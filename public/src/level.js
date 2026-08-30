// ── 無限地形生成器 ────────────────────────────────────
// 完全由 seed 決定。所有玩家用同一個 seed 從 0 開始生成，
// 因此不需要伺服器同步任何地形資料，畫面上的世界一定一模一樣。
import { mulberry32 } from './rng.js';
import { PHYS, WORLD, JUMP_HEIGHT } from './constants.js';

const SLAB_H = 26;
const SPIKE_H = 18;
export const COIN_R = 9;

// 從高度差 rise（正=往上跳）算出「單次跳躍」最遠能跨過的水平距離。
// 用彈道公式解，確保生成出來的關卡一定跳得過去。
export function maxGapForRise(rise) {
  const J = PHYS.jumpVel;
  const g = PHYS.gravity;
  const disc = J * J - 2 * g * rise;
  if (disc < 0) return 0; // 這個高度單跳上不去
  const tTop = (J + Math.sqrt(disc)) / g; // 最後仍在 landing 高度以上的時刻
  return PHYS.runSpeed * tTop;
}

export class Level {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rand = mulberry32(this.seed);
    this.platforms = []; // {x,y,w,h}  y = 頂面
    this.spikes = [];    // {x,y,w,h}
    this.coins = [];     // {x,y,taken}
    this.jumps = [];     // 每一次「跨越」的紀錄，給 tools/verify-level.mjs 檢查用
    this.maxPlatW = 0;
    this.generatedTo = 0;

    // 起跑安全區
    this.addPlatform(-500, WORLD.startY, 1100, SLAB_H + 260);
    this.cursorX = 600;
    this.cursorY = WORLD.startY;
    this.ensure(WORLD.chunkAhead);
  }

  addPlatform(x, y, w, h) {
    const p = { x, y, w, h: h || SLAB_H };
    this.platforms.push(p);
    if (w > this.maxPlatW) this.maxPlatW = w;
    return p;
  }

  ensure(x) {
    let guard = 0;
    while (this.cursorX < x && guard++ < 4000) this.step();
    this.generatedTo = this.cursorX;
  }

  // ── 產生下一段 ──────────────────────────────────────
  step() {
    const r = this.rand;
    const diff = Math.min(1, this.cursorX / 16000); // 難度隨距離爬升
    const roll = r();

    if (roll < 0.26) this.pFlat(diff);
    else if (roll < 0.42) this.pStairs(diff);
    else if (roll < 0.56) this.pPillars(diff);
    else if (roll < 0.68) this.pBigGap(diff);
    else if (roll < 0.80) this.pSpikeRun(diff);
    else if (roll < 0.90) this.pHighRoad(diff);
    else this.pWall(diff);
  }

  // 放一塊平台：gapWant = 想要的空隙，dy = 相對上一塊的高度變化（負=往上）
  // 會自動夾到「保證跳得過去」的範圍內。
  place(gapWant, dy, w, tightness = 0.72) {
    const targetY = clamp(this.cursorY + dy, WORLD.yMin, WORLD.yMax);
    const rise = this.cursorY - targetY; // 正 = 要往上跳
    const limit = maxGapForRise(Math.max(0, rise)) * tightness;
    const gap = clamp(gapWant, 40, Math.max(40, limit));
    const x = this.cursorX + gap;
    const p = this.addPlatform(x, targetY, w, SLAB_H);
    this.jumps.push({ fromX: this.cursorX, fromY: this.cursorY, toX: x, toY: targetY, gap, rise });
    this.cursorX = x + w;
    this.cursorY = targetY;
    return p;
  }

  // 一般平地 + 小起伏
  pFlat(d) {
    const r = this.rand;
    const w = 220 + r() * 300;
    const dy = (r() - 0.5) * (90 + 90 * d);
    const gap = 90 + r() * (110 + 90 * d);
    const p = this.place(gap, dy, w);
    this.maybeCoins(p, 0.5);
  }

  // 階梯（連續上升或下降的小平台）
  pStairs(d) {
    const r = this.rand;
    const up = r() < 0.55;
    const n = 3 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const w = 90 + r() * 60;
      const dy = up ? -(60 + r() * 55) : 55 + r() * 70;
      const gap = 80 + r() * 70;
      const p = this.place(gap, dy, w);
      if (i === n - 1) this.maybeCoins(p, 0.7);
    }
  }

  // 連續小柱子，要精準連跳
  pPillars(d) {
    const r = this.rand;
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const w = 62 + r() * 40 - 18 * d;
      const dy = (r() - 0.5) * 110;
      const gap = 120 + r() * (70 + 70 * d);
      const p = this.place(gap, dy, Math.max(52, w), 0.8);
      if (r() < 0.45) this.coinAt(p.x + p.w / 2, p.y - 46);
    }
  }

  // 大斷崖：單跳勉強、二段跳輕鬆
  pBigGap(d) {
    const r = this.rand;
    const prevY = this.cursorY;
    const dy = (r() - 0.6) * 80;
    const gap = 230 + r() * (60 + 60 * d);
    const p = this.place(gap, dy, 260 + r() * 180, 0.92);
    // 空中金幣做誘導（沿著跳躍拋物線擺）
    const from = p.x - gap;
    const realGap = p.x - from;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const baseY = prevY + (p.y - prevY) * t;
      this.coinAt(from + realGap * t, baseY - 60 - Math.sin(t * Math.PI) * 55);
    }
  }

  // 長平台 + 地刺。
  // 規則：平台頭留 90px 讓你落地站穩、尾留 140px 讓你重新加速，
  // 每叢地刺之間至少隔 170px，保證「跳過一叢 → 落地 → 再跳下一叢」跑得完。
  pSpikeRun(d) {
    const r = this.rand;
    const w = 360 + r() * 260;
    const gap = 100 + r() * 110;
    const p = this.place(gap, (r() - 0.5) * 70, w);

    const left = p.x + 90;
    const right = p.x + p.w - 140;
    const room = right - left;
    if (room < 80) return;

    const wanted = 1 + Math.floor(r() * (1 + 2 * d));
    const n = Math.max(1, Math.min(wanted, Math.floor(room / 240)));
    const slot = room / n;

    for (let i = 0; i < n; i++) {
      const sw = 34 + r() * 36;
      const jitter = Math.max(0, slot - sw - 170) * r();
      const sx = left + i * slot + jitter;
      this.spikes.push({ x: sx, y: p.y - SPIKE_H, w: sw, h: SPIKE_H });
      this.coinAt(sx + sw / 2, p.y - 74);
    }
  }

  // 高空路線
  pHighRoad(d) {
    const r = this.rand;
    const n = 2 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const dy = i === 0 ? -(90 + r() * 60) : (r() - 0.5) * 70;
      const p = this.place(110 + r() * 90, dy, 140 + r() * 120, 0.78);
      this.maybeCoins(p, 0.75);
    }
  }

  // 牆：可以直接跳過去，也可以蹬牆上去拿金幣。
  // 牆一定放在平台前段、而且不高，跳過去之後還有足夠的跑道重新起跳。
  pWall(d) {
    const r = this.rand;
    const p = this.place(100 + r() * 90, (r() - 0.5) * 60, 500 + r() * 200);
    const wallH = 70 + r() * 45;
    const wx = p.x + 110 + r() * 70;
    this.addPlatform(wx, p.y - wallH, 26, wallH);
    this.coinAt(wx + 13, p.y - wallH - 40);
  }

  maybeCoins(p, chance) {
    const r = this.rand;
    if (r() > chance) return;
    const n = 1 + Math.floor(r() * 3);
    const startX = p.x + 24 + r() * Math.max(0, p.w - 48 - n * 34);
    for (let i = 0; i < n; i++) this.coinAt(startX + i * 34, p.y - 42);
  }

  coinAt(x, y) {
    this.coins.push({ x, y: clamp(y, 30, WORLD.yMax + 120), taken: false });
  }

  // ── 查詢：回傳 [x0,x1] 範圍內的平台（二分搜尋，陣列本來就依 x 遞增）──
  rangeIndex(x0) {
    let lo = 0, hi = this.platforms.length;
    const target = x0 - this.maxPlatW;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.platforms[mid].x < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  forEachPlatform(x0, x1, fn) {
    for (let i = this.rangeIndex(x0); i < this.platforms.length; i++) {
      const p = this.platforms[i];
      if (p.x > x1) break;
      if (p.x + p.w >= x0) fn(p);
    }
  }

  forEachIn(arr, x0, x1, fn) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].x < x0 - 120) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < arr.length; i++) {
      if (arr[i].x > x1) break;
      fn(arr[i]);
    }
  }

  forEachSpike(x0, x1, fn) { this.forEachIn(this.spikes, x0, x1, fn); }
  forEachCoin(x0, x1, fn) { this.forEachIn(this.coins, x0, x1, fn); }
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export { SLAB_H, SPIKE_H, JUMP_HEIGHT };
