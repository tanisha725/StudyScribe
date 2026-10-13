# Understanding StudyScribe

This document explains how StudyScribe works today, in plain language. It describes the code as it actually is, including its weak points, and is updated as each StudyScribe 2.0 phase is completed.

Last updated: 14 October 2026, after Phase 4 (adaptive assessment and mistake analysis).

## 1. What the app does

A student uploads one file. The backend pulls the text out of it, asks an AI model to write a summary, notes, flashcards and a quiz, builds a map of the topics and concepts in the file, turns the summary into an audio file, and sends everything back. The frontend shows the result in six tabs, one of which is a tutor the student can question about the file.

It is a one-shot generator. It does not remember the student, the file, or the quiz result.

## 2. Architecture

```
Browser (React)                      Server (Node + Express)                 Outside services
───────────────                      ───────────────────────                 ────────────────
Auth.js   login screen
          (browser storage only)

App.js    choose a file  ──────────► POST /upload
                                       0. check file exists, size, type
                                       1. extractSections() ───────────────► Groq Whisper        
                                          PDF / PPTX / DOCX / TXT / audio     (audio files only)
                                          gives sections with a source label
                                       2. sampleText(): 6,000 characters
                                          spread across the whole file
                                       3. askGroq() x2    ─────────────────► Groq LLM
                                          summary, notes
                                       4. buildKnowledgeMap() ─────────────► Groq LLM
                                          topics, concepts, relationships     (up to 4 calls)
                                          then flashcards + quiz, each question
                                          tagged with one of those concepts
                                       5. generateAudio() ─────────────────► Google TTS (gtts)
                                          saves an mp3 in backend/uploads
                                       6. saveDocument(): keep the pieces
                                          in memory for the tutor
          show 6 tabs    ◄────────── JSON response with a docId

          Tutor question ──────────► POST /ask
                                       1. search(): find the 4 most relevant
                                          pieces of the document (BM25)
                                       2. askGroq()       ─────────────────► Groq LLM (tutor model)
                                       3. keep only sources that were sent
          answer + sources ◄──────── JSON response

          Submit quiz    ──────────► POST /analyze-mistakes ───────────────► Groq LLM (fast model)
          explanations,  ◄────────── code checks each suggested cause
          weak concepts

          Practice weak  ──────────► POST /practice ───────────────────────► Groq LLM (fast model)
          concepts       ◄────────── new questions on those concepts

          "Load more"    ──────────► POST /generate-more-questions ────────► Groq LLM
          questions      ◄────────── 10 more questions
```

There are two separate programs:

- **Frontend** in `frontend/`: a React single-page app made with Create React App.
- **Backend** in `backend/`: one Express server. `index.js` holds the routes and `lib/` holds the logic.

There is no database. Uploaded documents are held in the server's memory.

## 3. Files

| File | What it does |
| --- | --- |
| `backend/index.js` | Server setup, error responses, audio, input checks and the five routes |
| `backend/lib/extract.js` | Reads an uploaded file into sections, each with a source label |
| `backend/lib/understand.js` | Splits text into pieces and batches, samples long documents, and builds the knowledge map |
| `backend/lib/retrieve.js` | `search()`: ranks the pieces of a document against a question |
| `backend/lib/tutor.js` | `answerQuestion()`: retrieve, ask the LLM, check the sources |
| `backend/lib/store.js` | `saveDocument()` and `getDocument()`: documents kept in memory |
| `backend/lib/quiz.js` | `cleanQuiz()` and `cleanFlashcards()`, which check AI-written questions and cards, plus the shared question format |
| `backend/lib/assess.js` | `nextDifficulty()`, `weakConcepts()`, `analyzeMistakes()` and `practiceQuestions()` |
| `backend/lib/ai.js` | `askGroq()`, the single place that calls the LLM, and `safeParse()` |
| `backend/lib/errors.js` | `UserError`, for problems the student can fix |
| `backend/test/` | 36 tests run with Node's built-in test runner (`npm test`) |
| `backend/package.json` | Backend libraries |
| `backend/.env.example` | Template listing the keys the backend needs |
| `backend/tmp_*.js` | Four leftover experiment scripts. Not used by the app. Three contain a hardcoded token (see section 7) |
| `frontend/src/App.js` | Main screen: upload box, progress popup, the six tabs, and the `Tutor`, `KnowledgeMap` and `FlipCard` components |
| `frontend/src/Quiz.js` | The quiz: answering, timer, score, mistake review, practice rounds |
| `frontend/src/config.js` | The backend address |
| `frontend/src/Auth.js` | Sign-up and login screen |
| `frontend/src/App.css` | All styling |
| `frontend/src/index.js` | Starts React |
| `frontend/src/App.test.js` | Eight tests covering the sign-in screen, the upload screen, file checks, and the Topics, Tutor and Quiz tabs |
| `frontend/.env.example` | Template for the backend address the frontend should call |
| `frontend/README.md` | The default Create React App readme |
| `package.json` (root) | Lists five libraries the backend already lists. Not used by anything |

## 4. How each feature works

### Upload and text extraction

`extractSections(file)` in `backend/lib/extract.js` picks a reader from the file extension. Every reader returns a list of **sections**, `{ source, text }`, where `source` says where the text came from:

| Extension | Method | Sections |
| --- | --- | --- |
| `.pdf` | `pdf-parse` reads the text layer | One per page: "Page 3" |
| `.pptx` | `officeparser` builds a tree of slides | One per slide: "Slide 7" |
| `.docx` | `officeparser` builds a tree of headings and paragraphs | One per heading: "Section: Stacks". A file with no heading styles is one section, "Document". Word files do not store page numbers |
| `.txt` | Read as UTF-8 text | One: "Text file" |
| `.mp3`, `.wav`, `.m4a`, `.ogg` | `transcribe()` sends it to Groq's `whisper-large-v3-turbo` model | One: "Recording" |
| `.ppt`, `.doc`, images | Rejected with a message saying what to upload instead | |

Files are kept in memory by `multer` (limit 25 MB) and never written to disk. If fewer than 100 characters come out, the upload is rejected with a clear message, which is what happens for scanned PDFs.

The summary, notes and quiz prompts receive at most 6,000 characters. `sampleText()` uses a short file in full. For a long file it picks pieces spread evenly from start to end, instead of only the beginning as before.

Problems the student can fix are raised as a `UserError` with a readable message and a status code. `sendError()` turns any error into a JSON response, so internal error text is not shown as the main message.

### Summary, notes, flashcards, quiz

`askGroq(prompt)` in `backend/lib/ai.js` sends one prompt to Groq's `openai/gpt-oss-120b` model. The `/upload` route calls it for the summary, then the notes, then (after the knowledge map is built) for flashcards and quiz together.

Each prompt asks for JSON. `safeParse()` tries to read the reply as JSON, and if that fails it looks for JSON inside a code block or between the first `{` and last `}`. If a result is missing or too short, the route asks again with a simpler prompt.

AI output is not trusted as is. `cleanQuiz()` drops any question that has no usable options or whose answer cannot be matched to an option, and it converts answers like "B" or "B) text" into the option's exact text. `cleanFlashcards()` drops cards with a missing side. If the quiz or flashcards are still empty, the response carries a `warnings` message that the frontend shows, instead of inventing questions.

### Knowledge map (Topics tab)

`buildKnowledgeMap(sections)` in `backend/lib/understand.js` turns the file into structured learning content:

```
topics → subtopics
       → concepts → definition, example, source
relationships between concepts ("AVL tree" is a type of "Binary tree")
```

It works in four steps:

1. **Split.** `toPieces()` cuts each section into pieces of at most 1,500 characters, cutting at paragraph or sentence ends. Each piece keeps its source label.
2. **Batch.** `makeBatches()` groups neighbouring pieces into batches of about 8,000 characters. One batch is one AI call.
3. **Ask.** Each batch is sent with its labels, like `[Page 3]`, and the model is told to use only that material and to name the label each concept came from.
4. **Check and merge.** `cleanKnowledge()` drops anything malformed and removes any source that is not a real label from the file, so the model cannot invent a page number. `mergeKnowledge()` joins the batches, removes repeated topics and concepts, and keeps a relationship only if both of its concepts exist.

To stay inside free AI limits, at most `MAX_ANALYSIS_CALLS` batches (default 4, about 32,000 characters) are read. For a longer file, `pickEvenly()` chooses batches spread across it, and the result includes a `coverage` percentage that the Topics tab shows to the student. If the AI is rate limited part-way, the map is built from the batches that succeeded.

This map is the base for later phases: concepts become the units that quizzes target and that mastery is tracked for.

### Tutor (retrieval-augmented generation)

An LLM asked about a student's lecture will happily answer from its general knowledge, which may differ from what the lecture says. Retrieval-augmented generation (RAG) avoids that: first *retrieve* the relevant parts of the student's own file, then ask the LLM to *generate* an answer from those parts only.

`answerQuestion()` in `backend/lib/tutor.js` does this in three steps:

1. **Retrieve.** `search()` in `backend/lib/retrieve.js` scores every piece of the document against the question and returns the best four. It uses **BM25**, a standard keyword-ranking formula: a piece scores higher when it contains the question's words often, and rare words count for more than common ones. Common words ("what", "is", "explain") are ignored and plurals are trimmed so "processes" matches "process".
2. **Generate.** The four pieces are sent to the LLM with their labels, like `[Page 4]`, along with the recent conversation and the chosen level (simple or detailed). The model must reply in JSON with `answer`, `sources` and `found`. It is told to set `found` to false, and not to answer from outside knowledge, when the pieces do not contain the answer.
3. **Check.** Only sources that were actually among the four pieces are kept, so a cited page is always a real one. Each source is returned with a short excerpt that the student can open to verify the answer.

Three details make conversations work:

- **Follow-ups.** "Explain that more simply" has no topic words to search with. When a question has fewer than two search words, the most recent student question that did have some is added to the search.
- **Broad questions.** "What is this about?" matches nothing, so pieces spread evenly across the document are used instead.
- **Memory.** The frontend sends the last few messages with each question. The server keeps no chat history.

**Why keyword search instead of embeddings?** Embedding search matches by meaning and is the more common choice for RAG, but it needs an embedding model: either a paid service (the Hugging Face one requires credits) or a large model loaded into the server's memory. BM25 needs neither, is about 40 lines of code, and works well for study questions because students usually ask using the terms in their notes. Its weakness is questions worded very differently from the material.

**Where documents live.** `/upload` stores the document's pieces with `saveDocument()` and returns a `docId`. `backend/lib/store.js` is a plain in-memory `Map` holding the 50 most recent documents. It is emptied when the server restarts, in which case `/ask` returns a 404 telling the student to upload again.

**Why the tutor uses a different model.** Groq's free plan limits each model to 8,000 tokens per minute. One upload uses most of that on `openai/gpt-oss-120b`, so tutor questions asked straight afterwards had to wait up to 27 seconds. The tutor uses `openai/gpt-oss-20b`, which has its own separate limit, and replies in about one to two seconds.

### Audio

`generateAudio()` uses `gtts` to read the summary aloud and saves `backend/uploads/audio_<timestamp>.mp3`. Express serves that folder at `/uploads`, and the frontend plays it with an `<audio>` element.

### Quiz, mistake analysis and adaptive practice

**Questions.** Every question now carries three extra fields: `difficulty` (easy, medium or hard), `concept` (the one concept it tests) and `explanation` (why the answer is right). The quiz is generated *after* the knowledge map, and the prompt lists the map's concept names, so each question is tagged with a concept from the Topics tab. `cleanQuiz()` rewrites a matching concept to the map's exact spelling, so one concept is always counted under one name. The upload asks for 5 easy, 5 medium and 5 hard questions.

**Taking the quiz.** `frontend/src/Quiz.js` keeps the selected answers in React state. A 10-minute countdown starts on the first click and submits automatically at zero. The score is shown overall and per difficulty.

**Mistake analysis.** On submit, the browser sends the answered questions to `/analyze-mistakes`. `analyzeMistakes()` in `backend/lib/assess.js`:

1. Picks out the wrong answers (at most 8).
2. Gathers evidence for each: how many *other* questions on the same concept the student got right and wrong, and the passage of the document about the question (found with the same `search()` the tutor uses).
3. Asks the LLM for an explanation of why the choice is wrong, a likely cause, and one sentence of evidence.
4. **Checks the cause in code.** The cause must be one of five values: `conceptual`, `knowledge_gap`, `misinterpretation`, `careless`, `unclear`. Two are only accepted when the quiz results support them:
   - `careless` needs another question on the same concept answered **correctly**.
   - `conceptual` needs another question on the same concept answered **wrongly**.

   Otherwise the cause becomes `unclear`, and the screen says "one wrong answer is not enough to tell why".

This rule exists because the first real test labelled five out of five single mistakes "conceptual". One wrong multiple-choice pick does not show *why* it was wrong, so the screen always says "Possible cause", never a verdict.

**Adaptive practice.** Two explicit rules, both in `assess.js`, decide what the student sees next:

- `weakConcepts()` lists the concepts with wrong answers, worst first. "Practice weak concepts" calls `/practice`, which finds the passages about the top three and asks for two new questions on each. Practice starts at the easiest level the student missed for that concept, so basics are rebuilt first. Questions that repeat an old one or drift to another concept are dropped.
- `nextDifficulty()` sets the level of "more questions" from the last score: 80% or more gives hard, 50% or more gives medium, below that easy.

In both cases the code decides *what* to ask about and *how hard*; the LLM only writes the questions.

### Authentication

`Auth.js` saves `{ email, password }` in the browser's `localStorage` on sign-up, and compares against it on login. A `loggedIn` flag in `localStorage` decides whether to show the app. The backend is not involved at all.

## 5. Technologies

| Technology | Used for | Actually used? |
| --- | --- | --- |
| React 19, Create React App | Frontend | Yes |
| axios | Frontend HTTP calls | Yes |
| Express 5, cors, multer, dotenv | Backend server and uploads | Yes |
| groq-sdk | LLM calls and audio transcription | Yes |
| gtts | Text-to-speech | Yes |
| pdf-parse, officeparser | File parsing | Yes |

## 6. Deployment

The original app is deployed with the frontend on Vercel (`https://study-scribe-xi.vercel.app`) and the backend on Render (`https://studyscribe.onrender.com`), both connected to the original repository this one was forked from.

The frontend reads the backend address from `REACT_APP_API_URL` and falls back to the Render address when it is not set. A separate deployment needs its own Render service (with the backend variables) and its own Vercel project (with `REACT_APP_API_URL` pointing at that Render service).

## 7. Audit findings

### Fixed in Phase 1

| Problem found | Fix |
| --- | --- |
| Backend address hardcoded in the frontend, so local development could not use a local backend | `REACT_APP_API_URL` setting, with the old address as the default |
| Uploading with no file crashed with "Cannot read properties of undefined" | Clear 400 error |
| "Max 25 MB" was shown but not enforced | Enforced in the browser and on the server |
| PowerPoint text was built by converting the parser's whole output to JSON and then deleting symbols and the words "type", "metadata" and "pptx", which also removed them from real content | Uses the parser's `toText()`; `cleanText()` removed |
| Old `.ppt` files were accepted but the parser cannot read them | Rejected with a helpful message, removed from the file picker |
| Scanned PDFs produced an empty study set | Rejected with a clear message |
| A quiz answer that was not exactly one of the options could never be marked correct | `cleanQuiz()` repairs or drops such questions |
| When the AI failed, two generic made-up questions and flashcards were shown as if real | Removed; a warning is shown instead |
| The frontend expected `audioError` but the backend never sent it | Backend sends it |
| Answers and score from the previous file stayed when a new file was uploaded | Quiz state resets on each upload |
| Document text and full AI output were printed to the server log | Only the text length is logged |
| Server started without an API key and failed later on the first upload | Stops at startup with instructions |
| CORS allowed every website with no way to restrict it | Optional `ALLOWED_ORIGINS` setting |
| Unused libraries (`mongoose`, `openai`, `mammoth`, `axios`, `fs`), no start script | Removed; `npm start` added |
| The only test failed | Replaced with passing tests |
| Real Word and PowerPoint files were rejected as "could not read this file". The parser guesses an in-memory file's type from its first bytes and saw many real files as plain zip archives | The upload is written to a temporary file with the right extension, parsed from there, and the temporary file is removed (found in Phase 3 testing with a real Word file) |
| Audio uploads failed. The Hugging Face call sent raw bytes, which the service rejects, and the service now needs paid credits | Transcription moved to Groq's free Whisper model, using the same key as everything else. The Hugging Face library and `HF_API_KEY` were removed (found in Phase 2) |
| A small PDF could fail to upload with "bad XRef entry", depending on where the file landed in memory | The file is copied into its own memory block before parsing (found in Phase 2) |

### Still open

**Security**

1. **A Hugging Face token is hardcoded** in `backend/tmp_tts_lookup.js`, `tmp_tts_lookup2.js` and `tmp_tts_test.js` on the public `main` branch. The files are deleted on the `studyscribe-2.0` branch, but they stay readable in the Git history.
2. **The first commit in the Git history contains `backend/.env`** with a Groq key and a Hugging Face key. A later commit removed the file, but old commits remain readable on a public repository. Both keys must be treated as leaked and replaced by their owner.
3. **Login gives no real protection.** The password is stored as plain text in the browser, each browser has its own "account", and anyone can skip the screen by setting `loggedIn` in `localStorage`. Real accounts need a database, so this is planned with Phase 5.
4. **The backend has no authentication and no rate limit**, so anyone with the URL can use up the Groq quota. `ALLOWED_ORIGINS` stops other websites, not direct requests.

**Limitations**

1. **Long documents are only partly analysed.** The topic map reads up to about 32,000 characters and reports its coverage. The summary, notes and quiz use a 6,000-character sample. Phase 3 retrieval lets the tutor use the whole file.
2. **Nothing is saved permanently.** No users, no quiz history, and documents live only in server memory. (Phase 5)
3. **The knowledge map has had one real-model check.** A two-page test lecture gave 5 topics and 18 concepts with correct page labels. Quality on long or messy documents has not been measured.
4. **Four to nine AI calls run one after another** on each upload. Test uploads took 33 to 71 seconds, which is slow and can hit free-tier time limits on Render. The model's hidden reasoning counts towards the reply limit, so the knowledge map call uses a higher limit (6,000 tokens) than the others (3,000).
5. **Audio files pile up** in `backend/uploads` and are never deleted. On Render's free tier they also disappear on restart.
6. **Images and scanned PDFs are not supported.** OCR is possible with the `tesseract.js` library that `officeparser` already brings in, but it downloads language data at run time and uses a lot of memory, which is risky on a free hosting plan. It was left out and uploads of images get a clear message.
7. **The tutor searches by words, not meaning.** A question worded very differently from the material may not find the right passage. Its answers were checked by hand on one five-page test document, not measured on a question set.
8. **Groq's free limit is 8,000 tokens per minute per model.** One upload uses most of that, so several uploads in a row can hit the rate limit.
9. **A mistake's cause is a guess from limited evidence.** Most single mistakes come back as "knowledge gap", the model's default. The analysis was checked by hand on one test quiz, not measured against real students. At most 8 mistakes are analysed per quiz.
10. **Adaptation only uses the current quiz**, because results are not stored yet. (Phase 5)
11. **The upload box says "Drag and drop"** but only the Browse button works.

## 8. What can be reused for StudyScribe 2.0

| Existing piece | Reused for |
| --- | --- |
| `search()` and the document store | Phases 4 to 7. Finding the passage for a weak concept, to re-explain it or write a question on it |
| Concept tags on questions, `weakConcepts()` | Phases 5 to 7. Mastery and revision are tracked per concept |
| `askGroq()` and `safeParse()` | Every later phase. All AI features go through this one helper |
| Groq integration (`askGroq()`) | Tutor, question generation, mistake analysis. It has a free tier |
| Tab layout | Add Tutor, Progress and Revision as new tabs |
| `gtts` audio | Keep as is |
