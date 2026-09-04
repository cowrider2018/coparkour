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

import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCat, Rig } from '../public/src/cat/rig.js';
import { Driver, Sway, applyPose } from '../public/src/cat/pose.js';
import { measureShapes } from '../public/src/cat/shape.js';
import {
  makeShader, tones, raster, writePPM, emitGroup, rrRadius,
  colOf, dot2, xform, INK_PX, SWAY_TAIL,
} from './lib/soft-raster.mjs';

// cat.js 裡的同名常數。這支工具只讀不寫，複製而非把它們變成公開介面。
const CENTER_Z = -0.04;
const UNITS_PER_BOXH = 3.6293;

const W = 300, H = 300;
const OUT = process.argv[2] || join(tmpdir(), 'catshape');
const SKIN = 'tabby';          // 有斑紋的那隻，才看得出頂點色有沒有被抹平

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
    bones, sway, yaw, place, groundY: -1.563, centerZ: CENTER_Z,
    parts: shape.parts, tail: shape.tail,
    byBone: bend ? shape.byBone : new Int8Array(rig.count).fill(-1),
    rides: shape.rides, grow: g, inkOut: bend ? o : 0,
  });
  const vsFill = mk(0, 0), vsInk = mk(grow, inkPx);

  const tris = [];
  emitGroup(tris, data, col, gLit, vsFill, false, unlitStart);
  emitGroup(tris, data, col, gUnlit, vsFill, false, unlitStart);
  emitGroup(tris, data, col, gOut, vsInk, true, unlitStart);

  mkdirSync(OUT, { recursive: true });
  writePPM(join(OUT, name + '.ppm'), raster(tris, light, T, W, H), W, H);
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
    bones, sway, yaw, place, groundY: -1.563, centerZ: CENTER_Z,
    parts: shape.parts, tail: shape.tail,
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
