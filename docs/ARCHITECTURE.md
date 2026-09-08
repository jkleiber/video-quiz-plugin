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
    quiz.js                      Cloze-question generator (no deps)
  background/
    background.js                Seeds default settings on install
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
   `{start, end, text}` entries.
3. `content.js` attaches a `timeupdate` listener to the `<video>` element. On
   each tick it checks how much video time has elapsed since the last quiz;
   once that exceeds the configured interval, it slices the transcript
   entries spoken during that window and hands them to `quiz.js`.
4. `quiz.js` (`VideoQuizGen.generateQuestion`) turns that slice into a
   fill-in-the-blank question (see [QUIZ_GENERATION.md](QUIZ_GENERATION.md)).
5. `content.js` pauses the video, renders the question as an absolutely
   positioned overlay inside the player container, and waits for an answer.
   Selecting an option reveals correctness and the right answer; a
   "Continue video" button resumes playback and resets the interval timer.

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

## Settings and state

- **Settings** (`enabled`, `intervalSeconds`, `numOptions`,
  `preferredLanguage`) live in `chrome.storage.sync`, edited from the popup,
  and are read reactively via `chrome.storage.onChanged` so a change applies
  immediately without reloading the page.
- **Per-video state** (transcript, last quiz time, quiz-active flag) lives in
  memory inside `content.js`. YouTube is a single-page app — navigating to a
  new video doesn't reload the page or reinject content scripts — so this
  state is reset on the `yt-navigate-finish` DOM event YouTube fires after a
  client-side navigation, and a fresh caption-track request is sent to
  `extract-captions.js`.
- The **popup** asks the active tab's content script for status
  (`GET_STATUS` runtime message) rather than keeping its own copy of state,
  since the popup is transient and the content script is the source of truth.

## Permissions

- `storage` — for settings.
- `host_permissions: https://www.youtube.com/*` — to run the content scripts
  and let the isolated-world script fetch the timedtext endpoint (a
  same-origin request, so no extra permission is needed for the fetch itself).

No `tabs` or `activeTab` permission is requested: the popup only needs a tab
ID to message the content script, which doesn't require either.
