/* ── tools/verify-combat.mjs ────────────────────────────────────
   /test/?mode=combat 的離線驗證。

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
                    空中再按跳——在視窗的前段按要三段都中、整套打完之前一次都
                    沒被咬（中段、後段只列出結果：衝刺夠長，拖到後段會被衝到；
                    BOSS 衝完僵直 0.5 秒，中段按的話牠下一次蓄力剛好在第三段
                    落地的時候，蓄力打不退，收招就被衝到）。
    10. 名冊與血    每一類怪物的數值登記在 KINDS；三段各扣 1、3、2；扣到 0 就死，
                    在牠自己的重生點重生（血滿、破防歸零、擊退與定住都清掉）；
                    回到站位血也補滿。
    11. 破防門檻    傷害累積到 8 就破防、開 0.5 秒的窗口；窗口裡不再累積；
                    錯過就歸零重算。
    12. 破防攻擊    選最近的破防目標；按下去窗口用掉、累積歸零；朝頭頂飛過去、
                    碰到之後牠轉一圈、玩家繞牠 360°、扣 5、往反方向跳離，同一
                    瞬間牠被往突進的方向推開（只有水平）；整招無敵；在空中也
                    按得出來——被第二段打破防的那一刻玩家就在空中，接得上。
    13. 怪物不疊    三隻追同一個站著不動的人，身體一直不重疊、不出牆。
    14. 陣容        五種陣容：3 殭屍、1 BOSS、2 殭屍 + 1 BOSS、3 幽靈、1 騎士，預設是第三種；
                    每一隻都在中線 1/3 那條橫線上、面向中心，不疊在一起。
    15. BOSS 放招   腳程 4；每 3 秒挑一招，挑的那一刻鎖定玩家的位置，放招中站著
                    不動；被擊退、定住、推開就打斷。球：倒數 0.75 秒、半徑 0.75
                    狗高、每秒 6 公尺、直線、碰到黑牆消失，站著不動會被打中、
                    倒數裡橫移一步就躲得掉。跳砸：倒數 1.5 秒、最後 0.6 秒起跳、
                    落在鎖定的點上打半徑 2.5 狗高的一圈，走出圈外或跳起來就躲得過。
                    扇形：倒數 1 秒、朝鎖定的方向打 60°、4 狗高長的一片。三招都
                    挑得到。倒數中打不退、傷害減半無條件捨去，破防攻擊打斷得了。
                    出招後僵直 0.5 秒：站著不動、打得退、傷害照算。
    16. 衝刺        碰到不再有事，傷害是一次一次的衝刺：追到 1.8 公尺以內停下來
                    蓄力 0.25 秒，朝那時鎖定的方向衝（16 → 0，0.25 秒，2.0 公尺，
                    跟幀長無關），衝完僵直 0.5 秒；只有衝的時候碰到才死。小怪
                    蓄力被打就取消；BOSS 蓄力打不退、傷害減半。
    17. 幽靈        不受重力：朝玩家的腳在三維裡追、朝三維的方向衝 2.0 公尺；
                    被擊退往上飛得跟殭屍一樣高，但停在半空、不落下，停了再追；
                    高度夾在地板與蓋子底下；破防攻擊的迴旋之後在原本的高度被
                    推開；在空中被擊退的時候破防攻擊一樣瞄得到。
    18. 場地        怪物帶著自己的場地（黑牆、碰撞、門）：站在高台上就在台上追、
                    被擊退落回台上；走出台緣會掉下去、落在底下的地板；踏得上
                    一級台階；關著的門擋住、開著的不擋；圓的黑牆量得出球道多長、
                    球飛到它就消失；跳砸落在目標腳下那一塊的頂上，打的是那一層。
    19. 玩家的血    一開始 3 點；小怪咬 1、騎士咬 2、BOSS 咬 3、BOSS 的三招各 5（球與範圍攻擊
                    身上帶著這個數）；扣到 0 為止、不會變負的；挨一下之後 1 秒內
                    不再扣，所以一次衝刺從頭衝到尾只扣一次。撿到靈魂最大血量 +1；
                    倒下補滿到最大血量；不在戰鬥中每 0.3 秒回一顆、回到滿為止。
    20. 靈魂        只有 BOSS 會掉；從身體中間受重力往下掉，落在腳下那一層地板上
                    0.5 公尺，之後上下 ±0.2 簡諧漂浮、不橫移；碰到身體才撿得到。
    21. 劍光        三段攻擊的範圍畫成的同心三道劍氣（trail.js）：掃的角度就是判定的
                    角度、一路往同一個方向掃；最外那一道的外緣在 REACH 上、最粗，
                    往內一道比一道靠內、一道比一道細，相鄰兩道疊在一起；每一道起點
                    尖、往刀那一頭變寬到全寬（一整圈的不收）；合起來的外框框得住三道、
                    全寬時併成一塊；每一道上的每一點都打得到——各種面向、
                    第二段跳起來高過末端點也一樣；整道在同一個面上。
    22. 落地粉塵    太輕的落地（比 DUST.min 慢）不起塵；狗普通地跳一下是力道 1；力道有
                    上限；體型越大、落得越重，塵越濃、起塵的那一圈越大、推得越快越遠、
                    留得越久，沒有一項會倒過來；一團塵從全在淡到收掉，不會回來。
                    BOSS 範圍攻擊（扇形、跳砸）地震的塵：震波從腳下往外走，越外面
                    那一道越晚揚、越濃（所以越高）；最外面那一道揚完之前整片不淡，
                    之後淡到收掉。
    24. 騎士        劍迴旋衝刺：離玩家 3.2 公尺以內才放（夠不到就不放、夠得到的那一幀放）；
                    挑的那一刻鎖定方向；倒數 0.5 秒站著不打；然後朝那個方向衝 3.2 公尺
                    （跟幀長無關），衝的每一幀打這一幀走過的那一段、外擴迴旋的半徑，
                    一段接一段；衝完僵直 0.5 秒；放招中是攻擊中、打不退。站在路上、
                    貼著邊的會被打到，邊外、背後、跳起來的不會；預告那一條就是
                    整段衝下來打得到的地方。倒數是 whirlWind、衝是 whirlDash，比主角
                    第三擊多轉一圈，劍光也是兩圈。
    25. 騎士的跳砍  離玩家 8 公尺以內才放；長條的正中間是鎖定的那一點、落點在它前面半條
                    （比半條還近就原地跳）；倒數 0.25 秒站著；然後跳一道最高 1.2 公尺的弧線
                    落在落點上、劈一下、扣 3；連跳三次、每一跳重新鎖定玩家，第三跳落地才
                    僵直 0.5 秒；放招中打不退。長條（加上身體）裡的劈得到、外面的劈不到，
                    跳起來躲得過，倒數裡跑開就劈空；落點在台上就落在台上、劈那一層。
                    動作是 cleaveWind → cleaveAir（三次）→ cleaveRec。
    26. 頭盔        騎士與 BOSS 戴、小怪與幽靈不戴。量在狗頭上（頭骨座標、靜置姿勢）：
                    頭皮與眼睛除了底下的開口與正面的切口，全部包在盔殼內層裡；面罩整片
                    在盔殼的墨線外殼外面、下緣高過吻部；兩隻眼睛各對著一個洞；臉往鏡頭
                    推的那一段讓眼睛正面看在頭皮前、面罩後。頭盔跟著頭骨轉；墨線跟著
                    那隻動物的墨色換（攻擊中轉紅）。
   ------------------------------------------------------------------ */

import { PHYS } from '../public/test/src/walk.js';
import {
  MODES, DEFAULT_MODE, LUNGE, lunging, ARENA, SPAWN, DOG_H, REACH, SWING, REST, KNOCK, KNOCK_SCALE, FAN, WINDOW, KINDS, DAMAGE, hurt, placeMonster,
  BREAK_AT, BREAK_WINDOW, broken,
  FLY, BREAK_ATK, breaking, breakTarget, startBreak, breakContact, latch, spinStep, separate, armored, attacking,
  makeMonster, monsterStep, touching, bites, knock, inSlash, inFan, inRing, slashTip, fanFrame,
  makeCombo, comboStep, invulnerable, cueing, FIELD, LIFE, resetLife, lifeStep, harm, refill, gainHeart, regen,
  SOUL, dropSoul, soulStep, grabs,
} from '../public/test/src/combat.js';
import { SKILL, WHIRL_LEN, makeWorld, bossStep, shotsStep, shotHits, shotBlocked, strikeHits, laneLength } from '../public/test/src/skills.js';
import { steer } from '../public/test/src/walk.js';
import { DUST, dustOf, dustFade, QUAKE, quakeBands, quakeFade } from '../public/test/src/dust.js';
import { Motion, bloodOf, sizeOf, MOVES as KNIGHT_MOVES } from '../public/test/src/monster.js';
import { MOVES as HERO_MOVES } from '../public/test/src/moves.js';
import { TRAILS, PIECE, BANDS, sweepAt, fadeAt, sideAt, qiAt, along, hullOf } from '../public/test/src/trail.js';
import { bladeAt } from '../public/test/src/trail.js';
import { BLEED, SPLAT, STYLE, dropSize, dropCount, volumeOf, sizeRange, speedOf, hitFrame, pushFrame, spurtOf, floorUnder, splatScale, bleedStep } from '../public/test/src/bleed.js';
import { taken } from '../public/test/src/combat.js';
import { readFileSync } from 'node:fs';
import * as THREE from '../public/test/vendor/three.module.js';
import { loadZoo } from '../public/test/src/critter.js';
import { makeMonsterCritter, helmOf, ATTACK_INK } from '../public/test/src/monster.js';
import { Helm, HELM } from '../public/test/src/helm.js';
import { Rig } from '../public/src/cat/rig.js';

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
  const [boss, ...minions] = SPAWN.monsters;
  ok(boss.kind === 'boss' && near(boss.z, ARENA.z0 + len / 3), `BOSS 在中線 1/3（z = ${boss.z.toFixed(2)}）`);
  ok(near(SPAWN.player.x, (ARENA.x0 + ARENA.x1) / 2) && near(boss.x, SPAWN.player.x), '玩家與 BOSS 都在中線上');
  ok(minions.length === 2 && minions.every((s) => s.kind === 'minion' && near(s.z, boss.z) && near(Math.abs(s.x - boss.x), 4))
    && minions[0].x !== minions[1].x, '兩隻小怪在 BOSS 左右各 4 公尺');
  const cz = (ARENA.z0 + ARENA.z1) / 2;
  ok(Math.cos(SPAWN.player.yaw) * (cz - SPAWN.player.z) > 0, '玩家面向中心');
  const cx = (ARENA.x0 + ARENA.x1) / 2;
  ok(SPAWN.monsters.every((s) => {
    const d = Math.hypot(cx - s.x, cz - s.z);
    return near(Math.sin(s.yaw), (cx - s.x) / d) && near(Math.cos(s.yaw), (cz - s.z) / d);
  }), '三隻怪物都面向中心');
  ok(near(REACH, 2.5 * DOG_H) && near(DOG_H, PHYS.height), `長度是 2.5 個狗高（${REACH.toFixed(2)} m）`);
}

/* ── 2. 追與咬 ───────────────────────────────────────────────── */
console.log('2. 追與咬');
{
  const p = body(SPAWN.player.x, SPAWN.player.z);
  const m = makeMonster();
  let t = 0;
  while (!m.lunge && t < 10) { monsterStep(m, DT, p); t += DT; }
  ok(!!m.lunge, `站著不動：第 ${t.toFixed(2)} 秒追到衝刺的距離`);
  const gap = SPAWN.player.z - SPAWN.monsters[0].z - LUNGE.range;
  ok(t < gap / KINDS[m.kind].speed + 0.5, '追的速度對得上（沒有卡住、沒有繞遠路）');
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
  ok(touching({ ...p, x: m.x, z: m.z }, m) && !bites({ ...p, x: m.x, z: m.z }, m), '落地之後碰到也不咬——只有衝刺才咬');
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
  // 每一段的倍率：第一段水平 0.7、垂直 0.5；第二段水平 0.5、垂直 1.5；第三段水平 1.5、垂直 0.5。
  const want = { slash: [0.7, 0.5], rise: [0.5, 1.5], slam: [1.5, 0.5] };
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
    let t = 0, press2 = false, press3 = false, bitten = false, shielded = 0, sawSlam = false;
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
      // 整套打完就停：第三段落地那一圈收招的那一刻（之後自動出的第一段是下一輪）。
      if (c.phase === 'slam') sawSlam = true;
      else if (sawSlam) break;
    }
    return { hits, bitten, shielded };
  };
  for (const at of [WINDOW[0] + 0.02, 0.45, 0.7]) {
    const r = chain(at);
    // 只看這一整套的三下：第三段收招那一幀自動接出來的第一段是下一輪的事。
    const set3 = r.hits.slice(0, 3);
    const line = `收招後 ${at.toFixed(2)} 秒按：${set3.join(' → ') || '沒有'}${r.bitten ? '，被咬了' : '，沒被咬'}`
      + `${r.shielded ? `（第三段的無敵擋掉了 ${r.shielded} 幀）` : ''}`;
    /* 視窗中段、後段按不保證：衝刺 2.0 公尺，拖到後段，落地收招的那一刻牠已經衝得到你；
       中段按的話，BOSS 衝完僵直 0.5 秒之後的下一次蓄力剛好疊在第三段落地上（蓄力打不退）。
       這是數值的結果，列出來看，不算沒過。 */
    if (at > WINDOW[0] + 0.1) console.log(`   ·  ${line}`);
    else ok(set3.join(' ') === 'slash rise slam' && !r.bitten, line);
  }
}

/* ── 10. 名冊與血 ────────────────────────────────────────────── */
console.log('10. 名冊與血');
{
  ok(KINDS.minion.hp === 4 && KINDS.boss.hp === 20, '名冊裡兩類：小怪血 4、BOSS 血 20');
  ok(KINDS.knight.hp === 10 && KINDS.knight.speed === 3.6 && !KINDS.knight.steady && !KINDS.knight.fly && sizeOf('knight') === 1.2,
    '騎士：血 10、腳程 3.6、衝刺打得斷、不會飛、畫成 1.2 倍高');
  ok(SPAWN.monsters.map((s) => makeMonster(s)).every((q) => q.hp === KINDS[q.kind].hp), '每一隻生出來是自己那一類的滿血');
  const mm = makeMonster(SPAWN.monsters[1]);
  hurt(mm, DAMAGE.slash);
  ok(hurt(mm, DAMAGE.rise) && mm.deaths === 1 && mm.hp === 4, '小怪：第一段加第二段剛好打死，在重生點重生');
  const m = makeMonster(SPAWN.monsters[0]);
  m.hp = 10;                                  // 下面照 10 血的算術走
  ok(DAMAGE.slash === 1 && DAMAGE.rise === 3 && DAMAGE.slam === 2, '三段各扣 1、3、2');
  hurt(m, DAMAGE.slash); hurt(m, DAMAGE.rise); hurt(m, DAMAGE.slam);
  ok(m.hp === 4 && m.deaths === 0, `一整套扣 6，剩 ${m.hp}`);
  // 在別的地方、被擊退在空中、還帶著一點破防累積的時候被打死。
  m.x = 3; m.z = 5;
  knock(m, 3, 7, 0, -1);
  hurt(m, DAMAGE.rise);
  ok(m.hp === 1 && m.air, '還剩 1、正被擊退在空中');
  const died = hurt(m, DAMAGE.slash);
  ok(died && m.deaths === 1 && m.hp === KINDS.boss.hp, '扣到 0：死了一次，血滿著重生');
  ok(near(m.x, m.spawn.x) && near(m.z, m.spawn.z) && m.y === 0 && !m.air && m.vx === 0 && m.vz === 0 && m.vy === 0,
    '重生在牠自己的重生點，站在地上、不帶死前的擊退');
  ok(m.gauge === 0 && !broken(m), '重生之後破防歸零');
  const own = makeMonster({ kind: 'boss', x: -5, z: 6, yaw: 1 });
  own.hp = 1;
  hurt(own, 1);
  ok(near(own.x, -5) && near(own.z, 6), '每一隻回到的是自己的重生點');
  hurt(m, 3);
  placeMonster(m);
  ok(m.hp === KINDS.boss.hp, '回到站位血也補滿');
}

/* ── 11. 破防門檻 ────────────────────────────────────────────── */
console.log('11. 破防門檻');
{
  ok(BREAK_AT === 8 && Object.values(KINDS).every((k) => k.breakAt === BREAK_AT), '每一類的破防門檻都是 8');
  const m = makeMonster();
  m.hp = 99;                                  // 這一項只看累積，別讓牠中途死掉重生
  hurt(m, DAMAGE.slash); hurt(m, DAMAGE.rise); hurt(m, DAMAGE.slam);
  ok(!broken(m) && m.gauge === 6, '一整套三段：累積 6，還沒破防');
  hurt(m, DAMAGE.slash);
  ok(!broken(m) && m.gauge === 7, '再一個第一段：累積 7，還沒破防');
  hurt(m, DAMAGE.rise);
  ok(broken(m) && near(m.breakT, BREAK_WINDOW), `再一個第二段：累積 10，破防，窗口 ${BREAK_WINDOW} 秒`);
  const g = m.gauge;
  hurt(m, DAMAGE.slam);
  ok(m.gauge === g, '窗口裡再挨一下不累積');
  const far = { x: 0, z: 100 };
  let t = 0;
  while (broken(m)) { monsterStep(m, DT, far); t += DT; }
  ok(Math.abs(t - BREAK_WINDOW) < 2 * DT && m.gauge === 0, `${t.toFixed(2)} 秒沒用上：錯過，累積歸零`);
  hurt(m, DAMAGE.slam);
  ok(m.gauge === 2 && !broken(m), '錯過之後從 0 重算');
}

/* ── 12. 破防攻擊 ────────────────────────────────────────────── */
console.log('12. 破防攻擊');
{
  const breakNow = (m) => { m.gauge = BREAK_AT; m.breakT = BREAK_WINDOW; };
  // 選目標
  const p0 = { ...body(0, 4), grounded: true };
  const a = makeMonster(), b = makeMonster(), c0 = makeMonster();
  a.x = 0; a.z = 0; b.x = 0; b.z = 2; c0.x = 0; c0.z = 3;
  breakNow(a); breakNow(b);
  ok(breakTarget(p0, [a, b, c0]) === b, '好幾隻破防中：選最近的那一隻（沒破防的更近也不選）');
  ok(breakTarget(p0, [c0]) === null, '沒有破防中的：沒有目標');
  // 在空中也發動；蓋過連段
  const cc = makeCombo();
  cc.phase = 'air'; cc.t = 0.1;
  const inAir = comboStep(cc, DT, { pressed: true, grounded: false, near: false, breakable: true });
  ok(inAir.brk && !inAir.start && cc.phase === 'dash', '第二段之後在空中按：破防攻擊（不是第三段）');
  const cr = makeCombo();
  cr.phase = 'rest'; cr.t = 0.4;
  const go = comboStep(cr, DT, { pressed: true, grounded: true, near: false, breakable: true });
  ok(go.brk && !go.start && cr.phase === 'dash' && invulnerable(cr), '第二段的窗口裡按：破防攻擊優先，無敵');

  // 整招：玩家站著，怪物在前方 2.5 公尺追過來、破防中
  const p = { x: 0, y: 0, z: 4, vx: 0, vy: 0, vz: 0, grounded: true, aimX: 0, aimZ: -1 };
  const m = makeMonster();
  m.x = 0; m.z = 1.5;
  breakNow(m);
  const hp0 = m.hp;
  const c = makeCombo();
  const act = comboStep(c, DT, { pressed: true, grounded: true, near: false, breakable: !!breakTarget(p, [m]) });
  ok(act.brk, '站在地上按跳：發動');
  startBreak(c, p, m);
  ok(!broken(m) && m.gauge === 0, '發動就用掉窗口，累積歸零');
  let vault = null, pushed = null, slid = null;
  let t = 0, bitten = false, latchedAt = -1, yawTurn = 0, orbit = 0, lastYaw = null, lastAng = null, done = false, landedAt = -1;
  const unwrap = (d) => d - Math.PI * 2 * Math.round(d / (Math.PI * 2));
  while (t < 4) {
    comboStep(c, DT, { pressed: false, grounded: p.grounded, near: false, breakable: false });
    if (c.phase !== 'spin') {
      if (!breaking(c)) [p.vx, p.vz] = steer(p.vx, p.vz, p.aimX, p.aimZ, 0, DT);
      p.x += p.vx * DT; p.z += p.vz * DT;
      p.vy -= PHYS.gravity * DT; p.y += p.vy * DT;
      if (p.y <= 0 && p.vy <= 0) { p.y = 0; p.vy = 0; p.grounded = true; } else p.grounded = false;
    }
    monsterStep(m, DT, p);
    if (c.phase === 'dash' && breakContact(p, m)) { latch(c, p, m); latchedAt = t; }
    if (c.phase === 'spin') {
      const yaw = Math.atan2(m.aimX, m.aimZ), ang = Math.atan2(p.x - m.x, p.z - m.z);
      const r = spinStep(c, p, m);
      const yaw2 = Math.atan2(m.aimX, m.aimZ), ang2 = Math.atan2(p.x - m.x, p.z - m.z);
      yawTurn += unwrap(yaw2 - yaw); orbit += unwrap(ang2 - ang);
      if (r.done) { done = true; vault = [p.vx, p.vz, p.vy, c.dashX, c.dashZ]; pushed = { vx: m.vx, vz: m.vz, vy: m.vy, x: m.x, z: m.z, slide: m.slide }; }
    }
    if (bites(p, m) && !invulnerable(c)) bitten = true;
    if (pushed && !slid && !m.slide) slid = Math.hypot(m.x - pushed.x, m.z - pushed.z);
    t += DT;
    if (done && c.phase === 'idle') { landedAt = t; break; }
  }
  ok(latchedAt > 0 && latchedAt < BREAK_ATK.flight + 0.15, `突進 ${latchedAt.toFixed(2)} 秒碰到牠`);
  ok(Math.abs(Math.abs(yawTurn) - Math.PI * 2) < 0.05, `迴旋：牠原地轉了 ${(Math.abs(yawTurn) * 180 / Math.PI).toFixed(0)}°`);
  ok(Math.abs(Math.abs(orbit) - Math.PI * 2) < 0.05 && Math.sign(orbit) === Math.sign(yawTurn),
    `玩家繞著牠轉了 ${(Math.abs(orbit) * 180 / Math.PI).toFixed(0)}°，跟牠同一個方向`);
  ok(hp0 - m.hp === DAMAGE.break, `扣 ${DAMAGE.break}（${hp0} → ${m.hp}）`);
  ok(vault && near(vault[0], -vault[3] * BREAK_ATK.off.h) && near(vault[1], -vault[4] * BREAK_ATK.off.h) && near(vault[2], BREAK_ATK.off.v),
    `跳離：往突進的反方向 ${BREAK_ATK.off.h} m/s、往上 ${BREAK_ATK.off.v.toFixed(1)} m/s`);
  ok(pushed && near(pushed.vx, vault[3] * BREAK_ATK.push.h) && near(pushed.vz, vault[4] * BREAK_ATK.push.h) && pushed.vy === 0 && pushed.slide,
    `同一瞬間牠被往突進的方向推開 ${BREAK_ATK.push.h} m/s，沒有往上`);
  const want = (BREAK_ATK.push.h ** 2) / (2 * BREAK_ATK.push.decel);
  ok(slid !== null && Math.abs(slid - want) < 0.1, `沿著地面滑了 ${slid?.toFixed(2)} 公尺才停（應為 ${want.toFixed(2)}），停了才回去追人`);
  ok(landedAt > 0, `跳離之後落地、回到待機（離牠 ${Math.hypot(p.x - m.x, p.z - m.z).toFixed(1)} 公尺）`);
  ok(!bitten, '整招沒被咬（突進、迴旋、跳離都無敵）');
  ok(!m.held, '跳離之後怪物被放開');

  // 接在連段後面：牠身上已經累積了 4（上一輪打的），站著等牠過來、第一段自動、
  // 視窗裡按第二段——累積到 8、破防發生在第二段的空中，窗口裡再按一次跳，在空中
  // 發動破防攻擊。
  {
    const q = { x: 0, y: 0, z: SPAWN.player.z, vx: 0, vy: 0, vz: 0, grounded: true, aimX: 0, aimZ: -1 };
    const n = makeMonster();
    n.gauge = BREAK_AT - DAMAGE.slash - DAMAGE.rise;
    const k = makeCombo();
    const reach = { slash: inSlash, rise: (u, v) => inFan(u, v, k.tip), slam: inRing };
    let tt = 0, p2 = false, p3 = false, brokeAt = -1, launchedY = -1, bit = false, over = false;
    const got = [];
    while (tt < 6 && !over) {
      let pressed = false;
      if (k.phase === 'rest' && !p2 && k.t >= 0.4) { pressed = true; p2 = true; }
      if (broken(n) && !p3 && tt - brokeAt >= 0.2) { pressed = true; p3 = true; }
      const tgt = breakTarget(q, [n]);
      const a2 = comboStep(k, DT, { pressed, grounded: q.grounded, near: inSlash(q, n), breakable: !!tgt });
      if (a2.start === 1) k.tip = slashTip(q);
      if (a2.brk) { launchedY = q.y; startBreak(k, q, tgt); }
      if (a2.jump) { q.vy = PHYS.jump; q.grounded = false; }
      if (!breaking(k)) [q.vx, q.vz] = steer(q.vx, q.vz, q.aimX, q.aimZ, 0, DT);
      if (k.phase !== 'spin') {
        q.x += q.vx * DT; q.z += q.vz * DT;
        q.vy -= PHYS.gravity * DT; q.y += q.vy * DT;
        if (q.y <= 0 && q.vy <= 0) { q.y = 0; q.vy = 0; q.grounded = true; } else q.grounded = false;
      }
      monsterStep(n, DT, q);
      if (k.phase === 'dash' && breakContact(q, n)) latch(k, q, n);
      if (k.phase === 'spin' && spinStep(k, q, n).done) got.push('break');
      const r = reach[k.phase];
      if (r && !k.hit.has(n) && r(q, n)) {
        knock(n, q.x, q.z, q.aimX, q.aimZ, KNOCK_SCALE[k.phase]); k.hit.add(n);
        hurt(n, DAMAGE[k.phase]); got.push(k.phase);
        if (broken(n) && brokeAt < 0) brokeAt = tt;
      }
      if (bites(q, n) && !invulnerable(k)) bit = true;
      tt += DT;
      if (got.includes('break') && k.phase === 'idle') over = true;
    }
    ok(got.join(' ') === 'slash rise break' && launchedY > 0.3,
      `第一段 → 第二段 → 破防攻擊（${got.join(' → ')}），在 ${launchedY.toFixed(2)} 公尺高的空中發動`);
    ok(n.hp === KINDS.boss.hp - DAMAGE.slash - DAMAGE.rise - DAMAGE.break && !bit, `扣 1 + 3 + 5，剩 ${n.hp}，沒被咬`);
  }

  // 在空中被定住的怪物：放開之後帶著水平速度落下，不被往上挑。
  const pa = { x: 0, y: 1.5, z: 3, vx: 0, vy: 0, vz: 0, grounded: false, aimX: 0, aimZ: -1 };
  const ma = makeMonster();
  ma.x = 0; ma.z = 1; ma.y = 1.2; ma.air = true;
  const ca = makeCombo();
  ca.dashX = 0; ca.dashZ = -1;
  latch(ca, pa, ma);
  ca.t = BREAK_ATK.spin;
  spinStep(ca, pa, ma);
  ok(ma.air && !ma.slide && ma.vy === 0 && near(ma.vz, -BREAK_ATK.push.h), '在空中被定住的：放開之後帶著水平速度落下，垂直速度是 0');
  // 打死的那一下：推開的速度不帶到重生點。
  const md = makeMonster();
  md.x = 0; md.z = 1; md.hp = DAMAGE.break;
  const cd = makeCombo();
  cd.dashX = 0; cd.dashZ = -1;
  latch(cd, { ...pa, y: 0.9 }, md);
  cd.t = BREAK_ATK.spin;
  const rd = spinStep(cd, { ...pa }, md);
  ok(rd.died && md.vx === 0 && md.vz === 0 && !md.slide && near(md.z, md.spawn.z), '這一下打死牠：在重生點重生，不帶推開的速度');
}

/* ── 13. 怪物不疊 ────────────────────────────────────────────── */
console.log('13. 怪物不疊');
{
  const p = body(SPAWN.player.x, SPAWN.player.z);
  const ms = SPAWN.monsters.map((s) => makeMonster(s));
  let worst = Infinity, out = false, t = 0;
  while (t < 4) {
    for (const m of ms) monsterStep(m, DT, p);
    separate(ms);
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) worst = Math.min(worst, Math.hypot(ms[i].x - ms[j].x, ms[i].z - ms[j].z));
      if (Math.abs(ms[i].x) > ARENA.x1 - PHYS.radius + 1e-6 || Math.abs(ms[i].z) > ARENA.z1 - PHYS.radius + 1e-6) out = true;
    }
    t += DT;
  }
  ok(worst >= PHYS.radius * 2 - 1e-3, `追了 4 秒，任兩隻最近 ${worst.toFixed(3)} 公尺（身體直徑 ${PHYS.radius * 2}）`);
  ok(!out, '推開之後都還在黑牆裡');
  ok(ms.some((m) => Math.hypot(m.x - p.x, m.z - p.z) < 1), '還是追得到人（不是互相擋死在原地）');
  // 疊在同一點：也分得開。
  const a = makeMonster(SPAWN.monsters[1]), b = makeMonster(SPAWN.monsters[2]);
  b.x = a.x; b.z = a.z;
  separate([a, b]);
  ok(near(Math.hypot(a.x - b.x, a.z - b.z), PHYS.radius * 2), '兩隻完全疊在一起：推開到剛好相切');
  // 被定住的那一隻不動。
  const h = makeMonster(SPAWN.monsters[1]), f = makeMonster(SPAWN.monsters[2]);
  f.x = h.x + 0.2; f.z = h.z;
  h.held = true;
  const hx = h.x;
  separate([h, f]);
  ok(h.x === hx && near(f.x - h.x, PHYS.radius * 2), '被破防攻擊定住的那一隻不動，另一隻退全部');
}

/* ── 14. 陣容 ────────────────────────────────────────────────── */
console.log('14. 陣容');
{
  const tally = (md) => md.monsters.reduce((o, s) => ({ ...o, [s.kind]: (o[s.kind] || 0) + 1 }), {});
  const want = { minions: { minion: 3 }, boss: { boss: 1 }, mixed: { boss: 1, minion: 2 }, ghosts: { ghost: 3 }, knight: { knight: 1 } };
  ok(MODES.map((md) => md.id).join() === 'minions,boss,mixed,ghosts,knight', '五種陣容，面板上依序是 3 殭屍、1 BOSS、2 殭屍 + 1 BOSS、3 幽靈、1 騎士');
  for (const md of MODES) ok(JSON.stringify(tally(md)) === JSON.stringify(want[md.id]), `${md.name}：${JSON.stringify(tally(md))}`);
  ok(DEFAULT_MODE === 'mixed' && SPAWN.monsters === MODES[2].monsters, '預設是 2 殭屍 + 1 BOSS');
  const cx = (ARENA.x0 + ARENA.x1) / 2, cz = (ARENA.z0 + ARENA.z1) / 2;
  const row = ARENA.z0 + (ARENA.z1 - ARENA.z0) / 3;
  const good = MODES.every((md) => md.monsters.every((s, i) => near(s.z, row)
    && near(Math.sin(s.yaw), (cx - s.x) / Math.hypot(cx - s.x, cz - s.z))
    && md.monsters.every((o, j) => j === i || Math.hypot(o.x - s.x, o.z - s.z) >= PHYS.radius * 2)));
  ok(good, '每一種陣容：都在中線 1/3 那條橫線上、面向中心、不疊在一起');
}

/* ── 15. BOSS 放招 ───────────────────────────────────────────── */
console.log('15. BOSS 放招');
{
  const bossAt = (x, z) => { const m = makeMonster({ kind: 'boss', x, z, yaw: 0 }); return m; };
  ok(KINDS.boss.speed === 4 && KINDS.boss.every === 3 && KINDS.boss.skills.includes('orb') && !KINDS.minion.skills,
    'BOSS 腳程 4、每 3 秒放一招；小怪沒有技能');
  ok(near(SKILL.orb.radius, 0.75 * DOG_H) && SKILL.orb.speed === 6 && SKILL.orb.windup === 0.75, '球：半徑 0.75 狗高、每秒 6 公尺、倒數 0.75 秒');

  // 循環：3 秒才放第一招；放招中站著不動；下一招是 3 秒之後。人站在場地另一頭，
  // BOSS 這 6 秒追不到——不然貼著人衝刺的時候，招會等衝完才放。
  const w = makeWorld();
  const m = bossAt(0, -11);
  const p = body(0, 11.5);
  const starts = [];
  let still = true, t = 0;
  while (t < 6.6) {
    const was = m.cast;
    bossStep(m, DT, p, w, () => 0);
    if (m.cast && !was) starts.push(t);
    const x0 = m.x, z0 = m.z;
    monsterStep(m, DT, p);
    if (m.cast && (m.x !== x0 || m.z !== z0)) still = false;
    t += DT;
  }
  ok(starts.length === 2 && Math.abs(starts[0] - 3) < 2 * DT && Math.abs(starts[1] - 6) < 2 * DT,
    `第 ${starts.map((x) => x.toFixed(2)).join('、')} 秒各放一招`);
  ok(still, '放招的時候站著不動');

  // 球：鎖定開始那一刻的位置；站著不動會被打中；倒數裡橫移一步就躲掉。
  const fire = (dodge) => {
    const wb = makeWorld();
    const b = bossAt(0, -4);
    const q = body(0, 4);
    b.castT = 0;
    let hit = false, fired = -1, tt = 0, gone = -1;
    while (tt < 4) {
      bossStep(b, DT, q, wb, () => 0);
      if (dodge && b.cast && b.cast.t > 0.3) q.x = 1.2;           // 倒數到一半往旁邊跨一步
      shotsStep(wb, DT);
      if (fired < 0 && wb.shots.length) fired = tt;
      if (wb.shots.some((sh) => shotHits(sh, q))) hit = true;
      if (fired >= 0 && gone < 0 && !wb.shots.length) gone = tt;
      tt += DT;
    }
    return { hit, fired, gone };
  };
  const stay = fire(false), side = fire(true);
  ok(Math.abs(stay.fired - SKILL.orb.windup) < 2 * DT, `倒數 ${stay.fired.toFixed(2)} 秒後發射`);
  ok(stay.hit, '站著不動：被打中');
  ok(!side.hit, '倒數裡往旁邊跨 1.2 公尺：打不到（方向在開始那一刻就鎖定了）');
  // 從身體前緣（離中心 PHYS.radius + r）出發，球面碰到牆（離牆 r）就消失。
  const travel = laneLength(0, -4, 0, 1) - (PHYS.radius + SKILL.orb.radius) - SKILL.orb.radius;
  ok(side.gone > 0 && Math.abs(side.gone - side.fired - travel / SKILL.orb.speed) < 2 * DT,
    `沒打中的球直線飛到黑牆才消失（飛了 ${(side.gone - side.fired).toFixed(2)} 秒）`);
  ok(shotHits({ x: 0, y: SKILL.orb.radius, z: 0, r: SKILL.orb.radius }, body(PHYS.radius + SKILL.orb.radius - 0.01, 0))
    && !shotHits({ x: 0, y: SKILL.orb.radius, z: 0, r: SKILL.orb.radius }, body(PHYS.radius + SKILL.orb.radius + 0.01, 0)),
    '球碰到身體的邊就算');

  // 倒數中被打：打不退，球照樣射出去。
  const wi = makeWorld();
  const bi = bossAt(0, -4);
  bi.castT = 0;
  bossStep(bi, DT, p, wi, () => 0);
  const bx = bi.x, bz = bi.z;
  knock(bi, 0, 0, 0, -1);
  ok(armored(bi) && !bi.air && bi.vx === 0 && bi.vz === 0 && bi.vy === 0 && bi.hits === 1, '倒數中被打：算打中，但打不退');
  for (let i = 0; i < 90; i++) { bossStep(bi, DT, p, wi, () => 0); if (wi.shots.length) break; monsterStep(bi, DT, p); }
  ok(wi.shots.length === 1 && near(bi.x, bx) && near(bi.z, bz), '倒數照走，球照樣射出去，牠沒挪一步');
  // 倒數中的傷害：減半、無條件捨去；破防累積的是實際扣掉的。
  const ba = bossAt(0, -4);
  ba.castT = 0;
  bossStep(ba, DT, p, makeWorld(), () => 0.5);
  const hp1 = ba.hp;
  const took = [DAMAGE.slash, DAMAGE.slam, DAMAGE.rise, DAMAGE.break].map((d) => { const h = ba.hp; hurt(ba, d); return h - ba.hp; });
  ok(took.join() === '0,1,1,2' && hp1 - ba.hp === 4 && ba.gauge === 4, `倒數中挨 1、2、3、5：實際扣 ${took.join('、')}，破防累積 ${ba.gauge}`);
  // 破防攻擊打斷得了：被定住的那一刻起這一招就取消。
  const wh = makeWorld();
  const bh = bossAt(0, -4);
  bh.castT = 0;
  bossStep(bh, DT, p, wh, () => 0);
  bh.held = true;
  bossStep(bh, DT, p, wh, () => 0);
  bh.held = false;
  for (let i = 0; i < 90; i++) bossStep(bh, DT, p, wh, () => 0);
  ok(!wh.shots.length, '倒數中被破防攻擊定住：這一招取消，沒有球');

  // 跳砸：挑 leap（亂數給 0.5 → 第二招）。
  ok(near(SKILL.leap.radius, 2.5 * DOG_H) && SKILL.leap.windup === 1.5, '跳砸：範圍半徑 2.5 狗高、倒數 1.5 秒');
  const leap = (move) => {
    const wl = makeWorld();
    const b = bossAt(0, -4);
    const q = body(0, 3);
    b.castT = 0;
    let st = null, at = -1, tookOff = -1, peak = 0, tt = 0;
    while (tt < 2 && !st) {
      st = bossStep(b, DT, q, wl, () => 0.5);
      if (tookOff < 0 && b.y > 0) tookOff = tt;
      peak = Math.max(peak, b.y);
      if (move) move(q, b);
      if (st) at = tt;
      tt += DT;
    }
    return { st, at, tookOff, peak, b, q };
  };
  const L = leap(null);
  ok(L.st && L.st.shape === 'circle' && near(L.st.x, 0) && near(L.st.z, 3), '打在開始那一刻鎖定的點上');
  ok(Math.abs(L.at - SKILL.leap.windup) < 2 * DT && Math.abs(L.tookOff - (SKILL.leap.windup - SKILL.leap.air)) < 2 * DT,
    `第 ${L.tookOff.toFixed(2)} 秒起跳、第 ${L.at.toFixed(2)} 秒落地打下去，最高 ${L.peak.toFixed(2)} 公尺`);
  ok(near(L.b.x, 0) && near(L.b.z, 3) && L.b.y === 0 && !L.b.cast, 'BOSS 落在目標點上，放完了');
  ok(strikeHits(L.st, L.q), '站著不動：被砸到');
  ok(strikeHits(L.st, body(SKILL.leap.radius + PHYS.radius - 0.01, 3)) && !strikeHits(L.st, body(SKILL.leap.radius + PHYS.radius + 0.01, 3)),
    '邊界在身體碰到圈的邊');
  const out = leap((q, b) => { if (b.cast && b.cast.t > 0.2) q.x = 3; });
  ok(!strikeHits(out.st, out.q), '倒數裡走出圈外 3 公尺：躲過');
  ok(!strikeHits(L.st, body(0, 3, PHYS.height + 0.01)) && strikeHits(L.st, body(0, 3, PHYS.height - 0.01)),
    `跳起來、腳高過一個狗高（${PHYS.height} m）：躲過；低一點就中`);
  // 起跳之後被打：飛行也算倒數，打不退，照樣砸在鎖定的點上。
  const wk = makeWorld();
  const bk = bossAt(0, -4);
  bk.castT = 0;
  let hitK = null, knocked = false;
  for (let i = 0; i < 150 && !hitK; i++) {
    const r = bossStep(bk, DT, p, wk, () => 0.5);
    if (r) hitK = r;
    if (bk.cast && bk.y > 0.3 && !knocked) { knock(bk, 0, 4, 0, -1); knocked = true; }
    monsterStep(bk, DT, p);
  }
  ok(knocked && hitK && near(hitK.x, p.x) && near(hitK.z, p.z), '飛到一半被打：打不退，照樣砸在鎖定的點上');

  // 扇形：挑 cone（亂數給 0.99 → 第三招）。
  ok(near(SKILL.cone.radius, 4 * DOG_H) && near(SKILL.cone.half * 2, Math.PI / 3) && SKILL.cone.windup === 1,
    '扇形：60°、長 4 狗高、倒數 1 秒');
  const wc = makeWorld();
  const bc = bossAt(0, 0);
  const qc = body(0, 2);
  bc.castT = 0;
  let sc = null, atc = -1, moved = false, tc = 0;
  while (tc < 2 && !sc) {
    sc = bossStep(bc, DT, qc, wc, () => 0.99);
    if (bc.cast && bc.cast.t > 0.3) qc.x = 0.4;                  // 開始之後才動：方向已經鎖定了
    const x0 = bc.x, z0 = bc.z, casting = !!bc.cast;
    monsterStep(bc, DT, qc);
    if (casting && (bc.x !== x0 || bc.z !== z0)) moved = true;
    if (sc) atc = tc;
    tc += DT;
  }
  ok(sc && sc.shape === 'cone' && near(sc.dirX, 0) && near(sc.dirZ, 1) && Math.abs(atc - SKILL.cone.windup) < 2 * DT && !moved,
    `第 ${atc.toFixed(2)} 秒打下去，方向是開始那一刻鎖定的，放的時候站著不動`);
  const ang = (deg, d, y = 0) => body(Math.sin(deg * Math.PI / 180) * d, Math.cos(deg * Math.PI / 180) * d, y);
  ok(strikeHits(sc, ang(0, 3)) && strikeHits(sc, ang(29, 3)), '正前方 3 公尺、偏 29°：中');
  ok(!strikeHits(sc, ang(40, 3)) && !strikeHits(sc, ang(180, 1.5)), '偏 40°、背後：不中');
  ok(strikeHits(sc, ang(0, SKILL.cone.radius + PHYS.radius - 0.01)) && !strikeHits(sc, ang(0, SKILL.cone.radius + PHYS.radius + 0.01)),
    '長度的邊界在身體碰到扇形的弧');
  ok(!strikeHits(sc, ang(0, 3, PHYS.height + 0.01)), '跳起來、腳高過一個狗高：躲過');

  // 三招都挑得到。
  const picked = new Set();
  for (const r of [0, 0.34, 0.5, 0.67, 0.99]) {
    const b = bossAt(0, -4);
    b.castT = 0;
    bossStep(b, DT, p, makeWorld(), () => r);
    picked.add(b.cast.skill);
  }
  ok(['orb', 'leap', 'cone'].every((k) => picked.has(k)), `亂數涵蓋三招：${[...picked].join('、')}`);

  // 出招後僵直：三招各放一次，量「出完」到「僵直結束」隔多久，這段時間一步都沒動、
  // 也沒開始衝刺。
  ok(SKILL.recover === 0.5, '出招後僵直 0.5 秒');
  for (const [name, r] of [['orb', 0], ['leap', 0.5], ['cone', 0.99]]) {
    const ws = makeWorld();
    const bs = bossAt(0, -4);
    const qs = body(0, 4);
    bs.castT = 0;
    let doneAt = -1, freeAt = -1, ts = 0, stirred = false;
    while (ts < 4 && freeAt < 0) {
      const had = !!bs.cast;
      bossStep(bs, DT, qs, ws, () => r);
      if (had && !bs.cast && doneAt < 0) doneAt = ts;
      const x0 = bs.x, z0 = bs.z;
      monsterStep(bs, DT, qs);
      if (doneAt >= 0 && bs.stun > 0 && (bs.x !== x0 || bs.z !== z0 || bs.lunge)) stirred = true;
      if (doneAt >= 0 && !(bs.stun > 0)) freeAt = ts;
      ts += DT;
    }
    ok(doneAt > 0 && Math.abs(freeAt - doneAt - SKILL.recover) < 2 * DT && !stirred,
      `${name}：出完之後僵直 ${(freeAt - doneAt).toFixed(2)} 秒，這段時間沒動、沒衝`);
  }
  // 僵直中：打得退、傷害照算。
  const bst = bossAt(0, -4);
  bst.castT = 0;
  const wst = makeWorld();
  while (!wst.shots.length) bossStep(bst, DT, p, wst, () => 0);
  ok(bst.stun > 0 && !armored(bst), '球射出去之後：僵直中，不是倒數');
  const hst = bst.hp;
  knock(bst, 0, 0, 0, -1);
  hurt(bst, DAMAGE.rise);
  ok(bst.air && hst - bst.hp === DAMAGE.rise, '僵直中被打：打得退，傷害照算（3）');
  // 被破防攻擊打斷的不算出招：沒有僵直。
  const bn = bossAt(0, -4);
  bn.castT = 0;
  bossStep(bn, DT, p, makeWorld(), () => 0);
  bn.held = true;
  bossStep(bn, DT, p, makeWorld(), () => 0);
  ok(!bn.cast && !(bn.stun > 0), '被破防攻擊打斷：沒有僵直');
}

/* ── 16. 衝刺 ──────────────────────────────────────────────── */
console.log('16. 衝刺');
{
  ok(LUNGE.range === 1.8 && LUNGE.windup === 0.25 && LUNGE.speed === 16 && LUNGE.time === 0.25 && LUNGE.recover === 0.5,
    '追到 1.8 公尺以內、蓄力 0.25 秒、衝刺初速 16、0.25 秒減到 0、衝完僵直 0.5 秒');
  /** 一隻怪物從 z 追向站在原點的人，記下衝刺的每一件事。 */
  const run = (kind, z0, dt, during) => {
    const m = makeMonster({ kind, x: 0, z: z0, yaw: 0 });
    const q = body(0, 0);
    let t = 0, stopAt = -1, dashAt = -1, endAt = -1, stopD = 0, from = null, moved = false, hitAt = -1, touchedIdle = false;
    let hotEnd = -1;
    while (t < 4 && endAt < 0) {
      const had = m.lunge;
      const x0 = m.x, z1 = m.z;
      monsterStep(m, dt, q);
      if (!had && m.lunge && stopAt < 0) { stopAt = t; stopD = Math.hypot(m.x - q.x, m.z - q.z); from = [m.x, m.z]; }
      if (m.lunge && !lunging(m) && (m.x !== x0 || m.z !== z1)) moved = true;
      if (lunging(m) && dashAt < 0) dashAt = t;
      if (lunging(m)) hotEnd = t;
      if (had && !m.lunge && endAt < 0) endAt = t;
      if (during) during(q, m, t, stopAt);
      if (bites(q, m) && hitAt < 0) hitAt = t;
      if (touching(q, m) && !lunging(m)) touchedIdle = true;
      t += dt;
    }
    return { m, q, stopAt, dashAt, endAt, hotEnd, stopD, from, moved, hitAt, touchedIdle };
  };
  const a = run('minion', -4, DT);
  ok(a.stopAt > 0 && a.stopD <= LUNGE.range && a.stopD > LUNGE.range - 0.1, `追到 ${a.stopD.toFixed(2)} 公尺停下來`);
  ok(!a.moved && Math.abs(a.dashAt - a.stopAt - LUNGE.windup) < 2 * DT, `蓄力 ${(a.dashAt - a.stopAt).toFixed(2)} 秒、一步都沒動，然後衝`);
  ok(Math.abs(a.hotEnd - a.dashAt - LUNGE.time) < 2 * DT && Math.abs(a.endAt - a.hotEnd - LUNGE.recover) < 2 * DT,
    `衝了 ${(a.hotEnd - a.dashAt).toFixed(2)} 秒，衝完發呆 ${(a.endAt - a.hotEnd).toFixed(2)} 秒才收`);
  const dash = Math.hypot(a.m.x - a.from[0], a.m.z - a.from[1]);
  const want = (LUNGE.speed * LUNGE.time) / 2;
  ok(Math.abs(dash - want) < 1e-6, `衝了 ${dash.toFixed(3)} 公尺（${want} 公尺）`);
  ok(a.hitAt >= a.dashAt && a.dashAt > 0, '站著不動的人：衝的時候被碰到（衝 2.0 公尺，比 1.8 還長）');
  const slow = run('minion', -4, 1 / 20);
  ok(Math.abs(Math.hypot(slow.m.x - slow.from[0], slow.m.z - slow.from[1]) - want) < 1e-6, '每秒 20 幀也衝一樣遠（跟幀長無關）');
  // 碰到但沒在衝：沒事。
  const idle = makeMonster({ kind: 'minion', x: 0, z: 0.3, yaw: 0 });
  ok(touching(body(0, 0), idle) && !bites(body(0, 0), idle), '疊在一起但沒在衝：沒事');
  // 蓄力的時候往旁邊跨一步：方向已經鎖定，衝空。
  const side = run('minion', -4, DT, (q, m, t, stopAt) => { if (stopAt >= 0 && m.lunge && m.lunge.t < LUNGE.windup) q.x = 0.8; });
  ok(side.hitAt < 0, '蓄力的時候往旁邊跨 0.8 公尺：衝空');
  // 小怪蓄力的時候被打：擊退，這一下取消。
  let cutOk = null;
  run('minion', -4, DT, (q, m, t, stopAt) => {
    if (cutOk === null && stopAt >= 0 && m.lunge && m.lunge.t < LUNGE.windup && m.lunge.t > 0.1) {
      knock(m, 0, 0, 0, -1);
      cutOk = !m.lunge && m.air;
    }
  });
  ok(cutOk === true, '小怪蓄力的時候被打：擊退，這一下取消');
  // BOSS 蓄力的時候被打：打不退、傷害減半，照樣衝。
  let hurtTook = -1;
  const firm = run('boss', -4, DT, (q, m, t, stopAt) => {
    if (hurtTook < 0 && stopAt >= 0 && m.lunge && m.lunge.t < LUNGE.windup && m.lunge.t > 0.1) {
      const h = m.hp; knock(m, 0, 0, 0, -1); hurt(m, DAMAGE.rise); hurtTook = h - m.hp;
    }
  });
  ok(firm.dashAt > 0 && !firm.m.air && hurtTook === 1, 'BOSS 蓄力的時候被打：打不退、第二段的 3 只扣 1，照樣衝');
  // BOSS 衝完之後的發呆不是蓄力：打得退、傷害照算。
  const loose = makeMonster({ kind: 'boss', x: 0, z: -4, yaw: 0 });
  loose.lunge = { t: LUNGE.windup + LUNGE.time + 0.1, dirX: 0, dirZ: 1 };
  ok(!armored(loose), 'BOSS 衝完之後的發呆：不是蓄力');

  /* 紅色墨線（fight.js）與不可打斷都從 attacking 來。BOSS 每一招與衝刺輪流放，
     每一幀：不可打斷＝攻擊中；僵直與衝完的發呆不算；攻擊中一定有 cast 或還沒衝完的 lunge。
     新增技能時這一條自己會把關。 */
  {
    const wm = makeWorld(), bm = makeMonster({ kind: 'boss', x: 0, z: -4, yaw: 0 }), pm = body(0, 0);
    let seq = 0, mismatch = 0, redStun = 0, redRecover = 0, redFrames = 0, redNoCause = 0;
    const seen = new Set();
    for (let t = 0; t < 60; t += DT) {
      bossStep(bm, DT, pm, wm, () => [0.1, 0.5, 0.9][seq++ % 3]);
      monsterStep(bm, DT, pm);
      const red = attacking(bm);
      if (red !== armored(bm)) mismatch++;
      if (red) {
        redFrames++;
        if (bm.stun > 0) redStun++;
        if (bm.lunge && !bm.cast && bm.lunge.t >= LUNGE.windup + LUNGE.time) redRecover++;
        if (!bm.cast && !bm.lunge) redNoCause++;
        seen.add(bm.cast ? bm.cast.skill : 'lunge');
      }
    }
    ok(mismatch === 0, 'BOSS：不可打斷與紅色（attacking）每一幀都一樣');
    ok(redStun === 0 && redRecover === 0 && redNoCause === 0 && redFrames > 0, '紅色不含出招後的僵直與衝完的發呆');
    ok(['orb', 'leap', 'cone', 'lunge'].every((s) => seen.has(s)), `每一招與衝刺都出現過紅色（${[...seen].join('、')}）`);
    const mn = makeMonster({ kind: 'minion', x: 0, z: 0, yaw: 0 });
    mn.lunge = { t: LUNGE.windup + LUNGE.time / 2, dirX: 0, dirZ: 1 };
    ok(attacking(mn) && !armored(mn), '小怪衝的時候也是紅色，但不是不可打斷');
    mn.lunge.t = LUNGE.windup + LUNGE.time + 0.1;
    ok(!attacking(mn), '小怪衝完的發呆：不是紅色');
  }
}

/* ── 17. 幽靈 ────────────────────────────────────────────────── */
console.log('17. 幽靈');
{
  const ghost = (x, z, y = 0) => { const m = makeMonster({ kind: 'ghost', x, z, yaw: 0 }); m.y = y; return m; };
  ok(KINDS.ghost.fly && !KINDS.minion.fly && !KINDS.boss.fly && KINDS.ghost.hp === KINDS.minion.hp && KINDS.ghost.speed === KINDS.minion.speed,
    '名冊：只有幽靈會飛；血與腳程跟殭屍一樣');

  // 追：人站在 3 公尺高的地方，幽靈從地上飛上去，停下來的時候三維距離在 range 以內。
  {
    const m = ghost(0, -6), q = body(0, 0, 3);
    let t = 0;
    while (t < 5 && !m.lunge) { monsterStep(m, DT, q); t += DT; }
    const d = Math.hypot(m.x - q.x, m.y - q.y, m.z - q.z);
    ok(m.lunge && m.y > 1 && d <= LUNGE.range && d > LUNGE.range - 0.1,
      `人在 3 公尺高：飛到 y = ${m.y.toFixed(2)}、三維距離 ${d.toFixed(2)} 停下來蓄力`);
    ok(m.lunge && m.lunge.dirY > 0, '鎖定的方向往上');
    const from = [m.x, m.y, m.z];
    while (t < 6 && m.lunge) { monsterStep(m, DT, q); t += DT; }
    const dash = Math.hypot(m.x - from[0], m.y - from[1], m.z - from[2]);
    ok(Math.abs(dash - (LUNGE.speed * LUNGE.time) / 2) < 1e-6, `朝三維的方向衝了 ${dash.toFixed(3)} 公尺`);
  }
  // 站在地上的人：幽靈追到地面的高度，衝得到。
  {
    const m = ghost(0, -4, 2), q = body(0, 0);
    let t = 0, hit = false;
    while (t < 4 && !hit) { monsterStep(m, DT, q); hit = bites(q, m); t += DT; }
    ok(hit, '人在地上、幽靈從 2 公尺高追過來：衝得到');
  }
  // 擊退：往上飛得跟殭屍一樣高，停在那裡不掉，停了才回去追。
  {
    const m = ghost(0, -4), z = makeMonster({ kind: 'minion', x: 0, z: -4, yaw: 0 });
    knock(m, 0, 0, 0, -1); knock(z, 0, 0, 0, -1);
    let top = 0, zTop = 0, t = 0, stopAt = -1;
    while (t < 2) {
      if (z.air) { monsterStep(z, DT, body(0, 20)); zTop = Math.max(zTop, z.y); }
      if (m.air) { monsterStep(m, DT, body(0, 20)); top = Math.max(top, m.y); if (!m.air) stopAt = t; }
      t += DT;
    }
    ok(Math.abs(top - zTop) < 0.05, `基準擊退挑起來：幽靈最高 ${top.toFixed(2)}、殭屍最高 ${zTop.toFixed(2)}`);
    ok(stopAt > 0 && near(m.y, top) && m.vy === 0, `${stopAt.toFixed(2)} 秒停在 ${m.y.toFixed(2)} 公尺的半空，不落下`);
    const y0 = m.y, z0 = m.z;
    for (let i = 0; i < 10; i++) monsterStep(m, DT, body(0, 20, y0));
    ok(m.z > z0 && near(m.y, y0, 0.01), '停了之後回去追人（同一個高度的人：只往前、不升降）');
  }
  // 高度夾在地板與蓋子底下。
  {
    const hi = ghost(0, 0, FLY.top - 0.5);
    knock(hi, 0, 0, 0, -1, KNOCK_SCALE.rise);
    for (let i = 0; i < 120 && hi.air; i++) monsterStep(hi, DT, body(0, 20));
    const lo = ghost(0, 0, 0.2);
    lo.vy = -10; lo.air = true;
    for (let i = 0; i < 60 && lo.air; i++) monsterStep(lo, DT, body(0, 20));
    ok(near(hi.y, FLY.top) && FLY.top === ARENA.lid - PHYS.height && near(lo.y, 0),
      `往上砸：停在蓋子底下 ${hi.y.toFixed(2)}；往下：停在地板`);
  }
  // 破防攻擊的迴旋之後：在原本的高度被推開，不落下。
  {
    const m = ghost(0, -2, 1.5), c = makeCombo(), p = body(0, 0);
    m.hp = KINDS.boss.hp;                  // 破防攻擊扣 5，比幽靈的血多——別讓牠死了重生回地上
    c.dashX = 0; c.dashZ = -1;
    latch(c, p, m);
    c.t = BREAK_ATK.spin;
    spinStep(c, p, m);
    for (let i = 0; i < 60 && m.slide; i++) monsterStep(m, DT, body(0, 20, 1.5));
    ok(!m.air && !m.slide && near(m.y, 1.5) && m.z < -2, `轉完被推開：還在 ${m.y.toFixed(2)} 公尺高，往突進的方向滑開`);
  }
  // 在空中被擊退的幽靈：破防攻擊照牠 T 秒後的位置瞄，碰得到。
  {
    const m = ghost(0, -3, 1);
    knock(m, 0, -1, 0, -1, KNOCK_SCALE.slam);
    for (let i = 0; i < 3; i++) monsterStep(m, DT, body(0, 20));
    const c = makeCombo(), p = { ...body(0, 0), vx: 0, vy: 0, vz: 0, grounded: true };
    startBreak(c, p, m);
    let hit = false;
    for (let t = 0; t < BREAK_ATK.flight + 0.1 && !hit; t += DT) {
      p.vy -= PHYS.gravity * DT;
      p.x += p.vx * DT; p.y += p.vy * DT; p.z += p.vz * DT;
      if (m.air) monsterStep(m, DT, body(0, 20));
      hit = breakContact(p, m);
    }
    ok(hit, '被第三段往上砸、正在飛的幽靈：破防攻擊碰得到');
  }
  /* 飛的時候常駐的漂（monster.js 的 Motion）：四條腿一直往後、慢慢擺，尾巴同一個
     相位；停下來淡掉；不會飛的不漂；衝刺的蓄力讓給蓄力那一套。 */
  {
    const fly = (kind, speed) => {
      const mo = new Motion(), m = makeMonster({ kind, x: 0, z: 0, yaw: 0 });
      m.vz = speed; m.grounded = false;
      return { mo, m, go: (secs) => { const out = []; for (let t = 0; t < secs - 1e-9; t += DT) out.push({ ...mo.step(DT, m, null).move }); return out; } };
    };
    const g = fly('ghost', KINDS.ghost.speed);
    g.go(3);
    const rec = g.go(5);
    const phase = (p) => (p.front - 0.35) / 0.25;
    let full = true, back = true, sync = true, ups = 0;
    rec.forEach((p, i) => {
      if (Math.abs(p.legs - 1) > 1e-3) full = false;
      if (!(p.front > 0 && p.hind > 0)) back = false;
      const s = phase(p);
      if (Math.abs((p.hind - 0.75) / 0.25 - s) > 1e-3 || Math.abs((p.tailPitch - 0.10) / 0.30 - s) > 1e-3) sync = false;
      if (i && phase(rec[i - 1]) < 0 && s >= 0) ups++;
    });
    ok(full && back, '幽靈全速飛：四條腿整個換成漂的姿勢，一直是往後的');
    ok(sync, '前腿、後腿、膝蓋、尾巴同一個相位');
    ok(ups >= 2 && ups <= 4, `慢慢擺：5 秒擺 ${ups} 下`);
    g.m.vz = 0;
    const still = g.go(1.5).pop();
    ok(still.legs < 0.02, `停下來 1.5 秒：漂淡到 ${still.legs.toFixed(3)}`);
    const z = fly('minion', KINDS.minion.speed);
    ok(z.go(2).every((p) => p.legs === 0 && p.tailPitch === 0), '殭屍（不會飛）走路不漂');
    const w = fly('ghost', KINDS.ghost.speed);
    w.go(2);
    w.m.lunge = { t: 0 };
    let last;
    for (let t = 0; t < LUNGE.windup - DT / 2; t += DT) { last = w.mo.step(DT, w.m, null).move; w.m.lunge.t += DT; }
    ok(Math.abs(last.legs - 0.8) < 0.01, `衝刺蓄力到最後：腿是蓄力那一套的 ${last.legs.toFixed(3)}，漂已經收掉`);
  }
}

/* ── 18. 場地 ────────────────────────────────────────────────── */
console.log('18. 場地');
{
  /* 一塊圓的場地（半徑 10）：中間一座 6×6、頂在 2 公尺的高台，東邊一級 0.3 的台階，
     北邊一扇門（屬於 'g'，關著就是一道牆）。碰撞的欄位跟 geom.js 登記的一樣。 */
  const arena = { id: 'ring', shape: 'circle', x: 0, z: 0, r: 10, lid: 12 };
  const box = (x0, y0, z0, x1, y1, z1, more = {}) => ({ kind: 'block', min: [x0, y0, z0], max: [x1, y1, z1], base: y0, ...more });
  const cols = [
    { kind: 'bound', ...arena, min: [-10, -2, -10], max: [10, 30, 10], base: -2 },
    box(-3, 0, -3, 3, 2, 3, { kind: 'floor' }),
    box(5, 0, -1, 9, 0.3, 1, { kind: 'floor' }),
    box(-2, 0, -7.2, 2, 3, -6.8, { door: 'g' }),
  ];
  const field = { arena, cols, doors: {} };
  const on = (spawn, f = field) => makeMonster(spawn, f);
  // 只看走路：追到了也不讓牠停下來衝。
  const run = (m, target, secs) => {
    for (let t = 0; t < secs; t += DT) { monsterStep(m, DT, target); if (m.lunge) m.lunge = null; }
  };

  ok(makeMonster().field === FIELD && FIELD.arena === ARENA, '沒給場地的怪物站在這一頁那塊空地上');

  const up = on({ kind: 'minion', x: -2, y: 2, z: 0, yaw: 0 });
  run(up, body(2.5, 0, 2), 0.6);
  ok(near(up.y, 2) && !up.air && up.x > -2, `站在高台上追台上的人：一直在台上（y = ${up.y.toFixed(2)}）`);
  knock(up, 0, 0, 0, -1);
  run(up, body(2.5, 0, 2), 1.2);
  ok(!up.air && near(up.y, 2), '在台上被擊退：落回台上');

  const off = on({ kind: 'minion', x: 0, y: 2, z: 0, yaw: 0 });
  let fell = false;
  for (let t = 0; t < 4 && !(off.z > 5 && !off.air); t += DT) {
    monsterStep(off, DT, body(0, 8));
    if (off.lunge) off.lunge = null;
    fell ||= off.air;
  }
  ok(fell && !off.air && near(off.y, 0) && off.z > 3, `走出台緣：掉下去、落在地上（y = ${off.y.toFixed(2)}、z = ${off.z.toFixed(2)}）`);

  const step = on({ kind: 'minion', x: 3.8, z: 0, yaw: Math.PI / 2 });
  run(step, body(8.5, 0, 0.3), 1.0);
  ok(step.x > 5.5 && near(step.y, 0.3), `踏上 0.3 的一級台階（y = ${step.y.toFixed(2)}）`);

  const shut = on({ kind: 'minion', x: 0, z: -5, yaw: Math.PI });
  run(shut, body(0, -9), 1.5);
  ok(shut.z >= -6.8 + PHYS.radius - 1e-3, `門關著：擋在門前（z = ${shut.z.toFixed(2)}）`);
  const open = on({ kind: 'minion', x: 0, z: -5, yaw: Math.PI }, { ...field, doors: { g: true } });
  run(open, body(0, -9), 1.5);
  ok(open.z < -7.2, `門開著：走得過去（z = ${open.z.toFixed(2)}）`);

  ok(near(laneLength(0, 0, 1, 0, arena), 10) && near(laneLength(0, 6, 0, -1, arena), 16), '圓的黑牆：球道從圓心量到牆、從牆邊量到對面');
  const w = makeWorld(field);
  w.shots.push({ x: 9.5, y: 0.5, z: 0, vx: 6, vz: 0, r: 0.3 });
  const wall = w.shots[0];
  const boomed = shotsStep(w, 0.1);
  ok(w.shots.length === 0 && boomed.length === 1 && boomed[0] === wall, '球飛到圓的黑牆就炸掉消失（回報炸掉的那一顆）');
  const ball = (x, y, z, r = 0.3) => ({ x, y, z, vx: 0, vz: 0, r });
  ok(shotBlocked(ball(-3.2, 0.5, 0), field) && !shotBlocked(ball(-3.4, 0.5, 0), field), '球撞到高台的側面：碰到才算');
  ok(!shotBlocked(ball(0, 2.3, 0), field), '球貼著高台的頂飛（底在台面上）：不算撞到');
  ok(shotBlocked(ball(5.1, 0.3, 0), field), '貼地飛的球撞上 0.3 的台階側面：炸掉');
  ok(shotBlocked(ball(0, 0.5, -6.6), field) && !shotBlocked(ball(0, 0.5, -6.6), { ...field, doors: { g: true } }),
    '門關著：球撞在門上；門開著：穿得過去');
  const post = { arena, cols: [{ kind: 'block', shape: 'circle', x: 0, z: 0, r: 0.5, cap: 3, dome: 0, min: [-0.5, 0, -0.5], max: [0.5, 3, 0.5], base: 0 }], doors: {} };
  ok(shotBlocked(ball(0.75, 0.5, 0), post) && !shotBlocked(ball(0.85, 0.5, 0), post) && !shotBlocked(ball(0.7, 3.4, 0), post),
    '圓柱：碰到柱面才算，從柱頂上面飛過去不算');
  const wp = makeWorld(field);
  wp.shots.push({ x: -4, y: 0.5, z: 0, vx: 6, vz: 0, r: 0.3 });
  let hitAt = -1;
  for (let i = 0; i < 30 && hitAt < 0; i++) if (shotsStep(wp, DT).length) hitAt = wp.shots.length === 0 ? i : -2;
  ok(hitAt >= 0, '飛向高台的球：撞上的那一幀炸掉、不再在場上');

  // 跳砸：BOSS 在地上、玩家站在台上。rng 0.5 挑三招的中間那一招（leap）。
  const boss = on({ kind: 'boss', x: -6, z: 0, yaw: Math.PI / 2 });
  boss.castT = 0;
  const p = { ...body(0, 0, 2), vx: 0, vy: 0, vz: 0, grounded: true };
  let strike = null;
  for (let t = 0; t < 3 && !strike; t += DT) strike = bossStep(boss, DT, p, makeWorld(field), () => 0.5);
  ok(strike && strike.shape === 'circle' && near(boss.y, 2) && near(strike.y, 2), `跳砸落在台上（y = ${boss.y.toFixed(2)}）`);
  ok(strike && strikeHits(strike, p) && !strikeHits(strike, { ...p, y: 2 + PHYS.height + 0.01 }),
    '打的是台上那一層：站在台上會中、腳離台面超過一個狗高就躲得過');
}

/* ── 19. 玩家的血 ────────────────────────────────────────────────── */
console.log('19. 玩家的血');
{
  const p = {};
  resetLife(p);
  ok(LIFE.start === 3 && p.hp === 3 && p.guard === 0, '一開始 3 點血');
  ok(KINDS.minion.bite === 1 && KINDS.ghost.bite === 1 && KINDS.knight.bite === 2 && KINDS.boss.bite === 3, '小怪咬 1、騎士咬 2、BOSS 咬 3');
  ok(['orb', 'leap', 'cone'].every((k) => SKILL[k].damage === 5), 'BOSS 的三招各 5');

  ok(harm(p, KINDS.minion.bite) && p.hp === 2 && p.guard === LIFE.guard, '被小怪咬到：3 → 2，開 guard');
  ok(!harm(p, 5) && p.hp === 2, 'guard 還開著：再被打到不扣');
  for (let t = 0; t < LIFE.guard + DT; t += DT) lifeStep(p, DT);
  ok(p.guard === 0 && harm(p, 5) && p.hp === 0, 'guard 過了：挨 5 扣到 0，不會變負的');
  resetLife(p);
  ok(harm(p, KINDS.boss.bite) && p.hp === 0, '滿血被 BOSS 咬到一下：3 → 0，倒下');

  // 一次衝刺從頭衝到尾：站著不動的人只扣一次。
  const q = { ...body(0, 0), vx: 0, vy: 0, vz: 0, grounded: true };
  resetLife(q);
  const m = makeMonster({ kind: 'minion', x: 0, z: -3, yaw: 0 });
  let bitFrames = 0;
  for (let t = 0; t < 1.5; t += DT) {
    lifeStep(q, DT);
    monsterStep(m, DT, q);
    if (bites(q, m)) { bitFrames++; harm(q, KINDS[m.kind].bite); }
  }
  ok(bitFrames > 1 && q.hp === 2, `衝刺碰著人 ${bitFrames} 幀，只扣 1 點（剩 ${q.hp}）`);

  // 球與範圍攻擊身上帶著這一招的傷害。rng 挑招：0 → orb、0.5 → leap、0.9 → cone。
  const boss = makeMonster({ kind: 'boss', x: 0, z: -4, yaw: 0 });
  const tgt = { ...body(0, 0), vx: 0, vy: 0, vz: 0, grounded: true };
  const dmgOf = (pick) => {
    const w = makeWorld();
    placeMonster(boss);
    boss.castT = 0;
    for (let t = 0; t < 3; t += DT) {
      const st = bossStep(boss, DT, tgt, w, () => pick);
      if (st) return st.dmg;
      if (w.shots.length) return w.shots[0].dmg;
    }
    return null;
  };
  ok(dmgOf(0) === 5 && dmgOf(0.5) === 5 && dmgOf(0.9) === 5, '球、跳砸、扇形打出來都帶著 5');

  // 最大血量與回血。
  const r = {};
  resetLife(r);
  gainHeart(r);
  ok(r.max === 4 && r.hp === 4, '撿到靈魂：最大血量 3 → 4，多的那一顆是滿的');
  r.guard = 0;
  harm(r, 3);
  refill(r);
  ok(r.hp === 4 && r.max === 4 && r.guard === 0, '倒下補滿：補到最大血量，撿到的那一顆留著');
  resetLife(r);
  ok(r.max === LIFE.start && r.hp === LIFE.start, '從頭開始：最大血量回到 3');
  gainHeart(r); gainHeart(r);
  r.hp = 0;
  let tr = 0;
  while (r.hp < r.max && tr < 5) { regen(r, DT); tr += DT; }
  ok(r.hp === 5 && near(tr, 5 * LIFE.regen, DT * 1.5), `不在戰鬥中：0 → 5 花 ${tr.toFixed(2)} 秒（每 ${LIFE.regen} 秒一顆）`);
  for (let k = 0; k < 60; k++) regen(r, DT);
  ok(r.hp === r.max, '回滿了就停在最大血量');
}

/* ── 20. 靈魂 ────────────────────────────────────────────────────── */
console.log('20. 靈魂');
{
  ok(KINDS.boss.soul && !KINDS.minion.soul && !KINDS.ghost.soul, '只有 BOSS 會掉靈魂');

  // 在平地上被打死：從身體中間掉下來，落在地板上 0.5 公尺停住。
  const s = dropSoul({ x: 1, y: 0, z: 2, field: FIELD });
  const y0 = s.y;
  let t = 0;
  while (s.base === null && t < 2) { soulStep(s, DT); t += DT; }
  ok(y0 > SOUL.hover && s.base !== null && near(s.base, SOUL.hover), `受重力往下掉，${t.toFixed(2)} 秒後停在離地 ${SOUL.hover} 公尺`);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < SOUL.period / DT + 1; k++) { soulStep(s, DT); lo = Math.min(lo, s.y); hi = Math.max(hi, s.y); }
  ok(near(hi, SOUL.hover + SOUL.bob, 0.01) && near(lo, SOUL.hover - SOUL.bob, 0.01) && s.x === 1 && s.z === 2,
    `之後在 ${lo.toFixed(2)}～${hi.toFixed(2)} 之間上下漂（±${SOUL.bob}），不橫移`);

  // 被挑在半空、腳下是高台：一路掉到台面上 0.5 公尺。
  const cols = [...FIELD.cols, { kind: 'floor', min: [-3, 0, -3], max: [3, 2, 3], base: 0 }];
  const a = dropSoul({ x: 0, y: 4, z: 0, field: { ...FIELD, cols } });
  for (let k = 0; k < 120 && a.base === null; k++) soulStep(a, DT);
  ok(near(a.base, 2 + SOUL.hover), `在高台上空死掉：落在台面上 ${SOUL.hover} 公尺（${a.base.toFixed(2)}）`);

  // 撿：碰到身體才撿得到。
  const at = (x, y, z) => ({ x, y, z });
  ok(grabs(body(0, 0), at(0.3, 0.5, 0)) && !grabs(body(0, 0), at(PHYS.radius + SOUL.r + 0.01, 0.5, 0)), '水平上碰到身體才撿得到');
  ok(!grabs(body(0, 0, 2), at(0, 0.5, 0)) && grabs(body(0, 0, 0.5), at(0, 0.5, 0)), '跳在牠正上方太高撿不到、碰到就撿得到');
}

/* ── 21. 劍光 ────────────────────────────────────────────────────── */
console.log('21. 劍光');
{
  const range = { slash: inSlash, slam: inRing, whirl: inRing };
  ok(sweepAt('slash', 0) === -Math.PI / 3 && near(sweepAt('slash', 1), Math.PI / 3), '第一段：從右 60° 掃到左 60°，就是判定的那 120°');
  ok(sweepAt('rise', 0) === 0 && near(sweepAt('rise', 1), FAN.sweep), '第二段：從扇形的下緣往上掃 90°，就是判定的那片扇形');
  ok(TRAILS.slam.to - TRAILS.slam.from >= 2 * Math.PI, '第三段：掃滿一整圈');
  for (const kind of Object.keys(TRAILS)) {
    let mono = true;
    for (let t = 0; t < 1; t += 0.005) if (sweepAt(kind, t + 0.005) < sweepAt(kind, t) - 1e-9) mono = false;
    ok(mono, `${kind}：一路往同一個方向掃，不回頭`);
    const T = TRAILS[kind];
    ok(fadeAt(kind, T.t1) === 1 && fadeAt(kind, T.life) === 0 && fadeAt(kind, (T.t1 + T.life) / 2) < 1,
      `${kind}：掃的時候全亮，掃完之後淡掉，${T.life} 秒收起來`);
  }

  /* 三道的形狀：最外那一道的外緣就在判定的半徑上、最粗；往內一道比一道靠內、
     一道比一道細；相鄰兩道疊在一起；最裡面那一道也不過身體中心。 */
  const me = body(0, 0, 0, [0, -1]);
  const mid = (kind) => (TRAILS[kind].from + TRAILS[kind].to) / 2;
  const along60 = (kind, k) => TRAILS[kind].from + ((TRAILS[kind].to - TRAILS[kind].from) * k) / 60;
  const radius = (q) => Math.hypot(...q.p.map((v, i) => v - q.b.o[i]));
  let order = BANDS.length === 3 && BANDS[0].out === REACH;
  for (let b = 1; b < BANDS.length; b++) {
    const o = BANDS[b - 1], i = BANDS[b];
    if (!(i.out < o.out && i.wide < o.wide && i.out > o.out - o.wide)) order = false;
  }
  const last = BANDS[BANDS.length - 1];
  ok(order && last.out - last.wide > 0,
    `一刀三道：最外那一道貼 REACH、最粗（${BANDS.map((b) => b.wide.toFixed(2)).join(' → ')} 公尺），往內一道比一道細，相鄰兩道疊在一起`);
  for (const kind of Object.keys(TRAILS)) {
    let edge = true;
    for (let k = 0; k <= 60; k++) {
      for (let b = 0; b < BANDS.length; b++) {
        const q = qiAt(kind, along60(kind, k), me, slashTip(me), b);
        if (!near(radius(q) + q.w / 2, BANDS[b].out)) edge = false;
      }
    }
    ok(edge, `${kind}：每一道的外緣一路都在它的 out 上（最外那一道在 REACH ${REACH.toFixed(2)} 公尺）`);
  }
  /* 合起來的外框（qi.js 鋪的就是它，光影照它算）：每一截三道都在框裡，框的內緣就是
     最靠內的那一道的內緣、外緣就是 REACH；全寬的時候三道併成一塊、中間沒有空。 */
  let hull = true;
  for (let s = 0; s <= 1.0001; s += 0.05) {
    const h = hullOf(s), ins = BANDS.map((B) => B.out - B.wide * s);
    if (!near(h.outer, REACH) || !near(h.inner, Math.min(...ins)) || ins.some((v) => v < h.inner - 1e-12)) hull = false;
  }
  const full = [...BANDS].sort((a, b) => a.out - b.out);
  let joined = true;
  for (let i = 1; i < full.length; i++) if (full[i].out - full[i].wide > full[i - 1].out) joined = false;
  ok(hull && joined, '三道合起來的外框框得住每一道、外緣在 REACH，全寬的時候併成一塊');

  // 一側寬：起點尖、往刀那一頭只變寬不變窄，刀那一頭是全寬的平邊。
  for (const kind of ['slash', 'rise']) {
    let grow = true;
    for (let k = 0; k < 60; k++) if (sideAt(kind, along60(kind, k + 1)) < sideAt(kind, along60(kind, k)) - 1e-12) grow = false;
    ok(grow && sideAt(kind, TRAILS[kind].from) < 0.2 && sideAt(kind, TRAILS[kind].to) === 1 && sideAt(kind, mid(kind)) > 0.9,
      `${kind}：一側寬——起點收到兩成以下、往刀那一頭只變寬，刀那一頭全寬`);
  }
  ok(sideAt('slam', TRAILS.slam.from) === 1 && sideAt('slam', mid('slam')) === 1, '第三段是一整圈，寬度不收');

  /* 劍氣就是範圍：三道上的每一點（中線與內外兩緣）放一隻怪物，都要打得到。各種
     面向；第二段各種「上一次第一段的末端點」（正前方、偏一邊、跳起來高過它）。 */
  const cases = [];
  for (const a of [0, 1.1, 2.5, -2.0]) {
    const p = body(0.7, -1.3, 0, [Math.sin(a), Math.cos(a)]);
    cases.push([p, slashTip(p)]);
    cases.push([{ ...p, y: 1.4 }, slashTip(p)]);
    cases.push([p, { x: p.x + 0.5, y: p.y + 0.46, z: p.z - 1.9 }]);
  }
  let inside = true, where = '';
  for (const kind of Object.keys(TRAILS)) {
    for (const [p, tip] of cases) {
      for (let k = 0; k <= 60; k++) {
        for (let b = 0; b < BANDS.length; b++) {
          const q = qiAt(kind, along60(kind, k), p, tip, b), r = radius(q);
          for (const rr of [r - q.w / 2, r, r + q.w / 2 - 1e-6]) {
            const pt = along(q.b, rr);
            const m = { x: pt[0], y: pt[1] - PHYS.height / 2, z: pt[2] };
            const hit = kind === 'rise' ? inFan(p, m, tip) : range[kind](p, m);
            if (!hit && inside) { inside = false; where = `${kind} 第 ${b + 1} 道在 (${pt.map((v) => v.toFixed(2))})`; }
          }
        }
      }
    }
  }
  ok(inside, `三道上的每一點都打得到${inside ? '' : `——${where} 打不到`}`);

  /* 整道劍氣在同一個面上：人沒動的話每一截的面法線（刀的方向 × 掃的方向）都一樣，
     而且每一截都在那個面上。三道是同一把刀上不同的半徑，所以也在這個面上。 */
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let flat = true;
  for (const kind of Object.keys(TRAILS)) {
    for (const [p, tip] of cases) {
      const q0 = qiAt(kind, TRAILS[kind].from, p, tip), N = cross(q0.b.d, q0.b.t);
      for (let k = 0; k <= 60; k++) {
        const q = qiAt(kind, along60(kind, k), p, tip), n = cross(q.b.d, q.b.t);
        if (Math.abs(dot(n, N) - 1) > 1e-9 || Math.abs(dot(q.p.map((v, i) => v - q0.p[i]), N)) > 1e-9) flat = false;
      }
    }
  }
  ok(flat, '整道劍氣在同一個面上、每一截的面法線都一樣（第二段是那片鉛直扇形所在的面）');

  // 一排最多掃過 PIECE：每一道的外緣兩排之間走的距離比那一道最寬處短，弧才不會變成折線。
  ok(BANDS.every((B) => PIECE * B.out < B.wide),
    `兩排之間每一道的外緣最多走 ${BANDS.map((B) => (PIECE * B.out).toFixed(2)).join(' / ')} 公尺，比那一道最寬處（${BANDS.map((B) => B.wide.toFixed(2)).join(' / ')}）短`);
}

/* ── 22. 落地粉塵 ──────────────────────────────────────────────────── */
console.log('22. 落地粉塵');
{
  ok(dustOf(1, DUST.min) === null && dustOf(1, 1) === null && dustOf(2, 0) === null, `落地比 ${DUST.min} 公尺 / 秒慢不起塵`);
  ok(near(dustOf(1, PHYS.jump).power, 1), '狗普通地跳一下（落地速度 = PHYS.jump）是力道 1');
  ok(dustOf(2, 40).power === DUST.max && dustOf(1, 200).power === DUST.max, `力道最多 ${DUST.max}`);

  /* 越大、越重，每一項都不會變小。 */
  const KEYS = ['power', 'amount', 'foot', 'push', 'life', 'half', 'thick'];
  const grows = (a, b) => KEYS.filter((k) => b[k] < a[k] - 1e-12);
  let bySpeed = [], bySize = [];
  for (const size of [0.5, 1, 1.5, 2]) {
    for (let v = DUST.min + 0.1; v < 20; v += 0.25) {
      const bad = grows(dustOf(size, v), dustOf(size, v + 0.25));
      if (bad.length) bySpeed.push(`體型 ${size}、${v.toFixed(2)} → ${(v + 0.25).toFixed(2)}：${bad.join('、')}`);
    }
  }
  for (const v of [4, PHYS.jump, 12]) {
    for (let size = 0.5; size < 2.5; size += 0.1) {
      const bad = grows(dustOf(size, v), dustOf(size + 0.1, v));
      if (bad.length) bySize.push(`${v.toFixed(1)} 公尺 / 秒、體型 ${size.toFixed(1)} → ${(size + 0.1).toFixed(1)}：${bad.join('、')}`);
    }
  }
  ok(!bySpeed.length, `落得越重，塵越濃越大越久${bySpeed.length ? '——' + bySpeed[0] : ''}`);
  ok(!bySize.length, `體型越大，塵越濃越大越久${bySize.length ? '——' + bySize[0] : ''}`);
  const dog = dustOf(1, PHYS.jump), boss = dustOf(2, PHYS.jump);
  ok(boss.amount > dog.amount && boss.half > dog.half, `同樣的落地速度，BOSS（體型 2）的塵比狗濃、比狗大（力道 ${boss.power.toFixed(1)} 對 ${dog.power.toFixed(1)}）`);

  /* 那一片煙裝得下推出去的塵：往外推 push、留 life 秒，推到的地方還在 half 以內。 */
  let fits = true;
  for (const size of [0.5, 1, 2]) for (const v of [3, 8, 15]) {
    const d = dustOf(size, v);
    if (d.foot + 0.4 * d.push * d.life > d.half) fits = false;
  }
  ok(fits, '那一片煙的半邊長裝得下起塵的那一圈加上往外推的距離');

  let fades = true;
  const d = dustOf(1.5, 9);
  for (let t = 0; t < d.life; t += 0.01) if (dustFade(d, t + 0.01) > dustFade(d, t) + 1e-12) fades = false;
  ok(dustFade(d, 0) === 1 && dustFade(d, d.life) === 0 && fades, `一團塵一開始全在、一路淡下去、${d.life.toFixed(2)} 秒收掉`);

  /* 地震：一道比一道外面、晚、濃。 */
  for (const [name, shape, r] of [['扇形', 'cone', SKILL.cone.radius], ['跳砸的圓', 'circle', SKILL.leap.radius]]) {
    const bands = quakeBands(shape, r);
    const gaps = bands.slice(1).map((b, i) => (b.u - bands[i].u) * r);
    ok(bands.every((b, i) => i === 0 || (b.u > bands[i - 1].u && b.at > bands[i - 1].at && b.amount > bands[i - 1].amount))
      && gaps.every((g) => g > 0.7 * QUAKE.gap),
      `地震的塵（${name}，半徑 ${r.toFixed(2)}）：${bands.length} 道、隔 ${gaps[0].toFixed(2)} 公尺，越外面越晚揚、越濃`
      + `（${bands[0].amount.toFixed(2)} → ${bands.at(-1).amount.toFixed(2)}）`);
  }
  const last = quakeBands('cone', SKILL.cone.radius).at(-1).at + QUAKE.inject;
  let qFades = true;
  for (let t = 0; t < QUAKE.life; t += 0.01) if (quakeFade(t + 0.01) > quakeFade(t) + 1e-12) qFades = false;
  ok(quakeFade(0) === 1 && quakeFade(last) === 1 && quakeFade(QUAKE.life) === 0 && qFades && last < QUAKE.life,
    `地震的塵：最外面那一道 ${last.toFixed(2)} 秒揚完之前整片不淡，之後淡到 ${QUAKE.life} 秒收掉`);
}

/* ── 23. 噴血 ────────────────────────────────────────────────── */
console.log('23. 噴血');
{
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // 出血量：半徑立方和正好是 volume · s³；滴數照 s^1.5。
  let exact = true;
  for (const s of [0.7, 1, 2]) {
    const sum = spurtOf(pushFrame(1, 0), { x: 0, y: 0, z: 0 }, s, 'blood', rng).reduce((a, o) => a + o.r ** 3, 0);
    if (Math.abs(sum / volumeOf(s) - 1) > 1e-9) exact = false;
  }
  ok(exact, '一次噴出去的血總量正好是 volume · 體型³（0.7、1、2 倍都是）');
  ok(near(volumeOf(2) / volumeOf(1), 8), 'BOSS（體型 2）的出血量是狗的 8 倍');
  const n1 = spurtOf(pushFrame(1, 0), { x: 0, y: 0, z: 0 }, 1, 'blood', rng), n2 = spurtOf(pushFrame(1, 0), { x: 0, y: 0, z: 0 }, 2, 'blood', rng);
  ok(n1.length === BLEED.drops && n2.length === dropCount(2) && n2.length === Math.round(BLEED.drops * 2 ** 1.5),
    `滴數跟著體型的 1.5 次方：${n1.length} → ${n2.length}`);
  let inside = true;
  const seen = [];
  for (let k = 0; k < 200; k++) {
    for (const s of [1, 2]) {
      const [lo, hi] = sizeRange(s);
      const l = spurtOf(pushFrame(1, 0), { x: 0, y: 0, z: 0 }, s, 'blood', rng);
      if (Math.abs(l.reduce((x, o) => x + o.r ** 3, 0) / volumeOf(s) - 1) > 1e-9) inside = false;
      for (const o of l) { if (o.r < lo - 1e-12 || o.r > hi + 1e-12) inside = false; if (s === 1) seen.push(o.r); }
    }
  }
  ok(inside, `每一滴都在區間裡（體型 1 是 ${BLEED.size.join('～')} 公尺，照 √體型放大），200 批每一批總量都剛好`);
  ok(Math.min(...seen) < BLEED.size[0] + 0.003 && Math.max(...seen) > BLEED.size[1] - 0.003, '大小在區間裡亂給：兩頭都抽得到');
  ok(speedOf(BLEED.size[0], 1) === BLEED.speed[1] && speedOf(BLEED.size[1], 1) === BLEED.speed[0] && speedOf(0.04, 1) > speedOf(0.05, 1),
    `越小越快：最小的 ${BLEED.speed[1]}、最大的 ${BLEED.speed[0]} 公尺／秒`);
  const vmax = (l) => Math.max(...l.map((o) => Math.hypot(o.vx, o.vy, o.vz)));
  ok(vmax(n1) <= BLEED.speed[1] + 1e-9 && vmax(n2) <= BLEED.speed[1] * Math.SQRT2 + 1e-9 && vmax(n2) > BLEED.speed[1],
    '初速照體型的根號放大（射程 v²/g 跟著體型變遠）');
  // 小的噴得比大的遠：真的讓每一滴飛到落地，量沿著噴的方向走了多遠。起點一律放在同一點，
  // 比的只是大小（傷口沿著 t 散開，第二段的 t 是立著的，起點高低不一會混進來）。
  const flat = { arena: { shape: 'circle', x: 0, z: 0, r: 50 }, cols: [] };
  const pw = { x: 0, y: 0, z: 0, aimX: 0, aimZ: 1 };
  let farther = true, flights = 0;
  for (const f of [pushFrame(0, 1), hitFrame('slash', pw, null, { x: 0.3, y: 0, z: 1.5 }, 1), hitFrame('rise', pw, slashTip(pw), { x: 0, y: 0.6, z: 1.2 }, 1)]) {
    for (const s of [1, 2]) {
      const land = spurtOf(f, { x: 0, y: 0, z: 0 }, s, 'blood', rng).map((o) => {
        const one = [{ ...o, x: 0, y: 0.5, z: 0, field: flat }], sp = [];
        for (let t = 0; t < 3 && one.length; t += DT) bleedStep(one, sp, DT);
        return { r: o.r, far: sp.length ? sp[0].x * f.d[0] + sp[0].z * f.d[2] : -1 };
      }).sort((a, b) => a.r - b.r);
      for (let i = 1; i < land.length; i++) if (land[i].far >= land[i - 1].far) farther = false;
      if (land.some((q) => q.far < 0)) farther = false;
      flights += land.length;
    }
  }
  ok(farther && flights > 0, `小的血滴噴得比大的遠（破防攻擊、第一段、第二段各飛到落地量，${flights} 滴）`);

  // 方向：跟劍氣垂直（沒有沿著掃的方向 t 的份）、躺在劍氣的面上；是劍氣經過怪物那一截的刀。
  const p = { x: 0, y: 0, z: 0, aimX: 0.6, aimZ: 0.8 };
  const tip = slashTip(p);
  let perp = true, plane = true, aimed = true, start = true, count = 0;
  const cases = [
    ['slash', [[0.6, 0.8], [1, 0.3], [0.1, 1]]],
    ['slam', [[0.6, 0.8], [-1, 0.2], [-0.6, -0.8]]],
    ['rise', [[0.6, 0.8], [0.72, 0.96]]],
  ];
  for (const [kind, spots] of cases) {
    for (const [dx, dz] of spots) {
      for (const s of [1, 2]) {
        const m = { x: dx * 1.2, y: kind === 'rise' ? 0.6 : 0, z: dz * 1.2 };
        const f = hitFrame(kind, p, kind === 'rise' ? tip : null, m, s);
        const nrm = cross(f.d, f.t);
        const h = Math.hypot(m.x - p.x, m.z - p.z);
        // 水平上指著怪物（第一段與第三段在水平面上；第二段在那片扇形裡，水平的份也是朝牠）
        const fh = Math.hypot(f.d[0], f.d[2]);
        if (((m.x - p.x) * f.d[0] + (m.z - p.z) * f.d[2]) / (h * fh) < 0.999) aimed = false;
        for (const o of spurtOf(f, m, s, 'blood', rng)) {
          const v = [o.vx, o.vy, o.vz];
          if (Math.abs(dot(v, f.t)) > 1e-9) perp = false;
          if (Math.abs(dot(v, nrm)) > 1e-9) plane = false;
          if (Math.hypot(o.x - m.x, o.z - m.z) > BLEED.wound * s / 2 + 1e-9 || Math.abs(o.y - (m.y + PHYS.height / 2 * s)) > BLEED.wound * s / 2 + 1e-9) start = false;
          count++;
        }
      }
    }
  }
  ok(count > 0 && perp, '血的方向跟劍氣拉長的方向垂直（沒有沿著掃的方向的份）');
  ok(plane, '血的方向躺在劍氣的面上');
  ok(aimed, '噴的是劍氣經過怪物的那一截：水平上從玩家指著牠，不是出手那一刻刀掃到哪');
  ok(start, '起點在怪物身上：腰的高度（體型大的高），沿著傷口散開');
  const up = hitFrame('rise', p, tip, { x: 0.72, y: 0.6, z: 0.96 }, 1);
  ok(up.d[1] > 0.1, '第二段斜著往上噴（那片扇形是立起來的）');
  // 扇形外面一點點（判定有算身體半徑）：夾回掃得到的角度，還是在那個面上。
  const edge = hitFrame('slash', p, null, { x: -0.8, y: 0, z: -0.2 }, 1);
  const b0 = bladeAt('slash', TRAILS.slash.from, p, null), b1 = bladeAt('slash', TRAILS.slash.to, p, null);
  ok(near(dot(edge.d, b0.d), 1) || near(dot(edge.d, b1.d), 1), '在掃得到的角度外面：夾到最近的那一邊');
  const push = pushFrame(3, -4);
  ok(near(push.d[0], 0.6) && near(push.d[2], -0.8) && push.d[1] === 0 && near(dot(push.d, push.t), 0), '破防攻擊：往推開的方向水平噴');

  // 蓄力中扣 0 點：不噴。
  const armoredBoss = makeMonster({ kind: 'boss', x: 0, z: 0, yaw: 0 });
  armoredBoss.cast = { skill: 'orb', t: 0 };
  ok(taken(armoredBoss, DAMAGE.slash) === 0 && taken(armoredBoss, DAMAGE.rise) === 1 && taken(makeMonster({ kind: 'boss', x: 0, z: 0, yaw: 0 }), DAMAGE.slash) === 1,
    '實際扣幾點（taken）：蓄力中第一段扣 0——不噴');

  // 落地：點的地板；落到盒頂變一灘；撞進盒子側面就沒了。
  const field = { arena: { shape: 'circle', x: 0, z: 0, r: 20 }, cols: [{ kind: 'block', min: [2, 0, -1], max: [3, 0.5, 1], base: 0 }] };
  ok(floorUnder(field.cols, 2.5, 0, 1) === 0.5 && floorUnder(field.cols, 1.99, 0, 1) === 0 && Number.isNaN(floorUnder(field.cols, 2.5, 0, 0.2)),
    '一個點的地板：盒頂上是盒頂、差一公分出去是地面、在盒子裡面是撞牆');
  const drops = [
    { x: 0, y: 0.5, z: 0, vx: 1, vy: 0, vz: 0, r: 0.05, field },
    { x: 2.5, y: 1.0, z: 0, vx: 0, vy: 0, vz: 0, r: 0.05, field },
    { x: 1.5, y: 0.3, z: 0, vx: 8, vy: 0, vz: 0, r: 0.05, field },
  ];
  const splats = [];
  for (let t = 0; t < 1; t += DT) bleedStep(drops, splats, DT);
  ok(drops.length === 0 && splats.length === 2, `兩滴落地變一灘、一滴撞進盒子側面沒了（${splats.length} 灘）`);
  const floorSp = splats.find((q) => q.y === 0), boxSp = splats.find((q) => q.y === 0.5);
  ok(!!floorSp && !!boxSp && near(floorSp.r, 0.05 * SPLAT.area) && floorSp.long > 1 && near(boxSp.long, 1) && near(floorSp.ax, 1),
    '一灘照那一滴放大、順著落地的水平速度拉長（直直落下的是圓的）');
  let rises = true, falls = true;
  for (let t = 0; t < SPLAT.grow; t += 0.005) if (splatScale(t + 0.005) < splatScale(t)) rises = false;
  for (let t = SPLAT.grow + SPLAT.hold; t < SPLAT.life; t += 0.01) if (splatScale(t + 0.01) > splatScale(t) + 1e-12) falls = false;
  ok(splatScale(0) === 0 && rises && splatScale(SPLAT.grow + SPLAT.hold / 2) === 1 && falls && splatScale(SPLAT.life) === 0,
    `一灘 ${SPLAT.grow} 秒攤開、留 ${SPLAT.hold} 秒、${SPLAT.shrink} 秒縮掉`);
  for (let t = 0; t < SPLAT.life + 0.1; t += DT) bleedStep(drops, splats, DT);
  ok(splats.length === 0, '縮掉之後收起來');

  // 幽靈的靈質：初速快、減速快、沒有重力、不留一灘，停在半空中留得比血久，最後縮掉。
  ok(bloodOf('ghost') === 'ecto' && bloodOf('minion') === 'blood' && bloodOf('boss') === 'blood', '幽靈噴的是靈質，殭屍與 BOSS 是血');
  ok(near(speedOf(0.04, 1, 'ecto'), speedOf(0.04, 1) * STYLE.ecto.speed) && STYLE.ecto.speed > 1, `靈質的初速是血的 ${STYLE.ecto.speed} 倍`);
  const open = { arena: { shape: 'circle', x: 0, z: 0, r: 50 }, cols: [] };
  const ecto = spurtOf(pushFrame(1, 0), { x: 0, y: 0, z: 0 }, 1, 'ecto', rng).map((o) => ({ ...o, field: open, y0: o.y, v0: Math.hypot(o.vx, o.vy, o.vz) }));
  const eSplats = [];
  const e = ecto.slice();
  let level = true, slowed = true, lasted = false, shrank = true;
  for (let t = 0; t < STYLE.ecto.life + 0.2; t += DT) {
    bleedStep(e, eSplats, DT);
    for (const o of e) {
      if (o.y !== o.y0) level = false;
      if (near(t + DT, 0.5, DT / 2) && Math.hypot(o.vx, o.vy, o.vz) > o.v0 * Math.exp(-STYLE.ecto.drag * 0.5) * 1.001) slowed = false;
    }
    if (t > STYLE.blood.life + 0.1 && e.length === ecto.length) lasted = true;
    if (t > STYLE.ecto.life - 0.05 && e.some((o) => dropSize(o) > o.r * 0.05)) shrank = false;
  }
  ok(level, '沒有重力：水平噴出去的靈質一直在同一個高度');
  ok(slowed, `減速快：0.5 秒後剩不到 e^(−${STYLE.ecto.drag}·0.5) 的速度`);
  ok(lasted && e.length === 0 && shrank, `停在半空中留得比血久（血最多 ${STYLE.blood.life} 秒，靈質 ${STYLE.ecto.life} 秒），最後縮掉`);
  ok(eSplats.length === 0, '靈質不留一灘');
  const down = [{ x: 0, y: 0.3, z: 0, vx: 0, vy: -6, vz: 0, r: 0.05, style: 'ecto', field: open }], dSp = [];
  for (let t = 0; t < 0.5; t += DT) bleedStep(down, dSp, DT);
  ok(down.length === 1 && down[0].y === 0 && dSp.length === 0, '往下噴的靈質碰到地板就貼著停住，不穿過去、不留一灘');
  const reachE = spurtOf(pushFrame(0, 1), { x: 0, y: 0, z: 0 }, 1, 'ecto', rng).map((o) => {
    const one = [{ ...o, x: 0, z: 0, field: open }];
    for (let t = 0; t < STYLE.ecto.life - STYLE.ecto.fade; t += DT) bleedStep(one, [], DT);
    return { r: o.r, far: one[0].z };
  }).sort((a, b) => a.r - b.r);
  ok(reachE.every((q, i) => i === 0 || q.far < reachE[i - 1].far), '靈質也是小的噴得比大的遠（停下來的地方 v₀ / drag）');
}

/* ── 24. 騎士 ────────────────────────────────────────────────── */
console.log('24. 騎士');
{
  const S = SKILL.whirl;
  ok(KINDS.knight.skills.includes('whirl') && KINDS.knight.every === 2.5, '騎士每 2.5 秒放一招，會劍迴旋衝刺');
  ok(S.windup === 0.5 && S.damage === 2 && near(WHIRL_LEN, (S.speed * S.time) / 2) && near(WHIRL_LEN, 3.2) && near(S.time, TRAILS.whirl.t1),
    `劍迴旋衝刺：倒數 0.5 秒、扣 2、衝 ${WHIRL_LEN.toFixed(2)} 公尺、0.4 秒衝完（劍光同樣 0.4 秒掃完）`);
  const W = TRAILS.whirl, L = TRAILS.slam;
  ok(near(W.to - W.from, L.to - L.from + 2 * Math.PI) && W.from === L.from && W.ease === L.ease && !W.taper,
    '劍光比主角第三擊那一圈多轉一圈（兩圈多），起點與加減速一樣');
  const turn = (mv) => Math.max(...mv.keys.map(([, p]) => p.yaw || 0));
  ok(near(turn(KNIGHT_MOVES.whirlDash), turn(HERO_MOVES.slam) + 2 * Math.PI) && near(KNIGHT_MOVES.whirlWind.keys.at(-1)[0], S.windup),
    `動作：蓄力拉長到 ${S.windup} 秒；衝的時候比主角第三擊多轉一圈（最多轉到 ${(turn(KNIGHT_MOVES.whirlDash) / (2 * Math.PI)).toFixed(2)} 圈）`);
  /** 只讓騎士會這幾招（量一招的時候不讓亂數挑到別招），回傳換回去的那一支。 */
  const only = (ks) => { const k = KINDS.knight.skills; KINDS.knight.skills = ks; return () => { KINDS.knight.skills = k; }; };
  const back = only(['whirl']);

  // 夠不到就不放：時間到了、人在 range 外，站著等 1 秒都不放；人走進 range，那一幀就放。
  {
    const m = makeMonster({ kind: 'knight', x: 0, z: 0, yaw: 0 });
    const w = makeWorld();
    m.castT = 0;
    const far = body(0, S.range + 0.5);
    for (let i = 0; i < 60; i++) bossStep(m, DT, far, w, () => 0);
    const none = !m.cast;
    bossStep(m, DT, body(0, S.range - 0.1), w, () => 0);
    ok(none && m.cast && m.cast.skill === 'whirl', `離 ${S.range + 0.5} 公尺不放、走進 ${S.range} 公尺以內那一幀就放`);
  }

  /** 騎士在原點、人在 (px, pz)，放一次劍迴旋衝刺，記下每一件事。move：倒數中人往哪跑（公尺每秒）。 */
  const whirl = (px, pz, dt = DT, move = null) => {
    const m = makeMonster({ kind: 'knight', x: 0, z: 0, yaw: 0 });
    const w = makeWorld();
    const q = body(px, pz);
    m.castT = 0;
    const out = { m, strikes: [], windStill: true, windHit: false, armor: true, stages: new Set() };
    const mo = new Motion();
    let t = 0;
    while (t < 2) {
      const had = !!m.cast;
      const st = bossStep(m, dt, q, w, () => 0);
      if (st) out.strikes.push(st);
      if (had && !m.cast) { out.endAt = t + dt; out.stun = m.stun; }
      const wind = m.cast && m.cast.t < S.windup;
      if (wind && (m.x !== 0 || m.z !== 0)) out.windStill = false;
      if (wind && st) out.windHit = true;
      if (m.cast && !(attacking(m) && armored(m))) out.armor = false;
      if (m.cast) out.stages.add(mo._stage(m)[0]);
      if (move && wind) { q.x += move[0] * dt; q.z += move[1] * dt; }
      monsterStep(m, dt, q);
      t += dt;
      if (out.endAt) break;
    }
    return out;
  };

  const a = whirl(0, 3);
  ok(a.windStill && !a.windHit, '倒數的 0.5 秒站著不動、不打');
  ok(a.armor, '放招中是攻擊中、打不退（armored）');
  ok(near(a.m.z, WHIRL_LEN, 1e-6) && near(a.m.x, 0, 1e-9), `朝鎖定的方向衝了 ${a.m.z.toFixed(4)} 公尺`);
  ok(near(a.endAt, S.windup + S.time, 1.5 * DT) && a.stun === SKILL.recover && !a.m.cast, `${a.endAt.toFixed(2)} 秒衝完，僵直 ${SKILL.recover} 秒`);
  ok(a.strikes.length > 0 && a.strikes.every((st) => st.shape === 'capsule' && st.r === S.radius && st.dmg === S.damage),
    `衝的每一幀打一段（${a.strikes.length} 段），半徑 ${S.radius.toFixed(2)}、扣 ${S.damage}`);
  const chain = a.strikes.every((st, i) => (i === 0 ? near(st.z, 0) : near(st.z, a.strikes[i - 1].z1, 1e-9)));
  ok(chain && near(a.strikes[a.strikes.length - 1].z1, WHIRL_LEN, 1e-6), '一段接一段，從起步的地方接到衝完的地方');
  ok([...a.stages].join() === 'whirlWind,whirlDash', `動作：${[...a.stages].join(' → ')}`);

  for (const dt of [DT / 4, 0.037]) {
    const b = whirl(0, 3, dt);
    ok(near(b.m.z, WHIRL_LEN, 1e-6), `幀長 ${dt.toFixed(4)}：一樣衝 ${b.m.z.toFixed(4)} 公尺`);
  }

  // 鎖定：倒數裡人往旁邊跑，牠還是朝一開始的方向衝。
  const c = whirl(0, 3, DT, [6, 0]);
  ok(near(c.m.x, 0, 1e-9) && near(c.m.z, WHIRL_LEN, 1e-6), '倒數裡人往旁邊跑，牠照鎖定的方向衝');

  // 打不打得到：整段衝下來的每一段裡有沒有一段碰到。
  const R = S.radius + PHYS.radius;
  const hitBy = (strikes, p) => strikes.some((st) => strikeHits(st, p));
  ok(hitBy(a.strikes, body(0, 3)), '站在路上：被打到');
  ok(hitBy(a.strikes, body(R - 0.02, 1.5)) && !hitBy(a.strikes, body(R + 0.02, 1.5)), `路邊：${R.toFixed(2)} 公尺以內打到、以外打不到`);
  ok(hitBy(a.strikes, body(0, -R + 0.02)) && !hitBy(a.strikes, body(0, -R - 0.02)), '背後：起步的地方往後一個半徑以外打不到');
  ok(!hitBy(a.strikes, { ...body(0, 1.5), y: PHYS.height }), '跳起來（腳高過一個狗高）：躲得過');

  // 預告那一條就是打得到的地方：膠囊（起步 → 衝完、半徑 radius）加上身體，裡外各取一片點。
  const gap = (x, z) => Math.hypot(x, z - Math.min(WHIRL_LEN, Math.max(0, z)));
  let agree = true;
  for (let x = -3; x <= 3; x += 0.25) {
    for (let z = -3; z <= 7; z += 0.25) {
      const d = gap(x, z);
      if (Math.abs(d - R) < 0.03) continue;
      if (hitBy(a.strikes, body(x, z)) !== d < R) agree = false;
    }
  }
  ok(agree, '預告那一條（起步到衝完、兩頭半圓）裡面的都打得到，外面的都打不到');
  back();
}

/* ── 25. 騎士的跳砍 ──────────────────────────────────────────── */
console.log('25. 騎士的跳砍');
{
  const S = SKILL.cleave;
  ok(KINDS.knight.skills.includes('cleave'), '騎士會跳砍');
  ok(S.windup === 0.25 && S.hops === 3 && S.damage === 3 && S.range === 8, '跳砍：每一跳倒數 0.25 秒、連跳三次、扣 3、離玩家 8 公尺以內才放');
  const keep = KINDS.knight.skills;
  KINDS.knight.skills = ['cleave'];

  /** 騎士在原點、人在 (px, pz)，放一次跳砍，記下每一件事。move：倒數中人往哪跑（公尺每秒）。 */
  const cleave = (px, pz, dt = DT, move = null) => {
    const m = makeMonster({ kind: 'knight', x: 0, z: 0, yaw: 0 });
    const w = makeWorld();
    const q = body(px, pz);
    m.castT = 0;
    const out = { m, q, strikes: [], strikeAt: [], strikeQ: [], windStill: true, top: 0, stages: new Set(), armor: true, casts: [] };
    const mo = new Motion();
    let t = 0;
    while (t < 5) {
      const had = !!m.cast;
      const st = bossStep(m, dt, q, w, () => 0);
      // 每一跳鎖定的那一份：開始那一幀，與落地重新鎖定（倒數歸 0）的那一幀。
      if (m.cast && (!had || m.cast.t === 0)) out.casts.push({ ...m.cast });
      if (st) { out.strikes.push(st); out.strikeAt.push(t + dt); out.strikeQ.push({ ...q }); }
      if (m.cast && m.cast.t < S.windup && (m.x !== m.cast.x0 || m.z !== m.cast.z0 || m.y !== m.cast.y0)) out.windStill = false;
      if (m.cast && !(attacking(m) && armored(m))) out.armor = false;
      out.top = Math.max(out.top, m.y);
      if (m.cast) out.stages.add(mo._stage(m)[0]);
      if (had && !m.cast) { out.endAt = t + dt; out.stun = m.stun; out.rec = mo._stage(m)[0]; }
      if (move && m.cast && m.cast.t < S.windup) { q.x += move[0] * dt; q.z += move[1] * dt; }
      monsterStep(m, dt, q);
      t += dt;
      if (out.endAt) break;
    }
    out.cast = out.casts[0];
    return out;
  };

  const a = cleave(0, 5);
  const land = 5 - S.len / 2;
  const hopT = S.windup + S.air;
  ok(near(a.cast.lx, 0) && near(a.cast.lz, land) && a.cast.ly === 0, `落點在鎖定那一點前面半條（z = ${land.toFixed(2)}），長條的正中間就是人`);
  ok(a.windStill, `每一跳倒數的 ${S.windup} 秒站著不動`);
  ok(a.armor, '放招中（三跳之間也是）是攻擊中、打不退（armored）');
  ok(near(a.top, S.hop, 0.02), `飛的時候跳到 ${a.top.toFixed(2)} 公尺高（弧線最高 ${S.hop}）`);
  ok(a.casts.length === S.hops && a.strikes.length === S.hops && a.strikes.every((st) => st.shape === 'strip' && st.dmg === S.damage),
    `連跳 ${S.hops} 次，每一跳落地劈一下（扣 ${S.damage}）`);
  ok(a.strikeAt.every((t, i) => near(t, (i + 1) * hopT, 1.5 * DT)), `劈在 ${a.strikeAt.map((t) => t.toFixed(2)).join('、')} 秒（每 ${hopT.toFixed(2)} 秒一跳）`);
  ok(near(a.endAt, S.hops * hopT, 1.5 * DT) && near(a.m.x, 0) && near(a.m.z, land) && a.m.y === 0 && a.m.grounded,
    `${a.endAt.toFixed(2)} 秒第三跳落地、站在地上（人沒動，後兩跳原地跳）`);
  ok(a.stun === SKILL.recover && a.rec === 'cleaveRec', `第三跳落地之後才僵直 ${SKILL.recover} 秒，播劈到底的收尾`);
  ok([...a.stages].join() === 'cleaveWind,cleaveAir', `動作：${[...a.stages].join(' → ')}（${S.hops} 次）→ ${a.rec}`);

  // 比半條還近：原地跳起來劈，長條從牠腳下起。
  const b = cleave(0, S.len / 4);
  ok(near(b.cast.lz, 0) && near(b.m.z, 0), '人比半條還近：原地跳起來劈');

  // 每一跳重新鎖定：人每一跳倒數的時候往旁邊跑，後一跳的落點跟著人現在的位置。
  {
    const d = cleave(0, 5, DT, [3, 0]);
    const aimed = d.casts.every((c) => near(Math.hypot(c.tx - c.x0, c.tz - c.z0) > 1e-6 ? Math.atan2(c.tx - c.x0, c.tz - c.z0) : 0, Math.atan2(c.dirX, c.dirZ)));
    ok(d.casts.length === S.hops && aimed && d.casts[1].tx > d.casts[0].tx + 0.5 && d.casts[2].tx > d.casts[1].tx + 0.5,
      `每一跳重新鎖定人現在的位置（鎖在 x = ${d.casts.map((c) => c.tx.toFixed(2)).join('、')}）`);
  }

  // 打不打得到：長條（落點往前 len、寬 width）加上身體。
  const st = a.strikes[0], r = PHYS.radius, half = S.width / 2;
  ok(strikeHits(st, body(0, 5)), '站在鎖定的那一點上：被劈到');
  ok(strikeHits(st, body(half + r - 0.02, 5)) && !strikeHits(st, body(half + r + 0.02, 5)), `橫向：離中線 ${(half + r).toFixed(2)} 公尺以內劈到、以外劈不到`);
  ok(strikeHits(st, body(0, land + S.len + r - 0.02)) && !strikeHits(st, body(0, land + S.len + r + 0.02)), '長條的遠端外面劈不到');
  ok(!strikeHits(st, { ...body(0, 5), y: PHYS.height }), '跳起來（腳高過一個狗高）：躲得過');
  let agree = true;
  for (let x = -2; x <= 2; x += 0.1) {
    for (let z = land - 1; z <= land + S.len + 1; z += 0.1) {
      const du = Math.max(0, land - z, z - land - S.len), dv = Math.max(0, Math.abs(x) - half), d = Math.hypot(du, dv);
      if (Math.abs(d - r) < 0.02) continue;
      if (strikeHits(st, body(x, z)) !== d < r) agree = false;
    }
  }
  ok(agree, '預告那一條（落點往前、寬 width）碰到身體的都劈得到，沒碰到的都劈不到');

  // 倒數裡往旁邊跑開就躲得掉：預告鎖在倒數開始的那一刻。
  const c = cleave(0, 5, DT, [3, 0]);
  ok(near(c.cast.lx, 0) && !strikeHits(c.strikes[0], c.strikeQ[0]), `倒數裡往旁邊跑 ${(3 * S.windup).toFixed(1)} 公尺以上：劈空`);

  // 太遠不放。
  {
    const m = makeMonster({ kind: 'knight', x: 0, z: 0, yaw: 0 });
    const w = makeWorld();
    m.castT = 0;
    for (let i = 0; i < 30; i++) bossStep(m, DT, body(0, S.range + 0.5), w, () => 0);
    ok(!m.cast, `離 ${S.range + 0.5} 公尺不放`);
  }

  // 落點在台上：落在那一塊的頂上，打的是那一層。
  {
    const top = 0.3;
    const cols = [...FIELD.cols, { kind: 'floor', min: [-2, 0, 3], max: [2, top, 7], base: 0 }];
    const m = makeMonster({ kind: 'knight', x: 0, z: 0, yaw: 0 }, { ...FIELD, cols });
    const w = makeWorld(m.field);
    const q = body(0, 5.5, top);
    m.castT = 0;
    let hit = null;
    for (let i = 0; i < 90 && !hit; i++) { hit = bossStep(m, DT, q, w, () => 0); if (!hit) monsterStep(m, DT, q); }
    ok(hit && near(hit.y, top) && near(m.y, top) && strikeHits(hit, q), `落點在 ${top} 公尺高的台上：落在台上、劈的是台上那一層`);
  }
  KINDS.knight.skills = keep;
}

/* ── 26. 頭盔 ────────────────────────────────────────────────── */
console.log('26. 頭盔');
{
  ok(helmOf('knight') && helmOf('boss') && !helmOf('minion') && !helmOf('ghost'), '騎士與 BOSS 戴頭盔，小怪與幽靈不戴');
  const buf = readFileSync('public/assets/cat.bin');
  const zoo = await loadZoo({ buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  const { SHELL, SHELL_FLOOR, NOTCH, VISOR, FACE_LIFT, INK_OUT } = HELM;
  const fOf = (p, h) => p.reduce((a, x, k) => a + Math.abs((x - SHELL.c[k]) / h[k]) ** SHELL.n, 0);
  const inShellPart = (p) => p[1] >= SHELL_FLOOR && !(p[2] > NOTCH.z && p[1] < NOTCH.y);
  for (const kind of ['knight', 'boss']) {
    const c = makeMonsterCritter(zoo, kind);
    const helm = new Helm();
    helm.follow(c);
    /* 每個頂點換到頭骨座標（靜置姿勢），照骨頭分。 */
    const rig = new Rig(c.data.header);
    rig.update();
    const M = rig.matrices, head = rig.bone('head');
    const inv = new THREE.Matrix4().fromArray(M, head * 16).invert();
    const bm = new THREE.Matrix4(), v = new THREE.Vector3(), by = {};
    for (let i = 0; i < c._boneId.length; i++) {
      const b = c._boneId[i];
      v.set(c._posBaked[i * 3], c._posBaked[i * 3 + 1], c._posBaked[i * 3 + 2]).applyMatrix4(bm.fromArray(M, b * 16)).applyMatrix4(inv);
      (by[rig.names[b]] ||= []).push([v.x, v.y, v.z]);
    }
    const face = [...by.head, ...by.eye0, ...by.eye1].filter(inShellPart);
    const lining = SHELL.h.map((x) => x - SHELL.t);
    ok(face.length > 1000 && face.every((p) => fOf(p, lining) < 1), `${kind}：頭皮與眼睛（開口與切口以外）全部包在盔殼內層裡`);
    const visor = helm.node.getObjectByName('visor').geometry.attributes.position.array;
    const vp = [];
    for (let i = 0; i < visor.length; i += 3) vp.push([visor[i], visor[i + 1], visor[i + 2]]);
    const hull = SHELL.h.map((x) => x + INK_OUT);
    ok(vp.every((p) => fOf(p, hull) > 1), `${kind}：面罩整片在盔殼的墨線外殼外面`);
    const muzzleTop = Math.max(...by.muzzle.map((p) => p[1]));
    ok(Math.min(...vp.map((p) => p[1])) > muzzleTop, `${kind}：面罩下緣（y ${VISOR.y[0]}）高過吻部（y ${muzzleTop.toFixed(2)}）`);
    const hw = VISOR.holeW / 2;
    const eyes = ['eye0', 'eye1'].map((n) => by[n]);
    ok(eyes.every((e) => {
      const x = Math.abs(e.reduce((a, p) => a + p[0], 0) / e.length);
      return VISOR.holes.some((h) => Math.abs(x - h) < hw);
    }), `${kind}：兩隻眼睛各對著一個洞`);
    /* 臉往鏡頭推 lift：正面看，眼睛（九成以上）要在頭皮前、整顆在面罩內面後。 */
    const lift = c._faceLift.value / c.mesh.scale.x;
    const eyeAll = eyes.flat();
    const ax = eyeAll.map((p) => Math.abs(p[0])), ay = eyeAll.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...ax), Math.max(...ax), Math.min(...ay), Math.max(...ay)];
    const skin = Math.max(...by.head.filter((p) => Math.abs(p[0]) >= x0 && Math.abs(p[0]) <= x1 && p[1] >= y0 && p[1] <= y1).map((p) => p[2]));
    const plate = Math.min(...vp.filter((p) => Math.abs(p[0]) <= x1 && p[1] >= VISOR.holeY[0] && p[1] <= VISOR.holeY[1]).map((p) => p[2]));
    const shown = eyeAll.filter((p) => p[2] + lift > skin).length / eyeAll.length;
    const front = Math.max(...eyeAll.map((p) => p[2]));
    ok(near(lift, FACE_LIFT) && shown > 0.9 && front + lift < plate,
      `${kind}：臉推 ${lift.toFixed(2)}：眼睛 ${(shown * 100).toFixed(0)}% 在頭皮（z ${skin.toFixed(2)}）前、前緣（z ${(front + lift).toFixed(2)}）在面罩內面（z ${plate.toFixed(2)}）後`);
    /* 跟著頭骨：擺一個頭歪、仰的姿勢（跳砍舉劍那一格）。 */
    for (let i = 0; i < 5; i++) c.update(DT, { speed: 0, grounded: true, vy: 0, viewYaw: 0, move: KNIGHT_MOVES.cleaveWind.keys[1][1] });
    helm.update();
    const want = new THREE.Matrix4().fromArray(c.rig.matrices, head * 16);
    ok(helm.node.matrix.equals(want) && helm.node.parent === c.mesh, `${kind}：頭盔跟著頭骨轉`);
    c.setInkColor(ATTACK_INK);
    const red = helm.ink.color.equals(ATTACK_INK);
    c.setInkColor(null);
    ok(red && !helm.ink.color.equals(ATTACK_INK), `${kind}：墨線跟著牠的墨色換（攻擊中轉紅、之後換回來）`);
  }
}

console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
