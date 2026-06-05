import React, { useState, useEffect, useRef } from "react";
import { styles, C } from "../styles.js";
import { getParticipants, applyResult } from "../lib/store.js";
import { getTournament, currentMatch, recordMatchResult, progress } from "../lib/tournament.js";
import { buildFighterSystem, fighterFace, fighterColor } from "../lib/agent.js";
import { callClaude } from "../lib/api.js";
import { publish, subscribe } from "../lib/bus.js";
import { TOPICS, randomTopic } from "../data/topics.js";
import { roundJudgeSystem, finalJudgeSystem, roundDamage, CRITERIA } from "../data/judging.js";
import { pickModel, MODEL_TIERS } from "../lib/models.js";
import { getConfig, replyWords, temperatureValue, memoryWindow } from "../data/agentConfig.js";
import { pickSprite } from "../data/sprites.js";
import PixelFighter from "../components/PixelFighter.jsx";
import PixelArena from "../components/PixelArena.jsx";

const ROUNDS = 3;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Защита от непослушных моделей: режем слишком длинный ответ до лимита слов бойца (+запас).
function clampReply(text, maxWords) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  const limit = Math.round(maxWords * 1.3);
  const words = clean.split(" ");
  if (words.length <= limit) return clean;
  return words.slice(0, limit).join(" ").replace(/[,;:—-]+$/, "") + "…";
}

// История для агента с учётом его настройки памяти: берём последние N реплик стенограммы.
function historyFor(side, transcript, window) {
  const slice = transcript.slice(Math.max(0, transcript.length - window));
  return slice.map((t) => ({ role: t.side === side ? "assistant" : "user", content: t.text }));
}

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
  const [shake, setShake] = useState(null);
  const [error, setError] = useState("");
  // Текущая модель (тир) каждого бойца — деградирует по мере расхода токенов.
  const [tierA, setTierA] = useState(MODEL_TIERS[0]);
  const [tierB, setTierB] = useState(MODEL_TIERS[0]);
  const [tour, setTour] = useState(getTournament());
  const logRef = useRef(null);

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
    if (!A || !B) return;
    publish("live", {
      phase,
      topic: topic.title,
      a: { name: A.name, face: fighterFace(A), color: fighterColor(A, C.red), stance: stanceA, hp: hpA, tier: tierA },
      b: { name: B.name, face: fighterFace(B), color: fighterColor(B, C.blue), stance: stanceB, hp: hpB, tier: tierB },
      round,
      status,
      lastNote: [...log].reverse().find((l) => l.side === "judge")?.text || "",
      verdict,
    });
  }, [phase, hpA, hpB, round, status, verdict, aId, bId, topicId, swapped, tierA, tierB]); // eslint-disable-line

  function rollTopic() {
    setTopicId(randomTopic(topicId).id);
  }

  // Запуск ручного боя (разминка) из текущих селекторов.
  function startManualFight() {
    if (A && B && aId !== bId) runFight(A, B, topic, swapped, { tournament: false });
  }

  // Запуск следующего турнирного матча по расписанию.
  function startTournamentMatch() {
    const m = currentMatch();
    if (!m) return;
    const aF = people.find((p) => p.id === m.a);
    const bF = people.find((p) => p.id === m.b);
    if (!aF || !bF) return setError("Боец матча не найден.");
    runFight(aF, bF, randomTopic(), false, { tournament: true });
  }

  async function runFight(aF, bF, topicObj, swap, { tournament = false } = {}) {
    const A = aF;
    const B = bF;
    const topic = topicObj;
    const stanceA = swap ? topic.sideB : topic.sideA;
    const stanceB = swap ? topic.sideA : topic.sideB;
    // Синхронизируем селекторы — от них зависит рендер ринга и трансляция на табло.
    setAId(A.id);
    setBId(B.id);
    setTopicId(topic.id);
    setSwapped(swap);

    setError("");
    setPhase("versus");
    await wait(2200);
    setPhase("fight");
    setHpA(100);
    setHpB(100);
    setLog([]);
    setVerdict(null);
    setTierA(MODEL_TIERS[0]);
    setTierB(MODEL_TIERS[0]);

    const colorA = fighterColor(A, C.red);
    const colorB = fighterColor(B, C.blue);
    const faceA = fighterFace(A);
    const faceB = fighterFace(B);
    const sysA = buildFighterSystem(A, stanceA, topic.title);
    const sysB = buildFighterSystem(B, stanceB, topic.title);

    // Тонкие настройки каждого бойца (память / темперамент / длина реплики).
    const cfgA = getConfig(A);
    const cfgB = getConfig(B);
    const wordsA = replyWords(cfgA);
    const wordsB = replyWords(cfgB);
    const tempA = temperatureValue(cfgA);
    const tempB = temperatureValue(cfgB);
    const budget = (w) => Math.max(180, Math.round(w * 7)); // токен-бюджет под длину реплики

    const transcript = [];
    let curHpA = 100;
    let curHpB = 100;
    // Накопленный расход токенов каждого бойца → определяет текущую модель (деградация).
    let tokA = 0;
    let tokB = 0;

    try {
      for (let r = 1; r <= ROUNDS; r++) {
        setRound(r);

        // Боец A — модель по его перегреву, история по его настройке памяти
        const mA = pickModel(tokA);
        setTierA(mA);
        setStatus(`${A.name} атакует… [${mA.label}]`);
        const histA = historyFor("A", transcript, memoryWindow(cfgA, transcript.length));
        const resA = await callClaude(
          sysA,
          [...histA, { role: "user", content: r === 1 ? "Открой дебаты своим сильнейшим аргументом." : "Парируй оппонента и нанеси новый удар." }],
          { maxTokens: budget(wordsA), model: mA.id, temperature: tempA }
        );
        const replyA = clampReply(resA.text, wordsA);
        tokA += resA.usage?.total_tokens || 0;
        transcript.push({ side: "A", text: replyA });
        setLog((l) => [...l, { side: "A", name: A.name, face: faceA, color: colorA, text: replyA, round: r, tier: mA }]);
        await wait(700);

        // Боец B — модель по его перегреву, история по его настройке памяти
        const mB = pickModel(tokB);
        setTierB(mB);
        setStatus(`${B.name} отвечает… [${mB.label}]`);
        const histB = historyFor("B", transcript, memoryWindow(cfgB, transcript.length));
        const resB = await callClaude(
          sysB,
          [...histB, { role: "user", content: "Разбей это и ударь в ответ." }],
          { maxTokens: budget(wordsB), model: mB.id, temperature: tempB }
        );
        const replyB = clampReply(resB.text, wordsB);
        tokB += resB.usage?.total_tokens || 0;
        transcript.push({ side: "B", text: replyB });
        setLog((l) => [...l, { side: "B", name: B.name, face: faceB, color: colorB, text: replyB, round: r, tier: mB }]);
        await wait(700);

        // Судья оценивает обмен (судью держим на сильной модели — он арбитр)
        setStatus("🧑‍⚖️ судья считает раунд…");
        const judgeRes = await callClaude(
          roundJudgeSystem(),
          [
            {
              role: "user",
              content: `Тема: ${topic.title}\n\nБОЕЦ A (${A.name}) защищает: «${stanceA}»\nA сказал: "${replyA}"\n\nБОЕЦ B (${B.name}) защищает: «${stanceB}»\nB сказал: "${replyB}"`,
            },
          ],
          { json: true, maxTokens: 300, model: MODEL_TIERS[0].id }
        );
        const judgement = judgeRes.parsed;

        const { damageToA, damageToB } = roundDamage(judgement);
        curHpA = Math.max(0, curHpA - damageToA);
        curHpB = Math.max(0, curHpB - damageToB);
        if (damageToA > damageToB) setShake("A");
        else if (damageToB > damageToA) setShake("B");
        setHpA(curHpA);
        setHpB(curHpB);
        setLog((l) => [...l, { side: "judge", text: judgement.note || "раунд сыгран", round: r }]);
        await wait(700);
        setShake(null);
        await wait(500);
      }

      // Финальный вердикт
      setStatus("🧑‍⚖️ ФИНАЛЬНЫЙ ВЕРДИКТ…");
      const full = transcript.map((t) => `${t.side === "A" ? A.name : B.name}: ${t.text}`).join("\n\n");
      const finalRes = await callClaude(
        finalJudgeSystem(),
        [{ role: "user", content: `Тема: ${topic.title}\nA (${A.name}): «${stanceA}»\nB (${B.name}): «${stanceB}»\n\n${full}` }],
        { json: true, maxTokens: 300, model: MODEL_TIERS[0].id }
      );
      const final = finalRes.parsed;

      // Тай-брейк по остаткам HP, если судья поставил равный счёт.
      let winner = final.winner;
      if (final.score_a === final.score_b) winner = curHpA === curHpB ? "draw" : curHpA > curHpB ? "A" : "B";

      setVerdict({ ...final, winner, hpA: curHpA, hpB: curHpB });
      setStatus("");
      setPhase("verdict");

      // Начисляем очки в зачёт (для турнирной таблицы и разминочного рейтинга).
      applyResult({ aId: A.id, bId: B.id, winner, scoreA: final.score_a, scoreB: final.score_b });
      if (tournament) {
        recordMatchResult({ winner, scoreA: final.score_a, scoreB: final.score_b });
        setTour(getTournament());
      }
      setPeople(getParticipants());
    } catch (e) {
      setError("Бой прерван: " + e.message);
      setStatus("");
      setPhase("select");
    }
  }

  const canFight = A && B && aId !== bId;

  if (phase === "select") {
    if (tour.status === "running" || tour.status === "done") {
      return (
        <TournamentSelect
          {...{ tour, people, error }}
          onPlay={startTournamentMatch}
        />
      );
    }
    return (
      <Selection
        {...{ people, aId, setAId, bId, setBId, topic, topicId, setTopicId, rollTopic, swapped, setSwapped, stanceA, stanceB, canFight, runFight: startManualFight, error }}
      />
    );
  }

  if (phase === "versus") {
    return <Versus A={A} B={B} stanceA={stanceA} stanceB={stanceB} topic={topic} />;
  }

  return (
    <Ring
      {...{ A, B, hpA, hpB, log, round, status, shake, verdict, logRef, topic, stanceA, stanceB, tierA, tierB }}
      onRematch={() => { setPhase("select"); setVerdict(null); }}
    />
  );
}

/* ---------- Экран выбора ---------- */
function Selection({ people, aId, setAId, bId, setBId, topic, topicId, setTopicId, rollTopic, swapped, setSwapped, stanceA, stanceB, canFight, runFight, error }) {
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
      </div>
    </div>
  );
}

function FighterSelect({ side, color, value, onChange, people, disabledId }) {
  const sel = people.find((p) => p.id === value);
  return (
    <div style={{ ...styles.pickerCol, borderColor: color }}>
      <div style={{ ...styles.playerTag, background: color }}>{side}</div>
      <select style={{ ...styles.input, marginBottom: 12 }} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— выбери бойца —</option>
        {people.map((p) => (
          <option key={p.id} value={p.id} disabled={p.id === disabledId}>
            {p.name} ({p.stats.points} очк.)
          </option>
        ))}
      </select>
      {sel && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48 }}>{fighterFace(sel)}</div>
          <div style={{ fontWeight: 900, fontSize: 18, color, marginTop: 4 }}>{sel.name}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
            {sel.skills.map((id) => id).length} скиллов · {sel.stats.wins}–{sel.stats.losses}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Экран турнира ---------- */
function TournamentSelect({ tour, people, onPlay, error }) {
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const { played, total } = progress();
  const m = tour.matches[tour.cursor];
  const A = m ? byId[m.a] : null;
  const B = m ? byId[m.b] : null;
  const done = tour.status === "done";

  return (
    <div className="fade-in" style={{ maxWidth: 900, margin: "0 auto" }}>
      <p style={styles.sectionLabel}>🏆 ТУРНИР · КРУГОВАЯ СИСТЕМА</p>
      <div style={{ textAlign: "center", color: C.muted, marginBottom: 18 }}>
        Сыграно матчей: <b style={{ color: C.yellow }}>{played}</b> / {total}
      </div>

      {done ? (
        <div style={{ ...styles.verdictPanel, position: "static" }}>
          <div style={styles.koText}>FINISH</div>
          <div style={{ ...styles.winnerName, color: C.yellow }}>ТУРНИР ЗАВЕРШЁН!</div>
          <p style={{ color: "#d7cdec", marginTop: 12 }}>Итоговые места — на турнирной таблице.</p>
          <a href="#/scoreboard" target="_blank" rel="noreferrer" style={{ ...styles.btn, textDecoration: "none", display: "inline-block", marginTop: 12 }}
            onClick={(e) => { e.preventDefault(); window.open("#/scoreboard", "debate-scoreboard", "width=1280,height=800"); }}>
            🏆 ОТКРЫТЬ ТАБЛИЦУ
          </a>
        </div>
      ) : (
        <>
          <div style={{ ...styles.panel, textAlign: "center", marginBottom: 18 }}>
            <div style={{ color: C.muted, fontSize: 13, letterSpacing: 1, marginBottom: 14 }}>СЛЕДУЮЩИЙ МАТЧ #{tour.cursor + 1}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 26 }}>
              <MatchSide fighter={A} color={C.red} />
              <div style={{ fontSize: 40, fontWeight: 900, color: C.yellow, fontFamily: "'Arial Black', sans-serif" }}>VS</div>
              <MatchSide fighter={B} color={C.blue} />
            </div>
            {error && <p style={{ color: C.danger, fontWeight: 700, marginTop: 14 }}>{error}</p>}
            <button style={{ ...styles.btn, marginTop: 18 }} onClick={onPlay} disabled={!A || !B}>▶ ИГРАТЬ МАТЧ</button>
          </div>
        </>
      )}

      {/* Мини-таблица текущих мест */}
      <div style={styles.panel}>
        <div style={{ fontWeight: 900, color: C.yellow, marginBottom: 10, letterSpacing: 1 }}>ТЕКУЩИЕ МЕСТА</div>
        <MiniStandings tour={tour} byId={byId} />
      </div>
    </div>
  );
}

function MatchSide({ fighter, color }) {
  if (!fighter) return <div style={{ color: C.muted }}>—</div>;
  return (
    <div style={{ textAlign: "center", minWidth: 160 }}>
      <div style={{ display: "flex", justifyContent: "center", height: 110 }}>
        <PixelFighter sprite={pickSprite(fighter.id || fighter.name)} color={fighterColor(fighter, color)} glow={fighterColor(fighter, color)} state="idle" facing={1} px={7} />
      </div>
      <div style={{ fontWeight: 900, color: fighterColor(fighter, color), fontSize: 17, marginTop: 4 }}>{fighter.name}</div>
      <div style={{ fontSize: 12, color: C.muted }}>{fighter.stats.points} очк. · {fighter.stats.wins}–{fighter.stats.losses}</div>
    </div>
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];
function MiniStandings({ tour, byId }) {
  const rows = [...tour.roster]
    .map((id) => byId[id])
    .filter(Boolean)
    .sort((a, b) => b.stats.points - a.stats.points || b.stats.wins - a.stats.wins || a.stats.losses - b.stats.losses);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {rows.map((p, i) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", borderRadius: 6, background: i === 0 ? "rgba(255,210,63,0.08)" : "transparent" }}>
          <span style={{ width: 34, fontWeight: 900, color: i < 3 ? C.yellow : C.muted }}>{MEDALS[i] || i + 1}</span>
          <span style={{ flex: 1, fontWeight: 700 }}>{p.name}</span>
          <span style={{ color: C.muted, fontSize: 12 }}>{p.stats.wins}–{p.stats.losses}–{p.stats.draws}</span>
          <span style={{ color: C.yellow, fontWeight: 900, minWidth: 50, textAlign: "right" }}>{p.stats.points}</span>
        </div>
      ))}
    </div>
  );
}

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
function Ring({ A, B, hpA, hpB, log, round, status, shake, verdict, logRef, topic, stanceA, stanceB, tierA, tierB, onRematch }) {
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
        <HpBar name={A.name} face={fighterFace(A)} color={colorA} hp={hpA} align="left" shaking={shake === "A"} tier={tierA} />
        <div style={styles.roundBadge}>{verdict ? "ФИНАЛ" : `Р${round}/${ROUNDS}`}</div>
        <HpBar name={B.name} face={fighterFace(B)} color={colorB} hp={hpB} align="right" shaking={shake === "B"} tier={tierB} />
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
          <button style={{ ...styles.btn, marginTop: 16 }} onClick={onRematch}>↻ НОВЫЙ БОЙ</button>
        </div>
      )}
    </div>
  );
}

function HpBar({ name, face, color, hp, align, shaking, tier }) {
  const right = align === "right";
  return (
    <div style={{ flex: 1, textAlign: align, animation: shaking ? "shake 0.4s" : "none" }}>
      <div style={{ ...styles.hpName, color, justifyContent: right ? "flex-end" : "flex-start", alignItems: "center" }}>
        {face} {name}
        {tier && <TierBadge tier={tier} />}
      </div>
      <div style={{ ...styles.hpTrack, direction: right ? "rtl" : "ltr" }}>
        <div style={{ ...styles.hpFill, width: `${hp}%`, background: hp > 50 ? C.green : hp > 25 ? C.yellow : C.danger }} />
      </div>
      <div style={{ ...styles.hpNum, color }}>{hp} HP</div>
    </div>
  );
}

// Бейдж текущей модели бойца — подсвечивает деградацию (PRIME → WORN → FRIED).
function TierBadge({ tier }) {
  return (
    <span
      title={tier.id}
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
