// Неоновая киберпанк-палитра под цветовую гамму стенда:
// тёмно-фиолетовый фон, неон magenta/пурпур + электрический cyan, акцент — hot pink.
// Семантические ключи red/blue/yellow/green сохранены (их использует код),
// но перекрашены в неон: red = P1 (magenta), blue = P2 (cyan), yellow = акцент (pink),
// green = «здоровье» (lime). danger — отдельный красный для низкого HP.
export const C = {
  red: "#d94dff", // P1 — неоновый пурпур
  blue: "#00d9ff", // P2 — электрический cyan
  yellow: "#ff3ca5", // акцент — hot pink (судья, победитель, бейджи)
  green: "#2bff9e", // неон-лайм (высокое HP)
  danger: "#ff2b6d", // красно-розовый (низкое HP, опасность)
  bg: "#0a0613",
  panel: "#130b22",
  card: "#1b1033",
  border: "#33204f",
  text: "#ece8f5",
  muted: "#8a7da8",
};

export const styles = {
  root: {
    minHeight: "100vh",
    background: "radial-gradient(ellipse at top, #1d0f3a 0%, #0a0613 72%)",
    color: C.text,
    fontFamily: "'Courier New', monospace",
    padding: "20px 16px 60px",
    position: "relative",
    overflow: "hidden",
  },
  scanlines: {
    position: "fixed",
    inset: 0,
    background:
      "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)",
    pointerEvents: "none",
    zIndex: 100,
  },
  header: { textAlign: "center", marginBottom: 18 },
  title: {
    fontSize: 48,
    fontWeight: 900,
    letterSpacing: 4,
    margin: 0,
    fontFamily: "'Arial Black', sans-serif",
    textShadow: "0 0 22px rgba(217,77,255,0.5)",
  },
  subtitle: { letterSpacing: 6, fontSize: 13, color: C.yellow, marginTop: 6 },

  // навигация
  nav: { display: "flex", gap: 10, justifyContent: "center", marginBottom: 22, flexWrap: "wrap" },
  navLink: {
    padding: "8px 18px",
    border: `2px solid ${C.border}`,
    borderRadius: 8,
    color: C.muted,
    textDecoration: "none",
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: 1,
  },
  navLinkActive: { borderColor: C.yellow, color: C.yellow, background: "rgba(255,60,165,0.1)" },
  navLinkDisabled: {
    opacity: 0.35,
    cursor: "not-allowed",
    filter: "grayscale(0.6)",
  },

  sectionLabel: { textAlign: "center", letterSpacing: 4, color: C.muted, fontSize: 13, marginBottom: 16 },

  // общие
  panel: { background: C.panel, border: `2px solid ${C.border}`, borderRadius: 12, padding: 20 },
  input: {
    width: "100%",
    boxSizing: "border-box",
    background: C.card,
    border: `2px solid ${C.border}`,
    borderRadius: 8,
    color: C.text,
    padding: "12px 14px",
    fontSize: 15,
    fontFamily: "inherit",
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    background: C.card,
    border: `2px solid ${C.border}`,
    borderRadius: 8,
    color: C.text,
    padding: "12px 14px",
    fontSize: 14,
    fontFamily: "inherit",
    minHeight: 90,
    resize: "vertical",
    lineHeight: 1.5,
  },
  label: { display: "block", fontSize: 12, letterSpacing: 1, color: C.muted, marginBottom: 8, fontWeight: 700 },

  btn: {
    background: "linear-gradient(180deg, #d94dff, #8a1fd0)",
    color: "#fff",
    border: "none",
    padding: "14px 40px",
    fontSize: 18,
    fontWeight: 900,
    letterSpacing: 2,
    borderRadius: 8,
    cursor: "pointer",
    boxShadow: "0 0 30px rgba(217,77,255,0.55)",
    fontFamily: "'Arial Black', sans-serif",
  },
  btnGhost: {
    background: "transparent",
    color: C.text,
    border: `2px solid ${C.border}`,
    padding: "10px 18px",
    fontWeight: 700,
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13,
  },

  // скилл-карточки
  skillGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 },
  skillCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    padding: "12px 6px",
    border: "2px solid",
    borderRadius: 8,
    cursor: "pointer",
    transition: "all 0.15s",
    textAlign: "center",
  },
  skillName: { fontWeight: 900, fontSize: 11, letterSpacing: 0.5 },

  // выбор бойцов / темы на арене
  selectGrid: { display: "flex", alignItems: "stretch", gap: 16, maxWidth: 960, margin: "0 auto 22px", justifyContent: "center" },
  vsMini: { alignSelf: "center", fontWeight: 900, fontSize: 28, color: C.yellow },
  pickerCol: { flex: 1, border: "2px solid", borderRadius: 12, padding: 16, background: C.panel },
  playerTag: { display: "inline-block", padding: "3px 14px", borderRadius: 4, fontWeight: 900, fontSize: 14, color: C.bg, marginBottom: 12 },

  // versus
  versusWrap: { display: "flex", alignItems: "center", justifyContent: "center", gap: 30, padding: "40px 0", minHeight: 300 },
  versusCard: { textAlign: "center", border: "3px solid", borderRadius: 16, padding: "26px 36px", background: C.panel, minWidth: 220 },
  versusName: { fontWeight: 900, fontSize: 20, letterSpacing: 1, marginTop: 10 },
  versusStance: { fontSize: 12, color: "#aaa", letterSpacing: 1, marginTop: 8, maxWidth: 220 },
  versusVS: { fontSize: 64, fontWeight: 900, color: C.yellow, fontFamily: "'Arial Black', sans-serif", textShadow: "0 0 30px rgba(255,60,165,0.7)" },

  // ринг
  topicBanner: { textAlign: "center", color: C.yellow, fontWeight: 900, letterSpacing: 2, fontSize: 22, marginBottom: 14 },
  hpRow: { display: "flex", alignItems: "flex-start", gap: 20, maxWidth: 1320, margin: "0 auto 16px" },
  roundBadge: { background: C.yellow, color: C.bg, fontWeight: 900, padding: "8px 16px", borderRadius: 6, fontSize: 18, alignSelf: "center", whiteSpace: "nowrap" },
  hpName: { display: "flex", gap: 8, fontWeight: 900, fontSize: 17, marginBottom: 5, alignItems: "center" },
  hpTrack: { height: 28, background: "#1a0f33", border: `2px solid ${C.border}`, borderRadius: 4, overflow: "hidden" },
  hpFill: { height: "100%", transition: "width 0.6s ease", boxShadow: "inset 0 0 8px rgba(255,255,255,0.3)" },
  hpNum: { fontSize: 14, fontWeight: 700, marginTop: 4 },
  arena: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    maxWidth: 1000,
    margin: "0 auto",
    height: 110,
    background: "linear-gradient(180deg, transparent, rgba(255,60,165,0.07))",
    borderBottom: `3px solid ${C.border}`,
    padding: "0 60px",
    position: "relative",
  },
  fighterSprite: { paddingBottom: 8 },
  arenaCenter: { flex: 1, textAlign: "center", color: C.yellow, fontSize: 13, letterSpacing: 1, paddingBottom: 30, fontWeight: 700 },
  // Пиксельная арена (Canvas-фон + бойцы поверх).
  pixelArena: {
    position: "relative",
    maxWidth: 1320,
    margin: "0 auto",
    height: 300,
    border: `2px solid ${C.border}`,
    borderRadius: 8,
    overflow: "hidden",
    boxShadow: "inset 0 0 40px rgba(0,0,0,0.6)",
  },
  pixelSlot: { position: "absolute", bottom: 20, zIndex: 2 },
  arenaCenterAbs: {
    position: "absolute",
    top: 14,
    left: "50%",
    transform: "translateX(-50%)",
    textAlign: "center",
    color: C.yellow,
    fontSize: 13,
    letterSpacing: 1,
    fontWeight: 700,
    zIndex: 3,
    textShadow: "0 0 8px rgba(0,0,0,0.9)",
    whiteSpace: "nowrap",
  },
  feed: { maxWidth: 1320, margin: "20px auto 0", display: "flex", flexDirection: "column", gap: 14, maxHeight: 360, overflowY: "auto", padding: "0 8px" },
  bubble: { maxWidth: "72%", border: "2px solid", borderRadius: 10, padding: "12px 16px", fontSize: 17, lineHeight: 1.5 },
  bubbleName: { fontWeight: 900, fontSize: 13, marginBottom: 6, letterSpacing: 0.5 },
  judgeLine: { alignSelf: "center", color: C.yellow, fontSize: 15, fontWeight: 700, letterSpacing: 1, padding: "3px 0" },

  verdictPanel: { textAlign: "center", maxWidth: 720, margin: "24px auto 0", border: `3px solid ${C.yellow}`, borderRadius: 16, padding: 28, background: "rgba(255,60,165,0.07)" },
  koText: { fontSize: 56, fontWeight: 900, color: C.yellow, fontFamily: "'Arial Black', sans-serif", textShadow: "0 0 30px rgba(217,77,255,0.7)", letterSpacing: 6 },
  winnerName: { fontSize: 24, fontWeight: 900, marginTop: 8, letterSpacing: 1 },
  scoreLine: { marginTop: 14, fontSize: 14, fontWeight: 700 },
  rationale: { marginTop: 12, fontStyle: "italic", color: "#bbb", fontSize: 14, lineHeight: 1.5 },

  // табло
  boardWrap: { maxWidth: 1100, margin: "0 auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 16 },
  th: { textAlign: "left", padding: "12px 14px", color: C.muted, fontSize: 12, letterSpacing: 1, borderBottom: `2px solid ${C.border}` },
  td: { padding: "14px 14px", borderBottom: `1px solid ${C.border}` },
  rank: { fontWeight: 900, fontSize: 22, width: 60 },
  pointsCell: { fontWeight: 900, fontSize: 22, color: C.yellow, textAlign: "right" },
  empty: { textAlign: "center", color: C.muted, padding: "40px 0", fontSize: 15 },

  banner: { textAlign: "center", color: C.red, fontWeight: 700, fontSize: 13, marginBottom: 14 },
};

export const css = `
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
  @keyframes glow { 0%,100%{box-shadow:0 0 12px rgba(255,60,165,0.35)} 50%{box-shadow:0 0 28px rgba(255,60,165,0.8)} }
  .glow { animation: glow 1.8s infinite; }
  * { scrollbar-width: thin; scrollbar-color: #2a2a3e transparent; }
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-thumb { background: #2a2a3e; border-radius: 4px; }
  button:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
  input:focus, textarea:focus { outline: none; border-color: #ffd23f; }
  body { margin: 0; }
`;
