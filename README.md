# StudyScribe

StudyScribe turns study material into a study set. You upload a lecture file and it gives back a summary (with audio), short notes, a map of topics and concepts, a tutor you can question about the file, flashcards and a multiple-choice quiz.

This repository is being extended into **StudyScribe 2.0**, an adaptive learning assistant. The roadmap is at the end of this file. For a deeper explanation of how the code works, see [UNDERSTANDING.md](UNDERSTANDING.md).

## What works today

| Feature | How it works |
| --- | --- |
| Upload | PDF, PPTX, DOCX, TXT, and audio (MP3, WAV, M4A, OGG) |
| Summary | Written by an LLM on Groq, 300+ words |
| Audio summary | The summary is read aloud using Google text-to-speech (`gtts`) |
| Notes | About 15 short bullet notes |
| Topics | Topics, subtopics and key concepts, each with a definition, an example when the material gives one, and the page or slide it came from. Also shows how concepts relate |
| Tutor | A chat that answers questions using only the uploaded file, in simple or detailed language, and shows the page or slide each answer came from. It says so when the file does not cover a question |
| Flashcards | Question on the front, answer on the back, click to flip |
| Quiz | Multiple-choice questions at three difficulty levels, each tagged with the concept it tests. 10-minute timer, score by difficulty, retake |
| Mistake analysis | After submitting, each wrong answer gets an explanation and a cautious "possible cause", and the weak concepts are listed |
| Adaptive practice | "Practice weak concepts" writes new questions on the concepts you missed. "More questions" get harder or easier depending on your last score |
| Sign in | A simple sign-up and login screen (browser-only, see limitations) |

## Tech stack

- **Frontend:** React 19 (Create React App), axios, plain CSS
- **Backend:** Node.js, Express 5, multer (file upload)
- **AI:** Groq for text generation (`openai/gpt-oss-120b`), the tutor and mistake analysis (`openai/gpt-oss-20b`) and audio transcription (`whisper-large-v3-turbo`), `gtts` for text-to-speech
- **Retrieval:** BM25 keyword search written in plain JavaScript, with no vector database or embedding service
- **File parsing:** `pdf-parse` (PDF), `officeparser` (PowerPoint and Word)
- **Database:** none yet. Uploaded documents are kept in server memory

## Project structure

```
StudyScribe/
├── backend/
│   ├── index.js          Server setup and API routes
│   ├── lib/
│   │   ├── extract.js    Reads files into sections with page / slide labels
│   │   ├── understand.js Splits text and builds the topic and concept map
│   │   ├── retrieve.js   Finds the parts of a document most relevant to a question
│   │   ├── tutor.js      Answers a question from those parts and checks the sources
│   │   ├── store.js      Keeps uploaded documents in server memory
│   │   ├── quiz.js       Checks and repairs AI-written questions and flashcards
│   │   ├── assess.js     Adaptive difficulty, mistake analysis, practice questions
│   │   ├── ai.js         The one function that calls the LLM, and JSON parsing
│   │   └── errors.js     Error type for messages shown to the student
│   ├── test/             Backend tests
│   ├── .env.example      Template for the keys you need
│   └── package.json
├── frontend/
│   ├── src/App.js        Main screen: upload, tabs, topics, tutor, flashcards
│   ├── src/Quiz.js       Quiz, mistake review and practice rounds
│   ├── src/Auth.js       Sign-up and login screen
│   ├── src/App.css       All styling
│   └── package.json
├── README.md
└── UNDERSTANDING.md
```

## Setup

You need Node.js 18 or newer and a free [Groq API key](https://console.groq.com/keys). That one key covers every AI feature.

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env      # then open .env and paste your keys
npm start
```

You should see `Server running on port 5000`. Opening http://localhost:5000 shows `Backend working ✅`.

On macOS, port 5000 is often used by AirPlay Receiver. If the server fails to start, set `PORT=5001` in `backend/.env`.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env      # points the app at your local backend
npm start
```

The app opens at http://localhost:3000.

`frontend/.env` holds one setting, `REACT_APP_API_URL`, which is the address of the backend. If you changed the backend port, change it here too. If the file is missing, the app uses the deployed backend at `https://studyscribe.onrender.com`.

### 3. Tests

```bash
cd backend && npm test      # 36 tests, no API key needed
cd frontend && npm test     # 8 tests
```

## Environment variables

The `.env` files are ignored by Git and must never be committed. When deploying, set the same variables in the hosting dashboard (Render for the backend, Vercel for the frontend).

**Backend (`backend/.env`)**

| Variable | Required | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes | Used for all AI features, including transcribing audio. The server refuses to start without it |
| `PORT` | No | Backend port, defaults to 5000 |
| `ALLOWED_ORIGINS` | No | Comma-separated frontend URLs allowed to call the backend. Empty means any site |
| `GROQ_MODEL` | No | Groq model name, defaults to `openai/gpt-oss-120b` |
| `GROQ_FAST_MODEL` | No | Groq model for the tutor, mistake analysis and practice questions, defaults to `openai/gpt-oss-20b` |
| `MAX_ANALYSIS_CALLS` | No | Most AI calls used to build the topic map for one file, defaults to 4 (about 12 pages) |

**Frontend (`frontend/.env`)**

| Variable | Required | Purpose |
| --- | --- | --- |
| `REACT_APP_API_URL` | No | Backend address. Defaults to `https://studyscribe.onrender.com` |

## API routes

| Method | Route | Input | Output |
| --- | --- | --- | --- |
| GET | `/` | none | Text confirming the server is running |
| POST | `/upload` | Form data with one file in the `file` field (max 25 MB) | `docId`, `summary`, `notes`, `knowledge`, `flashcards`, `quiz`, `audio`, `audioError`, `warnings`, `originalText` |
| POST | `/ask` | JSON `{ "docId", "question", "history", "level" }`. `level` is `simple` or `detailed` | `{ "answer", "found", "sources": [{ "source", "excerpt" }] }` |
| POST | `/generate-more-questions` | JSON `{ "text", "score": { "correct", "total" }, "concepts" }`. Only `text` is required | `{ "questions", "difficulty" }` |
| POST | `/analyze-mistakes` | JSON `{ "docId", "answers" }`, where each answer has `index`, `q`, `options`, `answer`, `chosen`, `concept`, `difficulty` | `{ "analysis": [{ "index", "explanation", "category", "evidence", "source" }], "weakConcepts" }` |
| POST | `/practice` | Same input as `/analyze-mistakes` | `{ "questions", "concepts" }` |
| GET | `/uploads/<file>.mp3` | none | A generated audio file |

When something goes wrong, every route returns `{ "error": "a message the student can read" }` with a matching status code (400 bad request, 404 document no longer on the server, 413 file too large, 415 unsupported type, 422 unreadable file, 429 AI rate limit).

## Known limitations

These describe the code as it is now. Each is covered in more detail in [UNDERSTANDING.md](UNDERSTANDING.md).

- Long documents are only partly analysed. The topic map reads up to about 32,000 characters (roughly 12 pages), spread evenly across the file, and shows what percentage it covered. The summary, notes and quiz use a 6,000-character sample spread across the file.
- The topic map has been checked by hand on one short test lecture with the real AI model. Its quality on long or messy documents has not been measured.
- An upload takes roughly 40 to 70 seconds, because the AI calls run one after another.
- Login is stored in the browser only. The backend has no accounts and does not check who is calling it.
- Nothing is saved permanently. Refreshing the page loses the study set and the quiz score, and restarting the server loses the documents the tutor uses (the tutor then asks for a re-upload). The server keeps the 50 most recent documents.
- The tutor finds text by matching words, not meaning. A question that uses different words from the material (for example "memory juggling" for "thrashing") may not find the right passage.
- Groq's free plan allows 8,000 tokens per minute per model. One upload uses most of that, so uploading several files in a row can hit "rate limit reached".
- Quiz results are not remembered between sessions, so adaptation only uses the current quiz. (Phase 5)
- A mistake's "possible cause" is a guess from limited evidence. One wrong multiple-choice answer rarely shows why it was wrong, so most single mistakes are labelled "knowledge gap" or left without a cause. At most 8 mistakes are analysed per quiz.
- Old `.ppt` and `.doc` files, images and scanned PDFs are not supported. Word files have no page numbers, so their concepts point to a heading instead.
- Automated tests do not call the real AI services. They cover file reading, text splitting, checking of AI output, and the main screens.

## StudyScribe 2.0 roadmap

The goal is a closed learning loop:

**Study Material → Understand → Learn → Test → Analyze Mistakes → Adapt → Revise → Re-test**

| Phase | Goal | Status |
| --- | --- | --- |
| 1 | Audit and stabilize the existing app | Done, except real login (moved to Phase 5) |
| 2 | Structured understanding of study material (topics, concepts, definitions) | Done, except images and OCR |
| 3 | Grounded AI tutor using retrieval (RAG) over the uploaded material | Done |
| 4 | Adaptive quizzes and mistake analysis | Done |
| 5 | Student knowledge and performance model | Planned |
| 6 | Orchestrator that picks the next best learning action | Planned |
| 7 | Personalized, spaced revision | Planned |
| 8 | Evaluation workflow and final polish | Planned |
