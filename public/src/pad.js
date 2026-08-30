// ── 螢幕手把：固定在兩側（直向時是下方）操作列的搖桿 + 跳躍鍵 ──────
//
// 風格是「靜如儀器、動如水」：
//   沒被碰的時候只有幾條薄荷細線和一個空心旋鈕，跟 .stat 那些霧面卡同一個語言，
//   不搶畫面；手指一按上去就液化成水球，用的是跟 touch.js 同一組行進波與 tint()。
//   兩種操作方式因此看起來是同一個世界，只是一個游動、一個定居。
//
// 幾何全部在 layout() 算好，main.js 再把 rail 寬度餵回 CSS 變數，
// DOM 的儀表板和這裡畫的操作元件就永遠對齊在同一條操作列裡。
//
// 搖桿本體固定不浮動，但「整個操作列下半段」都是它的觸控區——
// 位置看得到、抓得寬鬆，兩件事不衝突。

import { waveAt, tint } from './touch.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const DEADZONE = 0.12;
const SWAP_T = 0.30;    // 左右對調的飛行時間（秒）
const THROW = 0.86;     // 推到軌道可動範圍的幾成就滿速

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

// 跟水球同一套：閒置擾動 + 朝某個方向的鼓起 + 收斂的行進波
function blobPath(cx, cy, r, tilt, pull, t, ph, wa) {
  const N = 44;
  const xs = new Float32Array(N), ys = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const th = (i / N) * TAU;
    let k = 1
      + 0.026 * Math.sin(3 * th + ph[0] + 1.30 * t)
      + 0.020 * Math.sin(5 * th + ph[1] - 0.95 * t)
      + 0.014 * Math.sin(7 * th + ph[2] + 2.05 * t);
    const d = angDiff(th, tilt);
    const face = Math.cos(d);
    k += pull * (0.26 * Math.pow(Math.max(0, face), 1.5) - 0.09 * Math.max(0, -face));
    const env = 0.3 + 0.7 * Math.pow(Math.cos(d * 0.5), 2);
    k += wa * waveAt(Math.abs(d), t) * env;
    xs[i] = cx + Math.cos(th) * r * k;
    ys[i] = cy + Math.sin(th) * r * k;
  }
  const p = new Path2D();
  p.moveTo((xs[N - 1] + xs[0]) / 2, (ys[N - 1] + ys[0]) / 2);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    p.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[j]) / 2, (ys[i] + ys[j]) / 2);
  }
  p.closePath();
  return p;
}

// 水的菲涅耳 + 高光，跟 WaterBall._drawBody 同一個配方
function fillLiquid(ctx, p, cx, cy, r, tn, glow) {
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.34, r * 0.08, cx, cy, r * 1.05);
  g.addColorStop(0, 'rgba(255,255,255,0.26)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.82, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, tint(tn, 0.3));
  ctx.fillStyle = g;
  ctx.fill(p);

  ctx.save();
  ctx.clip(p);
  const hx = cx - r * 0.34, hy = cy - r * 0.4;
  const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.55);
  hg.addColorStop(0, 'rgba(255,255,255,0.4)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2);
  ctx.restore();

  ctx.lineWidth = 1.6;
  ctx.strokeStyle = tint(tn, 0.5 + 0.35 * tn);
  ctx.shadowColor = tint(tn, 0.45);
  ctx.shadowBlur = glow;
  ctx.stroke(p);
  ctx.shadowBlur = 0;
}

// 橫躺膠囊（roundRect 不是每台裝置都有，自己畫比較省事）
function capsule(x, y, w, h) {
  const r = h / 2;
  const p = new Path2D();
  p.moveTo(x - w / 2 + r, y - r);
  p.lineTo(x + w / 2 - r, y - r);
  p.arc(x + w / 2 - r, y, r, -Math.PI / 2, Math.PI / 2);
  p.lineTo(x - w / 2 + r, y + r);
  p.arc(x - w / 2 + r, y, r, Math.PI / 2, -Math.PI / 2);
  p.closePath();
  return p;
}

export class Pad {
  /**
   * @param {HTMLCanvasElement} canvas 跟水球同一張操作層畫布
   * @param {{onJump:()=>void, onJumpEnd:()=>void, enabled:()=>boolean}} opts
   */
  constructor(canvas, opts) {
    this.onJump = opts.onJump || (() => {});
    this.onJumpEnd = opts.onJumpEnd || (() => {});
    this.isEnabled = opts.enabled || (() => true);
    this.canvas = canvas;

    this.on = false;              // 手把開著嗎（狀態，立刻生效；視覺才有動畫）
    this.vis = 0; this.visv = 0;  // 進退場：彈簧，會過衝一點
    this.k = 0;                   // 同一件事的無過衝版，給相機和 CSS 用
    this.t = 0;

    this.swapped = false;         // true = 搖桿在右
    this.mix = 0;                 // 對調動畫：0 = 搖桿在 A 槽，1 = 在 B 槽
    this.mixFrom = 0; this.mixTo = 0; this.mixT = 1;

    // 搖桿
    this.jOn = false; this.jPid = null;
    this.axis = 0;                // −1..1，給 Input 讀
    this.jTarget = 0;             // 旋鈕目標位置（−1..1，含盲區內的微量）
    this.jK = 0; this.jKv = 0;    // 旋鈕視覺位置 + 彈簧速度
    this.jLiq = 0;                // 0 = 儀器環，1 = 液化
    this.jPh = [0, 0, 0];

    // 跳躍鍵
    this.bOn = false; this.bPid = null;
    this.bPress = 0; this.bPressv = 0;
    this.bLiq = 0;
    this.bPh = [0, 0, 0];
    this.drops = [];

    this.W = 0; this.H = 0;
    this.portrait = false;
    this.rail = 0; this.barT = 0; this.barB = 0; this.zoneH = 0; this.ctrlTop = 0;
    this.inset = { l: 0, r: 0, t: 0, b: 0 };
    this.joy = { w: 120, h: 56, kr: 24 };
    this.jmp = { r: 40 };
    this.slotA = { x: 0, y: 0 };
    this.slotB = { x: 0, y: 0 };
    this.zoneA = { x: 0, y: 0, w: 0, h: 0 };
    this.zoneB = { x: 0, y: 0, w: 0, h: 0 };

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointercancel', (e) => this._up(e));
    addEventListener('blur', () => this._releaseAll());
  }

  // ── 狀態切換 ──────────────────────────────────────────
  setEnabled(on) {
    if (this.on === on) return;
    this.on = on;
    if (!on) this._releaseAll();
  }

  setSwapped(sw) {
    if (this.swapped === sw) return;
    this.swapped = sw;
    this.mixFrom = this.mix;
    this.mixTo = sw ? 1 : 0;
    this.mixT = 0;
  }

  // ── 幾何 ──────────────────────────────────────────────
  // 回傳的 rail / barT / barB 會被 main.js 寫進 CSS 變數，
  // DOM 的儀表板就跟這裡畫的東西共用同一條操作列。
  layout(W, H, safe) {
    this.W = W; this.H = H;
    const sl = safe.l, sr = safe.r, st = safe.t, sb = safe.b;
    this.portrait = H > W;

    if (!this.portrait) {
      // 橫向：左右兩根直欄，上儀表板、下操作元件
      const rail = clamp(Math.min(W * 0.155, H * 0.44), 96, 190);
      // 軌道可動距離是 (w−h)/2，所以膠囊要「寬而不高」——
      // 拇指才推得出足夠的行程，旋鈕又還抓得住
      const iw = Math.min(rail - 18, 168);
      const jh = clamp(iw * 0.42, 46, 70);
      const br = Math.min(iw * 0.5, 52);
      const half = Math.max(iw / 2, br);
      const boxH = Math.max(jh, br * 2);
      const cy = H - sb - 20 - boxH / 2;

      this.rail = rail; this.barT = 0; this.barB = 0;
      this.joy = { w: iw, h: jh, kr: jh * 0.42 };
      this.jmp = { r: br };
      this.slotA = { x: sl + Math.max(rail / 2, half + 6), y: cy };
      this.slotB = { x: W - sr - Math.max(rail / 2, half + 6), y: cy };

      this.ctrlTop = cy - boxH / 2 - 12;
      const top = Math.min(cy - boxH / 2 - 28, H * 0.5);
      this.zoneH = H - top;
      this.zoneA = { x: 0, y: top, w: sl + rail + 12, h: this.zoneH };
      this.zoneB = { x: W - sr - rail - 12, y: top, w: sr + rail + 12, h: this.zoneH };
      this.inset = { l: (sl + rail) / W, r: (sr + rail) / W, t: 0, b: 0 };
    } else {
      // 直向：上下兩條橫帶，中間整片留給遊戲
      // 上帶要塞得下兩塊儀表板「連同最下面那排按鈕」，所以比操作帶還吃高度
      const barB = clamp(Math.min(H * 0.21, W * 0.56), 120, 200);
      const barT = clamp(H * 0.175, 104, 168);
      const iw = clamp(W * 0.34, 130, 240);
      const jh = clamp(Math.min(iw * 0.42, barB * 0.5), 50, 88);
      const br = clamp(Math.min(W * 0.13, barB * 0.34), 38, 60);
      const half = Math.max(iw / 2, br);
      const cy = H - sb - barB / 2;

      this.rail = 0; this.barT = barT; this.barB = barB;
      this.joy = { w: iw, h: jh, kr: jh * 0.42 };
      this.jmp = { r: br };
      this.slotA = { x: sl + 16 + half, y: cy };
      this.slotB = { x: W - sr - 16 - half, y: cy };

      const top = H - sb - barB - 12;
      this.ctrlTop = top;
      this.zoneH = H - top;
      this.zoneA = { x: 0, y: top, w: W / 2, h: this.zoneH };
      this.zoneB = { x: W / 2, y: top, w: W / 2, h: this.zoneH };
      this.inset = { l: 0, r: 0, t: (st + barT) / H, b: (sb + barB) / H };
    }
  }

  _at(m) {
    return { x: lerp(this.slotA.x, this.slotB.x, m), y: lerp(this.slotA.y, this.slotB.y, m) };
  }
  get joyPos() { return this._at(this.mix); }
  get jmpPos() { return this._at(1 - this.mix); }

  // 觸控區歸屬用「目標」而不是動畫值：對調的那 0.3 秒裡，
  // 摸左邊就是控制正飛過來的那一個，不會有中途換手的空窗。
  get joyZone() { return this.swapped ? this.zoneB : this.zoneA; }
  get jmpZone() { return this.swapped ? this.zoneA : this.zoneB; }

  // ── 指標事件 ──────────────────────────────────────────
  _live() { return this.on && this.isEnabled(); }

  _hit(z, x, y) { return x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h; }

  _down(e) {
    if (!this._live()) return;
    const x = e.clientX, y = e.clientY;
    if (!this.jOn && this._hit(this.joyZone, x, y)) {
      e.preventDefault();
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* 沒有就算了 */ }
      this.jOn = true; this.jPid = e.pointerId;
      for (let i = 0; i < 3; i++) this.jPh[i] = Math.random() * TAU;
      this._aim(x);
      return;
    }
    if (!this.bOn && this._hit(this.jmpZone, x, y)) {
      e.preventDefault();
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* 沒有就算了 */ }
      this.bOn = true; this.bPid = e.pointerId;
      for (let i = 0; i < 3; i++) this.bPh[i] = Math.random() * TAU;
      this.bPressv = 26;
      this._splash();
      try { if (navigator.vibrate) navigator.vibrate(10); } catch { /* 不支援就算了 */ }
      this.onJump();
    }
  }

  _move(e) {
    if (!this._live()) return;
    if (this.jOn && e.pointerId === this.jPid) { e.preventDefault(); this._aim(e.clientX); }
  }

  _up(e) {
    if (this.jOn && e.pointerId === this.jPid) { e.preventDefault(); this._releaseJoy(); }
    if (this.bOn && e.pointerId === this.bPid) { e.preventDefault(); this._releaseBtn(); }
  }

  // 旋鈕固定不浮動：軸值是「手指 x 相對搖桿中心」，不是相對按下的那一點。
  // 所以按在觸控區哪裡就已經在推了，不必先滑到旋鈕上——看得到位置、又抓得寬鬆。
  _aim(x) {
    const travel = (this.joy.w - this.joy.h) / 2;
    const a = clamp((x - this.joyPos.x) / Math.max(travel * THROW, 1), -1, 1);
    const m = Math.abs(a);
    this.axis = m < DEADZONE ? 0 : Math.sign(a) * ((m - DEADZONE) / (1 - DEADZONE));
    this.jTarget = a;
  }

  _releaseJoy() {
    this.jOn = false; this.jPid = null; this.axis = 0; this.jTarget = 0;
  }

  _releaseBtn() {
    if (!this.bOn) return;
    this.bOn = false; this.bPid = null;
    this.onJumpEnd();
  }

  _releaseAll() { this._releaseJoy(); this._releaseBtn(); }

  // ── 每幀 ──────────────────────────────────────────────
  update(dt) {
    this.t += dt;
    // 死掉或還沒開跑的時候鬆手，不然按著跳的那一下會殘留到下一輪
    if ((this.jOn || this.bOn) && !this._live()) this._releaseAll();

    // 進退場：彈簧給視覺（過衝一點才有彈性），指數給相機（過衝的話畫面會晃）
    const target = this.on ? 1 : 0;
    this.visv += ((target - this.vis) * 260 - this.visv * 23) * dt;
    this.vis += this.visv * dt;
    if (!this.on && this.vis < 0.002 && Math.abs(this.visv) < 0.02) { this.vis = 0; this.visv = 0; }
    this.k += (target - this.k) * (1 - Math.pow(0.0016, dt));

    if (this.mixT < 1) {
      this.mixT = Math.min(1, this.mixT + dt / SWAP_T);
      this.mix = lerp(this.mixFrom, this.mixTo, easeIO(this.mixT));
    }

    // 旋鈕：推的時候跟手（硬），放開彈回中心（軟一點，看得到回彈）
    const jt = this.jOn ? this.jTarget : 0;
    this.jKv += ((jt - this.jK) * (this.jOn ? 900 : 420) - this.jKv * (this.jOn ? 46 : 26)) * dt;
    this.jK += this.jKv * dt;

    const liqK = 1 - Math.pow(0.0006, dt);
    this.jLiq += ((this.jOn ? 1 : 0) - this.jLiq) * liqK;
    this.bLiq += ((this.bOn ? 1 : 0) - this.bLiq) * liqK;

    // 按壓：按下瞬間鼓起，按著維持，放開彈回
    this.bPressv += (((this.bOn ? 1 : 0) - this.bPress) * 420 - this.bPressv * 26) * dt;
    this.bPress += this.bPressv * dt;

    this._updateDrops(dt);
  }

  _splash() {
    const r = this.jmp.r;
    const n = 9 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = 70 + Math.random() * 150;
      this.drops.push({
        ax: Math.cos(a) * r * 0.75, ay: Math.sin(a) * r * 0.75,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        r0: 1.6 + Math.random() * 2.8, t: 0,
        life: 0.30 + Math.random() * 0.22,
      });
    }
  }

  // 水滴存的是「相對跳躍鍵中心」的位移，所以對調飛行途中噴的水花也會跟著飛過去
  _updateDrops(dt) {
    const out = [];
    for (const d of this.drops) {
      d.t += dt / d.life;
      if (d.t >= 1) continue;
      d.ax += d.vx * dt;
      d.ay += d.vy * dt;
      d.vy += 300 * dt;
      const drag = Math.pow(0.1, dt);
      d.vx *= drag; d.vy *= drag;
      out.push(d);
    }
    this.drops = out;
  }

  // ── 繪製 ──────────────────────────────────────────────
  draw(ctx) {
    if (this.vis <= 0.002) return;
    const v = clamp(this.vis, 0, 1.3);
    // 對調途中兩邊各縮一下，看起來是「被拋過去」而不是瞬移
    const dip = this.mixT < 1 ? 1 - 0.13 * Math.sin(Math.PI * this.mixT) : 1;
    // 進場時從畫面外緣推進來
    const off = (1 - Math.min(1, this.vis)) * 26;

    ctx.save();
    ctx.globalAlpha = clamp(this.vis, 0, 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const j = this.joyPos, b = this.jmpPos;
    this._drawJoy(ctx, j.x + this._offX(j.x, off), j.y + this._offY(off), v * dip);
    this._drawJump(ctx, b.x + this._offX(b.x, off), b.y + this._offY(off), v * dip);

    ctx.restore();
  }

  _offX(x, off) { return this.portrait ? 0 : (x < this.W / 2 ? -off : off); }
  _offY(off) { return this.portrait ? off : 0; }

  // 搖桿：膠囊軌道（儀器）＋ 液化旋鈕
  _drawJoy(ctx, cx, cy, s) {
    const w = this.joy.w * s, h = this.joy.h * s, kr = this.joy.kr * s;
    const travel = (w - h) / 2;
    const liq = this.jLiq;
    const a = clamp(this.jK, -1, 1);

    // 軌道
    const track = capsule(cx, cy, w, h);
    ctx.fillStyle = 'rgba(6,11,28,0.46)';
    ctx.fill(track);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(94,242,192,' + (0.14 + 0.16 * liq).toFixed(3) + ')';
    ctx.stroke(track);

    // 中線刻度：只在靜止時看得到，一推就讓位給水
    ctx.save();
    ctx.globalAlpha *= 0.5 - 0.4 * liq;
    ctx.setLineDash([2, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(143,183,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(cx - travel, cy);
    ctx.lineTo(cx + travel, cy);
    ctx.stroke();
    ctx.restore();

    // 端點靶標。旋鈕推到底時會蓋住它們（膠囊的幾何注定如此），
    // 所以靠近就讓它淡掉——「到位了」，力道則交給那道水痕去說。
    const chev = (dir) => {
      const on = Math.max(0, dir * a);
      ctx.save();
      ctx.globalAlpha *= 0.34 * (1 - on * 0.92);
      ctx.strokeStyle = 'rgba(143,183,255,0.75)';
      ctx.lineWidth = 1.8;
      const ex = cx + dir * (w / 2 - h * 0.28), q = h * 0.15;
      ctx.beginPath();
      ctx.moveTo(ex - dir * q, cy - q);
      ctx.lineTo(ex + dir * q, cy);
      ctx.lineTo(ex - dir * q, cy + q);
      ctx.stroke();
      ctx.restore();
    };
    chev(-1); chev(1);

    // 推桿量：從中心拖到旋鈕的一道水痕
    const kx = cx + a * travel;
    if (Math.abs(a) > 0.02) {
      ctx.save();
      ctx.clip(track);
      const g = ctx.createLinearGradient(cx, 0, kx, 0);
      g.addColorStop(0, tint(Math.abs(a), 0.04));
      g.addColorStop(1, tint(Math.abs(a), 0.30));
      ctx.fillStyle = g;
      ctx.fillRect(Math.min(cx, kx), cy - h / 2, Math.abs(kx - cx), h);
      ctx.restore();
    }

    // 旋鈕：靜止是空心環，被按住就液化。兩者交叉淡入，中間那一刻正好是「開始成形」。
    if (liq < 0.99) {
      ctx.save();
      ctx.globalAlpha *= 1 - liq;
      ctx.beginPath();
      ctx.arc(kx, cy, kr, 0, TAU);
      ctx.fillStyle = 'rgba(232,240,255,0.07)';
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = 'rgba(232,240,255,0.5)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(kx, cy, 2.2, 0, TAU);
      ctx.fillStyle = 'rgba(232,240,255,0.75)';
      ctx.fill();
      ctx.restore();
    }
    if (liq > 0.01) {
      ctx.save();
      ctx.globalAlpha *= liq;
      const tn = Math.abs(a);
      // 被推的時候朝行進方向鼓起，像被水流帶著跑
      const p = blobPath(kx, cy, kr, a >= 0 ? 0 : Math.PI, Math.abs(a) * 0.85 * liq,
        this.t, this.jPh, 0.03 + 0.06 * Math.abs(a));
      fillLiquid(ctx, p, kx, cy, kr, tn, 8 + 14 * tn);
      ctx.restore();
    }
  }

  // 跳躍鍵：細環儀器 ＋ 按下時鼓成水滴、炸出水花
  _drawJump(ctx, cx, cy, s) {
    const r = this.jmp.r * s;
    const liq = this.bLiq;
    const press = clamp(this.bPress, 0, 1.4);

    // 外環：按著時整圈亮起來——「還按著」就是「還在長高」，這件事要看得到
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(94,242,192,' + (0.16 + 0.5 * liq).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, TAU);
    ctx.stroke();

    if (liq < 0.99) {
      ctx.save();
      ctx.globalAlpha *= 1 - liq;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fillStyle = 'rgba(6,11,28,0.46)';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(232,240,255,0.42)';
      ctx.stroke();
      ctx.restore();
    }
    if (liq > 0.01) {
      ctx.save();
      ctx.globalAlpha *= liq;
      const rr = r * (1 + 0.10 * press);
      const p = blobPath(cx, cy, rr, -Math.PI / 2, 0.34 * press, this.t, this.bPh,
        0.035 + 0.075 * press);
      fillLiquid(ctx, p, cx, cy, rr, 0.55 + 0.45 * press, 12 + 22 * press);
      ctx.restore();
    }

    // 向上的箭頭：這顆鍵在說什麼，一眼就懂
    ctx.save();
    ctx.globalAlpha *= 0.55 + 0.45 * liq;
    ctx.strokeStyle = liq > 0.02 ? tint(0.4 + 0.6 * liq, 0.95) : 'rgba(232,240,255,0.62)';
    ctx.lineWidth = Math.max(2, r * 0.09);
    const q = r * 0.30, y = cy + q * 0.45 - press * r * 0.06;
    ctx.beginPath();
    ctx.moveTo(cx - q, y);
    ctx.lineTo(cx, y - q * 0.95);
    ctx.lineTo(cx + q, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, y - q * 0.8);
    ctx.lineTo(cx, y + q * 0.62);
    ctx.stroke();
    ctx.restore();

    this._drawDrops(ctx, cx, cy);
  }

  _drawDrops(ctx, cx, cy) {
    for (const d of this.drops) {
      const rr = d.r0 * Math.pow(1 - d.t, 0.6);
      if (rr < 0.35) continue;
      const fade = Math.pow(1 - d.t, 0.5);
      const x = cx + d.ax, y = cy + d.ay;
      const g = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.3, 0, x, y, rr);
      g.addColorStop(0, 'rgba(255,255,255,' + (0.72 * fade).toFixed(3) + ')');
      g.addColorStop(0.7, 'rgba(255,255,255,' + (0.34 * fade).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(210,255,240,' + (0.5 * fade).toFixed(3) + ')');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, TAU);
      ctx.fill();
    }
  }
}
