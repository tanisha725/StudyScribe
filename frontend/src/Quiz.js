import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { API_URL } from "./config";

const QUIZ_SECONDS = 600;

const CAUSE_LABELS = {
  conceptual: "Concept misunderstanding",
  knowledge_gap: "Knowledge gap",
  misinterpretation: "Misread the question",
  careless: "Careless slip",
};

const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;

export default function Quiz({ docId, initialQuestions, originalText, conceptNames }) {
  const [fullQuiz, setFullQuiz] = useState(initialQuestions);
  const [practice, setPractice] = useState(null);   // a practice round on weak concepts, or null
  const [answers, setAnswers] = useState({});
  const [showScore, setShowScore] = useState(false);
  const [timeLeft, setTimeLeft] = useState(QUIZ_SECONDS);
  const [started, setStarted] = useState(false);
  const [lastScore, setLastScore] = useState(null);

  const [analysis, setAnalysis] = useState({});     // question index -> why the answer was wrong
  const [weakConcepts, setWeakConcepts] = useState([]);
  const [busy, setBusy] = useState(null);           // "analysis", "practice" or "more" while waiting for the server
  const [message, setMessage] = useState(null);

  const questions = practice || fullQuiz;
  const isCorrect = (i) => answers[i] === questions[i].answer;
  const score = questions.filter((_, i) => isCorrect(i)).length;

  // Answered questions in the form the server expects
  const answered = () =>
    questions.flatMap((q, index) =>
      answers[index] === undefined
        ? []
        : [{ index, q: q.q, options: q.options, answer: q.answer, chosen: answers[index], concept: q.concept, difficulty: q.difficulty }]
    );

  const startFresh = () => {
    setAnswers({});
    setShowScore(false);
    setTimeLeft(QUIZ_SECONDS);
    setStarted(false);
    setAnalysis({});
    setWeakConcepts([]);
    setMessage(null);
  };

  const submit = async () => {
    if (showScore) return;
    setShowScore(true);
    setLastScore({ correct: score, total: questions.length });

    const given = answered();
    if (!docId || !given.some((item) => item.chosen !== item.answer)) return;

    setBusy("analysis");
    try {
      const res = await axios.post(`${API_URL}/analyze-mistakes`, { docId, answers: given });
      setAnalysis(Object.fromEntries(res.data.analysis.map((item) => [item.index, item])));
      setWeakConcepts(res.data.weakConcepts || []);
    } catch (err) {
      setMessage(err.response?.data?.error || "Your mistakes could not be analysed. The correct answers are still shown.");
    }
    setBusy(null);
  };

  // The timer needs the latest submit(), which changes on every render
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    if (!started || showScore) return;
    if (timeLeft <= 0) {
      submitRef.current();
      return;
    }
    const timer = setTimeout(() => setTimeLeft((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [started, showScore, timeLeft]);

  const practiseWeakConcepts = async () => {
    setBusy("practice");
    setMessage(null);
    try {
      const res = await axios.post(`${API_URL}/practice`, { docId, answers: answered() });
      setPractice(res.data.questions);
      startFresh();
    } catch (err) {
      setMessage(err.response?.data?.error || "Practice questions could not be loaded.");
    }
    setBusy(null);
  };

  const loadMoreQuestions = async () => {
    setBusy("more");
    setMessage(null);
    try {
      const res = await axios.post(`${API_URL}/generate-more-questions`, {
        text: originalText || "Generate more quiz questions based on the study material",
        score: lastScore,
        concepts: conceptNames,
      });
      const newQuestions = Array.isArray(res.data?.questions) ? res.data.questions : [];
      setFullQuiz((prev) => [...prev, ...newQuestions]);
      if (showScore) startFresh();
    } catch (err) {
      setMessage(err.response?.data?.error || "Failed to load more questions");
    }
    setBusy(null);
  };

  const backToFullQuiz = () => {
    setPractice(null);
    startFresh();
  };

  if (questions.length === 0) return <p>No quiz questions are available for this file.</p>;

  const byDifficulty = ["easy", "medium", "hard"]
    .map((level) => {
      const indexes = questions.map((q, i) => i).filter((i) => questions[i].difficulty === level);
      return { level, total: indexes.length, correct: indexes.filter(isCorrect).length };
    })
    .filter((row) => row.total > 0);

  return (
    <>
      {practice && (
        <div className="practice-banner">
          <span>Practice round on your weak concepts: <strong>{[...new Set(practice.map((q) => q.concept))].join(", ")}</strong></span>
          <button className="app-button secondary-button" onClick={backToFullQuiz}>Back to full quiz</button>
        </div>
      )}

      {started && !showScore && <div className="timer">Time Left: {formatTime(timeLeft)}</div>}

      {questions.map((q, i) => {
        const wasAnswered = answers[i] !== undefined;
        const review = analysis[i];

        return (
          <div key={i} className="quiz-card">
            <p>{i + 1}. {q.q}</p>
            <div className="question-tags">
              {q.difficulty && <span className={`difficulty ${q.difficulty}`}>{q.difficulty}</span>}
              {q.concept && <span>{q.concept}</span>}
            </div>

            {q.options.map((opt, idx) => {
              let className = "option";
              if (answers[i] === opt) className += " selected";
              if (showScore) {
                if (q.answer === opt) className += " correct";
                else if (answers[i] === opt) className += " wrong";
              }

              return (
                <div
                  key={idx}
                  className={className}
                  onClick={() => {
                    if (showScore) return;
                    setAnswers({ ...answers, [i]: opt });
                    setStarted(true);
                  }}
                >
                  {opt}
                </div>
              );
            })}

            {showScore && !isCorrect(i) && (
              <div className="mistake-review">
                <p className="correct-text">✔ Correct: {q.answer}{!wasAnswered && " (not answered)"}</p>
                {(review?.explanation || q.explanation) && <p>{review?.explanation || q.explanation}</p>}
                {wasAnswered && review && (
                  <p className="mistake-cause">
                    <b>Possible cause:</b>{" "}
                    {CAUSE_LABELS[review.category]
                      ? `${CAUSE_LABELS[review.category]}${review.evidence ? ` - ${review.evidence}` : ""}`
                      : "one wrong answer is not enough to tell why."}
                    {review.source && <span className="source-tag"> {review.source}</span>}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {message && <div className="error-banner">{message}</div>}

      {!showScore && (
        <div className="quiz-actions">
          {!started && (
            <button className="app-button primary-button" onClick={() => setStarted(true)}>Start Quiz</button>
          )}
          <button className="app-button secondary-button" onClick={submit}>Submit Quiz</button>
          {!practice && (
            <button className="app-button accent-button load-more-btn" onClick={loadMoreQuestions} disabled={busy === "more"}>
              {busy === "more" ? "Loading..." : "Load More Questions"}
            </button>
          )}
        </div>
      )}

      {showScore && (
        <>
          <h3>Score: {score} / {questions.length}</h3>
          <p className="score-breakdown">
            {byDifficulty.map((row) => `${row.level}: ${row.correct}/${row.total}`).join("  ·  ")}
          </p>

          {busy === "analysis" && <p className="chat-thinking">Looking at your mistakes...</p>}

          {weakConcepts.length > 0 && (
            <p className="weak-concepts">
              <b>Concepts to work on:</b> {weakConcepts.map((concept) => concept.name).join(", ")}
            </p>
          )}

          <div className="quiz-actions">
            <button className="app-button primary-button" onClick={startFresh}>Retake Quiz</button>
            {weakConcepts.length > 0 && (
              <button className="app-button accent-button" onClick={practiseWeakConcepts} disabled={busy === "practice"}>
                {busy === "practice" ? "Writing questions..." : "Practice weak concepts"}
              </button>
            )}
            {!practice && (
              <button className="app-button secondary-button" onClick={loadMoreQuestions} disabled={busy === "more"}>
                {busy === "more" ? "Loading..." : "More questions at my level"}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
