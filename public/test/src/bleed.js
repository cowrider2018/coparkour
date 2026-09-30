/* ── test/src/bleed.js ───────────────────────────────────────────────
   挨打噴出來的血（怪物與主角）：規則——噴多少、往哪裡噴、落到哪裡。

   跟 trail.js 一樣只算數字；畫出來是 blood.js 的事，而這一支 node 驗得動
   （tools/verify-combat.mjs 的「噴血」那一節）。

   ── 方向 ─────────────────────────────────────────────────────────
   劍氣是刀掃過去畫出來的一筆：順著掃的方向（trail.js 的 t）拉長，寬度沿著刀（d）
   量。血噴的方向跟劍氣垂直、角度跟劍氣平行，就是刀的方向 d——它躺在劍氣所在的
   那個面上、跟那一筆拉長的方向垂直。第二段那片扇形是斜著立起來的，血也就斜著
   往上噴。

   用的是劍氣經過怪物的那一截的刀（hitFrame），不是出手那一刻刀掃到哪：判定是
   整片扇形一次算的，怪物可能在刀還沒掃到的那一邊就算打中了，照那一刻的刀噴，
   血會往旁邊噴。

   每一滴的初速都正好是 d 的倍數，沒有沿著 t 的份，也不偏出那個面。散開靠的是
   起點沿著 t 錯開（傷口是劍氣劃過身體的那一條線）與初速快慢不同。之後只有重力。

   起點是怪物的身體：腰的高度（體型大的高），沿著傷口那一條線散開。

   破防攻擊沒有劍氣，是例外：往全方向噴（burstFrame，見下面的塊狀）。

   ── 片狀與塊狀 ───────────────────────────────────────────────────
   上面那樣噴成一片（sheet）的，是被劍氣——一片薄薄的東西——劃到的。被一整塊東西撞到
   的噴成一塊（lump，lumpFrame）：起點擠在傷口的一小團裡（LUMP.core），每一滴的初速
   在 d 周圍一個圓錐（LUMP.cone）裡亂給，往四面散開、不躺在哪一個面上。d 是撞過來的
   方向（水平），再往上抬 LUMP.lift。破防攻擊的圓錐張到整個球（burstFrame）：往全方向噴，
   往下的那幾滴就近落在牠腳邊。

   形狀只改每一滴的起點與方向：大小、滴數、初速快慢、總量都跟片狀的一樣。

   ── 主角挨打 ─────────────────────────────────────────────────────
   主角跟狗一樣大（體型 1），噴的是血。哪一下是片狀、哪一下是塊狀，照打中他的是什麼
   （hurtFrame）：
     片狀  怪物的劍：騎士的劍迴旋（whirl 那一圈，水平）、跳砍劈下去那一條與國王的直線劈砍
           （cleave，從正上方劈下來的那個立著的面）、上挑（rise 那片扇形）。跟主角砍怪物
           同一套：劍氣經過他的那一截的刀（hitFrame）。
     塊狀  衝過來咬（從怪物指著他）、BOSS 的球（球飛的方向）、地震的震波（從震央往外）。

   ── 大小與遠近 ───────────────────────────────────────────────────
   每一滴的半徑在 BLEED.size 那個區間裡均勻亂給。初速照半徑定：最小的那一端是
   speed 的快的那一頭、最大的是慢的那一頭，中間照比例——所以小的血滴一定噴得比
   大的遠（射程 v²·sin2θ/g 在任何仰角都跟著 v 變大），大滴就近落下、細的飛出去。

   ── 出血量跟體積走 ───────────────────────────────────────────────
   一隻怪物畫得是狗的 s 倍高（monster.js 的 sizeOf），體積就是 s³ 倍。一次噴出去的
   血總量——每一滴半徑的立方加起來——正好是 BLEED.volume · s³，而且每一滴都還在
   區間裡：前 n − 1 滴照區間亂給，最後一滴補足剩下的量；補的那一滴落在區間外就
   整批重抽（大多一兩次就中）。最後一滴不擺在傷口的哪一頭：擺位是打散之後才給的。

   一滴一滴怎麼分：滴數照 s^1.5、區間（所以平均半徑）照 s^0.5，乘起來才是 s³。全部
   給滴數的話 BOSS 是一團八倍多的小點，全部給半徑的話是同樣幾滴大球，都不像大隻
   的流得多。

   噴的範圍跟著體型放大：傷口照 s 寬，初速照 √s——拋物線的射程是 v²/g，所以跟著 s
   變遠。大隻噴出來的形狀是小隻的放大版，只是滴更多、更大。

   ── 落地 ─────────────────────────────────────────────────────────
   落到那一點底下的地板（floorUnder：一個點的地板，不是 walk.js 那個有半徑的身體的）
   就變成一灘：半徑照那一滴放大 SPLAT.area 倍，順著落地時的水平速度拉長。一灘很快
   攤開、留一陣子（看是哪一種血）、再縮掉（splatScale）——跟劍光一樣是收掉，不是淡掉。撞進盒子的
   側面、或飛出黑牆就沒了：那裡本來就被擋住，看不到。

   沒扣到血（蓄力中傷害減半、捨去成 0）就不噴。

   ── 血的種類 ─────────────────────────────────────────────────────
   噴出來的是哪一種（STYLE，每一類怪物是哪一種看 monster.js 的 bloodOf）只改怎麼飛、
   留多久，不改量與方向：
     blood  血：只受重力，落地變成一灘。
     ecto   幽靈的靈質：初速快一截，但空氣阻力大（速度每秒照 e^(−drag) 衰減），沒有
            重力、落地也不留一灘——噴出去一下就慢下來，停在半空中飄著，留得比血久，
            最後 fade 秒縮掉（dropSize）。碰到地板就貼著地板停住，不往下穿。
   阻力照比例減速，停下來的地方是 v₀ / drag 那麼遠：初速快的停得遠，小的照樣噴得比
   大的遠。
   ------------------------------------------------------------------ */

import { PHYS, nearXZ, roundTop, arenaGap } from './walk.js';
import { fanFrame } from './combat.js';
import { TRAILS, bladeAt } from './trail.js';

/**
 * 噴血的數值（體型 1 的那一份；體型 s 照檔頭的比例放大）。
 *
 *   drops   幾滴
 *   size    半徑的區間（公尺），每一滴在裡面均勻亂給
 *   speed   初速的區間（公尺／秒）：[最大的那一滴, 最小的那一滴]，再乘上那一種的 speed
 *   wound   傷口多長（公尺）：起點沿著劍氣散開的那一段
 *   volume  一次噴出去的總量（半徑立方和）：drops 滴、半徑在 size 裡均勻分布的期望值
 */
export const BLEED = {
  drops: 12, size: [0.025, 0.07],
  speed: [2.5, 6.5], wound: 0.5,
};
{
  const [a, b] = BLEED.size;
  BLEED.volume = (BLEED.drops * (b ** 4 - a ** 4)) / (4 * (b - a));
}

/**
 * 塊狀的噴法（體型 1 的那一份；core 照體型放大）。
 *
 *   cone  初速在 d 周圍多大的圓錐裡（半角，弧度）
 *   lift  d 從撞過來的水平方向往上抬多少（弧度）
 *   core  起點擠在多大的一團裡（半徑，公尺）
 */
export const LUMP = { cone: 0.6, lift: 0.35, core: 0.08 };

/**
 * 地上的一灘（只有會留一灘的那幾種血，STYLE 的 pool）。
 *
 *   area   半徑是那一滴的幾倍
 *   long   順著落地的水平速度拉長：每 1 m/s 長這麼多成（寬不變）
 *   grow   攤開要多久（秒）
 *   hold   攤開之後留多久
 *   shrink 縮掉要多久
 */
export const SPLAT = { area: 2.4, long: 0.12, grow: 0.06, hold: 1.6, shrink: 0.8 };
SPLAT.life = SPLAT.grow + SPLAT.hold + SPLAT.shrink;

/**
 * 每一種血（見檔頭）。
 *
 *   speed   初速是 BLEED.speed 的幾倍
 *   drag    空氣阻力：速度每秒乘 e^(−drag)
 *   fall    重力是 PHYS.gravity 的幾成
 *   life    一滴最多留幾秒（血是飛到落地，這只是掉進坑裡的上限；靈質就是留這麼久）
 *   fade    最後幾秒縮掉（0 = 不縮，飛到落地或 life 為止）
 *   pool    落地變成一灘；不會的碰到地板就貼著停住
 */
export const STYLE = {
  blood: { speed: 1, drag: 0, fall: 1, life: 1.2, fade: 0, pool: true },
  ecto: { speed: 1.8, drag: 5, fall: 0, life: 2.4, fade: 0.8, pool: false },
};

/** 一滴這一刻畫多大：半徑乘上那一種在最後 fade 秒縮掉的那一份。 */
export function dropSize(o) {
  const S = STYLE[o.style || 'blood'];
  if (!S.fade) return o.r;
  const u = Math.min(1, Math.max(0, ((o.t || 0) - (S.life - S.fade)) / S.fade));
  return o.r * (1 - u * u * (3 - 2 * u));
}

/** 體型 s 的一次噴幾滴。 */
export const dropCount = (s) => Math.max(1, Math.round(BLEED.drops * s ** 1.5));

/** 體型 s 的一次噴出去的血總量（半徑立方和，公尺³）。 */
export const volumeOf = (s) => BLEED.volume * s ** 3;

/** 怪物腰的高度：畫得多高（體型 s）的一半。 */
const waistOf = (m, s) => m.y + (PHYS.height / 2) * s;

const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * 劍氣經過怪物的那一截，刀是哪一把（trail.js 的 bladeAt）：怪物在劍氣所在那個面上
 * 的哪一個角度，夾在那一段掃得到的角度裡。只要 d（刀的方向）與 t（劍氣拉長的方向）。
 *
 * @param {string} kind 哪一段（trail.js 的 TRAILS 的鍵）
 * @param {object} body 玩家這一幀（fight.body，出招時是鎖住的面向）
 * @param {object|null} tip 第二段（combo.tip）或劈（cleave）指著的末端點
 * @param {object} m 挨打的那一個
 * @param {number} s 牠的體型
 */
export function hitFrame(kind, body, tip, m, s) {
  const T = TRAILS[kind], y = waistOf(m, s);
  let theta;
  if (kind === 'rise') {
    const { dirX, dirZ, a0 } = fanFrame(body, tip);
    const h = (m.x - body.x) * dirX + (m.z - body.z) * dirZ;
    theta = Math.atan2(y - body.y, h) - a0;
  } else if (kind === 'cleave') {
    const { dirX, dirZ, a1 } = fanFrame(body, tip);
    const h = (m.x - body.x) * dirX + (m.z - body.z) * dirZ;
    theta = a1 - Math.atan2(y - body.y, h);
  } else {
    theta = wrap(Math.atan2(m.x - body.x, m.z - body.z) - Math.atan2(body.aimX, body.aimZ));
  }
  // 一整圈的（第三段）掃過每一個角度；其他的夾在 from～to 裡。
  if (T.taper) theta = clamp(theta, Math.min(T.from, T.to), Math.max(T.from, T.to));
  else theta = T.from + ((((theta - T.from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  const { d, t } = bladeAt(kind, theta, body, tip);
  return { d, t };
}

/** 破防攻擊：塊狀，但圓錐張到整個球——往全方向噴。 */
export const burstFrame = () => ({ d: [0, 1, 0], lump: true, cone: Math.PI });

/** 塊狀：被一整塊東西從 (dx, dz)（水平）撞過來，往那個方向、抬高 LUMP.lift 噴一團。 */
export function lumpFrame(dx, dz) {
  const h = Math.hypot(dx, dz) || 1, c = Math.cos(LUMP.lift);
  return { d: [(dx / h) * c, Math.sin(LUMP.lift), (dz / h) * c], lump: true };
}

/**
 * 主角挨的那一下噴成什麼樣（見檔頭「主角挨打」）。
 *
 * @param {string} cause 'bitten'、'shot'、'struck'（fight.js 的 resolve）
 * @param {object} src 打中他的那一個：咬的是怪物、球是 world.shots 的那一顆、其餘是
 *   bossStep 打下去的那一下（skills.js，strike 或震波）
 * @param {{x,y,z}} p 主角
 */
export function hurtFrame(cause, src, p) {
  if (cause === 'bitten') return lumpFrame(p.x - src.x, p.z - src.z);
  if (cause === 'shot') return lumpFrame(src.vx, src.vz);
  if (src.shape === 'fan') return hitFrame('rise', src, src.tip, p, 1);
  if (src.shape === 'capsule') {
    // 劍光畫在牠腰那麼高（bladeAt 從身體的 y 往上半個身高量）。
    const body = { x: src.x1, y: src.waist - PHYS.height / 2, z: src.z1, aimX: 0, aimZ: 1 };
    return hitFrame('whirl', body, null, p, 1);
  }
  if (src.shape === 'strip') {
    const body = { x: src.x, y: src.y, z: src.z, aimX: src.dirX, aimZ: src.dirZ };
    return hitFrame('cleave', body, { x: src.x + src.dirX, y: src.y, z: src.z + src.dirZ }, p, 1);
  }
  return lumpFrame(p.x - src.x, p.z - src.z);
}

/** 體型 s 的半徑區間。 */
export const sizeRange = (s) => BLEED.size.map((r) => r * Math.sqrt(s));

/** 半徑 r 的那一滴初速多快（體型 s、哪一種）：區間的小頭最快、大頭最慢，中間照比例。 */
export function speedOf(r, s, style = 'blood') {
  const [a, b] = sizeRange(s), u = clamp((r - a) / (b - a), 0, 1);
  return (BLEED.speed[1] + (BLEED.speed[0] - BLEED.speed[1]) * u) * Math.sqrt(s) * STYLE[style].speed;
}

/**
 * 體型 s 的一批半徑：每一個都在區間裡，立方和正好是 volumeOf(s)（見檔頭）。
 * 重抽 64 次都沒中（區間與滴數配得太離譜）就退一步：整批縮放到剛好，再夾回區間。
 */
function radiiOf(s, rng) {
  const n = dropCount(s), [a, b] = sizeRange(s), want = volumeOf(s);
  for (let k = 0; k < 64; k++) {
    const r = [];
    let sum = 0;
    for (let i = 0; i < n - 1; i++) { r.push(a + (b - a) * rng()); sum += r[i] ** 3; }
    const last = Math.cbrt(Math.max(0, want - sum));
    if (last >= a && last <= b) { r.push(last); return r; }
  }
  const r = Array.from({ length: n }, () => a + (b - a) * rng());
  const k = Math.cbrt(want / r.reduce((x, v) => x + v ** 3, 0));
  return r.map((v) => clamp(v * k, a, b));
}

/**
 * 一次噴血：每一滴的起點、初速與半徑。
 *
 * @param {{d:number[], t?:number[], lump?:boolean}} frame hitFrame（片狀）、lumpFrame 或 burstFrame（塊狀）
 * @param {{x:number,y:number,z:number}} m 挨打的那一個（這一刻的位置）
 * @param {number} s 怪物的體型（monster.js 的 sizeOf）
 * @param {string} style 哪一種血（STYLE 的鍵，monster.js 的 bloodOf）
 * @param {() => number} rng
 * @returns {{x,y,z,vx,vy,vz,r,style}[]}
 */
export function spurtOf(frame, m, s, style = 'blood', rng = Math.random) {
  const { d, t } = frame;
  const radii = radiiOf(s, rng), n = radii.length, y = waistOf(m, s);
  // 打散：補足總量的那一滴不固定在傷口的哪一頭。
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [radii[i], radii[j]] = [radii[j], radii[i]];
  }
  if (frame.lump) return radii.map((r) => lumpDrop(d, frame.cone ?? LUMP.cone, m, y, s, r, style, rng));
  return radii.map((r, i) => {
    // 沿著傷口排開（加一點亂），不是全擠在正中間。
    const side = ((i + rng()) / n - 0.5) * BLEED.wound * s;
    const sp = speedOf(r, s, style);
    return {
      x: m.x + t[0] * side, y: y + t[1] * side, z: m.z + t[2] * side,
      vx: d[0] * sp, vy: d[1] * sp, vz: d[2] * sp, r, style,
    };
  });
}

/**
 * 塊狀的一滴：起點在腰那一點周圍 LUMP.core · s 的球裡，方向在 d 周圍半角 cone 的圓錐裡
 * （立體角上均勻：cos 在 [cos cone, 1] 裡均勻），快慢照半徑，跟片狀的一樣。
 */
function lumpDrop(d, cone, m, y, s, r, style, rng) {
  // 跟 d 垂直的兩個單位向量。
  const a = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
  const ul = Math.hypot(...u);
  u = u.map((v) => v / ul);
  const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const cz = 1 - (1 - Math.cos(cone)) * rng(), sz = Math.sqrt(1 - cz * cz), phi = 2 * Math.PI * rng();
  const cu = Math.cos(phi) * sz, cw = Math.sin(phi) * sz;
  const v = [0, 1, 2].map((k) => d[k] * cz + u[k] * cu + w[k] * cw);
  // 起點：球裡均勻（半徑照立方根給）。
  const cr = Math.cbrt(rng()) * LUMP.core * s, oz = 2 * rng() - 1, oo = Math.sqrt(1 - oz * oz), op = 2 * Math.PI * rng();
  const sp = speedOf(r, s, style);
  return {
    x: m.x + cr * oo * Math.cos(op), y: y + cr * oz, z: m.z + cr * oo * Math.sin(op),
    vx: v[0] * sp, vy: v[1] * sp, vz: v[2] * sp, r, style,
  };
}

/**
 * (x, z) 那一點往下第一塊地板有多高：頂面不高於 y 的碰撞體裡最高的那一個，都沒有
 * 就是地面 0（坑裡是坑底）。跟 walk.js 的 supportInfo 同一套規則，只是一個點——
 * 沒有身體的半徑，也沒有踏得上去的台階。
 *
 * @returns {number} 地板的高度；那一點在某個碰撞體裡面（撞進側面）是 NaN
 */
export function floorUnder(cols, x, z, y) {
  let pit = null;
  for (const b of cols) {
    if (b.kind === 'pit' && Math.hypot(x - b.x, z - b.z) < b.r) { pit = b; break; }
  }
  let f = pit ? pit.bottom : 0;
  for (const b of cols) {
    if (b.kind === 'bound' || b.kind === 'pit') continue;
    if (pit && b.max[1] <= pit.top + 0.01) continue;
    if (!nearXZ(b, x, z, 0)) continue;
    const top = b.shape === 'circle' ? roundTop(b, Math.min(Math.hypot(x - b.x, z - b.z), b.r)) : b.max[1];
    if (top > y + 1e-6) {
      if (y > (b.min ? b.min[1] : -Infinity)) return NaN;   // 在它裡面
      continue;
    }
    if (top > f) f = top;
  }
  return f;
}

/** 一灘在第 t 秒攤開到幾成（0 → 1 → 0）。 */
export function splatScale(t) {
  if (t < SPLAT.grow) return 1 - (1 - t / SPLAT.grow) ** 2;
  if (t < SPLAT.grow + SPLAT.hold) return 1;
  const u = Math.min(1, (t - SPLAT.grow - SPLAT.hold) / SPLAT.shrink);
  return 1 - u * u * (3 - 2 * u);
}

/**
 * 血的一幀：每一滴照那一種的阻力與重力飛，落地的變成一灘（不留一灘的貼著地板停住），
 * 撞牆或留太久的沒了；每一灘長大、縮掉。drops 與 splats 就地改。
 *
 * @param {{x,y,z,vx,vy,vz,r,style?,t?,field}[]} drops 每一滴帶著牠噴出來的那一場（field）
 * @param {{x,y,z,r,ax,az,long,t}[]} splats
 */
export function bleedStep(drops, splats, dt) {
  let n = 0;
  for (const o of drops) {
    const S = STYLE[o.style || 'blood'];
    o.t = (o.t || 0) + dt;
    if (S.drag) { const k = Math.exp(-S.drag * dt); o.vx *= k; o.vy *= k; o.vz *= k; }
    if (S.fall) o.vy -= PHYS.gravity * S.fall * dt;
    o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
    if (o.t > S.life || arenaGap(o.field.arena, o.x, o.z) < 0) continue;
    const f = floorUnder(o.field.cols, o.x, o.z, o.y + Math.max(0, -o.vy * dt));
    if (Number.isNaN(f)) continue;
    if (o.y <= f && o.vy <= 0 && !S.pool) { o.y = f; o.vy = 0; }
    else if (o.y <= f && o.vy <= 0) {
      const h = Math.hypot(o.vx, o.vz);
      splats.push({
        x: o.x, y: f, z: o.z, r: o.r * SPLAT.area,
        ax: h > 1e-6 ? o.vx / h : 1, az: h > 1e-6 ? o.vz / h : 0, long: 1 + SPLAT.long * h, t: 0,
      });
      continue;
    }
    drops[n++] = o;
  }
  drops.length = n;
  let k = 0;
  for (const p of splats) {
    p.t += dt;
    if (p.t < SPLAT.life) splats[k++] = p;
  }
  splats.length = k;
}
