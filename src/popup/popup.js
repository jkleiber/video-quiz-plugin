const DEFAULT_SETTINGS = {
  enabled: true,
  intervalSeconds: 90,
  numOptions: 4,
  preferredLanguage: "",
};

const el = {
  enabled: document.getElementById("enabled"),
  intervalSeconds: document.getElementById("intervalSeconds"),
  numOptions: document.getElementById("numOptions"),
  preferredLanguage: document.getElementById("preferredLanguage"),
  save: document.getElementById("save"),
  status: document.getElementById("status"),
};

chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
  el.enabled.checked = settings.enabled;
  el.intervalSeconds.value = String(settings.intervalSeconds);
  el.numOptions.value = String(settings.numOptions);
  el.preferredLanguage.value = settings.preferredLanguage;
});

el.save.addEventListener("click", () => {
  const settings = {
    enabled: el.enabled.checked,
    intervalSeconds: Number(el.intervalSeconds.value),
    numOptions: Number(el.numOptions.value),
    preferredLanguage: el.preferredLanguage.value.trim(),
  };
  chrome.storage.sync.set(settings, () => {
    el.save.textContent = "Saved!";
    setTimeout(() => (el.save.textContent = "Save"), 1200);
  });
});

function renderStatus(response) {
  if (chrome.runtime.lastError || !response) {
    el.status.textContent = "Open a YouTube video to use Video Quiz.";
    return;
  }
  if (!response.onVideoPage) {
    el.status.textContent = "No video detected on this page yet.";
    return;
  }
  const lines = [];
  switch (response.transcriptStatus) {
    case "ready":
      lines.push(
        `Transcript loaded (${response.numSegments} segments${
          response.transcriptLanguage ? ", lang: " + response.transcriptLanguage : ""
        }${response.transcriptTranslated ? ", machine-translated" : ""}${
          response.transcriptSource === "dom-scrape" ? ", read from transcript panel" : ""
        }).`
      );
      break;
    case "loading":
      lines.push("Loading transcript…");
      break;
    case "no-captions":
      lines.push("No captions available for this video — quizzes can't be generated.");
      break;
    case "empty":
    case "error":
      lines.push(
        "This video has captions, but YouTube didn't return them to the extension directly " +
          "(this happens for some videos). Click the ⋯ under the video, expand the " +
          '"Show transcript" panel once yourself, and Video Quiz will pick it up automatically.'
      );
      break;
    default:
      lines.push("Waiting for video data…");
  }
  lines.push(response.enabled ? "Quizzing is ON." : "Quizzing is OFF.");
  el.status.textContent = lines.join("\n");
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab || !tab.id) {
    renderStatus(null);
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "GET_STATUS" }, (response) => {
    renderStatus(response);
  });
});
