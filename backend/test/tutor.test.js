const test = require("node:test");
const assert = require("node:assert");
const { tokenize, search } = require("../lib/retrieve");
const { answerQuestion } = require("../lib/tutor");
const { saveDocument, getDocument, MAX_DOCUMENTS } = require("../lib/store");

const pieces = [
  { source: "Page 1", text: "A process is a program in execution. Each process has a process control block." },
  { source: "Page 2", text: "Round Robin gives each process a time quantum. When the quantum expires the process is preempted." },
  { source: "Page 3", text: "Aging solves starvation by gradually increasing the priority of waiting processes." },
  { source: "Page 4", text: "Paging divides memory into fixed size frames. A page table maps pages to frames." },
];

test("tokenize drops common words and trims plurals", () => {
  assert.deepStrictEqual(tokenize("What are the Processes in an operating system?"), ["process", "operating", "system"]);
  assert.deepStrictEqual(tokenize("Explain this to me"), []);
  assert.deepStrictEqual(tokenize("queries queues classes boxes"), ["query", "queue", "class", "box"]);
});

test("search ranks the piece about the question first", () => {
  assert.strictEqual(search(pieces, "What is a time quantum in round robin?")[0].source, "Page 2");
  assert.strictEqual(search(pieces, "how does aging prevent starvation")[0].source, "Page 3");
  assert.strictEqual(search(pieces, "page tables and frames")[0].source, "Page 4");
});

test("search returns nothing when no word matches, and respects the limit", () => {
  assert.deepStrictEqual(search(pieces, "photosynthesis in plants"), []);
  assert.deepStrictEqual(search(pieces, "explain that again"), []);
  assert.strictEqual(search(pieces, "process", 2).length, 2);
});

test("answerQuestion sends the relevant excerpt and returns only sources that were sent", async () => {
  let prompt;
  const fakeAsk = async (p) => {
    prompt = p;
    return JSON.stringify({ found: true, answer: "It is a small unit of CPU time.", sources: ["[Page 2]", "Page 77"] });
  };

  const result = await answerQuestion({ pieces, question: "What is a time quantum?" }, fakeAsk);
  assert.ok(prompt.includes("[Page 2]"));
  assert.ok(!prompt.includes("[Page 4]"));
  assert.strictEqual(result.found, true);
  assert.deepStrictEqual(result.sources.map((s) => s.source), ["Page 2"]);
  assert.ok(result.sources[0].excerpt.startsWith("Round Robin"));
});

test("answerQuestion reports when the material does not cover the question", async () => {
  const fakeAsk = async () => JSON.stringify({ found: false, answer: "The material does not mention deadlock.", sources: ["Page 1"] });
  const result = await answerQuestion({ pieces, question: "What is deadlock?" }, fakeAsk);
  assert.strictEqual(result.found, false);
  assert.deepStrictEqual(result.sources, []);
});

test("answerQuestion uses the previous question to search for a follow-up", async () => {
  let prompt;
  const fakeAsk = async (p) => { prompt = p; return JSON.stringify({ found: true, answer: "Simpler.", sources: ["Page 3"] }); };
  const history = [
    { role: "student", text: "How does aging prevent starvation?" },
    { role: "tutor", text: "It raises priority over time." },
  ];

  await answerQuestion({ pieces, question: "Explain that more simply", history, level: "simple" }, fakeAsk);
  assert.ok(prompt.includes("[Page 3]"));

  // A second follow-up in a row still finds the topic from two questions back
  history.push({ role: "student", text: "Explain that more simply" }, { role: "tutor", text: "Simpler." });
  await answerQuestion({ pieces, question: "Give me an analogy for it", history }, fakeAsk);
  assert.ok(prompt.includes("[Page 3]"));

  // A new question with its own topic words is searched on its own
  await answerQuestion({ pieces, question: "What does a page table map?", history }, fakeAsk);
  assert.ok(prompt.includes("[Page 4]") && !prompt.includes("[Page 3]"));
  assert.ok(prompt.includes("Student: How does aging prevent starvation?"));
  assert.ok(prompt.includes("everyday language"));
});

test("answerQuestion samples the whole document for broad questions", async () => {
  let prompt;
  const fakeAsk = async (p) => { prompt = p; return JSON.stringify({ found: true, answer: "Overview.", sources: [] }); };
  const longDocument = Array.from({ length: 20 }, (_, i) => ({ source: `Page ${i + 1}`, text: `Text of page ${i + 1}.` }));
  await answerQuestion({ pieces: longDocument, question: "What is this about?" }, fakeAsk);
  assert.ok(prompt.includes("[Page 1]") && prompt.includes("[Page 20]"));
});

test("answerQuestion fails clearly when the AI reply is unusable", async () => {
  await assert.rejects(answerQuestion({ pieces, question: "What is a process?" }, async () => "not json"));
});

test("the document store returns saved documents and forgets the oldest when full", () => {
  const first = saveDocument(pieces);
  assert.deepStrictEqual(getDocument(first).pieces, pieces);
  assert.strictEqual(getDocument("unknown-id"), null);

  for (let i = 0; i < MAX_DOCUMENTS; i++) saveDocument(pieces);
  assert.strictEqual(getDocument(first), null);
});
