/* ── test-area/src/walk.js ───────────────────────────────────────────
   走路的規則。

   單獨一支檔案，是因為它有兩個使用者：/test-area/ 這一頁，以及
   tools/verify-test-area.mjs——那支腳本在 node 底下把四個區塊砌一遍，
   然後用「中心那片空地上每一格的支撐高度都一樣」來驗證「中心夠空曠」
   這條規則。兩邊必須是同一份規則，不是「看起來很像」的兩份：中心是不是
   真的走得動，只有踩過才知道，而踩的那個動作要能離線做。

   狗當成一個圓柱（半徑 0.30、高 0.92）。碰撞盒是軸對齊的（blocks.js
   砌的時候登記），一張清單四百多個，每次全掃——四百次比較比建索引便宜，
   而且地圖是靜態的，沒有「盒子搬家要重建索引」的問題。

   清單裡有兩種東西，但只有一套「擋住」的邏輯：

     盒子（'floor'／'block'／'step'／'shell'）  不准進來。
     場地（'bound'）                          不准出去——黑牆。方的或圓的。

   場地邊界之所以不是「另一支夾限函式」，是因為障礙物與邊界在遊戲裡是
   同一件事：擋住。差別只在它被什麼外觀包裹（砌體，或是黑牆與黑霧）。
   兩套邏輯的話，「牆擋得住我但邊界把我吸過去」這種 bug 就有地方住。
   ------------------------------------------------------------------ */

/* 數字是「一隻 0.6 公尺高的狗在一座 6 公尺高的城牆遺跡裡」調出來的：
   走 3.1、衝 6.2、跳 4.6（跳得上 0.95 高、跨得過 2.4 寬），重力 22。
   STEP 0.36 比階梯的級高（0.27～0.32）大一點，所以樓梯不必跳。 */
export const PHYS = {
  walk: 3.1, run: 6.2, accel: 26, brake: 18,
  gravity: 22, jump: 4.6,
  radius: 0.30, height: 0.92, step: 0.36,
};

/* ── 從 PHYS 推出來的三個造形規則 ────────────────────────────────
   房間要「視覺上凹凸、腳下平坦」，靠的不是小心擺東西，是這三個數字：

     APEX      跳躍頂點 = jump² / 2g = 4.6² / 44 = 0.48。
     MOUNT     踩得上去的最高頂面 = APEX + step = 0.84。所以頂面 0.84
               以下的東西，玩家跳一下就站得上去。
     BLOCK_TOP 障礙物的頂面至少要這麼高（1.0，比 MOUNT 多一點餘裕），
               不然它是「看起來該站得上去、跳上去又站不穩」的東西。
     TRIP      會絆腳的那一段：頂面在 0.08 到 step 之間的東西會把身體
               抬起來、頓一下。純視覺的碎石一律壓進地板、只露 0.08 以下，
               就是為了避開這一段。

   `walk.js` 自己不用這幾個數（它只吃盒子），但零件與驗證都要用，而它們
   是從 PHYS 算出來的——放在別的地方就會有兩份物理。 */
export const APEX = (PHYS.jump * PHYS.jump) / (2 * PHYS.gravity);
export const MOUNT = APEX + PHYS.step;
export const BLOCK_TOP = 1.0;
export const TRIP = [0.08, PHYS.step];

/**
 * 點到場地邊界的距離：在裡面是正的，出去了是負的。
 *
 * 方的與圓的共用這一支，因為「邊界在哪」只該有一個定義——阻擋（solveXZ）、
 * 夾住碎石（blocks.js）、畫黑牆（veil.js）三邊都問它。三份各自算的話，
 * 遲早會出現「畫面上的牆在這裡、走得到的地方在那裡」。
 *
 * @param {object} a  {shape:'circle', x, z, r} 或 {shape:'rect', x0, x1, z0, z1}
 */
export function arenaGap(a, x, z) {
  if (a.shape === 'circle') return a.r - Math.hypot(x - a.x, z - a.z);
  return Math.min(x - a.x0, a.x1 - x, z - a.z0, a.z1 - z);
}

/**
 * 把一個點夾進場地裡（離邊界至少 margin）。
 *
 * `solveXZ` 與相機都用這一支：身體的 margin 是它的半徑（所以走到底的
 * 時候身體表面剛好貼在牆面上），相機的是 0.35（鏡頭不出牆，不然會從
 * 外面看到牆的背面）。兩份各自算的話，其中一份遲早會跟畫面差半公尺。
 */
export function clampArena(a, x, z, margin) {
  if (a.shape === 'circle') {
    const dx = x - a.x, dz = z - a.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    const lim = Math.max(0, a.r - margin);
    return d <= lim ? [x, z] : [a.x + (dx / d) * lim, a.z + (dz / d) * lim];
  }
  return [
    Math.min(Math.max(x, a.x0 + margin), a.x1 - margin),
    Math.min(Math.max(z, a.z0 + margin), a.z1 - margin),
  ];
}

/** 圓柱（用外接方框近似）與一個盒子在水平面上有沒有重疊。 */
export function overlapXZ(x, z, b, pad) {
  return x + pad > b.min[0] && x - pad < b.max[0] && z + pad > b.min[2] && z - pad < b.max[2];
}

/**
 * 水平推出。
 *
 * 高度差在 STEP 以內的盒子在這一步不算牆——所以身體會先走進台階裡，
 * 再由 `supportAt` 把牠抬上來。「踏得上去」因此不是另外一條規則，
 * 而是這兩步的順序造成的結果。
 *
 * @returns {[number, number]} 推出後的 x, z
 */
export function solveXZ(cols, x0, z0, feetY) {
  const R = PHYS.radius;
  const headY = feetY + PHYS.height;
  let x = x0, z = z0;
  for (const b of cols) {
    if (b.kind === 'bound') {
      /* 場地的邊界。由內往外擋，所以它只能對「已經在裡面的東西」作用
         ——這張清單裡有四個場地，而站在一個場地裡的時候，另外三個在
         四十公尺外；不加下界的話，那三個會各自把身體往自己的邊界上拉。
         三公尺的餘裕是給「已經貼在邊上」的身體用的。 */
      const gap = arenaGap(b, x, z);
      if (gap >= R || gap <= -3) continue;
      [x, z] = clampArena(b, x, z, R);
      continue;
    }
    if (b.max[1] <= feetY + PHYS.step) continue;   // 踏得上去 → 不是牆
    if (b.min[1] >= headY) continue;              // 從底下鑽得過去
    if (!overlapXZ(x, z, b, R)) continue;
    const dxL = x + R - b.min[0], dxR = b.max[0] - (x - R);
    const dzL = z + R - b.min[2], dzR = b.max[2] - (z - R);
    const mx = Math.min(dxL, dxR), mz = Math.min(dzL, dzR);
    if (mx < mz) x += dxL < dxR ? -mx : mx;
    else z += dzL < dzR ? -mz : mz;
  }
  return [x, z];
}

/**
 * 站在 (x, z)、腳原本在 fromY 的話，會踩在多高的地方。
 *
 * 只認「不高於 fromY + STEP」的盒子：跳上去之前，屋頂不是地板。
 * 沒有任何盒子的話就是地面（y = 0）。
 */
export function supportAt(cols, x, z, fromY) {
  let top = 0;
  for (const b of cols) {
    if (b.kind === 'bound') continue;              // 邊界不是地板
    if (b.max[1] > fromY + PHYS.step) continue;
    if (!overlapXZ(x, z, b, PHYS.radius * 0.85)) continue;
    if (b.max[1] > top) top = b.max[1];
  }
  return top;
}
