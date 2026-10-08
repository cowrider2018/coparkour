/* ── test/src/hero.js ────────────────────────────────────────────────
   玩家那隻在遺跡上怎麼動：操控 → 速度（`steerHero`），速度 → 位移、重力、
   落地（`moveHero`）。

   從地形模式的主程式搬出來，因為完整流程模式也走在同一片遺跡上，而兩邊
   必須是同一份——緩滑、滑落、感測區前的反推、關著的門，少一樣就是「在這
   個模式走得過去，在那個模式走不過去」。

   跳不在這裡：地形模式按著就跳，有連段的模式由連段決定這一下跳是什麼。
   感測區送走人（warp）也不在這裡：送到哪、送不送，是模式的事。
   ------------------------------------------------------------------ */

import { PHYS, solveXZ, supportInfo, steer, slideDrift, slideAccel, portalDrift } from './walk.js';
import { speedFor } from './controls.js';

/** 站在 (x, y, z) 的一隻，靜止、朝 +Z。 */
export function makeHero(x, y, z) {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, grounded: true,
    /* 腳底下那個面站不站得住，由 walk.js 的 supportInfo 給：null = 站得住，
       'slide' = 可操作的緩滑，'fall' = 失去操作的滑落。欄位名字跟著它，
       所以 slideDrift／slideAccel 直接吃這個物件，不必抄一份。 */
    slip: null, sin: 0, dx: 0, dz: 0,
    /* 最後一次操控的方向。移動與朝向都讀它：移動是「沿著它的那一份速度」
       （walk.js 的 steer），朝向是「轉到這裡為止」。放開手之後它不會被
       清掉——那正是「停下來還會轉完最後那一下」的全部機制。
       初值 +Z，因為模型的靜止朝向就是 +Z。 */
    aimX: 0, aimZ: 1,
  };
}

/**
 * 操控 → 速度。回報這一幀是不是在滑落（滑落的時候不能跳）。
 *
 * @param {object} p makeHero 那一種
 * @param {import('./controls.js').Controls} controls
 * @param {{ix: number, iz: number, mag: number, sprint?: boolean}} input controls.axis() 這一幀的軸
 */
export function steerHero(p, dt, controls, input) {
  /* 站在不可踩的圓頂上（樹梢那種）：操作整個失效，只剩重力。判斷用
     的是**上一幀**踩到的那個面——這一幀踩到什麼要等垂直那一段算完才
     知道，而輸入得在那之前處理。差一幀，16 毫秒，手上感覺不到。 */
  const locked = p.grounded && p.slip === 'fall';
  if (locked) input = { ix: 0, iz: 0, mag: 0 };

  // 操控的方向當幀就是移動的方向。轉向沒有延遲，加速量照舊。
  const aim = controls.aim(input);
  if (aim) [p.aimX, p.aimZ] = aim;

  if (locked) {
    /* 沿著面加速 g·sinθ。不走 accel／brake 那一段：煞車是 23，比滑落的
       加速度還大，兩個一起算的結果是站在上面紋風不動。 */
    const [ax, az] = slideAccel(p);
    p.vx += ax * dt;
    p.vz += az * dt;
  } else {
    [p.vx, p.vz] = steer(p.vx, p.vz, p.aimX, p.aimZ, speedFor(input), dt);
  }
  return locked;
}

/**
 * 速度 → 位移、重力、落地。`portals` 與 `doors` 給感測區前的反推與關著的門；
 * 不想被反推（例如戰鬥中所有傳送都不通）就給一張空的感測區清單。
 *
 * @returns {number} 這一幀實際走多快（給步態）
 */
export function moveHero(p, dt, cols, portals, doors) {
  /* 緩滑（屋頂、斜坡、大石）。它是一個**終端速度**而不是一個加速度，
     所以加在位移上而不是加進速度裡：加進速度的話，在斜面上站著不動的
     每一幀都會再累積一次，一秒之後就不是緩滑而是摔下去了。走路、跳躍、
     撞牆全部照常——這就是跑酷遊戲抓著牆往下溜的那個狀態。 */
  const [driftX, driftZ] = p.grounded ? slideDrift(p) : [0, 0];
  /* 感測區前那一圈的反推（walk.js 的 REPEL）：也是加在位移上的速度——進門會慢，
     停下來會被推回安全的地方。 */
  const [pushX, pushZ] = portalDrift(portals, p.x, p.y, p.z, doors);

  /* 水平。撞到東西不必把速度清掉：速度永遠只沿著操控的方向，所以「沿著
     牆一直加速」不會發生（速率被 speedFor 封在 6 以內），而正面撞牆之後
     轉開，新方向上的投影本來就是 0——以前那兩行逐軸清零做的事，現在是
     steer 的投影在做。 */
  const mvx = p.vx + driftX + pushX, mvz = p.vz + driftZ + pushZ;
  const [sx, sz] = solveXZ(cols, p.x + mvx * dt, p.z + mvz * dt, p.y, doors);
  p.x = sx; p.z = sz;

  // 垂直
  const prevY = p.y;
  p.vy -= PHYS.gravity * dt;
  p.y += p.vy * dt;
  const sup = supportInfo(cols, p.x, p.z, prevY);
  if (p.y <= sup.y && p.vy <= 0) {
    p.y = sup.y;
    p.vy = 0;
    p.grounded = true;
    /* 踩到的是什麼跟踩在多高是同一次搜尋的結果。分開問兩次的話，兩次
       之間隔著一個位移，而那正是「明明已經滑下來了卻還被鎖著」。 */
    p.slip = sup.slip;
    p.sin = sup.sin;
    p.dx = sup.dx;
    p.dz = sup.dz;
  } else {
    p.grounded = false;
    p.slip = null;                 // 在空中：控制權回來
  }
  return Math.hypot(mvx, mvz);
}
