// CatLayer 的無頭驗證器：一層畫多種動物這件事有沒有接對。
//
// 這台機器沒有 GPU，也沒有 headless WebGL，但 CatLayer 需要驗的東西幾乎
// 都不在 GPU 上——它們在「呼叫了什麼、照什麼順序呼叫、每支 program 有沒有
// 拿到自己那份 uniform」。所以這裡給它一個會記帳的假 gl，跑真的 begin/cat/
// end，再檢查帳。
//
// 驗的是這幾件事：
//
//   · 一層可以同時握住貓和兩種狗，各自編出自己的 program
//   · look 字串（"model/skin"）解析成對的模型與毛色，錯的名字會退回而不是丟例外
//   · 一幀裡混著三種動物時，program 換的次數等於模型數，不是角色數
//   · 每支 program 都拿到自己的 uniform（換 program 之後沒有沿用上一支的）
//   · 同一個角色換了動物，它的通道緩衝會跟著換一副骨架重建
//   · 深度切片仍然照「呼叫順序」而不是排序後的順序
//
// 用法：node tools/verify-layer.mjs

import { readFileSync } from 'node:fs';
import { parseCat } from '../public/src/cat/rig.js';
import { CatLayer, CAT_SKINS } from '../public/src/cat/cat.js';
import { buildDog, DOG_EARS, DOG_SKINS } from '../public/src/cat/dog.js';

/* ── 會記帳的假 gl ─────────────────────────────────────────────── */

function fakeGL() {
  let nextId = 1;
  const obj = (kind) => ({ kind, id: nextId++ });
  const log = [];
  const uniforms = new Map();   // program → Set<uniform 名>
  let current = null;

  const gl = {
    log,
    uniforms,
    // 常數：只要是唯一值就好，程式碼只拿它們當旗標傳
    ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2, STATIC_DRAW: 3,
    FLOAT: 4, SHORT: 5, UNSIGNED_BYTE: 6, UNSIGNED_SHORT: 7, UNSIGNED_INT: 8,
    TRIANGLES: 9, DEPTH_TEST: 10, CULL_FACE: 11, BLEND: 12, LESS: 13,
    BACK: 14, FRONT: 15, COLOR_BUFFER_BIT: 16, DEPTH_BUFFER_BIT: 32,
    VERTEX_SHADER: 17, FRAGMENT_SHADER: 18, COMPILE_STATUS: 19, LINK_STATUS: 20,

    createShader: () => obj('shader'),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => obj('program'),
    attachShader: () => {},
    linkProgram: () => {},
    deleteShader: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    useProgram: (p) => { current = p; log.push(['useProgram', p && p.id]); },
    getUniformLocation: (p, name) => ({ kind: 'uniform', prog: p.id, name }),

    createBuffer: () => obj('buffer'),
    bindBuffer: () => {},
    bufferData: () => {},
    createVertexArray: () => obj('vao'),
    bindVertexArray: (v) => log.push(['bindVertexArray', v && v.id]),
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    deleteBuffer: () => {}, deleteVertexArray: () => {}, deleteProgram: () => {},

    viewport: () => {}, clearColor: () => {}, clearDepth: () => {}, clear: () => {},
    depthMask: () => {}, depthFunc: () => {}, depthRange: () => {},
    enable: () => {}, disable: () => {}, cullFace: () => {},
    isContextLost: () => false,
    drawElements: (mode, count) => log.push(['drawElements', current && current.id, count]),
  };
  // uniform*：全部記在「現在這支 program」名下
  const note = (loc) => {
    if (!loc) return;
    if (!uniforms.has(current && current.id)) uniforms.set(current && current.id, new Set());
    uniforms.get(current && current.id).add(loc.name);
    if (loc.prog !== (current && current.id)) {
      log.push(['WRONG_PROGRAM', loc.name, loc.prog, current && current.id]);
    }
  };
  for (const n of ['uniform1f', 'uniform1i', 'uniform2f', 'uniform3f', 'uniform4f',
    'uniform1fv', 'uniform1iv', 'uniform2fv', 'uniform3fv', 'uniform4fv']) {
    gl[n] = (loc) => note(loc);
  }
  gl.uniformMatrix4fv = (loc) => note(loc);
  return gl;
}

function fakeCanvas(gl) {
  return {
    width: 800, height: 400,
    getContext: () => gl,
    addEventListener: () => {},
  };
}

/* ── 起一層，裡面三種動物 ───────────────────────────────────────── */

const buf = readFileSync('public/assets/cat.bin');
const cat = parseCat(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const roster = [
  { id: 'cat', data: cat },
  ...DOG_EARS.map((ear) => ({ id: `dog-${ear}`, data: buildDog(cat, { ear }) })),
];

const gl = fakeGL();
const layer = new CatLayer(fakeCanvas(gl), roster, {});

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ── 1. 名冊與 look 解析 ────────────────────────────────────────── */

const looks = layer.looks();
const want = CAT_SKINS.length + DOG_EARS.length * DOG_SKINS.length;
ok(looks.length === want, `looks() 有 ${looks.length} 個，應該是 ${want}`);
ok(looks[0] === `cat/${CAT_SKINS[0]}`, `looks() 第一個是 ${looks[0]}`);
ok(looks.includes(`dog-drop/${DOG_SKINS[0]}`), 'looks() 少了 dog-drop');

const cases = [
  [`dog-prick/${DOG_SKINS[1]}`, 'dog-prick', DOG_SKINS[1]],
  [CAT_SKINS[1], 'cat', CAT_SKINS[1]],                       // 沒有斜線 = 預設模型
  ['dog-drop/nosuchcoat', 'dog-drop', DOG_SKINS[0]],          // 毛色不存在 → 退回第一件
  // 模型不存在 → 退回預設模型，但毛色照要求（貓也有 tabby）
  ['nosuchmodel/tabby', 'cat', CAT_SKINS[1]],
  [undefined, 'cat', CAT_SKINS[0]],                           // 什麼都沒給
];
for (const [look, wantModel, wantSkin] of cases) {
  const r = layer._look(look);
  const gotModel = [...layer._models].find(([, m]) => m === r.m)[0];
  ok(gotModel === wantModel && r.skin === wantSkin,
    `_look(${look}) → ${gotModel}/${r.skin}，應該是 ${wantModel}/${wantSkin}`);
}

/* ── 2. 一幀混著三種動物 ────────────────────────────────────────── */

const sky = { tint: [1, 0.93, 0.82], ambient: [0.16, 0.19, 0.26] };
const draw = (list) => {
  gl.log.length = 0;
  layer.begin({ x: 0, y: 0 }, { w: 800, h: 400 }, sky);
  list.forEach(([id, look], i) => {
    layer.cat(id, 40 + i * 60, 200, 1, 'run', 200, 1 / 60, look, 1, 0);
  });
  layer.end();
};

// 刻意交錯，讓「照模型排序」有事可做
draw([
  ['a', `cat/${CAT_SKINS[0]}`],
  ['b', `dog-prick/${DOG_SKINS[0]}`],
  ['c', `cat/${CAT_SKINS[1]}`],
  ['d', `dog-drop/${DOG_SKINS[2]}`],
  ['e', `dog-prick/${DOG_SKINS[0]}`],
]);

const progSwitches = gl.log.filter((l) => l[0] === 'useProgram').length;
ok(progSwitches === 3, `一幀換了 ${progSwitches} 次 program，三種動物應該只換 3 次`);
ok(!gl.log.some((l) => l[0] === 'WRONG_PROGRAM'),
  'uniform 送到了別支 program 上：' + JSON.stringify(gl.log.find((l) => l[0] === 'WRONG_PROGRAM')));
ok(layer.stats.cats === 5, `畫了 ${layer.stats.cats} 隻，應該是 5`);

// 每支 program 都要拿到那批「每幀一次」的 uniform，不能沿用上一支的
const MUST = ['uXform', 'uGroundY', 'uUnlitStart', 'uBonePart[0]', 'uPart[0]',
  'uInkSink[0]', 'uKeyLit', 'uBandEdge', 'uPlace', 'uYaw', 'uPitch', 'uBones[0]'];
for (const [progId, sent] of gl.uniforms) {
  if (progId == null) continue;
  const missing = MUST.filter((u) => !sent.has(u));
  ok(missing.length === 0, `program ${progId} 少送了 ${missing.join(', ')}`);
}

// 兩隻同模型同毛色的（b 和 e）應該共用一次 VAO bind
const vaoBinds = gl.log.filter((l) => l[0] === 'bindVertexArray' && l[1] != null).length;
ok(vaoBinds === 4, `VAO 綁了 ${vaoBinds} 次，四種「模型×毛色」應該是 4 次`);

/* ── 3. 同一個角色換動物 ────────────────────────────────────────── */

draw([['x', `cat/${CAT_SKINS[0]}`]]);
const asCat = layer._cats.get('x');
draw([['x', `dog-drop/${DOG_SKINS[0]}`]]);
const asDog = layer._cats.get('x');
ok(asCat && asDog, '角色狀態不見了');
ok(asCat !== asDog, '換了動物但角色狀態沒有重建');
ok(asDog.chan.length !== asCat.chan.length || asDog.bones.length !== asCat.bones.length
   || asDog.m !== asCat.m, '重建後仍然指著同一個模型');

/* ── 4. 深度切片照呼叫順序，不照排序後的順序 ─────────────────────── */

layer.begin({ x: 0, y: 0 }, { w: 800, h: 400 }, sky);
layer.cat('p', 40, 200, 1, 'run', 200, 1 / 60, `dog-drop/${DOG_SKINS[0]}`, 1, 0);
layer.cat('q', 100, 200, 1, 'run', 200, 1 / 60, `cat/${CAT_SKINS[0]}`, 1, 0);
const [first, second] = layer._queue;
ok(first.c === layer._cats.get('p') || second.c === layer._cats.get('p'), '佇列裡少了一隻');
layer.end();
// end() 會排序，但切片是在排序「之前」指派的：先叫的在後面（遠）
const pq = layer._queue.find((i) => i.c === layer._cats.get('p'));
const qq = layer._queue.find((i) => i.c === layer._cats.get('q'));
ok(pq.near > qq.near, '先呼叫的那隻沒有被放到比較遠的深度切片');

/* ── 5. 只給一份資產時，行為跟以前一樣 ──────────────────────────── */

const solo = new CatLayer(fakeCanvas(fakeGL()), cat, {});
ok(solo.looks().length === CAT_SKINS.length, '單一資產的 looks() 不對');
ok(solo._look(CAT_SKINS[2]).skin === CAT_SKINS[2], '單一資產的裸毛色名解析不對');

/* ── 報告 ──────────────────────────────────────────────────────── */

console.log(`一層三種動物：${layer._models.size} 個模型、${looks.length} 種 look`);
console.log(`  ${looks.join('  ')}`);
if (fails.length) {
  for (const f of fails) console.log('✗ ' + f);
  process.exit(1);
}
console.log('✓ 全部通過');
