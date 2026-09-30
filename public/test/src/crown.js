/* ── test/src/crown.js ────────────────────────────────────────
   國王戴的王冠：一圈金色的冠環坐在頭頂上，上緣是一圈尖角，尖角頂上各一顆金珠，
   正面冠環上鑲一顆紅寶石。

     冠環   平面輪廓是一個圓角矩形（超橢圓：中心 RING.c、半徑 RING.r、指數 RING.n），跟頭一樣
            方。頭頂是圓角化的：兩側到 y 1.7 上下還是滿寬（x ±1.19），再往上一路收進去，最高的
            y 2.06 那一片平台只剩 x ±0.61、z −0.51～0.68。冠環的下緣 RING.y0（y 1.74，剛好在耳朵
            最高的 1.72 之上）壓在圓角剛開始收的地方，外面正好貼著那一高度以上的整個頭（x ±1.162、
            z −1.055～1.244，量頭的頂點得來），厚度 t 往內長進頭裡面，不凸出頭外——包住額頭，不是
            只箍在頭頂那一小塊平面上。上緣在 RING.y1 與 RING.tip 之間走鋸齒：RING.points 個尖角，
            四個角與四邊正中各一個，一個正對前面。冠環有內外兩面，頂上一條窄邊封起來。
     底板   冠環內面與頭頂平台之間本來看得到頭頂圓角收進去的那一圈空隙：一片金色的平板
            （FLOOR）蓋住它——高度剛好在頭頂最高點之上，從冠環內面一直鋪到平台的輪廓，頭頂只從
            中間那一塊露出來。
     耳朵   國王是垂耳狗，耳朵最高到 y 1.72，在冠環底下，不必讓路。

   ── 墨線 ─────────────────────────────────────────────────────────
   外緣跟刀、頭盔一樣是外推一點、只畫背面的殼（INK_OUT）——輪廓線。但冠環貼著頭，殼的下緣
   埋在頭裡，只畫背面的殼在「王冠與頭相接」的那兩道看不到線，所以那兩道另外鋪一條正面的墨色
   窄帶（寬 INK_OUT，LIP）：冠環外面最下面那一條、底板上貼著頭頂那一圈。

   跟頭盔（helm.js）一樣掛在頭那根骨頭上、尺寸是模型單位、頭骨座標（+X 左頰、+Y 上、
   +Z 前）；墨線一樣是外推一點、只畫背面的殼，材質交給那隻動物的墨色一起換（攻擊中轉紅）。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { toon, INK } from './palette.js';

/** 冠環：輪廓中心、半徑（x, z）、超橢圓的指數（越大越方）、下緣、尖角之間的上緣、尖角頂、
    幾個尖角、厚度。 */
const RING = { c: [0, 0.0944], r: [1.1622, 1.1498], n: 6, y0: 1.74, y1: 2.204, tip: 2.572, points: 8, t: 0.06 };
/** 尖角頂上的金珠、正面的寶石：半徑。寶石在冠環正面的高度。 */
const BEAD = 0.09;
/** 底板：高度（頭頂最高 2.0603 之上一點）、內緣的輪廓（頭頂平台的中心、半徑，指數跟冠環一樣）。 */
const FLOOR = { y: 2.065, c: [0, 0.086], r: [0.607, 0.591] };
/** 相接那兩道墨色窄帶離表面多遠（壓在金色上面、不打架）。 */
const LIP = 0.003;
const GEM = { r: 0.13, y: 2.068 };
const INK_OUT = 0.05;
/** 尺寸（驗證器量王冠跟狗頭的相對位置用）。 */
export const CROWN = { RING, FLOOR, BEAD, GEM, INK_OUT };
const COL = { gold: 0xe8b53a, gem: 0xd8283a };

/** 每一個尖角切幾格（尖角正好落在格線上）。 */
const PER = 24;

/** 冠環上緣在參數角 θ（0 = 正前方，往 +X 轉；見 onRing）的高度：尖角之間是一條鋸齒。 */
export function crownTop(th) {
  const span = (2 * Math.PI) / RING.points;
  let d = th / span;
  d = Math.abs(d - Math.round(d));                  // 離最近的尖角幾成（0～0.5）
  return RING.tip - (RING.tip - RING.y1) * 2 * d;
}

const spow = (x, e) => Math.sign(x) * Math.abs(x) ** e;

/**
 * 冠環輪廓上參數角 θ 的那一點（半徑再加 grow）與往外的法線（超橢圓的梯度方向）。
 * θ 每 45° 一個：0 是正前方、45° 是角，所以尖角照 θ 等分就落在四角與四邊正中。
 */
function onRing(th, grow) {
  const [rx, rz] = RING.r, e = 2 / RING.n;
  const u = spow(Math.sin(th), e), w = spow(Math.cos(th), e);
  const nx = spow(u, RING.n - 1) / rx, nz = spow(w, RING.n - 1) / rz, l = Math.hypot(nx, nz) || 1;
  return [RING.c[0] + (rx + grow) * u, RING.c[1] + (rz + grow) * w, nx / l, nz / l];
}

/** 中心 c、半徑 r（x, z）、指數 RING.n 的超橢圓上參數角 θ 那一點（跟 onRing 同一種參數化）。 */
function onOval(th, c, r) {
  const e = 2 / RING.n;
  return [c[0] + r[0] * spow(Math.sin(th), e), c[1] + r[1] * spow(Math.cos(th), e)];
}

/** 兩圈輪廓 a(θ)、b(θ) 之間、高 y 的一片平的環（法線朝上，兩面都畫）。 */
function bandGeometry(a, b, y) {
  const N = RING.points * PER, pos = [];
  for (let i = 0; i < N; i++) {
    const t0 = (i / N) * 2 * Math.PI, t1 = ((i + 1) / N) * 2 * Math.PI;
    const [ax, az] = a(t0), [bx, bz] = a(t1), [cx, cz] = b(t1), [dx, dz] = b(t0);
    pos.push(ax, y, az, bx, y, bz, cx, y, cz, ax, y, az, cx, y, cz, dx, y, dz);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  return geo;
}

/** 冠環外面最下面那一條墨色窄帶：y0 到 y0 + INK_OUT，貼在外面外 LIP。 */
function lipGeometry() {
  const N = RING.points * PER, pos = [], nrm = [];
  const y0 = RING.y0, y1 = RING.y0 + INK_OUT;
  for (let i = 0; i < N; i++) {
    const t0 = (i / N) * 2 * Math.PI, t1 = ((i + 1) / N) * 2 * Math.PI;
    const [ax, az, anx, anz] = onRing(t0, LIP), [bx, bz, bnx, bnz] = onRing(t1, LIP);
    for (const [x, y, z, nx, nz] of [[ax, y0, az, anx, anz], [bx, y0, bz, bnx, bnz], [bx, y1, bz, bnx, bnz],
      [ax, y0, az, anx, anz], [bx, y1, bz, bnx, bnz], [ax, y1, az, anx, anz]]) {
      pos.push(x, y, z); nrm.push(nx, 0, nz);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return geo;
}

/**
 * 冠環的幾何：外面、內面（往內 t）、頂上那一條窄邊。ink 的話只要外面那一層，整個往外
 * 長 INK_OUT（下緣往下、上緣往上、半徑往外）——墨線殼。
 */
function ringGeometry(ink) {
  const N = RING.points * PER, pos = [], nrm = [];
  const g = ink ? INK_OUT : 0;
  const quad = (a, b, c, d, na, nb) => {
    for (const [p, n] of [[a, na], [b, nb], [c, nb], [a, na], [c, nb], [d, na]]) { pos.push(...p); nrm.push(...n); }
  };
  for (let i = 0; i < N; i++) {
    const t0 = (i / N) * 2 * Math.PI, t1 = ((i + 1) / N) * 2 * Math.PI;
    const top0 = crownTop(t0) + g, top1 = crownTop(t1) + g, y0 = RING.y0 - g;
    const [ax, az, anx, anz] = onRing(t0, g), [bx, bz, bnx, bnz] = onRing(t1, g);
    const na = [anx, 0, anz], nb = [bnx, 0, bnz];
    // 外面：從外面看是逆時針（θ 往 +X 轉，從外面看是往右）。
    quad([ax, y0, az], [bx, y0, bz], [bx, top1, bz], [ax, top0, az], na, nb);
    if (ink) continue;
    const [cx, cz] = onRing(t0, -RING.t), [dx, dz] = onRing(t1, -RING.t);
    const ia = [-anx, 0, -anz], ib = [-bnx, 0, -bnz];
    quad([dx, y0, dz], [cx, y0, cz], [cx, top0, cz], [dx, top1, dz], ib, ia);
    // 頂上的窄邊：外緣到內緣。
    quad([ax, top0, az], [bx, top1, bz], [dx, top1, dz], [cx, top0, cz], [0, 1, 0], [0, 1, 0]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return geo;
}

/** 一顆球（本體與墨線殼）擺在 (x, y, z)。 */
function ball(g, r, color, inkMat, [x, y, z]) {
  for (const [rr, mat] of [[r, toon(color)], [r + INK_OUT, inkMat]]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(rr, 16, 12), mat);
    m.position.set(x, y, z);
    g.add(m);
  }
}

/** 一個 mesh，帶名字（驗證器照名字找）。 */
const named = (name, geo, mat) => Object.assign(new THREE.Mesh(geo, mat), { name });

function buildCrown(inkMat, lipMat) {
  const g = new THREE.Group();
  g.add(named('ring', ringGeometry(false), toon(COL.gold)));
  g.add(named('ring-ink', ringGeometry(true), inkMat));
  // 底板：冠環內面到頭頂平台；貼著平台那一圈是墨色窄帶。
  const inner = (th) => onOval(th, FLOOR.c, FLOOR.r);
  const lipOut = (th) => onOval(th, FLOOR.c, [FLOOR.r[0] + INK_OUT, FLOOR.r[1] + INK_OUT]);
  const floor = toon(COL.gold);
  floor.side = THREE.DoubleSide;
  g.add(named('floor', bandGeometry((th) => onRing(th, -RING.t), inner, FLOOR.y), floor));
  g.add(named('floor-lip', bandGeometry(lipOut, inner, FLOOR.y + LIP), lipMat));
  g.add(named('ring-lip', lipGeometry(), lipMat));
  for (let k = 0; k < RING.points; k++) {
    const th = (k / RING.points) * 2 * Math.PI;
    const [x, z] = onRing(th, -RING.t / 2);
    ball(g, BEAD, COL.gold, inkMat, [x, RING.tip + BEAD * 0.6, z]);
  }
  const [gx, gz] = onRing(0, 0);
  ball(g, GEM.r, COL.gem, inkMat, [gx, GEM.y, gz + GEM.r * 0.4]);
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

export class Crown {
  constructor() {
    /** 墨線外殼共用一顆材質：交給動物的墨色一起換。 */
    this.ink = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    /** 相接那兩道的墨色窄帶（正面畫）：也跟著換。 */
    this.lip = new THREE.MeshBasicMaterial({ color: INK, side: THREE.DoubleSide });
    this.node = buildCrown(this.ink, this.lip);
    this.node.matrixAutoUpdate = false;
    this._host = null;
  }

  /** 戴到這一隻頭上。墨線跟著牠的墨色換（Critter 的 setInkColor）。 */
  follow(critter) {
    if (this._host === critter) return;
    this._host = critter;
    critter.mesh.add(this.node);
    for (const mat of [this.ink, this.lip]) if (!critter._inkMats.includes(mat)) critter._inkMats.push(mat);
    this._headBone = critter.rig.bone('head');
  }

  /** 這一幀的頭在哪，王冠就在哪。要在 critter.update 之後叫。 */
  update() {
    if (!this._host) return;
    this.node.matrix.fromArray(this._host.rig.matrices, this._headBone * 16);
    this.node.matrixWorldNeedsUpdate = true;
  }
}
