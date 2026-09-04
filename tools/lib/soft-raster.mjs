// 這台機器沒有 headless WebGL，所以 cat.js 的頂點著色器（連同 shape.js 的
// 彎折）在這裡用 JS 重寫一次，再軟體光柵化成圖。驗證器與預覽工具共用同一份，
// 因為「離線畫出來的那隻」跟「瀏覽器畫出來的那隻」只有在兩邊算式一模一樣時
// 才有話說；抄成兩份，第一次改 shape.js 就會有一份悄悄過期。
//
// 這支檔案不知道自己在畫哪一種動物：貓、狗，或任何用同一副骨架與同一套彎折
// 的東西，差別都在傳進來的 ctx 裡（centerZ、parts、byBone…）。
//
// cat.js 那幾個常數是複製過來的，不是把它們變成公開介面。

import { writeFileSync } from 'node:fs';
import {
  TAIL_CAP_LEN, TAIL_CAP_R, SIL_NORMAL, SIL_RADIUS, FACE_LIFT,
} from '../../public/src/cat/shape.js';
import { TAIL_AXIS } from '../../public/src/cat/pose.js';

export const BAND_EDGE = [-0.06, 0.42];
export const INK = [43 / 255, 35 / 255, 32 / 255];
export const INK_PX = 1.25;
export const SWAY_TAIL = 1, SWAY_WHISKER_L = 3;

/* ── 小工具 ─────────────────────────────────────────────────────── */

export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const norm3 = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const xform = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
export const rot3 = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
];
export const colOf = (m, c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const qRot = (q, o, v) => {
  const x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3];
  const cx = y * v[2] - z * v[1] + w * v[0];
  const cy = z * v[0] - x * v[2] + w * v[1];
  const cz = x * v[1] - y * v[0] + w * v[2];
  return [
    v[0] + 2 * (y * cz - z * cy),
    v[1] + 2 * (z * cx - x * cz),
    v[2] + 2 * (x * cy - y * cx),
  ];
};

/** shape.js 的 rrRadius，一字不差的 JS 版。 */
export function rrRadius(d, h, r) {
  const a = [Math.abs(d[0]), Math.abs(d[1])];
  const e = [Math.max(h[0] - r, 0), Math.max(h[1] - r, 0)];
  if (h[0] * a[1] <= e[1] * a[0]) return h[0] / Math.max(a[0], 1e-6);
  if (h[1] * a[0] <= e[0] * a[1]) return h[1] / Math.max(a[1], 1e-6);
  const K = a[0] * e[0] + a[1] * e[1];
  return K + Math.sqrt(Math.max(0, K * K - (e[0] * e[0] + e[1] * e[1] - r * r)));
}

/* ── 頂點著色器的 JS 版 ─────────────────────────────────────────── */

export function makeShader(ctx) {
  const {
    bones, sway, yaw, place, groundY, parts, tail, byBone, rides, grow, inkOut, centerZ,
  } = ctx;
  // Per bone, how far this pass pushes the ink back; see cat.js's
  // uInkSink. Only the ink pass carries it, so a caller building the
  // fill's vertex function passes none.
  const inkSink = ctx.inkSink || null;
  const uY = [Math.sin(yaw), -Math.cos(yaw)];
  const S = place.s;

  const screenOf = (w) => {
    const rz = -w[0] * uY[1] + (w[2] - centerZ) * uY[0];
    return [place.cx + rz * S, place.fy - (w[1] - groundY) * S];
  };
  const projectDir = (d) => [(-d[0] * uY[1] + d[2] * uY[0]) * S, d[1] * S];
  const depthOf = (w) => w[0] * uY[0] + (w[2] - centerZ) * uY[1];
  const boneMat = (i) => bones.subarray(i * 16, i * 16 + 16);

  const frames = parts.map((p) => {
    const m = boneMat(p.bone);
    const e = [0, 1, 2].map((k) => projectDir(colOf(m, k)).map((x) => x * p.half[k]));
    const ey = Math.hypot(e[1][0], e[1][1]);
    const vHat = ey > 1e-5 ? [e[1][0] / ey, e[1][1] / ey] : [0, 1];
    const uHat = [vHat[1], -vHat[0]];
    return {
      c: screenOf(xform(m, p.center)), uHat, vHat,
      lu: Math.hypot(...e.map((x) => dot2(x, uHat))),
      lv: Math.hypot(...e.map((x) => dot2(x, vHat))),
      radius: p.radius, norm: p.norm,
    };
  });

  const warpToRect = (pt, id, sil) => {
    const f = frames[id];
    const off = [pt[0] - f.c[0], -(pt[1] - f.c[1])];
    const p = [dot2(off, f.uHat), dot2(off, f.vHat)];
    const len = Math.hypot(p[0], p[1]);
    if (len < 1e-5) return pt;
    const t = Math.hypot(p[0] / f.lu, p[1] / f.lv) / f.norm;
    const dir = [p[0] / len, p[1] / len];
    const r = Math.min(Math.min(f.lu, f.lv) * f.radius, Math.min(f.lu, f.lv));
    const R = rrRadius(dir, [f.lu, f.lv], r);
    const target = 1 + inkOut / Math.max(R, 1e-3);
    const w = smoothstep(SIL_NORMAL[0], SIL_NORMAL[1], sil)
            * smoothstep(SIL_RADIUS[0], SIL_RADIUS[1], t);
    const tt = Math.min(t + (target - t) * w, target);
    const np = [dir[0] * tt * R, dir[1] * tt * R];
    const no = [np[0] * f.uHat[0] + np[1] * f.vHat[0], np[0] * f.uHat[1] + np[1] * f.vHat[1]];
    return [f.c[0] + no[0], f.c[1] - no[1]];
  };

  const N = TAIL_AXIS.length;
  const capBase = TAIL_AXIS[N - 1];
  const capTan = norm3(sub3(TAIL_AXIS[N - 1], TAIL_AXIS[N - 2]));
  const tailCap = (p, o) => {
    if (o < 0.999) return p;
    const off = sub3(p, capBase);
    const along = dot3(off, capTan);
    if (along <= 0) return p;
    const side = [0, 1, 2].map((k) => off[k] - along * capTan[k]);
    const rad = Math.hypot(...side);
    const len = Math.hypot(along, rad);
    if (len < 1e-6) return p;
    const R = tail.radius;
    const dir = [along / len, rad / len];
    const target = rrRadius(dir, [R * TAIL_CAP_LEN, R], R * TAIL_CAP_R);
    const nq = [dir[0] * (len / R) * target, dir[1] * (len / R) * target];
    return [0, 1, 2].map((k) =>
      capBase[k] + nq[0] * capTan[k] + (rad > 1e-6 ? side[k] * (nq[1] / rad) : 0));
  };

  const tailNodes = (o) => {
    const x = Math.min(Math.max(o, 0), 1) * (N - 1);
    const lo = Math.min(Math.floor(x), N - 1);
    return { lo, hi: Math.min(lo + 1, N - 1), t: x - Math.floor(x) };
  };
  const swayPoint = (p, o, g) => {
    if (g === SWAY_TAIL) {
      const { lo, hi, t } = tailNodes(o);
      const f = (i) => {
        const a = qRot(sway.qs, i * 4, sub3(p, TAIL_AXIS[i]));
        return [0, 1, 2].map((k) => a[k] + TAIL_AXIS[i][k] + sway.bend[i * 3 + k]);
      };
      const a = f(lo), b = f(hi);
      return [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);
    }
    const { lo, hi, t } = tailNodes(o);
    let ay = sway.whiskers[lo * 2] + (sway.whiskers[hi * 2] - sway.whiskers[lo * 2]) * t;
    let az = sway.whiskers[lo * 2 + 1] + (sway.whiskers[hi * 2 + 1] - sway.whiskers[lo * 2 + 1]) * t;
    if (g === SWAY_WHISKER_L) { ay = -ay; az = -az; }
    const cz = Math.cos(az), sz = Math.sin(az);
    const q = [p[0] * cz - p[1] * sz, p[0] * sz + p[1] * cz, p[2]];
    const cy = Math.cos(ay), sy = Math.sin(ay);
    return [q[0] * cy + q[2] * sy, q[1], -q[0] * sy + q[2] * cy];
  };
  const swayNormal = (n, o, g) => {
    if (g === SWAY_TAIL) {
      const { lo, hi, t } = tailNodes(o);
      const a = qRot(sway.qs, lo * 4, n), b = qRot(sway.qs, hi * 4, n);
      return norm3([0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t));
    }
    return swayPoint(n, o, g);
  };

  /** 一個頂點：aPosition, aNormal.xyz, o, bone, swayGroup。 */
  return function vertex(pos, nrm, o, b, group, face) {
    let local = pos, normal = nrm;
    if (b === tail.bone && group === SWAY_TAIL) local = tailCap(local, o);
    if (group !== 0) { local = swayPoint(local, o, group); normal = swayNormal(normal, o, group); }
    local = [0, 1, 2].map((k) => local[k] + normal[k] * grow);

    const m = boneMat(b);
    const world = xform(m, local);
    const wn = rot3(m, normal);
    const vN = [wn[0] * uY[0] + wn[2] * uY[1], wn[1], -wn[0] * uY[1] + wn[2] * uY[0]];

    let screen = screenOf(world);
    const part = byBone[b];
    if (part >= 0 && !rides[b] && !face) {
      const l = Math.hypot(...vN) || 1;
      screen = warpToRect(screen, part, 1 - Math.abs(vN[0] / l));
    }
    const sink = inkSink ? inkSink[b] : 0;
    return { x: screen[0], y: screen[1], z: depthOf(world) - (face ? FACE_LIFT : 0) + sink, n: vN };
  };
}

/* ── 三階調（cat.js 的算式，用一個代表性的時辰） ────────────────── */

export const aces = (x) => { const v = Math.max(0, x) * 1.25; return Math.min(1, Math.max(0, (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14))); };
export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function tones(sunY) {
  const tint = [1.0, 0.93, 0.82], amb = [0.16, 0.19, 0.26];
  const band = (kf, af) => [0, 1, 2].map((i) => tint[i] * 2.4 * kf + amb[i] * 1.5 * af);
  const lit = band(1, 1), mid = band(0.24, 1), sh = band(0.035, 1.06);
  const ratio = (b) => [0, 1, 2].map((i) => { const L = aces(lit[i] * 0.55); return L > 1e-4 ? aces(b[i] * 0.55) / L : 0; });
  const lum = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const hold = (r, lo, hi) => { const l = lum(r); const k = l > 1e-4 ? Math.min(hi, Math.max(lo, l)) / l : 0; return r.map((v) => v * k); };
  return {
    keyLit: lit, mid: hold(ratio(mid), 0.50, 0.72), shadow: hold(ratio(sh), 0.24, 0.42),
    key: [-0.55, sunY * 0.8 + 0.42, 0.0], unlitGain: Math.max(0.30, aces(lum(lit) * 0.55)),
  };
}

/* ── 光柵器 ─────────────────────────────────────────────────────── */

export function raster(tris, light, T, W, H, bg = 0.10) {
  const rgb = new Float32Array(W * H * 3).fill(bg);
  const zb = new Float32Array(W * H).fill(1e9);
  for (const t of tris) {
    const [A, B, C] = t.v;
    const den = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    if (Math.abs(den) < 1e-9) continue;
    if (t.cull && Math.sign(den) === t.cull) continue;
    const x0 = Math.max(0, Math.floor(Math.min(A.x, B.x, C.x)));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(A.x, B.x, C.x)));
    const y0 = Math.max(0, Math.floor(Math.min(A.y, B.y, C.y)));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(A.y, B.y, C.y)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((B.y - C.y) * (px - C.x) + (C.x - B.x) * (py - C.y)) / den;
        const w1 = ((C.y - A.y) * (px - C.x) + (A.x - C.x) * (py - C.y)) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * A.z + w1 * B.z + w2 * C.z;
        const i = y * W + x;
        if (!(z < zb[i])) continue;
        zb[i] = z;
        let c;
        if (t.ink) c = INK;
        else if (t.unlit) c = t.albedo.map((v) => v * T.unlitGain);
        else {
          const n = [0, 1, 2].map((k) => w0 * A.n[k] + w1 * B.n[k] + w2 * C.n[k]);
          const l = Math.hypot(...n) || 1;
          const d = (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / l;
          const tone = d > BAND_EDGE[1] ? [1, 1, 1] : d > BAND_EDGE[0] ? T.mid : T.shadow;
          c = [0, 1, 2].map((k) => aces(srgbToLinear(t.albedo[k]) * T.keyLit[k]) * tone[k]);
        }
        rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
      }
    }
  }
  return rgb;
}

export function writePPM(path, rgb, W, H) {
  const head = Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii');
  const body = Buffer.alloc(W * H * 3);
  for (let i = 0; i < rgb.length; i++) {
    body[i] = Math.max(0, Math.min(255, Math.round(Math.pow(rgb[i], 1 / 2.2) * 255)));
  }
  writeFileSync(path, Buffer.concat([head, body]));
}

/**
 * 把一整個 group 的三角形餵給光柵器。`data` 是 parseCat 的產物或 dog.js 造出
 * 來的同形物件；`vs` 是 makeShader 回傳的頂點函式。
 */
export function emitGroup(tris, data, col, grp, vs, ink, unlitStart) {
  for (let i = grp.start; i < grp.start + grp.count; i += 3) {
    const v = [0, 1, 2].map((k) => {
      const vi = data.index[i + k];
      const packed = col[vi * 4 + 3];
      return vs(
        [data.position[vi * 3], data.position[vi * 3 + 1], data.position[vi * 3 + 2]],
        [data.normal[vi * 4] / 32767, data.normal[vi * 4 + 1] / 32767, data.normal[vi * 4 + 2] / 32767],
        data.normal[vi * 4 + 3] / 32767, packed & 31, packed >> 5,
        !ink && vi >= unlitStart);
    });
    const v0 = data.index[i];
    tris.push({
      v, ink, cull: ink ? -1 : 1,
      unlit: !ink && v0 >= unlitStart,
      albedo: [col[v0 * 4] / 255, col[v0 * 4 + 1] / 255, col[v0 * 4 + 2] / 255],
    });
  }
}
