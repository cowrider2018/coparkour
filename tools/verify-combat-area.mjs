/* ── tools/verify-combat-area.mjs ────────────────────────────────────
   /combat-area/ 的離線驗證。

   戰鬥的規則全都是「看不出來有沒有壞」的那一種：範圍差十度、視窗差
   0.1 秒、擊退落地前碰到算不算——畫面上都是一片亮光與一隻飛起來的狗，
   只有跑起來覺得「剛剛那一下怎麼沒中」。所以這裡用 combat.js 那一份
   規則、在 node 底下把每一條踩一遍。

     1. 站位       玩家在中線 2/3、怪物在 1/3，都面向中心。
     2. 追與咬     站著不動會被追上；碰到就咬。
     3. 擊退       水平遠離、垂直往上；落地前碰到不算；空中再挨一下再擊退一次；
                    每一段照自己的倍率。
     4. 第一段範圍  120° 水平扇形、身高中間、長 2.5 個狗高——邊上擦到身體就算。
     5. 第一段自動  站著不動、怪物走過來，第一段自己出手、打中、把牠挑起來，
                    而且不會一幀接一幀地連發。只靠第一段擋不住牠——挑得很低、
                    冷卻又長——所以這一項只量「幾秒後被咬」，不要求不被咬。
     6. 第二段範圍  圓心在腳下的直立 90° 扇形：下緣指向上一次第一段扇形正中
                    那條半徑的末端（不是現在的面向），往上越過頭頂，長 2.5 個
                    狗高；偏離那個面就掃不到。
     7. 第三段範圍  360°、身高中間、長 2.5 個狗高。
     8. 連段的時間  第二段只在第一段收招後 0.25～0.75 秒按得出來，太早是普通
                    的跳；第三段只在第二段收招後、落地前按得出來，無敵到落地，
                    落地才打。
     9. 打一整套    用真的物理跑：站著等怪物走過來、第一段自動、視窗裡按跳、
                    空中再按跳——在視窗的前段、中段、後段按都要三段都中、
                    整套打完之前一次都沒被咬。
   ------------------------------------------------------------------ */

import { PHYS } from '../public/test-area/src/walk.js';
import {
  ARENA, SPAWN, DOG_H, REACH, SWING, REST, KNOCK, KNOCK_SCALE, FAN, WINDOW,
  makeMonster, monsterStep, touching, bites, knock, inSlash, inFan, inRing, slashTip, fanFrame,
  makeCombo, comboStep, invulnerable, cueing,
} from '../public/combat-area/src/combat.js';
import { steer } from '../public/test-area/src/walk.js';

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
  // 每一段的倍率：第一段水平 0.7、垂直 0.5；第三段水平 0.5、垂直 2。
  const want = { slash: [0.7, 0.5], rise: [1, 1], slam: [0.5, 2] };
  for (const [stage, [h, v]] of Object.entries(want)) {
    const k = makeMonster();
    k.x = 0; k.z = 2;
    knock(k, 0, 4, 0, -1, KNOCK_SCALE[stage]);
    ok(near(k.vz, -KNOCK.h * h) && near(k.vy, KNOCK.v * v), `${stage}：水平 ${h} 倍（${(KNOCK.h * h).toFixed(1)} m/s）、垂直 ${v} 倍（${(KNOCK.v * v).toFixed(1)} m/s）`);
  }
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
  while (t < 12 && !bitten) {
    const act = comboStep(c, DT, { pressed: false, grounded: true, near: inSlash(p, m) });
    if (act.jump) jumped = true;
    if (act.start === 1) { starts++; if (firstAt < 0) firstAt = t; if (slashT) slashLen.push(slashT); slashT = 0; }
    if (c.phase === 'slash') slashT += DT;
    monsterStep(m, DT, p);
    if (c.phase === 'slash' && !c.hit.has(m) && inSlash(p, m)) { knock(m, p.x, p.z, p.aimX, p.aimZ, KNOCK_SCALE.slash); c.hit.add(m); }
    if (bites(p, m)) bitten = true;
    t += DT;
  }
  ok(firstAt > 0, `怪物走進範圍就自動出手（第 ${firstAt.toFixed(2)} 秒）`);
  ok(m.hits === starts && starts >= 1, `每一下都打中（出手 ${starts} 次、打中 ${m.hits} 下）`);
  console.log(`   ·  只靠第一段：${bitten ? `第 ${t.toFixed(2)} 秒被咬` : '12 秒都沒被咬'}`);
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

/* ── 6. 第二段範圍 ───────────────────────────────────────────── */
console.log('6. 第二段範圍');
{
  const deg = (r) => (r * 180) / Math.PI;
  const p = body(0, 0, 0, [0, 1]);
  const tip = slashTip(p);                    // 在原地出的第一段：(0, 身高/2, REACH)
  ok(near(tip.x, 0) && near(tip.y, PHYS.height / 2) && near(tip.z, REACH), '末端點是面向上 REACH 遠、身高中間那麼高');
  const fr = fanFrame(p, tip);
  ok(near(Math.tan(fr.a0), (PHYS.height / 2) / REACH) && near(fr.a1 - fr.a0, Math.PI / 2) && fr.a1 > Math.PI / 2,
    `原地出招：下緣仰角 ${deg(fr.a0).toFixed(1)}°，往上 90° 越過頭頂（到 ${deg(fr.a1).toFixed(1)}°）`);
  ok(near(FAN.r, REACH), `長度是 REACH（${FAN.r.toFixed(2)} m），不是那條線的長度`);
  ok(inFan(p, body(0, 2.0), tip), '正前方 2 公尺、站在地上：中');
  ok(inFan(p, body(0, 1.2, 1.0), tip), '正前方 1.2 公尺、離地 1 公尺：中');
  ok(inFan(p, body(0, -0.2, 1.4), tip), '頭頂正上方稍微偏後：中（扇形越過頭頂）');
  ok(!inFan(p, body(0, -1.5, 0), tip), '背後的地上：不中');
  ok(!inFan(p, body(0, 2.2, 1.6), tip), '正前方 2.2 公尺、離地 1.6（整隻在半徑外）：不中');
  ok(inFan(p, body(0.29, 2.0), tip), '偏離那個面 0.29 公尺（身體還跨在面上）：中');
  ok(!inFan(p, body(0.31, 2.0), tip), '偏離那個面 0.31 公尺：不中——扇形是一片平面');
  ok(!inFan(p, body(0, REACH + PHYS.radius + 0.05, 0), tip), '身體的前緣在 REACH 外：不中');
  // 方向跟著末端點，不跟著現在的面向。
  const turned = body(0, 0, 0, [1, 0]);
  ok(inFan(turned, body(0, 2.0), tip) && !inFan(turned, body(2.0, 0), tip), '轉身面向 +x 之後，扇形還是指著末端點（+z）');
  // 往前走近了：那條線變陡。
  const closer = body(0, 1.0, 0, [0, 1]);
  const fc = fanFrame(closer, tip);
  ok(near(Math.tan(fc.a0), (PHYS.height / 2) / (REACH - 1.0)), `往前走 1 公尺：下緣仰角變成 ${deg(fc.a0).toFixed(1)}°`);
  // 跳起來、腳高過末端點：下緣往前下方指著它。
  const high = body(0, 0, 1.0, [0, 1]);
  const fh = fanFrame(high, tip);
  ok(fh.a0 < 0 && inFan(high, body(0, 2.0), tip), `腳在 1 公尺高：下緣往下 ${deg(-fh.a0).toFixed(1)}°，前方地上的怪物：中`);
  ok(!inFan(body(0, 0, 2.5, [0, 1]), body(0, 1.0), tip), '腳在 2.5 公尺高、怪物在前方 1 公尺的地上（低於下緣）：不中');
}

/* ── 7. 第三段範圍 ───────────────────────────────────────────── */
console.log('7. 第三段範圍');
{
  const p = body(0, 0, 0, [0, 1]);
  let all = true;
  for (let a = 0; a < 360; a += 15) {
    const r = (a * Math.PI) / 180;
    if (!inRing(p, body(Math.sin(r) * 2.3, Math.cos(r) * 2.3))) all = false;
  }
  ok(all, '每一個方向 2.3 公尺：中');
  ok(inRing(p, body(REACH + PHYS.radius - 0.01, 0)) && !inRing(p, body(REACH + PHYS.radius + 0.01, 0)), '邊界在身體的前緣碰到 REACH');
  ok(!inRing(p, body(1, 0, PHYS.height / 2 + 0.01)), '怪物的腳高過身高中間：不中');
}

/* ── 8. 連段的時間 ───────────────────────────────────────────── */
console.log('8. 連段的時間');
{
  const idle = { pressed: false, grounded: true, near: false };
  /** 出一次第一段，收招之後再過 wait 秒按跳。回傳按下那一幀的結果。 */
  const pressAfterSlash = (wait) => {
    const c = makeCombo();
    comboStep(c, DT, { pressed: false, grounded: true, near: true });
    while (c.phase === 'slash') comboStep(c, DT, idle);
    for (let t = c.t; t + DT / 2 < wait; t += DT) comboStep(c, DT, idle);
    const out = comboStep(c, DT, { pressed: true, grounded: true, near: false });
    return { out, phase: c.phase };
  };
  const early = pressAfterSlash(0.15);
  ok(early.out.jump && !early.out.start && early.phase === 'idle', '收招後 0.15 秒按：普通的跳，連段斷了');
  for (const w of [WINDOW[0] + 0.02, 0.5, WINDOW[1] - 0.03]) {
    const r = pressAfterSlash(w);
    ok(r.out.start === 2 && r.out.jump && r.phase === 'rise', `收招後 ${w.toFixed(2)} 秒按：第二段，而且跳起來`);
  }
  const late = pressAfterSlash(0.85);
  ok(!late.out.start && late.out.jump, '收招後 0.85 秒按：視窗關了，普通的跳');

  // 第二段之後：rise 裡按不算，air 裡按是第三段；無敵到落地，落地才打。
  const c = makeCombo();
  comboStep(c, DT, { pressed: false, grounded: true, near: true });
  while (c.phase === 'slash') comboStep(c, DT, idle);
  for (let i = 0; i < 20; i++) comboStep(c, DT, idle);
  comboStep(c, DT, { pressed: true, grounded: true, near: false });
  ok(c.phase === 'rise', '進了第二段');
  const midRise = comboStep(c, DT, { pressed: true, grounded: false, near: false });
  ok(!midRise.jump && !midRise.start, '第二段還亮著的時候按：不算');
  ok(!cueing(c), '第二段還亮著的時候提示圈不亮');
  while (c.phase === 'rise') comboStep(c, DT, { pressed: false, grounded: false, near: false });
  ok(c.phase === 'air' && cueing(c), '第二段收招、人在空中：提示圈亮');
  const third = comboStep(c, DT, { pressed: true, grounded: false, near: false });
  ok(third.start === 3 && third.jump && invulnerable(c), '空中按跳：第三段，二段跳，無敵');
  let again = false;
  for (let i = 0; i < 30; i++) {
    if (comboStep(c, DT, { pressed: i === 5, grounded: false, near: false }).jump) again = true;
  }
  ok(c.phase === 'leap' && invulnerable(c) && !again, '落地之前一直無敵，再按也不會三段跳');
  comboStep(c, DT, idle);
  ok(c.phase === 'slam' && !invulnerable(c), '落地：打第三段那一圈，無敵結束');
  while (c.phase === 'slam') comboStep(c, DT, idle);
  ok(c.phase === 'idle', '第三段收招回到待機');
  // 第二段之後沒按、直接落地：連段結束。
  const d = makeCombo();
  d.phase = 'air';
  comboStep(d, DT, idle);
  ok(d.phase === 'idle', '第二段之後沒按就落地：回到待機');
}

/* ── 9. 打一整套 ─────────────────────────────────────────────── */
console.log('9. 打一整套');
{
  /** 站著不動，第一段收招後 at 秒按第二段，第二段收招後 0.05 秒按第三段。 */
  const chain = (at) => {
    const p = { x: 0, y: 0, z: SPAWN.player.z, vx: 0, vy: 0, vz: 0, grounded: true, aimX: 0, aimZ: -1 };
    const m = makeMonster();
    const c = makeCombo();
    const reach = { slash: inSlash, rise: (q, n) => inFan(q, n, c.tip), slam: inRing };
    const hits = [];
    let t = 0, press2 = false, press3 = false, bitten = false, shielded = 0;
    while (t < 8) {
      let pressed = false;
      if (c.phase === 'rest' && !press2 && c.t >= at) { pressed = true; press2 = true; }
      if (c.phase === 'air' && !press3 && c.t >= 0.05) { pressed = true; press3 = true; }
      const act = comboStep(c, DT, { pressed, grounded: p.grounded, near: inSlash(p, m) });
      if (act.start === 1) c.tip = slashTip(p);
      if (act.jump) { p.vy = PHYS.jump; p.grounded = false; }
      [p.vx, p.vz] = steer(p.vx, p.vz, p.aimX, p.aimZ, 0, DT);
      p.x += p.vx * DT; p.z += p.vz * DT;
      p.vy -= PHYS.gravity * DT; p.y += p.vy * DT;
      if (p.y <= 0 && p.vy <= 0) { p.y = 0; p.vy = 0; p.grounded = true; } else p.grounded = false;
      monsterStep(m, DT, p);
      const r = reach[c.phase];
      if (r && !c.hit.has(m) && r(p, m)) { knock(m, p.x, p.z, p.aimX, p.aimZ, KNOCK_SCALE[c.phase]); c.hit.add(m); hits.push(c.phase); }
      if (bites(p, m) && invulnerable(c)) shielded++;
      if (bites(p, m) && !invulnerable(c)) { bitten = true; break; }
      t += DT;
      if (press3 && c.phase === 'idle') break;
    }
    return { hits, bitten, shielded };
  };
  for (const at of [WINDOW[0] + 0.02, 0.45, 0.7]) {
    const r = chain(at);
    ok(r.hits.join(' ') === 'slash rise slam' && !r.bitten,
      `收招後 ${at.toFixed(2)} 秒按：${r.hits.join(' → ') || '沒有'}${r.bitten ? '，被咬了' : '，沒被咬'}`
      + `${r.shielded ? `（第三段的無敵擋掉了 ${r.shielded} 幀）` : ''}`);
  }
}

console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
