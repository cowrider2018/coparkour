// 地形驗證：確認隨機生成的關卡「一定跳得過去」。
// 用法：node tools/verify-level.mjs [幾個seed] [跑多遠px]
//
// 檢查兩件事：
//   1. 幾何檢查 — 每一次跨越的水平距離都在單次跳躍的彈道範圍內
//   2. 機器人試跑 — 用真的物理引擎跑一隻無腦 bot，看它能跑多遠
import { Level, maxGapForRise } from '../public/src/level.js';
import { Player } from '../public/src/player.js';
import { PHYS, PLAYER_W, PLAYER_H } from '../public/src/constants.js';

const SEEDS = Number(process.argv[2] || 40);
const RUN_TO = Number(process.argv[3] || 30000);
const STEP = 1 / 120;
const TRACE_N = Number(process.env.TRACE) > 1 ? Number(process.env.TRACE) : 200;

let geomFail = 0;
const results = [];

for (let s = 0; s < SEEDS; s++) {
  const seed = process.env.ONLY_SEED ? Number(process.env.ONLY_SEED) >>> 0 : (0x9e3779b1 * (s + 1)) >>> 0;
  const lvl = new Level(seed);
  lvl.ensure(RUN_TO + 3000);

  // ── 1. 幾何檢查 ──
  for (const j of lvl.jumps) {
    // kind:'wall' 的段落本來就不是一次跳躍跨過去的（蹬牆井、閘門柱），
    // 彈道公式對它沒有意義，改由下面的機器人試跑來驗。
    if (j.kind === 'wall') continue;
    const limit = maxGapForRise(Math.max(0, j.rise));
    if (!(j.gap <= limit + 1e-6) || !Number.isFinite(j.gap) || !Number.isFinite(j.toY)) {
      geomFail++;
      if (geomFail < 6) console.log(`  ✗ seed ${seed} x=${j.toX|0} gap=${j.gap.toFixed(1)} rise=${j.rise.toFixed(1)} limit=${limit.toFixed(1)}`);
    }
  }

  // 排序檢查（前端用二分搜尋查詢，陣列必須依 x 遞增）
  for (const [nm, arr] of [['platforms', lvl.platforms], ['spikes', lvl.spikes], ['coins', lvl.coins]]) {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].x < arr[i - 1].x) { console.log(`  ✗ ${nm} 未排序 @${i} (seed ${seed})`); geomFail++; break; }
    }
  }

  // ── 2. 機器人試跑 ──
  const r = runBot(new Level(seed), RUN_TO);
  results.push(r);
}

const dists = results.map((r) => r.dist).sort((a, b) => a - b);
const reached = results.filter((r) => r.dist * 10 >= RUN_TO * 0.999).length;

console.log('');
console.log(`幾何檢查：${geomFail === 0 ? '✓ 全部通過' : `✗ ${geomFail} 個問題`}  (${SEEDS} 個 seed)`);
console.log(`機器人試跑：目標 ${RUN_TO / 10}m`);
console.log(`  跑完全程：${reached}/${SEEDS}`);
console.log(`  最短 ${dists[0]}m / 中位 ${dists[dists.length >> 1]}m / 最長 ${dists[dists.length - 1]}m`);
const fails = results.filter((r) => r.dist * 10 < RUN_TO * 0.999).slice(0, 5);
for (const f of fails) console.log(`  ✗ seed ${f.seed} 卡在 ${f.dist}m（${f.reason}）`);

process.exit(geomFail === 0 && reached === SEEDS ? 0 : 1);

// ── 機器人：一直往右跑，靠彈道預測決定「跳多高」──────────
// （跟真人一樣只能用左右+跳三個輸入，跑的是同一套 player.js 物理）
function runBot(level, runTo) {
  const p = new Player(level);
  // Player 讀的是 axis / jumpHeld（鍵盤與水球共用的介面），bot 照樣只設 left/right/jump
  const input = {
    left: false, right: true, jump: false,
    get axis() { return (this.right ? 1 : 0) - (this.left ? 1 : 0); },
    get jumpHeld() { return this.jump; },
  };
  let t = 0, stuckAt = p.x, stuckT = 0;
  const bot = { hold: 0, frame: 999, climb: false, steer: 1, wjCool: 0 };

  const trace = process.env.TRACE ? [] : null;
  while (!p.dead && p.x < runTo && t < 900) {
    act(p, level, bot, input);
    p.update(STEP, input);
    bot.frame++;
    t += STEP;
    if (trace) {
      trace.push(`x=${p.x.toFixed(0)} y=${p.y.toFixed(0)} vx=${p.vx.toFixed(0)} vy=${p.vy.toFixed(0)} g=${p.grounded ? 1 : 0} w=${p.wallDir} J=${input.jump ? 1 : 0} c=${bot.climb ? 1 : 0} s=${bot.steer} hold=${bot.hold} f=${bot.frame} aj=${p.airJumps}`);
      if (trace.length > TRACE_N) trace.shift();
    }

    if (p.x > stuckAt + 2) { stuckAt = p.x; stuckT = 0; }
    else {
      stuckT += STEP;
      if (stuckT > 4) {
        if (trace) console.log(trace.slice(-TRACE_N).join('\n'));
        return { seed: level.seed, dist: p.dist, reason: '卡住' };
      }
    }
  }
  if (trace && p.dead) console.log(trace.slice(-TRACE_N).join('\n'));
  return { seed: level.seed, dist: p.dist, reason: p.dead ? p.deadReason : t >= 900 ? '逾時' : 'ok' };
}

function act(p, level, bot, input) {
  if (bot.wjCool > 0) bot.wjCool--;
  steer(input, 1); // 預設一路往右

  if (p.grounded) {
    bot.climb = false;
    const want = decide(p, level);
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
  if (p.wallDir !== 0) {
    const top = wallTop(level, p, p.wallDir);
    if (bot.climb || (top !== null && top < p.y - 60)) {
      bot.climb = true;
      // 貼上牆的瞬間還在上升，這時蹬掉就白費了剩下的上升高度。
      // 先貼著牆滑到最高點（vy 轉正）再蹬，一次才吃得滿 WALL_RISE。
      if (bot.wjCool === 0 && p.vy > -60) {
        // 對面也有牆 → 蹬過去（蹬牆井）；只有單面牆 → 蹬完再貼回同一面，
        // 一次磨高一點，直到爬過柱頂（閘門柱）。
        bot.steer = hasOpposingWall(level, p, -p.wallDir, 260) ? -p.wallDir : p.wallDir;
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
  if (bot.climb) steer(input, bot.steer);

  // 空中：按住跳躍鍵到預定的 frame 數（決定這一跳的高度）
  if (bot.frame < bot.hold) { input.jump = true; return; }
  // 掉下去又沒落點 → 補二段跳（全力）
  if (p.vy > 40 && p.airJumps > 0 && !landingAhead(p, level)) {
    p.queueJump();
    bot.hold = bot.frame + 60;
    input.jump = true;
    return;
  }
  input.jump = false;
}

function steer(input, dir) {
  input.right = dir > 0;
  input.left = dir < 0;
}

// 現在貼著的那面高牆的頂端 y（沒貼著牆就回 null）
function wallTop(level, p, dir, reach = 6) {
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
function hasOpposingWall(level, p, dir, dist) {
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

// 在地面上時決定要不要跳、以及要按住幾個 frame（false = 不跳）
function decide(p, level) {
  const footY = p.y + PLAYER_H;
  const nose = p.x + PLAYER_W;
  const vx = Math.max(200, Math.abs(p.vx));
  const edge = edgeAhead(level, p, footY);

  // ① 前方障礙物（地刺或高塊）：算出「剛好跨得過去又落得回平台」的跳法
  const obs = obstacleAhead(level, nose, footY);
  if (obs && obs.x - nose < 200) {
    const landMax = edge === null ? Infinity : edge - nose - 24;
    const now = holdForObstacle(vx, p.y, obs.x - nose, obs.w, obs.top, landMax);
    if (now !== null) {
      // 等到「再晚一點就跨不過去」的那一刻才起跳，這樣落點最遠
      const later = holdForObstacle(vx, p.y, obs.x - nose - vx * STEP * 2, obs.w, obs.top, landMax - vx * STEP * 2);
      if (later === null) return now;
    } else if (obs.x - nose < 30) {
      return 60; // 已經來不及精算了，全力一跳
    }
  }

  // ② 快到平台邊緣 → 先看「直接走下去」會不會剛好落在下一塊平台上
  if (edge === null || edge - nose > 14) return false;
  const target = nextLanding(level, nose);
  if (!target) return 60;
  const landY = target.y - PLAYER_H;

  const fall = simFall(vx, p.y, landY);
  if (fall !== null && nose + fall > target.x + 10 && nose + fall < target.x + target.w - 10) return false;

  // 不然就挑一個落點最接近平台前段的跳法
  const wantX = target.x + Math.min(46, target.w * 0.45);
  let best = 60, bestErr = Infinity;
  for (let hold = 1; hold <= 60; hold += 1) {
    const r = simJump(vx, p.y, hold, null, landY);
    if (r.landX === null) continue;
    const err = Math.abs(nose + r.landX - wantX);
    if (err < bestErr) { bestErr = err; best = hold; }
  }
  return best;
}

// 不跳、直接從邊緣走下去會前進多少 px
function simFall(vx, y0, landY) {
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
function holdForObstacle(vx, y0, obsD, obsW, obsTop, landMax) {
  if (obsD < -PLAYER_W) return null;
  for (let hold = 1; hold <= 60; hold += 1) {
    const r = simJump(vx, y0, hold, { d: obsD, w: obsW, top: obsTop }, y0);
    if (!r.clears || r.landX === null) continue;
    if (r.landX > landMax) continue;
    return hold;
  }
  return null;
}

// 模擬一次跳躍：按住 hold 個 frame。
// obs 非 null 時會檢查有沒有從障礙物上方通過；回傳落到 landY 時前進了多少 px。
function simJump(vx, y0, hold, obs, landY) {
  let vy = -PHYS.jumpVel, y = y0, x = 0, clears = true;
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
    if (vy > 0 && y >= landY) return { clears, landX: x };
  }
  return { clears: false, landX: null };
}

// 前方第一個必須跨過去的東西
function obstacleAhead(level, nose, footY) {
  let obs = null;
  level.forEachSpike(nose - 20, nose + 240, (s) => {
    if (obs || s.x + s.w <= nose) return;
    if (s.y < footY - 60 || s.y > footY + 10) return;
    obs = { x: s.x, w: s.w, top: s.y };
  });
  level.forEachPlatform(nose - 8, nose + 240, (pl) => {
    if (pl.h < 60 || pl.x + pl.w <= nose) return;
    if (pl.y >= footY - 10 || pl.y + pl.h < footY - 10) return;
    if (!obs || pl.x < obs.x) obs = { x: pl.x, w: pl.w, top: pl.y };
  });
  return obs;
}

// 腳下這塊平台的右緣
function edgeAhead(level, p, footY) {
  let edge = null;
  level.forEachPlatform(p.x - 8, p.x + PLAYER_W + 8, (pl) => {
    if (Math.abs(pl.y - footY) > 2) return;
    if (pl.x + pl.w < p.x || pl.x > p.x + PLAYER_W) return;
    if (edge === null || pl.x + pl.w > edge) edge = pl.x + pl.w;
  });
  return edge;
}

// 下一塊可以落腳的平台（跳過當成牆的高塊）
function nextLanding(level, nose) {
  let found = null;
  level.forEachPlatform(nose + 2, nose + 700, (pl) => {
    if (found || pl.h >= 60 || pl.x <= nose + 2) return;
    found = pl;
  });
  return found;
}

function landingAhead(p, level) {
  const footY = p.y + PLAYER_H;
  let land = false;
  level.forEachPlatform(p.x - 30, p.x + PLAYER_W + 700, (pl) => {
    if (land || pl.y < footY - 6 || pl.x + pl.w <= p.x) return;
    // 深度上限跟著「掉下去要多久」走：剛爬完一道牆會停在很高的地方，
    // 下面那塊平台可能在 600px 以下，但掉那麼久也早就飄過去了，那才算落點。
    // 寫死一個深度會讓爬完牆的高空誤判成「沒地方落」，白補一次二段跳就飄過頭。
    const t = Math.sqrt((2 * Math.max(0, pl.y - footY)) / PHYS.gravity);
    if (pl.x <= p.x + PLAYER_W + 240 + PHYS.runSpeed * t) land = true;
  });
  return land;
}
