// 二段跳的契約：只重設方向（對齊 facing），速率原封不動。
// 也就是說——起跳當幀不會有憑空加速，只可能換邊。
// 地面跳與蹬牆跳不受影響。
// 用法：node tools/verify-jump.mjs
import { Player } from '../public/src/player.js';
import { PHYS } from '../public/src/constants.js';

const STEP = 1 / 120;
const F = PHYS.runSpeed;
const noop = () => {};
const stub = { ensure: noop, forEachPlatform: noop, forEachSpike: noop, forEachCoin: noop, coins: [] };

// 從最高點起跳，回報起跳當幀的速度與整段滯空位移
function fly({ vx0, dir, facing0 = 1, kind = 'air' }) {
  const p = new Player(stub);
  p.grounded = kind === 'ground';
  p.airJumps = kind === 'air' ? 1 : 0;
  p.vx = vx0;
  p.vy = 0;
  p.facing = facing0;
  const y0 = p.y;
  const input = { axis: dir, jumpHeld: true };
  p.queueJump();

  const s = [];
  let t = 0;
  for (let i = 0; i < 400; i++) {
    p.update(STEP, input);
    t += STEP;
    s.push({ t, dx: p.x - 80, vx: p.vx });
    if (p.vy > 0 && p.y >= y0) break;
  }
  return {
    air: t, end: p.x - 80, vx0: s[0].vx,
    jolt: Math.abs(Math.abs(s[0].vx) - Math.abs(vx0)),   // 憑空多出來的速率
    maxRight: Math.max(0, ...s.map((x) => x.dx)),
  };
}

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
};

// 水平加速區塊排在跳躍區塊之前，所以起跳鏡射到的是「已吃過這一幀輸入」的速度。
// 那一幀的推進本來就該生效，所以容許值就是一幀的輸入加速度，多一分都不行。
const FRAME = PHYS.accelAir * STEP;   // 19.17 px/s
console.log('核心契約：起跳只換邊、不變速。');
console.log(`速率變化的容許上限 = 一幀的輸入加速度 ${FRAME.toFixed(1)} px/s，超過就是憑空加速。\n`);

const CASES = [
  { n: '滿速續跳', vx0: F, dir: 0, facing0: 1, sign: 1 },
  { n: '滿速反跳', vx0: F, dir: -1, facing0: 1, sign: -1 },
  { n: '半速續跳', vx0: F * 0.5, dir: 1, facing0: 1, sign: 1 },
  { n: '半速反跳', vx0: F * 0.5, dir: -1, facing0: 1, sign: -1 },
  { n: '反轉途中跳（vx=−100，推右）', vx0: -100, dir: 1, facing0: -1, sign: 1 },
  { n: '幾乎靜止時跳', vx0: 20, dir: 0, facing0: 1, sign: 1 },
  { n: '鬆手重新點按（axis=0）', vx0: F, dir: 0, facing0: 1, sign: 1 },
  { n: '往左跑時重新點按', vx0: -F, dir: 0, facing0: -1, sign: -1 },
];

let worst = 0;
for (const c of CASES) {
  const r = fly(c);
  worst = Math.max(worst, r.jolt);
  const dirOk = r.vx0 === 0 || Math.sign(r.vx0) === c.sign;
  ok(c.n, r.jolt <= FRAME + 0.5 && dirOk,
    `起跳 vx=${r.vx0.toFixed(0)} · 速率變化 ${r.jolt.toFixed(1)} · 位移 ${r.end.toFixed(0)}px`);
}
ok('沒有任何情境憑空加速', worst <= FRAME + 0.5,
  `最大 ${worst.toFixed(1)} px/s ≤ 一幀的 ${FRAME.toFixed(1)}`);

// 沒有輸入時連那一幀的加速都沒有，應該是分毫不差的鏡射
const pure = CASES.filter((c) => c.dir === 0).map((c) => fly(c).jolt);
ok('沒推方向時速率完全不變', Math.max(...pure) < 0.001, `最大 ${Math.max(...pure).toFixed(3)} px/s`);

console.log('\n反跳要即時，不能先往回漂：');
const rev = fly({ vx0: F, dir: -1, facing0: 1 });
ok('完全不往右漂', rev.maxRight < 1, `峰值 ${rev.maxRight.toFixed(1)}px`);

console.log('\n正跳與反跳對稱：');
const fwd = fly({ vx0: F, dir: 1, facing0: 1 });
ok('左右一樣遠', Math.abs(-rev.end - fwd.end) < 1,
  `左 ${(-rev.end).toFixed(0)}px vs 右 ${fwd.end.toFixed(0)}px`);

console.log('\n地面跳（不該被動到）：');
const gnd = fly({ vx0: F, dir: 1, kind: 'ground' });
ok('滿速起跳保留跑速', Math.abs(gnd.vx0 - F) < 1, `vx=${gnd.vx0.toFixed(0)}`);
const gndBack = fly({ vx0: F, dir: -1, facing0: 1, kind: 'ground' });
ok('地面反跳不會被瞬間翻向', gndBack.vx0 > 0, `vx=${gndBack.vx0.toFixed(0)}（仍在往右，靠加速度轉向）`);

console.log(fails === 0 ? '\n全部通過 ✓' : `\n${fails} 項失敗 ✗`);
process.exit(fails === 0 ? 0 : 1);
