// 螢幕手把驗證：用 stub canvas 驅動狀態機，確認版面與手感符合設計。
// 用法：node tools/verify-pad.mjs
//
// 釘住的幾條規則：
//   · 開手把時中央是一整片乾淨區，兩個觸控區都碰不到畫面正中心
//   · 搖桿固定不浮動：軸值算的是「手指相對搖桿中心」，不是相對按下那一點
//   · 推到底滿速、盲區內完全不動
//   · 跳躍鍵按下排跳、放開回報 —— 可變跳躍高度靠的就是這一對
//   · 左右對調之後觸控區歸屬立刻互換（不等動畫跑完）
//   · 相機取景分數落在乾淨區的中心，不是整個畫面的中心
//   · 關掉手把、或人死了，就完全不吃指標事件
import { Pad } from '../public/src/pad.js';
import { Input } from '../public/src/input.js';

// 建構子會掛 window 的 blur 監聽，node 裡先擋掉
globalThis.addEventListener = () => {};

const handlers = {};
const canvas = {
  addEventListener: (t, f) => { handlers[t] = f; },
  setPointerCapture: () => {},
};

let jumpLog = [];
let alive = true;
const pad = new Pad(canvas, {
  onJump: () => jumpLog.push('down'),
  onJumpEnd: () => jumpLog.push('up'),
  enabled: () => alive,
});

const NO_SAFE = { t: 0, r: 0, b: 0, l: 0 };
const DT = 1 / 60;
const ev = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y, preventDefault() {} });
const down = (id, x, y) => handlers.pointerdown(ev(id, x, y));
const move = (id, x, y) => handlers.pointermove(ev(id, x, y));
const up = (id, x, y) => handlers.pointerup(ev(id, x, y));
const step = (n = 1) => { for (let i = 0; i < n; i++) pad.update(DT); };
const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
};

// ── 1. 橫向版面 ───────────────────────────────────────
const LW = 844, LH = 390;              // iPhone 14 橫放
pad.setEnabled(true);
pad.layout(LW, LH, NO_SAFE);
console.log(`1. 橫向版面 ${LW}×${LH}`);
console.log(`   rail=${pad.rail.toFixed(1)}  搖桿 ${pad.joy.w.toFixed(0)}×${pad.joy.h.toFixed(0)}` +
  `  行程=±${((pad.joy.w - pad.joy.h) / 2).toFixed(1)}px  跳躍鍵 r=${pad.jmp.r.toFixed(1)}`);
ok('左右操作列不重疊', pad.zoneA.x + pad.zoneA.w < pad.zoneB.x,
  `A右緣=${(pad.zoneA.x + pad.zoneA.w).toFixed(0)} B左緣=${pad.zoneB.x.toFixed(0)}`);
ok('畫面正中心不屬於任何觸控區',
  !inRect(pad.zoneA, LW / 2, LH / 2) && !inRect(pad.zoneB, LW / 2, LH / 2));
ok('乾淨區至少佔六成寬', (1 - pad.inset.l - pad.inset.r) > 0.6,
  `乾淨=${((1 - pad.inset.l - pad.inset.r) * 100).toFixed(0)}%`);
ok('行程夠拇指推（≥28px）', (pad.joy.w - pad.joy.h) / 2 >= 28);
ok('兩個元件上下對齊', Math.abs(pad.slotA.y - pad.slotB.y) < 1e-9);
ok('元件都在操作列範圍內',
  pad.slotA.x + pad.joy.w / 2 <= pad.rail + 1 && pad.slotB.x - pad.joy.w / 2 >= LW - pad.rail - 1,
  `搖桿右緣=${(pad.slotA.x + pad.joy.w / 2).toFixed(0)} rail=${pad.rail.toFixed(0)}`);

// ── 2. 相機取景：對準乾淨區的中心 ─────────────────────
console.log('\n2. 相機取景');
step(240);                              // 讓 k 收斂到 1
const il = pad.inset.l * pad.k, ir = pad.inset.r * pad.k;
const fx = il + 0.34 * (1 - il - ir);
ok('進退場進度收斂到 1', Math.abs(pad.k - 1) < 0.01, `k=${pad.k.toFixed(4)}`);
ok('取景分數落在乾淨區內', fx > pad.inset.l && fx < 1 - pad.inset.r,
  `fx=${fx.toFixed(3)} 乾淨區=[${pad.inset.l.toFixed(3)}, ${(1 - pad.inset.r).toFixed(3)}]`);
ok('相對乾淨區仍是 0.34',
  Math.abs((fx - pad.inset.l) / (1 - pad.inset.l - pad.inset.r) - 0.34) < 1e-9);
ok('比原本更靠右（讓出了左操作列）', fx > 0.34, `fx=${fx.toFixed(3)} > 0.34`);

// ── 3. 搖桿固定不浮動 ─────────────────────────────────
console.log('\n3. 搖桿固定不浮動');
const jc = pad.joyPos, travel = (pad.joy.w - pad.joy.h) / 2;
down(1, pad.zoneA.x + 4, pad.zoneA.y + pad.zoneA.h - 10);   // 按在觸控區最左下角
ok('按在角落也抓得到搖桿', pad.jOn);
ok('軸值算的是相對搖桿中心（不是按下點）', pad.axis === -1,
  `按在 x=${(pad.zoneA.x + 4).toFixed(0)}、中心 x=${jc.x.toFixed(0)} → axis=${pad.axis}`);
move(1, jc.x, jc.y);
ok('滑回中心就歸零', pad.axis === 0, `axis=${pad.axis}`);
move(1, jc.x + travel * 0.05, jc.y);
ok('盲區內不動', pad.axis === 0, `axis=${pad.axis}`);
move(1, jc.x + travel * 0.86, jc.y);
ok('推到 86% 行程就滿速', Math.abs(pad.axis - 1) < 1e-9, `axis=${pad.axis.toFixed(4)}`);
move(1, jc.x + travel * 0.5, jc.y);
ok('中間是類比的', pad.axis > 0.3 && pad.axis < 0.8, `axis=${pad.axis.toFixed(3)}`);
move(1, jc.x, jc.y - 400);
ok('純垂直移動不影響左右', pad.axis === 0, `axis=${pad.axis}`);
up(1, jc.x, jc.y);
ok('放開就停', !pad.jOn && pad.axis === 0);

// ── 4. 跳躍鍵 ─────────────────────────────────────────
console.log('\n4. 跳躍鍵');
const bc = pad.jmpPos;
jumpLog = [];
down(2, bc.x, bc.y);
ok('按下就排跳', jumpLog.join(',') === 'down', `log=[${jumpLog}]`);
ok('噴出水花', pad.drops.length >= 9, `drops=${pad.drops.length}`);
step(6);
ok('鼓起來了', pad.bPress > 0.2, `press=${pad.bPress.toFixed(3)}`);
up(2, bc.x, bc.y);
ok('放開有回報（可變跳躍高度靠這個）', jumpLog.join(',') === 'down,up', `log=[${jumpLog}]`);
step(40);
ok('水花會消失', pad.drops.length === 0, `drops=${pad.drops.length}`);

// ── 5. 兩指同時：邊跑邊跳 ─────────────────────────────
console.log('\n5. 兩指同時');
jumpLog = [];
down(1, jc.x + travel, jc.y);
down(2, bc.x, bc.y);
ok('搖桿和跳躍鍵各自獨立', pad.jOn && pad.bOn);
ok('推著的同時跳得出來', Math.abs(pad.axis - 1) < 1e-9 && jumpLog[0] === 'down');
up(2, bc.x, bc.y);
ok('放開跳躍鍵不影響搖桿', pad.jOn && Math.abs(pad.axis - 1) < 1e-9);

// ── 6. 死掉自動鬆手 ───────────────────────────────────
console.log('\n6. 死掉自動鬆手');
jumpLog = [];
down(2, bc.x, bc.y);
alive = false;
step(1);
ok('搖桿鬆開', !pad.jOn && pad.axis === 0);
ok('跳躍鍵鬆開並回報', !pad.bOn && jumpLog.includes('up'), `log=[${jumpLog}]`);
alive = true;

// ── 7. 左右對調 ───────────────────────────────────────
console.log('\n7. 左右對調');
const beforeJoy = pad.joyPos.x;
pad.setSwapped(true);
ok('觸控區歸屬立刻互換（不等動畫）', pad.joyZone === pad.zoneB && pad.jmpZone === pad.zoneA);
ok('位置還在原地（動畫才剛開始）', Math.abs(pad.joyPos.x - beforeJoy) < 1);
down(1, pad.zoneB.x + pad.zoneB.w - 4, pad.zoneB.y + 20);
ok('對調途中摸右邊就是搖桿', pad.jOn);
up(1, pad.zoneB.x, pad.zoneB.y);
step(Math.ceil(0.30 / DT) + 2);
ok('0.3 秒後飛到另一側', Math.abs(pad.joyPos.x - pad.slotB.x) < 0.5,
  `搖桿 x=${pad.joyPos.x.toFixed(1)} 目標=${pad.slotB.x.toFixed(1)}`);
ok('跳躍鍵換到原本搖桿的位置', Math.abs(pad.jmpPos.x - pad.slotA.x) < 0.5);
pad.setSwapped(false);
step(Math.ceil(0.30 / DT) + 2);
ok('換回來', Math.abs(pad.joyPos.x - pad.slotA.x) < 0.5);

// ── 8. 直向：上下介面 ─────────────────────────────────
const PW = 390, PH = 844;
pad.layout(PW, PH, NO_SAFE);
console.log(`\n8. 直向版面 ${PW}×${PH}`);
console.log(`   上帶=${pad.barT.toFixed(0)}  下帶=${pad.barB.toFixed(0)}` +
  `  搖桿 ${pad.joy.w.toFixed(0)}×${pad.joy.h.toFixed(0)}  跳躍鍵 r=${pad.jmp.r.toFixed(1)}`);
ok('認得出是直向', pad.portrait);
ok('沒有左右操作列', pad.rail === 0);
ok('取景改吃上下', pad.inset.l === 0 && pad.inset.r === 0 && pad.inset.t > 0 && pad.inset.b > 0);
ok('中央乾淨區至少佔六成高', (1 - pad.inset.t - pad.inset.b) > 0.6,
  `乾淨=${((1 - pad.inset.t - pad.inset.b) * 100).toFixed(0)}%`);
ok('畫面正中心不屬於任何觸控區',
  !inRect(pad.zoneA, PW / 2, PH / 2) && !inRect(pad.zoneB, PW / 2, PH / 2));
ok('兩個元件左右不打架',
  pad.slotA.x + pad.joy.w / 2 < pad.slotB.x - pad.jmp.r,
  `搖桿右緣=${(pad.slotA.x + pad.joy.w / 2).toFixed(0)} 跳躍鍵左緣=${(pad.slotB.x - pad.jmp.r).toFixed(0)}`);
ok('元件都在畫面內',
  pad.slotA.x - pad.joy.w / 2 >= 0 && pad.slotB.x + pad.jmp.r <= PW);
ok('操作元件在下帶裡', pad.slotA.y > PH - pad.barB && pad.slotA.y < PH);

// ── 9. 關掉手把就完全不收事件 ─────────────────────────
console.log('\n9. 關掉手把');
pad.setEnabled(false);
jumpLog = [];
down(1, pad.zoneA.x + 10, pad.zoneA.y + 10);
down(2, pad.zoneB.x + 10, pad.zoneB.y + 10);
ok('搖桿不理', !pad.jOn && pad.axis === 0);
ok('跳躍鍵不理', !pad.bOn && jumpLog.length === 0);
step(240);
ok('視覺退場歸零', pad.vis === 0 && pad.k < 0.01, `vis=${pad.vis} k=${pad.k.toFixed(4)}`);

// ── 10. 跟 Input 的介面 ───────────────────────────────
console.log('\n10. Input 介面');
let queued = 0;
const input = new Input(() => queued++, () => {});
input.setPad(true, -0.7);
ok('手把軸值蓋過鍵盤', input.axis === -0.7, `axis=${input.axis}`);
input.left = true;
ok('推手把時鍵盤不插嘴', input.axis === -0.7);
input.setPad(false, 0);
ok('放開手把換回鍵盤', input.axis === -1, `axis=${input.axis}`);
input.left = false;
input.setPadJump(true);
ok('按住跳躍鍵 = jumpHeld', input.jumpHeld === true && queued === 1);
input.setPadJump(true);
ok('按著不會重複排跳', queued === 1, `queued=${queued}`);
input.setPadJump(false);
ok('放開就不是 jumpHeld（跳躍會被砍高度）', input.jumpHeld === false);

console.log(fails ? `\n✗ ${fails} 項不合格` : '\n✓ 全部通過');
process.exit(fails ? 1 : 0);
