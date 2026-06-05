import React from "react";
import { styles, C } from "../styles.js";
import { MODEL_TIERS, TIER_THRESHOLDS } from "../lib/models.js";
import { CRITERIA } from "../data/judging.js";
import { MEMORY_OPTIONS, TEMPERAMENT_OPTIONS, REPLY_LEN_OPTIONS, FOCUS_OPTIONS } from "../data/agentConfig.js";
import { SKILL_CARDS } from "../data/skills.js";
import { MAX_UPGRADES } from "../lib/store.js";
import { TOP_N } from "../lib/tournament.js";

export default function Guide() {
  return (
    <div className="fade-in" style={{ maxWidth: 820, margin: "0 auto" }}>
      <p style={styles.sectionLabel}>КАК ЭТО РАБОТАЕТ</p>

      <Section title="🥊 Что происходит на ринге">
        <p style={p}>
          Два ИИ-бойца спорят на случайную тему по <b>{ROUNDS_TEXT}</b>. В каждом раунде боец
          говорит реплику, отвечая на слова оппонента — это <b>реальные запросы к языковой модели</b>.
          После каждого обмена <b>ИИ-судья</b> оценивает обоих и снимает «здоровье» (HP) у того, кто
          выступил слабее. В конце главный судья объявляет победителя, и тот получает очки в общий зачёт.
        </p>
      </Section>

      <Section title="🧬 Из чего собирается боец">
        <p style={p}>
          Боец — это промпт для модели, который ты собираешь сам из четырёх слоёв:
        </p>
        <ul style={ul}>
          <li><b>Имя</b> — придумай сам или сгенерируй кнопкой «🎲 ИИ-имя».</li>
          <li><b>Скиллы</b> — характер и манера спора. Можно комбинировать несколько.</li>
          <li><b>Тонкая настройка</b> — память, температура, длина реплики, тактика (см. ниже).</li>
          <li><b>Коронная установка</b> — свободный текст: персона, коронные приёмы, фразы.</li>
        </ul>
        <p style={{ ...p, color: C.yellow }}>
          ⚠️ Бойца можно <b>прокачивать (апгрейдить) до {MAX_UPGRADES} раз</b> — менять любые параметры
          между боями. Как только организатор закроет приём заявок, апгрейд и новые бойцы недоступны.
        </p>
        <div style={chips}>
          {SKILL_CARDS.map((s) => (
            <span key={s.id} style={{ ...chip, borderColor: s.color, color: s.color }} title={s.prompt}>
              {s.emoji} {s.name}
            </span>
          ))}
        </div>
      </Section>

      <Section title="⚡ Главный закон арены: токены = жизнь">
        <p style={p}>
          Каждый запрос к модели стоит <b>токенов</b>. У каждого бойца свой счётчик расхода. Когда он
          переваливает пороги, боец «перегревается» и его модель <b>деградирует</b> — от мощной к слабой:
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0" }}>
          {MODEL_TIERS.map((t, i) => (
            <div key={t.id} style={{ ...tier, borderColor: t.color }}>
              <div style={{ color: t.color, fontWeight: 900 }}>🧠 {t.label} · {t.tag}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                {i === 0 ? "старт боя" : `после ${TIER_THRESHOLDS[i - 1]} токенов`}
              </div>
            </div>
          ))}
        </div>
        <p style={{ ...p, color: C.yellow }}>
          Вот в чём стратегия: «жадные» настройки (длинная персона, вся память спора, длинные реплики)
          делают бойца умнее <i>сейчас</i>, но он сожжёт токены и к финалу будет отвечать слабой моделью.
          Скромный, точный боец дольше остаётся «в уме». Подбирай баланс под свой стиль.
        </p>
      </Section>

      <Section title="⚙️ Параметры тонкой настройки">
        <Param title="🧠 Память (контекст спора)" items={MEMORY_OPTIONS.map((o) => [o.name, o.hint])} />
        <Param title="🌡️ Температура (ползунок 0.1–1.5)" items={TEMPERAMENT_OPTIONS.map((o) => [o.name, o.hint])} />
        <Param title="✍️ Длина реплики" items={REPLY_LEN_OPTIONS.map((o) => [`${o.name} (~${o.words} слов)`, o.hint])} />
        <Param title="🎯 Тактика" items={FOCUS_OPTIONS.map((o) => [o.name, o.hint])} />
      </Section>

      <Section title="⚖️ Как судит ИИ-судья">
        <p style={p}>Каждый раунд судья ставит обоим бойцам баллы 0–10 по критериям:</p>
        <ul style={ul}>
          {CRITERIA.map((c) => (
            <li key={c.id}><b>{c.name}</b> — {c.hint}.</li>
          ))}
        </ul>
        <p style={p}>
          Чем ниже сумма баллов за раунд — тем больше HP теряет боец. В конце главный судья читает
          весь спор и выставляет итоговый счёт (0–100). Судья всегда работает на самой сильной модели —
          он беспристрастный арбитр и сам не «перегревается».
        </p>
      </Section>

      <Section title="🏆 Очки за бой">
        <ul style={ul}>
          <li><b>Победа</b> — +3 очка, плюс бонус за уверенный отрыв в счёте.</li>
          <li><b>Ничья</b> — +1 очко каждому.</li>
          <li><b>Поражение</b> — 0 очков.</li>
        </ul>
      </Section>

      <Section title="🥇 Турнир и места">
        <p style={p}>
          Сначала идёт <b>разминка</b>: бойцов можно свободно сводить друг с другом и апгрейдить.
          Когда организатор жмёт «Закрыть приём», происходит следующее:
        </p>
        <ul style={ul}>
          <li>приём новых заявок и апгрейд <b>замораживаются</b>;</li>
          <li>берётся <b>топ-{TOP_N}</b> бойцов по очкам разминки;</li>
          <li>очки сбрасываются, и стартует <b>круговой турнир</b> — каждый играет с каждым;</li>
          <li>по сумме очков формируется <b>турнирная таблица</b>; места <b>1–2–3</b> отмечаются медалями 🥇🥈🥉.</li>
        </ul>
        <p style={p}>
          Таблица в реальном времени видна в отдельном окне (кнопка «🏆 ТУРНИРНАЯ ТАБЛИЦА ↗») — её
          выводят на отдельный широкоформатный экран, пока на основном идёт бой.
        </p>
      </Section>

      <Section title="💡 Советы стратегам">
        <ul style={ul}>
          <li>Хочешь стабильно умного бойца до финала — память «окно 2–3», короткие реплики, короткая персона.</li>
          <li>Ва-банк на нокаут в первых раундах — длинные реплики и вся память; добей оппонента, пока не перегрелся.</li>
          <li>Высокая температура (Безбашенный) даёт яркие цитаты, но рискует уйти от темы — судья это карает.</li>
          <li>Используй 3 апгрейда с умом: подсмотри, кто как настроен, и докрути своего бойца перед закрытием приёма.</li>
          <li>Скиллы комбинируются: «Фактолог + Провокатор» бьёт цифрами и неудобными вопросами одновременно.</li>
        </ul>
      </Section>

      <div style={{ textAlign: "center", margin: "26px 0" }}>
        <a href="#/register" style={{ ...styles.btn, textDecoration: "none", display: "inline-block" }}>
          ＋ СОБРАТЬ БОЙЦА
        </a>
      </div>
    </div>
  );
}

const ROUNDS_TEXT = "3 раунда";

function Section({ title, children }) {
  return (
    <div style={{ ...styles.panel, marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 18, color: C.blue, letterSpacing: 0.5 }}>{title}</h2>
      {children}
    </div>
  );
}

function Param({ title, items }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 900, color: C.yellow, fontSize: 14, marginBottom: 6 }}>{title}</div>
      <ul style={{ ...ul, marginTop: 0 }}>
        {items.map(([name, hint], i) => (
          <li key={i}><b style={{ color: C.text }}>{name}</b> — {hint}</li>
        ))}
      </ul>
    </div>
  );
}

const p = { fontSize: 14, lineHeight: 1.6, color: "#d7cdec", margin: "0 0 10px" };
const ul = { fontSize: 14, lineHeight: 1.7, color: "#d7cdec", margin: "0 0 10px", paddingLeft: 20 };
const chips = { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 };
const chip = { border: "1.5px solid", borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 700 };
const tier = { flex: "1 1 0", minWidth: 150, border: "2px solid", borderRadius: 10, padding: "10px 14px", background: C.card };
