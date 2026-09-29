/* ── test/src/qi.js ─────────────────────────────────────────────────
   劍光：刀掃過去的那一瞬間留下的一道光（形狀與時間在 trail.js，這裡把它畫出來）。

   要的是俐落：三道（trail.js 的 BANDS）合成一塊，光影照合起來的那一塊算一次，
   不是三道各算各的——平色分三區：外緣一條白、中間淺藍、內側深一點又透一點；
   每一條邊都是硬的（一個像素寬的抗鋸齒），沒有漸層、不流動、不晃。三道在起點
   那一頭是分開的三條尖尾，往刀那一頭變寬、併成一塊；出現得快、收得也快。

   ── 網格 ────────────────────────────────────────────────────────
   一條帶子，沿著刀掃過的路徑一排一排鋪上去（step），每一排是三道合起來的
   外框的一個橫截面：從最靠內的那一道的內緣，到最靠外的外緣，ACROSS 格
   （trail.js 的 hullOf）。每一排帶著它的半徑（aR）與那一截的寬度比例（aSide），
   片段自己用 BANDS 算出三道各在哪、合起來是哪幾段——不在任何一道裡面的就不畫，
   所以起點那裡三條尖尾之間是空的。

   每一排從鋪下去那一幀的玩家身上算，接在上一排後面，所以整塊是連續的一筆，
   人在揮的時候轉向也只是讓它彎一下。

   排是照角度鋪的，不是照幀：每掃過 PIECE 固定一排，刀尖現在的位置另外一排
   「頭」，下一幀就覆寫掉。照幀鋪的話排數跟著幀率走——144Hz 或慢動作下，
   一整圈的排數會超過網格。

   ── 光影 ────────────────────────────────────────────────────────
   三區照合起來的那一塊切：從合體的內緣（這一截最靠內的那一道的內緣）量到
   外緣，所以白只在最外面那一條——打得到的最遠處——裡面那兩道疊進來的地方
   不會多一條白邊，也不會因為疊了兩層而變亮。

   ── 收 ──────────────────────────────────────────────────────────
   每一排鋪下去 HOLD 秒之後開始收：合體的內緣往外緣收，FLASH 秒收到外緣、不見。
   先鋪的先收，所以尾巴先沒、刀尖最後——一道光從尾巴往刀尖收掉，外緣（打得到的
   最遠處）留到最後。三區照還剩下的那一截切，所以收的時候三區一起變窄，白邊一直在。

   一側寬：只有起點那一頭收成尖（sideAt，再乘上離起點不到 END 公尺的那一段
   往 0 收）；刀現在的位置（頭）不收，是一條跟刀平行的平邊。第三段一整圈，頭轉
   回來疊在尖的那一截上，平邊蓋過去、接得上。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { TRAILS, PIECE, BANDS, sweepAt, fadeAt, sideAt, bladeAt, along, hullOf } from './trail.js';

/** 一排橫截面切幾格。 */
const ACROSS = 4;

/** 最多幾排：最長的是騎士的劍迴旋，兩圈多一點、每 PIECE（trail.js）一排是 12.9 / 0.12 ≈ 108，
    加上起點與刀尖。 */
const ROWS = 112;

/** 起點收成尖的那一段多長（公尺，沿著外緣量）。 */
const END = 0.35;

/** 三區的分界（合體的橫截面上從內緣 0 到外緣 1）：內側、中間、外緣那一條白。 */
const ZONES = [0.45, 0.85];

/** 一排鋪上去之後多久開始收（秒）。 */
const HOLD = 0.04;

/** 一排從開始收到收成一條線不見（秒）。 */
const FLASH = 0.16;

const n4 = (v) => v.toFixed(4);
/** 第 i 道這一截的內緣（公尺，GLSL）。 */
const lo = (B) => `(${n4(B.out)} - ${n4(B.wide)} * vSide)`;
const TOP = hullOf(1).outer;

const VERT = /* glsl */ `
attribute float aR;     // 離刀根多遠（公尺，沿著刀量）
attribute float aSide;  // 這一截的寬度是每一道 wide 的幾成
attribute float aBorn;  // 這一排什麼時候鋪上去的（秒，從出招量）
varying float vR;
varying float vSide;
varying float vBorn;
void main() {
  vR = aR; vSide = aSide; vBorn = aBorn;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uNow, uFade;
varying float vR;
varying float vSide;
varying float vBorn;
void main() {
  // 收：合體的內緣往外緣走，走完就只剩外緣那一線、再過去就沒了。
  float age = clamp((uNow - vBorn - ${HOLD.toFixed(2)}) / ${FLASH.toFixed(2)}, 0.0, 1.0);
  float inner = ${BANDS.map(lo).reduce((a, b) => `min(${a}, ${b})`)};
  float cut = mix(inner, ${n4(TOP)}, 1.025 * max(age * age, 1.0 - uFade));
  // 在不在三道合起來的那一塊裡：每一道離自己兩條邊多遠（公尺），取最大就是合體。
  float f = -1.0e3;
${BANDS.map((B) => `  f = max(f, min(vR - max(${lo(B)}, cut), ${n4(B.out)} - vR));`).join('\n')}
  float cover = clamp(f / max(fwidth(f), 1e-5) + 0.5, 0.0, 1.0);
  if (cover <= 0.0) discard;
  // 三區平色（硬邊，一個像素寬的抗鋸齒）：照合體還剩下的那一截切，外緣一條白、
  // 中間淺藍、內側深一點又透一點。
  float t = (vR - cut) / max(${n4(TOP)} - cut, 1e-3), tw = max(fwidth(t), 1e-4);
  float mid = smoothstep(${ZONES[0]} - tw, ${ZONES[0]} + tw, t);
  float out_ = smoothstep(${ZONES[1]} - tw, ${ZONES[1]} + tw, t);
  vec3 col = mix(mix(vec3(0.45, 0.72, 1.0), vec3(0.74, 0.89, 1.0), mid), vec3(1.0), out_);
  float a = mix(mix(0.45, 0.75, mid), 1.0, out_);
  gl_FragColor = vec4(col, cover * a);
}`;

/** 一刀的劍光（三道合成一塊）。借來、start、每幀 step，step 回 false 就是收掉了，可以再借。 */
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
    this._a = { position: attr('position', 3), aR: attr('aR', 1), aSide: attr('aSide', 1), aBorn: attr('aBorn', 1) };
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
      uniforms: { uNow: { value: 0 }, uFade: { value: 1 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.node = new THREE.Mesh(g, this.material);
    this.node.renderOrder = 3;
    this.node.frustumCulled = false;
    this.node.visible = false;
    this.kind = null;
  }

  /**
   * 起一道：哪一段、第二段指著的末端點、畫多大（scale：刀上每一點離刀根的距離乘上它，
   * 1 是主角那一刀；騎士的劍迴旋照牠的半徑縮放）。
   */
  start(kind, tip, scale = 1) {
    this.kind = kind;
    this.tip = tip;
    this.scale = scale;
    this.tau = 0;
    this.rows = 0;
    this._th = null;
    /** 外緣鋪到多長、上一排的外緣固定在哪。 */
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
    for (const k in this._a) this._a[k].needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, this.rows + (head ? 1 : 0) - 1) * ACROSS * 6);
  }

  /** 在第 rows 排寫下角度 θ 的合體橫截面。keep：固定下來（rows 往前一格），不然是頭。 */
  _row(theta, player, keep) {
    if (this.rows >= ROWS) return false;
    const b = bladeAt(this.kind, theta, player, this.tip), k = this.scale, edge = along(b, TOP * k), last = this._last;
    const len = last ? this._len + Math.hypot(edge[0] - last[0], edge[1] - last[1], edge[2] - last[2]) : 0;
    const side = sideAt(this.kind, theta) * Math.min(1, len / END), { inner, outer } = hullOf(side);
    const A = this._a;
    for (let j = 0; j <= ACROSS; j++) {
      const i = this.rows * (ACROSS + 1) + j, r = inner + ((outer - inner) * j) / ACROSS, q = along(b, r * k);
      A.position.setXYZ(i, q[0], q[1], q[2]);
      A.aR.setX(i, r);
      A.aSide.setX(i, side);
      A.aBorn.setX(i, this.tau);
    }
    if (keep) {
      this._len = len;
      this._last = edge;
      this.rows++;
    }
    return true;
  }
}
