# Known Limitations

- **The "Word meaning" question type depends on an unofficial, rate-limited
  translation endpoint.** `translate.googleapis.com`'s "gtx" endpoint has no
  API key, no documented SLA, and no official support — during development
  it returned HTTP 429 ("Sorry...", Google's abuse page) from one automated
  environment and HTTP 503 from another, on every query tried. It may behave
  better from an ordinary residential browser session, but there's no
  guarantee. Failures are handled gracefully (see
  [QUIZ_GENERATION.md](QUIZ_GENERATION.md#word-meaning-question-type)) — the
  round just falls back to "Fill in the blank" silently — but this means the
  "Word meaning" type can end up appearing rarely or not at all with no
  visible error, which can look like the setting isn't working. If that
  endpoint stops working entirely, this question type simply stops
  appearing (fill-in-the-blank is unaffected, since it has no such
  dependency); there's no automatic notification of that state today beyond
  the pattern of rarely seeing "Word meaning" questions.
- **Word-meaning translations aren't curated, and quality isn't verified.**
  A machine translation of a single word out of context can be wrong,
  overly literal, or ambiguous (many words have multiple meanings depending
  on context) — there's no verification that the returned meaning actually
  matches how the word was used in the sentence it's quizzing.
- **Score is in-memory only, not persisted.** Reloading the page,
  navigating away and back, or restarting the browser resets a video's
  score to 0/0 — there's no history of past quiz performance across
  sessions. The score is also not per-question-type: cloze and word-meaning
  answers count toward the same running total.
- **The direct caption-fetch endpoint sometimes returns nothing for videos
  that do have captions.** Confirmed across multiple unrelated videos and
  caption tracks (auto-generated and not) — YouTube returns HTTP 200 with an
  empty body from its legacy timedtext endpoint, while its own site can
  still show the transcript through an internal, authenticated panel API.
  See [ARCHITECTURE.md](ARCHITECTURE.md#when-the-timedtext-endpoint-returns-nothing)
  for the full explanation and the DOM-scrape fallback this extension uses
  to recover — it requires the viewer to manually click YouTube's own "Show
  transcript" button once (a script-triggered click doesn't work), which the
  popup status line prompts for when this happens. Until then, quizzing
  can't start for that video.
- **The DOM-scrape fallback depends on YouTube's transcript-panel markup**,
  which has already changed once (`ytd-transcript-segment-renderer` →
  `transcript-segment-view-model` with opaque/hashed class names — see
  ARCHITECTURE.md) and matches structurally (element position/content shape)
  rather than by class name to reduce — but not eliminate — fragility to
  future changes.
- **Requires captions.** Videos with no caption track at all (not even
  auto-generated, and not offered as a machine-translation target — see
  [ARCHITECTURE.md](ARCHITECTURE.md#translated-captions)) can't be quizzed —
  there's no transcript to draw questions from. Some videos also have
  subtitles burned directly into the video image ("hardcoded" subs); those
  aren't a caption track at all and are invisible to this extension.
- **Machine-translated transcripts inherit translation errors** on top of
  whatever transcription errors were already in the base track (worse still
  if the base track is itself auto-generated), so quiz sentences/answers for
  a translated language can occasionally be wrong or awkward in ways a
  native track wouldn't be.
- **Question quality tracks caption quality.** Auto-generated captions have
  no punctuation and occasional transcription errors, which can produce
  slightly awkward sentence chunks (handled via the fixed-size fallback
  chunking in `quiz.js`, but not eliminated).
- **Vocabulary-level, not comprehension-level, questions.** The cloze
  approach checks whether the learner recognizes/recalls a specific word in
  context. It doesn't verify deeper comprehension (e.g. "why did the
  speaker say X") — that would require actual natural-language understanding
  of the transcript, i.e. an LLM call. `quiz.js` is structured so that a
  future `generateQuestion` implementation (e.g. one that POSTs the segment
  to an LLM API and asks for a comprehension question) could be swapped in
  without changing `content.js` at all — it only depends on the
  `{sentence, correctAnswer, options}` return shape.
- **Depends on `window.ytInitialPlayerResponse`.** This is an internal
  YouTube page global, not a public API, and could change shape or
  disappear in a future YouTube redesign. `extract-captions.js` also checks
  the player element's `getPlayerResponse()` method as a fallback, but both
  are unofficial.
- **SPA navigation is handled via the `yt-navigate-finish` event**, which is
  also an unofficial (undocumented) signal YouTube's own frontend fires.
  If YouTube stops firing it, per-video state wouldn't reset correctly when
  navigating between videos without a full page reload (a manual page
  refresh would still work).
- **No per-video settings.** Interval/options/language/question-types are
  global across all videos (only the score itself, covered above, is
  per-video).
- **No custom icon set** — the extension currently uses Chrome's default
  icon. Cosmetic only.
- **Distractor words are unigrams, not curated by difficulty or part of
  speech** — they're just other content words from the same video (or a
  small fallback list), so occasionally a distractor may be an obviously
  wrong part of speech for the blank.
- **Stopword/distractor lists are only curated for English and Korean.**
  Tokenization itself is Unicode-aware and works for any script (see
  [QUIZ_GENERATION.md](QUIZ_GENERATION.md)), but a caption language without a
  dedicated list falls back to the English stopword list, which won't
  recognize that language's own function words (particles, articles,
  pronouns) — so blanks may sometimes land on grammatical glue instead of a
  content word. Add an entry to `STOPWORDS_BY_LANG` / `FALLBACK_DISTRACTORS_BY_LANG`
  in `src/lib/quiz.js` to improve quality for another language.
