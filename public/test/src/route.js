/* ── test/src/route.js ───────────────────────────────────────────────
   完整流程模式的路線：打哪幾場、照什麼順序、每一場之間開哪幾扇門、倒下之後
   在哪裡休息。

   跟 combat.js 一樣只有規則與資料、不碰畫面，所以 tools/verify-flow.mjs 在
   node 底下驗得到「每一步開的門走得到下一場、而且走不到更後面的」。

   ── 路線 ────────────────────────────────────────────────────────
     兵營 → 中庭 → 窄巷 → 井（不打）→ 水窖 → 墓室 →（傳送）中庭 → 王座廳

   照劇本（STORY.md）：兵營殭屍三隻、中庭 BOSS、窄巷騎士、水窖與墓室幽靈各六隻、
   王座廳國王。「走過不打」不用另外處理：每一場只打一次，清完就是清完。
   墓室打完不走回去：漫畫翻過回程那一頁，書頁還蓋著的時候直接送到王座廳那一場
   的休息點（`warp`）。

   ── 門 ──────────────────────────────────────────────────────────
     打的時候    所有的門都關上，所有的傳送（包括井與水窖殘階這兩條單向的）都不通。
     沒在打的時候 只開通往下一場的那幾扇（`OPEN`）——下一場在好幾張圖之外的時候，
                 整條路上的門一起開。
     全部打完    所有的門都開，隨便逛。

   ── 倒下 ────────────────────────────────────────────────────────
   不在同一個房間裡重生：回到這一場的入口外面（`rest`，那個入口另一頭的到達點），
   面朝入口，BOSS 收起來。休息夠了自己走回去，一進房間就重打。兵營是起點，
   它的入口外面就是起點本身（起點在觸發範圍外面）。
   ------------------------------------------------------------------ */

import { BLOCKS, DOORS } from './blocks.js';
import { KINDS } from './combat.js';

/** 牆頂那一層與兵營那一層的分界：腳高過它就是在牆頂（走道面 5.2，地面 0）。 */
const TOP = 3.5;

/**
 * 一個位置屬於哪個「房間」：區塊的 id，城牆步道分成兩層（地面的兵營、牆頂的走道）。
 * 兩層之間只有圓塔的門，所以對路線來說它們是兩個房間。
 */
export const roomOf = (block, y) => (block === 'wallwalk' && y > TOP ? 'wallwalk:top' : block);

/**
 * 每一場：
 *   id, name   給人看的名字；hint 是面板上那一行說明
 *   room       在哪個房間打（roomOf 的那一種）
 *   enter      房間裡還要再滿足這個（區塊的局部座標）才開打；沒有就是一進房間就打
 *   foes       怪物的種類與站位，區塊的局部座標（y 是腳下那一層地板）
 *   rest       倒下之後在哪裡休息：一個到達點的名字（blocks.js 的 arrivals）
 *   entry      這一場的入口：感測區在哪個區塊、送到哪個到達點——休息的時候面朝它
 *   warp       打完不走過去：直接送到下一場的休息點（墓室 → 中庭）
 */
/** 一圈 n 隻：半徑 r、中心 (cx, cz)，都面朝中心。 */
const ring = (kind, n, r, cx = 0, cz = 0, a0 = 0) => Array.from({ length: n }, (_, i) => {
  const a = a0 + (2 * Math.PI * i) / n;
  const x = cx + r * Math.sin(a), z = cz + r * Math.cos(a);
  return { kind, x, y: 0, z, yaw: Math.atan2(cx - x, cz - z) };
});

export const STAGES = [
  {
    id: 'barracks', name: '兵營', hint: '起點。往城門走，殭屍在城門前。',
    room: 'wallwalk', enter: (x, z) => z > -14,
    foes: [
      { kind: 'minion', x: -2.5, y: 0, z: -6.5, yaw: Math.PI },
      { kind: 'minion', x: 0, y: 0, z: -8, yaw: Math.PI },
      { kind: 'minion', x: 2.5, y: 0, z: -6.5, yaw: Math.PI },
    ],
    rest: 'wallwalk.fog', entry: null,
  },
  {
    id: 'courtyard', name: '崩塌中庭', hint: '從兵營南邊的黑霧過去。',
    room: 'courtyard',
    foes: [{ kind: 'boss', x: -4, y: 0, z: 0, yaw: Math.PI / 2 }],
    rest: 'wallwalk.fog', entry: { from: 'wallwalk', to: 'courtyard.east' },
  },
  {
    id: 'alley', name: '城內窄巷', hint: '中庭的西拱洞過去，騎士在井後面。',
    room: 'alley',
    foes: [{ kind: 'knight', x: 0, y: 0, z: 11.6, yaw: Math.PI }],
    rest: 'courtyard.west', entry: { from: 'courtyard', to: 'alley.fog' },
  },
  {
    id: 'cistern', name: '圓塔水窖', hint: '跳進窄巷的井裡。',
    room: 'cistern',
    foes: ring('ghost', 6, 7, 0, 0, Math.PI / 6),
    rest: 'alley.stair', entry: { from: 'alley', to: 'cistern.well' },
  },
  {
    id: 'crypt', name: '地下墓室', hint: '水窖南邊的鐵閘。',
    room: 'crypt',
    foes: [-1, 1].flatMap((sx) => [1, 5, 9].map((z) => ({ kind: 'ghost', x: sx * 1.2, y: 0, z, yaw: Math.PI }))),
    rest: 'cistern.gate', entry: { from: 'cistern', to: 'crypt.gate' },
    warp: true,
  },
  {
    id: 'throne', name: '王座廳', hint: '回到中庭，門樓的鐵閘升起來了。',
    room: 'throne',
    foes: [{ kind: 'king', x: 0, y: 0, z: 6, yaw: Math.PI }],
    rest: 'courtyard.gate', entry: { from: 'courtyard', to: 'throne.gate' },
  },
];

/**
 * 沒在打的時候開哪幾扇門：下一場是第 k 場就開 OPEN[k]——從上一場走到這一場的
 * 路上所有的門。窄巷到水窖是井（單向，沒有門）；墓室到王座廳是傳送過去的，只開中庭到王座廳那一扇。
 */
export const OPEN = [
  [],
  ['courtyard-wallwalk'],
  ['courtyard-alley'],
  [],
  ['cistern-crypt'],
  ['courtyard-throne'],
];

/** 一開始站在哪：第一場的休息點（兵營南端，黑霧前、面朝城門）。 */
export const START = STAGES[0].rest;

/** 區塊的原點（世界座標）。 */
const origin = (room) => BLOCKS.find((b) => b.id === room.split(':')[0]).origin;

/** 第 k 場的怪物與站位，世界座標（combat.js 的 makeMonster 吃的那一種）。 */
export function foesOf(k) {
  const s = STAGES[k], [ox, oz] = origin(s.room);
  return s.foes.map((f) => ({ ...f, x: f.x + ox, z: f.z + oz }));
}

/**
 * 一輪打下來掉得出幾顆靈魂：每一場的怪物裡會掉靈魂的（KINDS 的 `soul`）一隻一顆，全部加起來。
 * 國王要收的就是這麼多（offer.js）——加一隻會掉靈魂的怪物、改哪一場有幾隻，這裡自己跟著變。
 */
export const SOULS = STAGES.reduce((n, s) => n + s.foes.filter((f) => KINDS[f.kind].soul).length, 0);

/** 站在 (x, y, z)、區塊 `block` 裡：是不是進了第 k 場的範圍（進了就開打）。 */
export function inStage(k, block, x, y, z) {
  const s = STAGES[k];
  if (roomOf(block, y) !== s.room) return false;
  if (!s.enter) return true;
  const [ox, oz] = origin(s.room);
  return s.enter(x - ox, z - oz);
}

/**
 * 路線的狀態：下一場是第幾場（`next`，全部打完就是 STAGES.length），以及是不是
 * 正在打（`active`）。
 */
export const makeRun = (next = 0) => ({ next, active: false });

/** 這個狀態底下每一扇門開不開（門的 id → 開著嗎）。 */
export function doorsFor(run) {
  const done = run.next >= STAGES.length;
  const open = new Set(run.active || done ? [] : OPEN[run.next]);
  return Object.fromEntries(DOORS.map((d) => [d.id, !run.active && (done || open.has(d.id))]));
}

/** 這個狀態底下傳送通不通：打的時候全部不通（單向的井與殘階也是）。 */
export const portalsOn = (run) => !run.active;

/**
 * 倒下之後的休息點：到達點的位置，面朝這一場的入口（入口的感測區的中心）。
 * 沒有入口（第一場，起點本身）就照到達點自己的方向。
 *
 * @param {object} ruins blocks.js buildRuins() 的輸出
 * @returns {{x: number, y: number, z: number, yaw: number, block: string}}
 */
export function restAt(k, ruins) {
  const s = STAGES[k];
  const a = ruins.arrivals[s.rest];
  let yaw = a.yaw;
  if (s.entry) {
    const p = ruins.portals.find((q) => q.block === s.entry.from && q.to === s.entry.to);
    const [cx, cz] = p.shape === 'box' ? [(p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2] : [p.x, p.z];
    yaw = Math.atan2(cx - a.x, cz - a.z);
  }
  return { x: a.x, y: a.y, z: a.z, yaw, block: a.block };
}
