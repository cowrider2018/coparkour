// 圓角矩形貓的離線驗證器。
//
// 這台機器沒有 headless WebGL，所以 cat.js 頂點著色器裡那段彎折
// （shape.js 的 SHAPE_GLSL）在這裡用 JS 重寫一次，連同真網格、真法線、
// 真頂點色一起光柵化成圖來看。驗的是最容易寫錯、又最難靠讀程式碼抓到
// 的那幾件事：
//
//   · 彎折後每個部位的輪廓，在任何 yaw、任何步態下都是圓角矩形
//   · 三階調用的是真法線，所以各部位的明暗分佈跟原本一致
//   · 頂點色沒有被抹平——虎斑的紋、三花的塊、尾巴的尾端色都還在
//   · 耳朵、眼睛、鬍鬚是「被載著走」而不是被彎折，形狀保持原樣
//   · 尾巴末端是「平尾端 + 圓角」而不是半球
//   · 墨線是往外一圈固定寬度的矩形，不是被拉歪的外殼
//
// 同時把「同一份姿勢下的真網格」也畫出來當對照，兩排並排看得出差異。
//
// 用法：node tools/verify-cat-shape.mjs [輸出資料夾]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCat, Rig } from '../public/src/cat/rig.js';
import { Driver, Sway, applyPose, TAIL_AXIS } from '../public/src/cat/pose.js';
import {
  measureShapes, SHAPE_PARTS, TAIL_CAP_LEN, TAIL_CAP_R, SIL_NORMAL, SIL_RADIUS, FACE_LIFT,
} from '../public/src/cat/shape.js';

// cat.js 裡的同名常數。這支工具只讀不寫，複製而非把它們變成公開介面。
const CENTER_Z = -0.04;
const BAND_EDGE = [-0.06, 0.42];
const INK = [43 / 255, 35 / 255, 32 / 255];
const INK_PX = 1.25;
const UNITS_PER_BOXH = 3.6293;
const SWAY_TAIL = 1, SWAY_WHISKER_L = 3;

const W = 300, H = 300;
const OUT = process.argv[2] || join(tmpdir(), 'catshape');
const SKIN = 'tabby';          // 有斑紋的那隻，才看得出頂點色有沒有被抹平

/* ── 小工具 ─────────────────────────────────────────────────────── */

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm3 = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const xform = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const rot3 = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
];
const colOf = (m, c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const qRot = (q, o, v) => {
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
function rrRadius(d, h, r) {
  const a = [Math.abs(d[0]), Math.abs(d[1])];
  const e = [Math.max(h[0] - r, 0), Math.max(h[1] - r, 0)];
  if (h[0] * a[1] <= e[1] * a[0]) return h[0] / Math.max(a[0], 1e-6);
  if (h[1] * a[0] <= e[0] * a[1]) return h[1] / Math.max(a[1], 1e-6);
  const K = a[0] * e[0] + a[1] * e[1];
  return K + Math.sqrt(Math.max(0, K * K - (e[0] * e[0] + e[1] * e[1] - r * r)));
}

/* ── 頂點著色器的 JS 版 ─────────────────────────────────────────── */

function makeShader(ctx) {
  const { bones, sway, yaw, place, groundY, parts, tail, byBone, rides, grow, inkOut } = ctx;
  const uY = [Math.sin(yaw), -Math.cos(yaw)];
  const S = place.s;

  const screenOf = (w) => {
    const rz = -w[0] * uY[1] + (w[2] - CENTER_Z) * uY[0];
    return [place.cx + rz * S, place.fy - (w[1] - groundY) * S];
  };
  const projectDir = (d) => [(-d[0] * uY[1] + d[2] * uY[0]) * S, d[1] * S];
  const depthOf = (w) => w[0] * uY[0] + (w[2] - CENTER_Z) * uY[1];
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
    return { x: screen[0], y: screen[1], z: depthOf(world) - (face ? FACE_LIFT : 0), n: vN };
  };
}

/* ── 三階調（cat.js 的算式，用一個代表性的時辰） ────────────────── */

const aces = (x) => { const v = Math.max(0, x) * 1.25; return Math.min(1, Math.max(0, (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14))); };
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function tones(sunY) {
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

function raster(tris, light, T) {
  const rgb = new Float32Array(W * H * 3).fill(0.10);
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

function writePPM(path, rgb) {
  const head = Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii');
  const body = Buffer.alloc(W * H * 3);
  for (let i = 0; i < rgb.length; i++) {
    body[i] = Math.max(0, Math.min(255, Math.round(Math.pow(rgb[i], 1 / 2.2) * 255)));
  }
  writeFileSync(path, Buffer.concat([head, body]));
}

/* ── 一幀 ──────────────────────────────────────────────────────── */

const buf = readFileSync('public/assets/cat.bin');
const data = parseCat(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const rig = new Rig(data.header);
const shape = measureShapes(data, rig);
const col = data.colors.get(SKIN);
const groups = data.header.groups;
const gLit = groups.find((g) => g.name === 'lit');
const gUnlit = groups.find((g) => g.name === 'unlit');
const gOut = groups.find((g) => g.name === 'outline');
const unlitStart = (() => { let lo = Infinity; for (let i = gUnlit.start; i < gUnlit.start + gUnlit.count; i++) lo = Math.min(lo, data.index[i]); return lo; })();

function frame(name, { yaw, speed, steps, bend }) {
  const drv = new Driver(), sway = new Sway();
  for (let i = 0; i < steps; i++) { const p = drv.step(1 / 60, speed, 0); sway.step(1 / 60, drv.time, 0, 0, p); }
  rig.reset(); applyPose(rig, drv.pose);
  const bones = rig.update();

  const place = { cx: W / 2, fy: H - 34, s: 56 };
  const T = tones(0.9);
  const kl = Math.hypot(...T.key);
  const lz = 0.35 * Math.sin(yaw);
  const inv = 1 / Math.max(1e-4, Math.hypot(T.key[0], T.key[1], lz));
  const light = [T.key[0] * inv, T.key[1] * inv, lz * inv];

  // 遊戲裡 boxH = 40（S ≈ 11.0）。這裡畫大了，墨線按同比例放大。
  const inkPx = INK_PX * (place.s / (40 / UNITS_PER_BOXH));
  const S = place.s;
  const grow = Math.min(0.16, inkPx / S);

  const mk = (g, o) => makeShader({
    bones, sway, yaw, place, groundY: -1.563,
    parts: shape.parts, tail: shape.tail,
    byBone: bend ? shape.byBone : new Int8Array(rig.count).fill(-1),
    rides: shape.rides, grow: g, inkOut: bend ? o : 0,
  });
  const vsFill = mk(0, 0), vsInk = mk(grow, inkPx);

  const tris = [];
  const emit = (grp, vs, ink) => {
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
  };
  emit(gLit, vsFill, false);
  emit(gUnlit, vsFill, false);
  emit(gOut, vsInk, true);

  mkdirSync(OUT, { recursive: true });
  writePPM(join(OUT, name + '.ppm'), raster(tris, light, T));
  return { vsFill, place };
}

/* ── 契約檢查 ──────────────────────────────────────────────────── */

/** 彎折後，各方向的輪廓離「該方向的圓角矩形邊界」有多遠。 */
function outlineError(yaw, speed, steps) {
  const drv = new Driver(), sway = new Sway();
  for (let i = 0; i < steps; i++) { const p = drv.step(1 / 60, speed, 0); sway.step(1 / 60, drv.time, 0, 0, p); }
  rig.reset(); applyPose(rig, drv.pose);
  const bones = rig.update();
  const place = { cx: W / 2, fy: H - 34, s: 56 };
  const vs = makeShader({
    bones, sway, yaw, place, groundY: -1.563, parts: shape.parts, tail: shape.tail,
    byBone: shape.byBone, rides: shape.rides, grow: 0, inkOut: 0,
  });
  const uY = [Math.sin(yaw), -Math.cos(yaw)];
  const projectDir = (d) => [(-d[0] * uY[1] + d[2] * uY[0]) * place.s, d[1] * place.s];
  const screenOf = (w) => {
    const rz = -w[0] * uY[1] + (w[2] - CENTER_Z) * uY[0];
    return [place.cx + rz * place.s, place.fy - (w[1] + 1.563) * place.s];
  };
  const BINS = 48;
  const out = new Map();
  const seen = new Uint8Array(data.header.vertexCount);
  for (let i = gLit.start; i < gLit.start + gLit.count; i++) {
    const vi = data.index[i];
    if (seen[vi]) continue;
    seen[vi] = 1;
    const b = col[vi * 4 + 3] & 31;
    const id = shape.byBone[b];
    if (id < 0 || shape.rides[b]) continue;
    const p = shape.parts[id];
    const m = bones.subarray(p.bone * 16, p.bone * 16 + 16);
    const e = [0, 1, 2].map((k) => projectDir(colOf(m, k)).map((x) => x * p.half[k]));
    const ey = Math.hypot(e[1][0], e[1][1]);
    const vHat = ey > 1e-5 ? [e[1][0] / ey, e[1][1] / ey] : [0, 1];
    const uHat = [vHat[1], -vHat[0]];
    const lu = Math.hypot(...e.map((x) => dot2(x, uHat)));
    const lv = Math.hypot(...e.map((x) => dot2(x, vHat)));
    const c = screenOf(xform(m, p.center));
    const packed = col[vi * 4 + 3];
    const w = vs([data.position[vi * 3], data.position[vi * 3 + 1], data.position[vi * 3 + 2]],
      [data.normal[vi * 4] / 32767, data.normal[vi * 4 + 1] / 32767, data.normal[vi * 4 + 2] / 32767],
      data.normal[vi * 4 + 3] / 32767, packed & 31, packed >> 5);
    const off = [w.x - c[0], -(w.y - c[1])];
    const q = [dot2(off, uHat), dot2(off, vHat)];
    const len = Math.hypot(q[0], q[1]);
    if (len < 1e-4) continue;
    const dir = [q[0] / len, q[1] / len];
    const r = Math.min(Math.min(lu, lv) * p.radius, Math.min(lu, lv));
    const R = rrRadius(dir, [lu, lv], r);
    const frac = len / R;
    const bin = Math.floor(((Math.atan2(q[1], q[0]) + Math.PI) / (Math.PI * 2)) * BINS) % BINS;
    const k = p.name + '|' + bin;
    const prev = out.get(k);
    if (prev === undefined) out.set(k, { max: frac, n: 1, R });
    else { prev.n++; if (frac > prev.max) { prev.max = frac; prev.R = R; } }
  }
  /* A direction bin with only a handful of vertices in it does not
     know where the outline is — the max of four samples is not a
     silhouette. The small parts are exactly where that bites: a front
     paw has 714 vertices for 48 directions and they are not spread
     evenly, so thin bins report an edge that is simply the nearest
     vertex that happened to be there. Five is the point past which the
     number stops moving when the bin count is halved. */
  const per = new Map();
  for (const [k, s] of out) {
    if (s.n < 5) continue;
    const n = k.split('|')[0];
    (per.get(n) ?? per.set(n, []).get(n)).push([s.max, s.R]);
  }
  return per;
}

/* ── 跑 ────────────────────────────────────────────────────────── */

const cases = [
  ['idle-right', { yaw: Math.PI / 2, speed: 0, steps: 120, bend: true }],
  ['run-right', { yaw: Math.PI / 2, speed: 1, steps: 143, bend: true }],
  ['turning', { yaw: Math.PI / 2 * 0.35, speed: 1, steps: 143, bend: true }],
  ['idle-left', { yaw: -Math.PI / 2, speed: 0, steps: 120, bend: true }],
];
for (const [n, o] of cases) frame(n, o);
for (const [n, o] of cases) frame('ref-' + n, { ...o, bend: false });

console.log('彎折後的輪廓，離「該方向的圓角矩形邊界」有多遠。');
console.log('比例 1.000 = 剛好在邊界上；px 是換算到遊戲大小（boxH = 40）後的偏離。');
console.log('看不看得出來只取決於 px：前掌在遊戲裡只有 2 px 寬，百分比再大也是');
console.log('半個像素以內，而身體只要偏 2% 就已經是一條墨線的寬度。\n');
let worst = 0;
const acc = new Map();
for (const deg of [-180, -135, -90, -45, 0, 45, 90, 135]) {
  for (const [sp, st] of [[0, 120], [1, 143]]) {
    for (const [n, a] of outlineError(deg * Math.PI / 180, sp, st)) {
      (acc.get(n) ?? acc.set(n, []).get(n)).push(...a);
    }
  }
}
// 驗證器把貓畫在 s = 56；遊戲是 boxH = 40，也就是每模型單位 11.02 世界像素。
const TO_GAME_PX = (40 / UNITS_PER_BOXH) / 56;
for (const [n, a] of acc) {
  a.sort((x, y) => x[0] - y[0]);
  const q = (f) => a[Math.min(a.length - 1, Math.floor(f * a.length))];
  const dev = Math.max(Math.abs(q(0.02)[0] - 1), Math.abs(q(0.98)[0] - 1));
  const rMean = a.reduce((s, x) => s + x[1], 0) / a.length * TO_GAME_PX;
  const px = dev * rMean;
  worst = Math.max(worst, px);
  console.log('  ' + n.padEnd(6) + ' p02 ' + q(0.02)[0].toFixed(3) + '  p98 ' + q(0.98)[0].toFixed(3)
    + '   偏離 ±' + (dev * 100).toFixed(1).padStart(4) + '% = ' + px.toFixed(2)
    + ' px（半寬 ' + rMean.toFixed(1) + ' px）');
}
/* 門檻取一條墨線寬（INK_PX = 1.25 px）。輪廓偏離只要小於畫它的那條線，
   就不可能被看出不是圓角矩形。

   除了兩隻前掌，所有部位都在 0.1 px 以內；前掌是 0.6–0.75 px，而且那是
   真的、不是取樣誤差。原因與取捨都寫在 shape.js 的 SIL_NORMAL：把法線
   閘門放寬到 0.20 可以把前掌壓到 0.33 px，但那會讓更多頂點被拉到邊界上，
   身體與頭的斑紋跟著被壓扁——而保住斑紋正是這整套改寫的理由。前掌在遊戲
   裡半寬 3 px、位在貓的最下緣、跑動時每秒擺數次，用它換掉虎斑的紋路是
   不划算的。 */
const ok = worst < 1.25;
console.log('\n' + (ok ? '✓' : '✗') + ' 最差偏離 ' + worst.toFixed(2) + ' px（門檻 1.25 px = 一條墨線寬）');
console.log('圖：' + OUT + '（無前綴 = 彎折後，ref- = 同姿勢的原網格）');
process.exit(ok ? 0 : 1);
