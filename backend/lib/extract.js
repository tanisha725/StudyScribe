const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const pdfParse = require("pdf-parse");
const officeParser = require("officeparser");
const { UserError } = require("./errors");
const { transcribe } = require("./ai");

const MIN_TEXT_LENGTH = 100;
const SUPPORTED_MESSAGE = "Unsupported file type. Use PDF, PPTX, DOCX, TXT, MP3, WAV, M4A or OGG.";

/*
  Every reader returns a list of sections: [{ source, text }].
  "source" says where the text came from ("Page 3", "Slide 7", a Word heading),
  so later features can point the student back to the right place.
*/

/* ---------- PDF: one section per page ---------- */
async function pageText(pageData) {
  const content = await pageData.getTextContent();
  let lastY;
  let text = "";
  for (const item of content.items) {
    // A change in vertical position means a new line
    text += lastY === undefined || lastY === item.transform[5] ? item.str : "\n" + item.str;
    lastY = item.transform[5];
  }
  return text;
}

async function readPdf(buffer) {
  const pages = [];
  // A small upload can sit inside a larger shared block of memory, which pdf-parse misreads
  // ("bad XRef entry"). Copying the file into its own block avoids that.
  const data = new Uint8Array(buffer);

  // pdf-parse calls this once per page, in order
  await pdfParse(data, {
    pagerender: async (pageData) => {
      const text = await pageText(pageData);
      pages.push(text);
      return text;
    },
  });
  return pages.map((text, i) => ({ source: `Page ${i + 1}`, text }));
}

/* ---------- OFFICE FILES ---------- */
/*
  officeparser guesses the type of an in-memory file from its first bytes, and many real Word
  and PowerPoint files look like a plain zip archive to it. It only trusts the file extension
  when reading from disk. So the upload is written to a temporary file with the right
  extension, parsed, and the temporary file is removed again.
*/
async function parseOffice(buffer, extension) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "studyscribe-"));
  const filePath = path.join(folder, `upload.${extension}`);
  try {
    await fs.writeFile(filePath, buffer);
    return await officeParser.parseOffice(filePath);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
}

// officeparser returns a tree of nodes. This collects the text under one node.
function nodeText(node) {
  if (typeof node.text === "string") return node.text;
  return (node.children || []).map(nodeText).filter(Boolean).join("\n");
}

// PowerPoint: one section per slide
async function readPptx(buffer) {
  const ast = await parseOffice(buffer, "pptx");
  const slides = ast.content.filter((node) => node.type === "slide");

  if (slides.length === 0) return [{ source: "Slides", text: ast.toText() }];

  return slides.map((slide, i) => ({
    source: `Slide ${slide.metadata?.slideNumber || i + 1}`,
    text: nodeText(slide),
  }));
}

// Word: a new section starts at every heading. Word files do not store page numbers.
async function readDocx(buffer) {
  const ast = await parseOffice(buffer, "docx");
  const sections = [];
  let current = { source: "Document start", lines: [] };

  for (const node of ast.content) {
    const text = nodeText(node).trim();
    if (!text) continue;

    if (node.type === "heading") {
      sections.push(current);
      current = { source: `Section: ${text.slice(0, 60)}`, lines: [text] };
    } else {
      current.lines.push(text);
    }
  }
  sections.push(current);

  const filled = sections.filter((section) => section.lines.length);

  // No headings at all: the whole file is one section
  if (filled.length === 1) return [{ source: "Document", text: filled[0].lines.join("\n") }];

  return filled.map((section) => ({ source: section.source, text: section.lines.join("\n") }));
}

/* ---------- AUDIO ---------- */
async function readAudio(file) {
  try {
    const text = await transcribe(file.buffer, file.originalname);
    return [{ source: "Recording", text }];
  } catch (error) {
    // Wrong key or rate limit: let the route report these with their own message
    if (error.status === 401 || error.status === 429) throw error;
    console.error("TRANSCRIPTION ERROR:", error.message);
    throw new UserError("The recording could not be transcribed. Please try again, or upload a shorter recording.", 502);
  }
}

async function readFile(file) {
  const name = file.originalname.toLowerCase();

  if (name.endsWith(".pdf")) return readPdf(file.buffer);
  if (name.endsWith(".pptx")) return readPptx(file.buffer);
  if (name.endsWith(".docx")) return readDocx(file.buffer);
  if (name.endsWith(".txt")) return [{ source: "Text file", text: file.buffer.toString("utf-8") }];
  if (name.match(/\.(mp3|wav|m4a|ogg)$/)) return readAudio(file);

  if (name.endsWith(".ppt") || name.endsWith(".doc")) {
    const newer = name.endsWith(".ppt") ? ".pptx" : ".docx";
    throw new UserError(`Old ${name.slice(-4)} files are not supported. Save the file as ${newer} and upload again.`, 415);
  }
  if (name.match(/\.(png|jpe?g|gif|webp|heic)$/)) {
    throw new UserError("Images are not supported yet. Upload the material as a PDF, PPTX, DOCX or TXT file.", 415);
  }

  throw new UserError(SUPPORTED_MESSAGE, 415);
}

// Reads an uploaded file and returns its non-empty sections.
async function extractSections(file) {
  let sections;
  try {
    sections = await readFile(file);
  } catch (error) {
    if (error instanceof UserError || error.status === 401 || error.status === 429) throw error;
    console.error("EXTRACTION ERROR:", error.message);
    throw new UserError("Could not read this file. It may be damaged or password protected.", 422);
  }

  sections = sections
    .map((section) => ({ source: section.source, text: (section.text || "").trim() }))
    .filter((section) => section.text);

  const totalLength = sections.reduce((sum, section) => sum + section.text.length, 0);
  if (totalLength < MIN_TEXT_LENGTH) {
    throw new UserError(
      "Not enough readable text was found in this file. Scanned or image-only documents are not supported yet.",
      422
    );
  }
  return sections;
}

module.exports = { extractSections };
