// ── 在地圖上遊蕩的 NPC ──────────────────────────────────
// 每 2000m 一隻，用的是 tools/verify-level.mjs 那顆機器人的腦（bot.js），
// 差別只有兩個：它不會二段跳，而且它有目的地。
//
// ── 為什麼位置是「時間的函數」而不是「一路模擬出來的」 ──────
// 多人要看到同一件事，但伺服器不跑物理（那會讓 Durable Object 永不休眠）。
// 所以把 NPC 的一生切成固定 6 秒的時槽：前 2 秒移動、後 4 秒待機。
//
//   · 第 k 槽的落腳點 = 純幾何函數 f(seed, 編號, k)，抽籤用的亂數也由這三個值決定。
//     這條鏈不含物理，重播一小時份只是幾萬次範圍查詢，所以任何時候加入的人
//     都能從錨點算到現在，答案跟老玩家一模一樣。
//   · 那 2 秒的移動才跑真物理（bot.js 開同一套 player.js）。就算兩台電腦
//     在這 2 秒差了幾 px，待機段會把位置收斂回落腳點，誤差不會累積。
//
// 所以網路上完全不需要傳 NPC 的座標，只需要一個共同的世界時鐘（伺服器發的 t0）。
//
// ── 鄰居規則為什麼看「無規則鏈」──────────────────────────
// 規格：1000m 內有另一隻 NPC 時，下一個目標必須在反方向。
// 如果 A 的鏈要看 B 的鏈、B 的鏈又要看 A 的鏈，就變成互相依賴的耦合系統，
// 晚加入的人得把所有 NPC 的歷史一起重播才算得出來。
// 所以 A 看的是 B 的「無規則鏈」（同一組亂數、只是不套這條規則）——
// 那是純函數 f(seed, 編號, k)，誰都能單獨算。規則本來就很少開火（家與家相距
// 2000m，要隨機漫步一兩個小時才可能靠近到 1000m），這個近似看不出差別。
import { PLAYER_W, PLAYER_H, PX_PER_M, JUMP_HEIGHT, PHYS } from './constants.js';
import { maxGapForRise } from './level.js';
import { Player } from './player.js';
import { makeBot, makeInput, act } from './bot.js';
import { mulberry32 } from './rng.js';

export const NPC = {
  spacingM: 2000,   // 每幾公尺一隻
  slot: 6,          // 一個時槽幾秒
  move: 2,          // 其中前幾秒在移動（剩下的都在待機）
  anchorSlots: 2000, // 鏈每隔幾槽回家歸零一次（≈3.3 小時）。見下面 anchorOf() 的說明
  catchup: 300,     // 每一幀最多幫鏈推進幾個時槽（見 Chain.advance 的說明）
  activePx: 3000,   // 離玩家這麼遠以外的不模擬也不畫
  trackPx: 15000,   // 這個範圍內的鏈要算，鄰居規則才看得到彼此
  span: 700,        // 找落腳點的搜尋半徑
  reach: 560,       // 一次躍遷的水平上限（2 秒的移動窗口跑得完）
  maxDrop: 420,     // 一次躍遷往下最多掉多少
  talkPx: 90,       // 玩家離多近才點得到（9m）
  prices: [50, 150, 300], // 第 1、2、3 隻的價格，之後一律最後一個
};

export const SPACING = NPC.spacingM * PX_PER_M;
// 鄰居門檻＝間距的一半。寫成推導式，這樣改 spacingM 它自己跟著動。
export const NEAR = SPACING / 2;

/** 買第 n+1 隻要多少金幣（n = 已經買了幾隻）。伺服器用同一張表驗。 */
export function priceFor(n) {
  return NPC.prices[Math.min(n, NPC.prices.length - 1)];
}

// 鏈的錨點：每 anchorSlots 槽強制回家一次。
// 沒有錨點的話，一間開了三天的房間會要求新加入的人從第 0 槽重播四萬多次，
// 那是白花的計算。代價是每 3.3 小時 NPC 會瞬移回家一次——所有人同一瞬間發生，
// 而且那是 3.3 小時才一次的事。
function anchorOf(k) {
  return Math.floor(k / NPC.anchorSlots) * NPC.anchorSlots;
}

// (seed, 編號, 槽號) → 亂數種子。三個值都要進去，否則不同 NPC 會抽出同一串。
function mix(seed, i, k) {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 第 i 隻的家：牠那一段的正中間，最靠近的一塊「站得住、而且走得出去」的地板。
 *
 * 「走得出去」是必要條件，不是加分：蹬牆井的井底也是一塊好好的地板，但它三面都是
 * 上不去的細柱（那是設計給蹬牆用的，NPC 不會蹬牆），住在那裡的貓一輩子只會在兩點之間來回。
 * 所以由近而遠挑，第一塊「至少有三個去得了的落腳點」的才是家。
 */
function homeSpot(cache, i) {
  const level = cache.level;
  const cx = i * SPACING + SPACING / 2;
  level.ensure(cx + 2000 + NPC.span);
  const cands = [];
  level.forEachPlatform(cx - 2000, cx + 2000, (p) => {
    if (p.h >= 60 || p.w < 80) return; // 柱子跟碎片不能當家
    cands.push(p);
  });
  if (!cands.length) return null;
  cands.sort((a, b) => Math.abs(a.x + a.w / 2 - cx) - Math.abs(b.x + b.w / 2 - cx));
  for (const p of cands.slice(0, 6)) {
    const spot = spotOn(p, p.x + p.w / 2);
    if (exits(cache, spot) >= 3) return spot;
  }
  return spotOn(cands[0], cands[0].x + cands[0].w / 2);
}

/** 從這個落腳點去得了幾個地方（含腳下這塊板子的另一端） */
function exits(cache, spot) {
  return cache.at(spot).length;
}

/** 平台上的一個落腳點。x 會夾進「站得穩」的範圍內。 */
function spotOn(p, x) {
  const inset = Math.min(40, p.w / 2);
  const tx = x < p.x + inset ? p.x + inset : (x > p.x + p.w - inset ? p.x + p.w - inset : x);
  return { x: tx, y: p.y, p };
}

/** 這塊板子的正中央——買下來的重生點就是這個點（Y 是頂面）。 */
export function centerSpot(p) {
  return { x: p.x + p.w / 2, y: p.y, p };
}

const HALF = PLAYER_W / 2;
const STEP = 1 / 120;

// ── 跳上柱頂 ────────────────────────────────────────────
// 機器人的腦沒有這一招：nextLanding 直接略過 h>=60 的方塊（那是要蹬的牆，不是落點），
// obstacleAhead 更把它當成必須跨過去的障礙。但柱頂站得住，NPC 就該站得上去，
// 所以這裡自己解一次彈道：用多快的速度跑、按住幾格、從哪一點起跳。
//
// 全部由「這一槽的起點與目標」決定——那兩個值是鏈算出來的，每台電腦都一樣，
// 所以這個計畫也是一樣的。算不出來就是算不出來，那一槽會靠槽尾的對齊收拾。
//
// 回傳 {c0, v0, hold, k, dir}：c0 是起跳時貓的中心要在哪、v0 是起跳時的水平速度、
// k 是空中搖桿推幾成（決定最高速）、hold 是跳躍鍵按住幾格。
//
// 有兩種起跳方式，因為站的地方不一樣：
//   · 地板上有助跑空間 → 全速衝過去起跳，起跳點反推得出來（拋物線多長就退多遠）。
//   · 站在細柱上（比貓還窄）→ 沒有助跑，只能原地跳，水平距離全靠空中加速補。
//     這時起跳點是定的，改變的是「按住幾格」跟「空中推幾成」，兩個一起湊出剛好的落點。
function computePost(level, from, target) {
  const post = target.p;
  const y0 = from.y - PLAYER_H;          // 站在起點時 box 的 y
  const landY = post.y - PLAYER_H;       // 站上柱頂時 box 的 y
  if (landY >= y0 - 8) return null;      // 柱頂不比腳下高：那是走下去的事，不是這一招
  const C = post.x + post.w / 2;
  const dir = C >= from.x ? 1 : -1;
  const face = dir > 0 ? post.x : post.x + post.w;
  const lo = from.p.x + HALF + 2, hi = from.p.x + from.p.w - HALF - 2;
  const standing = hi - lo < 40;         // 腳下太窄，跑不起來
  const tol = (post.w + PLAYER_W) / 2 - 8; // 原地跳的落點容差：貓踩得到柱頂的範圍
  const need = (C - from.x) * dir;
  const shortlist = [];

  // landX（跳出去多遠）對 hold（跳躍鍵按住幾格）是單調遞增的，所以「落點剛好對」的按壓
  // 時間是一段連續區間。先把需求換算成 landX 的區間，再二分找到入口、出界就收工——
  // 不必把 7 種速度 × 60 段按壓全部模擬一遍。那個「一算就掉一幀」的尖峰就是這樣來的。
  const wLo = standing ? need - tol : (dir > 0 ? C - hi : lo - C);
  const wHi = standing ? need + tol : (dir > 0 ? C - lo : hi - C);

  for (const k of [1, 0.86, 0.72, 0.6, 0.5, 0.42, 0.34]) {
    const cap = PHYS.runSpeed * k;
    const v0 = standing ? 0 : cap;
    const land = (hold) => flight(v0, cap, y0, hold, landY, null, 0);

    // 這個速度整段都構不到（或全部飛過頭）就整組跳過，只花兩次模擬
    const far = land(60);
    if (far === null || far < wLo) continue;
    const near = land(1);
    if (near !== null && near > wHi) continue;

    // 二分找到第一個「跳得夠遠」的按壓時間
    let g = 1, h = 60;
    while (g < h) {
      const m = (g + h) >> 1;
      const v = land(m);
      if (v === null || v < wLo) g = m + 1; else h = m;
    }

    for (let hold = g; hold <= 60; hold++) {
      const landX = land(hold);
      if (landX === null) continue;
      if (landX > wHi) break;                       // 再按下去只會更遠
      const c0 = standing ? from.x : C - dir * landX;
      // 前緣越過柱子的近側面時，腳底一定要已經高過柱頂
      const faceX = (face - c0) * dir - HALF;
      const clear = flight(v0, cap, y0, hold, landY, faceX, post.y);
      if (clear === null) continue;
      shortlist.push({ c0, v0, hold, k, dir, clear });
    }
  }

  // 解析式的彈道只知道起點與那根柱子，不知道路上還有什麼——蹬牆井裡近端那根柱子
  // 就正好擋在半路上。所以最後一關是用真的物理預演一次：餘裕最大的先試，
  // 第一個真的站得上去的就是計畫。預演跑的是同一套 player.js，所以它成立就是真的成立。
  shortlist.sort((a, b) => b.clear - a.clear);
  for (const pl of shortlist.slice(0, 4)) {   // 預演一次要跑兩百多步真物理，餘裕最大的先試
    if (rehearse(level, from, target, pl)) return pl;
  }
  return null;
}

// 用真的物理把整段助跑＋起跳跑一遍，看最後有沒有站在目標上。
// 跟正式執行用的是同一個控制器（flyStep），所以預演過了就等於做得到。
function rehearse(level, from, target, plan) {
  const p = new Player(level, { airJumps: 0, mortal: false });
  p.reset({ x: from.x - HALF, y: from.y });
  const ctl = { airborne: false, runningUp: false, holdLeft: 0, ain: { axis: 0, jumpHeld: false } };
  const steps = Math.round(NPC.move / STEP);
  for (let i = 0; i < steps; i++) {
    flyStep(p, ctl, plan, STEP);
    if (ctl.done) break;
  }
  return standingOn(p, target.p);
}

function standingOn(p, plat) {
  return p.grounded && Math.abs(p.y + PLAYER_H - plat.y) < 1.5 &&
    p.x + PLAYER_W > plat.x && p.x < plat.x + plat.w;
}

// 助跑 → 到點起跳 → 空中保持方向。搖桿推幾成由計畫決定（Player 的最高速跟著推的深度走）。
// NPC 與預演共用這一段，兩邊才會是同一件事。
function flyStep(p, ctl, plan, dt) {
  const ax = ctl.ain;
  const cx = p.x + HALF;
  if (ctl.airborne) {
    ax.axis = plan.dir * plan.k;
    ctl.holdLeft--;
    ax.jumpHeld = ctl.holdLeft > 0;        // 按住幾格 = 這一跳的高度
    if (p.grounded) { ctl.airborne = false; ctl.done = true; ax.jumpHeld = false; }
  } else {
    const d = (plan.c0 - cx) * plan.dir;
    if (plan.v0 === 0) {
      // 原地跳：站定了才跳，帶著速度跳會把拋物線拉長，柱頂就過頭了
      ax.axis = Math.abs(d) < 3 ? 0 : (d > 0 ? plan.dir : -plan.dir) * 0.4;
      if (Math.abs(d) < 3 && Math.abs(p.vx) < 6) takeoff(p, ctl, plan);
    } else if (d > 1.5) {
      ax.axis = plan.dir * plan.k;         // 還沒到起跳點：往前跑
    } else if (d < -1.5 && !ctl.runningUp) {
      ax.axis = -plan.dir * 0.7;           // 起跳點在身後：先退回去
    } else {
      ctl.runningUp = true;
      ax.axis = plan.dir * plan.k;
      // 到點而且速度也上來了才起跳；不然拋物線會比計畫的短
      if (Math.abs(p.vx) >= plan.v0 - 12) takeoff(p, ctl, plan);
    }
  }
  p.update(dt, ax);
}

function takeoff(p, ctl, plan) {
  p.queueJump();
  ctl.ain.jumpHeld = true;
  ctl.airborne = true;
  ctl.holdLeft = plan.hold;
}

// 模擬一次跳躍，水平方向照 player.js 的空中加速走（原地跳全靠它把距離補出來）。
// faceX 為 null 時回傳「落到 landY 時前進了多少」；
// 非 null 時回傳「越過 faceX 之後腳底離柱頂最少還有多少」（會撞上去就回 null）。
function flight(v0, cap, y0, hold, landY, faceX, top) {
  let vy = -PHYS.jumpVel, y = y0, x = 0, vx = v0, clear = Infinity;
  for (let i = 0; i < 400; i++) {
    if (i > 0) {
      vy += PHYS.gravity * STEP;
      if (i === hold && vy < 0) vy *= PHYS.jumpCut;
      if (vy > PHYS.maxFall) vy = PHYS.maxFall;
    }
    vx += PHYS.accelAir * STEP;
    if (vx > cap) vx = cap;
    y += vy * STEP;
    x += vx * STEP;
    // 落地那一步要先結束，才不會把「腳踩到柱頂」本身算成撞到柱子
    if (vy > 0 && y >= landY) return faceX === null ? x : (clear < 0 ? null : clear);
    if (faceX !== null && x > faceX) {
      const c = top - (y + PLAYER_H);
      if (c < clear) clear = c;
    }
  }
  return null;
}

// 從 from 跳得到 to 嗎？用的是關卡生成器同一條彈道公式，所以「生成器保證跳得過去」
// 跟「NPC 選得到的目標」講的是同一件事。
function reachable(level, from, to) {
  const rise = from.y - to.y;                 // 正 = 要往上
  if (rise > JUMP_HEIGHT - 14) return false;  // 沒有二段跳，單跳上不去就是上不去
  if (-rise > NPC.maxDrop) return false;      // 掉太深，移動窗口收不回來
  if (Math.abs(to.x - from.x) > NPC.reach) return false;
  // 細高柱只能從下面跳上柱頂，而且落點只有十幾 px 寬，容錯比地板小得多。
  // 這裡先用彈道公式粗篩，真正的助跑計畫在起跳前才算（planPost）。
  if (to.p.h >= 60) {
    if (rise <= 8 || rise > JUMP_HEIGHT - 18) return false;
    if (to.p.w < 14) return false;
    // 路上不能再有別的東西凸出來。蹬牆井裡近端那根柱子就正好擋在通往遠端那根的半路上，
    // 解析式的彈道看不見它——那一跳一定撞牆。
    if (blocked(level, from, to)) return false;
  }
  // 真正決定跳不跳得過去的是「兩塊板子之間的空隙」，不是兩個落腳點的距離：
  // 兩塊大平台的落腳點可能差 500px，但邊緣其實只隔 100px。
  const a = from.p, b = to.p;
  const gap = b.x > a.x + a.w ? b.x - (a.x + a.w)
    : a.x > b.x + b.w ? a.x - (b.x + b.w) : 0;
  return gap <= maxGapForRise(Math.max(0, rise)) * 0.75;
}

// 腳下這塊板子的另一端也是落腳點。
// 少了這個，站在寬板子上的 NPC 會被困住：它的落腳點被釘在「上一次走過來的那一側」，
// 於是板子另一頭的鄰居永遠在 reach 之外，兩個點之間來回一輩子。
// 板子比一次躍遷還長的話就先走 reach 這麼遠，下一輪再繼續往前——長板子分段走完。
function ownEnds(cur) {
  const p = cur.p, out = [];
  const inset = Math.min(40, p.w / 2);
  for (const end of [p.x + inset, p.x + p.w - inset]) {
    const d = end - cur.x;
    if (Math.abs(d) < 60) continue; // 太近，等於沒動
    const x = Math.abs(d) > NPC.reach ? cur.x + (d > 0 ? NPC.reach : -NPC.reach) : end;
    out.push({ x, y: p.y, p });
  }
  return out;
}

// 起點與目標之間，還有沒有別的東西凸出「起跳的那個水平面」？
function blocked(level, from, to) {
  const lo = Math.min(from.x, to.x), hi = Math.max(from.x, to.x);
  let hit = false;
  level.forEachPlatform(lo, hi, (p) => {
    if (hit || p === from.p || p === to.p) return;
    if (p.y >= from.y - 12) return;              // 沒有凸出腳下這個面，不擋路
    if (p.x + p.w <= lo || p.x >= hi) return;
    hit = true;
  });
  return hit;
}

function twoWay(level, a, b) {
  return reachable(level, a, b) && reachable(level, b, a);
}

// ── 候選點的記憶 ────────────────────────────────────────
// 一條鏈重播兩千個時槽，走的其實是同一小塊地形上的同幾個點——那是一個很小的圖上的
// 隨機漫步，不是每次都走到新地方。每一槽都重掃一次地形（範圍查詢 + 最多 8 次雙向可達性，
// 柱頂還要再掃一次擋路的東西）是白費的，所以照「落腳點」記起來。
//
// 記得住的前提是這份答案永遠不會變：地形是照 seed 依序長出來的、只會往後長、
// 長出來就不再變動，而且每次建表之前都先 ensure 過那個範圍。
// 鍵用板子的物件本身（不會誤撞）加上量化過的 x（同一塊板子上的不同站位）。
class SpotCache {
  constructor(level) {
    this.level = level;
    this.byPlat = new Map();
    this.plans = new Map();   // 柱頂計畫：同一段躍遷會一再重複，算一次就夠
  }

  /** 從 from 跳上 to 那根柱子的計畫（算不出來就記 null，下次不必再算一遍）。 */
  plan(from, to) {
    const k = Math.round(from.x * 4) + ':' + Math.round(from.y * 4) + '>' +
      Math.round(to.p.x * 4) + ':' + Math.round(to.p.y * 4);
    if (this.plans.has(k)) return this.plans.get(k);
    const v = computePost(this.level, from, to);
    this.plans.set(k, v);
    return v;
  }

  at(spot) {
    let inner = this.byPlat.get(spot.p);
    if (!inner) { inner = new Map(); this.byPlat.set(spot.p, inner); }
    const k = Math.round(spot.x * 4);
    let list = inner.get(k);
    if (!list) { list = buildCands(this.level, spot); inner.set(k, list); }
    return list;
  }
}

// 從 cur 看得到、而且去得了的所有落腳點：左右各 4 個「別的」，再加上腳下這塊板子的另一端。
// 順序就是抽籤的順序，不能動——它決定了鏈的內容。
function buildCands(level, cur) {
  // 掃描之前先確保地形長到那裡。地形是照 seed 依序長出來的，多長一段不會改變已經有的東西，
  // 但「還沒長出來」會讓兩台電腦看到不一樣的候選——那就不同步了。
  level.ensure(cur.x + NPC.span + 100);
  const s = level.standSpotsAround(cur.x, cur.y, 4, NPC.span, cur.p);
  const out = [];
  // 只走「回得來」的路。往下掉 400px 很容易，爬回來卻不一定爬得上去——
  // 少了這一條，隨機漫步遲早會掉進某個爬不出來的坑，然後在那裡走一輩子
  //（蹬牆井的井底就是這種坑：它有地板，但四周只有上不去的細柱）。
  for (const c of s.right) if (twoWay(level, cur, c)) out.push(c);
  for (const c of s.left) if (twoWay(level, cur, c)) out.push(c);
  for (const c of ownEnds(cur)) out.push(c);
  return out;
}

// 抽下一個落腳點。ban 非 0 時只准往那個方向找（鄰居規則）。
// 兩趟走訪、不配置任何陣列：這支函式在重播時會被叫上千次。
function pickSpot(cache, cur, rng, ban) {
  const cands = cache.at(cur);
  let n = 0;
  for (let i = 0; i < cands.length; i++) {
    if (ban === 0 || (cands[i].x - cur.x) * ban >= 0) n++;
  }
  if (!n) return cur; // 那一側沒有去得了的地方 → 原地再待機一輪
  let pick = Math.floor(rng() * n) % n;
  for (let i = 0; i < cands.length; i++) {
    if (ban !== 0 && (cands[i].x - cur.x) * ban < 0) continue;
    if (pick-- === 0) return cands[i];
  }
  return cur;
}

// ── 一條鏈 ──────────────────────────────────────────────
// free = true 的是「無規則鏈」：不套鄰居規則，純函數，給別人當參考用。
class Chain {
  constructor(pool, i, free) {
    this.pool = pool;
    this.i = i;
    this.free = free;
    this.k = -1;
    this.anchor = -1;
    this.spot = null;
    this.prev = null;      // 前一槽的落腳點
    this.prevK = -1;
    // 無規則鏈要記下每一槽的 x：真鏈重播的時候會回頭問「你第 j 槽在哪」，
    // 沒有這份紀錄就得把無規則鏈倒帶回錨點重算一遍，等於同一段路走兩次。
    this.xs = free ? [] : null;
  }

  /**
   * 第 k 槽的落腳點。
   *
   * 「往回要一格」要特別接住：Npc 每次換槽都要問 k（這一槽的起點）和 k+1（目標），
   * 但池子已經先把鏈推到 k+1 了。沒有這一手的話，問 k 會讓整條鏈從錨點重建——
   * 一間開了三小時的房就是每次換槽重播兩千個時槽，而且是無預算的那種。
   */
  at(k) {
    if (this.spot !== null && this.anchor === anchorOf(k)) {
      if (k === this.k) return this.spot;
      if (k === this.prevK && this.prev !== null) return this.prev;
    }
    const fuel = this.pool.fuel;
    this.pool.fuel = Infinity;
    const ok = this.advance(k);
    this.pool.fuel = fuel;
    return ok ? this.spot : null;
  }

  /** 這條鏈算到第 k 槽了嗎（無規則鏈有歷史，算過就一直記得）。 */
  has(k) {
    return this.spot !== null && this.anchor === anchorOf(k) && this.k >= k;
  }

  ready(k) {
    return this.spot !== null && this.anchor === anchorOf(k) && this.k === k;
  }

  /** 第 k 槽時這條鏈在哪個 x。只有無規則鏈答得出來——只有它記了歷史。 */
  xAt(k) {
    return this.has(k) ? this.xs[k - this.anchor] : null;
  }

  /**
   * 往前推進到第 k 槽。花的是「整個池子這一幀的預算」（pool.fuel），用完就停在半路，
   * 下一幀接著走。
   *
   * 為什麼要限量：一間開了三小時的房，新加入的人得從錨點重播兩千個時槽才知道那隻貓
   * 現在站在哪。全部擠在一幀裡就是一次掉幀——而那一幀正好是「貓出現」的那一幀，
   * 玩家看到的就是「貓一出現就頓一下」。攤到十幾幀去，貓晚 0.1 秒出現，沒有人看得出來。
   *
   * 預算為什麼要整個池子共用：真鏈每走一步都要問鄰居「你那一槽在哪」，鄰居沒算到就得
   * 先幫它算。分開記預算的話，這條隱藏的路會繞過限制——那個 6ms 的尖峰就是這樣來的。
   *
   * 鄰居沒追上時真鏈會停下來等，不會自己往前衝：那一步的答案本來就取決於鄰居，
   * 猜一個會讓結果跟著各人的幀率跑掉，那就不同步了。
   */
  advance(k) {
    if (this.free && this.has(k)) return true;
    const a = anchorOf(k);
    if (this.spot === null || this.anchor !== a || this.k > k) {
      this.anchor = a;
      this.k = a;
      this.prev = null;
      this.prevK = -1;
      this.spot = homeSpot(this.pool.cache, this.i);
      if (this.xs) { this.xs.length = 0; if (this.spot) this.xs.push(this.spot.x); }
      if (!this.spot) return false;
    }
    while (this.k < k && this.pool.fuel > 0) {
      // 鄰居的無規則鏈要先算到這一槽，這一步才算得出來
      if (!this.free && !this.pool.neighborsReady(this.i, this.k)) break;
      // 幫鄰居追進度也是花預算的，花完就停在這裡——不然這一步會透支
      if (this.pool.fuel <= 0) break;
      this.prev = this.spot;
      this.prevK = this.k;
      this.spot = this.step(this.k);
      this.k++;
      this.pool.fuel--;
      this.pool.steps++;
      if (this.xs) this.xs.push(this.spot.x);
    }
    return this.free ? this.has(k) : this.k === k;
  }

  step(k) {
    const rng = mulberry32(mix(this.pool.seed, this.i, k));
    let ban = 0;
    if (!this.free) {
      const other = this.pool.neighborAt(this.i, k, this.spot.x);
      // 反方向＝遠離對方。剛好重疊（差 0）時往右，只是要有個定論。
      if (other !== null) ban = this.spot.x - other >= 0 ? 1 : -1;
    }
    return pickSpot(this.pool.cache, this.spot, rng, ban);
  }
}

// ── 一隻 NPC ────────────────────────────────────────────
class Npc {
  constructor(pool, i) {
    this.pool = pool;
    this.i = i;
    this.name = '旅貓 ' + (i + 1);
    // 不吃金幣、不被地刺殺、掉出世界也不死：牠是世界的一部分，不是玩家
    this.p = new Player(pool.level, { airJumps: 0, mortal: false });
    this.bot = makeBot();
    this.input = makeInput();
    // 跳柱頂用的是類比搖桿（要控制助跑速度），機器人的腦用的是數位左右鍵
    this.ctl = { airborne: false, runningUp: false, holdLeft: 0, done: false, ain: { axis: 0, jumpHeld: false } };
    this.plan = null;
    this.chain = new Chain(pool, i, false);
    this.slot = -1;
    this.from = null;
    this.target = null;
    this.invite = 0;     // 購買邀請的倒數（秒）。純本機 UI，不進網路
    this.says = '';      // 對話泡的內容
    this.saysT = 0;
    this.ready = false;
    this.moving = false;
    this.hops = 0;    // 走過幾段（給 tools/verify-npc.mjs 看的診斷數字）
    this.misses = 0;  // 其中幾段在移動窗口結束時還沒站上目標
  }

  get owner() { return this.pool.owners.get(this.i) || null; }
  get x() { return this.p.x; }
  get y() { return this.p.y; }
  /** 貓的中心點，給點擊判定與對話泡用 */
  get cx() { return this.p.x + PLAYER_W / 2; }
  get cy() { return this.p.y + PLAYER_H / 2; }

  say(text, secs = 3.5) { this.says = text; this.saysT = secs; }

  // 買下來之後：只在那塊板子上左右踱步，兩端各待機一輪，再也不跳。
  // 端點由伺服器發的重生點座標反查，所以就算跨過鏈的錨點也還是同一塊板子。
  patrolSpot(k) {
    const own = this.owner;
    const p = this.pool.platformAt(own.x, own.y);
    if (!p) return null;
    const m = Math.min(60, p.w / 2);
    const left = { x: p.x + m, y: p.y, p };
    const right = { x: p.x + p.w - m, y: p.y, p };
    return ((k - this.pool.slotOf(own)) & 1) ? right : left;
  }

  spotAt(k) {
    const own = this.owner;
    if (!own) return this.chain.at(k);
    const s = this.pool.slotOf(own);
    // 定居之後只看那塊板子。找不到板子（地形還沒長到那裡）就先不出場，
    // 不要回頭把整條鏈重算一遍——那是一次幾千個時槽的重播。
    if (k > s) return this.patrolSpot(k);
    return this.chain.at(k);
  }

  /** 這一槽還需不需要動用鏈？定居之後的踱步只看伺服器發的那塊板子，不需要。 */
  needsChain(k) {
    const own = this.owner;
    return !own || k <= this.pool.slotOf(own) + 1;
  }

  place(spot) {
    const p = this.p;
    p.x = spot.x - PLAYER_W / 2;
    p.y = spot.y - PLAYER_H;
    p.vx = 0; p.vy = 0;
    p.grounded = true;
    p.airJumps = 0;
    p.wallDir = 0;
    this.bot = makeBot();
    this.input.left = this.input.right = this.input.jump = false;
  }

  // dt 一定是 1/120（跟玩家同一個固定步長），worldT 是房間的世界時間（秒）
  update(dt, worldT) {
    const k = Math.floor(worldT / NPC.slot);
    const tIn = worldT - k * NPC.slot;

    if (k !== this.slot) {
      const from = this.spotAt(k);
      if (!from) { this.ready = false; return; }
      const to = this.spotAt(k + 1) || from;
      this.slot = k;
      this.from = from;
      this.target = to;
      // 每一槽的開頭都硬對齊到落腳點。平常這是個沒有作用的指派（待機段早就收斂到這裡了），
      // 只有在上一槽失手——沒跳到、掉進坑裡——的時候才看得出來：它就是那個救援機制。
      this.place(from);
      // 目標是柱頂的話，先把整段助跑與起跳算好（見 planPost 的說明）
      this.plan = to.p.h >= 60 && to.p !== from.p ? this.pool.cache.plan(from, to) : null;
      this.ctl.airborne = false;
      this.ctl.runningUp = false;
      this.ctl.holdLeft = 0;
      this.ctl.done = false;
      this.ready = true;
    }
    if (!this.ready) return;

    if (this.saysT > 0) this.saysT = Math.max(0, this.saysT - dt);
    if (this.invite > 0) {
      this.invite = Math.max(0, this.invite - dt);
      if (this.invite === 0 && this.says) this.says = '';
    }

    if (tIn < NPC.move) {
      this.moving = true;
      this.drive(dt);
    } else {
      if (this.moving) {
        this.moving = false;
        this.hops++;
        if (!this.onTarget() || Math.abs(this.cx - this.target.x) > 26) this.misses++;
      }
      this.rest(dt, tIn);
    }
  }

  // 移動段：走得到就用走的，柱頂自己算彈道，其餘交給機器人的腦
  drive(dt) {
    const p = this.p, t = this.target;
    const dir = t.x - this.cx;
    if (this.plan && !this.onTarget()) {
      this.flyToPost(dt);
      return;
    }
    if (this.onTarget()) {
      // 已經站在目標那塊板子上了：純走路，不准跳——
      // 目標若在細柱上，機器人在邊緣會判斷成「該起跳了」，那會把牠從柱頂送出去。
      const near = Math.abs(dir) < 18;
      this.input.left = !near && dir < 0;
      this.input.right = !near && dir > 0;
      this.input.jump = false;
    } else {
      act(p, this.pool.level, this.bot, this.input, dir >= 0 ? 1 : -1, false);
    }
    p.update(dt, this.input);
  }

  // 待機段：把位置收斂到落腳點，0.5 秒後完全對齊。
  // 這是所有人「看到同一件事」的地方——每 6 秒有 3.5 秒是逐位元相同的。
  rest(dt, tIn) {
    const p = this.p, t = this.target;
    const tx = t.x - PLAYER_W / 2, ty = t.y - PLAYER_H;
    p.vx = 0; p.vy = 0;
    p.grounded = true;
    p.wallDir = 0;
    if (tIn > NPC.move + 0.5) { p.x = tx; p.y = ty; }
    else {
      const a = 1 - Math.pow(0.0005, dt);
      p.x += (tx - p.x) * a;
      p.y += (ty - p.y) * a;
    }
    this.input.left = this.input.right = this.input.jump = false;
    if (Math.abs(tx - p.x) > 1) p.facing = tx > p.x ? 1 : -1;
  }

  flyToPost(dt) {
    flyStep(this.p, this.ctl, this.plan, dt);
    if (this.ctl.done) this.plan = null;
  }

  onTarget() {
    const t = this.target, p = this.p;
    if (!p.grounded) return false;
    if (Math.abs(p.y + PLAYER_H - t.p.y) > 1.5) return false;
    return p.x + PLAYER_W > t.p.x && p.x < t.p.x + t.p.w;
  }
}

// ── 池子 ────────────────────────────────────────────────
export class NpcPool {
  constructor(seed, level) {
    this.seed = seed >>> 0;
    this.level = level;
    this.map = new Map();   // 編號 → Npc（模擬中的）
    this.chains = new Map(); // 編號 → 無規則鏈（給鄰居規則參考）
    this.owners = new Map(); // 編號 → {name, slot, x, y, mine}
    this.cache = new SpotCache(level); // 落腳點 → 候選清單。重播兩千個時槽全靠它
    this.fuel = 0;          // 這一幀還能幫鏈推進幾個時槽（見 Chain.advance）
    this.steps = 0;         // 累計推進了幾個時槽。tools/verify-perf.mjs 用它確認沒有繞過預算的路
    this.t0 = 0;            // 世界時鐘的原點（ms），由伺服器發
    this.offset = 0;        // 本機時鐘與伺服器的差
  }

  /** 換地形＝整個世界重來：連 NPC 跟它們的主人一起丟掉。 */
  rebind(seed, level, t0) {
    this.seed = seed >>> 0;
    this.level = level;
    this.cache = new SpotCache(level);
    this.t0 = t0 || Date.now();
    this.map.clear();
    this.chains.clear();
    this.owners.clear();
  }

  setClock(t0, offset) {
    if (t0 && t0 !== this.t0) { this.t0 = t0; this.map.clear(); this.chains.clear(); }
    if (offset != null) this.offset = offset;
  }

  /** 現在是房間的第幾秒。所有人算出來的值一樣（誤差是 ping 的一半）。 */
  worldTime(now = Date.now()) {
    return Math.max(0, (now + this.offset - this.t0) / 1000);
  }

  setOwners(list) {
    this.owners.clear();
    for (const o of list || []) this.owners.set(o.i, o);
  }

  /** 成交的那一刻是第幾槽。伺服器存的是時間（ms），槽號在這裡換算。 */
  slotOf(o) {
    if (o.slot != null) return o.slot;
    return Math.floor((o.at - this.t0) / 1000 / NPC.slot) + 1;
  }

  setOwner(o) {
    this.owners.set(o.i, o);
    const n = this.map.get(o.i);
    if (n) n.slot = -1; // 下一槽重新取目標，直接切進踱步模式
  }

  /** 我（name）在這間房買了幾隻 */
  ownedBy(name) {
    let n = 0;
    for (const o of this.owners.values()) if (o.name === name) n++;
    return n;
  }

  mySpawn(name) {
    let best = null;
    for (const o of this.owners.values()) {
      if (o.name !== name) continue;
      if (!best || o.x > best.x) best = o;   // 買過好幾個就用最遠的那個
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  platformAt(x, y) {
    let hit = null;
    this.level.forEachPlatform(x - 4, x + 4, (p) => {
      if (hit || Math.abs(p.y - y) > 1.5) return;
      if (x < p.x || x > p.x + p.w) return;
      hit = p;
    });
    return hit;
  }

  // 第 i 隻的鄰居（i±1）在第 k 槽的位置，只回傳 NEAR 之內最近的那一個。
  // 看的是鄰居的「無規則鏈」——理由寫在檔案開頭。
  neighborAt(i, k, mine) {
    let best = null, bestD = NEAR;
    for (const j of [i - 1, i + 1]) {
      if (j < 0) continue;
      const x = this.freeChain(j).xAt(k);
      if (x === null) continue;
      const d = Math.abs(x - mine);
      if (d < bestD) { bestD = d; best = x; }
    }
    return best;
  }

  /** 第 i 隻的左右鄰居，無規則鏈都算到第 k 槽了嗎？沒有就順手幫它們算（一樣吃預算）。 */
  neighborsReady(i, k) {
    let ok = true;
    for (const j of [i - 1, i + 1]) {
      if (j < 0) continue;
      const c = this.freeChain(j);
      if (c.has(k)) continue;
      if (!c.advance(k)) ok = false;
    }
    return ok;
  }

  freeChain(i) {
    let c = this.chains.get(i);
    if (!c) { c = new Chain(this, i, true); this.chains.set(i, c); }
    return c;
  }

  /**
   * @param {number} focusX 玩家所在的 x
   * @param {number} dt     固定步長（1/120）
   * @param {number} worldT 房間的世界時間（秒）
   */
  update(focusX, dt, worldT) {
    const iMax = Math.floor((focusX + NPC.trackPx) / SPACING);
    const iMin = Math.max(0, Math.floor((focusX - NPC.trackPx) / SPACING));
    // 鄰居規則要看得到隔壁那一隻，所以地形至少要生成到牠家的搜尋半徑外
    this.level.ensure((iMax + 1) * SPACING + SPACING / 2 + NPC.span + 200);

    for (let i = iMin; i <= iMax; i++) this.freeChain(i);
    for (const i of this.chains.keys()) {
      if (i < iMin - 1 || i > iMax + 1) this.chains.delete(i);
    }

    // 只有離玩家夠近的才真的模擬。「夠近」量的是牠現在的落腳點，不是牠的家——
    // 遊蕩久了牠可能離家很遠。用無規則鏈當位置的估計值就夠了（跟真鏈最多差一次躍遷）。
    const k = Math.floor(worldT / NPC.slot);
    // 這一幀能花在「把鏈算到現在」的預算，所有鏈共用。用完的下一幀繼續。
    this.fuel = NPC.catchup;

    for (const [i, n] of this.map) {
      // 還在追鏈、還沒放到位的那一隻，身上的座標是 Player 的預設值，不能拿來判距離——
      // 拿它判會變成「建了就被回收、下一幀再建」，那隻貓永遠不會出場。
      const px = n.ready ? n.x : (n.chain.spot ? n.chain.spot.x : focusX);
      if (Math.abs(px - focusX) > NPC.activePx + NPC.reach) { this.map.delete(i); continue; }
      // 買下來定居之後就不必再算鏈了：踱步只看伺服器發的那塊板子
      if (n.needsChain(k + 1) && !n.chain.advance(k + 1)) { n.ready = false; continue; }
      n.update(dt, worldT);
    }

    for (let i = iMin; i <= iMax; i++) {
      if (this.map.has(i)) continue;
      const c = this.freeChain(i);
      if (!c.advance(k)) continue;                    // 還在算，下一幀再看
      if (Math.abs(c.xAt(k) - focusX) > NPC.activePx) continue;
      const n = new Npc(this, i);
      this.map.set(i, n);
      if (n.chain.advance(k + 1)) n.update(dt, worldT);
    }
  }

  /** 診斷用：從 from 跳到 target 的柱頂，做得到嗎？（tools/verify-npc.mjs 與 _diag 用） */
  tryHop(from, target) {
    const plan = this.cache.plan(from, target);
    return plan ? rehearse(this.level, from, target, plan) : false;
  }

  list() {
    const out = [];
    for (const n of this.map.values()) if (n.ready) out.push(n);
    return out;
  }

  /** 離 (x,y) 最近、而且近到可以講話的那一隻。點擊判定用。 */
  nearest(x, y, maxDist = NPC.talkPx) {
    let best = null, bestD = maxDist * maxDist;
    for (const n of this.list()) {
      const dx = n.cx - x, dy = n.cy - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }
}
