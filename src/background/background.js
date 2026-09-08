// Minimal service worker: only responsible for seeding default settings the
// first time the extension is installed. All quiz logic lives in the content
// script since it needs direct access to the YouTube page and video element.
const DEFAULT_SETTINGS = {
  enabled: true,
  intervalSeconds: 90,
  numOptions: 4,
  preferredLanguage: "",
};

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
});
