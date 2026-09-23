/* ── tools/verify-test-area.mjs ──────────────────────────────────────
   /test-area/ 的離線驗證。

   這一頁的設計規則有三條是「用眼睛看不出來有沒有壞」的：

     1. 中心夠空曠   每個區塊中央那片空地上，每一格的支撐高度都必須等於
                     鋪面的高度，而且站在上面不會被任何碰撞盒推開。
                     少一塊鋪面、多一顆會絆腳的大石頭，這一項就會紅。
     2. 走得到       從出生點真的走到中心去——用的是 public/test-area/
                     src/walk.js 那一份物理，不是另寫一份。城牆平台這一
                     項尤其重要：它要爬兩折樓梯穿過一道牆的缺口，而那條
                     路上任何一個看不見的盒子都會讓狗卡住。
     3. 烘焙接上了    部位表量到了、畫的就是烘出來的幾何、墨線那一推只
                     插進了墨線的著色器、耳朵沒被烘、墨線的寬度換算對。
                     node 沒有 WebGL 可以編譯，但這些全都查得出來，而它們
                     就是這一段會壞的地方——字串比對失敗不會報錯，只會
                     靜靜地畫出一隻沒有圓角的狗。
     4. 動物是遊戲那幾隻  cat.bin 讀得動、species.js 的三種模型都建得
                     起來、每一種的骨頭每幀算得出有限的矩陣、九種 look 都
                     換得動、腳踩在 y = 0 上。這一頁不重畫動物，所以要驗
                     的是「接得上」而不是「長得像」。
     5. 生物那張表塞得進直欄  直欄可以只有 96 px 寬，而那不是斷點、是
                     算出來的。所以降級的門檻要跟真的量出來的尺寸對得上，
                     不然最窄的那一級會把表推寬、被面板裁掉半排。
     6. 每塊石頭底下有東西頂著  砌體不准有一塊石頭浮在空中。這一項掃
                     的是「一堆碎料」和「一棟建築」的差別，而它抓到過
                     `wall()` 拿絕對 y 去比相對高度——任何抬高的牆整段
                     消失，於是九個垛口浮在四公尺的空中。掛件（拱的楔石、
                     旗、鏈、獸像、樹枝）用 `hang` 標記，白名單是旗標
                     而不是人的記性。
     7. 牆身之內不透光  牆只有一塊磚厚，磚縫是穿透的，所以牆裡有一片
                     牆芯。有沒有牆芯從外面看一模一樣——只有站在裡面、
                     光從另一邊來的時候才看得到一排亮縫。
     8. 鋪面底下有基座  石板會缺，缺掉的地方看到的必須是填層而不是洞。
                     露台那一片以前是看穿到三公尺底下的。
     9. 碰撞盒都有分類  每個盒子都要說自己是地板、障礙、階梯還是牆體，
                     而每一種有自己的高度規矩。這一項是「視覺凹凸不准傳到
                     腳底下」唯一的執行者。
    9b. 圓的東西是圓的  柱、井、樹是圓的，碰撞體也必須是圓的。方盒的角
                     比它所代表的圓遠 41%，繞著走會在四個角上各被頂開
                     一次——看不出來（畫面上是圓的），只有跑起來覺得
                     這根柱子卡卡的。
    9c. 圓頂上站不住  大石與樹梢的頂是圓的，站上去要滑下來——大石是
                     可操作的緩滑，樹梢那種危險、不可踩的是失去操作的
                     滑落。這一項也看不出來：不可踩的頂如果悄悄變成站得
                     住，畫面上什麼都不會變，只會有人站在不該站的地方。
                     所以用真的物理各滑一次。
    10. 房間是可玩的  整片房間都是平的、都走得到、沒有被障礙物塞滿。
                     這是 roguelike 要的那個單位。
    11. 地形的墨線與五階調  兩件事都活在著色器裡，node 沒有 WebGL 編不
                     了——但它們要的**資料**就在緩衝區裡，而字串有沒有
                     插進去也查得出來，那正是會壞的兩個地方：面法線沒
                     烘進去，畫面上是墨線整批消失；字串沒配到，畫面上是
                     每一道轉折又全都描上了。兩種都不會報錯。
    12. 手把的版面與手感  兩側是操作列、中間那一整片是遊戲——這條規則
                     是這個版面存在的全部理由，而「觸控區悄悄長到畫面
                     中央」看不出來，只會讓人覺得點哪裡都在走路。軸是
                     圓的（推到對角不會比推直的快 41%）也一樣：看不出來，
                     只有跑起來覺得斜著比較快。

   跑法：node tools/verify-test-area.mjs
   ------------------------------------------------------------------ */

import * as THREE from '../public/test-area/vendor/three.module.js';
import { buildRuins, BLOCKS, PITCH } from '../public/test-area/src/blocks.js';
import {
  PHYS, SLIDE, APEX, solveXZ, supportAt, supportInfo, roundTop, roundSin,
  slideDrift, slideAccel, arenaGap, boomLimit, BLOCK_TOP, TRIP, MOUNT,
} from '../public/test-area/src/walk.js';
import { VEIL, buildVeil, outline } from '../public/test-area/src/veil.js';
import { toonVC, inkLine, BAND_EDGE, BAND_KEY } from '../public/test-area/src/palette.js';
import { CAM, makeCam, updateCam } from '../public/test-area/src/camera.js';
import { readFileSync } from 'node:fs';
import { loadZoo } from '../public/test-area/src/critter.js';
import { Pad } from '../public/test-area/src/pad.js';
import { railTier } from '../public/test-area/src/hud.js';

let fails = 0;
const ok = (cond, label, detail = '') => {
  if (cond) console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  else { console.log(`  ✗ ${label}  ${detail}`); fails++; }
};
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 56 - s.length))}`);

/* 每個區塊「必須是空的」那一片。區塊自己的局部座標，加上 origin 才是
   世界座標。y 是那片空地的鋪面高度——城牆平台的空地在露台上，不在地面。 */
/* `via` 是那條路上的幾個轉折點（區塊的局部座標）。城牆平台需要它：
   露台在 3.2 高，上去的路是兩折樓梯加一道牆的缺口，而驗證用的走法是
   「朝目標直線走」——直線走進一面城牆是走不上去的，真人也不會那樣走。
   給轉折點不是放寬標準：每一段仍然是用真的物理走完的。 */
const CENTERS = {
  courtyard: { y: 0, hx: 6.0, hz: 6.0 },
  rampart: { y: 3.2, hx: 8.0, hz: 4.2, via: [[4.2, -14], [4.2, -9.5], [4.2, -5.5]] },
  throne: { y: 0, hx: 4.4, hz: 8.5 },
  cistern: { y: 0, hx: 6.0, hz: 6.0 },
  wallwalk: { y: 5.2, hx: 7.0, hz: 2.4 },
  breach: { y: 5.2, hx: 3.5, hz: 2.4 },
  crypt: { y: 0, hx: 2.4, hz: 8.0 },
  alley: { y: 0, hx: 2.0, hz: 6.0 },
};

head('砌全部區塊');
const t0 = Date.now();
const R = buildRuins({ record: true });
const ms = Date.now() - t0;
console.log(`  ${ms} ms ・ ${R.tris.toLocaleString()} 三角形 ・ ${R.inkLines.toLocaleString()} 墨線`
  + ` ・ ${R.colliders.length} 碰撞盒 ・ ${R.flames.length} 盆火`);
ok(R.tris > 120000, '幾何量夠稱得上高細緻度', `${R.tris} tris`);
ok(R.colliders.length > 200, '碰撞盒有登記', `${R.colliders.length}`);
ok(R.flames.length >= 8, '火盆散得夠開', `${R.flames.length} 盆`);

head('緩衝區乾淨');
{
  const p = R.geometry.attributes.position.array;
  const n = R.geometry.attributes.normal.array;
  const c = R.geometry.attributes.color.array;
  let nan = 0, badN = 0, badC = 0;
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) nan++;
  for (let i = 0; i < n.length; i += 3) {
    const L = Math.hypot(n[i], n[i + 1], n[i + 2]);
    if (!(L > 0.9 && L < 1.1)) badN++;
  }
  for (let i = 0; i < c.length; i++) if (!(c[i] >= 0 && c[i] <= 1)) badC++;
  ok(nan === 0, '沒有 NaN 頂點', `${nan}`);
  ok(badN === 0, '法線都是單位長', `${badN} / ${n.length / 3}`);
  ok(badC === 0, '頂點色都在 [0,1]', `${badC}`);
  ok(R.geometry.attributes.position.count === R.geometry.attributes.color.count, '頂點色數量對得上');
  const ip = R.ink.attributes.position.array;
  let inan = 0;
  for (let i = 0; i < ip.length; i++) if (!Number.isFinite(ip[i])) inan++;
  ok(inan === 0, '墨線沒有 NaN', `${inan}`);
  ok(ip.length % 6 === 0, '墨線是成對的頂點');
}

head('墨線只描輪廓');
/* 輪廓判定是「這條邊兩側的面，一個朝鏡頭一個背對」。判定本身在著色器
   裡，這裡驗的是它吃的那兩個法線：數量對得上、是單位長（int8 量化之後
   仍然要是）、而且一條線的兩個頂點帶的是同一組——半路換人的話，線會
   在中間斷掉。 */
{
  const n0 = R.ink.attributes.aN0, n1 = R.ink.attributes.aN1;
  const P = R.ink.attributes.position;
  ok(!!n0 && !!n1, '每個墨線頂點都帶著兩側的面法線');
  ok(n0.normalized && n1.normalized && n0.count === P.count && n1.count === P.count,
    '面法線的數量與頂點對得上，而且是正規化的 int8', `${n0.count}`);
  const CREASE = Math.cos((24 * Math.PI) / 180);
  let badLen = 0, tooFlat = 0, split = 0;
  const v = (at, i) => [at.getX(i), at.getY(i), at.getZ(i)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let i = 0; i < n0.count; i++) {
    const a = v(n0, i), b = v(n1, i);
    if (Math.abs(Math.hypot(...a) - 1) > 0.02 || Math.abs(Math.hypot(...b) - 1) > 0.02) badLen++;
    /* 兩面夾角小於 24° 的邊不該進來——那是同一片平面上的對角線，永遠
       不會是輪廓，留著只是替每個四邊形多畫一條。 */
    if (dot(a, b) > CREASE + 0.02) tooFlat++;
    /* 比的是量化前後都不會動的那三個位元組本身，不是內積——量化後的
       單位向量自己跟自己的內積也只有 0.99 上下。 */
    if (i % 2 === 1) {
      for (let k = 0; k < 3; k++) {
        if (n0.array[i * 3 + k] !== n0.array[(i - 1) * 3 + k]
          || n1.array[i * 3 + k] !== n1.array[(i - 1) * 3 + k]) { split++; break; }
      }
    }
  }
  ok(badLen === 0, '量化之後的面法線還是單位長', `${badLen} / ${n0.count}`);
  ok(tooFlat === 0, '沒有太平的邊混進來（那些是四邊形的對角線）', `${tooFlat}`);
  ok(split === 0, '一條線的兩端帶的是同一組法線', `${split}`);
}

head('五階調與輪廓判定接上了');
/* node 編不了 GLSL，但這兩段是用字串替換接上 three 的著色器的，而字串
   沒配到不會報錯——只會靜靜地畫出一片平光的地形，或是把每一道轉折又
   全部描上。所以接得上沒有，這裡查。 */
{
  const sh = () => ({
    uniforms: {},
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  });

  const band = sh();
  toonVC().onBeforeCompile(band, null);
  ok(!!band.uniforms.uBand && band.uniforms.uBand.value.length === 15,
    '五階的顏色攤平成 vec3[5]', `${band.uniforms.uBand ? band.uniforms.uBand.value.length : 0} 個數字`);
  ok(BAND_EDGE.length === 4 && BAND_KEY.length === 5, '五階四界');
  ok(BAND_EDGE.every((e, i) => i === 0 || e < BAND_EDGE[i - 1]), '邊界由亮到暗遞減');
  ok(BAND_EDGE[3] < 0, '最後一道界落在明暗交界線下面（背光側是一塊平的）',
    `${BAND_EDGE[3]}`);
  const mixes = (band.fragmentShader.match(/cpTone = mix\(/g) || []).length;
  ok(mixes === BAND_EDGE.length, '每一道界都插進片段著色器了', `${mixes} 道`);
  ok(band.fragmentShader.includes('fwidth(cpD)'), '交界的寬度是螢幕空間導數算的');
  ok(band.vertexShader.includes('vBandN = mat3(modelMatrix) * normal;'),
    '世界空間的法線送得到片段著色器');
  ok(!band.fragmentShader.includes('gradientMap'), '沒有留下梯度圖那條舊路');

  /* 五階要讀得出五階：亮度嚴格遞減，而且最暗的那一階不是死黑——它是
     一整片背光的牆，掉到零就沒有東西可看了。 */
  const T = band.uniforms.uBand.value;
  const lum = (i) => 0.2126 * T[i * 3] + 0.7152 * T[i * 3 + 1] + 0.0722 * T[i * 3 + 2];
  let mono = true;
  for (let i = 1; i < 5; i++) if (!(lum(i) < lum(i - 1) * 0.95)) mono = false;
  ok(mono, '五階的亮度一階比一階暗，而且階差看得出來',
    [0, 1, 2, 3, 4].map((i) => lum(i).toFixed(3)).join(' > '));
  ok(lum(4) / lum(0) > 0.25, '最暗那一階不是死黑', `${(lum(4) / lum(0)).toFixed(2)} × 最亮`);

  const ink = sh();
  inkLine().onBeforeCompile(ink, null);
  ok(ink.vertexShader.includes('attribute vec3 aN0;') && ink.vertexShader.includes('attribute vec3 aN1;'),
    '墨線讀得到兩側的面法線');
  ok(ink.vertexShader.includes('cameraPosition'), '視線是從表面指向鏡頭算的（透視）');
  ok(/vSil\.x \* vSil\.y > 0\.0\) discard/.test(ink.fragmentShader),
    '兩側同號的邊（內部轉折）會被丟掉');
}

head('每塊石頭底下有東西頂著');
/* 「一堆碎料浮在空中而不是一棟建築」是看得出來的，但看不出來有幾塊、
   在哪裡——所以掃。每一塊 add 進來的幾何，底下 6 cm 內必須有東西托著；
   拱的楔石、旗、鏈、獸像、絞盤是掛著的，它們用 `hang` 標記，白名單靠
   旗標而不是靠人記得。

   這一項抓到過的東西：城牆的女牆一塊磚都沒砌（`wall()` 拿絕對 y 去比
   相對高度，所以任何 y > 0 的牆整段消失），於是九個垛口浮在 4.26 公尺
   上；斷塔頂那圈磚寫死在 5.6，而塔身被 ruin 吃得更低。 */
{
  const P = R.parts;
  const CELL = 2, grid = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const b of P) {
    for (let i = Math.floor(b.min[0] / CELL); i <= Math.floor(b.max[0] / CELL); i++) {
      for (let j = Math.floor(b.min[2] / CELL); j <= Math.floor(b.max[2] / CELL); j++) {
        const k = key(i, j);
        let a = grid.get(k); if (!a) grid.set(k, a = []);
        a.push(b);
      }
    }
  }
  const T = 0.06;
  /* 「托著」= 對方跨過我的底面（從下面頂上來，或者我整塊嵌在它裡面），
     而且水平投影有重疊。不是只認「剛好貼著」：石板是壓進基座裡的、磚是
     砌歪的、苔是長在石頭頂面上陷進去一點的。

     反過來，浮在牆頂上方的垛口不會被誤判成托著——那時候牆的頂面在垛口
     的底面**以下**，跨不過去。 */
  const holds = (a, o) => o !== a
    && o.min[1] < a.min[1] + 0.02 && o.max[1] > a.min[1] - T
    && a.min[0] - 0.02 < o.max[0] && a.max[0] + 0.02 > o.min[0]
    && a.min[2] - 0.02 < o.max[2] && a.max[2] + 0.02 > o.min[2];
  const vol = (b) => (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);

  let floats = [], hangs = 0, onGround = 0;
  for (const b of P) {
    if (b.hang) { hangs++; continue; }
    if (b.min[1] <= 0.05) { onGround++; continue; }
    let ok2 = false;
    for (let i = Math.floor((b.min[0] - T) / CELL); i <= Math.floor((b.max[0] + T) / CELL) && !ok2; i++) {
      for (let j = Math.floor((b.min[2] - T) / CELL); j <= Math.floor((b.max[2] + T) / CELL) && !ok2; j++) {
        const a = grid.get(key(i, j));
        if (a) for (const o of a) if (holds(b, o)) { ok2 = true; break; }
      }
    }
    if (!ok2) floats.push(b);
  }
  console.log(`  ${P.length} 塊幾何：坐在地上 ${onGround}、掛著的 ${hangs}、`
    + `其餘 ${P.length - onGround - hangs} 塊要有東西托著`);
  floats.sort((a, b) => vol(b) - vol(a));
  const worst = floats.slice(0, 3).map((b) =>
    `${vol(b).toFixed(2)}m³ @ ${((b.min[0] + b.max[0]) / 2).toFixed(1)},`
    + `${b.min[1].toFixed(1)},${((b.min[2] + b.max[2]) / 2).toFixed(1)}`).join('  ');
  ok(floats.length === 0, '沒有一塊石頭浮在空中', floats.length ? `${floats.length} 塊：${worst}` : `${P.length} 塊都站得住`);
}

head('旗面沒有被砌體戳穿');
/* 布是掛著的（hang），所以「底下有沒有東西頂著」那一項管不到它；而它跟
   牆之間差幾公分，站遠一點看不出來，走近了就是幾塊磚從布裡戳出來。所以
   逐塊量：每一片布（`tag: 'cloth'`）的外接盒，跟任何一塊不是掛件的幾何
   重疊超過 2 公分就算。布面有波浪、牆面有突出的丁磚，兩個加起來就是
   `banner()` 的 WALL_CLEAR 在防的那件事。 */
{
  const cloth = R.parts.filter((q) => q.tag === 'cloth');
  const solid = R.parts.filter((q) => !q.hang && q.tag !== 'cloth');
  const E = 0.02;
  let hit = 0, at = null;
  for (const c of cloth) {
    for (const q of solid) {
      if (Math.min(c.max[0], q.max[0]) - Math.max(c.min[0], q.min[0]) > E
        && Math.min(c.max[1], q.max[1]) - Math.max(c.min[1], q.min[1]) > E
        && Math.min(c.max[2], q.max[2]) - Math.max(c.min[2], q.min[2]) > E) {
        hit++;
        at = at || [(c.min[0] + c.max[0]) / 2, (c.min[2] + c.max[2]) / 2];
        break;
      }
    }
  }
  ok(cloth.length > 0, '旗有登記成布', `${cloth.length} 片`);
  ok(hit === 0, '沒有一片布被砌體戳穿', hit ? `${hit} 片，例如 @ ${at[0].toFixed(1)},${at[1].toFixed(1)}` : '');
}

head('牆身之內不透光');
/* 牆只有一塊磚厚，而磚縫 2 cm、砌歪 ±2 cm——所以那些縫是穿透的。牆芯
   （比外皮薄的一片實心牆，貼在中間）就是為這件事存在的，而「牆芯有沒有
   漏掉一段」看不出來：從外面看，一道有芯的牆和一道沒有芯的牆一模一樣，
   只有站在裡面、光從另一邊來的時候才看得到一排亮縫。

   所以驗的是牆芯覆蓋到的高度以下，中線上每一格都是實心的；以及牆頂
   露出來的那一段單層外皮不超過兩皮。 */
{
  const P = R.parts;
  const CELL = 2, grid = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const b of P) {
    for (let i = Math.floor(b.min[0] / CELL); i <= Math.floor(b.max[0] / CELL); i++) {
      for (let j = Math.floor(b.min[2] / CELL); j <= Math.floor(b.max[2] / CELL); j++) {
        const k = key(i, j);
        let a = grid.get(k); if (!a) grid.set(k, a = []);
        a.push(b);
      }
    }
  }
  const solidAt = (x, y, z) => {
    const a = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!a) return false;
    for (const b of a) {
      if (b.min[0] <= x && b.max[0] >= x && b.min[1] <= y && b.max[1] >= y
        && b.min[2] <= z && b.max[2] >= z) return true;
    }
    return false;
  };
  let leaks = 0, cells = 0, thinMax = 0;
  for (const w of R.walls) {
    const dx = w.to[0] - w.from[0], dz = w.to[1] - w.from[1];
    const len = Math.hypot(dx, dz);
    for (let u = 0.02; u <= 0.98; u += Math.min(0.1, 0.1 / Math.max(len, 0.1)) * Math.max(len, 0.1) / len) {
      const x = w.from[0] + dx * u, z = w.from[1] + dz * u;
      const core = w.coreAt(u), surf = w.surfaceAt(u);
      if (surf > w.y0 + w.course * 0.5) thinMax = Math.max(thinMax, (surf - core) / w.course);
      for (let y = w.y0 + 0.06; y < core - 0.02; y += 0.1) {
        cells++;
        if (!solidAt(x, y, z)) leaks++;
      }
    }
  }
  ok(leaks === 0, '牆芯覆蓋到的高度以下沒有一格是透的', `${leaks}/${cells} 格`);
  ok(thinMax <= 2.5, '牆頂露出的單層外皮不超過兩皮半', `最多 ${thinMax.toFixed(1)} 皮`);
}

head('鋪面底下有基座');
/* 石板是會缺的（那是遺跡），缺掉的地方看到的必須是底下的填層，不是一個
   洞。露台那一片尤其重要：台體只砌了四周的牆，中間是中空的，所以以前
   缺掉的那 11 塊石板是看穿到 3.2 公尺底下的真洞。 */
{
  const P = R.parts;
  let miss = 0, n = 0;
  for (const f of R.floors) {
    for (let x = -f.w / 2; x <= f.w / 2; x += 0.5) {
      for (let z = -f.d / 2; z <= f.d / 2; z += 0.5) {
        if (f.round && Math.hypot(x, z) > f.round - 0.5) continue;
        const wx = f.x + x, wz = f.z + z, wy = f.y - 0.2;
        n++;
        let hit = false;
        for (const b of P) {
          if (b.min[0] <= wx && b.max[0] >= wx && b.min[1] <= wy && b.max[1] >= wy
            && b.min[2] <= wz && b.max[2] >= wz) { hit = true; break; }
        }
        if (!hit) miss++;
      }
    }
  }
  ok(miss === 0, '每一片鋪面底下都是實心的', `${miss}/${n} 格是空的`);
}

head('碰撞盒都有分類，而且高度合法');
/* 視覺的凹凸不准傳到腳底下——這條規則要有東西執行它，不然它只是一句話。
   每個盒子都必須說自己是哪一種，而每一種有自己的高度規矩：

     'block'  頂面至少高過 BLOCK_TOP（1.0）。低於這個的障礙物是「看起來
              該站得上去、跳上去又只有半公尺」的東西，而房間裡跑起來
              最不該有的就是那個。
     'floor'  頂面不准落在會絆腳的那一段（0.08～0.36）。
     'step'   階梯的一級。只有它可以，因為踩上去是預期的；級高不准超過
              抬腳的高度，不然那道樓梯要跳。
*/
{
  const bad = { kind: [], block: [], floor: [], step: [] };
  for (const c of R.colliders) {
    const top = c.max[1];
    if (!c.kind) { bad.kind.push(c); continue; }
    if (c.kind === 'block' && top - c.base < BLOCK_TOP - 1e-6) bad.block.push(c);
    if ((c.kind === 'floor' || c.kind === 'shell') && top > TRIP[0] && top < TRIP[1] - 1e-9) bad.floor.push(c);
  }
  const by = {};
  for (const c of R.colliders) by[c.kind || '?'] = (by[c.kind || '?'] || 0) + 1;
  console.log(`  ${R.colliders.length} 個盒子：`
    + Object.entries(by).map(([k, v]) => `${k} ${v}`).join('、'));
  ok(bad.kind.length === 0, '每個盒子都說得出自己是哪一種', `${bad.kind.length} 個沒說`);
  ok(bad.block.length === 0, `障礙物的頂面都高過 ${BLOCK_TOP} m`,
    bad.block.length ? bad.block.slice(0, 3).map((c) => `${(c.max[1] - c.base).toFixed(2)}m @ ${c.min[0].toFixed(0)},${c.min[2].toFixed(0)}`).join(' / ') : '');
  ok(bad.floor.length === 0, `沒有頂面落在會絆腳那一段（${TRIP[0]}～${TRIP[1]}）的地板`,
    bad.floor.length ? `${bad.floor.length} 個` : '');
  /* 跳高是 1.5 個狗高（MOUNT 1.74），頂面在那以下的東西本來就跳得上去
     ——障礙物、殘牆、台座都是。「除了階梯沒有踩得上去的東西」是舊跳高
     （MOUNT 0.84）底下的規則，現在它不成立也不該成立，這裡只列數量。 */
  {
    const up = {};
    for (const c of R.colliders) {
      if (c.kind !== 'step' && c.max[1] > TRIP[0] && c.max[1] <= MOUNT) up[c.kind] = (up[c.kind] || 0) + 1;
    }
    console.log(`  · 跳得上去的東西（頂面 ${TRIP[0]}～${MOUNT.toFixed(2)}）：`
      + (Object.entries(up).map(([k, v]) => `${k} ${v}`).join('、') || '無'));
  }
  // 階梯：級高不准超過抬腳的高度。
  const steps = R.colliders.filter((c) => c.kind === 'step').map((c) => c.max[1]).sort((a, b) => a - b);
  let jump = 0;
  for (let i = 1; i < steps.length; i++) {
    const d = steps[i] - steps[i - 1];
    if (d > PHYS.step + 1e-6 && d < 2) jump++;      // 2 m 以上是「另一道樓梯」
  }
  ok(jump === 0, '每一道樓梯的級高都在抬腳的高度以內', jump ? `${jump} 級超過 ${PHYS.step}` : `${steps.length} 級`);
}

head('圓的東西是圓的');
/* 兩件事：圓柱帶著的外接盒真的是外接盒（吃盒子的那些檢查——分類、支撐、
   相機——都靠它保守得住），以及繞著它走一圈，被推出來的每一個點到軸的
   距離都一樣。後面那一項單獨拿一根圓柱去推，不是拿整張清單：一根柱子
   腳下還有一塊方的台基，而那是它本來就該有的形狀。 */
{
  const round = R.colliders.filter((c) => c.shape === 'circle' && c.kind !== 'bound');
  ok(round.length > 0, '有圓柱登記', `${round.length} 根`);

  let badR = 0, badBox = 0;
  for (const c of round) {
    if (!(c.r > 0)) { badR++; continue; }
    const e = Math.max(
      Math.abs(c.min[0] - (c.x - c.r)), Math.abs(c.max[0] - (c.x + c.r)),
      Math.abs(c.min[2] - (c.z - c.r)), Math.abs(c.max[2] - (c.z + c.r)),
    );
    if (e > 1e-9) badBox++;
  }
  ok(badR === 0, '每根圓柱都有半徑', `${badR} 根沒有`);
  ok(badBox === 0, '外接盒就是外接盒', `${badBox} 根對不上`);

  /* 推出來的那一圈。誤差用「同一根柱子上最遠與最近的差」來量——那正好
     是方盒的角會造成的東西（一個方盒的差是 41%），圓的話是 0。 */
  let worstSpread = 0, worstAt = '', offAxis = 0;
  for (const c of round) {
    const feet = c.base;
    if (c.max[1] <= feet + PHYS.step) continue;      // 踩得上去的東西不推
    let lo = Infinity, hi = -Infinity;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 64) {
      const x = c.x + Math.cos(a) * c.r * 0.5, z = c.z + Math.sin(a) * c.r * 0.5;
      const [px, pz] = solveXZ([c], x, z, feet);
      const d = Math.hypot(px - c.x, pz - c.z);
      lo = Math.min(lo, d); hi = Math.max(hi, d);
      // 推出的方向必須是半徑：推出來的點、軸、原來的點三個共線。
      const cross = Math.abs(Math.cos(a) * (pz - c.z) - Math.sin(a) * (px - c.x));
      if (cross > 1e-9) offAxis++;
    }
    if (hi - lo > worstSpread) {
      worstSpread = hi - lo;
      worstAt = `r=${c.r.toFixed(2)} @ ${c.x.toFixed(1)},${c.z.toFixed(1)}`;
    }
    const want = c.r + PHYS.radius;
    if (Math.abs(hi - want) > 1e-9 || Math.abs(lo - want) > 1e-9) {
      worstSpread = Math.max(worstSpread, Math.abs(hi - want), Math.abs(lo - want));
      worstAt = `推到 ${lo.toFixed(3)}～${hi.toFixed(3)}、該是 ${want.toFixed(3)}`;
    }
  }
  ok(worstSpread < 1e-6, '繞著圓柱走是一個圓，不是一個方框',
    worstSpread > 1e-6 ? `差 ${worstSpread.toFixed(3)} m（${worstAt}）` : `${round.length} 根`);
  ok(offAxis === 0, '推出的方向是半徑', `${offAxis} 次歪掉`);
}

head('圓頂上站不住');
/* 滑的規則（slideDrift／slideAccel）跟頁面讀的是同一份，這裡只是照
   main.js 那一套把它積起來——不給任何輸入，因為驗的正是「不操作會
   怎樣」。 */
{
  const CS = R.colliders;
  const domes = CS.filter((c) => c.shape === 'circle' && c.dome > 0);
  const flat = CS.filter((c) => c.shape === 'circle' && !c.dome);
  const falls = domes.filter((c) => c.slip === 'fall');
  console.log(`  ${domes.length} 個圓頂（${falls.length} 個不可踩）、${flat.length} 根平頂圓柱`);

  ok(domes.length > 0 && falls.length > 0, '圓頂與不可踩的圓頂都有登記');
  ok(domes.every((c) => c.slip === 'slide' || c.slip === 'fall'),
    '每個圓頂都說得出怎麼滑', `${domes.filter((c) => !c.slip).length} 個沒說`);
  ok(flat.every((c) => !c.slip), '平頂的圓柱沒有滑法——它就是站得住的');

  /* 表面接得上：裙邊那一圈就是柱身的頂面，正上方就是它的頂點。接不上
     的話，圓頂與柱身之間會有一道看不見的階，人會卡在上面。 */
  let gap = 0;
  for (const c of domes) {
    gap = Math.max(gap, Math.abs(roundTop(c, c.r) - c.cap), Math.abs(roundTop(c, 0) - c.max[1]));
  }
  ok(gap < 1e-9, '圓頂接在柱身上，中間沒有一道階', `差 ${gap.toExponential(1)}`);

  /* 頂端那一小塊：'slide' 的正頂站得住（不然跳上大石只會被彈開），
     'fall' 的正頂站不住（不可踩的東西沒有安全的一點）。 */
  const slides = domes.filter((c) => c.slip === 'slide');
  /* 問的是「站在它正上方，腳下是它的話，站不站得住」。腳下不是它的那些
     不算——一顆石頭的頂可能被旁邊更高的一顆蓋住，那時候腳踩的是那一顆，
     而那是場上真的會發生的事，不是這條規則壞了。 */
  const apex = (c) => {
    const s = supportInfo(CS, c.x, c.z, c.max[1] + 0.1);
    return s.on === c ? s.slip : 'other';
  };
  const badSlide = slides.filter((c) => apex(c) !== null && apex(c) !== 'other');
  const badFall = falls.filter((c) => apex(c) === null);
  ok(badSlide.length === 0, '可操作的圓頂，正頂上站得住',
    `${slides.length - badSlide.length} / ${slides.length} 個`);
  ok(badFall.length === 0, '不可踩的圓頂，正頂上也站不住',
    `${badFall.length} 個站得住`);

  /** 放手，照 main.js 那一套滾。回報什麼時候離開 `c`、最快滑多快。 */
  const sim = (c, d0, seconds = 6) => {
    const dt = 1 / 60;
    const x0 = c.x + d0, z0 = c.z;
    const p = {
      x: x0, y: roundTop(c, Math.abs(d0)), z: z0,
      vx: 0, vy: 0, vz: 0, grounded: true, slip: null, sin: 0, dx: 0, dz: 0,
    };
    const first = supportInfo(CS, p.x, p.z, p.y + 0.1);
    if (first.on !== c) return null;                 // 起點根本不在它頭上
    p.slip = first.slip; p.sin = first.sin; p.dx = first.dx; p.dz = first.dz;
    let peak = 0, locked = 0;
    for (let t = 0; t < seconds; t += dt) {
      const [ax, az] = p.grounded ? slideAccel(p) : [0, 0];
      p.vx += ax * dt; p.vz += az * dt;
      const [gx, gz] = p.grounded ? slideDrift(p) : [0, 0];
      const mvx = p.vx + gx, mvz = p.vz + gz;
      peak = Math.max(peak, Math.hypot(mvx, mvz));
      if (p.grounded && p.slip === 'fall') locked++;
      const nx = p.x + mvx * dt, nz = p.z + mvz * dt;
      const [sx, sz] = solveXZ(CS, nx, nz, p.y);
      if (Math.abs(sx - nx) > 1e-4) p.vx = 0;
      if (Math.abs(sz - nz) > 1e-4) p.vz = 0;
      p.x = sx; p.z = sz;
      const prevY = p.y;
      p.vy -= PHYS.gravity * dt;
      p.y += p.vy * dt;
      const sup = supportInfo(CS, p.x, p.z, prevY);
      if (p.y <= sup.y && p.vy <= 0) {
        p.y = sup.y; p.vy = 0; p.grounded = true;
        p.slip = sup.slip; p.sin = sup.sin; p.dx = sup.dx; p.dz = sup.dz;
      } else { p.grounded = false; p.slip = null; }
      if (sup.on !== c) return { off: t, peak, locked, at: [p.x, p.y, p.z] };
      if (p.y < -4) return { off: t, peak, locked, at: [p.x, p.y, p.z] };
    }
    return { off: null, peak, locked, at: [p.x, p.y, p.z] };
  };

  // 不可踩：站上正頂，兩秒內一定被丟下來，而且整段都是鎖著的。
  {
    let tried = 0, stuck = [], slow = 0, worst = 0;
    for (const c of falls) {
      const s = sim(c, 0, 3);
      if (!s) continue;
      tried++;
      if (s.off === null) { stuck.push(c); continue; }
      if (s.locked === 0) slow++;
      worst = Math.max(worst, s.off);
    }
    ok(tried > 0, '試得到不可踩的圓頂', `${tried} / ${falls.length} 個`);
    ok(stuck.length === 0, '踩上不可踩的圓頂，站不住',
      stuck.length ? `${stuck.length} 個站得住` : `最久 ${worst.toFixed(2)} 秒就滑掉`);
    ok(slow === 0, '滑的那段是鎖著的（操作不回來）', `${slow} 個沒鎖`);
  }

  // 可操作：緩滑。速度不准超過終端速度——超過就不是抓牆，是摔下去。
  {
    let tried = 0, fast = 0, stuck = 0, peak = 0, worst = 0;
    for (const c of slides) {
      const s = sim(c, c.r * 0.6, 6);
      if (!s) continue;
      tried++;
      peak = Math.max(peak, s.peak);
      if (s.peak > SLIDE.max + 1e-6) fast++;
      if (s.off === null) stuck++;
      else worst = Math.max(worst, s.off);
      if (s.locked) fast++;                    // 緩滑不准鎖住操作
    }
    ok(tried > 0, '試得到可操作的圓頂', `${tried} / ${slides.length} 個`);
    ok(stuck === 0, '不跳的話，緩滑會一路滑下來', stuck ? `${stuck} 個滑不動` : `最久 ${worst.toFixed(2)} 秒`);
    ok(fast === 0, `緩滑不超過終端速度 ${SLIDE.max} m/s`, `最快 ${peak.toFixed(2)} m/s`);
  }

  /* 兩種滑法真的不一樣：同一個圓頂，'fall' 掉得比 'slide' 快。差別因此
     不是一個只寫在註解裡的字。 */
  {
    const c = falls.find((q) => sim(q, 0, 3)?.off != null);
    let fastT = null, slowT = null;
    if (c) {
      fastT = sim(c, c.r * 0.5, 6)?.off;
      c.slip = 'slide';
      slowT = sim(c, c.r * 0.5, 6)?.off;
      c.slip = 'fall';
    }
    ok(fastT != null && slowT != null && fastT < slowT, '同一個圓頂，滑落比緩滑快',
      fastT == null ? '沒試到' : `${fastT.toFixed(2)} 秒 vs ${slowT?.toFixed(2)} 秒`);
  }
}

head('每個區塊的中心是空的');
const COLS = R.colliders;
for (const b of BLOCKS) {
  const c = CENTERS[b.id];
  const [ox, oz] = b.origin;
  let holes = 0, walls = 0, worst = 0;
  const step = 0.5;
  for (let x = -c.hx; x <= c.hx + 1e-6; x += step) {
    for (let z = -c.hz; z <= c.hz + 1e-6; z += step) {
      const wx = ox + x, wz = oz + z;
      const sup = supportAt(COLS, wx, wz, c.y + 0.1);
      if (Math.abs(sup - c.y) > 0.06) { holes++; worst = Math.max(worst, Math.abs(sup - c.y)); }
      const [px, pz] = solveXZ(COLS, wx, wz, c.y);
      if (Math.hypot(px - wx, pz - wz) > 1e-6) walls++;
    }
  }
  const n = Math.round((2 * c.hx / step + 1) * (2 * c.hz / step + 1));
  ok(holes === 0, `${b.name}：${(c.hx * 2).toFixed(0)}×${(c.hz * 2).toFixed(0)} 全是平的`,
    holes ? `${holes}/${n} 格高度不符，最差 ${worst.toFixed(2)} m` : `${n} 格`);
  ok(walls === 0, `${b.name}：空地裡沒有擋路的東西`, walls ? `${walls}/${n} 格被推開` : '');
}

head('從出生點走到中心');
/* 用真的物理走一遍。每一步朝著目標走，撞到東西就沿著推出來的方向繼續
   ——這跟 tools/verify-level.mjs 那隻 bot 的想法一樣：關卡過不過得去，
   只有跑過才知道。 */
function walkTo(from, target, seconds = 26) {
  const dt = 1 / 60;
  const p = { x: from[0], y: from[1] + 0.2, z: from[2], vy: 0 };
  let best = Infinity;
  for (let t = 0; t < seconds; t += dt) {
    const dx = target[0] - p.x, dz = target[2] - p.z;
    const d = Math.hypot(dx, dz);
    best = Math.min(best, d);
    if (d < 0.9) return { arrived: true, best, t, at: [p.x, p.y, p.z] };
    const sp = PHYS.walk;
    const nx = p.x + (dx / d) * sp * dt;
    const nz = p.z + (dz / d) * sp * dt;
    const [sx, sz] = solveXZ(COLS, nx, nz, p.y);
    p.x = sx; p.z = sz;
    const prevY = p.y;
    p.vy -= PHYS.gravity * dt;
    p.y += p.vy * dt;
    const sup = supportAt(COLS, p.x, p.z, prevY);
    if (p.y <= sup && p.vy <= 0) { p.y = sup; p.vy = 0; }
    if (p.y < -4) return { arrived: false, best, t, fell: true };
  }
  return { arrived: false, best, t: seconds, at: [p.x, p.y, p.z] };
}
for (const b of BLOCKS) {
  const c = CENTERS[b.id];
  const [ox, oz] = b.origin;
  const spawn = R.spawns[b.id];
  const sup = supportAt(COLS, spawn[0], spawn[2], spawn[1] + 0.4);
  ok(Math.abs(sup - spawn[1]) < 0.5, `${b.name}：出生點站得住`, `支撐 ${sup.toFixed(2)} / 期望 ${spawn[1].toFixed(2)}`);
  const [px, pz] = solveXZ(COLS, spawn[0], spawn[2], spawn[1]);
  ok(Math.hypot(px - spawn[0], pz - spawn[2]) < 1e-6, `${b.name}：出生點不在牆裡`);
  const route = [...(c.via || []).map(([vx, vz]) => [ox + vx, 0, oz + vz]), [ox, c.y, oz]];
  let from = spawn, arrived = true, secs = 0, worst = null;
  for (const leg of route) {
    const res = walkTo(from, leg);
    secs += res.t;
    if (!res.arrived) { arrived = false; worst = res; break; }
    // 下一段從「真的走到的地方」接下去，不是從轉折點的 y = 0 接：
    // 上到一半的樓梯上，y = 0 是石階的內部。
    from = res.at;
  }
  ok(arrived, `${b.name}：走得到中心`,
    arrived ? `${secs.toFixed(1)} 秒${c.via ? `（經 ${c.via.length} 個轉折）` : ''}`
      : `最近只到 ${worst.best.toFixed(1)} m${worst.fell ? '（掉下去了）' : ''}`);
}

head('門洞進得去也回得來');
/* 以前這一項驗的是「從中心走得出去」。現在室內那三個房間的黑牆貼在牆面
   上，門洞後面就是黑牆——走不出去是設計，不是 bug。

   所以改驗一件仍然會壞、而且看不出來的事：**進得去也回得來**。拱洞後面
   剩下的那條縫只有幾十公分寬，而身體的半徑是 0.30；碰撞是逐盒推出的，
   兩個方向相反的推力（拱的墩柱與黑牆）有可能把身體夾在中間推來推去，
   那時候畫面上什麼都沒發生，人就是走不動了。城牆平台照舊要驗那條真的
   路：露台 → 兩折樓梯 → 牆外那一圈。 */
/* 每個房間的一個門洞，以及走到它那裡的轉折點。轉折點是必要的：驗證用的
   走法是朝目標直線走，而直線穿過拱廊的墩柱是走不過去的——真人也不會
   那樣走。中庭與水窖的座標都落在拱洞的正中間（拱廊的洞口每 4.05 公尺
   一個、環牆的門在每一段的中點 11.25°），不是隨手挑的。 */
const HOLES = {
  courtyard: [[-12.6, 0], [-13.4, 0]],
  rampart: [[4.2, -5.5], [4.2, -9.5], [4.2, -14], [4.2, -19]],
  throne: [[0, -13.4], [0, -14.6]],
  cistern: [[11.6, 2.3], [12.9, 2.6]],
  // 城牆步道沒有門洞通到外面——走道本身就是整個場地。驗的是走進東塔的塔頂再回來。
  wallwalk: [[12, 2.4], [12, 5.8]],
  // 缺口那一座的門洞就是西段走道本身（缺口要跳，這裡的走法不跳）。
  breach: [[-8, 0], [-12, 0]],
  // 墓室：走上南端那道樓梯，到鐵閘前的平台。
  crypt: [[0, -8.0], [0, -13.0]],
  // 窄巷：走出巷口，進廣場、繞到井的東邊。
  alley: [[0, 5], [3.6, 9.0]],
};
for (const b of BLOCKS) {
  const c = CENTERS[b.id];
  const [ox, oz] = b.origin;
  const legs = HOLES[b.id];
  let from = [ox, c.y, oz], went = true, worst = null;
  for (const [vx, vz] of legs) {
    const res = walkTo(from, [ox + vx, 0, oz + vz]);
    if (!res.arrived) { went = false; worst = res; break; }
    from = res.at;
  }
  ok(went, `${b.name}：走到門洞裡`, went ? '' : `卡在還差 ${worst.best.toFixed(1)} m 的地方`);
  if (!went) continue;
  // 回頭走同一條路（不是直線切回中心——那會撞到自己剛剛繞過的牆）。
  const back = [...legs].reverse().slice(1).map(([vx, vz]) => [ox + vx, 0, oz + vz]);
  back.push([ox, c.y, oz]);
  let ret = true, rworst = null, secs = 0;
  for (const leg of back) {
    const res = walkTo(from, leg, 40);
    secs += res.t;
    if (!res.arrived) { ret = false; rworst = res; break; }
    from = res.at;
  }
  ok(ret, `${b.name}：從門洞走得回來`,
    ret ? `${secs.toFixed(1)} 秒` : `卡在還差 ${rworst.best.toFixed(1)} m 的地方（被夾住了）`);
}

head('整片走一遍：沒有鑽得進去的空心，也沒有回不來的地方');
/* 上面兩項走的都是「給定的一條路」。這一項把走得到的地方全部淹一遍——
   每 0.2 公尺一格，走（抬腳 STEP 以內、往下不限）與跳（頂點 APEX、頭頂
   要有淨空）兩種移動，用的是同一支 solveXZ／supportAt。然後問兩件事：

     空心     走得到的格子，頭頂 3 公尺內不准有砌體蓋著。蓋著的意思是
              人鑽進了一個東西的底下——城牆平台的台體以前是空的，從樓梯
              旁的矮牆跳進第二折樓梯底下、穿過南牆缺口，整座露台的正下方
              都走得到，而畫面上看不出來，除非你真的走進去。底下本來就
              該是空的東西（水窖的懸臂石階）在碰撞盒上標 `open`，不算。
     回不來   每一個走得到的格子都要走得回出生點。水窖以前可以從殘階頂
              跳上環牆、往外掉進牆與黑牆之間那條縫，掉進去就只剩重生。

   碰撞盒先照場地的外接框篩一次：四個場地相隔六十公尺，全掃的話九成
   的時間花在問另外三個場地的盒子。 */
{
  const G = 0.2;
  const snap = (v) => Math.round(v * 20) / 20;
  for (const b of BLOCKS) {
    const [ox, oz] = b.origin;
    const A = R.arenas.find((a) => a.id === b.id);
    const x0 = A.shape === 'circle' ? A.x - A.r : A.x0, x1 = A.shape === 'circle' ? A.x + A.r : A.x1;
    const z0 = A.shape === 'circle' ? A.z - A.r : A.z0, z1 = A.shape === 'circle' ? A.z + A.r : A.z1;
    const cols = COLS.filter((c) => (c.kind === 'bound' ? c.id === b.id
      : c.max[0] > x0 - 2 && c.min[0] < x1 + 2 && c.max[2] > z0 - 2 && c.min[2] < z1 + 2));
    /** 頭頂上最低的那個碰撞體（底面在頭以上的那些裡面）：底面多高、底下是不是故意空著的。 */
    const overhead = (x, z, y) => {
      let lo = Infinity, open = false;
      for (const c of cols) {
        if (c.kind === 'bound' || c.kind === 'pit' || c.min[1] < y + PHYS.height - 0.02) continue;
        const inside = c.shape === 'circle' ? Math.hypot(x - c.x, z - c.z) < c.r
          : x > c.min[0] && x < c.max[0] && z > c.min[2] && z < c.max[2];
        if (inside && c.min[1] < lo) { lo = c.min[1]; open = !!c.open; }
      }
      return { lo, open };
    };
    const moves = (nx, nz, y) => {
      const [sx, sz] = solveXZ(cols, nx, nz, y);
      return Math.hypot(sx - nx, sz - nz) <= 0.03;
    };
    const sp = R.spawns[b.id];
    const key = (i, k, y) => `${i},${k},${y}`;
    const i0 = Math.round(sp[0] / G), k0 = Math.round(sp[2] / G);
    const s0 = key(i0, k0, snap(supportAt(cols, i0 * G, k0 * G, sp[1] + 0.2)));
    const from = new Map([[s0, []]]);   // 格子 → 走得到它的那些格子
    const queue = [s0];
    const hollow = [];
    for (let h = 0; h < queue.length; h++) {
      const s = queue[h];
      const [i, k, y] = s.split(',').map(Number);
      const x = i * G, z = k * G;
      /* 懸臂石階（`open`）底下本來就是空的，走進去不算空心；但它仍然是
         天花板，跳的時候照樣要算淨空。 */
      const { lo: lid, open } = overhead(x, z, y);
      if (lid - y < 3 && !open) hollow.push([x - ox, z - oz, y]);
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = (i + di) * G, nz = (k + dk) * G;
        const to = [];
        if (moves(nx, nz, y)) to.push(snap(supportAt(cols, nx, nz, y)));
        /* 跳：起跳、在頂點跨過去、落在那裡的任何高度。落點比原地低也算——
           被圓頂的裙邊與牆夾住的時候，走是被推回來的，跳才出得去。 */
        if (lid > y + APEX + PHYS.height && moves(nx, nz, y + APEX)) {
          to.push(snap(supportAt(cols, nx, nz, y + APEX)));
        }
        for (const ny of to) {
          const t = key(i + di, k + dk, ny);
          if (!from.has(t)) { from.set(t, []); queue.push(t); }
          from.get(t).push(s);
        }
      }
    }
    const back = new Set([s0]);
    const stack = [s0];
    while (stack.length) {
      for (const p of from.get(stack.pop())) if (!back.has(p)) { back.add(p); stack.push(p); }
    }
    /* 掉進坑裡（窄巷那口開著的井）的格子，現在本來就上不來——井底怎麼回去
       是下一步的事。這裡先把它們分出來、印出數量，不算「回不來」。 */
    const pits = cols.filter((c) => c.kind === 'pit');
    const inPit = ([i, k, y]) => pits.some((c) => Math.hypot(i * G - c.x, k * G - c.z) < c.r && y < c.top - 0.5);
    const lost = queue.filter((s) => !back.has(s)).map((s) => s.split(',').map(Number));
    const fell = lost.filter(inPit);
    if (fell.length) console.log(`  · ${b.name}：掉進井裡 ${fell.length} 格（井底還沒有出口）`);
    const stuck = lost.filter((c) => !inPit(c)).map(([i, k, y]) => [i * G - ox, k * G - oz, y]);
    const at = (p) => `(${p[0].toFixed(1)}, ${p[2]}, ${p[1].toFixed(1)})`;
    ok(hollow.length === 0, `${b.name}：沒有鑽得進去的空心`,
      hollow.length ? `${hollow.length} 格，例如 ${at(hollow[0])}` : `${queue.length} 格走得到`);
    ok(stuck.length === 0, `${b.name}：每個走得到的地方都走得回出生點`,
      stuck.length ? `${stuck.length} 格回不來，例如 ${at(stuck[0])}` : '');
    /* 圍著空氣牆的場地：走到哪、跳到哪，腳都不准低於出生的那個面。
       空氣牆漏一段的話，這一項就會找到從那裡跳下去之後的每一格地面。 */
    if (b.fenced) {
      const floorY = typeof b.fenced === 'number' ? b.fenced : sp[1];
      const low = queue.map((s) => s.split(',').map(Number)).filter(([, , y]) => y < floorY - 0.05);
      ok(low.length === 0, `${b.name}：走得到的每一格都在牆頂上`,
        low.length ? `${low.length} 格掉下去了，例如 ${at([low[0][0] * G - ox, low[0][1] * G - oz, low[0][2]])}` : '');
    }
  }
}

head('城牆缺口：衝刺跳得過，走路跳不過');
/* 淹水那一項只問相鄰的格子，跨不過四公尺的缺口，所以這一跳要另外驗：
   用 main.js 同一套的垂直積分（重力、supportInfo 接住），從缺口邊上起跳，
   看落在哪裡。衝刺跳不過就是這一座壞了；走路也跳得過，這一跳就沒有意義。 */
{
  const b = BLOCKS.find((q) => q.id === 'breach');
  const [ox, oz] = b.origin;
  const H = 5.2, G0 = 4.5, G1 = 9.0;
  /* `at` 是起跳時身體中心在哪。腳底的支撐量的是半徑 0.255 的一圈，所以中心
     過了邊緣 0.25 還踩得到——那是最有利的起跳點。 */
  const leap = (speed, at) => {
    const dt = 1 / 120;
    const p = { x: ox + G0 - 2.0, y: H, z: oz, vy: 0, air: false, jumped: false };
    for (let t = 0; t < 4; t += dt) {
      if (!p.jumped && p.x >= ox + at) { p.vy = PHYS.jump; p.jumped = true; }
      const [sx, sz] = solveXZ(COLS, p.x + speed * dt, p.z, p.y);
      p.x = sx; p.z = sz;
      const prevY = p.y;
      p.vy -= PHYS.gravity * dt;
      p.y += p.vy * dt;
      const sup = supportAt(COLS, p.x, p.z, prevY);
      if (p.y <= sup && p.vy <= 0) {
        p.y = sup; p.vy = 0;
        if (p.jumped) return { x: p.x - ox, y: p.y };
      }
    }
    return { x: p.x - ox, y: p.y };
  };
  // 衝刺給一個不利的起跳（提早 0.3），走路給最有利的（邊緣外 0.25）。
  const run = leap(PHYS.run, G0 - 0.3), walk = leap(PHYS.walk, G0 + 0.25);
  ok(run.y > H - 0.05 && run.x > G1, '衝刺起跳（提早 0.3 m）落在對岸的走道上', `落在 x ${run.x.toFixed(1)}、y ${run.y.toFixed(2)}`);
  ok(walk.y < H - 1, '走路起跳（踩到最邊緣）也掉進缺口', `落在 x ${walk.x.toFixed(1)}、y ${walk.y.toFixed(2)}`);
}

head('黑牆就是移動的上限');
/* 黑牆是場地的邊界，而它跟障礙物走**同一套**阻擋邏輯（`walk.js` 的
   solveXZ，只差形狀是方或圓而不是盒子）——所以驗它的方式跟驗一道牆
   一樣：走過去，看有沒有出去。

     1. 走不出去。從出生點朝十六個方向各走三十秒（約九十公尺）。
     2. 停在牆**上**，不是停在牆前面。身體半徑 0.30，所以走到底的時候
        身體表面應該剛好貼著牆面。差得多就是「畫面上的牆」與「走得到的
        地方」不一致，而消掉那個不一致就是這道牆存在的理由。
     3. 黑牆沒有切到任何幾何。切到的話畫面上是一面被削掉一半的牆，而
        牆上那層薄霧淡不掉一個切面。
     4. 貼合。室內那三個房間的黑牆要貼在砌體的外皮上（差 1 公尺以內）；
        城牆平台相反，它要留出至少一公尺的牆外區域。這一項看不出來——
        黑牆離牆面兩公尺或十公尺，站在房間中央看起來一模一樣，只有走到
        牆邊才會發現外面多了一圈到不了的空地。
*/
const vol = (q) => (q.max[0] - q.min[0]) * (q.max[1] - q.min[1]) * (q.max[2] - q.min[2]);
/* 每一塊幾何離「它自己那個場地」的邊界最近的距離（在裡面是正的）。

   量的是真正的頂點，不是 AABB：圓形的鋪面基座是一塊直徑 25 公尺的圓盤，
   它的 AABB 的角比它本身遠 40%，照 AABB 量的話每一片鋪面都會被判成
   戳到牆外面。一塊石頭一次、全圖走一遍頂點緩衝區，幾十毫秒。 */
const PART_GAP = (() => {
  const P = R.geometry.attributes.position.array;
  const out = new Float64Array(R.parts.length);
  for (let k = 0; k < R.parts.length; k++) {
    const q = R.parts[k];
    const end = k + 1 < R.parts.length ? R.parts[k + 1].i0 : P.length;
    const cx = (q.min[0] + q.max[0]) / 2, cz = (q.min[2] + q.max[2]) / 2;
    // 它屬於哪個場地：中心離邊界最裡面的那一個。
    let a = R.arenas[0], bg = -Infinity;
    for (const c of R.arenas) {
      const g = arenaGap(c, cx, cz);
      if (g > bg) { bg = g; a = c; }
    }
    let worst = Infinity;
    for (let i = q.i0; i < end; i += 3) {
      const g = arenaGap(a, P[i], P[i + 2]);
      if (g < worst) worst = g;
    }
    out[k] = worst;
  }
  return out;
})();
for (const a of R.arenas) {
  const blk = BLOCKS.find((b) => b.id === a.id);
  const name = blk.name;
  const spawn = R.spawns[a.id];
  let escaped = 0, tight = Infinity, dropped = 0;
  // 圍著空氣牆的場地可以給一個高度：比它低才算掉下去（城牆缺口的坑底不算）。
  const floorY = typeof blk.fenced === 'number' ? blk.fenced : spawn[1];
  for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * Math.PI * 2;
    const far = 60;
    const res = walkTo(spawn, [spawn[0] + Math.cos(ang) * far, 0, spawn[2] + Math.sin(ang) * far], 30);
    if (!res.at) continue;                       // 掉下去了（另一項在驗）
    const gap = arenaGap(a, res.at[0], res.at[2]);
    if (gap < -1e-3) escaped++;
    if (gap < tight) tight = gap;
    if (res.at[1] < floorY - 0.05) dropped++;
  }
  ok(escaped === 0, `${name}：十六個方向都走不出黑牆`,
    escaped ? `${escaped}/16 出去了` : `${a.shape === 'circle' ? `半徑 ${a.r}` : '方形'} m`);
  /* 圍著空氣牆的場地（城牆步道）走不到黑牆腳下——空氣牆先擋住了。那裡
     要驗的是另一件事：朝哪個方向走到底，腳都還在走道面上，沒有掉下去。 */
  if (blk.fenced) {
    ok(dropped === 0, `${name}：十六個方向走到底都還在牆頂上`,
      dropped ? `${dropped}/16 掉下去了` : `離黑牆最近 ${tight.toFixed(1)} m`);
  } else if (blk.sealed) {
    /* 四面都是牆的房間（墓室）：走到底停在牆上，黑牆在牆外面，本來就
       走不到。走不出去已經在上一項驗過了。 */
    ok(tight > PHYS.radius, `${name}：四面是牆，走到底停在牆上`, `離黑牆最近 ${tight.toFixed(2)} m`);
  } else {
    ok(Math.abs(tight - PHYS.radius) < 0.05, `${name}：走到底就貼在牆面上`,
      `身體離牆面 ${(tight - PHYS.radius).toFixed(3)} m`);
  }

  /* 貼合：黑牆與砌體外皮的距離。只算大於 0.25 m³ 的砌體（牆磚 0.35、
     扶壁的階更大；碎石的磚只有 0.11——碎石是可以夾掉的，牆不行）。 */
  let nearest = Infinity;
  for (let k = 0; k < R.parts.length; k++) {
    const q = R.parts[k];
    if (vol(q) < 0.25 || q.pierce) continue;   // 故意穿過黑牆的那一段不算
    const cx = (q.min[0] + q.max[0]) / 2, cz = (q.min[2] + q.max[2]) / 2;
    if (arenaGap(a, cx, cz) < 0) continue;        // 別的場地的
    if (PART_GAP[k] < nearest) nearest = PART_GAP[k];
  }
  if (a.hug) {
    ok(nearest < 1.0, `${name}：黑牆貼在砌體的外皮上`, `離最近的砌體 ${nearest.toFixed(2)} m`);
  } else {
    ok(nearest > 1.0, `${name}：牆外那一圈留著`, `離最近的砌體 ${nearest.toFixed(2)} m`);
  }
}
{
  /* `pierce` 的幾何是故意穿過去的（城牆步道那段沒入黑霧的幕牆）：切面在
     不透明的黑牆外面，鏡頭出不去，永遠看不到。其餘的一塊都不准切。 */
  let cut = 0, worst = 0, at = null, pierced = 0;
  for (let k = 0; k < R.parts.length; k++) {
    if (PART_GAP[k] >= 0) continue;
    if (R.parts[k].pierce) { pierced++; continue; }
    cut++;
    if (-PART_GAP[k] > worst) {
      worst = -PART_GAP[k];
      const q = R.parts[k];
      at = [(q.min[0] + q.max[0]) / 2, (q.min[2] + q.max[2]) / 2];
    }
  }
  ok(cut === 0, '黑牆沒有切到任何幾何',
    cut ? `${cut} 塊，最多戳出去 ${worst.toFixed(2)} m @ ${at[0].toFixed(1)},${at[1].toFixed(1)}`
      : `${R.parts.length} 塊（${pierced} 塊是刻意穿過去的）`);
}

head('黑牆與黑霧的幾何');
/* 這一節驗的是 veil.js，而它有一個致命而且看不出來的失敗模式：三角形的
   繞向。材質是單面的（雙面的話走進霧殼與牆之間會把整個畫面染暗一次），
   所以法線必須朝內——反了就整片被剔掉，畫面上是「黑牆沒有出現」，而那跟
   「還沒做」長得一模一樣。node 沒有 WebGL 可以畫，但繞向算得出來。 */
{
  const V = buildVeil(R.arenas);
  console.log(`  ${V.tris} 三角形 ・ 一個 draw ・ ${VEIL.haze.length} 層霧`
    + ` ・ 牆腳漸層 ${VEIL.skirt} m`);
  ok(V.tris > 0 && V.pos.length === V.alpha.length * 3, '頂點與透明度數量對得上');
  let nanCount = 0;
  for (const v of V.pos) if (!Number.isFinite(v)) nanCount++;
  for (const v of V.alpha) if (!(v >= 0 && v <= 1)) nanCount++;
  ok(nanCount === 0, '沒有 NaN，透明度都在 [0,1]', `${nanCount}`);

  /* 法線：垂直的牆面要朝內（指向場地裡面），地上那圈要朝上。 */
  let inward = 0, up = 0, outward = 0, down = 0, lidBad = 0;
  for (let i = 0; i < V.pos.length; i += 9) {
    const ax = V.pos[i], ay = V.pos[i + 1], az = V.pos[i + 2];
    const bx = V.pos[i + 3], by = V.pos[i + 4], bz = V.pos[i + 5];
    const cx2 = V.pos[i + 6], cy = V.pos[i + 7], cz2 = V.pos[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx2 - ax, wy = cy - ay, wz = cz2 - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const mx = (ax + bx + cx2) / 3, mz = (az + bz + cz2) / 3;
    if (Math.abs(ny) > Math.abs(nx) + Math.abs(nz)) {
      /* 水平的三角形只有兩種：牆腳那圈漸層（貼在地上、朝上），以及頂
         （在 lid 的高度、朝下——站在下面才看得到）。 */
      const y = (ay + by + cy) / 3;
      if (ny < 0) {
        down++;
        if (!R.arenas.some((q) => Math.abs(q.lid - y) < 1e-6)) lidBad++;
      } else {
        up++;
        if (Math.abs(y - VEIL.skirtY) > 1e-6) lidBad++;
      }
      continue;
    }
    // 朝內 = 法線與「從場地中心指向這個三角形」的方向相反
    const a = R.arenas.reduce((p, q) => (arenaGap(q, mx, mz) > arenaGap(p, mx, mz) ? q : p));
    const ox = a.shape === 'circle' ? a.x : (a.x0 + a.x1) / 2;
    const oz = a.shape === 'circle' ? a.z : (a.z0 + a.z1) / 2;
    ((mx - ox) * nx + (mz - oz) * nz < 0 ? inward++ : outward++);
  }
  ok(outward === 0, '牆面的法線都朝內（單面材質才看得到）', `朝內 ${inward}、朝外 ${outward}`);
  ok(up > 0 && down > 0, '牆腳那圈朝上、頂朝下', `朝上 ${up}、朝下 ${down}`);
  ok(lidBad === 0, '水平的面只落在牆腳與頂這兩個高度上', `${lidBad} 片不在`);

  /* 外框就是碰撞用的那個邊界：段數 56 的圓，弓高只有 1 公分。 */
  let far = 0;
  for (const a of R.arenas) {
    for (const [px, pz] of outline(a, 0)) {
      const g = Math.abs(arenaGap(a, px, pz));
      if (g > far) far = g;
    }
    // 段的中點才是離邊界最遠的地方（圓的弓高）
    const P = outline(a, 0);
    for (let i = 0; i < P.length; i++) {
      const q = P[(i + 1) % P.length];
      const g = Math.abs(arenaGap(a, (P[i][0] + q[0]) / 2, (P[i][1] + q[1]) / 2));
      if (g > far) far = g;
    }
  }
  ok(far < 0.02, '畫出來的牆面貼合碰撞的邊界', `最多差 ${(far * 100).toFixed(1)} cm`);

  /* 頂的高度：要蓋過最高的砌體（不然頂會從屋頂穿過去），但也不必太高
     ——這幾座的牆才六七公尺，頂拉到二十公尺只是讓房間變成一口井。 */
  for (const a of R.arenas) {
    const name = BLOCKS.find((b) => b.id === a.id).name;
    let hi = 0;
    for (const q of R.parts) {
      if (arenaGap(a, (q.min[0] + q.max[0]) / 2, (q.min[2] + q.max[2]) / 2) < 0) continue;
      if (q.max[1] > hi) hi = q.max[1];
    }
    ok(a.lid > hi + 1.0, `${name}：頂沒有切到砌體`, `頂 ${a.lid} m／砌體最高 ${hi.toFixed(1)} m`);
    ok(a.lid < hi + 10, `${name}：頂沒有高到變成一口井`, `高出砌體 ${(a.lid - hi).toFixed(1)} m`);
  }

  /* 封閉：牆從牆腳一路到頂，中間不准有斷層——有的話會從縫裡看到外面的
     地面與隔壁那幾座，而那正是封頂要解決的事。 */
  let gap = 0;
  for (const a of R.arenas) {
    let lo = Infinity, hi2 = -Infinity;
    for (let i = 0; i < V.pos.length; i += 3) {
      const x = V.pos[i], y = V.pos[i + 1], z = V.pos[i + 2];
      if (Math.abs(arenaGap(a, x, z)) > 0.05) continue;    // 只看貼在這道牆上的
      if (y < lo) lo = y; if (y > hi2) hi2 = y;
    }
    if (lo > VEIL.base + 1e-6 || hi2 < a.lid - 1e-6) gap++;
  }
  ok(gap === 0, '每一道牆都從牆腳一路實心到頂', `${gap} 道有斷層`);
}

head('鏡頭的吊臂');
/* 第三人稱的鏡頭掛在一條從角色伸出去的線上，撞到黑牆、天花板或地板就
   沿著那條線收短。這一項驗的是「收短之後鏡頭真的還在房間裡」——出去了
   就是從外面看黑牆的背面，畫面整片黑，而那是一個沒有人會回報成「相機
   出界」的災難：看起來就只是「畫面黑掉了」。

   掃法：場地裡每隔兩公尺一個樞紐（站得住的才算）、每 15° 一個方位、五個
   俯仰角，全部伸到底，然後問那個點在不在場地裡、有沒有穿出天花板、陷進
   地板，或者**跑進砌體裡面**——最後這一項是把吊臂接上碰撞盒清單之後才
   驗得到的，而它在畫面上不是「相機穿牆」，只是「突然看到一片奇怪的東西」。 */
{
  const MARGIN = 0.35, FLOOR = 0.45;
  let checked = 0, outWall = 0, outLid = 0, outFloor = 0, inStone = 0, worst = 0;
  for (const a of R.arenas) {
    const x0 = a.shape === 'circle' ? a.x - a.r : a.x0;
    const x1 = a.shape === 'circle' ? a.x + a.r : a.x1;
    const z0 = a.shape === 'circle' ? a.z - a.r : a.z0;
    const z1 = a.shape === 'circle' ? a.z + a.r : a.z1;
    for (let px = x0; px <= x1; px += 2) {
      for (let pz = z0; pz <= z1; pz += 2) {
        if (arenaGap(a, px, pz) < 0.3) continue;      // 樞紐本來就該在裡面
        // 站不住的地方不算（樞紐在砌體裡面的話，吊臂本來就沒有答案）
        const [sx2, sz2] = solveXZ(COLS, px, pz, 0);
        if (Math.hypot(sx2 - px, sz2 - pz) > 1e-6) continue;
        /* 推不動不代表不在牆裡：一道牆切成 1.2 公尺一段，正好落在兩段交界、
           又在牆身正中間的點，兩段會把它往相反的方向各推一次，推完回到原地。
           身體走不到那裡（它是從牆外面走進來的），但格點撒得到，所以直接問。 */
        if (COLS.some((c) => c.kind !== 'bound' && !c.air && c.min[1] < 0.5 && c.max[1] > 0.5
          && (c.shape === 'circle' ? Math.hypot(px - c.x, pz - c.z) < c.r
            : px > c.min[0] && px < c.max[0] && pz > c.min[2] && pz < c.max[2]))) continue;
        /* 樞紐放在站得住的那個面上方一公尺，而且頭頂兩公尺內不能有東西。
           後面這一條是在濾掉「人到不了的封閉空腔」——露台的台體中間是
           中空的（四周砌牆、上面鋪面），格點會撒進去，而那裡的鏡頭當然
           在鋪面裡面。物理看不出那裡到不了，抬頭看得出來。 */
        const pivY = supportAt(COLS, px, pz, 0.1) + 1.0;
        if (boomLimit(a, COLS, [px, pivY, pz], [0, 1, 0], 30) < 2.0) continue;
        for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 12) {
          for (const pitch of [-0.35, 0, 0.4, 0.8, 1.15]) {
            const cp = Math.cos(pitch), sp = Math.sin(pitch);
            const dir = [-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp];
            const pivot = [px, pivY, pz];
            const t = boomLimit(a, COLS, pivot, dir, 16);
            const cx = pivot[0] + dir[0] * t, cy = pivot[1] + dir[1] * t, cz = pivot[2] + dir[2] * t;
            checked++;
            /* 容差 1 mm：交點是解二次式算出來的，浮點誤差在 1e-9 的
               量級，而 1 公釐在畫面上不存在。 */
            const g = arenaGap(a, cx, cz);
            if (g < MARGIN - 1e-3) { outWall++; worst = Math.max(worst, MARGIN - g); }
            if (cy > a.lid - MARGIN + 1e-3) outLid++;
            if (cy < FLOOR - 1e-3) outFloor++;
            /* 跑進砌體裡面。碰撞體往內縮 0.25（吊臂留的餘裕是 0.35），
               所以「剛好停在牆面前」不會被算成穿進去。圓柱要照圓量：
               它的外接盒的角比它自己遠 41%，照盒子量的話，鏡頭停在柱面
               前面會被誤判成停在柱子裡面。 */
            for (const b of COLS) {
              if (b.kind === 'bound' || b.air) continue;   // 空氣牆本來就不擋鏡頭
              if (cy <= b.min[1] + 0.25 || cy >= b.max[1] - 0.25) continue;
              const deep = b.shape === 'circle'
                ? Math.hypot(cx - b.x, cz - b.z) < b.r - 0.25
                : (cx > b.min[0] + 0.25 && cx < b.max[0] - 0.25
                  && cz > b.min[2] + 0.25 && cz < b.max[2] - 0.25);
              if (deep) { inStone++; break; }
            }
          }
        }
      }
    }
  }
  console.log(`  掃了 ${checked.toLocaleString()} 個鏡頭位置`);
  ok(outWall === 0, '鏡頭不會穿出黑牆', outWall ? `${outWall} 個，最深 ${worst.toFixed(2)} m` : '');
  ok(outLid === 0, '鏡頭不會穿出天花板', `${outLid}`);
  ok(outFloor === 0, '鏡頭不會陷進地板', `${outFloor}`);
  ok(inStone === 0, '鏡頭不會縮進砌體裡面', `${inStone}`);

  /* 收短，不是滑開：吊臂只會變短，方向不變。所以在同一個樞紐與方位上，
     鏡頭一定落在那條線上——這一項是拿算出來的點回推方向來驗的。 */
  let offLine = 0;
  for (const a of R.arenas) {
    const px = a.shape === 'circle' ? a.x : (a.x0 + a.x1) / 2;
    const pz = a.shape === 'circle' ? a.z : (a.z0 + a.z1) / 2;
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.21) {
      const cp = Math.cos(0.3), sp = Math.sin(0.3);
      const dir = [-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp];
      const t = boomLimit(a, COLS, [px, 1.0, pz], dir, 16);
      const v = [dir[0] * t, dir[1] * t, dir[2] * t];
      const len = Math.hypot(v[0], v[1], v[2]) || 1;
      const dot = (v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) / len;
      if (dot < 1 - 1e-9) offLine++;
    }
  }
  ok(offLine === 0, '鏡頭只沿著吊臂收短，不往旁邊滑', `${offLine} 個偏離`);
}

/* ── 被牆逼到最近的時候，角色會不會離開畫面中心 ──────────────────────
   這是整個鏡頭最容易做錯、而且**只有動起來才看得到**的一條：貼著牆走的
   時候，如果樞紐還黏在人身上，鏡頭就會黏著牆滑，人永遠在正中央，畫面
   有一半是牆。要的是相反的——鏡頭停住，人走出中心，換到看得見前面。

   場地是這裡臨時造的一個空圓，不是四個區塊裡的任何一個：驗的是**規則**，
   而規則不該綁在某一座遺跡的擺設上。走到哪裡算「離牆夠遠」也是從 CAM 的
   門檻推回來的，所以之後調那幾個數字，這一項不會因此變成紅的。 */
{
  const a = { id: 'test', shape: 'circle', x: 0, z: 0, r: 22, lid: 16 };
  const cam = makeCam(0, 20);
  cam.yaw = Math.PI;                       // 吊臂朝 +z，也就是朝牆
  const player = { x: 0, y: 0, z: 20 };
  const dt = 1 / 60;
  const deg = (r2) => (r2 * 180) / Math.PI;
  let maxOff = 0, pinnedFrames = 0, minBoom = 99;
  for (let i = 0; i < 120; i++) {           // 兩秒：沿著牆走
    player.x += PHYS.walk * dt;
    const rig = updateCam(cam, dt, player, a, []);
    maxOff = Math.max(maxOff, rig.offAngle);
    minBoom = Math.min(minBoom, rig.boom);
    if (rig.pinned) pinnedFrames++;
  }
  ok(pinnedFrames > 100, '貼著牆走的時候樞紐被釘住', `${pinnedFrames}/120 幀`);
  ok(minBoom < cam.curDist - 0.5, '吊臂真的被牆收短了', `最短 ${minBoom.toFixed(2)} m`);
  ok(deg(maxOff) > 10, '角色確實離開了畫面中心', `最多偏 ${deg(maxOff).toFixed(1)}°`);
  ok(deg(maxOff) < deg(Math.atan(CAM.deadTan)) + 2, '但沒有走出 dead zone',
    `${deg(maxOff).toFixed(1)}° ≤ ${deg(Math.atan(CAM.deadTan)).toFixed(0)}°+2`);

  /* 走回場地中央。要走到「牆不再限制吊臂」為止，而那個距離是門檻算出來
     的：鬆開需要空間大於 hold × holdOut，再加一公尺餘裕。 */
  const needRoom = CAM.hold * CAM.holdOut + 1;
  let off2 = 1, pinned2 = true, steps = 0;
  while (steps < 600 && (pinned2 || Math.hypot(player.x, player.z) > a.r - needRoom)) {
    const d = Math.hypot(player.x, player.z) || 1;
    player.x -= (player.x / d) * PHYS.walk * dt;
    player.z -= (player.z / d) * PHYS.walk * dt;
    const rig = updateCam(cam, dt, player, a, []);
    off2 = rig.offAngle; pinned2 = rig.pinned;
    steps++;
  }
  ok(!pinned2, '走開之後樞紐鬆得開',
    `走了 ${(steps / 60).toFixed(1)} 秒、離牆 ${(a.r - Math.hypot(player.x, player.z)).toFixed(1)} m`);
  ok(deg(off2) < 2, '角色回到畫面中心', `偏 ${deg(off2).toFixed(2)}°`);
}

head('動物（遊戲那幾隻本人）');
const buf = readFileSync(new URL('../public/assets/cat.bin', import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const zoo = await loadZoo({ buffer: ab, look: 'dog-prick/yellow', height: 1.0 });

ok(zoo.models.length === 3, 'species.js 的三種模型都建起來了', zoo.models.join(', '));
ok(zoo.looks().length === 9, '九種 look＝選單那張 3×3 的表',
  zoo.looks().map((l) => l.look).join(' '));
{
  const cells = zoo.looks();
  const rows = new Set(cells.map((c) => c.row)), cols = new Set(cells.map((c) => c.col));
  ok(rows.size === 3 && cols.size === 3, '表是 3 行 3 列', `${rows.size}×${cols.size}`);
  ok(new Set(cells.map((c) => `${c.row},${c.col}`)).size === 9, '沒有兩格疊在同一個位置');
}

for (const id of zoo.models) {
  const c = zoo.critters.get(id);
  ok(c.data.header.vertexCount > 15000, `${id}：cat.bin 的幾何搬進來了`,
    `${c.data.header.vertexCount.toLocaleString()} 個頂點`);
  ok(c.rig.count >= 23, `${id}：骨架至少是那 23 根`, `${c.rig.count} 根`);
  const G = Object.fromEntries(c.data.header.groups.map((g) => [g.name, g.count]));
  ok(G.lit > 0 && G.unlit > 0 && G.outline > 0, `${id}：三個群組都在`,
    `lit ${G.lit} / unlit ${G.unlit} / outline ${G.outline}`);
  ok(c.geometry.groups.length === 3 && c.mesh.material.length === 3,
    `${id}：三個 draw range、三顆材質`);
  ok(c.mesh.material[2].side === THREE.BackSide, `${id}：墨線那顆是翻面的`);
  ok(c._hatBones.length > 0, `${id}：漁夫帽掛得上`, `${c._hatBones.length} 根骨頭`);
  ok(c.shape.parts.length >= 8, `${id}：部位表量到了`, `${c.shape.parts.length} 個`);
  c.update(1 / 60, { speed: 0, grounded: true, vy: 0 });
  const box = c._measure();
  const h = (box.max[1] - box.min[1]) * c._scale;
  ok(Math.abs(h - 1.0) < 0.02, `${id}：站著剛好一公尺高（含帽子）`, `${h.toFixed(3)} m`);
  const feet = box.min[1] * c._scale + c.mesh.position.y;
  ok(Math.abs(feet) < 0.01, `${id}：腳掌落在 y = 0 上`, `${feet.toFixed(4)}`);
}

/* 九種 look 都換得動，而且同一時間只有一隻看得見——切換是換可見度，
   漏掉一隻就會有兩隻動物疊在同一個位置上，而那在畫面上是一團看不懂的
   東西。 */
{
  let bad = 0, wrongVis = 0;
  for (const { look } of zoo.looks()) {
    if (!zoo.setLook(look) || zoo.look !== look) { bad++; continue; }
    let vis = 0;
    for (const c of zoo.critters.values()) if (c.root.visible) vis++;
    if (vis !== 1) wrongVis++;
  }
  ok(bad === 0, '九種 look 都換得動', `${bad} 個失敗`);
  ok(wrongVis === 0, '同一時間只有一隻看得見', `${wrongVis} 次不是一隻`);
  ok(!zoo.setLook('dog-prick/orangin'), '不存在的組合換不動（貓的毛色不會跑到狗身上）');
}

/* 烘焙版的貓沒有嘴：`unlit` 裡掛在 head 上的那幾個頂點收成一點（零面積，
   不會被畫）。其他臉部頂點、以及每一隻狗的臉都不能被波及。 */
{
  const facePts = (c) => {
    const G = c._unlitGroup, head = c.rig.names.indexOf('head');
    const mouth = new Set(), rest = new Set();
    for (let i = G.start; i < G.start + G.count; i++) {
      const v = c.data.index[i];
      const p = c._posBaked;
      const key = `${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]}`;
      (c._boneId[v] === head ? mouth : rest).add(key);
    }
    return { mouth, rest };
  };
  const cat = facePts(zoo.critters.get('cat'));
  ok(cat.mouth.size === 1, '烘焙版的貓：嘴收成一點，畫不出來', `${cat.mouth.size} 個相異位置`);
  ok(cat.rest.size > 100, '烘焙版的貓：眼睛、鼻子、鬍鬚都還在', `${cat.rest.size} 個相異位置`);
  for (const id of zoo.models.filter((m) => m !== 'cat')) {
    const d = facePts(zoo.critters.get(id));
    ok(d.mouth.size !== 1 && d.rest.size > 100, `${id}：狗的臉沒被收掉`,
      `head 上 ${d.mouth.size}、其他 ${d.rest.size} 個相異位置`);
  }
}

/* 換模型要接住朝向：不接的話玩家只是換了外觀，角色卻原地轉回正面。 */
{
  zoo.setLook('cat/tabby');
  zoo.setFacing(1.1);
  for (let i = 0; i < 60; i++) zoo.update(1 / 60, { speed: 4, grounded: true, vy: 0 });
  const before = zoo.active._yaw;
  zoo.setLook('dog-drop/grey');
  ok(Math.abs(zoo.active._yaw - before) < 1e-6, '換動物的時候朝向接過去了',
    `${before.toFixed(3)} → ${zoo.active._yaw.toFixed(3)}`);
}

zoo.setLook('dog-prick/yellow');
{
  const dog = zoo.active;
  ok(zoo.hatOn, '預設戴著帽子');
  zoo.setHat(false);
  zoo.update(1 / 60, { speed: 0, grounded: true, vy: 0 });
  let shrunk = true;
  for (const b of dog._hatBones) if (dog.rig.scale[b * 3 + 1] !== 0) shrunk = false;
  ok(shrunk, '脫帽是把帽子的骨頭縮到零（跟遊戲同一個做法）');
  zoo.setHat(true);
  zoo.update(1 / 60, { speed: 0, grounded: true, vy: 0 });
  let back = true;
  for (const b of dog._hatBones) if (dog.rig.scale[b * 3 + 1] !== dog.rig.rest.scale[b * 3 + 1]) back = false;
  ok(back, '戴回去是回到 rest 的尺寸');

  /* 兩千幀，四種狀態都跑過：骨頭矩陣與尾巴那條彈簧鏈都不准生出非有限
     數。彈簧是這裡唯一會爆的東西——它是積分出來的。 */
  let bad = 0;
  for (let i = 0; i < 2000; i++) {
    zoo.setFacing(Math.sin(i * 0.07) * 3.1);
    zoo.update(1 / 60, { speed: (i % 300) / 48, grounded: i % 91 !== 0, vy: Math.sin(i * 0.3) * 4 });
    if (i % 50 === 0) {
      for (const v of dog.rig.matrices) if (!Number.isFinite(v)) bad++;
      for (const v of dog.sway.qs) if (!Number.isFinite(v)) bad++;
      for (const v of dog.sway.bend) if (!Number.isFinite(v)) bad++;
    }
  }
  ok(bad === 0, '兩千幀之後骨頭與彈簧都還是有限數', `${bad}`);
  let moved = 0;
  for (let i = 0; i < dog.sway.qs.length; i += 4) {
    if (Math.abs(dog.sway.qs[i + 3] - 1) > 1e-4) moved++;
  }
  ok(moved > 3, '尾巴那條 17 節的彈簧真的在擺', `${moved}/17 節偏離靜止`);

  /* ── 烘焙 ───────────────────────────────────────────────────
     沒有 GPU 可以驗「畫出來對不對」，所以驗的是「接上了沒有」。每一項
     都對應一個真的會發生、而且不會報錯的故障。 */
  const S = dog.shape;
  const earL = dog.rig.bone('earL'), earR = dog.rig.bone('earR');
  ok(S.rides[earL] === 1 && S.rides[earR] === 1, '兩隻立耳被標成「只跟著頭走」');
  ok(S.byBone[dog.rig.bone('tail')] === -1, '尾巴不是部位（它是一根管子）');

  /* 畫的就是烘出來的那一份，而且烘焙真的動了皮；耳朵與尾巴不烘，維持
     網格原本的形狀。墨線外殼不算：它照抄雙生毛皮頂點，連不烘的部位也
     會退掉資產裡那 0.05 的厚度，那是刻意的（線寬處處相等）。 */
  const P = dog.geometry.attributes.position.array;
  let same = true;
  for (let i = 0; i < P.length; i++) if (P[i] !== dog._posBaked[i]) { same = false; break; }
  ok(same, '幾何就是烘焙後的頂點');
  let movedSkin = 0, skin = 0, movedEar = 0, ears = 0;
  const nv = dog.data.header.vertexCount;
  const OG = dog._outlineGroup, isInk = new Uint8Array(nv);
  for (let i = OG.start; i < OG.start + OG.count; i++) isInk[dog.data.index[i]] = 1;
  for (let v = 0; v < nv; v++) {
    if (isInk[v]) continue;
    const d = Math.hypot(P[v * 3] - dog._posRaw[v * 3], P[v * 3 + 1] - dog._posRaw[v * 3 + 1],
      P[v * 3 + 2] - dog._posRaw[v * 3 + 2]);
    const b = dog._boneId[v];
    if (b === earL || b === earR || b === dog.rig.bone('tail')) { ears++; if (d > 1e-6) movedEar++; }
    else { skin++; if (d > 1e-6) movedSkin++; }
  }
  ok(movedSkin > skin * 0.9, '烘焙真的把皮放到超橢球上了', `${movedSkin}/${skin} 個皮與臉的頂點動了`);
  ok(ears > 0 && movedEar === 0, '耳朵與尾巴沒被烘', `${ears} 個頂點、動了 ${movedEar}`);

  const U = dog._uniforms;
  ok(U.uPart.value.length === S.parts.length * 4, 'uPart 的長度對得上部位數');
  let boneOk = true;
  S.parts.forEach((p, i) => { if (U.uPart.value[i * 4 + 3] !== p.bone) boneOk = false; });
  ok(boneOk, '每個部位的 uniform 記著正確的骨號（臉靠它找頭）');

  dog.setInkPx(2, 900);
  ok(Math.abs(dog._inkOut.value - 2 * 2 / 900) < 1e-9, '墨線寬度從像素換算成螢幕單位',
    `2 px / 900 px 高 → ${dog._inkOut.value.toFixed(5)}`);

  ok(typeof zoo.setShapeMode !== 'function' && typeof zoo.setBend !== 'function',
    '造型不再可選：沒有切換 warp／bake 的入口');

  for (const [i, name, wantInk] of [[0, '皮毛', false], [1, '臉', false], [2, '墨線', true]]) {
    const src = i === 0 ? THREE.ShaderLib.toon : THREE.ShaderLib.basic;
    const shader = { uniforms: {}, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
    dog.mesh.material[i].onBeforeCompile(shader, null);
    const calls = (shader.vertexShader.match(/gl_Position\.xy \+= /g) || []).length;
    ok(calls === (wantInk ? 1 : 0), `${name}：${wantInk ? '有' : '沒有'}在螢幕空間往外推`, `${calls} 處`);
    ok(!shader.vertexShader.includes('cpWarp'), `${name}：沒有每幀的二次變形`);
    ok(shader.vertexShader.includes('cpSkinPos()'), `${name}：頂點位置換成骨架算的了`);
    ok(!!shader.uniforms.uBones && shader.uniforms.uBones.value === dog.rig.matrices,
      `${name}：uBones 指的就是 rig 每幀寫的那一份`);
  }
  const inkShader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: '' };
  dog.mesh.material[2].onBeforeCompile(inkShader, null);
  const furShader = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: '' };
  dog.mesh.material[0].onBeforeCompile(furShader, null);
  ok(inkShader.uniforms.uInkOut.value > 0 && furShader.uniforms.uInkOut.value === 0,
    '墨線推到輪廓外一圈，皮毛不推');
}

head('手把');
/* 驗的是版面與手感的算術，不是畫面。node 沒有 canvas，所以餵一個假的
   ——建構子只把 getContext 的結果存起來，那個東西只有畫的時候用得到。 */
{
  const fakeCanvas = () => ({ getContext: () => null, width: 0, height: 0 });

  /* ── 橫向：兩側操作列，中間留給遊戲 ── */
  const land = new Pad(fakeCanvas());
  land.layout(1024, 576, 2, { l: 0, r: 0, t: 0, b: 0 });
  ok(!land.portrait, '寬的畫面判成橫向');
  ok(land.rail >= 96 && land.rail <= 190, '直欄寬度落在遊戲那條式子的範圍裡',
    `${land.rail.toFixed(1)} px`);
  ok(Math.abs(land.rail - Math.min(1024 * 0.155, 576 * 0.44)) < 1e-6,
    '直欄寬度就是 min(W·0.155, H·0.44)', `${land.rail.toFixed(2)}`);
  ok(land.slotJoy.x < 1024 / 2 && land.slotJmp.x > 1024 / 2, '預設左搖桿、右跳躍',
    `搖桿 x=${land.slotJoy.x.toFixed(0)}、跳躍 x=${land.slotJmp.x.toFixed(0)}`);
  ok(land.slotJoy.x + land.joy.r <= land.rail + 12 + 1e-6, '搖桿整個在左欄裡',
    `右緣 ${(land.slotJoy.x + land.joy.r).toFixed(0)} ≤ ${(land.rail + 12).toFixed(0)}`);
  ok(land.slotJmp.x - land.jmp.r >= 1024 - land.rail - 12 - 1e-6, '跳躍鍵整個在右欄裡');
  ok(land.slotJoy.y + land.joy.r < 576, '操作元件沒有掉出畫面下緣');
  ok(land.ctrlTop > 0 && land.ctrlTop < 576, '面板的下界（--ctrl）是個合理的高度',
    `${land.ctrlTop.toFixed(0)} px`);

  /* 中間那一整片必須是遊戲的。這是這個版面存在的全部理由，所以整條
     中央帶都掃一遍，而不是只問一個點。 */
  let stolen = 0;
  for (let x = land.rail + 20; x < 1024 - land.rail - 20; x += 8) {
    for (let y = 8; y < 576; y += 8) if (land.hit(x, y)) stolen++;
  }
  ok(stolen === 0, '橫向：中間那一整片沒有被觸控區吃掉', `${stolen} 個點`);
  ok(land.hit(30, 560) === 'joy', '左欄下半段是搖桿');
  ok(land.hit(1000, 560) === 'jmp', '右欄下半段是跳躍');
  ok(land.hit(30, 20) === null, '左欄上半段留給面板，不吃觸控');

  /* ── 直向：上下兩條橫帶 ── */
  const port = new Pad(fakeCanvas());
  port.layout(430, 900, 2, { l: 0, r: 0, t: 0, b: 0 });
  ok(port.portrait, '高的畫面判成直向');
  ok(port.barT > 0 && port.barB > 0, '上下兩條橫帶都有高度',
    `上 ${port.barT.toFixed(0)}、下 ${port.barB.toFixed(0)}`);
  ok(port.rail === 0, '直向沒有直欄');
  let stolenP = 0;
  for (let x = 8; x < 430; x += 8) {
    for (let y = port.barT + 20; y < port.ctrlTop - 8; y += 8) if (port.hit(x, y)) stolenP++;
  }
  ok(stolenP === 0, '直向：兩條橫帶之間那一片沒有被吃掉', `${stolenP} 個點`);
  ok(port.hit(40, 880) === 'joy' && port.hit(400, 880) === 'jmp',
    '直向也是左搖桿右跳躍');

  /* ── 手感 ── */
  const st = land;
  const push = (dx, dy) => {
    st.down('joy', 1, st.slotJoy.x + dx, st.slotJoy.y + dy);
    const m = Math.hypot(st.axis.x, st.axis.y);
    st.up(1);
    return m;
  };
  const travel = (st.joy.r - st.joy.kr) * 0.86;
  ok(Math.abs(push(travel, 0) - 1) < 1e-6, '推到底＝軸長 1', push(travel, 0).toFixed(4));
  ok(Math.abs(push(travel * 3, 0) - 1) < 1e-6, '推過頭也是 1（夾在單位圓上）');
  const diag = push(travel * 0.7071 * 3, travel * 0.7071 * 3);
  ok(Math.abs(diag - 1) < 1e-6, '推到對角也是 1（軸是圓的，不是方的）', diag.toFixed(4));
  ok(push(travel * 0.05, 0) === 0, '死區裡不走路');
  const half = push(travel * 0.5, 0);
  ok(half > 0.2 && half < 0.85, '半推是類比的', half.toFixed(3));
  /* 旋鈕固定不浮動：按在觸控區的哪裡就已經在推了，所以「按下的位置」
     本身就決定了軸值——這是遊戲那支手把的手感，也是它跟浮動搖桿最大
     的差別。 */
  st.down('joy', 3, st.slotJoy.x + travel, st.slotJoy.y);
  ok(Math.abs(Math.hypot(st.axis.x, st.axis.y) - 1) < 1e-6,
    '按下的那一刻就已經在推了（旋鈕不浮動）');
  st.up(3);

  let jumps = 0;
  const jp = new Pad(fakeCanvas(), { onJump: () => { jumps++; } });
  jp.layout(1024, 576, 2);
  jp.down('jmp', 9, jp.slotJmp.x, jp.slotJmp.y);
  ok(jumps === 1, '按下就跳，不等放開');
  ok(jp.takeJump() === true, '排到的那一次讀得出來');
  ok(jp.takeJump() === false, '同一次按下不會跳兩次');
  ok(jp.drops.length > 0, '按下噴出水花', `${jp.drops.length} 滴`);
  jp.up(9);

  /* 畫一遍。假 context 與假 Path2D：畫出來對不對驗不到，但「畫的時候會
     不會爆」驗得到，而那是這種每幀跑的繪圖碼最常見的故障。 */
  const calls = new Map();
  const grad = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      return (...a) => { calls.set(k, (calls.get(k) || 0) + 1); void a; };
    },
    set() { return true; },
  });
  globalThis.Path2D = class {
    moveTo() {} lineTo() {} closePath() {} quadraticCurveTo() {} arc() {}
  };
  const dr = new Pad({ getContext: () => ctx, width: 0, height: 0 });
  dr.layout(1024, 576, 2);
  let threw = null;
  try {
    dr.update(1 / 60); dr.draw();                            // 儀器狀態
    dr.down('joy', 1, dr.slotJoy.x + 20, dr.slotJoy.y - 14);
    dr.update(1 / 60); dr.draw();                            // 液化、推著
    dr.down('jmp', 2, dr.slotJmp.x, dr.slotJmp.y);
    dr.update(1 / 60); dr.draw();                            // 加上按著跳
    dr.up(1); dr.up(2);
    dr.update(1 / 60); dr.draw();                            // 放開，彈回
  } catch (e) {
    threw = e;
  }
  ok(!threw, '四種狀態都畫得出來（靜止／推著／按跳／放開）', threw ? threw.message : '');
  ok((calls.get('clearRect') || 0) === 4, '每一幀都先清掉上一幀',
    `${calls.get('clearRect') || 0} 次`);
  ok((calls.get('stroke') || 0) > 0 && (calls.get('fill') || 0) > 0, '真的有畫東西',
    `stroke ${calls.get('stroke') || 0} 次、fill ${calls.get('fill') || 0} 次`);
}

head('生物那張表的 RWD');
/* 這張表要塞進一根「算出來的」直欄裡（96–190），所以降級的門檻不能是
   隨手挑的斷點——它們要跟真的量出來的尺寸對得上。下面那幾個常數就是
   index.html 那幾條 CSS 的尺寸，逐級把「一列需要多寬」加起來，跟那一級
   實際拿得到的寬度比。

   量不到的是字體實際渲染出來的寬度（node 沒有排版引擎），所以中文字寬
   用「字級 × 1.0」估——方塊字就是這樣，這個估法對 CJK 是準的，而這張表
   從頭到尾只有中文。 */
{
  const PANEL_EDGE = 16;          // 面板離欄兩側各 8
  const PANEL_PAD = { wide: 7 * 2 + 2, mid: 5 * 2 + 2, narrow: 5 * 2 + 2 };
  const FONT = { wide: 10, mid: 9, narrow: 9 };
  const DOT = { wide: 10 + 2, mid: 9 + 2, narrow: 8 + 2 };
  const GAP = 3;
  const CHIP_PAD = { wide: 8, mid: 0, narrow: 0 };   // 只有 wide 的格子有內距
  const LABEL_CHARS = { wide: 3, mid: 3, narrow: 1 };

  const needs = (tier) => {
    const label = LABEL_CHARS[tier] * FONT[tier] + 3;      // 名字 + 右邊那道 3
    const chip = DOT[tier] + CHIP_PAD[tier];
    return label + 3 * chip + 3 * GAP + PANEL_PAD[tier];
  };

  let bad = [];
  for (let rail = 96; rail <= 190; rail += 1) {
    const tier = railTier(rail);
    const have = rail - PANEL_EDGE;
    if (needs(tier) > have) bad.push(`${rail}px（${tier} 需要 ${needs(tier)}，只有 ${have}）`);
  }
  ok(bad.length === 0, '96 到 190 的每一種欄寬，那一級都塞得進去',
    bad.length ? bad.slice(0, 3).join('、') : `最窄 96 需要 ${needs('narrow')}、有 ${96 - PANEL_EDGE}`);

  ok(railTier(96) === 'narrow' && railTier(111) === 'narrow', '96–111 是最窄的那一級');
  ok(railTier(112) === 'mid' && railTier(149) === 'mid', '112–149 是中間那一級');
  ok(railTier(150) === 'wide' && railTier(190) === 'wide', '150 以上是最寬的那一級');
  /* 直向的面板橫躺在上帶裡、有半個畫面寬，所以 main.js 餵一個大數字進來
     當「最寬」——那一級才會把毛色的名字放出來。 */
  ok(railTier(999) === 'wide', '直向（面板橫躺）算最寬的那一級');

  /* 門檻要落在「剛好放得下」的那一點附近，不然就是憑感覺挑的：
     單字那一級省下兩個字（18 px），所以 mid 的門檻應該比 narrow 的
     需求多出大約那麼多。 */
  const slackAtMid = 112 - 16 - needs('mid');
  ok(slackAtMid >= 0 && slackAtMid < 22, 'mid 的門檻就落在它剛好放得下的地方',
    `餘裕 ${slackAtMid} px`);
}

head('版面');
ok(PITCH >= 40, '區塊間距夠遠，互相看得到但不重疊', `${PITCH} m`);
{
  const p = R.geometry.attributes.position.array;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < p.length; i += 3) { if (p[i] < minY) minY = p[i]; if (p[i] > maxY) maxY = p[i]; }
  ok(minY > -1.5, '沒有幾何沉到地底下去', `最低 ${minY.toFixed(2)}`);
  ok(maxY > 6, '有夠高的東西撐起輪廓', `最高 ${maxY.toFixed(2)}`);
}

console.log(fails ? `\n${fails} 項不合格\n` : '\n全部通過\n');
process.exit(fails ? 1 : 0);
