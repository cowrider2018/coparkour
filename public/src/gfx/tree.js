// ── 平台上的樹 ─────────────────────────────────────────────
// 跟 decor.js 同一套規矩：由座標雜湊決定，所以無狀態、多人一致、可往回看。
// 樹比草大兩個數量級，所以有三件事要跟草不一樣：
//
//   骨架是長出來的      末梢在哪，葉團就在哪。另外撒一團葉子在樹的外框裡，
//                       遠看很像，一走近就會看到葉子浮在沒有枝的空中。
//   風只讀慢項          field.js 把風拆成兩道波就是為了這一刻：快項波長 4.1
//                       比樹幹本身還細，樹幹讀了只會發抖。葉團才加快項。
//   不用 edgeFade       草進出視野時縮小沒人看得出來，一棵樹忽然矮一截很明顯。
//                       改成把採集範圍往兩側推 MARGIN，樹在畫面外就已經是完整的。
import { makeCell, slowGust, gust } from './field.js';
import { css, shade, mix3 } from './daycycle.js';
import { seasonPick } from './season.js';

const TREE_CELL = 168;       // 一格一棵候選
const MARGIN = 300;          // 採集範圍往兩側推多遠（樹在畫面外就長好）
const MIN_PLAT_W = 150;      // 太窄的板子不長樹；牆只有 26 寬，自然被這條排除
const MAX_TREES = 12;
const MAX_SEGS = 760;        // Canvas 2D 是 O(數量)，一定要有硬上限
const MAX_TUFTS = 760;
const SEG_RESERVE = 70;      // 開始長之前先確認額度夠——寧可少一棵，不要半棵
const TUFT_RESERVE = 70;

const BARK_LIT = [0.185, 0.155, 0.125];

// ── 季節帶 ──────────────────────────────────────────────────
// 分界與過渡帶由 gfx/season.js 統一決定，草、土、遠山、樹讀的是同一條線——
// 不然會出現「草已經黃了但樹還全綠」那種各換各的分界。
//
// 過渡帶上樹跟草用同一個規則：每棵樹自己抽籤選邊（seasonPick），
// 不是把兩季的樹混成一種中間色的樹。走進交界處會先看到零星幾棵已經轉紅的，
// 再往前紅的愈來愈多——那是密度在漸變，不是顏色在漸變。
//
// kinds 是這一季能長的物種，cut 是雜湊落點的上界（照順序取第一個小於的）
const SEASON_KINDS = [
  { kinds: [0, 1], cut: [0.625, 1] },   // 綠：闊葉 + 針葉
  { kinds: [2],    cut: [1] },          // 秋：只有闊葉，暖色
  { kinds: [3, 4], cut: [0.55, 1] },    // 冬：積雪的針葉，或落光了的枯枝
];

// 五個物種。同一份骨架程式，差別只在參數：
// leader 決定有沒有主幹（針葉樹有、闊葉樹沒有），droop 決定側枝往上還是往下。
const SPECIES = [
  { // 0 闊葉：沒有主幹，開成一頂傘
    hMin: 106, hVar: 74, leanK: 0.30,
    trunk: 0.30, wid: 0.052, depth: 4, lenK: 0.76, widK: 0.66,
    spread: 0.62, leader: 0.20, droop: 0.00, extra: 0.25,
    tuftN: 2, tuftR: 12.0, tuftFlat: 0.85, tuftSpread: 0.44,
    bark: [0.055, 0.042, 0.032],
    leaf: [[0.045, 0.135, 0.040], [0.085, 0.235, 0.062], [0.145, 0.335, 0.085]],
  },
  { // 1 針葉：一根主幹到頂，側枝短而下垂
    hMin: 130, hVar: 88, leanK: 0.14,
    trunk: 0.26, wid: 0.045, depth: 5, lenK: 0.70, widK: 0.62,
    spread: 0.45, leader: 0.85, droop: 0.62, extra: 0.20,
    tuftN: 2, tuftR: 8.4, tuftFlat: 0.52, tuftSpread: 0.52,
    bark: [0.045, 0.036, 0.032],
    leaf: [[0.022, 0.078, 0.055], [0.040, 0.130, 0.080], [0.068, 0.190, 0.100]],
  },
  { // 2 秋：闊葉，暖色
    hMin: 96, hVar: 62, leanK: 0.38,
    trunk: 0.28, wid: 0.048, depth: 4, lenK: 0.74, widK: 0.64,
    spread: 0.74, leader: 0.12, droop: -0.06, extra: 0.35,
    tuftN: 2, tuftR: 10.6, tuftFlat: 0.80, tuftSpread: 0.50,
    bark: [0.062, 0.046, 0.040],
    leaf: [[0.230, 0.075, 0.045], [0.400, 0.150, 0.055], [0.560, 0.290, 0.070]],
  },
  { // 3 冬・針葉：骨架跟 1 一樣，葉團少一半、色階由暗綠壓到白
    //   色階本來就是照高度分的（高的亮），所以雪自然堆在朝天的那一面
    hMin: 130, hVar: 88, leanK: 0.14,
    trunk: 0.26, wid: 0.045, depth: 5, lenK: 0.70, widK: 0.62,
    spread: 0.45, leader: 0.85, droop: 0.62, extra: 0.20,
    tuftN: 1, tuftR: 8.8, tuftFlat: 0.50, tuftSpread: 0.52,
    bark: [0.070, 0.064, 0.062],
    leaf: [[0.030, 0.075, 0.062], [0.300, 0.340, 0.390], [0.690, 0.730, 0.800]],
  },
  { // 4 冬・枯枝：闊葉的骨架，葉子掉光了，只剩壓在枝上的雪
    //   tuftFlat 壓扁成 0.42：雪是躺在枝上的一條，不是掛在枝上的一球
    hMin: 100, hVar: 68, leanK: 0.32,
    trunk: 0.30, wid: 0.050, depth: 4, lenK: 0.76, widK: 0.66,
    spread: 0.66, leader: 0.18, droop: 0.00, extra: 0.25,
    tuftN: 1, tuftR: 4.6, tuftFlat: 0.42, tuftSpread: 0.34,
    bark: [0.078, 0.072, 0.072],
    leaf: [[0.130, 0.150, 0.190], [0.430, 0.460, 0.510], [0.780, 0.810, 0.870]],
  },
];

export class Trees {
  constructor(roomSeed) {
    this.cell = makeCell(roomSeed);
    this.segs = [];      // 重複使用，不在迴圈裡配置記憶體
    this.tufts = [];
    this._stack = [];    // 展開骨架用的堆疊，同樣重複使用
    this.ns = 0;
    this.nt = 0;
    this.n = 0;
    this.mask = 0;
    this.density = 1;
  }

  /**
   * 掃過可見範圍內的平台，把這一幀要畫的枝幹與葉團長出來。
   * 風在這裡就套進座標（骨架與擺動是同一次計算），所以 draw() 只剩幾何。
   * @param {object} level
   * @param {number} x0 視窗左緣（世界座標）
   * @param {number} x1 視窗右緣
   * @param {number} t  秒
   * @param {number} wind 0..1
   */
  collect(level, x0, x1, t, wind) {
    const C = this.cell;
    const W = wind === undefined ? 0.55 : wind;
    this.ns = 0;
    this.nt = 0;
    this.mask = 0;          // 這一幀出現了哪些物種，draw() 用它跳過空的色階
    let n = 0;
    const lo = x0 - MARGIN, hi = x1 + MARGIN;

    level.forEachPlatform(lo, hi, (p) => {
      if (n >= MAX_TREES) return;
      if (p.w < MIN_PLAT_W) return;
      const top = p.y;
      const iz = Math.round(top / 17);          // 高度也進雜湊，不同層長得不一樣
      const from = Math.floor(Math.max(p.x, lo) / TREE_CELL);
      const to = Math.floor(Math.min(p.x + p.w, hi) / TREE_CELL);

      for (let ix = from; ix <= to && n < MAX_TREES; ix++) {
        if (C(ix, iz, 300) > 0.40 * this.density) continue;
        const x = ix * TREE_CELL + (0.16 + C(ix, iz, 301) * 0.68) * TREE_CELL;
        if (x < p.x + 34 || x > p.x + p.w - 34) continue;
        if (x < lo || x > hi) continue;
        if (this.ns + SEG_RESERVE > MAX_SEGS) return;
        if (this.nt + TUFT_RESERVE > MAX_TUFTS) return;
        this.grow(ix, iz, x, top, t, W);
        n++;
      }
    });

    this.n = n;
    this.t = t;
  }

  /**
   * 一棵樹：深度優先展開骨架，末梢掛葉團。
   * 每個節點的亂數 salt 從 k 推出來（k = 父 k×4 + 子序號），
   * 所以同一棵樹每幀長得一模一樣，而且不必存任何東西。
   */
  grow(ix, iz, x, top, t, W) {
    const C = this.cell;
    const S = SEASON_KINDS[seasonPick(x, C(ix, iz, 301))];
    const r = C(ix, iz, 302);
    let si = S.kinds[0];
    for (let i = 0; i < S.kinds.length; i++) {
      if (r < S.cut[i]) { si = S.kinds[i]; break; }
    }
    this.mask |= 1 << si;
    const sp = SPECIES[si];
    const H = sp.hMin + C(ix, iz, 303) * sp.hVar;
    const tr = {
      x, top, H,
      lean: (C(ix, iz, 304) - 0.5) * sp.leanK,
      susc: 0.72 + C(ix, iz, 305) * 0.6,        // 受風程度
      phase: C(ix, iz, 306) * 97,
    };

    const st = this._stack;
    let n = 0;
    const root = st[n] || (st[n] = {});
    root.x = x; root.y = top; root.a = tr.lean;
    root.len = H * sp.trunk; root.w = H * sp.wid; root.d = 0; root.k = 1;
    n++;

    while (n > 0) {
      n--;
      // 先抄成純量：等一下要把小孩推回同一個位置
      const cur = st[n];
      const cx = cur.x, cy = cur.y, ca = cur.a, cl = cur.len, cw = cur.w, cd = cur.d, ck = cur.k;
      const tipX = cx + Math.sin(ca) * cl;
      const tipY = cy - Math.cos(ca) * cl;
      const w1 = cw * sp.widK;

      if (this.ns < MAX_SEGS) {
        const g = this.segs[this.ns] || (this.segs[this.ns] = {});
        g.x0 = cx + sway(tr, up(top, cy, H), t, W);
        g.y0 = cy;
        g.x1 = tipX + sway(tr, up(top, tipY, H), t, W);
        g.y1 = tipY;
        g.w0 = cw * (cd === 0 ? 1.4 : 1);       // 根部外擴一點，樹才站得住
        g.w1 = w1;
        g.si = si;
        g.thin = cd >= 2 ? 1 : 0;
        this.ns++;
      }

      if (cd >= sp.depth || cl < 7) {
        // ── 樹冠 ──
        // 葉團長在末梢，位置從枝長推出來，所以樹冠的外形是骨架的結果，不是另外畫的形狀
        for (let i = 0; i < sp.tuftN && this.nt < MAX_TUFTS; i++) {
          const s = 500 + ck * 6 + i * 2;
          const rad = sp.tuftR * (H / 150) * (0.62 + C(ix, iz, s) * 0.85);
          const px = tipX + (C(ix, iz, s + 1) - 0.5) * cl * sp.tuftSpread * 2;
          const py = tipY + (C(ix, iz, 1700 + ck * 3 + i) - 0.5) * cl * sp.tuftSpread * 1.4;
          const u = up(top, py, H);
          // 葉子才讀快項：同一棵樹的葉團各自抖，但整棵樹一起彎
          const flut = (gust(px + tr.phase, t) - 0.5) * 2 * W * 3.6 * u;
          const f = this.tufts[this.nt] || (this.tufts[this.nt] = {});
          f.x = px + sway(tr, u, t, W) + flut;
          f.y = py;
          f.rx = rad;
          f.ry = rad * sp.tuftFlat;
          f.rot = ca * 0.6;
          f.si = si;
          // 高的、外圍的比較亮。這是體積，不是逐團抖色——逐團抖色讀起來只會像雜訊
          f.band = Math.max(0, Math.min(2, (u * 1.7 + C(ix, iz, s + 1) * 1.2) | 0));
          this.nt++;
        }
        continue;
      }

      // ── 分枝 ──
      const nb = 2 + (C(ix, iz, 900 + ck) < sp.extra ? 1 : 0);
      for (let i = 0; i < nb && n < 48; i++) {
        const s = 1100 + ck * 7 + i * 2;
        const jit = C(ix, iz, s) - 0.5;
        const side = i === 0 ? 0 : (i & 1 ? 1 : -1);
        let a, len;
        if (i === 0) {
          // 續行的那一枝。leader 高（針葉）就把角度拉回垂直，低（闊葉）就跟著父枝跑掉
          a = ca * (1 - sp.leader * 0.55) + jit * sp.spread * 0.5;
          len = cl * (sp.lenK + sp.leader * 0.16);
        } else {
          a = ca * 0.35 + side * (sp.spread * (0.7 + C(ix, iz, s + 1) * 0.7) + sp.droop) + jit * 0.2;
          len = cl * sp.lenK * (0.8 + C(ix, iz, s + 1) * 0.34);
        }
        const c = st[n] || (st[n] = {});
        c.x = tipX; c.y = tipY; c.a = a; c.len = len; c.w = w1;
        c.d = cd + 1; c.k = ck * 4 + i + 1;
        n++;
      }
    }
  }

  /**
   * 一次畫完。跟 decor 一樣批次成少數幾個 path——
   * 枝幹每個物種兩階、葉團每個物種三階，而一個畫面通常只有一季的兩個物種，
   * 也就是十次 fill 上下，跟樹的數量無關。
   */
  draw(ctx, sky) {
    if (!this.ns) return;

    // 枝幹：粗的一階、細的一階。細枝在樹冠裡接到的天光多一點
    for (let si = 0; si < SPECIES.length; si++) {
      if (!(this.mask & (1 << si))) continue;     // 一個畫面通常只有一季，其他四種連掃都不用掃
      for (let thin = 0; thin < 2; thin++) {
        const col = mix3(SPECIES[si].bark, BARK_LIT, thin ? 0.45 : 0.08);
        ctx.fillStyle = css(shade(col, sky, 0.5 + thin * 0.22, 1.5));
        ctx.beginPath();
        let drawn = false;
        for (let i = 0; i < this.ns; i++) {
          const g = this.segs[i];
          if (g.si !== si || g.thin !== thin) continue;
          limb(ctx, g);
          drawn = true;
        }
        if (drawn) ctx.fill();
      }
    }

    // 葉團：暗的先畫、亮的疊上去，樹冠就有了正面與背面
    for (let si = 0; si < SPECIES.length; si++) {
      if (!(this.mask & (1 << si))) continue;
      for (let band = 0; band < 3; band++) {
        ctx.fillStyle = css(shade(SPECIES[si].leaf[band], sky, 0.42 + band * 0.30, 1.0));
        ctx.beginPath();
        let drawn = false;
        for (let i = 0; i < this.nt; i++) {
          const f = this.tufts[i];
          if (f.si !== si || f.band !== band) continue;
          ctx.moveTo(f.x + f.rx * Math.cos(f.rot), f.y + f.rx * Math.sin(f.rot));
          ctx.ellipse(f.x, f.y, f.rx, f.ry, f.rot, 0, 6.2832);
          drawn = true;
        }
        if (drawn) ctx.fill();
      }
    }
  }
}

/** 這個點在樹上的高度比例，0 = 根、1 = 樹頂。 */
function up(top, y, H) {
  const u = (top - y) / H;
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

/**
 * 風把這個高度往旁邊推多少。
 * u² 是懸臂樑的彎曲形狀——根部不動、往上愈彎，跟草「繞根部旋轉」是同一件事，
 * 差別只在樹夠高，一次線性的剪切就會被看出來。
 * 相位隨高度延遲：樹梢比根部慢半拍，那個時間差就是整棵樹的鞭子感。
 */
function sway(tr, u, t, W) {
  return slowGust(tr.x, t - u * 0.16) * W * tr.susc * tr.H * 0.15 * u * u;
}

/** 一段枝：往兩側各推半個寬度的錐形四邊形。 */
function limb(ctx, g) {
  const dx = g.x1 - g.x0, dy = g.y1 - g.y0;
  const L = Math.sqrt(dx * dx + dy * dy) || 1e-6;
  const px = -dy / L, py = dx / L;
  const a0 = Math.max(0.4, g.w0 * 0.5);
  const a1 = Math.max(0.35, g.w1 * 0.5);
  ctx.moveTo(g.x0 + px * a0, g.y0 + py * a0);
  ctx.lineTo(g.x1 + px * a1, g.y1 + py * a1);
  ctx.lineTo(g.x1 - px * a1, g.y1 - py * a1);
  ctx.lineTo(g.x0 - px * a0, g.y0 - py * a0);
  ctx.closePath();
}
