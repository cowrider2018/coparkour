/* ── test-area/src/pad.js ────────────────────────────────────────────
   螢幕手把，照搬遊戲的那一套。

   來源是 `public/src/pad.js`：橫向的時候兩側各一根直欄，上半段是儀表板、
   下半段是操作元件，中間那一整片永遠留給遊戲——那個功能的全部意義就在
   那片乾淨。這一頁照搬的是同一件事：

     幾何   `layout()` 的每一個數字都是那邊的：
            rail = clamp(min(W·0.155, H·0.44), 96, 190)、
            iw = min(rail − 18, 168)、
            直向的 barT / barB、觸控區從 min(cy − boxH/2 − 28, H·0.5) 開始。
            算好的 rail / barT / barB / ctrl / zone 由 main.js 寫進 CSS
            變數，DOM 的面板與畫布上的操作元件因此永遠對齊在同一條列裡。
     外觀   「靜如儀器、動如水」：沒被碰的時候只有幾條薄荷細線和一個空心
            旋鈕；手指一按上去就液化成水球，用的是 `touch.js` 的
            `waveAt()` 與 `tint()`。`blobPath`、`fillLiquid`、水花與所有
            彈簧常數都是那邊的原文——那些數字就是這個操作介面的長相，
            重新調一次只會調出一個像的東西。
     手感   旋鈕固定不浮動，軸值是「手指相對搖桿中心」而不是相對按下的
            那一點，所以按在觸控區的哪裡就已經在推了，不必先滑到旋鈕上。
            死區 0.12、推到可動範圍的 0.86 就滿速，都照抄。

   ── 唯一的差別：軸從一維變二維 ────────────────────────────────────
   跑酷是橫向的，所以那邊的搖桿是一條橫躺的膠囊軌道，軸只有 x。這一頁
   是 3D，要八個方向，所以軌道改成圓的：

     · 軌道是一個圓（同樣的深底 + 薄荷細線），端點靶標從兩個變四個，
       靜止時的中線刻度變成一個十字。
     · 旋鈕可動範圍是「圓心到軌道內緣」，軸夾在單位圓裡——夾方的話對角
       線長 1.41，斜著跑會比直著跑快 41%。
     · 那道從圓心拖到旋鈕的水痕還在，只是方向跟著旋鈕跑。

   跳躍鍵一個像素都沒動：細環儀器、按下鼓成水滴、炸出水花、向上的箭頭。
   ------------------------------------------------------------------ */

import { waveAt, tint } from '../../src/touch.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 死區與滿速門檻，跟遊戲的手把一樣。 */
const DEADZONE = 0.12;
const THROW = 0.86;

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/* 閒置擾動 + 朝某個方向的鼓起 + 收斂的行進波。src/pad.js 的原文。 */
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

/* 水的菲涅耳 + 高光。src/pad.js 的 fillLiquid 原文。 */
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

export class Pad {
  /**
   * @param {HTMLCanvasElement} canvas 操作層那張 2D 畫布
   * @param {{onJump:()=>void}} [opts]
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onJump = opts.onJump || (() => {});
    this.t = 0;

    /** 給外面讀的：圓形的二維軸，長度 ≤ 1。 */
    this.axis = { x: 0, y: 0 };
    this.mag = 0;

    // 搖桿
    this.jOn = false; this.jPid = null;
    this.jTx = 0; this.jTy = 0;          // 旋鈕目標（−1..1，含死區內的微量）
    this.jKx = 0; this.jKy = 0;          // 旋鈕視覺位置
    this.jKvx = 0; this.jKvy = 0;        // …與它的彈簧速度
    this.jLiq = 0;                       // 0 = 儀器環，1 = 液化
    this.jPh = [0, 0, 0];

    // 跳躍鍵
    this.bOn = false; this.bPid = null;
    this.bPress = 0; this.bPressv = 0;
    this.bLiq = 0;
    this.bPh = [0, 0, 0];
    this.drops = [];
    this._queued = false;

    this.W = 0; this.H = 0; this.dpr = 1;
    this.portrait = false;
    this.rail = 0; this.barT = 0; this.barB = 0; this.zoneH = 0; this.ctrlTop = 0;
    this.joy = { r: 48, kr: 20 };
    this.jmp = { r: 40 };
    this.slotJoy = { x: 0, y: 0 };
    this.slotJmp = { x: 0, y: 0 };
    this.zoneJoy = { x: 0, y: 0, w: 0, h: 0 };
    this.zoneJmp = { x: 0, y: 0, w: 0, h: 0 };
  }

  /* ── 幾何 ──────────────────────────────────────────────────────
     src/pad.js 的 layout()，數字照抄。回傳的 rail / barT / barB / ctrlTop
     / zoneH 由 main.js 寫進 CSS 變數，所以 DOM 的面板與這裡畫的東西
     共用同一條操作列。

     預設左搖桿、右跳躍，而且不提供對調——遊戲那邊有對調是因為它要照顧
     左右手，這一頁是試玩場，少一個狀態少一個要驗的東西。 */
  layout(W, H, dpr, safe = { l: 0, r: 0, t: 0, b: 0 }) {
    this.W = W; this.H = H; this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    const { l: sl, r: sr, t: st, b: sb } = safe;
    this.portrait = H > W;

    if (!this.portrait) {
      // 橫向：左右兩根直欄，上儀表板、下操作元件
      const rail = clamp(Math.min(W * 0.155, H * 0.44), 96, 190);
      const iw = Math.min(rail - 18, 168);
      /* 圓軌道的直徑就是那條膠囊的寬度，所以拇指的行程跟遊戲一樣寬；
         旋鈕的比例也照抄（膠囊高 0.42·iw、旋鈕半徑 0.42·高）。 */
      const jr = iw / 2;
      const kr = clamp(iw * 0.42, 46, 70) * 0.42;
      const br = Math.min(iw * 0.5, 52);
      const half = Math.max(jr, br);
      const boxH = Math.max(jr * 2, br * 2);
      const cy = H - sb - 20 - boxH / 2;

      this.rail = rail; this.barT = 0; this.barB = 0;
      this.joy = { r: jr, kr };
      this.jmp = { r: br };
      this.slotJoy = { x: sl + Math.max(rail / 2, half + 6), y: cy };
      this.slotJmp = { x: W - sr - Math.max(rail / 2, half + 6), y: cy };

      this.ctrlTop = cy - boxH / 2 - 12;
      const top = Math.min(cy - boxH / 2 - 28, H * 0.5);
      this.zoneH = H - top;
      this.zoneJoy = { x: 0, y: top, w: sl + rail + 12, h: this.zoneH };
      this.zoneJmp = { x: W - sr - rail - 12, y: top, w: sr + rail + 12, h: this.zoneH };
    } else {
      // 直向：上下兩條橫帶，中間整片留給遊戲
      const barB = clamp(Math.min(H * 0.21, W * 0.56), 120, 200);
      const barT = clamp(H * 0.175, 104, 168);
      const iw = clamp(W * 0.34, 130, 240);
      const jr = clamp(Math.min(iw * 0.42, barB * 0.5), 50, 88) / 2 * 1.6;
      const kr = clamp(Math.min(iw * 0.42, barB * 0.5), 50, 88) * 0.42;
      const br = clamp(Math.min(W * 0.13, barB * 0.34), 38, 60);
      const half = Math.max(jr, br);
      const cy = H - sb - barB / 2;

      this.rail = 0; this.barT = barT; this.barB = barB;
      this.joy = { r: jr, kr };
      this.jmp = { r: br };
      this.slotJoy = { x: sl + 16 + half, y: cy };
      this.slotJmp = { x: W - sr - 16 - half, y: cy };

      const top = H - sb - barB - 12;
      this.ctrlTop = top;
      this.zoneH = H - top;
      this.zoneJoy = { x: 0, y: top, w: W / 2, h: this.zoneH };
      this.zoneJmp = { x: W / 2, y: top, w: W / 2, h: this.zoneH };
    }
  }

  /** 這一點該由誰接。`null` 是中間那片遊戲畫面（轉鏡頭與縮放）。 */
  hit(x, y) {
    const inside = (z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
    if (inside(this.zoneJoy)) return 'joy';
    if (inside(this.zoneJmp)) return 'jmp';
    return null;
  }

  /* ── 指標 ────────────────────────────────────────────────────── */
  down(kind, pid, x, y) {
    if (kind === 'joy') {
      if (this.jOn) return;
      this.jOn = true; this.jPid = pid;
      for (let i = 0; i < 3; i++) this.jPh[i] = Math.random() * TAU;
      this._aim(x, y);
      return;
    }
    if (this.bOn) return;
    this.bOn = true; this.bPid = pid;
    for (let i = 0; i < 3; i++) this.bPh[i] = Math.random() * TAU;
    this.bPressv = 26;
    this._splash();
    try { if (navigator.vibrate) navigator.vibrate(10); } catch { /* 不支援就算了 */ }
    this._queued = true;
    this.onJump();
  }

  move(pid, x, y) {
    if (this.jOn && pid === this.jPid) this._aim(x, y);
  }

  up(pid) {
    if (this.jOn && pid === this.jPid) {
      this.jOn = false; this.jPid = null;
      this.axis.x = 0; this.axis.y = 0; this.mag = 0;
      this.jTx = 0; this.jTy = 0;
    }
    if (this.bOn && pid === this.bPid) { this.bOn = false; this.bPid = null; }
  }

  releaseAll() { this.up(this.jPid); this.up(this.bPid); }

  /** 按過跳沒有。讀一次就清掉，所以一次按下只跳一次。 */
  takeJump() {
    if (!this._queued) return false;
    this._queued = false;
    return true;
  }

  /* 旋鈕固定不浮動：軸值是「手指相對搖桿中心」，不是相對按下的那一點。
     所以按在觸控區哪裡就已經在推了，不必先滑到旋鈕上——看得到位置、
     又抓得寬鬆。夾圓不夾方，斜推才不會比直推快。 */
  _aim(x, y) {
    const travel = Math.max((this.joy.r - this.joy.kr) * THROW, 1);
    let ax = (x - this.slotJoy.x) / travel;
    let ay = (y - this.slotJoy.y) / travel;
    const m = Math.hypot(ax, ay);
    if (m > 1) { ax /= m; ay /= m; }
    this.jTx = ax; this.jTy = ay;
    const mag = Math.min(1, m);
    if (mag < DEADZONE) {
      this.axis.x = 0; this.axis.y = 0; this.mag = 0;
      return;
    }
    const k = (mag - DEADZONE) / (1 - DEADZONE);
    const len = Math.max(m, 1e-6);
    this.axis.x = ((x - this.slotJoy.x) / travel / len) * k;
    this.axis.y = ((y - this.slotJoy.y) / travel / len) * k;
    this.mag = k;
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

  /* ── 每幀 ────────────────────────────────────────────────────
     每一條彈簧的係數都是 src/pad.js 的：旋鈕推的時候硬（900/46）、放開
     軟一點看得到回彈（420/26），液化與按壓各自一條。 */
  update(dt) {
    this.t += dt;

    const jtx = this.jOn ? this.jTx : 0;
    const jty = this.jOn ? this.jTy : 0;
    const kS = this.jOn ? 900 : 420, kD = this.jOn ? 46 : 26;
    this.jKvx += ((jtx - this.jKx) * kS - this.jKvx * kD) * dt;
    this.jKvy += ((jty - this.jKy) * kS - this.jKvy * kD) * dt;
    this.jKx += this.jKvx * dt;
    this.jKy += this.jKvy * dt;

    const liqK = 1 - Math.pow(0.0006, dt);
    this.jLiq += ((this.jOn ? 1 : 0) - this.jLiq) * liqK;
    this.bLiq += ((this.bOn ? 1 : 0) - this.bLiq) * liqK;

    this.bPressv += (((this.bOn ? 1 : 0) - this.bPress) * 420 - this.bPressv * 26) * dt;
    this.bPress += this.bPressv * dt;

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

  /* ── 繪製 ──────────────────────────────────────────────────── */
  draw() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this._drawJoy(ctx, this.slotJoy.x, this.slotJoy.y);
    this._drawJump(ctx, this.slotJmp.x, this.slotJmp.y);
    ctx.restore();
  }

  /** 搖桿：圓軌道（儀器）＋ 液化旋鈕。 */
  _drawJoy(ctx, cx, cy) {
    const R = this.joy.r, kr = this.joy.kr;
    const travel = R - kr;
    const liq = this.jLiq;
    let ax = this.jKx, ay = this.jKy;
    const am = Math.hypot(ax, ay);
    if (am > 1) { ax /= am; ay /= am; }
    const tn = Math.min(1, am);

    // 軌道
    const track = new Path2D();
    track.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = 'rgba(24,18,11,0.46)';
    ctx.fill(track);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(155,217,78,${(0.14 + 0.16 * liq).toFixed(3)})`;
    ctx.stroke(track);

    // 十字刻度：只在靜止時看得到，一推就讓位給水
    ctx.save();
    ctx.globalAlpha *= 0.5 - 0.4 * liq;
    ctx.setLineDash([2, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(226,196,142,0.5)';
    ctx.beginPath();
    ctx.moveTo(cx - travel, cy); ctx.lineTo(cx + travel, cy);
    ctx.moveTo(cx, cy - travel); ctx.lineTo(cx, cy + travel);
    ctx.stroke();
    ctx.restore();

    /* 四個端點靶標。旋鈕推到那一側時會蓋住它（幾何注定如此），所以靠近
       就讓它淡掉——「到位了」，力道交給那道水痕去說。 */
    const chev = (dx, dy) => {
      const on = Math.max(0, ax * dx + ay * dy);
      ctx.save();
      ctx.globalAlpha *= 0.34 * (1 - on * 0.92);
      ctx.strokeStyle = 'rgba(226,196,142,0.75)';
      ctx.lineWidth = 1.8;
      const q = R * 0.10;
      const ex = cx + dx * (R - R * 0.16), ey = cy + dy * (R - R * 0.16);
      // 三角形的兩隻腳往「靶標方向的兩側」張開
      const px = -dy, py = dx;
      ctx.beginPath();
      ctx.moveTo(ex - dx * q + px * q, ey - dy * q + py * q);
      ctx.lineTo(ex + dx * q * 0.6, ey + dy * q * 0.6);
      ctx.lineTo(ex - dx * q - px * q, ey - dy * q - py * q);
      ctx.stroke();
      ctx.restore();
    };
    chev(-1, 0); chev(1, 0); chev(0, -1); chev(0, 1);

    // 推桿量：從中心拖到旋鈕的一道水痕
    const kx = cx + ax * travel, ky = cy + ay * travel;
    if (am > 0.02) {
      ctx.save();
      ctx.clip(track);
      const g = ctx.createLinearGradient(cx, cy, kx, ky);
      g.addColorStop(0, tint(tn, 0.04));
      g.addColorStop(1, tint(tn, 0.30));
      ctx.fillStyle = g;
      const w = kr * 1.5;
      const px = -ay / Math.max(am, 1e-6), py = ax / Math.max(am, 1e-6);
      const p = new Path2D();
      p.moveTo(cx + px * w, cy + py * w);
      p.lineTo(kx + px * w * 0.8, ky + py * w * 0.8);
      p.lineTo(kx - px * w * 0.8, ky - py * w * 0.8);
      p.lineTo(cx - px * w, cy - py * w);
      p.closePath();
      ctx.fill(p);
      ctx.restore();
    }

    /* 旋鈕：靜止是空心環，被按住就液化。兩者交叉淡入，中間那一刻正好是
       「開始成形」。 */
    if (liq < 0.99) {
      ctx.save();
      ctx.globalAlpha *= 1 - liq;
      ctx.beginPath();
      ctx.arc(kx, ky, kr, 0, TAU);
      ctx.fillStyle = 'rgba(247,239,221,0.07)';
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = 'rgba(247,239,221,0.5)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(kx, ky, 2.2, 0, TAU);
      ctx.fillStyle = 'rgba(247,239,221,0.75)';
      ctx.fill();
      ctx.restore();
    }
    if (liq > 0.01) {
      ctx.save();
      ctx.globalAlpha *= liq;
      // 被推的時候朝行進方向鼓起，像被水流帶著跑
      const tilt = Math.atan2(ay, ax);
      const p = blobPath(kx, ky, kr, tilt, tn * 0.85 * liq, this.t, this.jPh, 0.03 + 0.06 * tn);
      fillLiquid(ctx, p, kx, ky, kr, tn, 8 + 14 * tn);
      ctx.restore();
    }
  }

  /** 跳躍鍵：細環儀器 ＋ 按下時鼓成水滴、炸出水花。src/pad.js 的原文。 */
  _drawJump(ctx, cx, cy) {
    const r = this.jmp.r;
    const liq = this.bLiq;
    const press = clamp(this.bPress, 0, 1.4);

    // 外環：按著時整圈亮起來——「還按著」就是「還在長高」，這件事要看得到
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `rgba(155,217,78,${(0.16 + 0.5 * liq).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, TAU);
    ctx.stroke();

    if (liq < 0.99) {
      ctx.save();
      ctx.globalAlpha *= 1 - liq;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fillStyle = 'rgba(24,18,11,0.46)';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(247,239,221,0.42)';
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
    ctx.strokeStyle = liq > 0.02 ? tint(0.4 + 0.6 * liq, 0.95) : 'rgba(247,239,221,0.62)';
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

  /* 水滴存的是「相對跳躍鍵中心」的位移。src/pad.js 的原文。 */
  _drawDrops(ctx, cx, cy) {
    for (const d of this.drops) {
      const rr = d.r0 * Math.pow(1 - d.t, 0.6);
      if (rr < 0.35) continue;
      const fade = Math.pow(1 - d.t, 0.5);
      const x = cx + d.ax, y = cy + d.ay;
      const g = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.3, 0, x, y, rr);
      g.addColorStop(0, `rgba(255,255,255,${(0.72 * fade).toFixed(3)})`);
      g.addColorStop(0.7, `rgba(255,255,255,${(0.34 * fade).toFixed(3)})`);
      g.addColorStop(1, `rgba(236,250,196,${(0.5 * fade).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, TAU);
      ctx.fill();
    }
  }
}
