// 狗的離線驗證器與預覽圖。
//
// dog.js 是把 cat.bin 重新拼過一次的東西——刪三角形、換頂點色、接上新
// 造的鼻樑與短尾、改耳朵角度——這些錯了不會丟例外，只會畫出一隻怪東西。
// 所以這支工具把整隻狗用 tools/lib/soft-raster.mjs（cat.js 頂點著色器的
// JS 版）畫出來：兩種耳朵，各跑一張，再沿著整個 180 度的轉身取五個角度。
//
// 順便檢查幾件靠看圖看不出來的事：三個 group 的頂點範圍還是不相交、
// lit 與 unlit 在索引裡還是相鄰（不然一次 draw call 併不起來）、
// 每個三角形仍然只屬於一根骨頭。
//
// 用法：node tools/verify-dog.mjs [輸出資料夾]

import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { parseCat, Rig } from '../public/src/cat/rig.js';
import { Driver, Sway, applyPose } from '../public/src/cat/pose.js';
import { measureShapes } from '../public/src/cat/shape.js';
import { buildDog, DOG_EARS, DOG_SKINS } from '../public/src/cat/dog.js';
import { makeShader, tones, raster, emitGroup, INK_PX } from './lib/soft-raster.mjs';

const W = 320, H = 300;
const OUT = process.argv[2] || join(tmpdir(), 'dogpreview');

/* ── PNG（PPM 沒有人看得動） ─────────────────────────────────────── */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(path, rgb, w, h) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w * 3; x++) {
      const v = rgb[y * w * 3 + x];
      raw[o++] = Math.max(0, Math.min(255, Math.round(Math.pow(v, 1 / 2.2) * 255)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

/** 幾張圖橫著拼成一張，才看得出兩種耳朵的差別。 */
function tile(frames, w, h) {
  const n = frames.length;
  const out = new Float32Array(w * n * h * 3);
  frames.forEach((f, k) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) out[(y * w * n + k * w + x) * 3 + c] = f[(y * w + x) * 3 + c];
      }
    }
  });
  return out;
}

/* ── 一隻狗 ─────────────────────────────────────────────────────── */

const buf = readFileSync('public/assets/cat.bin');
const cat = parseCat(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

function dogOf(ear) {
  const data = buildDog(cat, { ear });
  const rig = new Rig(data.header);
  const shape = measureShapes(data, rig, data.model.parts, data.model.ride);
  const g = (n) => data.header.groups.find((x) => x.name === n);
  const gUnlit = g('unlit');
  let unlitStart = Infinity;
  for (let i = gUnlit.start; i < gUnlit.start + gUnlit.count; i++) {
    unlitStart = Math.min(unlitStart, data.index[i]);
  }
  const col = data.colors.get(DOG_SKINS[0]);

  // CatLayer 的 _measureGround：站姿的最低點就是腳踩的那條線。
  const drv0 = new Driver();
  rig.reset(); applyPose(rig, drv0.pose);
  const M0 = rig.update();
  let groundY = 1e30;
  for (let v = 0; v < data.header.vertexCount; v++) {
    const o = (col[v * 4 + 3] & 31) * 16;
    const y = M0[o + 1] * data.position[v * 3] + M0[o + 5] * data.position[v * 3 + 1]
      + M0[o + 9] * data.position[v * 3 + 2] + M0[o + 13];
    if (y < groundY) groundY = y;
  }

  /* The same table cat.js builds: per bone, how far its ink is pushed
     back so that two parts come out sharing one outline. */
  const inkSink = new Float32Array(rig.count);
  for (const [name, by] of Object.entries(data.model.inkSink || {})) {
    inkSink[rig.bone(name)] = by;
  }

  return {
    data, rig, shape, col, unlitStart, groundY, inkSink,
    lit: g('lit'), unlit: gUnlit, out: g('outline'),
  };
}

function frame(dog, { yaw, speed, steps, bend = true, skin = DOG_SKINS[0] }) {
  const { data, rig, shape, unlitStart, groundY } = dog;
  const col = data.colors.get(skin);
  const drv = new Driver(), sway = new Sway();
  for (let i = 0; i < steps; i++) { const p = drv.step(1 / 60, speed, 0); sway.step(1 / 60, drv.time, 0, 0, p); }
  rig.reset(); applyPose(rig, drv.pose);
  const bones = rig.update();

  const place = { cx: W / 2, fy: H - 34, s: 56 };
  const T = tones(0.9);
  const lz = 0.35 * Math.sin(yaw);
  const inv = 1 / Math.max(1e-4, Math.hypot(T.key[0], T.key[1], lz));
  const light = [T.key[0] * inv, T.key[1] * inv, lz * inv];

  const S = place.s;
  const inkPx = INK_PX * (S / (40 / (data.model.restHeight / data.model.heightInBoxH)));
  const grow = Math.min(0.16, inkPx / S);

  const mk = (gr, io, sink) => makeShader({
    bones, sway, yaw, place, groundY, centerZ: data.model.centerZ,
    parts: shape.parts, tail: shape.tail,
    byBone: bend ? shape.byBone : new Int8Array(rig.count).fill(-1),
    rides: shape.rides, grow: gr, inkOut: bend ? io : 0, inkSink: sink,
  });
  const vsFill = mk(0, 0, null), vsInk = mk(grow, inkPx, dog.inkSink);

  const tris = [];
  emitGroup(tris, data, col, dog.lit, vsFill, false, unlitStart);
  emitGroup(tris, data, col, dog.unlit, vsFill, false, unlitStart);
  emitGroup(tris, data, col, dog.out, vsInk, true, unlitStart);
  return raster(tris, light, T, W, H, 0.14);
}

/* ── 結構檢查 ───────────────────────────────────────────────────── */

function checks(dog, ear) {
  const { data, col } = dog;
  const h = data.header;
  const range = {};
  for (const g of h.groups) {
    let lo = Infinity, hi = -Infinity;
    for (let i = g.start; i < g.start + g.count; i++) {
      lo = Math.min(lo, data.index[i]); hi = Math.max(hi, data.index[i]);
    }
    range[g.name] = [lo, hi];
  }
  const fail = [];
  if (!(range.lit[1] < range.unlit[0])) fail.push('lit 與 unlit 的頂點範圍重疊');
  if (!(range.unlit[1] < range.outline[0])) fail.push('unlit 與 outline 的頂點範圍重疊');
  const lit = h.groups[0], unlit = h.groups[1];
  if (lit.start + lit.count !== unlit.start) fail.push('lit 與 unlit 在索引裡不相鄰，併不成一次 draw call');
  for (let i = 0; i < h.indexCount; i += 3) {
    const b = col[data.index[i] * 4 + 3] & 31;
    for (let k = 1; k < 3; k++) {
      if ((col[data.index[i + k] * 4 + 3] & 31) !== b) { fail.push('有三角形跨兩根骨頭'); i = h.indexCount; break; }
    }
  }
  const names = h.bones.map((b) => b.name);
  if (names.length > 31) fail.push('骨頭超過 31 根，裝不進顏色 alpha 的五個位元');
  const used = new Set();
  for (let v = 0; v < h.vertexCount; v++) used.add(col[v * 4 + 3] & 31);
  for (const n of ['whisker0', 'whisker5']) {
    if (used.has(names.indexOf(n))) fail.push(`${n} 還在`);
  }
  console.log(`  ${ear.padEnd(6)} 頂點 ${h.vertexCount}　三角形 ${h.indexCount / 3}　骨頭 ${names.length}`
    + `　高 ${data.model.restHeight.toFixed(3)}　中心 z ${data.model.centerZ.toFixed(3)}`);
  return fail;
}

/* ── 跑 ────────────────────────────────────────────────────────── */

mkdirSync(OUT, { recursive: true });
/* ψ 是從鏡頭量起的角度，兩端各是一個側面、中間是正面，所以整個轉身就是
   這 180 度。預覽頁把它整條開成滑桿，這裡就照著同一條線取樣，不然驗過的
   只有兩個端點，而會出事的是中間——正面時 X 方向的範圍整個轉成深度。 */
const cases = [
  ['run', { yaw: Math.PI / 2, speed: 1, steps: 143 }],
  ['+90', { yaw: Math.PI / 2, speed: 0, steps: 120 }],
  ['+45', { yaw: Math.PI / 4, speed: 0, steps: 120 }],
  ['0', { yaw: 0, speed: 0, steps: 120 }],
  ['-45', { yaw: -Math.PI / 4, speed: 0, steps: 120 }],
  ['-90', { yaw: -Math.PI / 2, speed: 0, steps: 120 }],
];
/* 毛色是「換一塊頂點色」而已，幾何完全一樣，所以另外出一張並排圖就夠——
   角度那一排維持只畫第一種，不然圖會寬到看不動。 */
const coatCases = [
  { yaw: Math.PI / 2, speed: 0, steps: 120 },
  { yaw: 0, speed: 0, steps: 120 },
];

console.log('狗：');
let fails = [];
for (const ear of DOG_EARS) {
  const dog = dogOf(ear);
  fails = fails.concat(checks(dog, ear).map((f) => `${ear}: ${f}`));
  const frames = cases.map(([, o]) => frame(dog, o));
  writePNG(join(OUT, `${ear}.png`), tile(frames, W, H), W * frames.length, H);

  const coats = [];
  for (const skin of DOG_SKINS) for (const o of coatCases) coats.push(frame(dog, { ...o, skin }));
  writePNG(join(OUT, `${ear}-coats.png`), tile(coats, W, H), W * coats.length, H);
}
console.log('圖：' + OUT);
console.log('  <耳>.png        左起：跑，然後 ψ = +90° +45° 0° −45° −90°');
console.log('  <耳>-coats.png  每種毛色各一組（側面、正面）：' + DOG_SKINS.join('、'));
if (fails.length) { for (const f of fails) console.log('✗ ' + f); process.exit(1); }
console.log('✓ 結構檢查通過');
