const test = require("node:test");
const assert = require("node:assert");
const { cleanQuiz, cleanFlashcards } = require("../lib/quiz");

const options = ["Stack", "Queue", "Tree", "Graph"];
const answerFor = (answer) => cleanQuiz([{ q: "Which one?", options, answer }])[0]?.answer ?? null;

test("cleanQuiz turns the answer into the exact option text", () => {
  assert.strictEqual(answerFor("Queue"), "Queue");
  assert.strictEqual(answerFor(" queue "), "Queue");
  assert.strictEqual(answerFor("B"), "Queue");
  assert.strictEqual(answerFor("c)"), "Tree");
  assert.strictEqual(answerFor("Option D"), "Graph");
  assert.strictEqual(answerFor("B) Queue"), "Queue");
});

test("cleanQuiz drops questions whose answer cannot be matched", () => {
  assert.strictEqual(answerFor("Heap"), null);
  assert.strictEqual(answerFor("B) Heap"), null);
  assert.strictEqual(answerFor("A stack is LIFO"), null);
  assert.strictEqual(answerFor(undefined), null);
});

test("cleanQuiz drops malformed questions", () => {
  assert.deepStrictEqual(cleanQuiz("not a list"), []);
  assert.deepStrictEqual(cleanQuiz([null, { q: 1 }, { q: "x", options: "no" }, { q: "x", options: ["a"], answer: "a" }]), []);
});

test("cleanFlashcards keeps only cards with both sides", () => {
  const cards = cleanFlashcards([{ q: "a", a: "b" }, { q: "", a: "b" }, null, { q: "a" }]);
  assert.deepStrictEqual(cards, [{ q: "a", a: "b" }]);
});
