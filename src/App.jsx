import React from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import { styles, css } from "./styles.js";
import Arena from "./pages/Arena.jsx";
import Register from "./pages/Register.jsx";
import Tournament from "./pages/Tournament.jsx";
import Scoreboard from "./pages/Scoreboard.jsx";
import Guide from "./pages/Guide.jsx";
import Battles from "./pages/Battles.jsx";
import BattleDetail from "./pages/BattleDetail.jsx";

export default function App() {
  const location = useLocation();
  // На табло прячем общий хедер/навигацию — это отдельный «киоск»-экран.
  const isBoard = location.pathname.startsWith("/scoreboard");

  return (
    <div style={styles.root}>
      <style>{css}</style>
      <div style={styles.scanlines} />

      {!isBoard && (
        <>
          <header style={styles.header}>
            <h1 style={styles.title}>
              <span style={{ color: "#d94dff" }}>DEBATE</span>{" "}
              <span style={{ color: "#00d9ff" }}>ARENA</span>
            </h1>
            <p style={styles.subtitle}>◆ ИИ против ИИ ◆ конференц-ринг ◆</p>
          </header>

          <nav style={styles.nav}>
            <Nav to="/" label="🥊 АРЕНА" />
            <Nav to="/register" label="📝 УЧАСТНИКИ" />
            <Nav to="/tournament" label="🏆 ТУРНИР" />
            <Nav to="/battles" label="📜 ИСТОРИЯ" />
            <Nav to="/guide" label="📖 ИНСТРУКЦИЯ" />
            <BoardLink />
          </nav>
        </>
      )}

      <Routes>
        <Route path="/" element={<Arena />} />
        <Route path="/register" element={<Register />} />
        <Route path="/tournament" element={<Tournament />} />
        <Route path="/battles" element={<Battles />} />
        <Route path="/battles/:id" element={<BattleDetail />} />
        <Route path="/guide" element={<Guide />} />
        <Route path="/scoreboard" element={<Scoreboard />} />
      </Routes>
    </div>
  );
}

function Nav({ to, label }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      style={({ isActive }) => ({ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) })}
    >
      {label}
    </NavLink>
  );
}

// Табло открываем в отдельном окне — его удобно вытащить на второй монитор/проектор.
function BoardLink() {
  return (
    <a
      href="#/scoreboard"
      target="_blank"
      rel="noreferrer"
      style={styles.navLink}
      onClick={(e) => {
        e.preventDefault();
        window.open(
          "#/scoreboard",
          "debate-scoreboard",
          "width=1280,height=720"
        );
      }}
    >
      🏆 ТАБЛИЦА ↗
    </a>
  );
}
