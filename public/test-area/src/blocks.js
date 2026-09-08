/* ── test-area/src/blocks.js ─────────────────────────────────────────
   四個城堡遺跡關卡區塊，擺成一片 2×2 的廢墟。

   ── 每一個區塊的規矩 ─────────────────────────────────────────────
   一模一樣的三條，因為它們是「可以跑的關卡」而不是「一張場景」：

     1. 中心留空。每個區塊中央至少 12×12 是平的、乾淨的、沒有一塊突出來
        會卡腳的東西——狗要在上面跑，而跑起來最需要的是「看得懂哪裡能
        走」。所有裝飾一律退到那個方框外面，或是抬到頭頂以上。
     2. 密度往外長。空地邊緣是碎石與苔，再外面是柱列與拱廊，最外圈是
        城牆、雕像、旗與火盆。視線因此有三層深度，而腳下始終是空的。
     3. 進出口在地面。每個區塊都走得進去也走得出去，抬高的（城牆平台）
        一定配階梯，不靠跳躍——這一頁只做移動與觀賞。

   ── 四個區塊 ────────────────────────────────────────────────────
     崩塌中庭   兩側拱廊、一圈斷柱、一座門樓與鐵閘、井、枯樹
     城牆平台   抬高 3.2 的露台、女牆與垛口、扶壁、塔基、旗與鎖鏈
     王座廳     兩列柱、斜插的穹稜、台座與王座、掛旗的側牆
     圓塔水窖   環形拱廊、貼牆的殘階、垂下的鎖鏈、牆頭的獸像

   每一個都只回報資料（幾何、碰撞盒、出生點、火焰座標），不碰場景也不碰
   材質——組裝是 main.js 的事，這樣同一份區塊資料離線也建得起來，
   verify.mjs 就是靠這件事在 node 底下把四個區塊全部砌一遍。
   ------------------------------------------------------------------ */

import { Build, rng } from './geom.js';
import { C } from './palette.js';
import {
  Kit, flagstones, wall, merlons, column, pointedArch, arcade, buttress, stair,
  knight, gargoyle, rubble, brazier, banner, chain, portcullis, deadTree, well,
  mossTuft,
} from './pieces.js';

/** 區塊在世界裡的間距。中間那片空地是走廊，四個區塊互相看得到。 */
export const PITCH = 62;

/* ── 空地的守門員 ────────────────────────────────────────────────
   「中心留空」這條規則要有一個東西去執行它，不然它只是一句話。撒碎石
   的時候每一顆都會問一次這個判斷式，`false` 的就不撒。

   邊界給得比空地本身寬 0.7：狗有 0.3 的半徑，而一塊轉過角度的石頭，
   它的軸對齊碰撞盒會比石頭本身再胖一點。兩個加起來就是那 0.7。 */
const clearOf = (hx, hz, rad = 0) => (x, z) => (
  (Math.abs(x) > hx || Math.abs(z) > hz) && (!rad || Math.hypot(x, z) > rad)
);

/* ── 一、崩塌中庭 ─────────────────────────────────────────────────
   最正統的那一個：一個被兩排拱廊夾住的方形中庭，北面一座門樓。
   斷柱排成一圈但半徑 8.5——圓心那 14×14 完全是空的，那圈柱子的作用是
   把空地「框」出來，而不是站在裡面。 */
function courtyard(B, flames, seed) {
  const r = rng(seed);
  flagstones(B, { x: 0, z: 0, w: 26, d: 26, y: 0, seed: seed + 1, ruin: 0.34 });

  // 東西兩側的拱廊。長軸沿 z，所以 yaw 是 ±90°。
  for (const side of [-1, 1]) {
    arcade(B, {
      x: side * 13, z: 0, yaw: Math.PI / 2, bays: 5, span: 3.1, pier: 0.95,
      legH: 2.6, depth: 1.0, y: 0, ruin: side < 0 ? 0.5 : 0.22, seed: seed + 20 + side,
    });
  }

  // 南面一道塌了一半的圍牆，牆後兩根扶壁。
  wall(B, { from: [-13, 13], to: [13, 13], h: 4.6, thick: 1.0, ruin: 0.55, seed: seed + 40 });
  for (const t of [-8, 0, 8]) {
    buttress(B, { x: t, z: 13.6, yaw: 0, h: 3.2, w: 1.3, out: 1.6, steps: 3, seed: seed + 50 + t });
  }

  /* 北面的門樓：兩座墩、一道尖拱、一面鐵閘。拱是走得過去的（12 寬的
     開口只放閘，閘本身有碰撞，所以門是關著的——它是背景，不是路）。
     真正的出入口在東南與西北兩個缺角。 */
  wall(B, { from: [-13, -13], to: [-2.4, -13], h: 6.4, thick: 1.2, ruin: 0.28, seed: seed + 60 });
  wall(B, { from: [2.4, -13], to: [13, -13], h: 6.4, thick: 1.2, ruin: 0.3, seed: seed + 61 });
  /* 門樓的拱是完整的（ruin 0）。整片廢墟裡至少要有一道拱是完好的，
     不然「尖拱」這個形狀在畫面上從來沒有被說完整——而那正好是這一路
     造型語言最好認的一筆。缺口留給別的拱。 */
  pointedArch(B, { x: 0, z: -13, y: 3.6, span: 5.0, rise: 3.6, yaw: 0, thick: 0.55, depth: 1.3, ruin: 0, seed: seed + 62 });
  portcullis(B, { x: 0, z: -13, y: 0, w: 4.4, h: 3.4, yaw: 0 });
  merlons(B, { from: [-13, -13], to: [13, -13], y: 6.4, h: 1.0, thick: 1.2, pitch: 1.6, ruin: 0.3, seed: seed + 63 });
  for (const side of [-1, 1]) {
    gargoyle(B, { x: side * 4.2, z: -12.4, y: 6.4, s: 0.9, yaw: Math.PI, seed: seed + 70 + side });
    banner(B, { x: side * 2.9, y: 5.6, z: -12.2, yaw: 0, s: 0.95, color: side < 0 ? C.banner : C.bannerAlt });
    knight(B, { x: side * 3.4, z: -9.4, y: 0, s: 1.05, yaw: Math.PI, damage: side < 0 ? 0.5 : 0, seed: seed + 80 + side });
  }

  /* 框出中庭的那一圈斷柱。半徑 9.2、八根，起始角 0.39 弧度——那個起始
     角不是為了好看：0 或 45° 的話會有柱子正好落在 12×12 空地的角上，
     而 22° 讓每一根都離那個方框的邊至少一公尺。 */
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.39;
    column(B, {
      x: Math.cos(a) * 9.2, z: Math.sin(a) * 9.2, y: 0, r: 0.46,
      h: 5.2, broken: r() < 0.65 ? r.range(0.35, 0.8) : 0, seed: seed + 100 + i,
    });
  }

  // 井、枯樹、火盆、碎石。全部在半徑 6 以外。
  well(B, { x: -9.3, z: 7.4, y: 0, r: 1.15, seed: seed + 120 });
  deadTree(B, { x: 7.4, z: 7.8, y: 0, s: 1.15, seed: seed + 121 });
  deadTree(B, { x: -8.4, z: -6.2, y: 0, s: 0.85, seed: seed + 122 });
  /* 火盆。z 一律對著拱廊的墩柱（±2.03）而不是拱洞（0、±4.05、±8.1）：
     拱洞是路——這一頁唯一能走出中庭的路——而一盆一公尺高的鐵器擺在門口
     中央，畫面上完全看不出有什麼問題，走到那裡才會發現出不去。 */
  for (const [bx, bz] of [[-6.2, -8.6], [6.2, -8.6], [7.4, 2.03], [-7.4, -2.03]]) {
    brazier(B, { x: bx, z: bz, y: 0, s: 1, seed: seed + 130 }, flames);
  }
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2, rad = r.range(8.0, 12.5);
    rubble(B, {
      x: Math.cos(a) * rad, z: Math.sin(a) * rad, y: 0, r: r.range(1.6, 3.2), n: 22,
      keep: clearOf(7.0, 7.0), seed: seed + 140 + i,
    });
  }
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2, rad = r.range(6.5, 12);
    mossTuft(B, Math.cos(a) * rad, 0, Math.sin(a) * rad, r);
  }
  return { spawn: [0, 0, 3.5] };
}

/* ── 二、城牆平台 ─────────────────────────────────────────────────
   抬高 3.2 的一段城牆。這個區塊的重點是「站在上面往外看」，所以露台
   本身鋪得很乾淨，所有東西都在女牆上或女牆外。上得去的路是兩折階梯，
   不需要跳。 */
function rampart(B, flames, seed) {
  const r = rng(seed);
  const H = 3.2;                       // 露台面的高度
  const W = 22, D = 15;                // 露台尺寸
  const SX = 4.2;                      // 樓梯的中心線
  const GAP_L = SX - 1.9, GAP_R = SX + 1.9;   // 南面牆的缺口

  // 台體：四面砌牆，中間鋪面。牆從地面砌到露台面，所以它同時是台基。
  const hw = W / 2, hd = D / 2;
  /* 南面（−z）是入口那一面，所以它是兩段，中間留一個 3.8 寬的缺口給
     樓梯。缺口是必要的而不是造型：牆的碰撞盒從地面到露台面，沒有缺口
     的話樓梯會爬到牆裡去。 */
  wall(B, { from: [-hw, -hd], to: [GAP_L, -hd], h: H, thick: 1.1, ruin: 0.12, seed: seed + 1 });
  wall(B, { from: [GAP_R, -hd], to: [hw, -hd], h: H, thick: 1.1, ruin: 0.14, seed: seed + 11 });
  wall(B, { from: [-hw, hd], to: [hw, hd], h: H, thick: 1.1, ruin: 0.12, seed: seed + 2 });
  wall(B, { from: [-hw, -hd], to: [-hw, hd], h: H, thick: 1.1, ruin: 0.18, seed: seed + 3 });
  wall(B, { from: [hw, -hd], to: [hw, hd], h: H, thick: 1.1, ruin: 0.18, seed: seed + 4 });
  flagstones(B, { x: 0, z: 0, w: W - 1.6, d: D - 1.6, y: H, seed: seed + 5, ruin: 0.22, cell: 1.6 });
  B.block(0, H - 1, 0, W, 2, D);       // 露台的地板

  // 外側扶壁。城牆的側面沒有它就只是一片板子。
  for (const t of [-8.5, -4.2, 0, 4.2, 8.5]) {
    buttress(B, { x: t, z: hd + 0.5, yaw: 0, h: H - 0.2, w: 1.4, out: 1.7, steps: 3, seed: seed + 10 + t });
  }
  for (const side of [-1, 1]) {
    buttress(B, { x: side * (hw + 0.5), z: 0, yaw: side * Math.PI / 2, h: H - 0.2, w: 1.4, out: 1.7, steps: 3, seed: seed + 20 + side });
  }

  // 女牆：外側（+z）一整道帶垛口的，內側（−z）一道矮的。
  /* 女牆本身只給 0.08 的殘破度。垛口是坐在它的頂上的，而 `wall` 的
     殘破是把頂皮吃掉——牆頂一低下去，那幾個垛就浮在半空中。殘破留給
     垛自己（少掉三成），它們少一個就是少一個，不會浮起來。 */
  wall(B, { from: [-hw, hd - 0.1], to: [hw, hd - 0.1], h: 1.1, y: H, thick: 0.85, ruin: 0.08, course: 0.36, seed: seed + 30 });
  merlons(B, { from: [-hw + 0.8, hd - 0.1], to: [hw - 0.8, hd - 0.1], y: H + 1.06, h: 0.95, thick: 0.85, pitch: 1.55, ruin: 0.32, seed: seed + 31 });
  wall(B, { from: [-hw, -hd + 0.1], to: [GAP_L, -hd + 0.1], h: 0.75, y: H, thick: 0.8, ruin: 0.45, course: 0.36, seed: seed + 32 });
  wall(B, { from: [GAP_R, -hd + 0.1], to: [hw, -hd + 0.1], h: 0.75, y: H, thick: 0.8, ruin: 0.5, course: 0.36, seed: seed + 33 });

  /* 塔基：西端一座斷掉的圓塔。塔身是三圈砌石（用 12 段直牆圍成的圓，
     每段自己算 yaw），頂上一圈缺了大半的垛。 */
  const TX = -hw - 3.4, TZ = 0, TR = 3.5;
  const segs = 12;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    wall(B, {
      from: [TX + Math.cos(a0) * TR, TZ + Math.sin(a0) * TR],
      to: [TX + Math.cos(a1) * TR, TZ + Math.sin(a1) * TR],
      h: 6.2, thick: 1.0, ruin: 0.42, seed: seed + 40 + i,
    });
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    if (r() < 0.45) continue;
    B.add(B.kit.brick(1.1, 0.9, 0.9, 0.06), {
      p: [TX + Math.cos(a) * TR, 5.6 + r.range(0, 0.5), TZ + Math.sin(a) * TR],
      r: [0, -a, 0], color: r() < 0.4 ? C.stoneLit : C.stone,
    });
  }
  gargoyle(B, { x: TX, z: TZ + TR - 0.4, y: 5.4, s: 1.1, yaw: 0, seed: seed + 60 });

  /* 上露台的兩折階梯。兩折都完全在露台的footprint 之外，最後靠一塊
     平台接到牆的缺口上——樓梯只要有一階落在露台鋪面的正下方，那片鋪面
     的碰撞盒就會變成一道擋在半空的牆。 */
  const s1 = stair(B, { x: SX, z: -hd - 8.9, y: 0, yaw: 0, steps: 6, rise: 0.27, run: 0.62, w: 3.2, seed: seed + 70 });
  const s2 = stair(B, { x: SX, z: -hd - 5.0, y: s1.top, yaw: 0, steps: 6, rise: 0.27, run: 0.62, w: 3.2, seed: seed + 71 });
  // 接到缺口的那塊平台，頂面跟最後一階同高。
  B.add(B.kit.brick(3.4, 0.36, 1.5, 0.06), { p: [SX, s2.top - 0.18, -hd - 0.75], color: C.granite, solid: true });
  // 階梯兩側的矮牆，免得從側面掉下去。
  for (const side of [-1, 1]) {
    wall(B, {
      from: [SX + side * 1.75, -hd - 9.1], to: [SX + side * 1.75, -hd - 0.2],
      h: 1.0, y: 0.5, thick: 0.32, ruin: 0.25, course: 0.3, brick: 0.7, seed: seed + 80 + side,
    });
  }

  /* 旗掛在城牆的外面，不是露台上。第一版掛在內側女牆的上方，而那道
     女牆只有 0.75 高——旗於是懸在露台中央的半空中，看起來像沒有掛上去。
     掛在外牆面上就沒有這個問題：布垂在牆上，垛口在它上面，這也是這種
     城牆真正掛旗的地方。 */
  for (const t of [-7.5, -2.5, 2.5, 7.5]) {
    banner(B, { x: t, y: H - 0.35, z: hd + 0.55, yaw: 0, s: 0.9, color: t < 0 ? C.banner : C.bannerAlt });
  }
  for (const [bx, bz] of [[-9.4, hd - 1.8], [9.4, hd - 1.8], [0, -hd + 1.6]]) {
    brazier(B, { x: bx, z: bz, y: H, s: 1, seed: seed + 90 + bx }, flames);
  }
  for (let i = 0; i < 3; i++) {
    chain(B, {
      from: [-2 + i * 2.2, H + 2.0, hd - 0.6], to: [-2 + i * 2.2 + 0.6, H + 0.4, hd - 0.6],
      n: 8, sag: 0.5,
    });
  }
  // 牆外的碎石堆：城牆塌下來的東西要在牆腳。
  for (let i = 0; i < 6; i++) {
    rubble(B, { x: r.range(-hw, hw), z: hd + r.range(2.2, 5.0), y: 0, r: r.range(1.8, 3.4), n: 24, seed: seed + 100 + i });
  }
  deadTree(B, { x: -hw - 6.5, z: -8, y: 0, s: 1.3, seed: seed + 110 });
  return { spawn: [SX, 0, -hd - 11.4] };
}

/* ── 三、王座廳 ───────────────────────────────────────────────────
   一條中軸線：門在南、台座與王座在北，兩列柱夾出中殿。屋頂沒了，只剩
   幾段斜插在地上的穹稜——那幾段是這個區塊唯一在講「這裡曾經是室內」的
   東西，所以它們刻意插在柱列外側，不擋中殿。 */
function throne(B, flames, seed) {
  const r = rng(seed);
  flagstones(B, { x: 0, z: 1, w: 15, d: 30, y: 0, seed: seed + 1, ruin: 0.26, cell: 1.5 });

  // 兩列柱。柱距 4.2，離中軸 5.6——中殿淨寬 11.2，夠空。
  for (let i = 0; i < 6; i++) {
    const z = -11 + i * 4.2;
    for (const side of [-1, 1]) {
      const broken = r() < 0.4 ? r.range(0.3, 0.75) : 0;
      const col = column(B, { x: side * 5.6, z, y: 0, r: 0.5, h: 6.4, broken, seed: seed + 10 + i * 2 + side });
      // 完整的柱子之間掛旗；斷柱之間掛鎖鏈。
      if (!broken && i < 5) {
        banner(B, { x: side * 5.6, y: col.top - 0.7, z: z + 2.1, yaw: Math.PI / 2, s: 0.9, color: i % 2 ? C.banner : C.bannerAlt });
      }
      if (broken && r() < 0.5) mossTuft(B, side * 5.6 + r.range(-1, 1), 0, z + r.range(-1, 1), r);
    }
  }

  // 側牆：開了高窗的殘牆，窗就是尖拱本身。
  for (const side of [-1, 1]) {
    const x = side * 7.6;
    for (let i = 0; i < 4; i++) {
      const z0 = -12 + i * 6.4, z1 = z0 + 4.2;
      wall(B, { from: [x, z0], to: [x, z1], h: 5.6, thick: 0.9, ruin: 0.5, seed: seed + 40 + i * 2 + side });
      pointedArch(B, {
        x, z: z1 + 1.1, y: 3.0, span: 2.0, rise: 1.9, yaw: Math.PI / 2,
        thick: 0.38, depth: 0.9, ruin: 0.3, seed: seed + 60 + i * 2 + side,
      });
    }
    // 牆外的扶壁。
    for (let i = 0; i < 3; i++) {
      buttress(B, { x, z: -8 + i * 7, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, h: 4.2, w: 1.3, out: 1.8, steps: 3, seed: seed + 80 + i });
    }
    /* 斷掉的穹稜：半個尖拱，從側牆頭起拱、往中殿彎過去、在半空斷掉。
       跨距用整個中殿（15.2）、起拱線在牆頭（5.0）——所以它們是「這裡
       本來有屋頂」而不是「這裡有幾塊石頭」。三根，缺得一根比一根多。 */
    for (let i = 0; i < 3; i++) {
      pointedArch(B, {
        x: 0, z: -7 + i * 6.5, y: 5.0, span: 15.2, rise: 5.4, yaw: 0,
        thick: 0.5, depth: 0.7, half: side, ruin: 0.42 + i * 0.12, seed: seed + 90 + i * 3 + side,
      });
    }
  }

  // 北端的台座、王座、與背後的殘牆。
  const d1 = stair(B, { x: 0, z: 12.4, y: 0, yaw: Math.PI, steps: 3, rise: 0.3, run: 0.7, w: 8, seed: seed + 100 });
  B.block(0, 0.45, 13.6, 8, 0.9, 2.6);
  void d1;
  B.add(B.kit.brick(9, 0.9, 4.4, 0.09), { p: [0, 0.45, 15.6], color: C.granite, solid: true });
  // 王座：座、背、兩個扶手，全部是倒角石塊。
  B.add(B.kit.brick(1.9, 0.5, 1.7, 0.08), { p: [0, 1.15, 16.2], color: C.stoneLit, solid: true });
  B.add(B.kit.brick(1.9, 2.6, 0.5, 0.09), { p: [0, 2.6, 17.0], color: C.stone, solid: true });
  for (const side of [-1, 1]) {
    B.add(B.kit.brick(0.4, 0.7, 1.6, 0.06), { p: [side * 0.95, 1.65, 16.2], color: C.stone });
    B.add(B.kit.cone(0.22, 0.5, 6), { p: [side * 0.8, 4.05, 17.0], color: C.gold, ink: false });
  }
  wall(B, { from: [-7.6, 18.4], to: [7.6, 18.4], h: 7.2, thick: 1.1, ruin: 0.4, seed: seed + 110 });
  pointedArch(B, { x: 0, z: 18.4, y: 4.4, span: 4.6, rise: 3.4, yaw: 0, thick: 0.5, depth: 1.2, ruin: 0.22, seed: seed + 111 });
  for (const side of [-1, 1]) {
    knight(B, { x: side * 3.6, z: 14.4, y: 0.9, s: 1.15, yaw: Math.PI, damage: side < 0 ? 0 : 0.55, seed: seed + 120 + side });
    brazier(B, { x: side * 2.6, z: 12.0, y: 0, s: 1.05, seed: seed + 130 + side }, flames);
    brazier(B, { x: side * 5.1, z: 2.0, y: 0, s: 0.95, seed: seed + 140 + side }, flames);
  }

  // 南端：塌掉的正門，兩塊倒下的柱頭當踏腳石。
  wall(B, { from: [-7.6, -14.4], to: [-2.6, -14.4], h: 5.0, thick: 1.1, ruin: 0.6, seed: seed + 150 });
  wall(B, { from: [2.6, -14.4], to: [7.6, -14.4], h: 5.0, thick: 1.1, ruin: 0.6, seed: seed + 151 });
  /* 倒下的柱頭。刻意擺在柱列外側而不是中殿裡：中殿是這個區塊的空地，
     而「可以踩的大石頭」只要落在那條線裡，跑起來就會被絆一下。 */
  for (let i = 0; i < 4; i++) {
    B.add(B.kit.drum(0.62, 0.5, 1.4, 10), {
      p: [(i % 2 ? 1 : -1) * r.range(6.2, 7.0), 0.35, r.range(-12, 8)],
      r: [Math.PI / 2, r() * 3, r.range(-0.2, 0.2)],
      color: C.stoneLit, solid: true,
    });
  }
  for (let i = 0; i < 8; i++) {
    rubble(B, {
      x: (i % 2 ? 1 : -1) * r.range(6.0, 9.0), z: r.range(-14, 18), y: 0,
      r: r.range(1.2, 2.6), n: 16, keep: clearOf(5.3, 9.4), seed: seed + 160 + i,
    });
  }
  return { spawn: [0, 0, -11] };
}

/* ── 四、圓塔水窖 ─────────────────────────────────────────────────
   一個圓的區塊，因為前三個都是方的。環形拱廊把整圈框起來，中央是一片
   直徑 14 的圓形鋪面；牆上剩一段貼著內壁往上爬的殘階（走得上去，但上面
   是斷的——那是刻意的，這一頁只做移動與觀賞，斷階是給人看的）。 */
function cistern(B, flames, seed) {
  const r = rng(seed);
  const R = 13;
  flagstones(B, { x: 0, z: 0, w: 22, d: 22, y: 0, seed: seed + 1, ruin: 0.4, cell: 1.5 });

  // 環牆：16 段，其中四段換成尖拱的洞口（東西南北四個門）。
  const segs = 16;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const gate = i % 4 === 0;
    const from = [Math.cos(a0) * R, Math.sin(a0) * R];
    const to = [Math.cos(a1) * R, Math.sin(a1) * R];
    if (gate) {
      // 門洞：拱腳兩側各留一小段牆，中間是拱。
      const t = 0.28;
      const lerp = (u) => [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u];
      wall(B, { from, to: lerp(t), h: 6.0, thick: 1.1, ruin: 0.3, seed: seed + 10 + i });
      wall(B, { from: lerp(1 - t), to, h: 6.0, thick: 1.1, ruin: 0.3, seed: seed + 30 + i });
      const c = lerp(0.5);
      pointedArch(B, {
        x: c[0], z: c[1], y: 3.2, span: 3.0, rise: 2.4,
        yaw: -mid + Math.PI / 2, thick: 0.45, depth: 1.1, ruin: 0.15, seed: seed + 50 + i,
      });
    } else {
      wall(B, { from, to, h: 6.0, thick: 1.1, ruin: r.range(0.25, 0.6), seed: seed + 10 + i });
      if (r() < 0.5) {
        merlons(B, { from, to, y: 6.0, h: 0.85, thick: 1.1, pitch: 1.5, ruin: 0.4, seed: seed + 70 + i });
      }
    }
    /* 外圈扶壁，隔一段放一根——但門洞那幾段不放。扶壁在牆外 0.6，
       正好會擋在門口前面：門洞是開的，路卻是不通的，而這種東西在畫面上
       完全看不出來（從裡面看，扶壁在牆的另一邊）。 */
    if (i % 2 === 0 && i % 4 !== 0) {
      buttress(B, {
        x: Math.cos(mid) * (R + 0.6), z: Math.sin(mid) * (R + 0.6),
        yaw: -mid + Math.PI / 2, h: 3.6, w: 1.3, out: 1.7, steps: 3, seed: seed + 90 + i,
      });
    }
    // 牆頭的獸像，四隻，朝內看。
    if (i % 4 === 2) {
      gargoyle(B, {
        x: Math.cos(mid) * (R - 0.9), z: Math.sin(mid) * (R - 0.9), y: 5.4, s: 0.95,
        yaw: -mid - Math.PI / 2, seed: seed + 110 + i,
      });
    }
  }

  // 內圈一圈柱子，半徑 9.2——中央 14 見方以內完全是空的。
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    column(B, {
      x: Math.cos(a) * 9.2, z: Math.sin(a) * 9.2, y: 0, r: 0.42, h: 4.4,
      broken: r() < 0.5 ? r.range(0.3, 0.7) : 0, seed: seed + 130 + i,
    });
  }

  /* 貼著內壁往上爬的殘階。每一階都是獨立的碰撞盒，所以真的踩得上去；
     爬到第 14 階就沒了，斷面上放幾塊翹起的碎石。 */
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const a = 2.4 + (i / steps) * 2.3;
    const rr = R - 1.5;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const y = 0.3 + i * 0.32;
    B.add(B.kit.brick(2.0, 0.3, 1.3, 0.05), {
      p: [x, y, z], r: [0, -a + Math.PI / 2, 0],
      color: i % 2 ? C.granite : C.graniteDark, solid: true,
    });
    if (i === steps - 1) {
      for (let k = 0; k < 4; k++) {
        B.add(B.kit.brick(0.5, 0.22, 0.4, 0.04), {
          p: [x + r.range(-0.8, 0.8), y + 0.26, z + r.range(-0.6, 0.6)],
          r: [r.range(-0.4, 0.4), r() * 3, r.range(-0.4, 0.4)], color: C.stoneDeep,
        });
      }
    }
  }

  // 從殘存的穹稜垂下來的鎖鏈，以及牆邊的火盆與根。
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.8;
    chain(B, {
      from: [Math.cos(a) * (R - 1.2), 5.6, Math.sin(a) * (R - 1.2)],
      to: [Math.cos(a) * (R - 3.0), 2.4, Math.sin(a) * (R - 3.0)],
      n: 12, sag: 0.9,
    });
    brazier(B, { x: Math.cos(a) * 10.4, z: Math.sin(a) * 10.4, y: 0, s: 1, seed: seed + 150 + i }, flames);
  }
  for (let i = 0; i < 3; i++) {
    const a = r() * Math.PI * 2;
    deadTree(B, { x: Math.cos(a) * 11.2, z: Math.sin(a) * 11.2, y: 0, s: r.range(0.8, 1.2), seed: seed + 160 + i });
  }
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2, rad = r.range(8.5, 12.5);
    rubble(B, {
      x: Math.cos(a) * rad, z: Math.sin(a) * rad, y: 0, r: r.range(1.4, 2.8), n: 20,
      keep: clearOf(7.0, 7.0, 7.4), seed: seed + 170 + i,
    });
  }
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2, rad = r.range(6.5, 12);
    mossTuft(B, Math.cos(a) * rad, 0, Math.sin(a) * rad, r);
  }
  return { spawn: [0, 0, -6] };
}

/* ── 中間那片地 ──────────────────────────────────────────────────
   四個區塊之間的空地。它不是裝飾：沒有它，四個區塊是四張圖；有了它，
   它們是同一片廢墟裡的四個角落，而狗可以走過去。撒的東西刻意稀疏，
   一眼就看得出「那邊才是關卡」。 */
function grounds(B, seed) {
  const r = rng(seed);
  const half = PITCH / 2;

  /* 四條走廊：相鄰兩個區塊的原點連起來的那四段。走廊上不撒任何有碰撞的
     東西——不是因為那樣不好看，是因為「走得過去」比「有東西看」重要，
     而一段孤立的殘牆剛好躺在兩個區塊中間的話，走過去的人只會覺得這張
     地圖是斷的。tools/verify-test-area.mjs 會沿著這四條線走一遍。 */
  const O = BLOCKS.map((b) => b.origin);
  const LANES = [[O[0], O[1]], [O[0], O[2]], [O[1], O[3]], [O[2], O[3]]];
  const onLane = (x, z, pad) => LANES.some(([a, b]) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)) < pad;
  });
  for (let i = 0; i < 60; i++) {
    const x = r.range(-half - 20, half + 20), z = r.range(-half - 20, half + 20);
    // 別撒進區塊裡：四個區塊各佔一個 ±(PITCH/2) 附近的方框。
    const near = Math.min(
      Math.hypot(x - 0, z - 0), Math.hypot(x - PITCH, z - 0),
      Math.hypot(x - 0, z - PITCH), Math.hypot(x - PITCH, z - PITCH),
    );
    if (near < 17) continue;
    if (r() < 0.35) {
      rubble(B, {
        x, z, y: 0, r: r.range(1.2, 3.0), n: 14,
        keep: (sx, sz) => !onLane(sx, sz, 4.5), seed: (seed + i * 7) >>> 0,
      });
    } else if (r() < 0.3) {
      if (onLane(x, z, 4.0)) continue;
      deadTree(B, { x, z, y: 0, s: r.range(0.7, 1.4), seed: (seed + i * 13) >>> 0 });
    } else {
      mossTuft(B, x, 0, z, r);   // 苔沒有碰撞，撒在走廊上也沒關係
    }
  }
  // 幾段孤立的殘牆，把空地切開，讓走過去的路上有東西擋一下視線。
  for (let i = 0; i < 5; i++) {
    const x = r.range(-half + 6, half + 24), z = r.range(-half + 6, half + 24);
    if (Math.min(Math.hypot(x, z), Math.hypot(x - PITCH, z), Math.hypot(x, z - PITCH), Math.hypot(x - PITCH, z - PITCH)) < 19) continue;
    const len = r.range(4, 9), a = r() * Math.PI;
    // 殘牆是實心的，所以整段都不能碰到走廊——兩端各檢查一次。
    if (onLane(x, z, 5.5) || onLane(x + Math.cos(a) * len, z + Math.sin(a) * len, 5.5)) continue;
    wall(B, {
      from: [x, z], to: [x + Math.cos(a) * len, z + Math.sin(a) * len],
      h: r.range(1.6, 3.4), thick: 0.9, ruin: 0.7, seed: (seed + 300 + i) >>> 0,
    });
  }
}

/* ── 名冊 ────────────────────────────────────────────────────────
   每一個區塊：一個 id、一個名字、一個世界座標、一支砌它的函式。
   `origin` 是那個區塊自己的原點在世界裡的位置——區塊內部一律用自己的
   局部座標寫，砌完再整個平移過去，所以四個區塊的程式碼互相看不到彼此。 */
export const BLOCKS = [
  { id: 'courtyard', name: '崩塌中庭', hint: '兩側拱廊、一圈斷柱、門樓與鐵閘', origin: [0, 0], build: courtyard, seed: 0x1a2b },
  { id: 'rampart', name: '城牆平台', hint: '抬高的露台、女牆垛口、斷塔', origin: [PITCH, 0], build: rampart, seed: 0x3c4d },
  { id: 'throne', name: '王座廳', hint: '兩列柱、斜插的穹稜、台座與王座', origin: [0, PITCH], build: throne, seed: 0x5e6f },
  { id: 'cistern', name: '圓塔水窖', hint: '環形拱廊、貼牆殘階、垂鏈', origin: [PITCH, PITCH], build: cistern, seed: 0x7a8b },
];

/**
 * 砌出整片廢墟。
 *
 * 四個區塊 + 中間那片地全部砌進同一個 Build，於是整張地圖是一個 mesh
 * 加一個 LineSegments——兩個 draw call。這是可以這樣做的，因為地圖是
 * 靜態的：沒有一塊石頭會動，會動的只有火焰，而火焰不在這裡。
 *
 * @returns {{geometry, ink, colliders, flames, spawns, tris, inkLines}}
 */
export function buildRuins() {
  const B = new Build(new Kit());
  const flames = [];
  const spawns = {};
  _colCursor = _inkCursor = _flameCursor = 0;   // 同一個行程裡砌第二遍也要對

  for (const b of BLOCKS) {
    const [ox, oz] = b.origin;
    const mark = B.pos.length;
    const meta = b.build(B, flames, b.seed);
    // 區塊是用自己的局部座標砌的，砌完把這一段整個平移到世界位置上——
    // 包含頂點、墨線、碰撞盒與火焰。
    shift(B, mark, ox, oz, flames);
    spawns[b.id] = [meta.spawn[0] + ox, meta.spawn[1], meta.spawn[2] + oz];
  }
  grounds(B, 0x9c0d);

  const out = B.finish();
  out.flames = flames;
  out.spawns = spawns;
  return out;
}

/* 把 `from` 之後新加進來的所有東西平移。頂點與墨線是從 `from` 這個
   索引開始的那一段；碰撞盒與火焰則是「還沒有被搬過的」那些，用一個游標
   記著——比重算一次整個區塊便宜，也不必讓每個零件都去接一個 offset。 */
let _colCursor = 0, _inkCursor = 0, _flameCursor = 0;
function shift(B, fromPos, ox, oz, flames) {
  for (let i = fromPos; i < B.pos.length; i += 3) { B.pos[i] += ox; B.pos[i + 2] += oz; }
  for (let i = _inkCursor; i < B.ink.length; i += 3) { B.ink[i] += ox; B.ink[i + 2] += oz; }
  _inkCursor = B.ink.length;
  for (let i = _colCursor; i < B.colliders.length; i++) {
    const c = B.colliders[i];
    c.min[0] += ox; c.max[0] += ox; c.min[2] += oz; c.max[2] += oz;
  }
  _colCursor = B.colliders.length;
  for (let i = _flameCursor; i < flames.length; i++) { flames[i].x += ox; flames[i].z += oz; }
  _flameCursor = flames.length;
}
