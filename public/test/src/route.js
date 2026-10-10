/* ── test/src/route.js ───────────────────────────────────────────────
   完整流程模式的路線：打哪幾場、照什麼順序、每一場之間開哪幾扇門、倒下之後
   在哪裡休息。

   跟 combat.js 一樣只有規則與資料、不碰畫面，所以 tools/verify-flow.mjs 在
   node 底下驗得到「每一步開的門走得到下一場、而且走不到更後面的」。

   ── 路線 ────────────────────────────────────────────────────────
     兵營 → 中庭 → 窄巷 → 井（不打）→ 水窖 → 墓室 →（傳送）中庭 → 王座廳

   照劇本（STORY.md）：兵營殭屍三隻、中庭殭屍王、窄巷騎士、水窖幽靈六隻、墓室幽靈六隻與
   一隻幽靈騎士——幽靈從石棺、幽靈騎士從北端的大墓升上來——王座廳國王。怪物怎麼出場見 `entranceOf`。「走過不打」不用另外處理：每一場只打一次，清完就是清完。
   墓室打完不走回去：漫畫翻過回程那一頁，書頁還蓋著的時候直接送到王座廳那一場
   的休息點（`warp`）。

   ── 門 ──────────────────────────────────────────────────────────
     打的時候    所有的門都關上，所有的傳送（包括井與水窖殘階這兩條單向的）都不通。
     沒在打的時候 每進一張圖就重算：全部關上，只開從這張圖往下一場的那一步（`openPortals`）。
                 來時的門在背後關上，沒門的殘階也不通——永遠只有一條路往前走。
     全部打完    國王打完的那一刻所有的門都開，隨便逛。

   ── 倒下 ────────────────────────────────────────────────────────
   不在同一個房間裡重生：回到這一場的入口外面（`rest`，那個入口另一頭的到達點），
   面朝入口，殭屍王收起來。休息夠了自己走回去，一進房間就重打。兵營是起點，
   它的入口外面就是起點本身（起點在觸發範圍外面）。
   ------------------------------------------------------------------ */

import { BLOCKS, DOORS, COFFINS, GRAVE } from './blocks.js';
import { KINDS } from './combat.js';

/** 牆頂那一層與兵營那一層的分界：腳高過它就是在牆頂（走道面 5.2，地面 0）。 */
const TOP = 3.5;

/**
 * 一個位置屬於哪個「房間」：區塊的 id，城牆步道分成兩層（地面的兵營、牆頂的走道）。
 * 兩層之間只有圓塔的門，所以對路線來說它們是兩個房間。
 */
export const roomOf = (block, y) => (block === 'wallwalk' && y > TOP ? 'wallwalk:top' : block);

/** 房間給人看的名字：區塊的名字；城牆步道那兩層分開叫（地面是兵營，上面是城牆上）。 */
export function roomName(room) {
  if (room === 'wallwalk') return '兵營';
  if (room === 'wallwalk:top') return '城牆上';
  return BLOCKS.find((b) => b.id === room).name;
}

/**
 * 動態路標（signpost.js 畫）：房間 `room` 裡的每一個感測區——門、霧口、井、殘階，全部都算——
 * 一筆：指向哪一點（感測區登記的 `aim`，見 geom.js 的 portal）、通到哪個房間（`to`，給人看的名字是
 * `name`）、屬於哪一扇門（沒有門的一直通）。感測區算在它自己那一層：城牆步道的圓塔兩扇門
 * 在同一張圖裡，但站在兵營走不到牆頂那一扇，反過來也是，所以各自只出現在自己那一層。
 *
 * `seen`：這一輪進過的房間（完整流程模式記的）。通到一個還沒進過、而且是某一場的房間，
 * 字寫去那裡的目的（那一場的 `goal`），不寫地名——還沒去過，主角只知道為什麼要去。
 * 沒給 `seen`（地形模式）就一律寫地名。
 */
export function signposts(portals, room, seen = null) {
  const out = [];
  for (const p of portals) {
    if (portalRoom(p) !== room) continue;
    const to = roomOf(p.dest.block, p.dest.y);
    const goal = seen && !seen.has(to) ? STAGES.find((s) => s.room === to)?.goal : null;
    const { x, y, z } = p.aim;
    out.push({ portal: p, x, y, z, to, name: goal || roomName(to), door: p.door || null });
  }
  return out;
}

/**
 * 每一場：
 *   id, name   給人看的名字；hint 是面板上那一行說明
 *   room       在哪個房間打（roomOf 的那一種）
 *   enter      房間裡還要再滿足這個（區塊的局部座標）才開打；沒有就是一進房間就打
 *   foes       怪物的種類與站位，區塊的局部座標（y 是腳下那一層地板）。帶 `boss` 的那一隻是這一場的
 *              BOSS（最多一隻）：牠出場的時候畫面最上方展開牠的血條（bossbar.js）。沒有帶的那一場沒有 BOSS
 *   debut      初見模式：這一輪第一次登場的時候怎麼出場（entranceOf）。'comic' 是開場漫畫蓋住
 *              畫面的那一刻就在站位上生好，漫畫走了才開始動；'rise' 是從站位底下升上來
 *   rest       倒下之後在哪裡休息：一個到達點的名字（blocks.js 的 arrivals）
 *   entry      這一場的入口：感測區在哪個區塊、送到哪個到達點——休息的時候面朝它
 *   warp       打完不走過去：直接送到下一場的休息點（墓室 → 中庭）
 *   goal       為什麼要去這一場（照上一場的戰後漫畫）：還沒進過這個房間的時候，路標指著通往它的
 *              門寫這個，不寫地名（signposts）
 */
/** 一圈 n 隻：半徑 r、中心 (cx, cz)，都面朝中心。 */
const ring = (kind, n, r, cx = 0, cz = 0, a0 = 0) => Array.from({ length: n }, (_, i) => {
  const a = a0 + (2 * Math.PI * i) / n;
  const x = cx + r * Math.sin(a), z = cz + r * Math.cos(a);
  return { kind, x, y: 0, z, yaw: Math.atan2(cx - x, cz - z) };
});

/**
 * 墓室的七隻，都面朝鐵閘：兩排石棺各取北邊三具（最南那一對離鐵閘太近，一進門
 * 就貼著人），一具一隻幽靈，站在棺蓋上；幽靈騎士從北端那座大墓（GRAVE）升上來，站在石蓋上。
 */
const tomb = () => [
  ...COFFINS.filter((c) => c.i > 0).map((c) => ({ kind: 'ghost', x: c.x, y: c.top, z: c.z, yaw: Math.PI })),
  { kind: 'wraith', x: GRAVE.x, y: GRAVE.top, z: GRAVE.z, yaw: Math.PI, boss: true },
];

export const STAGES = [
  {
    id: 'barracks', name: '兵營', hint: '起點。往城門走，殭屍在城門前。',
    room: 'wallwalk', enter: (x, z) => z > -14, debut: 'rise',
    foes: [
      { kind: 'minion', x: -2.5, y: 0, z: -6.5, yaw: Math.PI },
      { kind: 'minion', x: 0, y: 0, z: -8, yaw: Math.PI },
      { kind: 'minion', x: 2.5, y: 0, z: -6.5, yaw: Math.PI },
    ],
    rest: 'wallwalk.fog', entry: null,
  },
  {
    id: 'courtyard', name: '中庭', hint: '從兵營南邊的黑霧過去。',
    room: 'courtyard', goal: '調查殭屍來歷', debut: 'comic',
    foes: [{ kind: 'boss', x: -4, y: 0, z: 0, yaw: Math.PI / 2, boss: true }],
    rest: 'wallwalk.fog', entry: { from: 'wallwalk', to: 'courtyard.east' },
  },
  {
    id: 'alley', name: '城鎮窄巷', hint: '中庭的西拱洞過去，騎士在井後面。',
    room: 'alley', goal: '喝水', debut: 'comic',
    foes: [{ kind: 'knight', x: 0, y: 0, z: 11.6, yaw: Math.PI, boss: true }],
    rest: 'courtyard.west', entry: { from: 'courtyard', to: 'alley.fog' },
  },
  {
    id: 'cistern', name: '水窖', hint: '跳進窄巷的井裡。',
    room: 'cistern', goal: '喝水', debut: 'comic',
    foes: ring('ghost', 6, 7, 0, 0, Math.PI / 6),
    rest: 'alley.stair', entry: { from: 'alley', to: 'cistern.well' },
  },
  {
    id: 'crypt', name: '地下墓室', hint: '水窖南邊的鐵閘。',
    room: 'crypt', goal: '調查幽靈來歷', debut: 'rise',
    foes: tomb(),
    rest: 'cistern.gate', entry: { from: 'cistern', to: 'crypt.gate' },
    warp: true,
  },
  {
    id: 'throne', name: '王座廳', hint: '回到中庭，門樓的鐵閘升起來了。',
    room: 'throne', goal: '見國王', debut: 'rise',
    foes: [{ kind: 'king', x: 0, y: 0, z: 6, yaw: Math.PI, boss: true }],
    rest: 'courtyard.gate', entry: { from: 'courtyard', to: 'throne.gate' },
  },
];

/** 一開始站在哪：第一場的休息點（兵營南端，黑霧前、面朝城門）。 */
export const START = STAGES[0].rest;

/** 區塊的原點（世界座標）。 */
const origin = (room) => BLOCKS.find((b) => b.id === room.split(':')[0]).origin;

/**
 * 第 k 場的怪物與站位，世界座標（combat.js 的 makeMonster 吃的那一種）。`rise`：每一隻都從
 * 站位底下升上來、升到站位才上場（fight.js 的 lineup）；不然一放上場就在站位上。
 */
export function foesOf(k, rise = false) {
  const s = STAGES[k], [ox, oz] = origin(s.room);
  return s.foes.map((f) => ({ ...f, x: f.x + ox, z: f.z + oz, ...(rise ? { rise: true } : {}) }));
}

/**
 * 第 k 場的怪物這一次怎麼出場：
 *   'comic'  開場漫畫蓋住畫面的那一刻在站位上生好，漫畫走了才開始動。
 *   'rise'   從站位底下升上來（墓室的在棺蓋與大墓的石蓋上，所以是從棺材裡升上來）。
 * 看兩件事：這一場的初見模式（`debut`），與這一輪牠們是不是已經登場過（`appeared`：倒下之後
 * 回來重打）。登場過的一律升上來——第二次進來沒有開場漫畫可以蓋住牠們生出來的那一刻。
 * `comic`：這一次真的有開場漫畫要翻；初見模式是 'comic' 卻沒有漫畫的話也是升上來。
 */
export function entranceOf(k, appeared, comic) {
  return !appeared && comic && STAGES[k].debut === 'comic' ? 'comic' : 'rise';
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

/** 感測區在哪個房間：它門口那一層（沒有門口的看感測區的底）。 */
export const portalRoom = (p) => roomOf(p.block, p.mouth ? p.mouth.y : p.y0 + 0.5);

/**
 * 這個狀態底下、站在房間 `room` 的時候，走得通的感測區（門、霧口、井、殘階一視同仁）：
 *   打的時候      一個都不通。
 *   全部打完      全部都通（國王打完的那一刻起）。
 *   其他時候      只有往下一場的那一步：從這個房間沿最短的路（不管門開不開）走到下一場的
 *                 房間，第一步走的那幾個感測區。所以每進一張圖，來時的門就關上、只剩往前的
 *                 那一條路——走回頭路的門、沒門的殘階都不通。已經在下一場的房間裡（還沒走進
 *                 觸發範圍，例如兵營）就一個都不通。
 */
export function openPortals(portals, room, run) {
  if (run.active) return [];
  if (run.next >= STAGES.length) return portals;
  const to = (p) => roomOf(p.dest.block, p.dest.y);
  // 每個房間離下一場的房間幾步：從終點往回一圈一圈擴。
  const dist = new Map([[STAGES[run.next].room, 0]]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of portals) {
      const a = portalRoom(p), d = dist.get(to(p));
      if (d !== undefined && !(dist.get(a) <= d + 1)) { dist.set(a, d + 1); grew = true; }
    }
  }
  const here = dist.get(room);
  if (!here) return [];
  return portals.filter((p) => portalRoom(p) === room && dist.get(to(p)) === here - 1);
}

/** 這個狀態底下、站在 `room` 的時候每一扇門開不開（門的 id → 開著嗎）：openPortals 用得到的那幾扇開。 */
export function doorsFor(portals, room, run) {
  const open = new Set(openPortals(portals, room, run).map((p) => p.door).filter(Boolean));
  return Object.fromEntries(DOORS.map((d) => [d.id, open.has(d.id)]));
}

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
