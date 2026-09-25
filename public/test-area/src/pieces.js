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

import { stone, drum, spike, blob, ring, cloth, gablePrism, cap, rng, hashAt } from './geom.js';
import { C } from './palette.js';
import { BLOCK_TOP, TRIP } from './walk.js';

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
  /** @param {number} [v] 缺角的變體，0 = 完整（見 geom.js 的 stone）。 */
  brick(w, h, d, ch = 0.045, v = 0) {
    const q = (x) => Math.round(x * 50) / 50;
    return this._get(`b${q(w)},${q(h)},${q(d)},${q(ch)},${v}`, () => stone(q(w), q(h), q(d), ch, v));
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
  cap(r, h, seg = 14) {
    const q = (v) => Math.round(v * 50) / 50;
    return this._get(`h${q(r)},${q(h)},${seg}`, () => cap(q(r), q(h), seg));
  }
  gable(w, h, d) {
    const q = (v) => Math.round(v * 50) / 50;
    return this._get(`g${q(w)},${q(h)},${q(d)}`, () => gablePrism(q(w), q(h), q(d)));
  }
  cloth(w, h, wave, tail = 0) {
    const q = (v) => Math.round(v * 50) / 50;
    return this._get(`f${q(w)},${q(h)},${q(wave || 0.16)},${q(tail)}`, () => cloth(q(w), q(h), wave, q(tail)));
  }
}

/* 石材四階。挑哪一階不是隨機挑的：同一皮磚裡混兩三階才有砌體的感覺，
   但整體要偏中階，不然一面牆看起來像馬賽克。 */
const COURSE = [C.stone, C.stone, C.stoneLit, C.stoneDark, C.stone, C.stoneDeep];
const stoneTone = (r) => COURSE[Math.floor(r() * COURSE.length)];

/* 缺角：一塊砌石是完整的還是被敲掉一兩個角，由它的位置決定（三成完整、
   其餘三種缺法）。用位置不用亂數器，是因為零件的亂數序列一個都不能多抽
   ——多抽一個，後面哪根柱子斷、哪裡撒碎石就全部換掉了。 */
const CHIPS = 3;
const chipAt = (x, y, z) => {
  const h = hashAt(x, y, z, 9);
  return h < 0.3 ? 0 : 1 + Math.min(CHIPS - 1, Math.floor(((h - 0.3) / 0.7) * CHIPS));
};

/* ── 地板 ────────────────────────────────────────────────────────
   中央空地。這是唯一一片「必須乾淨」的區域：狗要在上面跑，所以石板是
   平的、沒有一塊突出來會卡腳的東西。缺塊處直接不畫（露出底下的土色
   地面），苔只長在縫上，兩者都不影響行走。

   `keep(x, z)` 給每一格一個留下來的機率（0～1），疊在殘破之上：一條路要在
   哪裡慢慢稀疏、斷掉，由呼叫端說。留不留用位置決定（hashAt），不多抽亂數。 */
export function flagstones(B, o) {
  const r = rng(o.seed);
  const cell = o.cell || 1.5;
  const nx = Math.round(o.w / cell), nz = Math.round(o.d / cell);
  const y = o.y || 0;

  /* ── 基座 ──────────────────────────────────────────────────────
     石板底下的填層。少一塊石板看到的是這個（暗一階的花崗岩），而不是
     一個洞：地面層看到的是 10 cm 下的填石，抬高的鋪面（城牆露台）看到的
     是樓板——那 11 塊缺掉的石板以前是看穿到 3.2 公尺底下的真洞，因為
     台體只砌了四周的牆，中間是中空的。

     `out` 讓基座比鋪面往外放一點：露台的基座要壓在四道牆的牆頂上，
     它才有東西頂著（不然基座自己就是一塊浮在空中的樓板）。 */
  const out = o.out || 0.3;
  if (o.round) {
    // 圓的房間要圓的基座：方的基座會在環牆的四個對角戳出去 2.6 公尺，
    // 而以前看不出來是因為那幾格石板剛好多半是缺的。
    B.add(B.kit.drum(o.round + out, o.round + out, 0.35, 24), {
      p: [o.x, y - 0.275, o.z], color: C.graniteDark, ink: false,
    });
  } else {
    B.add(B.kit.brick(o.w + out * 2, 0.35, o.d + out * 2, 0.06), {
      p: [o.x, y - 0.275, o.z], color: C.graniteDark, ink: false,
    });
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const cx = o.x + (i - (nx - 1) / 2) * cell;
      const cz = o.z + (j - (nz - 1) / 2) * cell;
      // 從中心往外，缺塊機率上升：中間要能跑，邊緣才准爛。
      if (o.round && Math.hypot(cx - o.x, cz - o.z) > o.round - cell * 0.35) continue;
      const q = o.round
        ? Math.hypot(cx - o.x, cz - o.z) / o.round
        : Math.max(Math.abs(cx - o.x) / (o.w / 2), Math.abs(cz - o.z) / (o.d / 2));
      if (r() < (o.ruin || 0.3) * q * q) continue;
      if (o.keep && hashAt(cx, y, cz, 17) >= o.keep(cx, cz)) continue;
      const gap = 0.06 + r() * 0.05;
      const th = 0.18 + r() * 0.05;
      B.add(B.kit.brick(cell - gap, th, cell - gap, 0.05, chipAt(cx, y, cz)), {
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
     出一片看不見的地板可以站。

     鋪面是一整塊平的（'floor'），跟上面那些石板一塊都不對應——石板的
     厚度、缺塊、砌歪全部是視覺，腳下永遠是這一塊。這就是「視覺凹凸
     獨立於行走平坦」在最基本的地方的樣子。 */
  B.block(o.x, y - 0.2, o.z, o.w, 0.4, o.d, { kind: 'floor', base: y - 0.4 });
  B.floors.push({ x: o.x, z: o.z, w: o.w, d: o.d, y, cell, round: o.round || 0 });
}

/** 一小叢苔。三片扁石加兩三根草，只長在地上與石頭頂面。 */
export function mossTuft(B, x, y, z, r) {
  /* 長不長看那一張圖的苔量（B.mossRate），由位置決定。亂數照樣全部抽完——
     不長的那一叢也要抽，不然後面每一個零件的亂數都往前錯一格，版面就變了。 */
  const show = B.mossRate >= 1 || hashAt(x, y, z, 13) < B.mossRate;
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    /* 小一點、暗一點。第一版是 0.34 見方、一半用亮綠，畫出來像有人在
       地上潑了油漆——苔是「石縫的顏色變了」，不是一塊綠色的東西。 */
    const p = [x + r.range(-0.22, 0.22), y + 0.02, z + r.range(-0.22, 0.22)];
    const rot = [0, r() * Math.PI, 0];
    const color = r() < 0.28 ? C.moss : C.mossDark;
    if (show) B.add(B.kit.brick(0.24, 0.04, 0.21, 0.015), { p, r: rot, color, ink: false, tag: 'moss' });
  }
  if (r() < 0.6) {
    const rot = [r.range(-0.3, 0.3), 0, r.range(-0.3, 0.3)];
    if (show) B.add(B.kit.cone(0.06, 0.3, 5), { p: [x, y + 0.15, z], r: rot, color: C.moss, ink: false, tag: 'moss' });
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
   一皮一皮砌，丁順交錯（每皮的起點錯開半塊）。

   ── 殘破只有一個來源：牆頂那條輪廓（skyline）─────────────────────
   第一版有兩套殘破疊在一起：一條輪廓，加上「每塊磚各自有機率掉」。後者
   是「一堆碎料浮在空中」的來源，而且它量得出來——牆只有一塊磚厚，所以
   隨機掉掉一塊就是一個看得穿的孔（掃出來 4～12% 的格子是透的），而上面
   那皮的磚有可能兩邊的支撐都被掉掉，於是它就掛在半空中。

   現在磚一律砌在輪廓以下，沒有第二套機制：結構上不可能穿孔、不可能有
   一塊磚底下是空的。輪廓 = 兩個不成比例的正弦（走多長都不重複）＋ 少數
   幾個咬下去的缺口。缺口咬的是牆頂的邊緣，不是牆身中間的一塊——所以
   「牆頂以下不透光」這條規則仍然成立，而「塌了一角」的破相還在。

   缺口只有兩種結局：咬到 BREACH_MIN 以上（還是一道牆），或者整段咬光
   （一個豁口，走得過去）。中間那種半公尺高的殘垣是最糟的——畫面上是
   一道牆，腳下卻是一個抬得上去又站不穩的東西。

   ── 牆芯 ────────────────────────────────────────────────────────
   外皮是一塊一塊砌的，磚縫 2 cm、砌歪 ±2 cm，而牆只有一塊磚厚，所以那些
   縫是穿透的。牆芯是一片比外皮薄的實心牆，貼在中間：縫變成暗縫而不是
   亮洞，兩道牆在轉角各自少半塊磚留下的那個缺口也一起補上。牆芯不出頭
   ——每一段的頂取那一段輪廓的最低點並收到整皮，所以牆頂的參差看得見。
   ------------------------------------------------------------------ */

/** 牆要嘛站得住，要嘛整段沒了。一皮的高度就是那條界線。 */
const BREACH_MIN = 0.44;

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

  /* 缺口。長度每七公尺一個、乘上殘破度，所以短牆通常一個都沒有。
     深度夾在「還剩一皮以上」與「咬光」之間，不會停在半公尺。 */
  const bites = [];
  const nb = ruin > 0.12 ? Math.round((ruin * len) / 7) : 0;
  for (let i = 0; i < nb; i++) {
    bites.push({ at: r() * len, half: r.range(0.6, 1.6), deep: r.range(0.4, 0.95) });
  }

  /**
   * 牆頂的輪廓。s 是離牆中點的距離。
   * @returns {number} 相對牆底的高度（0 = 這一段整段沒了）
   */
  function skyline(s) {
    const decay = 0.5 + 0.5 * Math.sin(s / 3.1) * Math.sin(s / 7.7 + 1.7);
    let h = top * (1 - ruin * 0.42 * decay);
    for (const b of bites) {
      const d = Math.abs(s + len / 2 - b.at);
      if (d >= b.half) continue;
      // 缺口的底是圓的，兩側收進去：直上直下的缺口看起來像被切過的。
      h = Math.min(h, top * (1 - b.deep * (1 - (d / b.half) ** 2)));
    }
    if (h < BREACH_MIN) h = h < BREACH_MIN * 0.5 ? 0 : BREACH_MIN;
    return Math.min(h, top);
  }

  /** 那一條上，最高那塊磚的頂面（絕對 y）。垛口與獸像坐在這上面。 */
  function surfaceAt(t) {
    const cmax = Math.floor(skyline((t - 0.5) * len) / bh - 0.5);
    return cmax < 0 ? y0 : y0 + bh * (cmax + 1) - 0.01;
  }

  /* 錯開半塊的那一皮，最後一塊磚的中心就在牆的端頭上，多出去半塊——平常
     那半塊插進隔壁那一段牆裡，看不到。隔壁那一段在某個高度開了洞（圓塔的
     門）的話，它就斜插在洞裡。`flush` 給這一頭（`from`／`to`）一段絕對高度
     [y0, y1]：那段高度裡的磚裁到端頭為止，不伸出去。 */
  const flush = o.flush || {};
  const flushed = (end, y) => !!end && y > end[0] && y < end[1];

  for (let c = 0; c < courses; c++) {
    const rel = bh * (c + 0.5);            // 離牆底多高——不是絕對 y
    const cy = y0 + rel;
    const stagger = (c % 2) * 0.5;
    const n = Math.ceil(len / bl);
    for (let i = 0; i < n; i++) {
      const t = (i + stagger + 0.5) / n;
      if (t > 1) continue;
      const s = (t - 0.5) * len;
      if (rel > skyline(s)) continue;
      const jut = r() < 0.12 ? r.range(0.05, 0.16) : 0;   // 突出的丁磚
      const wob = r.range(-0.02, 0.02);                    // 砌歪的那一點點
      const s0 = flushed(flush.from, cy) ? Math.max(s - bl / 2, -len / 2) : s - bl / 2;
      const s1 = flushed(flush.to, cy) ? Math.min(s + bl / 2, len / 2) : s + bl / 2;
      const tc = (s0 + s1) / 2 / len + 0.5;
      /* 磚縫只留 2 cm，倒角也收到 3.5 cm。第一版是 6 cm 縫加 5 cm 倒角，
         畫出來一面牆是一堆各自漂浮的方塊而不是砌體——那兩個數字加起來
         就是縫的視覺寬度，而砌體的縫必須比石頭薄一個數量級。 */
      const bx = x0 + dx * tc + nrm[0] * wob, bz = z0 + dz * tc + nrm[1] * wob;
      B.add(B.kit.brick(s1 - s0 - 0.02, bh - 0.02, th + jut, 0.035, chipAt(bx, cy, bz)), {
        p: [bx, cy, bz],
        r: [0, yaw + r.range(-0.02, 0.02), 0],
        color: stoneTone(r),
      });
    }
  }

  /* 牆芯。一公尺一段，每段的頂取那一段輪綂的最低點再收到整皮——所以
     芯永遠在外皮之下，牆頂的參差與缺口都還看得見。段給得比外皮的磚長
     一點（1.0 vs 0.95）是為了讓芯的接縫和磚的接縫錯開。 */
  const coreParts = [];                    // [t0, t1, 芯的高度]
  /* 一段一段往下切：那一段的輪廓起伏超過一皮就對半再切，切到 0.25 公尺
     為止。平的牆一段一塊芯（一公尺一塊）；缺口的邊緣自己會細下去，所以
     芯永遠貼在輪廓底下一皮之內——不然缺口旁邊會留下一大片只有一塊磚厚
     的外皮，而那一片的磚縫是穿透的。 */
  const emitCore = (s0, s1) => {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k <= 4; k++) {
      const v = skyline(s0 + (s1 - s0) * (k / 4));
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    if (hi - lo > bh * 1.1 && s1 - s0 > 0.12) {
      const mid = (s0 + s1) / 2;
      emitCore(s0, mid); emitCore(mid, s1);
      return;
    }
    const hc = Math.floor(lo / bh) * bh;
    coreParts.push([(s0 + len / 2) / len, (s1 + len / 2) / len, hc]);
    if (hc < bh * 0.9) return;              // 這一段是豁口，芯也不能有
    const t = (s0 + s1) / 2 / len + 0.5;
    B.add(B.kit.brick(s1 - s0 + 0.03, hc, th * 0.55, 0.02), {
      p: [x0 + dx * t, y0 + hc / 2, z0 + dz * t],
      r: [0, yaw, 0],
      color: C.stoneDeep, ink: false,
    });
  };
  {
    const n0 = Math.max(1, Math.round(len / 1.0));
    for (let i = 0; i < n0; i++) emitCore((i / n0 - 0.5) * len, ((i + 1) / n0 - 0.5) * len);
  }
  /** 牆芯在這一條上砌到多高（絕對 y）。y0 就是那一段沒有芯。 */
  const coreAt = (t) => {
    for (const [t0, t1, h] of coreParts) if (t >= t0 - 1e-9 && t <= t1 + 1e-9) return y0 + h;
    return y0;
  };

  /* 碰撞：沿長度切成一公尺左右的小段，一段一個盒子，高度跟著輪廓走。

     碰撞盒是軸對齊的，而斜著的一道牆，它的軸對齊外接盒是一個大矩形：
     圓塔水窖的環牆是十六段斜牆，每段用一個盒子的話，那十六個大矩形疊起
     來會把四個門洞全部封住，而畫面上門洞明明是開的。切成小段之後，
     每一段的外接盒幾乎就是那一段牆本身。

     高度不再一律是 `top`：被咬掉的那一段如果照 `top` 登記，畫面上是一個
     豁口、腳下卻是一道看不見的牆。取那一小段的最高點，所以碰撞永遠蓋得住
     看得到的磚，而豁口是真的豁口。 */
  const parts = Math.max(1, Math.ceil(len / 1.2));
  const sub = len / parts;
  for (let i = 0; i < parts; i++) {
    const t = (i + 0.5) / parts;
    let hi = 0;
    for (let k = 0; k <= 4; k++) {
      hi = Math.max(hi, skyline((i / parts + (k / 4) / parts - 0.5) * len));
    }
    if (hi <= 0) continue;                 // 豁口：不登記
    const w = Math.abs(dir[0]) * sub + Math.abs(nrm[0]) * th;
    const d = Math.abs(dir[1]) * sub + Math.abs(nrm[1]) * th;
    B.block(x0 + dx * t, y0 + hi / 2, z0 + dz * t, Math.max(w, 0.3), hi, Math.max(d, 0.3),
      { kind: 'shell', base: y0 });
  }

  /* 登記這道牆。verify 拿它去掃「牆身之內有沒有看得穿的格子」——那一項
     守的是牆芯有沒有漏掉一段，而那是看不出來的。 */
  B.walls.push({ from: [x0, z0], to: [x1, z1], y0, thick: th, h: top, course: bh, surfaceAt, coreAt });

  /** 世界上某一點投影到這道牆上之後，牆頂在多高。垛口與獸像用。 */
  const topAtPoint = (px, pz) => {
    const L2 = dx * dx + dz * dz;
    const u = L2 > 0 ? ((px - x0) * dx + (pz - z0) * dz) / L2 : 0.5;
    return surfaceAt(Math.max(0, Math.min(1, u)));
  };

  return {
    yaw, len, y0, a: [x0, z0], b: [x1, z1],
    top: y0 + top, topAt: surfaceAt, topAtPoint, coreAt, skyline,
  };
}

/**
 * 女牆：牆頂一排垛口。城牆才有，中庭的矮牆沒有。
 *
 * `on` 是那道牆的回傳值。垛口坐在牆頂**實際的**高度上，不是坐在一個
 * 給定的 y 上——牆頂被咬掉一塊的地方就不放垛，所以不會有垛浮在半空。
 * 這是「每塊石頭底下要有東西頂著」那條規則在這支零件裡的樣子。
 */
export function merlons(B, o) {
  const r = rng(o.seed);
  const [x0, z0] = o.from, [x1, z1] = o.to;
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const yaw = yawOf(dx, dz);
  const pitch = o.pitch || 1.5;
  const n = Math.floor(len / pitch);
  const w = o.on;
  for (let i = 0; i < n; i++) {
    if (r() < (o.ruin || 0.3)) continue;         // 缺的那幾個垛
    const t = (i + 0.5) / n;
    /* 牆頂在哪。給了 `on` 就問那道牆——牆是用它自己的座標算輪廓的，
       所以要把「這個垛在整道牆上的位置」換算成那道牆的 t。 */
    let base = o.y;
    if (w) {
      base = w.topAtPoint(x0 + dx * t, z0 + dz * t);
      if (base <= w.y0 + 0.02) continue;         // 這一段牆整段沒了
    }
    const h = (o.h || 0.9) * r.range(0.82, 1.0);
    B.add(B.kit.brick(pitch * 0.62, h, (o.thick || 0.9) * 0.9, 0.06, chipAt(x0 + dx * t, base, z0 + dz * t)), {
      p: [x0 + dx * t, base + h / 2, z0 + dz * t],
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

  /* 台基兩階是**視覺**的：它的頂面在 0.48，而那剛好是「跳一下站得上去、
     站上去又只有半公尺」的高度。柱子是障礙物，不是踏腳石，所以整根用
     下面那一個 'block' 登記，台基不各自登記。 */
  B.add(B.kit.brick(rad * 2.7, 0.26, rad * 2.7, 0.07), { p: [o.x, y + 0.13, o.z], color: C.stoneDark });
  B.add(B.kit.brick(rad * 2.3, 0.22, rad * 2.3, 0.06), { p: [o.x, y + 0.37, o.z], color: C.stone });

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
        // 嵌在斷面上，不是擺在斷面上方 6 cm——那 6 cm 就是「浮著」。
        p: [o.x + r.range(-rad, rad) * 0.6, topY, o.z + r.range(-rad, rad) * 0.6],
        r: [r.range(-0.4, 0.4), r() * Math.PI, r.range(-0.4, 0.4)],
        color: C.stoneDeep,
      });
    }
    if (r() < 0.7) mossTuft(B, o.x, topY + 0.02, o.z, r);
  } else {
    B.add(B.kit.drum(rad * 1.25, rad * 1.02, 0.2, 10), { p: [o.x, topY + 0.1, o.z], color: C.stoneLit });
    B.add(B.kit.brick(rad * 2.5, 0.24, rad * 2.5, 0.07), { p: [o.x, topY + 0.32, o.z], color: C.stone });
  }
  /* 碰撞：台基是方的（它真的是兩塊方石），柱身是圓的。以前整根是一個
     台基那麼寬的方盒，於是繞著柱子走會在四個角上各被頂開一次——而畫面
     上那四個角只存在於最底下那 48 公分。

     柱身的半徑取柱頭那一圈（rad×1.3，鼓身只有 rad）：碰撞體寧可胖一點，
     瘦的話身體會陷進石頭裡。斷得最低的柱子頂面也有 1.1，過得了 BLOCK_TOP。 */
  B.block(o.x, y + 0.24, o.z, rad * 2.7, 0.48, rad * 2.7, { kind: 'shell', base: y });
  B.round(o.x, o.z, rad * 1.3, y, topY, { kind: 'block', base: y });
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

  B.hangs(true);                                        // 楔石靠的是隔壁那一塊
  let apex = -Infinity;                                 // 實際砌到的最高點
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
      /* 這一塊楔石的頂面到哪。楔石是斜的，所以不是「弧上的高度加半個
         磚厚」——要把旋轉算進去。拱背上要砌東西的人靠這個數字，不能靠
         「頂點應該在哪」：拱的殘破是從頂點開始吃的。 */
      apex = Math.max(apex, y + ly + (th / 2) * Math.abs(Math.cos(roll)) + 0.2 * Math.abs(Math.sin(roll)));
      B.add(B.kit.brick(0.4, th, depth, 0.05, chipAt(o.x + dir[0] * lx, y + ly, o.z + dir[1] * lx)), {
        p: [o.x + dir[0] * lx, y + ly, o.z + dir[1] * lx],
        r: [0, yaw, roll],
        color: stoneTone(r),
      });
    }
  }
  B.hangs(false);
  /* `apex` 給拱背上要砌東西的人用：拱的殘破是從頂點開始吃的，所以一道
     半塌的拱沒有頂——而坐在「那個頂應該在的地方」的填牆會浮在空中。
     這件事在畫面上看起來就是一排磚飄在拱洞上方。 */
  return { crown: y + rise, apex };
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
      const q = at(t + r.range(-0.02, 0.02), (o.y || 0) + 0.44 * (c + 0.5), 0);
      B.add(B.kit.brick(pier, 0.44 - 0.05, o.depth || 0.9, 0.05, chipAt(q[0], q[1], q[2])), {
        p: q,
        r: [0, yaw, 0],
        color: stoneTone(r),
      });
    }
    B.block(p[0], p[1], p[2], Math.max(pier, 0.5), h, Math.max(o.depth || 0.9, 0.5),
      { kind: 'block', base: o.y || 0 });
    // 柱頭一塊出簷的。
    B.add(B.kit.brick(pier * 1.3, 0.2, (o.depth || 0.9) * 1.25, 0.06), {
      p: at(t, springer + 0.1, 0), r: [0, yaw, 0], color: C.stoneLit,
    });
  }

  for (let i = 0; i < bays; i++) {
    const t = (i - bays / 2 + 0.5) * pitch;
    const c = at(t, 0, 0);
    const bayRuin = Math.min(1, (o.ruin || 0) * r.range(0.4, 1.8));
    const arch = pointedArch(B, {
      x: c[0], z: c[2], y: springer + 0.2, span, rise: span * 0.8, yaw,
      thick: 0.4, depth: (o.depth || 0.9) * 0.95, ruin: bayRuin, seed: o.seed + 17 * i + 3,
    });
    /* 拱背上的填牆，讓拱廊有一道連續的簷。第一皮坐在拱**實際**砌到的
       最高點上——以前是坐在「跨度中間 + 0.35」，那個數字比拱背低半公尺，
       所以那一排磚的下緣懸在拱洞裡、還跟拱圈在同一個進深上互相穿插；
       而拱一旦缺了頂，整排就飄在空中。缺了頂的那一跨就不填。 */
    if (arch.apex > springer + 0.2 + span * 0.8 - 0.12) {
      /* 一皮一塊，橫跨整跨，第一皮坐在拱背上（拱**實際**砌到的最高點）。

         以前是一皮三塊、而且底面比拱背低半公尺：那一排磚的下緣懸在拱洞
         裡、跟拱圈在同一個進深上互相穿插，而拱一旦缺了頂，三塊裡至少
         一塊會飄在空中——磚縫 6 cm，旁邊那一塊也接不住它。整跨一塊就沒有
         這個問題，而且這道簷本來就是一條連續的壓頂，不是砌體。 */
      const extrados = arch.apex - 0.04;
      for (let c2 = 0; c2 < 2; c2++) {
        B.add(B.kit.brick(pitch - 0.08, 0.42, (o.depth || 0.9) * (0.9 + c2 * 0.12), 0.05), {
          p: at(t, extrados + 0.21 + 0.42 * c2, 0), r: [0, yaw, 0],
          color: c2 ? C.stoneLit : stoneTone(r),
        });
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
  /* 碰撞：整座一個盒子，不是逐階一個。逐階的話最低那一階自己是一個
     頂面一公尺的小平台——爬得上去，然後站在扶壁的第一階上，而扶壁是
     牆外面的東西。整座一個 'block' 才是它在遊戲裡的意思：繞過去。 */
  const base = o.y || 0;
  const dep0 = out;
  B.block(o.x + Math.sin(yaw) * dep0 / 2, base + h / 2, o.z + Math.cos(yaw) * dep0 / 2,
    Math.abs(Math.cos(yaw)) * (o.w || 1.2) + Math.abs(Math.sin(yaw)) * dep0, h,
    Math.abs(Math.sin(yaw)) * (o.w || 1.2) + Math.abs(Math.cos(yaw)) * dep0,
    { kind: 'block', base });
}

/**
 * 階梯。每一階都是一個碰撞盒，所以真的踩得上去。
 *
 * `ground` 是這道樓梯底下的填石砌到哪裡（預設就是起步的 `y`）。接在另一折
 * 上面的那一折要傳它站著的地面：第二折從 1.6 公尺起步，填石只補到 1.6 的話，
 * 底下那一段是一個看不到、但鑽得進去的空腔。
 */
export function stair(B, o) {
  const r = rng(o.seed);
  const n = o.steps;
  const rise = o.rise || 0.28, run = o.run || 0.6;
  const yaw = o.yaw || 0;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const ground = o.ground === undefined ? (o.y || 0) : o.ground;
  for (let i = 0; i < n; i++) {
    const off = (i + 0.5) * run;
    const x = o.x + sn * off, z = o.z + cs * off;
    const y = (o.y || 0) + rise * (i + 0.5);
    // 缺角：邊上少一塊，露出裡面的填石。
    const w = (o.w || 3) * (r() < 0.25 ? r.range(0.72, 0.95) : 1);
    /* 每一級底下的砌體。少了它，一道兩折的樓梯就是十二塊浮在空中的板
       ——第二折的第一級底下本來什麼都沒有。

       填石取整道樓梯的寬度，不是這一級（可能缺了角）的寬度：缺角露出來
       的必須是填石，否則那一條縫一路看穿到地面。它也是實心的——只登記
       踏板的話，踏板底下就是一段鑽得過去的空氣。登記成 'step'，因為低處
       那幾級的填石頂面落在會絆腳的高度，而那正是階梯才准有的高度。 */
    const fill = y - rise / 2 - ground;
    if (fill > 0.02) {
      B.add(B.kit.brick((o.w || 3) * 0.96, fill, (run + 0.06) * 0.96, 0.04), {
        p: [x, ground + fill / 2, z], r: [0, yaw, 0], color: C.stoneDeep, ink: false,
        solid: 'step', base: ground,
      });
    }
    B.add(B.kit.brick(w, rise, run + 0.06, 0.05), {
      p: [x, y, z], r: [0, yaw, 0],
      color: r() < 0.3 ? C.granite : C.graniteDark,
      solid: 'step',
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

  // 台座是視覺的（頂面 0.56 s 落在會絆腳與站不穩之間）；整座由下面
  // 那個 'block' 登記。
  B.add(B.kit.brick(1.5 * s, 0.3 * s, 1.5 * s, 0.07), { p: [o.x, y + 0.15 * s, o.z], color: C.stoneDark });
  B.add(B.kit.brick(1.25 * s, 0.26 * s, 1.25 * s, 0.06), { p: [o.x, y + 0.43 * s, o.z], color: C.stone });
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
  B.block(o.x, y + 1.1 * s, o.z, 1.55 * s, 2.2 * s, 1.55 * s, { kind: 'block', base: y });
}

/** 蹲踞的獸像。放在牆頭與拱腳，個頭小、剪影兇。 */
export function gargoyle(B, o) {
  const r = rng(o.seed);
  B.hangs(true);                    // 獸像是從牆面挑出去的
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
  B.hangs(false);
  void r;
}

/* ── 碎石 ────────────────────────────────────────────────────────
   遺跡的地面不是空的，但也不能到處都是。撒法照抄 src/gfx/decor.js 的
   clump-and-thin：半徑用 u 而不是 sqrt(u)，再用 u²·0.9 往外圍淘汰，
   所以石堆沒有一條看得出來的邊界。大的幾塊登記碰撞，可以踩上去。 */
/**
 * 一叢碎石。
 *
 * ── 碎石不再有中間尺寸 ──────────────────────────────────────────
 * 以前 16% 的石頭是「大顆」而且登記碰撞，頂面落在 0.4～1.0 之間——那
 * 剛好是最糟的一段：跳一下站得上去（頂點 0.48 + 抬腳 0.36 = 0.84），
 * 站上去又只有半公尺高，所以在房間裡跑起來的地面是坑坑巴巴的。掃出來
 * 全圖有 158 個這種盒子。
 *
 * 現在只有兩種：
 *   碎石   壓進地板，只露 TRIP[0]（8 cm）以下，完全不登記碰撞。看得到
 *          地上有石頭，腳下是平的——這就是要的效果。露太多的話狗的腳會
 *          穿過去，所以不是「不登記碰撞」就好，是要真的壓下去。
 *   大石   `boulders` 這麼多顆，高過 BLOCK_TOP，登記成繞得過去的障礙。
 *          少而大比多而中好看，也是那一路造型語言本來的樣子。
 */
export function rubble(B, o) {
  const r = rng(o.seed);
  const n = o.n || 24;
  const y0 = o.y || 0;
  let boulders = o.boulders || 0;
  for (let i = 0; i < n; i++) {
    const u = r();
    if (r() < u * u * 0.9) continue;
    const ang = r() * Math.PI * 2;
    const rad = u * (o.r || 3);
    const x = o.x + Math.cos(ang) * rad, z = o.z + Math.sin(ang) * rad;
    /* 石堆是「一叢」而不是「一顆」，所以叢的中心在空地外面不代表每一顆
       都在外面。大石是障礙物，擺進走道就是把路堵住，所以逐顆問。 */
    if (o.keep && !o.keep(x, z)) continue;
    const big = boulders > 0 && r() < 0.35;
    if (big) {
      boulders--;
      const h = r.range(1.15, 1.75), rr = r.range(0.5, 0.78);
      /* 一顆石頭最寬的一圈在它的腰上，腰以上是一個圓頂——這是石頭之所以
         叫石頭。跳得上去（頂面 1.4 左右），但站不住：不跳的話會照著
         坡度緩緩滑下來，跳鍵隨時帶得走。 */
      B.add(B.kit.blob(rr, 1), {
        p: [x, y0 + h * 0.42, z], r: [r.range(-0.3, 0.3), r() * 3, r.range(-0.3, 0.3)],
        s: [1.25, h / rr * 0.5, 1.05],
        color: stoneTone(r), solid: 'block', base: y0, grow: -0.06,
        round: 'dome', slip: 'slide',
      });
      if (r() < 0.6) mossTuft(B, x + r.range(-0.4, 0.4), y0 + h * 0.84, z + r.range(-0.3, 0.3), r);
      continue;
    }
    const sz = r.range(0.16, 0.42);
    if (r() < 0.45) {
      const th = sz * 0.8;
      B.add(B.kit.brick(sz * 1.5, th, sz * 1.2, 0.05, chipAt(x, y0, z)), {
        p: [x, y0 + TRIP[0] - th / 2 - 0.01, z],
        r: [r.range(-0.25, 0.25), r() * Math.PI, r.range(-0.25, 0.25)],
        color: stoneTone(r),
      });
    } else {
      /* 壓扁再拉長。正球體的碎石看起來像散落的珠子——石頭是有卧向的，
         而那個卧向是「它掉下來之後停在那裡」的全部訊息。 */
      const hh = sz * 0.7 * 0.62;
      B.add(B.kit.blob(sz * 0.7), {
        p: [x, y0 + TRIP[0] - hh - 0.01, z], r: [r() * 3, r() * 3, r() * 3],
        s: [1.15, 0.62, 0.95],
        color: stoneTone(r),
      });
    }
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
  /* 碰撞：缽是圓的，所以碰撞體也是圓的，半徑取缽口那一圈——不是三隻腳，
     畫面上寬的是缽。到缽口為止，平頂。

     火沒有體積：它逐幀在抖，而會抖的東西當不了碰撞體；一團火焰也沒有
     一個「表面」可以讓人踩。所以缽口以上什麼都不登記。 */
  B.round(o.x, o.z, 0.56 * s, y, y + 1.36 * s, { kind: 'block', base: y });
  if (flames) flames.push({ x: o.x, y: y + 1.44 * s, z: o.z, s });
}

/** 旗。一根橫桿、一片布、桿頭兩顆銅球。 */
/**
 * 旗。
 *
 * `wall`（+1／−1）表示它掛在一道牆的牆面上：`x`／`z` 給的是**牆面**，旗往
 * 牆面的法線方向（+1 是 (sin yaw, cos yaw)）撐出 WALL_CLEAR，兩根托架把旗桿
 * 接回牆上。不給就是懸在兩根柱子之間，位置就是旗桿本身。
 *
 * 撐出去是必要的，不是造型：布面有波浪（±0.18），牆面上有突出的丁磚
 * （外露到 0.1）——旗直接貼在牆面上的話，那幾塊磚會從布裡戳出來。掛在牆上
 * 的布也收平一點（波浪 0.07），真的貼牆掛的旗不會像晾在風裡的布。
 */
const WALL_CLEAR = 0.24;
export function banner(B, o) {
  const s = o.s || 1;
  const yaw = o.yaw || 0;
  const hung = o.wall || 0;
  const nx = Math.sin(yaw) * hung, nz = Math.cos(yaw) * hung;   // 牆面往外的方向
  const ax = Math.cos(yaw), az = -Math.sin(yaw);                  // 旗桿的方向
  const x = o.x + nx * (hung ? WALL_CLEAR : 0), z = o.z + nz * (hung ? WALL_CLEAR : 0);
  B.hangs(true);                    // 旗掛在牆面上
  /* 1.75 × 2.5 而不是 1.3 × 3.0：窄長的布在十幾公尺外只是一條色帶，
     而旗在這種畫面裡的工作是「一塊顏色」——整片廢墟只有它和火是暖色。
     太窄的話那塊顏色不夠大，讀不到。 */
  const w = 1.75 * s, h = 2.5 * s;
  B.add(B.kit.brick(w * 1.25, 0.12 * s, 0.12 * s, 0.04), { p: [x, o.y, z], r: [0, yaw, 0], color: C.woodDark });
  for (const side of [-1, 1]) {
    B.add(B.kit.blob(0.1 * s), {
      p: [x + ax * side * w * 0.66, o.y, z + az * side * w * 0.66],
      color: C.gold, ink: false,
    });
    // 托架：從牆面伸到旗桿，不然一根撐在半空中的旗桿是浮著的。
    if (hung) {
      B.add(B.kit.brick(0.08 * s, 0.1 * s, WALL_CLEAR, 0.02), {
        p: [o.x + ax * side * w * 0.5 + nx * WALL_CLEAR / 2, o.y, o.z + az * side * w * 0.5 + nz * WALL_CLEAR / 2],
        r: [0, yaw, 0], color: C.woodDark,
      });
    }
  }
  /* 下擺剪一個燕尾（布本身的形狀）。以前是另外疊一塊斜放的小磚當「缺口」，
     畫出來就是旗底多了一個小方塊。 */
  B.add(B.kit.cloth(w, h, hung ? 0.07 : 0.18, 0.55 * s), {
    p: [x, o.y - h / 2 - 0.06 * s, z], r: [0, yaw, 0],
    color: o.color || C.banner, ink: false, tag: 'cloth',
  });
  B.hangs(false);
}

/** 垂下來的鎖鏈。兩點之間掛一串環，中間鬆。 */
export function chain(B, o) {
  B.hangs(true);
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
  B.hangs(false);
}

/**
 * 鐵閘。一格一格的柵欄，下緣做成尖的。門檻在 o.y，寬 o.w、高 o.h，沿 yaw 那一條。
 *
 * 可以開關的鐵閘是兩塊（blocks.js 用 `B.detach` 各砌一次）：放下的那一塊有碰撞，
 * 屬於那一組門（`door`，門開著碰撞就不存在）；升起的那一塊沒有碰撞（`solid: false`），
 * 整面往上抬 `lift`，抬進門洞頂上的石頭裡——`ceil(t)` 是沿閘面 t 那一點的頂（拱的
 * 內緣、門楣的底），每一根柵條與橫條都裁到那裡為止，看起來是收進了拱石的槽裡，
 * 而不是穿過拱圈戳到外面。
 *
 * 斜著的鐵閘（水窖的環牆）：碰撞盒是軸對齊的，整面一個盒子的話外接盒會胖到
 * 半公尺以上，於是切成幾段，每段各一個盒子。
 */
export function portcullis(B, o) {
  const w = o.w, h = o.h, yaw = o.yaw || 0;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const bars = Math.max(3, Math.round(w / 0.45));
  const y0 = o.y + (o.lift || 0);
  const top = (t) => Math.min(y0 + h, o.ceil ? o.ceil(t) : Infinity);
  for (let i = 0; i < bars; i++) {
    const t = (i / (bars - 1) - 0.5) * w;
    const bh = top(t) - y0;
    if (bh < 0.1) continue;
    B.add(B.kit.brick(0.09, bh, 0.09, 0.02), {
      p: [o.x + cs * t, y0 + bh / 2, o.z - sn * t], r: [0, yaw, 0], color: C.iron, ink: false,
    });
    B.add(B.kit.cone(0.08, 0.24, 4), {
      p: [o.x + cs * t, y0 - 0.1, o.z - sn * t], r: [Math.PI, yaw, 0], color: C.ironLit, ink: false,
    });
  }
  for (let j = 0; j < 3; j++) {
    const yb = y0 + h * (0.2 + j * 0.32);
    /* 橫條只橫過頂比它高的那幾根柵條——閘收進拱裡的那一截，橫條也跟著收進去。 */
    let reach = 0;                                // 還橫得過去的最外那一根離中線多遠
    for (let i = 0; i < bars; i++) {
      const t = (i / (bars - 1) - 0.5) * w;
      if (top(t) > yb + 0.06) reach = Math.max(reach, Math.abs(t));
    }
    if (!reach) continue;
    B.add(B.kit.brick(2 * reach, 0.08, 0.08, 0.02), {
      p: [o.x, yb, o.z], r: [0, yaw, 0], color: C.iron, ink: false,
    });
  }
  if (o.solid === false) return;
  const k = Math.abs(cs) > 1e-3 && Math.abs(sn) > 1e-3 ? Math.ceil(w / 0.5) : 1;
  const L = w / k;
  for (let i = 0; i < k; i++) {
    const t = ((i + 0.5) / k - 0.5) * w;
    B.block(o.x + cs * t, o.y + h / 2, o.z - sn * t,
      Math.abs(cs) * L + Math.abs(sn) * 0.3, h, Math.abs(sn) * L + Math.abs(cs) * 0.3,
      { kind: 'block', base: o.y, door: o.door });
  }
}

/** 枯樹。從石縫裡長出來的那一種：主幹兩段、分枝遞迴兩層。 */
export function deadTree(B, o) {
  const r = rng(o.seed);
  const s = o.s || 1;
  const limb = (x, y, z, len, rad, pitch, yaw2, depth) => {
    const hx = Math.sin(pitch) * Math.sin(yaw2), hy = Math.cos(pitch), hz = Math.sin(pitch) * Math.cos(yaw2);
    // 樹枝是懸臂：它接在上一段的末端，底下本來就沒有東西。樹幹（depth 0）
    // 不算——那一段必須從地面長起來。
    B.add(B.kit.drum(rad * 0.7, rad, len, 6), {
      hang: depth > 0,
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
  /* 樹幹是一根圓的（它就是一支 drum），從地面起算：以前是
     [y+1−s, y+1+s] 的一個方盒，小一點的樹底下就留了一段離地 30 cm 的縫，
     而縫底下是看得到的樹幹。 */
  B.round(o.x, o.z, 0.25 * s, o.y || 0, (o.y || 0) + 1.7 * s,
    /* 樹頂是一把枝椏：那是一堆細長的東西，不是一個踩得住的面，所以收成
       一個不可踩的圓頂。矮一點的樹（s < 0.87）跳得到，跳到了會滑下來。 */
    { kind: 'block', base: o.y || 0, dome: 0.3 * s, slip: 'fall' });
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
      const wx = o.x + Math.cos(a) * R, wy = y + 0.17 + c * 0.36, wz = o.z + Math.sin(a) * R;
      B.add(B.kit.brick(0.55, 0.34, 0.42, 0.05, chipAt(wx, wy, wz)), {
        p: [wx, wy, wz],
        r: [0, -a, 0], color: stoneTone(r),
      });
    }
  }
  B.add(B.kit.drum(R * 0.78, R * 0.78, 0.1, 12), { p: [o.x, y + 0.05, o.z], color: 0x161310, ink: false });
  for (const side of [-1, 1]) {
    B.add(B.kit.brick(0.14, 1.7, 0.14, 0.03), { p: [o.x + side * R * 0.85, y + 0.85, o.z], color: C.wood });
  }
  B.add(B.kit.brick(R * 2.1, 0.13, 0.13, 0.03), { p: [o.x, y + 1.7, o.z], color: C.woodDark });
  B.hangs(true);                    // 絞盤的軸與吊桶是掛在兩根柱之間的
  B.add(B.kit.drum(0.13, 0.13, R * 1.3, 8), { p: [o.x, y + 1.55, o.z], r: [0, 0, Math.PI / 2], color: C.wood });
  B.hangs(false);
  chain(B, { from: [o.x + 0.1, y + 1.5, o.z], to: [o.x + 0.1, y + 0.9, o.z], n: 5, sag: 0 });
  B.hangs(true);
  B.add(B.kit.drum(0.2, 0.17, 0.3, 8), { p: [o.x + 0.1, y + 0.75, o.z], color: C.woodDark });
  for (const [hy, hr] of [[0.66, 0.184], [0.84, 0.202]]) {
    B.add(B.kit.drum(hr, hr, 0.035, 8), { p: [o.x + 0.1, y + hy, o.z], color: C.iron, ink: false });
  }
  B.hangs(false);
  if (o.open) {
    /* 開著的井：井圈是一圈站得上去的石頭，中間是一個坑。井圈照石頭本身
       登記——十二根小圓柱，頂面在第二皮的頂（0.7），相鄰兩根重疊，所以
       是一圈連續的邊，不是一排柱子。坑口的半徑就是那片黑色的井口。 */
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      B.round(o.x + Math.cos(a) * R, o.z + Math.sin(a) * R, 0.33, y, y + 0.7, { kind: 'floor', base: y });
    }
    B.pit(o.x, o.z, R * 0.78, y, y - 8);
  } else {
    /* 井口的石圈是障礙，不是矮台。半徑取石塊往外凸出來的那一圈
       （R + 0.21，石塊是 0.42 深、擺在 R 上），不是 R 本身。 */
    const wh = BLOCK_TOP + 0.1;
    B.round(o.x, o.z, R + 0.21, y, y + wh, { kind: 'block', base: y });
  }
}

/* ── 木箱與木桶 ──────────────────────────────────────────────────
   木頭的形狀是一片一片的：木箱是一個暗色的箱芯，四面各釘三片橫板、四角
   四根角柱、頂上三片蓋板；木桶是桶身加上下兩道鐵箍與一片桶蓋。一整塊
   方的木頭上貼再好的木紋，看起來仍然是一塊木頭，不是一只箱子——板與板
   之間那一道暗縫才是「這是釘起來的」。

   碰撞跟以前的那一整塊一模一樣（邊長 s 的方盒，轉過 yaw 之後的外接盒），
   所以跳上去、疊起來的高度一公分都沒變。板子凸出箱芯 3 公分，頂面剛好
   落回 s——腳底下就是蓋板的頂面。 */

/** 一只木箱：底面中心 (x, y, z)，邊長 s，繞 y 轉 yaw。 */
export function crate(B, x, y, z, yaw, s = 0.9) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const at = (lx, ly, lz) => [x + cs * lx + sn * lz, y + ly, z - sn * lx + cs * lz];
  const T = 0.03;                           // 板厚
  const core = s - 2 * T;
  B.add(B.kit.brick(core, s - T, core, 0.02), { p: at(0, (s - T) / 2, 0), r: [0, yaw, 0], color: C.woodDark });
  // 四面的橫板，每面三片。板在兩根角柱之間。
  const ph = (s - T) / 3, pl = s - 0.16;
  for (let f = 0; f < 4; f++) {
    const a = yaw + (f * Math.PI) / 2;
    const off = s / 2 - T / 2;
    const fx = Math.sin(f * Math.PI / 2) * off, fz = Math.cos(f * Math.PI / 2) * off;
    for (let i = 0; i < 3; i++) {
      B.add(B.kit.brick(pl, ph - 0.025, T, 0.012), { p: at(fx, ph * (i + 0.5), fz), r: [0, a, 0], color: C.wood });
    }
  }
  // 四根角柱，從地面到蓋板底下。
  for (const [ux, uz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const k = s / 2 - 0.045;
    B.add(B.kit.brick(0.09, s - T, 0.09, 0.015), { p: at(ux * k, (s - T) / 2, uz * k), r: [0, yaw, 0], color: C.woodDark });
  }
  // 頂上三片蓋板。
  const tw = s / 3;
  for (let i = 0; i < 3; i++) {
    B.add(B.kit.brick(s - 0.02, T, tw - 0.022, 0.012), { p: at(0, s - T / 2, (i - 1) * tw), r: [0, yaw, 0], color: C.wood });
  }
  const hx = (s / 2) * (Math.abs(cs) + Math.abs(sn));
  B.block(x, y + s / 2, z, hx * 2, s, hx * 2, { kind: 'floor', base: y });
}

/** 一只木桶：底面中心 (x, y, z)。桶身是 10 片的柱（每一片就是一片桶板）。 */
export function barrel(B, x, y, z) {
  B.add(B.kit.drum(0.38, 0.34, 1.0, 10), { p: [x, y + 0.5, z], color: C.woodDark, solid: 'floor', round: true });
  // 兩道鐵箍：桶身是上寬下窄的，箍的半徑照它在那個高度的半徑再外放 1 公分。
  for (const hy of [0.2, 0.8]) {
    const hr = 0.34 + 0.04 * hy + 0.012;
    B.add(B.kit.drum(hr, hr, 0.06, 10), { p: [x, y + hy, z], color: C.iron, ink: false });
  }
  // 桶蓋：比桶口內縮一點、低一點，桶口的那一圈邊就看得出來。
  B.add(B.kit.drum(0.33, 0.33, 0.03, 10), { p: [x, y + 0.985, z], color: C.wood, ink: false });
}

/* ── 營地 ────────────────────────────────────────────────────────
   城牆步道牆下那一片兵營的零件（造景，走不到）：圓帳、武器架、練習假人、箭靶、
   炊事的火、糧袋堆、柴堆、營前的軍旗。全部是布、木、稻草與鐵——石頭
   留給牆，營地的東西一眼就要讀得出是「搬來的」而不是「砌的」。

   碰撞照 DEVNOTES 的分法：
     圓帳       圓柱加圓頂，'slide'。帳篷頂就是一片屋頂，跳上去會緩緩滑下來。
     武器架     方盒 'block'，頂面拉過 MOUNT：一排槍尖不是一個踩得住的面，
                而方盒沒有圓頂可以滑，所以乾脆讓人跳不上去。
     假人、箭靶 圓柱加圓頂，'fall'。頂上是橫木、頭、一面立著的靶——一堆
                做不出踩得住的面的形狀。
     火         圓柱加圓頂，'fall'。設定上就危險。
     糧袋、柴堆 'floor'：一層一層疊平的，本來就是給人爬的。

   只影響外觀的變化（麻袋的歪斜、布的顏色）一律用 hashAt，不抽零件的亂數。
   ------------------------------------------------------------------ */

/** 把局部的一個方向（長在 local y 上的東西）轉成歐拉角：local +y 轉到 (tx, ty, tz)。 */
const tilt = (tx, ty, tz) => {
  const L = Math.hypot(tx, ty, tz);
  return [Math.atan2(tz, ty), 0, -Math.asin(tx / L)];
};

/** 一根從 a 拉到 b 的桿子或繩子：截面 t×t，長在 local y 上。 */
function rod(B, a, b, t, color, o = {}) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = Math.hypot(dx, dy, dz);
  B.add(B.kit.brick(t, L, t, Math.min(0.02, t * 0.3)), {
    p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    r: tilt(dx, dy, dz), color, ...o,
  });
}

/** 局部座標 → 世界座標。跟 crate 同一個慣例（local +x 在 (cos yaw, −sin yaw)）。 */
const frame = (x, y, z, yaw) => {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return (lx, ly, lz) => [x + cs * lx + sn * lz, y + ly, z - sn * lx + cs * lz];
};

/**
 * 圓帳：一圈帆布的帳身、一頂圓頂、簷口一圈垂下的尖齒、頂上一根帶三角旗的
 * 旗桿、拉到地上的幾條營繩。門是帳身上一塊三角形的暗布，朝 `yaw` 開
 * （門的朝向是 (sin yaw, cos yaw)）。
 *
 * 頂用 `cap`（半橢球），不用錐：碰撞的圓頂是橢球冠，錐形的頂在半腰比它低
 * 三四成，站在上面滑的時候人會浮在布上。
 *
 * @param {object} o x, z, y, R 帳身半徑, h 帳身高, roof 頂高, yaw, color 頂與條紋的顏色
 */
export function pavilion(B, o) {
  const y = o.y || 0, R = o.R, h = o.h || 1.5, roof = o.roof || 1.2;
  const yaw = o.yaw || 0, col = o.color || C.banner;
  const E = R + 0.18;                         // 簷口的半徑：頂比帳身往外放一點
  const SEG = 16, step = (Math.PI * 2) / SEG;
  const ap = R * Math.cos(step / 2);          // 一片帳身的中線離軸多遠
  const chord = 2 * R * Math.sin(step / 2);

  B.add(B.kit.drum(R, R, h, SEG), { p: [o.x, y + h / 2, o.z], color: C.canvas });
  /* 門開在哪一片：離 yaw 最近的那一片的中線。CylinderGeometry 的第 i 片
     從角度 i·step 開始，點在 (sin θ, cos θ)——跟這個檔案的 yaw 同一個方向。 */
  const door = ((Math.round(yaw / step - 0.5) % SEG) + SEG) % SEG;
  for (let i = 0; i < SEG; i++) {
    const a = (i + 0.5) * step;
    if (i === door) {
      // 三角形的門洞：一片暗色的內襯，底邊貼地。
      B.add(B.kit.gable(chord * 0.9, h * 0.9, 0.03), {
        p: [o.x + Math.sin(a) * (ap + 0.02), y + 0.01, o.z + Math.cos(a) * (ap + 0.02)],
        r: [0, a, 0], color: C.canvasDark,
      });
    } else if (i % 2 === 0) {
      // 條紋：隔一片貼一條顏色。
      B.add(B.kit.brick(chord * 0.98, h * 0.98, 0.02, 0.005), {
        p: [o.x + Math.sin(a) * (ap + 0.012), y + h * 0.49 + 0.01, o.z + Math.cos(a) * (ap + 0.012)],
        r: [0, a, 0], color: col, ink: false,
      });
    }
  }
  B.add(B.kit.cap(E, roof, SEG), { p: [o.x, y + h, o.z], color: col });

  /* 簷口那一圈尖齒（倒過來的三角），跟頂一色、跟帆布一色輪流。它們掛在
     簷口上，底下本來就是空的。 */
  B.hangs(true);
  const eap = E * Math.cos(step / 2), echord = 2 * E * Math.sin(step / 2);
  for (let i = 0; i < SEG; i++) {
    const a = (i + 0.5) * step;
    B.add(B.kit.gable(echord * 0.96, 0.3, 0.02), {
      p: [o.x + Math.sin(a) * eap, y + h + 0.02, o.z + Math.cos(a) * eap],
      r: [0, a, Math.PI], color: i % 2 ? C.canvas : col, ink: false,
    });
  }
  B.hangs(false);

  // 頂上的旗桿與三角旗。旗往 +x 飄：整片營地吹的是同一陣風。
  const top = y + h + roof;
  B.add(B.kit.drum(0.035, 0.05, 0.75, 6), { p: [o.x, top - 0.1 + 0.375, o.z], color: C.woodDark });
  B.add(B.kit.blob(0.07), { p: [o.x, top + 0.7, o.z], color: C.gold, ink: false });
  B.hangs(true);
  B.add(B.kit.cloth(0.62, 0.3, 0.06, 0.12), {
    p: [o.x + 0.08 + 0.31, top + 0.45, o.z], color: o.pennant || C.bannerAlt, ink: false, tag: 'cloth',
  });
  B.hangs(false);

  /* 營繩：從簷口拉到地上的木樁。避開門口那一片——繩子橫在門前，人就是
     從繩子中間穿進去的。樁壓進地裡只露 8 公分（絆腳那一段以下）。 */
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * (Math.PI / 4);
    let off = Math.abs(a - yaw) % (Math.PI * 2);
    if (off > Math.PI) off = Math.PI * 2 - off;
    if (off < 0.45) continue;
    const s = Math.sin(a), c = Math.cos(a);
    const stake = [o.x + s * (E + 0.95), y + 0.03, o.z + c * (E + 0.95)];
    rod(B, stake, [o.x + s * (E - 0.04), y + h - 0.02, o.z + c * (E - 0.04)], 0.025, C.rope, { ink: false });
    B.add(B.kit.brick(0.06, 0.08, 0.06, 0.015), { p: [stake[0], y + 0.04, stake[2]], color: C.woodDark, ink: false });
  }

  B.round(o.x, o.z, E, y, y + h, { kind: 'block', base: y, dome: roof, slip: 'slide' });
  return { E, reach: E + 0.95 };
}

/**
 * 武器架：兩根柱、上下兩道橫木，一排靠著上橫木的長槍，前面靠著兩面圓盾。
 * 架子沿 local x、正面朝 local +z（世界的 (sin yaw, cos yaw)）。
 */
export function weaponRack(B, o) {
  const yaw = o.yaw || 0, y = o.y || 0, at = frame(o.x, y, o.z, yaw);
  for (const sx of [-1, 1]) {
    B.add(B.kit.brick(0.12, 1.7, 0.12, 0.02), { p: at(sx * 1.1, 0.85, 0), r: [0, yaw, 0], color: C.woodDark });
    B.add(B.kit.brick(0.12, 0.08, 0.72, 0.015), { p: at(sx * 1.1, 0.04, 0), r: [0, yaw, 0], color: C.woodDark });
  }
  B.add(B.kit.brick(2.44, 0.1, 0.12, 0.02), { p: at(0, 1.6, 0), r: [0, yaw, 0], color: C.wood });
  B.add(B.kit.brick(2.44, 0.08, 0.1, 0.02), { p: at(0, 0.45, 0), r: [0, yaw, 0], color: C.wood });
  /* 長槍：槍尾在前面的地上，槍身靠在上橫木的**前緣**上（在 1.6 的高度離架心
     8.6 公分，橫木前緣在 6 公分），槍頭過了橫木半公尺多。 */
  for (let i = 0; i < 6; i++) {
    const lx = -0.9 + i * 0.36;
    const a = at(lx, 0, 0.3), b = at(lx, 2.24, 0);
    rod(B, a, b, 0.045, C.wood);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d);
    B.add(B.kit.cone(0.05, 0.24, 4), {
      p: [b[0] + d[0] / L * 0.11, b[1] + d[1] / L * 0.11, b[2] + d[2] / L * 0.11],
      r: tilt(...d), color: C.ironLit, ink: false,
    });
  }
  // 兩面圓盾，面朝前、往後靠 15°，下緣著地。
  const lean = 0.27, sc = Math.cos(yaw), ss = Math.sin(yaw);
  const nrm = [ss * Math.cos(lean), Math.sin(lean), sc * Math.cos(lean)];
  for (const [lx, color] of [[-0.55, C.banner], [0.6, C.bannerAlt]]) {
    const c = at(lx, 0.36 * Math.cos(lean) + 0.03, 0.44);
    B.add(B.kit.drum(0.36, 0.36, 0.05, 12), { p: c, r: tilt(...nrm), color });
    B.add(B.kit.blob(0.07), { p: [c[0] + nrm[0] * 0.04, c[1] + nrm[1] * 0.04, c[2] + nrm[2] * 0.04], color: C.ironLit, ink: false });
  }
  const hx = 1.26 * Math.abs(sc) + 0.5 * Math.abs(ss), hz = 1.26 * Math.abs(ss) + 0.5 * Math.abs(sc);
  const m = at(0, 0, 0.1);
  B.block(m[0], y + 1.15, m[2], hx * 2, 2.3, hz * 2, { kind: 'block', base: y });
}

/** 練習假人：一根柱、一根橫木當手臂、一捆稻草的身體、麻袋頭上扣一頂破鐵盔。 */
export function dummy(B, o) {
  const yaw = o.yaw || 0, y = o.y || 0, at = frame(o.x, y, o.z, yaw);
  B.add(B.kit.drum(0.07, 0.08, 1.9, 6), { p: at(0, 0.95, 0), color: C.wood });
  B.add(B.kit.brick(0.9, 0.08, 0.12, 0.02), { p: at(0, 0.04, 0), r: [0, yaw, 0], color: C.woodDark });
  B.add(B.kit.brick(0.12, 0.08, 0.9, 0.02), { p: at(0, 0.04, 0), r: [0, yaw, 0], color: C.woodDark });
  B.add(B.kit.drum(0.24, 0.28, 0.7, 8), { p: at(0, 1.15, 0), color: C.straw });
  for (const [by, br] of [[0.9, 0.285], [1.35, 0.262]]) {
    B.add(B.kit.drum(br, br, 0.05, 8), { p: at(0, by, 0), color: C.rope, ink: false });
  }
  B.add(B.kit.brick(1.2, 0.09, 0.09, 0.02), { p: at(0, 1.38, 0), r: [0, yaw, 0], color: C.wood });
  // 手臂兩頭纏的稻草：壓扁一點、坐在橫木上，底不比橫木低。
  for (const sx of [-1, 1]) B.add(B.kit.blob(0.1), { p: at(sx * 0.55, 1.4, 0), s: [1, 0.8, 1], color: C.straw });
  B.add(B.kit.blob(0.19, 1), { p: at(0, 1.72, 0), s: [1, 1.1, 1], color: C.sack });
  B.add(B.kit.cap(0.21, 0.15, 10), { p: at(0, 1.8, 0), r: [0.12, 0, 0.1], color: C.ironLit });
  B.round(o.x, o.z, 0.34, y, y + 1.5, { kind: 'block', base: y, dome: 0.45, slip: 'fall' });
}

/** 箭靶：三腳的木架、一面往後仰的稻草靶、畫上去的三圈與靶心、幾支插著的箭。 */
export function archeryTarget(B, o) {
  const yaw = o.yaw || 0, y = o.y || 0, at = frame(o.x, y, o.z, yaw);
  // 三隻腳都在靶的背面：前兩隻斜斜往後靠，後一隻從後面撐上來。
  for (const sx of [-1, 1]) rod(B, at(sx * 0.5, 0, 0.25), at(sx * 0.34, 1.7, -0.3), 0.07, C.woodDark);
  rod(B, at(0, 0, -0.75), at(0, 1.62, -0.26), 0.07, C.woodDark);
  const lean = 0.2, sc = Math.cos(yaw), ss = Math.sin(yaw);
  const n = [ss * Math.cos(lean), Math.sin(lean), sc * Math.cos(lean)];
  const c = at(0, 1.15, 0.02);
  const on = (d) => [c[0] + n[0] * d, c[1] + n[1] * d, c[2] + n[2] * d];
  B.add(B.kit.drum(0.62, 0.62, 0.22, 14), { p: c, r: tilt(...n), color: C.straw });
  for (const [rr, d, color] of [[0.5, 0.115, C.banner], [0.34, 0.125, C.canvas], [0.18, 0.135, C.banner], [0.07, 0.145, C.gold]]) {
    B.add(B.kit.drum(rr, rr, 0.02, 14), { p: on(d), r: tilt(...n), color, ink: false });
  }
  // 插著的箭：箭身從靶面斜斜地伸出來。
  for (const [ox, oy, k] of [[0.16, 0.1, 0.9], [-0.22, -0.18, 1.1], [0.05, 0.3, 0.8]]) {
    const p = at(ox, 1.15 + oy, 0.02);
    const d = [n[0] + sc * 0.12 * k, n[1] - 0.1 * k, n[2] - ss * 0.12 * k];
    const L = Math.hypot(...d);
    const a = [p[0] + n[0] * 0.1, p[1] + n[1] * 0.1, p[2] + n[2] * 0.1];
    rod(B, a, [a[0] + d[0] / L * 0.55, a[1] + d[1] / L * 0.55, a[2] + d[2] / L * 0.55], 0.02, C.wood, { ink: false });
  }
  const m = at(0, 0, -0.1);
  B.round(m[0], m[2], 0.72, y, y + 1.15, { kind: 'block', base: y, dome: 0.65, slip: 'fall' });
}

/**
 * 炊事的火：一圈壓進地裡的石頭、幾根燒黑的柴、三腳架吊著一口鍋，火在鍋底下。
 * 火焰跟火盆一樣回報給 `flames`，由 main.js 建成會抖的錐。
 */
export function campfire(B, o, flames) {
  const y = o.y || 0;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const sx = o.x + Math.cos(a) * 0.62, sz = o.z + Math.sin(a) * 0.62;
    B.add(B.kit.blob(0.17), {
      p: [sx, y - 0.01, sz], r: [0, a, 0], s: [1.2, 0.5, 1],
      color: hashAt(sx, y, sz, 21) < 0.5 ? C.stoneDark : C.stone, ink: false,
    });
  }
  for (let i = 0; i < 4; i++) {
    B.add(B.kit.drum(0.06, 0.06, 0.6, 6), {
      p: [o.x, y + 0.02, o.z], r: [0, i * 0.8 + 0.3, Math.PI / 2], color: i % 2 ? C.woodDark : C.stoneDeep, ink: false,
    });
  }
  const apex = [o.x, y + 1.78, o.z];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    rod(B, [o.x + Math.cos(a) * 0.86, y, o.z + Math.sin(a) * 0.86],
      [apex[0] - Math.cos(a) * 0.06, apex[1], apex[2] - Math.sin(a) * 0.06], 0.07, C.wood);
  }
  chain(B, { from: [o.x, y + 1.72, o.z], to: [o.x, y + 1.06, o.z], n: 5, sag: 0 });
  B.hangs(true);                     // 鍋吊在鏈子上
  B.add(B.kit.drum(0.36, 0.26, 0.4, 10), { p: [o.x, y + 0.82, o.z], color: C.iron });
  B.add(B.kit.drum(0.39, 0.39, 0.05, 10), { p: [o.x, y + 1.03, o.z], color: C.ironLit, ink: false });
  B.add(B.kit.drum(0.33, 0.33, 0.02, 10), { p: [o.x, y + 1.02, o.z], color: C.woodDark, ink: false });
  B.hangs(false);
  if (flames) flames.push({ x: o.x, y: y + 0.02, z: o.z, s: 0.85 });
  B.round(o.x, o.z, 1.0, y, y + 1.1, { kind: 'block', base: y, dome: 0.65, slip: 'fall' });
}

/**
 * 糧袋堆：一層一層疊平的麻袋。`layers` 是每一層幾袋 [x 向, z 向]，由下往上，
 * 上一層放在下一層的正中間。每一層是一個 'floor'（頂面 0.4 的倍數），所以
 * 疊三層就是一道爬得上去的三級台階。只收正交的擺法（`turn` 轉 90°）——轉斜了，
 * 每一層的外接盒會比那一層胖出一圈看不見的地板。
 */
export function sackStack(B, o) {
  const y = o.y || 0, turn = !!o.turn;
  const PX = 0.78, PZ = 0.58, LH = 0.4;
  o.layers.forEach(([nx, nz], k) => {
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const lx = (i - (nx - 1) / 2) * PX, lz = (j - (nz - 1) / 2) * PZ;
        const x = o.x + (turn ? lz : lx), z = o.z + (turn ? lx : lz), sy = y + k * LH + 0.2;
        const h = hashAt(x, sy, z, 23);
        B.add(B.kit.blob(0.3, 1), {
          p: [x, sy, z], r: [0, (turn ? Math.PI / 2 : 0) + (h - 0.5) * 0.3, 0], s: [1.3, 0.68, 0.98],
          color: h < 0.3 ? C.canvas : C.sack,
        });
      }
    }
    const w = nx * PX, d = nz * PZ, top = (k + 1) * LH;
    B.block(o.x, y + top / 2, o.z, turn ? d : w, top, turn ? w : d, { kind: 'floor', base: y });
  });
}

/** 柴堆：四根樁夾著碼齊的劈柴。柴沿 x（`turn` 則沿 z）。頂面 0.94，跳得上去。 */
export function woodpile(B, o) {
  const y = o.y || 0, yaw = o.turn ? Math.PI / 2 : 0, at = frame(o.x, y, o.z, yaw);
  for (let k = 0; k < 4; k++) {
    const n = k % 2 ? 4 : 5;
    for (let i = 0; i < n; i++) {
      const lz = (i - (n - 1) / 2) * 0.26;
      const p = at(hashAt(o.x + i, y + k, o.z, 25) * 0.1 - 0.05, 0.13 + k * 0.225, lz);
      B.add(B.kit.drum(0.13, 0.13, 1.5, 7), { p, r: [0, yaw, Math.PI / 2], color: (i + k) % 3 ? C.wood : C.woodDark });
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.add(B.kit.brick(0.1, 1.1, 0.1, 0.02), { p: at(sx * 0.8, 0.55, sz * 0.7), r: [0, yaw, 0], color: C.woodDark });
  }
  const w = o.turn ? 1.5 : 1.7, d = o.turn ? 1.7 : 1.5;
  B.block(o.x, y + 0.47, o.z, w, 0.94, d, { kind: 'floor', base: y });
}

/** 一根橫放的原木當凳子，沿 x（`turn` 則沿 z）。頂面 0.4。 */
export function logSeat(B, x, z, turn = false, len = 1.6) {
  B.add(B.kit.drum(0.2, 0.2, len, 8), { p: [x, 0.2, z], r: [0, turn ? Math.PI / 2 : 0, Math.PI / 2], color: C.wood });
  B.block(x, 0.2, z, turn ? 0.4 : len, 0.4, turn ? len : 0.4, { kind: 'floor', base: 0 });
}

/**
 * 營前的軍旗：兩根高柱夾著一面大旗。旗面朝 local +z，柱子在旗的兩側——
 * 一根柱子立在旗後面的話，布的波浪會跟柱子撞在一起。旗的下擺在 1.6 公尺，
 * 狗從旗底下走得過去。
 */
export function standard(B, o) {
  const yaw = o.yaw || 0, at = frame(o.x, 0, o.z, yaw);
  for (const sx of [-1, 1]) {
    const p = at(sx * 1.0, 0, 0);
    B.add(B.kit.drum(0.07, 0.09, 4.4, 6), { p: [p[0], 2.2, p[2]], color: C.woodDark });
    B.add(B.kit.blob(0.1), { p: [p[0], 4.47, p[2]], color: C.gold, ink: false });
    B.round(p[0], p[2], 0.12, 0, 4.4, { kind: 'block', base: 0 });
  }
  banner(B, { x: o.x, y: 4.2, z: o.z, yaw, s: 1.0, color: o.color || C.banner });
}
