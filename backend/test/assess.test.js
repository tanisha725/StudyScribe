const test = require("node:test");
const assert = require("node:assert");
const { nextDifficulty, weakConcepts, analyzeMistakes, practiceQuestions } = require("../lib/assess");
const { cleanQuiz, conceptNamesOf } = require("../lib/quiz");

const pieces = [
  { source: "Page 1", text: "Round Robin gives each process a time quantum. When it expires the process is preempted." },
  { source: "Page 2", text: "Aging solves starvation by gradually increasing the priority of waiting processes." },
];
const options = ["FCFS", "Round Robin", "SJF", "Priority"];
const answer = (index, concept, difficulty, chosen, correct = "Round Robin") =>
  ({ index, q: `Question ${index}?`, options, answer: correct, chosen, concept, difficulty });

test("cleanQuiz keeps difficulty, concept and explanation, with safe defaults", () => {
  const [full, bare] = cleanQuiz(
    [
      { q: "Q1", options, answer: "FCFS", difficulty: "HARD", concept: "round robin", explanation: " Because. " },
      { q: "Q2", options, answer: "B", difficulty: "impossible", concept: 7 },
    ],
    ["Round Robin", "Aging"]
  );
  assert.deepStrictEqual([full.difficulty, full.concept, full.explanation], ["hard", "Round Robin", "Because."]);
  assert.deepStrictEqual([bare.difficulty, bare.concept, bare.explanation], ["medium", "", ""]);
});

test("conceptNamesOf lists every concept in a knowledge map", () => {
  const knowledge = { topics: [{ concepts: [{ name: "A" }, { name: "B" }] }, { concepts: [{ name: "C" }] }] };
  assert.deepStrictEqual(conceptNamesOf(knowledge), ["A", "B", "C"]);
  assert.deepStrictEqual(conceptNamesOf(null), []);
});

test("nextDifficulty goes up with high accuracy and down with low accuracy", () => {
  assert.strictEqual(nextDifficulty(9, 10), "hard");
  assert.strictEqual(nextDifficulty(8, 10), "hard");
  assert.strictEqual(nextDifficulty(6, 10), "medium");
  assert.strictEqual(nextDifficulty(4, 10), "easy");
  assert.strictEqual(nextDifficulty(0, 0), "medium");
});

test("weakConcepts lists missed concepts, worst first, at the easiest level missed", () => {
  const weak = weakConcepts([
    answer(0, "Aging", "hard", "FCFS"),
    answer(1, "Round Robin", "medium", "FCFS"),
    answer(2, "Round Robin", "easy", "SJF"),
    answer(3, "Paging", "easy", "Round Robin"),
    answer(4, "", "easy", "FCFS"),
  ]);
  assert.deepStrictEqual(weak, [
    { name: "Round Robin", wrong: 2, difficulty: "easy" },
    { name: "Aging", wrong: 1, difficulty: "hard" },
  ]);
});

test("analyzeMistakes sends only wrong answers, with evidence about the same concept", async () => {
  let prompt;
  const fakeAsk = async (p) => {
    prompt = p;
    return JSON.stringify({ analysis: [{ id: 1, explanation: "FCFS has no quantum.", category: "knowledge_gap", evidence: "You picked an unrelated algorithm." }] });
  };
  const answers = [answer(0, "Round Robin", "easy", "FCFS"), answer(1, "Round Robin", "easy", "Round Robin"), answer(2, "Aging", "easy", "Round Robin")];

  const analysis = await analyzeMistakes(pieces, answers, fakeAsk);
  assert.strictEqual(analysis.length, 1);
  assert.deepStrictEqual(analysis[0], {
    index: 0, explanation: "FCFS has no quantum.", category: "knowledge_gap", evidence: "You picked an unrelated algorithm.", source: "Page 1",
  });
  assert.ok(prompt.includes("Student chose: FCFS"));
  assert.ok(prompt.includes("1 correct, 0 wrong"));
  assert.ok(!prompt.includes("Question 1?"));
});

test("analyzeMistakes overrules categories the evidence does not support", async () => {
  const reply = (category) => async () => JSON.stringify({ analysis: [{ id: 1, explanation: "x", category, evidence: "You usually get this right." }] });

  // "careless" needs another correct answer on the same concept
  const alone = await analyzeMistakes(pieces, [answer(0, "Round Robin", "easy", "FCFS")], reply("careless"));
  assert.deepStrictEqual([alone[0].category, alone[0].evidence], ["unclear", ""]);

  const withCorrect = await analyzeMistakes(pieces, [answer(0, "Round Robin", "easy", "FCFS"), answer(1, "Round Robin", "hard", "Round Robin")], reply("careless"));
  assert.strictEqual(withCorrect[0].category, "careless");

  // "conceptual" needs another wrong answer on the same concept
  const oneMiss = await analyzeMistakes(pieces, [answer(0, "Round Robin", "easy", "FCFS")], reply("conceptual"));
  assert.strictEqual(oneMiss[0].category, "unclear");
  assert.strictEqual(oneMiss[0].explanation, "x");

  const twoMisses = await analyzeMistakes(pieces, [answer(0, "Round Robin", "easy", "FCFS"), answer(1, "Round Robin", "hard", "SJF")], async () =>
    JSON.stringify({ analysis: [{ id: 1, explanation: "x", category: "conceptual", evidence: "e" }, { id: 2, explanation: "y", category: "conceptual", evidence: "e" }] }));
  assert.deepStrictEqual(twoMisses.map((item) => item.category), ["conceptual", "conceptual"]);

  // unknown labels and unreadable replies fall back to "unclear"
  const invented = await analyzeMistakes(pieces, [answer(0, "Round Robin", "easy", "FCFS")], reply("lazy"));
  assert.strictEqual(invented[0].category, "unclear");
  const garbage = await analyzeMistakes(pieces, [answer(0, "Round Robin", "easy", "FCFS")], async () => "not json");
  assert.deepStrictEqual([garbage[0].category, garbage[0].explanation], ["unclear", ""]);
});

test("analyzeMistakes makes no AI call when everything is correct", async () => {
  let called = false;
  const analysis = await analyzeMistakes(pieces, [answer(0, "Round Robin", "easy", "Round Robin")], async () => { called = true; return "{}"; });
  assert.deepStrictEqual(analysis, []);
  assert.strictEqual(called, false);
});

test("practiceQuestions keeps only new questions on the requested concepts", async () => {
  let prompt;
  const fakeAsk = async (p) => {
    prompt = p;
    return JSON.stringify({ questions: [
      { q: "What is a time quantum?", options, answer: "Round Robin", difficulty: "easy", concept: "round robin", explanation: "e" },
      { q: "Shortened name?", options, answer: "Round Robin", difficulty: "easy", concept: "Robin", explanation: "e" },
      { q: "Question 0?", options, answer: "FCFS", difficulty: "easy", concept: "Round Robin", explanation: "repeat" },
      { q: "Off topic?", options, answer: "FCFS", difficulty: "easy", concept: "Deadlock", explanation: "e" },
    ] });
  };

  const questions = await practiceQuestions(pieces, [{ name: "Round Robin", wrong: 2, difficulty: "easy" }], ["Question 0?"], fakeAsk);
  assert.deepStrictEqual(questions.map((q) => q.q), ["What is a time quantum?", "Shortened name?"]);
  assert.deepStrictEqual(questions.map((q) => q.concept), ["Round Robin", "Round Robin"]);
  assert.ok(prompt.includes("[Page 1]") && prompt.includes("DIFFICULTY: easy"));
});

test("practiceQuestions returns nothing when the document has no text on the concept", async () => {
  let called = false;
  const questions = await practiceQuestions(pieces, [{ name: "Photosynthesis", wrong: 1, difficulty: "easy" }], [], async () => { called = true; return "{}"; });
  assert.deepStrictEqual(questions, []);
  assert.strictEqual(called, false);
});
