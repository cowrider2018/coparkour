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
   ------------------------------------------------------------------ */

/* 數字是「一隻 0.6 公尺高的狗在一座 6 公尺高的城牆遺跡裡」調出來的：
   走 3.1、衝 6.2、跳 4.6（跳得上 0.95 高、跨得過 2.4 寬），重力 22。
   STEP 0.36 比階梯的級高（0.27～0.32）大一點，所以樓梯不必跳。 */
export const PHYS = {
  walk: 3.1, run: 6.2, accel: 26, brake: 18,
  gravity: 22, jump: 4.6,
  radius: 0.30, height: 0.92, step: 0.36,
};

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
    if (b.max[1] > fromY + PHYS.step) continue;
    if (!overlapXZ(x, z, b, PHYS.radius * 0.85)) continue;
    if (b.max[1] > top) top = b.max[1];
  }
  return top;
}
