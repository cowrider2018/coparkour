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
     第二段  第一段收招後 0.25～0.75 秒內按跳：跳起來，同時打一片直立的
             90° 扇形。圓心在玩家腳下，下緣是「腳下 → 上一次第一段扇形正中
             那條半徑的末端」那一條線，往上掃 90° 越過頭頂。方向跟著那個
             末端點走，不是跟著玩家現在的面向。
     第三段  第二段收招之後、落地之前再按跳：把垂直速度換成一次新的起跳
             （二段跳），一直到落地都是無敵的；落地那一下打一圈 360°，
             高度在身高中間。
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
 * 擊退的基準：水平（遠離玩家）與垂直的初速，公尺每秒。第二段就是這一份；
 * 7.0 在重力 22 底下飛 0.64 秒、最高 1.1 公尺，水平帶走 1.3 公尺。
 */
export const KNOCK = { h: 2.0, v: 7.0 };

/**
 * 每一段給基準的幾倍（h 水平、v 垂直）。
 *
 *   第一段  水平 0.7、垂直 0.5：1.4 m/s、3.5 m/s，飛 0.32 秒、只離地 0.28——
 *           挑一下，不是打飛。
 *   第二段  1 倍。
 *   第三段  水平 0.5、垂直 2：1 m/s、14 m/s，飛 1.27 秒、最高 4.5 公尺——
 *           幾乎是往正上方砸上去。
 */
export const KNOCK_SCALE = {
  slash: { h: 0.7, v: 0.5 },
  rise: { h: 1, v: 1 },
  slam: { h: 0.5, v: 2 },
};

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
 * 呼叫端給的是玩家面向的方向。`scale` 是這一段的倍率（KNOCK_SCALE）。
 */
export function knock(m, fromX, fromZ, awayX, awayZ, scale = KNOCK_SCALE.rise) {
  let dx = m.x - fromX, dz = m.z - fromZ;
  const d = Math.hypot(dx, dz);
  if (d > 1e-6) { dx /= d; dz /= d; } else { dx = awayX; dz = awayZ; }
  m.vx = dx * KNOCK.h * scale.h;
  m.vz = dz * KNOCK.h * scale.h;
  m.vy = KNOCK.v * scale.v;
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
 * 第二段那片直立扇形：半徑 REACH，從下緣往上掃 sweep。沒有厚度——判定就是
 * 那一片平面。下緣在哪由 fanFrame 算。
 */
export const FAN = { r: REACH, sweep: Math.PI / 2 };

/**
 * 第一段扇形正中那條半徑的末端：面向的方向上 REACH 遠、身高中間那麼高。
 * 第一段出手的那一刻記下來（世界座標），第二段的扇形就指著它。
 */
export function slashTip(p) {
  return { x: p.x + p.aimX * REACH, y: p.y + PHYS.height / 2, z: p.z + p.aimZ * REACH };
}

/**
 * 第二段的扇形這一幀擺在哪裡。
 *
 * 下緣是「玩家現在的腳下 → tip（上一次第一段的末端點）」那一條線，所以
 * 扇形立在包含這條線的那個鉛直面上：水平方向 (dirX, dirZ) 是腳下指向 tip，
 * a0 是那條線的仰角，往上 sweep 到 a1。玩家跳起來、腳高過那一點之後 a0
 * 是負的——下緣往前下方指著那一點。
 *
 * 長度不是那條線的長度，一律是 REACH。
 *
 * tip 正好在腳的正上下方（水平上沒有方向可言）的時候，用玩家的面向。
 *
 * @returns {{dirX:number, dirZ:number, a0:number, a1:number}}
 */
export function fanFrame(p, tip) {
  const hx = tip.x - p.x, hz = tip.z - p.z;
  const hd = Math.hypot(hx, hz);
  const [dirX, dirZ] = hd > 1e-6 ? [hx / hd, hz / hd] : [p.aimX, p.aimZ];
  const a0 = Math.atan2(tip.y - p.y, Math.max(hd, 1e-6));
  return { dirX, dirZ, a0, a1: a0 + FAN.sweep };
}

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

/** 鉛直面上的一點（前 f、上 u，從腳下量）在不在 [a0, a1] 那片扇形裡。 */
function inFanAt(f, u, a0, a1) {
  const rho = Math.hypot(f, u);
  if (rho > FAN.r) return false;
  if (rho < 1e-9) return true;
  const th = Math.atan2(u, f);
  return th >= a0 && th <= a1;
}

/**
 * 第二段：圓心在腳下、立在指向 tip 的那個鉛直面上的 90° 扇形（見 fanFrame）。
 *
 * 扇形是一片沒有厚度的平面，打不打得到是「這片平面切不切得到怪物的身體」：
 * 怪物的中心要在那個面左右一個身體半徑（0.3 公尺）以內，再偏就整隻在面的
 * 一側、掃不到。
 *
 * 怪物那根圓柱被這個鉛直面切出一個長方形（寬 2√(r² − s²)，s 是牠偏離
 * 那個面多遠；高一個身高）。長方形與扇形重疊就算中：長方形上取一片格點
 * 看有沒有落在扇形裡，再沿扇形的兩條直邊看有沒有穿過長方形——後者是給
 * 「扇形的邊從格點之間切過去」那種擦邊用的。
 */
export function inFan(p, m, tip) {
  const { dirX, dirZ, a0, a1 } = fanFrame(p, tip);
  const r = PHYS.radius;
  const dx = m.x - p.x, dz = m.z - p.z;
  const s = dz * dirX - dx * dirZ;                   // 偏離鉛直面多遠
  if (Math.abs(s) >= r) return false;
  const f = dx * dirX + dz * dirZ;                   // 在面上往前多遠
  const w = Math.sqrt(r * r - s * s);
  const f0 = f - w, f1 = f + w;
  const u0 = m.y - p.y, u1 = u0 + PHYS.height;
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 6; j++) {
      if (inFanAt(f0 + ((f1 - f0) * i) / 4, u0 + ((u1 - u0) * j) / 6, a0, a1)) return true;
    }
  }
  for (const a of [a0, a1]) {
    for (let k = 0; k <= 32; k++) {
      const q = (FAN.r * k) / 32;
      const qf = Math.cos(a) * q, qu = Math.sin(a) * q;
      if (qf >= f0 && qf <= f1 && qu >= u0 && qu <= u1) return true;
    }
  }
  return false;
}

/** 第三段：落地那一下，以玩家為中心的 360°，高度在身高中間，長 REACH。 */
export function inRing(p, m) {
  return atWaist(p, m) && Math.hypot(m.x - p.x, m.z - p.z) <= REACH + PHYS.radius;
}

/* ── 連段 ────────────────────────────────────────────────────────
   一個小狀態機，只管「現在在哪一段、這一段開始多久了」。打不打得到由
   上面那幾支範圍判斷，擊退由 knock——這裡不碰任何身體。

     idle   沒有招。站在地上、怪物進了第一段的範圍 → 出第一段。
            按跳就是普通的跳。
     slash  第一段，亮 SWING 秒。
     rest   第一段收招之後的那段時間。在 WINDOW 裡按跳 → 第二段。
            太早按是普通的跳，連段就斷了（回 idle）。時間到了沒按也回
            idle，第一段才能再自動出手——rest 同時是第一段的冷卻，不然
            怪物被挑起來的那一瞬間還在扇形裡，第一段會一幀接一幀地連發。
     rise   第二段：起跳的同時出手，亮 SWING 秒。這段時間按跳不算。
     air    第二段收招之後、落地之前。按跳 → 第三段。落地了就回 idle。
     leap   第三段的二段跳。無敵，一直到落地。
     slam   第三段落地那一下，亮 SWING 秒，之後回 idle。
   ------------------------------------------------------------------ */

/** 第一段收招之後，第二段的按鍵視窗（秒，從收招那一刻量）。 */
export const WINDOW = [0.25, 0.75];

/** 第一段收招之後多久才能再出第一段（秒）——就是視窗關上的那一刻。 */
export const REST = WINDOW[1];

/**
 * `hit`：這一段已經打中過了（每一段對同一隻怪物只算一下）。
 * `tip`：上一次第一段的末端點（slashTip），第二段指著它。出第一段的時候
 * 由呼叫端記下——狀態機不碰身體。
 */
export function makeCombo() {
  return { phase: 'idle', t: 0, hit: false, tip: null };
}

/** 現在是不是無敵：第三段起跳之後、落地之前。 */
export const invulnerable = (c) => c.phase === 'leap';

/** 現在按跳會不會接下一段（給畫面提示用）。 */
export const cueing = (c) => (c.phase === 'rest' && c.t >= WINDOW[0] && c.t <= WINDOW[1]) || c.phase === 'air';

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
 *   jump   玩家這一幀要起跳：垂直速度換成一次新的起跳（普通的跳、第二段、
 *          第三段的二段跳都是這一個）
 *   start  這一幀開始的是第幾段（0 = 沒有）。第三段的 start 在起跳那一幀，
 *          落地那一下是 phase 進了 'slam'。
 */
export function comboStep(c, dt, { pressed, grounded, near }) {
  const out = { jump: false, start: 0 };
  c.t += dt;
  const go = (phase) => { c.phase = phase; c.t = 0; c.hit = false; };
  let used = false;                       // 這一下按跳已經被連段吃掉了
  switch (c.phase) {
    case 'slash':
      if (c.t >= SWING) go('rest');
      break;
    case 'rest':
      if (pressed && grounded && c.t >= WINDOW[0] && c.t <= WINDOW[1]) {
        go('rise'); out.start = 2; out.jump = true; used = true;
      } else if (pressed) go('idle');     // 太早：普通的跳，連段斷了
      else if (c.t >= REST) go('idle');
      break;
    case 'rise':
      if (c.t >= SWING) go(grounded ? 'idle' : 'air');
      used = pressed;
      break;
    case 'air':
      if (grounded) go('idle');
      else if (pressed) { go('leap'); out.start = 3; out.jump = true; used = true; }
      break;
    case 'leap':
      if (grounded) go('slam');
      break;
    case 'slam':
      if (c.t >= SWING) go('idle');
      break;
    default:
      break;
  }
  if (c.phase === 'idle' && grounded && near && !pressed) { go('slash'); out.start = 1; }
  if (pressed && grounded && !used) out.jump = true;
  return out;
}
