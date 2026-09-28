/* ── test/src/blade.js ────────────────────────────────────────
   主角咬著的那把刀。

   橫咬在嘴裡：刀柄從左頰（模型的 +X）伸出去，刀身從右頰（−X）伸出去，
   刃朝前（+Z）、刀背朝後，刀面是水平的。所以頭怎麼轉，刀就怎麼揮——
   頭往左甩是橫砍，頭側過去再抬起來是往上撩，整隻轉一圈就是迴旋斬。
   動作在 moves.js，這裡只有刀本身與「刀掛在哪」。

   ── 掛在頭那根骨頭上 ─────────────────────────────────────────────
   動物的骨頭只在著色器裡動（critter.js），three 不知道頭在哪。所以刀是
   Critter 那個 mesh 的子節點，自己的矩陣每幀手動算：頭骨的世界矩陣
   （rig.matrices 那一份，模型單位）× 刀在頭上的位置。mesh 本身的縮放與
   墊高交給 three 照常乘上去。

   ── 嘴在哪：量出來的 ───────────────────────────────────────────
   三種模型的頭不一樣大，狗有吻部、貓沒有。所以嘴的位置不寫死，是在
   靜置姿勢下把頭（連同吻部）的頂點換到頭骨的座標裡，取最前面那一段的
   下緣——換一隻動物，刀自己咬到新的嘴上。

   ── 墨線 ─────────────────────────────────────────────────────────
   跟動物一樣是翻面外殼：每一塊再做一份往外推一點的、只畫背面的墨色
   殼。刀每一塊都是凸的（稜柱、方盒），所以外推不會在角上裂開。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { toon, INK } from './palette.js';
import { Rig } from '../../src/cat/rig.js';

/* 尺寸，模型單位（狗的模型約 4.2 單位高 = 1 公尺，1 單位約 24 公分）。
   刀身 4.9——一公尺出頭。對一隻一公尺高的狗是一把大刀，但攻擊的範圍是
   2.5 個狗高，刀太短的話畫面上那一刀跟亮起來的那一片對不起來。 */
const BLADE_LEN = 4.9;
const BLADE_W = 0.46;          // 刃到刀背
const BLADE_T = 0.07;          // 厚
const TIP = 0.75;              // 刀尖那一段斜切多長
const GUARD = [0.10, 0.50, 0.66];
const GRIP_LEN = 1.15;
const GRIP = [0.22, 0.28];     // 刀柄截面：高、寬
/** 護手離嘴的中心多遠（往 +X，也就是左頰外）。 */
const GUARD_X = 1.45;
/** 墨線殼往外推多少。 */
const INK_OUT = 0.05;

const COL = { steel: 0xd9e2ea, spine: 0x8e9aa6, guard: 0xc79a3a, grip: 0x3b2a22 };

/**
 * 一個凸多邊形（在 XZ 平面上，逆時針）擠成厚 2h 的稜柱。平的法線，
 * 給三階調用。`out` 是往外推多少（墨線殼）。
 */
function prism(poly, h, out = 0) {
  let pts = poly;
  if (out > 0) {
    /* 每一條邊往外平移 out，相鄰兩條的交點就是新的頂點。 */
    const n = poly.length;
    const nrm = poly.map((p, i) => {
      const q = poly[(i + 1) % n];
      const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
      return [-dz / l, dx / l];
    });
    pts = poly.map((p, i) => {
      const a = nrm[(i + n - 1) % n], b = nrm[i];
      const mx = a[0] + b[0], mz = a[1] + b[1];
      const k = out / Math.max(0.2, (mx * a[0] + mz * a[1]));
      return [p[0] + mx * k, p[1] + mz * k];
    });
    h += out;
  }
  const v = [];
  const tri = (a, b, c) => v.push(...a, ...b, ...c);
  const top = pts.map(([x, z]) => [x, h, z]);
  const bot = pts.map(([x, z]) => [x, -h, z]);
  for (let i = 1; i < pts.length - 1; i++) {
    tri(top[0], top[i], top[i + 1]);
    tri(bot[0], bot[i + 1], bot[i]);
  }
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    tri(bot[i], top[j], top[i]);
    tri(bot[i], bot[j], top[j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/** 一塊方盒，中心 c、大小 s，外加它的墨線殼。 */
function box(c, s, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...s), toon(color));
  const ink = new THREE.Mesh(
    new THREE.BoxGeometry(...s.map((x) => x + INK_OUT * 2)),
    new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }),
  );
  m.position.set(...c);
  ink.position.set(...c);
  return [m, ink];
}

/** 整把刀，原點在咬的那一點，刀身往 −X。 */
function buildKnife() {
  const g = new THREE.Group();
  /* 刀身：刃在 +Z、刀背在 −Z，刀尖的斜切從刃往上收到刀背。 */
  const x0 = GUARD_X, x1 = GUARD_X - BLADE_LEN;
  const zb = -BLADE_W * 0.45, ze = BLADE_W * 0.55;
  const poly = [[x0, zb], [x1, zb], [x1 + TIP, ze], [x0, ze]];
  const blade = new THREE.Mesh(prism(poly, BLADE_T / 2), toon(COL.steel));
  const bladeInk = new THREE.Mesh(prism(poly, BLADE_T / 2, INK_OUT),
    new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
  /* 刀背那一條暗一點的稜，讓人看得出哪一邊是刃。 */
  const spine = new THREE.Mesh(prism([[x0, zb], [x1 + 0.02, zb], [x1 + 0.12, zb + 0.09], [x0, zb + 0.09]], BLADE_T / 2 + 0.004),
    toon(COL.spine));
  g.add(blade, bladeInk, spine);
  g.add(...box([GUARD_X + GUARD[0] / 2, 0, 0.02], GUARD, COL.guard));
  g.add(...box([GUARD_X + GUARD[0] + GRIP_LEN / 2, 0, 0.02], [GRIP_LEN, GRIP[0], GRIP[1]], COL.grip));
  g.add(...box([GUARD_X + GUARD[0] + GRIP_LEN + 0.05, 0, 0.02], [0.1, GRIP[0] + 0.06, GRIP[1] + 0.06], COL.guard));
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

/**
 * 嘴在頭骨座標裡的哪裡：靜置姿勢下頭與吻部的頂點，最前面那 0.7 單位裡
 * 最低的那一圈往上一點、往後一點。
 */
function mouthOf(critter) {
  const rig = new Rig(critter.data.header);
  rig.update();
  const M = rig.matrices;
  const head = rig.bone('head');
  const inv = new THREE.Matrix4().fromArray(M, head * 16).invert();
  const keep = new Set([head]);
  for (let i = 0; i < rig.count; i++) if (rig.names[i] === 'muzzle') keep.add(i);
  const pos = critter._posBaked, ids = critter._boneId;
  const bm = new THREE.Matrix4(), v = new THREE.Vector3();
  const pts = [];
  for (let i = 0; i < ids.length; i++) {
    if (!keep.has(ids[i])) continue;
    v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    v.applyMatrix4(bm.fromArray(M, ids[i] * 16)).applyMatrix4(inv);
    pts.push([v.x, v.y, v.z]);
  }
  const zMax = Math.max(...pts.map((p) => p[2]));
  const front = pts.filter((p) => p[2] > zMax - 0.7);
  const yLo = Math.min(...front.map((p) => p[1]));
  const yHi = Math.max(...front.map((p) => p[1]));
  return new THREE.Vector3(0, yLo + (yHi - yLo) * 0.22, zMax - 0.5);
}

export class Blade {
  constructor() {
    this.node = buildKnife();
    this.node.matrixAutoUpdate = false;
    this._host = null;
    this._local = new THREE.Matrix4();
    this._head = new THREE.Matrix4();
    this._mouth = new Map();
  }

  /** 掛到這一隻身上（換動物的時候跟著換）。 */
  follow(critter) {
    if (this._host === critter) return;
    this._host = critter;
    critter.mesh.add(this.node);
    if (!this._mouth.has(critter.modelId)) this._mouth.set(critter.modelId, mouthOf(critter));
    this._local.makeTranslation(this._mouth.get(critter.modelId));
    this._headBone = critter.rig.bone('head');
  }

  /** 這一幀的頭在哪，刀就在哪。要在 critter.update 之後叫。 */
  update() {
    if (!this._host) return;
    this._head.fromArray(this._host.rig.matrices, this._headBone * 16);
    this.node.matrix.multiplyMatrices(this._head, this._local);
    this.node.matrixWorldNeedsUpdate = true;
  }
}
