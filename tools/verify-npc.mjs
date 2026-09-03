// NPC 驗證：確認遊蕩的 NPC 不會走丟，而且所有人看到的是同一件事。
// 用法：node tools/verify-npc.mjs [幾個seed] [跑幾秒]
//
// 檢查四件事：
//   1. 同步   — 從第 0 秒就在的人，跟中途才進房的人，算出來的位置必須完全相同
//   2. 不走丟 — 待機的時候一定站在地形上，不會掉出世界，也不會一直卡在原地
//   3. 走得到 — 每一段躍遷都要在 2 秒的移動窗口內站上目標（失敗率要夠低）
//   4. 定居   — 買下來的 NPC 只在原本那塊板子上走動，而且再也不跳
//   5. 柱頂   — 站在地板上的矮牆，NPC 要跳得上去（那是 planPost 那套彈道的用武之地）
import { Level } from '../public/src/level.js';
import { NpcPool, NPC, SPACING } from '../public/src/npc.js';
import { PHYS, PLAYER_H } from '../public/src/constants.js';

const SEEDS = Number(process.argv[2] || 12);
const RUN_S = Number(process.argv[3] || 300);
const STEP = 1 / 120;
const LATE_S = 120;      // 「中途進房的人」從第幾秒開始算
const MISS_LIMIT = 0.06; // 允許的躍遷失敗率

let bad = 0;
const fail = (msg) => { if (bad++ < 8) console.log('  ✗ ' + msg); };

let hops = 0, misses = 0, stuckSlots = 0, slots = 0, maxDrift = 0;

for (let s = 0; s < SEEDS; s++) {
  const seed = (0x9e3779b1 * (s + 1)) >>> 0;
  const focus = SPACING / 2;              // 鏡頭停在第一隻的家附近

  const early = makePool(seed);
  const late = makePool(seed);            // 同一個房間，但這一份要到 LATE_S 才開始跑
  let t = 0;
  let lastSpot = null, sameSpot = 0;

  while (t < RUN_S) {
    t += STEP;
    early.update(focus, STEP, t);
    if (t >= LATE_S) late.update(focus, STEP, t);

    const tIn = t - Math.floor(t / NPC.slot) * NPC.slot;
    const idle = tIn > NPC.move + 1;      // 待機段的後半：兩邊都該完全對齊了
    if (!idle) continue;

    for (const a of early.list()) {
      // ── 2. 不走丟 ──
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) { fail(`seed ${seed} #${a.i} 座標壞了`); continue; }
      if (a.y + PLAYER_H > PHYS.respawnY) fail(`seed ${seed} #${a.i} 待機時掉在世界外 y=${a.y | 0}`);
      if (!a.p.grounded) fail(`seed ${seed} #${a.i} 待機時沒站在地上`);

      // ── 1. 同步 ──
      if (t < LATE_S + NPC.slot * 2) continue;
      const b = late.list().find((n) => n.i === a.i);
      if (!b) { fail(`seed ${seed} #${a.i} 晚進來的人看不到牠`); continue; }
      const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      if (d > maxDrift) maxDrift = d;
      if (d > 1e-9) fail(`seed ${seed} #${a.i} t=${t.toFixed(1)} 兩邊差了 ${d.toFixed(3)}px`);
    }
  }

  // ── 3. 走得到 / 有在動 ──
  for (const n of early.list()) { hops += n.hops; misses += n.misses; }
  const spots = new Set();
  for (let k = 0; k < 40; k++) {
    const sp = early.freeChain(0).at(Math.floor(RUN_S / NPC.slot) + k);
    if (sp) spots.add(Math.round(sp.x) + ':' + Math.round(sp.y));
  }
  slots += spots.size;
  if (spots.size < 3) { stuckSlots++; fail(`seed ${seed} #0 四十個時槽只走過 ${spots.size} 個落腳點`); }

  // ── 4. 定居 ──
  const owned = makePool(seed);
  let ot = 0;
  while (ot < 20) { ot += STEP; owned.update(focus, STEP, ot); }
  const n0 = owned.list()[0];
  if (!n0) { fail(`seed ${seed} 第一隻沒生出來`); continue; }
  const plat = n0.target.p;
  const slot = Math.floor(ot / NPC.slot);
  owned.setOwner({ i: n0.i, name: '買家', slot, x: plat.x + plat.w / 2, y: plat.y });
  // 成交的那一槽牠可能還在半路上（正走向那塊板子），從下一槽才開始算
  const settled = (slot + 1) * NPC.slot;
  let jumped = false, leftPlat = false;
  while (ot < 20 + 120) {
    ot += STEP;
    owned.update(focus, STEP, ot);
    if (ot < settled) continue;
    const n = owned.list().find((q) => q.i === n0.i);
    if (!n || !n.ready) continue;
    if (n.p.vy < -1) jumped = true;
    if (n.cx < plat.x - 2 || n.cx > plat.x + plat.w + 2 || Math.abs(n.y + PLAYER_H - plat.y) > 2) leftPlat = true;
  }
  if (jumped) fail(`seed ${seed} #${n0.i} 買下來之後還在跳`);
  if (leftPlat) fail(`seed ${seed} #${n0.i} 買下來之後離開了那塊板子`);
}

// ── 5. 柱頂 ──
// 蹬牆井裡的細柱本來就上不去（那是設計給蹬牆用的，NPC 不會蹬牆），鏈會自己不選它。
// 這裡驗的是「站在地板上的矮牆」——那種柱頂 NPC 就該站得上去。
let posts = 0, postOk = 0;
for (let s = 0; s < SEEDS && posts < 12; s++) {
  const seed = (0x9e3779b1 * (s + 1)) >>> 0;
  const lvl = new Level(seed);
  lvl.ensure(30000);
  const pool = new NpcPool(seed, lvl);
  for (const post of lvl.platforms) {
    if (posts >= 12) break;
    if (!(post.w <= 40 && post.h >= 60 && post.h <= 130)) continue;
    const floor = lvl.platforms.find((p) => p.h < 60 && p.w > 200 &&
      p.x < post.x && p.x + p.w > post.x + post.w && Math.abs(p.y - (post.y + post.h)) < 40);
    if (!floor) continue;
    posts++;
    const from = { x: Math.max(floor.x + 40, post.x - 260), y: floor.y, p: floor };
    const to = { x: post.x + post.w / 2, y: post.y, p: post };
    if (pool.tryHop(from, to)) postOk++;
    else fail(`seed ${seed} 跳不上 x=${post.x | 0} 的矮牆（高 ${post.h | 0}）`);
  }
}

function makePool(seed) {
  const lvl = new Level(seed);
  const pool = new NpcPool(seed, lvl);
  pool.t0 = 0;
  pool.offset = 0;
  return pool;
}

const missRate = hops ? misses / hops : 0;
console.log('');
console.log(`NPC 驗證：${SEEDS} 個 seed × ${RUN_S}s`);
console.log(`  同步：早進與晚進的人最大差距 ${maxDrift.toFixed(6)}px`);
console.log(`  躍遷：${hops} 段，其中 ${misses} 段沒走到（${(missRate * 100).toFixed(2)}%）`);
console.log(`  柱頂：${posts} 根站得住的矮牆，跳得上去 ${postOk} 根`);
console.log(`  走動：第一隻在 40 個時槽內平均踩過 ${(slots / SEEDS).toFixed(1)} 個落腳點（少於 3 個算卡住：${stuckSlots}）`);
console.log(bad === 0 ? '  ✓ 全部通過' : `  ✗ ${bad} 個問題`);

const ok = bad === 0 && missRate <= MISS_LIMIT && stuckSlots === 0 && postOk === posts;
if (!ok && missRate > MISS_LIMIT) console.log(`  ✗ 躍遷失敗率超過 ${(MISS_LIMIT * 100).toFixed(0)}%`);
process.exit(ok ? 0 : 1);
