// 服裝的離線驗證器與預覽圖。
//
// wear.js 主張一件事：頭是一個矩形，而且三種動物是同一個矩形，所以一件
// 帽子照著那個矩形裁一次，三種動物都戴得上。這支工具的工作就是不要讓那句
// 話只是一句話——它把每一件服裝畫在每一種動物頭上，沿著整個 180 度的轉身
// 取樣，然後量幾件用看的看不出來的事：
//
//   · 每一件的每一塊，在每一種動物身上都還在頭的空間裡該在的地方
//   · 帽身「畫出來的」矩形真的就是頭顱那一個——大小與中心都比，而且
//     比的是 bend 之後的矩形而不是幾何的包圍盒（兩者差了將近一成）
//   · 帽簷沒有壓到眼睛上（被切一半的臉不會被藏起來，會被畫在帽子上），
//     而且比帽身寬一截、跟帽身之間沒有縫
//   · 帽身收得住立在裡面的耳朵
//   · 三個 group 的頂點範圍還是不相交、lit 與 unlit 在索引裡還是相鄰、
//     每個三角形仍然只屬於一根骨頭、骨頭沒有超過顏色 alpha 裝得下的 32 根
//   · 貓臉上那塊「畫上去的鼻子」在重排之後仍然是連續的一段頂點
//     （measureShapes 會自己丟例外，這裡是讓它有機會丟）
//
// 用法：node tools/verify-wear.mjs [輸出資料夾]

import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCat, Rig } from '../public/src/cat/rig.js';
import { Driver, Sway, applyPose } from '../public/src/cat/pose.js';
import { measureShapes } from '../public/src/cat/shape.js';
import { speciesModels, SPECIES } from '../public/src/cat/species.js';
import { WEARS, wearName } from '../public/src/cat/wear.js';
import { makeShader, tones, raster, emitGroup, INK_PX } from './lib/soft-raster.mjs';
import { writePNG, tile } from './lib/png.mjs';

const W = 300, H = 300;
const OUT = process.argv[2] || join(tmpdir(), 'wearpreview');

const buf = readFileSync('public/assets/cat.bin');
const cat = parseCat(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
/* 名冊是遊戲自己的那一支，只是這一次要求它把衣櫃也建進去——所以這裡驗到的
   物種，就是圖鑑頁上會出現的那幾種，不可能對不上。 */
const roster = speciesModels(cat, { wear: WEARS });

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ── 量一隻穿好衣服的動物 ───────────────────────────────────────── */

function dressed(data) {
  const rig = new Rig(data.header);
  const shape = measureShapes(
    data, rig, data.model.parts, data.model.ride, data.model.patch);
  const g = (n) => data.header.groups.find((x) => x.name === n);
  const gUnlit = g('unlit');
  let unlitStart = Infinity;
  for (let i = gUnlit.start; i < gUnlit.start + gUnlit.count; i++) {
    unlitStart = Math.min(unlitStart, data.index[i]);
  }
  const col = data.colors.get(data.header.skins[0]);

  // CatLayer 的 _measureGround：站姿的最低點就是腳踩的那條線。
  rig.reset();
  applyPose(rig, new Driver().pose);
  const M0 = rig.update();
  let groundY = 1e30;
  for (let v = 0; v < data.header.vertexCount; v++) {
    const o = (col[v * 4 + 3] & 31) * 16;
    const y = M0[o + 1] * data.position[v * 3] + M0[o + 5] * data.position[v * 3 + 1]
      + M0[o + 9] * data.position[v * 3 + 2] + M0[o + 13];
    if (y < groundY) groundY = y;
  }

  const inkSink = new Float32Array(rig.count);
  for (const [name, by] of Object.entries(data.model.inkSink || {})) {
    inkSink[rig.bone(name)] = by;
  }

  return {
    data, rig, shape, col, unlitStart, groundY, inkSink,
    lit: g('lit'), unlit: gUnlit, out: g('outline'),
  };
}

/**
 * 每一根骨頭的幾何，量在「頭骨自己的空間」裡。
 *
 * 帽子上的每一個數字都是寫在那個空間裡的，所以檢查也得在那裡做——不然
 * 量到的是世界座標，而頭一低整份數字就跟著跑。休息姿勢下頭骨沒有旋轉，
 * 所以換算就是減掉頭的位置。
 *
 * @param {object} d  `dressed()` 的結果
 * @param {string} group  要量哪一個 group：'lit' 或 'outline'
 */
function boxes(d, group) {
  const { data, rig } = d;
  rig.reset();
  const M = rig.update();
  const HEAD = rig.bone('head');
  const o0 = HEAD * 16;
  const origin = [M[o0 + 12], M[o0 + 13], M[o0 + 14]];
  const grp = data.header.groups.find((x) => x.name === group);
  const out = new Map();
  const seen = new Set();
  for (let i = grp.start; i < grp.start + grp.count; i++) {
    const v = data.index[i];
    if (seen.has(v)) continue;
    seen.add(v);
    const b = d.col[v * 4 + 3] & 31;
    const o = b * 16;
    const x = data.position[v * 3], y = data.position[v * 3 + 1], z = data.position[v * 3 + 2];
    const p = [
      M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12] - origin[0],
      M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13] - origin[1],
      M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14] - origin[2],
    ];
    const name = rig.names[b];
    let a = out.get(name);
    if (!a) { a = { min: [1e30, 1e30, 1e30], max: [-1e30, -1e30, -1e30] }; out.set(name, a); }
    for (let k = 0; k < 3; k++) {
      if (p[k] < a.min[k]) a.min[k] = p[k];
      if (p[k] > a.max[k]) a.max[k] = p[k];
    }
  }
  return out;
}

/* ── 畫一格 ─────────────────────────────────────────────────────── */

/**
 * 一幀。`wear` 是要穿的那一件，其餘每一件的骨頭都縮成零——這就是
 * CatLayer.wear 做的事，在這裡重做一次，因為這支工具不開 GL。
 */
function frame(d, { yaw, wear, speed = 0, steps = 120, skin }) {
  const { data, rig, shape, unlitStart, groundY } = d;
  const col = data.colors.get(skin || data.header.skins[0]);
  const drv = new Driver(), sway = new Sway();
  for (let i = 0; i < steps; i++) {
    const p = drv.step(1 / 60, speed, 0);
    sway.step(1 / 60, drv.time, 0, 0, p);
  }
  rig.reset();
  applyPose(rig, drv.pose);
  for (const [id, boneNames] of Object.entries(data.model.wear)) {
    if (id === wear) continue;
    for (const name of boneNames) {
      const b = rig.bone(name) * 3;
      rig.scale[b] = 0; rig.scale[b + 1] = 0; rig.scale[b + 2] = 0;
    }
  }
  const bones = rig.update();

  const place = { cx: W / 2, fy: H - 26, s: 52 };
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
    byBone: shape.byBone, rides: shape.rides,
    grow: gr, inkOut: io, inkSink: sink,
  });
  const vsFill = mk(0, 0, null), vsInk = mk(grow, inkPx, d.inkSink);

  const tris = [];
  emitGroup(tris, data, col, d.lit, vsFill, false, unlitStart);
  emitGroup(tris, data, col, d.unlit, vsFill, false, unlitStart);
  emitGroup(tris, data, col, d.out, vsInk, true, unlitStart);
  return raster(tris, light, T, W, H, 0.14);
}

/* ── 檢查 ───────────────────────────────────────────────────────── */

/** 一個盒子整個包住另一個？ */
const covers = (outer, inner) => [0, 1, 2].every(
  (k) => outer.min[k] <= inner.min[k] + 1e-6 && outer.max[k] >= inner.max[k] - 1e-6);

function structure(id, d) {
  const h = d.data.header;
  const range = {};
  for (const g of h.groups) {
    let lo = Infinity, hi = -Infinity;
    for (let i = g.start; i < g.start + g.count; i++) {
      lo = Math.min(lo, d.data.index[i]); hi = Math.max(hi, d.data.index[i]);
    }
    range[g.name] = [lo, hi];
  }
  ok(range.lit[1] < range.unlit[0], `${id}: lit 與 unlit 的頂點範圍重疊`);
  ok(range.unlit[1] < range.outline[0], `${id}: unlit 與 outline 的頂點範圍重疊`);
  const lit = h.groups[0], unlit = h.groups[1];
  ok(lit.start + lit.count === unlit.start,
    `${id}: lit 與 unlit 在索引裡不相鄰，併不成一次 draw call`);
  ok(h.bones.length <= 32, `${id}: ${h.bones.length} 根骨頭，顏色 alpha 只裝得下 32`);
  for (let i = 0; i < h.indexCount; i += 3) {
    const b = d.col[d.data.index[i] * 4 + 3] & 31;
    for (let k = 1; k < 3; k++) {
      if ((d.col[d.data.index[i + k] * 4 + 3] & 31) !== b) {
        fails.push(`${id}: 有三角形跨兩根骨頭`);
        i = h.indexCount;
        break;
      }
    }
  }
}

/** 耳朵伸進帽身多深才算「立在裡面」，而不是耳根卡在帽緣。 */
const INTO = 0.4;

/**
 * 服裝與動物的關係，量在頭骨的空間裡。
 *
 * 這幾條就是 wear.js 開頭那幾段話的機器版本，而它們是這份設計會不會在
 * 下一次有人動數字的時候悄悄壞掉的地方。
 */
function fit(id, d) {
  const out = boxes(d, 'outline');
  const ears = ['earL', 'earR'].map((n) => out.get(n)).filter(Boolean);
  const brim = out.get('wear-bucket-brim');
  const crown = out.get('wear-bucket-crown');

  /* ── 帽身就是頭顱本人 ──
     這是整份設計的前提，而且要比對的是「畫出來的」矩形，不是幾何的
     包圍盒：bend 把每個部位彎成矩形，而矩形的大小是 (half + 墨線殼) 乘上
     量出來的 norm，兩者差了將近一成。

     連中心一起比。頭骨是往前傾的（盒心在 z 0.095 不是 0），所以只對大小
     不對中心的帽子，會前面剛好、後面凸出去，凸的量剛好是那個差。 */
  const head = part(d, 'head');
  const body = part(d, 'wear-bucket-crown');
  const FIT = 0.02;
  for (const [k, axis] of [[0, 'x'], [2, 'z']]) {
    ok(Math.abs(body.half[k] - head.half[k]) < FIT,
      `${id}: 帽身的 ${axis} 不是頭顱的寬度`
      + `（${body.half[k].toFixed(3)}，頭 ${head.half[k].toFixed(3)}）`);
  }
  ok(Math.abs(body.center[2] - head.center[2]) < FIT,
    `${id}: 帽身沒有坐在頭顱的中心上`
    + `（z ${body.center[2].toFixed(3)}，頭 ${head.center[2].toFixed(3)}）`);

  /* ── 帽簷 ──
     下緣要在眼睛（頂 1.45）之上：被切一半的臉不會被藏起來，會被抬到
     帽子前面畫出來。而且要比帽身寬一截，不然看不出是一圈簷。 */
  ok(brim.min[1] > 1.45,
    `${id}: 帽簷壓到眼睛上（底 ${brim.min[1].toFixed(2)}，眼睛到 1.45）`);
  ok(brim.max[0] > crown.max[0] + 0.3 && brim.max[2] > crown.max[2] + 0.3,
    `${id}: 帽簷沒有比帽身寬多少，看不出是一圈`);
  ok(brim.max[1] >= crown.min[1], `${id}: 帽簷跟帽身之間有縫`);

  /* ── 耳朵 ──
     真的立在帽身裡的（伸進去超過 INTO）要整根收得進去，不然耳尖會從
     帽頂穿出來。只是耳根卡在帽緣那一點點的——垂耳犬就是——從帽子底下
     鑽出來反而是對的。 */
  for (const e of ears) {
    if (e.max[1] - crown.min[1] < INTO) continue;
    const above = { min: [e.min[0], crown.min[1], e.min[2]], max: e.max };
    ok(covers(crown, above), `${id}: 帽身收不住耳朵`
      + `（耳 ${e.max.map((x) => x.toFixed(2)).join('/')}，`
      + `帽身 ${crown.max.map((x) => x.toFixed(2)).join('/')}）`);
  }
}

/** 一根骨頭「畫出來的」矩形——bend 用的是這個，不是幾何的包圍盒。 */
function part(d, name) {
  const p = d.shape.parts.find((q) => q.name === name);
  if (!p) throw new Error(`verify-wear: 沒有 "${name}" 這個部位`);
  return p;
}

/* ── 跑 ────────────────────────────────────────────────────────── */

mkdirSync(OUT, { recursive: true });

const yaws = [Math.PI / 2, Math.PI / 4, 0, -Math.PI / 2];

console.log('服裝：' + WEARS.map(wearName).join('、'));
for (const { id, data } of roster) {
  const d = dressed(data);
  structure(id, d);
  fit(id, d);

  /* 一張圖一種動物：一列一件服裝（最上面那一列沒穿），一行一個角度。 */
  const rows = [null, ...WEARS];
  const frames = [];
  for (const wear of rows) for (const yaw of yaws) frames.push(frame(d, { yaw, wear }));
  writePNG(join(OUT, `${id}.png`), tile(frames, W, H), W * frames.length, H);

  console.log(`  ${id.padEnd(10)} 頂點 ${data.header.vertexCount}`
    + `　三角形 ${data.header.indexCount / 3}　骨頭 ${data.header.bones.length}`);
}

/* 一張並排圖：每種動物穿每一件，全部側面，一眼看完「同一尺寸大量重用」
   到底成不成立。 */
const shelf = [];
for (const { data } of roster) {
  const d = dressed(data);
  for (const wear of WEARS) shelf.push(frame(d, { yaw: Math.PI / 2, wear }));
}
writePNG(join(OUT, 'shelf.png'), tile(shelf, W, H), W * shelf.length, H);

console.log('圖：' + OUT);
console.log('  <物種>.png  一列一件（沒穿、' + WEARS.join('、') + '），'
  + '一行一個角度：+90° +45° 0° −90°');
console.log('  shelf.png   ' + SPECIES.map((s) => s.id).join('、') + ' × ' + WEARS.join('、'));
if (fails.length) { for (const f of fails) console.log('✗ ' + f); process.exit(1); }
console.log('✓ 檢查通過');
