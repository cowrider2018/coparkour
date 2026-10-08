/* ── test/src/offer.js ───────────────────────────────────────────────
   獻靈魂（完整流程模式）：國王倒下之後躺在王座廳裡（fight.js 的屍體，REST 的 lie），
   主角在牠身邊長按跳，把撿靈魂撿來的最大血量一顆一顆交給牠。

   ── 一次長按 ────────────────────────────────────────────────────
     按著 wait 秒      還沒開始：這之前放手什麼都沒發生。
     交               頭頂最上面那一顆心（最大血量）閃 beat 秒，閃完那一顆不見、最大血量
                       −1，同時拋出一顆靈魂（fight.js 畫成拋物線落到國王身上）；接著下一顆閃
                       ——一秒交 1 / beat 顆，閃的長短就是交的速度。
     放手、走開       停。閃到一半的那一顆不算、留著；再按要重新等 wait 秒。
     交滿 need 顆      完成（done），之後不再收。
     交不出去         最大血量只剩一開始那麼多（LIFE.start）就不能再交——交出去的只有撿靈魂撿來
                       的那幾顆。還沒交滿的話說一次「需要更多」（short）：有靈魂沒撿到，玩家自己回去找。

   need 是這一輪掉得出的靈魂總數（route.js 的 SOULS，模式給），所以全部撿到、全部交完，最大血量
   剛好回到一開始的 LIFE.start。交了幾顆記在這裡，不管一次交完還是分幾次。

   規則在這裡（node 驗得動，verify-combat 的「獻靈魂」）；在哪裡、怎麼畫在 fight.js。
   ------------------------------------------------------------------ */

import { LIFE } from './combat.js';

/**
 * 按多久才開始、一顆閃幾秒（也就是多久交一顆）、離國王（躺著的身體中間）多近（公尺，水平）
 * 才算在牠身邊、拋出去的靈魂飛幾秒、拋多高（公尺）。
 */
export const OFFER = { wait: 0.5, beat: 0.5, near: 2.5, flight: 0.6, arc: 1.2 };

/**
 * 還沒交過的一份：要收 `need` 顆。`held` 這一次按了多久、`blink` 現在那一顆閃了多久、`told` 這一次
 * 按著說過「需要更多」了。need 是 0 的話一開始就交滿了（沒有要收的：戰鬥模式）。
 */
export const makeOffer = (need = 0) => ({ need, given: 0, held: 0, blink: 0, told: false });

/** 交滿了嗎。 */
export const offerDone = (o) => o.given >= o.need;

/** 現在交得出去嗎：還沒交滿、最大血量比一開始多（有撿來的可以交）。 */
export const canGive = (o, p) => !offerDone(o) && p.max > LIFE.start;

/** 最上面那一顆心閃了幾秒（0～beat）；沒在閃是 -1。 */
export const blinkOf = (o, p) => (o.held >= OFFER.wait && canGive(o, p) ? o.blink : -1);

/**
 * 一幀。`holding`：按著跳、而且在國王身邊。`p` 是玩家（交出去的那一顆從 max 扣，血跟著不超過它）。
 *
 * @returns {{gave: boolean, done: boolean, short: boolean}}
 *   gave  這一幀交出了一顆
 *   done  這一顆把它交滿了
 *   short 交不出去了、還沒交滿（一次長按只說一次）
 */
export function offerStep(o, dt, holding, p) {
  const out = { gave: false, done: false, short: false };
  if (!holding || offerDone(o)) {
    o.held = 0; o.blink = 0; o.told = false;
    return out;
  }
  const was = o.held;
  o.held += dt;
  if (o.held < OFFER.wait) return out;
  if (!canGive(o, p)) {
    if (!o.told) { o.told = true; out.short = true; }
    return out;
  }
  // 跨過 wait 的那一幀只閃超過的那一截。
  o.blink += o.held - Math.max(was, OFFER.wait);
  if (o.blink < OFFER.beat) return out;
  o.blink -= OFFER.beat;
  p.max--;
  p.hp = Math.min(p.hp, p.max);
  o.given++;
  out.gave = true;
  if (offerDone(o)) out.done = true;
  else if (!canGive(o, p)) { o.told = true; out.short = true; }
  return out;
}

/**
 * 拋出去的一顆靈魂：從 (x0, y0, z0) 飛 OFFER.flight 秒落到 (x1, y1, z1)，中間往上拱 OFFER.arc
 * 公尺（拋物線），一邊飛一邊轉。形狀跟地上的靈魂一樣（{x, y, z, yaw}，soul.js 畫）。
 */
export const throwSoul = (from, to) => ({
  x0: from.x, y0: from.y, z0: from.z, x1: to.x, y1: to.y, z1: to.z, t: 0, x: from.x, y: from.y, z: from.z, yaw: 0,
});

/** 拋出去的那一顆往前飛一幀；落到了回傳 true。 */
export function flySoul(s, dt) {
  s.t += dt;
  const u = Math.min(1, s.t / OFFER.flight);
  s.x = s.x0 + (s.x1 - s.x0) * u;
  s.z = s.z0 + (s.z1 - s.z0) * u;
  s.y = s.y0 + (s.y1 - s.y0) * u + 4 * OFFER.arc * u * (1 - u);
  s.yaw = (s.yaw + 2 * Math.PI * dt) % (2 * Math.PI);
  return u >= 1;
}
