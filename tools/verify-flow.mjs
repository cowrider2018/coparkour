/* ── tools/verify-flow.mjs ───────────────────────────────────────────
   /test/?mode=flow 的離線驗證：路線表（public/test/src/route.js）接不接得上。

   路線錯了的樣子是「玩到一半卡死」：某一步少開一扇門，玩家就被關在一張圖裡，
   只剩重玩；多開一扇，就走得到還沒輪到的那一場。兩種都要實際走一遍才會發現，
   所以這裡把遺跡砌一遍，把感測區當成一張圖（房間是點、感測區是單向的邊），
   照每一步的門走走看。

     1. 站位      每一隻怪物站在自己那一場的房間裡、黑牆裡面、腳下那一層地板
                  就是站位的高度、沒有嵌在任何碰撞盒裡。墓室的六隻一具石棺一隻、站在棺蓋上、
                  從棺材裡升上來；最北（末端）那兩隻是幽靈騎士，其餘四隻是幽靈。
     2. 觸發      每一條進得了那一場的路（送進那個房間的感測區），到達點都在
                  觸發範圍裡——一進門就開打；休息點（與起點）都在外面。兵營是
                  例外：起點就在兵營裡，往城門走一段才開打，怪物站在那一段裡。
     3. 休息點    每一場的休息點與入口都找得到，休息點不在那一場的房間裡（兵營
                  除外，同上），面朝入口，而且從休息點照當時的門走得回那一場。
     4. 往下一場  第 k 場打完，照那時的門走得到第 k + 1 場、走不到更後面任何一場
                  （墓室打完是直接送到下一場的休息點，從那裡走）；
                  打的時候哪裡都去不了（門全關、傳送全不通）；全部打完之後
                  每一個房間都走得到。門跟模式一樣每進一個房間重算（只開往前的那一步）。
     5. 靈魂      一輪掉得出幾顆靈魂（route.js 的 SOULS，國王要收的數）＝每一場會掉靈魂的怪物
                  一隻一顆加起來。
     6. 人民      國王復活之後每一張圖撒的人民（folk.js）：每一張 1～3 叢、每一叢 2～4 隻，
                  都站在從出生點走得到、平的地板上（腳下就是那一層地板、身體沒有嵌在碰撞盒裡），
                  離黑牆與感測區夠遠，叢與叢分得開、一叢裡的不擠在一起，面朝自己那一叢的中間。
     7. 頭        頭跟著主角（gaze.js）：左右照主角在哪一邊轉、主角在上面就抬頭；左右超過 60° 不跟、
                  回到前面；轉過去是追的，不是一幀跳過去。
     8. 王座      復活的國王走回王座（king.js 的 enthrone）：從王座廳裡幾個地方出發，走的那一條路
                  不穿過柱子與牆，一級一級爬上台座（階梯是反著砌的，見 king.js），轉身背對王座，
                  最後坐在座面中心、座面那麼高、面朝廳裡，而且是坐姿。
     9. 路標      主角腳邊的動態路標（route.js 的 signposts）：每一個感測區剛好出現在一個房間的
                  路標裡——它自己門口那一層；城牆步道兩層各只指自己那一層的圓塔門；字是通到的房間，
                  還沒進過、是某一場的房間寫去那裡的目的（STAGES 的 goal）。

   房間裡面走不走得通不在這裡驗——那是 verify:terrain 的事（每張圖從出生點
   真的走到中心、感測區都踩得到）。這裡只驗房間與房間之間。

   跑法：node tools/verify-flow.mjs
   ------------------------------------------------------------------ */

import { buildRuins, BLOCKS } from '../public/test/src/blocks.js';
import { PHYS, arenaGap, solveXZ, supportInfo } from '../public/test/src/walk.js';
import {
  STAGES, START, SOULS, roomOf, roomName, signposts, foesOf, entranceOf, inStage, makeRun, doorsFor, openPortals, portalRoom, restAt,
} from '../public/test/src/route.js';
import { KINDS } from '../public/test/src/combat.js';
import { FOLK, walkCells, plan } from '../public/test/src/folk.js';
import { GAZE, Gaze, aimHead } from '../public/test/src/gaze.js';
import { portalGap } from '../public/test/src/walk.js';
import { THRONE, COFFINS, GRAVE } from '../public/test/src/blocks.js';
import { LivingKing, KING, thronePath, pathGap } from '../public/test/src/king.js';

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok ' : ' FAIL'} ${msg}`);
  if (!cond) fails++;
};

const ruins = buildRuins();
const COLS = ruins.colliders;
const arenaOf = (id) => ruins.arenas.find((a) => a.id === id);
const shut = Object.fromEntries(Object.keys(ruins.doors).map((d) => [d, false]));

/* 感測區 → 邊：從哪個房間（感測區門口那一層）送到哪個房間（到達點在哪一層）。 */
const edges = ruins.portals.map((p) => ({ p, from: portalRoom(p), to: roomOf(p.dest.block, p.dest.y) }));


/**
 * 照路線的這個狀態，從 `start` 走得到的房間。門跟模式一樣每進一個房間重算（route.js 的
 * openPortals）。`stop` 是走進去就停的房間：下一場的房間一走進去就開打、門全關，不會從那裡
 * 再走到別處（窄巷的井就在窄巷這一場裡）。
 */
function reach(start, run, stop = null) {
  const seen = new Set([start]), todo = [start];
  while (todo.length) {
    const r = todo.pop();
    if (r === stop && r !== start) continue;
    for (const p of openPortals(ruins.portals, r, run)) {
      const to = roomOf(p.dest.block, p.dest.y);
      if (seen.has(to)) continue;
      seen.add(to);
      todo.push(to);
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

{
  const k = STAGES.findIndex((s) => s.id === 'crypt'), foes = STAGES[k].foes;
  const ghosts = foes.filter((f) => f.kind === 'ghost'), wraiths = foes.filter((f) => f.kind === 'wraith');
  const on = ghosts.map((f) => COFFINS.findIndex((c) => c.x === f.x && c.z === f.z && c.top === f.y));
  ok(foes.length === 7 && foes.every((f) => f.yaw === Math.PI) && STAGES[k].debut === 'rise', '地下墓室：七隻，都面朝鐵閘，第一次也是從底下升上來');
  ok(ghosts.length === 6 && on.every((i) => i >= 0 && COFFINS[i].i > 0) && new Set(on).size === 6,
    '地下墓室：六隻幽靈各站在一具石棺的棺蓋上（離鐵閘最近那一對不用）');
  ok(wraiths.length === 1 && wraiths[0].x === GRAVE.x && wraiths[0].z === GRAVE.z && wraiths[0].y === GRAVE.top,
    `地下墓室：一隻幽靈騎士從北端的大墓升上來，站在石蓋上（${GRAVE.top} 公尺）`);
}

{
  // 出場：初見模式 + 這一輪登場過沒有（route.js 的 entranceOf）。
  const id = (k) => STAGES[k].id;
  const comicFirst = STAGES.map((_, k) => k).filter((k) => entranceOf(k, false, true) === 'comic').map(id);
  ok(comicFirst.join() === 'courtyard,alley,cistern', `第一次進來、有開場漫畫：${comicFirst.join('、')} 在漫畫底下生好，其他（兵營、墓室、王座廳）從地底升上來`);
  ok(STAGES.every((_, k) => entranceOf(k, true, false) === 'rise' && entranceOf(k, true, true) === 'rise'),
    '登場過的（倒下之後回來重打）每一場都從地底升上來');
  ok(STAGES.every((_, k) => entranceOf(k, false, false) === 'rise'), '初見模式是漫畫、這一次卻沒有漫畫可翻的話，也是升上來');
  ok(foesOf(1, true).every((f) => f.rise) && foesOf(1).every((f) => !f.rise) && STAGES.every((s) => s.foes.every((f) => !('rise' in f))),
    '升不升上來是出場時決定的（foesOf 的 rise），站位本身不帶');
}

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
  const back = reach(home, makeRun(k));
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
{
  const first = reach(roomOf(ruins.arrivals[START].block, ruins.arrivals[START].y), makeRun(0));
  ok(first.has(STAGES[0].room) && STAGES.slice(1).every((s) => !first.has(s.room)),
    `一開始：只到得了${STAGES[0].name}（${[...first].join('、')}）`);
}
STAGES.forEach((s, k) => {
  const fighting = { next: k, active: true };
  const stuck = reach(s.room, fighting);
  ok(stuck.size === 1 && Object.values(doorsFor(ruins.portals, s.room, fighting)).every((o) => !o), `${s.name}：打的時候門全關、哪裡都去不了`);
  const after = makeRun(k + 1);
  const to = s.warp && restAt(k + 1, ruins);
  const next = k + 1 < STAGES.length ? STAGES[k + 1].room : null;
  const got = reach(to ? roomOf(to.block, to.y) : s.room, after, next);
  if (k + 1 < STAGES.length) {
    const early = STAGES.slice(k + 2).filter((t) => got.has(t.room) && t.room !== STAGES[k + 1].room);
    ok(got.has(STAGES[k + 1].room) && early.length === 0,
      `${s.name}打完${s.warp ? `（送到 ${STAGES[k + 1].rest}）` : ''}：走得到${STAGES[k + 1].name}${early.length ? `，也走得到 ${early.map((t) => t.name).join('、')}` : '、走不到更後面的'}`);
  } else {
    const all = new Set([...BLOCKS.map((b) => b.id), 'wallwalk:top']);
    ok([...all].every((r) => got.has(r)), `${s.name}打完：全部的門都開，${all.size} 個房間都走得到`);
  }
});

{
  // 一條路：每進一張圖只開往下一場的那一步，回頭的門、沒門的殘階都不通。
  const k = STAGES.findIndex((s) => s.id === 'crypt'), run = makeRun(k);
  const from = (room) => openPortals(ruins.portals, room, run).map((p) => p.to).join('、');
  ok(from('cistern') === 'crypt.gate', `水窖打完：水窖裡只通往墓室的鐵閘（${from('cistern')}），回窄巷的殘階不通`);
  ok(from('alley') === 'cistern.well' && from('courtyard') === 'alley.fog',
    `那時候不管站在哪，都只開往前的那一步：窄巷只通井、中庭只通窄巷（${from('alley')}；${from('courtyard')}）`);
  const throne = makeRun(STAGES.findIndex((s) => s.id === 'throne'));
  ok(openPortals(ruins.portals, 'courtyard', throne).map((p) => p.to).join() === 'throne.gate'
    && Object.entries(doorsFor(ruins.portals, 'courtyard', throne)).filter(([, o]) => o).map(([d]) => d).join() === 'courtyard-throne',
    '墓室打完回到中庭：只開王座廳正門，往兵營與窄巷的拱洞都關著');
  const done = makeRun(STAGES.length);
  ok(openPortals(ruins.portals, 'cistern', done).length === ruins.portals.length && Object.values(doorsFor(ruins.portals, 'cistern', done)).every(Boolean),
    '國王打完：所有的門、所有的傳送一次全開');
}

console.log('5. 靈魂');
{
  const each = STAGES.map((s) => s.foes.filter((f) => KINDS[f.kind].soul).length);
  ok(SOULS === each.reduce((a, b) => a + b, 0) && SOULS === 3,
    `一輪掉得出 ${SOULS} 顆靈魂（每一場 ${each.join('、')}），國王要收的就是這麼多`);
  /* 離開有靈魂的房間就算撿到（mode-flow.js 每一幀照位置問房間，跟 stage.js 的 arenaAt 同一個取法）：
     會掉靈魂的怪物站在哪，照位置問出來就是那一場的房間；被送走的那一場，送到的地方是別的房間。 */
  const at = (x, y, z) => {
    let best = null, bg = -Infinity;
    for (const a of ruins.arenas) { const g = arenaGap(a, x, z); if (g > bg) { bg = g; best = a; } }
    return roomOf(best.id, y);
  };
  STAGES.forEach((s, k) => {
    const owe = foesOf(k).filter((f) => KINDS[f.kind].soul);
    if (!owe.length) return;
    const to = s.warp && k + 1 < STAGES.length ? restAt(k + 1, ruins) : null;
    ok(owe.every((f) => at(f.x, f.y, f.z) === s.room) && (!to || at(to.x, to.y, to.z) !== s.room),
      `${s.name}：掉靈魂的怪物照位置問得到這一場的房間${to ? `；打完送到的 ${STAGES[k + 1].rest} 是別的房間——一送走就收下` : ''}`);
  });
}

console.log('6. 人民');
{
  const open = Object.fromEntries(Object.keys(ruins.doors).map((d) => [d, true]));
  // 固定的亂數：每一次驗的都是同一批，壞了重跑得出來。
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const a of ruins.arenas) {
    const [sx, sy, sz] = ruins.spawns[a.id];
    const cells = walkCells(COLS, a, { x: sx, y: sy, z: sz }, open);
    const okAt = (x, z) => arenaGap(a, x, z) > FOLK.edge && ruins.portals.every((p) => portalGap(p, x, z)[0] > FOLK.portal);
    const counts = [];
    let bad = '';
    for (let round = 0; round < 20; round++) {
      const spots = plan(cells, rng, okAt);
      const groups = [...new Set(spots.map((o) => o.cluster))].map((c) => spots.filter((o) => o.cluster === c));
      counts.push(groups.length);
      if (groups.length < FOLK.clusters[0] || groups.length > FOLK.clusters[1]) bad ||= `${groups.length} 叢`;
      for (const g of groups) {
        if (g.length < FOLK.members[0] || g.length > FOLK.members[1]) bad ||= `一叢 ${g.length} 隻`;
        const cx = g.reduce((t, o) => t + o.x, 0) / g.length, cz = g.reduce((t, o) => t + o.z, 0) / g.length;
        for (const o of g) {
          if (Math.abs(supportInfo(COLS, o.x, o.z, o.y + 0.1).y - o.y) > 1e-6) bad ||= `浮著或埋著 (${o.x}, ${o.z})`;
          const [px, pz] = solveXZ(COLS, o.x, o.z, o.y, open);
          if (Math.hypot(px - o.x, pz - o.z) > 1e-4) bad ||= `嵌在碰撞盒裡 (${o.x}, ${o.z})`;
          if (!okAt(o.x, o.z)) bad ||= `太靠近黑牆或感測區 (${o.x}, ${o.z})`;
          if (!FOLK.looks.includes(o.look)) bad ||= `不是第 14 頁的動物 ${o.look}`;
          if (g.some((q) => q !== o && Math.hypot(q.x - o.x, q.z - o.z) < FOLK.gap - 1e-9)) bad ||= '一叢裡擠在一起';
          if (Math.abs(Math.atan2(cx - o.x, cz - o.z) - o.yaw) > 1e-9) bad ||= '沒有面朝自己那一叢';
        }
        for (const h of groups) if (h !== g && Math.hypot(h[0].x - g[0].x, h[0].z - g[0].z) < FOLK.apart - 1e-9) bad ||= '叢與叢太近';
      }
    }
    const flat = cells.filter((c) => c.flat).length;
    ok(!bad, `${BLOCKS.find((b) => b.id === a.id).name}：走得到 ${cells.length} 格（平的 ${flat}），撒 20 次都是 ${Math.min(...counts)}～${Math.max(...counts)} 叢、站得好${bad ? `——${bad}` : ''}`);
  }
}

console.log('7. 頭');
{
  const left = aimHead(0, 0, 1, 0, 1, 1, 1), up = aimHead(0, 0, 1, 0, 0, 3, 2);
  ok(left && Math.abs(left.yaw - Math.PI / 4) < 1e-9 && Math.abs(left.pitch) < 1e-9, '主角在左前方 45°：頭往左轉 45°、不抬不低');
  ok(up && up.yaw === 0 && up.pitch < 0 && up.pitch >= -GAZE.pitch, '主角在上面：抬頭（不超過上限）');
  ok(aimHead(0, 0, 1, 0, Math.sin(1.1), 1, Math.cos(1.1)) === null && aimHead(0, 0, 1, 0, -1, 1, 0) === null
    && aimHead(0, 0, 1, 0, Math.sin(1.0), 1, Math.cos(1.0)) !== null, '左右超過 60° 不跟（63° 不跟、57° 跟），正後方也不跟');
  const g = new Gaze();
  const first = g.step(1 / 60, left);
  ok(first.headYaw > 0 && first.headYaw < left.yaw / 2 && first.w === 1, '轉過去是追的：第一幀只轉一點');
  for (let t = 0; t < 2; t += 1 / 60) g.step(1 / 60, left);
  ok(Math.abs(g.yaw - left.yaw) < 1e-3, '追得上');
  for (let t = 0; t < 2; t += 1 / 60) g.step(1 / 60, null);
  ok(Math.abs(g.yaw) < 1e-3, '主角走到後面：頭回到前面');
  const sit = { pitch: -0.5, headPitch: 0.3, w: 1 };
  const s = new Gaze();
  for (let t = 0; t < 2; t += 1 / 60) s.step(1 / 60, { yaw: 0, pitch: 0 }, sit);
  ok(Math.abs(s.pitch - 0.5) < 1e-3, '身體仰著（坐）：頭扣掉身體仰的那一份，看出去還是平的');
  for (let t = 0; t < 2; t += 1 / 60) s.step(1 / 60, null, sit);
  ok(Math.abs(s.pitch - 0.3) < 1e-3, '不跟的時候回到那一個姿勢本來的頭');
}

console.log('8. 王座');
{
  const [ox, oz] = BLOCKS.find((b) => b.id === 'throne').origin;
  const seat = { x: THRONE.x + ox, y: THRONE.y, z: THRONE.z + oz, stair: THRONE.stair + oz };
  const open = Object.fromEntries(Object.keys(ruins.doors).map((d) => [d, true]));
  const top = supportInfo(COLS, seat.x, seat.z, seat.y + 1).y;
  // 擋路的：柱子、牆、火盆（地板與階梯是爬上去的，不算）。
  const WALLS = COLS.filter((b) => b.kind !== 'floor' && b.kind !== 'step');
  ok(Math.abs(top - (THRONE.y + 0.5)) < 1e-6, `座面在 ${top.toFixed(2)} 公尺（台座 ${THRONE.y} 再高 0.5）`);
  // 王座廳裡幾個國王可能倒下的地方（區塊的局部座標）：正中、左右靠柱子、南端、靠近階梯。
  for (const [lx, lz] of [[0, 6], [-4.5, -2], [4.5, 1], [-3, -11], [2.5, 9.5]]) {
    const k = { at: { x: lx + ox, y: 0, z: lz + oz, yaw: 0 }, trip: null };
    LivingKing.prototype.enthrone.call(k, COLS, seat);
    const path = [{ ...k.at }, ...k.trip.path];
    let clear = true;
    for (let i = 1; i < path.length; i++) {
      for (let u = 0; u <= 1; u += 0.02) {
        const x = path[i - 1].x + (path[i].x - path[i - 1].x) * u, z = path[i - 1].z + (path[i].z - path[i - 1].z) * u;
        const [px, pz] = solveXZ(WALLS, x, z, 0, open);
        if (Math.hypot(px - x, pz - z) > 1e-4) clear = false;
      }
    }
    let t = 0, climbs = 0, last = 0, pose = null, jump = 0;
    while (k.trip.phase !== 'seated' && t < 30) {
      const r = LivingKing.prototype._walk.call(k, 1 / 60);
      pose = r.pose;
      jump = Math.max(jump, Math.abs(k.at.y - last));
      if (k.at.y > last + 1e-3) climbs++;
      last = k.at.y;
      t += 1 / 60;
    }
    LivingKing.prototype._walk.call(k, 1 / 60);
    const sat = k.trip.phase === 'seated' && Math.hypot(k.at.x - seat.x, k.at.z - seat.z) < 1e-6 && Math.abs(k.at.y - top) < 1e-6;
    const facing = Math.abs(Math.cos(k.at.yaw) + 1) < 1e-6;
    ok(clear && sat && facing && pose && pose.hind > 1 && jump < 0.1,
      `從 (${lx}, ${lz}) 出發：路不穿過柱子與牆、${t.toFixed(1)} 秒坐上王座、面朝廳裡、坐姿，高度一路是追上去的（一幀最多 ${jump.toFixed(3)} 公尺）`);
  }
  const from = { x: ox + 4, z: oz }, path = thronePath(from, seat);
  ok(pathGap(from, path, seat.x, seat.z - KING.front) < 1e-9 && pathGap(from, path, ox + 4, oz) < 1e-9 && pathGap(from, path, ox - 3, oz) > 2.9,
    'pathGap：路上的點是 0，路外面的照到路的距離');
}

console.log('9. 路標');
{
  const rooms = [...new Set(ruins.portals.map((p) => roomOf(p.block, p.mouth ? p.mouth.y : p.y0 + 0.5)))];
  const all = rooms.flatMap((r) => signposts(ruins.portals, r));
  ok(ruins.portals.every((p) => all.filter((sp) => sp.portal === p).length === 1),
    `${ruins.portals.length} 個感測區（門、霧口、井、殘階）各在一個房間的路標裡出現一次（${rooms.length} 個房間）`);
  ok(all.every((sp) => sp.name === roomName(sp.to) && sp.to === roomOf(sp.portal.dest.block, sp.portal.dest.y)),
    '每一支路標的字是它通到的那個房間');
  const say = (room) => signposts(ruins.portals, room).map((sp) => sp.name).sort().join('、');
  ok(say('wallwalk') === ['城牆上', '崩塌中庭'].sort().join('、') && say('wallwalk:top') === '兵營',
    `兵營指 ${say('wallwalk')}，城牆上只指 ${say('wallwalk:top')}：圓塔另一層的那扇門在同一張圖裡，但走不到，不指`);
  ok(say('courtyard') === ['王座廳', '兵營', '城內窄巷'].sort().join('、'), `崩塌中庭指 ${say('courtyard')}`);
  {
    // 箭頭的上下：指感測區高度的 1/3，箭頭在主角身高的一半。門是門檻上半個狗高——站在門前那一層就水平。
    const posts = rooms.flatMap((r) => signposts(ruins.portals, r));
    const doorsOk = posts.filter((sp) => sp.portal.mouth).every((sp) => Math.abs(sp.y - (sp.portal.mouth.y + PHYS.height / 2)) < 1e-9);
    ok(doorsOk, '每一扇門：路標指門檻上半個狗高（站在門前那一層、從身高一半指過去是水平的）');
    const up = posts.find((sp) => sp.portal.block === 'cistern' && sp.to === 'alley');
    const down = posts.find((sp) => sp.portal.block === 'alley' && sp.to === 'cistern');
    const hx = (sp, x, z) => Math.hypot(sp.x - x, sp.z - z);
    const cis = ruins.spawns.cistern, al = ruins.spawns.alley;
    const pitch = (sp, at) => Math.atan2(sp.y - (at[1] + PHYS.height / 2), hx(sp, at[0], at[2])) * 180 / Math.PI;
    ok(pitch(up, cis) > 15, `水窖往窄巷的殘階在上面：從水窖的出生點指過去往上 ${pitch(up, cis).toFixed(0)}°`);
    ok(pitch(down, al) < -15, `窄巷的井在底下：從窄巷的出生點指過去往下 ${(-pitch(down, al)).toFixed(0)}°`);
  }
  {
    // 照路線走到第 k 場的時候（前面的房間都進過）：每一個房間的路標寫什麼。
    const at = (k, room) => {
      const seen = new Set(STAGES.slice(0, k + 1).map((s) => s.room));
      return signposts(ruins.portals, room, seen).map((sp) => sp.name).sort().join('、');
    };
    ok(at(0, 'wallwalk') === ['城牆上', '調查殭屍來歷'].sort().join('、'), `兵營打完：往中庭的霧口寫「調查殭屍來歷」（${at(0, 'wallwalk')}）`);
    ok(at(1, 'courtyard') === ['兵營', '喝水', '見國王'].sort().join('、'), `中庭打完：去過的兵營寫地名，窄巷寫「喝水」、王座廳寫「見國王」（${at(1, 'courtyard')}）`);
    ok(at(2, 'alley') === ['喝水', '崩塌中庭'].sort().join('、'), `窄巷打完：井寫「喝水」（${at(2, 'alley')}）`);
    ok(at(3, 'cistern') === ['城內窄巷', '調查幽靈來歷'].sort().join('、'), `水窖打完：往墓室的鐵閘寫「調查幽靈來歷」（${at(3, 'cistern')}）`);
    const all = new Set(STAGES.map((s) => s.room));
    ok(['wallwalk', 'courtyard', 'alley', 'cistern', 'crypt', 'throne'].every((r) => signposts(ruins.portals, r, all).every((sp) => sp.name === roomName(sp.to))),
      '全部進過之後一律寫地名');
  }
}

console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
