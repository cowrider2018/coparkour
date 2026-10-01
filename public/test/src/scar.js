/* ── test/src/scar.js ─────────────────────────────────────────────────
   國王劈砍在劍長以內留下的斬痕：那一刀砍進地板的一道暗色裂口。

   這不是劍光——劍光是亮的、一閃就收（qi.js）；斬痕是力道大到把地面劈開的
   物理痕跡：暗色、平塗、硬邊。只在劍砍得到的那一截（skills.js 的 hew 那一刀，
   長 SKILL.hew.len，黑牆比劍近的話到牆為止）；往前推出去的氣流不留痕（gust.js）。

   ── 形狀 ─────────────────────────────────────────────────────────
   一條沿著那一刀中線的帶子，每 SEG 公尺一個樣本。每個樣本的寬度與左右偏一點都是
   固定的亂數（照樣本的編號算），所以邊緣是鋸齒、中線微微折——裂開的，不是畫上去的
   線。橫截面兩區：外面一圈是壓暗的裂緣（半透明，透出底下的地板顏色），裡面是幾乎
   全黑的裂縫。

   起點那一頭收成尖（劍落下的地方往前 START 才全寬），劍尖那一頭也收成尖（最後
   TIP 公尺收到 0）。

   ── 什麼時候裂、什麼時候合 ───────────────────────────────────────
   劈下去那一刻從劍落下的地方往劍尖撕開（每秒 TEAR 公尺，一眨眼），HOLD 秒之後在
   CLOSE 秒裡合上（寬度收到 0）——先裂的先合，所以從國王腳下往劍尖收掉。

   地板不平的地方（流程模式的台階、坑）：樣本底下的地板不在國王那一層的，那一個樣本
   不畫——斬痕不會浮在坑上，也不會插進台階裡。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { floorUnder } from './bleed.js';

/** 兩個樣本之間隔多遠（公尺）。 */
const SEG = 0.18;

/** 一道最多幾個樣本：劍長兩公尺上下，留足夠的餘裕。 */
const MAX = 32;

/** 全寬是多寬（公尺），裡面那一道黑的佔幾成。 */
const WIDE = 0.24, CORE = 0.42;

/** 每個樣本的寬度在全寬的幾倍之間抽、中線左右偏多少（公尺）。 */
const JAG = [0.65, 1.15], ZIG = 0.025;

/** 斬痕最寬的地方離中線多遠（公尺）：犁地的塵挖掉的那一條至少這麼寬，才不會蓋住它（fight.js）。 */
export const SCAR_REACH = (WIDE / 2) * JAG[1] + ZIG;

/** 起點那一頭：從劍落下的地方（離國王腳下劍長的 FROM 倍）往前 START 公尺才全寬。 */
const FROM = 0.35, START = 0.45;

/** 劍尖那一頭：最後 TIP 公尺收到 0。 */
const TIP = 0.35;

/** 往劍尖撕開多快（公尺 / 秒）、裂開之後撐多久才開始合、合要多久（秒）。 */
const TEAR = 25, HOLD = 1.1, CLOSE = 0.35;

/** 離地板多高：比血泊（blood.js，0.02）、預告（fx.js，0.03）都低，它們蓋得過它。 */
const LIFT = 0.015;

/** 兩區的顏色（rgb、alpha）：裂緣、裂縫。 */
const RIM = [0.10, 0.07, 0.05, 0.55], DEEP = [0.03, 0.02, 0.015, 0.92];

const f3 = (v) => v.map((x) => x.toFixed(3)).join(', ');

const VERT = /* glsl */ `
attribute vec3 aSide;   // 往兩邊撐開的方向（單位向量）
attribute float aV;     // 這一點在哪一邊（-1、1）
attribute float aHalf;  // 這個樣本的半寬（亂數與兩頭的收尖都算進去了）
attribute float aBorn;  // 什麼時候裂開的（秒）
uniform float uNow;
varying float vV;
void main() {
  float age = uNow - aBorn;
  float open = age < 0.0 ? 0.0 : 1.0 - smoothstep(${HOLD.toFixed(3)}, ${(HOLD + CLOSE).toFixed(3)}, age);
  vV = aV;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + aSide * aV * aHalf * open, 1.0);
}`;

const FRAG = /* glsl */ `
varying float vV;
void main() {
  float d = abs(vV), aa = fwidth(vV);
  float deep = 1.0 - smoothstep(${CORE.toFixed(3)} - aa, ${CORE.toFixed(3)} + aa, d);
  float edge = 1.0 - smoothstep(1.0 - 2.0 * aa, 1.0, d);
  vec4 c = mix(vec4(${f3(RIM)}), vec4(${f3(DEEP)}), deep);
  gl_FragColor = vec4(c.rgb, c.a * edge);
}`;

/** 第 i 個樣本的固定亂數（0～1）。 */
const hash = (i, k) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const ATTRS = [['position', 3], ['aSide', 3], ['aV', 1], ['aHalf', 1], ['aBorn', 1]];

/** 一道斬痕：一條帶子，劈下去那一刻整條寫好。 */
class Mark {
  constructor() {
    const g = new THREE.BufferGeometry();
    for (const [name, n] of ATTRS) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(MAX * 2 * n), n));
    const idx = [];
    for (let i = 0; i < MAX - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uNow: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.g = g;
    /** 最後一個樣本合完的時候（秒）：過了就可以收起來。 */
    this.over = 0;
  }

  /**
   * 寫下整條：samples 是每一個樣本 { p 中線上的一點, side 往兩邊撐開的方向, half 半寬, born 什麼時候裂開 }。
   */
  write(samples) {
    const a = this.g.attributes, n = Math.min(MAX, samples.length);
    for (let i = 0; i < n; i++) {
      const { p, side, half, born } = samples[i];
      for (const v of [-1, 1]) {
        const k = 2 * i + (v + 1) / 2;
        a.position.setXYZ(k, p[0], p[1], p[2]);
        a.aSide.setXYZ(k, side[0], side[1], side[2]);
        a.aV.setX(k, v);
        a.aHalf.setX(k, half);
        a.aBorn.setX(k, born);
      }
      this.over = Math.max(this.over, born + HOLD + CLOSE);
    }
    for (const [name] of ATTRS) a[name].needsUpdate = true;
    this.g.setDrawRange(0, Math.max(0, n - 1) * 6);
  }
}

/** 場上的斬痕：國王每劈一下一道。 */
export class Scars {
  constructor(scene) {
    this.scene = scene;
    this.now = 0;
    this.live = [];
    this.spare = [];
  }

  /**
   * 劈下去了：沿那一刀（skills.js 的 hew 回傳的長條：從 (x, z) 往 (dirX, dirZ) 長 len，在 y 那一層）
   * 留一道。cols 是場上的碰撞清單：樣本底下的地板不在那一層就不畫。
   */
  cut(st, cols) {
    const side = [st.dirZ, 0, -st.dirX], s0 = FROM * st.len, out = [];
    for (let i = 0, s = s0; ; i++, s = Math.min(st.len, s + SEG)) {
      const zig = (hash(i, 1) * 2 - 1) * ZIG;
      const x = st.x + st.dirX * s + side[0] * zig, z = st.z + st.dirZ * s + side[2] * zig;
      const flat = Math.abs(floorUnder(cols, x, z, st.y + 0.05) - st.y) < 0.04;
      const grow = Math.sin((Math.PI / 2) * Math.min(1, (s - s0) / START));
      const tip = Math.min(1, (st.len - s) / TIP);
      const half = flat ? (WIDE / 2) * (JAG[0] + (JAG[1] - JAG[0]) * hash(i, 2)) * grow * tip : 0;
      out.push({ p: [x, st.y + LIFT, z], side, half, born: this.now + (s - s0) / TEAR });
      if (s >= st.len) break;
    }
    const m = this.spare.pop() || new Mark();
    if (!m.mesh.parent) this.scene.add(m.mesh);
    m.mesh.visible = true;
    m.over = 0;
    m.write(out);
    this.live.push(m);
  }

  /** 全部收掉（回到站位、換陣容）。 */
  clear() {
    for (const m of this.live) { m.mesh.visible = false; this.spare.push(m); }
    this.live.length = 0;
  }

  draw(dt) {
    this.now += dt;
    this.live = this.live.filter((m) => {
      m.mat.uniforms.uNow.value = this.now;
      if (this.now < m.over) return true;
      m.mesh.visible = false;
      this.spare.push(m);
      return false;
    });
  }
}
