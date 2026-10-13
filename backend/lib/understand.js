const { askGroq, safeParse } = require("./ai");

const PIECE_CHARS = 1500;   // size of one piece of text
const BATCH_CHARS = 8000;   // how much text goes into one AI call
const MAX_ANALYSIS_CALLS = Number(process.env.MAX_ANALYSIS_CALLS) || 4;
const KNOWLEDGE_MAX_TOKENS = 6000;   // the knowledge map is a long JSON reply

/* ---------- SPLITTING TEXT ---------- */

// Cuts long text into parts of at most maxChars, preferring to cut at a paragraph or sentence end.
function splitText(text, maxChars) {
  const parts = [];
  let rest = text.trim();

  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    let cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". ") + 1);
    if (cut < maxChars / 2) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = maxChars;

    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// Turns sections into pieces of at most PIECE_CHARS. Each piece remembers its source.
function toPieces(sections, maxChars = PIECE_CHARS) {
  return sections.flatMap((section) =>
    splitText(section.text, maxChars).map((text) => ({ source: section.source, text }))
  );
}

// Groups neighbouring pieces into batches of at most maxChars.
function makeBatches(pieces, maxChars = BATCH_CHARS) {
  const batches = [];
  let current = [];
  let size = 0;

  for (const piece of pieces) {
    if (current.length && size + piece.text.length > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(piece);
    size += piece.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

// Picks `count` items spread evenly across the list, so the start, middle and end are all represented.
function pickEvenly(items, count) {
  if (items.length <= count) return items;
  if (count === 1) return [items[0]];
  const step = (items.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => items[Math.round(i * step)]);
}

// Text used for the summary, notes, flashcards and quiz.
// A short document is used in full. A long one is sampled evenly instead of using only its beginning.
function sampleText(sections, maxChars) {
  const pieces = toPieces(sections);
  const picked = pickEvenly(pieces, Math.max(1, Math.floor(maxChars / PIECE_CHARS)));
  return picked.map((piece) => piece.text).join("\n\n").slice(0, maxChars);
}

/* ---------- KNOWLEDGE MAP ---------- */

const text = (value) => (typeof value === "string" ? value.trim() : "");
const key = (value) => value.toLowerCase();

function knowledgePrompt(batch) {
  const material = batch.map((piece) => `[${piece.source}]\n${piece.text}`).join("\n\n");

  return `
You are organising study material for a student.

Return ONLY JSON:
{
 "topics":[
  {
   "name":"...",
   "subtopics":["..."],
   "concepts":[{"name":"...","definition":"...","example":"...","source":"..."}]
  }
 ],
 "relationships":[{"from":"...","to":"...","relation":"..."}]
}

Rules:
- Use ONLY the material below. Do not add outside knowledge.
- At most 5 topics, and at most 6 concepts per topic.
- "definition": 1-2 simple sentences.
- "example": an example given in the material. If the material gives none, use "".
- "source": the label in square brackets where the concept appears, for example "${batch[0].source}".
- "relationships": how two of the listed concepts are connected, for example "is a type of", "depends on", "is the opposite of". "from" and "to" must be concept names you listed.

MATERIAL:
${material}
`;
}

// Checks the AI's reply field by field and keeps only well-formed data.
function cleanKnowledge(data, validSources) {
  const topics = (Array.isArray(data?.topics) ? data.topics : []).flatMap((topic) => {
    const name = text(topic?.name);
    if (!name) return [];

    const subtopics = (Array.isArray(topic.subtopics) ? topic.subtopics : []).map(text).filter(Boolean);
    const concepts = (Array.isArray(topic.concepts) ? topic.concepts : []).flatMap((concept) => {
      const conceptName = text(concept?.name);
      const definition = text(concept?.definition);
      if (!conceptName || !definition) return [];

      // Keep a source only if it is a real label from the material
      const source = text(concept.source).replace(/^\[|\]$/g, "");
      return [{
        name: conceptName,
        definition,
        example: text(concept.example),
        source: validSources.has(source) ? source : "",
      }];
    });

    return [{ name, subtopics, concepts }];
  });

  const relationships = (Array.isArray(data?.relationships) ? data.relationships : []).flatMap((rel) => {
    const from = text(rel?.from);
    const to = text(rel?.to);
    const relation = text(rel?.relation);
    return from && to && relation ? [{ from, to, relation }] : [];
  });

  return { topics, relationships };
}

// Joins the results of several AI calls into one map, without repeating topics or concepts.
function mergeKnowledge(maps) {
  const topics = new Map();
  const conceptNames = new Map();

  for (const map of maps) {
    for (const topic of map.topics) {
      if (!topics.has(key(topic.name))) {
        topics.set(key(topic.name), { name: topic.name, subtopics: [], concepts: [] });
      }
      const merged = topics.get(key(topic.name));

      for (const subtopic of topic.subtopics) {
        if (!merged.subtopics.some((existing) => key(existing) === key(subtopic))) merged.subtopics.push(subtopic);
      }
      for (const concept of topic.concepts) {
        if (conceptNames.has(key(concept.name))) continue;
        conceptNames.set(key(concept.name), concept.name);
        merged.concepts.push(concept);
      }
    }
  }

  // Keep a relationship only if both ends are concepts we actually have
  const seen = new Set();
  const relationships = maps.flatMap((map) => map.relationships).flatMap((rel) => {
    const from = conceptNames.get(key(rel.from));
    const to = conceptNames.get(key(rel.to));
    const id = `${from}|${to}`;
    if (!from || !to || from === to || seen.has(id)) return [];
    seen.add(id);
    return [{ from, to, relation: rel.relation }];
  });

  return {
    topics: [...topics.values()].filter((topic) => topic.concepts.length || topic.subtopics.length),
    relationships,
  };
}

/*
  Builds the knowledge map of a document: topics, subtopics, concepts (with definition,
  example and source) and relationships between concepts.

  The document is read in batches, one AI call per batch. To stay inside free AI limits,
  at most MAX_ANALYSIS_CALLS batches are read. For a longer document the batches are
  spread evenly, and "coverage" reports honestly how much was read.

  `ask` can be replaced in tests so no real AI call is made.
*/
async function buildKnowledgeMap(sections, ask = askGroq) {
  const batches = makeBatches(toPieces(sections));
  const chosen = pickEvenly(batches, MAX_ANALYSIS_CALLS);
  const batchSize = (batch) => batch.reduce((sum, piece) => sum + piece.text.length, 0);

  const maps = [];
  let analysedChars = 0;

  for (const batch of chosen) {
    try {
      const validSources = new Set(batch.map((piece) => piece.source));
      const reply = await ask(knowledgePrompt(batch), { maxTokens: KNOWLEDGE_MAX_TOKENS });
      const map = cleanKnowledge(safeParse(reply), validSources);
      if (map.topics.length) {
        maps.push(map);
        analysedChars += batchSize(batch);
      } else {
        console.warn("KNOWLEDGE MAP: no usable topics in the AI reply for", batch[0].source);
      }
    } catch (error) {
      console.error("KNOWLEDGE MAP ERROR:", error.message);
      // A rate limit will not clear within this request, so stop and keep what we have
      if (error.status === 429) break;
    }
  }

  if (maps.length === 0) return null;

  const totalChars = batches.reduce((sum, batch) => sum + batchSize(batch), 0);
  return {
    ...mergeKnowledge(maps),
    coverage: {
      percent: Math.round((analysedChars / totalChars) * 100),
      sections: sections.length,
      firstSource: sections[0].source,
      lastSource: sections[sections.length - 1].source,
    },
  };
}

module.exports = { splitText, toPieces, makeBatches, pickEvenly, sampleText, cleanKnowledge, mergeKnowledge, buildKnowledgeMap };
