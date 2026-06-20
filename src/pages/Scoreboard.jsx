import React, { useState, useEffect } from "react";
import { C } from "../styles.js";
import { leaderboard, resetScores } from "../lib/store.js";
import { fighterFace } from "../lib/agent.js";
import { subscribe } from "../lib/bus.js";
import { getTournament, standings, progress } from "../lib/tournament.js";
import { isTournamentMode, scoreboardTitle, tournamentStateFromEvent } from "../lib/scoreboardState.js";
import { fetchLiveSnapshot, subscribeLiveSnapshot } from "../lib/liveState.js";

const MEDALS = ["🥇", "🥈", "🥉"];

// Турнирная таблица — отдельное окно для ТВ 16:9. Заполняет весь экран,
// крупные строки и шрифты, читаемые издалека.
export default function Scoreboard() {
  const [tour, setTour] = useState(getTournament());
  const [, force] = useState(0);
  const [live, setLive] = useState(null);

  useEffect(() =>
    subscribe((type, payload) => {
      if (type === "participants") force((n) => n + 1);
      if (type === "tournament") setTour((current) => tournamentStateFromEvent(current, type, payload));
      if (type === "live") setLive(payload);
    }), []);

  useEffect(() => {
    let alive = true;
    fetchLiveSnapshot().then((snapshot) => { if (alive) setLive(snapshot); }).catch(() => {});
    const unsubscribe = subscribeLiveSnapshot((snapshot) => setLive(snapshot));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const inTournament = isTournamentMode(tour);
  const rows = inTournament ? standings() : leaderboard();
  const { played, total } = progress();
  const showLive = live && live.phase !== "select";

  return (
    <div style={S.root}>
      <div style={S.scan} />
      <header style={S.header}>
        <h1 style={S.title}>
          🏆 <span style={{ color: C.yellow }}>{scoreboardTitle(tour)}</span>
        </h1>
        {inTournament && (
          <div style={S.sub}>
            {tour.status === "done" ? "ТУРНИР ЗАВЕРШЁН" : "КРУГОВАЯ СИСТЕМА"} · матчей {played}/{total}
          </div>
        )}
      </header>

      {showLive && <LivePanel live={live} />}

      {rows.length === 0 ? (
        <div style={S.empty}>Участников пока нет.</div>
      ) : (
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.th, width: "8%" }}>#</th>
                <th style={{ ...S.th, textAlign: "center", width: "12%" }}>№ ПОЛЬЗ.</th>
                <th style={S.th}>БОЕЦ</th>
                <th style={{ ...S.th, textAlign: "center", width: "12%" }}>БОИ</th>
                <th style={{ ...S.th, textAlign: "center", width: "20%" }}>В · П · Н</th>
                <th style={{ ...S.th, textAlign: "right", width: "14%" }}>ОЧКИ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const st = inTournament ? p.tourStats : p.stats;
                return (
                  <tr key={p.id} style={{ background: i < 3 ? `rgba(255,210,63,${0.12 - i * 0.03})` : "transparent" }}>
                    <td style={{ ...S.td, ...S.rank, color: i < 3 ? C.yellow : C.muted }}>{MEDALS[i] || i + 1}</td>
                    <td style={{ ...S.td, ...S.userNumber }}>{p.externalId ? `#${p.externalId}` : "—"}</td>
                    <td style={S.td}>
                      <span style={{ fontSize: "2.4vh", marginRight: "1.4vh" }}>{fighterFace(p)}</span>
                      <b style={{ fontSize: "2.8vh" }}>{p.name}</b>
                    </td>
                    <td style={{ ...S.td, textAlign: "center", color: C.muted }}>{st.battles}</td>
                    <td style={{ ...S.td, textAlign: "center" }}>
                      <span style={{ color: C.green }}>{st.wins}</span> · <span style={{ color: C.danger }}>{st.losses}</span> · <span style={{ color: C.muted }}>{st.draws}</span>
                    </td>
                    <td style={{ ...S.td, ...S.points }}>{st.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!inTournament && (
        <div style={{ textAlign: "center", padding: "2vh 0" }}>
          <button style={S.ghost} onClick={async () => { if (confirm("Обнулить очки всех участников?")) { await resetScores(); force((n) => n + 1); } }}>
            ↺ обнулить очки
          </button>
        </div>
      )}
    </div>
  );
}

function LivePanel({ live }) {
  const { a, b, topic, round, status, lastNote, verdict } = live;
  return (
    <div className="glow" style={S.live}>
      <div style={{ color: C.red, fontWeight: 900, letterSpacing: 2, fontSize: "1.6vh", marginBottom: "1vh" }}>● СЕЙЧАС НА РИНГЕ</div>
      <div style={{ color: C.yellow, fontWeight: 900, fontSize: "2.4vh", marginBottom: "1.4vh" }}>{topic}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "3vw" }}>
        <LiveFighter f={a} />
        <div style={{ fontWeight: 900, fontSize: "3vh", color: C.yellow }}>{verdict ? "ФИНАЛ" : `Р${round}`}</div>
        <LiveFighter f={b} right />
      </div>
      {verdict ? (
        <div style={{ marginTop: "1.4vh", fontWeight: 900, fontSize: "2.2vh", color: C.green }}>
          {verdict.winner === "draw" ? "НИЧЬЯ" : `Победа: ${verdict.winner === "A" ? a.name : b.name}  (${verdict.score_a} : ${verdict.score_b})`}
        </div>
      ) : (
        <div style={{ marginTop: "1.2vh", color: "#bbb", fontSize: "1.8vh" }} className="blink">{status}</div>
      )}
      {!verdict && lastNote && <div style={{ marginTop: "0.6vh", color: C.yellow, fontSize: "1.6vh" }}>⚖ {lastNote}</div>}
    </div>
  );
}

function LiveFighter({ f, right }) {
  return (
    <div style={{ minWidth: "22vw", textAlign: right ? "right" : "left" }}>
      <div style={{ fontWeight: 900, color: f.color, fontSize: "2.2vh" }}>
        {f.face} {f.name}
        {f.tier && <span style={{ marginLeft: 8, padding: "1px 8px", borderRadius: 4, fontSize: "1.4vh", fontWeight: 900, color: "#0a0613", background: f.tier.color }}>{f.tier.label}</span>}
      </div>
      <div style={{ height: "2.6vh", background: "#1a0f33", border: `2px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginTop: "0.6vh", direction: right ? "rtl" : "ltr" }}>
        <div style={{ height: "100%", width: `${f.hp}%`, transition: "width 0.6s", background: f.hp > 50 ? C.green : f.hp > 25 ? C.yellow : C.danger }} />
      </div>
      <div style={{ fontSize: "1.5vh", color: f.color, marginTop: "0.4vh" }}>{f.hp} HP</div>
    </div>
  );
}

const S = {
  root: {
    minHeight: "100vh",
    height: "100vh",
    boxSizing: "border-box",
    background: "radial-gradient(ellipse at top, #1d0f3a 0%, #0a0613 72%)",
    color: C.text,
    fontFamily: "'Courier New', monospace",
    padding: "2.5vh 3vw",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  scan: { position: "fixed", inset: 0, background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)", pointerEvents: "none", zIndex: 100 },
  header: { textAlign: "center", marginBottom: "1.5vh" },
  title: { fontSize: "5vh", fontWeight: 900, letterSpacing: 4, margin: 0, fontFamily: "'Arial Black', sans-serif", textShadow: "0 0 22px rgba(217,77,255,0.5)" },
  sub: { color: C.pink || "#ff3ca5", letterSpacing: 3, fontSize: "1.8vh", marginTop: "0.8vh", fontWeight: 700 },
  live: { border: `2px solid ${C.yellow}`, borderRadius: 14, padding: "1.8vh 2vw", marginBottom: "1.6vh", textAlign: "center", background: "rgba(255,60,165,0.06)" },
  tableWrap: { flex: 1, overflow: "hidden", display: "flex" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "2.4vh", alignSelf: "stretch" },
  th: { textAlign: "left", padding: "1.2vh 1.4vw", color: C.muted, fontSize: "1.7vh", letterSpacing: 2, borderBottom: `2px solid ${C.border}` },
  td: { padding: "1.3vh 1.4vw", borderBottom: `1px solid ${C.border}` },
  rank: { fontWeight: 900, fontSize: "3.4vh" },
  userNumber: { textAlign: "center", color: C.muted, fontWeight: 900, whiteSpace: "nowrap" },
  points: { fontWeight: 900, fontSize: "3.4vh", color: C.yellow, textAlign: "right" },
  empty: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: "2.5vh" },
  ghost: { background: "transparent", color: C.text, border: `2px solid ${C.border}`, padding: "1vh 2vw", fontWeight: 700, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: "1.6vh" },
};
