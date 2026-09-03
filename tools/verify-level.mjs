// 地形驗證：確認隨機生成的關卡「一定跳得過去」。
// 用法：node tools/verify-level.mjs [幾個seed] [跑多遠px]
//
// 檢查兩件事：
//   1. 幾何檢查 — 每一次跨越的水平距離都在單次跳躍的彈道範圍內。這一關是硬的：
//      沒過就代表關卡真的產生了跳不過去的地方，那是遊戲壞了。
//   2. 機器人試跑 — 用真的物理引擎跑一隻 bot，看它能跑多遠。
//      現在要求全部跑完：bot 會算彈道抓牆、也會用「按住幾格」把每一次蹬牆的高度
//      對到下一根柱子，實測 120 個 seed 跑 6000m、60 個 seed 跑 10000m 都是全通。
//      有 seed 跑不完就代表有東西真的變了（物理參數、地形生成、或 bot 自己）。
import { Level, maxGapForRise } from '../public/src/level.js';
import { Player } from '../public/src/player.js';
// 機器人的腦搬到 public/src/bot.js 了（NPC 也用同一顆）。這裡永遠傳預設的 dir=+1，
// 行為必須跟搬家前逐字相同——改動 bot.js 之後請比對這支工具印出來的四個數字。
import { makeBot, makeInput, act } from '../public/src/bot.js';

const PASS_RATE = 1;   // 完跑率的門檻。見檔頭：現在是「一個都不能少」
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
console.log(`  跑完全程：${reached}/${SEEDS}（${(reached / SEEDS * 100).toFixed(0)}%，門檻 ${PASS_RATE * 100}%）`);
console.log(`  最短 ${dists[0]}m / 中位 ${dists[dists.length >> 1]}m / 最長 ${dists[dists.length - 1]}m`);
const fails = results.filter((r) => r.dist * 10 < RUN_TO * 0.999).slice(0, 5);
for (const f of fails) console.log(`  ✗ seed ${f.seed} 卡在 ${f.dist}m（${f.reason}）`);

const rateOK = reached >= SEEDS * PASS_RATE;
if (!rateOK) console.log(`  ✗ 完跑率低於 ${PASS_RATE * 100}%`);
process.exit(geomFail === 0 && rateOK ? 0 : 1);

// ── 機器人：一直往右跑，靠彈道預測決定「跳多高」──────────
// （跟真人一樣只能用左右+跳三個輸入，跑的是同一套 player.js 物理）
function runBot(level, runTo) {
  const p = new Player(level);
  const input = makeInput();
  input.right = true;
  let t = 0, stuckAt = p.x, stuckT = 0;
  const bot = makeBot();

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
