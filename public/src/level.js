// ── 無限地形生成器 ────────────────────────────────────
// 完全由 seed 決定。所有玩家用同一個 seed 從 0 開始生成，
// 因此不需要伺服器同步任何地形資料，畫面上的世界一定一模一樣。
import { mulberry32 } from './rng.js';
import { PHYS, WORLD, JUMP_HEIGHT, PLAYER_W, PLAYER_H } from './constants.js';

const SLAB_H = 26;
const SPIKE_H = 18;
export const COIN_R = 9;

// 蹬牆井的階距。wallJumpVY²/2g（≈152）是「貼著牆滑到最高點才蹬」能爬的物理上限，
// 實跑下來貼著上限排太苛刻——真正下腳的時機多半在滑落途中，不是最高點。
// 乘 0.65 取 ≈99，等於整段滑牆的時間窗都還構得到下一根柱子。
export const WALL_RISE = (PHYS.wallJumpVY * PHYS.wallJumpVY) / (2 * PHYS.gravity) * 0.65; // ≈99

// 柱子長度 ≈94，也就是「抓得到牆」的容錯窗口——落腳點在正中間，上下各 ≈47。
// 下限是 60：player.js 的 probeWall 只把高度 >= 60 的方塊當牆，比這矮就蹬不了。
export const SHAFT_PILLAR_H = (WALL_RISE * 0.95 - 27) * 0.7 * 2;
// 地板到「最低那根柱子底端」的距離。整排柱子跟著它一起上下移動，柱長和柱距都不動。
// 排得低的好處是往上爬的空間留得多；壞處是全力起跳會直接越過第一根的柱頂
//（柱頂只在地板上方 40+94=134，而全力跳的最高點是 JUMP_HEIGHT≈172），
// 所以第一下要收著跳，或是等落下來的時候再貼上牆。實跑下來 40 最順。
// 唯一的硬限制是 > 0：等於 0 就跟地板黏在一起，那道縫就不見了。
export const SHAFT_BOTTOM_GAP = 40;
// 第 i 根柱子的落腳點（＝柱子中心）相對井底的高度。柱距一律等於 WALL_RISE，
// 整排的位置由 SHAFT_BOTTOM_GAP 決定，不是由第一次跳躍的高度決定。
export const shaftCling = (i) => SHAFT_BOTTOM_GAP + SHAFT_PILLAR_H / 2 + WALL_RISE * i;
// 柱子根數。一定要偶數：出口在右邊，最後一次得從左柱蹬出去才會往右飛。
export const SHAFT_N = 4;
// 出口平台比「最高那根柱子的頂端」再高這麼多（≈34）。
// 從左柱蹬出去橫渡到右邊的那一瞬間大概爬了 100~130px，出口放太高就會撞在它的側面掉回井底。
export const SHAFT_LIFT = WALL_RISE * 0.34;
// 井底往上至少要留這麼多空間才排得下整排柱子。注意它只算到最高那根的「落腳點」，
// 沒把柱子上半截跟 SHAFT_LIFT 算進去，所以出口實際上還會再高 ≈80px——
// WORLD.yMin 本來就只是生成器的參考線，出口稍微高過它不影響任何判定。
export const SHAFT_CLIMB = shaftCling(SHAFT_N - 1) + SHAFT_LIFT;
export const SHAFT_DROP_MIN = 130; // 井底至少比入口再低這麼多
export const SHAFT_DROP_MAX = 420; // 掉太久會看不到自己要落在哪；step() 用它擋掉太高的入口

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

    if (roll < 0.20) this.pFlat(diff);
    else if (roll < 0.33) this.pStairs(diff);
    else if (roll < 0.44) this.pPillars(diff);
    else if (roll < 0.54) this.pBigGap(diff);
    else if (roll < 0.64) this.pSpikeRun(diff);
    else if (roll < 0.72) this.pHighRoad(diff);
    else if (roll < 0.79) this.pWall(diff);
    // 蹬牆井是從入口往下挖一段當井底，再往上疊固定四根柱子。
    // 入口太高的話井底得挖到很深才排得下，掉進去要掉很久——先用階梯把高度帶下來。
    else if (roll < 0.88) {
      if (this.cursorY >= WORLD.yMin + 20 + SHAFT_CLIMB - SHAFT_DROP_MAX) this.pWallShaft(diff);
      else this.pStairs(diff);
    }
    else if (roll < 0.94) this.pGate(diff);
    else this.pFork(diff);
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

  // ── 蹬牆井：左右交錯的細高石柱，一路蹬上去 ──────────────────
  // 起點是井底那塊地板，終點是右柱頂端的出口，中間的柱子左右交錯，
  // 每一根都是一次蹬牆。整口井都相對「入口高度」排：井底在入口下方一段，
  // 柱子從井底往上疊，出口再跟著最高那根柱子走。
  // 固定 SHAFT_N 根；整排柱子的位置由「地板 + SHAFT_BOTTOM_GAP」定錨。
  //
  // 地板跟柱子都不相連：右柱在地板右緣之外 G 遠，左柱懸在地板正上方 ≈139px。
  // 跑到地板邊緣沒跳起來就直接漏下去；地板接得住從右柱蹬歪往左掉的失誤，
  // 接不住從左柱蹬出去沒摸到右柱的——那個會往右飛出井外。
  //
  // 落腳點數必須是偶數：出口在右邊，最後一次一定要「從左柱蹬出去」才會往右飛。
  pWallShaft(d) {
    const r = this.rand;
    const BW = 18;                      // 柱子很細，比貓還窄，站不住，只能蹬
    const G = 96 + r() * (14 + 14 * d); // 兩根柱子的內側間距，也就是每次橫渡的距離；越寬越難

    const H = SHAFT_PILLAR_H;

    // 井底＝入口高度再往下挖一段，整口井跟著地形浮動；
    // 但至少要挖到「四根柱子加出口都排得下」的深度，不然頂端會捅出世界外面。
    const gap = 110 + r() * 60;
    const floorW = 300 + r() * 160;
    const baseY = Math.max(
      this.cursorY + SHAFT_DROP_MIN + r() * 80,
      WORLD.yMin + 20 + SHAFT_CLIMB,
    );
    const floor = this.addPlatform(this.cursorX + gap, baseY, floorW, SLAB_H + 30);
    this.jumps.push({
      fromX: this.cursorX, fromY: this.cursorY, toX: floor.x, toY: baseY,
      gap, rise: this.cursorY - baseY,
    });

    // 整排柱子相對井底往上排：最低那根的底端剛好離地板 SHAFT_BOTTOM_GAP，
    // 之後每一根往上一個 WALL_RISE。柱長全部一樣，柱距全部一樣。
    const clingY = [];
    for (let i = 0; i < SHAFT_N; i++) clingY.push(baseY - shaftCling(i));

    // 地板右緣切齊「左柱的牆面」：起跳的第一段橫渡距離就等於 G，跟之後每一次蹬牆一樣寬。
    // 地板往右多鋪一點就會縮短這一段，變成低空擦過第一根柱子底下飛出井外。
    const XL = floor.x + floor.w - BW;
    const XR = XL + BW + G;

    // 柱子以自己的落腳點為中心，上下各留 H/2。先放完左柱才放右柱——
    // platforms 必須依 x 遞增，前端的二分搜尋靠這個。
    for (let i = 1; i < SHAFT_N; i += 2) this.addPlatform(XL, clingY[i] - H / 2, BW, H);
    for (let i = 0; i < SHAFT_N; i += 2) this.addPlatform(XR, clingY[i] - H / 2, BW, H);

    // 出口跟著最高那根柱子走（它一定在左柱，因為 SHAFT_N 是偶數）。
    const topPillarY = clingY[SHAFT_N - 1] - H / 2; // 最高那根柱子的頂端
    const exitY = topPillarY - SHAFT_LIFT;          // 再高 SHAFT_LIFT

    const exit = this.addPlatform(XR, exitY, 260 + r() * 150, SLAB_H);

    // 金幣掛在井的正中央：每一次橫渡都會掃過去，順便把路線畫給玩家看
    const midX = XL + BW + G / 2;
    for (const y of clingY) this.coinAt(midX, y - 20);

    this.jumps.push({
      fromX: XR, fromY: baseY, toX: exit.x, toY: exit.y,
      gap: G, rise: baseY - exitY, kind: 'wall',
    });
    this.cursorX = exit.x + exit.w;
    this.cursorY = exit.y;

    // 爬完給一段下坡緩衝：喘口氣，順便把高度帶回中段，
    // 不然後面每一塊平台都被 clamp 擠在 WORLD.yMin 附近。
    this.place(110 + r() * 70, 150 + r() * 90, 260 + r() * 140);
  }

  // 一塊「包住某個落腳點」的牆：上下各留 pad 的餘裕，
  // 這樣玩家抓得高一點低一點都還有牆可以蹬。
  wallSlab(x, w, clingY, pad) {
    return this.addPlatform(x, clingY - pad, w, pad * 2);
  }

  // ── 閘門柱：一根翻不過去的高柱擋在斷崖中央 ──────────────────
  // 兩岸的距離刻意落在「單跳過不去、二段跳勉強夠」之間，所以柱子是唯一的中繼點；
  // 柱頂又高過二段跳的極限，直接飛過去一定撞牆。
  // 只能貼著左面往上蹬、翻到柱子另一側，再從右面蹬一次牆彈到對岸。
  pGate(d) {
    const r = this.rand;
    // 先把兩岸壓低一點，柱頂才留得在畫面裡——看不到頂端的話玩家不會想到要爬。
    const baseY = clamp(this.cursorY, WORLD.yMin + 300, WORLD.yMax);
    const a = this.place(100 + r() * 80, baseY - this.cursorY, 250 + r() * 130);

    const PW = 30;
    const gap1 = 190 + r() * 40;
    const gap2 = 210 + r() * (40 + 50 * d);
    // gap1 + PW + gap2 ≈ 430..570：JUMP_RANGE(≈320) 過不去，二段跳(≈610)才勉強夠——
    // 但柱高超過二段跳的高度上限，所以「勉強夠」那條路其實會撞在柱子上。
    const px = a.x + a.w + gap1;
    const pillarH = 380 + r() * 40;
    this.addPlatform(px, baseY - pillarH, PW, pillarH + 80); // 往下多長 80，鑽不過去

    const bY = clamp(baseY + (r() - 0.3) * 80, WORLD.yMin, WORLD.yMax);
    const b = this.addPlatform(px + PW + gap2, bY, 300 + r() * 160, SLAB_H);

    this.coinAt(px + PW / 2, baseY - pillarH - 44);            // 爬到柱頂的獎勵
    for (let i = 1; i <= 3; i++) {                              // 從右面蹬出去的弧線
      const t = i / 4;
      this.coinAt(px + PW + gap2 * t, baseY - pillarH * 0.55 - Math.sin(t * Math.PI) * 60);
    }

    this.jumps.push({
      fromX: a.x + a.w, fromY: baseY, toX: b.x, toY: bY,
      gap: gap1 + PW + gap2, rise: baseY - bY, kind: 'wall',
    });
    this.cursorX = b.x + b.w;
    this.cursorY = bY;
  }

  // ── 分岔路：上下兩條路平行往前，玩家自己選 ────────────────────
  // 高路平坦、沒有陷阱，但一路上沒東西撿；低路有地刺，金幣全埋在地刺旁邊。
  // 風險跟報酬一定要放在同一條路上才算選擇——所以高路只給安全，低路才給錢。
  pFork(d) {
    const r = this.rand;
    // 兩條路要差 270px 以上，低路的人跳起來才不會撞到高路的底面
    const baseY = clamp(this.cursorY, WORLD.yMin + 210, WORLD.yMax - 130);
    const split = this.place(100 + r() * 70, baseY - this.cursorY, 210 + r() * 90);
    const lowY = split.y + 120;
    const highY = split.y - 150;
    const startX = split.x + split.w;

    const parts = [];   // 兩條路的 x 會交錯，先收集、排序，再一次放進 platforms
    const spikes = [];
    const coins = [];

    // 低路：兩段長平台夾一個斷崖，平台上灑地刺，金幣壓在地刺旁邊
    let x = startX + 110;
    let prevX = startX, prevY = split.y, prevGap = 110;
    let lowEnd = x;
    for (let i = 0; i < 2; i++) {
      const w = 280 + r() * 140;
      parts.push({ x, y: lowY, w, h: SLAB_H });
      this.jumps.push({ fromX: prevX, fromY: prevY, toX: x, toY: lowY, gap: prevGap, rise: prevY - lowY });
      // 頭留 90px 落地站穩、尾留 120px 重新加速，跟 pSpikeRun 同一套規則
      const room = w - 210;
      const n = Math.max(1, Math.min(1 + Math.floor(r() * (1 + d)), Math.floor(room / 200)));
      const slot = room / n;
      for (let k = 0; k < n; k++) {
        const sw = 34 + r() * 30;
        const sx = x + 90 + slot * k + Math.max(0, slot - sw - 160) * r();
        spikes.push({ x: sx, y: lowY - SPIKE_H, w: sw, h: SPIKE_H });
        coins.push({ x: sx + sw / 2, y: lowY - 74 });
        coins.push({ x: sx + sw / 2 + 40, y: lowY - 46 });
      }
      // 低路的報酬：除了地刺旁邊那幾枚，尾段再灑一排，讓「錢在下面」一眼看得出來
      for (let c = 0; c < 3; c++) coins.push({ x: x + w - 150 + c * 38, y: lowY - 44 });
      lowEnd = x + w;
      prevX = lowEnd; prevY = lowY; prevGap = 130 + r() * 90;
      x = lowEnd + prevGap;
    }

    // 匯流平台：低路的人跳過來，高路的人走到底直接掉下來
    const mergeX = lowEnd + 150;
    const mergeY = split.y + 60;
    this.jumps.push({ fromX: lowEnd, fromY: lowY, toX: mergeX, toY: mergeY, gap: 150, rise: lowY - mergeY });

    // 高路：一整條平的，只有進出口要抓準。右緣切齊匯流平台的左緣，走到底就落地。
    const highX = startX + 170; // rise 150 → maxGapForRise(150) ≈ 217，這個距離跳得到
    parts.push({ x: highX, y: highY, w: mergeX - highX, h: SLAB_H });
    this.jumps.push({ fromX: startX, fromY: split.y, toX: highX, toY: highY, gap: 170, rise: split.y - highY });
    coins.push({ x: highX + 60, y: highY - 40 });

    parts.push({ x: mergeX, y: mergeY, w: 300 + r() * 160, h: SLAB_H });

    parts.sort((p1, p2) => p1.x - p2.x);
    for (const p of parts) this.addPlatform(p.x, p.y, p.w, p.h);
    spikes.sort((s1, s2) => s1.x - s2.x);
    for (const s of spikes) this.spikes.push(s);
    coins.sort((c1, c2) => c1.x - c2.x);
    for (const c of coins) this.coinAt(c.x, c.y);

    const last = parts[parts.length - 1];
    this.cursorX = last.x + last.w;
    this.cursorY = mergeY;
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

  // 以玩家為中心，左右各取最近的 n 個落腳點，回傳它們相對 refY 的高度差（由近到遠）。
  // 動態視距靠這張清單決定要拉多遠：越近的落腳點容差越小，最近的那個必須完全看見。
  //
  // 落腳點有兩種。站得住的板子取頂面；細高柱取「側面的頂端與底部」——
  // 蹬牆的時候腳踩的就是那條側面，上下兩端就是這面牆給得起的落點極限。
  // 牆的判定跟 player.js 的 probeWall 對齊（h >= 60），再加上一個 w <= 40：
  // 寬板子的側面雖然物理上也蹬得到，但那一側可能在 1000px 外，框它沒有意義。
  //
  // 排序用的是實際距離（含高度），不是單純的水平距離：蹬牆井裡左右柱的 x 幾乎一樣，
  // 只比水平距離的話整排柱子會並列，分不出哪一根才是手邊那一根。
  footholdsAround(box, refY, n, span) {
    const px = box.x + PLAYER_W / 2, py = box.y + PLAYER_H / 2;
    const dsL = [], dyL = [], dsR = [], dyR = [];
    const push = (ds, dys, d2, dy) => {
      let i = ds.length;
      while (i > 0 && ds[i - 1] > d2) i--;
      if (i >= n) return;
      ds.splice(i, 0, d2); dys.splice(i, 0, dy);
      if (ds.length > n) { ds.pop(); dys.pop(); }
    };
    this.forEachPlatform(px - span, px + span, (p) => {
      // 正踩著／正貼著的那一塊不算：它的落差是 0，只會白白佔掉一個名額
      if (box.x + PLAYER_W > p.x - 3 && box.x < p.x + p.w + 3 &&
          box.y + PLAYER_H > p.y - 3 && box.y < p.y + p.h + 3) return;
      const cx = px < p.x ? p.x : (px > p.x + p.w ? p.x + p.w : px);
      const left = cx < px || (cx === px && p.x + p.w / 2 < px);
      const ds = left ? dsL : dsR, dys = left ? dyL : dyR;
      const dx = cx - px;
      const add = (cy) => push(ds, dys, dx * dx + (cy - py) * (cy - py), cy - refY);
      if (p.h >= 60 && p.w <= 40) { add(p.y); add(p.y + p.h); }
      else if (p.w >= PLAYER_W) add(p.y);
    });
    return { left: dyL, right: dyR };
  }

  // 以 (cx,cy) 為中心，左右各取最近的 n 個「站得住的落腳點」，回傳座標（由近到遠）。
  // NPC 用它挑下一個目標點；動態視距用的是上面那個 footholdsAround。
  //
  // 兩者的取樣規則故意不一樣，不要合併：
  //   · 視距要框住「腳有可能碰到的地方」，所以細高柱取的是側面的上下兩端（蹬牆的落點）。
  //   · NPC 站得住才算數，所以這裡一律只取頂面——柱頂可以站，柱子的側面不行。
  // 目標的 x 取「平台頂面上離 cx 最近的那一點，再往內縮一點」：
  // 遠處的大平台就走到它靠近這一側的邊、細柱就是柱心，兩種都落得穩。
  standSpotsAround(cx, cy, n, span, exclude) {
    const L = [], R = [];
    const push = (arr, spot) => {
      let i = arr.length;
      while (i > 0 && arr[i - 1].d2 > spot.d2) i--;
      if (i >= n) return;
      arr.splice(i, 0, spot);
      if (arr.length > n) arr.pop();
    };
    this.forEachPlatform(cx - span, cx + span, (p) => {
      if (p === exclude) return;
      if (p.w < 12) return;                      // 站不住的細片（目前的生成器不會產生）
      const inset = Math.min(40, p.w / 2);
      const tx = clamp(cx, p.x + inset, p.x + p.w - inset);
      const dx = tx - cx, dy = p.y - cy;
      const spot = { x: tx, y: p.y, p, d2: dx * dx + dy * dy };
      if (dx === 0) { push(L, spot); push(R, spot); return; } // 正上／正下方：兩側都算
      push(dx < 0 ? L : R, spot);
    });
    return { left: L, right: R };
  }

  forEachSpike(x0, x1, fn) { this.forEachIn(this.spikes, x0, x1, fn); }
  forEachCoin(x0, x1, fn) { this.forEachIn(this.coins, x0, x1, fn); }
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export { SLAB_H, SPIKE_H, JUMP_HEIGHT };
