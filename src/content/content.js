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
    transcriptTranslated: false, // true if machine-translated via &tlang=
    transcriptSource: null, // "fetch" | "dom-scrape"
    // idle | loading | ready | no-captions | empty | error
    transcriptStatus: "idle",
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
        transcriptTranslated: state.transcriptTranslated,
        transcriptSource: state.transcriptSource,
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
    handleCaptionTracks(data.videoId, data.tracks, data.translationLanguages);
  });

  function handleCaptionTracks(videoId, tracks, translationLanguages) {
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

    const preferred = state.settings.preferredLanguage;
    const nativeMatch = preferred && tracks.find((t) => t.languageCode === preferred);

    let track = nativeMatch || tracks.find((t) => t.kind !== "asr") || tracks[0];
    let tlang = null;

    // No native track in the preferred language — fall back to asking
    // YouTube to machine-translate an existing track (e.g. auto-generated
    // captions in the spoken language) into it, if it offers that language.
    if (!nativeMatch && preferred && translationLanguages && translationLanguages.includes(preferred)) {
      track = tracks.find((t) => t.kind !== "asr") || tracks[0];
      tlang = preferred;
    }

    state.transcriptStatus = "loading";
    fetchTranscript(track.baseUrl, tlang)
      .then((entries) => {
        if (entries.length) {
          state.transcript = entries;
          state.transcriptLanguage = tlang || track.languageCode;
          state.transcriptTranslated = !!tlang;
          state.transcriptSource = "fetch";
          state.transcriptStatus = "ready";
        } else {
          // YouTube can return HTTP 200 with a genuinely empty body for a
          // track that does exist — this isn't the same as "no captions at
          // all" (see startTranscriptFallbackWatcher below for how we try
          // to recover from it).
          state.transcriptStatus = "empty";
          startTranscriptFallbackWatcher();
        }
      })
      .catch(() => {
        state.transcriptStatus = "error";
        startTranscriptFallbackWatcher();
      });
  }

  async function fetchTranscript(baseUrl, tlang) {
    let url = baseUrl + (baseUrl.includes("?") ? "&" : "?") + "fmt=json3";
    if (tlang) url += "&tlang=" + encodeURIComponent(tlang);
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

  // ---------- transcript-panel DOM fallback ----------
  //
  // YouTube's public timedtext endpoint (used above) sometimes returns HTTP
  // 200 with an empty body for a track that genuinely exists and that
  // YouTube's own "Show transcript" panel can still display — this appears
  // to be a platform-side restriction on that legacy endpoint, not anything
  // specific to a video or caption language. The panel itself fetches
  // through an authenticated, session-bound API we deliberately don't
  // replicate. Instead, if the viewer opens that panel themselves (a real
  // click — a script-triggered one doesn't trigger YouTube's handler), we
  // read the transcript straight out of the resulting DOM.

  let transcriptFallbackObserver = null;

  function parseTimestampToSeconds(text) {
    const parts = text.trim().split(":").map(Number);
    if (!parts.length || parts.some((p) => Number.isNaN(p))) return null;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }

  function scrapeTranscriptPanel() {
    // YouTube has shipped at least two different transcript-panel markups:
    // the older Polymer <ytd-transcript-segment-renderer> (with dedicated
    // "timestamp"/"segment-text" classes) and a newer
    // <transcript-segment-view-model> whose class names are opaque/hashed
    // (a Tailwind-like atomic build), where the timestamp and caption text
    // are just plain child <div>/<span> elements distinguished only by
    // position and content shape. We match structurally so this survives
    // either markup, since we can't rely on the newer one's class names.
    const nodes = document.querySelectorAll(
      "transcript-segment-view-model, ytd-transcript-segment-renderer"
    );
    if (!nodes.length) return null;

    const entries = [];
    nodes.forEach((node) => {
      const directDivs = Array.from(node.querySelectorAll(":scope > div"));
      const timestampDiv = directDivs.find((d) => /^\d{1,2}(:\d{2}){1,2}$/.test(d.textContent.trim()));
      let start = timestampDiv ? parseTimestampToSeconds(timestampDiv.textContent) : null;
      let text = (node.querySelector("span") || {}).textContent || "";

      if (start == null) {
        const tsEl = node.querySelector('[class*="timestamp"]');
        start = tsEl ? parseTimestampToSeconds(tsEl.textContent) : null;
      }
      if (!text) {
        const textEl = node.querySelector('[class*="segment-text"]');
        text = textEl ? textEl.textContent : node.textContent;
      }

      text = text.replace(/\s+/g, " ").trim();
      if (text && start != null) entries.push({ start, end: start, text });
    });
    return entries.length ? entries : null;
  }

  function stopTranscriptFallbackWatcher() {
    if (transcriptFallbackObserver) {
      transcriptFallbackObserver.disconnect();
      transcriptFallbackObserver = null;
    }
  }

  function startTranscriptFallbackWatcher() {
    if (transcriptFallbackObserver) return; // already watching
    transcriptFallbackObserver = new MutationObserver(() => {
      const entries = scrapeTranscriptPanel();
      if (!entries) return;
      state.transcript = entries;
      state.transcriptSource = "dom-scrape";
      // The panel doesn't tell us which language it's showing; the
      // configured preferred language is the best guess available (the
      // viewer likely opened the panel because that's what they expected
      // to see) — used only to pick a stopword list for quiz generation.
      state.transcriptLanguage = state.transcriptLanguage || state.settings.preferredLanguage || null;
      state.transcriptStatus = "ready";
      stopTranscriptFallbackWatcher();
    });
    transcriptFallbackObserver.observe(document.body, { childList: true, subtree: true });
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

    if (!segment.length) {
      // Nothing was actually said since the last quiz (e.g. music/silence)
      // — never fall back to the full transcript, or the question could be
      // about content the viewer hasn't reached yet, or already covered.
      state.lastQuizVideoTime = video.currentTime;
      return;
    }

    const question = window.VideoQuizGen.generateQuestion(
      segment,
      state.transcript,
      state.settings.numOptions,
      state.transcriptLanguage
    );

    if (!question) {
      // The played window had transcript text but nothing quizzable in it
      // (e.g. only filler words); don't stall waiting for a quiz that can't
      // be built from that window.
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
    state.transcriptTranslated = false;
    state.transcriptSource = null;
    state.transcriptStatus = "idle";
    state.lastQuizVideoTime = 0;
    stopTranscriptFallbackWatcher();
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
