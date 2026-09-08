# Testing

## What was actually verified

- **`src/lib/quiz.js` (question generation)** was run standalone under Node
  (stubbing the `window` global it attaches to) against sample transcript
  text, including edge cases: a normally-punctuated transcript, a segment
  with no punctuation and only filler/stopwords ("um yeah so like it was
  pretty good i guess"), and an empty segment. It correctly picked
  reasonable content-word blanks, built plausible distractors from the wider
  transcript, and returned `null` (rather than throwing or hanging) when no
  usable content was in the segment. This is the one piece of logic with no
  browser/DOM dependency, so it could be exercised directly.
- **Manifest and message-passing logic** (`extract-captions.js` →
  `content.js` via `window.postMessage`, `content.js` ↔ popup via
  `chrome.runtime`/`chrome.tabs` messaging, settings via
  `chrome.storage.sync`) were verified by code review against the
  Manifest V3 APIs — there's no way to execute `chrome.*` or a real YouTube
  page's globals outside an actual Chrome browser.

## What was not tested

This extension was **not** loaded into a real Chrome browser or exercised
against a live YouTube page in this session — that requires manual
interaction (`chrome://extensions` → Load unpacked → navigate to a video →
wait through a playback interval → interact with the overlay) that wasn't
performed here. The pieces most worth checking by hand, in order of how
likely they are to break given YouTube's frequent, unannounced page changes:

1. **`window.ytInitialPlayerResponse` still exists and still has
   `captions.playerCaptionsTracklistRenderer.captionTracks`** on a current
   YouTube watch page. Check via the browser console: type
   `ytInitialPlayerResponse.captions` and confirm it's populated.
2. **The timedtext fetch succeeds and returns parseable JSON**: with the
   extension loaded, open DevTools → Network on a YouTube video and confirm
   a request to `/api/timedtext...&fmt=json3` returns 200 with an `events`
   array.
3. **The overlay appears and blocks playback** at the configured interval,
   and **`yt-navigate-finish` still fires** when clicking a related video
   without a full page reload (confirms per-video state resets correctly).

See [USAGE.md](USAGE.md) for the install/use steps to check these yourself.
