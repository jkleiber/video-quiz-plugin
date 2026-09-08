// Service worker: seeds default settings on install, and performs word
// translation lookups on behalf of the content script.
//
// Translation has to happen here rather than in content.js: a content
// script's fetch() is subject to the *page's* CORS policy (it's treated as
// coming from the page's origin), so a cross-origin call from a YouTube page
// to translate.googleapis.com would be blocked. An extension page's fetch
// (background/popup) is exempt from CORS for any host listed in
// host_permissions, so the lookup is proxied through here instead.
const DEFAULT_SETTINGS = {
  enabled: true,
  intervalSeconds: 90,
  numOptions: 4,
  preferredLanguage: "",
  questionsPerSession: 1,
  questionTypes: ["cloze", "definition"],
  definitionLanguage: "en",
};

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
});

// translate.googleapis.com is an unofficial, undocumented public endpoint
// (no API key, widely relied on by open-source translation tools) — not a
// documented/supported Google API. It can rate-limit or change without
// notice; callers must treat failures as routine, not exceptional.
async function translateWord(word, targetLang, sourceLang) {
  const params = new URLSearchParams({
    client: "gtx",
    sl: sourceLang || "auto",
    tl: targetLang || "en",
    dt: "t",
    q: word,
  });
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`);
  if (!res.ok) throw new Error("translate request failed: " + res.status);
  const data = await res.json();
  const translated = (data[0] || []).map((seg) => seg[0]).join("").trim();
  if (!translated) throw new Error("empty translation");
  return translated;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "TRANSLATE_WORD") {
    translateWord(message.word, message.targetLang, message.sourceLang)
      .then((translated) => sendResponse({ translated }))
      .catch((err) => sendResponse({ error: String(err && err.message ? err.message : err) }));
    return true; // keep the message channel open for the async response
  }
  return undefined;
});
