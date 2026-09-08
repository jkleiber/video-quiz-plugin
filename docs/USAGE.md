# Installing and Using the Extension

## Install (unpacked, for development/personal use)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `video-quiz-plugin` project folder
   (the one containing `manifest.json`).
4. The extension icon appears in the toolbar (Chrome will show a default
   puzzle-piece icon since no custom icon set is bundled yet — functionality
   is unaffected).

## Using it

1. Go to any `https://www.youtube.com/watch?v=...` page for a video that has
   captions (auto-generated captions work too, though quiz quality depends
   on their accuracy).
2. Click the extension icon to open the popup:
   - **Enabled** — turn quizzing on/off globally.
   - **Quiz interval** — how much video playback time passes between quizzes
     (30s to 5 minutes).
   - **Choices per question** — 3, 4, or 5 multiple-choice options.
   - **Caption language code** — set this to your target language (e.g.
     `ko`, `es`, `ja`) to quiz yourself in it. If the video has a native
     caption track in that language, it's used directly. If not, but
     YouTube offers to auto-translate the video's captions into that
     language (the same option available in YouTube's own subtitle menu),
     the extension requests a machine-translated transcript in that
     language instead — quiz sentences will then be translations, not the
     original spoken/written text, so expect occasional translation
     artifacts. Leave blank to let the extension pick automatically (it
     prefers a human-written track over an auto-generated one when both
     exist, no translation attempted).
   - The status line at the bottom reports whether a transcript was found
     for the current video, how many segments it has, and whether it's a
     machine-translated one.
3. Click **Save**. Settings apply immediately, without reloading the page.
4. Play the video normally. When the configured interval elapses, the video
   pauses and a question card appears over the player: a sentence from what
   was just said, with one word blanked out, and multiple-choice options to
   fill it in.
5. Pick an answer. The correct answer is highlighted (green) and, if you
   were wrong, your pick is highlighted red. Click **Continue video** to
   resume playback — the interval timer restarts from that point.

## Notes

- Quizzing only starts after 5 seconds of playback and only once the
  transcript has finished loading (near-instant for most videos).
- If a video has no captions at all, the popup will say so and no quizzes
  will be generated for it.
- Settings are shared across all videos/tabs (via `chrome.storage.sync`),
  not per-video.
