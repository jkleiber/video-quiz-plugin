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
   - **Questions per pause** — how many questions are asked back-to-back
     each time the video pauses (1-5). The **Quiz interval** setting above
     still controls how often that pause happens; this only controls how
     many questions you get during each one. If the extension runs out of
     quizzable material partway through (e.g. a short interval didn't have
     enough spoken content for 5 distinct questions), that pause just ends
     early with fewer.
   - **Question types** — enable "Fill in the blank", "Word meaning", or
     both (at least one stays checked; unchecking the last one re-checks
     it). When both are on, each round randomly picks one. "Word meaning"
     underlines a word in its sentence and asks you to pick its correct
     translation from multiple choice — it needs a network lookup (see
     below), so if that lookup fails for a given round, that round falls
     back to "Fill in the blank" instead of skipping the quiz.
   - **Show meanings in (language code)** — only shown when "Word meaning"
     is enabled; the language "Word meaning" answers are translated into
     (default `en`). Set this to your *native* language, not your target
     one — e.g. if you're learning Korean, leave this as `en` (or your own
     native language) so the meanings are things you can actually read.
   - The status line at the bottom reports whether a transcript was found
     for the current video, how many segments it has, whether it's a
     machine-translated one, and your running score for the video once
     you've answered at least one question.
3. Click **Save**. Settings apply immediately, without reloading the page.
4. Play the video normally. When the configured interval elapses, the video
   pauses and a question card appears over the player: either a sentence
   from what was just said with one word blanked out, or that same sentence
   with a word underlined and multiple-choice translations of its meaning.
5. Pick an answer. The correct answer is highlighted (green) and, if you
   were wrong, your pick is highlighted red; the feedback line also shows
   your running score for the video. If "Questions per pause" is more than
   1, click **Next question** to move to the next one in this pause (the
   video stays paused for all of them); on the last question of the pause,
   the button reads **Continue video** and resumes playback — the interval
   timer restarts from that point.
6. When you reach the end of the video, a **quiz session complete** summary
   shows your final score and percentage for the whole video.

## If the popup says captions couldn't be fetched

For some videos, YouTube's direct caption-fetch endpoint returns nothing
even though the video does have captions (see
[ARCHITECTURE.md](ARCHITECTURE.md#when-the-timedtext-endpoint-returns-nothing)
for why). The popup status line will say so and tell you to:

1. Scroll down below the video, click **...more** to expand the description
   if needed, and click **Show transcript**.
2. That's it — once YouTube's own transcript panel loads, Video Quiz reads
   it automatically within a second or two and starts quizzing normally.
   You can close the panel afterward if you don't want it taking up space.

This has to be a real click — the extension can't trigger this step for you
automatically.

## If "Word meaning" questions rarely or never appear

The meaning lookup relies on an unofficial, undocumented Google endpoint
that has no uptime guarantee — see
[QUIZ_GENERATION.md](QUIZ_GENERATION.md#word-meaning-question-type). When it
fails, the extension silently falls back to "Fill in the blank" for that
round rather than showing an error, so this can look like the setting isn't
doing anything. There's nothing to fix on your end; if it's persistent,
turning "Word meaning" off in the popup avoids the wasted lookup attempts.

## Notes

- Quizzing only starts after 5 seconds of playback and only once the
  transcript has finished loading (near-instant for most videos).
- If a video has no captions at all, the popup will say so and no quizzes
  will be generated for it.
- Settings are shared across all videos/tabs (via `chrome.storage.sync`),
  not per-video.
- Score is tracked per video, in memory only — reloading the page or
  navigating away and back resets it to 0/0. See
  [LIMITATIONS.md](LIMITATIONS.md).
