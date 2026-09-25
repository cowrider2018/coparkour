/* ── tools/verify-test-area.mjs ──────────────────────────────────────
   /test-area/ 的離線驗證。

   這一頁的設計規則有三條是「用眼睛看不出來有沒有壞」的：

     1. 中心夠空曠   每個區塊中央那片空地上，每一格的支撐高度都必須等於
                     鋪面的高度，而且站在上面不會被任何碰撞盒推開。
                     少一塊鋪面、多一顆會絆腳的大石頭，這一項就會紅。
     2. 走得到       從出生點真的走到中心去——用的是 public/test-area/
                     src/walk.js 那一份物理，不是另寫一份。路上任何一個
                     看不見的盒子都會讓狗卡住。
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
    13. 轉向不欠帳  操控轉向是瞬間的，加速量一點都沒變。這兩件事只有
                     一起驗才有意義：少了前面那半，推了新方向的人會先
                     往舊方向滑一段；少了後面那半，全速反向會變成瞬移。
                     兩種都是「跑起來覺得不對」，而不是看得出來的東西。
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
  PHYS, SLIDE, APEX, solveXZ, supportAt, supportInfo, roundTop, roundSin, portalAt,
  steer, slideDrift, slideAccel, arenaGap, clampArena, boomLimit, BLOCK_TOP, TRIP, MOUNT,
} from '../public/test-area/src/walk.js';
import { VEIL, buildVeil, outline } from '../public/test-area/src/veil.js';
import { toonVC, toon, inkLine, BAND_EDGE, BAND_KEY } from '../public/test-area/src/palette.js';
import { SURF, SURF_DEF, TEX_N, MOSS, surfacePixels, mossAt } from '../public/test-area/src/surface.js';
import { stone } from '../public/test-area/src/geom.js';
import { CAM, makeCam, updateCam } from '../public/test-area/src/camera.js';
import { readFileSync } from 'node:fs';
import { loadZoo, TURN_RATE } from '../public/test-area/src/critter.js';
import { Pad } from '../public/test-area/src/pad.js';
import { railTier } from '../public/test-area/src/hud.js';

let fails = 0;
const ok = (cond, label, detail = '') => {
  if (cond) console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  else { console.log(`  ✗ ${label}  ${detail}`); fails++; }
};
const head = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 56 - s.length))}`);

/* 每個區塊「必須是空的」那一片。區塊自己的局部座標，加上 origin 才是
   世界座標。y 是那片空地的鋪面高度，cx／cz 是那一片的中心（不給就是區塊的
   原點）。兩層的區塊（城牆步道）給一串：兵營的路在地上，走道在牆頂上。 */
/* `via` 是那條路上的幾個轉折點（區塊的局部座標），給「朝目標直線走」走不到
   的區塊用（直線走進一面牆是走不過去的，真人也不會那樣走）。給轉折點不是
   放寬標準：每一段仍然是用真的物理走完的。

   `from` 是從哪裡走過去：不給就是出生點。牆頂的走道從出生點（兵營）是走
   不到的——只有圓塔的門開著才上得去——所以從牆頂那扇門的到達點走。 */
const CENTERS = {
  courtyard: { y: 0, hx: 6.0, hz: 6.0 },
  throne: { y: 0, hx: 4.4, hz: 8.5 },
  cistern: { y: 0, hx: 6.0, hz: 6.0 },
  wallwalk: [
    { y: 0, cz: -12, hx: 2.0, hz: 6.0 },
    { y: 5.2, hx: 7.0, hz: 2.4, from: 'wallwalk.towerTop' },
  ],
  crypt: { y: 0, hx: 2.4, hz: 8.0 },
  alley: { y: 0, hx: 2.0, hz: 6.0 },
};
/** 一個區塊的每一片空地，帶上世界座標的中心與一個給人看的名字。 */
const areasOf = (b) => [].concat(CENTERS[b.id]).map((c, i, all) => ({
  ...c, wx: b.origin[0] + (c.cx || 0), wz: b.origin[1] + (c.cz || 0),
  name: all.length > 1 ? `${b.name}（${c.y > 0 ? '牆頂' : '地面'}）` : b.name,
}));

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

head('表面紋路');
/* 石紋、木紋那一層（surface.js）。它在畫面上壞掉的樣子全部是安靜的：
   屬性少一截，後半段的地形就讀到零——整片變成「素色」，不會報錯；一塊
   幾何的三個頂點材料不一樣，那個三角形上的紋路會在兩種材料之間抖；
   貼圖不能拼接，每一塊石頭上都有一道筆直的接縫。所以逐項查。 */
{
  const S = R.geometry.attributes.aSurf;
  const P = R.geometry.attributes.position;
  ok(!!S && S.itemSize === 4 && S.normalized && S.array instanceof Int8Array,
    '每個頂點帶著 aSurf（4 個正規化的 int8）');
  ok(S && S.count === P.count, 'aSurf 的數量與頂點對得上', `${S ? S.count : 0} / ${P.count}`);

  const A = S.array;
  let badMat = 0, badG = 0, mixed = 0;
  const byMat = new Array(8).fill(0);
  for (let i = 0; i < S.count; i++) {
    const w = A[i * 4 + 3];
    if (w < 0 || w > 127) { badMat++; continue; }
    const m = w >> 4;
    byMat[m]++;
    if (m) {
      const L = Math.hypot(A[i * 4], A[i * 4 + 1], A[i * 4 + 2]) / 127;
      if (Math.abs(L - 1) > 0.02) badG++;
    }
  }
  /* 一個三角形的三個頂點必須是同一塊幾何的——材料、偏移、紋理方向全部
     一樣。著色器靠的是「內插一個常數還是那個常數」。 */
  for (let t = 0; t < S.count; t += 3) {
    for (let k = 0; k < 4; k++) {
      const a = A[t * 4 + k];
      if (A[(t + 1) * 4 + k] !== a || A[(t + 2) * 4 + k] !== a) { mixed++; break; }
    }
  }
  ok(badMat === 0, '材料編號都在 0～7、偏移都在 0～15', `${badMat}`);
  ok(badG === 0, '上了紋的頂點，紋理方向都是單位長', `${badG}`);
  ok(mixed === 0, '每個三角形的三個頂點是同一種材料、同一個偏移、同一個方向', `${mixed}`);
  const name = Object.fromEntries(Object.entries(SURF).map(([k, v]) => [v, k]));
  console.log('  ' + byMat.map((n, m) => `${name[m]} ${(n / S.count * 100).toFixed(1)}%`).join('、'));
  const missing = [1, 2, 3, 4, 5, 6, 7].filter((m) => !byMat[m]).map((m) => name[m]);
  ok(missing.length === 0, '七種材料全都有東西在用', missing.length ? `沒有：${missing.join('、')}` : '');
  ok(byMat[SURF.stone] / S.count > 0.3, '石頭是這一頁的主角', `${(byMat[SURF.stone] / S.count * 100).toFixed(0)}%`);

  /* 貼圖：每一個通道都要能拼接（跨接縫的那一步，不比貼圖內部最陡的
     那一步陡），而且切得出三階——溝與凸都要有，也都不能蓋掉半張圖。 */
  const t0 = Date.now();
  const PX = surfacePixels();
  const gen = Date.now() - t0;
  ok(PX.length === 2 && PX.every((p) => p.length === TEX_N * TEX_N * 4), '兩張貼圖、各 TEX_N² 個 RGBA', `${TEX_N}²、${gen} ms`);
  ok(gen < 1500, '開場算貼圖不會拖太久', `${gen} ms`);
  const at = (p, c, i, j) => p[(j * TEX_N + i) * 4 + c];
  const seamBad = [], bandBad = [];
  for (let m = 1; m < SURF_DEF.length; m++) {
    const d = SURF_DEF[m], p = PX[d.tex], c = d.ch;
    let seam = 0, inner = 0, lo = 0, hi = 0;
    for (let j = 0; j < TEX_N; j++) {
      seam = Math.max(seam, Math.abs(at(p, c, 0, j) - at(p, c, TEX_N - 1, j)), Math.abs(at(p, c, j, 0) - at(p, c, j, TEX_N - 1)));
      for (let i = 1; i < TEX_N; i++) {
        inner = Math.max(inner, Math.abs(at(p, c, i, j) - at(p, c, i - 1, j)), Math.abs(at(p, c, j, i) - at(p, c, j, i - 1)));
      }
    }
    for (let i = 0; i < TEX_N * TEX_N; i++) {
      const v = p[i * 4 + c] / 255;
      if (v < d.lo) lo++; if (v > d.hi) hi++;
    }
    lo /= TEX_N * TEX_N; hi /= TEX_N * TEX_N;
    if (seam > inner) seamBad.push(`${name[m] || m} ${seam}>${inner}`);
    if (lo < 0.03 || hi < 0.03 || lo > 0.4 || hi > 0.4) bandBad.push(`${name[m] || m} 溝${(lo * 100).toFixed(0)}% 凸${(hi * 100).toFixed(0)}%`);
  }
  ok(seamBad.length === 0, '每一個通道都能無縫拼接', seamBad.join('、'));
  ok(bandBad.length === 0, '每一種材料都切得出溝與凸（各 3%～40%）', bandBad.join('、'));

  /* 著色器：字串替換接上的，沒配到不會報錯。 */
  const sh = () => ({
    uniforms: {},
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  });
  const on = sh(); toonVC().onBeforeCompile(on, null);
  ok(!!on.uniforms.uSurfTexA && !!on.uniforms.uSurfTexB && on.uniforms.uSurfA.value.length === SURF_DEF.length,
    '兩張貼圖與材料表接上了');
  ok(on.vertexShader.includes('attribute vec4 aSurf;') && on.vertexShader.includes('vSurfP = (modelMatrix'),
    '頂點著色器讀得到 aSurf，也送出世界座標');
  ok((on.fragmentShader.match(/textureGrad\(/g) || []).length >= 3, '取樣帶著顯式導數（面與面的交界不會跳 mipmap 層級）');
  const iS = on.fragmentShader.indexOf('diffuseColor.rgb *= cpK;'), iB = on.fragmentShader.indexOf('float cpD = dot(');
  ok(iS > 0 && iB > iS, '紋路在五階調之前乘上去（紋路是材料的顏色，光照仍然只有五塊平調）');
  const off = sh(); toonVC({ surf: false }).onBeforeCompile(off, null);
  ok(!off.uniforms.uSurfTexA && !off.fragmentShader.includes('textureGrad') && off.fragmentShader.includes('cpTone = mix('),
    '?surf=0 那一份：沒有紋路，五階調還在');
  const dirt = sh(); toon(0x6a5844, SURF.dirt).onBeforeCompile(dirt, null);
  /* 單色材質的幾何沒有 aSurf——宣告了卻沒有那個屬性，WebGL 會拿常數
     (0,0,0,1) 餵它，材料就解成 0（素色）。所以那一行宣告必須包在
     `#ifndef CP_SURF_CONST` 裡，而 define 必須在它前面。 */
  const dv = dirt.vertexShader;
  const iDef = dv.indexOf(`#define CP_SURF_CONST ${SURF.dirt}`);
  const iAttr = dv.indexOf('attribute vec4 aSurf;');
  ok(iDef >= 0 && iAttr > iDef && dv.lastIndexOf('#ifndef CP_SURF_CONST', iAttr) > iDef,
    '單色材質（地面）用 define 指定材料，不讀頂點屬性');
  ok(toonVC().customProgramCacheKey() !== toonVC({ surf: false }).customProgramCacheKey()
    && toonVC().customProgramCacheKey() !== toon(0, SURF.dirt).customProgramCacheKey(),
    '三種接法各自一份程式（不會共用第一顆編出來的）');
}

head('缺角的石頭');
/* 缺角只動角上的三個頂點，所以它必須：外接盒一點都沒變（碰撞、支撐、
   牆芯那些驗證都是照外接盒算的）；每一個四邊形仍然是平的（兩個三角形
   同一個法線——不平的話那一面在分階著色下會斷成兩塊）；而且真的缺了。 */
{
  let boxBad = 0, flatBad = 0, same = 0;
  const sizes = [[0.93, 0.42, 1.1, 0.035], [1.48, 0.2, 1.48, 0.05], [0.4, 0.42, 0.8, 0.05], [0.55, 0.34, 0.42, 0.05]];
  for (const [w, h, d, ch] of sizes) {
    const g0 = stone(w, h, d, ch, 0);
    g0.computeBoundingBox();
    for (let v = 1; v <= 3; v++) {
      const g = stone(w, h, d, ch, v);
      g.computeBoundingBox();
      if (g.boundingBox.min.distanceTo(g0.boundingBox.min) > 1e-6 || g.boundingBox.max.distanceTo(g0.boundingBox.max) > 1e-6) boxBad++;
      const p = g.attributes.position.array, q = g0.attributes.position.array;
      let diff = 0;
      for (let i = 0; i < p.length; i++) diff = Math.max(diff, Math.abs(p[i] - q[i]));
      if (diff < 1e-4) same++;
      const n = g.attributes.normal.array;
      // 前 36 個三角形是 6 個面加 12 條邊，兩兩一組是同一個四邊形。
      for (let t = 0; t < 36; t += 2) {
        const a = t * 9, b = (t + 1) * 9;
        if (n[a] * n[b] + n[a + 1] * n[b + 1] + n[a + 2] * n[b + 2] < 0.9999) flatBad++;
      }
    }
  }
  ok(boxBad === 0, '缺角不改外接盒', `${boxBad}`);
  ok(flatBad === 0, '缺角之後每一個四邊形仍然是平的', `${flatBad}`);
  ok(same === 0, '每一種缺角的變體都真的缺了一塊', `${same} 個跟完整的一樣`);
}

head('每張圖的苔量');
/* 名冊的 `moss` 管兩件事：石頭頂面的苔（逐頂點的門檻 aMoss）與苔叢。
   兩件都要照那一張圖的苔量走，而且**苔量不准動到版面**——苔叢少長幾叢，
   亂數照樣要抽完，不然後面每一根柱子斷在哪、碎石撒在哪全部換掉。所以把
   每一張圖的苔量都調回 1 再砌一遍，兩遍的碰撞盒必須一模一樣。 */
{
  const bad = BLOCKS.filter((b) => b.moss !== undefined && !(b.moss >= 0 && b.moss <= 1));
  ok(bad.length === 0, '每一張圖的苔量都在 0～1', bad.map((b) => b.id).join('、'));
  ok(mossAt(1) === MOSS.at && mossAt(0) >= 1, '苔量 1 是預設門檻、0 是一塊都不長',
    `1→${mossAt(1).toFixed(3)}、0→${mossAt(0).toFixed(3)}`);
  let mono = true;
  for (let k = 0.1; k <= 1.001; k += 0.1) if (!(mossAt(k) <= mossAt(k - 0.1) + 1e-9)) mono = false;
  ok(mono, '苔量越多、門檻越低');

  const Mo = R.geometry.attributes.aMoss;
  ok(!!Mo && Mo.count === R.geometry.attributes.position.count && Mo.normalized, 'aMoss 的數量與頂點對得上');

  /* 一個頂點屬於哪一張圖：看它落在哪一道黑牆裡面。 */
  const blockOf = (x, z) => {
    for (const a of R.arenas) if (arenaGap(a, x, z) > -0.3) return a.id;
    return null;
  };
  const rate = Object.fromEntries(BLOCKS.map((b) => [b.id, b.moss ?? 1]));
  const want = Object.fromEntries(BLOCKS.map((b) => [b.id, Math.round(mossAt(rate[b.id]) * 255)]));
  const P = R.geometry.attributes.position.array, S = R.geometry.attributes.aSurf.array;
  let wrong = 0, where = null;
  for (let i = 0; i < Mo.count; i += 3) {             // 一個三角形取一個頂點
    const id = blockOf(P[i * 3], P[i * 3 + 2]);
    if (!id) continue;
    const isStone = (S[i * 4 + 3] >> 4) === SURF.stone;
    const exp = isStone ? want[id] : 255;
    if (Mo.array[i] !== exp) { wrong++; where = where || id; }
  }
  ok(wrong === 0, '石頭頂面的苔門檻照它那一張圖的苔量給，其他材料一律不長', wrong ? `${wrong} 個，例如 ${where}` : '');

  /* 苔叢：照那一張圖的苔量少長；苔量 0 的一叢都沒有。拿「全部調回 1」的
     那一遍當分母。苔量是「每一叢長不長」的機率，所以叢少的圖本來就會偏：
     容許的誤差照叢數給（2.5 個標準差，至少 15%）。一叢平均 3.5 塊幾何。 */
  const saved = BLOCKS.map((b) => b.moss);
  for (const b of BLOCKS) b.moss = 1;
  const R1 = buildRuins({ record: true });
  BLOCKS.forEach((b, i) => { b.moss = saved[i]; });
  const tufts = (RR) => {
    const n = {};
    for (const q of RR.parts) {
      if (q.tag !== 'moss') continue;
      const id = blockOf((q.min[0] + q.max[0]) / 2, (q.min[2] + q.max[2]) / 2);
      if (id) n[id] = (n[id] || 0) + 1;
    }
    return n;
  };
  const n0 = tufts(R), n1 = tufts(R1);
  const off = [];
  for (const b of BLOCKS) {
    const k = rate[b.id], a = n0[b.id] || 0, full = n1[b.id] || 0;
    const tol = Math.max(0.15, 2.5 * Math.sqrt((k * (1 - k)) / Math.max(1, full / 3.5)));
    if (k === 0 ? a !== 0 : k === 1 ? a !== full : Math.abs(a / Math.max(full, 1) - k) > tol) {
      off.push(`${b.id} ${a}/${full}（要 ${k}）`);
    }
  }
  console.log('  苔叢：' + BLOCKS.map((b) => `${b.name} ${n0[b.id] || 0}/${n1[b.id] || 0}`).join('、'));
  ok(off.length === 0, '苔叢照每一張圖的苔量長，苔量 0 的一叢都沒有', off.join('、'));
  const same = R.colliders.length === R1.colliders.length
    && R.colliders.every((c, i) => c.min.every((v, k) => v === R1.colliders[i].min[k])
      && c.max.every((v, k) => v === R1.colliders[i].max[k]));
  const flamesSame = R.flames.length === R1.flames.length
    && R.flames.every((f, i) => f.x === R1.flames[i].x && f.z === R1.flames[i].z);
  ok(same && flamesSame, '苔量不動版面（碰撞盒與火盆跟全開那一遍一模一樣）');
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
        // 門洞（`hole`）裡本來就是空的。
        if (w.hole && u > w.hole.u[0] && u < w.hole.u[1] && y > w.hole.y[0] && y < w.hole.y[1]) continue;
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

head('轉向不欠帳');
/* 這一段完全不碰地形：驗的是 steer 本身。開闊地上跑一段，每幀 steer
   再積分，然後量軌跡——這跟頁面每幀做的是同一支函式。 */
{
  const dt = 1 / 60;
  const drive = (v0, dir, want, seconds) => {
    let vx = v0[0], vz = v0[1], x = 0, z = 0;
    const path = [];
    for (let t = dt; t <= seconds + 1e-9; t += dt) {
      [vx, vz] = steer(vx, vz, dir[0], dir[1], want, dt);
      x += vx * dt; z += vz * dt;
      path.push({ t, x, z, vx, vz });
    }
    return path;
  };

  /* 全速往 +z 跑，然後推 +x。舊的向量加速要 0.33 秒才轉完，這段期間
     往 +z 還會多滑 1.3 公尺——那 1.3 公尺就是操作誤差。 */
  const turn = drive([0, PHYS.run], [1, 0], PHYS.run, 1);
  const side = Math.max(...turn.map((p) => Math.abs(p.z)));
  ok(side < 1e-9, '轉 90° 之後一公分都不往舊方向跑', `側移 ${side.toExponential(1)} m`);
  ok(turn[0].x > 0 && turn.every((p) => p.vx >= 0), '轉 90° 的第一幀就已經往新方向走');

  /* 直線反向：轉向雖然是瞬間的，動量還在——沿著新方向的那一份投影是
     −8，所以照舊要減速到 0 再加速。這一項是「只有轉向沒有延遲」的另
     一半，少了它，全速反向會變成瞬移。 */
  const rev = drive([0, PHYS.run], [0, -1], PHYS.run, 1);
  const cross = rev.find((p) => p.vz <= 0).t;
  const full = rev.find((p) => p.vz <= -PHYS.run + 1e-9).t;
  const wantCross = PHYS.run / PHYS.accel, wantFull = (2 * PHYS.run) / PHYS.accel;
  ok(Math.abs(cross - wantCross) < 2 * dt, '直線反向仍然要先減速到 0',
    `${cross.toFixed(3)} 秒 / 該是 ${wantCross.toFixed(3)}`);
  ok(Math.abs(full - wantFull) < 2 * dt, '反向到全速的時間沒有變',
    `${full.toFixed(3)} 秒 / 該是 ${wantFull.toFixed(3)}`);
  const over = Math.max(...rev.map((p) => p.z));
  /* v²/2a。逐幀積分會比它少半幀的位移（每幀先減速再位移），所以容差
     給一幀的位移量，不是「差不多就好」。 */
  const wantOver = (PHYS.run * PHYS.run) / (2 * PHYS.accel);
  ok(Math.abs(over - wantOver) < PHYS.run * dt, '反向期間還會往前多跑一段（動量沒有被偷走）',
    `${over.toFixed(2)} m / 連續的算法是 ${wantOver.toFixed(2)}`);

  /* 放開手：方向留著（player.aim 不會被清掉），所以是沿著原來那條線
     減速，不是原地亂飄。 */
  const stop = drive([0, PHYS.run], [0, 1], 0, 1);
  ok(stop.every((p) => p.x === 0 && p.vx === 0), '放開手是沿著原來那條線減速');
  const stopT = stop.find((p) => p.vz <= 1e-9).t;
  ok(Math.abs(stopT - PHYS.run / PHYS.brake) < 2 * dt, '煞停的時間沒有變',
    `${stopT.toFixed(3)} 秒 / 該是 ${(PHYS.run / PHYS.brake).toFixed(3)}`);

  /* 轉向本身只是一次投影，所以小角度幾乎不損速。單看投影，不讓加速
     插手（想要的速率就給成投影後的速率）——不然一幀的 accel 0.57 比
     11.5° 的損失 0.16 還大，一幀就補回來了，什麼也量不到。 */
  const th = 0.2, k = Math.cos(th);
  const [lx, lz] = steer(0, PHYS.run, Math.sin(th), Math.cos(th), PHYS.run * k, dt);
  ok(Math.abs(Math.hypot(lx, lz) - PHYS.run * k) < 1e-9
    && Math.abs(Math.atan2(lx, lz) - th) < 1e-9,
    `轉向只是一次投影：轉 ${(th * 180 / Math.PI).toFixed(1)}° 只損失 ${((1 - k) * 100).toFixed(1)}%`);
}

head('每個區塊的中心是空的');
const COLS = R.colliders;
for (const b of BLOCKS) for (const c of areasOf(b)) {
  let holes = 0, walls = 0, worst = 0;
  const step = 0.5;
  for (let x = -c.hx; x <= c.hx + 1e-6; x += step) {
    for (let z = -c.hz; z <= c.hz + 1e-6; z += step) {
      const wx = c.wx + x, wz = c.wz + z;
      const sup = supportAt(COLS, wx, wz, c.y + 0.1);
      if (Math.abs(sup - c.y) > 0.06) { holes++; worst = Math.max(worst, Math.abs(sup - c.y)); }
      const [px, pz] = solveXZ(COLS, wx, wz, c.y);
      if (Math.hypot(px - wx, pz - wz) > 1e-6) walls++;
    }
  }
  const n = Math.round((2 * c.hx / step + 1) * (2 * c.hz / step + 1));
  ok(holes === 0, `${c.name}：${(c.hx * 2).toFixed(0)}×${(c.hz * 2).toFixed(0)} 全是平的`,
    holes ? `${holes}/${n} 格高度不符，最差 ${worst.toFixed(2)} m` : `${n} 格`);
  ok(walls === 0, `${c.name}：空地裡沒有擋路的東西`, walls ? `${walls}/${n} 格被推開` : '');
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
  const [ox, oz] = b.origin;
  const spawn = R.spawns[b.id];
  const sup = supportAt(COLS, spawn[0], spawn[2], spawn[1] + 0.4);
  ok(Math.abs(sup - spawn[1]) < 0.5, `${b.name}：出生點站得住`, `支撐 ${sup.toFixed(2)} / 期望 ${spawn[1].toFixed(2)}`);
  const [px, pz] = solveXZ(COLS, spawn[0], spawn[2], spawn[1]);
  ok(Math.hypot(px - spawn[0], pz - spawn[2]) < 1e-6, `${b.name}：出生點不在牆裡`);
  for (const c of areasOf(b)) {
    const start = c.from ? R.arrivals[c.from] : null;
    const route = [...(c.via || []).map(([vx, vz]) => [ox + vx, 0, oz + vz]), [c.wx, c.y, c.wz]];
    let from = start ? [start.x, start.y, start.z] : spawn, arrived = true, secs = 0, worst = null;
    for (const leg of route) {
      const res = walkTo(from, leg);
      secs += res.t;
      if (!res.arrived) { arrived = false; worst = res; break; }
      // 下一段從「真的走到的地方」接下去，不是從轉折點的 y = 0 接：
      // 上到一半的樓梯上，y = 0 是石階的內部。
      from = res.at;
    }
    ok(arrived, `${c.name}：走得到中心`,
      (arrived ? `${secs.toFixed(1)} 秒${c.via ? `（經 ${c.via.length} 個轉折）` : ''}`
        : `最近只到 ${worst.best.toFixed(1)} m${worst.fell ? '（掉下去了）' : ''}`)
      + (start ? `（從到達點 ${c.from}）` : ''));
  }
}

head('門洞進得去也回得來');
/* 以前這一項驗的是「從中心走得出去」。現在室內那三個房間的黑牆貼在牆面
   上，門洞後面就是黑牆——走不出去是設計，不是 bug。

   所以改驗一件仍然會壞、而且看不出來的事：**進得去也回得來**。拱洞後面
   剩下的那條縫只有幾十公分寬，而身體的半徑是 0.30；碰撞是逐盒推出的，
   兩個方向相反的推力（拱的墩柱與黑牆）有可能把身體夾在中間推來推去，
   那時候畫面上什麼都沒發生，人就是走不動了。 */
/* 每個房間的一個門洞，以及走到它那裡的轉折點。轉折點是必要的：驗證用的
   走法是朝目標直線走，而直線穿過拱廊的墩柱是走不過去的——真人也不會
   那樣走。中庭與水窖的座標都落在拱洞的正中間（拱廊的洞口每 4.05 公尺
   一個、環牆的門在每一段的中點 11.25°），不是隨手挑的。 */
/* 每一條是 [哪一片空地（CENTERS 那一串的第幾個）, 轉折點…]。 */
const HOLES = {
  courtyard: [[0, [-12.6, 0], [-13.4, 0]]],
  // 王座廳：走到正門那堆亂石前（門關著）。
  throne: [[0, [0, -12.0], [0, -13.0]]],
  // 水窖：走進東門，到封死的鐵閘前。
  cistern: [[0, [11.6, 2.3], [12.2, 2.45]]],
  wallwalk: [
    // 兵營：走進城門洞，到放下的鐵閘前（鐵閘在 z = 2.3，身體停在 1.85）。
    [0, [0, -5], [0, 1.2]],
    // 兵營：塔腳那扇門前留著的那條空地——從小路中段直線走到門前的到達點，中間什麼都不准擋。
    [0, [2.2, -17], [16.9, -6.9]],
    // 牆頂：走道沒有門洞通到外面。驗的是走進西邊方塔的塔頂再回來。
    [1, [-12, 2.4], [-12, 5.8]],
  ],
  // 墓室：走上南端那道樓梯，到鐵閘前的平台。
  crypt: [[0, [0, -8.0], [0, -13.0]]],
  // 窄巷：走出巷口，進廣場、繞到井的東邊。
  alley: [[0, [0, 5], [3.6, 9.0]]],
};
for (const b of BLOCKS) for (const [ai, ...legs] of HOLES[b.id]) {
  const c = areasOf(b)[ai];
  const [ox, oz] = b.origin;
  let from = [c.wx, c.y, c.wz], went = true, worst = null;
  for (const [vx, vz] of legs) {
    const res = walkTo(from, [ox + vx, 0, oz + vz]);
    if (!res.arrived) { went = false; worst = res; break; }
    from = res.at;
  }
  ok(went, `${c.name}：走到門洞裡`, went ? '' : `卡在還差 ${worst.best.toFixed(1)} m 的地方`);
  if (!went) continue;
  // 回頭走同一條路（不是直線切回中心——那會撞到自己剛剛繞過的牆）。
  const back = [...legs].reverse().slice(1).map(([vx, vz]) => [ox + vx, 0, oz + vz]);
  back.push([c.wx, c.y, c.wz]);
  let ret = true, rworst = null, secs = 0;
  for (const leg of back) {
    const res = walkTo(from, leg, 40);
    secs += res.t;
    if (!res.arrived) { ret = false; rworst = res; break; }
    from = res.at;
  }
  ok(ret, `${c.name}：從門洞走得回來`,
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
              該是空的東西（水窖的懸臂石階、圓塔門洞的橫楣）在碰撞盒上標
              `open`，不算。
     回不來   每一個走得到的格子都要走得回出生點。水窖以前可以從殘階頂
              跳上環牆、往外掉進牆與黑牆之間那條縫，掉進去就只剩重生。

   碰撞盒先照場地的外接框篩一次：四個場地相隔六十公尺，全掃的話九成
   的時間花在問另外三個場地的盒子。

   感測區：走進去就被送走，所以那一格不往四周長，只接到目的地。目的地在
   同一個區塊裡（圓塔的兩扇門）就接著淹；在別的區塊裡（井、黑霧）就是這個
   區塊的一個**出口**——那一格算「回得去」，因為走得出去的地方不是困住，
   而目的地那一邊的路由那個區塊自己驗（見「傳送點」那一項）。

   有門的區塊，門的每一種狀態各淹一遍：門是執行時開關的，兩種狀態都是
   玩家會走到的地圖。 */
{
  const G = 0.2;
  const snap = (v) => Math.round(v * 20) / 20;
  for (const b of BLOCKS) {
    const groups = Object.keys(R.doors).filter((g) => g.startsWith(`${b.id}.`));
    for (let mask = 0; mask < 1 << groups.length; mask++) {
      const doors = Object.fromEntries(groups.map((g, i) => [g, !!(mask & (1 << i))]));
      const tag = groups.map((g, i) => `${g.split('.')[1]}${mask & (1 << i) ? '開' : '關'}`).join('、');
      flood(b, doors, tag ? `（門：${tag}）` : '');
    }
  }
  function flood(b, doors, tag) {
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
      const [sx, sz] = solveXZ(cols, nx, nz, y, doors);
      return Math.hypot(sx - nx, sz - nz) <= 0.03;
    };
    const sp = R.spawns[b.id];
    const key = (i, k, y) => `${i},${k},${y}`;
    const i0 = Math.round(sp[0] / G), k0 = Math.round(sp[2] / G);
    const s0 = key(i0, k0, snap(supportAt(cols, i0 * G, k0 * G, sp[1] + 0.2)));
    const from = new Map([[s0, []]]);   // 格子 → 走得到它的那些格子
    const queue = [s0];
    const hollow = [];
    const exits = [];                    // 走進去就到別的區塊的那些格子
    const drops = [];                    // 從空氣牆圍著的那一層，不經過門就下去的那幾步
    const deck = b.fenced ? b.fenced - 0.05 : Infinity;
    for (let h = 0; h < queue.length; h++) {
      const s = queue[h];
      const [i, k, y] = s.split(',').map(Number);
      const x = i * G, z = k * G;
      /* 懸臂石階（`open`）底下本來就是空的，走進去不算空心；但它仍然是
         天花板，跳的時候照樣要算淨空。 */
      const { lo: lid, open } = overhead(x, z, y);
      if (lid - y < 3 && !open) hollow.push([x - ox, z - oz, y]);
      /* 感測區：走進去的那一刻就被送走，所以這一格不往四周長。送到同一個
         區塊裡就接著淹（那也是一步，所以門兩邊的格子互相回得去）；送到別的
         區塊就記成出口。 */
      const gate = portalAt(R.portals, x, y, z, doors);
      if (gate) {
        const d = gate.dest;
        if (d.block !== b.id) { exits.push(s); continue; }
        const ti = Math.round(d.x / G), tk = Math.round(d.z / G);
        const t = key(ti, tk, snap(supportAt(cols, ti * G, tk * G, d.y + 0.2)));
        if (!from.has(t)) { from.set(t, []); queue.push(t); }
        from.get(t).push(s);
        continue;
      }
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
          if (y >= deck && ny < deck) drops.push([x - ox, z - oz, ny]);
          if (!from.has(t)) { from.set(t, []); queue.push(t); }
          from.get(t).push(s);
        }
      }
    }
    // 回得去：從出生點與每一個出口倒著走回來。
    const back = new Set([s0, ...exits]);
    const stack = [s0, ...exits];
    while (stack.length) {
      for (const p of from.get(stack.pop())) if (!back.has(p)) { back.add(p); stack.push(p); }
    }
    const stuck = queue.filter((s) => !back.has(s)).map((s) => {
      const [i, k, y] = s.split(',').map(Number);
      return [i * G - ox, k * G - oz, y];
    });
    const at = (p) => `(${p[0].toFixed(1)}, ${p[2]}, ${p[1].toFixed(1)})`;
    const high = queue.filter((s) => +s.split(',')[2] >= deck).length;
    ok(hollow.length === 0, `${b.name}${tag}：沒有鑽得進去的空心`,
      (hollow.length ? `${hollow.length} 格，例如 ${at(hollow[0])}` : `${queue.length} 格走得到`)
      + (b.fenced ? `（牆頂 ${high} 格）` : '') + (exits.length ? `、${exits.length} 格是出口` : ''));
    ok(stuck.length === 0, `${b.name}${tag}：每個走得到的地方都走得回出生點或出口`,
      stuck.length ? `${stuck.length} 格回不來，例如 ${at(stuck[0])}` : '');
    /* 圍著空氣牆的那一層：從那一層走、跳，腳都不准落到它下面——只有門
       （感測區）上下得了。空氣牆漏一段的話，這一項就會找到從那裡跳下去
       的那一步。 */
    if (b.fenced) {
      ok(drops.length === 0, `${b.name}${tag}：牆頂只從門上下，走、跳都下不去`,
        drops.length ? `${drops.length} 步掉下去了，例如落在 ${at(drops[0])}` : '');
      // 門全部關著：從出生點（地上）一格牆頂都到不了。
      if (!Object.values(doors).some(Boolean)) ok(high === 0, `${b.name}${tag}：門關著上不了牆頂`, `${high} 格`);
    }
  }
}

head('坑都有出口');
/* 坑（開著的井）底下沒有路上來，出口是感測區：碰到就被送走。兩件事要成立：
   每一個坑的坑底都在某一個感測區裡（不然掉下去就只剩按 R），以及用 main.js
   那一套垂直積分真的從坑口掉下去，會在幾秒內碰到它、被送到一個站得住的地方。
   坑底的感測區不屬於任何一組門（門關著的話掉下去就出不來），所以這裡不給門的狀態。 */
{
  const pits = COLS.filter((c) => c.kind === 'pit');
  ok(pits.length > 0, '有登記坑', `${pits.length} 個`);
  for (const c of pits) {
    const gate = portalAt(R.portals, c.x, c.bottom, c.z);
    const name = gate ? BLOCKS.find((q) => q.id === gate.dest.block).name : '';
    ok(!!gate, '坑底在一個感測區裡', gate ? `送到 ${name}（${gate.to}）` : `(${c.x.toFixed(1)}, ${c.z.toFixed(1)}) 底下什麼都沒有`);
    if (!gate) continue;
    const dt = 1 / 60;
    const p = { x: c.x, y: c.top + 1.2, z: c.z, vy: 0 };
    let hit = null, t = 0;
    for (; t < 4 && !hit; t += dt) {
      const [sx, sz] = solveXZ(COLS, p.x, p.z, p.y);
      p.x = sx; p.z = sz;
      const prevY = p.y;
      p.vy -= PHYS.gravity * dt;
      p.y += p.vy * dt;
      const sup = supportAt(COLS, p.x, p.z, prevY);
      if (p.y <= sup && p.vy <= 0) { p.y = sup; p.vy = 0; }
      hit = portalAt(R.portals, p.x, p.y, p.z);
    }
    ok(!!hit, '從坑口掉下去會碰到感測區', hit ? `${t.toFixed(2)} 秒，碰到時在 y ${p.y.toFixed(1)}` : `4 秒後停在 y ${p.y.toFixed(1)}`);
    if (hit) {
      // 到達點可以在半空中（掉下來），落點由「傳送點」那一項驗。這裡只問底下接得住。
      const d = hit.dest;
      const sup = supportAt(COLS, d.x, d.z, d.y + 0.2);
      ok(sup > d.y - 4 && sup <= d.y + 0.05, '送到的地方底下接得住', `${name}，落在 ${sup.toFixed(2)}（到達點 ${d.y}）`);
    }
  }
}

head('傳送點');
/* 感測區送人去的地方（到達點）。每一個都要成立三件事：

     1. 在目的地那個區塊的黑牆裡，落得下來、站得住、不在牆裡。
     2. 不在任何一個感測區裡——不然一落地就又被送走，兩邊來回彈。門全部
        開著的時候問：那是感測區最多的時候。掉下來的到達點，整段落下都問。
     3. 不是單向的（井）就要有回程：目的地那個區塊裡有一個感測區把人送回這一個
        旁邊，而且從到達點用真的物理走得進它（門全部開著）。 */
{
  const ALL = Object.fromEntries(Object.keys(R.doors).map((g) => [g, true]));
  const centerOf = (p) => (p.shape === 'box' ? [(p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2] : [p.x, p.z]);
  /** 朝 target 走，碰到感測區就停（跟 main.js 一樣，每一步問一次）。 */
  const walkInto = (from, target, doors, seconds = 20) => {
    const dt = 1 / 60;
    const p = { x: from[0], y: from[1] + 0.2, z: from[2], vy: 0 };
    let best = Infinity;
    for (let t = 0; t < seconds; t += dt) {
      const dx = target[0] - p.x, dz = target[1] - p.z;
      const d = Math.hypot(dx, dz) || 1e-9;
      best = Math.min(best, d);
      const [sx, sz] = solveXZ(COLS, p.x + (dx / d) * PHYS.walk * dt, p.z + (dz / d) * PHYS.walk * dt, p.y, doors);
      p.x = sx; p.z = sz;
      const prevY = p.y;
      p.vy -= PHYS.gravity * dt;
      p.y += p.vy * dt;
      const sup = supportAt(COLS, p.x, p.z, prevY);
      if (p.y <= sup && p.vy <= 0) { p.y = sup; p.vy = 0; }
      const gate = portalAt(R.portals, p.x, p.y, p.z, doors);
      if (gate) return { gate, t, best };
    }
    return { gate: null, t: seconds, best };
  };
  ok(R.portals.length >= 5, '感測區都登記了', `${R.portals.length} 個`);
  for (const p of R.portals) {
    const d = p.dest;
    const label = `${p.block} → ${p.to}`;
    const A = R.arenas.find((a) => a.id === d.block);
    const sup = supportAt(COLS, d.x, d.z, d.y + 0.2);
    const [sx, sz] = solveXZ(COLS, d.x, d.z, sup);
    ok(arenaGap(A, d.x, d.z) > PHYS.radius && sup <= d.y + 0.05 && d.y - sup < 4
      && Math.hypot(sx - d.x, sz - d.z) < 1e-6, `${label}：到達點落得下來、站得住`,
      `落在 y ${sup.toFixed(2)}${d.y > sup + 0.05 ? `（從 ${d.y} 掉下來）` : ''}`);
    let bounce = null;
    for (let y = sup; y <= d.y + 0.25 && !bounce; y += 0.1) bounce = portalAt(R.portals, d.x, y, d.z, ALL);
    ok(!bounce, `${label}：到達點不在任何感測區裡`, bounce ? `落在 ${bounce.block} → ${bounce.to} 那一塊裡` : '');
    if (p.oneWay) continue;
    /* 回程：目的地那個區塊裡送回這個區塊的感測區裡，落點離這一塊最近的那一個。
       兩頭可以各有各的門（中庭的鐵閘與王座廳的鐵閘是兩組，各自在自己的區塊裡
       按 O），所以不要求同一組門；走回去的時候門全部開著。 */
    const [px, pz] = centerOf(p);
    const far = (q) => Math.hypot(q.dest.x - px, q.dest.z - pz);
    const back = R.portals.filter((q) => q.block === d.block && q.dest.block === p.block)
      .sort((a, b) => far(a) - far(b)).find((q) => far(q) < 8);
    ok(!!back, `${label}：有回程`, back ? `${back.block} → ${back.to}` : '目的地那一邊沒有送回這裡的感測區');
    if (!back) continue;
    const res = walkInto([d.x, sup, d.z], centerOf(back), ALL);
    ok(res.gate === back, `${label}：從到達點走得進回程的那一塊`,
      res.gate === back ? `${res.t.toFixed(1)} 秒`
        : res.gate ? `先碰到了 ${res.gate.block} → ${res.gate.to}` : `最近只到 ${res.best.toFixed(1)} m`);
  }
}

head('門');
/* 一組門是幾扇一起開關的門（在那個區塊裡按 O）。每一組都要：

     · 至少一個感測區，而且每一個都登記了門口（`mouth`）。
     · 看得出開關：每一扇門（每一個感測區的門口）旁邊，有一塊會隨著開關換掉的
       門扇（`pieces`），或者一塊路標（`signs`）。有門扇的門，兩種狀態各一塊
       （關著的木門、放下的鐵閘、堵住的亂石；開著的門洞、升起的鐵閘）——開著那一塊
       可以是空的：亂石清走了，看得出來的是它不見了。只有路標的門沒有門扇：關著就是
       一個走得進去、什麼都不會發生的拱洞。
     · 門扇、門洞的黑霧與路標都在自己那個區塊的黑牆裡（它們不進合併的那一份，
       「黑牆沒有切到任何幾何」那一項看不到它們）。

   開著的門洞裡有黑霧的（圓塔的門），要再成立三件事：
     · 最裡面那一層是實心的（α = 1）——不然看得穿甬道，看到塔裡面。
     · 每一片都朝門外（法線跟門面同向）。材質是單面的，朝裡的話整片被剔掉，
       畫面上是「門開了但洞裡是亮的」，跟「黑霧沒做」長得一模一樣。
     · 每一片都在塔的碰撞圓柱裡面：黑霧在門面**以內**。伸出門面的話，走到
       門前會先穿過一片霧。（門開著的時候狗走得進去、穿過前面幾層才被送走，
       那是要的：牠是走進黑裡不見的。）

   登記了門洞（`hole`：兩側門框石、上面頂板、下面地板圍出來的那一塊，從門面
   到甬道盡頭）的門，洞裡面沒有一個三角形。門框以外的東西會插進來：門洞兩側
   那兩段塔牆錯開半塊的端磚，還有一路砌到塔心的幕牆——塔腳那扇門的甬道正好
   穿過它城內那一面。關著看不到，開著隔著幾層淡霧就是一塊磚擋在洞裡。量的是
   三角形切進盒子裡（每一片用盒子的六個面裁一次，裁完還剩一塊就是切進去了），
   不是頂點：一塊斜插進來的磚，它的角可以全部在盒子外面。

   每一扇門，從門口外兩公尺朝門直直走進去（真的物理）：
     · 關著：沒被送走；有門扇的話停在門前，身體不碰到門扇。
     · 開著：被送走的那一刻，身體的中心在門面內超過 `inset`——預設是狗的後半身
       （0.48，1 公尺高的狗量出來的），狗整隻走進門洞才被送走。沒有這一條，
       感測區悄悄退回門口，狗就又是在門前消失，看不出牠走進了門。貼在牆上、
       走不進去的門給負的：鼻子碰到門面之前就送。 */
{
  const P = R.geometry.attributes.position.array;
  /** 多邊形留下 axis 那一軸 ≥ v（sign = 1）或 ≤ v（sign = −1）的那一側。 */
  const cut = (poly, axis, v, sign) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ia = sign * (a[axis] - v) >= 0, ib = sign * (b[axis] - v) >= 0;
      if (ia) out.push(a);
      if (ia !== ib) { const t = (v - a[axis]) / (b[axis] - a[axis]); out.push(a.map((x, j) => x + (b[j] - x) * t)); }
    }
    return out;
  };
  /** 合併那一份裡，有三角形切進 [lo, hi] 這個盒子的幾塊。 */
  const intruders = (lo, hi) => {
    const hits = [];
    for (let k = 0; k < R.parts.length; k++) {
      const q = R.parts[k];
      if ([0, 1, 2].some((j) => q.max[j] <= lo[j] || q.min[j] >= hi[j])) continue;
      const end = k + 1 < R.parts.length ? R.parts[k + 1].i0 : P.length;
      for (let i = q.i0; i < end; i += 9) {
        let poly = [0, 3, 6].map((o) => [P[i + o], P[i + o + 1], P[i + o + 2]]);
        for (let j = 0; j < 3 && poly.length; j++) poly = cut(cut(poly, j, lo[j], 1), j, hi[j], -1);
        if (poly.length >= 3) { hits.push(q); break; }
      }
    }
    return hits;
  };
  const inside = (x, y, z) => COLS.some((c) => c.kind !== 'bound' && c.kind !== 'pit' && !c.air
    && y >= c.min[1] - 1e-3 && y <= c.max[1] + 1e-3
    && (c.shape === 'circle' ? Math.hypot(x - c.x, z - c.z) <= c.r + 1e-3
      : x >= c.min[0] - 1e-3 && x <= c.max[0] + 1e-3 && z >= c.min[2] - 1e-3 && z <= c.max[2] + 1e-3));
  /** 一塊門扇（或門洞）離門口 (x, z) 最近的頂點有多遠。 */
  const nearest = (q, x, z) => {
    let best = Infinity;
    for (const V of [q.geometry.attributes.position.array, q.haze.pos]) {
      for (let i = 0; i < V.length; i += 3) best = Math.min(best, Math.hypot(V[i] - x, V[i + 2] - z));
    }
    return best;
  };
  const DOG_BACK = 0.48;
  const signs = R.signs || [];
  for (const [g, open0] of Object.entries(R.doors)) {
    const mine = R.pieces.filter((q) => q.door === g);
    const marks = signs.filter((s) => s.door === g);
    const nOpen = mine.filter((q) => q.open).length, nShut = mine.length - nOpen;
    ok(nOpen === nShut, `${g}：有門扇的門兩種狀態各一塊`, `開 ${nOpen}、關 ${nShut}、路標 ${marks.length}`);
    const gates = R.portals.filter((p) => p.door === g);
    ok(gates.length >= 1 && gates.every((p) => p.mouth), `${g}：開著的時候有感測區，每一個都登記了門口`,
      `${gates.length} 個感測區`);
    const A = R.arenas.find((a) => a.id === g.split('.')[0]);
    let worst = Infinity;
    for (const q of mine) {
      for (const V of [q.geometry.attributes.position.array, q.haze.pos]) {
        for (let i = 0; i < V.length; i += 3) worst = Math.min(worst, arenaGap(A, V[i], V[i + 2]));
      }
    }
    for (const s of marks) worst = Math.min(worst, arenaGap(A, s.x, s.z));
    ok(worst > 0, `${g}：門扇、門洞的黑霧與路標在黑牆裡`, `離黑牆最近 ${worst.toFixed(2)} m`);

    for (const q of mine.filter((m) => m.open && m.haze.alpha.length)) {
      const H = q.haze, [fx, fz] = q.face;
      const layers = new Set(), solid = [...H.alpha].some((a) => a >= 1);
      let back = 0, out = 0;
      for (let i = 0; i < H.pos.length; i += 9) {
        const p = H.pos;
        const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
        const wx = p[i + 6] - p[i], wy = p[i + 7] - p[i + 1], wz = p[i + 8] - p[i + 2];
        const nx = uy * wz - uz * wy, nz = ux * wy - uy * wx;
        if (nx * fx + nz * fz <= 0) back++;
        for (let k = 0; k < 9; k += 3) if (!inside(p[i + k], p[i + k + 1], p[i + k + 2])) out++;
        layers.add(H.alpha[i / 3]);
      }
      const where = `朝 (${fx.toFixed(0)}, ${fz.toFixed(0)}) 的那一扇`;
      ok(solid, `${g}：${where}開著，門洞裡有黑霧、盡頭是實心的黑`, `${layers.size} 層`);
      ok(back === 0, `${g}：${where}的黑霧每一片都朝門外`, back ? `${back} 片朝裡` : '');
      ok(out === 0, `${g}：${where}的黑霧在門面以內`, out ? `${out} 個頂點露在外面` : '');
    }
    for (const q of mine.filter((m) => m.open && m.hole)) {
      // 貼著門框的面是門框自己，所以盒子往裡收 2 公分。
      const e = 0.02, lo = q.hole[0].map((v) => v + e), hi = q.hole[1].map((v) => v - e);
      const hits = intruders(lo, hi);
      ok(hits.length === 0, `${g}：朝 (${q.face.map((v) => v.toFixed(0))}) 的門洞裡沒有門框以外的磚`,
        hits.length ? hits.slice(0, 3).map((h) => `(${h.min.map((v) => v.toFixed(1))})`).join(' ') : '');
    }

    for (const p of gates.filter((q) => q.mouth)) {
      // 門的局部座標：m 沿門面的法線（往門外、走過來的人那一邊是正，門面是 0）。
      const { x: mx, y: sill, z: mz, n: [fx, fz] } = p.mouth;
      const need = p.mouth.inset ?? DOG_BACK;
      const m = (x, z) => fx * (x - mx) + fz * (z - mz);
      const where = `往 ${p.to} 的那一扇`;
      const shown = mine.some((q) => nearest(q, mx, mz) < 4)
        || marks.some((s) => Math.hypot(s.x - mx, s.z - mz) < 4);
      ok(shown, `${g}：${where}看得出開關`, shown ? '' : '門口四公尺內沒有門扇，也沒有路標');
      const walkIn = (doors) => {
        const dt = 1 / 60;
        const q = { x: mx + fx * 2, z: mz + fz * 2, y: sill };
        const target = [mx - fx, mz - fz];
        for (let t = 0; t < 3; t += dt) {
          const dx = target[0] - q.x, dz = target[1] - q.z, d = Math.hypot(dx, dz) || 1e-9;
          [q.x, q.z] = solveXZ(COLS, q.x + (dx / d) * PHYS.walk * dt, q.z + (dz / d) * PHYS.walk * dt, q.y, doors);
          q.y = supportAt(COLS, q.x, q.z, q.y + 0.1);
          const hit = portalAt(R.portals, q.x, q.y, q.z, doors);
          if (hit) return { sent: hit === p, other: hit === p ? null : hit, m: m(q.x, q.z) };
        }
        return { sent: false, other: null, m: m(q.x, q.z) };
      };
      /* 關著的門扇：門口四公尺內、關著那一塊的頂點裡最靠門外的那一個（木門最外面
         那一點是鐵條，鐵閘是柵條與尖刺）。只有路標的門沒有門扇。 */
      let leaf = -Infinity;
      for (const q of mine.filter((k) => !k.open)) {
        const V = q.geometry.attributes.position.array;
        for (let i = 0; i < V.length; i += 3) {
          if (Math.hypot(V[i] - mx, V[i + 2] - mz) < 4) leaf = Math.max(leaf, m(V[i], V[i + 2]));
        }
      }
      const shut = walkIn({});
      const front = shut.m - PHYS.radius;
      ok(!shut.sent && !shut.other && front > leaf,
        `${g}：${where}關著，沒被送走${leaf > -Infinity ? '、停在門前' : ''}`,
        leaf > -Infinity ? `前緣離門扇 ${(front - leaf).toFixed(2)} m`
          : `停在門面${shut.m < 0 ? '內' : '外'} ${Math.abs(shut.m).toFixed(2)} m`);
      const open = walkIn({ [g]: true });
      ok(open.sent && -open.m > need,
        `${g}：${where}開著，${need > 0 ? '狗整隻走進門洞才被送走' : '走到門面前就被送走'}`,
        open.sent ? `送走時中心在門面${open.m < 0 ? '內' : '外'} ${Math.abs(open.m).toFixed(2)} m`
          : open.other ? `先碰到了 ${open.other.block} → ${open.other.to}` : `沒被送走，停在門面外 ${open.m.toFixed(2)} m`);
    }
    console.log(`  ${g} 一開始${open0 ? '開著' : '關著'}`);
  }
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
     4. 貼合。黑牆要貼在砌體的外皮上（差 1 公尺以內）——城牆步道是那座切在
        黑牆上的圓塔。這一項看不出來：黑牆離牆面兩公尺或十公尺，站在房間
        中央看起來一模一樣，只有走到牆邊才會發現外面多了一圈到不了的空地。
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
  /** 從 start 朝十六個方向各走到底：走出黑牆幾次、離黑牆最近多少、腳落到 floorY 以下幾次。 */
  const sweep = (start, floorY) => {
    let escaped = 0, tight = Infinity, dropped = 0;
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      const far = 60;
      const res = walkTo(start, [start[0] + Math.cos(ang) * far, 0, start[2] + Math.sin(ang) * far], 30);
      if (!res.at) continue;                       // 掉下去了（另一項在驗）
      const gap = arenaGap(a, res.at[0], res.at[2]);
      if (gap < -1e-3) escaped++;
      if (gap < tight) tight = gap;
      if (res.at[1] < floorY - 0.05) dropped++;
    }
    return { escaped, tight, dropped };
  };
  const { escaped, tight } = sweep(spawn, spawn[1]);
  ok(escaped === 0, `${name}：十六個方向都走不出黑牆`,
    escaped ? `${escaped}/16 出去了` : `${a.shape === 'circle' ? `半徑 ${a.r}` : '方形'} m`);
  /* 圍著空氣牆的那一層（城牆步道的走道）走不到黑牆腳下——空氣牆先擋住了。
     那裡要驗的是另一件事：從走道中央朝哪個方向走到底，腳都還在走道面上。 */
  if (blk.fenced) {
    const top = [blk.origin[0], blk.fenced, blk.origin[1]];
    const s = sweep(top, blk.fenced);
    ok(s.escaped === 0 && s.dropped === 0, `${name}：從牆頂十六個方向走到底都還在牆頂上`,
      s.dropped || s.escaped ? `${s.dropped}/16 掉下去了、${s.escaped}/16 出去了` : `離黑牆最近 ${s.tight.toFixed(1)} m`);
  }
  if (blk.sealed) {
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
  ok(nearest < 1.0, `${name}：黑牆貼在砌體的外皮上`, `離最近的砌體 ${nearest.toFixed(2)} m`);
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
        const own = arenaGap(a, px, pz);
        if (own < 0.3) continue;                      // 樞紐本來就該在裡面
        /* 身體貼著黑牆的時候（離牆 0.30～0.35），樞紐自己就已經在吊臂的餘裕
           裡面：沿著牆面看出去的那幾個方向，吊臂收到零、鏡頭就在樞紐上，而
           「離牆 0.35」這件事沒有任何一個吊臂長度做得到。那時候要的是鏡頭
           **不比樞紐更靠牆**。格點撒不撒得到這一帶看場地的尺寸——半徑 25 的
           圓，(9, 23) 那一格就離牆 0.302 m——撒到了不該因此變紅。 */
        const need = Math.min(MARGIN, own);
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
            if (g < need - 1e-3) { outWall++; worst = Math.max(worst, need - g); }
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

/* ── 蹭著牆繞一整圈，樞紐會不會被拖到牆外 ────────────────────────
   dead zone 的橫向拖是一條**直線**（垂直於視線），而圓牆是彎的：沿著圓牆
   繞的時候那條線是一條弦，一路切到牆外面去。人始終在牆內（身體被 solveXZ
   擋在半徑那麼遠的地方），樞紐卻飄出去——方的場地看不出這件事，因為直線
   拖在直牆邊不會離開房間（只有牆角會）。

   出了牆不只是看點跑掉：boomLimit 的射線與圓是從**牆內**解的，樞紐在外面
   的時候那條二次式取到的是另一側的交點，吊臂因此不是當場歸零（鏡頭縮進
   頭裡），就是一路伸到牆外，畫面整片黑——而那是一個不會被回報成「相機
   出界」的災難：看起來就只是「畫面黑掉了」。

   驗法：狗貼著牆（離牆剛好是身體半徑，也就是 solveXZ 擋下來的位置）繞一
   整圈，鏡頭的 yaw 全程不動——那就是「位移方向與操作方向不一致」的極端，
   而它是玩家一根手指推著搖桿繞場就會做出來的事。圓的與方的都掃，順逆
   兩個方向、八個起始視角。 */
{
  const dt = 1 / 60, RAD = PHYS.radius;
  /* 貼著牆的那一圈：把一個遠在場外的點夾進場地裡，落點就是身體能到的
     最外圈——用的是 solveXZ 擋人時的同一支 clampArena，所以「貼著牆」
     不是這裡另外定義的一個半徑。 */
  const hug = (a, s) => {
    if (a.shape === 'circle') {
      return clampArena(a, a.x + Math.sin(s * 2 * Math.PI) * a.r * 2,
        a.z + Math.cos(s * 2 * Math.PI) * a.r * 2, RAD);
    }
    const w = a.x1 - a.x0, h = a.z1 - a.z0, u = (s % 1) * 2 * (w + h);
    const p = u < w ? [a.x0 + u, a.z0 - 9]
      : u < w + h ? [a.x1 + 9, a.z0 + (u - w)]
        : u < 2 * w + h ? [a.x1 - (u - w - h), a.z1 + 9]
          : [a.x0 - 9, a.z1 - (u - 2 * w - h)];
    return clampArena(a, p[0], p[1], RAD);
  };
  const lap = (a) => (a.shape === 'circle'
    ? 2 * Math.PI * (a.r - RAD)
    : 2 * ((a.x1 - a.x0) + (a.z1 - a.z0)) - 8 * RAD);

  let worstPivot = Infinity, worstCam = Infinity, where = '';
  for (const a of R.arenas) {
    const per = lap(a);
    for (let k = 0; k < 8; k++) {
      for (const dir of [1, -1]) {
        const yaw = (k * Math.PI) / 4;
        let s = 0;
        const [sx, sz] = hug(a, s);
        const player = { x: sx, y: 0, z: sz };
        const cam = makeCam(sx, sz);
        cam.yaw = yaw;
        // 先站定幾幀讓吊臂收到該有的長度，再開始繞
        for (let i = 0; i < 30; i++) updateCam(cam, dt, player, a, []);
        for (let i = 0; i < Math.ceil(per / (PHYS.run * dt)); i++) {
          s += (dir * PHYS.run * dt) / per;
          [player.x, player.z] = hug(a, (s % 1 + 1) % 1);
          const rig = updateCam(cam, dt, player, a, []);
          const gp = arenaGap(a, cam.px, cam.pz);
          const gc = arenaGap(a, rig.pos[0], rig.pos[2]);
          if (gp < worstPivot || gc < worstCam) where = `${a.id}／yaw ${(k * 45)}°`;
          worstPivot = Math.min(worstPivot, gp);
          worstCam = Math.min(worstCam, gc);
        }
      }
    }
  }
  ok(worstPivot > -1e-6, '蹭著牆繞圈也不會把樞紐拖出牆外',
    `最靠牆 ${worstPivot.toFixed(2)} m（${where}）`);
  /* 鏡頭自己：吊臂最短那 0.35 公尺是硬給的（再短就在頭裡面），所以它
     吃得掉牆的餘裕——但不准真的穿出牆面。 */
  ok(worstCam > 0, '鏡頭也一直在牆內', `最靠牆 ${worstCam.toFixed(2)} m`);
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

/* ── 外觀的轉身 ──────────────────────────────────────────────────
   移動不等身體轉過去（walk.js 的 steer），所以轉身純粹是「讓人看清楚
   牠朝哪」，而那件事越快越好——這裡是遊戲那邊 TURN_RATE 的兩倍。

   另一半是「停下來之後還會轉完最後那一下」：main.js 每幀都送朝向、而且
   送的是最後一次的操控方向，所以放開手、人煞停了，身體還會繼續轉到那個
   方向才停。驗的是 update() 在 speed = 0 的時候照樣會轉。 */
{
  ok(TURN_RATE === 28, '外觀轉向是遊戲那邊（14 rad/s）的兩倍', `${TURN_RATE} rad/s`);
  const c = zoo.active;
  const dt = 1 / 60;
  c.setFacing(0);
  for (let i = 0; i < 200; i++) c.update(dt, { speed: 0, grounded: true, vy: 0 });
  ok(Math.abs(c.root.rotation.y) < 1e-9, '從正面開始', `${c.root.rotation.y}`);
  c.setFacing(Math.PI / 2);
  let turned = 0;
  for (let i = 0; i < 600; i++) {
    c.update(dt, { speed: 0, grounded: true, vy: 0 });     // speed = 0：人站著不動
    turned = i + 1;
    if (Math.abs(c.root.rotation.y - Math.PI / 2) < 1e-9) break;
  }
  const want = (Math.PI / 2) / TURN_RATE;
  ok(Math.abs(turned * dt - want) < 2 * dt, '站著不動也會轉到最後的操控方向',
    `${(turned * dt).toFixed(3)} 秒 / 該是 ${want.toFixed(3)}`);
  ok(Math.abs(c.root.rotation.y - Math.PI / 2) < 1e-9, '轉到就停，不會轉過頭');
  c.setFacing(0);
  for (let i = 0; i < 200; i++) c.update(dt, { speed: 0, grounded: true, vy: 0 });
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
