/* ── test/src/qi.js ─────────────────────────────────────────────────
   劍光：刀掃過去的那一瞬間留下的一道光（形狀與時間在 trail.js，這裡把它畫出來）。

   要的是俐落：一道月牙，平色分三區——外緣一條白（打得到的最遠處）、中間淺藍、
   內側深一點又透一點；每一條邊都是硬的（一個像素寬的抗鋸齒），沒有漸層、不流動、
   不晃。寬度幾乎蓋滿整片打得到的範圍，出現得快、收得也快。

   ── 網格 ────────────────────────────────────────────────────────
   一條帶子，沿著刀尖掃過的路徑一排一排鋪上去（step），每一排是月牙的一個
   橫截面：從內緣到外緣 ACROSS 格，外緣在 REACH 上（trail.js 的 qiAt）。
   每一排從鋪下去那一幀的玩家身上算，接在上一排後面，所以整道是連續的一筆，
   人在揮的時候轉向也只是讓它彎一下。

   排是照角度鋪的，不是照幀：每掃過 PIECE 固定一排，刀尖現在的位置另外一排
   「頭」，下一幀就覆寫掉。照幀鋪的話排數跟著幀率走——144Hz 或慢動作下，
   一整圈的排數會超過網格。

   ── 收 ──────────────────────────────────────────────────────────
   每一排鋪下去 HOLD 秒之後開始收：內緣往外緣收，FLASH 秒收到外緣、不見。先鋪的先收，所以尾巴先沒、刀尖最後——一道光從尾巴往刀尖
   收掉，外緣（打得到的最遠處）留到最後。

   第二段例外：那片扇形是立著的，鏡頭通常正好從它的側面看，一條沿著半徑鋪開
   的帶子只剩一條線。所以第二段的帶子橫過來——寬度沿著扇形的法線、貼著 REACH
   內側立成一道弧——從玩家背後看是一道正對鏡頭的弧光。帶子的「外緣」（最亮的
   那一邊）這時候是朝上那一邊。

   兩端收成尖：離頭尾不到 END 公尺的地方，帶子往中間收。刀尖現在的位置（頭）
   因此一直是尖的，第三段一整圈頭尾疊在一起的地方也不會有一道切痕。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { TRAILS, PIECE, sweepAt, fadeAt, qiAt, along } from './trail.js';
import { REACH } from './combat.js';

/** 一排橫截面切幾格。 */
const ACROSS = 4;

/** 最多幾排：一整圈多一點、每 PIECE（trail.js）一排是 6.6 / 0.12 ≈ 56，加上起點與刀尖。 */
const ROWS = 64;

/** 頭尾收成尖的那一段多長（公尺）。 */
const END = 0.35;

/** 三區的分界（橫截面上從內緣 0 到外緣 1）：內側、中間、外緣那一條白。 */
const ZONES = [0.45, 0.85];

/** 第二段那一道弧離 REACH 往內多少、最寬多寬（公尺）。 */
const RISE_IN = 0.06;
const RISE_W = 0.9;

/** 一排鋪上去之後多久開始收（秒）。 */
const HOLD = 0.04;

/** 一排從開始收到收成一條線不見（秒）。 */
const FLASH = 0.16;

const VERT = /* glsl */ `
attribute float aS;     // 橫截面上的位置：內緣 −1、外緣 +1
attribute float aL;     // 沿著月牙的長度（公尺）
attribute float aBorn;  // 這一排什麼時候鋪上去的（秒，從出招量）
varying float vS;
varying float vL;
varying float vBorn;
void main() {
  vS = aS; vL = aL; vBorn = aBorn;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uNow, uFade, uHead;
varying float vS;
varying float vL;
varying float vBorn;
void main() {
  // 收：內緣往外緣走（s 從 −1 走到快 1），走完就只剩外緣那一線。
  float age = clamp((uNow - vBorn - ${HOLD.toFixed(2)}) / ${FLASH.toFixed(2)}, 0.0, 1.0);
  float inner = mix(-1.0, 1.05, max(age * age, 1.0 - uFade));
  // 離兩條邊多遠（s 的單位），兩端再收成尖。
  float f = min(vS - inner, 1.0 - vS);
  f = min(f, min(vL, uHead - vL) / ${END.toFixed(2)} * (1.0 - inner) * 0.5);
  float cover = clamp(f / max(fwidth(f), 1e-5) + 0.5, 0.0, 1.0);
  if (cover <= 0.0) discard;
  // 外緣是白的，往內淡成淡藍、淡成透明。
  // 三區平色（硬邊，一個像素寬的抗鋸齒）：外緣一條白、中間淺藍、內側深一點又透一點。
  // 照還剩下的那一截切，往外緣收的時候三區一起變窄，白邊一直在。
  float t = (vS - inner) / max(1.0 - inner, 1e-3), tw = max(fwidth(t), 1e-4);
  float mid = smoothstep(${ZONES[0]} - tw, ${ZONES[0]} + tw, t);
  float out_ = smoothstep(${ZONES[1]} - tw, ${ZONES[1]} + tw, t);
  vec3 col = mix(mix(vec3(0.45, 0.72, 1.0), vec3(0.74, 0.89, 1.0), mid), vec3(1.0), out_);
  float a = mix(mix(0.45, 0.75, mid), 1.0, out_);
  gl_FragColor = vec4(col, cover * a);
}`;

/** 一道劍光。借來、start、每幀 step，step 回 false 就是收掉了，可以再借。 */
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
    this._a = { position: attr('position', 3), aS: attr('aS', 1), aL: attr('aL', 1), aBorn: attr('aBorn', 1) };
    const idx = [];
    for (let r = 0; r < ROWS - 1; r++) {
      for (let j = 0; j < ACROSS; j++) {
        const a = r * (ACROSS + 1) + j, b = a + ACROSS + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    g.setIndex(idx);
    this.geometry = g;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uNow: { value: 0 }, uFade: { value: 1 }, uHead: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.node = new THREE.Mesh(g, this.material);
    this.node.renderOrder = 3;
    this.node.frustumCulled = false;
    this.node.visible = false;
    this.kind = null;
  }

  /** 起一道：哪一段、第二段指著的末端點。 */
  start(kind, tip) {
    this.kind = kind;
    this.tip = tip;
    this.tau = 0;
    this.rows = 0;
    this._th = null;
    this._len = 0;
    this._last = null;
    this.geometry.setDrawRange(0, 0);
    this.node.visible = true;
  }

  /** 往前一幀：還在掃就把這一幀掃過的那一段鋪上去。回 false 就是收掉了。 */
  step(dt, player) {
    const T = TRAILS[this.kind];
    const prev = this.tau;
    this.tau += dt;
    if (prev <= T.t1) this._lay(sweepAt(this.kind, this.tau), player);
    const u = this.material.uniforms;
    u.uNow.value = this.tau;
    u.uFade.value = fadeAt(this.kind, this.tau);
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
    this.material.uniforms.uHead.value = head ? this._headL : this._len;
    for (const k in this._a) this._a[k].needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, this.rows + (head ? 1 : 0) - 1) * ACROSS * 6);
  }

  /** 在第 rows 排寫下角度 θ 的橫截面。keep：固定下來（rows 往前一格），不然是頭。 */
  _row(theta, player, keep) {
    if (this.rows >= ROWS) return false;
    let q = qiAt(this.kind, theta, player, this.tip), { d } = q.b;
    if (this.kind === 'rise') {
      /* 第二段橫過來：寬度沿著扇形的法線（刀的方向 × 掃的方向），中心貼著 REACH 內側。 */
      const t = q.b.t;
      d = [d[1] * t[2] - d[2] * t[1], d[2] * t[0] - d[0] * t[2], d[0] * t[1] - d[1] * t[0]];
      q = { ...q, p: along(q.b, REACH - RISE_IN), w: (RISE_W * q.w) / TRAILS.rise.width };
    }
    const len = this._last ? this._len + Math.hypot(q.p[0] - this._last[0], q.p[1] - this._last[1], q.p[2] - this._last[2]) : 0;
    const A = this._a;
    for (let j = 0; j <= ACROSS; j++) {
      const i = this.rows * (ACROSS + 1) + j, s = -1 + (2 * j) / ACROSS;
      A.position.setXYZ(i, q.p[0] + d[0] * s * q.w / 2, q.p[1] + d[1] * s * q.w / 2, q.p[2] + d[2] * s * q.w / 2);
      A.aS.setX(i, s);
      A.aL.setX(i, len);
      A.aBorn.setX(i, this.tau);
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
