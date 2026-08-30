// 水球手勢驗證：用 stub canvas 驅動狀態機，確認手勢判定符合設計。
// 用法：node tools/verify-touch.mjs
//
// 釘住的幾條規則：
//   · 左右／往下拖，水球被牽引著走，永遠逃不出去 → 不會誤跳
//   · 只有「往上甩出體積」才是跳
//   · 一次長甩只算一跳（跳完解除武裝，中心追上手指才重新武裝）
//   · 手指離開螢幕不算跳
//   · 表面擾動連續無尖角，行進波往手指那一側收斂
import { WaterBall, waveAt } from '../public/src/touch.js';

// touch.js 的建構子會掛 window 的 blur 監聽，node 裡先擋掉
globalThis.addEventListener = () => {};

const handlers = {};
const canvas = {
  addEventListener: (t, f) => { handlers[t] = f; },
  setPointerCapture: () => {},
};

let jumps = [];
const ball = new WaterBall(canvas, { onJump: (h) => jumps.push(h), enabled: () => true });
ball.resize(390, 844); // iPhone 14 尺寸

const DT = 1 / 60;
const ev = (x, y) => ({ pointerId: 1, clientX: x, clientY: y, preventDefault() {} });
const down = (x, y) => handlers.pointerdown(ev(x, y));
const move = (x, y) => handlers.pointermove(ev(x, y));
const up = () => handlers.pointerup(ev(ball.fx, ball.fy));
const step = (n = 1) => { for (let i = 0; i < n; i++) ball.update(DT); };

const R = ball.R;
console.log(`水球半徑 R = ${R.toFixed(1)}px（畫面 390×844）\n`);

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
};

// ── 1. 長距離水平拖曳：不能誤觸跳躍，且要滿速 ──
console.log('1. 往右拖 300px（跑步）');
jumps = []; down(200, 600); step(12);
for (let i = 1; i <= 60; i++) { move(200 + i * 5, 600); step(); }
ok('沒有誤跳', jumps.length === 0, `jumps=${jumps.length}`);
ok('axis 滿速', Math.abs(ball.axis - 1) < 1e-6, `axis=${ball.axis.toFixed(3)}`);
ok('水球被拖著走', Math.abs(ball.cx - ball.fx) <= R * 0.72 + 0.01,
  `dx=${(ball.fx - ball.cx).toFixed(1)} lead=${(R * 0.72).toFixed(1)}`);
up(); step(30);

// ── 2. 往上甩出體積 → 跳一次 ──
console.log('\n2. 往上甩 90px（跳躍）');
jumps = []; down(200, 600); step(20);
for (let i = 1; i <= 9; i++) { move(200, 600 - i * 10); step(); }
ok('跳了一次', jumps.length === 1, `jumps=${jumps.length}`);
ok('hold 在 0.10~0.42s 之間', jumps[0] >= 0.1 && jumps[0] <= 0.42, `hold=${jumps[0]?.toFixed(3)}`);
ok('水滴噴出來了', ball.drops.length >= 7, `drops=${ball.drops.length}`);
ok('新球比較小（正在長回來）', ball.r < R * 0.75, `r=${ball.r.toFixed(1)}`);
ok('跳完先解除武裝', !ball.armed);

// ── 3. 水滴要飛到手指、縮到消失 ──
console.log('\n3. 水滴的一生');
const d0 = ball.drops[0];
const startDist = Math.hypot(d0.x - ball.fx, d0.y - ball.fy);
step(12);
const midDist = Math.hypot(d0.x - ball.fx, d0.y - ball.fy);
ok('往手指靠近', midDist < startDist, `${startDist.toFixed(0)}px → ${midDist.toFixed(0)}px`);
ok('半徑縮小了', d0.r < d0.r0, `${d0.r0.toFixed(1)} → ${d0.r.toFixed(1)}`);
step(60);
ok('全部消失', ball.drops.length === 0, `drops=${ball.drops.length}`);
ok('手指停住後中心追上、重新武裝', ball.armed
  && Math.abs(ball.cy - ball.fy) < ball.r * 0.15, `dy=${(ball.fy - ball.cy).toFixed(2)}`);

// ── 4. 一次甩動只算一跳（連射防護）──
console.log('\n4. 一口氣往上甩 400px');
up(); step(40);
jumps = []; down(200, 700); step(20);
for (let i = 1; i <= 40; i++) { move(200, 700 - i * 10); step(); }
ok('跳的次數合理（不是每幀一次）', jumps.length >= 1 && jumps.length <= 4, `jumps=${jumps.length}`);

// ── 4b. 往下拖：不管拖多遠都不能跳 ──
console.log('\n4b. 往下拖 400px');
up(); step(40);
jumps = []; down(200, 300); step(20);
for (let i = 1; i <= 40; i++) { move(200, 300 + i * 10); step(); }
ok('沒有下拉跳躍', jumps.length === 0, `jumps=${jumps.length}`);
ok('水球被拖著往下走', Math.abs(ball.fy - ball.cy) <= R * 0.72 + 0.01,
  `dy=${(ball.fy - ball.cy).toFixed(1)} lead=${(R * 0.72).toFixed(1)}`);
ok('張力沒有亂漲', ball.tension < 0.01, `tension=${ball.tension.toFixed(3)}`);

console.log('\n4c. 斜下（右下 45°）拖到底');
up(); step(40);
jumps = []; down(200, 300); step(20);
for (let i = 1; i <= 40; i++) { move(200 + i * 8, 300 + i * 8); step(); }
ok('斜下也不跳', jumps.length === 0, `jumps=${jumps.length}`);
ok('但左右還是滿速', Math.abs(ball.axis - 1) < 1e-6, `axis=${ball.axis.toFixed(3)}`);

console.log('\n4d. 水平拖到底再往上甩');
up(); step(40);
jumps = []; down(200, 500); step(20);
for (let i = 1; i <= 30; i++) { move(200 + i * 5, 500); step(); }
ok('純水平沒跳', jumps.length === 0);
for (let i = 1; i <= 9; i++) { move(ball.fx, 500 - i * 10); step(); }
ok('接著往上甩就跳了', jumps.length === 1, `jumps=${jumps.length}`);

// ── 5. 手指直接離開螢幕：不算跳 ──
console.log('\n5. 按住不動後放開');
up(); step(40);
jumps = []; down(200, 600); step(30); up(); step(30);
ok('沒有跳', jumps.length === 0, `jumps=${jumps.length}`);
ok('水球收掉了', ball.r === 0, `r=${ball.r}`);
ok('axis 歸零', ball.axis === 0);

// ── 6. 形狀函式：連續、有界 ──
console.log('\n6. 表面擾動 r(θ)');
up(); step(40);
down(200, 600); step(20); move(200 + R * 0.5, 600 - R * 0.5); step(4);
const fn = ball._shape();
let min = Infinity, max = -Infinity, maxJump = 0, prev = fn(0);
for (let i = 1; i <= 720; i++) {
  const v = fn((i / 720) * Math.PI * 2);
  min = Math.min(min, v); max = Math.max(max, v);
  maxJump = Math.max(maxJump, Math.abs(v - prev));
  prev = v;
}
ok('沒有 NaN', Number.isFinite(min) && Number.isFinite(max));
ok('半徑為正', min > 0, `min=${min.toFixed(1)} max=${max.toFixed(1)}`);
ok('θ=0 與 θ=2π 接得起來', Math.abs(fn(0) - fn(Math.PI * 2)) < 1e-9);
ok('沒有尖角（相鄰取樣落差小）', maxJump < ball.r * 0.05, `maxΔ=${maxJump.toFixed(2)}px`);

// ── 7. 擾動波確實朝手指側前進 ──
// 直接測波函式本身。r(θ) 裡面還疊了「朝手指的鼓起」，那一項比波大得多，
// 在合成曲線上找極值只會找到鼓起的頂點，量不到波在動。
console.log('\n7. 波峰是否往手指收斂（|Δ|=0 就是手指方向）');
// 圓周上同時有好幾個波峰，所以要在上一個位置附近局部搜尋，才是「跟著同一個波峰」
const crestNear = (t, d0, win = 0.3) => {
  let bestD = d0, bestV = -Infinity;
  for (let i = 0; i <= 600; i++) {
    const d = d0 - win + (i / 600) * win * 2;
    if (d < 0 || d > Math.PI) continue;
    const v = waveAt(d, t);
    if (v > bestV) { bestV = v; bestD = d; }
  }
  return bestD;
};
let mono = true, prevD = crestNear(0, 2.45, 1.0);
const path = [prevD];
for (let i = 1; i <= 8; i++) {
  const c = crestNear(i * 0.04, prevD);
  if (c >= prevD) mono = false;
  prevD = c; path.push(c);
}
ok('同一個波峰持續往 |Δ|=0 前進', mono, path.map((v) => v.toFixed(2)).join(' → '));
ok('波在整個圓周上有界', Math.abs(waveAt(0, 0.3)) <= 1 && Math.abs(waveAt(Math.PI, 0.3)) <= 1);

console.log(fails === 0 ? '\n全部通過 ✓' : `\n${fails} 項失敗 ✗`);
process.exit(fails === 0 ? 0 : 1);
