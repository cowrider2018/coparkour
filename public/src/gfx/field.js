// ── 便宜的變化：整數雜湊、非諧波正弦場、可分離的風 ──────────
// 全部移植自 frontend-sandbox。這三個函式加起來就是整份外觀計畫的地基。

/**
 * 座標整數雜湊（clumps.js 的 seed）。
 *
 * 關鍵在第三個參數 k（salt）：同一個格子可以問無限多個互相獨立的問題，
 * 而且完全無狀態——不需要照順序生成，也不需要保存任何東西。
 * 對多人來說這是免費的一致性：同一個 room seed + 同一個格子 = 同一朵花。
 *
 * 注意 ix / iz 一定要先量化成整數格子索引再進來。用浮點座標直接雜湊的話，
 * 一個 ULP 的漂移就會換到另一個值，整片裝飾會隨著鏡頭爬行。
 */
export function cell(ix, iz, k) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 把 room seed 揉進格子雜湊，這樣不同房間的裝飾也不一樣。 */
export function makeCell(roomSeed) {
  const s = roomSeed | 0;
  return (ix, iz, k) => cell(ix ^ s, iz, k + (s & 0xff));
}

// ── 非諧波正弦場 ────────────────────────────────────────────
// 波長 74/41/23/13 互不成整數比（74/41=1.805、41/23=1.783、23/13=1.769），
// 所以走多遠都不會出現可辨認的重複。權重讓 w·f 幾乎相等（每一項貢獻
// 同樣多的斜率），這是正弦版的 gain = 1/lacunarity。
const WAVES = [
  // 波長, 相位, 權重
  [74.0, 0.00, 1.00],
  [41.0, 1.70, 0.55],
  [23.0, 3.90, 0.30],
  [13.0, 0.60, 0.17],
];
const TOTAL = WAVES.reduce((a, w) => a + w[2], 0);
const TERMS = WAVES.map(([lam, ph, w]) => ({ k: (Math.PI * 2) / lam, ph, w: w / TOTAL }));

/** 每單位振幅的最大斜率——生成器用它反推「跳得過去」的上限。 */
export const SLOPE_PER_AMP = TERMS.reduce((a, t) => a + t.w * t.k, 0);

/**
 * 一次算完高度與梯度。噪聲給不了解析導數，正弦和給得了——
 * 這就是為什麼山的法線、斜率上界、光照全部免費。
 * @param {number} x
 * @param {number} scale 波長縮放
 * @param {Float32Array|number[]} [grad] 長度 ≥1 的暫存，回寫 d/dx
 */
export function field(x, scale, grad) {
  let n = 0, g = 0;
  for (let i = 0; i < TERMS.length; i++) {
    const t = TERMS[i], a = t.k * x / scale + t.ph;
    n += t.w * Math.sin(a);
    g += t.w * t.k / scale * Math.cos(a);
  }
  if (grad) grad[0] = g;
  return n;
}

// ── 風 ──────────────────────────────────────────────────────
// 兩道行進中的平面波。慢項波長 19.6 單位、相速 3.4；快項 4.1、1.84。
// 兩項刻意可分離：消費者選擇要讀哪一項，而「它過濾掉什麼」就等於
// 「它有多大」——樹幹只讀慢項，草兩項都讀。
export function slowGust(x, t) {
  return Math.sin(x * 0.0106 - t * 1.10);
}

export function gust(x, t) {
  const chop = Math.sin(x * 0.0516 - t * 2.85 + 1.7);
  return 0.5 + 0.5 * (slowGust(x, t) * 0.66 + chop * 0.34);
}

// ── 輪廓家族 ────────────────────────────────────────────────
// 兩個指數涵蓋卵形／披針形／倒卵形。無分支、無查表，
// 而且比把形狀存下來還省。
export function leafWidth(t, skew, sharp) {
  return Math.pow(Math.sin(Math.PI * Math.pow(t < 0 ? 0 : t > 1 ? 1 : t, skew)), sharp);
}

/** 4×4 有序 Bayer，振幅剛好半個 8 bit LSB。螢幕空間靜態，不會蠕動。 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function bayer4(x, y) {
  return BAYER[(x & 3) + (y & 3) * 4] / 16 - 0.5;
}
