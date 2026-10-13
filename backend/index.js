const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const fs = require("fs");
const gTTS = require("gtts");

const { UserError } = require("./lib/errors");
const { askGroq, safeParse } = require("./lib/ai");
const { extractSections } = require("./lib/extract");
const { toPieces, sampleText, buildKnowledgeMap } = require("./lib/understand");
const { cleanQuiz, cleanFlashcards, conceptNamesOf, questionRules, QUESTION_FORMAT, DIFFICULTIES } = require("./lib/quiz");
const { nextDifficulty, weakConcepts, analyzeMistakes, practiceQuestions } = require("./lib/assess");
const { saveDocument, getDocument } = require("./lib/store");
const { answerQuestion, LEVELS } = require("./lib/tutor");

/* ---------- CONFIG ---------- */
const MAX_FILE_MB = 25;
const STUDY_TEXT_CHARS = 6000;   // how much text the summary, notes and quiz prompts receive
const MAX_QUESTION_CHARS = 500;
const MAX_HISTORY_TURNS = 6;     // how many earlier chat messages the tutor is shown
const MAX_TURN_CHARS = 1000;
const MAX_ANSWERS = 60;          // most quiz answers accepted in one request

if (!process.env.GROQ_API_KEY) {
  console.error("GROQ_API_KEY is missing. Copy backend/.env.example to backend/.env and add your key.");
  process.exit(1);
}

// ALLOWED_ORIGINS is a comma-separated list of frontend URLs. If it is empty, every origin is allowed.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined));
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
});

/* ---------- ERRORS ---------- */
function sendError(res, error, fallbackMessage) {
  console.error("ERROR:", error.message);

  if (error instanceof UserError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error.status === 401) {
    return res.status(502).json({ error: "The AI service rejected the API key. Check GROQ_API_KEY on the server." });
  }
  if (error.status === 429) {
    return res.status(429).json({ error: "The AI service is busy (rate limit reached). Please try again in a minute." });
  }
  res.status(500).json({ error: fallbackMessage, details: error.message });
}

/* ---------- AUDIO ---------- */
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

async function generateAudio(text) {
  return new Promise((resolve) => {
    try {
      const fileName = `audio_${Date.now()}.mp3`;
      const filePath = path.join(uploadsDir, fileName);

      const gtts = new gTTS(text || "No content", "en");

      gtts.save(filePath, (err) => {
        if (err) return resolve(null);
        resolve(`/uploads/${fileName}`);
      });
    } catch {
      resolve(null);
    }
  });
}

/* ---------- ROUTES ---------- */

app.get("/", (req, res) => {
  res.send("Backend working ✅");
});

/* ---------- MAIN UPLOAD ---------- */
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      throw new UserError("No file was uploaded. Please choose a file first.");
    }

    const sections = await extractSections(req.file);

    console.log("📄 SECTIONS:", sections.length);

    const text = sampleText(sections, STUDY_TEXT_CHARS);
    const warnings = [];

    /* ---------- SUMMARY ---------- */
    let summaryRaw = await askGroq(`
You are a professor explaining a lecture.

Return ONLY JSON:
{
 "summary": "..."
}

Rules:
- Minimum 300 words
- No generic phrases like "this presentation covers"
- Explain concepts clearly with examples

TEXT:
${text}
`);

    let summaryData = safeParse(summaryRaw);

    if (!summaryData || typeof summaryData.summary !== "string" || summaryData.summary.length < 200) {
      console.log("🔁 Retry summary...");
      const retry = await askGroq(`Explain in detail (300+ words):\n${text}`);
      summaryData = { summary: retry };
    }

    /* ---------- NOTES ---------- */
    let notesRaw = await askGroq(`
Return ONLY JSON:
{
 "notes":["...", "..."]
}

Rules:
- Minimum 15 notes
- Each note must be 1–2 lines
- Explain concept clearly with examples

TEXT:
${text}
`);

    let notesData = safeParse(notesRaw);

    if (!notesData || !Array.isArray(notesData.notes) || notesData.notes.length < 10) {
      console.log("🔁 Retry notes...");
      const retry = await askGroq(`Give 15 detailed notes:\n${text}`);
      notesData = {
        notes: retry.split(".").map(l => l.trim()).filter(Boolean)
      };
    }

    /* ---------- KNOWLEDGE MAP ---------- */
    const knowledge = await buildKnowledgeMap(sections);

    if (!knowledge) {
      warnings.push("The topics and concepts could not be extracted for this file.");
    }

    /* ---------- QUIZ + FLASHCARDS ---------- */
    // Built after the knowledge map so every question can be tagged with one of its concepts
    const conceptNames = conceptNamesOf(knowledge);

    let quizRaw = await askGroq(`
Return ONLY JSON:
{
 "flashcards":[{"q":"...","a":"..."}],
 "quiz":[${QUESTION_FORMAT}]
}

Rules:
- Minimum 15 flashcards
- Minimum 15 MCQs: 5 easy, 5 medium and 5 hard
- Questions must test understanding
${questionRules(conceptNames)}

TEXT:
${text}
`, { maxTokens: 6000 });

    const quizData = safeParse(quizRaw) || {};
    let quiz = cleanQuiz(quizData.quiz, conceptNames);
    let flashcards = cleanFlashcards(quizData.flashcards);

    if (quiz.length < 10) {
      console.log("🔁 Retry quiz...");
      const retry = await askGroq(`Return ONLY JSON: {"quiz":[${QUESTION_FORMAT}]}.\nRules:\n${questionRules(conceptNames)}\nGenerate 15 MCQs, a mix of easy, medium and hard:\n${text}`, { maxTokens: 6000 });
      const retryQuiz = cleanQuiz(safeParse(retry)?.quiz, conceptNames);
      if (retryQuiz.length > quiz.length) quiz = retryQuiz;
    }

    if (flashcards.length < 10) {
      console.log("🔁 Retry flashcards...");
      const retry = await askGroq(`Return ONLY JSON: {"flashcards":[{"q":"...","a":"..."}]}. Generate 20 flashcards:\n${text}`);
      const retryCards = cleanFlashcards(safeParse(retry)?.flashcards);
      if (retryCards.length > flashcards.length) flashcards = retryCards;
    }

    if (quiz.length === 0) {
      warnings.push("The quiz could not be generated for this file. Try uploading it again.");
    }
    if (flashcards.length === 0) {
      warnings.push("The flashcards could not be generated for this file. Try uploading it again.");
    }

    /* ---------- RESPONSE ---------- */
    const audioUrl = await generateAudio(summaryData.summary);

    // Keep the whole document so the tutor can search it later
    const docId = saveDocument(toPieces(sections));

    res.json({
      docId,
      summary: summaryData.summary,
      notes: notesData.notes,
      flashcards,
      quiz,
      knowledge,
      audio: audioUrl,
      audioError: audioUrl ? null : "The text-to-speech service did not respond.",
      warnings,
      originalText: text,
    });

  } catch (error) {
    sendError(res, error, "Something went wrong while creating your study set.");
  }
});

app.post("/generate-more-questions", async (req, res) => {
  try {
    const { text, score, concepts } = req.body || {};

    if (typeof text !== "string" || text.trim().length === 0) {
      throw new UserError("No text provided");
    }

    const contentText = text.substring(0, 10000);
    const conceptNames = (Array.isArray(concepts) ? concepts : [])
      .filter((name) => typeof name === "string" && name.trim())
      .slice(0, 60)
      .map((name) => name.trim().slice(0, 100));

    // Adaptive difficulty: the next questions depend on how the student has done so far
    const difficulty = nextDifficulty(Number(score?.correct) || 0, Number(score?.total) || 0);

    let quizRaw = await askGroq(`
Return ONLY JSON:
{
 "questions":[${QUESTION_FORMAT}]
}

Rules:
- Generate 10 NEW unique MCQs
- Different from the original questions
- Questions must test understanding
- Each option should be plausible
- Most questions should be of "${difficulty}" difficulty
${questionRules(conceptNames)}

TEXT:
${contentText}
`, { maxTokens: 5000 });

    let questions = cleanQuiz(safeParse(quizRaw)?.questions, conceptNames);

    if (questions.length === 0) {
      console.log("Retry more questions...");
      const retry = await askGroq(`Return ONLY JSON: {"questions":[${QUESTION_FORMAT}]}.\nRules:\n${questionRules(conceptNames)}\nGenerate 10 unique MCQs of mostly "${difficulty}" difficulty for a quiz:\n${contentText}`, { maxTokens: 5000 });
      questions = cleanQuiz(safeParse(retry)?.questions, conceptNames);
    }

    res.json({ questions, difficulty });

  } catch (error) {
    sendError(res, error, "Failed to generate more questions");
  }
});

/* ---------- ASSESSMENT ---------- */

// Reads the document and the student's answers from a request, keeping only well-formed answers.
function readAssessment(body) {
  const document = typeof body?.docId === "string" ? getDocument(body.docId) : null;
  if (!document) {
    throw new UserError("This document is no longer available on the server. Please upload it again.", 404);
  }

  const short = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const answers = (Array.isArray(body.answers) ? body.answers : []).slice(0, MAX_ANSWERS).flatMap((item) => {
    const options = (Array.isArray(item?.options) ? item.options : []).map((opt) => short(opt, 300)).filter(Boolean).slice(0, 6);
    const answer = short(item?.answer, 300);
    const chosen = short(item?.chosen, 300);
    const q = short(item?.q, 500);

    // Both the right answer and the student's choice must be real options of the question
    if (!q || !options.includes(answer) || !options.includes(chosen)) return [];

    return [{
      index: Number.isInteger(item.index) ? item.index : -1,
      q,
      options,
      answer,
      chosen,
      concept: short(item.concept, 100),
      difficulty: DIFFICULTIES.includes(item.difficulty) ? item.difficulty : "medium",
    }];
  });

  if (answers.length === 0) {
    throw new UserError("No quiz answers were provided.");
  }
  return { document, answers };
}

// Explains each wrong answer and suggests a likely cause
app.post("/analyze-mistakes", async (req, res) => {
  try {
    const { document, answers } = readAssessment(req.body);
    const analysis = await analyzeMistakes(document.pieces, answers);

    res.json({ analysis, weakConcepts: weakConcepts(answers) });

  } catch (error) {
    sendError(res, error, "The mistakes could not be analysed. Please try again.");
  }
});

// Writes new questions on the concepts the student got wrong
app.post("/practice", async (req, res) => {
  try {
    const { document, answers } = readAssessment(req.body);
    const concepts = weakConcepts(answers);

    if (concepts.length === 0) {
      throw new UserError("There are no weak concepts to practise. Every labelled question was answered correctly.");
    }

    const questions = await practiceQuestions(document.pieces, concepts, answers.map((item) => item.q));
    if (questions.length === 0) {
      throw new UserError("Practice questions could not be written for these concepts. Please try again.", 502);
    }

    res.json({ questions, concepts: [...new Set(questions.map((question) => question.concept))] });

  } catch (error) {
    sendError(res, error, "Practice questions could not be generated. Please try again.");
  }
});

/* ---------- TUTOR ---------- */
app.post("/ask", async (req, res) => {
  try {
    const { docId, question, history, level } = req.body || {};

    if (typeof question !== "string" || !question.trim()) {
      throw new UserError("Please type a question.");
    }
    if (question.length > MAX_QUESTION_CHARS) {
      throw new UserError(`Your question is too long. Keep it under ${MAX_QUESTION_CHARS} characters.`);
    }

    const document = typeof docId === "string" ? getDocument(docId) : null;
    if (!document) {
      throw new UserError("This document is no longer available on the server. Please upload it again.", 404);
    }

    // Only well-formed, recent messages are passed on to the AI
    const recentTurns = (Array.isArray(history) ? history : [])
      .filter((turn) => turn && typeof turn.text === "string" && ["student", "tutor"].includes(turn.role))
      .slice(-MAX_HISTORY_TURNS)
      .map((turn) => ({ role: turn.role, text: turn.text.slice(0, MAX_TURN_CHARS) }));

    const result = await answerQuestion({
      pieces: document.pieces,
      question: question.trim(),
      history: recentTurns,
      level: Object.hasOwn(LEVELS, level) ? level : "simple",
    });

    res.json(result);

  } catch (error) {
    sendError(res, error, "The tutor could not answer. Please try again.");
  }
});

/* ---------- UPLOAD ERRORS ---------- */
// Errors raised by multer before a route runs, such as a file that is too large.
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File is too large. The limit is ${MAX_FILE_MB} MB.` });
  }
  if (err instanceof multer.MulterError || err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "The request could not be read. Please try again." });
  }
  sendError(res, err, "Server error");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
