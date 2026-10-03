/* ── test/src/light/flame.js ─────────────────────────────────────────
   火盆的光圈：地面與牆上分兩階的暖光，會閃

   火焰本身在 stage.js（一顆自發光的錐，三個不成比例的正弦在抖），但它
   原本什麼都不照——墓室裡一排蠟燭、王座前兩盆火，底下的石板跟十公尺外
   一樣暗。這一支補上「火照到的那一圈」。

   ── 為什麼是兩階的圈，不是衰減 ─────────────────────────────────────
   地形的光只有五塊平調（palette.js），一盞點光照 1/r² 衰減下來，會在
   平調上面蓋一層連續的漸層，正是那一頁拿掉半球光的理由。所以火光也切
   成階：內圈一階、外圈一階，交界一樣只留 fwidth 那麼寬。兩階是夠讀得出
   「中心比較亮」的最少數目；再多就又走回漸層。

   ── 一個場，量兩件事 ────────────────────────────────────────────
   每一盆火給一個值 g = min(距離還剩多少, 面朝火的程度)：
     · 1 − r／R    離光心越近越大，到半徑 R 是 0
     · (n·l − 0.1) × 1.5   背對火的面是負的
   取 min，於是「太遠」與「背過身去」是同一道邊界——一面牆轉過去的那條
   稜線，和圈的外緣，用的是同一條 smoothstep。幾盆火疊在一起取 max 而
   不是相加：兩個圈重疊的地方仍然只有兩階，不會多長出第三階。
   最後只在合起來的 g 上切兩刀（0 與 INNER），fwidth 也只取一次。

   ── 加在哪裡 ────────────────────────────────────────────────────
   接在 cpTone 之後（投影那一支可能已經把 cpTone 壓暗了——火照得到影子
   裡，這是對的）。加的是「照度」，所以先除回材質色：顏色 = 材質 × (cpTone
   + 火)。火的量按這一階有多亮打折：亮面加一點、背光面加很多，因為火光
   在正午的亮面上本來就看不出來，該讀出來的是暗處。

   ── 上傳 ────────────────────────────────────────────────────────
   整張地圖二十幾盆火，著色器只吃離狗最近的八盆（固定長度的 uniform 陣
   列，每幀原地改值，不配置）。第九近的那一盆是門檻：快要被擠出去的那盆
   在跟它的距離差剩 FADE 公尺時把半徑縮到 0，所以換人不會啪一聲。
   沒有遺跡的那一頁（格鬥場）八格全空，著色器照跑但每一格都落在圈外。
   `?flame=0` 整段 GLSL 不接進去。
   ------------------------------------------------------------------ */

import * as THREE from '../../vendor/three.module.js';
import { C } from '../palette.js';

const ON = typeof location === 'undefined'
  || new URLSearchParams(location.search).get('flame') !== '0';

/** 一次照得到的火有幾盆。 */
const N = 8;
/** s = 1 的火盆，光圈半徑（公尺）。 */
const RADIUS = 4.6;
/** 半徑不跟 s 成正比：蠟燭（s 0.22）的火苗小，但光還是要落得到棺蓋與旁邊的地上。 */
const R_FLOOR = 0.35;
/** 內圈從 g 的哪裡開始（g 在光心是 1、外緣是 0）。 */
const INNER = 0.45;
/** 面朝火的程度乘多少進 g：n·l 過 0.1 進外圈，過 0.1 + INNER／1.5 = 0.4 進內圈。 */
const FACE_K = 1.5;
/** 加多少火光。最暗那一階幾乎抬一倍，最亮那一階只多一成多。 */
const GAIN = 0.62;
/** 光心比回報的座標高多少（× s）：stage.js 的火錐底在 0.32·s，錐高 0.72·s。 */
const LIFT = 0.6;
/** 被擠出最近八盆之前，用幾公尺把半徑縮到 0。 */
const FADE = 3;

/* xyz = 光心，w = 這一幀的半徑（0 = 空格）。 */
const U_FL = { value: new Float32Array(N * 4) };
const U_COL = { value: new THREE.Color() };

/** 接進地形五階調著色器的那一段（見 ../light.js）。 */
export const shade = ON ? {
  uniforms: { uFl: U_FL, uFlCol: U_COL },
  decl: `
uniform vec4 uFl[${N}];
uniform vec3 uFlCol;
`,
  post: `
  {
    vec3 cpFlN = normalize(vBandN);
    float cpFlG = -1.0;
    for (int i = 0; i < ${N}; i++) {
      vec4 cpFlF = uFl[i];
      vec3 cpFlV = cpFlF.xyz - vLightP;
      float cpFlR = max(length(cpFlV), 1e-3);
      float cpFlD = 1.0 - cpFlR / max(cpFlF.w, 1e-4);
      float cpFlC = (dot(cpFlN, cpFlV) / cpFlR - 0.1) * ${FACE_K.toFixed(2)};
      cpFlG = max(cpFlG, min(cpFlD, cpFlC));
    }
    float cpFlE = max(fwidth(cpFlG) * 0.6, 0.004);
    float cpFlL = 0.5 * smoothstep(-cpFlE, cpFlE, cpFlG)
      + 0.5 * smoothstep(${INNER.toFixed(2)} - cpFlE, ${INNER.toFixed(2)} + cpFlE, cpFlG);
    float cpFlY = dot(cpTone, vec3(0.299, 0.587, 0.114));
    vec3 cpFlA = uFlCol * (cpFlL * ${GAIN.toFixed(2)} * clamp(1.1 - cpFlY, 0.2, 1.0));
    diffuseColor.rgb *= 1.0 + cpFlA / max(cpTone, vec3(0.02));
  }
`,
} : null;

/** @param {object} ctx 見 ../light.js */
export function setup(ctx) {
  if (!ON || !ctx.ruins || !ctx.ruins.flames.length) return null;
  /* palette.js 跟 light.js 互相 import，所以 C 只能在這裡讀，不能在模組頂層。 */
  U_COL.value.set(C.flame);
  const flames = ctx.ruins.flames;
  const n = flames.length;
  /* 每一盆自己的相位：黃金角一盆一盆往下排，兩盆不會同時縮。 */
  const phase = new Float32Array(n);
  for (let i = 0; i < n; i++) phase[i] = i * 2.399;
  /* 最近的 N + 1 盆（多的那一盆是門檻），由近到遠。 */
  const best = new Int16Array(N + 1);
  const bd = new Float32Array(N + 1);
  const a = U_FL.value;

  return {
    update(f) {
      const p = f.player;
      if (!p) return;
      let k = 0;
      for (let i = 0; i < n; i++) {
        const fl = flames[i];
        const dx = fl.x - p.x, dy = fl.y - p.y, dz = fl.z - p.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (k === N + 1 && d >= bd[N]) continue;
        let j = k < N + 1 ? k++ : N;
        while (j > 0 && bd[j - 1] > d) { bd[j] = bd[j - 1]; best[j] = best[j - 1]; j--; }
        bd[j] = d; best[j] = i;
      }
      const edge = k > N ? Math.sqrt(bd[N]) : Infinity;
      const t = f.now / 1000;
      for (let s = 0; s < N; s++) {
        const o = s * 4;
        if (s >= k) { a[o + 3] = 0; continue; }
        const fl = flames[best[s]];
        const ph = t + phase[best[s]];
        /* 跟 stage.js 的火錐同一組頻率，幅度一半：圈的邊是硬的，抖太大整圈會跳。 */
        const w = 1
          + Math.sin(ph * 3.1) * 0.05
          + Math.sin(ph * 5.7) * 0.03
          + Math.sin(ph * 11.3) * 0.018;
        const fade = Math.min(1, Math.max(0, (edge - Math.sqrt(bd[s])) / FADE));
        a[o] = fl.x;
        a[o + 1] = fl.y + LIFT * fl.s;
        a[o + 2] = fl.z;
        a[o + 3] = RADIUS * (R_FLOOR + (1 - R_FLOOR) * fl.s) * w * fade;
      }
    },
  };
}
