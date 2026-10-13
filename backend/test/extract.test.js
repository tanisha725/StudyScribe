const test = require("node:test");
const assert = require("node:assert");
const { extractSections } = require("../lib/extract");

const file = (originalname, content) => ({ originalname, buffer: Buffer.from(content) });
const rejects = (upload, status) => assert.rejects(extractSections(upload), (error) => error.status === status);

test("a text file becomes one section", async () => {
  const sections = await extractSections(file("Notes.TXT", "  " + "Photosynthesis makes glucose. ".repeat(5)));
  assert.strictEqual(sections.length, 1);
  assert.strictEqual(sections[0].source, "Text file");
  assert.ok(sections[0].text.startsWith("Photosynthesis"));
});

test("files with too little text are rejected", () => rejects(file("empty.txt", "too short"), 422));

test("damaged files are rejected with a readable error", () => rejects(file("broken.pdf", "this is not a pdf ".repeat(20)), 422));

test("old Office formats, images and unknown types are rejected", async () => {
  await rejects(file("slides.ppt", "x".repeat(500)), 415);
  await rejects(file("essay.doc", "x".repeat(500)), 415);
  await rejects(file("photo.jpg", "x".repeat(500)), 415);
  await rejects(file("data.xlsx", "x".repeat(500)), 415);
});
