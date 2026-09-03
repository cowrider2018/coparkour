// NPC 的成本驗證：確認沒有任何一幀會被 NPC 拖垮。
// 用法：node tools/verify-perf.mjs
//
// 這一支主要驗的是「有沒有路徑繞過每幀的預算」——那是用計數驗的，跟機器快慢無關；
// 時間只印出來參考，因為 CI 的機器有多慢是沒得保證的。
//
// 會踩到的坑長這樣：一間開了三小時的房，新加入的人得從錨點重播兩千個時槽才知道
// 那隻貓現在站在哪。全部擠在一幀裡就是一次掉幀，而且正好是「貓出現」的那一幀。
import { Level } from '../public/src/level.js';
import { NpcPool, NPC, SPACING } from '../public/src/npc.js';

const STEP = 1 / 120;
const MAX_STEPS = NPC.catchup;   // 一幀最多推進幾個時槽
// 時間只是參考：CI 的機器有多慢、有沒有在別的事情上忙，都不是這裡管得到的。
// 真正的把關是上面那個步數——它跟機器快慢無關。門檻放得很寬，只擋「明顯壞掉」。
const SLOW_MS = 60;

let bad = 0;
const fail = (m) => { console.log('  ✗ ' + m); bad++; };
const mk = (seed, hours) => {
  const lvl = new Level(seed);
  const pool = new NpcPool(seed, lvl);
  pool.t0 = 0;
  return { pool, t: (hours || 0) * 3600 };
};

const report = [];
function run(name, hours, frames, moving, warm) {
  // 每個案例都先跑一輪丟掉：不暖機的話量到的是 V8 的編譯時間，不是這段程式的成本
  if (!warm) run(name, hours, Math.min(frames, 400), moving, true);
  const seeds = [0x9e3779b1, 0x85ebca6b, 0xc2b2ae35];
  let worstMs = 0, worstSteps = 0, appeared = -1, slowFrames = 0;
  for (const seed of seeds) {
    const { pool, t: t0 } = mk(seed >>> 0, hours);
    let t = t0, x = SPACING / 2;
    for (let f = 0; f < frames; f++) {
      t += STEP;
      if (moving) x += 385 * STEP;
      pool.steps = 0;
      const a = performance.now();
      pool.update(x, STEP, t);
      const ms = performance.now() - a;
      if (ms > worstMs) worstMs = ms;
      if (ms > SLOW_MS) slowFrames++;
      if (pool.steps > worstSteps) worstSteps = pool.steps;
      // 這裡不能用 pool.list()：它每次都配置一個陣列，一萬幀下來製造的垃圾
      // 會讓 GC 的暫停算到被測的程式頭上（第一次寫這支工具就被這樣騙過一次）
      if (appeared < 0 && pool.map.size) {
        for (const n of pool.map.values()) if (n.ready) { appeared = f; break; }
      }
    }
  }
  if (warm) return;
  report.push([name, worstMs, worstSteps, appeared]);
  if (worstSteps > MAX_STEPS) {
    fail(`${name}：一幀推進了 ${worstSteps} 個時槽，超過預算 ${MAX_STEPS}——有路徑繞過了 pool.fuel`);
  }
  if (slowFrames) fail(`${name}：有 ${slowFrames} 幀超過 ${SLOW_MS}ms`);
}

run('冷啟動（新房間）', 0, 600, false);
run('進入開了一小時的房', 1, 600, false);
run('進入開了三小時的房', 3, 600, false);
run('三小時的房 + 一路往前跑', 3, 120 * 60, true);

// 柱頂計畫：算過就要記得，不然同一段躍遷每次都重算
for (const warm of [true, false]) {
  const lvl = new Level(0x9e3779b1 >>> 0);
  lvl.ensure(30000);
  const pool = new NpcPool(0x9e3779b1 >>> 0, lvl);
  let cold = 0, again = 0, n = 0;
  for (const post of lvl.platforms) {
    if (n >= 8) break;
    if (!(post.w <= 40 && post.h >= 60 && post.h <= 130)) continue;
    const floor = lvl.platforms.find((p) => p.h < 60 && p.w > 200 &&
      p.x < post.x && p.x + p.w > post.x + post.w && Math.abs(p.y - (post.y + post.h)) < 40);
    if (!floor) continue;
    const from = { x: Math.max(floor.x + 40, post.x - 260), y: floor.y, p: floor };
    const to = { x: post.x + post.w / 2, y: post.y, p: post };
    let a = performance.now(); pool.cache.plan(from, to); cold += performance.now() - a;
    a = performance.now(); pool.cache.plan(from, to); again += performance.now() - a;
    n++;
  }
  if (warm) continue;                 // 第一輪只是暖機
  if (n && again > cold * 0.2) fail(`柱頂計畫沒有被記住：第一次 ${cold.toFixed(2)}ms、第二次 ${again.toFixed(2)}ms`);
  report.push(['柱頂計畫（' + n + ' 段，第一次 / 記過之後）', cold / Math.max(1, n), null, -1,
    again / Math.max(1, n)]);
}

console.log('');
console.log('NPC 成本：');
for (const [name, ms, steps, appeared, warm] of report) {
  const bits = [`最慢一幀 ${ms.toFixed(2)}ms`];
  if (steps !== null && steps !== undefined) bits.push(`單幀最多推進 ${steps}/${MAX_STEPS} 個時槽`);
  if (appeared >= 0) bits.push(`第 ${appeared} 幀看到貓`);
  if (appeared === -1 && steps === null) { /* 柱頂那一列沒有「看到貓」可言 */ }
  if (warm !== undefined) bits.push(`記過之後 ${warm.toFixed(3)}ms`);
  console.log('  ' + name.padEnd(22) + bits.join('　'));
}
console.log(bad === 0 ? '  ✓ 全部通過' : `  ✗ ${bad} 個問題`);
process.exit(bad === 0 ? 0 : 1);
