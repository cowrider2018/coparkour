/* ── test/src/trail.js ───────────────────────────────────────────────
   劍光：主角三段攻擊的範圍，畫成刀掃過去留下的三道同心的劍氣。

   這一支只算數字——每一段的劍氣什麼時候掃、從哪個角度掃到哪個角度、這一刻
   的三道劍氣在世界的哪裡。畫出來是 qi.js 的事；而這一支 node 驗得動
   （tools/verify-combat.mjs 的「劍氣」那一節）。

   ── 一刀三道劍氣 ─────────────────────────────────────────────────
   劍氣跟刀垂直：它是刀掃過去畫出來的那一筆，順著掃的方向拉長，寬度沿著
   刀的方向量。一道是一側寬（sideAt）：起點收成尖、往刀那一頭變寬，刀那一頭
   是一條跟刀平行的平邊。qi.js 沿著刀的路徑一排一排鋪上去，每一排接在上一排
   後面，所以一刀就是完整的一塊，人在揮的時候轉向也只是讓那一筆彎一下，不會
   斷開。

   寬度不靠把一道加寬，而是同一刀三道（BANDS）合成一塊：最外那一道最粗，外緣
   貼著 REACH；往內每一道的外緣退一點、也細一點。三道一樣照 sideAt 從起點尖到
   全寬，所以起點那一頭是分開的三條尖尾，往刀那一頭變寬、疊在一起、併成一塊
   （hullOf 是合起來的外框）。qi.js 的光影照合起來的那一塊算，不是三道各算各的。

   反過來「跟刀平行」（每一刻從刀根到刀尖畫一條、疊出寬度）的話，刀一幀
   掃過的角度一大、或人一轉向，條與條之間就是縫。

   ── 劍氣就是範圍 ─────────────────────────────────────────────────
   以前的高亮是「畫面上亮起來的那一片就是打得到的地方」，劍氣守的是它的邊：
   掃過去的角度就是那一段判定的角度，最外那一道的外緣就在判定的半徑 REACH 上，
   其餘兩道的外緣一道比一道靠內，每一道往內寬 wide·sideAt。所以三道上的每一點都
   打得到，最外那一道的外緣就是打得到的最遠處。qi.js 收的時候每一道都只從
   內緣往外緣收，外緣留到最後。

   ── 什麼時候掃 ───────────────────────────────────────────────────
   跟 moves.js 那一招出手的那一格對齊（第一段 0.07→0.18、第二段 0.06→0.19，
   都是 strike 的加減速；第三段落地那一下 0→0.40，out2）。稍微提早一點開始。

     slash  身體中間那個高度的水平面，面向的左右各 SLASH_HALF，從右掃到左
            （moves.js：刀從右後方掃過正前方）。
     rise   第二段那片鉛直扇形（combat.js 的 fanFrame），從下緣 a0 往上掃
            FAN.sweep。
     slam   身體中間那個高度的水平面，整整一圈多一點，從右後方開始往左轉
            （moves.js：整隻往左轉一圈多）。
     cleave 騎士（怪物）的跳砍：跟 rise 同一片鉛直扇形，反過來從正上方往下劈到下緣
            （下緣指著劈的那一條的遠端，半徑由 qi.js 照那一條的長度縮放）。
            θ 一樣從 0 往上數，量的是從正上方往下劈了多少。
     whirl  騎士（怪物）的劍迴旋衝刺：跟 slam 一樣，只是多轉一圈、同樣 0.40 秒掃完
            （monster.js 的 whirlDash）。半徑由 qi.js 照騎士的迴旋縮放。

   判定每一幀都照玩家現在的位置與面向算，劍氣也是：這一幀鋪上去的那一截從
   玩家這一幀的身上長出來。已經鋪好的不動——留下來的劍氣不該跟著人跑。
   ------------------------------------------------------------------ */

import { PHYS } from './walk.js';
import { REACH, SLASH_HALF, FAN, fanFrame } from './combat.js';

const TAU = Math.PI * 2;

/** 劍氣沿著路徑一排最多掃過這麼大的角度（弧度）：弧才不會變成折線。 */
export const PIECE = 0.12;

/**
 * 一刀的三道，從外到內（0 是最外那一道）：外緣在哪個半徑（out）、最寬的地方多寬
 * （wide，沿著刀的方向量），都是公尺。往內一道外緣退 0.3 REACH；寬度照 2.3 : 1.3 : 0.3
 * （一份是 REACH / 3）。全寬的時候裡面兩道整條落在最外那一道身上，只有起點那一頭
 * 還細的時候三道是分開的。
 */
const PART = REACH / 3;
export const BANDS = [
  { out: 1.0 * REACH, wide: 2.3 * PART },
  { out: 0.7 * REACH, wide: 1.3 * PART },
  { out: 0.4 * REACH, wide: 0.3 * PART },
];

/** 一側寬的那一道從起點尖到全寬，花掉掃的角度的幾成；之後一路全寬到刀那一頭。 */
const RISE = 0.6;

const EASE = {
  strike: (u) => u * u * u * (u * (u * 6 - 15) + 10),
  out2: (u) => 1 - (1 - u) ** 2,
};

/**
 * 每一段的劍氣。
 *   t0, t1   什麼時候掃（從進入那一段量，秒）
 *   from, to 從哪個角度掃到哪個角度（slash、slam 是相對面向的水平角，往左為正；
 *            rise 是從扇形的下緣 a0 往上量）
 *   life     整道多久之後收起來：最後一截在 t1 鋪上去，qi.js 的一截 0.2 秒收完，再留一點餘裕
 *   taper    一側寬：起點尖、往刀那一頭變寬（sideAt）。一整圈的不收，不然刀轉回起點
 *            的那一截接不上
 */
export const TRAILS = {
  slash: { t0: 0.05, t1: 0.17, from: -SLASH_HALF, to: SLASH_HALF, ease: 'strike', life: 0.39, taper: true },
  rise: { t0: 0.04, t1: 0.17, from: 0, to: FAN.sweep, ease: 'strike', life: 0.39, taper: true },
  slam: { t0: 0, t1: 0.40, from: -1.0 - Math.PI / 2, to: -1.0 - Math.PI / 2 + TAU + 0.35, ease: 'out2', life: 0.62, taper: false },
  cleave: { t0: 0, t1: 0.14, from: 0, to: FAN.sweep, ease: 'strike', life: 0.36, taper: true },
  whirl: { t0: 0, t1: 0.40, from: -1.0 - Math.PI / 2, to: -1.0 - Math.PI / 2 + 2 * TAU + 0.35, ease: 'out2', life: 0.62, taper: false },
};

/** 進入那一段 τ 秒時，劍氣掃到哪個角度（還沒開始是 from、掃完是 to）。 */
export function sweepAt(kind, tau) {
  const T = TRAILS[kind];
  const u = Math.min(1, Math.max(0, (tau - T.t0) / (T.t1 - T.t0)));
  return T.from + (T.to - T.from) * EASE[T.ease](u);
}

/**
 * 掃到角度 θ 的那一截劍氣有多寬（那一道 wide 的幾成）：起點收成尖，掃過 RISE 之後
 * 一路是 1，刀那一頭就是全寬的平邊。沒有 taper 的一律 1。
 */
export function sideAt(kind, theta) {
  const T = TRAILS[kind];
  if (!T.taper) return 1;
  const u = (theta - T.from) / (T.to - T.from) / RISE;
  return 0.04 + 0.96 * Math.sin((Math.PI / 2) * Math.min(1, Math.max(0, u))) ** 0.7;
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
 * 的時候往 t 那個方向動（單位向量，垂直於 d；d × t 就是劍氣所在那個面的法線）。
 *
 * 都照玩家這一幀的位置與面向（rise 是這一幀的 fanFrame），跟判定同一個時間點。
 */
export function bladeAt(kind, theta, p, tip) {
  if (kind === 'rise') {
    const { dirX, dirZ, a0 } = fanFrame(p, tip);
    const a = a0 + theta, c = Math.cos(a), s = Math.sin(a);
    return { o: [p.x, p.y, p.z], d: [dirX * c, s, dirZ * c], t: [-dirX * s, c, -dirZ * s] };
  }
  if (kind === 'cleave') {
    const { dirX, dirZ, a1 } = fanFrame(p, tip);
    const a = a1 - theta, c = Math.cos(a), s = Math.sin(a);
    return { o: [p.x, p.y, p.z], d: [dirX * c, s, dirZ * c], t: [dirX * s, -c, dirZ * s] };
  }
  const a = Math.atan2(p.aimX, p.aimZ) + theta, c = Math.cos(a), s = Math.sin(a);
  return { o: waist(p), d: [s, 0, c], t: [c, 0, -s] };
}

/** 刀上離 o 那麼遠的一點。 */
export const along = (b, r) => [b.o[0] + b.d[0] * r, b.o[1] + b.d[1] * r, b.o[2] + b.d[2] * r];

/**
 * 三道在寬度比例 s（sideAt）的那一截合起來的外框：最靠內的那一道的內緣到最靠外
 * 的外緣（公尺，從刀根沿著刀量）。中間可能有空的——起點那裡三道還沒疊到。
 */
export function hullOf(s) {
  let inner = Infinity, outer = -Infinity;
  for (const B of BANDS) {
    inner = Math.min(inner, B.out - B.wide * s);
    outer = Math.max(outer, B.out);
  }
  return { inner, outer };
}

/**
 * 第 band 道（0 是最外那一道）在角度 θ 的那一截：中線上的一點 p（外緣貼著那一道的
 * out，所以中線再往內 w/2）、這裡多寬 w（沿著刀的方向量）、那一刻的刀 b。
 */
export function qiAt(kind, theta, p, tip, band = 0) {
  const B = BANDS[band], w = B.wide * sideAt(kind, theta);
  const b = bladeAt(kind, theta, p, tip);
  return { p: along(b, B.out - w / 2), w, b };
}
