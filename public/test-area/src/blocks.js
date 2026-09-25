/* ── test-area/src/blocks.js ─────────────────────────────────────────
   六個城堡關卡區塊：三座遺跡、一段完好的城牆、一間墓室、一條巷子。

   ── 每一個區塊的規矩 ─────────────────────────────────────────────
   一模一樣的三條，因為它們是「可以跑的關卡」而不是「一張場景」：

     1. 中心留空。每個區塊中央至少 12×12 是平的、乾淨的、沒有一塊突出來
        會卡腳的東西——狗要在上面跑，而跑起來最需要的是「看得懂哪裡能
        走」。所有裝飾一律退到那個方框外面，或是抬到頭頂以上。
     2. 密度往外長。空地邊緣是碎石與苔，再外面是柱列與拱廊，最外圈是
        城牆、雕像、旗與火盆。視線因此有三層深度，而腳下始終是空的。
     3. 進出口在地面。每個區塊都走得進去也走得出去，抬高的一定配
        階梯，不靠跳躍——這一頁只做移動與觀賞。

   ── 四個區塊 ────────────────────────────────────────────────────
     崩塌中庭   兩側拱廊、一圈斷柱、一座門樓與鐵閘、井、枯樹
     王座廳     兩列柱、斜插的穹稜、台座與王座、掛旗的側牆
     圓塔水窖   環形拱廊、貼牆的殘階、垂下的鎖鏈、牆頭的獸像
     城牆步道   完好的幕牆，一頭沒入黑霧、一頭收進切著黑牆的圓塔。牆下城內
                那一側是兵營（帳篷、武器架、假人、箭靶、糧袋、炊事的火），走得到；
                一條小路從城門往南沒入黑霧，通到中庭。牆頂的走道由圓塔的兩扇門
                上下（塔腳一扇、牆頂一扇），門關著就上不去；上去之後空氣牆擋住
                牆外的落差。城外是碎石與枯樹的荒地，只看得到、走不到
     地下墓室   壓低的拱肋墓室、兩排石棺、壁龕裡的頭骨、燭火
     城內窄巷   木構的連棟屋夾出一條巷子，一頭沒入黑霧（通到中庭）、一頭是
                小廣場；廣場上那口井是開的，掉下去就到水窖

   ── 區塊之間怎麼走 ───────────────────────────────────────────────
   區塊互相看不到（每一個都封了頂），所以區塊之間的路是**感測區**：走進去
   就被送到另一個區塊的一個到達點（見 geom.js 的 `portal`／`arrive`）。

     中庭東拱洞 ⇄ 兵營的小路  中庭那頭是拱洞（一組門，路標），兵營那頭沒入黑霧
     中庭西拱洞 ⇄ 窄巷南端    同上
     中庭門樓   ⇄ 王座廳正門  兩頭各一道鐵閘，各是各的一組門
     水窖南門   ⇄ 墓室的鐵閘  同上；水窖另外兩個門洞的閘是封死的
     塔腳的門   ⇄ 牆頂的門    同一個區塊裡；屬於一組門，門關著就不通
     窄巷的井   → 水窖        單向
     水窖的殘階 → 窄巷井邊    單向，爬到最上面那一級

   每一個都只回報資料（幾何、碰撞盒、出生點、火焰座標），不碰場景也不碰
   材質——組裝是 main.js 的事，這樣同一份區塊資料離線也建得起來，
   verify.mjs 就是靠這件事在 node 底下把四個區塊全部砌一遍。
   ------------------------------------------------------------------ */

import { Build, rng } from './geom.js';
import { C } from './palette.js';
import { arenaGap, PHYS } from './walk.js';
import {
  Kit, flagstones, wall, merlons, column, pointedArch, arcade, stair,
  knight, gargoyle, rubble, rubbleHeap, brazier, banner, chain, portcullis, deadTree, well,
  mossTuft, crate, barrel,
  pavilion, weaponRack, dummy, archeryTarget, campfire, sackStack, woodpile, logSeat, standard,
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

/* ── 可以開關的鐵閘 ──────────────────────────────────────────────
   關著是放下的鐵閘，有碰撞（屬於那一組門：門開著碰撞就不存在）；開著是同一面
   閘升起來，柵條收進門洞頂上的石頭裡（`ceil`）。兩種狀態各自一塊（`detach`），
   執行時只換看得到的那一塊。`face` 是門面的法線，指向走過來的人那一邊。 */
function grate(B, o) {
  const { group, face, lift, ceil, hole, ...at } = o;
  B.detach({ door: group, open: false, face }, () => portcullis(B, { ...at, door: group }));
  // `hole`：開著的時候洞裡看得進去，驗證拿這個盒子量有沒有磚插進門洞（見 verify 的「門」）。
  B.detach({ door: group, open: true, face, ...(hole ? { hole } : {}) },
    () => portcullis(B, { ...at, lift, ceil, solid: false }));
}

/** 尖拱的內緣：沿拱面離中線 t 那一點的拱底有多高（`pointedArch` 同一組數）。
    拱腳以外就是起拱線。升起的鐵閘裁到這裡，看起來是收進了拱石的槽裡。 */
function intrados({ y, span, rise, thick }) {
  const half = span / 2, e = (rise * rise - half * half) / (2 * half), ri = half + e - thick / 2;
  return (t) => y + Math.sqrt(Math.max(0, ri * ri - (Math.abs(t) + e) ** 2));
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

  /* 北面的門樓：兩座墩、一道尖拱、一面鐵閘。鐵閘放下來的時候有碰撞；升起來
     就走得進門洞，走到底是王座廳。另外兩條路是兩側拱廊正中那兩個拱洞——三條
     是同一組門（見這一支的最後面）。 */
  const gateW = [
    wall(B, { from: [-13, -13], to: [-2.4, -13], h: 6.4, thick: 1.2, ruin: 0.28, seed: seed + 60 }),
    wall(B, { from: [2.4, -13], to: [13, -13], h: 6.4, thick: 1.2, ruin: 0.3, seed: seed + 61 }),
  ];
  /* 門樓的拱是完整的（ruin 0）。整片廢墟裡至少要有一道拱是完好的，
     不然「尖拱」這個形狀在畫面上從來沒有被說完整——而那正好是這一路
     造型語言最好認的一筆。缺口留給別的拱。 */
  const ARCH = { y: 3.6, span: 5.0, rise: 3.6, thick: 0.55 };
  pointedArch(B, { x: 0, z: -13, ...ARCH, yaw: 0, depth: 1.3, ruin: 0, seed: seed + 62 });
  /* 門樓的鐵閘是一扇門（`gates`，跟兩側的拱洞同一組）：升起來的時候尖刺停在
     兩公尺多，柵條收進拱裡；走進門洞就到王座廳。 */
  grate(B, { x: 0, z: -13, y: 0, w: 4.4, h: 3.4, yaw: 0, lift: 2.3, ceil: intrados(ARCH), group: 'gates', face: [0, 1] });
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

  /* 門樓：鐵閘升起來，走進門洞就到王座廳的正門。感測區從門樓牆的內皮往裡 0.5
     起、到黑牆。門前半公尺有一顆大石（碎石撒出來的），進門要從它旁邊繞過去；
     到達點在大石的中庭那一側、面朝中庭。路標浮在升起的鐵閘前面。 */
  B.portalBox(-2.4, A.z0, 2.4, -12.9, -0.5, 3, 'throne.gate', {
    door: 'gates', mouth: { x: 0, y: 0, z: -12.4, n: [0, 1] },
  });
  B.arrive('gate', 0, 0, -9.4, 0);
  B.sign(0, 3.0, -12.1, '王座廳', { door: 'gates' });

  /* 兩側拱廊正中那個拱洞（z = 0）通到別的區塊：東邊是城牆步道兵營的那條小路，
     西邊是窄巷的南端，兩頭一一對應——從東邊出去，從城牆回來也回到東邊。
     其餘四個拱洞照舊走到黑牆為止。

     這兩扇沒有門扇，開著關著拱洞都一樣；看得出能不能走的只有拱洞前那塊
     懸浮的路標（`sign`）。路標跟感測區是同一組門（`gates`，按 O），看得到就是
     走進去會被送走。感測區從拱廊內皮往裡 0.5 起、到黑牆：墩柱之間的拱洞
     淨寬 3.1，狗整隻走進拱洞才被送走。到達點在拱洞前 1.5 公尺、面朝中庭。 */
  const FACE = 12.5;                                   // 拱廊的內皮（x = ±13、深 1.0）
  for (const [sx, to, name, text] of [[1, 'wallwalk.fog', 'east', '城牆步道'], [-1, 'alley.fog', 'west', '城內窄巷']]) {
    B.portalBox(sx * (FACE + 0.5), -1.55, sx * A.x1, 1.55, -0.5, 3, to, {
      door: 'gates', mouth: { x: sx * FACE, y: 0, z: 0, n: [-sx, 0] },
    });
    B.arrive(name, sx * (FACE - 1.5), 0, 0, -sx * Math.PI / 2);
    B.sign(sx * (FACE - 0.2), 3.2, 0, text, { door: 'gates' });
  }
  return { spawn: [0, 0, 3.5] };
}

/* ── 二、王座廳 ───────────────────────────────────────────────────
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
  /* 正門是一扇「門」（`gate`，按 O），只是門扇是一堆亂石。關著：塌下來的石頭把
     兩段殘牆之間那個缺口整個堵住，從牆後的黑牆一路堆到牆的內皮前 0.3，後面高
     2.6、往廳裡斜下來；碰撞是一整塊跳不上去的盒子（屬於這一組門）。開著：清走了，
     什麼都沒有，缺口就是原本的樣子。開著走進缺口，從牆的內皮往裡 0.5 起就回中庭
     的門樓；到達點在門內、面朝王座。 */
  const FACE = -14.4 + 0.55, HEAP = { x0: -2.7, x1: 2.7, z0: A.z0 + 0.02, z1: FACE + 0.3, h: 2.6 };
  B.detach({ door: 'gate', open: false, face: [0, 1] }, () => rubbleHeap(B, { ...HEAP, seed: seed + 170 }));
  B.detach({ door: 'gate', open: true, face: [0, 1] }, () => {});
  B.block(0, HEAP.h / 2, (HEAP.z0 + HEAP.z1) / 2, HEAP.x1 - HEAP.x0, HEAP.h, HEAP.z1 - HEAP.z0 + 0.04,
    { kind: 'block', base: 0, door: 'gate' });
  B.portalBox(-2.6, A.z0, 2.6, FACE - 0.5, -0.5, 3, 'courtyard.gate', {
    door: 'gate', mouth: { x: 0, y: 0, z: FACE, n: [0, 1] },
  });
  B.arrive('gate', 0, 0, -11.4, 0);
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

/* ── 三、圓塔水窖 ─────────────────────────────────────────────────
   一個圓的區塊，因為前三個都是方的。環形拱廊把整圈框起來，中央是一片
   直徑 14 的圓形鋪面；牆上剩一段貼著內壁往上爬的殘階（走得上去，上面是
   斷的；走到最上面那一級就回到地面，窄巷的井口旁邊）。 */
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
      const ARCH = { y: 3.2, span: 3.0, rise: 2.4, thick: 0.45 };
      pointedArch(B, { x: c[0], z: c[1], ...ARCH, yaw: -mid + Math.PI / 2, depth: 1.1, ruin: 0.15, seed: seed + 50 + i });
      /* 每一個門洞都有一道鐵閘。朝南那一個（從井掉下來，一落地正前方就是它）是
         一扇門（`gate`，按 O）：升起來走進去就到墓室。另外兩個的閘是封死的，
         跟門洞裡的石頭一起砌進合併的那一份。 */
      /* 閘落在牆心，跟拱同一個面。 */
      const n = [Math.cos(mid), Math.sin(mid)];                // 往牆外
      const bars = { x: c[0], z: c[1], y: 0, w: 2.0, h: ARCH.y, yaw: -mid + Math.PI / 2 };
      if (Math.sin(mid) < -0.9) {
        const face = R * Math.cos(Math.PI / segs) - 0.55;       // 門洞內皮離圓心多遠
        grate(B, { ...bars, lift: 2.2, ceil: intrados(ARCH), group: 'gate', face: [-n[0], -n[1]] });
        /* 感測區是圓的（門面是斜的，方的蓋不準）：圓心在黑牆上，半徑讓它從門洞
           內皮往裡 0.5 起算；身體在門洞裡能走到離中線 0.8，那裡也蓋得到。 */
        B.portal(n[0] * A.r, n[1] * A.r, A.r - face - 0.5, -0.5, 3, 'crypt.gate', {
          door: 'gate', mouth: { x: n[0] * face, y: 0, z: n[1] * face, n: [-n[0], -n[1]] },
        });
        B.arrive('gate', n[0] * (face - 1.6), 0, n[1] * (face - 1.6), Math.atan2(-n[0], -n[1]));
      } else {
        portcullis(B, bars);
      }
      /* 閘後面到黑牆那一段填實：只登記碰撞、不畫，也不擋鏡頭（空氣牆）。閘在牆心，
         閘與黑牆之間是一個塞得下狗的口袋——殘階上跳得上比較矮的幾段牆頭，沿牆頭
         走到門洞上方就掉得進去，而且出不來。朝南那一道是門：門開著，那一段就是走
         進去的路，所以它屬於那一組門。斜的，所以跟閘的碰撞一樣切成幾段。 */
      {
        const r0 = R * Math.cos(Math.PI / segs) + 0.15, D = A.r + 0.2 - r0;
        const tx = Math.cos(bars.yaw), tz = -Math.sin(bars.yaw);
        const W = 2.4, k = 6, L = W / k;
        const door = Math.sin(mid) < -0.9 ? 'gate' : undefined;
        for (let j = 0; j < k; j++) {
          const t = ((j + 0.5) / k - 0.5) * W;
          const cx = n[0] * (r0 + D / 2) + tx * t, cz = n[1] * (r0 + D / 2) + tz * t;
          const ex = (Math.abs(tx) * L + Math.abs(n[0]) * D) / 2, ez = (Math.abs(tz) * L + Math.abs(n[1]) * D) / 2;
          B.air(cx - ex, cz - ez, cx + ex, cz + ez, 0, A.lid, { door });
        }
      }
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

  /* 殘階的頂：最上面那一級是斷的，走上去就回到地面——窄巷那口井的旁邊。這一條
     是單向的（下來的路是那口井），不屬於任何一組門。感測區是頂上那一級上方的
     一個圓，底在那一級的踏面下 0.15：站在下一級（低 0.32）碰不到它。 */
  {
    const a = STAIR.a0 + ((STAIR.n - 1) / STAIR.n) * STAIR.span;
    const tread = 0.18 + (STAIR.n - 1) * 0.32 + 0.15;
    B.portal(Math.cos(a) * STAIR.rr, Math.sin(a) * STAIR.rr, 0.9, tread - 0.15, tread + 2.5, 'alley.stair', { oneWay: true });
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
  /* 從窄巷的井掉下來的地方：中央那片空地的正中、離地三公尺，面朝南。掉下來
     這一段跟井裡那一段是同一個動作，所以人是「掉進」水窖，不是出現在地上。 */
  B.arrive('well', 0, 3, 0, Math.PI);
  return { spawn: [0, 0, -6] };
}

/* ── 完好城牆的零件：女牆、幕牆、方塔 ────────────────────────────
   城牆步道用。三支都只收軸對齊的東西——那一座全部是直角，空氣牆因此
   就是女牆的外框本身，一公分都不多。 */

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
 * 牆芯不在這裡登記（碰撞是呼叫端的事）：城門那一段要把門洞讓出來。
 *
 * `in1` 是城內那一面（−z）停在哪裡，預設跟 `x1` 一樣。給了的話那一頭的磚
 * 裁齊、不錯出半塊——它是頂著別的東西停下來的（圓塔塔腳那扇門的門框）。
 */
function curtain(B, seed, o) {
  const { x0, h, T, WT, s = 0 } = o;
  for (const side of [-1, 1]) {
    const x1 = side < 0 && o.in1 !== undefined ? o.in1 : o.x1;
    const len = x1 - x0, xm = (x0 + x1) / 2;
    const zc = side * (T / 2 - WT / 2);
    wall(B, {
      from: [x0, zc], to: [x1, zc], h, thick: WT, ruin: 0, course: o.course, seed: seed + 10 + s + side,
      flush: x1 === o.x1 ? {} : { to: [0, h] },
    });
    B.add(B.kit.brick(len, 0.5, 0.5, 0.05), { p: [xm, 0.25, side * (T / 2 + 0.1)], color: C.stoneDark });
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

/** 牆腳的地面：只有苔。完好的城牆，牆腳沒有塌下來的石頭（再往外見 `wasteland`）。 */
function footMoss(B, r, A, n, onWall) {
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, rad = r.range(4, A.r - 1.5);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (!onWall(x, z)) mossTuft(B, x, 0, z, r);
  }
}

/** 兵營那條小路的半寬：跟城門的路（GW = 4.4）一樣寬，對齊在同一條線上。 */
const PATH = 2.2;

/** (x, z) 離一條空地（`from`→`to` 的線段、半寬 `half`）的邊多遠；在裡面是負的。 */
function laneGap(l, x, z) {
  const [ax, az] = l.from, [bx, bz] = l.to;
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  return Math.hypot(x - (ax + dx * u), z - (az + dz * u)) - l.half;
}

/* ── 四、城牆步道 ─────────────────────────────────────────────────
   一段完好的幕牆。其他幾座多半是遺跡，這一座是「還在用的城牆」——所以
   ruin 一律是 0：牆頂是平的、垛口一個不缺、鋪面沒有缺塊。

   兩層都走得到：牆下城內那一側的兵營（出生點在這裡），以及牆頂的走道。
   走道面在 5.2 公尺、女牆之間 6.1 公尺寬（第一版只有 3.3，兩側的女牆加
   垛口比狗高一倍，走起來像在一條溝裡）。幕牆沿著場地的直徑：西端**直接
   穿進黑牆**——黑牆是不透明的，牆在它後面怎麼收尾永遠看不到，而內側那
   幾層加厚的黑霧讓走道一路淡進黑暗；東端收進一座圓塔，塔的外緣正好切在
   黑牆上。

   兩層之間只有圓塔的兩扇門：塔腳一扇朝兵營、牆頂一扇朝走道，是**一組門**
   （見 `towerDoor`）。關著是木門，什麼都不通；開著是黑的門洞，走進一扇就
   從另一扇的門外出來。門的狀態是執行時的，不是地圖的版本。

   女牆外面是空的，所以把人留在牆上的是**空氣牆**：沿著每一道女牆的外框
   立到封頂，女牆與垛口爬不上去、也跳不過去；走道的西端由黑牆擋住，東端
   由圓塔擋住（塔比走道高 3.6）。鏡頭不吃空氣牆，吊臂伸得出牆外，看得到
   城牆的立面、底下的城門與兵營。

   座標：幕牆沿 x，外側（城外）是 +z。西段一座方塔往城外凸出——塔是用來
   從側面射擊牆腳的，所以它凸在牆外面；塔頂跟走道同高，是走道的延伸。

   城門洞從兵營那一側走得進去，走到放下的鐵閘為止。城外的荒地一格都走
   不到，是造景。城門的路一路往南鋪進黑霧，但在營地中間斷開（見 `gate`）；
   走進黑霧就到中庭的東拱洞。 */
function wallwalk(B, flames, seed, A) {
  const r = rng(seed);
  const H = 5.2;                 // 走道面
  const L = A.r + 3;             // 幕牆西端：穿出黑牆 3 公尺，切面藏在牆外
  const T = 7.4;                 // 幕牆厚（z −T/2..T/2）
  const WT = 1.1;                // 牆身一皮石頭多厚
  /* 一皮多高。預設的 0.44 砌不整 5.2——最上面那一皮會凸出走道面 8 公分，
     女牆蓋得住的地方看不到，塔口那一段就是一排絆腳的磚。0.4 剛好 13 皮。 */
  const COURSE = H / 13;
  const TW = 7.2;                // 方塔寬（x）
  const TC = 12;                 // 方塔的中心 x = −TC
  const TZ = T / 2 + 4.0;        // 方塔往城外凸到哪裡
  const OUT = T / 2 - 0.35, IN = -T / 2 + 0.3;   // 外側、內側女牆的中線
  /* 圓塔：塔心在牆的中線上，外緣離黑牆 0.1（留給突出的丁磚）。幕牆、鋪面、
     女牆與空氣牆全部收到塔心為止——塔身把它們的端頭包在裡面。 */
  const RT = 5.0, TX = A.x + A.r - RT - 0.1;
  const GW = 4.4, GH = 3.6;      // 城門洞寬、高（9 皮，跟兩側的牆皮對齊）
  /* 門洞兩側那兩段牆停在洞邊外 0.47：`wall` 的磚一皮一皮錯開半塊，末端會多
     出去半塊磚（0.465），停在洞邊上的話每隔一皮就有一塊伸進門洞裡。多出來
     那一截由門洞的側牆（0.6 厚）蓋住。 */
  const GE = GW / 2 + 0.47;
  const { parapet } = battlements(B, seed, A, H);

  // ── 幕牆：西端穿過黑牆，所以這一段的幾何全部標 pierces ──
  B.pierces(true);
  curtain(B, seed, { x0: -L, x1: -GE, h: H, T, WT, course: COURSE });
  /* 城內那一面停在塔腳那扇門的門框外側：門洞的甬道從塔的外皮往裡伸 2.4，
     正好穿過這一面的牆身。砌到塔心的話，門開著的時候洞裡橫著一道磚牆。 */
  curtain(B, seed, { x0: GE, x1: TX, in1: TX - towerDoorHalf(RT), h: H, T, WT, course: COURSE, s: 5 });
  flagstones(B, { x: (TX - L) / 2, z: 0, w: TX + L, d: T - WT, y: H, out: 0.5, seed: seed + 20, ruin: 0.02, cell: 1.5 });
  // 城內那一側是一道連續的矮牆；城外那一側有垛口，在方塔那裡讓開。
  parapet([-L, IN], [TX, IN], 0.95, 0.6, false, 40);
  const gaps = [[-L, -TC - TW / 2], [-TC + TW / 2, TX]];
  gaps.forEach(([x0, x1], i) => parapet([x0, OUT], [x1, OUT], 1.1, 0.7, true, 30 + i * 3));
  B.pierces(false);
  /* 牆芯：城門洞兩側各一塊，洞頂上一塊（從洞頂到走道面）。洞本身是空的——
     兵營那一側走得進去，擋住人的是洞裡的鐵閘與兩扇門（見 `gate`）。 */
  B.block((-L - GW / 2) / 2, H / 2, 0, L - GW / 2, H, T, { kind: 'floor', base: 0 });
  B.block((TX + GW / 2) / 2, H / 2, 0, TX - GW / 2, H, T, { kind: 'floor', base: 0 });
  B.block(0, (GH + H) / 2, 0, GW, H - GH, T, { kind: 'floor', base: GH });

  squareTower(B, flames, seed, parapet, { xc: -TC, sx: -1, H, T, WT, TW, TZ, course: COURSE, OUT });
  // 城門兩側，城外那一面掛兩面旗。
  for (const t of [-4.3, 4.3]) {
    banner(B, { x: t, y: H - 0.55, z: T / 2, wall: 1, yaw: 0, s: 0.9, color: t < 0 ? C.bannerAlt : C.banner });
  }

  gate(B, seed, { H, T, WT, GW, GH, COURSE, south: -Math.sqrt(A.r ** 2 - (GW / 2 + 0.3) ** 2) + 0.4 });
  roundTower(B, seed, { x: TX, H, RT });
  /* 塔腳那扇門前的空地：從小路的中段斜著拉到門前的到達點（見 `towerDoor`），
     寬 3.2。它不是路——不鋪石磚——讀得出「這裡留著」的是兩側的帳篷都退開、
     門都朝著它，路口的軍旗也往它靠（見 `camp`）。 */
  const lane = { from: [PATH, -A.r + 5], to: [TX, -(RT + 1.9)], half: 1.6 };
  camp(B, flames, lane);
  /* 苔不長在小路與那條空地上：路斷開的那一段與空地都不鋪石磚，讀得出「這裡是空的」的只剩它是乾淨的。 */
  footMoss(B, r, A, 30, (x, z) => Math.abs(z) < T / 2 + 0.7
    || (z > 0 && z < TZ + 0.6 && Math.abs(x + TC) < TW / 2 + 0.6)
    || Math.hypot(x - TX, z) < RT + 0.6
    || (z < 0 && Math.abs(x) < PATH + 0.4)
    || laneGap(lane, x, z) < 0.4);
  wasteland(B, r, seed, A, { T, TC, TW, TZ, TX, RT });

  /* 小路沒入黑霧的那一截：一塊橫過路面的感測區，從黑牆往裡 1.4 公尺，送到中庭
     的東拱洞前。身體走得到黑牆前 0.3，所以一路走到底一定會碰到它；路以外的
     黑牆腳不送人。
     回來的到達點在路上、離這一塊兩公尺多，面朝城門。 */
  B.portalBox(-PATH, -A.r, PATH, -A.r + 1.4, -0.5, 3, 'courtyard.east');
  B.arrive('fog', 0, 0, -A.r + 3.4, 0);
  // 出生點在兵營中間的路上，面朝北（+z）：城門與牆頂的走道在正前方。
  return { spawn: [0, 0, -9], yaw: 0 };
}

/**
 * 城外的荒地：碎石、苔與兩棵枯樹，撒在城外那半圈（+z）。牆腳一公尺照舊
 * 乾淨（守軍會清），方塔、圓塔、城門口那一段路也不撒；再往外才是沒人管
 * 的地——碎石一路鋪進黑霧裡，黑牆腳下不留一圈乾淨的空地。
 *
 * 大石照樣登記碰撞，雖然沒有人走得到這裡：驗證逐盒檢查碰撞的分類，而一顆
 * 畫面上是大石、碰撞上什麼都沒有的東西，哪天這一片走得到了就是一個洞。
 * 叢心離黑牆至少 1.2 公尺——`keep` 只問每一顆的中心，大石本身的半徑到 1。
 */
function wasteland(B, r, seed, A, o) {
  const { T, TC, TW, TZ, TX, RT } = o;
  const keep = (x, z) => z > T / 2 + 1.0 && arenaGap(A, x, z) > 1.2
    && !(z < TZ + 1.0 && Math.abs(x + TC) < TW / 2 + 1.0)   // 方塔
    && Math.hypot(x - TX, z) > RT + 1.0                    // 圓塔
    && !(z < T / 2 + 4 && Math.abs(x) < 3);                // 城門口的路
  for (let i = 0; i < 18; i++) {
    const a = r.range(0.12, Math.PI - 0.12);
    // 半徑取平方根：不然全部擠在內圈（環的面積跟半徑成正比）
    const rad = Math.sqrt(r.range(8 * 8, (A.r - 1) ** 2));
    const x = A.x + Math.cos(a) * rad, z = A.z + Math.sin(a) * rad;
    if (r() < 0.65) {
      rubble(B, {
        x, z, y: 0, r: r.range(1.4, 3.4), n: 16, boulders: i % 3 === 0 ? 1 : 0,
        keep, seed: seed + 200 + i,
      });
    } else if (keep(x, z)) {
      mossTuft(B, x, 0, z, r);
    }
  }
  deadTree(B, { x: -4.5, z: 12, y: 0, s: 1.3, seed: seed + 230 });
  deadTree(B, { x: 7, z: 15, y: 0, s: 0.95, seed: seed + 231 });
}

/**
 * 城門：幕牆正中一個 GW × GH 的門洞，穿過整道牆（T 深）。從兵營那一側走得
 * 進去，走到靠城外那道放下的鐵閘為止（鐵閘有碰撞）；牆芯在洞頂以上才有。
 * 畫的是門洞兩側的側牆、頂板、門洞上方那一截牆、兩面各一圈尖拱、那道鐵閘、
 * 靠城內往裡開著的兩扇門（貼著洞壁，有碰撞），以及從城外一路鋪到黑牆前、在
 * 營地中間斷開的路（`south` 是它在黑牆前的那一頭）。
 */
function gate(B, seed, o) {
  const { H, T, WT, GW, GH, COURSE } = o;
  const GE = GW / 2 + 0.47;
  B.pierces(false);
  for (const side of [-1, 1]) {
    const zc = side * (T / 2 - WT / 2);
    wall(B, { from: [-GW / 2, zc], to: [GW / 2, zc], h: H - GH, y: GH, thick: WT, ruin: 0, course: COURSE, seed: seed + 140 + side });
    B.hangs(true);                                     // 壓簷挑在牆面外，接上兩側那兩段
    B.add(B.kit.brick(2 * GE, 0.24, 0.34, 0.05), { p: [0, H - 0.3, side * (T / 2 + 0.1)], color: C.stoneLit });
    B.hangs(false);
    /* 一圈尖拱框住門洞：拱腳在 2.4、拱頂收在壓簷底下，拱圈的內緣剛好落在門洞
       的邊上。拱圈與洞頂之間那一片是實牆（門楣上的山花），不是洞。 */
    pointedArch(B, { x: 0, z: zc, y: 2.4, span: GW + 0.5, rise: 2.05, yaw: 0, thick: 0.5, depth: WT + 0.24, ruin: 0, seed: seed + 144 });
    // 門洞的側牆：牆芯被門洞切開了，洞裡要自己砌。
    wall(B, { from: [side * (GW / 2 + 0.3), -T / 2], to: [side * (GW / 2 + 0.3), T / 2], h: GH, thick: 0.6, ruin: 0, course: COURSE, seed: seed + 146 + side });
  }
  B.add(B.kit.brick(GW + 1.2, 0.3, T - 0.1, 0.04), { p: [0, GH + 0.15, 0], color: C.stoneDeep, ink: false });
  portcullis(B, { x: 0, z: T / 2 - 1.4, y: 0, w: GW - 0.1, h: GH - 0.05, yaw: 0 });
  // 兩扇門鉸在城內那一頭，往裡開，貼在洞壁上。
  for (const sx of [-1, 1]) {
    const dx = sx * (GW / 2 - 0.08), dz = -T / 2 + 0.9 + 1.1;
    B.add(B.kit.brick(0.12, GH - 0.3, 2.2, 0.03), {
      p: [dx, (GH - 0.3) / 2 + 0.03, dz], color: C.woodDark, solid: 'block', base: 0,
    });
    for (const by of [0.6, 1.6, 2.6]) {
      B.add(B.kit.brick(0.15, 0.1, 2.1, 0.02), { p: [dx, by, dz], color: C.iron, ink: false });
    }
  }
  /* 路：城外那頭鋪出去 3 公尺，城內一路鋪到黑牆前（`south`，石板的基座還在
     黑牆裡面），但中間斷開。從城牆與黑牆兩頭各往中間數：頭兩格是完整的路，
     第三格起一格比一格稀，再三格就一塊都沒有——兩頭之間剩下的三四格是泥地。
     路讀起來是「從城門出來、往黑霧裡去」的同一條，只是營地中間被踩成了土。 */
  const CELL = 1.4, FADE = [1, 1, 0.7, 0.4, 0.15];
  const keep = (x, z) => {
    if (z > -T / 2) return 1;
    const row = Math.floor(Math.min(-T / 2 - z, z - o.south) / CELL);
    return FADE[row] ?? 0;
  };
  const north = T / 2 + 3;
  flagstones(B, {
    x: 0, z: (o.south + north) / 2, w: GW, d: north - o.south, y: 0, seed: seed + 148, ruin: 0.15, cell: CELL, keep,
  });
}

/**
 * 走道盡頭的圓塔：塔心在 (x, 0)，外緣半徑 RT，比走道高 3.6。16 段直牆圍一圈，
 * 錯開半段，讓正西、正南、正北各有一段是正的（塔門、旗掛在那幾段上）。頂上
 * 一圈垛口、一塊樓板把塔心蓋住。兩扇門是一組（`tower`）：朝走道那一面一扇、
 * 門檻在走道面上，朝兵營那一面一扇、門檻在地上。朝兵營那一面還有兩道箭窗
 * 與一面旗。
 */
function roundTower(B, seed, o) {
  const { x: TX, H, RT } = o;
  const HT = H + 3.6, TS = 16, step = (Math.PI * 2) / TS;
  const TR = RT - 0.55;
  const mid = (i) => (i + 1) * step;                   // 第 i 段的中線方向
  /* 開門的那兩段（段號 → 門檻高度）：牆砌成門洞底下與門洞上面兩截，中間
     讓出門洞（`towerDoor` 補門洞兩側的門框石與洞裡的甬道）。門洞高 DOOR.h
     是整皮的倍數，所以上下兩截的磚皮跟隔壁幾段對得齊。 */
  const doorSill = { 7: H, 11: 0 };
  const course = HT / 22;
  /* 門洞兩側那兩段牆：錯開半塊的那幾皮，端頭那塊磚順著自己的方向多出去半塊，
     斜插進門洞裡。門洞那個高度的磚裁到端頭為止（`flush`），缺的那一角由門框
     石補上（門框石補到 `towerDoorHalf`，比兩段牆的接縫多 0.1）。 */
  const opening = (j) => (doorSill[j] === undefined ? undefined : [doorSill[j], doorSill[j] + DOOR.h]);
  for (let i = 0; i < TS; i++) {
    const a0 = (i + 0.5) * step, a1 = (i + 1.5) * step;
    const from = [TX + Math.cos(a0) * TR, Math.sin(a0) * TR], to = [TX + Math.cos(a1) * TR, Math.sin(a1) * TR];
    const sill = doorSill[i];
    const flush = { from: opening((i + TS - 1) % TS), to: opening((i + 1) % TS) };
    let w;
    if (sill === undefined) {
      w = wall(B, { from, to, h: HT, thick: 1.0, ruin: 0, course, flush, seed: seed + 160 + i });
    } else {
      if (sill > 0) wall(B, { from, to, h: sill, thick: 1.0, ruin: 0, course, seed: seed + 160 + i });
      w = wall(B, { from, to, y: sill + DOOR.h, h: HT - sill - DOOR.h, thick: 1.0, ruin: 0, course, seed: seed + 200 + i });
    }
    merlons(B, { from, to, on: w, h: 0.9, thick: 1.0, pitch: 1.5, ruin: 1e-6, seed: seed + 180 + i });
  }
  B.add(B.kit.drum(TR, TR, 0.4, TS), { p: [TX, HT - 0.2, 0], color: C.graniteDark, ink: false });
  const face = TR * Math.cos(step / 2) + 0.5;           // 一段牆的外皮離塔心多遠
  const on = (i, d = 0) => [TX + Math.cos(mid(i)) * (face + d), Math.sin(mid(i)) * (face + d)];
  /* 兩扇塔門：正西那一段（i = 7）朝走道、門檻在走道面上；正南那一段（i = 11）
     朝兵營、門檻在地上。走進一扇，從另一扇的門外出來。 */
  const doorAt = (i, to, arrive) => {
    const n = [Math.cos(mid(i)), Math.sin(mid(i))];
    return towerDoor(B, seed + 196 + i, {
      face: on(i), n, y: doorSill[i], half: towerDoorHalf(RT), top: HT,
      reach: [TX + n[0] * RT, n[1] * RT], to, arrive, group: 'tower',
    });
  };
  // 塔身的碰撞是一根圓柱，在兩扇門的洞口各開一個缺口（見 `towerDoor`）。
  const notch = [doorAt(7, '.towerBase', 'towerTop'), doorAt(11, '.towerTop', 'towerBase')];
  B.round(TX, 0, RT, 0, HT, { kind: 'block', base: 0, notch });
  // 箭窗：開在一段牆的正中（開在別處會埋進磚裡），朝兵營與朝走道。
  for (const [i, y] of [[10, 3.2], [12, 3.2], [9, H + 2.0]]) {
    const [sx, sz] = on(i, 0.02);
    B.add(B.kit.brick(0.16, 0.9, 0.06, 0.01), {
      p: [sx, y, sz], r: [0, Math.atan2(Math.cos(mid(i)), Math.sin(mid(i))), 0], color: C.stoneDeep, ink: false,
    });
  }
  // 旗：正南那一段朝兵營、正北那一段朝城外。
  banner(B, { x: TX, y: HT - 0.9, z: -face, wall: 1, yaw: Math.PI, s: 0.95, color: C.banner });
  banner(B, { x: TX, y: HT - 0.9, z: face, wall: 1, yaw: 0, s: 0.95, color: C.bannerAlt });
}

/** 塔門的門洞：寬、高（整皮的倍數，0.4 × 6）、甬道從門面往塔裡伸多深。 */
const DOOR = { w: 1.1, h: 2.4, deep: 2.4 };
/** 外緣半徑 RT 的圓塔，一扇門的門框石從門洞中線補到多寬：那一段牆外皮的半寬再多 0.1。
    跟 `roundTower` 的 TR（RT − 0.55）、TS（16 段）是同一組數。 */
const towerDoorHalf = (RT) => (RT - 0.55) * Math.sin(Math.PI / 16) + 0.1;
/** 狗從身體的中心到屁股多長（1 公尺高的狗量出來是 0.48）：感測區在門面內這麼
    深，狗整隻走進門洞才被送走。 */
const DOG_BACK = 0.5;
/* 開著的門洞裡的黑霧：[離門面多深, 透明度]。最裡面那一層是實心的黑（甬道的
   盡頭），前面幾層一層比一層淡，疊起來是從門口往裡慢慢暗下去——跟黑牆內側
   那幾層霧殼同一個做法。穿過 k 層的亮度是 Π(1 − α)：門口 1、盡頭前 0.2。 */
const DOOR_HAZE = [[0.35, 0.1], [0.7, 0.14], [1.05, 0.18], [1.4, 0.24], [1.75, 0.3], [2.1, 0.4], [DOOR.deep, 1]];

/**
 * 圓塔的一扇門，一組門（`group`）裡的一扇。
 *
 * 門洞是真的開在牆上的（那一段牆在 `roundTower` 裡拆成上下兩截），洞裡是一段
 * 往塔身裡伸 DOOR.deep 的甬道：牆厚那一米是門框石，再進去是兩側的石壁與
 * 頂板（塔底那一扇再加一塊地板）。這些砌進合併的那一份，兩種狀態都在。
 *
 * 兩種狀態的東西各自另外成一塊（`detach`），執行時只換哪一塊看得到：關著是
 * 門面上一扇釘了鐵條的木門，把門洞整個蓋住；開著是甬道裡一層層的黑霧
 * （DOOR_HAZE）——門口看得到門框與甬道的石壁，往裡一路暗進黑裡，而不是
 * 門面上掛一塊黑布。
 *
 * 門開著，狗走得進門洞：塔的碰撞是半徑 RT 的圓柱（外皮 `reach` 比門面凸出
 * 0.14），這一扇在圓柱上開一個屬於這一組門的缺口（回傳給 `roundTower`，見
 * walk.js 的 `notch`）。門開著的時候，身體的中心進了缺口，圓柱就不擋；洞裡
 * 擋人的是另外登記的盒子：兩側門框、整段甬道上的頂板、甬道的盡頭。門關著，
 * 缺口不存在，身體照舊被圓柱擋在門前。
 *
 * 開著的時候甬道裡有一塊感測區，認的是身體的中心：從門面內 DOG_BACK 到甬道的
 * 盡頭、沿門面左右各 0.65。狗整隻走進門洞、走進那幾層黑霧裡才被送走——不是
 * 在門前消失。這一扇的到達點（`arrive`）在外皮外 1.9：從另一扇進來的人出現在
 * 這裡，背對著門。
 *
 * `face` 是這一段牆外皮的中點，`half` 是那一段外皮的半寬（門框石補到這裡），
 * `top` 是塔頂（洞裡那幾個盒子立到這裡）。門面要是正的（東西或南北向）：感測區、
 * 缺口與洞裡的盒子都是軸對齊的方盒。回傳這一扇的缺口。
 */
function towerDoor(B, seed, o) {
  const { face: [fx, fz], n: [nx, nz], y, group } = o;
  const alongX = Math.abs(nx) > Math.abs(nz);          // 門面的法線沿 x：東西向的門
  const tx = -nz, tz = nx;                             // 沿門面的方向
  const W = DOOR.w / 2, D = DOOR.deep, DH = DOOR.h;
  /** 門的局部座標 → 世界：t 沿門面、m 沿法線（往外是正，往塔裡是負）。 */
  const at = (t, m, yy) => [fx + tx * t + nx * m, yy, fz + tz * t + nz * m];
  /** 一塊方石：沿門面 tw、高 h、沿法線 md，中心在 (t, m, 底 + h/2)。 */
  const stone = (t, m, yy, tw, h, md, color, extra = {}) => B.add(
    B.kit.brick(...(alongX ? [md, h, tw] : [tw, h, md]), 0.04),
    { p: at(t, m, yy + h / 2), color, ...extra },
  );

  /* 甬道：從門面一路到 D，兩側各一整片石壁、頂上一整塊頂板，塔底那一扇再一塊
     地板（牆頂那一扇踩的是走道的鋪面，它一路鋪進塔裡）。每一面都是一整塊、
     從門口通到底——一塊一塊交錯的門框石讀起來是一堆磚，讀不出是一條廊道。
     石壁從洞邊補到這一段外皮的邊上（`half`），所以門面上洞的兩側是乾淨的
     兩道直邊；頂板貼在上面那一截牆的底下、往下吃進洞口 0.15，在門面上是一條
     橫楣（不跟那一截牆重疊，不然門面上兩個面疊在一起會閃）。 */
  const jw = o.half - W, LIN = 0.15;
  for (const s of [-1, 1]) stone(s * (W + jw / 2), -D / 2, y, jw, DH, D, C.stone);
  stone(0, -D / 2, y + DH - LIN, DOOR.w, LIN, D, C.stone);
  if (y === 0) stone(0, -D / 2 + 0.02, -0.2, DOOR.w, 0.2, D - 0.04, C.stoneDark);
  pointedArch(B, {
    x: fx + nx * 0.04, z: fz + nz * 0.04, y: y + 2.0, span: 1.6, rise: 1.1, yaw: alongX ? Math.PI / 2 : 0,
    thick: 0.3, depth: 0.3, ruin: 0, seed,
  });

  B.detach({ door: group, open: false, face: [nx, nz] }, () => {
    const [lx, , lz] = at(0, 0.04, 0);
    B.add(B.kit.brick(...(alongX ? [0.08, DH, DOOR.w + 0.2] : [DOOR.w + 0.2, DH, 0.08]), 0.02), {
      p: [lx, y + DH / 2, lz], color: C.woodDark,
    });
    for (const by of [0.55, 1.65]) {
      B.add(B.kit.brick(...(alongX ? [0.1, 0.09, DOOR.w + 0.1] : [DOOR.w + 0.1, 0.09, 0.1]), 0.01), {
        p: [lx + nx * 0.02, y + by, lz + nz * 0.02], color: C.iron, ink: false,
      });
    }
  });
  /* 開著：甬道裡一層層的黑霧，每一層蓋滿甬道的截面（往兩側石壁與頂板裡多伸
     2 公分，邊上不漏光；底邊就在地板上，地板擋著）。這一塊帶著門洞的盒子
     （`hole`，門框圍出來的那一塊，從門面到甬道盡頭）：驗證拿它量有沒有門框
     以外的磚插進來。 */
  const [h0, h1] = [at(-W, -D, y), at(W, 0, y + DH - LIN)];
  const hole = [[0, 1, 2].map((k) => Math.min(h0[k], h1[k])), [0, 1, 2].map((k) => Math.max(h0[k], h1[k]))];
  B.detach({ door: group, open: true, face: [nx, nz], hole }, () => {
    const e = 0.02;
    for (const [m, alpha] of DOOR_HAZE) {
      B.haze(at(-W - e, -m, y), at(W + e, -m, y), at(W + e, -m, y + DH + e), at(-W - e, -m, y + DH + e),
        alpha, [nx, 0, nz]);
    }
  });
  /** 門的局部座標裡的一個方盒 → 世界座標的 { min, max }。 */
  const box = (t0, t1, m0, m1, y0, y1) => {
    const a = at(t0, m0, y0), b = at(t1, m1, y1);
    return { min: [0, 1, 2].map((k) => Math.min(a[k], b[k])), max: [0, 1, 2].map((k) => Math.max(a[k], b[k])) };
  };
  const solid = ({ min, max }, base, open = false) => B.block(
    (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2,
    max[0] - min[0], max[1] - min[1], max[2] - min[2], { kind: 'block', base, open },
  );
  const [rx, rz] = o.reach;
  const skin = (rx - fx) * nx + (rz - fz) * nz;       // 圓柱的外皮在門面外多遠
  for (const s of [-1, 1]) solid(box(s * W, s * o.half, -D, 0, y, o.top), y);
  // 頂板底下就是狗走進去的甬道：本來就是空的（`open`）。
  solid(box(-W, W, -D, 0, y + DH - LIN, o.top), y, true);
  solid(box(-W, W, -D - 0.2, -D + 0.4, y, o.top), y);
  const notch = { ...box(-W, W, -D, skin + PHYS.radius + 0.1, y - 0.5, y + DH - LIN), door: group };

  const [p0x, , p0z] = at(-0.65, -D, 0), [p1x, , p1z] = at(0.65, -DOG_BACK, 0);
  B.portalBox(p0x, p0z, p1x, p1z, y - 0.5, y + 2.5, o.to, { door: group, mouth: { x: fx, y, z: fz, n: [nx, nz] } });
  B.arrive(o.arrive, rx + nx * 1.9, y, rz + nz * 1.9, Math.atan2(nx, nz));
  return notch;
}

/* ── 牆下的兵營 ──────────────────────────────────────────────────
   城內那一側（−z）的地面：守這段牆的兵住在牆腳。城門的路從中間往南穿過去，
   一路鋪進黑霧，只在營地中間斷開一段（見 `gate`）；它就是那條小路（`PATH`）。

   路東是住的地方：主帳、軍旗、兵帳，以及木箱木桶與一疊糧袋——圓塔塔腳的門
   就開在這一側，門口不擺練兵的東西（沒有人在住處門口射箭）。路西是練兵
   （武器架、假人、箭靶）與糧秣（糧袋、柴堆、炊事的火、軍需帳）。

   路東的帳篷沿著往塔門的那條空地（`lane`，從小路中段斜著到門前）排成兩排，
   門都朝著它。營繩避開帳篷的門口那一片，所以朝空地那一側沒有樁——空地是
   乾淨的，兩排帳篷夾出來的那一條就是「這裡留著」的暗示，不必鋪路。

   帳篷之間至少留一個人寬；小路（|x| < PATH）、那條空地與塔門前兩公尺什麼都
   不擺（軍旗的一根柱子例外，見下面）。營繩的樁不打進牆腳；帳身離黑牆一公尺
   以上，只有空地南側靠塔那一頂例外——它刻意大到被黑牆吃掉一角。 */
function camp(B, flames, lane) {
  const facing = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);   // 門朝 (tx, tz)
  /** 門朝那條空地上離它最近的那一點。 */
  const toLane = (x, z) => {
    const [ax, az] = lane.from, [bx, bz] = lane.to;
    const dx = bx - ax, dz = bz - az;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    return facing(x, z, ax + dx * u, az + dz * u);
  };
  const pennantOf = (color) => (color === C.banner ? C.bannerAlt : C.banner);

  /* 路東，空地北側：主帳與塔門邊一頂小帳。塔門邊那一頂夾在空地與城牆之間，
     帳身 1.3（再大，營繩的樁就打進牆腳）。主帳 1.9：擺在路口看過去的那一側，
     大了會把塔腳那扇門擋在後面——它比空地南側靠塔那一頂小。 */
  pavilion(B, { x: 5.9, z: -8.4, R: 1.9, h: 1.45, roof: 1.25, yaw: toLane(5.9, -8.4), color: C.banner, pennant: C.bannerAlt });
  /* 空地南側兩頂夾在空地與黑牆之間。靠塔那一頂反而最大（2.4）：從路口看，
     近的小、遠的大，兩排帳篷夾出來的那一條往塔門收，而不是往黑霧散開。它離空地
     的邊照舊 0.3、跟另一頂照舊留一個人寬，多出來的那一份往黑牆那一邊長，被黑牆
     吃掉一角（所以標 pierces）。 */
  const tent = ([x, z, R, color]) => pavilion(B, {
    x, z, R, h: 0.85 + R * 0.3, roof: 0.6 + R * 0.34, yaw: toLane(x, z), color, pennant: pennantOf(color),
  });
  tent([11.41, -6.57, 1.3, C.bannerAlt]);
  B.pierces(true);
  tent([14.21, -14.18, 2.4, C.banner]);
  B.pierces(false);
  tent([9.64, -16.35, 1.6, C.bannerAlt]);
  /* 軍旗立在空地接上小路的那個口的南側，旗面朝西、面向從城門下來的那條路。
     放南側是為了平衡：北側有城牆、主帳與木箱糧袋，份量已經夠重。兩根柱子
     沿 z 排（z ± 1），往城牆那邊靠了半面旗（0.875），北邊那一根站進空地的
     邊裡 0.56——旗半掩著路口，指著空地；空地中線離它還有一公尺多，走得過去。 */
  standard(B, { x: 4.8, z: -18.5 + 1.75 / 2, yaw: -Math.PI / 2, color: C.banner });
  // 木箱木桶靠牆、在兩頂帳篷之間，跟兩頂都留一個人寬（不然從帳頂滑下來會卡在夾縫裡）。
  crate(B, 8.2, 0, -4.8, -0.2);
  barrel(B, 9.1, 0, -4.6);
  sackStack(B, { x: 3.6, z: -4.9, layers: [[3, 2], [2, 1]] });

  // 路西：練兵。武器架與假人面朝路，箭靶在更西邊、也朝東。
  for (const z of [-7.5, -11]) {
    weaponRack(B, { x: -4.8, z, yaw: Math.PI / 2 });
    dummy(B, { x: -8, z, yaw: Math.PI / 2 });
  }
  for (const [x, z] of [[-11.5, -5.5], [-12, -8.5]]) archeryTarget(B, { x, z, yaw: Math.PI / 2 });

  // 路西南：糧秣與炊事。
  sackStack(B, { x: -14.5, z: -7, layers: [[3, 2], [2, 2], [1, 1]] });
  campfire(B, { x: -9.5, z: -15 }, flames);
  logSeat(B, -9.5, -16.9);
  logSeat(B, -9.5, -13.1);
  logSeat(B, -7.5, -15, true);
  woodpile(B, { x: -12.5, z: -16.5 });
  barrel(B, -7, 0, -17.5);
  pavilion(B, { x: -13.5, z: -12.5, R: 2.2, h: 1.6, roof: 1.35, yaw: facing(-13.5, -12.5, -9.5, -15), color: C.bannerAlt, pennant: C.banner });
}

/* ── 五、地下墓室 ─────────────────────────────────────────────────
   一間壓低的墓室。從南端一道樓梯頂上的鐵閘進來（那是來時的路，通回水窖
   的南門；閘是一扇門），往下走進兩排石棺之間的走道；北端兩級台階上去是一座大墓。

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
  /* 南牆在南端樓梯頂上開一個門洞（見南端那一段）：寬 2.6、高度對齊整皮（2.2～4.84）。 */
  const DOOR = { s: [-1.3, 1.3], y: [2.2, 4.84] };
  wall(B, { from: [-X, -Z], to: [X, -Z], h: WH, thick: 0.9, ruin: 0.08, seed: seed + 2, hole: DOOR });
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

  // ── 南端：來時的路。一道樓梯上到一塊平台，平台後面是穿過南牆、通回水窖的門洞 ──
  /* 從 −8.4 起、往南七級：最後一級停在 −12.74，平台就有 1.2 公尺深——扣掉
     鐵閘的 0.3，還站得下一隻狗。 */
  const up = stair(B, { x: 0, z: -8.4, y: 0, yaw: Math.PI, steps: 7, rise: 0.3, run: 0.62, w: 3.0, seed: seed + 60 });
  const end = -8.4 - up.depth;                  // 最後一級的外緣
  const LZ = (end - IZ) / 2, LD = end + IZ + 0.04;
  B.add(B.kit.brick(3.2, 0.3, LD, 0.05), { p: [0, up.top - 0.15, LZ], color: C.granite, solid: 'step' });
  B.add(B.kit.brick(3.0, up.top - 0.3, LD * 0.96, 0.04), {
    p: [0, (up.top - 0.3) / 2, LZ], color: C.stoneDeep, ink: false, solid: 'shell', base: 0,
  });
  /* 門洞穿過南牆，洞後面就是黑牆：通道往外面去，這裡看不到它通到哪。門檻是
     洞底那一皮磚的頂（2.2，比平台高 0.1）。鐵閘是一扇門（`gate`，按 O），落在
     牆厚的正中；升起來收進洞頂上的牆裡。感測區從牆的內皮往裡 0.5 起、一路到
     黑牆，跟其他鐵閘一樣：狗整隻走進門洞、走進磚後的那片黑才被送走。到達點在
     樓梯腳下、面朝北：從水窖過來的人背對著來時的樓梯，鏡頭落在樓梯上方（跟
     出生點同一個理由，見下面）。 */
  const SILL = DOOR.y[0];
  grate(B, {
    x: 0, z: -Z, y: SILL, w: 2.4, h: 2.6, yaw: 0, lift: 1.9, ceil: () => DOOR.y[1],
    group: 'gate', face: [0, 1],
    hole: [[DOOR.s[0], SILL, -Z - 0.45], [DOOR.s[1], DOOR.y[1], -Z + 0.45]],
  });
  B.portalBox(DOOR.s[0], A.z0, DOOR.s[1], -IZ - 0.5, SILL - 0.5, SILL + 2.5, 'cistern.gate', {
    door: 'gate', mouth: { x: 0, y: SILL, z: -IZ, n: [0, 1] },
  });
  B.arrive('gate', 0, 0, -7.0, 0);

  /* 出生點在走道南段，面朝北（+z）。不是鐵閘前的平台：那裡背後貼著牆，
     鏡頭的吊臂一伸就撞牆，縮到角色的頭裡面。站在這裡，鏡頭落在樓梯上方，
     來時的那道樓梯與鐵閘就在畫面的下緣。 */
  return { spawn: [0, 0, -6], yaw: 0 };
}

/* ── 六、城內窄巷 ─────────────────────────────────────────────────
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
    const tc = side < 0 ? C.tile : C.tileDark;
    if (vx) B.add(B.kit.brick(D + 0.3, 0.16, slope, 0.03), { p: [x, y, z], r: [tilt, 0, 0], color: tc });
    else B.add(B.kit.brick(slope, 0.16, D + 0.3, 0.03), { p: [x, y, z], r: [0, 0, -tilt], color: tc });
    /* 瓦：斜板上一排一排疊上去，從簷口往屋脊。每一排比斜板多翹 5°——下緣
       離開斜板 2 公分、上緣壓在斜板上，下一排再蓋住它的上緣。所以從側面看
       屋面是一道一道的階，每一階底下一條影子；那就是「瓦」這件事在輪廓上
       的全部證據，貼圖只負責一排裡面一片一片的縫。

       旋轉只有一根軸（vx 繞 x、否則繞 z），所以斜板的座標可以直接寫：
       b 是順著坡的那一軸、n 是斜板的法線。簷口在 b 的哪一端（ev）是從轉角
       的正負號推出來的：繞 x 轉 θ 時局部 +z 的高度是 −z·sinθ，繞 z 轉 φ
       時局部 +x 的高度是 x·sinφ。 */
    const ang = vx ? tilt : -tilt;
    const ev = Math.sign(tilt) || 1;              // 簷口在 b = ev·slope/2
    const RW = 0.42, RP = 0.32, LIFT = 0.087;     // 一排多寬、排距、翹多少（5°）
    const rows = Math.max(2, Math.ceil((slope - RW) / RP) + 1);
    for (let i = 0; i < rows; i++) {
      const b = ev * Math.max(slope / 2 - RW / 2 - i * RP, -(slope / 2 - RW / 2));
      const n = 0.08 + 0.025 + (RW / 2) * LIFT;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      if (vx) {
        // 繞 x：(0, n, b) → (0, n·cos − b·sin, n·sin + b·cos)
        B.add(B.kit.brick(D + 0.34, 0.05, RW, 0.015), {
          p: [x, y + n * cs - b * sn, z + n * sn + b * cs], r: [ang - ev * LIFT, 0, 0], color: tc,
        });
      } else {
        // 繞 z：(b, n, 0) → (b·cos − n·sin, b·sin + n·cos, 0)
        B.add(B.kit.brick(RW, 0.05, D + 0.34, 0.015), {
          p: [x + b * cs - n * sn, y + b * sn + n * cs, z], r: [0, 0, ang + ev * LIFT], color: tc,
        });
      }
    }
  }
  /* 壓脊：一根轉了 45° 的方料，沿著屋脊壓住兩面瓦的上緣。 */
  {
    const [x, z] = at(0, D / 2);
    const len = D + 0.4;
    B.add(B.kit.brick(vx ? len : 0.2, 0.2, vx ? 0.2 : len, 0.02), {
      p: [x, e + gh + 0.27, z], r: vx ? [Math.PI / 4, 0, 0] : [0, 0, Math.PI / 4], color: C.tileDark,
    });
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
    /* 門板：四片直板，板縫 1.5 公分，縫後面是一片暗色的襯板——不然縫裡
       看到的是牆洞底的灰泥。正面仍然在 RD − 0.06，跟以前那一整片同一個
       深度。兩根橫檔把板子串起來，橫檔上各一條鐵帶，從門軸那一側釘過來。 */
    const DWI = DW - 0.08, NP = 4, PW = DWI / NP;
    {
      const [x, z] = at(du, RD);
      const [bw, bd] = size(DWI, 0.02);
      B.add(B.kit.brick(bw, DH - 0.04, bd, 0.005), { p: [x, (DH - 0.04) / 2, z], color: C.woodDark, ink: false });
    }
    for (let i = 0; i < NP; i++) {
      const [x, z] = at(du - DWI / 2 + PW * (i + 0.5), RD - 0.025);
      const [pw, pd] = size(PW - 0.015, 0.07);
      B.add(B.kit.brick(pw, DH - 0.04, pd, 0.012), { p: [x, (DH - 0.04) / 2, z], color: C.wood });
    }
    for (const ly of [0.45, 1.65]) {
      const [x, z] = at(du, RD - 0.078);
      const [lw, ld] = size(DWI - 0.1, 0.035);
      B.add(B.kit.brick(lw, 0.14, ld, 0.01), { p: [x, ly, z], color: C.woodDark });
      // 鐵帶從門軸那一側（離房子中線遠的那一邊）伸到門的三分之二。
      const hinge = Math.sign(du) || 1, sl = DWI * 0.66;
      const [sx2, sz2] = at(du + hinge * (DWI / 2 - sl / 2 - 0.02), RD - 0.1);
      const [sw, sd] = size(sl, 0.012);
      B.add(B.kit.brick(sw, 0.05, sd, 0.004), { p: [sx2, ly, sz2], color: C.iron, ink: false });
    }
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
  /* 這一口井是開的：井口是一個坑，跳上井圈再往裡走就掉下去。掉到地下三公尺
     就碰到感測區，送到水窖——從水窖的半空中掉下來。井底沒有路上來，這條路
     是單向的：人掉進去的那一瞬間是整個畫面一片黑，那一片黑就是這條通道。 */
  well(B, { x: 0, z: WZ, y: 0, r: 1.15, seed: seed + 3, open: true });
  B.portal(0, WZ, 1.15 * 0.78, -8.5, -3, 'cistern.well', { oneWay: true });
  /* 從水窖的殘階爬上來的地方：井的南邊、離井心 2.4，面朝井。 */
  B.arrive('stair', 0, 0, WZ - 2.4, 0);
  /* 巷子南端沒入黑霧的那一截：一塊橫過巷子的感測區，從黑牆往裡 1.4 公尺，
     送到中庭的西拱洞前。回來的到達點在巷子裡、離這一塊兩公尺，面朝廣場。 */
  B.portalBox(-S, A.z0, S, A.z0 + 1.4, -0.5, 3, 'courtyard.west');
  B.arrive('fog', 0, 0, A.z0 + 3.4, 0);
  for (const sx of [-1, 1]) brazier(B, { x: sx * 5.6, z: NZ - 1.2, y: 0, s: 0.9, seed: seed + 4 + sx }, flames);
  crate(B, -6.0, 0, 5.2, 0.0); crate(B, -6.0, 0.9, 5.2, 0.12); crate(B, -5.1, 0, 5.3, -0.1);
  crate(B, 6.1, 0, 6.6, 0.05);
  for (const [bx, bz] of [[6.1, 5.3], [5.3, 5.2]]) barrel(B, bx, 0, bz);
  for (let i = 0; i < 10; i++) mossTuft(B, r.range(-S + 0.3, S - 0.3), 0, r.range(-15, 3), r);

  // 出生點在巷子中段，面朝北（+z）：巷子的盡頭就是廣場。
  return { spawn: [0, 0, -8], yaw: 0 };
}

/* ── 名冊 ────────────────────────────────────────────────────────
   每一個區塊：一個 id、一個名字、一個世界座標、一支砌它的函式。
   `origin` 是那個區塊自己的原點在世界裡的位置——區塊內部一律用自己的
   局部座標寫，砌完再整個平移過去，所以四個區塊的程式碼互相看不到彼此。 */
/* `arena` 是這個區塊的**黑牆**，也就是移動的上限（在 buildRuins 裡登記成
   一個 'bound' 碰撞體，跟柱子和牆進同一張清單）。兩種形狀：

     方（'rect'）  室內的房間。邊界貼在牆面上——中庭與王座廳的牆本來就是
                  方的，用圓去圍會在四個角留下一圈到不了的空地。
     圓（'circle'）水窖（環牆本來就是圓的）與城牆步道。

   ── 貼合 ────────────────────────────────────────────────────────
   黑牆貼著砌體走，所以牆外的東西（扶壁）就拿掉了：從裡面看不到（牆擋著），
   從外面到不了（那是黑牆外面）。城牆步道也貼著——走道盡頭的圓塔切在黑牆
   上——但它的黑牆是半徑 22 的圓，牆下兩側還有一片地：城內那一側是走得到
   的兵營，城外那一側（方塔腳、荒地）看得到、到不了。

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
   不必靠玩，`tools/verify-test-area.mjs` 用真的物理走一遍就知道。兩層的
   區塊（城牆步道）給一串，一層一筆。

   `doors` 是這個區塊裡每一組門一開始的狀態（組名 → 開著嗎）。一組門是
   幾扇一起開關的門，狀態在執行時改（main.js 的 setDoor），不是地圖的版本；
   砌完之後組名前面會加上區塊的 id（'wallwalk.tower'）。

   `fenced` 是「空氣牆圍著的那一層」的走道面高度：那一層只能從感測區（門）
   上下，驗證器據此檢查從那一層走、跳都下不去。

   `moss` 是這一張圖的苔量，0～1，不給就是 1（預設那麼多）。它同時管石頭
   朝上那一面的苔（面積是預設的幾倍）與苔叢（每一叢長不長的機率）。只能往下
   調：1 以上跟 1 一樣。墓室是封死的地下室、沒有光，所以是 0。 */
export const BLOCKS = [
  {
    id: 'courtyard', name: '崩塌中庭', hint: '兩側拱廊、一圈斷柱、門樓與鐵閘',
    origin: [0, 0], build: courtyard, seed: 0x1a2b,
    room: { y: 0, hx: 12.4, hz: 12.4 },
    // 牆面：南牆 13.5、門樓 13.6、兩側拱廊 13.5。砌體最高 7.4。
    arena: { shape: 'rect', x0: -13.8, x1: 13.8, z0: -13.8, z1: 13.8, lid: 12.0 },
    // 通到別的區塊的幾扇門，一開始關著。
    doors: { gates: false },
  },
  {
    id: 'throne', name: '王座廳', hint: '兩列柱、斜插的穹稜、台座與王座',
    origin: [0, PITCH], build: throne, seed: 0x5e6f, moss: 0.3,
    room: { y: 0, cz: -1.5, hx: 6.9, hz: 12.0 },
    // 牆面：兩側 8.05、南端 14.95、北端（王座背後那道）18.95。
    arena: { shape: 'rect', x0: -8.3, x1: 8.3, z0: -15.2, z1: 19.2, lid: 14.0 },
    // 正門的鐵閘，一開始放下。
    doors: { gate: false },
  },
  {
    id: 'cistern', name: '圓塔水窖', hint: '環形拱廊、鐵閘、貼牆殘階、垂鏈',
    origin: [PITCH, PITCH], build: cistern, seed: 0x7a8b, moss: 0,
    // 9.9 而不是 10.5：貼牆那道殘階的第一級（頂面 0.33）伸進來到 10.35，
    // 而樓梯是房間之間的垂直交通，不算房間的地板。
    room: { y: 0, rad: 9.9 },
    /* 環牆的外皮在 13.55——那是轉角。環牆是 16 段直牆，每一段的中點外皮
       只到 13.0·cos(π/16) + 0.55 ≈ 13.3。黑牆以前在 13.9，於是每段牆中點
       外面有一條 0.6 寬的縫：從殘階頂跳上牆頭、往外一走就掉進去，剛好塞得
       下狗，而且再也走不回來。13.75 讓那條縫只剩 0.45，比身體窄，站在牆頭
       往外走會先被黑牆擋住，不會掉下去。 */
    arena: { shape: 'circle', x: 0, z: 0, r: 13.75, lid: 12.0 },
    // 朝南那道鐵閘，一開始放下。
    doors: { gate: false },
    // 三個門洞都有鐵閘：從地上走到底停在環牆或閘上，走不到黑牆。
    sealed: true,
  },
  {
    id: 'wallwalk', name: '城牆步道', hint: '牆下的兵營、圓塔上下兩扇門、牆頂的走道',
    origin: [0, 2 * PITCH], build: wallwalk, seed: 0x9cad, moss: 0.2,
    room: [
      // 兵營：城門的路與往南那條小路，城門內到黑霧前。兩側是帳篷與練兵的東西。
      { y: 0, cz: -12, hx: 2.0, hz: 6.5 },
      // 走道：女牆之間（−3.1～3.0），方塔與圓塔之間那一段。方塔頂也走得到，但不算這一片。
      { y: 5.2, hx: 7.6, hz: 2.6 },
    ],
    /* 圓形黑牆，半徑 22。幕牆沿著直徑：西端穿過它（切面藏在牆外），東端的
       圓塔外緣切在它上面。

       `haze` 比預設多兩層：預設那一層薄霧（內縮 1.2）是為了糊掉牆腳那條
       邊，而這裡要的是一條走道**慢慢**淡進黑暗，看不出它在哪裡結束。兵營
       那條小路沒入黑霧用的也是這幾層。 */
    arena: {
      shape: 'circle', x: 0, z: 0, r: 22, lid: 14.0,
      haze: [[0, 1.0], [1.2, 0.34], [3.5, 0.24], [6.5, 0.14]],
    },
    // 圓塔的兩扇門，一開始關著：兵營走不上牆。
    doors: { tower: false },
    fenced: 5.2,
  },
  {
    id: 'crypt', name: '地下墓室', hint: '拱肋、石棺、壁龕與燭火',
    origin: [0, 3 * PITCH], build: crypt, seed: 0xc3d4, moss: 0,
    room: { y: 0, hx: 2.6, hz: 8.2 },
    // 南端那道鐵閘，一開始放下。
    doors: { gate: false },
    /* 牆面：兩側 8.05、兩端 14.85。封頂壓在拱頂上方一公尺多（拱頂約 7.1）。
       `sealed`：四面都是牆，唯一通到黑牆的門洞在南端樓梯頂、關著鐵閘——走到底停在牆上，
       不是停在黑牆上，所以驗證不驗「走到底貼在黑牆上」。 */
    arena: { shape: 'rect', x0: -8.3, x1: 8.3, z0: -15.1, z1: 15.1, lid: 8.4 },
    sealed: true,
  },
  {
    id: 'alley', name: '城內窄巷', hint: '木構的連棟屋、盡頭的小廣場與井',
    origin: [PITCH, 3 * PITCH], build: alley, seed: 0xd5e6,
    // 巷子那一段（廣場從 z = 4 開始）。
    room: { y: 0, hx: 2.3, hz: 6.0 },
    // 房子背面的外皮在 ±10.6、北排在 16.9；南端整條巷子穿進黑牆。
    arena: { shape: 'rect', x0: -11.0, x1: 11.0, z0: -16.0, z1: 17.5, lid: 11.0 },
  },
];

/**
 * 砌出整片廢墟。
 *
 * 四個區塊 + 中間那片地全部砌進同一個 Build，於是整張地圖是一個 mesh
 * 加一個 LineSegments——兩個 draw call。這是可以這樣做的，因為地圖是
 * 靜態的：沒有一塊石頭會動，會動的只有火焰，而火焰不在這裡。
 *
 * 門是例外：兩種狀態的門扇各自一塊（`pieces`），執行時換看得到的那一塊。
 *
 * @returns {{geometry, ink, colliders, flames, spawns, arenas, portals, arrivals,
 *   doors, pieces, signs, tris, inkLines}} `doors` 是每一組門一開始的狀態（組名 → 開著嗎）。
 */
export function buildRuins(opts = {}) {
  const B = new Build(new Kit(), opts);
  const flames = [];
  const spawns = {};
  const arenas = [];
  const doors = {};
  _colCursor = _inkCursor = _flameCursor = 0;   // 同一個行程裡砌第二遍也要對
  _partCursor = _wallCursor = _floorCursor = _portalCursor = 0;
  _arriveCursor = _pieceCursor = _signCursor = 0;

  for (const b of BLOCKS) {
    const [ox, oz] = b.origin;
    const mark = B.pos.length;
    B.mossRate = b.moss ?? 1;
    // 場地帶進去，因為撒出去的東西要逐顆問「還在黑牆裡面嗎」。
    const meta = b.build(B, flames, b.seed, b.arena);
    // 區塊是用自己的局部座標砌的，砌完把這一段整個平移到世界位置上——
    // 包含頂點、墨線、碰撞盒與火焰。
    shift(B, mark, ox, oz, flames, b.id);
    // 第四個數是出生時的鏡頭方位（cam.yaw）；沒給就是 π，也就是面朝 −z。
    spawns[b.id] = [meta.spawn[0] + ox, meta.spawn[1], meta.spawn[2] + oz, meta.yaw ?? Math.PI];
    for (const [g, open] of Object.entries(b.doors || {})) doors[`${b.id}.${g}`] = open;
    const A = b.arena;
    arenas.push(A.shape === 'circle'
      ? { id: b.id, shape: 'circle', x: A.x + ox, z: A.z + oz, r: A.r, lid: A.lid, haze: A.haze }
      : {
        id: b.id, shape: 'rect', lid: A.lid, haze: A.haze,
        x0: A.x0 + ox, x1: A.x1 + ox, z0: A.z0 + oz, z1: A.z1 + oz,
      });
  }
  B.mossRate = 1;

  /* 黑牆。砌完、平移完才登記，因為它拿的是世界座標——`shift` 搬的是
     「還沒搬過的」那些盒子，這幾筆進來得太早會被多搬一次。 */
  for (const a of arenas) B.bound(a);

  /* 感測區的目的地。全部砌完才解得出來：窄巷的井指向水窖的到達點，而水窖
     是在窄巷前面還是後面砌的，不該有關係。解不出來就是寫錯了名字——那是
     一個走進去什麼都不會發生的感測區，所以直接丟出去，不留到執行時。 */
  const arrivals = {};
  for (const a of B.arrivals) arrivals[a.name] = a;
  for (const p of B.portals) {
    const a = arrivals[p.to];
    const s = spawns[p.to];
    if (!a && !s) throw new Error(`感測區的目的地不存在：${p.to}（從 ${p.block}）`);
    p.dest = a ? { x: a.x, y: a.y, z: a.z, yaw: a.yaw, block: a.block }
      : { x: s[0], y: s[1], z: s[2], yaw: s[3], block: p.to };
    if (p.door && !(p.door in doors)) throw new Error(`感測區屬於一組沒有登記的門：${p.door}`);
  }

  const out = B.finish();
  out.flames = flames;
  out.spawns = spawns;
  out.arenas = arenas;
  out.arrivals = arrivals;
  out.doors = doors;
  return out;
}

/* 把 `from` 之後新加進來的所有東西平移。頂點與墨線是從 `from` 這個
   索引開始的那一段；碰撞盒與火焰則是「還沒有被搬過的」那些，用一個游標
   記著——比重算一次整個區塊便宜，也不必讓每個零件都去接一個 offset。 */
let _colCursor = 0, _inkCursor = 0, _flameCursor = 0;
let _partCursor = 0, _wallCursor = 0, _floorCursor = 0, _portalCursor = 0;
let _arriveCursor = 0, _pieceCursor = 0, _signCursor = 0;
function shift(B, fromPos, ox, oz, flames, id) {
  for (let i = fromPos; i < B.pos.length; i += 3) { B.pos[i] += ox; B.pos[i + 2] += oz; }
  for (let i = _inkCursor; i < B.ink.length; i += 3) { B.ink[i] += ox; B.ink[i + 2] += oz; }
  _inkCursor = B.ink.length;
  for (let i = _colCursor; i < B.colliders.length; i++) {
    const c = B.colliders[i];
    c.min[0] += ox; c.max[0] += ox; c.min[2] += oz; c.max[2] += oz;
    // 圓柱的軸是另外一組座標，跟著搬——漏搬的話那根柱子會擋在別的區塊裡。
    if (c.shape === 'circle' || c.kind === 'pit') { c.x += ox; c.z += oz; }
    // 圓柱上的缺口：跟著搬，屬於哪一組門也跟感測區一樣加上區塊的 id。
    for (const n of c.notch || []) {
      n.min[0] += ox; n.max[0] += ox; n.min[2] += oz; n.max[2] += oz;
      if (n.door) n.door = `${id}.${n.door}`;
    }
    if (c.door) c.door = `${id}.${c.door}`;         // 屬於一組門的盒子（鐵閘）
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
  /* 感測區也是區塊自己的座標；`'spawn'` 在這裡換成區塊的 id、`'.名字'`
     換成這個區塊的到達點、門的組名前面加上區塊的 id——砌它的那支函式不知道
     自己叫什麼。 */
  const own = (name) => `${id}.${name}`;
  for (let i = _portalCursor; i < B.portals.length; i++) {
    const p = B.portals[i];
    if (p.shape === 'box') { p.x0 += ox; p.x1 += ox; p.z0 += oz; p.z1 += oz; } else { p.x += ox; p.z += oz; }
    if (p.mouth) { p.mouth.x += ox; p.mouth.z += oz; }
    if (p.to === 'spawn') p.to = id;
    else if (p.to.startsWith('.')) p.to = own(p.to.slice(1));
    if (p.door) p.door = own(p.door);
    p.block = id;
  }
  _portalCursor = B.portals.length;
  for (let i = _arriveCursor; i < B.arrivals.length; i++) {
    const a = B.arrivals[i];
    a.x += ox; a.z += oz;
    a.name = own(a.name);
    a.block = id;
  }
  _arriveCursor = B.arrivals.length;
  // 另外成一塊的幾何（門）：頂點、墨線與黑霧整塊搬，組名跟感測區一樣加上區塊的 id。
  for (let i = _pieceCursor; i < B.pieces.length; i++) {
    const q = B.pieces[i];
    for (const arr of [q.pos, q.ink, q.haze.pos]) for (let k = 0; k < arr.length; k += 3) { arr[k] += ox; arr[k + 2] += oz; }
    if (q.hole) for (const c of q.hole) { c[0] += ox; c[2] += oz; }
    if (q.door) q.door = own(q.door);
    q.block = id;
  }
  _pieceCursor = B.pieces.length;
  for (let i = _signCursor; i < B.signs.length; i++) {
    const s = B.signs[i];
    s.x += ox; s.z += oz;
    if (s.door) s.door = own(s.door);
    s.block = id;
  }
  _signCursor = B.signs.length;
}
