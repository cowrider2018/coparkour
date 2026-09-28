/* ── test/src/trail.js ───────────────────────────────────────────────
   劍氣：主角三段攻擊的範圍，畫成刀掃過去留下的一道月牙。

   這一支只算數字——每一段的劍氣什麼時候掃、從哪個角度掃到哪個角度、這一刻
   的月牙在世界的哪裡。畫出來是 qi.js 的事；而這一支 node 驗得動
   （tools/verify-combat.mjs 的「劍氣」那一節）。

   ── 一刀一道月牙 ─────────────────────────────────────────────────
   劍氣跟刀垂直：它是刀尖掃過去畫出來的那一筆，順著掃的方向拉長，寬度沿著
   刀的方向量——一道月牙，中間寬、頭尾尖（crescentAt）。qi.js 沿著刀尖的路徑
   一顆一顆放點（間距 gapAt），每一顆接在上一顆後面，再把它們融成一個曲面，
   所以一刀就是完整的一塊，人在揮的時候轉向也只是讓那一筆彎一下，不會斷開。

   反過來「跟刀平行」（每一刻從刀根到刀尖畫一條、疊出寬度）的話，刀一幀
   掃過的角度一大、或人一轉向，條與條之間就是縫。

   ── 劍氣就是範圍 ─────────────────────────────────────────────────
   以前的高亮是「畫面上亮起來的那一片就是打得到的地方」，劍氣守的是它的邊：
   掃過去的角度就是那一段判定的角度，月牙的外緣就在判定的半徑 REACH 上，
   往內寬 width·crescentAt。所以月牙上的每一點都打得到，外緣就是打得到的
   最遠處。qi.js 讓邊晃的時候外緣只准往內縮，不准往外長。

   ── 什麼時候掃 ───────────────────────────────────────────────────
   跟 moves.js 那一招出手的那一格對齊（第一段 0.07→0.18、第二段 0.06→0.19，
   都是 strike 的加減速；第三段落地那一下 0→0.40，out2）。稍微提早一點開始。

     slash  身體中間那個高度的水平面，面向的左右各 SLASH_HALF，從右掃到左
            （moves.js：刀從右後方掃過正前方）。
     rise   第二段那片鉛直扇形（combat.js 的 fanFrame），從下緣 a0 往上掃
            FAN.sweep。
     slam   身體中間那個高度的水平面，整整一圈多一點，從右後方開始往左轉
            （moves.js：整隻往左轉一圈多）。

   判定每一幀都照玩家現在的位置與面向算，劍氣也是：這一幀鋪上去的那一截從
   玩家這一幀的身上長出來。已經鋪好的不動——留下來的劍氣不該跟著人跑。
   ------------------------------------------------------------------ */

import { PHYS } from './walk.js';
import { REACH, SLASH_HALF, FAN, fanFrame } from './combat.js';

const TAU = Math.PI * 2;

/**
 * 月牙是沿著刀尖路徑的一串點（qi.js 把它們融成一個曲面）。相鄰兩顆點最多隔多遠：
 * 那裡半寬的 GAP 倍，不小於 MIN_GAP 公尺。GAP 小於 1，相鄰兩顆一定重疊——剛掃
 * 出來的月牙是一整塊，要等點被吃小了才會斷開。
 */
export const GAP = 0.55;
export const MIN_GAP = 0.05;
export const gapAt = (w) => Math.max(MIN_GAP, (GAP * w) / 2);

const EASE = {
  strike: (u) => u * u * u * (u * (u * 6 - 15) + 10),
  out2: (u) => 1 - (1 - u) ** 2,
};

/**
 * 每一段的劍氣。
 *   t0, t1   什麼時候掃（從進入那一段量，秒）
 *   from, to 從哪個角度掃到哪個角度（slash、slam 是相對面向的水平角，往左為正；
 *            rise 是從扇形的下緣 a0 往上量）
 *   life     整道多久之後收起來（掃完之後被吃掉的那一段，見 qi.js）
 *   width    月牙最寬的地方多寬（公尺，沿著刀的方向量）
 *   taper    月牙：掃的頭尾尖、中間寬（crescentAt）。一整圈的不收，不然起點那裡斷一截
 */
export const TRAILS = {
  slash: { t0: 0.05, t1: 0.17, from: -SLASH_HALF, to: SLASH_HALF, ease: 'strike', life: 0.95, width: 1.3, taper: true },
  rise: { t0: 0.04, t1: 0.17, from: 0, to: FAN.sweep, ease: 'strike', life: 0.95, width: 1.3, taper: true },
  slam: { t0: 0, t1: 0.40, from: -1.0 - Math.PI / 2, to: -1.0 - Math.PI / 2 + TAU + 0.35, ease: 'out2', life: 1.2, width: 0.9, taper: false },
};

/** 進入那一段 τ 秒時，劍氣掃到哪個角度（還沒開始是 from、掃完是 to）。 */
export function sweepAt(kind, tau) {
  const T = TRAILS[kind];
  const u = Math.min(1, Math.max(0, (tau - T.t0) / (T.t1 - T.t0)));
  return T.from + (T.to - T.from) * EASE[T.ease](u);
}

/**
 * 掃到角度 θ 的那一截月牙有多寬（width 的幾成）：頭尾兩端收成尖、中間 1。
 * 沒有 taper 的一律 1。
 */
export function crescentAt(kind, theta) {
  const T = TRAILS[kind];
  if (!T.taper) return 1;
  const u = (theta - T.from) / (T.to - T.from);
  return 0.04 + 0.96 * Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** 0.7;
}

/** 那道劍氣這一刻還剩幾成（1 → 0）：掃的時候是 1，掃完之後到 life 收掉。 */
export function fadeAt(kind, tau) {
  const T = TRAILS[kind];
  if (tau <= T.t1) return 1;
  const u = Math.min(1, (tau - T.t1) / (T.life - T.t1));
  return 1 - u * u * (3 - 2 * u);
}

const waist = (p) => [p.x, p.y + PHYS.height / 2, p.z];

/**
 * 劍氣掃到角度 θ 的那一刻，刀在哪：從 o 沿單位向量 d 伸出去到 REACH，角度變大
 * 的時候往 t 那個方向動（單位向量，垂直於 d；d × t 就是月牙所在那個面的法線）。
 *
 * 都照玩家這一幀的位置與面向（rise 是這一幀的 fanFrame），跟判定同一個時間點。
 */
export function bladeAt(kind, theta, p, tip) {
  if (kind === 'rise') {
    const { dirX, dirZ, a0 } = fanFrame(p, tip);
    const a = a0 + theta, c = Math.cos(a), s = Math.sin(a);
    return { o: [p.x, p.y, p.z], d: [dirX * c, s, dirZ * c], t: [-dirX * s, c, -dirZ * s] };
  }
  const a = Math.atan2(p.aimX, p.aimZ) + theta, c = Math.cos(a), s = Math.sin(a);
  return { o: waist(p), d: [s, 0, c], t: [c, 0, -s] };
}

/** 刀上離 o 那麼遠的一點。 */
export const along = (b, r) => [b.o[0] + b.d[0] * r, b.o[1] + b.d[1] * r, b.o[2] + b.d[2] * r];

/**
 * 月牙在角度 θ 的那一截：中線上的一點 p（外緣貼著 REACH，所以中線在 REACH − w/2）、
 * 這裡多寬 w（沿著刀的方向量）、那一刻的刀 b。
 */
export function qiAt(kind, theta, p, tip) {
  const w = TRAILS[kind].width * crescentAt(kind, theta);
  const b = bladeAt(kind, theta, p, tip);
  return { p: along(b, REACH - w / 2), w, b };
}
