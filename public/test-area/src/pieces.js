/* ── test-area/src/pieces.js ─────────────────────────────────────────
   一套石造零件。每一支都是「把幾百塊 geom.js 的倒角石頭擺到該擺的
   地方」，形狀語言統一走 Dota／黑魂那一路：

     厚      牆是一塊一塊砌的，不是一片盒子。轉角看得到丁順、頂上看得到
             最後一皮沒砌完，這是「遺跡」和「低模建築」的差別所在。
     尖      拱是尖拱（兩段圓弧交在頂點），不是半圓。半圓拱是羅馬，尖拱
             是那些遊戲的招牌輪廓，而且它在低視角下佔的畫面更高。
     階      扶壁、台基、女牆一律分段收分。每一階都在輪廓上多切一刀，
             而輪廓是這種造型唯一真正被看見的東西。
     殘      每一支都吃 `ruin`（0～1）：越大則頂皮缺得越多、磚掉得越多、
             柱子斷得越低。同一支零件因此可以砌完好的門樓也可以砌廢墟。

   顏色一律從 palette.js 拿，形狀一律用 kit 快取——同尺寸的磚只會有一份
   幾何，墨線也因此只算一次（見 geom.js 的 edgesOf）。

   會動的東西（火焰）不進合併緩衝區，而是回報座標給 blocks.js，由
   main.js 建成自己的 mesh：合併過的頂點沒有辦法逐幀縮放。
   ------------------------------------------------------------------ */

import { stone, drum, spike, blob, ring, cloth, rng } from './geom.js';
import { C } from './palette.js';

/* ── 幾何快取 ────────────────────────────────────────────────────
   尺寸四捨五入到 2 cm 當 key。石造物的尺寸本來就是「幾種磚」而不是
   「每塊都不一樣」，所以命中率極高——一個區塊通常只有二三十份幾何。 */
export class Kit {
  constructor() { this.m = new Map(); }
  _get(k, make) {
    let g = this.m.get(k);
    if (!g) { g = make(); this.m.set(k, g); }
    return g;
  }
  brick(w, h, d, ch = 0.045) {
    const q = (v) => Math.round(v * 50) / 50;
    return this._get(`b${q(w)},${q(h)},${q(d)},${q(ch)}`, () => stone(q(w), q(h), q(d), ch));
  }
  drum(rt, rb, h, seg = 10) {
    const q = (v) => Math.round(v * 50) / 50;
    return this._get(`d${q(rt)},${q(rb)},${q(h)},${seg}`, () => drum(q(rt), q(rb), q(h), seg));
  }
  cone(r, h, seg = 8) {
    const q = (v) => Math.round(v * 50) / 50;
    return this._get(`c${q(r)},${q(h)},${seg}`, () => spike(q(r), q(h), seg));
  }
  blob(r, detail = 0) {
    const q = (v) => Math.round(v * 50) / 50;
    return this._get(`o${q(r)},${detail}`, () => blob(q(r), detail));
  }
  ring(r, t) {
    const q = (v) => Math.round(v * 100) / 100;
    return this._get(`r${q(r)},${q(t)}`, () => ring(q(r), q(t)));
  }
  cloth(w, h, wave) {
    const q = (v) => Math.round(v * 50) / 50;
    return this._get(`f${q(w)},${q(h)},${q(wave || 0.16)}`, () => cloth(q(w), q(h), wave));
  }
}

/* 石材四階。挑哪一階不是隨機挑的：同一皮磚裡混兩三階才有砌體的感覺，
   但整體要偏中階，不然一面牆看起來像馬賽克。 */
const COURSE = [C.stone, C.stone, C.stoneLit, C.stoneDark, C.stone, C.stoneDeep];
const stoneTone = (r) => COURSE[Math.floor(r() * COURSE.length)];

/* ── 地板 ────────────────────────────────────────────────────────
   中央空地。這是唯一一片「必須乾淨」的區域：狗要在上面跑，所以石板是
   平的、沒有一塊突出來會卡腳的東西。缺塊處直接不畫（露出底下的土色
   地面），苔只長在縫上，兩者都不影響行走。 */
export function flagstones(B, o) {
  const r = rng(o.seed);
  const cell = o.cell || 1.5;
  const nx = Math.round(o.w / cell), nz = Math.round(o.d / cell);
  const y = o.y || 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const cx = o.x + (i - (nx - 1) / 2) * cell;
      const cz = o.z + (j - (nz - 1) / 2) * cell;
      // 從中心往外，缺塊機率上升：中間要能跑，邊緣才准爛。
      const q = Math.max(Math.abs(cx - o.x) / (o.w / 2), Math.abs(cz - o.z) / (o.d / 2));
      if (r() < (o.ruin || 0.3) * q * q) continue;
      const gap = 0.06 + r() * 0.05;
      const th = 0.18 + r() * 0.05;
      B.add(B.kit.brick(cell - gap, th, cell - gap, 0.05), {
        p: [cx, y - th / 2, cz],
        r: [0, r() < 0.5 ? 0 : Math.PI / 2, 0],
        color: r() < 0.14 ? C.graniteDark : C.granite,
        ink: r() < 0.55,          // 每塊都描邊會讓地板變成一張格線紙
      });
      if (r() < 0.10) mossTuft(B, cx + r.range(-0.4, 0.4), y, cz + r.range(-0.4, 0.4), r);
    }
  }
  /* 地板本身的碰撞。厚度只有 0.4、範圍就是鋪面本身——這兩件事都不是
     隨手給的：抬高的鋪面（城牆露台）如果登記成一個又厚又比鋪面大的
     盒子，它在側面就是一道看不見的牆，樓梯會爬到一半卡住，而牆外會多
     出一片看不見的地板可以站。 */
  B.block(o.x, y - 0.2, o.z, o.w, 0.4, o.d);
}

/** 一小叢苔。三片扁石加兩三根草，只長在地上與石頭頂面。 */
export function mossTuft(B, x, y, z, r) {
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    /* 小一點、暗一點。第一版是 0.34 見方、一半用亮綠，畫出來像有人在
       地上潑了油漆——苔是「石縫的顏色變了」，不是一塊綠色的東西。 */
    B.add(B.kit.brick(0.24, 0.04, 0.21, 0.015), {
      p: [x + r.range(-0.22, 0.22), y + 0.02, z + r.range(-0.22, 0.22)],
      r: [0, r() * Math.PI, 0],
      color: r() < 0.28 ? C.moss : C.mossDark,
      ink: false,
    });
  }
  if (r() < 0.6) {
    B.add(B.kit.cone(0.06, 0.3, 5), {
      p: [x, y + 0.15, z], r: [r.range(-0.3, 0.3), 0, r.range(-0.3, 0.3)],
      color: C.moss, ink: false,
    });
  }
}

/* ── 方向慣例 ────────────────────────────────────────────────────
   整個檔案只用一個慣例，因為零件要能互相對齊：

     一個零件的「長軸」是它自己的 local +x，「正面／厚度方向」是 local +z。
     繞 y 轉 yaw 之後，local +x 落在 (cos yaw, 0, −sin yaw)，
     local +z 落在 (sin yaw, 0,  cos yaw)。

   所以一段從 (x0,z0) 拉到 (x1,z1) 的牆，它的 yaw 是 atan2(−dz, dx)——
   不是 atan2(dx, dz)。搞錯的話牆會轉 90 度，而且扶壁會插進牆裡。 */
const yawOf = (dx, dz) => Math.atan2(-dz, dx);
/** yaw 對應的長軸單位向量。 */
const along = (yaw) => [Math.cos(yaw), -Math.sin(yaw)];
/** yaw 對應的法向單位向量（零件的正面）。 */
const across = (yaw) => [Math.sin(yaw), Math.cos(yaw)];

/* ── 牆 ──────────────────────────────────────────────────────────
   一皮一皮砌，丁順交錯（每皮的起點錯開半塊），最後一皮按 `ruin` 從一端
   開始塌。牆頂不是水平的：高度沿長度用兩個不成比例的正弦相加調變，所以
   看不出重複，也不會出現「整面牆一樣高」那種模型感。 */
export function wall(B, o) {
  const r = rng(o.seed);
  const [x0, z0] = o.from, [x1, z1] = o.to;
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const yaw = yawOf(dx, dz);               // 牆的長軸方向（繞 y）
  const nrm = across(yaw);
  const dir = along(yaw);
  const th = o.thick || 0.9;
  const bh = o.course || 0.44;             // 一皮多高
  const bl = o.brick || 0.95;              // 一塊多長
  const y0 = o.y || 0;
  const top = o.h;
  const courses = Math.ceil(top / bh);
  const ruin = o.ruin === undefined ? 0.35 : o.ruin;

  for (let c = 0; c < courses; c++) {
    const cy = y0 + bh * (c + 0.5);
    const stagger = (c % 2) * 0.5;
    const n = Math.ceil(len / bl);
    for (let i = 0; i < n; i++) {
      const t = ((i + stagger + 0.5) / n);
      if (t > 1) continue;
      const s = (t - 0.5) * len;
      // 牆頂的起伏：兩個波長互不成整數比（3.1 與 7.7），走多長都不重複。
      const decay = 0.5 + 0.5 * Math.sin(s / 3.1) * Math.sin(s / 7.7 + 1.7);
      const limit = top * (1 - ruin * 0.55 * decay);
      if (cy > limit) continue;
      // 越靠頂的磚越容易掉。
      if (r() < ruin * 0.35 * (cy / top) ** 2) continue;
      const jut = r() < 0.12 ? r.range(0.05, 0.16) : 0;   // 突出的丁磚
      const wob = r.range(-0.02, 0.02);                    // 砌歪的那一點點
      /* 磚縫只留 2 cm，倒角也收到 3.5 cm。第一版是 6 cm 縫加 5 cm 倒角，
         畫出來一面牆是一堆各自漂浮的方塊而不是砌體——那兩個數字加起來
         就是縫的視覺寬度，而砌體的縫必須比石頭薄一個數量級。 */
      B.add(B.kit.brick(bl - 0.02, bh - 0.02, th + jut, 0.035), {
        p: [x0 + dx * t + nrm[0] * wob, cy, z0 + dz * t + nrm[1] * wob],
        r: [0, yaw + r.range(-0.02, 0.02), 0],
        color: stoneTone(r),
      });
    }
  }
  /* 碰撞：沿長度切成一公尺左右的小段，一段一個盒子。缺口那幾塊磚不值得
     讓身體鑽進去，所以每一小段自己是實心的——但整道牆不能只用一個盒子。

     碰撞盒是軸對齊的，而斜著的一道牆，它的軸對齊外接盒是一個大矩形：
     圓塔水窖的環牆是十六段斜牆，每段用一個盒子的話，那十六個大矩形疊起
     來會把四個門洞全部封住，而畫面上門洞明明是開的。切成小段之後，
     每一段的外接盒幾乎就是那一段牆本身。 */
  const parts = Math.max(1, Math.ceil(len / 1.2));
  const sub = len / parts;
  for (let i = 0; i < parts; i++) {
    const t = (i + 0.5) / parts;
    const w = Math.abs(dir[0]) * sub + Math.abs(nrm[0]) * th;
    const d = Math.abs(dir[1]) * sub + Math.abs(nrm[1]) * th;
    B.block(x0 + dx * t, y0 + top / 2, z0 + dz * t, Math.max(w, 0.3), top, Math.max(d, 0.3));
  }
  return { yaw, len };
}

/** 女牆：牆頂一排垛口。城牆才有，中庭的矮牆沒有。 */
export function merlons(B, o) {
  const r = rng(o.seed);
  const [x0, z0] = o.from, [x1, z1] = o.to;
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const yaw = yawOf(dx, dz);
  const pitch = o.pitch || 1.5;
  const n = Math.floor(len / pitch);
  for (let i = 0; i < n; i++) {
    if (r() < (o.ruin || 0.3)) continue;         // 缺的那幾個垛
    const t = (i + 0.5) / n;
    const h = (o.h || 0.9) * r.range(0.82, 1.0);
    B.add(B.kit.brick(pitch * 0.62, h, (o.thick || 0.9) * 0.9, 0.06), {
      p: [x0 + dx * t, o.y + h / 2, z0 + dz * t],
      r: [0, yaw, 0],
      color: r() < 0.3 ? C.stoneLit : C.stone,
    });
  }
}

/* ── 柱 ──────────────────────────────────────────────────────────
   台基兩階、柱身分鼓、柱頭兩階。斷柱不是「短柱」：斷面上要有幾塊翹起來
   的碎石，那幾塊就是「它是斷的」的全部證據。 */
export function column(B, o) {
  const r = rng(o.seed);
  const y = o.y || 0;
  const rad = o.r || 0.44;
  const h = o.h;
  const broken = o.broken || 0;                 // 0 = 完整，0.5 = 斷在一半
  const stand = broken ? h * (1 - broken) : h;

  B.add(B.kit.brick(rad * 2.7, 0.26, rad * 2.7, 0.07), { p: [o.x, y + 0.13, o.z], color: C.stoneDark, solid: true });
  B.add(B.kit.brick(rad * 2.3, 0.22, rad * 2.3, 0.06), { p: [o.x, y + 0.37, o.z], color: C.stone, solid: true });

  const dh = 0.62;                              // 一鼓多高
  const n = Math.max(1, Math.floor((stand - 0.5) / dh));
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    const rr = rad * (1 - 0.06 * t);             // 略收分
    B.add(B.kit.drum(rr, rr * 1.02, dh - 0.03, 10), {
      p: [o.x + r.range(-0.02, 0.02), y + 0.48 + dh * (i + 0.5), o.z + r.range(-0.02, 0.02)],
      r: [0, r() * 0.6, 0],
      color: i % 2 ? C.stone : C.stoneLit,
    });
  }
  const topY = y + 0.48 + dh * n;
  if (broken) {
    // 斷面：三到五塊翹起的碎石。
    for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
      B.add(B.kit.brick(rad * r.range(0.5, 0.9), 0.2, rad * r.range(0.5, 0.9), 0.04), {
        p: [o.x + r.range(-rad, rad) * 0.6, topY + 0.06, o.z + r.range(-rad, rad) * 0.6],
        r: [r.range(-0.4, 0.4), r() * Math.PI, r.range(-0.4, 0.4)],
        color: C.stoneDeep,
      });
    }
    if (r() < 0.7) mossTuft(B, o.x, topY + 0.1, o.z, r);
  } else {
    B.add(B.kit.drum(rad * 1.25, rad * 1.02, 0.2, 10), { p: [o.x, topY + 0.1, o.z], color: C.stoneLit });
    B.add(B.kit.brick(rad * 2.5, 0.24, rad * 2.5, 0.07), { p: [o.x, topY + 0.32, o.z], color: C.stone });
  }
  B.block(o.x, y, o.z, rad * 2.2, (topY - y) * 2, rad * 2.2);
  return { top: broken ? topY : topY + 0.44 };
}

/* ── 尖拱 ────────────────────────────────────────────────────────
   兩段圓心在中線兩側的圓弧，交在正上方的頂點。楔石（voussoir）一塊一塊
   沿弧擺，每塊都朝著自己那段弧的圓心——所以磚縫是輻射的，這是拱之所以
   看起來會傳力的原因，也是它和「彎過去的一排磚」的差別。

   `ruin` 讓拱從一側開始缺；缺到頂點就變成一個斜著斷掉的拱，那是遺跡裡
   最好認的形狀之一。

   `half` 只畫其中一半（+1 右、−1 左）。半個拱就是一根斷掉的穹稜：從
   牆頭起拱、往室內彎過去、在半空中斷掉。王座廳的屋頂是這樣交代的，而
   它不需要另一支零件——一根穹稜本來就是半個拱，用同一份數學畫比另寫
   一份「彎過去的一排磚」忠實得多，磚縫也仍然是輻射的。
 */
export function pointedArch(B, o) {
  const r = rng(o.seed);
  const half = o.span / 2;
  const rise = o.rise || o.span * 0.72;
  const y = o.y;                                // 起拱線
  const yaw = o.yaw || 0;
  const th = o.thick || 0.42;                   // 拱厚（徑向）
  const depth = o.depth || 0.8;                 // 拱進深
  const ruin = o.ruin || 0;
  const dir = along(yaw);

  /* 右半邊那段弧的圓心在起拱線上、在中線左邊 e 的地方（e 可以是負的，
     那就是圓心跑到外側去的坦拱）。半徑 R 同時要過右拱腳與頂點：

       拱腳 (half, 0)：R = half + e
       頂點 (0, rise)：R² = e² + rise²

     兩式相消得到 e = (rise² − half²) / (2·half)。rise = half 時 e = 0，
     R = half——那就退化成半圓拱，這支照樣畫得出來。 */
  const e = (rise * rise - half * half) / (2 * half);
  const R = half + e;
  /* 從拱腳（θ=0，位置 (R−e, 0) = (half, 0)）量到頂點（cos θ = e/R）。
     rise < half 時 e < 0，θmax 會超過 90°，atan2 自己處理得了。 */
  const amax = Math.atan2(rise, e);
  const n = Math.max(4, Math.round((R * amax) / 0.4));

  for (const side of (o.half ? [o.half] : [-1, 1])) {   // +1 右半，−1 左半
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const ang = t * amax;                     // 0 = 拱腳，amax = 頂點
      /* 缺口從左半開始吃，而且吃得比右半深——斜著斷掉的拱才像遺跡，
         兩邊對稱地缺會看起來像設計成這樣的。只畫一半的時候沒有另一半
         可以比，所以那時兩邊同一個吃法。 */
      if (ruin && t > 1 - ruin * (o.half ? 1.0 : (side < 0 ? 1.15 : 0.5))) continue;
      if (r() < ruin * 0.22) continue;
      const lx = side * (R * Math.cos(ang) - e); // 平面內的橫座標
      const ly = R * Math.sin(ang);
      /* 楔石的 local +y 要指向徑向外側。繞 z 轉 (θ − 90°) 剛好把 +y
         轉到 (cos θ, sin θ)；左半邊鏡射，所以是 (90° − θ)。 */
      const roll = side * (ang - Math.PI / 2);
      B.add(B.kit.brick(0.4, th, depth, 0.05), {
        p: [o.x + dir[0] * lx, y + ly, o.z + dir[1] * lx],
        r: [0, yaw, roll],
        color: stoneTone(r),
      });
    }
  }
  return { crown: y + rise };
}

/* ── 拱廊 ────────────────────────────────────────────────────────
   一排尖拱加中間的墩柱，兩端各一個壁墩。這是「城堡遺跡」最主要的背景
   元素：它同時給出高度、韻律和穿透感，而且拱洞後面看得到下一個區塊。 */
export function arcade(B, o) {
  const r = rng(o.seed);
  const bays = o.bays || 4;
  const yaw = o.yaw || 0;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const span = o.span || 2.6;
  const pier = o.pier || 0.8;
  const pitch = span + pier;
  const total = bays * pitch;
  const at = (t, y, off) => [o.x + cs * t + sn * (off || 0), y, o.z - sn * t + cs * (off || 0)];
  const springer = (o.y || 0) + (o.legH || 2.4);

  for (let i = 0; i <= bays; i++) {
    const t = (i - bays / 2) * pitch;
    const h = springer - (o.y || 0);
    const p = at(t, (o.y || 0) + h / 2, 0);
    // 墩柱：兩塊一皮的砌體，比牆厚。
    const cn = Math.ceil(h / 0.44);
    for (let c = 0; c < cn; c++) {
      B.add(B.kit.brick(pier, 0.44 - 0.05, o.depth || 0.9, 0.05), {
        p: at(t + r.range(-0.02, 0.02), (o.y || 0) + 0.44 * (c + 0.5), 0),
        r: [0, yaw, 0],
        color: stoneTone(r),
      });
    }
    B.block(p[0], p[1], p[2], Math.max(pier, 0.5), h, Math.max(o.depth || 0.9, 0.5));
    // 柱頭一塊出簷的。
    B.add(B.kit.brick(pier * 1.3, 0.2, (o.depth || 0.9) * 1.25, 0.06), {
      p: at(t, springer + 0.1, 0), r: [0, yaw, 0], color: C.stoneLit,
    });
  }

  for (let i = 0; i < bays; i++) {
    const t = (i - bays / 2 + 0.5) * pitch;
    const c = at(t, 0, 0);
    const bayRuin = Math.min(1, (o.ruin || 0) * r.range(0.4, 1.8));
    pointedArch(B, {
      x: c[0], z: c[2], y: springer + 0.2, span, rise: span * 0.8, yaw,
      thick: 0.4, depth: (o.depth || 0.9) * 0.95, ruin: bayRuin, seed: o.seed + 17 * i + 3,
    });
    // 拱背上的填牆，讓拱廊有一道連續的簷。缺拱的那一跨就不填。
    if (bayRuin < 0.35) {
      const wallTop = springer + 0.2 + span * 0.8 + 0.35;
      for (let c2 = 0; c2 < 2; c2++) {
        const cy = wallTop - 0.44 * (c2 + 0.5);
        for (let k = -1; k <= 1; k++) {
          if (r() < 0.2) continue;
          B.add(B.kit.brick(pitch / 3 - 0.06, 0.4, (o.depth || 0.9) * 0.9, 0.05), {
            p: at(t + k * (pitch / 3), cy, 0), r: [0, yaw, 0], color: stoneTone(r),
          });
        }
      }
    }
  }
  return { total, springer };
}

/** 扶壁：靠著牆、往上收分的三階。城牆的側面沒有它就只是一片板子。 */
export function buttress(B, o) {
  const r = rng(o.seed);
  const yaw = o.yaw || 0;
  const steps = o.steps || 3;
  const h = o.h;
  let out = o.out || 1.5;
  let y = o.y || 0;
  for (let i = 0; i < steps; i++) {
    const sh = h / steps;
    const dep = out * (1 - i / steps * 0.55);
    const off = dep / 2;
    B.add(B.kit.brick(o.w || 1.2, sh, dep, 0.07), {
      p: [o.x + Math.cos(yaw) * 0 + Math.sin(yaw) * off, y + sh / 2, o.z + Math.cos(yaw) * off],
      r: [0, yaw, 0],
      color: i % 2 ? C.stone : C.stoneDark,
      solid: true,
    });
    // 每一階頂上一塊斜的壓頂石，把階收掉。
    B.add(B.kit.brick((o.w || 1.2) * 0.98, 0.22, dep * 0.5, 0.05), {
      p: [o.x + Math.sin(yaw) * (dep * 0.75), y + sh, o.z + Math.cos(yaw) * (dep * 0.75)],
      r: [Math.cos(yaw) * -0.5, yaw, Math.sin(yaw) * 0.5],
      color: C.stoneLit,
    });
    y += sh;
    void r;
  }
}

/** 階梯。每一階都是一個碰撞盒，所以真的踩得上去。 */
export function stair(B, o) {
  const r = rng(o.seed);
  const n = o.steps;
  const rise = o.rise || 0.28, run = o.run || 0.6;
  const yaw = o.yaw || 0;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const off = (i + 0.5) * run;
    const x = o.x + sn * off, z = o.z + cs * off;
    const y = (o.y || 0) + rise * (i + 0.5);
    // 缺角：邊上少一塊，露出裡面的填石。
    const w = (o.w || 3) * (r() < 0.25 ? r.range(0.72, 0.95) : 1);
    B.add(B.kit.brick(w, rise, run + 0.06, 0.05), {
      p: [x, y, z], r: [0, yaw, 0],
      color: r() < 0.3 ? C.granite : C.graniteDark,
      solid: true,
    });
    if (r() < 0.2) mossTuft(B, x + r.range(-w / 3, w / 3), y + rise / 2, z, r);
  }
  return { top: (o.y || 0) + rise * n, depth: run * n };
}

/* ── 雕像 ────────────────────────────────────────────────────────
   兜帽騎士。低模、寬肩、下擺外張——這個剪影就是那類遊戲的門面守衛，
   而它在三階調下只需要五塊幾何：台座、下擺、胸、兜帽、劍。
   `damage` 決定它缺什麼：0 = 完好，0.5 = 沒頭，1 = 只剩下半身。 */
export function knight(B, o) {
  const r = rng(o.seed);
  const y = o.y || 0;
  const s = o.s || 1;
  const yaw = o.yaw || 0;
  const dmg = o.damage || 0;
  const side3 = along(yaw);      // 肩膀的方向
  const front = across(yaw);     // 它面對的方向

  B.add(B.kit.brick(1.5 * s, 0.3 * s, 1.5 * s, 0.07), { p: [o.x, y + 0.15 * s, o.z], color: C.stoneDark, solid: true });
  B.add(B.kit.brick(1.25 * s, 0.26 * s, 1.25 * s, 0.06), { p: [o.x, y + 0.43 * s, o.z], color: C.stone, solid: true });
  const base = y + 0.56 * s;

  // 下擺：一個上窄下寬的十邊柱，斜切的稜就是袍子的褶。
  B.add(B.kit.drum(0.34 * s, 0.56 * s, 1.15 * s, 10), { p: [o.x, base + 0.575 * s, o.z], r: [0, yaw + 0.2, 0], color: C.stoneLit });
  if (dmg < 0.9) {
    B.add(B.kit.brick(0.92 * s, 0.78 * s, 0.62 * s, 0.16), { p: [o.x, base + 1.5 * s, o.z], r: [0, yaw, 0], color: C.stone });
    // 肩：兩塊斜的板，寬度是這個剪影的重點。
    for (const side of [-1, 1]) {
      B.add(B.kit.brick(0.42 * s, 0.24 * s, 0.6 * s, 0.09), {
        p: [o.x + side3[0] * side * 0.55 * s, base + 1.78 * s, o.z + side3[1] * side * 0.55 * s],
        r: [0, yaw, side * 0.22],
        color: C.stoneLit,
      });
    }
  }
  if (dmg < 0.45) {
    // 兜帽：一個錐加一塊臉前的暗板，臉本身是空的——那個黑洞就是它的臉。
    B.add(B.kit.cone(0.36 * s, 0.62 * s, 8), { p: [o.x, base + 2.22 * s, o.z], r: [0, yaw, 0], color: C.stone });
    B.add(B.kit.brick(0.42 * s, 0.34 * s, 0.3 * s, 0.05), {
      p: [o.x + front[0] * 0.22 * s, base + 2.06 * s, o.z + front[1] * 0.22 * s],
      r: [0, yaw, 0], color: C.stoneDeep,
    });
  } else if (dmg < 0.9) {
    for (let i = 0; i < 3; i++) {
      B.add(B.kit.brick(0.3 * s, 0.14 * s, 0.28 * s, 0.04), {
        p: [o.x + r.range(-0.2, 0.2) * s, base + 1.95 * s, o.z + r.range(-0.2, 0.2) * s],
        r: [r.range(-0.5, 0.5), r() * 3, r.range(-0.5, 0.5)], color: C.stoneDeep,
      });
    }
  }
  // 劍：立在身前，劍尖插進台座。缺頭的那尊劍也斷。
  if (dmg < 0.7) {
    const sl = dmg < 0.45 ? 1.7 : 1.0;
    const fx = o.x + front[0] * 0.5 * s, fz = o.z + front[1] * 0.5 * s;
    B.add(B.kit.brick(0.16 * s, sl * s, 0.06 * s, 0.02), {
      p: [fx, base + (sl / 2) * s, fz], r: [0, yaw, 0], color: C.ironLit,
    });
    B.add(B.kit.brick(0.5 * s, 0.1 * s, 0.1 * s, 0.03), {
      p: [fx, base + sl * s, fz], r: [0, yaw, 0], color: C.iron,
    });
  }
  // 掉在腳邊的碎塊：雕像壞掉的部分要在地上找得到。
  if (dmg > 0.3) {
    for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
      B.add(B.kit.blob(0.16 * s * r.range(0.7, 1.4)), {
        p: [o.x + r.range(-1.4, 1.4) * s, y + 0.12 * s, o.z + r.range(-1.4, 1.4) * s],
        r: [r() * 3, r() * 3, r() * 3], color: C.stoneDeep,
      });
    }
  }
  B.block(o.x, y, o.z, 1.3 * s, 4 * s, 1.3 * s);
}

/** 蹲踞的獸像。放在牆頭與拱腳，個頭小、剪影兇。 */
export function gargoyle(B, o) {
  const r = rng(o.seed);
  const s = o.s || 1, y = o.y || 0, yaw = o.yaw || 0;
  const sd = along(yaw), fr = across(yaw);
  const at = (a, up, f) => [o.x + sd[0] * a * s + fr[0] * f * s, y + up * s, o.z + sd[1] * a * s + fr[1] * f * s];
  B.add(B.kit.brick(0.8 * s, 0.2 * s, 0.8 * s, 0.05), { p: at(0, 0.1, 0), color: C.stoneDark });
  B.add(B.kit.brick(0.5 * s, 0.42 * s, 0.7 * s, 0.13), { p: at(0, 0.42, 0), r: [0.18, yaw, 0], color: C.stone });
  // 翅：兩片往後上方張的板。
  for (const side of [-1, 1]) {
    B.add(B.kit.brick(0.12 * s, 0.62 * s, 0.5 * s, 0.04), {
      p: at(side * 0.3, 0.78, -0.1), r: [-0.35, yaw, side * 0.5], color: C.stoneDark,
    });
  }
  B.add(B.kit.brick(0.34 * s, 0.3 * s, 0.42 * s, 0.1), { p: at(0, 0.78, 0.24), r: [0.25, yaw, 0], color: C.stoneLit });
  // 角兩根、下顎一塊。
  for (const side of [-1, 1]) {
    B.add(B.kit.cone(0.07 * s, 0.26 * s, 5), {
      p: at(side * 0.12, 0.98, 0.16), r: [-0.4, yaw, side * 0.3], color: C.stone,
    });
  }
  B.add(B.kit.brick(0.24 * s, 0.1 * s, 0.24 * s, 0.03), { p: at(0, 0.64, 0.38), r: [0.1, yaw, 0], color: C.stoneDeep });
  void r;
}

/* ── 碎石 ────────────────────────────────────────────────────────
   遺跡的地面不是空的，但也不能到處都是。撒法照抄 src/gfx/decor.js 的
   clump-and-thin：半徑用 u 而不是 sqrt(u)，再用 u²·0.9 往外圍淘汰，
   所以石堆沒有一條看得出來的邊界。大的幾塊登記碰撞，可以踩上去。 */
export function rubble(B, o) {
  const r = rng(o.seed);
  const n = o.n || 24;
  for (let i = 0; i < n; i++) {
    const u = r();
    if (r() < u * u * 0.9) continue;
    const ang = r() * Math.PI * 2;
    const rad = u * (o.r || 3);
    const x = o.x + Math.cos(ang) * rad, z = o.z + Math.sin(ang) * rad;
    /* 中心那片空地的守門員。石堆是「一叢」而不是「一顆」，所以叢的中心
       在空地外面不代表每一顆都在外面——大的那幾顆是登記碰撞的，一顆掉
       進空地裡就會在跑起來的時候絆一下，而那是這一頁最不該有的東西。
       所以由呼叫的人給一個判斷式，逐顆問。 */
    if (o.keep && !o.keep(x, z)) continue;
    const big = r() < 0.16;
    const sz = big ? r.range(0.55, 1.0) : r.range(0.16, 0.42);
    const y = (o.y || 0) + sz * 0.42;
    if (r() < 0.45) {
      B.add(B.kit.brick(sz * 1.5, sz * 0.8, sz * 1.2, 0.05), {
        p: [x, y, z], r: [r.range(-0.25, 0.25), r() * Math.PI, r.range(-0.25, 0.25)],
        color: stoneTone(r), solid: big,
      });
    } else {
      /* 壓扁再拉長。正球體的碎石看起來像散落的珠子——石頭是有卧向的，
         而那個卧向是「它掉下來之後停在那裡」的全部訊息。 */
      B.add(B.kit.blob(sz * 0.7), {
        p: [x, y * 0.85, z], r: [r() * 3, r() * 3, r() * 3],
        s: [1.15, 0.62, 0.95],
        color: stoneTone(r), solid: big,
      });
    }
    if (big && r() < 0.5) mossTuft(B, x, y + sz * 0.4, z, r);
  }
}

/* ── 火盆 ────────────────────────────────────────────────────────
   三腳、一缽、一堆炭。火焰本身不在這裡：它要逐幀抖，所以座標回報給
   上層，由 main.js 建一顆會呼吸的自發光錐。 */
export function brazier(B, o, flames) {
  const r = rng(o.seed);
  const y = o.y || 0, s = o.s || 1;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    B.add(B.kit.brick(0.1 * s, 1.0 * s, 0.1 * s, 0.03), {
      p: [o.x + Math.cos(a) * 0.26 * s, y + 0.5 * s, o.z + Math.sin(a) * 0.26 * s],
      r: [Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22], color: C.iron,
    });
  }
  B.add(B.kit.drum(0.52 * s, 0.3 * s, 0.36 * s, 9), { p: [o.x, y + 1.14 * s, o.z], color: C.ironLit });
  B.add(B.kit.drum(0.56 * s, 0.5 * s, 0.08 * s, 9), { p: [o.x, y + 1.32 * s, o.z], color: C.iron });
  for (let i = 0; i < 5; i++) {
    B.add(B.kit.blob(0.1 * s), {
      p: [o.x + r.range(-0.28, 0.28) * s, y + 1.3 * s, o.z + r.range(-0.28, 0.28) * s],
      r: [r() * 3, r() * 3, r() * 3], color: C.stoneDeep, ink: false,
    });
  }
  B.block(o.x, y + 0.6 * s, o.z, 0.7 * s, 1.2 * s, 0.7 * s);
  if (flames) flames.push({ x: o.x, y: y + 1.44 * s, z: o.z, s });
}

/** 旗。一根橫桿、一片布、桿頭兩顆銅球。 */
export function banner(B, o) {
  const s = o.s || 1;
  /* 1.75 × 2.5 而不是 1.3 × 3.0：窄長的布在十幾公尺外只是一條色帶，
     而旗在這種畫面裡的工作是「一塊顏色」——整片廢墟只有它和火是暖色。
     太窄的話那塊顏色不夠大，讀不到。 */
  const w = 1.75 * s, h = 2.5 * s;
  B.add(B.kit.brick(w * 1.25, 0.12 * s, 0.12 * s, 0.04), { p: [o.x, o.y, o.z], r: [0, o.yaw || 0, 0], color: C.woodDark });
  for (const side of [-1, 1]) {
    B.add(B.kit.blob(0.1 * s), {
      p: [o.x + Math.cos(o.yaw || 0) * side * w * 0.66, o.y, o.z - Math.sin(o.yaw || 0) * side * w * 0.66],
      color: C.gold, ink: false,
    });
  }
  B.add(B.kit.cloth(w, h, 0.18), {
    p: [o.x, o.y - h / 2 - 0.06 * s, o.z], r: [0, o.yaw || 0, 0],
    color: o.color || C.banner, ink: false,
  });
  // 下擺的三角缺口：破布才是遺跡的旗。
  B.add(B.kit.brick(w * 0.3, 0.5 * s, 0.06, 0.02), {
    p: [o.x + 0.2 * s, o.y - h - 0.1 * s, o.z], r: [0, o.yaw || 0, 0.3],
    color: o.color || C.banner, ink: false,
  });
}

/** 垂下來的鎖鏈。兩點之間掛一串環，中間鬆。 */
export function chain(B, o) {
  const n = o.n || 10;
  const sag = o.sag || 0.8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = o.from[0] + (o.to[0] - o.from[0]) * t;
    const z = o.from[2] + (o.to[2] - o.from[2]) * t;
    const y = o.from[1] + (o.to[1] - o.from[1]) * t - Math.sin(t * Math.PI) * sag;
    B.add(B.kit.ring(0.1, 0.032), {
      p: [x, y, z], r: [Math.PI / 2, i % 2 ? Math.PI / 2 : 0, 0], color: C.iron, ink: false,
    });
  }
}

/** 鐵閘。一格一格的柵欄，下緣做成尖的。 */
export function portcullis(B, o) {
  const w = o.w, h = o.h, yaw = o.yaw || 0;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const bars = Math.max(3, Math.round(w / 0.45));
  for (let i = 0; i < bars; i++) {
    const t = (i / (bars - 1) - 0.5) * w;
    B.add(B.kit.brick(0.09, h, 0.09, 0.02), {
      p: [o.x + cs * t, o.y + h / 2, o.z - sn * t], r: [0, yaw, 0], color: C.iron, ink: false,
    });
    B.add(B.kit.cone(0.08, 0.24, 4), {
      p: [o.x + cs * t, o.y - 0.1, o.z - sn * t], r: [Math.PI, yaw, 0], color: C.ironLit, ink: false,
    });
  }
  for (let j = 0; j < 3; j++) {
    B.add(B.kit.brick(w, 0.08, 0.08, 0.02), {
      p: [o.x, o.y + h * (0.2 + j * 0.32), o.z], r: [0, yaw, 0], color: C.iron, ink: false,
    });
  }
  B.block(o.x, o.y + h / 2, o.z, Math.max(Math.abs(cs * w), 0.3), h, Math.max(Math.abs(sn * w), 0.3));
}

/** 枯樹。從石縫裡長出來的那一種：主幹兩段、分枝遞迴兩層。 */
export function deadTree(B, o) {
  const r = rng(o.seed);
  const s = o.s || 1;
  const limb = (x, y, z, len, rad, pitch, yaw2, depth) => {
    const hx = Math.sin(pitch) * Math.sin(yaw2), hy = Math.cos(pitch), hz = Math.sin(pitch) * Math.cos(yaw2);
    B.add(B.kit.drum(rad * 0.7, rad, len, 6), {
      p: [x + hx * len / 2, y + hy * len / 2, z + hz * len / 2],
      r: [pitch * Math.cos(yaw2), yaw2, -pitch * Math.sin(yaw2)],
      color: depth ? C.woodDark : C.wood,
    });
    if (depth >= 2 || len < 0.4) return;
    const n = 2 + (r() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      limb(
        x + hx * len, y + hy * len, z + hz * len,
        len * r.range(0.5, 0.72), rad * 0.62,
        pitch + r.range(0.25, 0.75) * (i % 2 ? 1 : -1),
        yaw2 + r.range(-1.2, 1.2), depth + 1,
      );
    }
  };
  limb(o.x, o.y || 0, o.z, 1.6 * s, 0.22 * s, r.range(-0.12, 0.12), r() * 6.28, 0);
  B.block(o.x, (o.y || 0) + 1, o.z, 0.5 * s, 2 * s, 0.5 * s);
  for (let i = 0; i < 4; i++) {
    B.add(B.kit.brick(0.4 * s, 0.14 * s, 0.34 * s, 0.03), {
      p: [o.x + r.range(-0.6, 0.6) * s, (o.y || 0) + 0.06, o.z + r.range(-0.6, 0.6) * s],
      r: [0, r() * 3, 0], color: C.stoneDeep, ink: false,
    });
  }
}

/** 井。一圈石、兩根柱、一根橫木、一只吊桶。 */
export function well(B, o) {
  const r = rng(o.seed);
  const y = o.y || 0, R = o.r || 1.1;
  const n = 12;
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < n; i++) {
      if (c === 1 && r() < 0.28) continue;              // 上皮缺幾塊
      const a = (i / n) * Math.PI * 2 + c * 0.13;
      B.add(B.kit.brick(0.55, 0.34, 0.42, 0.05), {
        p: [o.x + Math.cos(a) * R, y + 0.17 + c * 0.36, o.z + Math.sin(a) * R],
        r: [0, -a, 0], color: stoneTone(r), solid: true,
      });
    }
  }
  B.add(B.kit.drum(R * 0.78, R * 0.78, 0.1, 12), { p: [o.x, y + 0.05, o.z], color: 0x161310, ink: false });
  for (const side of [-1, 1]) {
    B.add(B.kit.brick(0.14, 1.7, 0.14, 0.03), { p: [o.x + side * R * 0.85, y + 0.85, o.z], color: C.wood });
  }
  B.add(B.kit.brick(R * 2.1, 0.13, 0.13, 0.03), { p: [o.x, y + 1.7, o.z], color: C.woodDark });
  B.add(B.kit.drum(0.13, 0.13, R * 1.3, 8), { p: [o.x, y + 1.55, o.z], r: [0, 0, Math.PI / 2], color: C.wood });
  chain(B, { from: [o.x + 0.1, y + 1.5, o.z], to: [o.x + 0.1, y + 0.9, o.z], n: 5, sag: 0 });
  B.add(B.kit.drum(0.2, 0.17, 0.3, 8), { p: [o.x + 0.1, y + 0.75, o.z], color: C.woodDark });
  B.block(o.x, y + 0.5, o.z, R * 2.2, 1, R * 2.2);
}
