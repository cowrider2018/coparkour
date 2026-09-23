/* ── test-area/src/blocks.js ─────────────────────────────────────────
   八個城堡關卡區塊：四座遺跡、兩段完好的城牆（一段塌了一截）、一間墓室、一條巷子。

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
     城牆步道   沒入黑霧的完好幕牆、兩座方塔，人在牆頂上，空氣牆擋住牆外的落差
     城牆缺口   同一段城牆塌了一截，衝刺跳過去；掉下去從起跑那一側爬回來
     地下墓室   壓低的拱肋墓室、兩排石棺、壁龕裡的頭骨、燭火
     城內窄巷   木構的連棟屋夾出一條巷子，一頭沒入黑霧、一頭是小廣場

   每一個都只回報資料（幾何、碰撞盒、出生點、火焰座標），不碰場景也不碰
   材質——組裝是 main.js 的事，這樣同一份區塊資料離線也建得起來，
   verify.mjs 就是靠這件事在 node 底下把四個區塊全部砌一遍。
   ------------------------------------------------------------------ */

import { Build, rng } from './geom.js';
import { C } from './palette.js';
import { arenaGap } from './walk.js';
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

/* ── 場地邊界的守門員 ─────────────────────────────────────────────
   撒出去的東西逐顆問「還在黑牆裡面嗎」。一叢碎石的半徑到 3.4，所以叢心
   在牆內不代表每一顆都在——而一顆被黑牆削掉一半的石頭，牆上那層薄霧
   淡不掉那個切面（切面就在牆腳，霧最濃的地方是它後面）。 */
const inArena = (A, pad = 0.4) => (x, z) => arenaGap(A, x, z) > pad;

/* ── 坐在哪一段牆上 ──────────────────────────────────────────────
   圓塔與環牆是用十幾段直牆圍出來的，而牆頂是起伏的。要把一塊石頭、一個
   垛口或一隻獸像擺在牆頭上，就得問「這個位置底下是哪一段牆、那一段砌到
   多高」——問錯（或者不問，直接寫一個 y）就是一塊浮在空中的石頭。 */
function restsOn(segs, x, z) {
  let best = 0, bd = Infinity;
  for (const w of segs) {
    const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1];
    const L2 = dx * dx + dz * dz;
    const u = Math.max(0, Math.min(1, ((x - w.a[0]) * dx + (z - w.a[1]) * dz) / L2));
    const d = Math.hypot(x - (w.a[0] + dx * u), z - (w.a[1] + dz * u));
    if (d < bd) { bd = d; best = w.topAt(u); }
  }
  return best;
}

/* ── 一、崩塌中庭 ─────────────────────────────────────────────────
   最正統的那一個：一個被兩排拱廊夾住的方形中庭，北面一座門樓。
   斷柱排成一圈但半徑 8.5——圓心那 14×14 完全是空的，那圈柱子的作用是
   把空地「框」出來，而不是站在裡面。 */
function courtyard(B, flames, seed, A) {
  const r = rng(seed);
  const keepIn = inArena(A);
  flagstones(B, { x: 0, z: 0, w: 26, d: 26, y: 0, seed: seed + 1, ruin: 0.34 });

  // 東西兩側的拱廊。長軸沿 z，所以 yaw 是 ±90°。
  for (const side of [-1, 1]) {
    arcade(B, {
      x: side * 13, z: 0, yaw: Math.PI / 2, bays: 5, span: 3.1, pier: 0.95,
      legH: 2.6, depth: 1.0, y: 0, ruin: side < 0 ? 0.5 : 0.22, seed: seed + 20 + side,
    });
  }

  /* 南面一道塌了一半的圍牆。牆後本來有三根扶壁，拿掉了：黑牆現在貼在
     牆面上，扶壁整根在牆外——從裡面看不到（牆擋著），從外面到不了
     （那已經是黑牆外面）。畫一個永遠看不到的東西不如不畫。 */
  wall(B, { from: [-13, 13], to: [13, 13], h: 4.6, thick: 1.0, ruin: 0.55, seed: seed + 40 });

  /* 北面的門樓：兩座墩、一道尖拱、一面鐵閘。拱是走得過去的（12 寬的
     開口只放閘，閘本身有碰撞，所以門是關著的——它是背景，不是路）。
     真正的出入口在東南與西北兩個缺角。 */
  const gateW = [
    wall(B, { from: [-13, -13], to: [-2.4, -13], h: 6.4, thick: 1.2, ruin: 0.28, seed: seed + 60 }),
    wall(B, { from: [2.4, -13], to: [13, -13], h: 6.4, thick: 1.2, ruin: 0.3, seed: seed + 61 }),
  ];
  /* 門樓的拱是完整的（ruin 0）。整片廢墟裡至少要有一道拱是完好的，
     不然「尖拱」這個形狀在畫面上從來沒有被說完整——而那正好是這一路
     造型語言最好認的一筆。缺口留給別的拱。 */
  pointedArch(B, { x: 0, z: -13, y: 3.6, span: 5.0, rise: 3.6, yaw: 0, thick: 0.55, depth: 1.3, ruin: 0, seed: seed + 62 });
  portcullis(B, { x: 0, z: -13, y: 0, w: 4.4, h: 3.4, yaw: 0 });
  /* 垛口分兩段，各自坐在自己那一段牆的頂上（`on`）。以前是一整排坐在
     一個給定的 6.4 上，而牆頂是起伏的——所以牆低下去的地方那幾個垛是
     浮在空中的。門洞上方沒有垛，那裡是拱。 */
  merlons(B, { from: [-13, -13], to: [-2.4, -13], on: gateW[0], h: 1.0, thick: 1.2, pitch: 1.6, ruin: 0.3, seed: seed + 63 });
  merlons(B, { from: [2.4, -13], to: [13, -13], on: gateW[1], h: 1.0, thick: 1.2, pitch: 1.6, ruin: 0.3, seed: seed + 64 });
  for (const side of [-1, 1]) {
    const gw = gateW[side < 0 ? 0 : 1];
    gargoyle(B, { x: side * 4.2, z: -12.4, y: gw.topAtPoint(side * 4.2, -13), s: 0.9, yaw: Math.PI, seed: seed + 70 + side });
    /* 門樓牆的內皮在 −12.4（牆心 −13、厚 1.2），旗從那裡撐出來。x 在 ±3.4
       而不是 ±2.9：牆在 ±2.4 就到門洞了，2.9 的話旗有一半懸在門洞上、
       靠門那一根托架釘在空氣裡。 */
    banner(B, { x: side * 3.4, y: 5.6, z: -12.4, wall: 1, yaw: 0, s: 0.95, color: side < 0 ? C.banner : C.bannerAlt });
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
      // 大石是障礙物，只放在離空地夠遠的那幾叢裡；碎石一律壓進地板。
      boulders: rad > 9.8 ? 1 : 0,
      keep: (x, z) => clearOf(7.0, 7.0)(x, z) && keepIn(x, z), seed: seed + 140 + i,
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
function rampart(B, flames, seed, A) {
  const r = rng(seed);
  const keepIn = inArena(A);
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
  /* 鋪面的基座往外放到台體的邊（out 0.8 = 那 1.6 的一半）：它要壓在四道
     牆的牆頂上才有東西頂著，而且缺掉的石板看到的是它——以前那 11 塊
     缺口是看穿到 3.2 公尺底下的真洞，因為台體中間是中空的。 */
  flagstones(B, { x: 0, z: 0, w: W - 1.6, d: D - 1.6, y: H, out: 0.8, seed: seed + 5, ruin: 0.22, cell: 1.6 });
  /* 露台的地板，一路實心到地面。以前只登記了最上面 2 公尺（1.2～3.2），
     底下那 1.2 比狗還高，於是整座台體的肚子是一片鑽得進去的空地：
     從樓梯旁的矮牆跳進第二折底下的空腔、穿過南牆的缺口，就站在露台的
     正下方了。台基本來就是實心的——四道牆只是它的外皮。 */
  B.block(0, H / 2, 0, W, H, D, { kind: 'floor', base: 0 });

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
  /* 女牆從鋪面**裡面**砌起（H − 0.14），不是從鋪面上——鋪面的基座頂在
     H − 0.10，從 H 起砌的話第一皮磚底下有 10 cm 是空的，而那就是一整排
     浮在空中的磚（掃出來 40 幾塊）。真的女牆也是砌進樓板裡的。 */
  const para = wall(B, { from: [-hw, hd - 0.1], to: [hw, hd - 0.1], h: 1.24, y: H - 0.14, thick: 0.85, ruin: 0.08, course: 0.36, seed: seed + 30 });
  merlons(B, { from: [-hw + 0.8, hd - 0.1], to: [hw - 0.8, hd - 0.1], on: para, h: 0.95, thick: 0.85, pitch: 1.55, ruin: 0.32, seed: seed + 31 });
  wall(B, { from: [-hw, -hd + 0.1], to: [GAP_L, -hd + 0.1], h: 0.89, y: H - 0.14, thick: 0.8, ruin: 0.45, course: 0.36, seed: seed + 32 });
  wall(B, { from: [GAP_R, -hd + 0.1], to: [hw, -hd + 0.1], h: 0.89, y: H - 0.14, thick: 0.8, ruin: 0.5, course: 0.36, seed: seed + 33 });

  /* 塔基：西端一座斷掉的圓塔。塔身是三圈砌石（用 12 段直牆圍成的圓，
     每段自己算 yaw），頂上一圈缺了大半的垛。 */
  const TX = -hw - 3.4, TZ = 0, TR = 3.5;
  const segs = 12;
  const tower = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    tower.push(wall(B, {
      from: [TX + Math.cos(a0) * TR, TZ + Math.sin(a0) * TR],
      to: [TX + Math.cos(a1) * TR, TZ + Math.sin(a1) * TR],
      h: 6.2, thick: 1.0, ruin: 0.42, seed: seed + 40 + i,
    }));
  }
  /* 塔頂那圈翹起的磚。以前 y 是硬編的 5.6——而塔身被 ruin 0.42 吃到更低，
     所以掃出來 19 塊裡有 7 塊是懸空的。現在問那一段塔身砌到多高。 */
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    if (r() < 0.45) continue;
    const bx = TX + Math.cos(a) * TR, bz = TZ + Math.sin(a) * TR;
    const on = restsOn(tower, bx, bz);
    if (on <= 0.5) continue;
    B.add(B.kit.brick(1.1, 0.9, 0.9, 0.06), {
      p: [bx, on + 0.42, bz],
      r: [0, -a, 0], color: r() < 0.4 ? C.stoneLit : C.stone,
    });
  }
  {
    const gx = TX, gz = TZ + TR - 0.4;
    gargoyle(B, { x: gx, z: gz, y: restsOn(tower, TX, TZ + TR), s: 1.1, yaw: 0, seed: seed + 60 });
  }

  /* 上露台的兩折階梯。兩折都完全在露台的footprint 之外，最後靠一塊
     平台接到牆的缺口上——樓梯只要有一階落在露台鋪面的正下方，那片鋪面
     的碰撞盒就會變成一道擋在半空的牆。 */
  const s1 = stair(B, { x: SX, z: -hd - 8.9, y: 0, yaw: 0, steps: 6, rise: 0.27, run: 0.62, w: 3.2, seed: seed + 70 });
  // 第二折的填石砌到地面，不是砌到第一折的頂——那 1.6 公尺底下是空的。
  const s2 = stair(B, { x: SX, z: -hd - 5.0, y: s1.top, ground: 0, yaw: 0, steps: 6, rise: 0.27, run: 0.62, w: 3.2, seed: seed + 71 });
  // 接到缺口的那塊平台，頂面跟最後一階同高。
  B.add(B.kit.brick(3.4, 0.36, 1.5, 0.06), { p: [SX, s2.top - 0.18, -hd - 0.75], color: C.granite, solid: 'step' });
  /* 平台底下的砌體，一樣到地面。它同時把南牆缺口的下半截封起來：缺口是
     給樓梯穿過牆用的，不是給人從地面走進台體裡的。 */
  {
    const fh = s2.top - 0.36;
    B.add(B.kit.brick(3.4 * 0.96, fh, 1.5 * 0.96, 0.04), {
      p: [SX, fh / 2, -hd - 0.75], color: C.stoneDeep, ink: false, solid: 'shell', base: 0,
    });
  }
  // 階梯兩側的矮牆，免得從側面掉下去。
  for (const side of [-1, 1]) {
    /* 從地面砌起，不是從 0.5 起——以前那道牆底下是一段空的，而牆是
       看得到的：那就是「浮在空中」的另一種樣子。 */
    wall(B, {
      from: [SX + side * 1.75, -hd - 9.1], to: [SX + side * 1.75, -hd - 0.2],
      h: 1.5, y: 0, thick: 0.32, ruin: 0.25, course: 0.3, brick: 0.7, seed: seed + 80 + side,
    });
  }

  /* 旗掛在城牆的外面，不是露台上。第一版掛在內側女牆的上方，而那道
     女牆只有 0.75 高——旗於是懸在露台中央的半空中，看起來像沒有掛上去。
     掛在外牆面上就沒有這個問題：布垂在牆上，垛口在它上面，這也是這種
     城牆真正掛旗的地方。 */
  /* 掛在兩根扶壁的正中間（扶壁在 0、±4.2、±8.5）。以前是 ±2.5、±7.5，
     ±7.5 那兩面有一半卡進 ±8.5 的扶壁裡。 */
  for (const t of [-6.35, -2.1, 2.1, 6.35]) {
    banner(B, { x: t, y: H - 0.35, z: hd + 0.55, wall: 1, yaw: 0, s: 0.9, color: t < 0 ? C.banner : C.bannerAlt });
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
    rubble(B, {
      x: r.range(-hw, hw), z: hd + r.range(2.2, 5.0), y: 0,
      r: r.range(1.8, 3.4), n: 24, boulders: i % 2, keep: keepIn, seed: seed + 100 + i,
    });
  }
  deadTree(B, { x: -hw - 6.5, z: -8, y: 0, s: 1.3, seed: seed + 110 });
  return { spawn: [SX, 0, -hd - 11.4] };
}

/* ── 三、王座廳 ───────────────────────────────────────────────────
   一條中軸線：門在南、台座與王座在北，兩列柱夾出中殿。屋頂沒了，只剩
   幾段斜插在地上的穹稜——那幾段是這個區塊唯一在講「這裡曾經是室內」的
   東西，所以它們刻意插在柱列外側，不擋中殿。 */
function throne(B, flames, seed, A) {
  const r = rng(seed);
  const keepIn = inArena(A);
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
  B.block(0, 0.45, 13.6, 8, 0.9, 2.6, { kind: 'floor', base: 0 });
  void d1;
  // 台座是上去站的（三級階梯接上來），所以是 'floor'；王座的背是障礙。
  /* 台座的石頭要接上最後一級階梯：碰撞盒從 z=12.3 開始（上面那個
     B.block），而石頭以前從 13.4 才開始——中間那 1.1 公尺是一片看不見
     的地板，站得上去、什麼都沒有。 */
  B.add(B.kit.brick(9, 0.9, 5.4, 0.09), { p: [0, 0.45, 15.1], color: C.granite, solid: 'floor' });
  // 王座：座、背、兩個扶手，全部是倒角石塊。
  B.add(B.kit.brick(1.9, 0.5, 1.7, 0.08), { p: [0, 1.15, 16.2], color: C.stoneLit, solid: 'floor' });
  B.add(B.kit.brick(1.9, 2.6, 0.5, 0.09), { p: [0, 2.6, 17.0], color: C.stone, solid: 'block', base: 0.9 });
  for (const side of [-1, 1]) {
    B.add(B.kit.brick(0.4, 0.7, 1.6, 0.06), { p: [side * 0.95, 1.65, 16.2], color: C.stone });
    B.add(B.kit.cone(0.22, 0.5, 6), { p: [side * 0.8, 4.05, 17.0], color: C.gold, ink: false });
  }
  wall(B, { from: [-7.6, 18.4], to: [7.6, 18.4], h: 7.2, thick: 1.1, ruin: 0.4, seed: seed + 110 });
  pointedArch(B, { x: 0, z: 18.4, y: 4.4, span: 4.6, rise: 3.4, yaw: 0, thick: 0.5, depth: 1.2, ruin: 0.22, seed: seed + 111 });
  for (const side of [-1, 1]) {
    knight(B, { x: side * 3.6, z: 14.4, y: 0.9, s: 1.15, yaw: Math.PI, damage: side < 0 ? 0 : 0.55, seed: seed + 120 + side });
    brazier(B, { x: side * 2.6, z: 12.0, y: 0, s: 1.05, seed: seed + 130 + side }, flames);
    /* 挪到柱距的正中間：火盆的缽有 0.53 寬，擺在 z = 2.0 的話它整個
       嵌在 z = 1.6 那根柱子裡（以前碰撞盒只有 0.35，看不出來）。x 也
       往外挪一點，不然缽加上身體的半徑會伸進中殿那片空地。 */
    brazier(B, { x: side * 5.35, z: 3.7, y: 0, s: 0.95, seed: seed + 140 + side }, flames);
  }

  // 南端：塌掉的正門，兩塊倒下的柱頭當踏腳石。
  wall(B, { from: [-7.6, -14.4], to: [-2.6, -14.4], h: 5.0, thick: 1.1, ruin: 0.6, seed: seed + 150 });
  wall(B, { from: [2.6, -14.4], to: [7.6, -14.4], h: 5.0, thick: 1.1, ruin: 0.6, seed: seed + 151 });
  /* 倒下的柱頭。以前是躺在地上的（頂面 0.7）——那正好是「跳一下站得
     上去、站上去只有半公尺」的高度，也就是房間裡跑起來最不該有的東西。
     現在改成斜靠在側牆上：頂面 1.7，是繞得過去的障礙物，剪影也比躺著
     的一塊石頭好認。 */
  for (let i = 0; i < 4; i++) {
    const side = i % 2 ? 1 : -1;
    B.add(B.kit.drum(0.62, 0.5, 1.7, 10), {
      p: [side * 6.9, 0.72, r.range(-12, 8)],
      r: [r.range(-0.15, 0.15), r() * 3, side * 0.95],
      color: C.stoneLit, solid: 'block', base: 0,
    });
  }
  for (let i = 0; i < 8; i++) {
    /* 碎石收進側廊（柱列與側牆之間），不再撒到 9 公尺——黑牆貼在側牆
       上，9 公尺那一圈已經在牆外面了。 */
    rubble(B, {
      x: (i % 2 ? 1 : -1) * r.range(5.8, 7.4), z: r.range(-14, 18), y: 0,
      r: r.range(1.2, 2.6), n: 16, boulders: i % 3 === 0 ? 1 : 0,
      keep: (x, z) => clearOf(5.3, 9.4)(x, z) && keepIn(x, z), seed: seed + 160 + i,
    });
  }
  return { spawn: [0, 0, -11] };
}

/* ── 四、圓塔水窖 ─────────────────────────────────────────────────
   一個圓的區塊，因為前三個都是方的。環形拱廊把整圈框起來，中央是一片
   直徑 14 的圓形鋪面；牆上剩一段貼著內壁往上爬的殘階（走得上去，但上面
   是斷的——那是刻意的，這一頁只做移動與觀賞，斷階是給人看的）。 */
function cistern(B, flames, seed, A) {
  const r = rng(seed);
  const keepIn = inArena(A);
  const R = 13;
  /* 貼牆殘階的位置：n 級，從 a0 起沿著牆爬 span 弧度，踏板中心在半徑 rr，
     石梁往外一路砌到 back（牆身裡）。碎石、火盆、枯樹都要讓開這一段——
     它底下是空的，而擺在懸臂梯底下的東西不是頂進梁裡（大石、樹），就是
     在燒上面那一級（火盆）。 */
  const STAIR = { n: 14, a0: 2.4, span: 2.3, rr: R - 1.5, back: 12.55 };
  /** (x, z) 離殘階有沒有 pad 那麼遠。角度的餘裕是踏板的半寬（1.0 公尺）加 pad。 */
  const offStair = (x, z, pad) => {
    const rad = Math.hypot(x, z);
    if (rad < STAIR.rr - 0.65 - pad) return true;
    let a = Math.atan2(z, x);
    if (a < 0) a += Math.PI * 2;
    const da = (1.0 + pad) / STAIR.rr;
    const last = STAIR.a0 + ((STAIR.n - 1) / STAIR.n) * STAIR.span;
    return a < STAIR.a0 - da || a > last + da;
  };
  /* 圓的房間、圓的鋪面。`round` 讓石板照半徑裁、基座換成一塊圓盤——
     方的基座會在環牆的四個對角戳出去 2.6 公尺。 */
  flagstones(B, { x: 0, z: 0, w: 24, d: 24, y: 0, round: R - 0.8, seed: seed + 1, ruin: 0.4, cell: 1.5 });

  // 環牆：16 段，其中四段換成尖拱的洞口（東西南北四個門）。
  const segs = 16;
  const ring = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const gate = i % 4 === 0;
    const from = [Math.cos(a0) * R, Math.sin(a0) * R];
    const to = [Math.cos(a1) * R, Math.sin(a1) * R];
    if (gate && !offStair(Math.cos(mid) * STAIR.rr, Math.sin(mid) * STAIR.rr, 0)) {
      /* 殘階正好橫過西門。懸臂石階的每一級都要砌進牆裡，門洞那一段沒有牆
         可以砌——那幾級會是真的浮在門口的空氣裡。所以這一段不開門，砌成
         整段牆。殘破度給定值、不抽籤：抽了的話後面整串亂數都會錯位。 */
      ring[i] = wall(B, { from, to, h: 6.0, thick: 1.1, ruin: 0.3, seed: seed + 10 + i });
    } else if (gate) {
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
      const w = wall(B, { from, to, h: 6.0, thick: 1.1, ruin: r.range(0.25, 0.6), seed: seed + 10 + i });
      ring[i] = w;
      if (r() < 0.5) {
        merlons(B, { from, to, on: w, h: 0.85, thick: 1.1, pitch: 1.5, ruin: 0.4, seed: seed + 70 + i });
      }
    }
    // 牆頭的獸像，四隻，朝內看。
    if (i % 4 === 2 && ring[i]) {
      // 獸像坐在這一段牆頂實際的高度上（這一段的 ruin 是 0.25～0.6 隨機的）
      gargoyle(B, {
        x: Math.cos(mid) * (R - 0.9), z: Math.sin(mid) * (R - 0.9),
        y: ring[i].topAtPoint(Math.cos(mid) * R, Math.sin(mid) * R) - 0.1, s: 0.95,
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
  for (let i = 0; i < STAIR.n; i++) {
    const a = STAIR.a0 + (i / STAIR.n) * STAIR.span;
    const rr = STAIR.rr;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    /* 第一級從 0.18 起（頂面 0.33），所以走得上去——以前是 0.3 起、
       頂面 0.45，比抬腳的 0.36 高，得跳一下才上得去第一級。 */
    const y = 0.18 + i * 0.32;
    const yaw = -a + Math.PI / 2;
    // 這一塊的兩條軸：u 沿著牆（踏板的長邊），v 往外指向牆。
    const ux = [Math.cos(yaw), -Math.sin(yaw)], uv = [Math.sin(yaw), Math.cos(yaw)];
    /* 懸臂石階：每一級是一根從牆裡伸出來的石梁，底下是空的——塔樓裡的
       旋轉梯就是這樣砌的，所以狗走得進樓梯底下是對的。

       「懸空」與「浮在空中」的差別只在一件事：石梁有沒有砌進牆裡。以前踏板
       的外緣停在 12.15，而牆的內皮在 12.2～12.45，中間那一條縫讓十四塊板
       看起來是黏在牆面上的。現在踏板和它底下那塊梁身都往外一路伸進牆身
       （到 back），從房間裡看，每一級都是從牆裡長出來的。 */
    const inner = rr - 0.65;                        // 踏板內緣（房間那一側）
    const depth = STAIR.back - inner;               // 內緣 → 牆裡
    const off = inner + depth / 2 - rr;             // 石梁中心相對踏板中心往外多少
    const cx = x + uv[0] * off, cz = z + uv[1] * off;
    B.add(B.kit.brick(2.0, 0.3, depth, 0.05), {
      p: [cx, y, cz], r: [0, yaw, 0],
      color: i % 2 ? C.granite : C.graniteDark,
    });
    // 踏板底下的梁身：一級 0.32 厚，讓每一級讀起來是一塊石梁而不是一片板。
    B.add(B.kit.brick(1.9, 0.32, depth - 0.1, 0.04), {
      p: [cx + uv[0] * 0.05, y - 0.31, cz + uv[1] * 0.05], r: [0, yaw, 0], color: C.stoneDeep, ink: false,
    });
    /* 碰撞：踏板加梁身那一段（y − 0.47 ～ y + 0.15），切成 4×3 的小格。
       這一塊是斜的而碰撞盒是軸對齊的——整塊一個盒子的話，45° 那幾級的
       外接盒會往房間裡多伸半公尺，底下就是一片看不見的天花板（站在火盆上
       的狗頭頂上以前就有一片）。切小之後每格只胖幾公分。

       `open`：這一級底下是故意空著的。驗證器掃「鑽進建築底下的空心」時
       認得這個字，懸臂梯底下的空間不算。 */
    const bot = Math.max(0, y - 0.47), top = y + 0.15;
    const cw = 2.0 / 4, cd = depth / 3;
    const ex = Math.abs(ux[0]) * cw + Math.abs(uv[0]) * cd;
    const ez = Math.abs(ux[1]) * cw + Math.abs(uv[1]) * cd;
    for (let u = 0; u < 4; u++) {
      for (let v = 0; v < 3; v++) {
        const lu = (u - 1.5) * cw, lv = (v - 1) * cd;
        B.block(cx + ux[0] * lu + uv[0] * lv, (bot + top) / 2, cz + ux[1] * lu + uv[1] * lv,
          ex, top - bot, ez, { kind: 'step', open: true });
      }
    }
    if (i === STAIR.n - 1) {
      for (let k = 0; k < 4; k++) {
        B.add(B.kit.brick(0.5, 0.22, 0.4, 0.04), {
          p: [x + r.range(-0.8, 0.8), y + 0.26, z + r.range(-0.6, 0.6)],
          r: [r.range(-0.4, 0.4), r() * 3, r.range(-0.4, 0.4)], color: C.stoneDeep,
        });
      }
    }
  }

  // 從殘存的穹稜垂下來的鎖鏈，以及牆邊的火盆與根。
  /* 起始角 0.6 而不是 0.8：殘階佔了整圈的三分之一以上，四個等分的角度裡
     至少一個落在它上面。0.8 的時候是兩個（一盆火嵌在第九級底下、另一盆
     頂著第一級），0.6 只剩一個，那一組就不擺。 */
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6;
    if (!offStair(Math.cos(a) * 10.4, Math.sin(a) * 10.4, 0.6)) continue;
    // 鏈子掛在牆頭上，不是掛在一個寫死的 5.6——牆頭比它低的地方，鏈子
    // 的上端會浮在牆外面的空氣裡。
    const anchor = Math.max(2.9, restsOn(ring.filter(Boolean), Math.cos(a) * R, Math.sin(a) * R) - 0.3);
    chain(B, {
      from: [Math.cos(a) * (R - 1.2), anchor, Math.sin(a) * (R - 1.2)],
      to: [Math.cos(a) * (R - 3.0), anchor - 3.2, Math.sin(a) * (R - 3.0)],
      n: 12, sag: 0.9,
    });
    brazier(B, { x: Math.cos(a) * 10.4, z: Math.sin(a) * 10.4, y: 0, s: 1, seed: seed + 150 + i }, flames);
  }
  for (let i = 0; i < 3; i++) {
    const a = r() * Math.PI * 2;
    const s = r.range(0.8, 1.2);          // 先抽：跳過的那一棵不能讓後面的亂數整串錯位
    if (!offStair(Math.cos(a) * 11.2, Math.sin(a) * 11.2, 0.8)) continue;
    deadTree(B, { x: Math.cos(a) * 11.2, z: Math.sin(a) * 11.2, y: 0, s, seed: seed + 160 + i });
  }
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2, rad = r.range(8.5, 12.5);
    rubble(B, {
      x: Math.cos(a) * rad, z: Math.sin(a) * rad, y: 0, r: r.range(1.4, 2.8), n: 20,
      boulders: rad > 10.5 ? 1 : 0,
      // 大石的半徑到 1 公尺，所以離殘階要留 1.3：石頭本身加上一個身體寬，
      // 不然石頭與石階之間會夾出一條進得去、爬不出來的縫。
      keep: (x, z) => clearOf(7.0, 7.0, 7.4)(x, z) && keepIn(x, z) && offStair(x, z, 1.3),
      seed: seed + 170 + i,
    });
  }
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2, rad = r.range(6.5, 12);
    mossTuft(B, Math.cos(a) * rad, 0, Math.sin(a) * rad, r);
  }
  return { spawn: [0, 0, -6] };
}

/* ── 完好城牆的零件：女牆、幕牆、方塔 ────────────────────────────
   城牆步道與城牆缺口共用。三支都只收軸對齊的東西——這兩座全部是直角，
   空氣牆因此就是女牆的外框本身，一公分都不多。 */

/**
 * 女牆與空氣牆。`H` 是走道面：女牆從鋪面裡面砌起（H − 0.14，理由見城牆
 * 平台），外框同時立一道空氣牆，從走道面稍下一點一路到場地的封頂。
 */
function battlements(B, seed, A, H) {
  const air = (x0, z0, x1, z1, y0 = H - 0.2) => B.air(x0, z0, x1, z1, y0, A.lid);
  const parapet = (from, to, h, th, crenel, s) => {
    const w = wall(B, { from, to, h, y: H - 0.14, thick: th, ruin: 0, course: 0.36, seed: seed + s });
    /* ruin 給 1e-6 而不是 0：merlons 的預設是 `ruin || 0.3`，0 會被當成「沒給」，
       於是完好的城牆少了三成垛口。 */
    if (crenel) merlons(B, { from, to, on: w, h: 0.9, thick: th, pitch: 1.5, ruin: 1e-6, seed: seed + s + 1 });
    if (from[1] === to[1]) air(from[0], from[1] - th / 2, to[0], to[1] + th / 2);
    else air(from[0] - th / 2, from[1], to[0] + th / 2, to[1]);
    return w;
  };
  return { air, parapet };
}

/**
 * 一段幕牆的兩道牆面（x0..x1，厚 T，高 h），加上牆腳一條外放的基石、
 * 牆頂下一條挑出的壓簷。兩條水平線是完好的城牆與遺跡最大的差別：遺跡的
 * 牆頂是鋸齒，這裡是一條直線，而且它一路延伸進黑霧裡。
 *
 * 牆芯不在這裡登記（碰撞是呼叫端的事），因為缺口那一座的牆芯不是一整塊。
 * `cornice: false` 給塌掉那一段用——斷牆沒有壓簷。
 */
function curtain(B, seed, o) {
  const { x0, x1, h, T, WT, s = 0 } = o;
  const len = x1 - x0, xm = (x0 + x1) / 2;
  for (const side of [-1, 1]) {
    const zc = side * (T / 2 - WT / 2);
    wall(B, { from: [x0, zc], to: [x1, zc], h, thick: WT, ruin: o.ruin || 0, course: o.course, seed: seed + 10 + s + side });
    B.add(B.kit.brick(len, 0.5, 0.5, 0.05), { p: [xm, 0.25, side * (T / 2 + 0.1)], color: C.stoneDark });
    if (o.cornice === false) continue;
    B.hangs(true);
    B.add(B.kit.brick(len, 0.24, 0.34, 0.05), { p: [xm, h - 0.3, side * (T / 2 + 0.1)], color: C.stoneLit });
    B.hangs(false);
  }
}

/**
 * 一座方塔：從幕牆外皮（z = T/2）往城外凸到 TZ，寬 TW，中心 x = xc。
 * 塔頂跟走道同高，是走道往外長出去的一塊；三面女牆都有垛口，外側兩角
 * 各一盆火。`sx` 只拿來錯開亂數與旗色，讓兩座塔不長得一模一樣。
 */
function squareTower(B, flames, seed, parapet, o) {
  const { xc, sx, H, T, WT, TW, TZ, course, OUT } = o;
  const xa = xc - TW / 2, xb = xc + TW / 2;
  const z0 = T / 2, zm = (z0 + TZ) / 2, D = TZ - z0;
  // 塔身三面（第四面就是幕牆）。
  wall(B, { from: [xa, TZ - WT / 2], to: [xb, TZ - WT / 2], h: H, thick: WT, ruin: 0, course, seed: seed + 50 + sx });
  wall(B, { from: [xa + WT / 2, z0], to: [xa + WT / 2, TZ], h: H, thick: WT, ruin: 0, course, seed: seed + 52 + sx });
  wall(B, { from: [xb - WT / 2, z0], to: [xb - WT / 2, TZ], h: H, thick: WT, ruin: 0, course, seed: seed + 54 + sx });
  B.add(B.kit.brick(TW + 0.2, 0.5, D + 0.1, 0.05), { p: [xc, 0.25, zm + 0.05], color: C.stoneDark });
  B.block(xc, H / 2, zm, TW, H, D, { kind: 'floor', base: 0 });
  /* 塔頂的鋪面接在幕牆鋪面的外緣上：幕牆那一片的外緣在 T/2 − WT/2，
     這一片從那裡開始，所以兩片之間沒有縫。 */
  const fz0 = T / 2 - WT / 2, fz1 = TZ - WT / 2;
  flagstones(B, { x: xc, z: (fz0 + fz1) / 2, w: TW - WT, d: fz1 - fz0, y: H, out: 0.5, seed: seed + 60 + sx, ruin: 0.02, cell: 1.5 });
  parapet([xa, TZ - 0.35], [xb, TZ - 0.35], 1.3, 0.7, true, 70 + sx * 5);
  parapet([xa + 0.35, OUT - 0.35], [xa + 0.35, TZ - 0.7], 1.3, 0.7, true, 80 + sx * 5);
  parapet([xb - 0.35, OUT - 0.35], [xb - 0.35, TZ - 0.7], 1.3, 0.7, true, 90 + sx * 5);
  for (const bx of [xa + 1.6, xb - 1.6]) {
    brazier(B, { x: bx, z: TZ - 1.6, y: H, s: 0.95, seed: seed + 120 + sx * 3 + (bx > xc ? 1 : 0) }, flames);
  }
  banner(B, { x: xc, y: H - 0.35, z: TZ, wall: 1, yaw: 0, s: 1.0, color: sx < 0 ? C.banner : C.bannerAlt });
  return { xa, xb };
}

/** 牆腳的地面：只有苔。完好的城牆，牆腳沒有塌下來的石頭。 */
function footMoss(B, r, A, n, onWall) {
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, rad = r.range(4, A.r - 1.5);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (!onWall(x, z)) mossTuft(B, x, 0, z, r);
  }
}

/* ── 五、城牆步道 ─────────────────────────────────────────────────
   一段完好的幕牆。前四座都是遺跡，這一座是「還在用的城牆」——所以 ruin
   一律是 0：牆頂是平的、垛口一個不缺、鋪面沒有缺塊。

   人從頭到尾都在牆頂上。走道面在 5.2 公尺、女牆之間 6.1 公尺寬（第一版
   只有 3.3，兩側的女牆加垛口比狗高一倍，走起來像在一條溝裡）。幕牆兩端
   **直接穿進黑牆**：黑牆是不透明的，牆在它後面怎麼收尾永遠看不到，而內側
   那幾層加厚的黑霧讓走道一路淡進黑暗——看起來這段牆沒有盡頭。

   女牆外面是空的，所以把人留在牆上的是**空氣牆**：沿著每一道女牆的外框
   立到封頂，女牆與垛口爬不上去、也跳不過去；走道的兩端由黑牆本身擋住。
   鏡頭不吃空氣牆，吊臂伸得出牆外，看得到城牆的立面與底下的地面。

   座標：幕牆沿 x，外側（城外）是 +z。中段兩座方塔往城外凸出——塔是用來
   從側面射擊牆腳的，所以它凸在牆外面；塔頂跟走道同高，是走道的延伸。 */
function wallwalk(B, flames, seed, A) {
  const r = rng(seed);
  const H = 5.2;                 // 走道面
  const L = A.r + 3;             // 幕牆半長：穿出黑牆 3 公尺，切面藏在牆外
  const T = 7.4;                 // 幕牆厚（z −T/2..T/2）
  const WT = 1.1;                // 牆身一皮石頭多厚
  /* 一皮多高。預設的 0.44 砌不整 5.2——最上面那一皮會凸出走道面 8 公分，
     女牆蓋得住的地方看不到，塔口那一段就是一排絆腳的磚。0.4 剛好 13 皮。 */
  const COURSE = H / 13;
  const TW = 7.2;                // 塔寬（x）
  const TC = 12;                 // 兩座塔的中心 x = ±TC
  const TZ = T / 2 + 4.0;        // 塔往城外凸到哪裡
  const OUT = T / 2 - 0.35, IN = -T / 2 + 0.3;   // 外側、內側女牆的中線
  const { parapet } = battlements(B, seed, A, H);

  // ── 幕牆：整段穿過黑牆，所以這一段的幾何全部標 pierces ──
  B.pierces(true);
  curtain(B, seed, { x0: -L, x1: L, h: H, T, WT, course: COURSE });
  flagstones(B, { x: 0, z: 0, w: 2 * L, d: T - WT, y: H, out: 0.5, seed: seed + 20, ruin: 0.02, cell: 1.5 });
  // 城內那一側是一道連續的矮牆；城外那一側有垛口，在兩座塔那裡讓開。
  parapet([-L, IN], [L, IN], 0.95, 0.6, false, 40);
  const gaps = [[-L, -TC - TW / 2], [-TC + TW / 2, TC - TW / 2], [TC + TW / 2, L]];
  gaps.forEach(([x0, x1], i) => parapet([x0, OUT], [x1, OUT], 1.1, 0.7, true, 30 + i * 3));
  B.pierces(false);
  B.block(0, H / 2, 0, 2 * L, H, T, { kind: 'floor', base: 0 });

  for (const sx of [-1, 1]) {
    squareTower(B, flames, seed, parapet, { xc: sx * TC, sx, H, T, WT, TW, TZ, course: COURSE, OUT });
  }
  // 兩座塔之間那一段幕牆，城外那一面掛兩面旗。
  for (const t of [-3.6, 3.6]) {
    banner(B, { x: t, y: H - 0.55, z: T / 2, wall: 1, yaw: 0, s: 0.9, color: t < 0 ? C.bannerAlt : C.banner });
  }
  footMoss(B, r, A, 30, (x, z) => Math.abs(z) < T / 2 + 0.7
    || (z > 0 && z < TZ + 0.6 && Math.abs(Math.abs(x) - TC) < TW / 2 + 0.6));
  // 出生點在走道正中，面朝東（+x）：一眼看到東塔，和它後面沒入黑霧的那一段牆。
  return { spawn: [0, H, 0], yaw: Math.PI / 2 };
}

/* ── 六、城牆缺口 ─────────────────────────────────────────────────
   城牆步道的那一段牆，中段塌了。走道斷開 4.5 公尺——走路跳過不去（走速
   跳得了 2.8 公尺加上身體的半徑），要衝刺跳。這是這一頁第一個「要練」的
   東西。

   跳不過就掉進缺口：塌下來的石頭把牆芯填到 2.0 公尺，四周一樣是空氣牆，
   掉下去不會掉出城外。爬回去的路只在起跑那一側——兩塊倒下來的方石疊成
   兩級台階，一級一公尺出頭，跳得上去。對岸那一面是整齊的斷面，爬不上
   去；不然掉下去再從對岸爬上來，這一跳就沒有意義了。

   對岸是一座方塔，跳過去的獎勵是塔頂的兩盆火與一面旗。

   座標跟城牆步道一樣：幕牆沿 x，城外是 +z，兩端穿進黑牆。缺口偏東，
   讓場地中心（原點）落在西段的走道上，出生點面朝東就看得到那道缺口。 */
function breach(B, flames, seed, A) {
  const r = rng(seed);
  const H = 5.2, T = 7.4, WT = 1.1, COURSE = H / 13;
  const L = A.r + 3;
  /* 缺口的 x 範圍，寬 4.5。4.2 的時候走路起跳落在對岸 0.3 公尺前——踩在最邊緣
     起跳就勉強過得去，那就不是「要衝刺」了。 */
  const G0 = 4.5, G1 = 9.0;
  const PIT = 2.0;               // 缺口底：塌下來的石頭填到這麼高
  const TC = 14.4, TW = 7.2, TZ = T / 2 + 4.0;
  const OUT = T / 2 - 0.35, IN = -T / 2 + 0.3;
  const IW = T - 2 * WT;         // 兩道牆面之間的牆芯寬
  const { air, parapet } = battlements(B, seed, A, H);

  // ── 西段與東段：跟城牆步道一樣完好，只是停在缺口邊上 ──
  B.pierces(true);
  curtain(B, seed, { x0: -L, x1: G0, h: H, T, WT, course: COURSE, s: 0 });
  curtain(B, seed, { x0: G1, x1: L, h: H, T, WT, course: COURSE, s: 5 });
  /* 鋪面停在缺口前半公尺，基座（外放 0.5）剛好停在斷面上——基座再往外
     就是一片懸在缺口上方的石板。 */
  flagstones(B, { x: (-L + G0 - 0.5) / 2, z: 0, w: G0 - 0.5 + L, d: T - WT, y: H, out: 0.5, seed: seed + 20, ruin: 0.05, cell: 1.5 });
  flagstones(B, { x: (G1 + 0.5 + L) / 2, z: 0, w: L - G1 - 0.5, d: T - WT, y: H, out: 0.5, seed: seed + 21, ruin: 0.05, cell: 1.5 });
  parapet([-L, IN], [G0, IN], 0.95, 0.6, false, 40);
  parapet([G1, IN], [L, IN], 0.95, 0.6, false, 44);
  parapet([-L, OUT], [G0, OUT], 1.1, 0.7, true, 30);
  parapet([G1, OUT], [TC - TW / 2, OUT], 1.1, 0.7, true, 33);
  parapet([TC + TW / 2, OUT], [L, OUT], 1.1, 0.7, true, 36);
  B.pierces(false);
  B.block((-L + G0) / 2, H / 2, 0, G0 + L, H, T, { kind: 'floor', base: 0 });
  B.block((G1 + L) / 2, H / 2, 0, L - G1, H, T, { kind: 'floor', base: 0 });

  /* 斷面。兩道牆面之間是牆芯，塌開之後看得到——所以兩端各砌一塊暗色的
     填石封住切口，頂面停在鋪面基座底下。沒有它，站在缺口上往下看就是
     兩道牆面中間一條空的縫。 */
  for (const [x0, x1] of [[G0 - 0.6, G0], [G1, G1 + 0.6]]) {
    B.add(B.kit.brick(x1 - x0, H - 0.45, IW, 0.05), { p: [(x0 + x1) / 2, (H - 0.45) / 2, 0], color: C.stoneDeep });
  }

  // ── 缺口：塌到只剩 2 公尺的牆面，中間填滿碎石 ──
  curtain(B, seed, { x0: G0, x1: G1, h: PIT, T, WT, ruin: 0.4, course: PIT / 5, s: 20, cornice: false });
  B.add(B.kit.brick(G1 - G0, PIT, IW, 0.05), { p: [(G0 + G1) / 2, PIT / 2, 0], color: C.stoneDeep });
  B.block((G0 + G1) / 2, PIT / 2, 0, G1 - G0, PIT, T, { kind: 'floor', base: 0 });
  /* 缺口四周的空氣牆從缺口底立起。走道那一段的空氣牆在女牆上（H − 0.2），
     這一段沒有女牆，所以要從坑底算。 */
  air(G0 - 0.05, T / 2 - 0.7, G1 + 0.05, T / 2, PIT - 0.2);
  air(G0 - 0.05, -T / 2, G1 + 0.05, -T / 2 + 0.6, PIT - 0.2);
  // 坑底的碎石。大石只放在東半邊，免得擋住爬回去的那兩級。
  rubble(B, {
    x: (G0 + G1) / 2, z: 0, y: PIT, r: 2.4, n: 30, boulders: 1,
    keep: (x, z) => x > G0 + 2.2 && x < G1 - 0.4 && Math.abs(z) < 2.4, seed: seed + 60,
  });

  /* 爬回去的兩級：倒下來的方石，一塊 1.2 高、一塊 2.3 高，靠著西邊的斷面。
     坑底 2.0 → 3.2 → 4.3 → 走道 5.2，每一跳 0.9～1.2，都在 MOUNT（1.74）以內。
     石頭歪一點點（0.06 弧度），碰撞取石頭本身的 96%：歪的外接盒會比石頭
     胖，而踩上去的人感覺得到那幾公分。 */
  const stones = [
    { x: G0 + 0.85, z: 1.3, w: 1.7, d: 2.2, h: 1.2, yaw: 0.06 },
    { x: G0 + 0.5, z: -0.7, w: 1.0, d: 1.8, h: 2.3, yaw: -0.05 },
  ];
  for (const s of stones) {
    B.add(B.kit.brick(s.w, s.h, s.d, 0.08), { p: [s.x, PIT + s.h / 2, s.z], r: [0, s.yaw, 0], color: C.stone });
    B.block(s.x, PIT + s.h / 2, s.z, s.w * 0.96, s.h, s.d * 0.96, { kind: 'floor', base: PIT });
  }

  squareTower(B, flames, seed, parapet, { xc: TC, sx: 1, H, T, WT, TW, TZ, course: COURSE, OUT });
  banner(B, { x: -3.6, y: H - 0.55, z: T / 2, wall: 1, yaw: 0, s: 0.9, color: C.bannerAlt });
  footMoss(B, r, A, 30, (x, z) => Math.abs(z) < T / 2 + 0.7
    || (z > 0 && z < TZ + 0.6 && Math.abs(x - TC) < TW / 2 + 0.6));
  // 出生點在西段，面朝東：缺口就在正前方十公尺。
  return { spawn: [-6, H, 0], yaw: Math.PI / 2 };
}

/* ── 七、地下墓室 ─────────────────────────────────────────────────
   一間壓低的墓室。從南端一道樓梯頂上的鐵閘前進來（那是來時的路，閘是
   關的），往下走進兩排石棺之間的走道；北端兩級台階上去是一座大墓。

   頂是黑的，但不是空的：七道橫跨整間的尖拱肋從兩側的壁柱起拱，拱與拱
   之間是黑牆封的頂——所以抬頭看到的是「肋」而不是「天」，黑色讀起來是
   拱頂深處的陰影。封頂壓在拱頂上方一公尺多，是全片最低的。

   石棺是平台（'floor'）：一公尺高，跳得上去，可以在棺蓋上跑。兩側牆上
   一格一格的壁龕放著頭骨，棺蓋上點著蠟燭。 */
function crypt(B, flames, seed, A) {
  const r = rng(seed);
  const X = 7.6, Z = 14.4;               // 牆的中線（±X、±Z）
  const IX = X - 0.45, IZ = Z - 0.45;    // 牆的內皮
  const WH = 6.0;
  flagstones(B, { x: 0, z: 0, w: 2 * IX, d: 2 * IZ, y: 0, seed: seed + 1, ruin: 0.22, cell: 1.5 });
  wall(B, { from: [-X, -Z], to: [X, -Z], h: WH, thick: 0.9, ruin: 0.08, seed: seed + 2 });
  wall(B, { from: [-X, Z], to: [X, Z], h: WH, thick: 0.9, ruin: 0.08, seed: seed + 3 });
  wall(B, { from: [-X, -Z], to: [-X, Z], h: WH, thick: 0.9, ruin: 0.08, seed: seed + 4 });
  wall(B, { from: [X, -Z], to: [X, Z], h: WH, thick: 0.9, ruin: 0.08, seed: seed + 5 });

  // ── 拱肋與壁柱 ──
  const SPRING = 2.6;
  for (let i = 0; i < 7; i++) {
    const z = -12 + i * 4;
    pointedArch(B, { x: 0, z, y: SPRING, span: 2 * IX, rise: 3.1, yaw: 0, thick: 0.42, depth: 0.55, ruin: 0, seed: seed + 10 + i });
    for (const side of [-1, 1]) {
      B.add(B.kit.brick(0.6, SPRING, 0.8, 0.05), {
        p: [side * (IX - 0.3), SPRING / 2, z], color: i % 2 ? C.stone : C.stoneDark, solid: 'block', base: 0,
      });
      B.add(B.kit.brick(0.8, 0.2, 1.0, 0.05), { p: [side * (IX - 0.4), SPRING + 0.1, z], color: C.stoneLit });
    }
  }

  // ── 壁龕：壁柱之間的兩層，暗色的底板、一條石架、架上幾顆頭骨 ──
  for (let i = 0; i < 6; i++) {
    const z = -10 + i * 4;
    for (const side of [-1, 1]) {
      for (const y of [0.9, 1.75]) {
        B.add(B.kit.brick(0.06, 0.62, 2.4, 0.01), { p: [side * (IX - 0.02), y + 0.31, z], color: C.stoneDeep, ink: false });
        B.add(B.kit.brick(0.34, 0.08, 2.5, 0.02), { p: [side * (IX - 0.15), y, z], color: C.stoneLit });
        const n = 2 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const sz = z + (k - (n - 1) / 2) * 0.5 + r.range(-0.08, 0.08);
          B.add(B.kit.blob(0.11), { p: [side * (IX - 0.16), y + 0.14, sz], s: [1, 0.9, 1.1], color: C.bone });
          // 兩個眼窩，朝著房間。沒有它，一排頭骨讀起來是一排石頭。
          for (const e of [-0.045, 0.045]) {
            B.add(B.kit.blob(0.028), { p: [side * (IX - 0.26), y + 0.16, sz + e], color: 0x161310, ink: false });
          }
        }
      }
    }
  }

  // ── 石棺：兩排，每排四具。蓋子有的滑開了一截，露出黑的內膛 ──
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = side * 4.2, z = -6.4 + i * 4.2;
      B.add(B.kit.brick(1.2, 0.8, 2.3, 0.05), { p: [x, 0.4, z], color: i % 2 ? C.stone : C.stoneDark });
      const open = r() < 0.35;
      const dz = open ? 0.45 : 0, yaw = open ? r.range(-0.12, 0.12) : 0;
      if (open) B.add(B.kit.brick(1.0, 0.04, 2.1, 0.01), { p: [x, 0.8, z], color: 0x161310, ink: false });
      B.add(B.kit.brick(1.34, 0.22, 2.44, 0.05), { p: [x, 0.91, z + dz], r: [0, yaw, 0], color: C.stoneLit });
      // 碰撞蓋住棺身加滑開的那一截蓋子。
      B.block(x, 0.51, z + dz / 2, 1.4, 1.02, 2.5 + dz, { kind: 'floor', base: 0 });
      // 蠟燭：棺蓋的一角一根，火苗交給 main.js 做（跟火盆同一份火焰，縮小）。
      const cz = z + dz + (r() < 0.5 ? -0.85 : 0.85), cx = x - side * 0.42;
      B.add(B.kit.drum(0.06, 0.07, 0.22, 7), { p: [cx, 1.13, cz], color: C.bone });
      flames.push({ x: cx, y: 1.29, z: cz, s: 0.22 });
    }
  }

  // ── 北端：兩級台階、台座、大墓、兩盆火 ──
  stair(B, { x: 0, z: 9.6, y: 0, yaw: 0, steps: 2, rise: 0.3, run: 0.6, w: 5.0, seed: seed + 40 });
  B.add(B.kit.brick(5.4, 0.6, IZ - 10.8, 0.06), { p: [0, 0.3, (10.8 + IZ) / 2], color: C.granite, solid: 'floor' });
  B.add(B.kit.brick(1.7, 1.1, 2.8, 0.06), { p: [0, 0.6 + 0.55, 12.3], color: C.stoneDark });
  B.add(B.kit.brick(1.9, 0.24, 3.0, 0.06), { p: [0, 1.82, 12.3], color: C.stoneLit });
  B.block(0, 1.27, 12.3, 1.9, 1.34, 3.0, { kind: 'floor', base: 0.6 });   // 0.6～1.94，到石蓋的頂
  for (const side of [-1, 1]) brazier(B, { x: side * 2.0, z: 13.1, y: 0.6, s: 0.8, seed: seed + 50 + side }, flames);

  // ── 南端：來時的路。一道樓梯上到一塊平台，平台後面是關著的鐵閘 ──
  /* 從 −8.4 起、往南七級：最後一級停在 −12.74，平台就有 1.2 公尺深——扣掉
     鐵閘的 0.3，還站得下一隻狗。 */
  const up = stair(B, { x: 0, z: -8.4, y: 0, yaw: Math.PI, steps: 7, rise: 0.3, run: 0.62, w: 3.0, seed: seed + 60 });
  const end = -8.4 - up.depth;                  // 最後一級的外緣
  const LZ = (end - IZ) / 2, LD = end + IZ + 0.04;
  B.add(B.kit.brick(3.2, 0.3, LD, 0.05), { p: [0, up.top - 0.15, LZ], color: C.granite, solid: 'step' });
  B.add(B.kit.brick(3.0, up.top - 0.3, LD * 0.96, 0.04), {
    p: [0, (up.top - 0.3) / 2, LZ], color: C.stoneDeep, ink: false, solid: 'shell', base: 0,
  });
  // 閘後面是一片黑：通道往外面去，這裡看不到它通到哪。
  B.add(B.kit.brick(2.6, 2.8, 0.06, 0.01), { p: [0, up.top + 1.4, -IZ + 0.03], color: 0x161310, ink: false });
  portcullis(B, { x: 0, z: -IZ + 0.15, y: up.top, w: 2.4, h: 2.6, yaw: 0 });

  /* 出生點在走道南段，面朝北（+z）。不是鐵閘前的平台：那裡背後貼著牆，
     鏡頭的吊臂一伸就撞牆，縮到角色的頭裡面。站在這裡，鏡頭落在樓梯上方，
     來時的那道樓梯與鐵閘就在畫面的下緣。 */
  return { spawn: [0, 0, -6], yaw: 0 };
}

/* ── 八、城內窄巷 ─────────────────────────────────────────────────
   一條 5.4 公尺寬的巷子，兩邊是一整排木構的連棟屋。巷子南端沒入黑霧
   （跟城牆步道同一招：房子一路蓋進黑牆裡），北端開成一個小廣場，中間一口
   井，角落堆著木箱與木桶——那幾個跳得上去。

   牆面刻意是素的：一條石砌的牆基，上面一整片抹灰，深色的木樑、木柱與
   斜撐釘在外面。第一版整排都是一皮一皮的磚加階梯山牆，巷子窄、兩側貼得
   近，滿眼都是磚縫，走一段就看累了。木構給的是少數幾條粗線，而那幾條線
   本身就是這條巷子的節奏。

   房子是封起來的，進不去也上不去（簷口最低 4.6，木箱疊兩層只到 1.8，
   加上跳躍的 1.74 還差一公尺）。所以房子的碰撞就是一個盒子，屋頂另一個
   盒子擋鏡頭——不需要一個「站在屋頂上會怎樣」的答案。 */

/**
 * 一棟木構的連棟屋。`at(u, v)` 把房子自己的座標換成世界的 x, z：u 沿著
 * 立面（−W/2..W/2），v 從立面往後（0..D）。`vx` 表示 v 軸是不是沿著 x
 * ——斜的木料與屋頂要繞著某一根世界軸轉，而 three 的旋轉是照世界軸給的。
 * `us` 是 u 軸在世界裡的正負號（±1），斜板往哪一邊倒靠它。
 */
function house(B, seed, o) {
  const r = rng(seed);
  const { at, W, D, e, vx } = o;
  const PL = 0.9;                         // 石砌牆基多高
  const GT = 0.5;                         // 山牆多厚
  const gh = (W / 2) * 1.1;               // 山牆多高（屋頂約 48°）
  const FL = Math.max(PL + 1.9, e * 0.5); // 二樓的樓板線
  const wallC = o.alt ? C.plasterAlt : C.plaster;
  const size = (u, v) => (vx ? [v, u] : [u, v]);   // (沿立面, 往後) → (x, z)
  const [cx, cz] = at(0, D / 2);

  /* 牆身：一塊牆基加一塊抹灰。碰撞一個盒子從地面到簷口——房子進不去，
     裡面是空的還是實的沒有人看得到。

     立面那一層（v 0～RD）另外砌，因為門要嵌進牆裡：牆面在門口開一個洞，
     門板退到洞底，比牆面深 RD − 0.06。一整塊牆身的話門只能貼在牆面外面，
     看起來像靠在牆上的一片木板。 */
  const RD = 0.18;                        // 立面那一層多厚，也就是門洞多深
  const du = (r() < 0.5 ? -1 : 1) * W / 4;  // 門的位置
  const DW = 1.1, DH = 2.2;               // 門洞寬、高
  const slab = (u0, u1, v0, v1, y0, y1, color) => {
    const [x, z] = at((u0 + u1) / 2, (v0 + v1) / 2);
    const [sx, sz] = size(u1 - u0, v1 - v0);
    B.add(B.kit.brick(sx, y1 - y0, sz, 0.03), { p: [x, (y0 + y1) / 2, z], color });
  };
  {
    const a = du - DW / 2, b = du + DW / 2;
    // 後面那一大塊：牆基往兩側與背面外放 0.04，抹灰就是房子本身。
    slab(-W / 2 - 0.04, W / 2 + 0.04, RD, D + 0.04, 0, PL, C.stoneDark);
    slab(-W / 2, W / 2, RD, D, PL, e, wallC);
    // 立面那一層：牆基（外放 0.04）與抹灰，都在門洞兩側斷開；門洞上方補一塊。
    slab(-W / 2 - 0.04, a, -0.04, RD, 0, PL, C.stoneDark);
    slab(b, W / 2 + 0.04, -0.04, RD, 0, PL, C.stoneDark);
    slab(-W / 2, a, 0, RD, PL, e, wallC);
    slab(b, W / 2, 0, RD, PL, e, wallC);
    slab(a, b, 0, RD, DH, e, wallC);
    const [bx, bz] = size(W, D);
    B.block(cx, e / 2, cz, bx, e, bz, { kind: 'shell', base: 0 });
  }

  // 山牆：前後各一片抹灰的三角形。
  for (const v of [GT / 2, D - GT / 2]) {
    const [x, z] = at(0, v);
    B.add(B.kit.gable(W, gh, GT), { p: [x, e, z], r: [0, vx ? Math.PI / 2 : 0, 0], color: wallC });
  }

  /* 屋頂：兩塊斜板，從簷口斜到屋脊，前後各挑出山牆 0.15。木構房子的屋頂
     本來就壓在山牆外面，挑出去的那一截是山牆上最好認的一條影子。 */
  const th = Math.atan2(gh, W / 2);
  const slope = (W / 2) / Math.cos(th) + 0.3;
  for (const side of [-1, 1]) {
    const [x, z] = at(side * W / 4, D / 2);
    const y = e + gh / 2 + 0.08;
    /* 往屋脊的方向要往上：繞 x 轉 a 時局部 +z 的斜率是 −tan a，繞 z 轉時局部
       +x 的斜率是 +tan a，而屋脊在這塊板的 −us·side 那一邊——兩個正負號
       就是從這裡來的。 */
    const tilt = side * o.us * th;
    if (vx) B.add(B.kit.brick(D + 0.3, 0.16, slope, 0.03), { p: [x, y, z], r: [tilt, 0, 0], color: side < 0 ? C.tile : C.tileDark });
    else B.add(B.kit.brick(slope, 0.16, D + 0.3, 0.03), { p: [x, y, z], r: [0, 0, -tilt], color: side < 0 ? C.tile : C.tileDark });
  }
  /* 屋頂的碰撞：一個從簷口到屋脊的盒子。人上不去，但鏡頭上得去——沒有
     它的話吊臂會從屋頂穿進房子裡面。 */
  {
    const [bx, bz] = size(W, D);
    B.block(cx, e + gh / 2, cz, bx, gh, bz, { kind: 'shell' });
  }

  /* ── 立面的木頭 ──
     `beam(u0, y0, u1, y1)` 在立面上釘一根木料，兩端是立面座標。木料埋進牆面
     4 公分（有東西托著），凸出來 8 公分（有影子）。 */
  const V0 = -0.04;
  const beam = (u0, y0, u1, y1, t = 0.16) => {
    const [x0, z0] = at(u0, V0), [x1, z1] = at(u1, V0);
    const dx = x1 - x0, dz = z1 - z0, dy = y1 - y0;
    const len = Math.hypot(dx, dy, dz);
    const p = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    if (vx) B.add(B.kit.brick(0.12, t, len, 0.02), { p, r: [-Math.atan2(dy, dz), 0, 0], color: C.woodDark });
    else B.add(B.kit.brick(len, t, 0.12, 0.02), { p, r: [0, 0, Math.atan2(dy, dx)], color: C.woodDark });
  };
  const U = W / 2 - 0.1;
  // 牆基上的地檻，在門那裡斷開。
  beam(-U - 0.08, PL + 0.08, du - 0.55, PL + 0.08);
  beam(du + 0.55, PL + 0.08, U + 0.08, PL + 0.08);
  beam(-U - 0.08, FL, U + 0.08, FL);                            // 樓板線
  beam(-U - 0.08, e - 0.08, U + 0.08, e - 0.08);                // 簷口
  for (const u of [-U, 0, U]) beam(u, PL + 0.16, u, e - 0.16, 0.16); // 三根柱
  /* 二樓兩角的斜撐：從角柱斜上 0.6。短一點，窗戶才不會被它穿過去——窗在
     角柱與中柱的正中間。 */
  for (const s of [-1, 1]) beam(s * (U - 0.6), FL + 0.08, s * U, FL + 0.6);
  // 山牆上：一根中柱、一根橫樑。
  beam(0, e + 0.08, 0, e + gh * 0.72);
  beam(-(W / 2) * 0.52, e + gh * 0.45, (W / 2) * 0.52, e + gh * 0.45);

  /* 門：嵌在門洞底的一片木門，兩側一對門框、上面一根門楣，門上一個鐵
     門把。門板的正面在 v = RD − 0.06，比牆面深 12 公分——那一段陰影就是
     「這裡是一個洞」的全部證據。 */
  {
    const [x, z] = at(du, RD - 0.02);
    const [dw, dd] = size(DW - 0.08, 0.08);
    B.add(B.kit.brick(dw, DH - 0.04, dd, 0.02), { p: [x, (DH - 0.04) / 2, z], color: C.wood });
    for (const s of [-1, 1]) slab(du + s * (DW / 2 - 0.05) - 0.05, du + s * (DW / 2 - 0.05) + 0.05, 0.0, RD, 0, DH, C.woodDark);
    beam(du - 0.72, DH + 0.06, du + 0.72, DH + 0.06, 0.18);
    // 門把開在離門軸遠的那一側（離房子中線近的那一邊）。
    const hu = du - Math.sign(du) * 0.32;
    const [px, pz] = at(hu, RD - 0.075);
    const [qx, qz] = at(hu, RD - 0.12);
    const [pw, pd] = size(0.07, 0.03);
    B.add(B.kit.brick(pw, 0.18, pd, 0.01), { p: [px, 1.0, pz], color: C.iron, ink: false });
    B.add(B.kit.blob(0.045), { p: [qx, 1.0, qz], color: C.ironLit });
  }
  // 二樓兩扇窗，窗台是一根木料。
  for (const wu of [-(U / 2 - 0.05), U / 2 - 0.05]) {
    const wy = FL + 0.5;
    const [x, z] = at(wu, -0.02);
    const [pw, pd] = size(0.7, 0.06);
    B.add(B.kit.brick(pw, 0.95, pd, 0.01), { p: [x, wy + 0.47, z], color: 0x161310, ink: false });
    beam(wu - 0.45, wy - 0.02, wu + 0.45, wy - 0.02, 0.12);
  }
}

function alley(B, flames, seed, A) {
  const r = rng(seed);
  /* 巷子 5.4 公尺寬、廣場 14.7 × 9.9。第一版是 3.6 與 9.8 × 6.6——兩側的房子
     五六公尺高，3.6 寬的巷子抬頭只看得到一條縫，鏡頭也一直被兩面牆夾著。 */
  const S = 2.7;                 // 巷子半寬
  const BACK = A.x1 - 0.4;       // 房子背面的外皮（離黑牆 0.4）
  const SQ = 4.0;                // 廣場從這裡開始（z）
  const SQX = 7.35;              // 廣場的半寬
  const NZ = 13.9;               // 北排房子的立面
  /* 北排房子的背面。離黑牆 0.6 而不是 0.4：廣場兩側那幾棟的屋簷沿著 z
     伸出側牆 0.25，最北那一棟的屋簷會戳出黑牆。 */
  const NB = A.z1 - 0.6;

  B.pierces(true);
  flagstones(B, { x: 0, z: (A.z0 - 4 + SQ) / 2, w: 2 * S, d: SQ - A.z0 + 4, y: 0, seed: seed + 1, ruin: 0.3, cell: 1.2 });
  B.pierces(false);
  flagstones(B, { x: 0, z: (SQ + NZ) / 2, w: 2 * SQX, d: NZ - SQ, y: 0, seed: seed + 2, ruin: 0.3, cell: 1.5 });

  /* 巷子兩排。立面在 x = ±S，往外砌到 ±BACK。分界的 z 刻意不等距、
     簷口高度逐棟抽、牆色一棟一換——整排一樣的連棟屋看起來像一道牆。
     最南那一棟穿過黑牆，所以它標 pierces。 */
  const rows = [
    { sx: -1, cuts: [-19.6, -14.4, -9.4, -4.6, 0.0, SQ] },
    { sx: 1, cuts: [-19.6, -15.0, -9.8, -4.4, 0.4, SQ] },
  ];
  let hn = 0;
  for (const { sx, cuts } of rows) {
    for (let i = 0; i < cuts.length - 1; i++) {
      const z0 = cuts[i], z1 = cuts[i + 1], zm = (z0 + z1) / 2;
      const through = z0 < A.z0;
      if (through) B.pierces(true);
      house(B, seed + 100 + hn * 13, { alt: hn++ % 2 === 1,
        W: z1 - z0, D: BACK - S, e: r.range(4.6, 6.2), vx: true, us: -sx,
        at: (u, v) => [sx * (S + v), zm - sx * u],
      });
      if (through) B.pierces(false);
    }
  }
  /* 廣場三面。東西兩側的房子立面朝廣場（淺一點，3 公尺出頭），北排立面朝南。 */
  for (const sx of [-1, 1]) {
    const cuts = [SQ, 8.3, 12.6, NB];
    for (let i = 0; i < cuts.length - 1; i++) {
      const z0 = cuts[i], z1 = cuts[i + 1], zm = (z0 + z1) / 2;
      house(B, seed + 100 + hn * 13, { alt: hn++ % 2 === 1,
        W: z1 - z0, D: BACK - SQX, e: r.range(4.8, 6.0), vx: true, us: -sx,
        at: (u, v) => [sx * (SQX + v), zm - sx * u],
      });
    }
  }
  {
    const cuts = [-SQX, -2.3, 2.6, SQX];
    for (let i = 0; i < cuts.length - 1; i++) {
      const x0 = cuts[i], x1 = cuts[i + 1], xm = (x0 + x1) / 2;
      house(B, seed + 100 + hn * 13, { alt: hn++ % 2 === 1,
        W: x1 - x0, D: NB - NZ, e: r.range(5.0, 6.2), vx: false, us: 1,
        at: (u, v) => [xm + u, NZ + v],
      });
    }
  }

  // ── 廣場：井、兩盆火、角落的木箱與木桶 ──
  const WZ = (SQ + NZ) / 2;      // 井在廣場正中
  // 這一口井是開的：井口是一個坑，跳上井圈再往裡走就掉下去。
  well(B, { x: 0, z: WZ, y: 0, r: 1.15, seed: seed + 3, open: true });
  for (const sx of [-1, 1]) brazier(B, { x: sx * 5.6, z: NZ - 1.2, y: 0, s: 0.9, seed: seed + 4 + sx }, flames);
  const crate = (x, y, z, yaw) => B.add(B.kit.brick(0.9, 0.9, 0.9, 0.04), {
    p: [x, y + 0.45, z], r: [0, yaw, 0], color: C.wood, solid: 'floor',
  });
  crate(-6.0, 0, 5.2, 0.0); crate(-6.0, 0.9, 5.2, 0.12); crate(-5.1, 0, 5.3, -0.1);
  crate(6.1, 0, 6.6, 0.05);
  for (const [bx, bz] of [[6.1, 5.3], [5.3, 5.2]]) {
    B.add(B.kit.drum(0.38, 0.34, 1.0, 10), { p: [bx, 0.5, bz], color: C.woodDark, solid: 'floor', round: true });
    B.add(B.kit.drum(0.39, 0.39, 0.06, 10), { p: [bx, 0.75, bz], color: C.iron, ink: false });
  }
  for (let i = 0; i < 10; i++) mossTuft(B, r.range(-S + 0.3, S - 0.3), 0, r.range(-15, 3), r);

  // 出生點在巷子中段，面朝北（+z）：巷子的盡頭就是廣場。
  return { spawn: [0, 0, -8], yaw: 0 };
}

/* ── 黑牆裡、建築外的那一圈 ──────────────────────────────────────
   每個場地的外圈。這裡以前是「四個區塊之間的空地」加四條走廊，那是為了
   「四個區塊是同一片廢墟的四個角落」而存在的。現在每個場地被一道黑牆
   圍起來（見 `arena`），走廊沒有了，於是這一圈的工作換成一件事：
   **讓地面一直鋪到黑霧裡**，不要在黑牆腳下留一圈乾淨的空地。

   只有城牆平台有這一圈（它的黑牆在 22，砌體只到 19）；室內那三個房間的
   黑牆貼在牆面上，沒有外圈可撒。

   這一圈只撒不擋路的東西——壓進地板的碎石與苔。理由不是好看：外圈是
   樓梯與門洞的必經之路，而一顆有碰撞的石頭擺在那裡，畫面上看不出有
   問題，走到那裡才會發現上不去。
   ------------------------------------------------------------------ */
function outskirts(B, seed) {
  const r = rng(seed);
  for (const b of BLOCKS) {
    const A = b.arena;
    if (!A.ring) continue;             // 貼著牆面的房間沒有外圈
    const ox = b.origin[0] + A.x, oz = b.origin[1] + A.z;
    const r0 = A.ring, r1 = A.r - 0.8;
    for (let i = 0; i < 22; i++) {
      const a = r() * Math.PI * 2;
      // 半徑取平方根：不然全部擠在內圈（環的面積跟半徑成正比）
      const rad = Math.sqrt(r.range(r0 * r0, r1 * r1));
      const x = ox + Math.cos(a) * rad, z = oz + Math.sin(a) * rad;
      if (r() < 0.6) {
        /* 逐顆問「還在黑牆裡面嗎」。一叢碎石的半徑到 3.4，所以叢心在牆內
           不代表每一顆都在——而一顆被牆削掉一半的石頭，黑霧淡不掉那個
           切面（它就在牆腳，霧最濃的地方反而是它後面）。 */
        rubble(B, {
          x, z, y: 0, r: r.range(1.4, 3.4), n: 12,
          keep: (sx, sz) => Math.hypot(sx - ox, sz - oz) < A.r - 0.6,
          seed: (seed + i * 7 + b.seed) >>> 0,
        });
      } else {
        mossTuft(B, x, 0, z, r);
      }
    }
  }
}

/* ── 名冊 ────────────────────────────────────────────────────────
   每一個區塊：一個 id、一個名字、一個世界座標、一支砌它的函式。
   `origin` 是那個區塊自己的原點在世界裡的位置——區塊內部一律用自己的
   局部座標寫，砌完再整個平移過去，所以四個區塊的程式碼互相看不到彼此。 */
/* `arena` 是這個區塊的**黑牆**，也就是移動的上限（在 buildRuins 裡登記成
   一個 'bound' 碰撞體，跟柱子和牆進同一張清單）。兩種形狀：

     方（'rect'）  室內的房間。邊界貼在牆面上——中庭與王座廳的牆本來就是
                  方的，用圓去圍會在四個角留下一圈到不了的空地。
     圓（'circle'）水窖（環牆本來就是圓的）與城牆平台。

   ── 貼合，還是留一圈 ────────────────────────────────────────────
   室內的三個房間貼著牆面走，所以牆外的東西（扶壁）就拿掉了：從裡面看不到
   （牆擋著），從外面到不了（那是黑牆外面）。城牆平台相反，它的半徑是 22
   ——那一座遺跡的重點有一半在牆外面（塔基、扶壁、牆腳塌下來的石頭），
   圍在牆邊就只剩一個天井。`ring` 是外圈撒碎石的內界，只有它有。

   `lid` 是黑牆封頂的高度（見 veil.js）：牆從牆腳實心到那裡，然後蓋起來。
   封起來之後看得到的只有房裡的結構——連天空都沒有，而那正是「人在房間
   裡面」這件事的全部。高度要蓋過最高的砌體，不然頂會把屋頂切掉；也不必
   太高，這幾座的牆才六七公尺，頂拉到二十公尺只是讓房間變成一口井。

   `room` 是這個區塊「可玩的那一片」：房間自己的局部座標、地板的高度、
   以及方的（hx/hz，可加 cx/cz 偏心）或圓的（rad）範圍。

   它的定義很嚴格：**這一片之內，凡是走得到的地方，支撐高度都必須剛好
   等於 `y`**。所以樓梯、台座、貼牆的殘階一律劃在 room 之外——它們是
   房間之間的垂直交通，不是房間的地板。房間裡准有的只有兩種東西：平的
   地板，以及繞得過去、爬不上去的障礙物（柱、井、火盆、雕像、大石）。

   這是 roguelike 要的那個單位：一個房間拼進地圖之後，「跑不跑得動」
   不必靠玩，`tools/verify-test-area.mjs` 用真的物理走一遍就知道。 */
export const BLOCKS = [
  {
    id: 'courtyard', name: '崩塌中庭', hint: '兩側拱廊、一圈斷柱、門樓與鐵閘',
    origin: [0, 0], build: courtyard, seed: 0x1a2b,
    room: { y: 0, hx: 12.4, hz: 12.4 },
    // 牆面：南牆 13.5、門樓 13.6、兩側拱廊 13.5。砌體最高 7.4。
    arena: { shape: 'rect', x0: -13.8, x1: 13.8, z0: -13.8, z1: 13.8, lid: 12.0, hug: true },
  },
  {
    id: 'rampart', name: '城牆平台', hint: '抬高的露台、女牆垛口、斷塔',
    origin: [PITCH, 0], build: rampart, seed: 0x3c4d,
    room: { y: 3.2, hx: 9.8, hz: 6.2 },
    // 圓形黑牆，半徑 22——露台的牆在 7.5～11，斷塔伸到 18.5、樓梯到 16.4，
    // 所以牆外那一圈（塔、階、扶壁、牆腳的碎石）整個留在場地裡。
    arena: { shape: 'circle', x: 0, z: 0, r: 22, ring: 13, lid: 16.0, hug: false },
  },
  {
    id: 'throne', name: '王座廳', hint: '兩列柱、斜插的穹稜、台座與王座',
    origin: [0, PITCH], build: throne, seed: 0x5e6f,
    room: { y: 0, cz: -1.5, hx: 6.9, hz: 12.0 },
    // 牆面：兩側 8.05、南端 14.95、北端（王座背後那道）18.95。
    arena: { shape: 'rect', x0: -8.3, x1: 8.3, z0: -15.2, z1: 19.2, lid: 14.0, hug: true },
  },
  {
    id: 'cistern', name: '圓塔水窖', hint: '環形拱廊、貼牆殘階、垂鏈',
    origin: [PITCH, PITCH], build: cistern, seed: 0x7a8b,
    // 9.9 而不是 10.5：貼牆那道殘階的第一級（頂面 0.33）伸進來到 10.35，
    // 而樓梯是房間之間的垂直交通，不算房間的地板。
    room: { y: 0, rad: 9.9 },
    /* 環牆的外皮在 13.55——那是轉角。環牆是 16 段直牆，每一段的中點外皮
       只到 13.0·cos(π/16) + 0.55 ≈ 13.3。黑牆以前在 13.9，於是每段牆中點
       外面有一條 0.6 寬的縫：從殘階頂跳上牆頭、往外一走就掉進去，剛好塞得
       下狗，而且再也走不回來。13.75 讓那條縫只剩 0.45，比身體窄，站在牆頭
       往外走會先被黑牆擋住，不會掉下去。 */
    arena: { shape: 'circle', x: 0, z: 0, r: 13.75, lid: 12.0, hug: true },
  },
  {
    id: 'wallwalk', name: '城牆步道', hint: '沒入黑霧的幕牆、兩座方塔、牆頂走道',
    origin: [0, 2 * PITCH], build: wallwalk, seed: 0x9cad,
    // 走道：女牆之間（−3.1～3.0），兩座塔之間那一段。塔頂也走得到，但塔頂不算這一片。
    room: { y: 5.2, hx: 7.6, hz: 2.6 },
    /* 圓形黑牆，半徑 22。幕牆整段穿過它（兩端的切面藏在牆外），塔角離它
       4.6 公尺。`fenced`：人被空氣牆留在走道上；驗證器據此改驗「走不下去」，
       不驗「走到底貼在黑牆上」——走道兩端倒是真的會貼上黑牆。

       `haze` 比預設多兩層：預設那一層薄霧（內縮 1.2）是為了糊掉牆腳那條
       邊，而這裡要的是一條走道**慢慢**淡進黑暗，看不出它在哪裡結束。 */
    arena: {
      shape: 'circle', x: 0, z: 0, r: 22, lid: 14.0, hug: false,
      haze: [[0, 1.0], [1.2, 0.34], [3.5, 0.24], [6.5, 0.14]],
    },
    fenced: true,
  },
  {
    id: 'breach', name: '城牆缺口', hint: '塌了一截的城牆，衝刺跳過缺口',
    origin: [PITCH, 2 * PITCH], build: breach, seed: 0xb1c2,
    // 西段走道，缺口（x 4.5～9.0）之前那一片。
    room: { y: 5.2, hx: 3.8, hz: 2.6 },
    /* 跟城牆步道同一個外框與同一層霧。`fenced` 給的是一個高度：掉進缺口
       是這一座的一部分（坑底 2.0），掉出城外才不是。 */
    arena: {
      shape: 'circle', x: 0, z: 0, r: 22, lid: 14.0, hug: false,
      haze: [[0, 1.0], [1.2, 0.34], [3.5, 0.24], [6.5, 0.14]],
    },
    fenced: 1.9,
  },
  {
    id: 'crypt', name: '地下墓室', hint: '拱肋、石棺、壁龕與燭火',
    origin: [0, 3 * PITCH], build: crypt, seed: 0xc3d4,
    room: { y: 0, hx: 2.6, hz: 8.2 },
    /* 牆面：兩側 8.05、兩端 14.85。封頂壓在拱頂上方一公尺多（拱頂約 7.1）。
       `sealed`：四面都是牆，沒有一個門洞通到黑牆——走到底停在牆上，
       不是停在黑牆上，所以驗證不驗「走到底貼在黑牆上」。 */
    arena: { shape: 'rect', x0: -8.3, x1: 8.3, z0: -15.1, z1: 15.1, lid: 8.4, hug: true },
    sealed: true,
  },
  {
    id: 'alley', name: '城內窄巷', hint: '木構的連棟屋、盡頭的小廣場',
    origin: [PITCH, 3 * PITCH], build: alley, seed: 0xd5e6,
    // 巷子那一段（廣場從 z = 4 開始）。
    room: { y: 0, hx: 2.3, hz: 6.0 },
    // 房子背面的外皮在 ±10.6、北排在 16.9；南端整條巷子穿進黑牆。
    arena: { shape: 'rect', x0: -11.0, x1: 11.0, z0: -16.0, z1: 17.5, lid: 11.0, hug: true },
  },
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
export function buildRuins(opts = {}) {
  const B = new Build(new Kit(), opts);
  const flames = [];
  const spawns = {};
  const arenas = [];
  _colCursor = _inkCursor = _flameCursor = 0;   // 同一個行程裡砌第二遍也要對
  _partCursor = _wallCursor = _floorCursor = 0;

  for (const b of BLOCKS) {
    const [ox, oz] = b.origin;
    const mark = B.pos.length;
    // 場地帶進去，因為撒出去的東西要逐顆問「還在黑牆裡面嗎」。
    const meta = b.build(B, flames, b.seed, b.arena);
    // 區塊是用自己的局部座標砌的，砌完把這一段整個平移到世界位置上——
    // 包含頂點、墨線、碰撞盒與火焰。
    shift(B, mark, ox, oz, flames);
    // 第四個數是出生時的鏡頭方位（cam.yaw）；沒給就是 π，也就是面朝 −z。
    spawns[b.id] = [meta.spawn[0] + ox, meta.spawn[1], meta.spawn[2] + oz, meta.yaw ?? Math.PI];
    const A = b.arena;
    arenas.push(A.shape === 'circle'
      ? { id: b.id, shape: 'circle', x: A.x + ox, z: A.z + oz, r: A.r, lid: A.lid, hug: A.hug, haze: A.haze }
      : {
        id: b.id, shape: 'rect', lid: A.lid, hug: A.hug, haze: A.haze,
        x0: A.x0 + ox, x1: A.x1 + ox, z0: A.z0 + oz, z1: A.z1 + oz,
      });
  }
  outskirts(B, 0x9c0d);

  /* 黑牆。砌完、平移完才登記，因為它拿的是世界座標——`shift` 搬的是
     「還沒搬過的」那些盒子，這幾筆進來得太早會被多搬一次。 */
  for (const a of arenas) B.bound(a);

  const out = B.finish();
  out.flames = flames;
  out.spawns = spawns;
  out.arenas = arenas;
  return out;
}

/* 把 `from` 之後新加進來的所有東西平移。頂點與墨線是從 `from` 這個
   索引開始的那一段；碰撞盒與火焰則是「還沒有被搬過的」那些，用一個游標
   記著——比重算一次整個區塊便宜，也不必讓每個零件都去接一個 offset。 */
let _colCursor = 0, _inkCursor = 0, _flameCursor = 0;
let _partCursor = 0, _wallCursor = 0, _floorCursor = 0;
function shift(B, fromPos, ox, oz, flames) {
  for (let i = fromPos; i < B.pos.length; i += 3) { B.pos[i] += ox; B.pos[i + 2] += oz; }
  for (let i = _inkCursor; i < B.ink.length; i += 3) { B.ink[i] += ox; B.ink[i + 2] += oz; }
  _inkCursor = B.ink.length;
  for (let i = _colCursor; i < B.colliders.length; i++) {
    const c = B.colliders[i];
    c.min[0] += ox; c.max[0] += ox; c.min[2] += oz; c.max[2] += oz;
    // 圓柱的軸是另外一組座標，跟著搬——漏搬的話那根柱子會擋在別的區塊裡。
    if (c.shape === 'circle' || c.kind === 'pit') { c.x += ox; c.z += oz; }
  }
  _colCursor = B.colliders.length;
  for (let i = _flameCursor; i < flames.length; i++) { flames[i].x += ox; flames[i].z += oz; }
  _flameCursor = flames.length;
  /* 驗證用的那三份登記也要跟著搬——它們記的是世界座標，而區塊是用自己
     的局部座標砌的。漏搬不會有人看出來，只會讓驗證去掃一片空地。 */
  for (let i = _partCursor; i < B.parts.length; i++) {
    const q = B.parts[i];
    q.min[0] += ox; q.max[0] += ox; q.min[2] += oz; q.max[2] += oz;
  }
  _partCursor = B.parts.length;
  for (let i = _wallCursor; i < B.walls.length; i++) {
    const w = B.walls[i];
    w.from[0] += ox; w.from[1] += oz; w.to[0] += ox; w.to[1] += oz;
  }
  _wallCursor = B.walls.length;
  for (let i = _floorCursor; i < B.floors.length; i++) {
    B.floors[i].x += ox; B.floors[i].z += oz;
  }
  _floorCursor = B.floors.length;
}
