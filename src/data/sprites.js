// Пиксельные бойцы для Canvas-рендера (стиль старых файтингов).
// Матрица кадра — массив строк одинаковой ширины. Символы:
//   '.' прозрачно, 'o' контур, 'b' тело (цвет команды), 'h' блик, 'e' глаза/акцент.
// Кадры состояний: idle, attack, hit, ko, win. Отсутствующий кадр → fallback на idle.

const WARRIOR = {
  w: 12,
  idle: [
    "....oooo....",
    "...ohhhho...",
    "..ohheehho..",
    "..ohhhhhho..",
    "...oooooo...",
    "..obbbbbbo..",
    ".obbbbbbbbo.",
    "oobbbbbbbboo",
    ".obbbbbbbbo.",
    "..obbbbbbo..",
    "..obbbbbbo..",
    "..obb..bbo..",
    "..obo..obo..",
    "..obo..obo..",
    "..obo..obo..",
    ".ooo...ooo..",
  ],
  attack: [
    "....oooo....",
    "...ohhhho...",
    "..ohheehho..",
    "..ohhhhhho..",
    "...oooooo...",
    "..obbbbbbo..",
    ".obbbbbbbbo.",
    "..obbbbbbbbo",
    "..obbbbbbbbo",
    "..obbbbbbo..",
    "..obbbbbbo..",
    "..obb.bbo...",
    "..obo.obo...",
    "..obo.obo...",
    "..obo.obo...",
    ".ooo..ooo...",
  ],
  hit: [
    "...oooo.....",
    "..ohhhho....",
    ".ohhxxhho...",
    ".ohhhhhho...",
    "..oooooo....",
    "oobbbbbboo..",
    "o.obbbbo.o..",
    "..obbbbbbo..",
    "..obbbbbbo..",
    "..obbbbbo...",
    "..obbbbbo...",
    "..obb.bbo...",
    "..obo.obo...",
    "..obo.obo...",
    "..obo.obo...",
    ".ooo..ooo...",
  ],
  win: [
    "o...oooo...o",
    "o..ohhhho..o",
    ".o.ohheeho.o",
    "..ohhhhhho..",
    "...oooooo...",
    "..obbbbbbo..",
    ".obbbbbbbbo.",
    ".obbbbbbbbo.",
    "..obbbbbbo..",
    "..obbbbbbo..",
    "..obbbbbbo..",
    "..obb..bbo..",
    "..obo..obo..",
    "..obo..obo..",
    "..obo..obo..",
    ".ooo...ooo..",
  ],
  ko: [
    "............",
    "............",
    "............",
    "............",
    "............",
    "............",
    "............",
    "............",
    "............",
    "....oooo....",
    "..oohhhhoo..",
    ".obbhhbbbbo.",
    "obbbbbbbbbbo",
    "obbbbbbbbbbo",
    "oooooooooooo",
    "............",
  ],
};

const ROBO = {
  w: 12,
  idle: [
    "..oooooooo..",
    "..ohhhhhho..",
    "..oheeeeho..",
    "..ohhhhhho..",
    "..oooooooo..",
    "...obbbbo...",
    ".obbbbbbbbo.",
    "oobbbbbbbboo",
    ".obbbbbbbbo.",
    "..obbbbbbo..",
    "..obbbbbbo..",
    "..obb..bbo..",
    "..obo..obo..",
    "..obo..obo..",
    "..ooo..ooo..",
    "..oo....oo..",
  ],
  attack: [
    "..oooooooo..",
    "..ohhhhhho..",
    "..oheeeeho..",
    "..ohhhhhho..",
    "..oooooooo..",
    "...obbbbo...",
    ".obbbbbbbbo.",
    "..obbbbbbbbo",
    ".obbbbbbbbo.",
    "..obbbbbbo..",
    "..obbbbbbo..",
    "..obb.bbo...",
    "..obo.obo...",
    "..obo.obo...",
    "..ooo.ooo...",
    "..oo..oo....",
  ],
  win: [
    "o.oooooooo.o",
    "o.ohhhhhho.o",
    ".ьoheeeeho.o",
    "..ohhhhhho..",
    "..oooooooo..",
    "...obbbbo...",
    ".obbbbbbbbo.",
    ".obbbbbbbbo.",
    "..obbbbbbo..",
    "..obbbbbbo..",
    "..obbbbbbo..",
    "..obb..bbo..",
    "..obo..obo..",
    "..obo..obo..",
    "..ooo..ooo..",
    "..oo....oo..",
  ],
  ko: WARRIOR.ko,
};

// Нормализуем кадры: одинаковая ширина (паддинг/обрезка), пустые символы → '.'.
function normalizeFrame(rows, w) {
  return rows.map((r) => {
    const cleaned = r.replace(/[^obhex.]/g, "."); // неизвестные символы → прозрачно
    if (cleaned.length < w) return cleaned + ".".repeat(w - cleaned.length);
    return cleaned.slice(0, w);
  });
}

function normalizeSprite(sp) {
  const out = { w: sp.w };
  for (const k of ["idle", "attack", "hit", "win", "ko"]) {
    if (sp[k]) out[k] = normalizeFrame(sp[k], sp.w);
  }
  return out;
}

export const SPRITES = [normalizeSprite(WARRIOR), normalizeSprite(ROBO)];

// Стабильный выбор спрайта по seed (имя/ид участника), чтобы у бойца всегда один силуэт.
export function pickSprite(seed = "") {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return SPRITES[h % SPRITES.length];
}
