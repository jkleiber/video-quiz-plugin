# Testing

## What was actually verified

- **`src/lib/quiz.js` (question generation)** was run standalone under Node
  (stubbing the `window` global it attaches to) against sample transcript
  text: a normally-punctuated English transcript, a Korean transcript, a
  segment with no punctuation and only filler/stopwords ("um yeah so like it
  was pretty good i guess"), and an empty segment. It correctly picked
  reasonable content-word blanks (including Unicode/Korean text), built
  plausible distractors, and returned `null` (rather than throwing or
  hanging) when no usable content was in the segment.
- **Live YouTube behavior** was checked directly in a real Chrome browser
  (via browser automation) against multiple real videos, which is how the
  DOM-scrape fallback in `content.js`/`scrapeTranscriptPanel()` was
  designed and validated, not just reasoned about:
  - Confirmed `window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer`
    still exists and lists real caption tracks on current YouTube pages.
  - Confirmed the direct timedtext fetch (`<baseUrl>&fmt=json3`, and every
    other format the endpoint supports) returns **HTTP 200 with an empty
    body** for some tracks — reproduced on two unrelated videos/tracks — while
    YouTube's own "Show transcript" panel can still display the same
    video's transcript, through a different internal endpoint
    (`youtubei/v1/get_panel`) that isn't replicated here (see
    [ARCHITECTURE.md](ARCHITECTURE.md#when-the-timedtext-endpoint-returns-nothing)).
  - Confirmed a **script-triggered click on the "Show transcript" button
    does not open the panel** (tested directly) — only a real user click
    does, which is why the fallback is manual-assist, not automatic.
  - Confirmed the transcript panel's actual current markup
    (`<transcript-segment-view-model>`, not the older
    `<ytd-transcript-segment-renderer>`) and validated the scraping logic
    against it live: extracted all 305 segments of a real video's transcript
    correctly (timestamps and text), which is what `scrapeTranscriptPanel()`
    in `content.js` now implements.
- **Manifest and message-passing logic** (`extract-captions.js` →
  `content.js` via `window.postMessage`, `content.js` ↔ popup via
  `chrome.runtime`/`chrome.tabs` messaging, settings via
  `chrome.storage.sync`) were verified by code review against the
  Manifest V3 APIs.

## What was not tested

The extension has **not** been loaded as an unpacked extension and exercised
end-to-end in this session (the live-page checks above were done by running
equivalent code directly in the page, not by loading the actual `.js` files
as a Chrome extension). Worth checking by hand:

1. **The full pipeline end-to-end**: load unpacked, open a video, let the
   configured interval elapse, confirm the overlay appears and blocks
   playback, answer it, confirm playback resumes.
2. **The DOM-scrape fallback wired into the real extension**: on a video
   where the direct fetch comes back empty, confirm the popup's guidance
   text appears, manually click YouTube's "Show transcript", and confirm the
   popup status updates to "read from transcript panel" and quizzing starts.
3. **`yt-navigate-finish` still fires** when clicking a related video without
   a full page reload (confirms per-video state, including the fallback
   watcher, resets correctly between videos).

See [USAGE.md](USAGE.md) for the install/use steps to check these yourself.
