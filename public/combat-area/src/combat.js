/* ── combat-area/src/combat.js ───────────────────────────────────────
   試打場的規則：場地與站位。

   跟 test-area 的 walk.js 一樣是「規則」而不是「畫面」：這裡只算數字，
   套到 three 上是 main.js 的事。分出來是因為它有兩個使用者——這一頁，
   以及 tools/verify-combat-area.mjs。

   ── 場地 ────────────────────────────────────────────────────────
   一塊方形空地，外圈一道黑牆，沒有任何結構。黑牆就是試玩場那一道
   （veil.js 畫、walk.js 的 'bound' 擋），差別只在它圍的是一片空地。

   ── 站位 ────────────────────────────────────────────────────────
   「中線」是穿過場地中心、沿著 z 軸的那一條。玩家站在它的 2/3、面向
   中心（−z）。
   ------------------------------------------------------------------ */

import { PHYS } from '../../test-area/src/walk.js';

/** 狗有多高。攻擊的長度都用它量，所以跟物理的身體是同一個數字。 */
export const DOG_H = PHYS.height;

/** 場地：24 公尺見方，黑牆 8 公尺高封頂。 */
export const ARENA = { id: 'arena', shape: 'rect', x0: -12, x1: 12, z0: -12, z1: 12, lid: 8 };

/** 中線上第 u 個比例的那一點（u = 0 在 z0 那一端）。 */
export const onMidline = (u) => ARENA.z0 + (ARENA.z1 - ARENA.z0) * u;

/** 玩家的站位：中線 2/3，面向中心。yaw 是 atan2(x, z) 那一種。 */
export const SPAWN = {
  player: { x: (ARENA.x0 + ARENA.x1) / 2, z: onMidline(2 / 3), yaw: Math.PI },
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
