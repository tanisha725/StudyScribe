const { askGroq, safeParse, FAST_MODEL } = require("./ai");
const { search } = require("./retrieve");
const { cleanQuiz, questionRules, QUESTION_FORMAT, DIFFICULTIES } = require("./quiz");

const MAX_MISTAKES_PER_CALL = 8;
const MAX_PRACTICE_CONCEPTS = 3;
const QUESTIONS_PER_CONCEPT = 2;
const EXCERPT_CHARS = 500;

const sameText = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/* ---------- ADAPTIVE DIFFICULTY ---------- */

// Rule for the next set of questions: do well and they get harder, struggle and they get easier.
function nextDifficulty(correct, total) {
  if (!total) return "medium";
  const accuracy = correct / total;
  if (accuracy >= 0.8) return "hard";
  if (accuracy >= 0.5) return "medium";
  return "easy";
}

// The easier of two difficulty levels.
const easier = (a, b) => (DIFFICULTIES.indexOf(a) <= DIFFICULTIES.indexOf(b) ? a : b);

/*
  Concepts the student got wrong, worst first. Practice for a concept starts at the
  easiest level the student missed, so the basics are rebuilt before harder questions.
*/
function weakConcepts(answers) {
  const byConcept = new Map();

  for (const item of answers) {
    if (!item.concept || sameText(item.chosen, item.answer)) continue;
    const entry = byConcept.get(item.concept) || { name: item.concept, wrong: 0, difficulty: item.difficulty };
    entry.wrong += 1;
    entry.difficulty = easier(entry.difficulty, item.difficulty);
    byConcept.set(item.concept, entry);
  }

  return [...byConcept.values()].sort((a, b) => b.wrong - a.wrong);
}

/* ---------- MISTAKE ANALYSIS ---------- */

const CATEGORIES = ["conceptual", "knowledge_gap", "misinterpretation", "careless", "unclear"];

function mistakePrompt(mistakes) {
  const list = mistakes.map((m, i) => `
#${i + 1}
Question: ${m.q}
Options: ${m.options.join(" | ")}
Correct answer: ${m.answer}
Student chose: ${m.chosen}
Concept: ${m.concept || "not labelled"} (${m.difficulty})
Other questions on this concept in this quiz: ${m.sameConceptCorrect} correct, ${m.sameConceptWrong} wrong
Excerpt from the student's material${m.excerpt ? ` [${m.excerpt.source}]: ${m.excerpt.text.slice(0, EXCERPT_CHARS)}` : ": none found"}`).join("\n");

  return `
You are reviewing a student's wrong answers in a multiple-choice quiz on their own study material.

Return ONLY JSON:
{"analysis":[{"id":1,"explanation":"...","category":"...","evidence":"..."}]}

Rules:
- Give one entry per mistake, with "id" equal to its number.
- "explanation": 1-2 sentences saying why the student's choice is wrong and why the correct answer is right. Use the excerpt when it is relevant. Plain text, no Markdown.
- "category": the most likely cause. One of:
  "conceptual" - the student got more than one question on this concept wrong, and the choices show a wrong idea about it
  "knowledge_gap" - the student seems not to know this fact, and the choice looks like a guess
  "misinterpretation" - the choice would be right for a different reading of the question, for example missing "NOT" or "EXCEPT"
  "careless" - the student answered other questions on the same concept correctly
  "unclear" - there is not enough evidence to tell
- One wrong multiple-choice answer is weak evidence. Use "unclear" unless something specific supports another category.
- "evidence": one short sentence, addressed to the student as "you", saying what supports the category.

MISTAKES:${list}
`;
}

/*
  Explains each wrong answer and suggests a likely cause.

  The AI proposes a category, but the code has the final say, because one wrong
  multiple-choice answer is not enough to know why a student got it wrong:
    - the category must be one of the five allowed values, otherwise it becomes "unclear"
    - "careless" is only accepted if the student got another question on that concept right
    - "conceptual" is only accepted if the student got another question on that concept wrong

  `answers` are all answered questions: [{ index, q, options, answer, chosen, concept, difficulty }].
  `ask` can be replaced in tests so no real AI call is made.
*/
async function analyzeMistakes(pieces, answers, ask = askGroq) {
  const isCorrect = (item) => sameText(item.chosen, item.answer);
  const sameConcept = (a, b) => a.concept && sameText(a.concept, b.concept);

  const mistakes = answers.filter((item) => !isCorrect(item)).slice(0, MAX_MISTAKES_PER_CALL).map((mistake) => {
    const others = answers.filter((item) => item !== mistake && sameConcept(item, mistake));
    return {
      ...mistake,
      sameConceptCorrect: others.filter(isCorrect).length,
      sameConceptWrong: others.filter((item) => !isCorrect(item)).length,
      excerpt: search(pieces, `${mistake.q} ${mistake.answer}`, 1)[0] || null,
    };
  });

  if (mistakes.length === 0) return [];

  const reply = safeParse(await ask(mistakePrompt(mistakes), { maxTokens: 3000, model: FAST_MODEL }));
  const entries = Array.isArray(reply?.analysis) ? reply.analysis : [];

  return mistakes.map((mistake, i) => {
    const entry = entries.find((item) => Number(item?.id) === i + 1) || {};
    let category = CATEGORIES.includes(entry.category) ? entry.category : "unclear";
    let evidence = typeof entry.evidence === "string" ? entry.evidence.trim() : "";

    const unsupported =
      (category === "careless" && mistake.sameConceptCorrect === 0) ||
      (category === "conceptual" && mistake.sameConceptWrong === 0);
    if (unsupported) {
      category = "unclear";
      evidence = "";
    }

    return {
      index: mistake.index,
      explanation: typeof entry.explanation === "string" ? entry.explanation.trim() : "",
      category,
      evidence,
      source: mistake.excerpt?.source || "",
    };
  });
}

/* ---------- PRACTICE ON WEAK CONCEPTS ---------- */

function practicePrompt(targets, avoid) {
  const sections = targets.map((target) => `
CONCEPT: ${target.name}
DIFFICULTY: ${target.difficulty}
MATERIAL:
${target.excerpts.map((piece) => `[${piece.source}] ${piece.text}`).join("\n")}`).join("\n");

  return `
A student got questions wrong on the concepts below. Write new practice questions to help them.

Return ONLY JSON:
{"questions":[${QUESTION_FORMAT}]}

Rules:
- Write ${QUESTIONS_PER_CONCEPT} multiple-choice questions for each concept, at the difficulty given for it.
- Use only the MATERIAL given for that concept.
- "concept" must be exactly the concept name given.
- Do not repeat these questions: ${avoid.length ? avoid.map((q) => `"${q}"`).join("; ") : "(none)"}
${questionRules()}
${sections}
`;
}

/*
  Writes follow-up questions for the student's weakest concepts, using the parts of the
  document about each concept.

  `concepts` is [{ name, difficulty }], as returned by weakConcepts().
*/
async function practiceQuestions(pieces, concepts, avoid = [], ask = askGroq) {
  const targets = concepts.slice(0, MAX_PRACTICE_CONCEPTS).map((concept) => ({
    ...concept,
    excerpts: search(pieces, concept.name, 2),
  })).filter((target) => target.excerpts.length);

  if (targets.length === 0) return [];

  const names = targets.map((target) => target.name);
  const reply = safeParse(await ask(practicePrompt(targets, avoid), { maxTokens: 4000, model: FAST_MODEL }));

  // The model may shorten a name ("Process Control Block" for "Process Control Block (PCB)"),
  // so a concept counts as a match if one name contains the other.
  const requested = (concept) => {
    const wanted = concept.toLowerCase();
    return wanted && names.find((name) => name.toLowerCase().includes(wanted) || wanted.includes(name.toLowerCase()));
  };

  // Keep only questions about a requested concept that are not repeats
  return cleanQuiz(reply?.questions).flatMap((question) => {
    const concept = requested(question.concept);
    if (!concept || avoid.some((old) => sameText(old, question.q))) return [];
    return [{ ...question, concept }];
  });
}

module.exports = { nextDifficulty, weakConcepts, analyzeMistakes, practiceQuestions, CATEGORIES };
