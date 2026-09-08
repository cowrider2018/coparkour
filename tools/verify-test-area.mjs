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
     3. 圓角方形烘對了  該動的動、不該動的沒動、尺寸沒變、輪廓真的變方。
                     這一項是眼睛最不可靠的地方：形狀「差一點」跟「對」
                     在截圖上很像，但「耳朵被圓掉」或「整隻縮了 7%」是
                     量得出來的。
     4. 那隻狗是遊戲那隻  cat.bin 讀得動、buildDog 與 dress 套得上、
                     23+ 根骨頭每幀算得出有限的矩陣、三種毛色換得動、
                     腳踩在 y = 0 上。這一頁不重畫那隻狗，所以要驗的是
                     「接得上」而不是「長得像」。

   跑法：node tools/verify-test-area.mjs
   ------------------------------------------------------------------ */

import * as THREE from '../public/test-area/vendor/three.module.js';
import { buildRuins, BLOCKS, PITCH } from '../public/test-area/src/blocks.js';
import { PHYS, solveXZ, supportAt } from '../public/test-area/src/walk.js';
import { readFileSync } from 'node:fs';
import { loadGameDog } from '../public/test-area/src/gamedog.js';

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

head('狗（遊戲那隻本人）');
{
  const buf = readFileSync(new URL('../public/assets/cat.bin', import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const dog = await loadGameDog({ buffer: ab, ear: 'prick', skin: 'yellow', height: 1.0 });

  ok(dog.data.header.vertexCount > 20000, 'cat.bin 的幾何是真的搬進來了',
    `${dog.data.header.vertexCount.toLocaleString()} 個頂點`);
  ok(dog.rig.count >= 23, '骨架至少是那 23 根（加上吻與帽子）', `${dog.rig.count} 根`);
  const G = Object.fromEntries(dog.data.header.groups.map((g) => [g.name, g.count]));
  ok(G.lit > 0 && G.unlit > 0 && G.outline > 0, '三個群組都在', 
    `lit ${G.lit} / unlit ${G.unlit} / outline ${G.outline}`);
  ok(G.outline / (G.lit + G.unlit + G.outline) > 0.3,
    '描邊群組佔了三成以上的三角形（翻面外殼就是靠它）',
    `${Math.round((G.outline / (G.lit + G.unlit + G.outline)) * 100)}%`);
  ok(dog.geometry.groups.length === 3, '幾何切成三個 draw range');
  ok(dog.skins.join(',') === 'yellow,grey,cow', '三種毛色都帶著', dog.skins.join(','));
  ok(dog.mesh.material.length === 3, '三顆材質：皮毛、臉、墨線');
  ok(dog.mesh.material[2].side === THREE.BackSide, '墨線那顆是翻面的（＝剔除正面）');

  // 帽子的骨頭要找得到，不然脫帽會是無聲的沒反應。
  ok(dog._hatBones.length > 0, '漁夫帽的骨頭掛上去了', `${dog._hatBones.length} 根`);

  dog.update(1 / 60, { speed: 0, grounded: true, vy: 0 });
  dog.root.updateMatrixWorld(true);
  const box = dog._measure();
  const h = (box.max[1] - box.min[1]) * dog._scale;
  ok(Math.abs(h - 1.0) < 0.02, '站著剛好一公尺高（含帽子）', `${h.toFixed(3)} m`);
  const feet = box.min[1] * dog._scale + dog.mesh.position.y;
  ok(Math.abs(feet) < 0.01, '腳掌落在 y = 0 上', `${feet.toFixed(4)}`);

  for (const id of dog.skins) {
    dog.setCoat(id);
    ok(dog.coatId === id, `毛色「${id}」換得動`);
  }
  dog.setCoat('yellow');
  dog.setHat(false);
  dog.update(1 / 60, { speed: 0, grounded: true, vy: 0 });
  let hatShrunk = true;
  for (const b of dog._hatBones) if (dog.rig.scale[b * 3 + 1] !== 0) hatShrunk = false;
  ok(hatShrunk, '脫帽是把帽子的骨頭縮到零（跟遊戲同一個做法）');
  dog.setHat(true);
  dog.update(1 / 60, { speed: 0, grounded: true, vy: 0 });
  let hatBack = true;
  for (const b of dog._hatBones) if (dog.rig.scale[b * 3 + 1] !== dog.rig.rest.scale[b * 3 + 1]) hatBack = false;
  ok(hatBack, '戴回去是回到 rest 的尺寸');

  /* 兩千幀，四種狀態都跑過：骨頭矩陣與尾巴那條彈簧鏈都不准生出
     非有限數。彈簧是這裡唯一會爆的東西——它是積分出來的。 */
  let bad = 0;
  for (let i = 0; i < 2000; i++) {
    dog.setFacing(Math.sin(i * 0.07) * 3.1);
    dog.update(1 / 60, {
      speed: (i % 300) / 48, grounded: i % 91 !== 0, vy: Math.sin(i * 0.3) * 4,
    });
    if (i % 50 === 0) {
      for (const v of dog.rig.matrices) if (!Number.isFinite(v)) bad++;
      for (const v of dog.sway.qs) if (!Number.isFinite(v)) bad++;
      for (const v of dog.sway.bend) if (!Number.isFinite(v)) bad++;
    }
  }
  ok(bad === 0, '兩千幀之後骨頭與彈簧都還是有限數', `${bad}`);

  /* 插進 three 頂點著色器的那一段，真的插進去了嗎。

     這一項是這支腳本裡最不像測試、卻最值得存在的一項：那段 GLSL 是靠
     字串比對插進 three 自己的著色器的（onBeforeCompile 裡三個 replace），
     而字串比對失敗的時候 `replace` 不會報錯，它只是什麼都不做——編出來
     的著色器就是沒有骨頭的那一份，畫出來是一坨定格在 rest 姿勢的網格。
     node 這裡沒有 WebGL 可以編譯，但「有沒有插進去」查得出來。

     三顆材質都要查。臉和墨線用的是 basic，而 basic 把
     <beginnormal_vertex> 包在一個 #if 裡（只有 envmap／skinning 才
     展開），所以那兩顆只靠 <begin_vertex> 那一刀——這也是為什麼位置與
     法線在 gamedog.js 裡是兩支各自算完的函式。 */
  for (const [i, name] of [[0, '皮毛（toon）'], [1, '臉（basic）'], [2, '墨線（basic）']]) {
    const src = i === 0 ? THREE.ShaderLib.toon : THREE.ShaderLib.basic;
    const shader = { uniforms: {}, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
    dog.mesh.material[i].onBeforeCompile(shader, null);
    const v = shader.vertexShader;
    ok(v.includes('cpSkinPos()') && !v.includes('#include <begin_vertex>'),
      `${name}：頂點位置換成骨架算的了`);
    ok(v.includes('uniform mat4 uBones['), `${name}：骨頭矩陣的宣告插進去了`);
    ok(v.includes('CP_TAIL_AXIS'), `${name}：尾巴的中心線表插進去了`);
    ok(!!shader.uniforms.uBones && !!shader.uniforms.uSwayQ && !!shader.uniforms.uGrow,
      `${name}：uniform 都掛上了`);
    ok(shader.uniforms.uBones && shader.uniforms.uBones.value === dog.rig.matrices,
      `${name}：uBones 指的就是 rig 每幀寫的那一份`);
  }
  ok(dog.mesh.material[2].onBeforeCompile
    && (() => {
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: '' };
      dog.mesh.material[2].onBeforeCompile(shader, null);
      return shader.uniforms.uGrow.value > 0;
    })(), '墨線那顆的外殼真的往外推（uGrow > 0）');
  ok(dog.mesh.material[0].customProgramCacheKey() !== dog.mesh.material[2].customProgramCacheKey(),
    '不同 grow 的材質不會共用同一支編好的程式');

  /* ── 圓角方形 ─────────────────────────────────────────────────
     烘焙有四件事要成立，而每一件都對應一個真的會發生的錯誤：

       動了      有頂點被移動，不然這整段就是沒接上（而畫面上會是那隻
                 原本的曲面狗，很像、但不是那個造型）。
       沒動錯    耳朵（ride）與臉（unlit 群組）一個位元組都不准變。
       沒縮      每個部位在三個軸上的最大伸展不准變——軸向上橢球半徑
                 等於盒半徑，所以映射在軸上是恆等式。這一項就是當初
                 誤用 measureShapes 的 `norm` 時整隻狗縮一圈的那個 bug。
       變方了    斜向必須被推出去：頭在 (1,1,1) 方向上的伸展要明顯超過
                 原本的橢球，不然它還是圓的。 */
  {
    const raw = dog.rawPosition, baked = dog.position;
    ok(dog.bakeStats.moved > 5000, '圓角把大量頂點移動了',
      `${dog.bakeStats.moved.toLocaleString()} / ${dog.bakeStats.total.toLocaleString()} 個`);
    ok(dog.bakeStats.parts >= 9, '部位表全部量到了（身體、頭、六條腿、吻…）',
      `${dog.bakeStats.parts} 個部位、${dog.bakeStats.rides} 根騎乘骨`);

    const col = dog.data.colors.get('yellow');
    const ranges = {};
    for (const g of dog.data.header.groups) {
      let lo = Infinity, hi = -1;
      for (let i = g.start; i < g.start + g.count; i++) {
        const v = dog.data.index[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      ranges[g.name] = [lo, hi + 1];
    }

    const bone = (v) => col[v * 4 + 3] & 31;
    const earL = dog.rig.bone('earL'), earR = dog.rig.bone('earR');
    let earMoved = 0, faceMoved = 0;
    for (let v = 0; v < dog.data.header.vertexCount; v++) {
      const moved = Math.abs(raw[v * 3] - baked[v * 3]) > 1e-9
        || Math.abs(raw[v * 3 + 1] - baked[v * 3 + 1]) > 1e-9
        || Math.abs(raw[v * 3 + 2] - baked[v * 3 + 2]) > 1e-9;
      if (!moved) continue;
      if (bone(v) === earL || bone(v) === earR) earMoved++;
      if (v >= ranges.unlit[0] && v < ranges.unlit[1]) faceMoved++;
    }
    ok(earMoved === 0, '兩隻立耳一個頂點都沒動（三角形圓掉就不是那隻狗了）', `${earMoved}`);
    ok(faceMoved === 0, '臉（unlit 群組：眼、鼻、嘴）一個頂點都沒動', `${faceMoved}`);

    /* 每個部位、每個軸的最大伸展，烘之前與烘之後。只看 lit 群組——
       outline 群組會多出墨線那一圈，本來就該變。 */
    const spanOf = (P, want) => {
      const out = new Map();
      for (let v = ranges.lit[0]; v < ranges.lit[1]; v++) {
        const b = bone(v);
        if (want && !want.has(b)) continue;
        let a = out.get(b);
        if (!a) { a = [0, 0, 0]; out.set(b, a); }
        for (let k = 0; k < 3; k++) a[k] = Math.max(a[k], Math.abs(P[v * 3 + k]));
      }
      return out;
    };
    const partBones = new Set(dog.model.parts.map((p) => dog.rig.bone(p.bone)).filter((b) => b !== earL && b !== earR));
    const before = spanOf(raw, partBones), after = spanOf(baked, partBones);
    /* 縮與胖分開看，因為它們是兩件事。

       縮是 bug：軸向上橢球半徑等於盒半徑，映射在軸上是恆等式，所以任何
       部位在任何軸上變短都表示尺寸的基準抓錯了（誤用 measureShapes 的
       `norm` 就是這樣，整隻縮 7%）。

       胖是那個造型本身：最遠的那個頂點通常不是正好落在軸上，而稍微偏離
       軸的方向在圓角盒上的邊界大於 1，所以它會被往外推。小部位（腳掌
       半徑 0.15）偏一點就佔比例的一大塊，實測最多 6%——那是圓角，不是
       錯誤。真正該擋的是「胖到不成比例」。 */
    /* 唯一「該縮」的是部位表自己說要縮的那個軸：頭的 scale 是
       [1, 0.86, 1]，因為圓角矩形的頂是一條線而不是一個點，不壓低它就會
       升起來吃掉耳朵。所以容許的縮量就是表上寫的那個數，其他軸是 2%。 */
    const scaleOf = new Map();
    for (const p of dog.model.parts) {
      const sc = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale;
      scaleOf.set(dog.rig.bone(p.bone), sc);
    }
    let shrink = 0, shrinkName = '', grow = 0, growName = '';
    for (const [b, a] of after) {
      const bf = before.get(b);
      const sc = scaleOf.get(b) || [1, 1, 1];
      for (let k = 0; k < 3; k++) {
        if (bf[k] < 0.05) continue;                 // 太薄的軸，比例會放大雜訊
        const d = (a[k] - bf[k]) / bf[k];
        const allow = 1 - sc[k];                    // 表上允許的縮量
        if (-d - allow > shrink) { shrink = -d - allow; shrinkName = `${dog.rig.names[b]}.${'xyz'[k]}`; }
        if (d > grow) { grow = d; growName = `${dog.rig.names[b]}.${'xyz'[k]}`; }
      }
    }
    ok(shrink < 0.02, '沒有任何部位縮得比部位表要求的更多',
      `最多超縮 ${(shrink * 100).toFixed(1)}%${shrinkName ? ` 在 ${shrinkName}` : ''}`);
    ok(grow < 0.12, '也沒有胖到不成比例',
      `最多胖 ${(grow * 100).toFixed(1)}% 在 ${growName}`);

    // 斜向：頭在 (1,1,1) 方向上必須被推出去，那就是「變方」。
    const head = dog.rig.bone('head');
    const diag = (P) => {
      let m = 0;
      for (let v = ranges.lit[0]; v < ranges.lit[1]; v++) {
        if (bone(v) !== head) continue;
        const d = (P[v * 3] + P[v * 3 + 1] + P[v * 3 + 2]) / Math.sqrt(3);
        if (d > m) m = d;
      }
      return m;
    };
    const grew = diag(baked) / diag(raw);
    ok(grew > 1.03, '頭在斜向被推出去了（圓角矩形的角）', `${((grew - 1) * 100).toFixed(1)}% 更遠`);

    // B 鍵：切回原始網格，再切回來。
    dog.setBend(false);
    ok(dog.geometry.attributes.position.array[7] === raw[7], 'B 鍵切得回原始曲面網格');
    dog.setBend(true);
    ok(dog.geometry.attributes.position.array[7] === baked[7], '再按一次切回圓角');
  }

  // 尾巴真的在動：彈簧的四元數不能整場都是單位四元數。
  let moved = 0;
  for (let i = 0; i < dog.sway.qs.length; i += 4) {
    if (Math.abs(dog.sway.qs[i + 3] - 1) > 1e-4) moved++;
  }
  ok(moved > 3, '尾巴那條 17 節的彈簧真的在擺', `${moved}/17 節偏離靜止`);
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
