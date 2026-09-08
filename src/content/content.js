// Isolated-world content script: owns extension state, talks to
// chrome.storage/runtime, fetches the transcript, watches video playback,
// and renders the quiz overlay. Reads caption track URLs posted by
// extract-captions.js (which runs in the page's MAIN world) and question
// generation from quiz.js (loaded before this file, exposes VideoQuizGen).
(function () {
  const SOURCE = "video-quiz-plugin";

  const DEFAULT_SETTINGS = {
    enabled: true,
    intervalSeconds: 90,
    numOptions: 4,
    preferredLanguage: "", // empty = use first available caption track
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    videoId: null,
    transcript: null, // [{start, end, text}]
    transcriptLanguage: null,
    transcriptStatus: "idle", // idle | loading | ready | no-captions | error
    video: null,
    lastQuizVideoTime: 0,
    quizActive: false,
    overlayEl: null,
  };

  // ---------- settings ----------

  function loadSettings() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
      state.settings = { ...DEFAULT_SETTINGS, ...stored };
    });
  }
  loadSettings();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const key of Object.keys(changes)) {
      if (key in DEFAULT_SETTINGS) {
        state.settings[key] = changes[key].newValue;
      }
    }
  });

  // ---------- popup status messaging ----------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "GET_STATUS") {
      sendResponse({
        onVideoPage: !!state.video,
        transcriptStatus: state.transcriptStatus,
        transcriptLanguage: state.transcriptLanguage,
        numSegments: state.transcript ? state.transcript.length : 0,
        enabled: state.settings.enabled,
      });
    }
    return true;
  });

  // ---------- caption track discovery + transcript fetch ----------

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== "CAPTION_TRACKS") return;
    handleCaptionTracks(data.videoId, data.tracks);
  });

  function handleCaptionTracks(videoId, tracks) {
    if (!videoId || state.transcript || state.transcriptStatus === "loading") {
      // Already have (or are fetching) a transcript for the current video.
      if (videoId && videoId !== state.videoId) {
        // A genuinely new video slipped in without a nav event; reset.
        resetForNewVideo(videoId);
      } else {
        return;
      }
    }
    state.videoId = videoId;

    if (!tracks || tracks.length === 0) {
      state.transcriptStatus = "no-captions";
      return;
    }

    const track =
      tracks.find((t) => t.languageCode === state.settings.preferredLanguage) ||
      tracks.find((t) => t.kind !== "asr") ||
      tracks[0];

    state.transcriptStatus = "loading";
    fetchTranscript(track.baseUrl)
      .then((entries) => {
        state.transcript = entries;
        state.transcriptLanguage = track.languageCode;
        state.transcriptStatus = entries.length ? "ready" : "no-captions";
      })
      .catch(() => {
        state.transcriptStatus = "error";
      });
  }

  async function fetchTranscript(baseUrl) {
    const url = baseUrl + (baseUrl.includes("?") ? "&" : "?") + "fmt=json3";
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("transcript fetch failed: " + res.status);
    const data = await res.json();
    const entries = [];
    for (const event of data.events || []) {
      if (!event.segs || typeof event.tStartMs !== "number") continue;
      const text = event.segs.map((s) => s.utf8 || "").join("").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const start = event.tStartMs / 1000;
      const duration = (event.dDurationMs || 0) / 1000;
      entries.push({ start, end: start + duration, text });
    }
    return entries;
  }

  // ---------- video discovery + playback watching ----------

  function findVideo() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function attachVideoWatcher() {
    const video = findVideo();
    if (!video || video === state.video) return;
    state.video = video;
    video.addEventListener("timeupdate", onTimeUpdate);
  }

  function onTimeUpdate() {
    const video = state.video;
    if (!video) return;
    if (!state.settings.enabled) return;
    if (state.quizActive) return;
    if (state.transcriptStatus !== "ready") return;
    if (video.currentTime < 5) return;

    const elapsedSinceLastQuiz = video.currentTime - state.lastQuizVideoTime;
    if (elapsedSinceLastQuiz < state.settings.intervalSeconds) return;

    const segment = state.transcript.filter(
      (e) => e.start >= state.lastQuizVideoTime && e.start <= video.currentTime
    );

    const question = window.VideoQuizGen.generateQuestion(
      segment.length ? segment : state.transcript,
      state.transcript,
      state.settings.numOptions,
      state.transcriptLanguage
    );

    if (!question) {
      // Not enough material in this window (e.g. mostly music/silence);
      // don't stall forever waiting for a quiz that can't be built.
      state.lastQuizVideoTime = video.currentTime;
      return;
    }

    showQuiz(question);
  }

  // ---------- quiz overlay ----------

  function findPlayerContainer() {
    return (
      document.getElementById("movie_player") ||
      document.querySelector(".html5-video-player") ||
      state.video.parentElement
    );
  }

  function showQuiz(question) {
    state.quizActive = true;
    state.video.pause();

    const container = findPlayerContainer();
    const overlay = document.createElement("div");
    overlay.className = "vqp-overlay";
    overlay.innerHTML = `
      <div class="vqp-card">
        <div class="vqp-title">Comprehension check</div>
        <div class="vqp-sentence"></div>
        <div class="vqp-options"></div>
        <div class="vqp-feedback" hidden></div>
        <button class="vqp-continue" hidden>Continue video</button>
      </div>
    `;
    overlay.querySelector(".vqp-sentence").textContent = question.sentence;

    const optionsEl = overlay.querySelector(".vqp-options");
    const feedbackEl = overlay.querySelector(".vqp-feedback");
    const continueBtn = overlay.querySelector(".vqp-continue");

    question.options.forEach((option) => {
      const btn = document.createElement("button");
      btn.className = "vqp-option";
      btn.textContent = option;
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        Array.from(optionsEl.children).forEach((b) => (b.disabled = true));

        const isCorrect = option === question.correctAnswer;
        btn.classList.add(isCorrect ? "vqp-correct" : "vqp-incorrect");
        if (!isCorrect) {
          Array.from(optionsEl.children)
            .find((b) => b.textContent === question.correctAnswer)
            ?.classList.add("vqp-correct");
        }

        feedbackEl.textContent = isCorrect
          ? "Correct!"
          : `Not quite — the answer was "${question.correctAnswer}".`;
        feedbackEl.hidden = false;
        continueBtn.hidden = false;
        continueBtn.focus();
      });
      optionsEl.appendChild(btn);
    });

    continueBtn.addEventListener("click", () => {
      closeQuiz(overlay);
    });

    container.appendChild(overlay);
    state.overlayEl = overlay;
  }

  function closeQuiz(overlay) {
    overlay.remove();
    state.overlayEl = null;
    state.quizActive = false;
    state.lastQuizVideoTime = state.video.currentTime;
    state.video.play();
  }

  // ---------- SPA navigation handling ----------

  function resetForNewVideo(newVideoId) {
    state.videoId = newVideoId;
    state.transcript = null;
    state.transcriptLanguage = null;
    state.transcriptStatus = "idle";
    state.lastQuizVideoTime = 0;
    if (state.overlayEl) {
      state.overlayEl.remove();
      state.overlayEl = null;
    }
    state.quizActive = false;
    if (state.video) {
      state.video.removeEventListener("timeupdate", onTimeUpdate);
      state.video = null;
    }
    window.postMessage({ source: SOURCE, type: "REQUEST_CAPTION_TRACKS" }, "*");
  }

  document.addEventListener("yt-navigate-finish", () => {
    resetForNewVideo(null);
    setTimeout(attachVideoWatcher, 500);
  });

  // ---------- boot ----------

  attachVideoWatcher();
  const bootWatcher = setInterval(() => {
    attachVideoWatcher();
    if (state.video) clearInterval(bootWatcher);
  }, 500);
})();
