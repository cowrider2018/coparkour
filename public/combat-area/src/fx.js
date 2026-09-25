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
import { toon } from '../../test-area/src/palette.js';
import { REACH, FAN, SLASH_HALF } from './combat.js';

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

/**
 * 半透明的一片，外加（給了的話）一圈同色的邊線。邊線是給正對著邊看的時候
 * 用的：一片平面側過來看不見，一條線側過來還是一條線。
 */
function glowMesh(geometry, color, edge = null, tilted = false) {
  const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0, side: THREE.DoubleSide,
    depthWrite: false, fog: false,
  }));
  m.renderOrder = 3;
  /* 要仰俯的那一片多包一層：外層轉 yaw、內層繞自己的 x 軸仰俯，順序才是
     「先抬起來、再轉過去」。 */
  const node = new THREE.Group();
  const body = tilted ? new THREE.Group() : node;
  if (tilted) node.add(body);
  body.add(m);
  const mats = [m.material];
  if (edge) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
    const line = new THREE.LineLoop(g, new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
    line.renderOrder = 3;
    body.add(line);
    mats.push(line.material);
  }
  node.visible = false;
  return { node, mats, tilt: tilted ? body : null };
}

/** 第一段：面向的 120° 水平扇形，在身高的中間。 */
export function slashFx() {
  const y = PHYS.height / 2;
  return glowMesh(fan([0, y, 0], (a) => [Math.sin(a) * REACH, y, Math.cos(a) * REACH], -SLASH_HALF, SLASH_HALF), 0xf2c14e);
}

/**
 * 第二段：圓心在腳下的直立 90° 扇形（見 combat.js 的 FAN 與 fanFrame）。
 *
 * 幾何是下緣水平、往上掃 90° 的那一片；下緣的仰角每幀不同（腳下指向上一次
 * 第一段的末端點），由 showFx 的 pitch 抬起來。
 *
 * 一片沒有厚度的平面，跟判定一樣。那個鉛直面通常就是鏡頭看出去的方向，從
 * 玩家正後方看平面本身看不見，所以多描一圈邊線——側著看它是一條亮線。
 */
export function fanFx() {
  const at = (a) => [0, Math.sin(a) * FAN.r, Math.cos(a) * FAN.r];
  const edge = [0, 0, 0];
  for (let i = 0; i <= SEG; i++) edge.push(...at((FAN.sweep * i) / SEG));
  return glowMesh(fan([0, 0, 0], at, 0, FAN.sweep), 0xff8a3d, edge, true);
}

/** 第三段：落地那一下，以玩家為中心的 360° 圓盤，在身高的中間。 */
export function ringFx() {
  const y = PHYS.height / 2;
  return glowMesh(fan([0, y, 0], (a) => [Math.sin(a) * REACH, y, Math.cos(a) * REACH], 0, Math.PI * 2), 0xff4d4d);
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

/** 擺球的預告。frac 是倒數走了幾成（0 → 1），len 是帶子多長。 */
export function showLane(f, on, frac, x, z, yaw, len) {
  f.node.visible = on;
  if (!on) return;
  f.node.position.set(x, 0, z);
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

/** 擺跳砸的預告。frac 是倒數走了幾成（0 → 1）。 */
export function showCircle(f, on, frac, x, z) {
  f.node.visible = on;
  if (!on) return;
  f.node.position.set(x, 0, z);
  f.bright.scale.setScalar(Math.max(1e-3, frac));
}

/** 一顆球的外觀：跟石頭同一套分階著色（palette.js 的 toon），才看得出是一顆球而不是一片圓。 */
const ORB_MAT = toon(0xff4fd8);
export function orbMesh(radius) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), ORB_MAT);
  m.visible = false;
  return m;
}

/**
 * 亮起、淡掉。`t` 是這一段開始了多久，`life` 是它亮多久。
 * 過了 life 就收起來。`pitch` 只有會仰俯的那一片（第二段）用：下緣的仰角。
 */
export function showFx(f, t, life, x, y, z, yaw, pitch = 0) {
  if (t >= life) { f.node.visible = false; return; }
  f.node.visible = true;
  f.node.position.set(x, y, z);
  f.node.rotation.y = yaw;
  /* 繞 x 軸轉 −pitch 把 +Z 抬到仰角 pitch：Rx(θ)·(0,0,1) = (0, −sin θ, cos θ)。 */
  if (f.tilt) f.tilt.rotation.x = -pitch;
  const k = 1 - t / life;
  f.mats[0].opacity = 0.55 * k;
  for (let i = 1; i < f.mats.length; i++) f.mats[i].opacity = k;
}
