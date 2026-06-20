import { buildFighterSystem } from "./agent.js";
import { callClaude } from "./api.js";
import { pickModel, MODEL_TIERS } from "./models.js";
import { getConfig, replyWords, temperatureValue, memoryWindow, usesJudge } from "../data/agentConfig.js";
import { roundJudgeSystem, finalJudgeSystem, roundDamage, judgeFeedbackMessage } from "../data/judging.js";

const DEFAULT_ROUNDS = 3;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function clampReply(text, maxWords) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  const limit = Math.round(maxWords * 1.3);
  const words = clean.split(" ");
  if (words.length <= limit) return clean;
  return words.slice(0, limit).join(" ").replace(/[,;:—-]+$/, "") + "…";
}

export function historyFor(side, transcript, window) {
  const slice = transcript.slice(Math.max(0, transcript.length - window));
  return slice.map((t) => ({ role: t.side === side ? "assistant" : "user", content: t.text }));
}

function fighterSnapshot(fighter) {
  return {
    id: fighter.id,
    externalId: fighter.externalId ?? null,
    name: fighter.name,
    skills: Array.isArray(fighter.skills) ? fighter.skills : [],
  };
}

function tierSnapshot(tier) {
  if (!tier) return null;
  return { tier: tier.tier, label: tier.label, color: tier.color };
}

export async function runDebateFight({
  aF,
  bF,
  topic,
  swap = false,
  rounds = DEFAULT_ROUNDS,
  call = callClaude,
  waitFor = wait,
  delays = {},
  onEvent = () => {},
} = {}) {
  const A = aF;
  const B = bF;
  if (!A || !B || !topic) throw new Error("runDebateFight: нужны два бойца и тема");

  const delay = {
    intro: 2200,
    afterReply: 700,
    afterJudge: 700,
    afterShake: 500,
    ...delays,
  };
  const stanceA = swap ? topic.sideB : topic.sideA;
  const stanceB = swap ? topic.sideA : topic.sideB;

  onEvent({ type: "phase", phase: "versus", A, B, topic, stanceA, stanceB });
  if (delay.intro) await waitFor(delay.intro);
  onEvent({ type: "phase", phase: "fight" });
  onEvent({ type: "reset", tierA: MODEL_TIERS[0], tierB: MODEL_TIERS[0] });

  const sysA = buildFighterSystem(A, stanceA, topic.title);
  const sysB = buildFighterSystem(B, stanceB, topic.title);
  const cfgA = getConfig(A);
  const cfgB = getConfig(B);
  const wordsA = replyWords(cfgA);
  const wordsB = replyWords(cfgB);
  const tempA = temperatureValue(cfgA);
  const tempB = temperatureValue(cfgB);
  const useJudgeA = usesJudge(cfgA);
  const useJudgeB = usesJudge(cfgB);
  const budget = (w) => Math.max(180, Math.round(w * 7));

  const transcript = [];
  let curHpA = 100;
  let curHpB = 100;
  let tokA = 0;
  let tokB = 0;
  let lastJudgement = null;
  let llmMs = 0;
  let fightCost = 0;
  let modelA = "";
  let modelB = "";
  const history = {
    topic: { id: topic.id, title: topic.title, sideA: topic.sideA, sideB: topic.sideB },
    stances: { A: stanceA, B: stanceB },
    fighters: { A: fighterSnapshot(A), B: fighterSnapshot(B) },
    rounds: [],
    final: null,
    metrics: {},
  };

  for (let r = 1; r <= rounds; r++) {
    onEvent({ type: "round", round: r });
    const roundHistory = {
      round: r,
      replies: {},
      judge: null,
      damage: { A: 0, B: 0 },
      hp: { A: curHpA, B: curHpB },
    };

    const mA = pickModel(tokA);
    onEvent({ type: "tier", side: "A", tier: mA });
    onEvent({ type: "status", status: `${A.name} атакует… [${mA.label}]` });
    const histA = historyFor("A", transcript, memoryWindow(cfgA, transcript.length));
    const instrA = r === 1 ? "Открой дебаты своим сильнейшим аргументом." : "Парируй оппонента и нанеси новый удар.";
    const fbA = r > 1 && useJudgeA ? judgeFeedbackMessage("A", lastJudgement) : "";
    const resA = await call(
      sysA,
      [...histA, { role: "user", content: [fbA, instrA].filter(Boolean).join("\n\n") }],
      { maxTokens: budget(wordsA), tier: mA.tier, temperature: tempA, label: `R${r}·A` }
    );
    llmMs += resA.ms || 0;
    fightCost += resA.usage?.cost_rub || 0;
    const replyA = clampReply(resA.text, wordsA);
    tokA += resA.usage?.total_tokens || 0;
    if (resA.model) modelA = resA.model;
    transcript.push({ side: "A", text: replyA });
    roundHistory.replies.A = { text: replyA, model: modelA, tier: tierSnapshot(mA) };
    onEvent({ type: "model", side: "A", model: modelA });
    onEvent({ type: "reply", side: "A", fighter: A, text: replyA, round: r, tier: mA });
    if (delay.afterReply) await waitFor(delay.afterReply);

    const mB = pickModel(tokB);
    onEvent({ type: "tier", side: "B", tier: mB });
    onEvent({ type: "status", status: `${B.name} отвечает… [${mB.label}]` });
    const histB = historyFor("B", transcript, memoryWindow(cfgB, transcript.length));
    const instrB = "Разбей это и ударь в ответ.";
    const fbB = r > 1 && useJudgeB ? judgeFeedbackMessage("B", lastJudgement) : "";
    const resB = await call(
      sysB,
      [...histB, { role: "user", content: [fbB, instrB].filter(Boolean).join("\n\n") }],
      { maxTokens: budget(wordsB), tier: mB.tier, temperature: tempB, label: `R${r}·B` }
    );
    llmMs += resB.ms || 0;
    fightCost += resB.usage?.cost_rub || 0;
    const replyB = clampReply(resB.text, wordsB);
    tokB += resB.usage?.total_tokens || 0;
    if (resB.model) modelB = resB.model;
    transcript.push({ side: "B", text: replyB });
    roundHistory.replies.B = { text: replyB, model: modelB, tier: tierSnapshot(mB) };
    onEvent({ type: "model", side: "B", model: modelB });
    onEvent({ type: "reply", side: "B", fighter: B, text: replyB, round: r, tier: mB });
    if (delay.afterReply) await waitFor(delay.afterReply);

    onEvent({ type: "status", status: "🧑‍⚖️ судья считает раунд…" });
    const judgeRes = await call(
      roundJudgeSystem(),
      [
        {
          role: "user",
          content: `Тема: ${topic.title}\n\nБОЕЦ A (${A.name}) защищает: «${stanceA}»\nA сказал: "${replyA}"\n\nБОЕЦ B (${B.name}) защищает: «${stanceB}»\nB сказал: "${replyB}"`,
        },
      ],
      { json: true, maxTokens: 300, judge: true, label: `R${r}·судья` }
    );
    llmMs += judgeRes.ms || 0;
    fightCost += judgeRes.usage?.cost_rub || 0;
    lastJudgement = judgeRes.parsed;

    const { damageToA, damageToB } = roundDamage(lastJudgement);
    curHpA = Math.max(0, curHpA - damageToA);
    curHpB = Math.max(0, curHpB - damageToB);
    const shake = damageToA > damageToB ? "A" : damageToB > damageToA ? "B" : null;
    roundHistory.judge = lastJudgement;
    roundHistory.damage = { A: damageToA, B: damageToB };
    roundHistory.hp = { A: curHpA, B: curHpB };
    history.rounds.push(roundHistory);
    onEvent({ type: "judge", judgement: lastJudgement, round: r, hpA: curHpA, hpB: curHpB, shake });
    if (delay.afterJudge) await waitFor(delay.afterJudge);
    onEvent({ type: "shake", side: null });
    if (delay.afterShake) await waitFor(delay.afterShake);
  }

  onEvent({ type: "status", status: "🧑‍⚖️ ФИНАЛЬНЫЙ ВЕРДИКТ…" });
  const full = transcript.map((t) => `${t.side === "A" ? A.name : B.name}: ${t.text}`).join("\n\n");
  const finalRes = await call(
    finalJudgeSystem(),
    [{ role: "user", content: `Тема: ${topic.title}\nA (${A.name}): «${stanceA}»\nB (${B.name}): «${stanceB}»\n\n${full}` }],
    { json: true, maxTokens: 300, judge: true, label: "финал" }
  );
  llmMs += finalRes.ms || 0;
  fightCost += finalRes.usage?.cost_rub || 0;
  const final = finalRes.parsed;

  let winner = final.winner;
  if (final.score_a === final.score_b) winner = curHpA === curHpB ? "draw" : curHpA > curHpB ? "A" : "B";
  const verdict = { ...final, winner, hpA: curHpA, hpB: curHpB };
  history.final = verdict;
  history.metrics = {
    tokensA: tokA,
    tokensB: tokB,
    llmMs,
    fightCost,
    modelA,
    modelB,
  };
  const result = {
    winner,
    scoreA: final.score_a,
    scoreB: final.score_b,
    final,
    verdict,
    transcript,
    hpA: curHpA,
    hpB: curHpB,
    tokensA: tokA,
    tokensB: tokB,
    llmMs,
    fightCost,
    modelA,
    modelB,
    history,
  };
  onEvent({ type: "verdict", verdict, result });
  onEvent({ type: "status", status: "" });
  return result;
}
