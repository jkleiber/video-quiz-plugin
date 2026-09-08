# Quiz Generation

`src/lib/quiz.js` turns a slice of transcript into a multiple-choice
fill-in-the-blank (cloze) question, entirely offline — no API key, no network
call beyond the transcript fetch already described in
[ARCHITECTURE.md](ARCHITECTURE.md). This was chosen over calling out to an
LLM for question generation for a few reasons:

- **Zero setup.** The extension works the moment it's installed. Requiring an
  API key (and paying per-call for a quiz every 90 seconds of every video)
  would be a real barrier for a browser extension meant to be used casually.
- **Cloze deletion is a well-established language-learning technique** on its
  own merits — it directly tests whether the learner tracked the vocabulary
  and sentence structure that was just spoken, which is the stated goal
  ("prove understanding").
- It's a natural place to extend later — see [LIMITATIONS.md](LIMITATIONS.md)
  for what an LLM-backed version would add.

## Algorithm

Given the transcript entries spoken since the last quiz:

1. **Segment into sentence-like units.** Split on `.`/`!`/`?`. Auto-generated
   YouTube captions frequently carry no punctuation at all, so if that split
   doesn't produce at least two usable (5+ word) pieces, fall back to
   chunking the raw text into fixed 10-word windows instead.
2. **Shuffle the candidate sentences** so repeated quizzes on similar content
   don't always pick the first sentence.
3. **Pick a target word to blank out.** For each sentence (in shuffled
   order), find words that are: at least 4 letters, alphabetic (contractions
   like "don't" allowed), and not in a built-in stopword list (articles,
   pronouns, auxiliary verbs, filler words like "um"/"like"). This biases
   the blank toward a content word — a noun, verb, or adjective — rather
   than grammatical glue, which is what a comprehension check should target.
   The first sentence with at least one such candidate wins; one candidate
   word is picked at random from it.
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
music or a very short interjection), `generateQuestion` returns `null` and
`content.js` skips that interval rather than blocking the video indefinitely
waiting for a quiz that can't be built.

## Why not scrape random dictionary words as distractors?

Using words from the *same video* as distractors, rather than a fixed
dictionary, keeps the multiple-choice options topically related to what the
learner is watching, which makes the "wrong" choices plausible instead of
comically unrelated — the difference between a real comprehension check and
a word-recognition freebie.
