# Known Limitations

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
- **No per-video settings or history.** Interval/options/language are global
  across all videos; there's no record of past quiz performance.
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
