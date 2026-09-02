// ── 觸控操作：一顆會擾動的水球 ─────────────────────────────
// 按住畫面 → 水球在指下成形；左右拖曳 → 類比移動；手指衝出水球體積 → 跳。
//
// 為什麼跑步不會誤跳：水球中心會被手指牽引（LEAD）——往左右、往下拖到底時
// 整顆球被拖著走，這三個方向永遠逃不出去。只有「往上」不牽引，所以往上甩才是跳。
//
// 視覺上要讓玩家看懂自己在做什麼，靠三件事：
//   1. 水球朝手指鼓起（拉扯感），表面擾動波往手指那一側匯聚
//   2. 起點小白點 → 手指的液體頸，寬度隨拉扯改變
//   3. 手指環上的張力弧，畫滿一圈就是跳
// 手指衝出去的瞬間，舊球炸成小水滴飛向手指、一路縮小到消失，新球在指下長回來。

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ── 幾何（CSS px；半徑會隨畫面縮放）──
const BASE_R = 62;      // 水球半徑，同時就是跳躍門檻
const LEAD = 0.72;      // 牽引距離 / 半徑（左、右、下三個方向）
const FULL_AX = 0.6;    // 拖到牽引距離的幾成就滿速
const DEADZONE = 0.1;

// ── 手感 ──
const JUMP_CD = 0.09;   // 兩跳最短間隔
const REARM_R = 0.8;    // 新球長到這個比例才可能重新武裝
const REARM_D = 0.12;   // 中心追到「手指 REARM_D×r 以內」才重新武裝（留一點殘量沒關係，但要小）
const CHASE = 0.0004;   // 解除武裝時中心垂直追手指的速度（越小越快）
const HOLD_MIN = 0.1;   // 觸控跳的「按住」時間 → 對應可變跳躍高度
const HOLD_MAX = 0.42;
const FLICK_FULL = 1500; // 甩到這個速度（px/s）算全高跳

// ── 表面擾動 ──
const WAVE_K = 3.2;     // 波在圓周上的密度
const WAVE_W = 8.5;     // 波速（rad/s）

// 表面行進波。相位 = K|Δ| + Wt，Δ 是「這一點」與「手指方向」的夾角。
// 等相位點滿足 K|Δ| + Wt = 定值，t 變大 → |Δ| 變小，所以波峰是朝手指那一側收斂的。
// 用 |Δ| 而不是 Δ，兩邊才會對稱，而且在正對手指（Δ=0）和正背面（|Δ|=π）都連續。
export function waveAt(dAbs, t) {
  return Math.sin(WAVE_K * dAbs + WAVE_W * t);
}

const LEAF = [155, 217, 78];

// 白 → 葉綠。張力越大越綠，快跳了一看就知道。
// 手把（pad.js）共用這條色階——兩種操作方式要看起來是同一個世界。
export function tint(t, a) {
  const k = t * t;
  const r = Math.round(255 + (LEAF[0] - 255) * k);
  const g = Math.round(255 + (LEAF[1] - 255) * k);
  const b = Math.round(255 + (LEAF[2] - 255) * k);
  return `rgba(${r},${g},${b},${a})`;
}

// 角度差，收進 [-π, π]
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

export class WaterBall {
  /**
   * @param {HTMLCanvasElement} canvas 接手勢的畫布（要蓋在遊戲層上、HUD 下）
   * @param {{onJump:(hold:number)=>void, enabled:()=>boolean}} opts
   */
  constructor(canvas, opts) {
    this.onJump = opts.onJump || (() => {});
    this.isEnabled = opts.enabled || (() => true);

    this.active = false;
    this.pid = null;
    this.axis = 0;              // −1..1，給 Input 讀

    this.cx = 0; this.cy = 0;   // 水球中心（＝手指起點，會被水平牽引）
    this.fx = 0; this.fy = 0;   // 手指目前位置
    this.fvx = 0; this.fvy = 0; // 手指速度（低通），決定跳躍力道
    this.px0 = 0; this.py0 = 0; // 上一幀手指位置

    this.R = BASE_R;            // 目標半徑
    this.r = 0; this.rv = 0;    // 目前半徑 + 彈簧速度
    this.dist = 0;              // 中心到手指的真實距離（給形狀用）
    this.ang = 0;
    this.pull = 0;              // dist / r：拉扯程度，任何方向都算
    this.esc = 0;               // 逃逸距離：垂直分量只取往上的部分
    this.tension = 0;           // esc / r：離跳躍還有多遠，畫滿就是跳
    this.flare = 0;             // 甩出瞬間的擾動加成，會衰減
    this.armed = true;          // 跳完會解除，中心追上手指才重新武裝
    this.armv = 1;              // 上面那個的平滑版，給視覺用
    this.cd = 0;
    this.shed = 0;              // 高張力時漏水滴的節流
    this.t = 0;

    this.ph = [0, 0, 0];        // 每次觸控重擲的諧波相位，讓形狀不重複
    this.amp = [0.03, 0.026, 0.02];
    this.drops = [];

    this.hintT = 7;             // 沒碰過螢幕時的提示倒數
    this.everTouched = false;

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointercancel', (e) => this._up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('blur', () => this._release());
    this.canvas = canvas;
  }

  resize(W, H) {
    this.R = clamp(Math.min(W, H) * 0.115, 50, 84);
  }

  // ── 指標事件 ──────────────────────────────────────────
  _down(e) {
    if (this.active || !this.isEnabled()) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* 沒有就算了 */ }
    this.pid = e.pointerId;
    this.active = true;
    this.everTouched = true;
    this.cx = this.fx = this.px0 = e.clientX;
    this.cy = this.fy = this.py0 = e.clientY;
    this.fvx = this.fvy = 0;
    this.r = this.R * 0.35;
    this.rv = 0;
    this.axis = 0;
    this.cd = JUMP_CD;
    this.flare = 0.45;
    this.armed = true;
    this.armv = 0;
    for (let i = 0; i < 3; i++) this.ph[i] = Math.random() * TAU;
    this.amp = [0.024 + Math.random() * 0.016, 0.02 + Math.random() * 0.014, 0.014 + Math.random() * 0.012];
  }

  _move(e) {
    if (!this.active || e.pointerId !== this.pid) return;
    e.preventDefault();
    this.fx = e.clientX;
    this.fy = e.clientY;
  }

  _up(e) {
    if (!this.active || e.pointerId !== this.pid) return;
    e.preventDefault();
    this._release();
  }

  // 手指離開螢幕：不算跳（跳只認「衝出體積」），球化開消失
  _release() {
    if (!this.active) return;
    this.active = false;
    this.pid = null;
    this.axis = 0;
    this.tension = 0;
    this.pull = 0;
    this.esc = 0;
    this.rv = Math.min(this.rv, -this.R * 1.2);
  }

  // ── 每幀 ──────────────────────────────────────────────
  update(dt) {
    this.t += dt;
    this.cd = Math.max(0, this.cd - dt);
    this.flare = Math.max(0, this.flare - dt * 2.4);
    this.armv += ((this.armed ? 1 : 0) - this.armv) * (1 - Math.pow(0.002, dt));
    if (!this.everTouched && this.isEnabled()) this.hintT = Math.max(0, this.hintT - dt);

    // 半徑彈簧：成形／重生時會過衝一點，像真的水球彈回來
    const target = this.active ? this.R : 0;
    this.rv += ((target - this.r) * 300 - this.rv * 24) * dt;
    this.r += this.rv * dt;
    if (!this.active && this.r < 0.4) { this.r = 0; this.rv = 0; }

    if (this.active) {
      // 手指速度（低通），用來換算跳躍力道
      const k = 1 - Math.pow(0.0008, dt);
      const inv = 1 / Math.max(dt, 1e-4);
      this.fvx += ((this.fx - this.px0) * inv - this.fvx) * k;
      this.fvy += ((this.fy - this.py0) * inv - this.fvy) * k;

      // 水平牽引：拖過頭就把整顆球帶著走。所以左右怎麼跑都逃不出去。
      const lead = this.R * LEAD;
      let dx = this.fx - this.cx;
      if (dx > lead) this.cx += dx - lead;
      else if (dx < -lead) this.cx += dx + lead;
      dx = this.fx - this.cx;

      // 解除武裝時中心「垂直」追手指——只追垂直，跑步中跳躍才不會斷開左右控制。
      // 手指還在快速移動時追不上，所以一次長甩只會跳一次；手指慢下來才重新武裝。
      if (!this.armed) {
        this.cy += (this.fy - this.cy) * (1 - Math.pow(CHASE, dt));
        if (this.cd <= 0 && this.r > this.R * REARM_R
            && Math.abs(this.fy - this.cy) < this.r * REARM_D) this.armed = true;
      }
      // 往下牽引：跟水平同一套，往下拖整顆球跟著往下走，逃不出去
      let dy = this.fy - this.cy;
      if (dy > lead) { this.cy += dy - lead; dy = lead; }

      // 形狀永遠朝真正的手指方向拉扯（水波要流向手指，不管手指在哪一邊）
      this.dist = Math.hypot(dx, dy);
      this.ang = Math.atan2(dy, dx);
      this.pull = clamp(this.dist / Math.max(this.r, 1), 0, 1);

      // 逃逸進度只算「往上」的那一段。往下拖再遠這個值都不會漲，
      // 所以下拉跳躍自然不存在，也不用另外寫方向判斷。
      // 水平被牽引在 ±0.72R，光靠橫向永遠湊不到 r，一定要真的往上甩。
      const upy = Math.min(0, dy);
      this.esc = Math.hypot(dx, upy);
      this.tension = clamp(this.esc / Math.max(this.r, 1), 0, 1);

      // 類比移動：牽引距離的 FULL_AX 就滿速，扣掉盲區後重新歸一
      let a = clamp(dx / (lead * FULL_AX), -1, 1);
      const m = Math.abs(a);
      this.axis = m < DEADZONE ? 0 : Math.sign(a) * ((m - DEADZONE) / (1 - DEADZONE));

      // 往上衝出體積 → 跳
      if (this.armed && this.esc > this.r && this.cd <= 0) {
        this._burst();
      } else if (this.armed && this.tension > 0.84) {
        // 快到門檻了，先漏幾滴當預告
        this.shed -= dt;
        if (this.shed <= 0) {
          this.shed = 0.075;
          this._drop(this.ang + (Math.random() - 0.5) * 0.8, 0.9, 1.6 + Math.random() * 2.2,
            0.22 + Math.random() * 0.12, (Math.random() - 0.5) * 14);
        }
      }
    }
    this.px0 = this.fx;
    this.py0 = this.fy;

    this._updateDrops(dt);
  }

  // 甩出體積：舊球炸成水滴飛向手指，新球在手指處長回來
  _burst() {
    const speed = Math.hypot(this.fvx, this.fvy);
    const power = clamp(speed / FLICK_FULL, 0, 1);
    const hold = HOLD_MIN + (HOLD_MAX - HOLD_MIN) * (0.35 + 0.65 * power);

    const n = 7 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      this._drop(this.ang + (Math.random() - 0.5) * 1.9, 0.86 + Math.random() * 0.22,
        3.2 + Math.random() * 5.2, 0.26 + Math.random() * 0.22,
        (Math.random() - 0.5) * this.r * 0.55);
    }
    // 幾顆更小的碎沫，散得更開
    for (let i = 0; i < 5; i++) {
      this._drop(Math.random() * TAU, 0.7 + Math.random() * 0.5,
        1.4 + Math.random() * 2.4, 0.3 + Math.random() * 0.25,
        (Math.random() - 0.5) * this.r);
    }

    this.cx = this.fx;
    this.cy = this.fy;
    this.dist = 0;
    this.pull = 0;
    this.esc = 0;
    this.tension = 0;
    this.r *= 0.42;
    this.rv = 0;
    this.flare = 1;
    this.cd = JUMP_CD;
    this.armed = false;
    this.onJump(hold);
  }

  // 水滴用參數化飛行：保證飛得到手指、也保證縮到消失，不用調物理
  _drop(ang, rr, r0, life, curl) {
    this.drops.push({
      sx: this.cx + Math.cos(ang) * this.r * rr,
      sy: this.cy + Math.sin(ang) * this.r * rr,
      x: 0, y: 0, px: 0, py: 0,
      r0, r: r0, life, t: 0, curl,
      ox: (Math.random() - 0.5) * 12,
      oy: (Math.random() - 0.5) * 12,
      ph: Math.random() * TAU,
    });
    const d = this.drops[this.drops.length - 1];
    d.x = d.px = d.sx;
    d.y = d.py = d.sy;
  }

  _updateDrops(dt) {
    const out = [];
    for (const d of this.drops) {
      d.t += dt / d.life;
      if (d.t >= 1) continue;

      // 目標是「手指此刻的位置」，所以手指還在動也追得上
      const tx = this.fx + d.ox, ty = this.fy + d.oy;
      const e = 1 - Math.pow(1 - d.t, 3);
      d.px = d.x; d.py = d.y;
      let x = d.sx + (tx - d.sx) * e;
      let y = d.sy + (ty - d.sy) * e;

      // 垂直於行進方向的弧線，飛起來才不像直線
      const ax = tx - d.sx, ay = ty - d.sy;
      const al = Math.hypot(ax, ay) || 1;
      const s = Math.sin(Math.PI * d.t) * d.curl;
      d.x = x + (-ay / al) * s;
      d.y = y + (ax / al) * s;
      d.r = d.r0 * Math.pow(1 - d.t, 0.7);
      out.push(d);
    }
    this.drops = out;
  }

  // ── 形狀 ──────────────────────────────────────────────
  // r(θ) = R × (閒置擾動 + 朝手指的鼓起 + 往手指匯聚的行進波)
  _shape() {
    const t = this.t, ph = this.ph, am = this.amp;
    const fl = this.flare;
    const pull = this.pull;     // 形狀跟著真實拉扯走，不是跟著「離跳躍多遠」
    const phi = this.ang;
    const wob = 1 + 1.9 * fl;
    const wa = 0.032 + 0.095 * pull + 0.09 * fl;

    return (th) => {
      let k = 1;
      k += (am[0] * Math.sin(3 * th + ph[0] + 1.30 * t)
          + am[1] * Math.sin(5 * th + ph[1] - 0.95 * t)
          + am[2] * Math.sin(7 * th + ph[2] + 2.05 * t)) * wob;

      // 被拉扯：手指那側鼓出去，背面稍微塌
      const d = angDiff(th, phi);
      const face = Math.cos(d);
      k += pull * (0.3 * Math.pow(Math.max(0, face), 1.5) - 0.1 * Math.max(0, -face));

      // 行進波往手指側收斂，而且越靠近手指振幅越大（能量堆在那裡）
      const env = 0.3 + 0.7 * Math.pow(Math.cos(d * 0.5), 2);
      k += wa * waveAt(Math.abs(d), t) * env;

      return this.r * k;
    };
  }

  _contour(cx, cy, fn) {
    const N = 72;
    const p = new Path2D();
    const xs = new Float32Array(N), ys = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const th = (i / N) * TAU;
      const rr = fn(th);
      xs[i] = cx + Math.cos(th) * rr;
      ys[i] = cy + Math.sin(th) * rr;
    }
    p.moveTo((xs[N - 1] + xs[0]) / 2, (ys[N - 1] + ys[0]) / 2);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      p.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[j]) / 2, (ys[i] + ys[j]) / 2);
    }
    p.closePath();
    return p;
  }

  // ── 繪製 ──────────────────────────────────────────────
  draw(ctx, W, H) {
    // 跳完到重新武裝之前不能再跳，所以張力相關的視覺先暗下去，充飽了才回來
    const tn = this.tension * this.armv;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (this.r > 0.6) {
      if (this.active) this._drawThreshold(ctx, tn);
      if (this.active) this._drawNeck(ctx, tn);
      this._drawBody(ctx, tn);
    }
    this._drawDrops(ctx);
    if (this.active) {
      this._drawOrigin(ctx);
      this._drawFinger(ctx, tn);
    }
    if (!this.everTouched && this.hintT > 0 && this.isEnabled()) this._drawHint(ctx, W, H);

    ctx.restore();
  }

  // 跳躍門檻。只畫上半圈——下半圈本來就跳不出去，畫整圈是騙人的。
  // 張力起來才淡入，平常不擋畫面。
  _drawThreshold(ctx, tn) {
    const a = Math.max(0, (tn - 0.3) / 0.7);
    if (a <= 0) return;
    ctx.save();
    ctx.setLineDash([5, 9]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = tint(tn, 0.1 + 0.4 * a * a);
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.r, Math.PI, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // 起點 → 手指的液體頸：這條就是「落差」本身
  _drawNeck(ctx, tn) {
    const dx = this.fx - this.cx, dy = this.fy - this.cy;
    const L = Math.hypot(dx, dy);
    if (L < 4) return;
    const nx = -dy / L, ny = dx / L;
    const w0 = 5.5 + 3 * tn;   // 起點端
    const w1 = 1.8;            // 手指端
    const K = 16;
    const p = new Path2D();

    const at = (u) => {
      const w = w1 + (w0 - w1) * Math.pow(1 - u, 1.5);
      // 一點點晃動，讓它像液體而不是棍子
      const sag = Math.sin(Math.PI * u) * Math.sin(this.t * 6 + u * 4) * 1.6 * tn;
      return [this.cx + dx * u + nx * sag, this.cy + dy * u + ny * sag, w];
    };
    for (let i = 0; i <= K; i++) {
      const [x, y, w] = at(i / K);
      if (i === 0) p.moveTo(x + nx * w, y + ny * w);
      else p.lineTo(x + nx * w, y + ny * w);
    }
    for (let i = K; i >= 0; i--) {
      const [x, y, w] = at(i / K);
      p.lineTo(x - nx * w, y - ny * w);
    }
    p.closePath();

    const g = ctx.createLinearGradient(this.cx, this.cy, this.fx, this.fy);
    g.addColorStop(0, tint(tn, 0.34));
    g.addColorStop(1, tint(tn, 0.12));
    ctx.fillStyle = g;
    ctx.fill(p);
  }

  _drawBody(ctx, tn) {
    const cx = this.cx, cy = this.cy, r = this.r;
    const p = this._contour(cx, cy, this._shape());

    // 水的菲涅耳：中間淡、邊緣亮
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.34, r * 0.08, cx, cy, r * 1.05);
    g.addColorStop(0, 'rgba(255,255,255,0.26)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.82, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, tint(tn, 0.3));
    ctx.fillStyle = g;
    ctx.fill(p);

    // 高光
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
    ctx.shadowBlur = 10 + 16 * tn + 20 * this.flare;
    ctx.stroke(p);
    ctx.shadowBlur = 0;
  }

  _drawDrops(ctx) {
    for (const d of this.drops) {
      if (d.r < 0.35) continue;
      const vx = d.x - d.px, vy = d.y - d.py;
      const sp = Math.hypot(vx, vy);
      const st = Math.min(2, 1 + sp * 0.16);       // 沿行進方向拉長
      const rr = d.r * (1 + 0.16 * Math.sin(this.t * 22 + d.ph));
      const fade = Math.pow(1 - d.t, 0.5);

      ctx.save();
      ctx.translate(d.x, d.y);
      if (sp > 0.01) ctx.rotate(Math.atan2(vy, vx));
      ctx.scale(st, 1 / Math.sqrt(st));            // 拉長但保體積
      const g = ctx.createRadialGradient(-rr * 0.3, -rr * 0.3, 0, 0, 0, rr);
      g.addColorStop(0, `rgba(255,255,255,${0.72 * fade})`);
      g.addColorStop(0.7, `rgba(255,255,255,${0.34 * fade})`);
      g.addColorStop(1, `rgba(236,250,196,${0.5 * fade})`);
      ctx.fillStyle = g;
      ctx.shadowColor = `rgba(196,240,140,${0.5 * fade})`;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawOrigin(ctx) {
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, 7, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, 3, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
  }

  // 手指環 + 張力弧：弧畫滿一圈就是跳
  _drawFinger(ctx, tn) {
    const fr = 15 + 5 * tn;
    ctx.beginPath();
    ctx.arc(this.fx, this.fy, fr, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (tn > 0.02) {
      ctx.beginPath();
      ctx.arc(this.fx, this.fy, fr, -Math.PI / 2, -Math.PI / 2 + tn * TAU);
      ctx.strokeStyle = tint(tn, 0.9);
      ctx.lineWidth = 2.6;
      ctx.shadowColor = tint(tn, 0.7);
      ctx.shadowBlur = tn > 0.85 ? 12 : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.beginPath();
    ctx.arc(this.fx, this.fy, 2.4, 0, TAU);
    ctx.fillStyle = tint(tn, 0.6);
    ctx.fill();
  }

  _drawHint(ctx, W, H) {
    const a = Math.min(1, this.hintT / 1.5) * 0.75;
    ctx.font = '500 13px system-ui, -apple-system, "Noto Sans TC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(247,239,221,${a})`;
    ctx.fillText('按住畫面左右拖曳移動 · 手指甩出水球即跳躍', W / 2, H - 34);
  }
}
