/* ── combat-area/src/combat.js ───────────────────────────────────────
   試打場的規則：場地、站位、怪物、攻擊。

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

   在試打場裡怪物打不死，只會被擊退：水平往遠離玩家的方向、垂直往上，
   兩份動能一起給。飛在空中（被擊退、還沒落地）的怪物碰到玩家不算數。
   空中再挨一下就再擊退一次——每一下都是把速度**換成**擊退的那一份，
   不是疊上去，所以連打是一直被挑在空中，而不是越飛越快。

   ── 攻擊 ────────────────────────────────────────────────────────
   長度一律是 2.5 個狗高（REACH），角度各段不同。第一段是自動的：怪物
   走進第一段的範圍、玩家站在地上、手上沒有別的招，就出手。所以「靠近」
   的定義就是「打得到」——在背後的怪物不會讓玩家對著空氣揮一下。

     第一段  面向的 120° 水平扇形，高度在玩家身高的中間。
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

/** 攻擊的長度：2.5 個狗高。每一段都一樣，差的只有角度。 */
export const REACH = 2.5 * DOG_H;

/** 第一段扇形的半角：120° 的一半。 */
export const SLASH_HALF = Math.PI / 3;

/** 一段攻擊亮多久（秒）。判定在這段時間裡有效，每一段對同一隻怪物只算一下。 */
export const SWING = 0.2;

/**
 * 擊退：水平（遠離玩家）與垂直的初速，公尺每秒。
 *
 * 垂直大、水平小，因為後面兩段是往上打的：7.0 在重力 22 底下飛 0.64 秒、
 * 最高 1.1 公尺，水平只帶走 1.3 公尺——怪物還在下一段搆得到的地方。
 */
export const KNOCK = { h: 2.0, v: 7.0 };

/** 一隻站在站位上的怪物。 */
export function makeMonster() {
  const m = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, aimX: 0, aimZ: 1,
    /* 被擊退、還沒落地。這段時間牠不追人，碰到玩家也不算數。 */
    air: false,
    /** 挨了幾下。 */
    hits: 0,
  };
  placeMonster(m);
  return m;
}

/** 怪物回到站位（中線 1/3，面向中心）。 */
export function placeMonster(m) {
  const s = SPAWN.monster;
  m.x = s.x; m.y = 0; m.z = s.z;
  m.vx = m.vy = m.vz = 0;
  m.grounded = true;
  m.air = false;
  m.aimX = Math.sin(s.yaw); m.aimZ = Math.cos(s.yaw);
}

/**
 * 怪物的一幀：被擊退的時候照拋物線飛，落地之後朝玩家追過去。兩種都被
 * 黑牆擋。
 *
 * 追的時候轉向與加速用的是玩家那一支 steer，所以牠的手感跟玩家是同一種
 * 東西：轉向不欠帳，加速量照 PHYS。
 */
export function monsterStep(m, dt, target) {
  if (m.air) {
    m.vy -= PHYS.gravity * dt;
    m.y += m.vy * dt;
    [m.x, m.z] = solveXZ(COLS, m.x + m.vx * dt, m.z + m.vz * dt, m.y);
    if (m.y <= 0 && m.vy <= 0) {
      /* 落地：水平的擊退一起停掉，從靜止重新起步追人。不停的話牠落地
         之後還會往後滑一段，而那段時間碰到牠算不算數說不清楚。 */
      m.y = 0; m.vy = 0; m.vx = 0; m.vz = 0;
      m.air = false;
      m.grounded = true;
    }
    return;
  }
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

/** 怪物碰到玩家會不會咬死他：碰到了，而且怪物不在被擊退的空中。 */
export const bites = (p, m) => !m.air && touching(p, m);

/**
 * 擊退一隻怪物：水平往遠離 (fromX, fromZ) 的方向、垂直往上。速度是
 * 換掉而不是加上去——理由見檔頭。
 *
 * 正好疊在出手點上（沒有「遠離」可言）的時候，往 (awayX, awayZ) 推，
 * 呼叫端給的是玩家面向的方向。
 */
export function knock(m, fromX, fromZ, awayX, awayZ) {
  let dx = m.x - fromX, dz = m.z - fromZ;
  const d = Math.hypot(dx, dz);
  if (d > 1e-6) { dx /= d; dz /= d; } else { dx = awayX; dz = awayZ; }
  m.vx = dx * KNOCK.h;
  m.vz = dz * KNOCK.h;
  m.vy = KNOCK.v;
  m.air = true;
  m.grounded = false;
  m.hits++;
}

/* ── 攻擊範圍 ────────────────────────────────────────────────────
   怪物是一根圓柱（半徑 PHYS.radius、高 PHYS.height），所以「打得到」是
   「範圍與那根圓柱相交」，不是「範圍包住牠的中心」——後者會讓擦到身體
   邊緣的一下落空，而畫面上那一下明明掃過了牠。 */

/** 身高中間那個高度的平面，切不切得到這隻怪物的身體。 */
const atWaist = (p, m) => {
  const y = p.y + PHYS.height / 2;
  return y >= m.y && y <= m.y + PHYS.height;
};

/**
 * 第一段：面向的 120° 水平扇形，高度在玩家身高的中間，長 REACH。
 *
 * @param {object} p 玩家（x, y, z, aimX, aimZ）
 * @param {object} m 怪物
 */
export function inSlash(p, m) {
  if (!atWaist(p, m)) return false;
  const r = PHYS.radius;
  const dx = m.x - p.x, dz = m.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > REACH + r) return false;
  if (d <= r) return true;                         // 疊在一起：哪個方向都掃得到
  const cos = (dx * p.aimX + dz * p.aimZ) / d;
  const off = Math.acos(Math.max(-1, Math.min(1, cos)));
  /* 半角 60°，再加上圓柱在那個距離上張開的角度——扇形的邊擦到身體就算。 */
  return off <= SLASH_HALF + Math.asin(Math.min(1, r / d));
}

/* ── 連段 ────────────────────────────────────────────────────────
   一個小狀態機，只管「現在在哪一段、這一段開始多久了」。打不打得到由
   上面那幾支範圍判斷，擊退由 knock——這裡不碰任何身體。

     idle   沒有招。站在地上、怪物進了第一段的範圍 → 出第一段。
            按跳就是普通的跳。
     slash  第一段，亮 SWING 秒。
     rest   第一段收招之後的那段時間。結束了才回 idle，第一段才能再自動
            出手——不然怪物被挑起來的那一瞬間還在扇形裡，第一段會一幀
            接一幀地連發。
   ------------------------------------------------------------------ */

/** 第一段收招之後多久才能再出第一段（秒）。 */
export const REST = 0.5;

/** `hit`：這一段已經打中過了（每一段對同一隻怪物只算一下）。 */
export function makeCombo() {
  return { phase: 'idle', t: 0, hit: false };
}

/**
 * 連段的一幀。
 *
 * @param {object} c    makeCombo() 的狀態
 * @param {number} dt
 * @param {object} io
 *   pressed   這一幀按了跳
 *   grounded  玩家站在地上
 *   near      怪物在第一段的範圍裡（inSlash）
 * @returns {{jump: boolean, start: number}}
 *   jump   玩家這一幀要起跳（普通的跳）
 *   start  這一幀開始的是第幾段（0 = 沒有）
 */
export function comboStep(c, dt, { pressed, grounded, near }) {
  const out = { jump: false, start: 0 };
  c.t += dt;
  const go = (phase) => { c.phase = phase; c.t = 0; c.hit = false; };
  if (c.phase === 'slash' && c.t >= SWING) go('rest');
  if (c.phase === 'rest' && c.t >= REST) go('idle');
  if (c.phase === 'idle' && grounded && near) { go('slash'); out.start = 1; }
  if (pressed && grounded && !out.start) out.jump = true;
  return out;
}
