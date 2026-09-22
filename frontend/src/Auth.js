import React, { useState } from "react";

export default function Auth({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = () => {
    if (!email || !password) return alert("Fill all fields");

    if (isLogin) {
      const user = JSON.parse(localStorage.getItem("user"));

      if (user && user.email === email && user.password === password) {
        localStorage.setItem("loggedIn", "true");
        onLogin();
      } else {
        alert("Invalid credentials");
      }
    } else {
      localStorage.setItem(
        "user",
        JSON.stringify({ email, password })
      );
      alert("Signup successful! Please login.");
      setIsLogin(true);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-left">
        <div className="auth-brand auth-brand-dark"><span className="brand-mark">S</span><span>StudyScribe</span></div>
        <div className="auth-form-wrap">
          <span className="eyebrow">Your personal study desk</span>
          <h1>{isLogin ? "Welcome back" : "Start learning smarter"}</h1>
          <p className="auth-intro">{isLogin ? "Pick up where you left off and turn your next file into momentum." : "Create an account and turn dense material into clear, useful study tools."}</p>
          <form onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}>
            <label htmlFor="email">Email address</label>
            <input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit" className="auth-submit">{isLogin ? "Sign In" : "Sign Up"}</button>
          </form>
          <p className="switch" onClick={() => setIsLogin(!isLogin)}>{isLogin ? "Don't have an account? Sign Up" : "Already have an account? Login"}</p>
        </div>
        <p className="auth-footnote">Private by design · Built for focused learning</p>
      </div>

      <div className="auth-right">
        <div className="auth-right-content">
          <span className="eyebrow eyebrow-light">A clearer way to study</span>
          <h2>Make every page<br /><em>count.</em></h2>
          <p>Notes, flashcards, and quizzes made from the material you already have.</p>
          <div className="auth-feature-list"><span><b>01</b> Upload your material</span><span><b>02</b> Get your study set</span><span><b>03</b> Learn at your pace</span></div>
        </div>
        <img src="/signin.png" alt="StudyScribe study workspace" className="auth-img" />
        <div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" />
      </div>
    </div>
  );
}