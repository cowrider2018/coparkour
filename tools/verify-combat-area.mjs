/* ── tools/verify-combat-area.mjs ────────────────────────────────────
   /combat-area/ 的離線驗證。

   戰鬥的規則全都是「看不出來有沒有壞」的那一種：範圍差十度、視窗差
   0.1 秒、擊退落地前碰到算不算——畫面上都是一片亮光與一隻飛起來的狗，
   只有跑起來覺得「剛剛那一下怎麼沒中」。所以這裡用 combat.js 那一份
   規則、在 node 底下把每一條踩一遍。

     1. 站位       玩家在中線 2/3、怪物在 1/3，都面向中心。
     2. 追與咬     站著不動會被追上；碰到就咬。
     3. 擊退       水平遠離、垂直往上；落地前碰到不算；空中再挨一下再擊退一次。
     4. 第一段範圍  120° 水平扇形、身高中間、長 2.5 個狗高——邊上擦到身體就算。
     5. 第一段自動  站著不動、怪物走過來，第一段自己出手、打中、把牠挑起來，
                    而且不會一幀接一幀地連發。
   ------------------------------------------------------------------ */

import { PHYS } from '../public/test-area/src/walk.js';
import {
  ARENA, SPAWN, DOG_H, REACH, SWING, REST, KNOCK,
  makeMonster, monsterStep, touching, bites, knock, inSlash, makeCombo, comboStep,
} from '../public/combat-area/src/combat.js';

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok ' : ' FAIL'} ${msg}`);
  if (!cond) fails++;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const DT = 1 / 60;

const body = (x, z, y = 0, aim = [0, -1]) => ({ x, y, z, aimX: aim[0], aimZ: aim[1] });

/* ── 1. 站位 ─────────────────────────────────────────────────── */
console.log('1. 站位');
{
  const len = ARENA.z1 - ARENA.z0;
  ok(near(SPAWN.player.z, ARENA.z0 + len * 2 / 3), `玩家在中線 2/3（z = ${SPAWN.player.z.toFixed(2)}）`);
  ok(near(SPAWN.monster.z, ARENA.z0 + len / 3), `怪物在中線 1/3（z = ${SPAWN.monster.z.toFixed(2)}）`);
  ok(near(SPAWN.player.x, (ARENA.x0 + ARENA.x1) / 2) && near(SPAWN.monster.x, SPAWN.player.x), '兩個都在中線上');
  const cz = (ARENA.z0 + ARENA.z1) / 2;
  ok(Math.cos(SPAWN.player.yaw) * (cz - SPAWN.player.z) > 0, '玩家面向中心');
  ok(Math.cos(SPAWN.monster.yaw) * (cz - SPAWN.monster.z) > 0, '怪物面向中心');
  ok(near(REACH, 2.5 * DOG_H) && near(DOG_H, PHYS.height), `長度是 2.5 個狗高（${REACH.toFixed(2)} m）`);
}

/* ── 2. 追與咬 ───────────────────────────────────────────────── */
console.log('2. 追與咬');
{
  const p = body(SPAWN.player.x, SPAWN.player.z);
  const m = makeMonster();
  let t = 0;
  while (!bites(p, m) && t < 10) { monsterStep(m, DT, p); t += DT; }
  ok(bites(p, m), `站著不動 ${t.toFixed(2)} 秒後被咬`);
  const gap = SPAWN.player.z - SPAWN.monster.z - PHYS.radius * 2;
  ok(t < gap / 3 + 0.5, '追的速度對得上（沒有卡住、沒有繞遠路）');
  ok(!touching(body(0, 0), body(0, 0, PHYS.height + 0.01)), '腳底高過對方頭頂就碰不到');
  // 黑牆擋得住怪物：往牆外追一個不存在的目標。
  const w = makeMonster();
  for (let i = 0; i < 600; i++) monsterStep(w, DT, { x: 0, z: -100 });
  ok(w.z >= ARENA.z0 + PHYS.radius - 1e-6, `怪物被黑牆擋住（z = ${w.z.toFixed(2)}）`);
}

/* ── 3. 擊退 ─────────────────────────────────────────────────── */
console.log('3. 擊退');
{
  const p = body(0, 4);
  const m = makeMonster();
  m.x = 0; m.z = 2;
  knock(m, p.x, p.z, p.aimX, p.aimZ);
  ok(m.air && near(m.vy, KNOCK.v), '往上');
  ok(near(m.vz, -KNOCK.h) && near(m.vx, 0), '水平往遠離玩家的方向');
  // 落地前把玩家疊在牠身上：不算。
  let air = 0, bitten = false, overlapped = 0, peak = 0;
  while (m.air && air < 3) {
    const q = { ...p, x: m.x, z: m.z, y: m.y };
    if (touching(q, m)) overlapped++;
    if (bites(q, m)) bitten = true;
    monsterStep(m, DT, p);
    air += DT;
    peak = Math.max(peak, m.y);
  }
  ok(overlapped > 0 && !bitten, `落地前疊在一起也不咬（疊了 ${overlapped} 幀）`);
  ok(!m.air && m.y === 0 && m.vx === 0 && m.vz === 0, `${air.toFixed(2)} 秒後落地，水平速度一起停掉`);
  ok(bites({ ...p, x: m.x, z: m.z }, m), '落地之後碰到就咬');
  const T = (2 * KNOCK.v) / PHYS.gravity;
  ok(Math.abs(air - T) < 2 * DT, `飛行時間是 2v/g（${T.toFixed(2)} 秒），最高 ${peak.toFixed(2)} m`);
  // 空中再挨一下：垂直速度換回 KNOCK.v，不是疊上去。
  const q = makeMonster();
  q.x = 0; q.z = 2;
  knock(q, 0, 4, 0, -1);
  for (let i = 0; i < 10; i++) monsterStep(q, DT, p);
  knock(q, 0, 4, 0, -1);
  ok(q.air && near(q.vy, KNOCK.v) && near(Math.hypot(q.vx, q.vz), KNOCK.h), '空中再挨一下再擊退一次，速度是換掉不是疊上去');
  ok(q.hits === 2, '兩下都算');
  // 正好疊在出手點上：往給的方向推。
  const s = makeMonster();
  s.x = 1; s.z = 1;
  knock(s, 1, 1, 1, 0);
  ok(near(s.vx, KNOCK.h) && near(s.vz, 0), '疊在出手點上就往面向推');
}

/* ── 4. 第一段範圍 ───────────────────────────────────────────── */
console.log('4. 第一段範圍');
{
  const p = body(0, 0, 0, [0, 1]);
  const at = (deg, d, y = 0) => {
    const a = (deg * Math.PI) / 180;
    return body(Math.sin(a) * d, Math.cos(a) * d, y);
  };
  ok(inSlash(p, at(0, 2.0)), '正前方 2 公尺：中');
  ok(inSlash(p, at(0, REACH + PHYS.radius - 0.01)), '身體的前緣剛好在範圍的弧上：中');
  ok(!inSlash(p, at(0, REACH + PHYS.radius + 0.01)), '再遠一公分：不中');
  ok(inSlash(p, at(59, 2.0)), '偏 59°：中');
  ok(inSlash(p, at(60 + 7, 2.0)), '偏 67°，身體的邊還在扇形裡（半徑 0.3 在 2 公尺張開 8.6°）：中');
  ok(!inSlash(p, at(70, 2.0)), '偏 70°：不中');
  ok(!inSlash(p, at(180, 1.0)), '背後：不中');
  ok(inSlash(p, at(0, 1.5, 0.3)), '怪物離地 0.3（身體還切得到身高中間）：中');
  ok(!inSlash(p, at(0, 1.5, PHYS.height / 2 + 0.01)), '怪物的腳高過身高中間：不中');
  ok(!inSlash({ ...p, y: 1.0 }, at(0, 1.5)), '玩家跳起來，身高中間高過怪物頭頂：不中');
}

/* ── 5. 第一段自動 ───────────────────────────────────────────── */
console.log('5. 第一段自動');
{
  const p = { ...body(SPAWN.player.x, SPAWN.player.z), grounded: true };
  const m = makeMonster();
  const c = makeCombo();
  let t = 0, starts = 0, bitten = false, firstAt = -1, jumped = false;
  const slashLen = [];
  let slashT = 0;
  while (t < 12) {
    const act = comboStep(c, DT, { pressed: false, grounded: true, near: inSlash(p, m) });
    if (act.jump) jumped = true;
    if (act.start === 1) { starts++; if (firstAt < 0) firstAt = t; if (slashT) slashLen.push(slashT); slashT = 0; }
    if (c.phase === 'slash') slashT += DT;
    monsterStep(m, DT, p);
    if (c.phase === 'slash' && !c.hit && inSlash(p, m)) { knock(m, p.x, p.z, p.aimX, p.aimZ); c.hit = true; }
    if (bites(p, m)) bitten = true;
    t += DT;
  }
  ok(firstAt > 0, `怪物走進範圍就自動出手（第 ${firstAt.toFixed(2)} 秒）`);
  ok(m.hits === starts && starts >= 3, `每一下都打中（出手 ${starts} 次、打中 ${m.hits} 下）`);
  ok(!bitten, '站著不動、一直自動打，12 秒都沒被咬到');
  ok(!jumped, '沒按跳就不跳');
  ok(slashLen.every((s) => Math.abs(s - SWING) < 2 * DT), `每一下亮 ${SWING} 秒`);
  // 不會連發：收招之後 REST 秒內，怪物就算還在範圍裡也不出手。
  const c2 = makeCombo();
  comboStep(c2, DT, { pressed: false, grounded: true, near: true });
  let again = -1;
  for (let k = 1; k < 120 && again < 0; k++) {
    if (comboStep(c2, DT, { pressed: false, grounded: true, near: true }).start) again = k * DT;
  }
  ok(again >= SWING + REST - 2 * DT, `怪物一直在範圍裡也要等 ${(SWING + REST).toFixed(2)} 秒才出下一下（實際 ${again.toFixed(2)}）`);
  // 在空中不自動出手；站在地上按跳是普通的跳。
  const c3 = makeCombo();
  ok(!comboStep(c3, DT, { pressed: false, grounded: false, near: true }).start, '在空中不自動出手');
  ok(comboStep(c3, DT, { pressed: true, grounded: true, near: false }).jump, '沒有招的時候按跳就是跳');
}

console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
