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
     3. 二次變形接上了  部位表量到了、uniform 攤平的順序沒錯、變形那一段
                     真的插進了皮毛與墨線的著色器而沒有插進臉、耳朵被
                     標成「不彎」、墨線的寬度換算對。node 沒有 WebGL 可以
                     編譯，但這些全都查得出來，而它們就是這一段會壞的
                     地方——字串比對失敗不會報錯，只會靜靜地畫出一隻沒有
                     圓角的狗。
     4. 動物是遊戲那幾隻  cat.bin 讀得動、species.js 的三種模型都建得
                     起來、每一種的骨頭每幀算得出有限的矩陣、九種 look 都
                     換得動、腳踩在 y = 0 上。這一頁不重畫動物，所以要驗
                     的是「接得上」而不是「長得像」。
     5. 生物那張表塞得進直欄  直欄可以只有 96 px 寬，而那不是斷點、是
                     算出來的。所以降級的門檻要跟真的量出來的尺寸對得上，
                     不然最窄的那一級會把表推寬、被面板裁掉半排。
     6. 手把的版面與手感  兩側是操作列、中間那一整片是遊戲——這條規則
                     是這個版面存在的全部理由，而「觸控區悄悄長到畫面
                     中央」看不出來，只會讓人覺得點哪裡都在走路。軸是
                     圓的（推到對角不會比推直的快 41%）也一樣：看不出來，
                     只有跑起來覺得斜著比較快。

   跑法：node tools/verify-test-area.mjs
   ------------------------------------------------------------------ */

import * as THREE from '../public/test-area/vendor/three.module.js';
import { buildRuins, BLOCKS, PITCH } from '../public/test-area/src/blocks.js';
import { PHYS, solveXZ, supportAt } from '../public/test-area/src/walk.js';
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
};

head('砌四個區塊');
const t0 = Date.now();
const R = buildRuins();
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

head('走得出去');
/* 出口是設計的一部分：中庭靠兩側拱廊的拱洞、王座廳靠塌掉的正門、
   圓塔靠環牆上四個門洞、城牆平台靠那兩折樓梯。這一項驗的是那些洞真的
   是洞——牆是一塊一塊砌的，少留一個缺口不會有人在程式裡看出來，只會在
   跑進去之後發現出不來。 */
const EXITS = {
  courtyard: [[-13, 0], [-19, 0]],
  rampart: [[4.2, -5.5], [4.2, -9.5], [4.2, -14], [4.2, -21]],
  throne: [[0, -14.4], [0, -19]],
  cistern: [[12.7, 2.5], [17.5, 3.4]],
};
for (const b of BLOCKS) {
  const c = CENTERS[b.id];
  const [ox, oz] = b.origin;
  let from = [ox, c.y, oz], out = true, worst = null;
  for (const [vx, vz] of EXITS[b.id]) {
    const res = walkTo(from, [ox + vx, 0, oz + vz]);
    if (!res.arrived) { out = false; worst = res; break; }
    from = res.at;
  }
  ok(out, `${b.name}：從中心走得出去`, out ? '' : `卡在還差 ${worst.best.toFixed(1)} m 的地方`);
}

head('區塊之間那片空地是通的');
/* 只驗空地，不驗「走進隔壁的區塊」：每個區塊都是有牆的，進出口在固定
   的幾個缺口上，而這支測試的走法是直線——直線撞牆是對的行為，不是 bug。
   要驗的是「兩個區塊中間那條走廊不會被孤立的殘牆或大石頭堵死」。 */
for (let i = 0; i < BLOCKS.length; i++) {
  const a = BLOCKS[i], b = BLOCKS[(i + 1) % BLOCKS.length];
  const mid = [(a.origin[0] + b.origin[0]) / 2, 0, (a.origin[1] + b.origin[1]) / 2];
  const dir = [b.origin[0] - a.origin[0], b.origin[1] - a.origin[1]];
  const L = Math.hypot(dir[0], dir[1]);
  // 從走廊的一端走到另一端，兩端各離區塊 19 公尺（區塊的半徑約 15）。
  const from = [a.origin[0] + (dir[0] / L) * 19, 0, a.origin[1] + (dir[1] / L) * 19];
  const to = [b.origin[0] - (dir[0] / L) * 19, 0, b.origin[1] - (dir[1] / L) * 19];
  const res = walkTo(from, to, 40);
  ok(res.arrived, `${a.name} → ${b.name} 的走廊是通的`,
    res.arrived ? `${res.t.toFixed(1)} 秒` : `最近只到 ${res.best.toFixed(1)} m`);
  void mid;
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

  /* ── 二次變形 ───────────────────────────────────────────────
     沒有 GPU 可以驗「畫出來對不對」，所以驗的是「接上了沒有」。每一項
     都對應一個真的會發生、而且不會報錯的故障。 */
  const S = dog.shape;
  const earL = dog.rig.bone('earL'), earR = dog.rig.bone('earR');
  ok(S.rides[earL] === 1 && S.rides[earR] === 1, '兩隻立耳被標成「不彎，只跟著頭走」');
  ok(S.byBone[earL] >= 0, '耳朵知道自己掛在哪個部位上');
  ok(S.byBone[dog.rig.bone('tail')] === -1, '尾巴沒有矩形（它是一根管子）');

  const U = dog._uniforms;
  ok(U.uPart.value.length === S.parts.length * 4, 'uPart 的長度對得上部位數');
  let boneOk = true, halfOk = true;
  S.parts.forEach((p, i) => {
    if (U.uPart.value[i * 4 + 3] !== p.bone) boneOk = false;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(U.uPartB.value[i * 4 + k] - p.half[k]) > 1e-6) halfOk = false;
    }
    if (Math.abs(U.uPartB.value[i * 4 + 3] - p.radius) > 1e-6) halfOk = false;
  });
  ok(boneOk, '每個部位的 uniform 記著正確的骨號');
  ok(halfOk, '三個半徑與圓角比例都照 measureShapes 攤平了');

  dog.setInkPx(2, 900);
  ok(Math.abs(dog._inkOut.value - 2 * 2 / 900) < 1e-9, '墨線寬度從像素換算成螢幕單位',
    `2 px / 900 px 高 → ${dog._inkOut.value.toFixed(5)}`);

  /* 變形沒有開關給玩家（那會是一個什麼都不多做的模式），但 API 留著，
     因為它是「同一隻動物、同一個姿勢，只差變形」這件事唯一的比對方式，
     而那是調造型的時候會想要的。主控台從 window.testArea.zoo 叫得到。 */
  zoo.setBend(false);
  ok(dog._bendU.value === 0 && zoo.bendOn === false, '變形關得掉（主控台用）');
  zoo.setBend(true);
  ok(dog._bendU.value === 1 && zoo.bendOn === true, '也開得回來');

  for (const [i, name, wantWarp] of [[0, '皮毛', true], [1, '臉', false], [2, '墨線', true]]) {
    const src = i === 0 ? THREE.ShaderLib.toon : THREE.ShaderLib.basic;
    const shader = { uniforms: {}, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
    dog.mesh.material[i].onBeforeCompile(shader, null);
    const calls = (shader.vertexShader.match(/gl_Position = cpWarp\(/g) || []).length;
    ok(calls === (wantWarp ? 1 : 0), `${name}：${wantWarp ? '有' : '沒有'}做二次變形`, `${calls} 處`);
    ok(shader.vertexShader.includes('cpSkinPos()'), `${name}：頂點位置換成骨架算的了`);
    ok(!!shader.uniforms.uBones && shader.uniforms.uBones.value === dog.rig.matrices,
      `${name}：uBones 指的就是 rig 每幀寫的那一份`);
    if (wantWarp) {
      ok(shader.vertexShader.includes('uniform vec4 uPart['), `${name}：部位的 uniform 宣告在`);
      ok(shader.vertexShader.includes('float cpRR('), `${name}：圓角矩形的求交式在`);
    }
  }
  const inkShader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: '' };
  dog.mesh.material[2].onBeforeCompile(inkShader, null);
  const furShader = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: '' };
  dog.mesh.material[0].onBeforeCompile(furShader, null);
  ok(inkShader.uniforms.uInkOut.value > 0 && furShader.uniforms.uInkOut.value === 0,
    '墨線落在矩形外一圈，皮毛落在矩形上');
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
