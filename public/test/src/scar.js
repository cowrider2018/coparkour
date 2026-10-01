/* ── test/src/scar.js ─────────────────────────────────────────────────
   國王劈砍留下的斬痕：那一刀砍進地板、氣流一路犁過去的一道暗色裂口。

   這不是劍光——劍光是亮的、一閃就收（qi.js）；斬痕是力道大到把地面劈開的
   物理痕跡：暗色、平塗、硬邊，跟著氣流往前長，停一下，再從近處往遠處合上。

   ── 形狀 ─────────────────────────────────────────────────────────
   一條沿著那一條（skills.js 的 hew 與氣流）中線的帶子，每 SEG 公尺一個樣本。每個樣本
   的寬度與左右偏一點都是固定的亂數（照樣本的編號算，同一刀每一幀都一樣），所以邊緣是
   鋸齒、中線微微折——裂開的，不是畫上去的線。橫截面兩區：外面一圈是壓暗的
   裂緣（半透明，透出底下的地板顏色），裡面是幾乎全黑的裂縫。

   起點那一頭收成尖（劍落下的地方往前 START 才全寬）；長到哪裡，那一頭也是尖的
   （TIP 公尺收到 0）——裂口是往前撕開的。

   ── 什麼時候長、什麼時候合 ───────────────────────────────────────
   劍長以內那一截是劍劈的：劈下去那一刻整截一起裂開。之後每一個樣本在氣流的前緣
   走過它的那一幀裂開，HOLD 秒之後在 CLOSE 秒裡合上（寬度收到 0）——先裂的先合，
   所以整道從國王腳下往遠處收掉。

   ── 撞上東西 ─────────────────────────────────────────────────────
   氣流撞上場上的東西（skills.js 的 blocker）停下來的那一刻，那個東西朝著它的那一面上
   多一道直的：從地板沿著那一面往上爬到氣流的高度（一個狗高，東西比那矮就到它頂），
   跟地上那一道同一種畫法，接在地上那一道的盡頭——地上那一道撞上東西的那一頭不收尖。
   黑牆不留（黑的，看不到）。

   地板不平的地方（流程模式的台階、坑）：樣本底下的地板不在氣流那一層的，那一個樣本
   不畫——斬痕不會浮在坑上，也不會插進台階裡。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { PHYS } from './walk.js';
import { SKILL } from './skills.js';
import { floorUnder } from './bleed.js';

/** 兩個樣本之間隔多遠（公尺）。 */
const SEG = 0.18;

/** 一道最多幾個樣本：46 公尺。比任何一間房的對角線都長。 */
const MAX = 256;

/** 全寬是多寬（公尺），裡面那一道黑的佔幾成。 */
const WIDE = 0.24, CORE = 0.42;

/** 每個樣本的寬度在全寬的幾倍之間抽、中線左右偏多少（公尺）。 */
const JAG = [0.65, 1.15], ZIG = 0.025;

/** 起點那一頭：從劍落下的地方（離國王腳下劍長的 FROM 倍）往前 START 公尺才全寬。 */
const FROM = 0.35, START = 0.45;

/** 長到哪裡，那一頭收尖：最後 TIP 公尺收到 0。 */
const TIP = 0.35;

/** 裂開之後撐多久才開始合，合要多久（秒）。 */
const HOLD = 1.1, CLOSE = 0.35;

/** 爬上東西那一道：每秒往上爬多快（公尺）——比氣流慢，看得到它爬上去。 */
const CLIMB = 8;

/** 地上那一道離地板多高：比血泊（blood.js，0.02）、預告（fx.js，0.03）都低，它們蓋得過它。 */
const LIFT = 0.015;

/** 爬上東西那一道離那一面多遠。 */
const OFF = 0.012;

/** 兩區的顏色（rgb、alpha）：裂緣、裂縫。 */
const RIM = [0.10, 0.07, 0.05, 0.55], DEEP = [0.03, 0.02, 0.015, 0.92];

const f3 = (v) => v.map((x) => x.toFixed(3)).join(', ');

const VERT = /* glsl */ `
attribute vec3 aSide;   // 往兩邊撐開的方向（單位向量）
attribute float aV;     // 這一點在哪一邊（-1、1）
attribute float aHalf;  // 這個樣本的半寬（亂數與起點的收尖都算進去了）
attribute float aBorn;  // 什麼時候裂開的（秒）
attribute float aS;     // 沿著那一道離起點多遠（公尺）
uniform float uNow, uFront;
varying float vV;
void main() {
  float age = uNow - aBorn;
  float open = age < 0.0 ? 0.0 : 1.0 - smoothstep(${HOLD.toFixed(3)}, ${(HOLD + CLOSE).toFixed(3)}, age);
  float tip = clamp((uFront - aS) / ${TIP.toFixed(3)}, 0.0, 1.0);
  vV = aV;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + aSide * aV * aHalf * open * tip, 1.0);
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

/** 第 i 個樣本的固定亂數（0～1）：同一刀每一幀都一樣。 */
const hash = (i, k) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** 一道斬痕：一條帶子，樣本一個一個加上去。 */
class Mark {
  constructor() {
    const g = new THREE.BufferGeometry();
    const buf = (n) => new THREE.BufferAttribute(new Float32Array(MAX * 2 * n), n).setUsage(THREE.DynamicDrawUsage);
    for (const [name, n] of [['position', 3], ['aSide', 3], ['aV', 1], ['aHalf', 1], ['aBorn', 1], ['aS', 1]]) g.setAttribute(name, buf(n));
    const idx = [];
    for (let i = 0; i < MAX - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uNow: { value: 0 }, uFront: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.g = g;
    this.n = 0;
  }

  /** 從頭開始：清空。 */
  reset() { this.n = 0; this.g.setDrawRange(0, 0); this.last = -1; }

  /** 加一個樣本：中線上的一點 p、往兩邊撐開的方向 side、半寬、什麼時候裂開、離起點多遠。 */
  push(p, side, half, born, s) {
    if (this.n >= MAX) return;
    const a = this.g.attributes;
    for (const v of [-1, 1]) {
      const k = 2 * this.n + (v + 1) / 2;
      a.position.setXYZ(k, p[0], p[1], p[2]);
      a.aSide.setXYZ(k, side[0], side[1], side[2]);
      a.aV.setX(k, v);
      a.aHalf.setX(k, half);
      a.aBorn.setX(k, born);
      a.aS.setX(k, s);
    }
    this.n++;
    for (const name of ['position', 'aSide', 'aV', 'aHalf', 'aBorn', 'aS']) a[name].needsUpdate = true;
    this.g.setDrawRange(0, Math.max(0, this.n - 1) * 6);
  }

  /** 最後一個樣本什麼時候裂開的：合完之後（再加一點餘裕）就可以收起來了。 */
  get over() { return this.lastBorn + HOLD + CLOSE; }
}

/**
 * 場上的斬痕：每一道氣流一道地上的，撞上東西的再加一道爬上去的。每幀 draw 一次，讀
 * world.gusts（skills.js）——新的氣流開一道，還在走的往前長，撞上東西的那一幀爬上去。
 */
export class Scars {
  constructor(scene) {
    this.scene = scene;
    this.now = 0;
    /** 還看得到的每一道：{ mark, gust, s（下一個樣本離起點多遠）, i（下一個樣本的編號）, y, cols } */
    this.live = [];
    this.spare = [];
  }

  _mark() {
    const m = this.spare.pop() || new Mark();
    m.reset();
    m.lastBorn = this.now;
    if (!m.mesh.parent) this.scene.add(m.mesh);
    m.mesh.visible = true;
    return m;
  }

  /** 全部收掉（回到站位、換陣容）。 */
  clear() {
    for (const r of this.live) { r.mark.mesh.visible = false; this.spare.push(r.mark); }
    this.live.length = 0;
  }

  /**
   * @param {number} dt
   * @param {object} world skills.js 的 makeWorld：讀 gusts 與 field
   */
  draw(dt, world) {
    this.now += dt;
    for (const g of world.gusts) {
      if (g.scar) continue;
      g.scar = true;
      const len = SKILL.hew.len;
      const rec = { mark: this._mark(), gust: g, s: FROM * len, i: 0, cols: world.field.cols, wall: null };
      // 劍劈的那一截：劈下去那一刻整截一起裂開。
      this._grow(rec, Math.min(g.to, len));
      this.live.push(rec);
    }
    for (const rec of this.live) {
      const g = rec.gust;
      if (!rec.done) {
        this._grow(rec, g.to, g.done);
        rec.mark.mat.uniforms.uFront.value = g.to + (g.done && g.blocker ? TIP : 0);
        if (g.done) {
          rec.done = true;
          if (g.blocker) rec.wall = this._climb(g);
        }
      }
      rec.mark.mat.uniforms.uNow.value = this.now;
      if (rec.wall) rec.wall.mat.uniforms.uNow.value = this.now;
    }
    this.live = this.live.filter((rec) => {
      const keep = !rec.done || this.now < Math.max(rec.mark.over, rec.wall ? rec.wall.over : 0) + 0.05;
      if (!keep) for (const m of [rec.mark, rec.wall]) if (m) { m.mesh.visible = false; this.spare.push(m); }
      return keep;
    });
  }

  /**
   * 地上那一道往前長到離起點 to：沿路每 SEG 一個樣本，這一刻裂開。end：氣流停在那裡了，
   * 盡頭再補一個剛好在 to 的樣本——撞上東西的話，接得上爬上去的那一道。
   */
  _grow(rec, to, end = false) {
    for (; rec.s <= to; rec.s += SEG) this._sample(rec, rec.s);
    if (end && to > rec.s - SEG + 1e-3) this._sample(rec, to);
  }

  /** 地上那一道離起點 s 的那一個樣本：底下的地板不在氣流那一層就不畫（半寬 0）。 */
  _sample(rec, s) {
    const g = rec.gust, side = [g.dirZ, 0, -g.dirX], i = rec.i++;
    const zig = (hash(i, 1) * 2 - 1) * ZIG;
    const x = g.x + g.dirX * s + side[0] * zig, z = g.z + g.dirZ * s + side[2] * zig;
    const flat = Math.abs(floorUnder(rec.cols, x, z, g.y + 0.05) - g.y) < 0.04;
    const grow = Math.min(1, Math.max(0, (s - FROM * SKILL.hew.len) / START));
    const half = flat ? (WIDE / 2) * (JAG[0] + (JAG[1] - JAG[0]) * hash(i, 2)) * Math.sin((Math.PI / 2) * grow) : 0;
    rec.mark.push([x, g.y + LIFT, z], side, half, this.now, s);
    rec.mark.lastBorn = this.now;
  }

  /**
   * 撞上東西那一道：那個東西朝著氣流的那一面上，離氣流前緣最近的那一點，從地板往上爬到
   * 一個狗高（東西比那矮就到它頂）。
   */
  _climb(g) {
    const b = g.blocker, fx = g.x + g.dirX * g.to, fz = g.z + g.dirZ * g.to;
    let px, pz, nx, nz;
    if (b.shape === 'circle') {
      const d = Math.hypot(fx - b.x, fz - b.z) || 1;
      [nx, nz] = d > 1e-6 ? [(fx - b.x) / d, (fz - b.z) / d] : [-g.dirX, -g.dirZ];
      px = b.x + nx * b.r; pz = b.z + nz * b.r;
    } else {
      px = Math.min(b.max[0], Math.max(b.min[0], fx));
      pz = Math.min(b.max[2], Math.max(b.min[2], fz));
      const dx = fx - px, dz = fz - pz, d = Math.hypot(dx, dz);
      [nx, nz] = d > 1e-6 ? [dx / d, dz / d] : [-g.dirX, -g.dirZ];
    }
    const top = Math.min(g.y + PHYS.height, b.max[1]), side = [nz, 0, -nx];
    const m = this._mark();
    const n = Math.max(2, Math.ceil((top - g.y) / SEG) + 1);
    for (let k = 0; k < n; k++) {
      const h = ((top - g.y) * k) / (n - 1), zig = (hash(k, 3) * 2 - 1) * ZIG;
      const half = (WIDE / 2) * (JAG[0] + (JAG[1] - JAG[0]) * hash(k, 4));
      m.push([px + nx * OFF + side[0] * zig, g.y + h, pz + nz * OFF + side[2] * zig], side, half, this.now + h / CLIMB, h);
      m.lastBorn = this.now + h / CLIMB;
    }
    m.mat.uniforms.uFront.value = top - g.y;
    return m;
  }
}
