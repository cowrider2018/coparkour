/* ── combat-area/src/skills.js ───────────────────────────────────────
   BOSS 的技能：規則。

   跟 combat.js 一樣只算數字——哪一招、打在哪裡、碰到沒有。畫出預告與球是
   fx.js 與 main.js 的事，而這一支 node 驗得動（tools/verify-combat-area.mjs）。

   ── 循環 ────────────────────────────────────────────────────────
   有技能的那一類（KINDS 的 `skills`）每 `every` 秒從自己的技能裡隨機挑一招。
   挑中的那一刻鎖定玩家的水平位置，之後玩家怎麼跑都不改——預告就是給人躲的。
   放招的這段時間牠站著不動，不追人；放完才回去追。

   被打斷：擊退在空中、被破防攻擊定住、被推開在滑，這三種時候放到一半的招
   直接取消，不打。倒數照走，下一招還是從上一招開始算起的 `every` 秒後。

     orb   倒數 0.75 秒（地上一條往目標延伸的預告），然後朝鎖定的方向直線發射
           一顆球：半徑 0.75 個狗高、每秒 6 公尺，碰到黑牆就消失。
     leap  目標點上兩個圓倒數 1.5 秒：淺色的是範圍（半徑 2.5 個狗高），亮色的
           從中心長到邊。最後 0.6 秒 BOSS 起跳、照拋物線飛過去，倒數到 0 的那一
           刻落在目標點上，打那一整圈。

   範圍攻擊（leap 的那一圈）打的是地面上一個狗高以內：玩家的腳比那還高——
   跳起來了——就躲得過。

   碰到就死：跟被咬一樣，玩家死、全部回到站位。玩家無敵的時候（第三段、破防
   攻擊）碰到不算。
   ------------------------------------------------------------------ */

import { PHYS, arenaGap } from '../../test-area/src/walk.js';
import { ARENA, DOG_H, kindOf } from './combat.js';

/** 每一招的數值。長度一律用狗高量。 */
export const SKILL = {
  orb: { windup: 0.75, radius: 0.75 * DOG_H, speed: 6 },
  leap: { windup: 1.5, air: 0.6, radius: 2.5 * DOG_H },
};

/** 範圍攻擊打得到的高度：腳在這以下才算（一個狗高）。 */
const REACH_UP = PHYS.height;

/** 場上飛著的東西（球）。每一局一份，回到站位就清空。 */
export function makeWorld() {
  return { shots: [] };
}

/** 放招會被打斷的狀態：擊退在空中、被定住、被推開在滑。 */
const busy = (m) => m.air || m.held || m.slide;

/** 開始一招：鎖定玩家現在的水平位置，面向它，停下來。 */
function begin(m, skill, target) {
  const dx = target.x - m.x, dz = target.z - m.z;
  const d = Math.hypot(dx, dz);
  const [dirX, dirZ] = d > 1e-6 ? [dx / d, dz / d] : [m.aimX, m.aimZ];
  m.cast = { skill, t: 0, dirX, dirZ, tx: target.x, tz: target.z, x0: m.x, z0: m.z };
  m.aimX = dirX; m.aimZ = dirZ;
  m.vx = 0; m.vz = 0;
}

/** 每一招倒數時與倒數完的那一幀要做什麼。 */
const CAST = {
  orb(m, world) {
    const c = m.cast, S = SKILL.orb;
    if (c.t < S.windup) return;
    // 從身體前緣發出去，剛好不跟自己重疊。
    const off = PHYS.radius + S.radius;
    world.shots.push({
      x: m.x + c.dirX * off, y: S.radius, z: m.z + c.dirZ * off,
      vx: c.dirX * S.speed, vz: c.dirZ * S.speed, r: S.radius,
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
      m.y = (PHYS.gravity * S.air * S.air / 2) * s * (1 - s);
      m.grounded = false;
      return null;
    }
    m.x = c.tx; m.z = c.tz; m.y = 0;
    m.grounded = true;
    m.cast = null;
    return { shape: 'circle', x: c.tx, z: c.tz, r: S.radius };
  },
};

/**
 * 範圍攻擊打到玩家了嗎。範圍是平面上的形狀，高度是地面往上一個狗高：
 * 形狀碰到身體（身體半徑算進去）、腳又在那個高度以下，才算。
 */
export function strikeHits(st, p) {
  if (p.y >= REACH_UP) return false;
  const d = Math.hypot(p.x - st.x, p.z - st.z);
  if (st.shape === 'circle') return d <= st.r + PHYS.radius;
  return false;
}

/**
 * BOSS 的一幀：倒數、挑招、推進放到一半的招。沒有技能的那一類什麼都不做。
 * 要在 monsterStep 之前叫——放招中的怪物 monsterStep 讓牠站著不動。
 *
 * @param {() => number} rng 挑招用的亂數（離線驗證給固定的）
 * @returns {object|null} 這一幀打下來的範圍攻擊（給 strikeHits），沒有就是 null
 */
export function bossStep(m, dt, target, world, rng = Math.random) {
  const k = kindOf(m);
  if (!k.skills || !k.skills.length) return null;
  if (m.cast && busy(m)) m.cast = null;                // 被打斷
  m.castT -= dt;
  if (!m.cast && m.castT <= 0 && !busy(m)) {
    m.castT = k.every;
    begin(m, k.skills[Math.min(k.skills.length - 1, Math.floor(rng() * k.skills.length))], target);
  }
  if (!m.cast) return null;
  m.cast.t += dt;
  return CAST[m.cast.skill](m, world) || null;
}

/** 球往前飛，碰到黑牆就消失。 */
export function shotsStep(world, dt) {
  for (const s of world.shots) { s.x += s.vx * dt; s.z += s.vz * dt; }
  world.shots = world.shots.filter((s) => arenaGap(ARENA, s.x, s.z) > s.r);
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
 * 從 (x, z) 沿 (dirX, dirZ) 走到黑牆有多遠。球的預告畫到這裡為止——球本來就
 * 在那裡消失。
 */
export function laneLength(x, z, dirX, dirZ) {
  let t = Infinity;
  if (dirX > 1e-9) t = Math.min(t, (ARENA.x1 - x) / dirX);
  if (dirX < -1e-9) t = Math.min(t, (ARENA.x0 - x) / dirX);
  if (dirZ > 1e-9) t = Math.min(t, (ARENA.z1 - z) / dirZ);
  if (dirZ < -1e-9) t = Math.min(t, (ARENA.z0 - z) / dirZ);
  return Math.max(0, t);
}
