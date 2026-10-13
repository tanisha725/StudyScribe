const test = require("node:test");
const assert = require("node:assert");
const {
  splitText, toPieces, makeBatches, pickEvenly, sampleText, cleanKnowledge, mergeKnowledge, buildKnowledgeMap,
} = require("../lib/understand");

test("splitText keeps short text whole and cuts long text at sentence ends", () => {
  assert.deepStrictEqual(splitText("Short text.", 100), ["Short text."]);

  const parts = splitText("First sentence here. Second sentence here. Third sentence here.", 45);
  assert.deepStrictEqual(parts, ["First sentence here. Second sentence here.", "Third sentence here."]);
  assert.ok(splitText("x".repeat(250), 100).every((part) => part.length <= 100));
});

test("toPieces keeps the source of every piece", () => {
  const pieces = toPieces([{ source: "Page 1", text: "a. ".repeat(100) }, { source: "Page 2", text: "short" }], 100);
  assert.ok(pieces.length > 2);
  assert.strictEqual(pieces[0].source, "Page 1");
  assert.strictEqual(pieces[pieces.length - 1].source, "Page 2");
});

test("makeBatches never goes over the limit when pieces fit", () => {
  const pieces = Array.from({ length: 10 }, (_, i) => ({ source: `Page ${i + 1}`, text: "x".repeat(40) }));
  const batches = makeBatches(pieces, 100);
  assert.strictEqual(batches.length, 5);
  assert.strictEqual(batches.flat().length, 10);
});

test("pickEvenly includes the first and last item", () => {
  assert.deepStrictEqual(pickEvenly([1, 2, 3], 5), [1, 2, 3]);
  assert.deepStrictEqual(pickEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9], 3), [1, 5, 9]);
});

test("sampleText uses a short document in full and samples a long one from start to end", () => {
  assert.strictEqual(sampleText([{ source: "Page 1", text: "Whole document." }], 6000), "Whole document.");

  const sections = Array.from({ length: 30 }, (_, i) => ({ source: `Page ${i + 1}`, text: `PAGE${i + 1} ` + "word ".repeat(250) }));
  const sample = sampleText(sections, 6000);
  assert.ok(sample.length <= 6000);
  assert.ok(sample.includes("PAGE1 "));
  assert.ok(sample.includes("PAGE30 "));
});

test("cleanKnowledge drops malformed entries and unknown sources", () => {
  const cleaned = cleanKnowledge(
    {
      topics: [
        {
          name: " Trees ",
          subtopics: ["Binary trees", 5, ""],
          concepts: [
            { name: "Binary tree", definition: "At most two children.", example: "", source: "[Page 2]" },
            { name: "Heap", definition: "A tree.", source: "Page 99" },
            { name: "No definition" },
            "not an object",
          ],
        },
        { subtopics: ["topic without a name"] },
      ],
      relationships: [{ from: "Heap", to: "Binary tree", relation: "is a type of" }, { from: "Heap" }],
    },
    new Set(["Page 1", "Page 2"])
  );

  assert.strictEqual(cleaned.topics.length, 1);
  assert.strictEqual(cleaned.topics[0].name, "Trees");
  assert.deepStrictEqual(cleaned.topics[0].subtopics, ["Binary trees"]);
  assert.deepStrictEqual(cleaned.topics[0].concepts.map((c) => c.source), ["Page 2", ""]);
  assert.strictEqual(cleaned.relationships.length, 1);

  assert.deepStrictEqual(cleanKnowledge(null, new Set()), { topics: [], relationships: [] });
});

test("mergeKnowledge joins topics and removes duplicates and broken relationships", () => {
  const concept = (name) => ({ name, definition: "d", example: "", source: "" });
  const merged = mergeKnowledge([
    { topics: [{ name: "Trees", subtopics: ["Traversal"], concepts: [concept("Binary tree")] }], relationships: [] },
    {
      topics: [{ name: "trees", subtopics: ["traversal", "Balancing"], concepts: [concept("binary tree"), concept("AVL tree")] }],
      relationships: [
        { from: "avl tree", to: "Binary Tree", relation: "is a type of" },
        { from: "AVL tree", to: "Unknown concept", relation: "uses" },
      ],
    },
  ]);

  assert.strictEqual(merged.topics.length, 1);
  assert.deepStrictEqual(merged.topics[0].subtopics, ["Traversal", "Balancing"]);
  assert.deepStrictEqual(merged.topics[0].concepts.map((c) => c.name), ["Binary tree", "AVL tree"]);
  assert.deepStrictEqual(merged.relationships, [{ from: "AVL tree", to: "Binary tree", relation: "is a type of" }]);
});

test("buildKnowledgeMap reads a short document fully and reports coverage", async () => {
  const sections = [{ source: "Slide 1", text: "A stack is last in, first out." }];
  const prompts = [];
  const fakeAsk = async (prompt) => {
    prompts.push(prompt);
    return JSON.stringify({
      topics: [{ name: "Stacks", subtopics: [], concepts: [{ name: "Stack", definition: "LIFO structure.", example: "", source: "Slide 1" }] }],
      relationships: [],
    });
  };

  const knowledge = await buildKnowledgeMap(sections, fakeAsk);
  assert.strictEqual(prompts.length, 1);
  assert.ok(prompts[0].includes("[Slide 1]"));
  assert.strictEqual(knowledge.topics[0].concepts[0].source, "Slide 1");
  assert.strictEqual(knowledge.coverage.percent, 100);
});

test("buildKnowledgeMap limits AI calls on a long document and reports partial coverage", async () => {
  const sections = Array.from({ length: 40 }, (_, i) => ({ source: `Page ${i + 1}`, text: "word ".repeat(600) }));
  let calls = 0;
  const fakeAsk = async () => {
    calls++;
    return JSON.stringify({ topics: [{ name: `Topic ${calls}`, subtopics: ["s"], concepts: [] }], relationships: [] });
  };

  const knowledge = await buildKnowledgeMap(sections, fakeAsk);
  assert.strictEqual(calls, 4);
  assert.strictEqual(knowledge.topics.length, 4);
  assert.ok(knowledge.coverage.percent > 0 && knowledge.coverage.percent < 100);
  assert.strictEqual(knowledge.coverage.sections, 40);
});

test("buildKnowledgeMap returns null when the AI gives nothing usable, and stops on a rate limit", async () => {
  const sections = Array.from({ length: 40 }, (_, i) => ({ source: `Page ${i + 1}`, text: "word ".repeat(600) }));

  assert.strictEqual(await buildKnowledgeMap(sections, async () => "sorry, no JSON"), null);

  let calls = 0;
  const rateLimited = async () => {
    calls++;
    throw Object.assign(new Error("rate limit"), { status: 429 });
  };
  assert.strictEqual(await buildKnowledgeMap(sections, rateLimited), null);
  assert.strictEqual(calls, 1);
});
