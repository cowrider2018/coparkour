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

   每一下都會扣血（各段的傷害見 DAMAGE）。血扣到 0 就死，當場在牠自己的
   重生點重生（血滿、破防歸零），玩家留在原地。被打中還會被擊退：水平往遠離玩家的方向、
   垂直往上，兩份動能一起給。

   ── 破防 ────────────────────────────────────────────────────────
   每一隻怪物各自累積受到的傷害，累積到破防門檻（一律 BREAK_AT = 4）就「破防」：
   開一個 BREAK_WINDOW 秒的窗口，畫面上是一圈淡色的圓與一圈從同樣大小縮到
   消失的亮圓。窗口裡累積不再增加；窗口過了沒用上（錯過），累積歸零重新算。

   窗口開著時按跳，就是破防攻擊（用掉窗口，累積一樣歸零）。在地上、在空中都
   可以——第一段接第二段剛好累積到 4，破防的那一刻玩家正在第二段的空中：

     突進  朝目標的頭頂飛過去（一次給足水平與垂直速度，照拋物線走）。有好幾隻
           破防中的時候，選最近的那一隻。
     迴旋  碰到牠的那一刻，記下玩家相對於牠的位置；牠原地轉一圈，玩家保持那個
           相對位置繞著牠轉 360°。
     跳離  轉完扣 5 點血，玩家往突進的反方向、往上跳下來；同一瞬間怪物被往
           另一邊（突進的方向）推開——只有水平，不往上挑。在地上的怪物是沿著
           地面滑出去、滑到停；在空中被定住的，放開之後帶著這一份水平速度落下。

   從按下去到跳離之後落地，玩家都是無敵的——整招都貼在怪物身上。飛在空中（被擊退、還沒落地）的怪物碰到玩家不算數。
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

/**
 * 怪物的名冊：每一類怪物一筆數值，住在這裡而不是散在各支函式裡——之後多一類
 * 怪物就是多一筆，規則不動。每一隻怪物身上帶的是牠自己的「狀態」（位置、速度、
 * 挨了幾下…），數值一律回頭查這一張，用 `m.kind` 認類別。
 *
 *   hound  綠狗（現在唯一的一類）。血 10。腳程 3.4：走路是 PHYS.walk（4），
 *          所以放開手就會被追上。
 *
 * `breakAt` 是破防門檻。現在每一類都是 BREAK_AT，但它是逐類登記的——哪天某一類
 * 要比較硬，改那一筆就好。
 */
export const BREAK_AT = 4;
export const KINDS = {
  hound: { name: '綠狗', hp: 10, speed: 3.4, breakAt: BREAK_AT },
};

/** 破防之後的窗口多長（秒）：亮圓從淡圓的大小縮到消失的時間。 */
export const BREAK_WINDOW = 0.5;

/** 每一段打中一下扣幾點血。這是招式的數值，不是怪物的，所以不在 KINDS 裡。 */
export const DAMAGE = { slash: 1, rise: 3, slam: 2, break: 5 };

/**
 * 破防攻擊的數值。
 *
 *   flight  突進花多久飛到頭頂（秒）。速度由它反推，所以不管目標多遠都是這麼久。
 *   spin    迴旋一圈多久（秒）。
 *   off     跳離：水平（突進的反方向）與垂直的速度。垂直是一次普通的跳。
 *   push    同一瞬間怪物被推開：水平速度 h（突進的方向），在地上滑行時每秒
 *           減速 decel——5 m/s 滑 0.6 秒、約 1.6 公尺。沒有垂直的份。
 */
export const BREAK_ATK = {
  flight: 0.35, spin: 0.6,
  off: { h: 5, v: PHYS.jump },
  push: { h: 5, decel: 8 },
};

/** 一隻怪物的那一類數值。 */
export const kindOf = (m) => KINDS[m.kind];

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

/**
 * 一隻站在站位上的怪物。`kind` 是 KINDS 的鍵，`spawn` 是牠自己的站位
 * （{x, z, yaw}），回到站位的時候回這裡。
 */
export function makeMonster(kind = 'hound', spawn = SPAWN.monster) {
  const m = {
    kind,
    spawn,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, aimX: 0, aimZ: 1,
    /* 被擊退、還沒落地。這段時間牠不追人，碰到玩家也不算數。 */
    air: false,
    /** 挨了幾下。 */
    hits: 0,
    /** 剩多少血。 */
    hp: 0,
    /** 死過幾次（死了就在重生點重生，見 hurt）。 */
    deaths: 0,
    /** 離破防還累積了多少傷害。 */
    gauge: 0,
    /** 破防窗口還剩幾秒（0 = 沒有破防）。 */
    breakT: 0,
    /** 被破防攻擊定住（迴旋中）：不動、不受重力。 */
    held: false,
    /* 被沿著地面推開、還在滑（破防攻擊的跳離）。這段時間牠不追人，滑到停為止。 */
    slide: false,
  };
  placeMonster(m);
  return m;
}

/** 怪物回到牠自己的站位。 */
export function placeMonster(m) {
  const s = m.spawn;
  m.x = s.x; m.y = 0; m.z = s.z;
  m.vx = m.vy = m.vz = 0;
  m.grounded = true;
  m.air = false;
  m.hp = kindOf(m).hp;
  m.gauge = 0;
  m.breakT = 0;
  m.held = false;
  m.slide = false;
  m.aimX = Math.sin(s.yaw); m.aimZ = Math.cos(s.yaw);
}

/** 這隻怪物現在是不是破防中（窗口還開著）。 */
export const broken = (m) => m.breakT > 0;

/** 破防的累積歸零（窗口用掉或錯過都是這一支）。 */
export function resetBreak(m) {
  m.gauge = 0;
  m.breakT = 0;
}

/**
 * 扣血，並累積破防。扣到 0 就死：記一次，當場回到牠自己的重生點重生——
 * placeMonster 把位置、速度、血、破防、被定住全部重設，所以死前的擊退或迴旋
 * 不會帶到重生之後。玩家不動。
 *
 * 破防窗口開著的時候不累積——門檻已經到了，窗口用掉或錯過之後才從 0 重算。
 *
 * @returns {boolean} 這一下把牠打死了
 */
export function hurt(m, dmg) {
  if (!broken(m)) {
    m.gauge += dmg;
    if (m.gauge >= kindOf(m).breakAt) m.breakT = BREAK_WINDOW;
  }
  m.hp -= dmg;
  if (m.hp > 0) return false;
  m.deaths++;
  placeMonster(m);
  return true;
}

/**
 * 怪物的一幀：被擊退的時候照拋物線飛，落地之後朝玩家追過去。兩種都被
 * 黑牆擋。
 *
 * 追的時候轉向與加速用的是玩家那一支 steer，所以牠的手感跟玩家是同一種
 * 東西：轉向不欠帳，加速量照 PHYS。
 */
export function monsterStep(m, dt, target) {
  // 破防窗口：時間到了還沒用上就是錯過，累積歸零。
  if (broken(m)) {
    m.breakT -= dt;
    if (m.breakT <= 0) resetBreak(m);
  }
  if (m.held) return;                     // 破防攻擊的迴旋：定在原地
  if (m.slide && !m.air) {
    // 沿著地面被推開：照 BREAK_ATK.push.decel 減速，停了才回去追人。
    const sp = Math.hypot(m.vx, m.vz);
    const ns = Math.max(0, sp - BREAK_ATK.push.decel * dt);
    const k = sp > 1e-9 ? ns / sp : 0;
    m.vx *= k; m.vz *= k;
    [m.x, m.z] = solveXZ(COLS, m.x + m.vx * dt, m.z + m.vz * dt, m.y);
    if (ns <= 0) m.slide = false;
    return;
  }
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
  [m.vx, m.vz] = steer(m.vx, m.vz, m.aimX, m.aimZ, kindOf(m).speed, dt);
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
  m.slide = false;
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

   破防攻擊蓋過上面每一個階段：有怪物破防中、按了跳，不管玩家在地上還是
   空中、現在在哪一段，都直接進突進。

     dash   突進。碰到目標 → spin（由 latch 切）；沒碰到就落地 → idle（揮空）。
     spin   迴旋。轉完 → vault（由 spinStep 切）。
     vault  跳離，落地 → idle。
   ------------------------------------------------------------------ */

/** 第一段收招之後，第二段的按鍵視窗（秒，從收招那一刻量）。 */
export const WINDOW = [0.25, 0.75];

/** 第一段收招之後多久才能再出第一段（秒）——就是視窗關上的那一刻。 */
export const REST = WINDOW[1];

/**
 * `hit`：這一段已經打中過的怪物（每一段對同一隻怪物只算一下，不同隻各算各的）。
 * `tip`：上一次第一段的末端點（slashTip），第二段指著它。出第一段的時候
 * 由呼叫端記下——狀態機不碰身體。
 */
export function makeCombo() {
  return { phase: 'idle', t: 0, hit: new Set(), tip: null };
}

/** 破防攻擊的三個階段。 */
const BREAKING = new Set(['dash', 'spin', 'vault']);

/** 玩家現在在破防攻擊裡（突進、迴旋、跳離）：速度與位置由這一招接管。 */
export const breaking = (c) => BREAKING.has(c.phase);

/** 現在是不是無敵：第三段起跳之後、落地之前；破防攻擊從突進到跳離落地。 */
export const invulnerable = (c) => c.phase === 'leap' || breaking(c);

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
 *   near      有怪物在第一段的範圍裡（inSlash）
 *   breakable 有怪物破防中（breakTarget 找得到）
 * @returns {{jump: boolean, start: number, brk: boolean}}
 *   jump   玩家這一幀要起跳：垂直速度換成一次新的起跳（普通的跳、第二段、
 *          第三段的二段跳都是這一個）
 *   start  這一幀開始的是第幾段（0 = 沒有）。第三段的 start 在起跳那一幀，
 *          落地那一下是 phase 進了 'slam'。
 *   brk    這一幀發動破防攻擊（phase 進了 'dash'）。速度與目標由呼叫端接著
 *          叫 startBreak 給。
 */
export function comboStep(c, dt, { pressed, grounded, near, breakable = false }) {
  const out = { jump: false, start: 0, brk: false };
  c.t += dt;
  const go = (phase) => { c.phase = phase; c.t = 0; c.hit = new Set(); };
  let used = false;                       // 這一下按跳已經被連段吃掉了
  if (pressed && breakable && !breaking(c)) {
    go('dash'); out.brk = true;
    return out;
  }
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
    case 'dash':
    case 'vault':
      // 起跳那一幀還算站在地上，所以過了一點時間才認落地。
      if (grounded && c.t > 0.05) go('idle');
      used = pressed;
      break;
    case 'spin':
      used = pressed;
      break;
    default:
      break;
  }
  if (c.phase === 'idle' && grounded && near && !pressed) { go('slash'); out.start = 1; }
  if (pressed && grounded && !used) out.jump = true;
  return out;
}

/* ── 破防攻擊 ────────────────────────────────────────────────────── */

/** 身體的中間，選目標量距離用。 */
const waist = (b) => [b.x, b.y + PHYS.height / 2, b.z];

/**
 * 破防攻擊要打哪一隻：破防中的怪物裡最近的那一隻（量身體中間到身體中間）。
 * 沒有就是 null。
 */
export function breakTarget(p, monsters) {
  const [px, py, pz] = waist(p);
  let best = null, bd = Infinity;
  for (const m of monsters) {
    if (!broken(m)) continue;
    const [mx, my, mz] = waist(m);
    const d = Math.hypot(mx - px, my - py, mz - pz);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

/**
 * 發動破防攻擊：用掉目標的窗口（累積歸零），給玩家一次飛向牠頭頂的速度。
 * 在空中發動也是同一條式子——垂直速度是從玩家現在的高度反推的，原本往上或
 * 往下的速度直接換掉。
 *
 * 速度是照拋物線反推的：BREAK_ATK.flight 秒後腳正好落在頭頂上。頭頂取的是
 * 牠**那時候**會在的地方——照牠現在的速度往前推（被擊退在空中的話連重力一起
 * 算，落地就停在地上）。追過來的怪物是迎著玩家跑的，照現在的位置瞄會飛過頭。
 */
export function startBreak(c, p, m) {
  resetBreak(m);
  const T = BREAK_ATK.flight, g = PHYS.gravity;
  const tx = m.x + m.vx * T, tz = m.z + m.vz * T;
  const ty = (m.air ? Math.max(0, m.y + m.vy * T - 0.5 * g * T * T) : m.y) + PHYS.height;
  const hx = tx - p.x, hz = tz - p.z, hd = Math.hypot(hx, hz);
  c.target = m;
  [c.dashX, c.dashZ] = hd > 1e-6 ? [hx / hd, hz / hd] : [p.aimX, p.aimZ];
  p.vx = hx / T;
  p.vz = hz / T;
  p.vy = (ty - p.y + 0.5 * g * T * T) / T;
  p.grounded = false;
  p.aimX = c.dashX; p.aimZ = c.dashZ;
}

/**
 * 突進碰到目標了嗎：水平上兩個身體相交，垂直上玩家的腳最高可以在牠頭頂上方
 * 0.3 公尺（瞄的就是頭頂，差一點點不該算沒碰到）。
 */
export function breakContact(p, m) {
  if (Math.hypot(p.x - m.x, p.z - m.z) >= PHYS.radius * 2) return false;
  return p.y <= m.y + PHYS.height + 0.3 && p.y + PHYS.height > m.y;
}

/** 碰到了：記下相對位置，把怪物定住，進迴旋。 */
export function latch(c, p, m) {
  c.phase = 'spin';
  c.t = 0;
  c.off = [p.x - m.x, p.y - m.y, p.z - m.z];
  c.yaw0 = Math.atan2(m.aimX, m.aimZ);
  m.held = true;
  m.vx = m.vy = m.vz = 0;
  p.vx = p.vy = p.vz = 0;
  p.grounded = false;
}

/**
 * 迴旋的一幀：怪物原地轉、玩家保持相對位置繞著牠轉，角度是 2π × 進度。
 * 轉完就扣血、放開怪物、讓玩家往突進的反方向跳離。
 *
 * 繞 y 軸轉 a：(x, z) → (x cos a + z sin a, −x sin a + z cos a)，跟 three 的
 * rotation.y 同一個方向，所以怪物的朝向加 a 與玩家繞的方向是一致的。
 *
 * @returns {{done: boolean, died: boolean}} done 這一幀轉完了；died 那一下把牠打死了
 */
export function spinStep(c, p, m) {
  const k = Math.min(1, c.t / BREAK_ATK.spin);
  const a = Math.PI * 2 * k;
  const [ox, oy, oz] = c.off;
  const rx = ox * Math.cos(a) + oz * Math.sin(a);
  const rz = -ox * Math.sin(a) + oz * Math.cos(a);
  p.x = m.x + rx; p.y = m.y + oy; p.z = m.z + rz;
  const rl = Math.hypot(rx, rz);
  if (rl > 0.05) { p.aimX = -rx / rl; p.aimZ = -rz / rl; }   // 一直面向牠
  m.aimX = Math.sin(c.yaw0 + a); m.aimZ = Math.cos(c.yaw0 + a);
  if (k < 1) return { done: false, died: false };
  /* 推開怪物在扣血之前：打死的話重生會把這一份清掉，不會帶到重生點去。 */
  m.held = false;
  m.vx = c.dashX * BREAK_ATK.push.h;
  m.vz = c.dashZ * BREAK_ATK.push.h;
  m.vy = 0;
  if (m.y > 0) { m.air = true; m.grounded = false; }         // 在空中被定住的：放開就帶著水平速度落下
  else m.slide = true;
  const died = hurt(m, DAMAGE.break);
  c.phase = 'vault';
  c.t = 0;
  p.vx = -c.dashX * BREAK_ATK.off.h;
  p.vz = -c.dashZ * BREAK_ATK.off.h;
  p.vy = BREAK_ATK.off.v;
  return { done: true, died };
}
