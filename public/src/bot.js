// ── 機器人的腦 ──────────────────────────────────────────
// 這一套本來長在 tools/verify-level.mjs 裡，只會做一件事：一路往右跑。
// 現在多了 NPC 要用同一顆腦（走去某個落腳點，方向左右都有），所以抽出來成一個
// 模組，並且把寫死的「往右」換成方向參數 dir。
//
// dir = +1 時每一行算式都跟原本逐字等價（乘 1、減 0 不改變浮點結果），
// 所以 tools/verify-level.mjs 重構前後跑出來的數字必須一模一樣——那是這支檔案的驗收條件。
//
// 腦只能用左右 + 跳三個輸入，跑的是 player.js 的同一套物理，跟真人完全一樣。
import { PHYS, PLAYER_W, PLAYER_H } from './constants.js';

const STEP = 1 / 120;

/** 腦的狀態。每一個受控角色一份。 */
export function makeBot() {
  // grab = 這一跳是為了抓住前面那面牆才跳的（見 decide 的第 ③ 條）
  return { hold: 0, frame: 999, climb: false, steer: 1, wjCool: 0, grab: false, wallY: 0 };
}

/** Player 讀的是 axis / jumpHeld（鍵盤與水球共用的介面），腦只設 left/right/jump。 */
export function makeInput() {
  return {
    left: false, right: false, jump: false,
    get axis() { return (this.right ? 1 : 0) - (this.left ? 1 : 0); },
    get jumpHeld() { return this.jump; },
  };
}

/**
 * 走一步。
 * @param {number} dir  +1 往右、−1 往左
 * @param {boolean} climb  允不允許蹬牆爬。NPC 關掉：它的目標一律是「單跳到得了的落腳點」，
 *                         用不到蹬牆，關掉之後行為才可預測（也不會爬到玩家上不去的地方）。
 */
export function act(p, level, bot, input, dir = 1, climb = true) {
  if (bot.wjCool > 0) bot.wjCool--;
  steer(input, dir); // 預設一路朝目標方向

  if (p.grounded) {
    bot.climb = false;
    const want = decide(p, level, dir, climb, bot);
    if (want === false) { bot.frame = 999; input.jump = false; return; }
    bot.hold = want;
    bot.frame = 0;
    p.queueJump();
    input.jump = true;
    return;
  }

  // ── 爬牆 ──────────────────────────────────────────────
  // 貼到一面「頂端還遠在頭上」的高牆 = 跳不過去，只能蹬。
  // 進入爬牆模式後就一直蹬，直到爬過牆頂或落地為止。
  if (climb && p.wallDir !== 0) {
    const top = wallTop(level, p, p.wallDir);
    // bot.grab = 這一跳是為了抓住這面牆才跳的（前面沒有任何跳得到的落點）。
    // 那種地方唯一的路就是往上爬，所以碰到牆就直接進爬牆模式——
    // 不必再問「牆頂是不是高過頭頂 60px」。蹬牆井最底下那根柱子只高過頭頂 29px，
    // 用那個門檻會被判成「跳得過去的矮牆」，於是貼著它滑下去掉進井底。
    // bot.grab = 這一跳是為了抓住這面牆才跳的（前面沒有任何跳得到的落點）。
    // 那種地方唯一的路就是往上爬，所以碰到牆就直接進爬牆模式，不必再問
    // 「牆頂是不是高過頭頂 60px」——蹬牆井最底下那根柱子只高過頭頂 29px，
    // 用那個門檻會被判成「跳得過去的矮牆」，於是貼著它滑下去掉回井底。
    if (bot.climb || bot.grab || (top !== null && top < p.y - 60)) {
      bot.climb = true;
      if (top !== null) bot.wallY = top;   // 記住這面牆的頂端
      // 貼上牆的瞬間還在上升，這時蹬掉就白費了剩下的上升高度。
      // 先貼著牆滑到最高點（vy 轉正）再蹬，一次才吃得滿 WALL_RISE。
      // 什麼時候該蹬？兩種牆的答案不一樣：
      //   · 單面牆（閘門柱）：滑到最高點再蹬，一次磨高一點。
      //   · 對面也有牆（蹬牆井）：不能蹬滿。一次蹬牆的物理上限是 152px，但井裡的柱子
      //     只隔 99px——蹬在最高點會從對面那根柱子的頂上飛過去，然後一路掉出井外。
      //     所以改成問「現在蹬出去，會貼到對面的哪個高度」，落在對面柱子的側面範圍內才蹬。
      //     還在上升時算出來的落點太高，它會自己等；滑下來一點就進窗口了。
      const opposed = hasOpposingWall(level, p, -p.wallDir, 260);
      const ready = opposed ? wallJumpOutcome(level, p, -p.wallDir) !== null : p.vy > -60;
      if (bot.wjCool === 0 && ready) {
        bot.steer = opposed ? -p.wallDir : p.wallDir;
        p.queueJump();
        bot.wjCool = 10; // 蹬完那幾 frame wallDir 還在，別把下一次跳浪費掉
        bot.frame = 0;
        bot.hold = 60;
        steer(input, bot.steer);
        input.jump = true;
        return;
      }
      steer(input, p.wallDir); // 推向牆面貼著滑，別讓 wallDir 掉了
      // 這裡千萬不能放開跳躍鍵：貼上牆的時候人還在上升，
      // 一放開就觸發 jumpCut 把上升速度砍掉一半，剩下的高度全沒了。
      input.jump = true;
      return;
    }
  }
  // 升過剛剛那面牆的頂端就先收工，回到「往前走」，也把空中的二段跳救援放回來。
  // 少了這一條，爬出井口的那一刻它還記著最後一次蹬牆的方向（那是往回的），
  // 於是頭也不回地飄回井底——爬上去又掉下來，一輩子。
  //
  // 收得早一點是量出來的，不是猜的：留在爬牆模式裡就用不到二段跳的救援。
  // 試過「兩側的牆都在腳底下才收工」與「目標那一側沒牆才收工」，兩種都是 20/40；
  // 這種「升過剛剛那面牆就收工」是 32/40。
  if (bot.climb && bot.wallY && p.y + PLAYER_H <= bot.wallY + 4) {
    bot.climb = false;
    bot.grab = false;
    bot.wallY = 0;
  }
  if (bot.climb) steer(input, bot.steer);

  // 空中：按住跳躍鍵到預定的 frame 數（決定這一跳的高度）
  if (bot.frame < bot.hold) { input.jump = true; return; }
  // 掉下去又沒落點 → 補二段跳（全力）。沒有二段跳的角色 airJumps 一直是 0，這條不會發動。
  // 正在飛去抓牆的時候不能補：那一跳的落點本來就不是地面，是牆面上的一段高度窗口，
  // 補下去會把身體射到柱頂之上、從柱子上面飛過去（本來就是這樣摔死的）。
  if (p.vy > 40 && p.airJumps > 0 && !bot.grab && !landingAhead(p, level, dir)) {
    p.queueJump();
    bot.hold = bot.frame + 60;
    input.jump = true;
    return;
  }
  input.jump = false;
}

export function steer(input, dir) {
  input.right = dir > 0;
  input.left = dir < 0;
}

// 現在貼著的那面高牆的頂端 y（沒貼著牆就回 null）
export function wallTop(level, p, dir, reach = 6) {
  const y0 = p.y + 4, y1 = p.y + PLAYER_H - 4;
  const lo = dir > 0 ? p.x + PLAYER_W - 4 : p.x - reach;
  const hi = dir > 0 ? p.x + PLAYER_W + reach : p.x + 4;
  let top = null;
  level.forEachPlatform(lo - 8, hi + 8, (pl) => {
    if (pl.h < 60) return;
    if (y1 <= pl.y || y0 >= pl.y + pl.h) return;
    const face = dir > 0 ? pl.x : pl.x + pl.w; // 會撞上的是哪一面
    if (face < lo || face > hi) return;
    if (top === null || pl.y < top) top = pl.y;
  });
  return top;
}

// 反方向 dist 之內還有沒有另一面高牆？（決定要蹬過去還是貼回原牆）
// 高度只要大致對得上就算——對面那塊牆通常比現在的落腳點還高一截。
export function hasOpposingWall(level, p, dir, dist) {
  const lo = dir > 0 ? p.x + PLAYER_W - 4 : p.x - dist;
  const hi = dir > 0 ? p.x + PLAYER_W + dist : p.x + 4;
  let found = false;
  level.forEachPlatform(lo - 8, hi + 8, (pl) => {
    if (found || pl.h < 60) return;
    if (pl.y > p.y + 200 || pl.y + pl.h < p.y - 300) return;
    const face = dir > 0 ? pl.x : pl.x + pl.w;
    if (face >= lo && face <= hi) found = true;
  });
  return found;
}

/**
 * 現在從牆上蹬出去，會發生什麼事？
 *   'wall' = 貼到對面那根柱子的側面（蹬牆井中段）
 *   'land' = 落在某塊板子上（蹬牆井的最後一蹬，目標是出口平台）
 *   null   = 兩者皆非，白蹬一次
 *
 * 蹬牆的初速是固定的（wallJumpVY / wallJumpVX），所以結果只由「現在的高度」決定——
 * 直接把那一段軌跡跑出來、沿路查地形就知道了。等於在腦裡先蹬一次看看。
 *
 * 水平速度照 player.js 走：wallStick 那段鎖住輸入（維持 wallJumpVX），
 * 之後推向對面，速度上限回到 runSpeed，多出來的部分用空中加速度收掉。
 */
export function wallJumpOutcome(level, p, dir) {
  let vy = -PHYS.wallJumpVY, vx = PHYS.wallJumpVX, x = p.x, y = p.y, stick = PHYS.wallStick;
  for (let i = 0; i < 240; i++) {
    if (stick > 0) stick -= STEP;
    else if (vx > PHYS.runSpeed) vx = Math.max(PHYS.runSpeed, vx - PHYS.accelAir * STEP);
    vy += PHYS.gravity * STEP;
    if (vy > PHYS.maxFall) vy = PHYS.maxFall;
    const py = y, px = x;
    y += vy * STEP;
    x += dir * vx * STEP;
    let hit = null;
    level.forEachPlatform(Math.min(px, x) - 8, Math.max(px, x) + PLAYER_W + 8, (pl) => {
      if (hit) return;
      if (!(x + PLAYER_W > pl.x && x < pl.x + pl.w)) return;
      if (pl.h >= 60) {
        // 柱子：身體跟柱身重疊就是貼上了（跟 probeWall 同一個判準，上下各收 4px）
        if (y + PLAYER_H > pl.y + 4 && y < pl.y + pl.h - 4) hit = 'wall';
      } else if (vy > 0 && py + PLAYER_H <= pl.y && y + PLAYER_H >= pl.y) {
        hit = 'land'; // 下降中、腳穿過頂面 = 站上去了
      }
    });
    if (hit) return hit;
    if (y > p.y + 260) return null; // 掉這麼多還沒著落，這一蹬是白蹬
  }
  return null;
}

// 在地面上時決定要不要跳、以及要按住幾個 frame（false = 不跳）
export function decide(p, level, dir = 1, climb = true, bot = null) {
  if (bot) bot.grab = false;
  const footY = p.y + PLAYER_H;
  const nose = dir > 0 ? p.x + PLAYER_W : p.x; // 前進方向的那一側
  const vx = Math.max(200, Math.abs(p.vx));
  const edge = edgeAhead(level, p, footY, dir);

  // ① 前方障礙物（地刺或高塊）：算出「剛好跨得過去又落得回平台」的跳法。
  // obs.d 已經換算成「前進方向上還有多遠」，所以下面的算式跟左右無關。
  const obs = obstacleAhead(level, nose, footY, dir);
  if (obs && obs.d < 200) {
    const landMax = edge === null ? Infinity : (edge - nose) * dir - 24;
    const now = holdForObstacle(vx, p.y, obs.d, obs.w, obs.top, landMax);
    if (now !== null) {
      // 等到「再晚一點就跨不過去」的那一刻才起跳，這樣落點最遠
      const later = holdForObstacle(vx, p.y, obs.d - vx * STEP * 2, obs.w, obs.top, landMax - vx * STEP * 2);
      if (later === null) return now;
    } else if (obs.d < 30) {
      return 60; // 已經來不及精算了，全力一跳
    }
  }

  // ② 快到平台邊緣 → 先看「直接走下去」會不會剛好落在下一塊平台上
  if (edge === null || (edge - nose) * dir > 14) return false;
  const target = nextLanding(level, nose, dir);
  if (!target) return 60;
  const landY = target.y - PLAYER_H;

  const fall = simFall(vx, p.y, landY);
  if (fall !== null && nose + fall * dir > target.x + 10 && nose + fall * dir < target.x + target.w - 10) return false;

  // 不然就挑一個落點最接近平台前段的跳法（「前段」＝前進方向先碰到的那一頭）
  const inset = Math.min(46, target.w * 0.45);
  const wantX = dir > 0 ? target.x + inset : target.x + target.w - inset;
  let best = 60, bestErr = Infinity;
  for (let hold = 1; hold <= 60; hold += 1) {
    const r = simJump(vx, p.y, hold, null, landY);
    if (r.landX === null) continue;
    const err = Math.abs(nose + r.landX * dir - wantX);
    if (err < bestErr) { bestErr = err; best = hold; }
  }
  // ③ 前面那塊板子根本跳不到（每一種跳法都構不著）。
  // 蹬牆井就是這種地方：站在井底往前看，「下一塊站得住的板子」是井頂的出口，
  // 高在四百多 px 外。以前這裡會落到 best 的初始值 60，也就是「全力往前一跳」——
  // 那一跳會直接飛出井外摔死，這是機器人試跑唯一的死因。
  //
  // 真正的路是先抓住柱子再蹬上去。爬牆那一段本來就寫好了，它只是永遠沒被觸發過：
  // 井底的柱子懸在頭頂上，用跑的碰不到。所以這裡補的是「第一次抓牆」——
  // 算一次彈道，讓身體在越過柱子側面的那一刻剛好貼在它旁邊，之後就交給爬牆邏輯。
  if (bestErr === Infinity) {
    if (!climb) return false;
    const grab = planWallGrab(p, level, dir, vx);
    if (grab === null) return false;   // 抓不到就別跳，停在邊緣總比摔下去好
    if (bot) bot.grab = true;
    return grab;
  }
  return best;
}

/**
 * 「抓住前面那根柱子」要按住跳躍鍵幾格？（抓不到回 null）
 *
 * 判準跟 player.js 的 probeWall 對齊：身體的前緣碰到柱子側面的那一刻，
 * 身體的上下範圍必須跟柱子的側面重疊——那樣 moveX 會把它停在牆面上，
 * probeWall 就認得出 wallDir，滑牆與蹬牆才有得談。
 */
export function planWallGrab(p, level, dir, vx) {
  const y0 = p.y;
  const nose = dir > 0 ? p.x + PLAYER_W : p.x;
  let wall = null;
  level.forEachPlatform(nose - 340, nose + 340, (pl) => {
    if (pl.h < 60) return;                     // 太薄的板子不算牆
    const face = dir > 0 ? pl.x : pl.x + pl.w; // 會撞上的是哪一面
    const d = (face - nose) * dir;
    if (d < 8 || d > 300) return;              // 太近沒得跳，太遠夠不著
    if (pl.y > y0 + 40) return;                // 在腳下的不算
    if (!wall || d < wall.d) wall = { d, top: pl.y, bottom: pl.y + pl.h };
  });
  if (!wall) return null;

  // 貼牆的高度窗口：身體要跟柱子的側面有重疊，上下各留一點餘裕
  const hi = wall.top - PLAYER_H + 8;          // 再高就從柱頂上面飛過去了
  const lo = wall.bottom - 8;                  // 再低就從柱子底下鑽過去了
  let best = null, bestMargin = -1;
  for (let hold = 1; hold <= 60; hold += 1) {
    const y = heightAt(vx, y0, hold, wall.d);
    if (y === null || y > lo || y < hi) continue;
    // 挑「離窗口上下緣最遠」的那一跳：容錯最大
    const margin = Math.min(lo - y, y - hi);
    if (margin > bestMargin) { bestMargin = margin; best = hold; }
  }
  return best;
}

// 按住 hold 格、以 vx 前進，跨出 d 這麼遠的時候身體的 y 在哪（飛不到那麼遠就回 null）
function heightAt(vx, y0, hold, d) {
  let vy = -PHYS.jumpVel, y = y0, x = 0;
  for (let i = 0; i < 500; i++) {
    if (i > 0) {
      vy += PHYS.gravity * STEP;
      if (i === hold && vy < 0) vy *= PHYS.jumpCut;
      if (vy > PHYS.maxFall) vy = PHYS.maxFall;
    }
    y += vy * STEP;
    x += vx * STEP;
    if (x >= d) return y;
  }
  return null;
}

// 不跳、直接從邊緣走下去會前進多少 px
export function simFall(vx, y0, landY) {
  if (landY < y0) return null;
  let vy = 0, y = y0, x = 0;
  for (let i = 0; i < 500; i++) {
    vy += PHYS.gravity * STEP;
    if (vy > PHYS.maxFall) vy = PHYS.maxFall;
    y += vy * STEP;
    x += vx * STEP;
    if (y >= landY) return x;
  }
  return null;
}

// 找到能跨過障礙、而且落點還在同一塊平台上的最小跳躍力道
export function holdForObstacle(vx, y0, obsD, obsW, obsTop, landMax) {
  if (obsD < -PLAYER_W) return null;
  for (let hold = 1; hold <= 60; hold += 1) {
    const r = simJump(vx, y0, hold, { d: obsD, w: obsW, top: obsTop }, y0);
    if (!r.clears || r.landX === null) continue;
    if (r.landX > landMax) continue;
    return hold;
  }
  return null;
}

// 模擬一次跳躍：按住 hold 個 frame。全部在「前進方向的一維座標」上算，跟左右無關。
// obs 非 null 時會檢查有沒有從障礙物上方通過；回傳落到 landY 時前進了多少 px。
export function simJump(vx, y0, hold, obs, landY) {
  let vy = -PHYS.jumpVel, y = y0, x = 0, clears = true;
  // 「落地」是從上面穿過那個高度，不是「現在就在那個高度以下」。
  // 少了這個分辨，目標在頭頂上時（landY 比 y0 小）第一步就會被判成落地，
  // 回報的是最高點的位置——於是「跳不上去」看起來像「跳得到」。
  // 蹬牆井的井底就是這樣：往前看到的是井頂的出口，然後全力往前一跳飛出井外。
  let above = y <= landY;
  for (let i = 0; i < 500; i++) {
    if (i > 0) {
      vy += PHYS.gravity * STEP;
      if (i === hold && vy < 0) vy *= PHYS.jumpCut;
      if (vy > PHYS.maxFall) vy = PHYS.maxFall;
    }
    y += vy * STEP;
    x += vx * STEP;
    if (obs && x > obs.d && x < obs.d + obs.w + PLAYER_W) {
      if (y + PLAYER_H > obs.top - 2) clears = false;
    }
    if (y <= landY) above = true;
    if (above && vy > 0 && y >= landY) return { clears, landX: x };
  }
  return { clears: false, landX: null };
}

// 前方第一個必須跨過去的東西。回傳的 d 是「前進方向上還有多遠」（負的代表已經跨進去了）。
export function obstacleAhead(level, nose, footY, dir = 1) {
  // 地刺與平台的搜尋窗口本來就差一點（-20 對 -8），照抄，不要順手統一
  const lo = dir > 0 ? nose - 20 : nose - 240;
  const hi = dir > 0 ? nose + 240 : nose + 20;
  const plo = dir > 0 ? nose - 8 : nose - 240;
  const phi = dir > 0 ? nose + 240 : nose + 8;
  let obs = null;
  const take = (x, w, top) => {
    const d = dir > 0 ? x - nose : nose - (x + w);
    if (!obs || d < obs.d) obs = { d, w, top };
  };
  level.forEachSpike(lo, hi, (s) => {
    // 往右時只認掃到的第一根（原本的寫法），往左時要取最靠近鼻尖的那一根
    if (dir > 0 && obs) return;
    if (dir > 0 ? s.x + s.w <= nose : s.x >= nose) return;
    if (s.y < footY - 60 || s.y > footY + 10) return;
    take(s.x, s.w, s.y);
  });
  level.forEachPlatform(plo, phi, (pl) => {
    if (pl.h < 60) return;
    if (dir > 0 ? pl.x + pl.w <= nose : pl.x >= nose) return;
    if (pl.y >= footY - 10 || pl.y + pl.h < footY - 10) return;
    take(pl.x, pl.w, pl.y);
  });
  return obs;
}

// 腳下這塊平台在前進方向的那一緣
export function edgeAhead(level, p, footY, dir = 1) {
  let edge = null;
  level.forEachPlatform(p.x - 8, p.x + PLAYER_W + 8, (pl) => {
    if (Math.abs(pl.y - footY) > 2) return;
    if (pl.x + pl.w < p.x || pl.x > p.x + PLAYER_W) return;
    const e = dir > 0 ? pl.x + pl.w : pl.x;
    if (edge === null || (e - edge) * dir > 0) edge = e;
  });
  return edge;
}

// 下一塊可以落腳的平台（跳過當成牆的高塊）
export function nextLanding(level, nose, dir = 1) {
  let found = null;
  const lo = dir > 0 ? nose + 2 : nose - 700;
  const hi = dir > 0 ? nose + 700 : nose - 2;
  level.forEachPlatform(lo, hi, (pl) => {
    if (pl.h >= 60) return;
    if (dir > 0) {
      if (found || pl.x <= nose + 2) return;
      found = pl;
    } else {
      // 往左時 forEachPlatform 還是由左往右掃，所以要一路覆蓋到最靠近鼻尖的那一塊
      if (pl.x + pl.w >= nose - 2) return;
      if (!found || pl.x + pl.w > found.x + found.w) found = pl;
    }
  });
  return found;
}

export function landingAhead(p, level, dir = 1) {
  const footY = p.y + PLAYER_H;
  let land = false;
  const lo = dir > 0 ? p.x - 30 : p.x - 700;
  const hi = dir > 0 ? p.x + PLAYER_W + 700 : p.x + PLAYER_W + 30;
  level.forEachPlatform(lo, hi, (pl) => {
    if (land || pl.y < footY - 6) return;
    if (dir > 0 ? pl.x + pl.w <= p.x : pl.x >= p.x + PLAYER_W) return;
    // 深度上限跟著「掉下去要多久」走：剛爬完一道牆會停在很高的地方，
    // 下面那塊平台可能在 600px 以下，但掉那麼久也早就飄過去了，那才算落點。
    // 寫死一個深度會讓爬完牆的高空誤判成「沒地方落」，白補一次二段跳就飄過頭。
    const t = Math.sqrt((2 * Math.max(0, pl.y - footY)) / PHYS.gravity);
    const reach = 240 + PHYS.runSpeed * t;
    if (dir > 0 ? pl.x <= p.x + PLAYER_W + reach : pl.x + pl.w >= p.x - reach) land = true;
  });
  return land;
}
