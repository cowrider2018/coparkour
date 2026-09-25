/* ── combat-area/src/fx.js ───────────────────────────────────────────
   攻擊範圍的高亮。還沒有動畫，出招就是把那一段的範圍畫成一片半透明的
   亮色，亮 SWING 秒、邊亮邊淡。

   形狀直接照 combat.js 的判定畫：半徑是 REACH，角度是那一段的角度，
   高度是判定的那個高度。所以畫面上亮起來的那一片就是打得到的地方，
   不是「看起來差不多」的另一個形狀。

   每一片的原點在玩家的腳下、+Z 是正前方——掛在一個 Group 上，擺位置與
   轉 yaw 就是 main.js 每幀做的那兩件事（Object3D 的 rotation.y = yaw
   剛好把 +Z 轉到 (sin yaw, 0, cos yaw)，也就是 aim 的方向）。
   ------------------------------------------------------------------ */

import * as THREE from '../../test-area/vendor/three.module.js';
import { PHYS } from '../../test-area/src/walk.js';
import { REACH, SLASH_HALF } from './combat.js';

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

/** 第一段：面向的 120° 水平扇形，在身高的中間。 */
export function slashFx() {
  const y = PHYS.height / 2;
  return glowMesh(fan([0, y, 0], (a) => [Math.sin(a) * REACH, y, Math.cos(a) * REACH], -SLASH_HALF, SLASH_HALF), 0xf2c14e);
}

/**
 * 亮起、淡掉。`t` 是這一段開始了多久，`life` 是它亮多久。
 * 過了 life 就收起來。
 */
export function showFx(f, t, life, x, y, z, yaw) {
  if (t >= life) { f.node.visible = false; return; }
  f.node.visible = true;
  f.node.position.set(x, y, z);
  f.node.rotation.y = yaw;
  f.mat.opacity = 0.55 * (1 - t / life);
}
