/* ── test/src/skills.js ───────────────────────────────────────
   怪物的技能（BOSS、騎士）：規則。

   跟 combat.js 一樣只算數字——哪一招、打在哪裡、碰到沒有。畫出預告與球是
   fx.js 與 mode-combat.js 的事，而這一支 node 驗得動（tools/verify-combat.mjs）。

   ── 循環 ────────────────────────────────────────────────────────
   有技能的那一類（KINDS 的 `skills`）每 `every` 秒從自己的技能裡隨機挑一招。
   挑中的那一刻鎖定玩家的水平位置，之後玩家怎麼跑都不改——預告就是給人躲的。
   放招的這段時間牠不追人（站著，或照那一招自己的路線走）；放完才回去追。

   帶 `range` 的招只在玩家離牠這麼近（水平、身體中心到身體中心）的時候挑得到：
   時間到了、沒有一招夠得到，就接著追，哪一幀夠得到了哪一幀放。

   倒數期間牠不會被擊退、受到的傷害減半（combat.js 的 armored）。唯一打斷得了
   的是破防攻擊：被定住的那一刻放到一半的招直接取消，不打。倒數照走，下一招
   還是從上一招開始算起的 `every` 秒後。

   出招之後（球射出去、跳砸落地、扇形打下去）僵直 SKILL.recover 秒：站著不動、
   也不追人，而且跟平常一樣打得退、傷害照算——這是反擊的空檔。被破防攻擊打斷
   的不算出招，沒有僵直。

     orb   倒數 0.75 秒（地上一條往目標延伸的預告），然後朝鎖定的方向直線發射
           一顆球：半徑 0.75 個狗高、每秒 6 公尺，碰到黑牆或場上的東西（牆、柱子、
           台階的側面；開著的門不算）就炸掉消失。
     leap  目標點上兩個圓倒數 1.5 秒：淺色的是範圍（半徑 2.5 個狗高），亮色的
           從中心長到邊。最後 0.6 秒 BOSS 起跳、照拋物線飛過去，倒數到 0 的那一
           刻落在目標點上，打那一整圈。
     cone  站在原地朝鎖定的方向倒數 1 秒：淺色的 60° 扇形（長 4 個狗高）是範圍，
           亮色的扇形從 BOSS 腳下往外長，長滿的那一刻打那一整片。

   騎士的招：

     whirl  劍迴旋衝刺（離玩家 3.2 公尺以內才放）。牠腳下出現一條往目標延伸的
            膠囊形紅區（寬是迴旋的直徑、長是衝得到的距離），倒數 0.5 秒；然後
            朝鎖定的方向衝（初速 16、0.4 秒減到 0，3.2 公尺），衝的同時劍掃兩圈
            （主角第三擊落地那一下的迴旋，多轉一圈）。衝的每一幀打的是這一幀走過的
            那一段，外擴迴旋的半徑——整段衝下來就是預告的那一條。
     cleave 跳砍（離玩家 8 公尺以內才放）。玩家腳下出現一條紅色長條（沿著騎士往
            玩家的方向，玩家在正中間），倒數 0.5 秒；然後騎士跳起來、0.4 秒沿一道
            弧線（最高 1.2 公尺）落在長條靠牠的那一頭，落地那一刻劍往前劈下，打
            那一整條。玩家離得比半條還近的話，牠原地跳起來劈（長條從牠腳下起）。

   範圍攻擊（leap 的那一圈、cone 的那一片、whirl 與 cleave 的那一條）打的是地面上一個狗高以內：
   玩家的腳比那還高——跳起來了——就躲得過。

   碰到扣血：BOSS 的招 5、騎士的 whirl 2、cleave 3（每一招的 `damage`；衝刺咬到的見 combat.js 的 KINDS）。
   打中人的球就炸掉消失。玩家無敵的時候（第三段、破防攻擊）碰到不算，球穿過去。
   ------------------------------------------------------------------ */

import { PHYS, arenaGap, supportInfo, solveXZ, overlapXZ, roundTop } from './walk.js';
import { FIELD, DOG_H, kindOf, busy, settle } from './combat.js';

/** 每一招的數值。長度一律用狗高量；`damage` 是打中玩家扣幾點血。 */
export const SKILL = {
  orb: { windup: 0.75, radius: 0.75 * DOG_H, speed: 6, damage: 5 },
  leap: { windup: 1.5, air: 0.6, radius: 2.5 * DOG_H, damage: 5 },
  cone: { windup: 1, radius: 4 * DOG_H, half: Math.PI / 6, damage: 5 },
  /* 騎士的劍迴旋衝刺：倒數 windup，然後 time 秒裡速度從 speed 線性減到 0（衝 speed·time/2
     = 3.2 公尺），劍掃的半徑是 radius。time 是 trail.js 的 whirl 那兩圈掃完的 0.40 秒
     （跟主角第三擊那一圈一樣長，轉兩倍快），衝完剛好轉完。range：離玩家這麼近才放。 */
  whirl: { windup: 0.5, time: 0.4, speed: 16, radius: 1.75 * DOG_H, range: 3.2, damage: 2 },
  /* 騎士的跳砍：倒數 windup，然後 air 秒跳一道最高 hop 公尺的弧線落下、劈那一條（長 len、
     寬 width，從落點往前）。range：離玩家這麼近才放。 */
  cleave: { windup: 0.5, air: 0.4, hop: 1.2, len: 2.2 * DOG_H, width: 0.8 * DOG_H, range: 8, damage: 3 },
  /** 出招後僵直幾秒。 */
  recover: 0.5,
};

/** 劍迴旋衝刺衝出去 s 秒（0 ≤ s ≤ time）走了多遠：速度從 speed 線性減到 0 的積分。 */
export const whirlDist = (s) => SKILL.whirl.speed * (s - (s * s) / (2 * SKILL.whirl.time));

/** 劍迴旋衝刺整段衝多遠（預告那一條的長度，不算兩頭的半圓）。 */
export const WHIRL_LEN = whirlDist(SKILL.whirl.time);

/** 範圍攻擊打得到的高度：腳在打下去的那一塊地板往上這麼高以內才算（一個狗高）。 */
const REACH_UP = PHYS.height;

/**
 * 場上飛著的東西（球）。每一局一份，回到站位就清空。`field` 是這一局的場地
 * （combat.js 的 FIELD 那一種）：球飛到它的黑牆就消失。
 */
export function makeWorld(field = FIELD) {
  return { shots: [], field };
}

/* 不能開始放招的狀態（combat.js 的 busy）。倒數中不會被擊退（見 armored），
   所以放到一半會碰上的只有「被定住」——破防攻擊打斷得了。 */

/** 開始一招：鎖定玩家現在的水平位置，面向它，停下來。 */
function begin(m, skill, target) {
  const dx = target.x - m.x, dz = target.z - m.z;
  const d = Math.hypot(dx, dz);
  const [dirX, dirZ] = d > 1e-6 ? [dx / d, dz / d] : [m.aimX, m.aimZ];
  /* 目標點的地板：玩家可能在空中，跳砸落在牠腳下那一塊的頂上。 */
  const ty = supportInfo(m.field.cols, target.x, target.z, target.y).y;
  m.cast = { skill, t: 0, dirX, dirZ, tx: target.x, tz: target.z, ty, x0: m.x, y0: m.y, z0: m.z };
  m.aimX = dirX; m.aimZ = dirZ;
  m.vx = 0; m.vz = 0;
  if (skill === 'cleave') aimCleave(m, d);
}

/**
 * 跳砍的落點：長條的正中間是鎖定的那一點，所以落在它前面半條的地方；比半條還近就
 * 原地跳。落點的地板照那一點往下找（跳得上去的台也算）。
 */
function aimCleave(m, d) {
  const c = m.cast, S = SKILL.cleave;
  const k = Math.max(0, d - S.len / 2);
  c.lx = m.x + c.dirX * k;
  c.lz = m.z + c.dirZ * k;
  c.ly = supportInfo(m.field.cols, c.lx, c.lz, Math.max(m.y, c.ty) + PHYS.step).y;
}

/** 每一招倒數時與倒數完的那一幀要做什麼。 */
const CAST = {
  orb(m, world) {
    const c = m.cast, S = SKILL.orb;
    if (c.t < S.windup) return;
    // 從身體前緣發出去，剛好不跟自己重疊。
    const off = PHYS.radius + S.radius;
    world.shots.push({
      x: m.x + c.dirX * off, y: m.y + S.radius, z: m.z + c.dirZ * off,
      vx: c.dirX * S.speed, vz: c.dirZ * S.speed, r: S.radius, dmg: S.damage,
    });
    m.cast = null;
  },

  /* 倒數的前 0.9 秒站著，最後 `air` 秒沿直線飛向目標、高度是一條拋物線（頂點
     g·air²/8，0.6 秒大約 1 公尺）。倒數到 0 那一幀落在目標點上，打那一圈。 */
  leap(m) {
    const c = m.cast, S = SKILL.leap;
    const s = (c.t - (S.windup - S.air)) / S.air;
    if (s < 0) return null;
    if (s < 1) {
      m.x = c.x0 + (c.tx - c.x0) * s;
      m.z = c.z0 + (c.tz - c.z0) * s;
      m.y = c.y0 + (c.ty - c.y0) * s + (PHYS.gravity * S.air * S.air / 2) * s * (1 - s);
      m.grounded = false;
      return null;
    }
    m.x = c.tx; m.z = c.tz; m.y = c.ty;
    m.grounded = true;
    m.cast = null;
    return { shape: 'circle', x: c.tx, y: c.ty, z: c.tz, r: S.radius, dmg: S.damage };
  },

  cone(m) {
    const c = m.cast, S = SKILL.cone;
    if (c.t < S.windup) return null;
    m.cast = null;
    return { shape: 'cone', x: m.x, y: m.y, z: m.z, dirX: c.dirX, dirZ: c.dirZ, r: S.radius, half: S.half, dmg: S.damage };
  },

  /* 倒數的時候站著；之後 air 秒沿直線飛向落點、高度是一條最高 hop 的拋物線（疊在起點與
     落點的高低差上）。飛完那一幀落在落點上，劈那一條。 */
  cleave(m) {
    const c = m.cast, S = SKILL.cleave;
    const s = (c.t - S.windup) / S.air;
    if (s < 0) return null;
    if (s < 1) {
      m.x = c.x0 + (c.lx - c.x0) * s;
      m.z = c.z0 + (c.lz - c.z0) * s;
      m.y = c.y0 + (c.ly - c.y0) * s + 4 * S.hop * s * (1 - s);
      m.grounded = false;
      return null;
    }
    m.x = c.lx; m.z = c.lz; m.y = c.ly;
    m.grounded = true;
    m.cast = null;
    return { shape: 'strip', x: c.lx, y: c.ly, z: c.lz, dirX: c.dirX, dirZ: c.dirZ, len: S.len, w: S.width, dmg: S.damage };
  },

  /* 倒數完沿鎖定的方向衝，走多遠是那一段時間的積分（跟幀長無關，一次永遠 3.2 公尺，
     被牆擋住就沿著牆滑）。每一幀打的是這一幀走過的那一段（膠囊）；衝完那一幀收招。 */
  whirl(m) {
    const c = m.cast, S = SKILL.whirl;
    const s = Math.min(S.time, c.t - S.windup);
    if (s <= 0) return null;
    const step = whirlDist(s) - whirlDist(c.s || 0);
    c.s = s;
    const x0 = m.x, z0 = m.z;
    [m.x, m.z] = solveXZ(m.field.cols, m.x + c.dirX * step, m.z + c.dirZ * step, m.y, m.field.doors);
    settle(m);
    if (s >= S.time) m.cast = null;
    return { shape: 'capsule', x: x0, y: m.y, z: z0, x1: m.x, z1: m.z, r: S.radius, dmg: S.damage };
  },
};

/** 點 (px, pz) 到線段 (ax, az)–(bx, bz) 的水平距離。 */
function segGap(px, pz, ax, az, bx, bz) {
  const ux = bx - ax, uz = bz - az, L2 = ux * ux + uz * uz;
  const k = L2 > 1e-12 ? Math.min(1, Math.max(0, ((px - ax) * ux + (pz - az) * uz) / L2)) : 0;
  return Math.hypot(px - ax - ux * k, pz - az - uz * k);
}

/**
 * 範圍攻擊打到玩家了嗎。範圍是平面上的形狀，高度是地面往上一個狗高：
 * 形狀碰到身體（身體半徑算進去）、腳又在那個高度以下，才算。
 *
 *   circle   圓心 (x, z)、半徑 r。
 *   cone     尖在 (x, z)、朝 (dirX, dirZ)、半角 half、長 r。
 *   capsule  (x, z)–(x1, z1) 那一段往外擴 r（劍迴旋衝刺這一幀走過的那一段）。
 *   strip    從 (x, z) 往 (dirX, dirZ) 長 len、寬 w 的長方形（跳砍劈下去的那一條）。
 */
export function strikeHits(st, p) {
  if (p.y >= (st.y ?? 0) + REACH_UP) return false;
  if (st.shape === 'capsule') return segGap(p.x, p.z, st.x, st.z, st.x1, st.z1) <= st.r + PHYS.radius;
  if (st.shape === 'strip') {
    // 長方形到身體中心的距離（裡面是 0），碰到身體就算。
    const rx = p.x - st.x, rz = p.z - st.z;
    const u = rx * st.dirX + rz * st.dirZ, v = rz * st.dirX - rx * st.dirZ;
    const du = Math.max(0, -u, u - st.len), dv = Math.max(0, Math.abs(v) - st.w / 2);
    return Math.hypot(du, dv) <= PHYS.radius;
  }
  const d = Math.hypot(p.x - st.x, p.z - st.z);
  if (st.shape === 'circle') return d <= st.r + PHYS.radius;
  // 扇形：跟第一段同一種判法——半徑加身體，角度加上身體在那個距離張開的角度。
  if (d > st.r + PHYS.radius) return false;
  if (d <= PHYS.radius) return true;
  const cos = ((p.x - st.x) * st.dirX + (p.z - st.z) * st.dirZ) / d;
  const off = Math.acos(Math.max(-1, Math.min(1, cos)));
  return off <= st.half + Math.asin(Math.min(1, PHYS.radius / d));
}

/**
 * 有技能的那一類（BOSS、騎士）的一幀：倒數、挑招、推進放到一半的招。沒有技能的那一類
 * 什麼都不做。要在 monsterStep 之前叫——放招中的怪物 monsterStep 讓牠站著不動（要走的招
 * 自己在 CAST 裡走）。
 *
 * 挑招只從夠得到的招裡挑（`range`，見檔頭）；一招都夠不到的話不重新計時，下一幀再看。
 *
 * @param {() => number} rng 挑招用的亂數（離線驗證給固定的）
 * @returns {object|null} 這一幀打下來的範圍攻擊（給 strikeHits），沒有就是 null
 */
export function bossStep(m, dt, target, world, rng = Math.random) {
  const k = kindOf(m);
  if (!k.skills || !k.skills.length) return null;
  if (m.cast && busy(m)) m.cast = null;                // 被打斷
  m.castT -= dt;
  // 衝刺（combat.js 的 LUNGE）打完才挑下一招，兩件事不會疊在一起。
  if (!m.cast && m.castT <= 0 && !busy(m) && !(m.stun > 0) && !m.lunge) {
    const gap = Math.hypot(target.x - m.x, target.z - m.z);
    const can = k.skills.filter((s) => !(gap > SKILL[s].range));
    if (can.length) {
      m.castT = k.every;
      begin(m, can[Math.min(can.length - 1, Math.floor(rng() * can.length))], target);
    }
  }
  if (!m.cast) return null;
  m.cast.t += dt;
  const hit = CAST[m.cast.skill](m, world) || null;
  if (!m.cast) m.stun = SKILL.recover;                 // 出完了：僵直
  return hit;
}

/** 球貼著地板飛（底剛好在發射那一層的頂上）：頂面不比球底高出這麼多的東西不算撞到。 */
const SKIM = 0.05;

/**
 * 一顆球撞到場上的東西了嗎：球（用外接方框近似）跟碰撞體重疊。坑與黑牆不在這裡算
 * （黑牆是 shotsStep 用 arenaGap 量的），開著的門不擋；圓柱照它的頂（圓頂的話照球
 * 碰得到的那一圈的高度）。
 */
export function shotBlocked(s, field) {
  const doors = field.doors || {};
  const lo = s.y - s.r + SKIM, hi = s.y + s.r;
  for (const b of field.cols) {
    if (b.kind === 'pit' || b.kind === 'bound') continue;
    if (b.door && doors[b.door]) continue;
    if (b.min[1] >= hi) continue;
    if (b.shape === 'circle') {
      const d = Math.hypot(s.x - b.x, s.z - b.z);
      if (d < b.r + s.r && roundTop(b, Math.max(0, d - s.r)) > lo) return true;
      continue;
    }
    if (b.max[1] > lo && overlapXZ(s.x, s.z, b, s.r)) return true;
  }
  return false;
}

/** 球往前飛，碰到黑牆或場上的東西就炸掉消失。回傳這一幀炸掉的那幾顆（畫爆炸用）。 */
export function shotsStep(world, dt) {
  const gone = [];
  world.shots = world.shots.filter((s) => {
    s.x += s.vx * dt; s.z += s.vz * dt;
    const hit = arenaGap(world.field.arena, s.x, s.z) <= s.r || shotBlocked(s, world.field);
    if (hit) gone.push(s);
    return !hit;
  });
  return gone;
}

/**
 * 一顆球碰到玩家了嗎：球心到玩家那根圓柱（半徑 PHYS.radius、高 PHYS.height）
 * 的距離小於球的半徑。
 */
export function shotHits(s, p) {
  const out = Math.max(0, Math.hypot(s.x - p.x, s.z - p.z) - PHYS.radius);
  const dy = s.y < p.y ? p.y - s.y : s.y > p.y + PHYS.height ? s.y - p.y - PHYS.height : 0;
  return Math.hypot(out, dy) < s.r;
}

/**
 * 從 (x, z) 沿 (dirX, dirZ) 走到黑牆 `arena` 有多遠。球的預告畫到這裡為止——球本來就
 * 在那裡消失。方的量到四條邊，圓的解射線與圓的交點。
 */
export function laneLength(x, z, dirX, dirZ, arena = FIELD.arena) {
  if (arena.shape === 'circle') {
    const ox = x - arena.x, oz = z - arena.z;
    const b = ox * dirX + oz * dirZ, c = ox * ox + oz * oz - arena.r * arena.r;
    return Math.max(0, -b + Math.sqrt(Math.max(0, b * b - c)));
  }
  let t = Infinity;
  if (dirX > 1e-9) t = Math.min(t, (arena.x1 - x) / dirX);
  if (dirX < -1e-9) t = Math.min(t, (arena.x0 - x) / dirX);
  if (dirZ > 1e-9) t = Math.min(t, (arena.z1 - z) / dirZ);
  if (dirZ < -1e-9) t = Math.min(t, (arena.z0 - z) / dirZ);
  return Math.max(0, t);
}
