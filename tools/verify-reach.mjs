/* ── tools/verify-reach.mjs ──────────────────────────────────────────
   完整流程模式裡，怪物不會跑到走不到的地方：掉進窄巷的井、跑到牆外。

     1. 擊退落地  被打飛的怪物落地那一幀不會被搬走：離井再近也不會被吸進井裡，幀率掉到
                  20（一幀 0.05 秒）也不會被地板的碰撞板橫推到牆外。落點離起點的水平距離
                  就是那一下擊退本身帶走的距離。
     2. 允許區    每一場有會走路的怪物的房間（roam.js）：站位都在裡面、沒有一格在井底、
                  沒有一格出了黑牆、台子頂不比旁邊地面高過 MOUNT（主角打得到）。
     3. 被打飛    從允許區裡的每一個地方（含井圈頂）往每個方向打三段，20～60 幀：落點都在
                  允許區裡——不掉井、不落在死角或牆外、不停在主角上不去的高台。
     4. 跳過去    騎士的跳砍隔著井、隔著柱子，殭屍王的跳砸對著站在任何地方的主角：落點都在
                  允許區裡。

   跑法：node tools/verify-reach.mjs
   ------------------------------------------------------------------ */

import { buildRuins } from '../public/test/src/blocks.js';
import { PHYS, MOUNT, solveXZ, supportInfo, arenaGap } from '../public/test/src/walk.js';
import { makeMonster, monsterStep, knock, separate, KNOCK, KNOCK_SCALE, KINDS } from '../public/test/src/combat.js';
import { bossStep, makeWorld } from '../public/test/src/skills.js';
import { roamMap } from '../public/test/src/roam.js';
import { STAGES, foesOf } from '../public/test/src/route.js';

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok ' : ' FAIL'} ${msg}`);
  if (!cond) fails++;
};

const ruins = buildRuins();
const COLS = ruins.colliders;
const fieldOf = (room) => ({ arena: ruins.arenas.find((a) => a.id === room), cols: COLS, doors: {} });
const stageOf = (id) => STAGES.findIndex((s) => s.id === id);
const WELL = COLS.find((b) => b.kind === 'pit');

/** 把 m 從 (x, z) 往 (dirX, dirZ) 打一段 `phase`，用 dt 一幀一幀飛到落地。回傳落點。 */
function fly(m, x, z, dirX, dirZ, phase, dt) {
  m.x = x; m.z = z; m.y = 0; m.vx = m.vy = m.vz = 0; m.air = false; m.grounded = true; m.cast = null;
  knock(m, x - dirX, z - dirZ, dirX, dirZ, KNOCK_SCALE[phase]);
  for (let i = 0; i < 400 && m.air; i++) monsterStep(m, dt, null);
  return { x: m.x, y: m.y, z: m.z };
}

/** 一段擊退水平最多帶走多遠：初速 × 飛行時間（落回同一層），加一幀的誤差。 */
const travel = (phase, dt) => {
  const s = KNOCK_SCALE[phase];
  return KNOCK.h * s.h * (2 * KNOCK.v * s.v / PHYS.gravity) + KNOCK.h * s.h * dt + 1e-6;
};

console.log('1. 擊退落地');
{
  const k = stageOf('alley');
  const knight = makeMonster(foesOf(k)[0], fieldOf('alley'));
  let sucked = 0, worst = 0, n = 0;
  for (const dt of [1 / 60, 1 / 30, 0.05]) {
    for (const phase of ['slash', 'rise', 'slam']) {
      // 井圈外緣 1.48，身體半徑 0.3：從貼著井圈到井的吸力範圍（r + 3）外面
      for (let r = 1.8; r <= 4.2; r += 0.2) {
        for (let a = 0; a < 16; a++) {
          const th = (a / 16) * Math.PI * 2, ux = Math.cos(th), uz = Math.sin(th);
          // 往外打、往旁邊打（往井裡打是 3、4 段的事）
          for (const [dx, dz] of [[ux, uz], [-uz, ux], [uz, -ux]]) {
            const x = WELL.x + ux * r, z = WELL.z + uz * r;
            const p = fly(knight, x, z, dx, dz, phase, dt);
            n++;
            if (p.y < -1) sucked++;
            worst = Math.max(worst, Math.hypot(p.x - x, p.z - z) - travel(phase, dt));
          }
        }
      }
    }
  }
  ok(sucked === 0, `窄巷井邊 ${n} 次擊退（20～60 幀、三段、往外與往旁邊）：沒有一次被吸進井裡（${sucked} 次）`);
  ok(worst <= 0, `落點離起點不比擊退本身帶走的遠（最多多出 ${Math.max(0, worst).toFixed(3)} 公尺）`);
}
{
  let moved = 0, n = 0;
  for (const id of ['courtyard', 'throne']) {
    const k = stageOf(id), field = fieldOf(STAGES[k].room);
    const m = makeMonster(foesOf(k)[0], field);
    const { x0, x1, z0, z1 } = field.arena;
    for (let i = 1; i < 8; i++) {
      for (let j = 1; j < 8; j++) {
        const x = x0 + ((x1 - x0) * i) / 8, z = z0 + ((z1 - z0) * j) / 8;
        // 只從站得住的地方打：地面那一層、身體沒有嵌在任何東西裡
        const [sx, sz] = solveXZ(COLS, x, z, 0, {});
        if (Math.hypot(sx - x, sz - z) > 1e-6 || supportInfo(COLS, x, z, 0).y !== 0) continue;
        const p = fly(m, x, z, 1, 0, 'rise', 0.05);
        n++;
        if (p.y < 0.5 && Math.hypot(p.x - x, p.z - z) > travel('rise', 0.05) + 0.7) moved++;
      }
    }
  }
  ok(moved === 0, `中庭與王座廳 ${n} 個點、20 幀被挑起：落地沒有被地板推走（${moved} 次）`);
}

/* 完整流程模式的那一份（mode-flow.js 的 ROAMS）：從這一場的入口往外淹、門全關。 */
const ROAMS = new Map();
console.log('\n2. 允許區');
for (let k = 0; k < STAGES.length; k++) {
  const st = STAGES[k], foes = foesOf(k);
  if (foes.every((f) => KINDS[f.kind].fly)) continue;
  const room = st.room.split(':')[0], arena = fieldOf(room).arena;
  const at = st.entry ? ruins.arrivals[st.entry.to] : foes[0];
  const t0 = performance.now();
  const roam = roamMap(COLS, arena, { x: at.x, y: at.y || 0, z: at.z }, {});
  const ms = performance.now() - t0;
  ROAMS.set(room, roam);
  const tops = roam.cells.filter((c) => c.top);
  const ground = (c) => Math.min(...roam.cells.filter((g) => !g.top && Math.hypot(g.x - c.x, g.z - c.z) < 0.8).map((g) => g.y));
  ok(foes.every((f) => roam.has(f.x, f.y || 0, f.z))
    && roam.cells.every((c) => c.y > -1 && arenaGap(arena, c.x, c.z) > PHYS.radius)
    && tops.every((c) => c.y - ground(c) <= MOUNT + 1e-6),
    `${st.name}：${roam.cells.length} 格（台子頂 ${tops.length}），站位在裡面、沒有井底、沒出黑牆、台子不高過 MOUNT（${ms.toFixed(0)} 毫秒）`);
}
const fieldIn = (room) => ({ ...fieldOf(room), roam: ROAMS.get(room) });

console.log('\n3. 被打飛');
for (const id of ['barracks', 'courtyard', 'alley', 'throne']) {
  const k = stageOf(id), room = STAGES[k].room.split(':')[0], roam = ROAMS.get(room);
  const m = makeMonster(foesOf(k)[0], fieldIn(room));
  /* 窄巷井邊 4.5 公尺內的每一格都打，其餘抽樣。 */
  const from = roam.cells.filter((c, i) => (id === 'alley' && Math.hypot(c.x - WELL.x, c.z - WELL.z) < 4.5) || i % 23 === 0);
  let out = 0, n = 0, slow = 0, worst = '';
  for (const c of from) {
    for (let a = 0; a < 8; a++) {
      const th = (a / 8) * Math.PI * 2;
      for (const phase of ['slash', 'rise', 'slam']) {
        for (const dt of [1 / 60, 0.05]) {
          m.x = c.x; m.y = c.y; m.z = c.z; m.vx = m.vy = m.vz = 0; m.air = false; m.grounded = true; m.cast = null;
          const t0 = performance.now();
          knock(m, c.x - Math.cos(th), c.z - Math.sin(th), Math.cos(th), Math.sin(th), KNOCK_SCALE[phase]);
          slow = Math.max(slow, performance.now() - t0);
          for (let i = 0; i < 400 && m.air; i++) monsterStep(m, dt, null);
          n++;
          if (!roam.has(m.x, m.y, m.z)) { out++; worst = `(${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}) ${phase} → (${m.x.toFixed(2)}, ${m.y.toFixed(2)}, ${m.z.toFixed(2)})`; }
        }
      }
    }
  }
  ok(out === 0, `${STAGES[k].name}：${n} 次擊退都落在允許區裡（${out} 次沒有${worst ? `，例如 ${worst}` : ''}）；最慢一次 ${slow.toFixed(2)} 毫秒`);
}

console.log('\n4. 跳過去');
/* 主角站得住的地方（不只是允許區：比 MOUNT 高的台子、井圈也算），每 0.7 公尺一點。 */
function stands(arena) {
  const out = [];
  const { x0, x1, z0, z1 } = arena.shape === 'circle'
    ? { x0: arena.x - arena.r, x1: arena.x + arena.r, z0: arena.z - arena.r, z1: arena.z + arena.r } : arena;
  for (let x = x0 + 0.5; x < x1; x += 0.7) {
    for (let z = z0 + 0.5; z < z1; z += 0.7) {
      if (arenaGap(arena, x, z) < 0.6) continue;
      const y = supportInfo(COLS, x, z, 6).y;
      const [sx, sz] = solveXZ(COLS, x, z, y, {});
      if (y > -1 && Math.hypot(sx - x, sz - z) < 1e-6) out.push({ x, y, z });
    }
  }
  return out;
}
for (const [id, skill] of [['alley', 'cleave'], ['courtyard', 'leap']]) {
  const k = stageOf(id), room = STAGES[k].room.split(':')[0], roam = ROAMS.get(room), field = fieldIn(room);
  const spots = stands(field.arena);
  const m = makeMonster(foesOf(k)[0], field);
  const world = makeWorld(field);
  // 騎士在 3.2 公尺外只剩跳砍挑得到；殭屍王的跳砸 6.9 公尺以內，亂數給 0.4 挑到別招就換下一點
  const range = skill === 'cleave' ? [3.3, 8] : [0, 6.9];
  let out = 0, n = 0, worst = '';
  for (let i = 0; i < roam.cells.length; i += 7) {
    const c = roam.cells[i];
    for (let j = (i * 13) % 17; j < spots.length; j += 17) {
      const p = spots[j], d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < range[0] || d > range[1]) continue;
      Object.assign(m, { x: c.x, y: c.y, z: c.z, cast: null, castT: 0, stun: 0, lunge: null, air: false, held: false, slide: false });
      bossStep(m, 1e-4, p, world, () => (skill === 'leap' ? 0.4 : 0));
      if (!m.cast || m.cast.skill !== skill) continue;
      const [x, y, z] = skill === 'cleave' ? [m.cast.lx, m.cast.ly, m.cast.lz] : [m.cast.tx, m.cast.ty, m.cast.tz];
      n++;
      if (!roam.has(x, y, z)) { out++; worst = `(${c.x.toFixed(1)}, ${c.z.toFixed(1)}) → 主角 (${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)})`; }
    }
  }
  ok(n > 50 && out === 0, `${STAGES[k].name}的${skill === 'cleave' ? '跳砍' : '跳砸'}：${n} 次落點都在允許區裡（${out} 次沒有${worst ? `，例如 ${worst}` : ''}）`);
}

console.log('\n5. 走下邊緣');
/* 每一個台子頂（含井圈）上放一隻，追八個方向五公尺外地上的主角三秒：追、衝刺都會走到邊上，
   踏空之後落的地方不在允許區裡（井裡、死角）就走不下去。 */
for (const id of ['barracks', 'courtyard', 'alley', 'throne']) {
  const k = stageOf(id), room = STAGES[k].room.split(':')[0], roam = ROAMS.get(room);
  const m = makeMonster(foesOf(k)[0], fieldIn(room));
  let out = 0, n = 0, worst = '';
  for (const c of roam.cells.filter((q) => q.top)) {
    for (let a = 0; a < 8; a++) {
      const th = (a / 8) * Math.PI * 2;
      const target = { x: c.x + Math.cos(th) * 5, y: 0, z: c.z + Math.sin(th) * 5 };
      for (const dt of [1 / 60, 0.05]) {
        Object.assign(m, { x: c.x, y: c.y, z: c.z, vx: 0, vy: 0, vz: 0, air: false, airT: 0, grounded: true, cast: null, lunge: null, stun: 0, slide: false });
        let bad = false;
        for (let t = 0; t < 3 && !bad; t += dt) {
          monsterStep(m, dt, target);
          if (m.y < roam.low - 0.5 || (!m.air && !roam.has(m.x, m.y, m.z))) bad = true;
        }
        n++;
        if (bad) { out++; worst = `(${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}) → (${m.x.toFixed(2)}, ${m.y.toFixed(2)}, ${m.z.toFixed(2)})`; }
      }
    }
  }
  ok(out === 0, `${STAGES[k].name}：從台子頂追 ${n} 次都留在允許區裡（${out} 次沒有${worst ? `，例如 ${worst}` : ''}）`);
}
{
  /* 兵營三隻擠在一起：放在允許區裡三個挨著、一樣高的格子上（身體重疊），互相讓開（separate）、
     追人兩秒，每一隻都留在允許區裡——讓開不會把誰擠進牆裡、擠下台子。 */
  const k = stageOf('barracks'), room = STAGES[k].room.split(':')[0], roam = ROAMS.get(room);
  const ms = foesOf(k).map((f) => makeMonster(f, fieldIn(room)));
  let out = 0, n = 0;
  for (let i = 0; i < roam.cells.length; i += 5) {
    const c = roam.cells[i];
    const trio = [c, ...roam.cells.filter((q) => q !== c && Math.abs(q.y - c.y) < 0.01 && Math.hypot(q.x - c.x, q.z - c.z) < 0.6)].slice(0, 3);
    if (trio.length < 3) continue;
    ms.forEach((m, j) => Object.assign(m, { x: trio[j].x, y: trio[j].y, z: trio[j].z, vx: 0, vy: 0, vz: 0, air: false, airT: 0, grounded: true, cast: null, lunge: null, stun: 0, slide: false }));
    const target = { x: c.x + 3, y: 0, z: c.z };
    let bad = false;
    for (let t = 0; t < 2 && !bad; t += 1 / 30) {
      for (const m of ms) monsterStep(m, 1 / 30, target);
      separate(ms);
      bad = ms.some((m) => m.y < roam.low - 0.5 || (!m.air && !roam.has(m.x, m.y, m.z)));
    }
    n++;
    if (bad) out++;
  }
  ok(out === 0, `兵營三隻擠在一起讓開 ${n} 次都留在允許區裡（${out} 次沒有）`);
}

console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
