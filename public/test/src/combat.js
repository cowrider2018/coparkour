/* ── test/src/combat.js ───────────────────────────────────────
   試打場的規則：場地、站位、怪物、攻擊。

   跟 walk.js 一樣是「規則」而不是「畫面」：這裡只算數字，
   套到 three 上是 mode-combat.js 的事。分出來是因為它有兩個使用者——這一頁，
   以及 tools/verify-combat.mjs。

   ── 場地 ────────────────────────────────────────────────────────
   一塊方形空地，外圈一道黑牆，沒有任何結構。黑牆就是試玩場那一道
   （veil.js 畫、walk.js 的 'bound' 擋），差別只在它圍的是一片空地。

   ── 站位 ────────────────────────────────────────────────────────
   「中線」是穿過場地中心、沿著 z 軸的那一條。玩家站在它的 2/3、面向
   中心（−z）。怪物排在中線 1/3 的那條橫線上，面向場地中心——隔著中心跟
   玩家對望。排哪幾隻由「陣容」決定（MODES）：

     3 殭屍          中線上一隻、左右各 4 公尺一隻。
     1 殭屍王          中線上。
     1 幽靈騎士      中線上（預設）。
     3 幽靈          跟 3 殭屍同樣的站位。
     1 騎士          中線上。
     1 國王          中線上。

   ── 怪物 ────────────────────────────────────────────────────────
   一直追著玩家跑。身體跟玩家一樣大（同一個 PHYS 的圓柱）。碰到玩家不再
   有事——傷害是一次一次的攻擊（衝刺，見 LUNGE）：追到 LUNGE.range 以內，
   站著發呆（蓄力）0.25 秒，然後朝那時鎖定的方向衝一下（速度 16、0.25 秒內
   減到 0），衝完僵直 0.75 秒才回去追。只有衝的那 0.25 秒裡碰到玩家，玩家
   才被咬到、扣血（小怪 1、騎士 2、殭屍王 3、國王 2，見 KINDS 的 `bite` 與下面的「玩家的血」）。
   國王（KINDS 的 `lunges`）一次衝兩下：衝完第一下不僵直，重新蓄力 0.25 秒、朝玩家那時
   的位置再衝一下，第二下衝完才僵直。兩下之間不到 LIFE.guard，所以第一下咬到的話第二下
   不再扣血——第二下是給躲過第一下的人的。

   國王身邊有三面盾（KINDS 的 `shields`）：挨打的時候先用掉一面，那一下整個不算——
   不扣血、不擊退、不累積破防、衝刺也不取消（parry）。挨打（不管擋沒擋）之後
   `shieldEvery` 秒沒再挨打，補回一面，補到滿為止。

   攻擊中（attacking：放招、或衝刺的蓄力加衝，不含之後的僵直）被打會怎樣看類別
   （KINDS 的 `steady`）：小怪一打就取消；殭屍王不會被打斷——跟放招的倒數一樣
   打不退、傷害減半（armored）。畫面上攻擊中墨線變紅，跟 armored 出自同一個
   attacking，所以殭屍王的不可打斷與紅色永遠是同一段。

   幽靈（KINDS 的 `fly`）不受重力、會飛：y 跟 x、z 是同一回事。追人是朝玩家
   的腳在三維裡追、衝刺朝三維的方向衝；被擊退的時候速度一樣照那一段給，但不
   往下掉，而是三個軸一起照 FLY.drag 減速，停在半空中再回去追。

   每一下都會扣血（各段的傷害見 DAMAGE）。血扣到 0 就死，當場在牠自己的
   重生點重生（血滿、破防歸零），玩家留在原地。被打中還會被擊退：水平往遠離玩家的方向、
   垂直往上，兩份動能一起給。

   ── 破防 ────────────────────────────────────────────────────────
   每一隻怪物各自累積受到的傷害，累積到破防門檻（一律 BREAK_AT = 8）就「破防」：
   開一個 BREAK_WINDOW 秒的窗口，畫面上是一圈淡色的圓與一圈從同樣大小縮到
   消失的亮圓。窗口裡累積不再增加；窗口過了沒用上（錯過），累積歸零重新算。

   窗口開著時按跳，就是破防攻擊（用掉窗口，累積一樣歸零）。在地上、在空中都
   可以——破防多半是被第二段打出來的，那一刻玩家正在第二段的空中：

     突進  朝目標的頭頂飛過去（一次給足水平與垂直速度，照拋物線走）。有好幾隻
           破防中的時候，選最近的那一隻。
     迴旋  碰到牠的那一刻，記下玩家相對於牠的位置；牠原地轉一圈，玩家保持那個
           相對位置繞著牠轉 360°。
     跳離  轉完扣 5 點血，玩家往突進的反方向、往上跳下來；同一瞬間怪物被往
           另一邊（突進的方向）推開——只有水平，不往上挑。在地上的怪物是沿著
           地面滑出去、滑到停；在空中被定住的，放開之後帶著這一份水平速度落下。

   ── 玩家的血 ────────────────────────────────────────────────────
   一開始 LIFE.start（3）顆心。被咬、被殭屍王的招打到都扣血，扣多少看是哪一下
   （小怪衝刺 1、騎士衝刺 2、殭屍王衝刺 3、殭屍王的其他招 5，見 KINDS 的 `bite` 與 skills.js
   的 SKILL）；扣到 0 才倒下。挨了一下之後 LIFE.guard 秒不再被打中（見 harm）。
   殭屍王死掉會掉出一顆靈魂（發光的狗頭），撿起來最大血量 +1（見 SOUL）。不在戰鬥中的
   時候（由模式決定，見 regen）很快回血回到最大血量。

   從按下去到跳離之後落地，玩家都是無敵的——整招都貼在怪物身上。飛在空中（被擊退、還沒落地）的怪物碰到玩家不算數。
   空中再挨一下就再擊退一次——每一下都是把速度**換成**擊退的那一份，
   不是疊上去，所以連打是一直被挑在空中，而不是越飛越快。

   ── 攻擊 ────────────────────────────────────────────────────────
   長度一律是 1.5 個狗高（REACH），角度各段不同。第一段是自動的：怪物
   走進第一段的範圍、玩家站在地上、手上沒有別的招，就出手。所以「靠近」
   的定義就是「打得到」——在背後的怪物不會讓玩家對著空氣揮一下。

     第一段  面向的 120° 水平扇形，高度在玩家身高的中間。
     第二段  第一段收招後 0.25～0.75 秒內按跳：跳起來，同時打一片直立的
             90° 扇形。圓心在玩家腳下，下緣是「腳下 → 上一次第一段扇形正中
             那條半徑的末端」那一條線，往上掃 90° 越過頭頂。方向跟著那個
             末端點走，不是跟著玩家現在的面向。
     第三段  第二段收招之後、落地之前再按跳：把垂直速度換成一次新的起跳
             （二段跳），一直到落地都是無敵的；落地那一下打一圈 360°，
             高度在身高中間。
   ------------------------------------------------------------------ */

import { PHYS, solveXZ, steer, supportInfo, colsNear } from './walk.js';
import { ROAM } from './roam.js';

/** 狗有多高。攻擊的長度都用它量，所以跟物理的身體是同一個數字。 */
export const DOG_H = PHYS.height;

/** 場地：24 公尺見方，黑牆 8 公尺高封頂。 */
export const ARENA = { id: 'arena', shape: 'rect', x0: -12, x1: 12, z0: -12, z1: 12, lid: 8 };

/** 中線上第 u 個比例的那一點（u = 0 在 z0 那一端）。 */
export const onMidline = (u) => ARENA.z0 + (ARENA.z1 - ARENA.z0) * u;

/** 面向場地中心的 yaw（atan2(x, z) 那一種）。 */
const faceCentre = (x, z) => Math.atan2((ARENA.x0 + ARENA.x1) / 2 - x, (ARENA.z0 + ARENA.z1) / 2 - z);

const MID_X = (ARENA.x0 + ARENA.x1) / 2;

/** 怪物的一個站位：中線 1/3 那條橫線上、離中線 dx 公尺，面向中心。 */
const post = (kind, dx) => {
  const x = MID_X + dx, z = onMidline(1 / 3);
  return { kind, x, z, yaw: faceCentre(x, z) };
};

/**
 * 陣容：右邊那塊面板上選的。每一種是一張怪物站位的清單，一隻一筆，帶著牠是
 * 哪一類（KINDS 的鍵）。順序就是面板上的順序（數字鍵 1～6）。
 */
export const MODES = [
  { id: 'minions', name: '3 殭屍', hint: '三隻殭屍。', monsters: [post('minion', -4), post('minion', 0), post('minion', 4)] },
  { id: 'boss', name: '1 殭屍王', hint: '一隻兩倍大的殭屍王。', monsters: [post('boss', 0)] },
  {
    id: 'wraith', name: '1 幽靈騎士',
    hint: '一隻半透明、會飛的騎士，兩套連斬：下劈、上挑、在空中轉一圈（對空），或下劈、在地上轉一圈、上挑（對地）。',
    monsters: [post('wraith', 0)],
  },
  { id: 'ghosts', name: '3 幽靈', hint: '三隻半透明、會飛的幽靈。', monsters: [post('ghost', -4), post('ghost', 0), post('ghost', 4)] },
  { id: 'knight', name: '1 騎士', hint: '一隻咬著雙刃劍、1.2 倍高的騎士。', monsters: [post('knight', 0)] },
  { id: 'king', name: '1 國王', hint: '一隻戴王冠、半透明、1.4 倍高的國王，身邊三面盾。', monsters: [post('king', 0)] },
];

/** 一開始是哪一個陣容。 */
export const DEFAULT_MODE = 'wraith';

/**
 * 站位：玩家在中線 2/3；`monsters` 是標準陣容——大隻的殭屍王在中線上、兩隻殭屍在左右各 4 公尺
 * （離線驗證拿它當標準陣容用，makeMonster 不給站位就是那隻殭屍王）。面板上已經沒有這一種了。
 * yaw 是 atan2(x, z) 那一種。
 */
export const SPAWN = {
  player: { x: MID_X, z: onMidline(2 / 3), yaw: Math.PI },
  monsters: [post('boss', 0), post('minion', -4), post('minion', 4)],
};

/**
 * 碰撞清單：只有黑牆那一筆。欄位跟 geom.js `bound()` 登記的
 * 一樣（`kind: 'bound'` 加上外接盒），所以 solveXZ 與鏡頭的 boomLimit
 * 不必認得這一頁。
 */
export const COLS = [{
  kind: 'bound', ...ARENA,
  min: [ARENA.x0, -2, ARENA.z0], max: [ARENA.x1, 30, ARENA.z1], base: -2,
}];

/**
 * 怪物站在什麼樣的地方：黑牆（arena，擋路也封頂）、碰撞清單（cols，走路與
 * 地板都問它，跟玩家同一份）、門開著哪幾扇（doors，關著的門扇會擋）。
 *
 * 每一隻怪物帶著自己的那一份（`m.field`），規則一律問牠身上的，不問這個檔案的
 * 常數——所以同一套規則放得進任何一張圖：這一塊空地是 FIELD，完整流程裡是
 * 那一張遺跡的黑牆與碰撞。地板不是 0，是腳下那一塊的頂（牆頂的走道在 5.2）。
 *
 * `roam`（可以沒有）：會走路的怪物准許待在哪（roam.js）。有的話，不是走路的移動（被打飛、
 * 跳砍、跳砸）只落在這裡面；這一塊空地四面平坦、只有黑牆，用不著。
 */
export const FIELD = { arena: ARENA, cols: COLS, doors: {} };

/**
 * 怪物的名冊：每一類怪物一筆數值，住在這裡而不是散在各支函式裡——之後多一類
 * 怪物就是多一筆，規則不動。每一隻怪物身上帶的是牠自己的「狀態」（位置、速度、
 * 挨了幾下…），數值一律回頭查這一張，用 `m.kind` 認類別。
 *
 *   minion  殭屍（綠色的小怪）。血 4——第一段加第二段剛好打死，破不了防。腳程 3.4：
 *           走路是 PHYS.walk（4），所以放開手就會被追上。
 *   boss    殭屍王（畫成兩倍大）。血 20。腳程 4。不會一直追：每 `every` 秒從 `skills`
 *           裡隨機放一招（規則在 skills.js），放招的時候站著不動。`steady`：
 *           衝刺（蓄力與衝）不會被打斷（見 armored）。
 *   ghost   幽靈（半透明的小怪）。血、腳程跟殭屍一樣。`fly`：不受重力，
 *           y 跟 x、z 一樣追、一樣衝、被擊退也不落下（見 FLY）。
 *   knight  騎士（殭屍畫成 1.2 倍高，嘴裡咬著一把雙刃劍）。血 10、腳程 3.6。
 *           衝刺跟小怪一樣一打就取消（不是 `steady`）。每 `every` 秒從 `skills`
 *           裡挑一招（skills.js），夠得到才放。
 *   wraith  幽靈騎士（騎士那一身，穿幽靈那一件、半透明）。數值跟騎士一樣，也掉靈魂；差別是招比較慢（`every`），
 *           `fly`（跟幽靈一樣不受重力），招只有兩套連斬（skills.js 的 reapAir：下劈、上挑、
 *           在空中原地轉一圈；reapGround：下劈、在地上原地轉一圈、上挑。三下連著），每次各一半。
 *           衝刺咬人照常。
 *   king  國王（垂耳狗，幽靈那一件毛、半透明，畫成 1.4 倍高）。血 40、腳程 3.8，走路、
 *           受重力。`lunges`：一次衝刺衝兩下才僵直（見 LUNGE）。`shields`：身邊幾面盾，
 *           每 `shieldEvery` 秒沒挨打補一面（見 parry）。衝刺跟小怪一樣一打就取消。每 `every`
 *           秒從 `skills` 裡挑一招（skills.js）。
 *
 * 碰撞的身體一樣大（同一個 PHYS 的圓柱）；外觀（同一件毛、殭屍王畫兩倍大、騎士 1.2 倍）在 monster.js。
 *
 * `bite` 是衝刺咬到玩家扣幾點血：小怪 1、騎士 2、殭屍王 3。`soul`：死掉的時候掉出一顆靈魂（見 SOUL）——殭屍與幽靈以外都會掉。
 *
 * `breakAt` 是破防門檻。現在每一類都是 BREAK_AT，但它是逐類登記的——哪天某一類
 * 要比較硬，改那一筆就好。
 */
export const BREAK_AT = 8;
export const KINDS = {
  minion: { name: '殭屍', hp: 4, speed: 3.4, breakAt: BREAK_AT, bite: 1 },
  boss: { name: '殭屍王', hp: 20, speed: 4, breakAt: BREAK_AT, bite: 3, soul: true, steady: true, skills: ['orb', 'leap', 'cone'], every: 3 },
  ghost: { name: '幽靈', hp: 4, speed: 3.4, breakAt: BREAK_AT, bite: 1, fly: true },
  knight: { name: '騎士', hp: 10, speed: 3.6, breakAt: BREAK_AT, bite: 2, soul: true, skills: ['whirl', 'cleave'], every: 3 },
  wraith: { name: '幽靈騎士', hp: 10, speed: 3.6, breakAt: BREAK_AT, bite: 2, soul: true, fly: true, skills: ['reapAir', 'reapGround'], every: 4 },
  king: { name: '國王', hp: 40, speed: 3.8, breakAt: BREAK_AT, bite: 2, lunges: 2, shields: 3, shieldEvery: 8, skills: ['hew', 'summon', 'gale'], every: 3 },
};

/**
 * 玩家的血。
 *
 *   start  一開始的最大血量（幾顆心）。撿到靈魂才會往上加（gainHeart）。
 *   guard  挨了一下之後幾秒不再被打中。衝刺碰著人是好幾幀、球穿過身體也是，不擋
 *          的話一下會算成好幾下；同一幀被好幾下碰到也只算最重的那一下（呼叫端挑）。
 *   regen  不在戰鬥中的時候，每幾秒回一顆心（regen），回到最大血量為止。
 *
 * 血、最大血量、guard、回血的計時記在玩家身上（`p.hp`、`p.max`、`p.guard`、`p.regenT`）。
 */
export const LIFE = { start: 3, guard: 1, regen: 0.3 };

/** 從頭開始：最大血量回到 LIFE.start，血滿。 */
export function resetLife(p) {
  p.max = LIFE.start;
  refill(p);
}

/** 血補滿（最大血量不變）、guard 清掉：倒下之後。 */
export function refill(p) {
  p.hp = p.max;
  p.guard = 0;
  p.regenT = 0;
}

/** 撿到一顆靈魂：最大血量 +1，多出來的那一顆是滿的。 */
export function gainHeart(p) {
  p.max++;
  p.hp++;
}

/**
 * 不在戰鬥中的一幀：每 LIFE.regen 秒回一顆心，到最大血量為止。在戰鬥中不叫它。
 * 計時從缺血的那一刻起算，所以一離開戰鬥就是一顆一顆連著回。
 */
export function regen(p, dt) {
  if (p.hp >= p.max) { p.regenT = 0; return; }
  p.regenT += dt;
  while (p.regenT >= LIFE.regen && p.hp < p.max) {
    p.regenT -= LIFE.regen;
    p.hp++;
  }
}

/** guard 倒數。 */
export function lifeStep(p, dt) {
  if (p.guard > 0) p.guard = Math.max(0, p.guard - dt);
}

/**
 * 玩家挨一下：扣 dmg 點血（不低於 0），開 guard。guard 還開著就不算。
 *
 * @returns {boolean} 這一下有沒有扣到
 */
export function harm(p, dmg) {
  if (p.guard > 0) return false;
  p.hp = Math.max(0, p.hp - dmg);
  p.guard = LIFE.guard;
  return true;
}

/**
 * 靈魂：KINDS 裡帶 `soul` 的那幾類（殭屍王、騎士）死掉的那一刻掉出一顆靈魂（畫成一顆
 * 半透明、發光的狗頭，眼睛是黑色的叉叉，見 soul.js）。
 *
 *   從牠（畫成兩倍大的）身體中間那個高度受重力往下掉，落到腳下那一層地板上
 *   `hover` 公尺停住；之後以那個高度為中心、振幅 `bob`、週期 `period` 秒上下
 *   漂浮（簡諧）。碰到玩家的身體（grabs）就被撿起來，最大血量 +1（gainHeart），沒有上限。
 *   從掉出來的那一刻起一直繞 Y 軸轉，每 `spin` 秒一圈（`yaw`，往下掉的時候也轉）。
 *   沒撿的不會一直留著：完整流程裡主角不在的那幾個房間裡的，直接算撿到（bankSouls）——
 *   離開有靈魂的房間就是撿了。
 *
 *   r  撿不撿得到用這個半徑量（一顆球）。
 */
export const SOUL = { r: 0.3, hover: 0.5, bob: 0.2, period: 2, spin: 4 };

/**
 * 地上 away 說「不在主角這裡」的那幾顆靈魂算撿到：每一顆最大血量 +1（gainHeart），從清單拿掉
 * （清單就地改，其他的留著）。回傳收了幾顆。
 * @param {(s: {x: number, y: number, z: number}) => boolean} away
 */
export function bankSouls(p, souls, away) {
  let kept = 0;
  for (const s of souls) {
    if (away(s)) gainHeart(p);
    else souls[kept++] = s;
  }
  const n = souls.length - kept;
  souls.length = kept;
  return n;
}

/**
 * 一顆剛掉出來的靈魂。`at` 是牠死掉那一刻的位置與場地（{x, y, z, field}）——
 * 呼叫端要在扣血之前記下來，扣到 0 的那一下 hurt 已經把牠搬回重生點了。
 */
export function dropSoul(at) {
  return { x: at.x, y: at.y + PHYS.height, z: at.z, vy: 0, cols: at.field.cols, base: null, t: 0, yaw: 0 };
}

/** 靈魂的一幀：一直繞 Y 軸轉；還沒落定就照重力掉，落定了就在 base 上下漂。 */
export function soulStep(s, dt) {
  s.yaw = (s.yaw + (2 * Math.PI * dt) / SOUL.spin) % (2 * Math.PI);
  if (s.base === null) {
    const base = supportInfo(s.cols, s.x, s.z, s.y).y + SOUL.hover;
    s.vy -= PHYS.gravity * dt;
    s.y += s.vy * dt;
    if (s.y > base) return;
    s.base = base;
    s.vy = 0;
  }
  s.t += dt;
  s.y = s.base + SOUL.bob * Math.sin((2 * Math.PI * s.t) / SOUL.period);
}

/** 玩家碰到這顆靈魂了嗎：球與玩家那根圓柱相交。 */
export function grabs(p, s) {
  if (Math.hypot(p.x - s.x, p.z - s.z) >= PHYS.radius + SOUL.r) return false;
  return s.y + SOUL.r > p.y && s.y - SOUL.r < p.y + PHYS.height;
}

/**
 * 會飛的那幾類（`fly`）怎麼動：
 *
 *   drag  被擊退之後，速度沿著它自己的方向每秒減掉這麼多（公尺每秒²），三個軸
 *         一起。取重力那個數，所以垂直往上的那一份飛得跟殭屍一樣高（第二段
 *         2.5 公尺、第三段 0.28 公尺）——差別是停在那裡，不掉下來。
 *   top   腳最高到哪：黑牆的蓋子底下一個身高。
 */
export const FLY = { drag: PHYS.gravity, top: ARENA.lid - PHYS.height };

/** 這隻怪物腳下的地板有多高：從 fromY 往下找，踏得上去的那一級也算（walk.js 的 supportInfo）。 */
const floorAt = (m, fromY = m.y) => supportInfo(m.field.cols, m.x, m.z, fromY).y;

/** 會飛的高度只能在地板與蓋子底下一個身高之間（FLY.top 是這一塊空地的那個數）。 */
const flyY = (m, y) => Math.min(m.field.arena.lid - PHYS.height, Math.max(floorAt(m), y));

/**
 * 走路的怪物在地上走完一步：腳跟著地板走——踏上一級就站上去，走出邊緣就掉下去
 * （跟被擊退一樣是 air，落地才回去追人）。walkTo 走完叫它。
 */
export function settle(m) {
  const f = supportInfo(nearCols(m), m.x, m.z, m.y).y;
  if (f >= m.y - 0.05) { m.y = f; return; }
  m.air = true;
  m.grounded = false;
  m.vy = 0;
}

/** 怪物身邊的碰撞體：colsNear 篩過、存在牠身上，走離篩的地方 NEAR.move 公尺才重篩。
    一步最多走一公尺左右（20 幀的衝刺 0.8），所以 NEAR.r 減掉 NEAR.move 還有兩公尺的餘裕。 */
const NEAR = { r: 3, move: 1 };
function nearCols(m) {
  const c = m.near;
  if (c && c.field === m.field && Math.abs(m.x - c.x) < NEAR.move && Math.abs(m.z - c.z) < NEAR.move) return c.cols;
  m.near = { field: m.field, x: m.x, z: m.z, cols: colsNear(m.field.cols, m.x, m.z, m.x, m.z, NEAR.r) };
  return m.near.cols;
}

/**
 * 走路的一步（追人、衝刺、被推開滑行、劍迴旋、互相讓開）：照碰撞走到 (x, z)，會走路的
 * 腳跟著地板（settle）。
 *
 * 有允許區（m.field.roam，見 roam.js）的時候，會走路的怪物站在允許區裡，每一小步就只准
 * 走到允許區裡：踏空的話看掉下去的地方（照被打飛同一支預跑 landing，只在踏空的那一步跑），
 * 沒踏空就看走到的地方。不准的那一步不走：先試只走 x、只走 z（沿著邊緣滑），都不行就站住。
 * 井圈往內、牆頭往外、台子往死角、從石塊與黑牆之間的縫擠出去（碰撞一個一個推，石塊往外推、
 * 黑牆往內夾，身體就沿著黑牆滑進石塊後面）——對怪物來說都是一道牆。
 * 被打飛、跳過去也只落在允許區裡，所以會走路的怪物永遠待在允許區裡。
 */
export function walkTo(m, x, z) {
  const fly = !!kindOf(m).fly;
  const go = (tx, tz) => {
    const cols = nearCols(m);
    const [nx, nz] = solveXZ(cols, tx, tz, m.y, m.field.doors);
    if (!fly && m.field.roam && !safeStep(m, nx, nz, cols)) return false;
    m.x = nx; m.z = nz;
    return true;
  };
  /* 一步最多 STRIDE：碰撞是把身體推回最近的那一面，一步跨過一道牆（加上身體半徑）的一半，
     最近的那一面就在另一側。20 幀的衝刺一幀 0.8 公尺，會穿過關著的鐵閘。 */
  const n = Math.max(1, Math.ceil(Math.hypot(x - m.x, z - m.z) / STRIDE));
  const sx = (x - m.x) / n, sz = (z - m.z) / n;
  for (let i = 0; i < n; i++) {
    const tx = m.x + sx, tz = m.z + sz;
    if (!(go(tx, tz) || go(tx, m.z) || go(m.x, tz))) break;
    if (!fly) settle(m);
    if (m.air) break;
  }
}

/** walkTo 一步最多走多遠。比任何碰撞體加上身體半徑之後的半寬（至少一個半徑 0.3）短。 */
const STRIDE = 0.25;

/** 走到 (x, z) 准不准：落腳的地方（踏空的話是掉下去的地方）在允許區裡。已經不在允許區裡
    （不該發生）就不攔，讓牠走得回來。 */
function safeStep(m, x, z, cols) {
  const roam = m.field.roam;
  if (!roam.has(m.x, m.y, m.z)) return true;
  const f = supportInfo(cols, x, z, m.y).y;
  if (f >= m.y - 0.05) return roam.has(x, f, z);
  const g = landing({ x, y: m.y, z, vx: m.vx, vy: 0, vz: m.vz, field: m.field });
  return !!g && roam.has(g.x, g.y, g.z, ROAM.near - SLACK);
}

/** 破防之後的窗口多長（秒）：亮圓從淡圓的大小縮到消失的時間。 */
export const BREAK_WINDOW = 0.5;

/** 每一段打中一下扣幾點血。這是招式的數值，不是怪物的，所以不在 KINDS 裡。 */
export const DAMAGE = { slash: 1, rise: 3, slam: 2, break: 5 };

/**
 * 破防攻擊的數值。
 *
 *   flight  突進花多久飛到頭頂（秒）。速度由它反推，所以不管目標多遠都是這麼久。
 *   spin    迴旋一圈多久（秒）。
 *   off     跳離：水平（突進的反方向）與垂直的速度。垂直是一次普通的跳。
 *   push    同一瞬間怪物被推開：水平速度 h（突進的方向），在地上滑行時每秒
 *           減速 decel——5 m/s 滑 0.6 秒、約 1.6 公尺。沒有垂直的份。
 */
export const BREAK_ATK = {
  flight: 0.35, spin: 0.6,
  off: { h: 5, v: PHYS.jump },
  push: { h: 5, decel: 8 },
};

/** 一隻怪物的那一類數值。 */
export const kindOf = (m) => KINDS[m.kind];

/**
 * 甩頭的僵直（衝刺的、幽靈騎士連斬的、國王旋風斬的）裡沒在甩的時間（秒）：甩之前先完全不動
 * before 秒（打完頓一下才回神），甩完回到原本的樣子之後再 after 秒沒有任何動作，僵直才結束。
 */
export const STILL = { before: 0.15, after: 0.1 };

/**
 * 怪物的衝刺（每一類都一樣）：
 *
 *   range    追到身體中心相距這麼近就停下來蓄力。
 *   windup   蓄力（發呆）多久（秒）。
 *   speed    衝出去的初速，time 秒內線性減到 0——衝 speed·time/2 = 2.0 公尺。
 *   recover  衝完之後僵直多久，才回去追人：低頭、STILL.before 秒完全不動、甩頭，再 STILL.after 秒
 *            沒有動作（monster.js）。
 *
 * 衝得到的 2.0 比 range 1.8 還長：站著不動的人一定被衝到（牠會衝過頭），
 * 蓄力的時候往旁邊閃開才躲得掉。
 */
export const LUNGE = { range: 1.8, windup: 0.25, speed: 16, time: 0.25, recover: STILL.before + 0.5 + STILL.after };

/** 攻擊的長度：1.5 個狗高。每一段都一樣，差的只有角度。 */
export const REACH = 1.5 * DOG_H;

/** 第一段扇形的半角：120° 的一半。 */
export const SLASH_HALF = Math.PI / 3;

/** 一段攻擊亮多久（秒）。判定在這段時間裡有效，每一段對同一隻怪物只算一下。 */
export const SWING = 0.2;

/**
 * 擊退的基準：水平（遠離玩家）與垂直的初速，公尺每秒。各段再乘 KNOCK_SCALE；
 * 7.0 在重力 22 底下飛 0.64 秒、最高 1.1 公尺，水平帶走 1.3 公尺。
 */
export const KNOCK = { h: 2.0, v: 7.0 };

/**
 * 每一段給基準的幾倍（h 水平、v 垂直）。
 *
 *   第一段  水平 0.7、垂直 0.5：1.4 m/s、3.5 m/s，飛 0.32 秒、只離地 0.28——
 *           挑一下，不是打飛。
 *   第二段  水平 0.5、垂直 1.5：1 m/s、10.5 m/s，飛 0.95 秒、最高 2.5 公尺——
 *           往上挑起來。
 *   第三段  水平 1.5、垂直 0.5：3 m/s、3.5 m/s，飛 0.32 秒、只離地 0.28、
 *           水平帶走 0.95 公尺——往前推出去。
 */
export const KNOCK_SCALE = {
  slash: { h: 0.7, v: 0.5 },
  rise: { h: 0.5, v: 1.5 },
  slam: { h: 1.5, v: 0.5 },
};

/**
 * 一隻站在站位上的怪物。`spawn` 是牠自己的站位（{kind, x, z, yaw}，SPAWN.monsters
 * 的一筆；可以帶 y，不帶就是 0）：牠是哪一類看它，回到站位、死了重生都回這裡。
 * `field` 是牠站在什麼樣的地方（見 FIELD）。
 */
export function makeMonster(spawn = SPAWN.monsters[0], field = FIELD) {
  const m = {
    kind: spawn.kind,
    spawn,
    field,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, aimX: 0, aimZ: 1,
    /* 被擊退、還沒落地。這段時間牠不追人，碰到玩家也不算數。 */
    air: false,
    /** 在空中還沒走完的那一點時間（不滿 AIR_DT，見 monsterStep）。 */
    airT: 0,
    /** 挨了幾下。 */
    hits: 0,
    /** 剩多少血。 */
    hp: 0,
    /** 死過幾次（死了就在重生點重生，見 hurt）。 */
    deaths: 0,
    /** 離破防還累積了多少傷害。 */
    gauge: 0,
    /** 破防窗口還剩幾秒（0 = 沒有破防）。 */
    breakT: 0,
    /** 被破防攻擊定住（迴旋中）：不動、不受重力。 */
    held: false,
    /* 被沿著地面推開、還在滑（破防攻擊的跳離）。這段時間牠不追人，滑到停為止。 */
    slide: false,
  };
  placeMonster(m);
  return m;
}

/** 怪物回到牠自己的站位。 */
export function placeMonster(m) {
  const s = m.spawn;
  m.x = s.x; m.y = s.y ?? 0; m.z = s.z;
  m.vx = m.vy = m.vz = 0;
  m.grounded = true;
  m.air = false;
  m.hp = kindOf(m).hp;
  m.gauge = 0;
  m.breakT = 0;
  m.held = false;
  m.slide = false;
  m.cast = null;                          // 放到一半的招（skills.js）
  m.castT = kindOf(m).every || 0;         // 離下一招還有幾秒
  m.stun = 0;                             // 出招後的僵直還剩幾秒（skills.js）
  m.lunge = null;                         // 衝刺：{ t, n, dirX, dirZ }，見 LUNGE
  m.shields = kindOf(m).shields || 0;     // 還剩幾面盾（國王，見 parry）
  m.shieldT = 0;                          // 上一次挨打之後過了幾秒（補盾用）
  m.aimX = Math.sin(s.yaw); m.aimZ = Math.cos(s.yaw);
}

/**
 * 這一下被盾擋掉了嗎（有盾的那一類，國王）。有盾就用掉一面，回 true：呼叫端這一下
 * 什麼都不做——不扣血、不擊退、不累積破防、衝刺不取消。不管擋沒擋，補盾的計時都
 * 從頭算（挨打就重算）。沒有盾的那幾類一律 false、什麼都不動。
 */
export function parry(m) {
  if (!kindOf(m).shields) return false;
  m.shieldT = 0;
  if (m.shields <= 0) return false;
  m.shields--;
  return true;
}

/** 補盾：沒滿的時候，距離上一次挨打每過 shieldEvery 秒補一面。滿的時候不計時。 */
function shieldStep(m, dt) {
  const K = kindOf(m);
  if (!K.shields || m.shields >= K.shields) { m.shieldT = 0; return; }
  m.shieldT += dt;
  if (m.shieldT < K.shieldEvery) return;
  m.shields++;
  m.shieldT = 0;
}

/** 這隻怪物現在是不是破防中（窗口還開著）。 */
export const broken = (m) => m.breakT > 0;

/** 破防的累積歸零（窗口用掉或錯過都是這一支）。 */
export function resetBreak(m) {
  m.gauge = 0;
  m.breakT = 0;
}

/**
 * 不能開始放招、也不算在攻擊的狀態：擊退在空中、被定住、被推開在滑。放招或衝刺
 * 在這一幀被它們打斷、還沒被各自的 step 清掉，也已經不算攻擊了。
 */
export const busy = (m) => m.air || m.held || m.slide;

/**
 * 攻擊中：從蓄力開始，到打完為止，**不含**打完之後的僵直。
 *   · 放招（skills.js 的 m.cast 還在）——預告亮著的那一整段，跳砸的飛行也算；
 *   · 衝刺的蓄力與衝（LUNGE.windup + LUNGE.time），衝完的發呆（recover）不算。
 *
 * 這是「怪物正在攻擊」的唯一定義。畫面上的紅色墨線（fight.js）與不可打斷
 * （armored）都從它來，所以兩者不可能對不上：新增一招、改一招的長短，只要
 * 讓那一招在放的時候是 m.cast（或 m.lunge）而且收招才清掉，兩邊自己就跟著走。
 */
export const attacking = (m) => !busy(m)
  && (!!m.cast || (!!m.lunge && m.lunge.t < LUNGE.windup + LUNGE.time));

/**
 * 不可打斷：不會被擊退，受到的傷害減半。就是攻擊中——只有
 *   · 放招（m.cast）一律算；
 *   · 衝刺只有 `steady` 那一類（殭屍王）算。小怪的衝刺一打就取消。
 */
export const armored = (m) => attacking(m) && (!!m.cast || !!kindOf(m).steady);

/** 這一下打在牠身上實際扣幾點：放招倒數中（armored）減半、無條件捨去。hurt 扣的就是這一份。 */
export const taken = (m, dmg) => (armored(m) ? Math.floor(dmg / 2) : dmg);

/**
 * 扣血，並累積破防。扣到 0 就死：記一次，當場回到牠自己的重生點重生——
 * placeMonster 把位置、速度、血、破防、被定住全部重設，所以死前的擊退或迴旋
 * 不會帶到重生之後。玩家不動。
 *
 * `respawn` 是 false 的話不重生：牠留在死的地方、帶著這一下的擊退，血停在 0 以下——
 * 屍體從這裡倒下去（fight.js）。
 *
 * 破防窗口開著的時候不累積——門檻已經到了，窗口用掉或錯過之後才從 0 重算。
 *
 * 放招倒數中（armored）傷害減半、無條件捨去（血是整數）：1 → 0、2 → 1、3 → 1、
 * 5 → 2。破防累積的是**實際扣掉**的那一份。
 *
 * @returns {boolean} 這一下把牠打死了
 */
export function hurt(m, dmg, respawn = true) {
  dmg = taken(m, dmg);
  if (!broken(m)) {
    m.gauge += dmg;
    if (m.gauge >= kindOf(m).breakAt) m.breakT = BREAK_WINDOW;
  }
  m.hp -= dmg;
  if (m.hp > 0) return false;
  m.deaths++;
  if (respawn) placeMonster(m);
  return true;
}

/**
 * 怪物的一幀：被擊退的時候照拋物線飛，落地之後朝玩家追過去。兩種都被
 * 黑牆擋。
 *
 * 追的時候轉向與加速用的是玩家那一支 steer，所以牠的手感跟玩家是同一種
 * 東西：轉向不欠帳，加速量照 PHYS。
 *
 * `target` 是 null 就是沒有目標（玩家倒下了，Fight.standDown）：被擊退、被推開的照常
 * 飛完、滑完，其餘站著不動，不衝也不追。
 */
export function monsterStep(m, dt, target) {
  if (m.stun > 0) m.stun = Math.max(0, m.stun - dt);
  shieldStep(m, dt);
  // 破防窗口：時間到了還沒用上就是錯過，累積歸零。
  if (broken(m)) {
    m.breakT -= dt;
    if (m.breakT <= 0) resetBreak(m);
  }
  // 被擊退、定住、推開：衝到一半的衝刺取消。
  if (m.lunge && (m.held || m.slide || m.air)) m.lunge = null;
  if (m.held) return;                     // 破防攻擊的迴旋：定在原地
  if (m.slide && !m.air) {
    // 沿著地面被推開：照 BREAK_ATK.push.decel 減速，停了才回去追人。
    const sp = Math.hypot(m.vx, m.vz);
    const ns = Math.max(0, sp - BREAK_ATK.push.decel * dt);
    const k = sp > 1e-9 ? ns / sp : 0;
    m.vx *= k; m.vz *= k;
    walkTo(m, m.x + m.vx * dt, m.z + m.vz * dt);      // 會飛的在原本的高度滑開
    if (ns <= 0) m.slide = false;
    return;
  }
  if (m.air && kindOf(m).fly) { driftStep(m, dt); return; }
  if (m.air) {
    /* 一步固定 AIR_DT，幀長再長就多走幾步，不滿一步的留到下一幀：被打飛的路線因此跟幀率
       無關，擊退那一刻預跑的落點（aimLanding）就是牠真的落下的地方。 */
    m.airT += dt;
    while (m.air && m.airT >= AIR_DT) { airStep(m, AIR_DT); m.airT -= AIR_DT; }
    if (!m.air) m.airT = 0;
    return;
  }
  // 沒有目標、放招中、出招後的僵直（skills.js）：站著不動。
  if (!target) { m.lunge = null; m.vx = 0; m.vy = 0; m.vz = 0; return; }
  if (m.cast || m.stun > 0) { m.vx = 0; m.vy = 0; m.vz = 0; return; }
  /* 一次衝好幾下的那一類（國王）：這一下衝完、還沒到 `lunges` 下，不發呆，重新蓄力
     朝玩家現在的位置再衝。衝完的那一幀（hot）照常算咬，下一幀才換成下一下。 */
  const L0 = m.lunge;
  if (L0 && L0.t >= LUNGE.windup + LUNGE.time && L0.n < (kindOf(m).lunges || 1)) { lockLunge(m, target, L0.n + 1); return; }
  /* 衝完、再發呆 recover 秒之後收掉。收掉的這一幀站著不動、不接著衝下一次：
     殭屍王的 bossStep 在 monsterStep 之前，牠要看到一幀「沒在衝」才挑得了招，
     不然貼著人的殭屍王會一次接一次地衝，永遠輪不到放招。 */
  if (m.lunge && m.lunge.t >= LUNGE.windup + LUNGE.time + LUNGE.recover) { m.lunge = null; m.vx = 0; m.vy = 0; m.vz = 0; return; }
  if (m.lunge) { lungeStep(m, dt); return; }
  /* 朝玩家的腳追。會飛的連高低一起追（三維的方向），走路的只看水平。 */
  const fly = !!kindOf(m).fly;
  const dx = target.x - m.x, dy = fly ? target.y - m.y : 0, dz = target.z - m.z;
  const d = Math.hypot(dx, dy, dz);
  const h = Math.hypot(dx, dz);
  if (h > 1e-6) { m.aimX = dx / h; m.aimZ = dz / h; }
  if (d <= LUNGE.range) {
    // 追到了：停下來發呆，方向在這一刻鎖定。
    lockLunge(m, target, 1);
    return;
  }
  if (fly) {
    [m.vx, m.vy, m.vz] = steer3(m.vx, m.vy, m.vz, dx / d, dy / d, dz / d, kindOf(m).speed, dt);
    m.y = flyY(m, m.y + m.vy * dt);
  } else {
    [m.vx, m.vz] = steer(m.vx, m.vz, m.aimX, m.aimZ, kindOf(m).speed, dt);
  }
  walkTo(m, m.x + m.vx * dt, m.z + m.vz * dt);
}

/** 在空中一步多長（見 monsterStep）。預跑落點用的是同一個，所以兩邊一步一步完全一樣。 */
const AIR_DT = 1 / 60;

/**
 * 被擊退（不會飛的）在空中的一步：照拋物線飛，落地就停。`cols` 平常是 m.field.cols；
 * 預跑落點的時候給篩過的那一份（walk.js 的 colsNear），規則是同一支。
 */
function airStep(m, dt, cols = m.field.cols) {
  /* 先水平、後垂直，跟玩家（hero.js 的 moveHero）同一個順序：水平的碰撞用的是這一幀
     開始時的腳高。倒過來的話，落地那一幀腳已經陷到地板底下（一幀掉 vy·dt，20 幀的時候
     超過半公尺），碰撞拿那個高度去問：井口以下的身體會被方圓 r + 3 公尺內的井壁吸進井裡，
     陷得比一階還深的時候整片地板的碰撞板變成一道牆，把身體橫推到板子邊上——牆外。 */
  const prevY = m.y;
  [m.x, m.z] = solveXZ(cols, m.x + m.vx * dt, m.z + m.vz * dt, prevY, m.field.doors);
  m.vy -= PHYS.gravity * dt;
  m.y += m.vy * dt;
  const f = supportInfo(cols, m.x, m.z, prevY).y;
  if (m.y <= f && m.vy <= 0) {
    /* 落地：水平的擊退一起停掉，從靜止重新起步追人。不停的話牠落地
       之後還會往後滑一段，而那段時間碰到牠算不算數說不清楚。 */
    m.y = f; m.vy = 0; m.vx = 0; m.vz = 0;
    m.air = false;
    m.grounded = true;
  }
}

/**
 * 開始一下衝刺（第 n 下）：站住蓄力，方向在這一刻朝玩家的腳鎖定——會飛的連高低一起
 * （三維的方向），走路的只看水平。正好疊在玩家身上的時候朝自己的面向。
 */
function lockLunge(m, target, n) {
  const fly = !!kindOf(m).fly;
  const dx = target.x - m.x, dy = fly ? target.y - m.y : 0, dz = target.z - m.z;
  const d = Math.hypot(dx, dy, dz);
  m.lunge = d > 1e-6 ? { t: 0, n, dirX: dx / d, dirY: dy / d, dirZ: dz / d } : { t: 0, n, dirX: m.aimX, dirY: 0, dirZ: m.aimZ };
  m.vx = 0; m.vy = 0; m.vz = 0;
}

/**
 * walk.js 的 steer 搬到三維：沿著想去的方向那一份照 PHYS.accel 追上 want，
 * 其他方向的份直接丟掉（轉向不欠帳，跟 steer 一樣）。
 */
function steer3(vx, vy, vz, dirX, dirY, dirZ, want, dt) {
  const cur = vx * dirX + vy * dirY + vz * dirZ;
  const rate = PHYS.accel * dt;
  const next = cur + Math.max(-rate, Math.min(rate, want - cur));
  return [dirX * next, dirY * next, dirZ * next];
}

/**
 * 會飛的被擊退：照速度飛，速度沿著自己的方向每秒減 FLY.drag，減到 0 就停在
 * 那裡、回去追人。撞到地板或蓋子，那個方向的份歸零。
 */
function driftStep(m, dt) {
  const sp = Math.hypot(m.vx, m.vy, m.vz);
  const ns = Math.max(0, sp - FLY.drag * dt);
  const k = sp > 1e-9 ? ns / sp : 0;
  m.vx *= k; m.vy *= k; m.vz *= k;
  const y = m.y + m.vy * dt;
  m.y = flyY(m, y);
  if (m.y !== y) m.vy = 0;
  [m.x, m.z] = solveXZ(m.field.cols, m.x + m.vx * dt, m.z + m.vz * dt, m.y, m.field.doors);
  if (ns <= 0) { m.vx = m.vy = m.vz = 0; m.air = false; }
}

/** 衝出去之後 s 秒（0 ≤ s ≤ LUNGE.time）走了多遠：速度從 speed 線性減到 0 的積分。 */
const lungeDist = (s) => LUNGE.speed * (s - (s * s) / (2 * LUNGE.time));

/**
 * 衝刺的一幀：蓄力與衝完之後都站著；衝的時候沿鎖定的方向走（會飛的是三維的
 * 方向，`dirY`），走多遠是那一段
 * 時間的積分——跟幀長無關，一次衝刺永遠是 2.0 公尺。
 *
 * `hot`：這一幀有衝（走了一段）。碰撞看的是它，而不是「t 落在哪一段」——衝完
 * 的那一幀 t 已經跨進衝完之後的發呆了，但牠這一幀剛好走到最遠處。
 */
function lungeStep(m, dt) {
  const L = m.lunge;
  const s0 = Math.min(LUNGE.time, Math.max(0, L.t - LUNGE.windup));
  L.t += dt;
  const s1 = Math.min(LUNGE.time, Math.max(0, L.t - LUNGE.windup));
  const dy = L.dirY || 0;
  const h = Math.hypot(L.dirX, L.dirZ);
  if (h > 1e-6) { m.aimX = L.dirX / h; m.aimZ = L.dirZ / h; }   // 正上下方衝的時候面向不變
  const step = lungeDist(s1) - lungeDist(s0);
  const v = s1 > 0 ? LUNGE.speed * (1 - s1 / LUNGE.time) : 0;
  m.vx = L.dirX * v; m.vy = dy * v; m.vz = L.dirZ * v;
  L.hot = step > 0;
  if (step > 0) {
    if (dy) m.y = flyY(m, m.y + dy * step);
    walkTo(m, m.x + L.dirX * step, m.z + L.dirZ * step);
  }
}

/** 這一幀正在衝。只有這段時間碰到玩家才算——蓄力與衝完之後的發呆都不算。 */
export const lunging = (m) => !!m.lunge && !!m.lunge.hot;

/**
 * 兩個身體碰在一起了嗎：水平上兩個圓柱相交，垂直上兩段身高重疊。
 * 身體是 walk.js 的那一個（半徑 PHYS.radius、高 PHYS.height）。
 */
export function touching(a, b) {
  if (Math.hypot(a.x - b.x, a.z - b.z) >= PHYS.radius * 2) return false;
  return a.y < b.y + PHYS.height && b.y < a.y + PHYS.height;
}

/**
 * 怪物彼此不重疊：兩隻的身體碰在一起（touching），就沿著兩者的連線各退一半，
 * 退到剛好相切。三隻追同一個人，不擋的話會從三個方向收進同一個點、疊成一隻。
 *
 * 被破防攻擊定住的那一隻不動，另一隻退全部。退是走路的一步（walkTo）：會被牆擋、不會被
 * 擠進柱子裡或擠出牆外，也不會被擠下允許區的邊緣。在空中的、正在放招的不推：空中那一段
 * 是擊退那一刻就預跑好落點的路線（推一下就不是那一條了），放招的路線是招式自己給的——
 * 落地、收招之後下一幀再讓開。
 */
export function separate(monsters) {
  const R2 = PHYS.radius * 2;
  /* 幾輪：一對推開可能把另一對推回去重疊（三隻圍著同一個人的時候就是這樣），
     多跑幾輪讓它收斂。 */
  for (let pass = 0; pass < 4; pass++)
  for (let i = 0; i < monsters.length; i++) {
    for (let j = i + 1; j < monsters.length; j++) {
      const a = monsters[i], b = monsters[j];
      if (!touching(a, b) || (a.held && b.held)) continue;
      const rx = b.x - a.x, rz = b.z - a.z;
      const d = Math.hypot(rx, rz);
      // 正好疊在同一點：沒有連線可言，往 +x 推開。
      const [dx, dz] = d > 1e-6 ? [rx / d, rz / d] : [1, 0];
      const gap = R2 - d;
      const wa = a.held ? 0 : b.held ? 1 : 0.5;
      const wb = 1 - wa;
      shove(a, -dx * gap * wa, -dz * gap * wa);
      shove(b, dx * gap * wb, dz * gap * wb);
    }
  }
}

/** separate 的一推。 */
function shove(m, dx, dz) {
  if ((!dx && !dz) || m.air || m.cast) return;
  walkTo(m, m.x + dx, m.z + dz);
}

/**
 * 怪物這一幀打到玩家了嗎：正在衝刺（lunging）、身體碰到了。其他時候碰到都
 * 沒事——不衝的怪物只是一個會擋路的東西。
 */
export const bites = (p, m) => !m.air && lunging(m) && touching(p, m);

/**
 * 擊退一隻怪物：水平往遠離 (fromX, fromZ) 的方向、垂直往上。速度是
 * 換掉而不是加上去——理由見檔頭。
 *
 * 正好疊在出手點上（沒有「遠離」可言）的時候，往 (awayX, awayZ) 推，
 * 呼叫端給的是玩家面向的方向。`scale` 是這一段的倍率（KNOCK_SCALE），不給就是基準的 1 倍。
 *
 * 放招倒數中（armored）不會被擊退：這一下照樣算打中，速度一點都不動。
 */
export function knock(m, fromX, fromZ, awayX, awayZ, scale = { h: 1, v: 1 }) {
  m.hits++;
  if (armored(m)) return;
  m.lunge = null;                         // 衝刺被打（小怪的蓄力、任何一類的衝與衝完）：這一下取消
  let dx = m.x - fromX, dz = m.z - fromZ;
  const d = Math.hypot(dx, dz);
  if (d > 1e-6) { dx /= d; dz /= d; } else { dx = awayX; dz = awayZ; }
  m.vx = dx * KNOCK.h * scale.h;
  m.vz = dz * KNOCK.h * scale.h;
  m.vy = KNOCK.v * scale.v;
  m.slide = false;
  m.air = true;
  m.airT = 0;
  m.grounded = false;
  if (m.field.roam && !kindOf(m).fly) aimLanding(m);
}

/** 預跑落點最多看幾秒（從井口掉到井底也在這以內）。 */
const FORESEE = 2;
/** 檢查預跑的落點時放寬多少：飛到一半被別隻推開（separate）會差一點點。 */
const SLACK = 0.1;
/** 改過的水平速度最多這麼快：再快就不像被打飛，是被扔出去。 */
const AIM_MAX = 6;

/**
 * 被打飛的這一下會落在哪：照 airStep 一步一步（AIR_DT）飛到落地。碰撞只看路線附近（colsNear）：
 * 落回起跳那一層要飛多久、再多 0.3 秒（落到低一層），水平走得到的範圍再放寬一公尺。
 * 一次中位數 0.03 毫秒。飛出那個範圍（篩掉的碰撞體可能擋得到）、掉得比允許區最低的那一格
 * 還低半公尺（往井底掉，不必看到底）、FORESEE 秒還沒落地，都回 null——看不準就當作落不進
 * 允許區。
 */
function landing(m) {
  const g = { x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, air: true, grounded: false, field: m.field };
  const span = Math.hypot(m.vx, m.vz) * ((2 * Math.max(0, m.vy)) / PHYS.gravity + 0.3);
  const cols = colsNear(m.field.cols, m.x, m.z, m.x, m.z, span + 1);
  for (let t = 0; t < FORESEE && g.air; t += AIR_DT) {
    airStep(g, AIR_DT, cols);
    if (Math.abs(g.x - m.x) > span + 0.5 || Math.abs(g.z - m.z) > span + 0.5 || g.y < m.field.roam.low - 0.5) return null;
  }
  return g.air ? null : g;
}

/**
 * 被打飛之前先看落點：不在允許區（m.field.roam）裡——井裡、柱子後面的死角、牆外——就
 * 改水平速度，讓牠落在最近的一格上（垂直的初速不動，所以弧線一樣高）。改了還是落不進去
 * （路上有東西擋），或者要扔得比 AIM_MAX 還快，就只留垂直：原地彈起來，落回起跳的地方。
 */
function aimLanding(m) {
  const roam = m.field.roam;
  const inside = (g) => !!g && roam.has(g.x, g.y, g.z, ROAM.near - SLACK);
  const at = landing(m);
  if (inside(at)) return;
  const g = PHYS.gravity;
  const apex = m.y + (m.vy * m.vy) / (2 * g);
  const from = at || { x: m.x + m.vx * (2 * m.vy / g), y: m.y, z: m.z + m.vz * (2 * m.vy / g) };
  const c = roam.nearest(from.x, from.y, from.z, (q) => q.y < apex - 0.05);
  if (c) {
    const T = (m.vy + Math.sqrt(m.vy * m.vy + 2 * g * (m.y - c.y))) / g;
    const vx = (c.x - m.x) / T, vz = (c.z - m.z) / T;
    if (Math.hypot(vx, vz) <= AIM_MAX) {
      const vx0 = m.vx, vz0 = m.vz;
      m.vx = vx; m.vz = vz;
      if (inside(landing(m))) return;
      m.vx = vx0; m.vz = vz0;
    }
  }
  m.vx = 0; m.vz = 0;
}

/**
 * 主角挨了一下（harm 有扣到）的擊退：怪物被打的基準（KNOCK，KNOCK_SCALE 之前）的一半
 * 動能。動能跟速度的平方成正比，所以水平與垂直的初速都乘 √½：1.41 m/s、4.95 m/s，
 * 飛 0.45 秒、最高 0.56 公尺、水平帶走 0.64 公尺。(dirX, dirZ) 是那一下打過來的方向
 * （水平的單位向量）。飛在空中的這一段不能操控、不能跳（`knocked`，模式與 Fight.lead
 * 看它），落地就結束（knockLand）。
 */
export const HERO_KNOCK = Math.SQRT1_2;

export function knockHero(p, dirX, dirZ) {
  p.vx = dirX * KNOCK.h * HERO_KNOCK;
  p.vz = dirZ * KNOCK.h * HERO_KNOCK;
  p.vy = KNOCK.v * HERO_KNOCK;
  p.grounded = false;
  p.knocked = true;
}

/** 被擊退的主角落地了：這一段結束，水平一起停掉（跟怪物落地一樣）。移動之後、判打中之前叫。 */
export function knockLand(p) {
  if (!p.knocked || !p.grounded) return;
  p.knocked = false;
  p.vx = 0;
  p.vz = 0;
}

/* ── 攻擊範圍 ────────────────────────────────────────────────────
   怪物是一根圓柱（半徑 PHYS.radius、高 PHYS.height），所以「打得到」是
   「範圍與那根圓柱相交」，不是「範圍包住牠的中心」——後者會讓擦到身體
   邊緣的一下落空，而畫面上那一下明明掃過了牠。 */

/** 身高中間那個高度的平面，切不切得到這隻怪物的身體。 */
const atWaist = (p, m) => {
  const y = p.y + PHYS.height / 2;
  return y >= m.y && y <= m.y + PHYS.height;
};

/**
 * 第二段那片直立扇形：半徑 REACH，從下緣往上掃 sweep。沒有厚度——判定就是
 * 那一片平面。下緣在哪由 fanFrame 算。
 */
export const FAN = { r: REACH, sweep: Math.PI / 2 };

/**
 * 第一段扇形正中那條半徑的末端：面向的方向上 REACH 遠、身高中間那麼高。
 * 第一段出手的那一刻記下來（世界座標），第二段的扇形就指著它。
 */
export function slashTip(p) {
  return { x: p.x + p.aimX * REACH, y: p.y + PHYS.height / 2, z: p.z + p.aimZ * REACH };
}

/**
 * 第二段的扇形這一幀擺在哪裡。
 *
 * 下緣是「玩家現在的腳下 → tip（上一次第一段的末端點）」那一條線，所以
 * 扇形立在包含這條線的那個鉛直面上：水平方向 (dirX, dirZ) 是腳下指向 tip，
 * a0 是那條線的仰角，往上 sweep 到 a1。玩家跳起來、腳高過那一點之後 a0
 * 是負的——下緣往前下方指著那一點。
 *
 * 長度不是那條線的長度，一律是 REACH。
 *
 * tip 正好在腳的正上下方（水平上沒有方向可言）的時候，用玩家的面向。
 *
 * @returns {{dirX:number, dirZ:number, a0:number, a1:number}}
 */
export function fanFrame(p, tip) {
  const hx = tip.x - p.x, hz = tip.z - p.z;
  const hd = Math.hypot(hx, hz);
  const [dirX, dirZ] = hd > 1e-6 ? [hx / hd, hz / hd] : [p.aimX, p.aimZ];
  const a0 = Math.atan2(tip.y - p.y, Math.max(hd, 1e-6));
  return { dirX, dirZ, a0, a1: a0 + FAN.sweep };
}

/**
 * 第一段：面向的 120° 水平扇形，高度在玩家身高的中間，長 REACH。
 *
 * @param {object} p 玩家（x, y, z, aimX, aimZ）
 * @param {object} m 怪物
 */
export function inSlash(p, m) {
  if (!atWaist(p, m)) return false;
  const r = PHYS.radius;
  const dx = m.x - p.x, dz = m.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > REACH + r) return false;
  if (d <= r) return true;                         // 疊在一起：哪個方向都掃得到
  const cos = (dx * p.aimX + dz * p.aimZ) / d;
  const off = Math.acos(Math.max(-1, Math.min(1, cos)));
  /* 半角 60°，再加上圓柱在那個距離上張開的角度——扇形的邊擦到身體就算。 */
  return off <= SLASH_HALF + Math.asin(Math.min(1, r / d));
}

/** 鉛直面上的一點（前 f、上 u，從腳下量）在不在 [a0, a1] 那片扇形裡。 */
function inFanAt(f, u, a0, a1) {
  const rho = Math.hypot(f, u);
  if (rho > FAN.r) return false;
  if (rho < 1e-9) return true;
  const th = Math.atan2(u, f);
  return th >= a0 && th <= a1;
}

/**
 * 第二段：圓心在腳下、立在指向 tip 的那個鉛直面上的 90° 扇形（見 fanFrame）。
 *
 * 扇形是一片沒有厚度的平面，打不打得到是「這片平面切不切得到怪物的身體」：
 * 怪物的中心要在那個面左右一個身體半徑（0.3 公尺）以內，再偏就整隻在面的
 * 一側、掃不到。
 *
 * 怪物那根圓柱被這個鉛直面切出一個長方形（寬 2√(r² − s²)，s 是牠偏離
 * 那個面多遠；高一個身高）。長方形與扇形重疊就算中：長方形上取一片格點
 * 看有沒有落在扇形裡，再沿扇形的兩條直邊看有沒有穿過長方形——後者是給
 * 「扇形的邊從格點之間切過去」那種擦邊用的。
 *
 * `thick`：扇形往面的左右各有這麼厚（公尺，預設 0 就是上面那一片平面）。騎士的上挑
 * （skills.js）用它——身體碰到那一塊厚片就算，切出來的長方形取最靠近面的那一刀。
 */
export function inFan(p, m, tip, thick = 0) {
  const { dirX, dirZ, a0, a1 } = fanFrame(p, tip);
  const r = PHYS.radius;
  const dx = m.x - p.x, dz = m.z - p.z;
  const s = dz * dirX - dx * dirZ;                   // 偏離鉛直面多遠
  if (Math.abs(s) >= r + thick) return false;
  const f = dx * dirX + dz * dirZ;                   // 在面上往前多遠
  const e = Math.max(0, Math.abs(s) - thick);        // 離厚片多遠
  const w = Math.sqrt(r * r - e * e);
  const f0 = f - w, f1 = f + w;
  const u0 = m.y - p.y, u1 = u0 + PHYS.height;
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 6; j++) {
      if (inFanAt(f0 + ((f1 - f0) * i) / 4, u0 + ((u1 - u0) * j) / 6, a0, a1)) return true;
    }
  }
  for (const a of [a0, a1]) {
    for (let k = 0; k <= 32; k++) {
      const q = (FAN.r * k) / 32;
      const qf = Math.cos(a) * q, qu = Math.sin(a) * q;
      if (qf >= f0 && qf <= f1 && qu >= u0 && qu <= u1) return true;
    }
  }
  return false;
}

/** 第三段：落地那一下，以玩家為中心的 360°，高度在身高中間，長 REACH。 */
export function inRing(p, m) {
  return atWaist(p, m) && Math.hypot(m.x - p.x, m.z - p.z) <= REACH + PHYS.radius;
}

/* ── 連段 ────────────────────────────────────────────────────────
   一個小狀態機，只管「現在在哪一段、這一段開始多久了」。打不打得到由
   上面那幾支範圍判斷，擊退由 knock——這裡不碰任何身體。

     idle   沒有招。站在地上、怪物進了第一段的範圍 → 出第一段。
            按跳就是普通的跳。
     slash  第一段，亮 SWING 秒。
     rest   第一段收招之後的那段時間。在 WINDOW 裡按跳 → 第二段。
            太早按是普通的跳，連段就斷了（回 idle）。時間到了沒按也回
            idle，第一段才能再自動出手——rest 同時是第一段的冷卻，不然
            怪物被挑起來的那一瞬間還在扇形裡，第一段會一幀接一幀地連發。
     rise   第二段：起跳的同時出手，亮 SWING 秒。這段時間按跳不算。
     air    第二段收招之後、落地之前。按跳 → 第三段。落地了就回 idle。
     leap   第三段的二段跳。無敵，一直到落地。
     slam   第三段落地那一下，亮 SWING 秒，之後回 idle。

   破防攻擊蓋過上面每一個階段：有怪物破防中、按了跳，不管玩家在地上還是
   空中、現在在哪一段，都直接進突進。

     dash   突進。碰到目標 → spin（由 latch 切）；沒碰到就落地 → idle（揮空）。
     spin   迴旋。轉完 → vault（由 spinStep 切）。
     vault  跳離，落地 → idle。
   ------------------------------------------------------------------ */

/** 第一段收招之後，第二段的按鍵視窗（秒，從收招那一刻量）。 */
export const WINDOW = [0.25, 0.75];

/** 第一段收招之後多久才能再出第一段（秒）——就是視窗關上的那一刻。 */
export const REST = WINDOW[1];

/**
 * `hit`：這一段已經打中過的怪物（每一段對同一隻怪物只算一下，不同隻各算各的）。
 * `tip`：上一次第一段的末端點（slashTip），第二段指著它。出第一段的時候
 * 由呼叫端記下——狀態機不碰身體。
 */
export function makeCombo() {
  return { phase: 'idle', t: 0, hit: new Set(), tip: null };
}

/** 破防攻擊的三個階段。 */
const BREAKING = new Set(['dash', 'spin', 'vault']);

/** 玩家現在在破防攻擊裡（突進、迴旋、跳離）：速度與位置由這一招接管。 */
export const breaking = (c) => BREAKING.has(c.phase);

/** 現在是不是無敵：第三段起跳之後、落地之前；破防攻擊從突進到跳離落地。 */
export const invulnerable = (c) => c.phase === 'leap' || breaking(c);

/**
 * 玩家現在打不中：無敵的招式（invulnerable），或剛挨過一下、guard 還開著。
 * 「碰到算不算」（fight.js）與畫面上的金色墨線都從這一個來，所以不會對不上。
 */
export const untouchable = (c, p) => invulnerable(c) || p.guard > 0;

/** 現在按跳會不會接下一段（給畫面提示用）。 */
export const cueing = (c) => (c.phase === 'rest' && c.t >= WINDOW[0] && c.t <= WINDOW[1]) || c.phase === 'air';

/**
 * 連段的一幀。
 *
 * @param {object} c    makeCombo() 的狀態
 * @param {number} dt
 * @param {object} io
 *   pressed   這一幀按了跳
 *   grounded  玩家站在地上
 *   near      有怪物在第一段的範圍裡（inSlash）
 *   breakable 有怪物破防中（breakTarget 找得到）
 * @returns {{jump: boolean, start: number, brk: boolean}}
 *   jump   玩家這一幀要起跳：垂直速度換成一次新的起跳（普通的跳、第二段、
 *          第三段的二段跳都是這一個）
 *   start  這一幀開始的是第幾段（0 = 沒有）。第三段的 start 在起跳那一幀，
 *          落地那一下是 phase 進了 'slam'。
 *   brk    這一幀發動破防攻擊（phase 進了 'dash'）。速度與目標由呼叫端接著
 *          叫 startBreak 給。
 */
export function comboStep(c, dt, { pressed, grounded, near, breakable = false }) {
  const out = { jump: false, start: 0, brk: false };
  c.t += dt;
  const go = (phase) => { c.phase = phase; c.t = 0; c.hit = new Set(); };
  let used = false;                       // 這一下按跳已經被連段吃掉了
  if (pressed && breakable && !breaking(c)) {
    go('dash'); out.brk = true;
    return out;
  }
  switch (c.phase) {
    case 'slash':
      if (c.t >= SWING) go('rest');
      break;
    case 'rest':
      if (pressed && grounded && c.t >= WINDOW[0] && c.t <= WINDOW[1]) {
        go('rise'); out.start = 2; out.jump = true; used = true;
      } else if (pressed) go('idle');     // 太早：普通的跳，連段斷了
      else if (c.t >= REST) go('idle');
      break;
    case 'rise':
      if (c.t >= SWING) go(grounded ? 'idle' : 'air');
      used = pressed;
      break;
    case 'air':
      if (grounded) go('idle');
      else if (pressed) { go('leap'); out.start = 3; out.jump = true; used = true; }
      break;
    case 'leap':
      if (grounded) go('slam');
      break;
    case 'slam':
      if (c.t >= SWING) go('idle');
      break;
    case 'dash':
    case 'vault':
      // 起跳那一幀還算站在地上，所以過了一點時間才認落地。
      if (grounded && c.t > 0.05) go('idle');
      used = pressed;
      break;
    case 'spin':
      used = pressed;
      break;
    default:
      break;
  }
  if (c.phase === 'idle' && grounded && near && !pressed) { go('slash'); out.start = 1; }
  if (pressed && grounded && !used) out.jump = true;
  return out;
}

/* ── 破防攻擊 ────────────────────────────────────────────────────── */

/** 身體的中間，選目標量距離用。 */
const waist = (b) => [b.x, b.y + PHYS.height / 2, b.z];

/**
 * 破防攻擊要打哪一隻：破防中的怪物裡最近的那一隻（量身體中間到身體中間）。
 * 沒有就是 null。
 */
export function breakTarget(p, monsters) {
  const [px, py, pz] = waist(p);
  let best = null, bd = Infinity;
  for (const m of monsters) {
    if (!broken(m)) continue;
    const [mx, my, mz] = waist(m);
    const d = Math.hypot(mx - px, my - py, mz - pz);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

/**
 * 怪物 T 秒後的腳在哪（x, y, z），照牠現在的速度往前推。
 *   · 會飛、被擊退：沿著速度走，照 FLY.drag 減速到停。
 *   · 會飛、其他時候：直線。
 *   · 走路、被擊退在空中：水平直線、垂直照重力，落地就停在地上。
 *   · 走路、其他時候：水平直線，腳在原本的高度。
 */
function ahead(m, T) {
  if (kindOf(m).fly) {
    let k = T;
    if (m.air) {
      const sp = Math.hypot(m.vx, m.vy, m.vz);
      k = sp > 1e-9 ? Math.min(sp * T - 0.5 * FLY.drag * T * T, (sp * sp) / (2 * FLY.drag)) / sp : 0;
    }
    return [m.x + m.vx * k, flyY(m, m.y + m.vy * k), m.z + m.vz * k];
  }
  const y = m.air ? Math.max(floorAt(m), m.y + m.vy * T - 0.5 * PHYS.gravity * T * T) : m.y;
  return [m.x + m.vx * T, y, m.z + m.vz * T];
}

/**
 * 發動破防攻擊：用掉目標的窗口（累積歸零），給玩家一次飛向牠頭頂的速度。
 * 在空中發動也是同一條式子——垂直速度是從玩家現在的高度反推的，原本往上或
 * 往下的速度直接換掉。
 *
 * 速度是照拋物線反推的：BREAK_ATK.flight 秒後腳正好落在頭頂上。頭頂取的是
 * 牠**那時候**會在的地方——照牠現在的速度往前推（見 ahead）。追過來的怪物是
 * 迎著玩家跑的，照現在的位置瞄會飛過頭。
 */
export function startBreak(c, p, m) {
  resetBreak(m);
  const T = BREAK_ATK.flight, g = PHYS.gravity;
  const [tx, my, tz] = ahead(m, T);
  const ty = my + PHYS.height;
  const hx = tx - p.x, hz = tz - p.z, hd = Math.hypot(hx, hz);
  c.target = m;
  [c.dashX, c.dashZ] = hd > 1e-6 ? [hx / hd, hz / hd] : [p.aimX, p.aimZ];
  p.vx = hx / T;
  p.vz = hz / T;
  p.vy = (ty - p.y + 0.5 * g * T * T) / T;
  p.grounded = false;
  p.aimX = c.dashX; p.aimZ = c.dashZ;
}

/**
 * 突進碰到目標了嗎：水平上兩個身體相交，垂直上玩家的腳最高可以在牠頭頂上方
 * 0.3 公尺（瞄的就是頭頂，差一點點不該算沒碰到）。
 */
export function breakContact(p, m) {
  if (Math.hypot(p.x - m.x, p.z - m.z) >= PHYS.radius * 2) return false;
  return p.y <= m.y + PHYS.height + 0.3 && p.y + PHYS.height > m.y;
}

/**
 * 突進碰到目標：有盾（國王，parry）的話這一下被擋掉——不定住、不扣血，玩家直接跳離
 * （vault）；沒盾就 latch。回傳這一下有沒有被擋掉。
 */
export function contact(c, p, m) {
  if (!parry(m)) { latch(c, p, m); return false; }
  vault(c, p);
  return true;
}

/** 跳離：玩家往突進的反方向、往上跳，連段進 vault（落地回 idle）。 */
function vault(c, p) {
  c.phase = 'vault';
  c.t = 0;
  p.vx = -c.dashX * BREAK_ATK.off.h;
  p.vz = -c.dashZ * BREAK_ATK.off.h;
  p.vy = BREAK_ATK.off.v;
  p.grounded = false;
}

/** 碰到了：記下相對位置，把怪物定住，進迴旋。 */
export function latch(c, p, m) {
  c.phase = 'spin';
  c.t = 0;
  c.off = [p.x - m.x, p.y - m.y, p.z - m.z];
  c.yaw0 = Math.atan2(m.aimX, m.aimZ);
  m.held = true;
  m.vx = m.vy = m.vz = 0;
  p.vx = p.vy = p.vz = 0;
  p.grounded = false;
}

/**
 * 迴旋的一幀：怪物原地轉、玩家保持相對位置繞著牠轉，角度是 2π × 進度。
 * 轉完就扣血、放開怪物、讓玩家往突進的反方向跳離。
 *
 * 繞 y 軸轉 a：(x, z) → (x cos a + z sin a, −x sin a + z cos a)，跟 three 的
 * rotation.y 同一個方向，所以怪物的朝向加 a 與玩家繞的方向是一致的。
 * `respawn` 交給 hurt：false 的話打死了不重生，帶著推開的速度留在原地。
 *
 * @returns {{done: boolean, died: boolean, took: number}} done 這一幀轉完了；died 那一下把牠打死了；
 *   took 那一下實際扣了幾點（taken）
 */
export function spinStep(c, p, m, respawn = true) {
  const k = Math.min(1, c.t / BREAK_ATK.spin);
  const a = Math.PI * 2 * k;
  const [ox, oy, oz] = c.off;
  const rx = ox * Math.cos(a) + oz * Math.sin(a);
  const rz = -ox * Math.sin(a) + oz * Math.cos(a);
  p.x = m.x + rx; p.y = m.y + oy; p.z = m.z + rz;
  const rl = Math.hypot(rx, rz);
  if (rl > 0.05) { p.aimX = -rx / rl; p.aimZ = -rz / rl; }   // 一直面向牠
  m.aimX = Math.sin(c.yaw0 + a); m.aimZ = Math.cos(c.yaw0 + a);
  if (k < 1) return { done: false, died: false, took: 0 };
  /* 推開怪物在扣血之前：打死的話重生會把這一份清掉，不會帶到重生點去。 */
  m.held = false;
  m.vx = c.dashX * BREAK_ATK.push.h;
  m.vz = c.dashZ * BREAK_ATK.push.h;
  m.vy = 0;
  if (m.y > floorAt(m) + 1e-3 && !kindOf(m).fly) { m.air = true; m.grounded = false; }   // 在空中被定住的：放開就帶著水平速度落下
  else m.slide = true;                                       // 會飛的不落下：在原本的高度滑開
  const took = taken(m, DAMAGE.break);
  const died = hurt(m, DAMAGE.break, respawn);
  vault(c, p);
  return { done: true, died, took };
}
