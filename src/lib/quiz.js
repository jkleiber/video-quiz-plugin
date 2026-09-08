// Generates fill-in-the-blank (cloze) comprehension questions from transcript
// text. Runs in the isolated content-script world alongside content.js, which
// calls into the VideoQuizGen global defined here. Deliberately dependency-free
// so the extension needs no build step.
(function (global) {
  const STOPWORDS = new Set(
    (
      "a an the and or but if then so because as of at by for with about " +
      "against between into through during before after above below to from " +
      "up down in out on off over under again further once here there when " +
      "where why how all any both each few more most other some such no nor " +
      "not only own same than too very s t can will just don should now is " +
      "am are was were be been being have has had having do does did doing " +
      "i you he she it we they me him her us them my your his its our their " +
      "this that these those what which who whom im youre hes shes its were " +
      "theyre ive youve weve theyve id youd hed shed wed theyd ill youll " +
      "hell shell well theyll gonna wanna gotta yeah okay ok uh um well like"
    ).split(" ")
  );

  function normalizeWord(raw) {
    return raw.replace(/[^A-Za-z']/g, "").toLowerCase();
  }

  function isCandidateWord(word) {
    const norm = normalizeWord(word);
    return norm.length >= 4 && !STOPWORDS.has(norm) && /^[a-z']+$/.test(norm);
  }

  // Splits a chunk of transcript text into sentence-like units. Auto-generated
  // captions frequently lack punctuation, so if splitting on punctuation
  // yields too little structure, fall back to fixed-size word chunks.
  function splitIntoSentences(text) {
    const punctSplit = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.split(/\s+/).length >= 5);

    if (punctSplit.length >= 2) return punctSplit;

    const words = text.split(/\s+/).filter(Boolean);
    const chunks = [];
    const CHUNK_SIZE = 10;
    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
      const chunk = words.slice(i, i + CHUNK_SIZE).join(" ");
      if (chunk.split(/\s+/).length >= 5) chunks.push(chunk);
    }
    return chunks;
  }

  function buildWordPool(fullText) {
    const words = fullText.split(/\s+/).filter(Boolean);
    const seen = new Map(); // normalized -> original display form
    for (const w of words) {
      if (!isCandidateWord(w)) continue;
      const norm = normalizeWord(w);
      if (!seen.has(norm)) seen.set(norm, norm);
    }
    return seen; // Map<normalizedWord, displayWord>
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const FALLBACK_DISTRACTORS = [
    "house", "water", "friend", "school", "money", "family", "music", "travel",
    "business", "morning", "weather", "kitchen", "answer", "problem", "picture",
  ];

  function pickDistractors(correctNorm, wordPool, count) {
    const pool = Array.from(wordPool.keys()).filter((w) => w !== correctNorm);
    const chosen = shuffle(pool).slice(0, count);
    let i = 0;
    while (chosen.length < count) {
      const fallback = FALLBACK_DISTRACTORS[i % FALLBACK_DISTRACTORS.length];
      i++;
      if (fallback !== correctNorm && !chosen.includes(fallback)) {
        chosen.push(fallback);
      }
      if (i > 50) break; // safety valve, should never trigger
    }
    return chosen;
  }

  // Blanks the first whole-word, case-insensitive occurrence of `word` in
  // `sentence`, preserving the rest of the sentence's original casing.
  function blankOutWord(sentence, word) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    return sentence.replace(re, "_____");
  }

  /**
   * @param {{text: string}[]} segmentEntries transcript entries spoken since
   *   the last quiz (defines which sentence the question is drawn from)
   * @param {{text: string}[]} fullTranscript entire video transcript (used
   *   only to build a larger, more varied distractor word pool)
   * @param {number} numOptions total multiple-choice options including the
   *   correct answer
   * @returns {{sentence: string, correctAnswer: string, options: string[]} | null}
   */
  function generateQuestion(segmentEntries, fullTranscript, numOptions) {
    numOptions = numOptions || 4;
    const segmentText = segmentEntries.map((e) => e.text).join(" ").trim();
    if (!segmentText) return null;

    const sentences = shuffle(splitIntoSentences(segmentText));
    const fullText = fullTranscript.map((e) => e.text).join(" ");
    const wordPool = buildWordPool(fullText);

    for (const sentence of sentences) {
      const words = sentence.split(/\s+/).filter(Boolean);
      const candidates = words.filter(isCandidateWord);
      if (candidates.length === 0) continue;

      const targetRaw = candidates[Math.floor(Math.random() * candidates.length)];
      const targetNorm = normalizeWord(targetRaw);
      if (!targetNorm) continue;

      const distractors = pickDistractors(targetNorm, wordPool, numOptions - 1);
      const options = shuffle([targetNorm, ...distractors]);

      return {
        sentence: blankOutWord(sentence, targetNorm),
        correctAnswer: targetNorm,
        options,
      };
    }
    return null;
  }

  global.VideoQuizGen = { generateQuestion };
})(window);
