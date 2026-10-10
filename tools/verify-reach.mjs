/* ── tools/verify-reach.mjs ──────────────────────────────────────────
   完整流程模式裡，怪物不會跑到走不到的地方：掉進窄巷的井、跑到牆外。

     1. 擊退落地  被打飛的怪物落地那一幀不會被搬走：離井再近也不會被吸進井裡，幀率掉到
                  20（一幀 0.05 秒）也不會被地板的碰撞板橫推到牆外。落點離起點的水平距離
                  就是那一下擊退本身帶走的距離。

   跑法：node tools/verify-reach.mjs
   ------------------------------------------------------------------ */

import { buildRuins } from '../public/test/src/blocks.js';
import { PHYS, solveXZ, supportInfo } from '../public/test/src/walk.js';
import { makeMonster, monsterStep, knock, KNOCK, KNOCK_SCALE } from '../public/test/src/combat.js';
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

console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
