import React, { useState, useEffect, useRef } from "react";

// ============================================================
//  DEBATE ARENA — Microservices vs Monolith
//  Retro arcade fighting-game styled AI debate stand demo
// ============================================================

const ARCHETYPES = {
  pragmatist: {
    name: "THE PRAGMATIST",
    tag: "Ships > Theory",
    color: "#ff3864",
    emoji: "🛠️",
    skill:
      "You are a battle-hardened staff engineer who values shipping working software over architectural purity. You argue with concrete war stories, cost numbers, and operational reality. You are dismissive of hype and ivory-tower thinking. Keep replies punchy — 2-3 sentences, sharp and quotable.",
  },
  visionary: {
    name: "THE VISIONARY",
    tag: "Scale or Die",
    color: "#3891ff",
    emoji: "🚀",
    skill:
      "You are a forward-looking principal architect obsessed with scale, team autonomy, and future-proofing. You argue from first principles and paint vivid pictures of where systems will be in 3 years. You are charismatic and a little grandiose. Keep replies punchy — 2-3 sentences, bold and memorable.",
  },
  professor: {
    name: "THE PROFESSOR",
    tag: "Cite Your Sources",
    color: "#ffd23f",
    emoji: "🎓",
    skill:
      "You are a rigorous computer-science academic. You argue with precision, definitions, trade-off analysis and references to established literature (Conway's Law, Fallacies of Distributed Computing, etc). You calmly dismantle sloppy reasoning. Keep replies punchy — 2-3 sentences, precise and devastating.",
  },
  rebel: {
    name: "THE REBEL",
    tag: "Burn It Down",
    color: "#06d6a0",
    emoji: "🔥",
    skill:
      "You are a contrarian who delights in attacking the consensus and exposing hidden assumptions. You use provocative analogies and aggressive rhetorical questions. You go straight for the opponent's weakest claim. Keep replies punchy — 2-3 sentences, aggressive and witty.",
  },
};

const STANCES = {
  microservices: "Microservices are the superior architecture.",
  monolith: "The monolith is the superior architecture.",
};

const ROUNDS = 3;
const MODEL = "claude-sonnet-4-20250514";

export default function DebateArena() {
  const [phase, setPhase] = useState("select"); // select | versus | fight | verdict
  const [fighterA, setFighterA] = useState("pragmatist");
  const [fighterB, setFighterB] = useState("visionary");
  const [hpA, setHpA] = useState(100);
  const [hpB, setHpB] = useState(100);
  const [log, setLog] = useState([]);
  const [round, setRound] = useState(0);
  const [status, setStatus] = useState("");
  const [verdict, setVerdict] = useState(null);
  const [shake, setShake] = useState(null);
  const logRef = useRef(null);

  const A = ARCHETYPES[fighterA];
  const B = ARCHETYPES[fighterB];

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function callClaude(system, messages, expectJson = false) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, system, messages }),
    });
    const data = await res.json();
    let text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (expectJson) {
      text = text.replace(/```json|```/g, "").trim();
      return JSON.parse(text);
    }
    return text;
  }

  async function runFight() {
    setPhase("versus");
    await wait(2200);
    setPhase("fight");
    setHpA(100);
    setHpB(100);
    setLog([]);
    setVerdict(null);

    const transcript = [];
    const sysA = `${A.skill}\nYou are debating: "${STANCES[stanceA]}" Your opponent argues the opposite. Attack their position and defend yours.`;
    const sysB = `${B.skill}\nYou are debating: "${STANCES[stanceB]}" Your opponent argues the opposite. Attack their position and defend yours.`;

    let curHpA = 100;
    let curHpB = 100;

    for (let r = 1; r <= ROUNDS; r++) {
      setRound(r);

      // Fighter A speaks
      setStatus(`${A.name} attacks…`);
      const histA = transcript.map((t, i) => ({
        role: i % 2 === 0 ? "assistant" : "user",
        content: t.text,
      }));
      const replyA = await callClaude(sysA, [
        ...histA,
        { role: "user", content: r === 1 ? "Open the debate with your strongest argument." : "Counter your opponent and land a new blow." },
      ]);
      transcript.push({ side: "A", text: replyA });
      setLog((l) => [...l, { side: "A", fighter: A, text: replyA, round: r }]);
      await wait(900);

      // Fighter B speaks
      setStatus(`${B.name} counters…`);
      const histB = transcript.map((t) => ({
        role: t.side === "B" ? "assistant" : "user",
        content: t.text,
      }));
      const replyB = await callClaude(sysB, [
        ...histB,
        { role: "user", content: "Rebut that and hit back hard." },
      ]);
      transcript.push({ side: "B", text: replyB });
      setLog((l) => [...l, { side: "B", fighter: B, text: replyB, round: r }]);
      await wait(900);

      // Judge scores this exchange
      setStatus("🧑‍⚖️  JUDGE scoring the round…");
      const judgeSys =
        "You are a sharp, fair debate judge. Score this single exchange on persuasiveness, factual correctness, and how well each fighter answered the opponent. Output ONLY JSON: {\"damage_to_a\": N, \"damage_to_b\": N, \"note\": \"<8 words punchy ringside call>\"} where damage is 0-25 hit points each fighter LOSES this round.";
      const judgement = await callClaude(
        judgeSys,
        [
          {
            role: "user",
            content: `STANCE A (${A.name}): ${STANCES[stanceA]}\nA said: "${replyA}"\n\nSTANCE B (${B.name}): ${STANCES[stanceB]}\nB said: "${replyB}"`,
          },
        ],
        true
      );

      curHpA = Math.max(0, curHpA - (judgement.damage_to_a || 0));
      curHpB = Math.max(0, curHpB - (judgement.damage_to_b || 0));
      if ((judgement.damage_to_a || 0) > (judgement.damage_to_b || 0)) {
        setShake("A");
      } else if ((judgement.damage_to_b || 0) > (judgement.damage_to_a || 0)) {
        setShake("B");
      }
      setHpA(curHpA);
      setHpB(curHpB);
      setLog((l) => [...l, { side: "judge", text: judgement.note, round: r }]);
      await wait(700);
      setShake(null);
      await wait(600);
    }

    // Final verdict
    setStatus("🧑‍⚖️  FINAL VERDICT…");
    const finalSys =
      "You are the head judge. Read the full debate and declare a winner. Output ONLY JSON: {\"winner\": \"A\" or \"B\", \"score_a\": 0-100, \"score_b\": 0-100, \"rationale\": \"2 sentence verdict\"}";
    const full = transcript
      .map((t) => `${t.side === "A" ? A.name : B.name}: ${t.text}`)
      .join("\n\n");
    const final = await callClaude(
      finalSys,
      [{ role: "user", content: `Topic: Microservices vs Monolith.\n\n${full}` }],
      true
    );
    // tie-break by HP if needed
    const winner = curHpA === curHpB ? final.winner : curHpA > curHpB ? "A" : "B";
    setVerdict({ ...final, winner, hpA: curHpA, hpB: curHpB });
    setStatus("");
    setPhase("verdict");
  }

  const [stanceA, setStanceA] = useState("microservices");
  const [stanceB, setStanceB] = useState("monolith");

  return (
    <div style={styles.root}>
      <style>{css}</style>
      <div style={styles.scanlines} />

      <header style={styles.header}>
        <h1 style={styles.title}>
          <span style={{ color: "#ff3864" }}>DEBATE</span>{" "}
          <span style={{ color: "#3891ff" }}>ARENA</span>
        </h1>
        <p style={styles.subtitle}>◆ MICROSERVICES vs MONOLITH ◆</p>
      </header>

      {phase === "select" && (
        <Selection
          {...{
            fighterA,
            setFighterA,
            fighterB,
            setFighterB,
            stanceA,
            setStanceA,
            stanceB,
            setStanceB,
            runFight,
          }}
        />
      )}

      {phase === "versus" && <VersusScreen A={A} B={B} stanceA={stanceA} stanceB={stanceB} />}

      {(phase === "fight" || phase === "verdict") && (
        <Ring
          {...{ A, B, hpA, hpB, log, round, status, shake, verdict, logRef }}
          onRematch={() => setPhase("select")}
        />
      )}
    </div>
  );
}

function Selection({ fighterA, setFighterA, fighterB, setFighterB, stanceA, setStanceA, stanceB, setStanceB, runFight }) {
  return (
    <div className="fade-in">
      <p style={styles.sectionLabel}>SELECT YOUR FIGHTERS</p>
      <div style={styles.selectGrid}>
        <FighterPicker side="P1" color="#ff3864" selected={fighterA} onSelect={setFighterA} stance={stanceA} setStance={setStanceA} />
        <div style={styles.vsMini}>VS</div>
        <FighterPicker side="P2" color="#3891ff" selected={fighterB} onSelect={setFighterB} stance={stanceB} setStance={setStanceB} />
      </div>
      <div style={{ textAlign: "center" }}>
        <button style={styles.fightBtn} onClick={runFight} disabled={fighterA === fighterB && stanceA === stanceB}>
          ▶ FIGHT
        </button>
      </div>
    </div>
  );
}

function FighterPicker({ side, color, selected, onSelect, stance, setStance }) {
  return (
    <div style={{ ...styles.pickerCol, borderColor: color }}>
      <div style={{ ...styles.playerTag, background: color }}>{side}</div>
      <div style={styles.archGrid}>
        {Object.entries(ARCHETYPES).map(([key, a]) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            style={{
              ...styles.archCard,
              borderColor: selected === key ? a.color : "#2a2a3e",
              background: selected === key ? `${a.color}22` : "#16161f",
              boxShadow: selected === key ? `0 0 16px ${a.color}88` : "none",
            }}
          >
            <span style={{ fontSize: 26 }}>{a.emoji}</span>
            <span style={{ ...styles.archName, color: a.color }}>{a.name}</span>
            <span style={styles.archTag}>{a.tag}</span>
          </button>
        ))}
      </div>
      <div style={styles.stanceRow}>
        {Object.entries(STANCES).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setStance(key)}
            style={{
              ...styles.stanceBtn,
              borderColor: stance === key ? color : "#2a2a3e",
              color: stance === key ? "#fff" : "#777",
              background: stance === key ? `${color}33` : "transparent",
            }}
          >
            {key === "microservices" ? "MICROSERVICES" : "MONOLITH"}
          </button>
        ))}
      </div>
    </div>
  );
}

function VersusScreen({ A, B, stanceA, stanceB }) {
  return (
    <div style={styles.versusWrap} className="fade-in">
      <div style={{ ...styles.versusCard, borderColor: A.color }} className="slide-left">
        <div style={{ fontSize: 70 }}>{A.emoji}</div>
        <div style={{ ...styles.versusName, color: A.color }}>{A.name}</div>
        <div style={styles.versusStance}>{stanceA === "microservices" ? "MICROSERVICES" : "MONOLITH"}</div>
      </div>
      <div style={styles.versusVS} className="vs-pop">VS</div>
      <div style={{ ...styles.versusCard, borderColor: B.color }} className="slide-right">
        <div style={{ fontSize: 70 }}>{B.emoji}</div>
        <div style={{ ...styles.versusName, color: B.color }}>{B.name}</div>
        <div style={styles.versusStance}>{stanceB === "microservices" ? "MICROSERVICES" : "MONOLITH"}</div>
      </div>
    </div>
  );
}

function Ring({ A, B, hpA, hpB, log, round, status, shake, verdict, logRef, onRematch }) {
  return (
    <div className="fade-in">
      {/* HP bars */}
      <div style={styles.hpRow}>
        <HpBar fighter={A} hp={hpA} align="left" shaking={shake === "A"} />
        <div style={styles.roundBadge}>
          {verdict ? "FINAL" : `R${round}/${ROUNDS}`}
        </div>
        <HpBar fighter={B} hp={hpB} align="right" shaking={shake === "B"} />
      </div>

      {/* Arena floor with fighters */}
      <div style={styles.arena}>
        <div style={{ ...styles.fighterSprite, animation: shake === "B" ? "lunge-right 0.4s" : "idle 2s infinite" }}>
          <span style={{ fontSize: 56, filter: hpA === 0 ? "grayscale(1) opacity(0.4)" : "none" }}>{A.emoji}</span>
        </div>
        <div style={styles.arenaCenter}>{status && <span className="blink">{status}</span>}</div>
        <div style={{ ...styles.fighterSprite, transform: "scaleX(-1)", animation: shake === "A" ? "lunge-left 0.4s" : "idle 2s infinite 0.3s" }}>
          <span style={{ fontSize: 56, filter: hpB === 0 ? "grayscale(1) opacity(0.4)" : "none" }}>{B.emoji}</span>
        </div>
      </div>

      {/* Debate feed */}
      <div style={styles.feed} ref={logRef}>
        {log.map((entry, i) =>
          entry.side === "judge" ? (
            <div key={i} style={styles.judgeLine}>⚖ {entry.text}</div>
          ) : (
            <div
              key={i}
              style={{
                ...styles.bubble,
                alignSelf: entry.side === "A" ? "flex-start" : "flex-end",
                borderColor: entry.fighter.color,
                background: `${entry.fighter.color}14`,
              }}
            >
              <div style={{ ...styles.bubbleName, color: entry.fighter.color }}>
                {entry.fighter.emoji} {entry.fighter.name}
              </div>
              {entry.text}
            </div>
          )
        )}
      </div>

      {verdict && (
        <div style={styles.verdictPanel} className="ko-pop">
          <div style={styles.koText}>K.O.</div>
          <div style={{ ...styles.winnerName, color: verdict.winner === "A" ? A.color : B.color }}>
            {(verdict.winner === "A" ? A : B).emoji} {(verdict.winner === "A" ? A : B).name} WINS
          </div>
          <div style={styles.scoreLine}>
            <span style={{ color: A.color }}>{A.name}: {verdict.score_a}</span>
            {"  ◆  "}
            <span style={{ color: B.color }}>{B.name}: {verdict.score_b}</span>
          </div>
          <div style={styles.rationale}>"{verdict.rationale}"</div>
          <button style={styles.fightBtn} onClick={onRematch}>↻ REMATCH</button>
        </div>
      )}
    </div>
  );
}

function HpBar({ fighter, hp, align, shaking }) {
  return (
    <div style={{ flex: 1, textAlign: align, animation: shaking ? "shake 0.4s" : "none" }}>
      <div style={{ ...styles.hpName, color: fighter.color, justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
        {fighter.emoji} {fighter.name}
      </div>
      <div style={{ ...styles.hpTrack, direction: align === "right" ? "rtl" : "ltr" }}>
        <div
          style={{
            ...styles.hpFill,
            width: `${hp}%`,
            background: hp > 50 ? "#06d6a0" : hp > 25 ? "#ffd23f" : "#ff3864",
          }}
        />
      </div>
      <div style={{ ...styles.hpNum, color: fighter.color }}>{hp} HP</div>
    </div>
  );
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const styles = {
  root: {
    minHeight: "100vh",
    background: "radial-gradient(ellipse at top, #1a1a2e 0%, #0a0a12 70%)",
    color: "#e8e8f0",
    fontFamily: "'Courier New', monospace",
    padding: "24px 16px 60px",
    position: "relative",
    overflow: "hidden",
  },
  scanlines: {
    position: "fixed",
    inset: 0,
    background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)",
    pointerEvents: "none",
    zIndex: 100,
  },
  header: { textAlign: "center", marginBottom: 28 },
  title: {
    fontSize: 52,
    fontWeight: 900,
    letterSpacing: 4,
    margin: 0,
    fontFamily: "'Arial Black', sans-serif",
    textShadow: "0 0 20px rgba(255,56,100,0.4)",
  },
  subtitle: { letterSpacing: 6, fontSize: 13, color: "#ffd23f", marginTop: 6 },
  sectionLabel: { textAlign: "center", letterSpacing: 4, color: "#777", fontSize: 13, marginBottom: 16 },
  selectGrid: { display: "flex", alignItems: "stretch", gap: 16, maxWidth: 920, margin: "0 auto 28px", justifyContent: "center" },
  vsMini: { alignSelf: "center", fontWeight: 900, fontSize: 28, color: "#ffd23f" },
  pickerCol: { flex: 1, border: "2px solid", borderRadius: 12, padding: 16, background: "#0e0e18" },
  playerTag: { display: "inline-block", padding: "3px 14px", borderRadius: 4, fontWeight: 900, fontSize: 14, color: "#0a0a12", marginBottom: 12 },
  archGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 },
  archCard: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "12px 6px", border: "2px solid", borderRadius: 8, cursor: "pointer", transition: "all 0.15s" },
  archName: { fontWeight: 900, fontSize: 10, letterSpacing: 0.5, textAlign: "center" },
  archTag: { fontSize: 9, color: "#888" },
  stanceRow: { display: "flex", gap: 8 },
  stanceBtn: { flex: 1, padding: "8px 4px", border: "2px solid", borderRadius: 6, background: "transparent", cursor: "pointer", fontWeight: 700, fontSize: 10, letterSpacing: 1, fontFamily: "inherit" },
  fightBtn: {
    background: "linear-gradient(180deg, #ff3864, #c01840)",
    color: "#fff",
    border: "none",
    padding: "16px 56px",
    fontSize: 22,
    fontWeight: 900,
    letterSpacing: 3,
    borderRadius: 8,
    cursor: "pointer",
    boxShadow: "0 0 30px rgba(255,56,100,0.5)",
    fontFamily: "'Arial Black', sans-serif",
    marginTop: 8,
  },
  versusWrap: { display: "flex", alignItems: "center", justifyContent: "center", gap: 30, padding: "50px 0", minHeight: 320 },
  versusCard: { textAlign: "center", border: "3px solid", borderRadius: 16, padding: "30px 40px", background: "#0e0e18" },
  versusName: { fontWeight: 900, fontSize: 18, letterSpacing: 1, marginTop: 10 },
  versusStance: { fontSize: 11, color: "#888", letterSpacing: 2, marginTop: 6 },
  versusVS: { fontSize: 64, fontWeight: 900, color: "#ffd23f", fontFamily: "'Arial Black', sans-serif", textShadow: "0 0 30px rgba(255,210,63,0.6)" },
  hpRow: { display: "flex", alignItems: "flex-start", gap: 16, maxWidth: 1000, margin: "0 auto 14px" },
  roundBadge: { background: "#ffd23f", color: "#0a0a12", fontWeight: 900, padding: "6px 12px", borderRadius: 6, fontSize: 14, alignSelf: "center", whiteSpace: "nowrap" },
  hpName: { display: "flex", gap: 6, fontWeight: 900, fontSize: 12, marginBottom: 4 },
  hpTrack: { height: 22, background: "#1a1a2e", border: "2px solid #2a2a3e", borderRadius: 4, overflow: "hidden" },
  hpFill: { height: "100%", transition: "width 0.6s ease", boxShadow: "inset 0 0 8px rgba(255,255,255,0.3)" },
  hpNum: { fontSize: 11, fontWeight: 700, marginTop: 3 },
  arena: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    maxWidth: 1000,
    margin: "0 auto",
    height: 110,
    background: "linear-gradient(180deg, transparent, rgba(255,210,63,0.06))",
    borderBottom: "3px solid #2a2a3e",
    padding: "0 60px",
    position: "relative",
  },
  fighterSprite: { paddingBottom: 8 },
  arenaCenter: { flex: 1, textAlign: "center", color: "#ffd23f", fontSize: 13, letterSpacing: 1, paddingBottom: 30, fontWeight: 700 },
  feed: { maxWidth: 1000, margin: "20px auto 0", display: "flex", flexDirection: "column", gap: 12, maxHeight: 340, overflowY: "auto", padding: "0 8px" },
  bubble: { maxWidth: "72%", border: "2px solid", borderRadius: 10, padding: "10px 14px", fontSize: 14, lineHeight: 1.45 },
  bubbleName: { fontWeight: 900, fontSize: 11, marginBottom: 5, letterSpacing: 0.5 },
  judgeLine: { alignSelf: "center", color: "#ffd23f", fontSize: 12, fontWeight: 700, letterSpacing: 1, padding: "2px 0" },
  verdictPanel: { textAlign: "center", maxWidth: 700, margin: "30px auto 0", border: "3px solid #ffd23f", borderRadius: 16, padding: 30, background: "rgba(255,210,63,0.06)" },
  koText: { fontSize: 64, fontWeight: 900, color: "#ff3864", fontFamily: "'Arial Black', sans-serif", textShadow: "0 0 30px rgba(255,56,100,0.7)", letterSpacing: 6 },
  winnerName: { fontSize: 24, fontWeight: 900, marginTop: 8, letterSpacing: 1 },
  scoreLine: { marginTop: 14, fontSize: 14, fontWeight: 700 },
  rationale: { marginTop: 12, fontStyle: "italic", color: "#bbb", fontSize: 14, lineHeight: 1.5 },
};

const css = `
  @keyframes idle { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
  @keyframes lunge-right { 0%{transform:translateX(0)} 50%{transform:translateX(40px)} 100%{transform:translateX(0)} }
  @keyframes lunge-left { 0%{transform:scaleX(-1) translateX(0)} 50%{transform:scaleX(-1) translateX(40px)} 100%{transform:scaleX(-1) translateX(0)} }
  @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .blink { animation: blink 1s infinite; }
  .fade-in { animation: fadeIn 0.5s ease; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
  .slide-left { animation: slideL 0.6s ease; }
  .slide-right { animation: slideR 0.6s ease; }
  @keyframes slideL { from{transform:translateX(-200px);opacity:0} to{transform:translateX(0);opacity:1} }
  @keyframes slideR { from{transform:translateX(200px);opacity:0} to{transform:translateX(0);opacity:1} }
  .vs-pop { animation: vsPop 0.6s ease 0.3s both; }
  @keyframes vsPop { from{transform:scale(0);opacity:0} 60%{transform:scale(1.4)} to{transform:scale(1);opacity:1} }
  .ko-pop { animation: koPop 0.5s ease; }
  @keyframes koPop { from{transform:scale(0.7);opacity:0} to{transform:scale(1);opacity:1} }
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-thumb { background: #2a2a3e; border-radius: 4px; }
  button:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
`;
