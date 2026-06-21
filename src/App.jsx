import React, { useEffect, useState } from "react";
import { Navigate, Routes, Route, NavLink, useLocation } from "react-router-dom";
import { styles, css, C } from "./styles.js";
import Arena from "./pages/Arena.jsx";
import Register from "./pages/Register.jsx";
import Tournament from "./pages/Tournament.jsx";
import Scoreboard from "./pages/Scoreboard.jsx";
import Guide from "./pages/Guide.jsx";
import Battles from "./pages/Battles.jsx";
import BattleDetail from "./pages/BattleDetail.jsx";
import { subscribe } from "./lib/bus.js";
import { getTournament } from "./lib/tournament.js";
import { isActivityFinished, isNavAvailable, isWarmupOpen } from "./lib/activityState.js";

export default function App() {
  const location = useLocation();
  const [tour, setTour] = useState(getTournament());
  // На табло прячем общий хедер/навигацию — это отдельный «киоск»-экран.
  const isBoard = location.pathname.startsWith("/scoreboard");
  const warmupOpen = isWarmupOpen(tour);
  const finished = isActivityFinished(tour);

  useEffect(() =>
    subscribe((type) => {
      if (type === "tournament") setTour(getTournament());
    }), []);

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
            <Nav to="/" label="🥊 АРЕНА" disabled={!isNavAvailable("arena", tour)} />
            <Nav to="/register" label="📝 УЧАСТНИКИ" />
            <Nav to="/tournament" label="🏆 ТУРНИР" disabled={!isNavAvailable("tournament", tour)} />
            <Nav to="/battles" label="📜 ИСТОРИЯ" />
            <Nav to="/guide" label="📖 ИНСТРУКЦИЯ" disabled={!isNavAvailable("guide", tour)} />
            <BoardLink />
          </nav>
        </>
      )}

      <Routes>
        <Route path="/" element={warmupOpen ? <Arena /> : <ArenaUnavailable finished={finished} />} />
        <Route path="/register" element={<Register />} />
        <Route path="/tournament" element={finished ? <Navigate to="/scoreboard" replace /> : <Tournament />} />
        <Route path="/battles" element={<Battles />} />
        <Route path="/battles/:id" element={<BattleDetail />} />
        <Route path="/guide" element={finished ? <Navigate to="/register" replace /> : <Guide />} />
        <Route path="/scoreboard" element={<Scoreboard />} />
      </Routes>
    </div>
  );
}

function Nav({ to, label, disabled = false }) {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        title="Недоступно на текущем этапе активности"
        style={{ ...styles.navLink, ...styles.navLinkDisabled }}
      >
        {label}
      </span>
    );
  }
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

function ArenaUnavailable({ finished }) {
  return (
    <div className="fade-in" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ ...styles.panel, textAlign: "center", borderColor: finished ? C.green : C.yellow }}>
        <div style={{ color: finished ? C.green : C.yellow, fontWeight: 900, fontSize: 22, marginBottom: 10 }}>
          {finished ? "АКТИВНОСТЬ ЗАВЕРШЕНА" : "РАЗМИНКА ЗАКРЫТА"}
        </div>
        <p style={{ color: "#d7cdec", lineHeight: 1.5, margin: "0 0 16px" }}>
          {finished
            ? "Новые бои больше не проводятся. Доступны настройки агентов, история и итоговая таблица."
            : "Турнир сформирован или уже идёт. Разминочные бои больше не проводятся."}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="#/register" style={{ ...styles.btnGhost, textDecoration: "none" }}>УЧАСТНИКИ</a>
          <a href="#/battles" style={{ ...styles.btnGhost, textDecoration: "none" }}>ИСТОРИЯ</a>
          <a href="#/scoreboard" style={{ ...styles.btnGhost, textDecoration: "none", color: C.yellow, borderColor: C.yellow }}>ТАБЛИЦА</a>
        </div>
      </div>
    </div>
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
