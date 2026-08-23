const express = require("express");
const multer = require("multer");
const cors = require("cors");
const pdfParse = require("pdf-parse");
const path = require("path");
require("dotenv").config();

const Groq = require("groq-sdk");
const fs = require("fs");
const officeParser = require("officeparser");
const { HfInference } = require("@huggingface/inference");
const gTTS = require("gtts");

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const hf = new HfInference(process.env.HF_API_KEY);

const upload = multer({ storage: multer.memoryStorage() });

/* ---------- SAFE PARSE ---------- */
function safeParse(raw) {
  if (!raw || typeof raw !== 'string') return null;

  try {
    return JSON.parse(raw);
  } catch {
    try {
      // Try to extract JSON from markdown code blocks
      const codeBlockMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        return JSON.parse(codeBlockMatch[1]);
      }

      // Try to find JSON object boundaries
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        const jsonStr = raw.substring(start, end + 1);
        return JSON.parse(jsonStr);
      }
    } catch {
      // If all parsing fails, return null
    }
  }
  return null;
}

/* ---------- CLEAN TEXT ---------- */
function cleanText(text) {
  return text
    .replace(/[{[\]}"]/g, " ")
    .replace(/metadata|pptx|type/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
async function askGroq(prompt) {

  const model = "llama-3.3-70b-versatile";

  console.log("🔥 ACTUAL GROQ MODEL:", model);

  const res = await groq.chat.completions.create({

    model: model,

    max_tokens: 3000,

    temperature: 0.4,

    messages: [
      {
        role: "user",
        content: prompt
      }
    ],

  });

  return res.choices[0].message.content;
}
/* ---------- GROQ ---------- */

/* ---------- TEXT EXTRACTION ---------- */
async function extractText(file) {
  const name = file.originalname.toLowerCase();

  if (name.endsWith(".pdf")) {
    const data = await pdfParse(file.buffer);
    return data.text;
  }

  if (name.endsWith(".pptx") || name.endsWith(".ppt")) {
    const data = await officeParser.parseOffice(file.buffer);

    let text =
      typeof data === "string"
        ? data
        : data?.text || JSON.stringify(data);

    text = cleanText(text);

    if (text.length < 300) {
      throw new Error("PPT extraction failed (text too small)");
    }

    return text;
  }

  if (name.endsWith(".txt")) {
    return file.buffer.toString("utf-8");
  }

  if (name.match(/\.(mp3|wav|m4a|ogg)$/)) {
    const result = await hf.automaticSpeechRecognition({
      model: "openai/whisper-large-v3",
      data: new Uint8Array(file.buffer),
    });
    return result.text;
  }

  throw new Error("Unsupported file type");
}

/* ---------- AUDIO ---------- */
const uploadsDir = path.join(__dirname, "uploads");
console.log("Uploads folder path:", uploadsDir);
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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
    const extractedText = await extractText(req.file);

    console.log("📄 TEXT LENGTH:", extractedText.length);
    console.log("📄 SAMPLE:", extractedText.substring(0, 300));

    const text = extractedText.substring(0, 6000);

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

    if (!summaryData || !summaryData.summary || summaryData.summary.length < 200) {
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

    if (!notesData || !notesData.notes || notesData.notes.length < 10) {
      console.log("🔁 Retry notes...");
      const retry = await askGroq(`Give 15 detailed notes:\n${text}`);
      notesData = {
        notes: retry.split(".").map(l => l.trim()).filter(Boolean)
      };
    }

    /* ---------- QUIZ + FLASHCARDS ---------- */
    let quizRaw = await askGroq(`
Return ONLY JSON:
{
 "flashcards":[{"q":"...","a":"..."}],
 "quiz":[{"q":"...","options":["...","...","...","..."],"answer":"..."}]
}

Rules:
- Minimum 15 flashcards
- Minimum 15 MCQs
- Questions must test understanding

TEXT:
${text}
`);

    console.log("QUIZ RAW RESPONSE:", quizRaw);
    let quizData = safeParse(quizRaw) || {};
    console.log("PARSED QUIZ DATA:", quizData);

    if (!quizData.quiz || quizData.quiz.length < 10) {
      console.log("🔁 Retry quiz...");
      const retry = await askGroq(`Return ONLY JSON: {"quiz":[{"q":"...","options":["...","...","...","..."],"answer":"..."}]}. Generate 20 MCQs:\n${text}`);
      console.log("QUIZ RETRY RESPONSE:", retry);
      quizData.quiz = safeParse(retry)?.quiz || [];
      console.log("PARSED QUIZ RETRY:", quizData.quiz);
    }

    if (!quizData.flashcards || quizData.flashcards.length < 10) {
      console.log("🔁 Retry flashcards...");
      const retry = await askGroq(`Return ONLY JSON: {"flashcards":[{"q":"...","a":"..."}]}. Generate 20 flashcards:\n${text}`);
      console.log("FLASHCARDS RETRY RESPONSE:", retry);
      quizData.flashcards = safeParse(retry)?.flashcards || [];
      console.log("PARSED FLASHCARDS RETRY:", quizData.flashcards);
    }

    // Fallback: Generate basic quiz and flashcards if AI fails completely
    if (!quizData.quiz || quizData.quiz.length === 0) {
      console.log("Using fallback quiz generation...");
      quizData.quiz = [
        {
          q: "What is the main topic discussed in the material?",
          options: ["General knowledge", "Specific subject matter", "Random information", "Unrelated content"],
          answer: "Specific subject matter"
        },
        {
          q: "Which of the following is a key concept from the text?",
          options: ["Basic principles", "Advanced topics", "Irrelevant details", "External references"],
          answer: "Basic principles"
        }
      ];
    }

    if (!quizData.flashcards || quizData.flashcards.length === 0) {
      console.log("Using fallback flashcards generation...");
      quizData.flashcards = [
        {
          q: "What is the primary focus of this material?",
          a: "The material covers key concepts and information related to the uploaded content."
        },
        {
          q: "What type of content was processed?",
          a: "The system processed text, audio, or document content to generate study materials."
        }
      ];
    }

    /* ---------- RESPONSE ---------- */
    const audioUrl = await generateAudio(summaryData.summary);
    
    res.json({
      summary: summaryData.summary,
      notes: notesData.notes,
      flashcards: quizData.flashcards || [],
      quiz: quizData.quiz || [],
      audio: audioUrl,
      originalText: text,
    });

  } catch (error) {
    console.error("ERROR:", error.message);

    res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
});

app.post("/generate-more-questions", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "No text provided" });
    }

    const contentText = text.substring(0, 10000);

    let quizRaw = await askGroq(`
Return ONLY JSON:
{
 "questions":[{"q":"...","options":["...","...","...","..."],"answer":"..."}]
}

Rules:
- Generate 10 NEW unique MCQs
- Different from the original questions
- Questions must test understanding
- Each option should be plausible

TEXT:
${contentText}
`);

    let quizData = safeParse(quizRaw) || {};

    if (!quizData.questions || quizData.questions.length === 0) {
      console.log("Retry more questions...");
      const retry = await askGroq(`Return ONLY JSON: {"questions":[{"q":"...","options":["...","...","...","..."],"answer":"..."}]}. Generate 10 unique MCQs for a quiz:\n${contentText}`);
      quizData.questions = safeParse(retry)?.questions || [];
    }

    res.json({
      questions: quizData.questions || [],
    });

  } catch (error) {
    console.error("ERROR in generate-more-questions:", error.message);

    res.status(500).json({
      error: "Failed to generate more questions",
      details: error.message,
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});