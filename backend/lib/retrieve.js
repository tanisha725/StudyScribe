/*
  Finds the pieces of a document that are most relevant to a question.

  This is the "retrieval" step of retrieval-augmented generation (RAG). It uses BM25,
  a standard keyword-ranking formula, so it runs inside the server with no external
  service. A piece scores higher when it contains the question's words often, and
  rare words count for more than common ones.
*/

const STOPWORDS = new Set(
  ("a an and are as at be but by can could did do does for from give had has have how i if in into is it its me " +
   "my of on or please so tell than that the their them then there these they this to was we were what when where " +
   "which who why will with would you your about explain describe define mean means meaning more simply simple " +
   "detail detailed example examples analogy again").split(" ")
);

// Makes plural and singular forms match: "processes" -> "process", "queries" -> "query", "queues" -> "queue".
function singular(word) {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (/(ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

// Turns text into a list of search words: lowercase, no common words, plurals trimmed.
function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(singular);
}

// BM25 constants: K controls how much repeated words add, B how much long pieces are penalised.
const K = 1.5;
const B = 0.75;

// Returns the `limit` best-matching pieces, best first. Pieces sharing no word with the query are left out.
function search(pieces, query, limit = 4) {
  const queryWords = [...new Set(tokenize(query))];
  if (queryWords.length === 0 || pieces.length === 0) return [];

  const docs = pieces.map((piece) => tokenize(piece.text));
  const averageLength = docs.reduce((sum, words) => sum + words.length, 0) / docs.length || 1;

  // How many pieces contain each query word
  const piecesWith = new Map(queryWords.map((word) => [word, docs.filter((words) => words.includes(word)).length]));

  const scored = docs.map((words, index) => {
    let score = 0;
    for (const word of queryWords) {
      const count = words.filter((w) => w === word).length;
      if (count === 0) continue;

      const containing = piecesWith.get(word);
      const rarity = Math.log(1 + (docs.length - containing + 0.5) / (containing + 0.5));
      score += (rarity * count * (K + 1)) / (count + K * (1 - B + (B * words.length) / averageLength));
    }
    return { piece: pieces[index], score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.piece);
}

module.exports = { tokenize, search };
