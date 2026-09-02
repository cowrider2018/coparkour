// ── 一天的時刻 → 光的方向、顏色、強度、天空、環境光 ──────────
// 移植自 frontend-sandbox/src/scenes/daycycle.js。
// 這支模組不畫任何東西，每幀在 CPU 上跑一次，約 30 次浮點運算。
//
// 兩個對原始碼的修正：
//   1. 日月交接在太陽仰角的小窗口內交叉淡入。原始碼在 06:00 / 18:00
//      會有一道接縫（tint 橘翻藍、方位角轉 180°），AETHER 被 taa=0.78
//      的時間濾波器蓋住了，我們沒有時間濾波器所以會直接看到。
//      交叉的軸必須是「帶號的」太陽仰角：用 |sin θ| 的話日月兩邊都從
//      0 開始長，同一個 w 會被餵給相反的端點，於是 06:00 的月亮拿到
//      純 DAWN、18:00 的太陽拿到 MOON。月亮沒有夕陽色。
//   2. 顏色一律經過 acesTone() 才落地。這些常數是為「ACES 套在
//      linear × 1.25、不做 sRGB 編碼」校準的，直接乘會亮兩倍且發灰。

const DAWN = [1.00, 0.42, 0.17];
const NOON = [1.00, 0.93, 0.82];
const MOON = [0.50, 0.62, 0.92];
const MOON_LIGHT = 0.58;
const MAX_EL = 1.16;                 // 正午仰角（弧度）≈ 66.5°
const AMBIENT_DAY = [0.100, 0.120, 0.160];
const AMBIENT_NIGHT = [0.072, 0.092, 0.150];   // 月亮在天頂時的值，見下

/* ── 夜的黑階 ────────────────────────────────────────────────
   泥土的 albedo 是 0.046：4.6% 的反射率。白天它勉強看得見，靠的是
   太陽本來就多了兩個數量級的流明，不是靠它自己。夜裡沒有那兩個
   數量級，於是 deep 落在 rgb(3,2,2)、描邊落在 rgb(2,1,1)、四層山脊
   全部落在 rgb(2,6,8) 上下——地板下方跟背景的波浪塌成同一片黑。

   這件事不能用「把月亮開亮一點」解決。要讓 0.046 的土回到白天那個
   亮度，月亮得跟太陽一樣亮，那時候草皮會先燒掉。ACES 在低端是二次
   的，乘法在那裡只會把差距一起壓扁。

   所以補的不是流明，是黑階：月光被空氣散回來的那一層，貼在所有東西
   前面，加法。暗的東西整個被抬起來，亮的東西幾乎不動（草皮只差兩階）。
   它跟著月亮的高度走——月亮低的時候夜就是真的黑，那是刻意的。

   天空拿的那一份是地面上東西的兩倍多，因為天空就是那層空氣本身，
   厚度是無限；一塊在腳邊的土前面只有幾公尺的空氣。這個差額正是山脊
   在夜裡重新變成剪影的原因：天亮起來、山沒有，山就有東西可以襯。
   兩份都給一樣多的話山會比它背後的天空還亮，下半個畫面變成一片會
   發光的 navy——那看起來不是夜景，是打錯燈的白天。

   山脊不吃 veil。它們的那一份已經由 R_HAZE 往天空混過去了——那正是
   「相機與山之間的空氣」，再加一次是重複計算，四層山會被一起抬平回
   同一片藍。近的山在夜裡就該是幾乎全黑的剪影。

   均勻的那一份要省著給。夜空整片抬得越高，月亮的光暈就越沒有東西可以
   襯——第一版把 NIGHT_SKY 開到 0.100，天空亮到 rgb(19,27,52)，而光暈
   的振幅還是為全黑的夜空調的 0.030，攤上去只差一階，等於沒有。所以
   均勻的抬升砍到 0.070，差額改由 background.js 那個以月亮為中心的
   寬暈給：同樣是月光照亮空氣，但它知道月亮在哪一邊。 */
const NIGHT_VEIL = 0.040;            // 地面上的東西
const NIGHT_SKY = 0.070;             // 天空自己。SKY.night 是新月的夜
const SEAM = 0.06;                   // 交叉淡入的視窗，以帶號的 sin θ 計

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
 * 回傳 { dir, tint, body, glowX, ambient, day, up, alt }——tint 已經含強度。
 * tint 是「那盞燈」，body 是「天上那一顆」，glowX 是霞光該燒的那一側。
 */
export function skyAt(hour) {
  const th = ((hour - 6) / 12) * Math.PI;
  const s = Math.sin(th);              // 太陽仰角的 sin，帶號
  const up = s > 0;
  const alt = Math.abs(s);
  const high = smooth(0, 0.5, alt);

  const el = alt * MAX_EL;
  const az = th - Math.PI / 2 + (up ? 0 : Math.PI);
  const dir = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];

  // 地平線的光同時變暗也變紅——只變色調的日落看起來像一盞有顏色的燈
  const sunLit = mix3(DAWN, NOON, high).map((c) => c * (0.22 + 0.78 * high));
  // 月光是反射的日光：亮度跟著高度走，色調不跟。
  const moonLit = MOON.map((c) => c * MOON_LIGHT * (0.45 + 0.55 * high));

  // 交接的軸是帶號的 s。再乘一道地平線消光，讓太陽是「熄掉」交班，
  // 而不是把最後那點橘色留給剛升起來的月亮。ext 只在 s ∈ [-0.02, 0.10]
  // 這十二分鐘內起作用，黃金時刻的直射光不受影響；順便也把 dir 在
  // 06:00 瞬間翻 180° 造成的 ndl 跳變藏在一個更暗的瞬間裡。
  const ext = smooth(-0.02, 0.10, s);
  const tint = mix3(moonLit, sunLit.map((c) => c * ext), smooth(-SEAM, SEAM, s));

  // 圓盤與光暈畫的是天上那一顆，不是那盞燈：交接時燈是兩顆的疊加，
  // 但天上只有一顆，落日的盤面該是紅的，不該被月色拉藍。所以 body
  // 既不吃交叉也不吃消光。
  const body = up ? sunLit : moonLit;

  // 夜裡的天光是月亮給的，所以它跟著月亮的高度走，不是一個常數。
  // 剛升起的月亮跟天頂的月亮，散進來的天光差了一倍。
  const nightAmb = AMBIENT_NIGHT.map((c) => c * (0.55 + 0.45 * high));

  // 霞光屬於太陽。月亮那半天的方位角轉了 180°，轉回去，霞光才不會在
  // 05:50 燒在西邊的月亮那側、再於 06:00 整片跳到東邊。
  const glowX = up ? dir[0] : -dir[0];

  const day = smooth(-0.16, 0.10, s);
  const moonlit = (1 - day) * (0.35 + 0.65 * high);
  const veil = MOON.map((c) => c * NIGHT_VEIL * moonlit);
  const skyVeil = MOON.map((c) => c * NIGHT_SKY * moonlit);
  return {
    dir, tint, body, glowX, veil, skyVeil, day, up, alt,
    ambient: mix3(nightAmb, AMBIENT_DAY, day),
  };
}

/** 天空的三段色帶。uDay 在十一個小時裡都是 1，所以還要看 dir.y。
    夜空也吃 veil：NIGHT_* 落地是 rgb(1,1,4)，那不是夜空，那是黑。
    山脊要當剪影得先有一片能被剪的天。 */
export function skyBands(sky) {
  const low = 1 - smooth(-0.02, 0.62, sky.dir[1]);
  const warm = low * smooth(0, 0.45, sky.day);
  const v = sky.skyVeil;
  const b = (n) => mix3(mix3(SKY.noon[n], SKY.dusk[n], warm), SKY.night[n], 1 - sky.day)
    .map((c, i) => c + v[i]);
  return { top: b("top"), hor: b("hor"), bot: b("bot"), warm };
}

/**
 * AETHER 的 shadeDirect 只留骨架：albedo × (tint × ndl × 2.4 + ambient × 1.5)。
 * 遊戲裡每個東西的顏色都走這一行。
 */
export function shade(albedo, sky, ndl, gain) {
  const g = gain === undefined ? 1 : gain;
  const v = sky.veil;
  return [
    albedo[0] * (sky.tint[0] * ndl * 2.4 + sky.ambient[0] * 1.5) * g + v[0],
    albedo[1] * (sky.tint[1] * ndl * 2.4 + sky.ambient[1] * 1.5) * g + v[1],
    albedo[2] * (sky.tint[2] * ndl * 2.4 + sky.ambient[2] * 1.5) * g + v[2],
  ];
}

/** 房間 seed → 這個房間的起始時刻。同房間的人看到同一個天色。 */
export function hourForSeed(seed) {
  return ((seed >>> 8) % 2400) / 100;
}

/** 一天在真實時間裡有多長（秒）。AETHER 用 130，遊戲慢一點比較不吵。 */
export const DAY_SECONDS = 420;
