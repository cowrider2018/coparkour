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

   ── 為什麼墨線是線而不是翻面外殼 ────────────────────────────────
   見 palette.js 的 inkLine 注解：平法線的外殼會在每道倒角上裂開。
   線是照著「原始那一塊」算的並且快取起來，然後跟著變換搬進合併後的
   緩衝區——所以一塊石頭的墨線只算一次，擺一百次是一百次矩陣乘法。

   每條線同時帶著它兩側的面法線（aN0／aN1）。那兩個數字是「這條邊現在
   是不是輪廓」唯一需要的東西，所以整批線可以一次送出去，由著色器逐條
   決定露不露——內部的轉折因此一條都不會被畫出來。

   ── 為什麼要合併 ────────────────────────────────────────────────
   一個區塊有上千塊石頭。一塊一個 mesh 是上千個 draw call，而它們的顏色
   差異可以整個交給頂點色帶走，所以整塊地景合併成一個 mesh、墨線合併成
   一個 LineSegments：一個區塊兩個 draw。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { SURF_OF } from './palette.js';
import { SURF, packSurf, mossAt } from './surface.js';

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
 * @param {number} [chip] 缺角的變體（0 = 完整）。見下面。
 */
export function stone(w, h, d, ch = 0.05, chip = 0) {
  const e = [w / 2, h / 2, d / 2];
  const cmax = Math.min(w, h, d) * 0.33;
  const c = Math.min(ch, cmax);
  /* ── 缺角 ──────────────────────────────────────────────────────
     每一個角各自的倒角寬度。完整的石頭八個角都是 c；缺角的變體挑幾個角
     放大到 c 的兩三倍——那個角就被敲掉一塊，一道斜面切過去。

     為什麼只動角：一個角的三個頂點各自在自己那一面上往內縮，而每一條
     邊面的四個頂點是兩個角各出兩個，兩個角縮得不一樣多，那條邊面就從
     長方形變成梯形。它仍然是平的（那四點在 x_a + x_b 與 x_k 兩個值上
     成對相等，所以落在同一個平面上），所以法線還是平的、墨線照樣算，
     外接盒也一點都沒變——碰撞、支撐、牆芯那些驗證完全不必知道有這件事。 */
  const cc = new Float32Array(8).fill(c);
  if (chip) {
    const r = mulberry32(chip * 0x2c1b3c6d + 17);
    let n = 0;
    for (let i = 0; i < 8; i++) {
      if (r() < 0.38) { cc[i] = Math.min(c * (2.2 + r() * 1.6), cmax); n++; }
    }
    // 一個角都沒敲到的變體跟完整的那塊一模一樣，那就至少敲一個。
    if (!n) cc[Math.floor(r() * 8)] = Math.min(c * 2.8, cmax);
  }
  const ci = (s) => (s[0] > 0 ? 4 : 0) + (s[1] > 0 ? 2 : 0) + (s[2] > 0 ? 1 : 0);
  const V = [];                 // 24 個頂點
  const at = new Map();         // key → index
  // 位元編碼：軸 × 8 + 三個符號。字串相加會把 0/1 加成數字而撞在一起。
  const key = (a, sx, sy, sz) => a * 8 + (sx > 0 ? 4 : 0) + (sy > 0 ? 2 : 0) + (sz > 0 ? 1 : 0);

  for (let a = 0; a < 3; a++) {
    for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
      const s = [sx, sy, sz];
      const k = cc[ci(s)];
      const p = [0, 1, 2].map((i) => (i === a ? e[i] * s[i] : (e[i] - k) * s[i]));
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

/**
 * 一頂圓頂：半徑 r、高 h 的半橢球，底圈在原點、往上長，底是開的。
 *
 * 形狀跟圓頂碰撞體（walk.js 的橢球冠，半軸 r 與 dome）是同一條曲線——
 * 帳篷頂用它，於是站在帳篷頂上滑的時候，腳就貼在看得到的那一面上。錐形
 * 的頂做不到這件事：橢球冠在半腰比錐面高出三四成，人會浮在布上面。
 */
export function cap(r, h, seg = 14) {
  const g = new THREE.SphereGeometry(r, seg, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, h / r, 1);
  return facet(g);
}

/** 環（鎖鏈的一節）。 */
export function ring(r, t) {
  return facet(new THREE.TorusGeometry(r, t, 5, 8));
}

/**
 * 一塊三角形的山牆：底寬 w、高 h、厚 d。底邊的中點在原點，厚度沿 z 置中。
 *
 * 磚一層一層疊出來的階梯山牆在一整排房子上會變成滿眼的磚縫——木構的
 * 房子，山牆就是一整片抹灰的三角形，木頭另外釘在上面。
 */
export function gablePrism(w, h, d) {
  const a = [-w / 2, 0], b = [w / 2, 0], c = [0, h];
  const f = d / 2, k = -d / 2;
  const P = [];
  const tri = (p, q, r) => P.push(...p, ...q, ...r);
  const V = (xy, z) => [xy[0], xy[1], z];
  tri(V(a, f), V(b, f), V(c, f));                            // 正面
  tri(V(b, k), V(a, k), V(c, k));                            // 背面
  tri(V(a, k), V(b, k), V(b, f)); tri(V(a, k), V(b, f), V(a, f));   // 底
  tri(V(b, k), V(c, k), V(c, f)); tri(V(b, k), V(c, f), V(b, f));   // 右斜面
  tri(V(c, k), V(a, k), V(a, f)); tri(V(c, k), V(a, f), V(c, f));   // 左斜面
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  return g;
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
 * 旗子不能是一片平面：平面在分階著色下整片同一階，沒有布的訊息。這裡把
 * 它沿 x 折出兩個波、沿 y 往下越垂越鬆，於是同一片布上同時出現好幾個色階，
 * 而且左右兩側各有一道亮邊。兩面都要看得見，所以背面另外複製一份反繞向的。
 */
export function cloth(w, h, wave = 0.16, tail = 0, segX = 10, segY = 6) {
  const g = new THREE.PlaneGeometry(w, h, segX, segY);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const down = 0.5 - y / h;                            // 0 = 上緣，1 = 下擺
    const slack = 0.35 + 0.65 * down;                    // 越往下越鬆
    p.setZ(i, Math.sin((x / w) * Math.PI * 2.4) * wave * slack);
    p.setX(i, x * (1 - 0.06 * slack));                  // 下擺略收
    /* 燕尾：下擺中間往上收一個 V，深 `tail`。整片布跟著下擺的比例一起
       往上推（上緣不動、下擺推滿），不是只推最下面那一排——只推一排的話
       那一排格子會被壓扁成一條，V 的兩邊看得到折痕。 */
    if (tail) p.setY(i, y + tail * down * Math.max(0, 1 - Math.abs(x) / (w * 0.32)));
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

/* ── 邊 ──────────────────────────────────────────────────────────
   一份幾何的「可能是輪廓的邊」，連同每條邊兩側的面法線。

   候選的門檻仍然是 24°（倒角面與大面之間是 45°，柱身相鄰兩片 10 段是
   36°，低面數球體最疏的一圈也有 25°，所以該留的稜一條都不少）；比這
   更平的兩個面之間就算真的落在輪廓上，也只是一條藏在自己的高光裡的
   髮絲，留著只是替每個四邊形多記一條對角線。

   three 的 EdgesGeometry 做的是同一件事，但它只吐位置——面法線在它算完
   之後就丟了，而那正是輪廓判定要的東西，所以這裡自己算一次。
   ------------------------------------------------------------------ */

/** 位置雜湊的精度，跟 three 的 EdgesGeometry 同一個（1e-4）。 */
const EPRE = 1e4;
/** 24° 的 cos。兩個面的法線內積大於它 = 太平，不當候選。 */
const CREASE = Math.cos((24 * Math.PI) / 180);

const EDGE_CACHE = new WeakMap();

/**
 * @param {THREE.BufferGeometry} g 非索引、平法線的幾何（facet 出來的那種）
 * @returns {{pos: Float32Array, n0: Float32Array, n1: Float32Array}}
 *   每條邊兩個頂點；n0／n1 逐頂點重複一次，所以三份的長度一樣。
 */
function edgesOf(g) {
  const hit = EDGE_CACHE.get(g);
  if (hit) return hit;

  const P = g.attributes.position.array;
  const key = (i) => `${Math.round(P[i] * EPRE)},${Math.round(P[i + 1] * EPRE)},`
    + `${Math.round(P[i + 2] * EPRE)}`;
  const E = new Map();

  for (let t = 0; t < P.length; t += 9) {
    /* 面法線從繞向算，不是讀法線屬性——smooth() 出來的幾何法線是平滑過
       的，那個法線回答不了「這個三角形朝哪邊」。 */
    const ux = P[t + 3] - P[t], uy = P[t + 4] - P[t + 1], uz = P[t + 5] - P[t + 2];
    const vx = P[t + 6] - P[t], vy = P[t + 7] - P[t + 1], vz = P[t + 8] - P[t + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-12) continue;                      // 退化的三角形沒有朝向
    nx /= L; ny /= L; nz /= L;
    for (let k = 0; k < 3; k++) {
      const i = t + k * 3, j = t + ((k + 1) % 3) * 3;
      const ki = key(i), kj = key(j);
      const id = ki < kj ? `${ki}|${kj}` : `${kj}|${ki}`;
      const rec = E.get(id);
      if (!rec) E.set(id, { i, j, n0: [nx, ny, nz], n1: null });
      else if (!rec.n1) rec.n1 = [nx, ny, nz];    // 第三個以上的面不理會
    }
  }

  const pos = [], n0 = [], n1 = [];
  for (const e of E.values()) {
    /* 只有一個面的邊（布的下擺、任何開口）永遠是輪廓——把另一側記成
       反向的同一個法線，內積必然異號，著色器那一條判定就不必分支。 */
    const b = e.n1 || [-e.n0[0], -e.n0[1], -e.n0[2]];
    if (e.n1 && e.n0[0] * b[0] + e.n0[1] * b[1] + e.n0[2] * b[2] > CREASE) continue;
    pos.push(P[e.i], P[e.i + 1], P[e.i + 2], P[e.j], P[e.j + 1], P[e.j + 2]);
    n0.push(...e.n0, ...e.n0);
    n1.push(...b, ...b);
  }
  const out = {
    pos: new Float32Array(pos),
    n0: new Float32Array(n0),
    n1: new Float32Array(n1),
  };
  EDGE_CACHE.set(g, out);
  return out;
}

/* ── 合併器 ────────────────────────────────────────────────────── */

/* ── 紋理方向 ────────────────────────────────────────────────────
   一份幾何「自己的」三軸全長。擺進場景時乘上縮放、挑最長的那一軸轉到
   世界——木紋順著木料、瓦沿著簷口、磚上的鑿痕順著磚長，都是從這裡來的
   （見 surface.js 的「投影」）。 */
const EXT_CACHE = new WeakMap();
function extentOf(g) {
  let e = EXT_CACHE.get(g);
  if (!e) {
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    e = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
    EXT_CACHE.set(g, e);
  }
  return e;
}

/** 一個位置的雜湊，[0,1)。不吃亂數器——零件的亂數序列一個都不能多抽，
    不然整片版面（哪根柱子斷、哪裡撒碎石）都會跟著換。 */
export function hashAt(x, y, z, s = 0) {
  let h = Math.imul(Math.round(x * 97), 0x27d4eb2d) ^ Math.imul(Math.round(y * 89), 0x165667b1)
    ^ Math.imul(Math.round(z * 83), 0x9e3779b1) ^ Math.imul(s + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ── 烘進頂點色的那一層 ──────────────────────────────────────────
   貼圖給的是「一塊之內」的紋路；「一塊與一塊之間」的差別烘在頂點色裡，
   而且是逐塊一個數字，不是逐頂點——逐頂點的話一塊磚上會拉出一條連續的
   漸層，那正是五階調花了整段注解在消的東西。

     深淺   每一塊自己亮一點或暗一點（±7%），同一種石材的一面牆因此不是
            四種顏色輪流出現，而是一片散開的色溫。
     牆根   貼地的那一皮暗一階、第二皮再淡一點：雨水、泥濘、苔的根——
            牆是從地面髒上來的。只給石與灰泥（木箱、地板不算）。 */
const JITTER = {
  [SURF.stone]: 0.14, [SURF.granite]: 0.08, [SURF.wood]: 0.14, [SURF.plaster]: 0.08, [SURF.tile]: 0.16,
};
const GRIME = { [SURF.stone]: true, [SURF.plaster]: true };
function tintOf(sid, p) {
  let k = 1;
  const j = JITTER[sid];
  if (j) k *= 1 + (hashAt(p[0], p[1], p[2], 3) - 0.5) * j;
  if (GRIME[sid]) k *= p[1] < 0.5 ? 0.88 : p[1] < 1.0 ? 0.94 : 1;
  return k;
}

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
 *
 * ── 碰撞是分類的，不是布林的 ─────────────────────────────────────
 * 視覺上的凹凸不准傳到腳底下。所以每一個碰撞盒都必須說自己是哪一種，
 * 而「哪一種」決定了盒子怎麼算出來：
 *
 *   'floor'  可以站的水平面（房間鋪面、露台、牆頂、台座）。盒子就是
 *            那個東西本身，頂面就是看得到的頂面。
 *   'block'  繞得過、爬不上的障礙（柱、井、火盆、雕像、大石）。盒子從
 *            它站著的那個地面（`base`）一路拉到頂——所以底下不會有一條
 *            縫可以鑽，而頂面必須高過 `BLOCK_TOP`。
 *   'step'   階梯的一級。只有階梯可以把頂面放在會絆腳的高度上，因為
 *            它是一個序列，踩上去是預期的。
 *   'shell'  牆體與台基那種「不是給人站的、但就是實心」的東西。
 *
 * 沒有第五種。`solid: true` 這種寫法留著當 'block' 的簡寫，但驗證會
 * 逐個盒子檢查上面那幾條，所以「隨手登記一個盒子」不再是一個選項。
 *
 * ── 形狀是方的或圓的 ────────────────────────────────────────────
 * 種類說的是「這個東西在遊戲裡是什麼」，形狀說的是「它長什麼樣」，
 * 兩件事互不干涉：一根柱子是圓的 'block'，露台是方的 'floor'。
 *
 *   方盒   預設。`block()`，或 `add` 的 `solid`。
 *   圓柱   `round()`，或 `add` 的 `solid` 加 `round: true`（軸與半徑
 *          從幾何的 AABB 算）。柱、井、樹、大石——場上一半的東西是圓的，
 *          而方盒的角比它所代表的圓遠 41%，繞著走會被頂四下。
 *   圓頂   圓柱加一頂蓋（`round()` 的 `dome`，或 `add` 的
 *          `round: 'dome'`）。頂上站不住，而站不住的方式要說清楚：
 *          `slip: 'slide'` 是可操作的緩滑（屋頂、斜坡、大石），
 *          `slip: 'fall'` 是失去操作的滑落（危險、不可踩的頂）。
 *          判準與新增時的規矩寫在 DEVNOTES.md。
 *
 * ── record ──────────────────────────────────────────────────────
 * 打開的話，每一塊 `add` 進來的幾何都會留下它的 AABB 與旗標。頁面上
 * 不需要（那是七千個物件），tools/verify-test-area.mjs 需要——「每塊
 * 石頭底下有沒有東西頂著」這條規則要有東西可以掃才驗得起來。
 */
export class Build {
  /**
   * @param {object} [kit] pieces.js 的 Kit。零件都從 `B.kit` 拿幾何。
   * @param {object} [opts] record：記下每塊幾何的 AABB（給驗證用）。
   */
  constructor(kit, opts = {}) {
    this.kit = kit;
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.ink = [];
    /* 墨線每個頂點的兩個面法線。量化成 int8（±1/127 ≈ 0.45°，而這兩個
       數字只拿去比正負號），所以一條線的附帶資料是 6 個位元組而不是
       24 個——整個區塊的墨線多了五成記憶體，不是多了三倍。 */
    this.inkA = [];
    this.inkB = [];
    this.colliders = [];
    this.record = !!opts.record;
    this.parts = [];        // record 打開時：每塊幾何的 AABB
    this.walls = [];         // 每一道牆的登記（給「牆身不透光」那一項驗）
    this.floors = [];        // 每一片鋪面的登記（給「鋪面有基座」那一項驗）
    this.portals = [];       // 感測區：走進去就被送到別的地方（見 `portal()`）
    this._c = new THREE.Color();
    /* 每個頂點 4 個 int8：紋理方向與「材料 × 16 + 偏移」（見 surface.js）。
       用型別陣列自己長，不用一般陣列——兩百萬個頂點，一般陣列的每一格是
       8 個位元組。 */
    this.sf = new Int8Array(1 << 20);
    this.sfN = 0;
    /* 苔量：這一段 `add` 進來的東西屬於哪一張圖，那張圖的苔長多少（0～1）。
       blocks.js 每砌一個區塊就換一次。它管兩件事：石頭朝上那一面的苔
       （逐頂點烘成著色器的門檻，aMoss）與苔叢（pieces.js 的 mossTuft）。 */
    this.mossRate = 1;
    this.mo = new Uint8Array(1 << 18);
  }

  /**
   * @param {THREE.BufferGeometry} g
   * @param {object} o
   *   p 位置 [x,y,z]／r 歐拉角 [x,y,z]／s 縮放（數字或 [x,y,z]）
   *   color 頂點色／ink 是否描邊（預設 true）
   *   surf  材料（surface.js 的 SURF）。不給就照顏色認（palette.js 的 SURF_OF）
   *   solid 碰撞的種類：'floor'／'block'／'step'（true = 'block'）
   *   base  'block' 站在哪個高度上（預設 0）——盒子從這裡拉到頂
   *   round 圓的：登記成圓柱而不是方盒。軸取 AABB 的中心，半徑取 x／z
   *         兩個半寬裡大的那一個——寧可胖一點，比石頭瘦的碰撞體會讓
   *         身體陷進石頭裡。'dome' 則是「腰以上是圓頂」：一顆石頭最寬
   *         的一圈就在它的腰上。
   *   slip  圓頂上怎麼滑：'slide'（可操作的緩滑）／'fall'（失去操作）。
   *   grow  碰撞盒往外放這麼多
   *   hang  這塊東西是掛著／靠著的（拱的楔石、旗、鏈、獸像），底下
   *         本來就不會有支撐。驗證的白名單靠這個旗標，不靠人記得。
   */
  add(g, o = {}) {
    const p = o.p || [0, 0, 0];
    const r = o.r || [0, 0, 0];
    const s = typeof o.s === 'number' ? [o.s, o.s, o.s] : (o.s || [1, 1, 1]);
    _q.setFromEuler(_e.set(r[0], r[1], r[2]));
    _m.compose(_v.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
    _nm.getNormalMatrix(_m);

    const start = this.pos.length;
    const src = g.attributes.position.array;
    const sn = g.attributes.normal.array;
    this._c.set(o.color === undefined ? 0xffffff : o.color);
    const sid = o.surf !== undefined ? o.surf : (SURF_OF.get(o.color) || 0);
    if (sid) this._c.multiplyScalar(tintOf(sid, p));
    const cr = Math.min(1, this._c.r), cg = Math.min(1, this._c.g), cb = Math.min(1, this._c.b);
    this._surf(g, s, sid, p, src.length / 3);

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
      for (let i = 0; i < E.pos.length; i += 3) {
        _v.set(E.pos[i], E.pos[i + 1], E.pos[i + 2]).applyMatrix4(_m);
        this.ink.push(_v.x, _v.y, _v.z);
        /* 法線走 normalMatrix，跟這塊幾何自己的法線同一條路——不然一塊
           被非等比縮放的石頭，它的輪廓會判在錯的地方。 */
        _v.set(E.n0[i], E.n0[i + 1], E.n0[i + 2]).applyMatrix3(_nm).normalize();
        this.inkA.push(_v.x * 127, _v.y * 127, _v.z * 127);
        _v.set(E.n1[i], E.n1[i + 1], E.n1[i + 2]).applyMatrix3(_nm).normalize();
        this.inkB.push(_v.x * 127, _v.y * 127, _v.z * 127);
      }
    }

    if (this.record) {
      /* `i0` 是這一塊在頂點緩衝區裡的起點。記它是因為 AABB 不夠用：
         「這塊石頭有沒有被黑牆削到」要量真正的頂點——一塊直徑 25 公尺的
         圓形鋪面，它的 AABB 的角比它本身遠 40%，照 AABB 量每一片鋪面
         都會被判成戳到牆外面。 */
      this.parts.push({
        i0: start,
        min: [minx, miny, minz], max: [maxx, maxy, maxz],
        hang: !!o.hang || !!this._hang, solid: o.solid || null,
        pierce: !!this._pierce, tag: o.tag || null,
      });
    }

    if (o.solid) {
      const gr = o.grow || 0;
      const kind = o.solid === true ? 'block' : o.solid;
      /* 'block' 的底不是它自己的底，是它站著的那個地面：一顆離地 30 cm
         的大石頭如果照 AABB 登記，腳下那 30 cm 就是一條可以鑽進去的縫。
         其他種類預設照 AABB，但給了 `base` 就一樣拉到那裡——樓梯底下的
         填石就是這樣從地面登記起的。 */
      const bot = o.base !== undefined ? o.base : kind === 'block' ? 0 : miny - gr;
      const c = {
        min: [minx - gr, bot, minz - gr],
        max: [maxx + gr, maxy + gr, maxz + gr],
        kind, base: bot,
      };
      if (o.round) {
        c.shape = 'circle';
        c.x = (c.min[0] + c.max[0]) / 2;
        c.z = (c.min[2] + c.max[2]) / 2;
        c.r = Math.max(c.max[0] - c.x, c.max[2] - c.z);
        /* 外接盒跟著撐到那個半徑。AABB 是「這個碰撞體不會超出去」的
           保證，吃盒子的那些檢查（相機、分類、掃描）全靠它——瘦的那個
           軸不補回來的話，那個保證就是假的。 */
        c.min[0] = c.x - c.r; c.max[0] = c.x + c.r;
        c.min[2] = c.z - c.r; c.max[2] = c.z + c.r;
        /* 最大的 XZ 截面在哪：'dome' 的話在幾何自己的腰上（一顆石頭
           最寬的一圈就在那裡），腰以上是圓頂。平頂的話就是頂面。 */
        c.cap = o.round === 'dome' ? (miny + maxy) / 2 : c.max[1];
        c.dome = c.max[1] - c.cap;
        c.slip = c.dome ? (o.slip || null) : null;
      }
      this.colliders.push(c);
    }
    return this;
  }

  /** 一塊幾何的 aSurf：紋理方向（最長軸，乘過縮放、轉到世界）與材料。 */
  _surf(g, s, sid, p, nv) {
    const ext = extentOf(g);
    const ex = ext[0] * Math.abs(s[0]), ey = ext[1] * Math.abs(s[1]), ez = ext[2] * Math.abs(s[2]);
    // 差不多一樣長的話取 x：方塊（木箱、石板）的紋路就不會隨著一兩公釐亂跳。
    const ax = ex >= ey * 0.98 && ex >= ez * 0.98 ? 0 : ey >= ez ? 1 : 2;
    _v.set(ax === 0 ? 1 : 0, ax === 1 ? 1 : 0, ax === 2 ? 1 : 0).applyQuaternion(_q);
    const gx = Math.round(_v.x * 127), gy = Math.round(_v.y * 127), gz = Math.round(_v.z * 127);
    const gw = packSurf(sid, Math.floor(hashAt(p[0], p[1], p[2], 5) * 16));
    if (this.sfN + nv * 4 > this.sf.length) {
      let L = this.sf.length * 2;
      while (L < this.sfN + nv * 4) L *= 2;
      const grown = new Int8Array(L);
      grown.set(this.sf.subarray(0, this.sfN));
      this.sf = grown;
      const mo = new Uint8Array(L / 4);
      mo.set(this.mo.subarray(0, this.sfN / 4));
      this.mo = mo;
    }
    const F = this.sf;
    for (let i = 0, k = this.sfN; i < nv; i++, k += 4) {
      F[k] = gx; F[k + 1] = gy; F[k + 2] = gz; F[k + 3] = gw;
    }
    // 苔的門檻。只有石頭會長苔，其他材料一律 1（不長）。
    const ma = sid === SURF.stone ? Math.round(mossAt(this.mossRate) * 255) : 255;
    this.mo.fill(ma, this.sfN / 4, this.sfN / 4 + nv);
    this.sfN += nv * 4;
  }

  /**
   * 這一段之內 `add` 進來的東西全部算「掛著／靠著的」。
   *
   * 拱的楔石、旗、鎖鏈、獸像底下本來就不會有支撐，而「每塊石頭底下要有
   * 東西頂著」那條規則需要一個白名單。用一支開關而不是逐塊標記，是因為
   * 這幾支零件裡每一塊都是掛著的，逐塊寫十次就是十次可以忘記。
   */
  hangs(on) { this._hang = !!on; return this; }

  /**
   * 這一段之內 `add` 進來的東西是**故意穿過黑牆的**。
   *
   * 驗證器守著「黑牆沒有切到任何幾何」——一塊被削掉一半的石頭，牆上那層
   * 薄霧淡不掉那個切面。但有一種東西本來就該穿過去：一段沒入黑霧、看起來
   * 一直延伸下去的城牆。它的切面在黑牆外面，站在場地裡永遠看不到（牆是
   * 不透明的、鏡頭出不去），所以這裡給它一個白名單，而白名單是旗標、不是
   * 人的記性——跟 `hangs` 同一個理由。
   */
  pierces(on) { this._pierce = !!on; return this; }

  /**
   * 只登記一個碰撞盒，不畫任何東西（牆體、台基、地板本身）。
   *
   * @param {object} [o] kind：'shell'（預設）／'floor'／'block'／'step'
   */
  block(cx, cy, cz, w, h, d, o = {}) {
    this.colliders.push({
      min: [cx - w / 2, cy - h / 2, cz - d / 2],
      max: [cx + w / 2, cy + h / 2, cz + d / 2],
      kind: o.kind || 'shell',
      base: o.base === undefined ? cy - h / 2 : o.base,
      // 底下是故意空著的（懸臂石階）。只有驗證器在問。
      ...(o.open ? { open: true } : {}),
    });
    return this;
  }

  /**
   * 一個坑：半徑 r 的圓形坑口，坑口在 top、坑底在 bottom。站在坑口上方的
   * 身體腳底下沒有地面（地面與鋪在坑口那一層的東西都不算），一路掉到坑底；
   * 掉進去之後被坑壁圍住。它不畫任何東西，也不擋鏡頭。
   *
   * 不用 `shape: 'circle'`——那是「不准進來」的圓柱，推出的方向是半徑往外；
   * 坑是反過來的。欄位名字跟圓柱一樣（x／z／r），`shift()` 一起搬。
   */
  pit(x, z, r, top, bottom) {
    this.colliders.push({
      kind: 'pit', x, z, r, top, bottom,
      min: [x - r, bottom, z - r], max: [x + r, top, z + r], base: bottom,
    });
    return this;
  }

  /**
   * 一個感測區：身體走進這個直立的圓柱（中心 x, z、半徑 r、y0～y1）就被
   * 送走。`to` 是目的地——一個區塊的 id，送到那個區塊的出生點（跟按 R
   * 一樣）；`'spawn'` 是「這個區塊自己的出生點」，砌完的時候才認得是誰。
   *
   * 它不是碰撞體，不進 `colliders`：那張清單上的每一支程式（走路、鏡頭、
   * 驗證）都在問「擋不擋」，而感測區什麼都不擋。混進去的話，每一支都得
   * 學會跳過它，漏一支就是一面看不見的牆。
   */
  portal(x, z, r, y0, y1, to = 'spawn') {
    this.portals.push({ x, z, r, y0, y1, to });
    return this;
  }

  /**
   * 空氣牆：擋身體、不擋鏡頭、不畫任何東西。
   *
   * 給「站在高處、外面是空的」的場地用（城牆步道）：黑牆是場地的外框，
   * 但走道的邊緣離黑牆還有十幾公尺，中間是六公尺的落差。空氣牆沿著女牆
   * 的外框從走道面一路立到 `y1`，於是女牆與垛口爬不上去、也跳不過去。
   *
   * 它是一個普通的 'shell' 盒子，只多一個 `air` 旗標。身體照常被它擋住
   * （solveXZ 不認得這個字）；鏡頭的吊臂跳過它——不然鏡頭會被關在三公尺
   * 寬的走道裡，永遠看不到城牆的外面。
   *
   * @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1 水平範圍
   * @param {number} y0 底（女牆腳，走道面稍下一點）
   * @param {number} y1 頂（拉到場地的封頂高度就不必再想跳多高）
   */
  air(x0, z0, x1, z1, y0, y1) {
    this.colliders.push({
      min: [Math.min(x0, x1), y0, Math.min(z0, z1)],
      max: [Math.max(x0, x1), y1, Math.max(z0, z1)],
      kind: 'shell', base: y0, air: true,
    });
    return this;
  }

  /**
   * 一根直立的圓柱，不畫任何東西（柱身、井口、樹幹）。
   *
   * 跟 `block()` 是同一件事，只差水平的截面是圓的——推出的方向因此是
   * 半徑，而不是「四個面裡最近的那一個」。外接的 AABB 照樣記著，所以
   * 吃盒子的那些檢查（分類、支撐、相機）不必先認得圓。
   *
   * @param {number} cx 軸
   * @param {number} cz 軸
   * @param {number} r  半徑（取最大的那一圈：碰撞體寧可胖一點）
   * @param {number} y0 底面
   * @param {number} y1 柱身的頂面（= 最大 XZ 截面的高度）
   * @param {object} [o] kind：'shell'（預設）／'floor'／'block'／'step'
   *   dome：柱頂再加一個這麼高的圓頂（預設 0 = 平頂，站得住）
   *   slip：圓頂上怎麼滑，'slide'／'fall'，見 walk.js 的 SLIDE
   */
  round(cx, cz, r, y0, y1, o = {}) {
    const dome = o.dome || 0;
    this.colliders.push({
      shape: 'circle', x: cx, z: cz, r, cap: y1, dome,
      // 平頂沒有斜度，滑法無從談起——標了也是空話，所以不讓它存在。
      slip: dome ? (o.slip || null) : null,
      min: [cx - r, y0, cz - r],
      max: [cx + r, y1 + dome, cz + r],
      kind: o.kind || 'shell',
      base: o.base === undefined ? y0 : o.base,
    });
    return this;
  }

  /**
   * 一道圓形的邊界（黑牆）。
   *
   * 它跟盒子進同一張清單、由同一支 `solveXZ` 解，因為「擋住」這件事只該
   * 有一套邏輯——障礙物與場地邊界的差別只在**它被什麼外觀包裹**：一根
   * 柱子外面包的是砌體，這一道外面包的是黑牆與黑霧。

   * 形狀（方或圓）由 `a.shape` 決定，判斷邊界在哪的那一支是
   * `walk.js` 的 arenaGap——阻擋、夾碎石、畫黑牆三邊問的是同一支。
   *
   * 圓的邊界不切成一圈盒子，理由是「視覺要貼合移動上限」：碰撞盒是軸
   * 對齊的，一圈斜著的盒子在對角會往內鼓出二三十公分，於是移動的邊界
   * 會沿著圓周晃動，而畫面上的牆是正圓——那正好是要消掉的那種不一致。
   * 圓在這裡是一個數字，畫面那邊用 96 段去逼近它（誤差 1.2 公分）。
   *
   * @param {object} a   世界座標的場地（blocks.js 的 `arenas` 那一筆）
   * @param {number} top 擋到多高。跳躍頂點只有 0.48，所以這個數字只是
   *   為了讓通用的檢查看得到一個合理的盒子範圍。
   */
  bound(a, top = 30) {
    const box = a.shape === 'circle'
      ? { min: [a.x - a.r, -2, a.z - a.r], max: [a.x + a.r, top, a.z + a.r] }
      : { min: [a.x0, -2, a.z0], max: [a.x1, top, a.z1] };
    this.colliders.push({ kind: 'bound', ...a, ...box, base: -2 });
    return this;
  }

  /** @returns {{geometry, ink, colliders, parts, walls, floors, tris, inkLines}} */
  finish() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSurf', new THREE.Int8BufferAttribute(this.sf.slice(0, this.sfN), 4, true));
    g.setAttribute('aMoss', new THREE.Uint8BufferAttribute(this.mo.slice(0, this.sfN / 4), 1, true));
    g.computeBoundingSphere();
    const ink = new THREE.BufferGeometry();
    ink.setAttribute('position', new THREE.Float32BufferAttribute(this.ink, 3));
    ink.setAttribute('aN0', new THREE.Int8BufferAttribute(new Int8Array(this.inkA), 3, true));
    ink.setAttribute('aN1', new THREE.Int8BufferAttribute(new Int8Array(this.inkB), 3, true));
    ink.computeBoundingSphere();
    return {
      geometry: g,
      ink,
      colliders: this.colliders,
      parts: this.parts,
      walls: this.walls,
      floors: this.floors,
      portals: this.portals,
      tris: this.pos.length / 9,
      inkLines: this.ink.length / 6,
    };
  }
}
