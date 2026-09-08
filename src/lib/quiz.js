// Generates fill-in-the-blank (cloze) comprehension questions from transcript
// text. Runs in the isolated content-script world alongside content.js, which
// calls into the VideoQuizGen global defined here. Deliberately dependency-free
// so the extension needs no build step.
(function (global) {
  // Keyed by ISO 639-1 language code (matched against the caption track's
  // languageCode prefix, e.g. "ko" from "ko" or "ko-KR"). "en" is the
  // fallback for any language without a dedicated list — tokenization still
  // works via Unicode letter matching below, but function-word filtering
  // will be weaker for languages that aren't English or Korean.
  const STOPWORDS_BY_LANG = {
    en: new Set(
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
    ),
    // Common particles, pronouns, and conjunctions — not exhaustive, but
    // enough to keep the most frequent Korean function words from being
    // picked as a quiz blank.
    ko: new Set(
      "은 는 이 가 을 를 의 에 에서 에게 께 한테 으로 로 와 과 도 만 까지 부터 " +
      "마다 조차 밖에 이나 나 랑 이랑 하고 그리고 그러나 하지만 그래서 그런데 " +
      "그러면 즉 또는 혹은 나 너 저 우리 저희 너희 그 그녀 이것 저것 그것 여기 " +
      "저기 거기 무엇 어떻게 왜 언제 어디 누구 이제 좀 더 매우 정말 진짜 같이 " +
      "등 것 수 때 분 점 네 예 아니요 그냥 진짜로 너무 아주".split(" ")
    ),
  };

  function getStopwords(lang) {
    const code = (lang || "en").split("-")[0].toLowerCase();
    return STOPWORDS_BY_LANG[code] || STOPWORDS_BY_LANG.en;
  }

  // Matches Hangul syllables, Hiragana/Katakana, and CJK ideographs — scripts
  // where a single "word" carries much more meaning per character than in
  // space-delimited alphabetic scripts, so they need a shorter minimum length.
  const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힣]/;

  function normalizeWord(raw) {
    // Keep any Unicode letter (not just A-Z) plus apostrophes for contractions.
    return raw.replace(/[^\p{L}']/gu, "").toLowerCase();
  }

  function isCandidateWord(word, stopwords) {
    const norm = normalizeWord(word);
    if (!norm || stopwords.has(norm)) return false;
    if (!/^[\p{L}']+$/u.test(norm)) return false;
    const minLength = CJK_RE.test(norm) ? 1 : 4;
    return norm.length >= minLength;
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

  function buildWordPool(fullText, stopwords) {
    const words = fullText.split(/\s+/).filter(Boolean);
    const seen = new Map(); // normalized -> original display form
    for (const w of words) {
      if (!isCandidateWord(w, stopwords)) continue;
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

  const FALLBACK_DISTRACTORS_BY_LANG = {
    en: [
      "house", "water", "friend", "school", "money", "family", "music", "travel",
      "business", "morning", "weather", "kitchen", "answer", "problem", "picture",
    ],
    ko: [
      "학교", "친구", "가족", "날씨", "음악", "여행", "사업", "아침",
      "문제", "사진", "시간", "사람", "생각", "이야기", "마음",
    ],
  };

  function getFallbackDistractors(lang) {
    const code = (lang || "en").split("-")[0].toLowerCase();
    return FALLBACK_DISTRACTORS_BY_LANG[code] || FALLBACK_DISTRACTORS_BY_LANG.en;
  }

  function pickDistractors(correctNorm, wordPool, count, lang) {
    const pool = Array.from(wordPool.keys()).filter((w) => w !== correctNorm);
    const chosen = shuffle(pool).slice(0, count);
    const fallbackList = getFallbackDistractors(lang);
    let i = 0;
    while (chosen.length < count) {
      const fallback = fallbackList[i % fallbackList.length];
      i++;
      if (fallback !== correctNorm && !chosen.includes(fallback)) {
        chosen.push(fallback);
      }
      if (i > 50) break; // safety valve, should never trigger
    }
    return chosen;
  }

  // Finds the first case-insensitive occurrence of `word` in `sentence` that
  // isn't part of a larger run of letters/digits. Uses lookaround instead of
  // \b because \b is defined only in terms of ASCII word characters and
  // never matches at the edges of non-Latin scripts (e.g. Hangul), which
  // would silently fail to match anything.
  function findWordMatch(sentence, word) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, "iu");
    const m = re.exec(sentence);
    return m ? { index: m.index, text: m[0] } : null;
  }

  // Blanks out the first occurrence of `word` in `sentence` (see
  // findWordMatch), preserving the rest of the sentence's original casing.
  function blankOutWord(sentence, word) {
    const match = findWordMatch(sentence, word);
    if (!match) return sentence;
    return sentence.slice(0, match.index) + "_____" + sentence.slice(match.index + match.text.length);
  }

  /**
   * Picks one quizzable word out of the transcript segment spoken since the
   * last quiz, plus distractor words drawn from the wider transcript.
   * Shared by both question types (fill-in-the-blank and word-meaning) so
   * they draw from the same underlying selection logic.
   *
   * @param {{text: string}[]} segmentEntries transcript entries spoken since
   *   the last quiz (defines which sentence the question is drawn from)
   * @param {{text: string}[]} fullTranscript entire video transcript (used
   *   only to build a larger, more varied distractor word pool)
   * @param {string} [languageCode] the transcript's caption language (e.g.
   *   "ko", "en-US") — selects a stopword/distractor list tuned for that
   *   language when available, defaulting to English otherwise
   * @param {number} numDistractors how many distractor words to return
   * @returns {{sentence: string, word: string, distractorWords: string[]} | null}
   */
  function pickQuizWord(segmentEntries, fullTranscript, languageCode, numDistractors) {
    const segmentText = segmentEntries.map((e) => e.text).join(" ").trim();
    if (!segmentText) return null;

    const stopwords = getStopwords(languageCode);
    const sentences = shuffle(splitIntoSentences(segmentText));
    const fullText = fullTranscript.map((e) => e.text).join(" ");
    const wordPool = buildWordPool(fullText, stopwords);

    for (const sentence of sentences) {
      const words = sentence.split(/\s+/).filter(Boolean);
      const candidates = words.filter((w) => isCandidateWord(w, stopwords));
      if (candidates.length === 0) continue;

      const targetRaw = candidates[Math.floor(Math.random() * candidates.length)];
      const targetNorm = normalizeWord(targetRaw);
      if (!targetNorm) continue;

      return {
        sentence,
        word: targetNorm,
        distractorWords: pickDistractors(targetNorm, wordPool, numDistractors, languageCode),
      };
    }
    return null;
  }

  /**
   * @param {number} numOptions total multiple-choice options including the
   *   correct answer
   * @returns {{type: "cloze", sentence: string, correctAnswer: string, options: string[]} | null}
   */
  function generateClozeQuestion(segmentEntries, fullTranscript, numOptions, languageCode) {
    numOptions = numOptions || 4;
    const pick = pickQuizWord(segmentEntries, fullTranscript, languageCode, numOptions - 1);
    if (!pick) return null;

    return {
      type: "cloze",
      sentence: blankOutWord(pick.sentence, pick.word),
      correctAnswer: pick.word,
      options: shuffle([pick.word, ...pick.distractorWords]),
    };
  }

  global.VideoQuizGen = { generateClozeQuestion, pickQuizWord, findWordMatch, shuffle };
})(window);
