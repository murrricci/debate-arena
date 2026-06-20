import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { styles, C } from "../styles.js";
import { SKILL_CARDS, SKILL_BY_ID } from "../data/skills.js";
import {
  getParticipants,
  addParticipant,
  removeParticipant,
  upgradeParticipant,
  getParticipant,
  MAX_UPGRADES,
} from "../lib/store.js";
import { generateFighterName } from "../lib/api.js";
import { subscribe } from "../lib/bus.js";
import { getTournament, closeAndStart, resetTournament, TOP_N } from "../lib/tournament.js";
import {
  DEFAULT_CONFIG,
  MEMORY_OPTIONS,
  REPLY_LEN_OPTIONS,
  FOCUS_OPTIONS,
  JUDGE_OPTIONS,
  TEMPERATURE_MIN,
  TEMPERATURE_MAX,
  TEMPERATURE_STEP,
  temperatureZone,
} from "../data/agentConfig.js";

export default function Register() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [skills, setSkills] = useState([]);
  const [custom, setCustom] = useState("");
  const [config, setConfig] = useState({ ...DEFAULT_CONFIG });
  const [editingId, setEditingId] = useState(null); // апгрейд существующего
  const [list, setList] = useState(getParticipants());
  const [tour, setTour] = useState(getTournament());
  const [naming, setNaming] = useState(false);
  const [error, setError] = useState("");

  useEffect(() =>
    subscribe((type) => {
      if (type === "participants") setList(getParticipants());
      if (type === "tournament") setTour(getTournament());
    }), []);

  const closed = tour.closed;

  function resetForm() {
    setEditingId(null);
    setName("");
    setSkills([]);
    setCustom("");
    setConfig({ ...DEFAULT_CONFIG });
    setError("");
  }
  function toggleSkill(id) {
    setSkills((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function setCfg(patch) {
    setConfig((c) => ({ ...c, ...patch }));
  }

  function startEdit(p) {
    setEditingId(p.id);
    setName(p.name);
    setSkills(p.skills || []);
    setCustom(p.custom || "");
    setConfig({ ...DEFAULT_CONFIG, ...(p.config || {}) });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function suggestName() {
    setNaming(true);
    setError("");
    try {
      setName(await generateFighterName());
    } catch (e) {
      setError("Не вышло сгенерировать имя: " + e.message);
    } finally {
      setNaming(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (closed) return setError("Приём заявок закрыт — турнир уже сформирован.");
    if (!name.trim()) return setError("Впиши имя бойца (или сгенерируй через ИИ).");
    if (skills.length === 0) return setError("Выбери хотя бы один скилл.");

    try {
      if (editingId) {
        const res = await upgradeParticipant(editingId, { name, skills, custom, config });
        if (!res) return setError("Лимит апгрейдов исчерпан.");
      } else {
        await addParticipant({ name, skills, custom, config });
      }
      setList(getParticipants());
      resetForm();
    } catch (e) {
      setError("Не удалось сохранить бойца: " + e.message);
    }
  }

  async function launchTournament() {
    if (!confirm(`Закрыть приём заявок и сформировать турнир из топ-${TOP_N}? После этого апгрейд и новые заявки будут недоступны.`)) return;
    try {
      const res = await closeAndStart();
      if (res?.error) return setError(res.error);
      setTour(res || getTournament());
      navigate("/tournament");
    } catch (e) {
      setError("Не удалось сформировать турнир: " + e.message);
    }
  }

  const editing = editingId ? getParticipant(editingId) : null;
  const editLocked = editing && (editing.upgrades || 0) >= MAX_UPGRADES;

  return (
    <div className="fade-in" style={{ maxWidth: 760, margin: "0 auto" }}>
      <p style={styles.sectionLabel}>{editingId ? "АПГРЕЙД БОЙЦА" : "РЕГИСТРАЦИЯ БОЙЦА"}</p>

      {closed && (
        <div style={cfgStyles.lockedBanner}>
          🔒 Приём заявок закрыт. Турнир сформирован — регистрация и апгрейд недоступны.
        </div>
      )}

      {!closed && (
        <form onSubmit={submit} style={{ ...styles.panel, marginBottom: 28, opacity: editLocked ? 0.6 : 1 }}>
          {editingId && (
            <div style={cfgStyles.editNote}>
              ✎ Апгрейд «{editing?.name}» · использовано {editing?.upgrades || 0}/{MAX_UPGRADES}
              <button type="button" style={{ ...styles.btnGhost, marginLeft: "auto" }} onClick={resetForm}>← новый боец</button>
            </div>
          )}

          {/* Имя */}
          <label style={styles.label}>ИМЯ БОЙЦА</label>
          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Придумай дерзкое имя…" maxLength={40} />
            <button type="button" style={{ ...styles.btnGhost, whiteSpace: "nowrap" }} onClick={suggestName} disabled={naming}>
              {naming ? "…" : "🎲 ИИ-имя"}
            </button>
          </div>

          {/* Скиллы */}
          <label style={styles.label}>СКИЛЛЫ — ХАРАКТЕР БОЙЦА (один или несколько)</label>
          <div style={{ ...styles.skillGrid, marginBottom: 22 }}>
            {SKILL_CARDS.map((card) => {
              const on = skills.includes(card.id);
              return (
                <button type="button" key={card.id} onClick={() => toggleSkill(card.id)} title={card.prompt}
                  style={{ ...styles.skillCard, borderColor: on ? card.color : C.border, background: on ? `${card.color}22` : C.card, boxShadow: on ? `0 0 16px ${card.color}88` : "none" }}>
                  <span style={{ fontSize: 26 }}>{card.emoji}</span>
                  <span style={{ ...styles.skillName, color: on ? card.color : "#aaa" }}>{card.name}</span>
                </button>
              );
            })}
          </div>

          {/* Тонкая настройка */}
          <div style={cfgStyles.tuneHeader}>
            ⚙️ ТОНКАЯ НАСТРОЙКА АГЕНТА
            <a href="#/guide" style={cfgStyles.tuneHint}>что это? →</a>
          </div>
          <p style={cfgStyles.tradeoff}>
            ⚡ Чем «жаднее» настройки (больше памяти, длиннее реплики), тем умнее боец — но тем
            быстрее он жжёт токены и проваливается на слабую модель. Ищи баланс.
          </p>

          <Segmented label="ПАМЯТЬ (контекст спора)" options={MEMORY_OPTIONS.map((o) => ({ id: o.id, name: o.name, hint: o.hint }))} value={config.memory} onChange={(id) => setCfg({ memory: id })} />
          {config.memory === "window" && (
            <div style={{ margin: "-4px 0 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 12, color: C.muted }}>Размер окна:</span>
              <input type="range" min={2} max={6} value={config.windowSize} onChange={(e) => setCfg({ windowSize: Number(e.target.value) })} style={{ flex: 1, accentColor: C.blue }} />
              <b style={{ color: C.blue, minWidth: 70 }}>{config.windowSize} реплик</b>
            </div>
          )}

          {/* Температура — ползунок */}
          <label style={styles.label}>ТЕМПЕРАТУРА</label>
          <div style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 12 }}>
            <input type="range" min={TEMPERATURE_MIN} max={TEMPERATURE_MAX} step={TEMPERATURE_STEP} value={config.temperature}
              onChange={(e) => setCfg({ temperature: Number(e.target.value) })} style={{ flex: 1, accentColor: C.yellow }} />
            <b style={{ color: C.yellow, minWidth: 90 }}>{config.temperature.toFixed(1)} · {temperatureZone(config.temperature).name}</b>
          </div>
          <div style={cfgStyles.segHint}>{temperatureZone(config.temperature).hint}</div>
          <div style={{ height: 16 }} />

          <Segmented label="ДЛИНА РЕПЛИКИ" options={REPLY_LEN_OPTIONS.map((o) => ({ id: o.id, name: `${o.name} (~${o.words}сл)`, hint: o.hint }))} value={config.replyLen} onChange={(id) => setCfg({ replyLen: id })} />
          <Segmented label="ТАКТИКА" options={FOCUS_OPTIONS.map((o) => ({ id: o.id, name: o.name, hint: o.hint }))} value={config.focus} onChange={(id) => setCfg({ focus: id })} />
          <Segmented label="МНЕНИЕ СУДЬИ" options={JUDGE_OPTIONS.map((o) => ({ id: o.id, name: o.name, hint: o.hint }))} value={config.useJudge} onChange={(id) => setCfg({ useJudge: id })} />

          {/* Персона */}
          <label style={styles.label}>КОРОННАЯ УСТАНОВКА / ПЕРСОНА (необязательно)</label>
          <textarea style={{ ...styles.textarea, marginBottom: 6 }} value={custom} onChange={(e) => setCustom(e.target.value)}
            placeholder="Кто твой боец, его коронные приёмы и фразы. Чем длиннее — тем дороже по токенам!" maxLength={800} />
          <div style={{ textAlign: "right", fontSize: 11, color: custom.length > 600 ? C.danger : C.muted, marginBottom: 18 }}>
            {custom.length}/800 символов{custom.length > 600 ? " — длинная персона ускорит перегрев!" : ""}
          </div>

          {error && <p style={{ color: C.danger, fontWeight: 700, marginBottom: 12 }}>{error}</p>}

          <button type="submit" style={styles.btn} disabled={editLocked}>
            {editingId ? `✦ СОХРАНИТЬ АПГРЕЙД (${editing?.upgrades || 0}/${MAX_UPGRADES})` : "＋ ДОБАВИТЬ БОЙЦА"}
          </button>
          {editLocked && <p style={{ color: C.danger, marginTop: 10 }}>Лимит апгрейдов исчерпан.</p>}
        </form>
      )}

      {/* Управление турниром */}
      <div style={{ ...styles.panel, marginBottom: 28, borderColor: C.yellow }}>
        <div style={{ fontWeight: 900, color: C.yellow, letterSpacing: 1, marginBottom: 8 }}>🏆 ТУРНИР</div>
        {tour.status === "idle" && (
          <>
            <p style={{ fontSize: 13, color: "#d7cdec", margin: "0 0 12px", lineHeight: 1.5 }}>
              Когда все бойцы готовы — закрой приём. Возьмём <b>топ-{TOP_N}</b> по очкам разминки
              среди тех, кто сыграл хотя бы один бой, и сформируем турнир (каждый с каждым).
              После закрытия апгрейд недоступен.
            </p>
            <button type="button" style={styles.btn} onClick={launchTournament} disabled={list.length < 2}>
              🏁 СФОРМИРОВАТЬ ТУРНИР
            </button>
          </>
        )}
        {tour.status !== "idle" && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span style={{ color: C.green, fontWeight: 700 }}>
              {tour.status === "running" ? "Турнир идёт" : "Турнир завершён"} · ростер {tour.roster.length}
            </span>
            <a href="#/scoreboard" target="_blank" rel="noreferrer" style={styles.btnGhost}
              onClick={(e) => { e.preventDefault(); window.open("#/scoreboard", "debate-scoreboard", "width=1280,height=800"); }}>
              🏆 ТУРНИРНАЯ ТАБЛИЦА ↗
            </a>
            <a href="#/tournament" style={styles.btnGhost}>🏆 К ТУРНИРУ</a>
            <button type="button" style={{ ...styles.btnGhost, marginLeft: "auto", color: C.danger, borderColor: C.danger }}
              onClick={async () => { if (confirm("Сбросить турнир и снова открыть приём заявок?")) { setTour(await resetTournament()); } }}>
              ↺ сбросить турнир
            </button>
          </div>
        )}
      </div>

      {/* Список */}
      <p style={styles.sectionLabel}>ЗАРЕГИСТРИРОВАНО: {list.length}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {list.length === 0 && <p style={styles.empty}>Пока никого. Добавь первого бойца ↑</p>}
        {list.map((p) => {
          const canUpgrade = !closed && (p.upgrades || 0) < MAX_UPGRADES;
          return (
            <div key={p.id} style={{ ...styles.panel, display: "flex", alignItems: "center", gap: 14, padding: "12px 16px" }}>
              <span style={{ fontSize: 28 }}>{SKILL_BY_ID[p.skills[0]]?.emoji || "🤖"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                  {p.skills.map((id) => SKILL_BY_ID[id]?.name).filter(Boolean).join(" · ")}
                  {p.custom ? "  ·  ✦ персона" : ""}
                  {"  ·  ⚙ " + (p.upgrades || 0) + "/" + MAX_UPGRADES + " апгр."}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 12, color: C.muted, marginRight: 8 }}>
                <div style={{ color: C.yellow, fontWeight: 900, fontSize: 16 }}>{p.stats.points} очк.</div>
                {p.stats.wins}–{p.stats.losses}
              </div>
              {canUpgrade && <button style={styles.btnGhost} onClick={() => startEdit(p)} title="Апгрейд">✎</button>}
              {!closed && <button style={styles.btnGhost} onClick={async () => { await removeParticipant(p.id); setList(getParticipants()); }}>✕</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Segmented({ label, options, value, onChange }) {
  const active = options.find((o) => o.id === value);
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={styles.label}>{label}</label>
      <div style={cfgStyles.segRow}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <button type="button" key={o.id} onClick={() => onChange(o.id)}
              style={{ ...cfgStyles.seg, borderColor: on ? C.blue : C.border, background: on ? `${C.blue}26` : "transparent", color: on ? "#fff" : C.muted }}>
              {o.name}
            </button>
          );
        })}
      </div>
      {active?.hint && <div style={cfgStyles.segHint}>{active.hint}</div>}
    </div>
  );
}

const cfgStyles = {
  lockedBanner: { background: "rgba(255,43,109,0.12)", border: `1px solid ${C.danger}`, borderRadius: 10, padding: "12px 16px", color: "#ffd6e3", fontWeight: 700, marginBottom: 20, textAlign: "center" },
  editNote: { display: "flex", alignItems: "center", gap: 10, color: C.yellow, fontWeight: 700, fontSize: 13, marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.border}` },
  tuneHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 900, fontSize: 13, letterSpacing: 2, color: C.yellow, borderTop: `1px solid ${C.border}`, paddingTop: 18, marginBottom: 6 },
  tuneHint: { fontSize: 11, color: C.blue, textDecoration: "none", fontWeight: 700 },
  tradeoff: { fontSize: 12, color: "#c9b8e8", background: "rgba(255,60,165,0.08)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", margin: "0 0 18px", lineHeight: 1.5 },
  segRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  seg: { flex: "1 1 0", minWidth: 90, padding: "9px 8px", border: "2px solid", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: "inherit", transition: "all 0.15s" },
  segHint: { fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.45, fontStyle: "italic" },
};
