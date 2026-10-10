/* ── test/src/folk.js ────────────────────────────────────────────────
   王國的人民（完整流程模式）：國王復活那一頁（第 14 頁）蓋住畫面的時候，每一張圖撒出幾叢——
   就是那一頁漫畫裡站滿王座廳的那幾隻（tools/comic/shots.js 的 p14-5，FOLK.looks）。書頁走了
   就看得到。

   ── 撒在哪 ──────────────────────────────────────────────────────
   每一張圖（blocks.js 的六個區塊）FOLK.clusters 叢、每一叢 FOLK.members 隻，都是亂給的。
   「任何地方」是那一張圖裡走得到的地方：從那一張圖的出生點往外淹（walkCells，FOLK.cell 一格），
   一格走得過去是身體擺得下（walk.js 的 solveXZ 不推它，四周 FOLK.clear 也不推）、跟上一格的
   地板差不到一階（PHYS.step）——跟主角走路同一套碰撞，所以牆裡、房子裡、牆外的荒地、要跳上去
   的台子都不會撒到。一叢要站在平的地方：那一格四周八格都是同一個高度（台階、樓梯不算），
   離黑牆至少 FOLK.edge、離感測區（沒入黑霧的路、門洞）至少 FOLK.portal，模式另外可以排掉
   一些地方（主角腳邊、國王要走的路）。一叢裡的幾隻擠在 FOLK.spread 以內、彼此至少隔 FOLK.gap，
   面朝這一叢的中間（圍成一圈聊天），兩隻就是面對面。叢與叢之間至少隔 FOLK.apart。

   ── 畫 ──────────────────────────────────────────────────────────
   區塊彼此看不到，所以只畫主角現在在的那一張圖裡的那幾隻，其餘藏著、不算。每一隻站著
   （待機的呼吸），頭跟著主角轉（gaze.js）。

   規則（walkCells、plan）不碰 three，node 驗得動（verify-flow 的「人民」）。
   ------------------------------------------------------------------ */

import { Critter } from './critter.js';
import { solveXZ, supportInfo, arenaGap, portalGap, colsNear, PHYS } from './walk.js';
import { Gaze, aimHead, GAZE } from './gaze.js';

/**
 * looks     撒哪幾種（第 14 頁第 5 格那幾隻）
 * clusters  一張圖幾叢 [最少, 最多]；members 一叢幾隻 [最少, 最多]
 * cell      淹的時候一格多大（公尺）；clear 身體四周再留多少
 * edge      離黑牆至少多遠；portal 離感測區至少多遠
 * spread    一叢的幾隻離這一叢的第一隻多遠以內；gap 彼此至少隔多遠；apart 叢與叢至少隔多遠
 */
export const FOLK = {
  looks: ['cat/orangin', 'dog-drop/cow', 'cat/tabby', 'dog-prick/grey', 'cat/calico', 'dog-drop/yellow', 'dog-prick/cow'],
  clusters: [1, 3], members: [2, 4],
  cell: 0.5, clear: 0.3, edge: 1.5, portal: 3.0,
  spread: 1.5, gap: 0.9, apart: 4.0,
};

/** [lo, hi] 裡的一個整數。 */
const pick = (rng, [lo, hi]) => lo + Math.floor(rng() * (hi - lo + 1));

/**
 * 一張圖裡走得到的每一格：從 start（{x, y, z}，那一張圖的出生點）往外淹。
 *
 * @param {object[]} cols 碰撞體（整片遺跡的就好，這裡只留這一張圖附近的）
 * @param {object} arena 那一張圖的黑牆（blocks.js buildRuins 的 arenas）
 * @param {object} doors 門的狀態（全開：國王復活之後）
 * @returns {{x: number, y: number, z: number, flat: boolean}[]}
 */
export function walkCells(cols, arena, start, doors) {
  const C = FOLK.cell;
  const [x0, z0, x1, z1] = arena.shape === 'circle'
    ? [arena.x - arena.r, arena.z - arena.r, arena.x + arena.r, arena.z + arena.r]
    : [arena.x0, arena.z0, arena.x1, arena.z1];
  const near = colsNear(cols, x0, z0, x1, z1, 1);
  const nx = Math.ceil((x1 - x0) / C) + 1;
  const key = (i, j) => i + j * nx;
  // 身體擺得下：中間與四周 clear 都不被推。
  const R = FOLK.clear, PROBE = [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]];
  const free = (x, z, y) => arenaGap(arena, x, z) > PHYS.radius + R && PROBE.every(([ox, oz]) => {
    const [px, pz] = solveXZ(near, x + ox, z + oz, y, doors);
    return Math.abs(px - x - ox) < 1e-4 && Math.abs(pz - z - oz) < 1e-4;
  });
  const i0 = Math.round((start.x - x0) / C), j0 = Math.round((start.z - z0) / C);
  const seen = new Set([key(i0, j0)]);
  const q = [[i0, j0, supportInfo(near, x0 + i0 * C, z0 + j0 * C, start.y + 0.1).y]];
  const got = new Map();
  while (q.length) {
    const [i, j, y] = q.pop();
    const x = x0 + i * C, z = z0 + j * C;
    if (!free(x, z, y)) continue;
    got.set(key(i, j), { i, j, x, y, z });
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, k = key(ni, nj);
      if (seen.has(k)) continue;
      const ny = supportInfo(near, x0 + ni * C, z0 + nj * C, y).y;
      if (Math.abs(ny - y) > PHYS.step) continue;
      seen.add(k);
      q.push([ni, nj, ny]);
    }
  }
  const out = [];
  for (const c of got.values()) {
    let flat = true;
    for (let di = -1; di <= 1 && flat; di++) {
      for (let dj = -1; dj <= 1 && flat; dj++) {
        const n = got.get(key(c.i + di, c.j + dj));
        if (!n || Math.abs(n.y - c.y) > 0.01) flat = false;
      }
    }
    out.push({ x: c.x, y: c.y, z: c.z, flat });
  }
  return out;
}

/**
 * 一張圖的人民站在哪：FOLK.clusters 叢、每一叢 FOLK.members 隻，撒在 `cells`（walkCells）裡平的、
 * `ok(x, z)` 也說可以的那幾格。湊不滿一叢最少的隻數就換一個地方再試，試不出來就少一叢。
 *
 * @param {(x: number, z: number) => boolean} ok 黑牆、感測區、模式要排掉的地方
 * @returns {{x, y, z, yaw, look, cluster}[]}
 */
export function plan(cells, rng, ok = () => true) {
  const room = cells.filter((c) => c.flat && ok(c.x, c.z));
  const out = [];
  const want = pick(rng, FOLK.clusters);
  for (let n = 0; n < want; n++) {
    for (let tries = 0; tries < 30; tries++) {
      const c = room[Math.floor(rng() * room.length)];
      if (!c || out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < FOLK.apart)) continue;
      const pool = room.filter((d) => Math.abs(d.y - c.y) < 0.01 && Math.hypot(d.x - c.x, d.z - c.z) <= FOLK.spread);
      const size = pick(rng, FOLK.members), group = [c];
      while (group.length < size && pool.length) {
        const d = pool.splice(Math.floor(rng() * pool.length), 1)[0];
        if (group.every((g) => Math.hypot(g.x - d.x, g.z - d.z) >= FOLK.gap)) group.push(d);
      }
      if (group.length < FOLK.members[0]) continue;
      const cx = group.reduce((s, g) => s + g.x, 0) / group.length, cz = group.reduce((s, g) => s + g.z, 0) / group.length;
      for (const g of group) {
        out.push({
          x: g.x, y: g.y, z: g.z, yaw: Math.atan2(cx - g.x, cz - g.z),
          look: FOLK.looks[Math.floor(rng() * FOLK.looks.length)], cluster: n,
        });
      }
      break;
    }
  }
  return out;
}

export class Folk {
  /** @param {import('./critter.js').Zoo} zoo */
  constructor(scene, zoo) {
    this.scene = scene;
    this.zoo = zoo;
    /** 每一隻：{critter, gaze, block, x, y, z}。 */
    this.list = [];
    this._inkPx = null;
  }

  setInkPx(px, h) {
    this._inkPx = [px, h];
    for (const f of this.list) f.critter.setInkPx(px, h);
  }

  /**
   * 撒一遍（之前的收掉）：每一張圖照 plan。
   *
   * @param {object} ruins blocks.js buildRuins 的輸出（arenas、spawns、portals）
   * @param {object[]} cols 碰撞體
   * @param {object} doors 門的狀態
   * @param {(x: number, z: number) => boolean} away 模式要排掉的地方（true = 不撒）
   * @param {() => number} rng
   */
  spawn(ruins, cols, doors, away = () => false, rng = Math.random) {
    this.clear();
    for (const arena of ruins.arenas) {
      const [sx, sy, sz] = ruins.spawns[arena.id];
      const ok = (x, z) => arenaGap(arena, x, z) > FOLK.edge && !away(x, z)
        && ruins.portals.every((p) => portalGap(p, x, z)[0] > FOLK.portal);
      for (const s of plan(walkCells(cols, arena, { x: sx, y: sy, z: sz }, doors), rng, ok)) {
        const [model, skin] = s.look.split('/');
        const own = this.zoo.critters.get(model);
        const critter = new Critter(own.data, model, { height: own.height, skin });
        critter.setHat(false);
        critter._yaw = critter._yawGoal = s.yaw;
        critter.root.position.set(s.x, s.y, s.z);
        critter.root.visible = false;
        if (this._inkPx) critter.setInkPx(...this._inkPx);
        this.scene.add(critter.root);
        this.list.push({ critter, gaze: new Gaze(), block: arena.id, x: s.x, y: s.y, z: s.z, aimX: Math.sin(s.yaw), aimZ: Math.cos(s.yaw) });
      }
    }
  }

  /** 全部收掉（重玩）。 */
  clear() {
    for (const f of this.list) {
      this.scene.remove(f.critter.root);
      f.critter.geometry?.dispose?.();
    }
    this.list = [];
  }

  /** 主角那一張圖裡的那幾隻（給接觸陰影）。 */
  here(block) { return this.list.filter((f) => f.block === block); }

  /** 一幀：主角那一張圖裡的站著、頭跟著主角；其餘藏著。在相機擺好之後叫。 */
  update(dt, camera, player, block) {
    const ty = player.y + GAZE.eye * PHYS.height;
    for (const f of this.list) {
      const c = f.critter, on = f.block === block;
      c.root.visible = on;
      if (!on) continue;
      const aim = aimHead(c._yaw, f.x, f.y + GAZE.eye * c.height, f.z, player.x, ty, player.z);
      c.update(dt, {
        speed: 0, grounded: true, vy: 0,
        viewYaw: Math.atan2(camera.position.x - f.x, camera.position.z - f.z), move: f.gaze.step(dt, aim),
      });
    }
  }
}
