# Architecture

## Components

```
manifest.json                    Manifest V3 config
src/
  content/
    extract-captions.js          Runs in the page's MAIN world
    content.js                   Runs in the isolated content-script world
    overlay.css                  Quiz overlay styling
  lib/
    quiz.js                      Word/sentence selection + cloze question builder (no deps)
  background/
    background.js                Seeds default settings; proxies translation lookups
  popup/
    popup.html/js/css            Settings UI + live status
```

## Why two content scripts in two "worlds"

YouTube embeds the data we need (caption track URLs, video ID) in a page
global, `window.ytInitialPlayerResponse`. Manifest V3 content scripts run in
an **isolated world** by default — they share the page's DOM but not its JS
globals — specifically so extensions can't read arbitrary page state. That's
usually what you want, but here we need that one specific global.

The fix is a second content script declared with `"world": "MAIN"`
(`extract-captions.js`), which *does* share the page's JS context. It only
reads `ytInitialPlayerResponse` and re-broadcasts the caption track list via
`window.postMessage`, which the isolated-world script (`content.js`) picks up
with a `message` listener. This keeps the MAIN-world script minimal — it
never touches `chrome.*` APIs (it can't; only the isolated world has access
to extension APIs) and never fetches anything itself.

## Data flow

1. `extract-captions.js` reads `ytInitialPlayerResponse.captions...captionTracks`
   (and the sibling `translationLanguages` list — see below) and posts
   `{type: "CAPTION_TRACKS", videoId, tracks, translationLanguages}` to the
   window.
2. `content.js` receives that message and picks a track:
   - a **native track in the configured language**, if one exists;
   - otherwise, if the configured language isn't a native track but *is* in
     `translationLanguages`, a non-auto-generated (or else auto-generated)
     base track, fetched with `&tlang=<code>` appended so YouTube
     machine-translates it on the fly (see "Translated captions" below);
   - otherwise, whatever non-auto-generated track exists, or the first track.

   It then fetches `<baseUrl>&fmt=json3[&tlang=<code>]` — YouTube's own
   timedtext endpoint — to get the transcript as JSON: a list of
   `{start, end, text}` entries. If that fetch comes back empty (see
   "When the timedtext endpoint returns nothing" below), a DOM-scrape
   fallback takes over instead.
3. `content.js` attaches a `timeupdate` listener to the `<video>` element. On
   each tick it checks how much video time has elapsed since the last quiz;
   once that exceeds the configured interval, it slices the transcript
   entries spoken during that window and hands them to `quiz.js`.
4. `content.js` picks a question type at random from the enabled ones
   (`settings.questionTypes`) and builds it — either
   `VideoQuizGen.generateClozeQuestion` directly, or (for "word meaning")
   `VideoQuizGen.pickQuizWord` followed by a translation lookup that falls
   back to a cloze question on failure. See
   [QUIZ_GENERATION.md](QUIZ_GENERATION.md) for both.
5. `content.js` pauses the video, renders the question as an absolutely
   positioned overlay inside the player container, and waits for an answer.
   Selecting an option updates the running score, reveals correctness and
   the right answer; a "Continue video" button resumes playback and resets
   the interval timer. If the configured per-video question limit is now
   reached, a session summary is shown instead of resuming immediately (see
   "Scoring and session limits" below).

## Translated captions

Many videos have no native caption track in a learner's target language, but
YouTube can machine-translate an existing track into one on request — this
is the same "Auto-translate" feature exposed in the YouTube UI's subtitle
menu. `playerCaptionsTracklistRenderer.translationLanguages` lists every
language code YouTube offers this for; appending `&tlang=<code>` to any
track's timedtext URL returns that track translated into `<code>`, generated
server-side by Google Translate.

`content.js` uses this only as a fallback (see step 2 above) — a native
track in the configured language is always preferred, since a
professionally- or community-written track is far more accurate than a
machine translation of (often already imperfect) auto-generated captions.
The popup surfaces this by appending "machine-translated" to the status line
when it happens, so it's clear the transcript — and therefore the quiz
sentences — may contain translation artifacts.

## When the timedtext endpoint returns nothing

The direct timedtext fetch (step 2 above) is a legacy, unauthenticated
YouTube endpoint. In testing, it reliably returned **HTTP 200 with a
completely empty body** for some caption tracks — reproduced across multiple
unrelated videos and both auto-generated and non-auto-generated tracks, in
every response format the endpoint supports (`json3`, `srv1`, `srv3`, `vtt`,
and the plain default). YouTube's own site can still display the transcript
for these videos, but only through its "Show transcript" panel, which is
backed by a different, session-authenticated internal API
(`youtubei/v1/get_panel`) that isn't something this extension replicates —
doing so would mean reverse-engineering and re-signing an authenticated,
undocumented endpoint, which is both fragile (liable to break without
notice) and not something to build against another product's private API.

Instead, `content.js` falls back to reading the transcript out of the DOM
*after* the viewer opens YouTube's real "Show transcript" panel themselves:

- When a fetch returns zero entries (`transcriptStatus = "empty"`) or throws
  (`"error"`), `startTranscriptFallbackWatcher()` attaches a `MutationObserver`
  to `document.body`.
- Note that a **script-triggered click on YouTube's "Show transcript" button
  does not open the panel** — this was tested directly and the panel stayed
  closed, so the extension cannot trigger this itself. The popup's status
  line tells the viewer to open it manually instead (a normal, single click).
- Once the viewer does, YouTube populates the panel with transcript
  segments, and the observer's callback calls `scrapeTranscriptPanel()`,
  which reads `{start, text}` out of each segment element and, on success,
  disconnects the observer and marks the transcript ready
  (`transcriptSource = "dom-scrape"`).
- `scrapeTranscriptPanel()` matches two known markups structurally rather
  than by class name, because the newer one's classes are opaque/hashed
  (an atomic-CSS build) and carry no semantic meaning to select on:
  - legacy `<ytd-transcript-segment-renderer>`, which has dedicated
    `[class*="timestamp"]` / `[class*="segment-text"]` elements;
  - current `<transcript-segment-view-model>`, where a segment is a plain
    `<div>` (short timestamp, e.g. `"0:41"`) + another `<div>` (a duplicate
    accessibility label, e.g. `"41 seconds"`, deliberately skipped) + a
    `<span>` (the caption text) — matched by picking the direct-child `<div>`
    whose text matches `H:MM:SS`/`M:SS` as the timestamp, and the segment's
    `<span>` as the text.

This fallback is deliberately last-resort and manual-assist rather than
automatic, since it depends on markup that could change and on the viewer
taking one extra action — see [LIMITATIONS.md](LIMITATIONS.md).

## Scoring and session limits

`state.score = {correct, total}` is incremented in the option-click handler
in `showQuiz()`, for either question type identically (both resolve to a
`correctAnswer` string to compare against). It's per-video, in-memory only —
see [LIMITATIONS.md](LIMITATIONS.md) for what that means across reloads.

- The running score is appended to the feedback line after every question
  ("Correct! Score: 4/5") and shown in the popup status whenever at least
  one question has been asked.
- `settings.maxQuestions` (0 = unlimited) caps how many questions are asked
  per video. `onTimeUpdate` checks `score.total >= maxQuestions` before
  even trying to build a question, so once the cap is hit, quizzing simply
  stops for the rest of that video — playback is otherwise unaffected.
- A **session summary** overlay (`showSessionSummary()`) reports the final
  score in two cases: when the cap is reached (right after the capping
  question's "Continue" is clicked — video stays paused until the summary
  is dismissed) or when the video's native `ended` event fires (whichever
  comes first; a `summaryShown` flag stops it from firing twice for the
  same video).

## Settings and state

- **Settings** (`enabled`, `intervalSeconds`, `numOptions`,
  `preferredLanguage`, `maxQuestions`, `questionTypes`, `definitionLanguage`)
  live in `chrome.storage.sync`, edited from the popup, and are read
  reactively via `chrome.storage.onChanged` so a change applies immediately
  without reloading the page.
- **Per-video state** (transcript, last quiz time, quiz-active flag, score,
  translation cache) lives in memory inside `content.js`. YouTube is a
  single-page app — navigating to a new video doesn't reload the page or
  reinject content scripts — so this state is reset on the
  `yt-navigate-finish` DOM event YouTube fires after a client-side
  navigation, and a fresh caption-track request is sent to
  `extract-captions.js`.
- The **popup** asks the active tab's content script for status
  (`GET_STATUS` runtime message) rather than keeping its own copy of state,
  since the popup is transient and the content script is the source of truth.

## Permissions

- `storage` — for settings.
- `host_permissions: https://www.youtube.com/*` — to run the content scripts
  and let the isolated-world script fetch the timedtext endpoint (a
  same-origin request, so no extra permission is needed for the fetch itself).
- `host_permissions: https://translate.googleapis.com/*` — lets the
  **background service worker** (not the content script — see "Word meaning
  question type" in [QUIZ_GENERATION.md](QUIZ_GENERATION.md)) fetch word
  translations across origins without being blocked by CORS.

No `tabs` or `activeTab` permission is requested: the popup only needs a tab
ID to message the content script, which doesn't require either.
