// ── 一天的時刻 → 光的方向、顏色、強度、天空、環境光 ──────────
// 移植自 frontend-sandbox/src/scenes/daycycle.js。
// 這支模組不畫任何東西，每幀在 CPU 上跑一次，約 30 次浮點運算。
//
// 兩個對原始碼的修正：
//   1. 日月交接在 |sin θ| 的小窗口內交叉淡入。原始碼在 06:00 / 18:00
//      會有一道接縫（tint 橘翻藍、方位角轉 180°），AETHER 被 taa=0.78
//      的時間濾波器蓋住了，我們沒有時間濾波器所以會直接看到。
//   2. 顏色一律經過 acesTone() 才落地。這些常數是為「ACES 套在
//      linear × 1.25、不做 sRGB 編碼」校準的，直接乘會亮兩倍且發灰。

const DAWN = [1.00, 0.42, 0.17];
const NOON = [1.00, 0.93, 0.82];
const MOON = [0.50, 0.62, 0.92];
const MOON_LIGHT = 0.46;
const MAX_EL = 1.16;                 // 正午仰角（弧度）≈ 66.5°
const AMBIENT_DAY = [0.100, 0.120, 0.160];
const AMBIENT_NIGHT = [0.055, 0.070, 0.118];
const SEAM = 0.06;                   // 交叉淡入的視窗，以 |sin θ| 計

// cluster.js 的 SKY block
const SKY = {
  noon:  { top: [0.082, 0.180, 0.430], hor: [0.195, 0.265, 0.390], bot: [0.045, 0.060, 0.090] },
  dusk:  { top: [0.042, 0.046, 0.115], hor: [0.105, 0.092, 0.140], bot: [0.024, 0.019, 0.026] },
  night: { top: [0.006, 0.009, 0.022], hor: [0.012, 0.016, 0.030], bot: [0.004, 0.005, 0.010] },
};
export const LOW_GLOW = [0.55, 0.20, 0.055];
export const EXPOSURE = 1.25;

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;
export const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** ACES Narkowicz 擬合，套在 linear × EXPOSURE 上，之後不做 sRGB 編碼。 */
export function acesTone(x) {
  x = Math.max(0, x) * EXPOSURE;
  return clamp01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
}

/** linear vec3 → CSS rgb()，中間走 ACES。 */
export function css(c, gain) {
  const k = gain === undefined ? 1 : gain;
  return `rgb(${Math.round(acesTone(c[0] * k) * 255)},${Math.round(acesTone(c[1] * k) * 255)},${Math.round(acesTone(c[2] * k) * 255)})`;
}

/**
 * hour ∈ [0, 24)。日出 06:00、正午 12:00、日落 18:00。
 * 回傳 { dir, tint, ambient, day, up, alt } —— tint 已經含強度。
 */
export function skyAt(hour) {
  const th = ((hour - 6) / 12) * Math.PI;
  const s = Math.sin(th);
  const up = s > 0;
  const alt = Math.abs(s);
  const high = smooth(0, 0.5, alt);

  const el = alt * MAX_EL;
  const az = th - Math.PI / 2 + (up ? 0 : Math.PI);
  const dir = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];

  // 地平線的光同時變暗也變紅——只變色調的日落看起來像一盞有顏色的燈
  const sunTint = mix3(DAWN, NOON, high).map((c) => c * (0.22 + 0.78 * high));
  const moonTint = MOON.map((c) => c * MOON_LIGHT * (0.45 + 0.55 * high));

  const w = smooth(0, SEAM, alt);
  const tint = up ? mix3(moonTint, sunTint, w) : mix3(sunTint, moonTint, w);

  const day = smooth(-0.16, 0.10, s);
  return { dir, tint, ambient: mix3(AMBIENT_NIGHT, AMBIENT_DAY, day), day, up, alt };
}

/** 天空的三段色帶。uDay 在十一個小時裡都是 1，所以還要看 dir.y。 */
export function skyBands(sky) {
  const low = 1 - smooth(-0.02, 0.62, sky.dir[1]);
  const warm = low * smooth(0, 0.45, sky.day);
  const b = (n) => mix3(mix3(SKY.noon[n], SKY.dusk[n], warm), SKY.night[n], 1 - sky.day);
  return { top: b("top"), hor: b("hor"), bot: b("bot"), warm };
}

/**
 * AETHER 的 shadeDirect 只留骨架：albedo × (tint × ndl × 2.4 + ambient × 1.5)。
 * 遊戲裡每個東西的顏色都走這一行。
 */
export function shade(albedo, sky, ndl, gain) {
  const g = gain === undefined ? 1 : gain;
  return [
    albedo[0] * (sky.tint[0] * ndl * 2.4 + sky.ambient[0] * 1.5) * g,
    albedo[1] * (sky.tint[1] * ndl * 2.4 + sky.ambient[1] * 1.5) * g,
    albedo[2] * (sky.tint[2] * ndl * 2.4 + sky.ambient[2] * 1.5) * g,
  ];
}

/** 房間 seed → 這個房間的起始時刻。同房間的人看到同一個天色。 */
export function hourForSeed(seed) {
  return ((seed >>> 8) % 2400) / 100;
}

/** 一天在真實時間裡有多長（秒）。AETHER 用 130，遊戲慢一點比較不吵。 */
export const DAY_SECONDS = 420;
