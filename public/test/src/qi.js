/* ── test/src/qi.js ─────────────────────────────────────────────────
   劍氣的外觀：一道卡通的月牙（形狀與時間在 trail.js，這裡把它畫出來）。

   跟場景裡的石頭與狗同一套畫法——明確的邊、墨線、兩階平色——擾動只在
   邊上：邊隨時間慢慢地鼓、縮，消散的時候從邊往內被吃掉、斷成幾塊。

   ── 網格 ────────────────────────────────────────────────────────
   一條帶子，沿著刀尖掃過的路徑一排一排鋪上去（step），每一排是月牙的
   一個橫截面：從內緣到外緣 ACROSS 格，外緣在 REACH 上（trail.js 的 qiAt）。
   每一排從鋪下去那一幀的玩家身上算，接在上一排後面，所以整道是連續的一筆，
   人在揮的時候轉向也只是讓它彎一下。

   排是照角度鋪的，不是照幀：每掃過 PIECE 固定一排，刀尖現在的位置另外一排
   「頭」，下一幀就覆寫掉。照幀鋪的話排數跟著幀率走——144Hz 或慢動作下，
   一整圈的排數會超過網格。

   上下兩層，各往自己那一面鼓出去，鼓多高照橫截面是一個半圓（中間最厚、
   兩緣是 0）——側著看是一片有厚度的透鏡，不是一條線。兩層都寫深度，
   近的那一層蓋住遠的那一層。

   ── 形狀 ────────────────────────────────────────────────────────
   形狀在 fragment 裡切：橫截面上的位置 s（內緣 −1、外緣 +1）與沿著月牙的
   長度 l（公尺）。

     f = min(1 − |s|, 離頭尾的長度 / END) − amp(s)·noise(l, t)

   f > 門檻的地方是劍氣。min 的第二項讓帶子的兩端收成圓尖——不然帶子的頭（刀尖
   現在的位置）是一刀切平的，第三段那一圈頭尾疊在一起的地方也是一道切痕。noise 是單一頻率的平滑噪聲，一個起伏 WOBBLE 公尺長
   ——擾動是大而少的鼓包，不是一排細碎的鋸齒。amp 在外緣很小、在內緣大：
   外緣是打得到的最遠處，只准往內縮一點，不准往外長；內緣怎麼晃都不影響
   範圍。

   門檻平常是 0。一排鋪上去 HOLD 秒之後開始往上抬，抬到 1 就整排不見——
   先鋪的先被吃，所以月牙從尾巴開始斷，一塊一塊地消失。

   ── 上色 ────────────────────────────────────────────────────────
   邊：f 減掉門檻、除以 fwidth，就是「離邊幾個像素」——邊在任何距離都是一個
   像素寬的抗鋸齒，離邊 INK_PX 以內是墨色（跟狗的描邊一樣粗、palette.js 的
   INK）。明暗：法線照橫截面是半圓算（中間朝上、兩緣朝外），吃主光，硬切成
   白與淡藍灰兩階。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { KEY_DIR, INK } from './palette.js';
import { TRAILS, PIECE, sweepAt, fadeAt, qiAt } from './trail.js';

/** 一排橫截面切幾格。 */
const ACROSS = 6;

/** 最多幾排：一整圈多一點、每 PIECE（trail.js）一排是 6.6 / 0.12 ≈ 56，加上起點與刀尖。 */
const ROWS = 64;

/** 邊上一個起伏多長（公尺）。 */
const WOBBLE = 0.9;

/** 頭尾收成圓尖的那一段多長（公尺）。 */
const END = 0.6;

/** 一排鋪上去之後多久開始被吃（秒）。 */
const HOLD = 0.1;

/** 描邊幾個像素寬（裝置像素）。 */
const INK_PX = 2.0;

/** 往一面鼓多高：半寬的幾成。 */
const BULGE = 0.28;

/* INK 是 sRGB 的十六進位；這個著色器不經過 three 的色彩空間轉換，直接寫進畫面，
   所以照原樣拆成三個 0～1 的數。 */
const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c) => (c / 255).toFixed(4)).join(', ');

const VERT = /* glsl */ `
attribute vec3 aN;      // 月牙所在那個面的法線
attribute vec3 aD;      // 這一排的刀的方向（從內緣指向外緣）
attribute float aS;     // 橫截面上的位置：內緣 −1、外緣 +1
attribute float aL;     // 沿著月牙的長度（公尺）
attribute float aBorn;  // 這一排什麼時候鋪上去的（秒，從出招量）
attribute float aW;     // 這一排的半寬（公尺）
uniform float uSide;
varying vec3 vN;
varying vec3 vD;
varying float vS;
varying float vL;
varying float vBorn;
void main() {
  float c = sqrt(max(0.0, 1.0 - aS * aS));
  vN = aN * uSide; vD = aD; vS = aS; vL = aL; vBorn = aBorn;
  vec3 p = position + aN * uSide * ${BULGE.toFixed(2)} * aW * c;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uNow, uErode, uFade, uSeed, uHead;
uniform vec3 uKey;
varying vec3 vN;
varying vec3 vD;
varying float vS;
varying float vL;
varying float vBorn;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float n = noise(vec2(vL / ${WOBBLE.toFixed(2)} + uSeed, uNow * 1.4 + uSeed));
  float amp = mix(0.55, 0.1, vS * 0.5 + 0.5);
  float f = min(1.0 - abs(vS), min(vL, uHead - vL) / ${END.toFixed(2)}) - amp * n;
  float eat = clamp((uNow - vBorn - ${HOLD.toFixed(2)}) / uErode, 0.0, 1.0);
  float th = max(eat, 1.0 - uFade);
  float px = (f - th) / max(fwidth(f), 1e-5);   // 離邊幾個像素，裡面是正的
  if (px < -0.5) discard;
  float cover = clamp(px + 0.5, 0.0, 1.0);

  vec3 nrm = normalize(vN * sqrt(max(0.0, 1.0 - vS * vS)) + vD * vS);
  float ndl = dot(nrm, uKey), w = max(fwidth(ndl), 1e-4);
  vec3 col = mix(vec3(0.74, 0.82, 0.95), vec3(1.0), smoothstep(0.1 - w, 0.1 + w, ndl));
  float ink = 1.0 - clamp(px - ${INK_PX.toFixed(1)} + 0.5, 0.0, 1.0);
  col = mix(col, vec3(${rgb(INK)}), ink);
  gl_FragColor = vec4(col, cover * mix(0.92, 1.0, ink));
}`;

/** 一道劍氣。借來、start、每幀 step，step 回 false 就是收掉了，可以再借。 */
export class Qi {
  constructor() {
    const n = ROWS * (ACROSS + 1);
    const g = new THREE.BufferGeometry();
    const attr = (name, size) => {
      const a = new THREE.BufferAttribute(new Float32Array(n * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    };
    this._a = {
      position: attr('position', 3), aN: attr('aN', 3), aD: attr('aD', 3),
      aS: attr('aS', 1), aL: attr('aL', 1), aBorn: attr('aBorn', 1), aW: attr('aW', 1),
    };
    const idx = [];
    for (let r = 0; r < ROWS - 1; r++) {
      for (let j = 0; j < ACROSS; j++) {
        const a = r * (ACROSS + 1) + j, b = a + ACROSS + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    g.setIndex(idx);
    this.geometry = g;

    this.node = new THREE.Group();
    this.node.visible = false;
    this._mats = [1, -1].map((side) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          uSide: { value: side }, uNow: { value: 0 }, uErode: { value: 1 }, uFade: { value: 1 },
          uSeed: { value: 0 }, uHead: { value: 0 }, uKey: { value: KEY_DIR },
        },
        transparent: true, depthWrite: true, side: THREE.DoubleSide, fog: false,
      });
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 3;
      m.frustumCulled = false;
      this.node.add(m);
      return mat;
    });
    this.kind = null;
  }

  /** 起一道：哪一段、第二段指著的末端點。 */
  start(kind, tip) {
    const T = TRAILS[kind];
    this.kind = kind;
    this.tip = tip;
    this.tau = 0;
    this.rows = 0;
    this._th = null;
    this._len = 0;
    this._last = null;
    const seed = Math.random() * 100;
    for (const m of this._mats) {
      const u = m.uniforms;
      u.uSeed.value = seed;
      /* 最後一排在 t1 鋪上去，要在 life 被吃完。 */
      u.uErode.value = Math.max(0.05, T.life - T.t1 - HOLD);
    }
    this.geometry.setDrawRange(0, 0);
    this.node.visible = true;
  }

  /** 往前一幀：還在掃就把這一幀掃過的那一段鋪上去。回 false 就是收掉了。 */
  step(dt, player) {
    const T = TRAILS[this.kind];
    const prev = this.tau;
    this.tau += dt;
    if (prev <= T.t1) this._lay(sweepAt(this.kind, this.tau), player);
    for (const m of this._mats) {
      m.uniforms.uNow.value = this.tau;
      m.uniforms.uFade.value = fadeAt(this.kind, this.tau);
    }
    this.node.visible = this.tau < T.life;
    return this.node.visible;
  }

  /** 收起來。 */
  stop() { this.node.visible = false; }

  /**
   * 掃到 θ 了：從上一排往 θ 每 PIECE 固定一排（第一次先鋪起點那一排），刀尖在 θ
   * 那一排當頭、不固定。
   */
  _lay(theta, player) {
    const T = TRAILS[this.kind], dir = Math.sign(T.to - T.from);
    if (this._th === null) { this._th = T.from; this._row(T.from, player, true); }
    while ((theta - this._th) * dir >= PIECE) {
      this._th += PIECE * dir;
      this._row(this._th, player, true);
    }
    const head = theta !== this._th && this._row(theta, player, false);
    for (const m of this._mats) m.uniforms.uHead.value = head ? this._headL : this._len;
    const A = this._a;
    for (const k in A) A[k].needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, this.rows + (head ? 1 : 0) - 1) * ACROSS * 6);
  }

  /** 在第 rows 排寫下角度 θ 的橫截面。keep：固定下來（rows 往前一格），不然是頭。 */
  _row(theta, player, keep) {
    if (this.rows >= ROWS) return false;
    const q = qiAt(this.kind, theta, player, this.tip), { d, t } = q.b;
    const len = this._last ? this._len + Math.hypot(q.p[0] - this._last[0], q.p[1] - this._last[1], q.p[2] - this._last[2]) : 0;
    const N = [d[1] * t[2] - d[2] * t[1], d[2] * t[0] - d[0] * t[2], d[0] * t[1] - d[1] * t[0]];
    const A = this._a;
    for (let j = 0; j <= ACROSS; j++) {
      const i = this.rows * (ACROSS + 1) + j, s = -1 + (2 * j) / ACROSS;
      A.position.setXYZ(i, q.p[0] + d[0] * s * q.w / 2, q.p[1] + d[1] * s * q.w / 2, q.p[2] + d[2] * s * q.w / 2);
      A.aN.setXYZ(i, N[0], N[1], N[2]);
      A.aD.setXYZ(i, d[0], d[1], d[2]);
      A.aS.setX(i, s);
      A.aL.setX(i, len);
      A.aBorn.setX(i, this.tau);
      A.aW.setX(i, q.w / 2);
    }
    this._headL = len;
    if (keep) {
      this._len = len;
      this._last = q.p;
      this.rows++;
    }
    return true;
  }
}
