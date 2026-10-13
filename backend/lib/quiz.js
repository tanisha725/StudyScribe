const normalize = (value) => String(value).trim().toLowerCase();
const text = (value) => (typeof value === "string" ? value.trim() : "");

const DIFFICULTIES = ["easy", "medium", "hard"];

// The JSON shape every question prompt asks for, and the rules that go with it.
const QUESTION_FORMAT = `{"q":"...","options":["...","...","...","..."],"answer":"...","difficulty":"easy","concept":"...","explanation":"..."}`;

function questionRules(conceptNames = []) {
  const conceptRule = conceptNames.length
    ? `Choose it from this list: ${conceptNames.join("; ")}`
    : "Use a short name of 1 to 4 words";

  return `- "answer" must be the exact text of the correct option
- "difficulty": "easy" (recall a fact), "medium" (understand or compare ideas) or "hard" (apply the idea to a new situation)
- "concept": the one concept the question tests. ${conceptRule}
- "explanation": one sentence saying why the answer is correct, based on the text`;
}

// The quiz is scored by comparing the chosen option with "answer", so "answer" must be
// exactly one of the options. The model sometimes returns a letter ("B") or "B) text" instead.
function findAnswer(options, answer) {
  if (typeof answer !== "string" && typeof answer !== "number") return null;

  const wanted = normalize(answer);
  const exact = options.find((opt) => normalize(opt) === wanted);
  if (exact) return exact;

  // "B", "b)", "Option B"
  const letterOnly = wanted.match(/^(?:option\s*)?([a-d])[.):]?$/);
  if (letterOnly) return options[letterOnly[1].charCodeAt(0) - 97] || null;

  // "B) the option text"
  const labelled = wanted.match(/^[a-d][.):]\s*(.+)$/);
  if (labelled) return options.find((opt) => normalize(opt) === labelled[1]) || null;

  return null;
}

/*
  Keeps only questions that can actually be answered and scored, and tidies their labels.
  If conceptNames is given, a concept that matches one of them is rewritten to that exact
  spelling, so the same concept is always counted under one name.
*/
function cleanQuiz(questions, conceptNames = []) {
  if (!Array.isArray(questions)) return [];

  return questions.flatMap((item) => {
    if (!item || typeof item.q !== "string" || !Array.isArray(item.options)) return [];

    const options = item.options.filter((opt) => typeof opt === "string" && opt.trim());
    const answer = findAnswer(options, item.answer);
    if (options.length < 2 || !answer) return [];

    const difficulty = normalize(item.difficulty ?? "");
    const concept = text(item.concept);
    const knownConcept = conceptNames.find((name) => normalize(name) === normalize(concept));

    return [{
      q: item.q.trim(),
      options,
      answer,
      difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : "medium",
      concept: knownConcept || concept,
      explanation: text(item.explanation),
    }];
  });
}

function cleanFlashcards(cards) {
  if (!Array.isArray(cards)) return [];

  return cards.filter(
    (card) => card && typeof card.q === "string" && typeof card.a === "string" && card.q.trim() && card.a.trim()
  );
}

// All concept names in a knowledge map, as a flat list.
function conceptNamesOf(knowledge) {
  return (knowledge?.topics || []).flatMap((topic) => topic.concepts.map((concept) => concept.name));
}

module.exports = { cleanQuiz, cleanFlashcards, conceptNamesOf, questionRules, QUESTION_FORMAT, DIFFICULTIES };
