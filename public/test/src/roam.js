/* ── test/src/roam.js ───────────────────────────────────────────────
   完整流程模式裡，會走路的怪物准許待在哪裡（允許區）。

   怪物換位置的方式不只走路：被打飛、跳砍、跳砸都是直接飛到一個點上。那個點
   不保證走得到——以前會掉進窄巷的井、落在柱子後面的死角、飛到牆外。所以每一
   場開打之前先把「准許的地方」標出來，所有不是走路的移動都只能落在這裡面
   （combat.js 的 knock、skills.js 的 leap / cleave）。

   ── 准許哪裡 ────────────────────────────────────────────────────
     地面   從這一場的入口往外淹（ROAM.cell 一格）：一格走得過去是身體擺得下
            （solveXZ 不推它，四周 ROAM.clear 也不推）、跟上一格的地板差不到
            一階。跟主角走路、folk.js 的 walkCells 同一套。
     台子   緊鄰地面、頂面比那一格地面高一階以上、但不超過 ROAM.rise（主角跳得
            上去的最高 MOUNT）的平頂。上限取 MOUNT，於是怪物站到哪裡主角都打得到。
            台子頂上只往同一個高度擴，**不往下擴**：牆頭、高台的另一側往下是牆外，
            從台子往下走到的格子不算——「爬上牆頭再走下去」因此進不了允許區。
            會滑的頂（屋頂、圓頂，walk.js 的 slip）不算台子。
   井口裡面兩種都不是（井底比地面低八公尺，不是一階）；井圈的頂是台子。

   ── 查 ──────────────────────────────────────────────────────────
     has(x, y, z, near) 這一點算不算在允許區裡：水平 near（預設 ROAM.near）以內
                        有一格、高低差不到一階。ROAM.near 小於「牆內那一格的中心到
                        牆外的身體」的最短距離（ROAM.clear + 兩個身體半徑），
                        所以牆的另一側永遠不算。
     low                最低的那一格多高（往下掉得比它低，就不會落在允許區裡）。
     nearest(x, y, z, ok)  離這一點最近的一格（水平距離加高低差），可以再給一個
                        條件。ROAM.far 公尺以內找不到就是 null。

   規則不碰 three，node 驗得動（tools/verify-reach.mjs）。
   ------------------------------------------------------------------ */

import { PHYS, MOUNT, solveXZ, supportInfo, arenaGap, colsNear } from './walk.js';

/**
 * cell   一格多大（公尺）；clear 身體四周再留多少（跟 folk.js 的人民一樣）
 * rise   台子頂面最多比旁邊地面高多少：主角跳得上去的最高（MOUNT）
 * flat   台子頂上往旁邊擴的時候，高低差在這以內才算同一個頂
 * near   has 的容忍：一點離最近那一格的中心多遠以內算在裡面
 * far    nearest 最遠找多遠
 */
export const ROAM = { cell: 0.5, clear: 0.3, rise: MOUNT, flat: 0.05, near: 0.7, far: 6 };

/**
 * 一張圖裡怪物准許待的地方，從 `start`（{x, y, z}，這一場的入口）往外淹。
 *
 * @param {object[]} cols 碰撞體（整片遺跡的就好，這裡只留這一張圖附近的）
 * @param {object} arena 這一張圖的黑牆
 * @param {object} doors 門的狀態（打的時候全關：{}）
 */
export function roamMap(cols, arena, start, doors = {}) {
  const C = ROAM.cell;
  const [x0, z0, x1, z1] = arena.shape === 'circle'
    ? [arena.x - arena.r, arena.z - arena.r, arena.x + arena.r, arena.z + arena.r]
    : [arena.x0, arena.z0, arena.x1, arena.z1];
  const near = colsNear(cols, x0, z0, x1, z1, 1);
  const R = ROAM.clear, PROBE = [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]];
  const free = (x, z, y) => arenaGap(arena, x, z) > PHYS.radius + R && PROBE.every(([ox, oz]) => {
    const [px, pz] = solveXZ(near, x + ox, z + oz, y, doors);
    return Math.abs(px - x - ox) < 1e-4 && Math.abs(pz - z - oz) < 1e-4;
  });
  const at = (i, j) => [x0 + i * C, z0 + j * C];

  /** (i, j) → 這一欄裡准許的那幾格（地面與台子頂可能疊在同一欄）。 */
  const grid = new Map();
  const col = (i, j) => `${i},${j}`;
  const seen = new Set();
  const q = [];
  const add = (i, j, y, top) => {
    const k = `${i},${j},${Math.round(y * 100)}`;
    if (seen.has(k)) return;
    seen.add(k);
    const [x, z] = at(i, j);
    if (!free(x, z, y)) return;
    const c = { x, y, z, top };
    const g = col(i, j);
    if (!grid.has(g)) grid.set(g, []);
    grid.get(g).push(c);
    q.push([i, j, y, top]);
  };

  const i0 = Math.round((start.x - x0) / C), j0 = Math.round((start.z - z0) / C);
  const [sx, sz] = at(i0, j0);
  add(i0, j0, supportInfo(near, sx, sz, start.y + 0.1).y, false);
  while (q.length) {
    const [i, j, y, top] = q.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      const [x, z] = at(ni, nj);
      const ny = supportInfo(near, x, z, y).y;
      if (top) {
        // 台子頂上：只往同一個頂擴，不往下
        if (Math.abs(ny - y) <= ROAM.flat) add(ni, nj, ny, true);
        continue;
      }
      if (Math.abs(ny - y) <= PHYS.step) add(ni, nj, ny, false);
      // 旁邊那一格有沒有一個主角跳得上去的平頂
      const up = supportInfo(near, x, z, y + ROAM.rise - PHYS.step);
      if (up.y > y + PHYS.step && up.y <= y + ROAM.rise && !up.slip) add(ni, nj, up.y, true);
    }
  }

  const cells = [...grid.values()].flat();
  const span = Math.ceil(ROAM.near / C);
  return {
    cells,
    low: Math.min(...cells.map((c) => c.y)),
    has(x, y, z, near = ROAM.near) {
      const ci = Math.round((x - x0) / C), cj = Math.round((z - z0) / C);
      for (let di = -span; di <= span; di++) {
        for (let dj = -span; dj <= span; dj++) {
          for (const c of grid.get(col(ci + di, cj + dj)) || []) {
            if (Math.abs(c.y - y) <= PHYS.step && Math.hypot(c.x - x, c.z - z) <= near) return true;
          }
        }
      }
      return false;
    },
    nearest(x, y, z, ok = () => true) {
      const ci = Math.round((x - x0) / C), cj = Math.round((z - z0) / C);
      const n = Math.ceil(ROAM.far / C);
      let best = null, bestD = Infinity;
      /* 一圈一圈往外：這一圈裡最近的一格比下一圈的內緣還近，就不必再找了。 */
      for (let ring = 0; ring <= n; ring++) {
        if (best && bestD <= (ring - 1) * C) break;
        for (let di = -ring; di <= ring; di++) {
          for (let dj = -ring; dj <= ring; dj++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
            for (const c of grid.get(col(ci + di, cj + dj)) || []) {
              const d = Math.hypot(c.x - x, c.z - z) + Math.abs(c.y - y);
              if (d < bestD && ok(c)) { best = c; bestD = d; }
            }
          }
        }
      }
      return best;
    },
  };
}
