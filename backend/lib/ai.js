const Groq = require("groq-sdk");

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

// A smaller model for the interactive features (tutor, mistake analysis, practice questions).
// On Groq's free plan every model has its own tokens-per-minute limit, so these features
// are not slowed down by an upload that just used up the main model's limit.
const FAST_MODEL = process.env.GROQ_FAST_MODEL || "openai/gpt-oss-20b";

// Created on first use so that files which only need safeParse can be loaded without an API key.
let groq;

function client() {
  if (!groq) groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groq;
}

// maxTokens limits the reply. The model's hidden "thinking" also counts towards it,
// so a reply that needs a lot of JSON needs a higher limit.
// model lets a feature use a different Groq model. Each model has its own free rate limit.
async function askGroq(prompt, { maxTokens = 3000, model = GROQ_MODEL } = {}) {
  const res = await client().chat.completions.create({

    model,

    max_tokens: maxTokens,

    temperature: 0.4,

    messages: [
      {
        role: "user",
        content: prompt
      }
    ],

  });

  if (res.choices[0].finish_reason === "length") {
    console.warn("AI reply was cut off at the token limit, so it may be incomplete.");
  }

  return res.choices[0].message.content;
}

// Turns a recording into text using Whisper on Groq.
async function transcribe(buffer, fileName) {
  const file = await Groq.toFile(buffer, fileName);
  const res = await client().audio.transcriptions.create({ file, model: TRANSCRIBE_MODEL });
  return res.text;
}

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

module.exports = { askGroq, transcribe, safeParse, FAST_MODEL };
