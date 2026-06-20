import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { styles, C } from "../styles.js";
import { fetchBattles } from "../lib/battleHistory.js";

export default function Battles() {
  const [query, setQuery] = useState("");
  const [onlyTournament, setOnlyTournament] = useState(false);
  const [battles, setBattles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      fetchBattles({ query, limit: 100, tournamentOnly: onlyTournament })
        .then((items) => { if (alive) setBattles(items); })
        .catch((e) => { if (alive) setError(e.message); })
        .finally(() => { if (alive) setLoading(false); });
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, onlyTournament]);

  return (
    <div className="fade-in" style={{ maxWidth: 1120, margin: "0 auto" }}>
      <p style={styles.sectionLabel}>📜 ИСТОРИЯ БОЁВ</p>

      <div style={{ ...styles.panel, marginBottom: 16 }}>
        <label style={styles.label}>ПОИСК ПО ИМЕНИ ИЛИ #НОМЕРУ ПОЛЬЗОВАТЕЛЯ</label>
        <div style={H.filters}>
          <input
            style={{ ...styles.input, flex: "1 1 360px", minWidth: 0 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ник или #номер пользователя"
          />
          <label style={{ ...H.toggle, borderColor: onlyTournament ? C.yellow : C.border, color: onlyTournament ? C.yellow : C.muted }}>
            <input
              type="checkbox"
              checked={onlyTournament}
              onChange={(e) => setOnlyTournament(e.target.checked)}
              style={H.checkbox}
            />
            <span>ТОЛЬКО ТУРНИРНЫЕ</span>
          </label>
        </div>
      </div>

      {error && <div style={{ ...styles.panel, borderColor: C.danger, color: C.danger, fontWeight: 900 }}>{error}</div>}
      {loading && <div style={styles.empty}>Загрузка...</div>}
      {!loading && !error && battles.length === 0 && <div style={styles.empty}>{onlyTournament ? "Турнирные бои не найдены." : "Боёв не найдено."}</div>}

      <div style={H.list}>
        {battles.map((battle) => (
          <Link key={battle.id} to={`/battles/${battle.id}`} style={H.row}>
            <div style={H.top}>
              <span style={{ color: C.yellow, fontWeight: 900 }}>#{battle.id}</span>
              <BattleKind battle={battle} />
              <span style={H.date}>{formatDate(battle.at)}</span>
            </div>
            <div style={H.topic}>{battle.topic || "Без темы"}</div>
            <div style={H.fighters}>
              <span style={{ color: C.red }}>{fighterLabel(battle, "A")}</span>
              <span style={{ color: C.muted }}>vs</span>
              <span style={{ color: C.blue }}>{fighterLabel(battle, "B")}</span>
            </div>
            <div style={H.result}>
              {resultLabel(battle)}
              <span style={{ color: C.muted }}> · {battle.scoreA}:{battle.scoreB}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function BattleKind({ battle }) {
  return (
    <span style={{ ...H.badge, borderColor: battle.tournament ? C.yellow : C.border, color: battle.tournament ? C.yellow : C.muted }}>
      {battle.tournament ? "ТУРНИР" : "РАЗМИНКА"}
    </span>
  );
}

export function formatDate(ts) {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

export function fighterLabel(battle, side) {
  const name = side === "A" ? battle.aName : battle.bName;
  const externalId = side === "A" ? battle.aExternalId : battle.bExternalId;
  return externalId ? `${name} #${externalId}` : name;
}

export function resultLabel(battle) {
  if (battle.winner === "draw") return "Ничья";
  return `Победа: ${battle.winner === "A" ? battle.aName : battle.bName}`;
}

const H = {
  filters: { display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" },
  toggle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    border: "2px solid",
    borderRadius: 8,
    padding: "0 14px",
    minHeight: 46,
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 1,
    cursor: "pointer",
    background: C.card,
    userSelect: "none",
  },
  checkbox: { width: 16, height: 16, accentColor: C.yellow, cursor: "pointer" },
  list: { display: "grid", gap: 10 },
  row: {
    ...styles.panel,
    display: "block",
    color: C.text,
    textDecoration: "none",
    padding: 16,
  },
  top: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 },
  badge: { border: "1px solid", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 900, letterSpacing: 1 },
  date: { marginLeft: "auto", color: C.muted, fontSize: 12 },
  topic: { color: C.yellow, fontWeight: 900, fontSize: 16, marginBottom: 8, lineHeight: 1.35 },
  fighters: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontWeight: 900, fontSize: 14 },
  result: { marginTop: 8, color: C.green, fontWeight: 900, fontSize: 13 },
};
