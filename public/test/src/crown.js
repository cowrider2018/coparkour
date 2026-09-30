/* ── test/src/crown.js ────────────────────────────────────────
   國王戴的王冠：一圈金色的冠環坐在頭頂上，上緣是一圈尖角，尖角頂上各一顆金珠，
   正面冠環上鑲一顆紅寶石。

     冠環   平面輪廓是一個橢圓（中心 RING.c、半徑 RING.r），坐在頭頂上：頭頂幾乎是平的
            （y 2.06），邊上是圓角方形的角——y 2.02 以上那一截在 x ±0.87、z −0.78～0.96，
            四個角離中心 0.99，冠環的內面比它大，下緣 RING.y0 就壓在那一截的高度。上緣在 RING.y1 與 RING.tip 之間走鋸齒：RING.points 個尖角，一個正對前面。
            冠環有內外兩面，頂上一條窄邊封起來。
     耳朵   國王是垂耳狗，耳朵最高到 y 1.72，在冠環底下，不必讓路。

   跟頭盔（helm.js）一樣掛在頭那根骨頭上、尺寸是模型單位、頭骨座標（+X 左頰、+Y 上、
   +Z 前）；墨線一樣是外推一點、只畫背面的殼，材質交給那隻動物的墨色一起換（攻擊中轉紅）。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { toon, INK } from './palette.js';

/** 冠環：輪廓中心、半徑（x, z）、下緣、尖角之間的上緣、尖角頂、幾個尖角、厚度。 */
const RING = { c: [0, 0.09], r: [1.08, 1.08], y0: 2.02, y1: 2.38, tip: 2.88, points: 5, t: 0.06 };
/** 尖角頂上的金珠、正面的寶石：半徑。寶石在冠環正面的高度。 */
const BEAD = 0.09;
const GEM = { r: 0.13, y: 2.2 };
const INK_OUT = 0.05;
/** 尺寸（驗證器量王冠跟狗頭的相對位置用）。 */
export const CROWN = { RING, BEAD, GEM, INK_OUT };
const COL = { gold: 0xe8b53a, gem: 0xd8283a };

/** 每一個尖角切幾格（尖角正好落在格線上）。 */
const PER = 24;

/** 冠環上緣在角度 θ（0 = 正前方，往 +X 轉）的高度：尖角之間是一條鋸齒。 */
export function crownTop(th) {
  const span = (2 * Math.PI) / RING.points;
  let d = th / span;
  d = Math.abs(d - Math.round(d));                  // 離最近的尖角幾成（0～0.5）
  return RING.tip - (RING.tip - RING.y1) * 2 * d;
}

/** 冠環輪廓上角度 θ 的那一點（半徑再加 grow）與往外的法線。 */
function onRing(th, grow) {
  const [rx, rz] = RING.r, s = Math.sin(th), c = Math.cos(th);
  const nx = s / rx, nz = c / rz, l = Math.hypot(nx, nz);
  return [RING.c[0] + (rx + grow) * s, RING.c[1] + (rz + grow) * c, nx / l, nz / l];
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

function buildCrown(inkMat) {
  const g = new THREE.Group();
  g.add(named('ring', ringGeometry(false), toon(COL.gold)));
  g.add(named('ring-ink', ringGeometry(true), inkMat));
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
    this.node = buildCrown(this.ink);
    this.node.matrixAutoUpdate = false;
    this._host = null;
  }

  /** 戴到這一隻頭上。墨線跟著牠的墨色換（Critter 的 setInkColor）。 */
  follow(critter) {
    if (this._host === critter) return;
    this._host = critter;
    critter.mesh.add(this.node);
    if (!critter._inkMats.includes(this.ink)) critter._inkMats.push(this.ink);
    this._headBone = critter.rig.bone('head');
  }

  /** 這一幀的頭在哪，王冠就在哪。要在 critter.update 之後叫。 */
  update() {
    if (!this._host) return;
    this.node.matrix.fromArray(this._host.rig.matrices, this._headBone * 16);
    this.node.matrixWorldNeedsUpdate = true;
  }
}
