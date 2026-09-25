/* ── combat-area/src/combat.js ───────────────────────────────────────
   試打場的規則：場地、站位、怪物。

   跟 test-area 的 walk.js 一樣是「規則」而不是「畫面」：這裡只算數字，
   套到 three 上是 main.js 的事。分出來是因為它有兩個使用者——這一頁，
   以及 tools/verify-combat-area.mjs。

   ── 場地 ────────────────────────────────────────────────────────
   一塊方形空地，外圈一道黑牆，沒有任何結構。黑牆就是試玩場那一道
   （veil.js 畫、walk.js 的 'bound' 擋），差別只在它圍的是一片空地。

   ── 站位 ────────────────────────────────────────────────────────
   「中線」是穿過場地中心、沿著 z 軸的那一條。玩家站在它的 2/3、面向
   中心（−z），怪物站在 1/3、也面向中心——兩個隔著場地中心對望。

   ── 怪物 ────────────────────────────────────────────────────────
   一直追著玩家跑。身體跟玩家一樣大（同一個 PHYS 的圓柱），碰到玩家
   玩家就死，雙方回到站位。追的速度比玩家走路慢：走得掉、但不能發呆。
   ------------------------------------------------------------------ */

import { PHYS, solveXZ, steer } from '../../test-area/src/walk.js';

/** 狗有多高。攻擊的長度都用它量，所以跟物理的身體是同一個數字。 */
export const DOG_H = PHYS.height;

/** 場地：24 公尺見方，黑牆 8 公尺高封頂。 */
export const ARENA = { id: 'arena', shape: 'rect', x0: -12, x1: 12, z0: -12, z1: 12, lid: 8 };

/** 中線上第 u 個比例的那一點（u = 0 在 z0 那一端）。 */
export const onMidline = (u) => ARENA.z0 + (ARENA.z1 - ARENA.z0) * u;

/** 站位：玩家在中線 2/3、怪物在 1/3，都面向中心。yaw 是 atan2(x, z) 那一種。 */
export const SPAWN = {
  player: { x: (ARENA.x0 + ARENA.x1) / 2, z: onMidline(2 / 3), yaw: Math.PI },
  monster: { x: (ARENA.x0 + ARENA.x1) / 2, z: onMidline(1 / 3), yaw: 0 },
};

/**
 * 碰撞清單：只有黑牆那一筆。欄位跟 test-area 的 geom.js `bound()` 登記的
 * 一樣（`kind: 'bound'` 加上外接盒），所以 solveXZ 與鏡頭的 boomLimit
 * 不必認得這一頁。
 */
export const COLS = [{
  kind: 'bound', ...ARENA,
  min: [ARENA.x0, -2, ARENA.z0], max: [ARENA.x1, 30, ARENA.z1], base: -2,
}];

/** 怪物的腳程。走路是 PHYS.walk（4），所以放開手就會被追上。 */
export const MONSTER = { speed: 3.4 };

/** 一隻站在站位上的怪物。 */
export function makeMonster() {
  const m = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, aimX: 0, aimZ: 1 };
  placeMonster(m);
  return m;
}

/** 怪物回到站位（中線 1/3，面向中心）。 */
export function placeMonster(m) {
  const s = SPAWN.monster;
  m.x = s.x; m.y = 0; m.z = s.z;
  m.vx = m.vy = m.vz = 0;
  m.grounded = true;
  m.aimX = Math.sin(s.yaw); m.aimZ = Math.cos(s.yaw);
}

/**
 * 怪物的一幀：朝玩家追過去，被黑牆擋。
 *
 * 轉向與加速用的是玩家那一支 steer，所以牠的手感跟玩家是同一種東西：
 * 轉向不欠帳，加速量照 PHYS。
 */
export function monsterStep(m, dt, target) {
  const dx = target.x - m.x, dz = target.z - m.z;
  const d = Math.hypot(dx, dz);
  if (d > 1e-6) { m.aimX = dx / d; m.aimZ = dz / d; }
  [m.vx, m.vz] = steer(m.vx, m.vz, m.aimX, m.aimZ, MONSTER.speed, dt);
  [m.x, m.z] = solveXZ(COLS, m.x + m.vx * dt, m.z + m.vz * dt, m.y);
}

/**
 * 兩個身體碰在一起了嗎：水平上兩個圓柱相交，垂直上兩段身高重疊。
 * 身體是 walk.js 的那一個（半徑 PHYS.radius、高 PHYS.height）。
 */
export function touching(a, b) {
  if (Math.hypot(a.x - b.x, a.z - b.z) >= PHYS.radius * 2) return false;
  return a.y < b.y + PHYS.height && b.y < a.y + PHYS.height;
}
