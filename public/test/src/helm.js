/* ── test/src/helm.js ─────────────────────────────────────────
   騎士與 BOSS 戴的頭盔：一頂盔殼，加一片面罩。

     盔殼   圓角方盒（超橢球，跟動物自己的部位同一種形狀，大一圈）罩住整顆頭
            連後腦。底下開口讓脖子出去；正面下半切掉一塊（前緣往後退到 NOTCH.z、
            從眉線 NOTCH.y 往下），吻部與眼睛那一帶從切口露出來。耳朵從盔頂穿出去。
     面罩   一條彎成盔殼平面輪廓的鋼板，從左頰繞過正面到右頰，遮住眼睛那一條，
            上緣蓋住眉線、下緣停在吻部上面，板面是直的、跟盔殼正面齊平。正面挖三個
            大方洞，正中一個、兩邊那兩個對著眼睛。
            兩頭各一顆鉚釘釘在盔殼兩側、右下角一個小凸耳——看起來是掀得起來的
            那一種面罩（只是造型，不會真的掀）。

   跟刀一樣掛在頭那根骨頭上（blade.js 的檔頭說了為什麼要自己算矩陣），所以
   頭怎麼轉，頭盔就怎麼轉。尺寸是模型單位、頭骨座標（+X 左頰、+Y 上、+Z 前），
   照狗的頭量出來的：頭約 x ±1.19、y 0.18～2.06、z −1.09～1.28，吻部頂在
   y 1.15，眼睛在 y 1.03～1.45、x ±0.25～0.59。

   ── 墨線 ─────────────────────────────────────────────────────────
   跟刀一樣是外推一點、只畫背面的殼。盔殼是開口的，所以外殼的開口也跟著往外
   退 INK_OUT：切口那一圈看得到一條墨線。盔殼有內外兩層（內層法線朝內），
   兩層之間那條縫從切口看進去就是墨色的外殼——切口的厚度就畫成一條粗一點的線。
   墨線的材質交給那隻動物的墨色一起換（攻擊中轉紅），不然頭盔一蓋，頭上那一圈
   紅就不見了。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { toon, INK } from './palette.js';

/** 盔殼：中心、半徑、指數（越大越方）、厚度。 */
const SHELL = { c: [0, 1.14, 0.10], h: [1.34, 1.06, 1.40], n: 4.5, t: 0.07 };
/** 底下的開口在這個高度以下。 */
const SHELL_FLOOR = 0.55;
/** 正面切掉的那一塊：z 比這個前、y 比這個低。 */
const NOTCH = { z: 0.78, y: 1.66 };

/* 面罩：平面輪廓是一條超橢圓（跟盔殼同一個指數），兩頭（鉚釘）在 z = VISOR.z 的
   兩頰、正面在 z = VISOR.z + VISOR.c。板子的中線離盔殼的墨線外殼再留一點，板面
   直上直下。盔殼的正面（z 1.50）比頭的正面（z 1.28）多留了一段，就是為了讓面罩
   離眼睛夠遠、放得下 FACE_LIFT。 */
const VISOR = {
  a: 1.44, z: 0.30, c: 1.30, n: 4.5,
  t: 0.08,                       // 板厚
  y: [1.16, 1.70],               // 下緣、上緣
  holes: [-0.42, 0, 0.42],       // 洞的中心（沿輪廓，離正中多遠）：兩邊那兩個對著眼睛
  holeW: 0.26, holeY: [1.23, 1.49],
};
/** 鉚釘：離面罩兩頭多遠、半徑、厚。凸耳：在面罩上的哪裡（離正中、高）、大小。 */
const RIVET = { inset: 0.14, r: 0.1, t: 0.06 };
const TAB = { u: -0.92, y: 1.27, s: [0.16, 0.08, 0.14] };

/**
 * 臉（眼睛、鼻子、嘴）往鏡頭推多遠，模型單位。Critter 平常推 0.15 公尺（critter.js 的
 * FACE_DECL）好贏過烘出去的頭皮，騎士身上那是 0.52 單位，眼睛會畫到面罩前面。
 * 眼睛的前緣在 z 1.17、大半埋在頭皮（z 1.28）後面 0.26 以上，面罩內面是 z 1.56：
 * 推 0.36，正面看九成以上的眼睛在頭皮前、整顆在面罩後。斜著看頭皮會先蓋回眼睛
 * 的邊，但那時兩頰的面罩也擋住了。
 */
const FACE_LIFT = 0.36;

const INK_OUT = 0.05;
/** 尺寸（驗證器量頭盔跟狗頭的相對位置用）。 */
export const HELM = { SHELL, SHELL_FLOOR, NOTCH, VISOR, FACE_LIFT, INK_OUT };
const COL = { shell: 0xb7c0c9, visor: 0x98a3ae, rivet: 0xc79a3a };

/* ── 盔殼 ── */

const spow = (x, e) => Math.sign(x) * Math.abs(x) ** e;

/** 超橢球上一點的法線（梯度方向）。p 相對中心。 */
function gradient(p, h, n) {
  const g = p.map((x, k) => Math.sign(x) * Math.abs(x / h[k]) ** (n - 1) / h[k]);
  const l = Math.hypot(...g) || 1;
  return g.map((x) => x / l);
}

/**
 * 一個多邊形用一串半空間裁掉外面的部分（Sutherland–Hodgman）。
 * 半空間是 [軸, 值, 正負]：留下 sign·(p[軸] − 值) ≤ 0 的那一邊。
 */
function clip(poly, planes) {
  for (const [k, at, s] of planes) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = s * (a[k] - at), db = s * (b[k] - at);
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const u = da / (da - db);
        out.push(a.map((x, j) => x + (b[j] - x) * u));
      }
    }
    poly = out;
    if (poly.length < 3) return [];
  }
  return poly;
}

/**
 * 盔殼的一層：半徑 h、底與切口往外退 grow（墨線外殼用）、inward 內層（法線朝內）。
 * 切掉的是「底下」與「正面下半那一塊」；後者是凹的，所以留下來的那一片拆成兩塊
 * 凸的各裁一次：切口後面的全部，與切口前面、眉線以上的那一條。
 */
function shellLayer(h, grow, inward) {
  const { c, n } = SHELL;
  const floor = [1, SHELL_FLOOR - grow, -1];
  const keep = [
    [floor, [2, NOTCH.z + grow, 1]],
    [floor, [2, NOTCH.z + grow, -1], [1, NOTCH.y - grow, -1]],
  ];
  const e = 2 / n, NU = 64, NV = 40;
  const at = (i, j) => {
    const th = (i / NU) * 2 * Math.PI, ph = -Math.PI / 2 + (j / NV) * Math.PI;
    const cp = Math.cos(ph);
    return [
      c[0] + h[0] * spow(cp, e) * spow(Math.sin(th), e),
      c[1] + h[1] * spow(Math.sin(ph), e),
      c[2] + h[2] * spow(cp, e) * spow(Math.cos(th), e),
    ];
  };
  const pos = [], nrm = [];
  const emit = (poly) => {
    const ns = poly.map((p) => gradient(p.map((x, k) => x - c[k]), h, n).map((x) => (inward ? -x : x)));
    for (let i = 1; i < poly.length - 1; i++) {
      let tri = [0, i, i + 1];
      const [a, b, d] = tri.map((k) => poly[k]);
      const f = [
        (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]),
        (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]),
        (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]),
      ];
      const m = ns[0].map((x, k) => x + ns[i][k] + ns[i + 1][k]);
      if (f[0] * m[0] + f[1] * m[1] + f[2] * m[2] < 0) tri = [0, i + 1, i];
      for (const k of tri) { pos.push(...poly[k]); nrm.push(...ns[k]); }
    }
  };
  for (let i = 0; i < NU; i++) {
    for (let j = 0; j < NV; j++) {
      const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      for (const planes of keep) emit(clip(q, planes));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/* ── 面罩 ── */

/** 面罩上的一點：u（沿輪廓）、高 v、離板子中線 d。 */
function onPlate(path, u, v, d) {
  const [x, z, nx, nz] = path(u);
  return [x + nx * d, v, z + nz * d];
}

/**
 * 面罩的平面輪廓，照弧長取點：u 從正中（0）往左頰（+X）是正的。回傳一個函式，
 * 給 u 回 [x, z, 往外的法線 x, z]。
 */
function visorPath() {
  const { a, z, c, n } = VISOR, e = 2 / n, N = 600;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const th = -Math.PI / 2 + (i / N) * Math.PI;
    pts.push([a * spow(Math.sin(th), e), z + c * spow(Math.cos(th), e)]);
  }
  const s = [0];
  for (let i = 1; i <= N; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const mid = s[N / 2];
  const along = (u) => {
    const t = Math.min(s[N], Math.max(0, u + mid));
    let i = 0;
    while (i < N - 1 && s[i + 1] < t) i++;
    const k = (t - s[i]) / (s[i + 1] - s[i] || 1);
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const tl = Math.hypot(x1 - x0, z1 - z0) || 1;
    return [x0 + (x1 - x0) * k, z0 + (z1 - z0) * k, -(z1 - z0) / tl, (x1 - x0) / tl];
  };
  along.half = s[N] / 2;
  return along;
}

/**
 * 面罩的板子：u（沿輪廓）× v（高）的格子，洞是挖掉的格子，每一格有正反兩面，
 * 實心與挖空（或外面）的交界立一道牆。grow 讓整塊往外長（墨線外殼）：外框往外、
 * 板子變厚。洞反而是放大的——外殼的洞要是縮小，就從洞裡把後面那一片墨色蓋上來，
 * 洞就被堵住了；放大的話外殼的洞緣藏在板子裡。
 */
function visorGeometry(path, grow) {
  const U = path.half, [vb, vt] = VISOR.y, [h0, h1] = VISOR.holeY, hw = VISOR.holeW / 2;
  /* 格線：[位置, grow 往哪邊推]。 */
  const ul = [[-U, -1], [U, 1]];
  for (const x of VISOR.holes) ul.push([x - hw, -1], [x + hw, 1]);
  ul.sort((p, q) => p[0] - q[0]);
  const us = ul.map(([x, d]) => x + d * grow);
  const vs = [vb - grow, h0 - grow, h1 + grow, vt + grow];
  const holeU = (i) => i % 2 === 1;                  // 第 i 格（u）是不是洞的那一欄
  const solid = (i, j) => i >= 0 && j >= 0 && i < us.length - 1 && j < 3 && !(holeU(i) && j === 1);
  const w = VISOR.t / 2 + grow;
  const pos = [], nrm = [];
  const put = (u, v, d) => onPlate(path, u, v, d);
  /** 一塊 u0～u1 的長條（沿輪廓切細，彎得順），四個角是 f(u, 另一個參數)。 */
  const strip = (u0, u1, corner, normal) => {
    const k = Math.max(1, Math.ceil(Math.abs(u1 - u0) / 0.06));
    for (let s = 0; s < k; s++) {
      const a = u0 + ((u1 - u0) * s) / k, b = u0 + ((u1 - u0) * (s + 1)) / k;
      const q = [corner(a, 0), corner(b, 0), corner(b, 1), corner(a, 1)];
      const nq = [normal(a), normal(b), normal(b), normal(a)];
      const f = new THREE.Vector3().subVectors(new THREE.Vector3(...q[1]), new THREE.Vector3(...q[0]))
        .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...q[2]), new THREE.Vector3(...q[0])));
      const flip = f.dot(new THREE.Vector3(...nq[0])) < 0;
      for (const idx of flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) { pos.push(...q[idx]); nrm.push(...nq[idx]); }
    }
  };
  const out = (u, sgn) => { const [, , nx, nz] = path(u); return [nx * sgn, 0, nz * sgn]; };
  for (let i = 0; i < us.length - 1; i++) {
    for (let j = 0; j < 3; j++) {
      if (!solid(i, j)) continue;
      const u0 = us[i], u1 = us[i + 1], v0 = vs[j], v1 = vs[j + 1];
      for (const sgn of [1, -1]) strip(u0, u1, (u, t) => put(u, t ? v1 : v0, sgn * w), (u) => out(u, sgn));
      /* 上下的牆 */
      if (!solid(i, j + 1)) strip(u0, u1, (u, t) => put(u, v1, t ? w : -w), () => [0, 1, 0]);
      if (!solid(i, j - 1)) strip(u0, u1, (u, t) => put(u, v0, t ? w : -w), () => [0, -1, 0]);
      /* 左右的牆：沿厚度方向一片，法線是輪廓的切線 */
      for (const [side, u] of [[-1, u0], [1, u1]]) {
        if (solid(i + side, j)) continue;
        const [, , nx, nz] = path(u);
        const tn = [nz * side, 0, -nx * side];
        const q = [put(u, v0, -w), put(u, v0, w), put(u, v1, w), put(u, v1, -w)];
        const f = new THREE.Vector3().subVectors(new THREE.Vector3(...q[1]), new THREE.Vector3(...q[0]))
          .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...q[2]), new THREE.Vector3(...q[0])));
        const flip = f.dot(new THREE.Vector3(...tn)) < 0;
        for (const idx of flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) { pos.push(...q[idx]); nrm.push(...tn); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/** 一塊東西擺在面罩外面那一面上：u（沿輪廓）、y、往外凸多少，轉成跟板面對齊。 */
function onVisor(path, obj, u, y, lift) {
  const [, , nx, nz] = path(u);
  obj.position.set(...onPlate(path, u, y, VISOR.t / 2 + lift));
  obj.rotation.y = Math.atan2(nx, nz);
  return obj;
}

/** 一個 mesh，帶名字（驗證器照名字找）。 */
const named = (name, geo, mat) => Object.assign(new THREE.Mesh(geo, mat), { name });

function buildHelm(inkMat) {
  const g = new THREE.Group();
  const { h, t } = SHELL;
  g.add(named('shell', shellLayer(h, 0, false), toon(COL.shell)));
  g.add(named('lining', shellLayer(h.map((x) => x - t), 0, true), toon(COL.shell)));
  g.add(named('shell-ink', shellLayer(h.map((x) => x + INK_OUT), INK_OUT, false), inkMat));
  const path = visorPath();
  g.add(named('visor', visorGeometry(path, 0), toon(COL.visor)));
  g.add(named('visor-ink', visorGeometry(path, INK_OUT), inkMat));
  /* 鉚釘：面罩兩頭，圓柱的軸朝外。 */
  const yMid = (VISOR.y[0] + VISOR.y[1]) / 2;
  for (const s of [-1, 1]) {
    for (const [r, len, mat] of [[RIVET.r, RIVET.t, toon(COL.rivet)], [RIVET.r + INK_OUT, RIVET.t + INK_OUT * 2, inkMat]]) {
      const cyl = new THREE.CylinderGeometry(r, r, len, 16);
      cyl.rotateX(Math.PI / 2);
      g.add(onVisor(path, new THREE.Mesh(cyl, mat), s * (path.half - RIVET.inset), yMid, RIVET.t / 2));
    }
  }
  /* 凸耳：掀面罩要捏的地方。 */
  for (const [grow, mat] of [[0, toon(COL.visor)], [INK_OUT, inkMat]]) {
    const b = new THREE.BoxGeometry(...TAB.s.map((x) => x + grow * 2));
    g.add(onVisor(path, new THREE.Mesh(b, mat), TAB.u, TAB.y, TAB.s[2] / 2));
  }
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

export class Helm {
  constructor() {
    /** 墨線外殼共用一顆材質：交給動物的墨色一起換（見檔頭）。 */
    this.ink = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    this.node = buildHelm(this.ink);
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
    critter._faceLift.value = FACE_LIFT * critter.mesh.scale.x;
  }

  /** 這一幀的頭在哪，頭盔就在哪。要在 critter.update 之後叫。 */
  update() {
    if (!this._host) return;
    this.node.matrix.fromArray(this._host.rig.matrices, this._headBone * 16);
    this.node.matrixWorldNeedsUpdate = true;
  }
}
