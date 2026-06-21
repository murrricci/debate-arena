import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { styles, C } from "../styles.js";
import { getParticipants, applyResult, canPlayWarmup, MAX_WARMUP_BATTLES } from "../lib/store.js";
import { getTournament } from "../lib/tournament.js";
import { fighterFace, fighterColor } from "../lib/agent.js";
import { publish, subscribe } from "../lib/bus.js";
import { TOPICS, randomTopic } from "../data/topics.js";
import { MODEL_TIERS } from "../lib/models.js";
import { pickSprite } from "../data/sprites.js";
import { filterFighters, fighterOptionLabel } from "../lib/fighterSearch.js";
import { runDebateFight } from "../lib/fightRunner.js";
import { historyWithMode } from "../lib/battleHistory.js";
import { clearLiveSnapshot, publishLiveSnapshot } from "../lib/liveState.js";
import { isWarmupOpen, warmupStatusMessage } from "../lib/activityState.js";
import PixelFighter from "../components/PixelFighter.jsx";
import PixelArena from "../components/PixelArena.jsx";

const ROUNDS = 3;

export default function Arena() {
  const [people, setPeople] = useState(getParticipants());
  const [phase, setPhase] = useState("select"); // select | versus | fight | verdict
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [topicId, setTopicId] = useState(TOPICS[0].id);
  const [swapped, setSwapped] = useState(false);

  const [hpA, setHpA] = useState(100);
  const [hpB, setHpB] = useState(100);
  const [log, setLog] = useState([]);
  const [round, setRound] = useState(0);
  const [status, setStatus] = useState("");
  const [verdict, setVerdict] = useState(null);
  const [battleId, setBattleId] = useState(null);
  const [historyError, setHistoryError] = useState("");
  const [shake, setShake] = useState(null);
  const [error, setError] = useState("");
  // Текущая ступень (тир) каждого бойца — деградирует по мере расхода токенов.
  const [tierA, setTierA] = useState(MODEL_TIERS[0]);
  const [tierB, setTierB] = useState(MODEL_TIERS[0]);
  // Реально ответившая модель каждого бойца (для честного тултипа на бейдже).
  const [modelA, setModelA] = useState("");
  const [modelB, setModelB] = useState("");
  const [tour, setTour] = useState(getTournament());
  const logRef = useRef(null);
  const fightSeqRef = useRef(0);

  useEffect(() =>
    subscribe((type) => {
      if (type === "participants") setPeople(getParticipants());
      if (type === "tournament") setTour(getTournament());
    }), []);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const topic = TOPICS.find((t) => t.id === topicId) || TOPICS[0];
  const A = people.find((p) => p.id === aId);
  const B = people.find((p) => p.id === bId);
  // Позиции: A защищает sideA, B — sideB (можно поменять кнопкой swap).
  const stanceA = swapped ? topic.sideB : topic.sideA;
  const stanceB = swapped ? topic.sideA : topic.sideB;

  // Транслируем состояние боя на табло (второе окно).
  useEffect(() => {
    if (!A || !B) {
      clearLiveSnapshot().catch(() => {});
      return;
    }
    const livePayload = {
      phase,
      topic: topic.title,
      a: { name: A.name, face: fighterFace(A), color: fighterColor(A, C.red), stance: stanceA, hp: hpA, tier: tierA },
      b: { name: B.name, face: fighterFace(B), color: fighterColor(B, C.blue), stance: stanceB, hp: hpB, tier: tierB },
      round,
      status,
      lastNote: [...log].reverse().find((l) => l.side === "judge")?.text || "",
      verdict,
    };
    publish("live", livePayload);
    publishLiveSnapshot(livePayload).catch(() => {});
  }, [phase, hpA, hpB, round, status, verdict, aId, bId, topicId, swapped, tierA, tierB]); // eslint-disable-line

  function rollTopic() {
    setTopicId(randomTopic(topicId).id);
  }

  // Запуск ручного боя (разминка) из текущих селекторов.
  function startManualFight() {
    if (!isWarmupOpen(tour)) return setError(warmupStatusMessage(tour));
    if (!A || !B || aId === bId) return;
    if (!canPlayWarmup(A) || !canPlayWarmup(B)) {
      return setError(`В разминке каждый агент играет максимум ${MAX_WARMUP_BATTLES} боя.`);
    }
    runFight(A, B, topic, swapped);
  }

  async function runFight(aF, bF, topicObj, swap) {
    const A = aF;
    const B = bF;
    const topic = topicObj;
    // Синхронизируем селекторы — от них зависит рендер ринга и трансляция на табло.
    setAId(A.id);
    setBId(B.id);
    setTopicId(topic.id);
    setSwapped(swap);

    const colorA = fighterColor(A, C.red);
    const colorB = fighterColor(B, C.blue);
    const faceA = fighterFace(A);
    const faceB = fighterFace(B);
    const fightStart = performance.now();
    const fightSeq = ++fightSeqRef.current;

    try {
      const result = await runDebateFight({
        aF: A,
        bF: B,
        topic,
        swap,
        rounds: ROUNDS,
        onEvent: (event) => {
          if (event.type === "phase") setPhase(event.phase);
          if (event.type === "reset") {
            setHpA(100);
            setHpB(100);
            setLog([]);
            setVerdict(null);
            setBattleId(null);
            setHistoryError("");
            setTierA(event.tierA);
            setTierB(event.tierB);
            setModelA("");
            setModelB("");
          }
          if (event.type === "round") setRound(event.round);
          if (event.type === "status") setStatus(event.status);
          if (event.type === "tier" && event.side === "A") setTierA(event.tier);
          if (event.type === "tier" && event.side === "B") setTierB(event.tier);
          if (event.type === "model" && event.side === "A") setModelA(event.model);
          if (event.type === "model" && event.side === "B") setModelB(event.model);
          if (event.type === "reply") {
            const isA = event.side === "A";
            setLog((l) => [...l, {
              side: event.side,
              name: isA ? A.name : B.name,
              face: isA ? faceA : faceB,
              color: isA ? colorA : colorB,
              text: event.text,
              round: event.round,
              tier: event.tier,
            }]);
          }
          if (event.type === "judge") {
            if (event.shake) setShake(event.shake);
            setHpA(event.hpA);
            setHpB(event.hpB);
            setLog((l) => [...l, { side: "judge", text: event.judgement?.note || "раунд сыгран", round: event.round }]);
          }
          if (event.type === "shake") setShake(event.side);
          if (event.type === "verdict") {
            setVerdict(event.verdict);
            setPhase("verdict");
          }
        },
      });

      // Итог по таймингу: сколько ушло на провайдера, а сколько — на паузы интерфейса.
      const wallMs = Math.round(performance.now() - fightStart);
      const llm = Math.round(result.llmMs);
      console.log(`[БОЙ] всего ${wallMs}мс · LLM ${llm}мс (${Math.round((llm / wallMs) * 100)}%) · паузы UX ${wallMs - llm}мс · ₽${result.fightCost.toFixed(2)}`);

      // Начисляем очки только в зачёт разминки. Турнир хранит отдельную таблицу.
      await applyResult({
        aId: A.id,
        bId: B.id,
        winner: result.winner,
        scoreA: result.scoreA,
        scoreB: result.scoreB,
        topic: topic.title,
        tournament: false,
        history: historyWithMode(result.history, "warmup"),
        onSaved: (saved) => {
          if (fightSeqRef.current === fightSeq && saved?.battleId) setBattleId(saved.battleId);
        },
        onError: () => {
          if (fightSeqRef.current === fightSeq) setHistoryError("История боя не сохранилась");
        },
      });
      setPeople(getParticipants());
    } catch (e) {
      setError("Бой прерван: " + e.message);
      setStatus("");
      setPhase("select");
    }
  }

  const canFight = A && B && aId !== bId && isWarmupOpen(tour) && canPlayWarmup(A) && canPlayWarmup(B);

  if (phase === "select") {
    return (
      <Selection
        {...{ people, aId, setAId, bId, setBId, topic, topicId, setTopicId, rollTopic, swapped, setSwapped, stanceA, stanceB, canFight, runFight: startManualFight, error, tour }}
      />
    );
  }

  if (phase === "versus") {
    return <Versus A={A} B={B} stanceA={stanceA} stanceB={stanceB} topic={topic} />;
  }

  return (
    <Ring
      {...{ A, B, hpA, hpB, log, round, status, shake, verdict, battleId, historyError, logRef, topic, stanceA, stanceB, tierA, tierB, modelA, modelB }}
      onRematch={() => { setPhase("select"); setVerdict(null); setBattleId(null); setHistoryError(""); }}
    />
  );
}

/* ---------- Экран выбора ---------- */
function Selection({ people, aId, setAId, bId, setBId, topic, topicId, setTopicId, rollTopic, swapped, setSwapped, stanceA, stanceB, canFight, runFight, error, tour }) {
  const warmupOpen = isWarmupOpen(tour);
  if (people.length < 2) {
    return (
      <div className="fade-in" style={{ textAlign: "center" }}>
        <p style={styles.empty}>
          Нужно минимум 2 зарегистрированных бойца.
          <br />
          Зайди во вкладку <b style={{ color: C.yellow }}>📝 УЧАСТНИКИ</b> и добавь их.
        </p>
      </div>
    );
  }
  return (
    <div className="fade-in">
      <p style={styles.sectionLabel}>ВЫБЕРИ БОЙЦОВ И ТЕМУ</p>
      {!warmupOpen && (
        <div style={{ ...styles.panel, maxWidth: 720, margin: "0 auto 18px", borderColor: C.yellow, textAlign: "center", color: C.yellow, fontWeight: 900 }}>
          {warmupStatusMessage(tour)}
          {tour.status !== "done" && <> Переходи во вкладку <a href="#/tournament" style={{ color: C.blue }}>🏆 ТУРНИР</a>.</>}
        </div>
      )}

      {/* Тема */}
      <div style={{ ...styles.panel, maxWidth: 720, margin: "0 auto 22px" }}>
        <label style={styles.label}>ТЕМА ДЕБАТОВ</label>
        <div style={{ display: "flex", gap: 10 }}>
          <select style={styles.input} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            {TOPICS.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          <button type="button" style={{ ...styles.btnGhost, whiteSpace: "nowrap" }} onClick={rollTopic}>🎲 Случайная</button>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: C.red }}>P1 ▸ {stanceA}</span>
          <span style={{ fontSize: 13, color: C.blue }}>P2 ▸ {stanceB}</span>
          <button type="button" style={styles.btnGhost} onClick={() => setSwapped((s) => !s)}>⇄ поменять стороны</button>
        </div>
      </div>

      {/* Бойцы */}
      <div style={styles.selectGrid}>
        <FighterSelect side="P1" color={C.red} value={aId} onChange={setAId} people={people} disabledId={bId} />
        <div style={styles.vsMini}>VS</div>
        <FighterSelect side="P2" color={C.blue} value={bId} onChange={setBId} people={people} disabledId={aId} />
      </div>

      {error && <p style={{ color: C.red, textAlign: "center", fontWeight: 700 }}>{error}</p>}

      <div style={{ textAlign: "center", marginTop: 8 }}>
        <button style={styles.btn} onClick={runFight} disabled={!canFight}>▶ БОЙ</button>
        {warmupOpen && (aId || bId) && !canFight && (
          <div style={{ color: C.muted, marginTop: 10, fontSize: 12 }}>
            В разминке каждый агент играет максимум {MAX_WARMUP_BATTLES} боя.
          </div>
        )}
      </div>
    </div>
  );
}

function FighterSelect({ side, color, value, onChange, people, disabledId }) {
  const sel = people.find((p) => p.id === value);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const matches = filterFighters(people, query, disabledId).slice(0, 8);
  const shownValue = open ? query : fighterOptionLabel(sel);

  function choose(fighter) {
    onChange(fighter.id);
    setQuery("");
    setOpen(false);
  }

  function typeQuery(next) {
    setQuery(next);
    setOpen(true);
    if (value) onChange("");
  }

  return (
    <div style={{ ...styles.pickerCol, borderColor: color, position: "relative" }}>
      <div style={{ ...styles.playerTag, background: color }}>{side}</div>
      <div style={{ position: "relative", marginBottom: 12 }}>
        <input
          style={{ ...styles.input, paddingRight: value ? 42 : 14 }}
          value={shownValue}
          onChange={(e) => typeQuery(e.target.value)}
          onFocus={(e) => { setQuery(""); setOpen(true); e.currentTarget.select(); }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && matches.length === 1) {
              e.preventDefault();
              choose(matches[0]);
            }
          }}
          placeholder="Ник или #номер пользователя"
          role="combobox"
          aria-expanded={open}
          aria-label={`${side}: поиск бойца по нику или номеру пользователя`}
        />
        {value && (
          <button
            type="button"
            title="Сбросить выбор"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(""); setQuery(""); setOpen(true); }}
            style={fighterSearchStyles.clear}
          >
            ×
          </button>
        )}
        {open && (
          <div role="listbox" style={fighterSearchStyles.menu}>
            {matches.length > 0 ? matches.map((p) => (
              <button
                type="button"
                key={p.id}
                role="option"
                aria-selected={p.id === value}
                onMouseDown={(e) => { e.preventDefault(); choose(p); }}
                style={{
                  ...fighterSearchStyles.option,
                  borderColor: p.id === value ? color : "transparent",
                  background: p.id === value ? `${color}22` : "transparent",
                }}
              >
                <span style={fighterSearchStyles.optionName}>{p.name}</span>
                {p.externalId && <span style={fighterSearchStyles.optionId}>#{p.externalId}</span>}
                <span style={fighterSearchStyles.optionStats}>{p.stats.points} очк.</span>
              </button>
            )) : (
              <div style={fighterSearchStyles.empty}>Ничего не найдено</div>
            )}
          </div>
        )}
      </div>
      {sel && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48 }}>{fighterFace(sel)}</div>
          <div style={{ fontWeight: 900, fontSize: 18, color, marginTop: 4 }}>{sel.name}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
            {sel.externalId ? `#${sel.externalId} · ` : ""}{sel.skills.map((id) => id).length} скиллов · {sel.stats.wins}–{sel.stats.losses}
          </div>
          <div style={{ fontSize: 12, color: canPlayWarmup(sel) ? C.green : C.danger, marginTop: 4, fontWeight: 900 }}>
            разминка: {sel.stats.battles}/{MAX_WARMUP_BATTLES}
          </div>
        </div>
      )}
    </div>
  );
}

const fighterSearchStyles = {
  menu: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    right: 0,
    zIndex: 30,
    maxHeight: 230,
    overflowY: "auto",
    background: C.card,
    border: `2px solid ${C.border}`,
    borderRadius: 8,
    boxShadow: "0 14px 30px rgba(0,0,0,0.42)",
    padding: 6,
  },
  option: {
    width: "100%",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    gap: 8,
    alignItems: "center",
    background: "transparent",
    border: "2px solid transparent",
    borderRadius: 6,
    color: C.text,
    padding: "8px 10px",
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left",
  },
  optionName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 900 },
  optionId: { color: C.blue, fontSize: 12, fontWeight: 900, whiteSpace: "nowrap" },
  optionStats: { color: C.muted, fontSize: 12, whiteSpace: "nowrap" },
  empty: { color: C.muted, padding: "10px 12px", fontSize: 13 },
  clear: {
    position: "absolute",
    right: 8,
    top: "50%",
    transform: "translateY(-50%)",
    width: 28,
    height: 28,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    background: "transparent",
    color: C.muted,
    cursor: "pointer",
    fontSize: 18,
    lineHeight: "24px",
  },
};

/* ---------- VS-заставка ---------- */
function Versus({ A, B, stanceA, stanceB, topic }) {
  return (
    <div className="fade-in">
      <div style={styles.topicBanner}>◆ {topic.title} ◆</div>
      <div style={styles.versusWrap}>
        <div style={{ ...styles.versusCard, borderColor: fighterColor(A, C.red) }} className="slide-left">
          <div style={{ display: "flex", justifyContent: "center", height: 150 }}>
            <PixelFighter sprite={pickSprite(A.id || A.name)} color={fighterColor(A, C.red)} glow={fighterColor(A, C.red)} state="win" facing={1} px={9} />
          </div>
          <div style={{ ...styles.versusName, color: fighterColor(A, C.red) }}>{A.name}</div>
          <div style={styles.versusStance}>{stanceA}</div>
        </div>
        <div style={styles.versusVS} className="vs-pop">VS</div>
        <div style={{ ...styles.versusCard, borderColor: fighterColor(B, C.blue) }} className="slide-right">
          <div style={{ display: "flex", justifyContent: "center", height: 150 }}>
            <PixelFighter sprite={pickSprite(B.id || B.name)} color={fighterColor(B, C.blue)} glow={fighterColor(B, C.blue)} state="win" facing={-1} px={9} />
          </div>
          <div style={{ ...styles.versusName, color: fighterColor(B, C.blue) }}>{B.name}</div>
          <div style={styles.versusStance}>{stanceB}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Ринг ---------- */
function Ring({ A, B, hpA, hpB, log, round, status, shake, verdict, battleId, historyError, logRef, topic, stanceA, stanceB, tierA, tierB, modelA, modelB, onRematch }) {
  const colorA = fighterColor(A, C.red);
  const colorB = fighterColor(B, C.blue);

  // Боевые состояния пиксельных бойцов из текущей фазы боя.
  const actor = status.includes(A.name) ? "A" : status.includes(B.name) ? "B" : null;
  const aState = verdict
    ? hpA === 0 ? "ko" : verdict.winner === "A" ? "win" : "idle"
    : shake === "A" ? "hit" : shake === "B" ? "attack" : actor === "A" ? "attack" : "idle";
  const bState = verdict
    ? hpB === 0 ? "ko" : verdict.winner === "B" ? "win" : "idle"
    : shake === "B" ? "hit" : shake === "A" ? "attack" : actor === "B" ? "attack" : "idle";

  return (
    <div className="fade-in">
      <div style={styles.topicBanner}>◆ {topic.title} ◆</div>
      <div style={styles.hpRow}>
        <HpBar name={A.name} face={fighterFace(A)} color={colorA} hp={hpA} align="left" shaking={shake === "A"} tier={tierA} model={modelA} />
        <div style={styles.roundBadge}>{verdict ? "ФИНАЛ" : `Р${round}/${ROUNDS}`}</div>
        <HpBar name={B.name} face={fighterFace(B)} color={colorB} hp={hpB} align="right" shaking={shake === "B"} tier={tierB} model={modelB} />
      </div>

      <div style={styles.pixelArena}>
        <PixelArena p1={colorA} p2={colorB} />
        <div style={{ ...styles.pixelSlot, left: "20%", transform: "translateX(-50%)" }}>
          <PixelFighter sprite={pickSprite(A.id || A.name)} color={colorA} glow={tierA?.color || colorA} state={aState} facing={1} px={10} />
        </div>
        <div style={styles.arenaCenterAbs}>{status && <span className="blink">{status}</span>}</div>
        <div style={{ ...styles.pixelSlot, left: "80%", transform: "translateX(-50%)" }}>
          <PixelFighter sprite={pickSprite(B.id || B.name)} color={colorB} glow={tierB?.color || colorB} state={bState} facing={-1} px={10} />
        </div>
      </div>

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
                borderColor: entry.color,
                background: `${entry.color}14`,
              }}
            >
              <div style={{ ...styles.bubbleName, color: entry.color }}>{entry.face} {entry.name}</div>
              {entry.text}
            </div>
          )
        )}
      </div>

      {verdict && (
        <div style={styles.verdictPanel} className="ko-pop">
          <div style={styles.koText}>{verdict.winner === "draw" ? "DRAW" : "K.O."}</div>
          <div style={{ ...styles.winnerName, color: verdict.winner === "A" ? colorA : verdict.winner === "B" ? colorB : C.yellow }}>
            {verdict.winner === "draw"
              ? "НИЧЬЯ"
              : `${verdict.winner === "A" ? fighterFace(A) : fighterFace(B)} ${verdict.winner === "A" ? A.name : B.name} ПОБЕЖДАЕТ`}
          </div>
          <div style={styles.scoreLine}>
            <span style={{ color: colorA }}>{A.name}: {verdict.score_a}</span>
            {"  ◆  "}
            <span style={{ color: colorB }}>{B.name}: {verdict.score_b}</span>
          </div>
          <div style={styles.rationale}>«{verdict.rationale}»</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
            {battleId && (
              <Link to={`/battles/${battleId}`} style={{ ...styles.btnGhost, textDecoration: "none", color: C.yellow, borderColor: C.yellow }}>
                ХОД БОЯ
              </Link>
            )}
            <button style={styles.btn} onClick={onRematch}>↻ НОВЫЙ БОЙ</button>
          </div>
          {historyError && <div style={{ marginTop: 10, color: C.danger, fontSize: 12, fontWeight: 900 }}>{historyError}</div>}
        </div>
      )}
    </div>
  );
}

function HpBar({ name, face, color, hp, align, shaking, tier, model }) {
  const right = align === "right";
  return (
    <div style={{ flex: 1, textAlign: align, animation: shaking ? "shake 0.4s" : "none" }}>
      <div style={{ ...styles.hpName, color, justifyContent: right ? "flex-end" : "flex-start", alignItems: "center" }}>
        {face} {name}
        {tier && <TierBadge tier={tier} model={model} />}
      </div>
      <div style={{ ...styles.hpTrack, direction: right ? "rtl" : "ltr" }}>
        <div style={{ ...styles.hpFill, width: `${hp}%`, background: hp > 50 ? C.green : hp > 25 ? C.yellow : C.danger }} />
      </div>
      <div style={{ ...styles.hpNum, color }}>{hp} HP</div>
    </div>
  );
}

// Бейдж текущей ступени бойца — подсвечивает деградацию (PRIME → WORN → FRIED).
// В тултипе — реально ответившая модель (из ответа бэкенда), иначе имя ступени.
function TierBadge({ tier, model }) {
  return (
    <span
      title={model || tier.tag}
      style={{
        marginLeft: 8,
        padding: "1px 7px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 900,
        letterSpacing: 0.5,
        color: "#0a0a12",
        background: tier.color,
        whiteSpace: "nowrap",
      }}
    >
      🧠 {tier.label} · {tier.tag}
    </span>
  );
}
