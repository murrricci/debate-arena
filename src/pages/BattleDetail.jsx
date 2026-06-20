import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { styles, C } from "../styles.js";
import { fetchBattle } from "../lib/battleHistory.js";
import { BattleKind, fighterLabel, formatDate, resultLabel } from "./Battles.jsx";

export default function BattleDetail() {
  const { id } = useParams();
  const [battle, setBattle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetchBattle(id)
      .then((data) => { if (alive) setBattle(data); })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  if (loading) return <div style={styles.empty}>Загрузка...</div>;
  if (error) return <div style={{ ...styles.panel, maxWidth: 760, margin: "0 auto", color: C.danger, borderColor: C.danger }}>{error}</div>;
  if (!battle) return <div style={styles.empty}>Бой не найден.</div>;

  const rounds = Array.isArray(battle.history?.rounds) ? battle.history.rounds : [];

  return (
    <div className="fade-in" style={{ maxWidth: 1120, margin: "0 auto" }}>
      <p style={styles.sectionLabel}>ПРОТОКОЛ БОЯ</p>
      <div style={{ marginBottom: 12 }}>
        <Link to="/battles" style={{ ...styles.btnGhost, display: "inline-block", textDecoration: "none" }}>← ИСТОРИЯ</Link>
      </div>

      <div style={{ ...styles.panel, borderColor: battle.tournament ? C.yellow : C.border, marginBottom: 16 }}>
        <div style={D.meta}>
          <span style={{ color: C.yellow, fontWeight: 900 }}>#{battle.id}</span>
          <BattleKind battle={battle} />
          <span style={{ color: C.muted }}>{formatDate(battle.at)}</span>
        </div>
        <div style={D.topic}>{battle.topic || "Без темы"}</div>
        <div style={D.fighters}>
          <span style={{ color: C.red }}>{fighterLabel(battle, "A")}</span>
          <span style={{ color: C.yellow, fontWeight: 900 }}>VS</span>
          <span style={{ color: C.blue }}>{fighterLabel(battle, "B")}</span>
        </div>
        <div style={D.result}>
          {resultLabel(battle)}
          <span style={{ color: C.muted }}> · {battle.scoreA}:{battle.scoreB}</span>
        </div>
      </div>

      {!battle.hasHistory && (
        <div style={{ ...styles.panel, color: C.muted }}>
          Подробный ход недоступен для боёв, сыгранных до появления истории.
        </div>
      )}

      {battle.hasHistory && (
        <>
          <div style={{ display: "grid", gap: 12 }}>
            {rounds.map((round) => (
              <RoundBlock key={round.round} battle={battle} round={round} />
            ))}
          </div>

          <div style={{ ...styles.verdictPanel, position: "static", marginTop: 16 }}>
            <div style={{ color: C.yellow, fontWeight: 900, letterSpacing: 2, marginBottom: 8 }}>ФИНАЛЬНЫЙ ВЕРДИКТ</div>
            <div style={{ ...styles.scoreLine, marginTop: 0 }}>
              <span style={{ color: C.red }}>{battle.aName}: {battle.history?.final?.score_a ?? battle.scoreA}</span>
              {"  ◆  "}
              <span style={{ color: C.blue }}>{battle.bName}: {battle.history?.final?.score_b ?? battle.scoreB}</span>
            </div>
            {battle.history?.final?.rationale && <div style={styles.rationale}>«{battle.history.final.rationale}»</div>}
          </div>
        </>
      )}
    </div>
  );
}

function RoundBlock({ battle, round }) {
  return (
    <div style={D.round}>
      <div style={D.roundTitle}>РАУНД {round.round}</div>
      <Reply color={C.red} name={battle.aName} reply={round.replies?.A} />
      <Reply color={C.blue} name={battle.bName} reply={round.replies?.B} right />
      <div style={D.judge}>
        <div style={{ color: C.yellow, fontWeight: 900, marginBottom: 4 }}>СУДЬЯ</div>
        <div>{round.judge?.note || "Раунд оценён."}</div>
        <div style={D.damage}>
          Урон: {battle.aName} −{round.damage?.A ?? 0} · {battle.bName} −{round.damage?.B ?? 0}
          {"  "}
          HP: {round.hp?.A ?? "?"}:{round.hp?.B ?? "?"}
        </div>
      </div>
    </div>
  );
}

function Reply({ color, name, reply, right = false }) {
  return (
    <div style={{ ...D.reply, borderColor: color, marginLeft: right ? "auto" : 0, background: `${color}14` }}>
      <div style={{ color, fontWeight: 900, marginBottom: 6 }}>{name}</div>
      <div>{reply?.text || "—"}</div>
      {reply?.model && <div style={D.model}>{reply.model}</div>}
    </div>
  );
}

const D = {
  meta: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 },
  topic: { color: C.yellow, fontWeight: 900, fontSize: 22, lineHeight: 1.35, marginBottom: 12 },
  fighters: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontWeight: 900, fontSize: 16 },
  result: { marginTop: 10, color: C.green, fontWeight: 900 },
  round: { ...styles.panel, padding: 16 },
  roundTitle: { color: C.yellow, fontWeight: 900, letterSpacing: 2, marginBottom: 12 },
  reply: { maxWidth: "78%", border: "2px solid", borderRadius: 8, padding: "10px 12px", marginBottom: 10, lineHeight: 1.5 },
  model: { marginTop: 8, color: C.muted, fontSize: 11 },
  judge: { color: C.text, borderTop: `1px solid ${C.border}`, paddingTop: 10, lineHeight: 1.45 },
  damage: { marginTop: 6, color: C.muted, fontSize: 12, fontWeight: 900 },
};
