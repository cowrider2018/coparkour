/* ── test-area/src/palette.js ────────────────────────────────────────
   這一區的顏色與材質。

   形狀走 Dota／黑魂那種厚重的石造感（見 geom.js 的倒角石塊），但顏色
   一律是本專案卡通調色盤的值——不是重新配色，是把遊戲裡已經在用的那幾
   個數字搬過來，所以這一頁的石頭和遊戲裡的狗站在一起不會像兩個作品：

     · 石材與木材      取自 /preview/ 圖鑑那張深色卡片色票
                       （#1e1810 底、#2b2218 卡片、#4a3b29 邊、#6b563c 線）
     · 苔與布的亮色    accent #9bd94e、accent2 #e8862f
     · 墨線            43,35,32——src/cat/cat.js 的 INK，同一個值
     · 光              src/gfx/daycycle.js 的 NOON tint 與 AMBIENT_DAY

   三階調著色也是照抄那個做法：漫射項硬切成三塊平調。three.js 這邊用
   MeshToonMaterial 加一張 3 階的 gradientMap 就是同一件事——差別只在
   邊界是貼圖取樣（NearestFilter）而不是 fwidth 寬的 smoothstep。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';

/** 墨色。src/cat/cat.js 的 INK = [43, 35, 32]。 */
export const INK = 0x2b2320;

/** 這一區用到的所有顏色。名字說的是「材質」，不是「顏色」。 */
export const C = {
  /* 石材四階。由亮到暗，亮的用在朝光的新鮮斷面，暗的用在牆根與內側。 */
  stoneLit: 0xc6b08c,
  stone: 0xa89270,
  stoneDark: 0x6b563c,
  stoneDeep: 0x4a3b29,
  /* 花崗岩：地板與台基，比牆冷一階，好讓中央空地跟周圍的裝飾分開。 */
  granite: 0x8d8577,
  graniteDark: 0x6d675c,
  /* 苔。亮的在頂面，暗的在縫裡。 */
  moss: 0x9bd94e,
  mossDark: 0x5f8f33,
  /* 木料、鐵件、布、金。 */
  wood: 0x7a5433,
  woodDark: 0x4c351f,
  iron: 0x3b3a3c,
  ironLit: 0x565459,
  banner: 0xc2452f,
  bannerAlt: 0xe8862f,
  gold: 0xe8b23a,
  /* 火與水。火是自發光，水是一片平的半透明。 */
  flame: 0xffb43c,
  flameCore: 0xfff0c0,
  water: 0x2f4a52,
  /* 天空與霧。#1e1810 是圖鑑那頁的底色。 */
  sky: 0x2a2b3a,
  fog: 0x1e1810,
};

/* ── 三階調 ──────────────────────────────────────────────────────
   gradientMap 的每一格就是一個色調，NearestFilter 讓邊界是硬的。
   三格的位置對應 cat.js 的 BAND_KEY（ndl = 1.0 / 0.24 / 0.035）：
   暗調佔的角度範圍最大，亮調最小，所以石頭在斜光下多半落在中調，
   只有正對光的面會跳到亮調——那正是這種厚重石塊要的閱讀方式。 */
function toonRamp() {
  const data = new Uint8Array([70, 70, 70, 165, 165, 165, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

let RAMP = null;
/** 共用的那一張 3 階梯度圖。每個材質各建一張是白花錢。 */
export const ramp = () => (RAMP || (RAMP = toonRamp()));

/**
 * 一個吃頂點色的三階調材質。
 *
 * 整個區塊的幾何最後會合併成極少數幾個 mesh（見 geom.js 的 merge），
 * 顏色靠頂點色帶著走，所以這裡不分材質——四階石材、苔、鐵、布全部用
 * 同一顆材質畫完，一個 draw call。
 */
export const toonVC = () => new THREE.MeshToonMaterial({
  color: 0xffffff,
  vertexColors: true,
  gradientMap: ramp(),
});

/** 單色的三階調材質（狗身上那幾塊、水面以外的道具）。 */
export const toon = (color) => new THREE.MeshToonMaterial({
  color,
  gradientMap: ramp(),
});

/** 自發光：火焰。不受光，直接就是那個顏色。 */
export const glow = (color) => new THREE.MeshBasicMaterial({ color });

/**
 * 墨線用的材質。
 *
 * 建築走的是 EdgesGeometry 畫線，不是翻面外殼——倒角石塊的法線是平的
 * （每個三角形自己一組），外殼沿法線推出去會在每道倒角上裂開。動物身上
 * 相反：那些是連續的曲面，外殼才是對的做法，所以 dog.js 用外殼。
 * 兩邊出來的都是同一個墨色。
 */
export const inkLine = () => new THREE.LineBasicMaterial({ color: INK });

/** 翻面外殼的墨。正面剔除掉之後剩下背面，只在輪廓外露出一圈。 */
export const inkShell = () => new THREE.MeshBasicMaterial({
  color: INK,
  side: THREE.BackSide,
});

/* ── 光 ──────────────────────────────────────────────────────────
   兩盞，跟遊戲一樣：一盞暖的主光、一圈偏藍的環境光。數值取自
   src/gfx/daycycle.js 的 NOON [1.00, 0.93, 0.82] 與
   AMBIENT_DAY [0.100, 0.120, 0.160]（環境光在那邊是加在三階調的每一
   階上的，這裡交給 HemisphereLight，強度另外乘上來）。 */
export function lights() {
  const key = new THREE.DirectionalLight(0xffeed1, 2.05);
  key.position.set(-9, 14, 7);
  const amb = new THREE.HemisphereLight(0x9fb4e6, 0x3a2d1f, 0.85);
  return { key, amb };
}
