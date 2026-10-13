import React, { useState } from "react";
import axios from "axios";
import "./App.css";
import Auth from "./Auth";
import Quiz from "./Quiz";
import { API_URL } from "./config";

const MAX_FILE_MB = 25;
const SUPPORTED_TYPES = [".pdf", ".pptx", ".docx", ".txt", ".mp3", ".wav", ".m4a", ".ogg"];

export default function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploadStage, setUploadStage] = useState("idle");
  const [uploadPopupVisible, setUploadPopupVisible] = useState(false);
  const [tab, setTab] = useState("summary");
  const [data, setData] = useState({});

  const [errorMessage, setErrorMessage] = useState(null);
  const [loggedIn, setLoggedIn] = useState(
    localStorage.getItem("loggedIn") === "true"
  );

  const handleUpload = async () => {
    if (!file) return alert("Please select a file");

    const fileName = file.name.toLowerCase();
    if (!SUPPORTED_TYPES.some((type) => fileName.endsWith(type))) {
      return setErrorMessage("Unsupported file type. Use PDF, PPTX, DOCX, TXT, MP3, WAV, M4A or OGG.");
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return setErrorMessage(`File is too large. The limit is ${MAX_FILE_MB} MB.`);
    }

    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", file);

    const stageTimeouts = [];

    try {
      setLoading(true);
      setUploadPopupVisible(true);
      setUploadStage("loading");

      stageTimeouts.push(
        setTimeout(() => setUploadStage("processing"), 800)
      );
      stageTimeouts.push(
        setTimeout(() => setUploadStage("generating"), 1600)
      );

      const res = await axios.post(`${API_URL}/upload`, formData);
      const result = res.data;

      setData(result);
      setErrorMessage(result?.warnings?.join(" ") || null);
      setUploadStage("done");
      setTimeout(() => setUploadPopupVisible(false), 700);
      setLoading(false);
    } catch (err) {
      setLoading(false);
      setUploadPopupVisible(false);
      const apiError = err.response?.data?.error || err.response?.data?.details;
      const networkError = !err.response && "Could not reach the server. Check your connection and try again.";
      setErrorMessage(apiError || networkError || err.message || "Upload failed");
    } finally {
      stageTimeouts.forEach(clearTimeout);
    }
  };

  const uploadStageLabel = {
    idle: "Ready to upload your file",
    loading: "Uploading file...",
    processing: "Processing the content...",
    generating: "Generating your study notes...",
    done: "All set!"
  }[uploadStage];

  if (!loggedIn) {
    return <Auth onLogin={() => setLoggedIn(true)} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark">S</span><span>StudyScribe</span></div>
        <button
          className="app-button secondary-button logout-button"
          onClick={() => {
            localStorage.removeItem("loggedIn");
            setLoggedIn(false);
          }}
        >
          <span className="button-icon">↪</span> Log out
        </button>
      </header>

      <main>
        <section className="home-hero">
          <div><span className="eyebrow">AI study workspace</span><h1 className="title">Learn from your<br /><em>source material.</em></h1><p className="hero-copy">Drop in a lecture, chapter, or recording. StudyScribe turns it into a focused set of notes, flashcards, and questions.</p></div>
          <div className="hero-stamp"><span>⌁</span><strong>01</strong><small>UPLOAD<br />TO LEARN</small></div>
        </section>

      <section className="upload-box">
        <div className="upload-heading"><div><span className="section-kicker">Create a study set</span><h2>What are you working on?</h2></div><span className="secure-note">✦ AI-powered</span></div>
        <div className="upload-dropzone"><div className="upload-icon">↑</div><div><strong>{file ? file.name : "Choose a file to get started"}</strong><span>Drag and drop or browse from your device</span></div><label className="browse-button">Browse<input type="file" accept={SUPPORTED_TYPES.join(",")} onChange={(e) => setFile(e.target.files[0])} /></label></div>
        <div className="input-group">
          <button className="app-button primary-button" onClick={handleUpload} disabled={loading}>
            Generate my study set <span className="button-arrow">→</span>
          </button>
        </div>
        <div className="upload-meta"><span>Supported formats</span><strong>PDF · PPTX · DOCX · TXT · MP3 · WAV · M4A · OGG</strong><span className="size-note">Max 25 MB</span></div>
      </section>

      {errorMessage && <div className="error-banner">{errorMessage}</div>}

      {uploadPopupVisible && (
        <div className="upload-popup-overlay">
          <div className="upload-popup-card">
            <div className={"popup-icon " + (uploadStage === "done" ? "popup-done" : "")}/>
            <h2>{uploadStageLabel}</h2>
            <p className="popup-subtitle">This may take a few seconds depending on file size.</p>
            <div className="popup-progress">
              {[
                { label: "Uploading", stage: "loading" },
                { label: "Processing", stage: "processing" },
                { label: "Generating", stage: "generating" },
              ].map((step) => {
                const activeStages = ["loading", "processing", "generating", "done"];
                const isActive = activeStages.indexOf(uploadStage) >= activeStages.indexOf(step.stage);
                return (
                  <div key={step.stage} className={"popup-step " + (isActive ? "active" : "")}> 
                    <span className="step-dot" />
                    <span>{step.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {loading && !uploadPopupVisible && <p className="loading">Generating...</p>}

      {data && Object.keys(data).length > 0 && (
        <>
          <div className="results-heading"><div><span className="section-kicker">Your study set</span><h2>Ready when you are.</h2></div><span className="result-count">6 learning tools</span></div>
          <div className="tabs">
            {["summary", "notes", "topics", "tutor", "flashcards", "quiz"].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`app-button tab-button ${tab === t ? 'active-tab' : 'secondary-button'}`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="card">
            {/* SUMMARY */}
            {tab === "summary" && (
              <>
                <p>{data?.summary || "No summary available"}</p>

                {data?.audio ? (
                  <audio
                    controls
                    src={`${API_URL}${data.audio}`}
                    style={{ marginTop: "15px", width: "100%" }}
                  />
                ) : (
                  <div
                    style={{
                      marginTop: "15px",
                      padding: "12px",
                      background: "#fee2e2",
                      color: "#991b1b",
                      borderRadius: "8px",
                      border: "1px solid #fca5a5",
                    }}
                  >
                    <strong>Audio unavailable</strong>
                    {data?.audioError && (
                      <div style={{ fontSize: "0.9em", marginTop: "8px" }}>
                        Reason: {data.audioError}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* NOTES */}
            {tab === "notes" && (
              <ul>
                {data?.notes
                  ? typeof data.notes === "string"
                    ? data.notes
                        .split(/\n|\. /)
                        .filter((l) => l.trim())
                        .map((l, i) => <li key={i}>{l}</li>)
                    : data.notes.map((l, i) => <li key={i}>{l}</li>)
                  : <li>No notes available.</li>}
              </ul>
            )}

            {/* TOPICS */}
            {tab === "topics" && <KnowledgeMap knowledge={data?.knowledge} />}

            {/* TUTOR */}
            {/* Kept on the page but hidden on other tabs, so the conversation survives switching tabs.
                The key gives each uploaded document its own fresh conversation. */}
            <div hidden={tab !== "tutor"}><Tutor key={data?.docId} docId={data?.docId} /></div>

            {/* FLASHCARDS */}
            {tab === "flashcards" && (
              <div className="grid">
                {(data?.flashcards || []).map((f, i) => (
                  <FlipCard key={i} q={f.q} a={f.a} />
                ))}
              </div>
            )}

            {/* QUIZ */}
            {/* Hidden rather than removed on other tabs, so answers and the timer are kept */}
            <div hidden={tab !== "quiz"}>
              <Quiz
                key={data?.docId}
                docId={data?.docId}
                initialQuestions={data?.quiz || []}
                originalText={data?.originalText}
                conceptNames={(data?.knowledge?.topics || []).flatMap((topic) => topic.concepts.map((c) => c.name))}
              />
            </div>
          </div>
        </>
      )}
      </main>
    </div>
  );
}

const FOLLOW_UPS = ["Explain that more simply", "Give me an example", "Give me an analogy"];

function Tutor({ docId }) {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [level, setLevel] = useState("simple");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState(null);

  const ask = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || asking) return;

    const history = messages.map(({ role, text }) => ({ role, text }));
    setMessages([...messages, { role: "student", text: trimmed }]);
    setQuestion("");
    setError(null);
    setAsking(true);

    try {
      const res = await axios.post(`${API_URL}/ask`, { docId, question: trimmed, history, level });
      setMessages((prev) => [...prev, { role: "tutor", text: res.data.answer, found: res.data.found, sources: res.data.sources || [] }]);
    } catch (err) {
      setError(err.response?.data?.error || "Could not reach the tutor. Please try again.");
    }
    setAsking(false);
  };

  if (!docId) return <p>The tutor is not available for this study set. Please upload the file again.</p>;

  const lastIsTutor = messages.length > 0 && messages[messages.length - 1].role === "tutor";

  return (
    <div className="tutor">
      <div className="tutor-head">
        <p>Ask anything about your material. Answers come only from the file you uploaded.</p>
        <div className="level-toggle">
          {["simple", "detailed"].map((option) => (
            <button key={option} className={level === option ? "active-level" : ""} onClick={() => setLevel(option)}>
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="chat">
        {messages.map((message, i) => (
          <div key={i} className={`chat-message ${message.role}${message.found === false ? " not-found" : ""}`}>
            <span className="chat-role">{message.role === "tutor" ? "Tutor" : "You"}</span>
            <p>{message.text}</p>
            {message.found === false && <small>This was not found in your material.</small>}
            {message.sources?.map((source) => (
              <details key={source.source} className="chat-source">
                <summary>{source.source}</summary>
                <blockquote>{source.excerpt}…</blockquote>
              </details>
            ))}
          </div>
        ))}
        {asking && <p className="chat-thinking">Tutor is reading your material...</p>}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {lastIsTutor && !asking && (
        <div className="follow-ups">
          {FOLLOW_UPS.map((text) => <button key={text} onClick={() => ask(text)}>{text}</button>)}
        </div>
      )}

      <form className="tutor-form" onSubmit={(event) => { event.preventDefault(); ask(question); }}>
        <input
          type="text"
          value={question}
          maxLength={500}
          placeholder="Ask a question about your material"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="app-button primary-button" disabled={asking || !question.trim()}>Ask</button>
      </form>
    </div>
  );
}

function KnowledgeMap({ knowledge }) {
  if (!knowledge || knowledge.topics.length === 0) {
    return <p>No topics could be extracted from this file.</p>;
  }

  const { topics, relationships, coverage } = knowledge;
  const range = coverage.sections > 1 ? `${coverage.firstSource} to ${coverage.lastSource}` : coverage.firstSource;

  return (
    <div className="knowledge-map">
      <p className="coverage-note">
        {coverage.percent >= 100
          ? `Built from all of your material (${range}).`
          : `Built from about ${coverage.percent}% of your material, sampled evenly from ${range}. Long files are only partly analysed for now.`}
      </p>

      {topics.map((topic) => (
        <section key={topic.name} className="topic-block">
          <h3>{topic.name}</h3>

          {topic.subtopics.length > 0 && (
            <div className="subtopic-list">
              {topic.subtopics.map((subtopic) => <span key={subtopic}>{subtopic}</span>)}
            </div>
          )}

          {topic.concepts.map((concept) => (
            <div key={concept.name} className="concept-item">
              <div className="concept-head">
                <strong>{concept.name}</strong>
                {concept.source && <span className="source-tag">{concept.source}</span>}
              </div>
              <p>{concept.definition}</p>
              {concept.example && <p className="concept-example"><b>Example:</b> {concept.example}</p>}
            </div>
          ))}
        </section>
      ))}

      {relationships.length > 0 && (
        <section className="topic-block">
          <h3>How the concepts connect</h3>
          <ul className="relationship-list">
            {relationships.map((rel) => (
              <li key={`${rel.from}-${rel.to}`}>
                <strong>{rel.from}</strong> <em>{rel.relation}</em> <strong>{rel.to}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FlipCard({ q, a }) {
  const [flip, setFlip] = useState(false);

  return (
    <div className="flashcard" onClick={() => setFlip(!flip)}>
      <div className={flip ? "flip-inner flipped" : "flip-inner"}>
        <div className="front">{q}</div>
        <div className="back">{a}</div>
      </div>
    </div>
  );
}