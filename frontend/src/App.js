import React, { useState, useEffect } from "react";
import axios from "axios";
import "./App.css";
import Auth from "./Auth";

export default function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploadStage, setUploadStage] = useState("idle");
  const [uploadPopupVisible, setUploadPopupVisible] = useState(false);
  const [tab, setTab] = useState("summary");
  const [data, setData] = useState({});

  const [answers, setAnswers] = useState({});
  const [showScore, setShowScore] = useState(false);
  const [quizTimeLeft, setQuizTimeLeft] = useState(600);
  const [quizStarted, setQuizStarted] = useState(false);
  const [loadingMoreQuestions, setLoadingMoreQuestions] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [loggedIn, setLoggedIn] = useState(
    localStorage.getItem("loggedIn") === "true"
  );

  const handleUpload = async () => {
    if (!file) return alert("Please select a file");

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

      const res = await axios.post("https://studyscribe.onrender.com/upload", formData);
      const result = res.data;

      setData(result);
      setErrorMessage(result?.audioError || null);
      setUploadStage("done");
      setTimeout(() => setUploadPopupVisible(false), 700);
      setLoading(false);
    } catch (err) {
      setLoading(false);
      setUploadPopupVisible(false);
      const apiError = err.response?.data?.error || err.response?.data?.details;
      setErrorMessage(apiError || err.message || "Upload failed");
    } finally {
      stageTimeouts.forEach(clearTimeout);
    }
  };

  const handleAnswer = (qIndex, option) => {
    if (!showScore) {
      setAnswers({ ...answers, [qIndex]: option });
    }
  };

  const calculateScore = () => {
    if (!data?.quiz) return 0;
    let score = 0;
    data.quiz.forEach((q, i) => {
      if (answers[i] === q.answer) score++;
    });
    return score;
  };

  useEffect(() => {
    let timer;
    if (quizStarted && quizTimeLeft > 0 && !showScore) {
      timer = setInterval(() => {
        setQuizTimeLeft((prev) => {
          if (prev <= 1) {
            setShowScore(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [quizStarted, quizTimeLeft, showScore]);

  const loadMoreQuestions = async () => {
    if (!data || loadingMoreQuestions) return;

    setLoadingMoreQuestions(true);
    try {
      const response = await axios.post(
        "https://studyscribe.onrender.com/generate-more-questions",
        {
          text:
            data.originalText ||
            "Generate more quiz questions based on the study material",
        }
      );

      const newQuestions = Array.isArray(response.data?.questions)
        ? response.data.questions
        : [];

      setData((prev) => ({
        ...prev,
        quiz: [...(prev.quiz || []), ...newQuestions],
      }));
    } catch (err) {
      alert("Failed to load more questions");
    }
    setLoadingMoreQuestions(false);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
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
        <div className="upload-dropzone"><div className="upload-icon">↑</div><div><strong>{file ? file.name : "Choose a file to get started"}</strong><span>Drag and drop or browse from your device</span></div><label className="browse-button">Browse<input type="file" accept=".pdf,.ppt,.pptx,.txt,.mp3,.wav,.m4a,.ogg" onChange={(e) => setFile(e.target.files[0])} /></label></div>
        <div className="input-group">
          <button className="app-button primary-button" onClick={handleUpload}>
            Generate my study set <span className="button-arrow">→</span>
          </button>
        </div>
        <div className="upload-meta"><span>Supported formats</span><strong>PDF · PPT · PPTX · TXT · MP3 · WAV · M4A · OGG</strong><span className="size-note">Max 25 MB</span></div>
      </section>

      {errorMessage && <div className="error-banner">{errorMessage}</div>}

      <p className="formats">
        Supported: PDF, PPT, PPTX, TXT, MP3, WAV, M4A, OGG
      </p>

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
          <div className="results-heading"><div><span className="section-kicker">Your study set</span><h2>Ready when you are.</h2></div><span className="result-count">4 learning tools</span></div>
          <div className="tabs">
            {["summary", "notes", "flashcards", "quiz"].map((t) => (
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
                    src={`https://studyscribe.onrender.com${data.audio}`}
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

            {/* FLASHCARDS */}
            {tab === "flashcards" && (
              <div className="grid">
                {(data?.flashcards || []).map((f, i) => (
                  <FlipCard key={i} q={f.q} a={f.a} />
                ))}
              </div>
            )}

            {/* QUIZ */}
            {tab === "quiz" && (
              <>
                {quizStarted && !showScore && (
                  <div className="timer">
                    Time Left: {formatTime(quizTimeLeft)}
                  </div>
                )}

                {(data?.quiz || []).map((q, i) => (
                  <div key={i} className="quiz-card">
                    <p>{i + 1}. {q.q}</p>

                    {(q?.options || []).map((opt, idx) => {
                      const isSelected = answers[i] === opt;
                      const isCorrect = q.answer === opt;

                      let className = "option";
                      if (isSelected) className += " selected";

                      if (showScore) {
                        if (isCorrect) className += " correct";
                        else if (isSelected) className += " wrong";
                      }

                      return (
                        <div
                          key={idx}
                          className={className}
                          onClick={() => {
                            handleAnswer(i, opt);
                            if (!quizStarted) setQuizStarted(true);
                          }}
                        >
                          {opt}
                        </div>
                      );
                    })}

                    {showScore && answers[i] !== q.answer && (
                      <p className="correct-text">
                        ✔ Correct: {q.answer}
                      </p>
                    )}
                  </div>
                ))}

                {!showScore && (data?.quiz?.length || 0) > 0 && (
                  <div className="quiz-actions">
                    {!quizStarted && (
                      <button className="app-button primary-button" onClick={() => setQuizStarted(true)}>
                        Start Quiz
                      </button>
                    )}

                    <button className="app-button secondary-button" onClick={() => setShowScore(true)}>
                      Submit Quiz
                    </button>

                    <button className="app-button accent-button load-more-btn" onClick={loadMoreQuestions}>
                      {loadingMoreQuestions ? "Loading..." : "Load More Questions"}
                    </button>
                  </div>
                )}

                {showScore && (
                  <>
                    <h3>
                      Score: {calculateScore()} / {data?.quiz?.length || 0}
                    </h3>

                    <button
                      className="app-button primary-button"
                      onClick={() => {
                        setAnswers({});
                        setShowScore(false);
                        setQuizTimeLeft(600);
                        setQuizStarted(false);
                      }}
                    >
                      Retake Quiz
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
      </main>
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