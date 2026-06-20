import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { styles, C } from "../styles.js";
import { getParticipants } from "../lib/store.js";
import { fighterFace, fighterColor } from "../lib/agent.js";
import { subscribe } from "../lib/bus.js";
import {
  getTournament,
  standings,
  beginTournament,
  markMatchesRunning,
  recordMatchResult,
  recordMatchError,
  queuedMatchesToStart,
  visibleTournamentMatches,
  tournamentFightCounts,
  MAX_TOURNAMENT_CONCURRENCY,
} from "../lib/tournament.js";
import { TOPICS } from "../data/topics.js";
import { runDebateFight } from "../lib/fightRunner.js";
import { saveTournamentBattle } from "../lib/battleHistory.js";

const MEDALS = ["🥇", "🥈", "🥉"];
const NO_DELAYS = { intro: 0, afterReply: 0, afterJudge: 0, afterShake: 0 };

export default function Tournament() {
  const [tour, setTour] = useState(getTournament());
  const [people, setPeople] = useState(getParticipants());
  const activeRef = useRef(new Set());

  useEffect(() =>
    subscribe((type) => {
      if (type === "participants") setPeople(getParticipants());
      if (type === "tournament") setTour(getTournament());
    }), []);

  useEffect(() => {
    const refresh = () => {
      setPeople(getParticipants());
      setTour(getTournament());
    };
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);

  const byId = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const topicById = useMemo(() => Object.fromEntries(TOPICS.map((t) => [t.id, t])), []);
  const rows = standings();
  const { played, remaining, total } = tournamentFightCounts(tour.matches);
  const activeCount = tour.matches.filter((m) => m.status === "running").length;
  const errorCount = tour.matches.filter((m) => m.status === "error").length;
  const activeTiebreak = activeTiebreakRound(tour);
  const liveMatches = visibleTournamentMatches(tour.matches);

  useEffect(() => {
    if (tour.status !== "running") return;
    const matches = queuedMatchesToStart(tour.matches, MAX_TOURNAMENT_CONCURRENCY)
      .filter((m) => !activeRef.current.has(m.id));
    if (!matches.length) return;

    let cancelled = false;
    matches.forEach((m) => activeRef.current.add(m.id));
    markMatchesRunning(matches.map((m) => m.id))
      .then((marked) => {
        if (cancelled) return;
        setTour(marked);
        matches.forEach((m) => runTournamentMatch(m, byId, topicById, activeRef, setTour));
      })
      .catch((e) => {
        matches.forEach((m) => activeRef.current.delete(m.id));
        console.warn("Не удалось отметить турнирные матчи running:", e.message);
      });
    return () => { cancelled = true; };
  }, [tour.status, tour.matches, byId, topicById]);

  async function startQueue() {
    const next = await beginTournament();
    setTour(next);
  }

  if (tour.status === "idle") {
    return (
      <div className="fade-in" style={{ maxWidth: 860, margin: "0 auto" }}>
        <p style={styles.sectionLabel}>🏆 ТУРНИР</p>
        <div style={{ ...styles.panel, textAlign: "center" }}>
          <div style={{ fontWeight: 900, color: C.yellow, fontSize: 22, marginBottom: 10 }}>Турнир ещё не сформирован</div>
          <p style={{ color: "#d7cdec", lineHeight: 1.5 }}>
            Проведи разминку, затем сформируй топ-10 на вкладке участников.
          </p>
          <Link to="/register" style={{ ...styles.btn, display: "inline-block", textDecoration: "none", marginTop: 10 }}>К УЧАСТНИКАМ</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ maxWidth: 1320, margin: "0 auto" }}>
      <p style={styles.sectionLabel}>🏆 ТУРНИР · {activeTiebreak ? `ДОП. КРУГ ${activeTiebreak}` : "ВСЕ СО ВСЕМИ"}</p>

      {tour.status === "done" && (
        <div style={T.done}>ТУРНИР ЗАВЕРШЁН</div>
      )}
      {activeTiebreak && (
        <div style={T.tiebreakBanner}>ТАЙ-БРЕЙК · ДОПОЛНИТЕЛЬНЫЙ КРУГ {activeTiebreak}</div>
      )}

      <div style={T.topBand}>
        <div style={{ ...styles.panel, flex: "1 1 520px" }}>
          <div style={T.tableHeader}>
            <span>ЛИДЕРБОРД ТУРНИРА</span>
            <span style={{ color: C.muted, fontSize: 12 }}>обновление раз в 5 секунд</span>
          </div>
          <TournamentTable rows={rows} />
        </div>

        <div style={{ ...styles.panel, flex: "0 0 300px", borderColor: C.yellow }}>
          <div style={T.metricLabel}>ПРОГРЕСС</div>
          <div style={T.metricValue}>{played}/{total}</div>
          <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.5 }}>
            Активно: <b style={{ color: C.green }}>{activeCount}</b> / {MAX_TOURNAMENT_CONCURRENCY}
            {errorCount > 0 && <><br />Ошибок: <b style={{ color: C.danger }}>{errorCount}</b></>}
          </div>
          {tour.status === "ready" && (
            <button type="button" style={{ ...styles.btn, width: "100%", padding: "12px 16px", marginTop: 16, fontSize: 15 }} onClick={startQueue}>
              ▶ ЗАПУСТИТЬ БОИ
            </button>
          )}
          {tour.status === "running" && (
            <div style={{ color: C.green, fontWeight: 900, marginTop: 16 }}>
              {activeTiebreak ? `ИДЁТ ДОП. КРУГ ${activeTiebreak}` : "ОЧЕРЕДЬ ЗАПУЩЕНА"}
            </div>
          )}
        </div>
      </div>

      <div style={T.liveHeader}>
        <span>БОИ В ПРОЦЕССЕ</span>
        <span style={{ color: C.muted, fontSize: 12 }}>архив завершённых боёв — во вкладке истории</span>
      </div>
      <div style={T.liveStats}>
        <span>Проведено: <b style={{ color: C.green }}>{played}</b></span>
        <span>Осталось: <b style={{ color: C.yellow }}>{remaining}</b></span>
        <span>Всего: <b style={{ color: C.text }}>{total}</b></span>
      </div>
      {liveMatches.length === 0 ? (
        <div style={T.emptyLive}>
          {tour.status === "ready" ? "Бои ещё не запущены." : tour.status === "done" ? "Активных боёв нет." : "Готовим следующую пачку боёв..."}
        </div>
      ) : (
        <div style={T.grid}>
          {liveMatches.map((m) => (
            <MatchCard key={m.id} match={m} byId={byId} topic={topicById[m.topicId] || TOPICS[0]} />
          ))}
        </div>
      )}
    </div>
  );
}

async function runTournamentMatch(match, byId, topicById, activeRef, setTour) {
  const A = byId[match.a];
  const B = byId[match.b];
  const topic = topicById[match.topicId] || TOPICS[0];
  try {
    if (!A || !B) throw new Error("Боец матча не найден");
    const result = await runDebateFight({
      aF: A,
      bF: B,
      topic,
      swap: false,
      delays: NO_DELAYS,
      waitFor: async () => {},
      onEvent: () => {},
    });
    let battleId = null;
    try {
      const saved = await saveTournamentBattle({ A, B, topic, result, match });
      battleId = saved?.battleId ?? null;
    } catch (e) {
      console.warn("Не удалось сохранить историю турнирного боя:", e.message);
    }
    const next = await recordMatchResult({ matchId: match.id, winner: result.winner, scoreA: result.scoreA, scoreB: result.scoreB, battleId });
    setTour(next);
  } catch (e) {
    const next = await recordMatchError({ matchId: match.id, error: e.message });
    setTour(next);
  } finally {
    activeRef.current.delete(match.id);
  }
}

function TournamentTable({ rows }) {
  if (!rows.length) return <div style={styles.empty}>Ростер пуст.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {rows.map((p, i) => (
        <div key={p.id} style={{ ...T.row, background: i === 0 ? "rgba(255,60,165,0.10)" : i < 3 ? "rgba(255,210,63,0.06)" : "transparent" }}>
          <span style={{ width: 38, fontWeight: 900, color: i < 3 ? C.yellow : C.muted }}>{MEDALS[i] || i + 1}</span>
          <span style={{ fontSize: 22 }}>{fighterFace(p)}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 900 }}>{p.name}</span>
          <span style={{ color: C.muted, fontSize: 12 }}>{p.tourStats.wins}–{p.tourStats.losses}–{p.tourStats.draws}</span>
          <span style={{ color: C.yellow, fontWeight: 900, minWidth: 46, textAlign: "right" }}>{p.tourStats.points}</span>
        </div>
      ))}
    </div>
  );
}

function MatchCard({ match, byId, topic }) {
  const A = byId[match.a];
  const B = byId[match.b];
  const colorA = fighterColor(A, C.red);
  const colorB = fighterColor(B, C.blue);
  const status = statusView(match.status);
  return (
    <div style={{ ...styles.panel, ...T.card, borderColor: status.color }}>
      <div style={T.cardTop}>
        <span style={{ color: C.yellow, fontWeight: 900 }}>#{match.index}</span>
        <span style={{ ...T.status, color: status.color }}>{status.label}</span>
      </div>
      {match.stage === "tiebreak" && (
        <div style={T.tiebreakBadge}>ДОП. КРУГ {match.tiebreakRound}</div>
      )}
      <div style={T.topic}>{topic.title}</div>
      <div style={T.fighters}>
        <FighterLine fighter={A} color={colorA} />
        <div style={{ color: C.yellow, fontWeight: 900 }}>VS</div>
        <FighterLine fighter={B} color={colorB} right />
      </div>
      {match.status === "done" && (
        <div style={T.result}>
          {match.winner === "draw" ? "НИЧЬЯ" : `Победа: ${match.winner === "A" ? A?.name : B?.name}`}
          <span style={{ color: C.muted }}> · {match.scoreA}:{match.scoreB}</span>
          {match.battleId && (
            <Link to={`/battles/${match.battleId}`} style={T.historyLink}>ХОД БОЯ</Link>
          )}
        </div>
      )}
      {match.status === "error" && <div style={{ ...T.result, color: C.danger }}>{match.error}</div>}
    </div>
  );
}

function FighterLine({ fighter, color, right = false }) {
  if (!fighter) return <div style={{ color: C.muted }}>—</div>;
  return (
    <div style={{ ...T.fighter, textAlign: right ? "right" : "left" }}>
      <span style={{ fontSize: 20 }}>{fighterFace(fighter)}</span>
      <span style={{ color }}>{fighter.name}</span>
    </div>
  );
}

function statusView(status) {
  if (status === "running") return { label: "ИДЁТ", color: C.green };
  if (status === "done") return { label: "ГОТОВО", color: C.yellow };
  if (status === "error") return { label: "ОШИБКА", color: C.danger };
  return { label: "ОЖИДАЕТ", color: C.muted };
}

function activeTiebreakRound(tour) {
  const rounds = (tour.matches || [])
    .filter((m) => m.stage === "tiebreak" && m.status !== "done" && m.status !== "error")
    .map((m) => m.tiebreakRound || 0)
    .filter(Boolean);
  return rounds.length ? Math.max(...rounds) : 0;
}

const T = {
  done: {
    ...styles.verdictPanel,
    position: "static",
    maxWidth: 760,
    margin: "0 auto 18px",
    color: C.yellow,
    fontWeight: 900,
    fontSize: 28,
    letterSpacing: 3,
  },
  tiebreakBanner: {
    ...styles.panel,
    maxWidth: 760,
    margin: "0 auto 18px",
    borderColor: C.yellow,
    color: C.yellow,
    textAlign: "center",
    fontWeight: 900,
    letterSpacing: 2,
  },
  topBand: { display: "flex", gap: 16, alignItems: "stretch", marginBottom: 18, flexWrap: "wrap" },
  liveHeader: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", color: C.yellow, fontWeight: 900, letterSpacing: 1, margin: "2px 0 10px", flexWrap: "wrap" },
  liveStats: { display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", color: C.muted, fontSize: 13, fontWeight: 900, margin: "0 0 12px" },
  emptyLive: { ...styles.panel, color: C.muted, textAlign: "center", fontWeight: 900 },
  tableHeader: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", color: C.yellow, fontWeight: 900, letterSpacing: 1, marginBottom: 10 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: 6 },
  metricLabel: { color: C.muted, fontSize: 12, letterSpacing: 2, fontWeight: 900 },
  metricValue: { color: C.yellow, fontSize: 46, fontWeight: 900, fontFamily: "'Arial Black', sans-serif", margin: "8px 0" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: 12 },
  card: { minHeight: 160, padding: 14 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  status: { fontWeight: 900, fontSize: 12, letterSpacing: 1 },
  tiebreakBadge: { display: "inline-block", marginBottom: 8, border: `1px solid ${C.yellow}`, borderRadius: 4, padding: "2px 8px", color: C.yellow, fontSize: 11, fontWeight: 900, letterSpacing: 1 },
  topic: { color: C.yellow, fontWeight: 900, lineHeight: 1.35, minHeight: 38, marginBottom: 12 },
  fighters: { display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center" },
  fighter: { display: "flex", gap: 6, alignItems: "center", minWidth: 0, fontWeight: 900, fontSize: 13 },
  result: { marginTop: 12, color: C.green, fontWeight: 900, fontSize: 13, lineHeight: 1.35 },
  historyLink: { display: "inline-block", marginLeft: 10, color: C.yellow, textDecoration: "none", borderBottom: `1px solid ${C.yellow}` },
};
