const LZString = require('lz-string');
const { stemmer } = require('stemmer');

// Use the same stop words as in the build script.
const stopWords = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'then',
  'else',
  'on',
  'in',
  'with',
  'to',
  'for',
  'of',
  'by',
  'at',
  'from',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
]);

// Tokenizer: lower-case, split on non-word characters, filter stop words, and apply stemming.
function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[\W_]+/)
    .filter((token) => token.length > 0 && !stopWords.has(token))
    .map((token) => stemmer(token));
}

/**
 * Damerau–Levenshtein Distance (Optimal String Alignment variant)
 * Accounts for deletion, insertion, substitution, and transposition.
 */
function damerauLevenshtein(a, b) {
  const alen = a.length;
  const blen = b.length;
  const d = [];

  // Initialize the matrix.
  for (let i = 0; i <= alen; i++) {
    d[i] = [];
    for (let j = 0; j <= blen; j++) {
      d[i][j] = 0;
    }
  }
  for (let i = 0; i <= alen; i++) {
    d[i][0] = i;
  }
  for (let j = 0; j <= blen; j++) {
    d[0][j] = j;
  }

  for (let i = 1; i <= alen; i++) {
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost, // substitution
      );
      // Check for transposition.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(
          d[i][j],
          d[i - 2][j - 2] + cost, // transposition
        );
      }
    }
  }
  return d[alen][blen];
}

export default class SearchEngine {
  constructor(indexObject) {
    this.docs = indexObject.docs;
    this.invertedIndex = indexObject.invertedIndex;
    // Cache all tokens (keys of the inverted index) for fuzzy matching.
    this.tokens = Object.keys(this.invertedIndex);
  }

  /**
   * Searches the index for the given query.
   * For each token in the query, first attempts an exact match.
   * If not found, it uses Damerau–Levenshtein (with threshold ≤ 1) to fuzzy-match tokens.
   * The document score accumulates the precomputed weights.
   */
  search(query) {
    const queryTokens = tokenize(query);
    const docScores = {}; // docId -> cumulative score

    queryTokens.forEach((qToken) => {
      let matchedTokens = [];

      if (this.invertedIndex[qToken]) {
        matchedTokens.push(qToken);
      } else {
        // Fuzzy matching: check all tokens with distance <= 1.
        for (let token of this.tokens) {
          if (damerauLevenshtein(qToken, token) <= 1) {
            matchedTokens.push(token);
          }
        }
      }

      // For each matching token, add its weight for each doc.
      matchedTokens.forEach((token) => {
        // this.invertedIndex[token] is an object mapping docId -> weight.
        const docWeights = this.invertedIndex[token];
        for (const docId in docWeights) {
          docScores[docId] = (docScores[docId] || 0) + docWeights[docId];
        }
      });
    });

    // Convert the scores into an array of results.
    const results = Object.keys(docScores).map((docId) => ({
      docId,
      score: docScores[docId],
      ...this.docs[docId],
    }));

    // Higher scores are ranked higher.
    return results.sort((a, b) => b.score - a.score);
  }

  // Loads the compressed index from a given URL.
  static async load(data) {
    const decompressed = LZString.decompressFromUTF16(data.compressedIndex);
    const indexObject = JSON.parse(decompressed);
    return new SearchEngine(indexObject);
  }
}
