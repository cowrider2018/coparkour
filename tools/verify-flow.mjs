/* ── tools/verify-flow.mjs ───────────────────────────────────────────
   /test/?mode=flow 的離線驗證：路線表（public/test/src/route.js）接不接得上。

   路線錯了的樣子是「玩到一半卡死」：某一步少開一扇門，玩家就被關在一張圖裡，
   只剩重玩；多開一扇，就走得到還沒輪到的那一場。兩種都要實際走一遍才會發現，
   所以這裡把遺跡砌一遍，把感測區當成一張圖（房間是點、感測區是單向的邊），
   照每一步的門走走看。

     1. 站位      每一隻怪物站在自己那一場的房間裡、黑牆裡面、腳下那一層地板
                  就是站位的高度、沒有嵌在任何碰撞盒裡。
     2. 觸發      每一條進得了那一場的路（送進那個房間的感測區），到達點都在
                  觸發範圍裡——一進門就開打；休息點（與起點）都在外面。兵營是
                  例外：起點就在兵營裡，往城門走一段才開打，怪物站在那一段裡。
     3. 休息點    每一場的休息點與入口都找得到，休息點不在那一場的房間裡（兵營
                  除外，同上），面朝入口，而且從休息點照當時的門走得回那一場。
     4. 往下一場  第 k 場打完，照那時的門走得到第 k + 1 場、走不到更後面任何一場
                  （墓室打完是直接送到下一場的休息點，從那裡走）；
                  打的時候哪裡都去不了（門全關、傳送全不通）；全部打完之後
                  每一個房間都走得到。

   房間裡面走不走得通不在這裡驗——那是 verify:terrain 的事（每張圖從出生點
   真的走到中心、感測區都踩得到）。這裡只驗房間與房間之間。

   跑法：node tools/verify-flow.mjs
   ------------------------------------------------------------------ */

import { buildRuins, BLOCKS } from '../public/test/src/blocks.js';
import { PHYS, arenaGap, solveXZ, supportInfo } from '../public/test/src/walk.js';
import {
  STAGES, OPEN, START, roomOf, foesOf, inStage, makeRun, doorsFor, portalsOn, restAt,
} from '../public/test/src/route.js';

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok ' : ' FAIL'} ${msg}`);
  if (!cond) fails++;
};

const ruins = buildRuins();
const COLS = ruins.colliders;
const arenaOf = (id) => ruins.arenas.find((a) => a.id === id);
const shut = Object.fromEntries(Object.keys(ruins.doors).map((d) => [d, false]));

/* 感測區 → 邊：從哪個房間（感測區的底在哪一層）送到哪個房間（到達點在哪一層）。 */
const edges = ruins.portals.map((p) => ({
  p, from: roomOf(p.block, p.y0 + 0.5), to: roomOf(p.dest.block, p.dest.y),
}));

/**
 * 照這一組門與傳送開關，從 `start` 走得到的房間。`stop` 是走進去就停的房間：下一場的
 * 房間一走進去就開打、門全關，不會從那裡再走到別處（窄巷的井就在窄巷這一場裡）。
 */
function reach(start, doors, portals, stop = null) {
  const seen = new Set([start]), todo = [start];
  while (todo.length) {
    const r = todo.pop();
    if (!portals || (r === stop && r !== start)) continue;
    for (const e of edges) {
      if (e.from !== r || (e.p.door && !doors[e.p.door]) || seen.has(e.to)) continue;
      seen.add(e.to);
      todo.push(e.to);
    }
  }
  return seen;
}

/* ── 1. 站位 ─────────────────────────────────────────────────── */
console.log('1. 站位');
STAGES.forEach((s, k) => {
  const block = s.room.split(':')[0];
  foesOf(k).forEach((b, i) => {
    const gap = arenaGap(arenaOf(block), b.x, b.z);
    const floor = supportInfo(COLS, b.x, b.z, b.y + 0.3).y;
    const [sx, sz] = solveXZ(COLS, b.x, b.z, b.y, shut);
    ok(roomOf(block, b.y) === s.room && gap > PHYS.radius && Math.abs(floor - b.y) < 1e-6
      && Math.hypot(sx - b.x, sz - b.z) < 1e-6,
    `${s.name}：第 ${i + 1} 隻（${b.kind}）在房間裡、離黑牆 ${gap.toFixed(1)}、腳下 ${floor.toFixed(2)}、沒嵌進東西`);
  });
});

/* ── 2. 觸發 ─────────────────────────────────────────────────── */
console.log('2. 觸發');
STAGES.forEach((s, k) => {
  if (s.enter) {
    // 房間裡還要再走一段才開打（兵營：起點就在這個房間裡）。怪物要站在那一段裡。
    ok(foesOf(k).every((b) => inStage(k, s.room.split(':')[0], b.x, b.y, b.z)), `${s.name}：走進房間裡那一段才開打，怪物都站在那一段裡`);
  } else {
    const ins = edges.filter((e) => e.to === s.room && e.from !== s.room);
    const bad = ins.filter((e) => !inStage(k, e.p.dest.block, e.p.dest.x, e.p.dest.y, e.p.dest.z));
    ok(ins.length > 0 && bad.length === 0,
      `${s.name}：${ins.length} 條進來的路，到達點都在觸發範圍裡${bad.length ? `（不在：${bad.map((e) => e.p.to).join('、')}）` : ''}`);
  }
  const r = restAt(k, ruins);
  ok(!inStage(k, r.block, r.x, r.y, r.z), `${s.name}：休息點（${s.rest}）在觸發範圍外面`);
});
{
  const a = ruins.arrivals[START];
  ok(!STAGES.some((_, k) => inStage(k, a.block, a.x, a.y, a.z)), `起點（${START}）不在任何一場的觸發範圍裡`);
  const spawn = ruins.spawns.wallwalk;
  ok(inStage(0, 'wallwalk', spawn[0], spawn[1], spawn[2]), '從起點往城門走（兵營的出生點）就進了第一場');
}

/* ── 3. 休息點 ───────────────────────────────────────────────── */
console.log('3. 休息點');
STAGES.forEach((s, k) => {
  const r = restAt(k, ruins);
  const home = roomOf(r.block, r.y);
  const back = reach(home, doorsFor(makeRun(k)), portalsOn(makeRun(k)));
  // 第一場沒有入口：休息點就是起點，在同一個房間裡、觸發範圍外面（見 2.）。
  ok((home !== s.room || !s.entry) && back.has(s.room), `${s.name}：在 ${s.rest}（${home}）休息，走得回去`);
  if (s.entry) {
    const p = ruins.portals.find((q) => q.block === s.entry.from && q.to === s.entry.to);
    const [cx, cz] = p.shape === 'box' ? [(p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2] : [p.x, p.z];
    const face = Math.cos(r.yaw) * (cz - r.z) + Math.sin(r.yaw) * (cx - r.x);
    ok(face > 0, `${s.name}：休息的時候面朝入口`);
  }
});

/* ── 4. 往下一場 ─────────────────────────────────────────────── */
console.log('4. 往下一場');
ok(OPEN.length === STAGES.length, `每一場都有一組門（${OPEN.length} 組、${STAGES.length} 場）`);
{
  const first = reach(roomOf(ruins.arrivals[START].block, ruins.arrivals[START].y), doorsFor(makeRun(0)), true);
  ok(first.has(STAGES[0].room) && STAGES.slice(1).every((s) => !first.has(s.room)),
    `一開始：只到得了${STAGES[0].name}（${[...first].join('、')}）`);
}
STAGES.forEach((s, k) => {
  const fighting = { next: k, active: true };
  const stuck = reach(s.room, doorsFor(fighting), portalsOn(fighting));
  ok(stuck.size === 1 && Object.values(doorsFor(fighting)).every((o) => !o), `${s.name}：打的時候門全關、哪裡都去不了`);
  const after = makeRun(k + 1);
  const to = s.warp && restAt(k + 1, ruins);
  const next = k + 1 < STAGES.length ? STAGES[k + 1].room : null;
  const got = reach(to ? roomOf(to.block, to.y) : s.room, doorsFor(after), portalsOn(after), next);
  if (k + 1 < STAGES.length) {
    const early = STAGES.slice(k + 2).filter((t) => got.has(t.room) && t.room !== STAGES[k + 1].room);
    ok(got.has(STAGES[k + 1].room) && early.length === 0,
      `${s.name}打完${s.warp ? `（送到 ${STAGES[k + 1].rest}）` : ''}：走得到${STAGES[k + 1].name}${early.length ? `，也走得到 ${early.map((t) => t.name).join('、')}` : '、走不到更後面的'}`);
  } else {
    const all = new Set([...BLOCKS.map((b) => b.id), 'wallwalk:top']);
    ok([...all].every((r) => got.has(r)), `${s.name}打完：全部的門都開，${all.size} 個房間都走得到`);
  }
});

console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
