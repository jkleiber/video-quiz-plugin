# Quiz Generation

The extension asks two kinds of questions, chosen randomly per round from
whichever types are enabled in settings (default: both):

- **Fill in the blank (cloze)** — entirely offline, described below.
- **Word meaning** — underlines a word in its sentence and asks the viewer
  to pick its correct translation/meaning from multiple choice. This one
  *does* need a network call (there's no way to derive a word's meaning from
  the transcript alone) — see
  [Word meaning question type](#word-meaning-question-type) below.

Both types share the same underlying word/sentence selection logic
(`pickQuizWord` in `src/lib/quiz.js`) — they differ only in what they do
with the picked word: blank it out (cloze) or look up its meaning
(definition).

## Why cloze deletion is entirely offline

`generateClozeQuestion` needs no API key and no network call beyond the
transcript fetch already described in [ARCHITECTURE.md](ARCHITECTURE.md).
This was chosen over calling out to an LLM for question generation for a
few reasons:

- **Zero setup.** The extension works the moment it's installed. Requiring an
  API key (and paying per-call for a quiz every 90 seconds of every video)
  would be a real barrier for a browser extension meant to be used casually.
- **Cloze deletion is a well-established language-learning technique** on its
  own merits — it directly tests whether the learner tracked the vocabulary
  and sentence structure that was just spoken, which is the stated goal
  ("prove understanding").
- It's a natural place to extend later — see [LIMITATIONS.md](LIMITATIONS.md)
  for what an LLM-backed version would add.

## Fill-in-the-blank algorithm

Given the transcript entries spoken since the last quiz:

1. **Segment into sentence-like units.** Split on `.`/`!`/`?`. Auto-generated
   YouTube captions frequently carry no punctuation at all, so if that split
   doesn't produce at least two usable (5+ word) pieces, fall back to
   chunking the raw text into fixed 10-word windows instead.
2. **Shuffle the candidate sentences** so repeated quizzes on similar content
   don't always pick the first sentence.
3. **Pick a target word to blank out.** For each sentence (in shuffled
   order), find words that are: long enough, alphabetic (any Unicode script —
   contractions like "don't" allowed), and not in a stopword list (articles,
   pronouns, auxiliary verbs, filler words like "um"/"like"). This biases
   the blank toward a content word — a noun, verb, or adjective — rather
   than grammatical glue, which is what a comprehension check should target.
   The first sentence with at least one such candidate wins; one candidate
   word is picked at random from it.

   The minimum length is 4 letters for Latin/Cyrillic/etc. scripts, but 1 for
   CJK scripts (Hangul, Hiragana/Katakana, Chinese ideographs) detected via
   Unicode range, since a single Hangul syllable or Han character often
   carries a full word's worth of meaning. Stopword lists are keyed by the
   caption track's language code; **English and Korean have curated lists**
   today, other languages fall back to the English list (tokenization still
   works, but a target language's own function words won't be filtered out
   as well — see [LIMITATIONS.md](LIMITATIONS.md)).
4. **Build distractors.** A word pool is built from the *entire* video
   transcript (not just the current segment) using the same
   length/stopword filter, deduplicated by lowercase form. `numOptions - 1`
   words are sampled at random from that pool, excluding the correct answer.
   If the video's own transcript doesn't have enough distinct candidate
   words (very short or repetitive videos), a small built-in list of common
   English words pads out the remainder so a question can still be posed.
5. **Render.** The chosen word's first case-insensitive whole-word occurrence
   in the sentence is replaced with `_____`; the correct answer and
   distractors are shuffled into the option list.

If no sentence in the window yields any candidate word (e.g. the segment is
music or a very short interjection), `pickQuizWord` (and so
`generateClozeQuestion`) returns `null` and `content.js` skips that interval
rather than blocking the video indefinitely waiting for a quiz that can't be
built.

## Why not scrape random dictionary words as distractors?

Using words from the *same video* as distractors, rather than a fixed
dictionary, keeps the multiple-choice options topically related to what the
learner is watching, which makes the "wrong" choices plausible instead of
comically unrelated — the difference between a real comprehension check and
a word-recognition freebie.

## Word meaning question type

Unlike cloze deletion, there's no way to derive a word's *meaning* from the
transcript itself — that requires an actual translation/dictionary lookup.
`content.js` (not `quiz.js`, which stays synchronous and dependency-free)
handles this:

1. Call the shared `pickQuizWord()` to get a sentence, a target word, and
   distractor words — the same selection logic the cloze question uses.
2. Look up the target word's translation into the configured
   "definition language" (default English), plus a translation of each
   distractor word, so the wrong answers are other real words' meanings
   rather than obviously-fake options.
3. Present the sentence with the target word underlined (not blanked —
   the viewer needs to see it to define it) and the translated meanings as
   multiple-choice options.

The lookup uses `translate.googleapis.com`'s unofficial, no-API-key
"gtx" endpoint (the same one many open-source translation tools rely on).
It's called from the **background service worker**, not the content
script: a content script's `fetch()` is subject to the page's CORS policy,
which would block a cross-origin call to a third party like this, while an
extension page's `fetch()` is exempt for hosts listed in `host_permissions`.
`content.js` sends a `TRANSLATE_WORD` runtime message and `background.js`
performs the actual request (see manifest.json's
`https://translate.googleapis.com/*` host permission).

**This endpoint is unreliable in practice** — direct testing during
development got HTTP 429 ("Sorry...", Google's abuse page) from one
automated environment and HTTP 503 from another, on every query tried,
regardless of word. It may work better from an ordinary residential browser
session than it did from those, but it is fundamentally an undocumented API
with no uptime guarantee. Accordingly:

- Each of the target word + distractor lookups is attempted independently
  (`Promise.allSettled`, not `Promise.all`) so one failed lookup doesn't
  sink the whole question if the others succeeded — the question is just
  built with fewer options.
- If the target word's own translation fails, or fewer than one distinct
  distractor comes back, the question type is abandoned for that round and
  `content.js` falls back to a fill-in-the-blank question instead — the
  viewer still gets a quiz, just not this type, that round.
- Successful lookups are cached in memory per video (a word is only
  translated once even if it recurs as a distractor across multiple
  rounds); failures are not cached, so a later attempt can retry.

If this endpoint becomes unusable in some deployment context, disabling
"Word meaning" in the popup's question-type setting falls back to
fill-in-the-blank only, which has no such dependency.
