/* ── test/src/fx.js ───────────────────────────────────────────
   戰鬥的小外觀：連段的提示圈、破防的兩圈、怪物技能（BOSS、騎士）的預告、靈魂。
   主角三段攻擊的範圍是劍氣，在 qi.js（形狀在 trail.js）；BOSS 的火球在 fireball.js。

   BOSS 預告的形狀直接照 skills.js 的判定畫，所以畫面上那一片就是會被打到的
   地方，不是「看起來差不多」的另一個形狀。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';

const SEG = 32;

/** 一片扇形的三角扇：從圓心 o 出發，沿 at(θ) 那條弧，θ 從 a0 到 a1。 */
function fan(o, at, a0, a1) {
  const v = [...o];
  for (let i = 0; i <= SEG; i++) v.push(...at(a0 + ((a1 - a0) * i) / SEG));
  const idx = [];
  for (let i = 1; i <= SEG; i++) idx.push(0, i, i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  return g;
}

/** 半透明的一片，掛在一個 Group 上（擺位置、轉 yaw 用）。 */
function glowMesh(geometry, color) {
  const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0, side: THREE.DoubleSide,
    depthWrite: false, fog: false,
  }));
  m.renderOrder = 3;
  const node = new THREE.Group();
  node.add(m);
  node.visible = false;
  return { node, mat: m.material };
}

/**
 * 提示圈：腳下一圈細環，亮著的時候按跳會接下一段（第一段收招後的視窗、
 * 第二段之後的空中）。這不是招式的一部分，是試打場給人抓節奏用的。
 */
export function cueFx() {
  const g = new THREE.RingGeometry(0.42, 0.52, 40);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.03, 0);
  return glowMesh(g, 0x7fe0ff);
}

/**
 * 破防的兩圈：一圈淡色的圓（窗口開著就一直在）與一圈亮圓（從淡圓的大小縮到
 * 消失，縮完就是窗口關了）。套在怪物身上、永遠正對鏡頭，所以不管牠在地上還是
 * 被挑在空中、鏡頭從哪個方向看，都是一個正圓。不吃深度：怪物的身體擋不住它。
 */
export const BREAK_R = 0.9;
export function breakFx() {
  const ring = (r0, r1, color, opacity) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 48), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide,
      depthTest: false, depthWrite: false, fog: false,
    }));
    m.renderOrder = 4;
    return m;
  };
  const node = new THREE.Group();
  const bright = ring(BREAK_R - 0.07, BREAK_R + 0.03, 0xf2c14e, 1);
  node.add(ring(BREAK_R - 0.03, BREAK_R + 0.03, 0xfff4dc, 0.35), bright);
  node.visible = false;
  return { node, bright };
}

/**
 * 擺破防的兩圈。`frac` 是窗口還剩幾成（1 → 0），0 以下就收起來。
 * `quat` 是鏡頭的朝向，讓那兩圈正對鏡頭。
 */
export function showBreak(f, frac, x, y, z, quat) {
  if (frac <= 0) { f.node.visible = false; return; }
  f.node.visible = true;
  f.node.position.set(x, y, z);
  f.node.quaternion.copy(quat);
  f.bright.scale.setScalar(frac);
}

/* ── BOSS 技能的預告 ──────────────────────────────────────────────
   一律「淺色的範圍 + 亮色往外長」：淺色是會被打到的整塊地方，亮色長滿的那一刻
   就是打下來的那一刻。貼在地上（y = 0.03），不吃霧，比攻擊範圍的高亮晚畫。 */
const DANGER = 0xff4a3d;
const decal = (geometry, opacity) => {
  const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: DANGER, transparent: true, opacity, side: THREE.DoubleSide,
    depthWrite: false, fog: false,
  }));
  m.renderOrder = 2;
  return m;
};

/** 球的預告：一條從 BOSS 往目標延伸到黑牆的帶子，寬就是球的直徑。 */
export function laneFx(radius) {
  const g = new THREE.PlaneGeometry(radius * 2, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.03, 0.5);              // 從原點往 +Z 長 1，縮放 z 就是長度
  const node = new THREE.Group();
  const pale = decal(g, 0.2), bright = decal(g, 0.45);
  node.add(pale, bright);
  node.visible = false;
  return { node, pale, bright };
}

/** 擺球的預告。frac 是倒數走了幾成（0 → 1），len 是帶子多長，y 是貼在哪一層地板上。 */
export function showLane(f, on, frac, x, z, yaw, len, y = 0) {
  f.node.visible = on;
  if (!on) return;
  f.node.position.set(x, y, z);
  f.node.rotation.y = yaw;
  f.pale.scale.z = len;
  f.bright.scale.z = Math.max(1e-3, len * frac);
}

/** 跳砸的預告：目標點上一片淺色的圓（整個範圍）與一片從中心長到邊的亮色圓。 */
export function circleFx(radius) {
  const g = new THREE.CircleGeometry(radius, 48);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.03, 0);
  const node = new THREE.Group();
  const pale = decal(g, 0.2), bright = decal(g, 0.45);
  node.add(pale, bright);
  node.visible = false;
  return { node, pale, bright };
}

/** 擺跳砸的預告。frac 是倒數走了幾成（0 → 1），y 是貼在哪一層地板上。 */
export function showCircle(f, on, frac, x, z, y = 0) {
  f.node.visible = on;
  if (!on) return;
  f.node.position.set(x, y, z);
  f.bright.scale.setScalar(Math.max(1e-3, frac));
}

/** 扇形的預告：淺色的整片 60° 扇形與一片從圓心往外長的亮色扇形，貼在地上。 */
export function coneFx(radius, half) {
  const at = (a) => [Math.sin(a) * radius, 0.03, Math.cos(a) * radius];
  const g = () => fan([0, 0.03, 0], at, -half, half);
  const node = new THREE.Group();
  const pale = decal(g(), 0.2), bright = decal(g(), 0.45);
  node.add(pale, bright);
  node.visible = false;
  return { node, pale, bright };
}

/** 擺扇形的預告。frac 是倒數走了幾成（0 → 1），亮色的半徑就是那幾成；y 是貼在哪一層地板上。 */
export function showCone(f, on, frac, x, z, yaw, y = 0) {
  f.node.visible = on;
  if (!on) return;
  f.node.position.set(x, y, z);
  f.node.rotation.y = yaw;
  const k = Math.max(1e-3, frac);
  f.bright.scale.set(k, 1, k);
}

/**
 * 長條的預告：一條寬 2r 的帶子，round 的話兩頭再各接一個半圓（膠囊，劍迴旋衝刺走過的
 * 那一條）。淺色的整條，亮色從正中間長到整條。長度每一招不一樣（showStrip 給），
 * 所以帶子是一片縮放 z 的長方形、兩頭的半圓另外擺——整片縮放的話半圓會被拉扁。
 */
export function stripFx(r, round) {
  const body = new THREE.PlaneGeometry(r * 2, 1);
  body.rotateX(-Math.PI / 2);
  body.translate(0, 0.03, 0);
  const cap = round ? fan([0, 0.03, 0], (a) => [Math.sin(a) * r, 0.03, Math.cos(a) * r], -Math.PI / 2, Math.PI / 2) : null;
  const layer = (opacity) => {
    const g = new THREE.Group();
    const mid = decal(body, opacity);
    const caps = round ? [decal(cap, opacity), decal(cap, opacity)] : [];
    if (round) caps[1].rotation.y = Math.PI;
    g.add(mid, ...caps);
    return { g, mid, caps };
  };
  const node = new THREE.Group();
  const pale = layer(0.2), bright = layer(0.45);
  node.add(pale.g, bright.g);
  node.visible = false;
  return { node, pale, bright };
}

/**
 * 擺長條的預告：從 (x, z) 往 yaw 那個方向長 len（兩頭的半圓不算在內）。frac 是倒數走了
 * 幾成（0 → 1），y 是貼在哪一層地板上。
 */
export function showStrip(f, on, frac, x, z, yaw, len, y = 0) {
  f.node.visible = on;
  if (!on) return;
  f.node.position.set(x, y, z);
  f.node.rotation.y = yaw;
  for (const [L, k] of [[f.pale, 1], [f.bright, Math.max(1e-3, frac)]]) {
    L.g.position.z = len / 2;
    L.g.scale.setScalar(k);
    L.mid.scale.z = Math.max(1e-3, len);
    if (L.caps.length) { L.caps[0].position.z = len / 2; L.caps[1].position.z = -len / 2; }
  }
}

/**
 * 一顆靈魂（BOSS 死掉掉出來的）的外觀：半透明的白球，裡面一顆比較實的芯、外面
 * 一層淡淡的光暈。不吃霧、不寫深度。
 */
export function soulMesh(radius) {
  const ball = (r, opacity) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity, depthWrite: false, fog: false,
    }));
    m.renderOrder = 3;
    return m;
  };
  const node = new THREE.Group();
  node.add(ball(radius * 0.6, 0.7), ball(radius, 0.35), ball(radius * 1.5, 0.12));
  node.visible = false;
  return node;
}

/**
 * 亮起、淡掉。`t` 是它開始了多久，`life` 是它亮多久。過了 life 就收起來。
 */
export function showFx(f, t, life, x, y, z, yaw) {
  if (t >= life) { f.node.visible = false; return; }
  f.node.visible = true;
  f.node.position.set(x, y, z);
  f.node.rotation.y = yaw;
  f.mat.opacity = 0.55 * (1 - t / life);
}
