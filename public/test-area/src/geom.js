/* ── test-area/src/geom.js ───────────────────────────────────────────
   形狀的最底層：一塊石頭長什麼樣，以及怎麼把幾千塊石頭變成兩個 draw。

   ── 為什麼是「倒角方塊」而不是方塊 ──────────────────────────────
   Dota 和黑魂的石造物看起來厚，靠的不是多邊形數，是每一道邊上那一小條
   斜面。純方塊的邊是一條數學上的線，光打上去兩面都是常數，於是那條邊
   只有在剛好擋住背景的時候才看得見；倒角把那條線換成一條窄面，它的法線
   介在兩面之間，所以無論光從哪邊來，邊上都會亮出一條細高光。這就是
   「石頭被鑿過」的全部訊息量，一塊 44 個三角形買得到。

   倒角方塊 = 6 個內縮的面 + 12 條邊面 + 8 個角三角形，24 個頂點。
   法線是平的（頂點不共用，computeVertexNormals 出來就是面法線）——這是
   刻意的，圓滑的法線會把倒角糊成一條漸層，那正好是要避免的東西。

   ── 為什麼墨線是 EdgesGeometry 而不是翻面外殼 ────────────────────
   見 palette.js 的 inkLine 注解：平法線的外殼會在每道倒角上裂開。
   線是照著「原始那一塊」算的並且快取起來，然後跟著變換搬進合併後的
   緩衝區——所以一塊石頭的墨線只算一次，擺一百次是一百次矩陣乘法。

   ── 為什麼要合併 ────────────────────────────────────────────────
   一個區塊有上千塊石頭。一塊一個 mesh 是上千個 draw call，而它們的顏色
   差異可以整個交給頂點色帶走，所以整塊地景合併成一個 mesh、墨線合併成
   一個 LineSegments：一個區塊兩個 draw。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';

/* ── 隨機源 ──────────────────────────────────────────────────────
   mulberry32，跟 src/rng.js 同一支。碎石、苔、缺口全部由它決定，所以
   同一個 seed 的區塊每次載入都一模一樣——要調版面才調得動。 */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一顆亂數器，外加幾個常用的取法。 */
export function rng(seed) {
  const r = mulberry32(seed >>> 0);
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = (lo, hi) => Math.floor(lo + r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  r.chance = (p) => r() < p;
  return r;
}

/* ── 倒角方塊 ───────────────────────────────────────────────────── */

const OTHER = [[1, 2], [0, 2], [0, 1]];

/**
 * 一塊石頭。
 *
 * @param {number} w  x 全長
 * @param {number} h  y 全長
 * @param {number} d  z 全長
 * @param {number} ch 倒角寬度。會自動夾到最短邊的 1/3，所以薄板不會翻面。
 */
export function stone(w, h, d, ch = 0.05) {
  const e = [w / 2, h / 2, d / 2];
  const c = Math.min(ch, Math.min(w, h, d) * 0.33);
  const V = [];                 // 24 個頂點
  const at = new Map();         // key → index
  // 位元編碼：軸 × 8 + 三個符號。字串相加會把 0/1 加成數字而撞在一起。
  const key = (a, sx, sy, sz) => a * 8 + (sx > 0 ? 4 : 0) + (sy > 0 ? 2 : 0) + (sz > 0 ? 1 : 0);

  for (let a = 0; a < 3; a++) {
    for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
      const s = [sx, sy, sz];
      const p = [0, 1, 2].map((i) => (i === a ? e[i] * s[i] : (e[i] - c) * s[i]));
      at.set(key(a, sx, sy, sz), V.length);
      V.push(p);
    }
  }

  const pos = [];
  /* 凸體且以原點為中心，所以「外側」就是與重心同向的那一邊——三角形的
     繞向不用自己數，算出來不對就換兩個頂點。 */
  const tri = (i, j, k) => {
    const A = V[i], B = V[j], D = V[k];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const v = [D[0] - A[0], D[1] - A[1], D[2] - A[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const m = [(A[0] + B[0] + D[0]) / 3, (A[1] + B[1] + D[1]) / 3, (A[2] + B[2] + D[2]) / 3];
    const out = n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0;
    const o = out ? [A, B, D] : [A, D, B];
    for (const q of o) pos.push(q[0], q[1], q[2]);
  };
  const quad = (i, j, k, l) => { tri(i, j, k); tri(i, k, l); };
  const ix = (a, t) => at.get(key(a, t[0], t[1], t[2]));

  // 6 個面
  for (let a = 0; a < 3; a++) for (const s of [1, -1]) {
    const [b, cc] = OTHER[a];
    const sg = (sb, sc) => { const t = [0, 0, 0]; t[a] = s; t[b] = sb; t[cc] = sc; return t; };
    const q = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sb, sc]) => ix(a, sg(sb, sc)));
    quad(q[0], q[1], q[2], q[3]);
  }

  // 12 條邊
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const k = 3 - a - b;
    for (const sa of [1, -1]) for (const sb of [1, -1]) {
      const sg = (sk) => { const t = [0, 0, 0]; t[a] = sa; t[b] = sb; t[k] = sk; return t; };
      const p = sg(1), q = sg(-1);
      quad(ix(a, p), ix(a, q), ix(b, q), ix(b, p));
    }
  }

  // 8 個角
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    const t = [sx, sy, sz];
    tri(ix(0, t), ix(1, t), ix(2, t));
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();  // 頂點不共用 → 面法線
  return g;
}

/* ── 其他幾個基本形 ───────────────────────────────────────────────
   全部走「低面數 + 平法線」：這種造型的邊要看得見，圓滑法線會把柱身的
   稜線抹掉，而那些稜線就是石柱之所以像鑿出來的。 */

/** 有稜的柱體。段數預設 10——柱子的稜要數得出來。 */
export function drum(rTop, rBot, h, seg = 10, twist = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false);
  if (twist) g.rotateY(twist);
  return facet(g);
}

/** 有稜的錐。 */
export function spike(r, h, seg = 8) {
  return facet(new THREE.ConeGeometry(r, h, seg, 1, false));
}

/** 低面數的球。碎石、果實、狗身上的關節用。 */
export function blob(r, detail = 0) {
  return facet(new THREE.IcosahedronGeometry(r, detail));
}

/** 圓一點的球（狗用，段數自己給）。 */
export function ball(r, wseg = 10, hseg = 7) {
  return facet(new THREE.SphereGeometry(r, wseg, hseg));
}

/** 環（鎖鏈的一節）。 */
export function ring(r, t) {
  return facet(new THREE.TorusGeometry(r, t, 5, 8));
}

/** 把任何幾何轉成「平法線、頂點不共用」。 */
export function facet(g) {
  const n = g.index ? g.toNonIndexed() : g;
  if (n.attributes.uv) n.deleteAttribute('uv');
  n.computeVertexNormals();
  if (n !== g) g.dispose();
  return n;
}

/** 把任何幾何轉成「平滑法線」（狗的身體要圓，見 dog.js）。 */
export function smooth(g) {
  if (g.attributes.uv) g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/**
 * 一片會垂的布。
 *
 * 旗子不能是一片平面：平面在三階調下整片同一階，沒有布的訊息。這裡把
 * 它沿 x 折出兩個波、沿 y 往下越垂越鬆，於是同一片布上同時出現三個色階，
 * 而且左右兩側各有一道亮邊。兩面都要看得見，所以背面另外複製一份反繞向的。
 */
export function cloth(w, h, wave = 0.16, segX = 10, segY = 6) {
  const g = new THREE.PlaneGeometry(w, h, segX, segY);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const slack = 0.35 + 0.65 * (0.5 - y / h);          // 越往下越鬆
    p.setZ(i, Math.sin((x / w) * Math.PI * 2.4) * wave * slack);
    p.setX(i, x * (1 - 0.06 * slack));                  // 下擺略收
  }
  return twoSided(facet(g));
}

/** 附上一份反繞向的複本，於是單面材質也看得到背面。 */
export function twoSided(g) {
  const src = g.attributes.position.array;
  const out = new Float32Array(src.length * 2);
  out.set(src, 0);
  for (let i = 0; i < src.length; i += 9) {             // 每個三角形換兩個頂點
    const o = src.length + i;
    for (let k = 0; k < 3; k++) {
      out[o + k] = src[i + k];
      out[o + 3 + k] = src[i + 6 + k];
      out[o + 6 + k] = src[i + 3 + k];
    }
  }
  const n = new THREE.BufferGeometry();
  n.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  n.computeVertexNormals();
  g.dispose();
  return n;
}

/* ── 合併器 ────────────────────────────────────────────────────── */

const EDGE_CACHE = new WeakMap();
const edgesOf = (g) => {
  let e = EDGE_CACHE.get(g);
  if (!e) {
    // 24°：倒角面與大面之間是 45°，所以倒角的兩條邊都留得住；
    // 柱身相鄰兩片（10 段 = 36°）也留得住，那是柱子的稜。
    e = new THREE.EdgesGeometry(g, 24).attributes.position.array;
    EDGE_CACHE.set(g, e);
  }
  return e;
};

const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * 一個區塊的建造現場。
 *
 * `add` 把一份幾何按變換蓋一份進緩衝區；`finish` 收成一個 mesh、一個
 * LineSegments 和一張碰撞盒清單。原始幾何本身不進場景，可以重複用——
 * 一塊 0.6×0.3×0.4 的磚在一個區塊裡會被擺上幾百次。
 */
export class Build {
  /** @param {object} [kit] pieces.js 的 Kit。零件都從 `B.kit` 拿幾何。 */
  constructor(kit) {
    this.kit = kit;
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.ink = [];
    this.colliders = [];
    this._c = new THREE.Color();
  }

  /**
   * @param {THREE.BufferGeometry} g
   * @param {object} o
   *   p 位置 [x,y,z]／r 歐拉角 [x,y,z]／s 縮放（數字或 [x,y,z]）
   *   color 頂點色／ink 是否描邊（預設 true）
   *   solid 是否算碰撞（預設 false）／grow 碰撞盒往外放這麼多
   */
  add(g, o = {}) {
    const p = o.p || [0, 0, 0];
    const r = o.r || [0, 0, 0];
    const s = typeof o.s === 'number' ? [o.s, o.s, o.s] : (o.s || [1, 1, 1]);
    _q.setFromEuler(_e.set(r[0], r[1], r[2]));
    _m.compose(_v.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
    _nm.getNormalMatrix(_m);

    const src = g.attributes.position.array;
    const sn = g.attributes.normal.array;
    this._c.set(o.color === undefined ? 0xffffff : o.color);
    const cr = this._c.r, cg = this._c.g, cb = this._c.b;

    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;

    for (let i = 0; i < src.length; i += 3) {
      _v.set(src[i], src[i + 1], src[i + 2]).applyMatrix4(_m);
      this.pos.push(_v.x, _v.y, _v.z);
      if (_v.x < minx) minx = _v.x; if (_v.x > maxx) maxx = _v.x;
      if (_v.y < miny) miny = _v.y; if (_v.y > maxy) maxy = _v.y;
      if (_v.z < minz) minz = _v.z; if (_v.z > maxz) maxz = _v.z;
      _v.set(sn[i], sn[i + 1], sn[i + 2]).applyMatrix3(_nm).normalize();
      this.nrm.push(_v.x, _v.y, _v.z);
      this.col.push(cr, cg, cb);
    }

    if (o.ink !== false) {
      const E = edgesOf(g);
      for (let i = 0; i < E.length; i += 3) {
        _v.set(E[i], E[i + 1], E[i + 2]).applyMatrix4(_m);
        this.ink.push(_v.x, _v.y, _v.z);
      }
    }

    if (o.solid) {
      const gr = o.grow || 0;
      this.colliders.push({
        min: [minx - gr, miny - gr, minz - gr],
        max: [maxx + gr, maxy + gr, maxz + gr],
      });
    }
    return this;
  }

  /** 只登記一個碰撞盒，不畫任何東西（看不見的欄杆、地板本身）。 */
  block(cx, cy, cz, w, h, d) {
    this.colliders.push({
      min: [cx - w / 2, cy - h / 2, cz - d / 2],
      max: [cx + w / 2, cy + h / 2, cz + d / 2],
    });
    return this;
  }

  /** @returns {{geometry, ink, colliders, tris, inkLines}} */
  finish() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const ink = new THREE.BufferGeometry();
    ink.setAttribute('position', new THREE.Float32BufferAttribute(this.ink, 3));
    ink.computeBoundingSphere();
    return {
      geometry: g,
      ink,
      colliders: this.colliders,
      tris: this.pos.length / 9,
      inkLines: this.ink.length / 6,
    };
  }
}
