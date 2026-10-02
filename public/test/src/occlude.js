/* ── test/src/occlude.js ─────────────────────────────────────────────
   從一點往四面八方看出去，每一個方向最先撞到什麼、在多遠：國王旋風斬的熱氣流
   （skills.js 的 gale）從牠身上往外擴散，碰到障礙物的那一段就被擋下、留下斬痕。

   氣流發射的那一刻，擋得到它的東西就已經決定了，所以這張表只算一次，是精確的
   ——不是打一圈射線取樣。

   ── 為什麼算得精確 ─────────────────────────────────────────────────
   場上的碰撞體只有兩種形狀（walk.js）：軸對齊的方盒、直立的圓柱（可能帶圓頂）；
   黑牆是方的或圓的。氣流在一段固定的高度 lo～hi 裡，每一個碰撞體對它只有擋或
   不擋（跟 skills.js 的 blockerAt 同一套：坑與黑牆不算、開著的門不算、底在 hi 以上
   的不算）；帶圓頂的柱子被 lo 那個高度切過，截面還是一個圓。所以整件事是平面上
   的事：從一點看一堆長方形與圓，每個方向最近的那一面多遠。

   在極座標下每一面都有封閉解（θ 是 atan2(x, z) 那一種，方向是 (sin θ, cos θ)）：
     line    方盒朝著這一點的那一面（一個方盒最多兩面）、方形的黑牆（從裡面看，四面）：
             d = h / cos(θ − φ)，h 是這一點到那條線的垂直距離、φ 是垂足的方向。
     circle  圓柱：看得到的角度是 φ ± asin(r / D)，
             d = D cos α − √(r² − D² sin² α)，α = θ − φ（近的那一側）。
     ring    圓形的黑牆（從裡面看）：d = −(o·u) + √((o·u)² − |o|² + R²)，o 是這一點離圓心。

   ── 下包絡 ─────────────────────────────────────────────────────────
   每一面在它看得到的那一段角度上是一條曲線，答案是所有曲線的下包絡。包絡換手只會發生
   在曲線的端點，或兩條曲線交叉的地方——互不重疊的凸形近側不會交叉（只會互相遮住），
   但流程模式的牆常是幾個相鄰、重疊的方盒拼的，所以兩兩交叉的角度也算進來（線對線、
   線對圓、圓對圓的交點，多算的只是多切一刀，不影響結果）。把這些角度排好，每一小段
   取中間那個方向，看誰最近，那一小段就是誰的；相鄰同一面的併起來。

   結果是一張分段表（`pieces`）：每一段 [a0, a1) 是哪一面、哪一個碰撞體（黑牆是
   null）。整圈 [−π, π) 都有人——黑牆一定在。

   ── 成本 ───────────────────────────────────────────────────────────
   一次：先丟掉比黑牆還遠、高度不對的，剩下的照角度掃過去（只跟角度範圍重疊的比），
   流程模式一場三百個碰撞體上下，算一次幾毫秒（離線驗證量得到）。之後查一個方向是二分搜尋加一個
   封閉式。
   ------------------------------------------------------------------ */

const TAU = 2 * Math.PI;

/** 角度收到 [−π, π)。 */
export const wrapAngle = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);

/** 兩個角度算同一個的容差（弧度）。 */
const EPS = 1e-9;

/** 一面在方向 θ 上離中心多遠。 */
function distOf(f, th) {
  const a = th - f.phi;
  if (f.kind === 'line') return f.h / Math.max(1e-12, Math.cos(a));
  if (f.kind === 'circle') {
    const s = f.D * Math.sin(a);
    return Math.max(0, f.D * Math.cos(a) - Math.sqrt(Math.max(0, f.r * f.r - s * s)));
  }
  if (f.kind === 'ring') {
    const ou = f.ox * Math.sin(th) + f.oz * Math.cos(th);
    return -ou + Math.sqrt(Math.max(0, ou * ou - f.ox * f.ox - f.oz * f.oz + f.R * f.R));
  }
  return 0;                                    // 'zero'：中心在東西裡面
}

/**
 * 一面看得到的那一段角度放進 out：從 a 往正方向轉 span（0 < span ≤ 2π）。跨過 ±π 的
 * 切成兩段，同一面的兩段共用參數。
 */
function push(out, f, a, span) {
  const a0 = wrapAngle(a), a1 = a0 + span;
  if (a1 <= Math.PI + EPS) { out.push({ ...f, a0, a1: Math.min(a1, Math.PI) }); return; }
  out.push({ ...f, a0, a1: Math.PI });
  out.push({ ...f, a0: -Math.PI, a1: a1 - TAU });
}

/** 一條線段（中心看過去從 p 到 q），垂足方向 phi、垂直距離 h：看得到的那一段角度。 */
function lineFace(out, cx, cz, p, q, h, phi, col) {
  const ap = Math.atan2(p[0] - cx, p[1] - cz), aq = Math.atan2(q[0] - cx, q[1] - cz);
  let span = wrapAngle(aq - ap), a = ap;
  if (span < 0) { a = aq; span = -span; }
  if (span < EPS) return;
  // 交點要用：線上一點（垂足）與線的方向。
  const fx = cx + h * Math.sin(phi), fz = cz + h * Math.cos(phi);
  push(out, { kind: 'line', h, phi, col, fx, fz, tx: Math.cos(phi), tz: -Math.sin(phi) }, a, span);
}

/**
 * 一個碰撞體在 lo～hi 這一段高度裡擋不擋，擋的話它的平面形狀：方盒 { box }、圓 { r }。
 * 跟 skills.js 的 blockerAt 同一套。
 */
function footprint(b, doors, lo, hi) {
  if (b.kind === 'pit' || b.kind === 'bound') return null;
  if (b.door && doors[b.door]) return null;
  if (b.min[1] >= hi) return null;
  if (b.shape === 'circle') {
    if (lo < b.cap) return { r: b.r };
    if (!b.dome || lo >= b.cap + b.dome) return null;
    const k = (lo - b.cap) / b.dome;
    return { r: b.r * Math.sqrt(1 - k * k) };
  }
  if (b.max[1] <= lo) return null;
  return { box: true };
}

/** 從 (cx, cz) 到黑牆最遠多遠（比這更遠的東西擋不到什麼）。 */
function farthest(A, cx, cz) {
  if (A.shape === 'circle') return Math.hypot(cx - A.x, cz - A.z) + A.r;
  return Math.hypot(Math.max(cx - A.x0, A.x1 - cx), Math.max(cz - A.z0, A.z1 - cz));
}

/** 這一點在場上每一面（黑牆、擋得到的碰撞體）看得到的那幾段。 */
function facesOf(field, cx, cz, lo, hi) {
  const A = field.arena, doors = field.doors || {}, out = [], far = farthest(A, cx, cz);
  if (A.shape === 'circle') {
    push(out, { kind: 'ring', phi: 0, col: null, ox: cx - A.x, oz: cz - A.z, R: A.r, x: A.x, z: A.z }, -Math.PI, TAU);
  } else {
    const c = [[A.x0, A.z0], [A.x1, A.z0], [A.x1, A.z1], [A.x0, A.z1]];
    lineFace(out, cx, cz, c[1], c[2], Math.max(0, A.x1 - cx), Math.PI / 2, null);
    lineFace(out, cx, cz, c[3], c[0], Math.max(0, cx - A.x0), -Math.PI / 2, null);
    lineFace(out, cx, cz, c[2], c[3], Math.max(0, A.z1 - cz), 0, null);
    lineFace(out, cx, cz, c[0], c[1], Math.max(0, cz - A.z0), Math.PI, null);
  }
  for (const b of field.cols) {
    const fp = footprint(b, doors, lo, hi);
    if (!fp) continue;
    if (fp.box) {
      const [x0, , z0] = b.min, [x1, , z1] = b.max;
      if (Math.hypot(Math.max(x0 - cx, 0, cx - x1), Math.max(z0 - cz, 0, cz - z1)) >= far) continue;
      if (cx > x0 && cx < x1 && cz > z0 && cz < z1) return [{ kind: 'zero', phi: 0, col: b, a0: -Math.PI, a1: Math.PI }];
      if (cx <= x0) lineFace(out, cx, cz, [x0, z0], [x0, z1], x0 - cx, Math.PI / 2, b);
      if (cx >= x1) lineFace(out, cx, cz, [x1, z1], [x1, z0], cx - x1, -Math.PI / 2, b);
      if (cz <= z0) lineFace(out, cx, cz, [x1, z0], [x0, z0], z0 - cz, 0, b);
      if (cz >= z1) lineFace(out, cx, cz, [x0, z1], [x1, z1], cz - z1, Math.PI, b);
      continue;
    }
    const D = Math.hypot(b.x - cx, b.z - cz), r = fp.r;
    if (D - r >= far) continue;
    if (D <= r) return [{ kind: 'zero', phi: 0, col: b, a0: -Math.PI, a1: Math.PI }];
    const phi = Math.atan2(b.x - cx, b.z - cz), half = Math.asin(r / D);
    push(out, { kind: 'circle', D, phi, r, col: b, x: b.x, z: b.z }, phi - half, 2 * half);
  }
  return out;
}

/** 一面底下那個完整的形狀（交點用）：線 { line: [點, 方向] } 或圓 { circle: [圓心, 半徑] }。 */
function shapeOf(f) {
  if (f.kind === 'line') return { line: [f.fx, f.fz, f.tx, f.tz] };
  return { circle: [f.x, f.z, f.kind === 'ring' ? f.R : f.r] };
}

/** 兩個形狀的交點（0～2 個）。 */
function meet(s, t) {
  if (s.circle && t.line) return meet(t, s);
  if (s.line && t.line) {
    const [px, pz, ux, uz] = s.line, [qx, qz, vx, vz] = t.line;
    const den = ux * vz - uz * vx;
    if (Math.abs(den) < 1e-12) return [];
    const k = ((qx - px) * vz - (qz - pz) * vx) / den;
    return [[px + ux * k, pz + uz * k]];
  }
  if (s.line) {
    const [px, pz, ux, uz] = s.line, [ox, oz, r] = t.circle;
    const wx = px - ox, wz = pz - oz, b = wx * ux + wz * uz, c = wx * wx + wz * wz - r * r, q = b * b - c;
    if (q < 0) return [];
    const e = Math.sqrt(q);
    return [[px + ux * (-b - e), pz + uz * (-b - e)], [px + ux * (-b + e), pz + uz * (-b + e)]];
  }
  const [ax, az, ra] = s.circle, [bx, bz, rb] = t.circle;
  const d = Math.hypot(bx - ax, bz - az);
  if (d < 1e-12 || d > ra + rb || d < Math.abs(ra - rb)) return [];
  const k = (d * d + ra * ra - rb * rb) / (2 * d), h = Math.sqrt(Math.max(0, ra * ra - k * k));
  const ux = (bx - ax) / d, uz = (bz - az) / d, mx = ax + ux * k, mz = az + uz * k;
  return [[mx - uz * h, mz + ux * h], [mx + uz * h, mz - ux * h]];
}

/**
 * 從 (x, z) 看出去、高度 lo～hi 的那一圈：每個方向最先撞到哪一面、多遠。
 *
 * @param {object} field combat.js 的 FIELD 那一種（arena、cols、doors）
 * @returns {{x: number, z: number, pieces: {a0: number, a1: number, face: object, col: object|null}[]}}
 *   pieces 照角度排好、首尾相接蓋滿 [−π, π)；face 是那一面（distOf 吃的），col 是那一面的碰撞體（黑牆是 null）
 */
export function shadeOf(field, x, z, lo, hi) {
  const faces = facesOf(field, x, z, lo, hi).sort((p, q) => p.a0 - q.a0);
  const cuts = [-Math.PI, Math.PI];
  for (const f of faces) cuts.push(f.a0, f.a1);
  // 交叉的角度：角度範圍重疊的兩面（照起點排好，往後找到起點超過自己終點為止）。
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    for (let j = i + 1; j < faces.length && faces[j].a0 < f.a1; j++) {
      const g = faces[j];
      if (f.kind === 'zero' || g.kind === 'zero') continue;
      for (const [px, pz] of meet(shapeOf(f), shapeOf(g))) {
        const a = Math.atan2(px - x, pz - z);
        if (a > Math.max(f.a0, g.a0) && a < Math.min(f.a1, g.a1)) cuts.push(a);
      }
    }
  }
  cuts.sort((p, q) => p - q);
  const pieces = [];
  let next = 0, live = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a0 = cuts[i], a1 = cuts[i + 1];
    if (a1 - a0 < EPS) continue;
    const mid = (a0 + a1) / 2;
    while (next < faces.length && faces[next].a0 <= mid) live.push(faces[next++]);
    live = live.filter((f) => f.a1 > mid);
    let best = null, bd = Infinity;
    for (const f of live) {
      const d = distOf(f, mid);
      if (d < bd) { bd = d; best = f; }
    }
    // 比 EPS 還窄、跳過的那一小段併給前一段：首尾一定相接。
    const last = pieces[pieces.length - 1];
    if (last) last.a1 = a0;
    if (last && last.face === best) last.a1 = a1;
    else pieces.push({ a0, a1, face: best, col: best.col });
  }
  pieces[0].a0 = -Math.PI;
  pieces[pieces.length - 1].a1 = Math.PI;
  return { x, z, pieces };
}

/** 包絡裡方向 θ 落在哪一段（二分搜尋）。 */
export function pieceAt(env, th) {
  const a = wrapAngle(th), P = env.pieces;
  let lo = 0, hi = P.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (P[m].a0 <= a) lo = m; else hi = m - 1;
  }
  return P[lo];
}

/** 從中心往方向 θ 走，最先撞到東西的那一點多遠。 */
export const reachAt = (env, th) => distOf(pieceAt(env, th).face, wrapAngle(th));

/** 一段裡離中心最遠的距離：那一面在這一段上的最大值（端點，圓形黑牆再看離圓心最遠的那個方向）。 */
export function farIn(piece) {
  const f = piece.face;
  let d = Math.max(distOf(f, piece.a0), distOf(f, piece.a1));
  if (f.kind === 'ring') {
    const away = Math.atan2(f.ox, f.oz);
    for (const a of [away, away - TAU, away + TAU]) if (a > piece.a0 && a < piece.a1) d = Math.max(d, distOf(f, a));
  }
  return d;
}

/** 整圈最遠到哪（氣流走完要走這麼遠）。 */
export const farthestOf = (env) => Math.max(...env.pieces.map(farIn));
