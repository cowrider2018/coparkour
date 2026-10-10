/* ── test/src/mode-flow.js ───────────────────────────────────────────
   /test/?mode=flow：完整流程模式的組裝與操作。

   地形模式的遺跡（stage.js、hero.js）加上戰鬥模式的戰鬥（fight.js），照
   route.js 的路線一場一場打。每一場的怪物照劇本（STORY.md）——這個模式現在只確認流程
   （開打、關門、打完開門、倒下、重玩），不設計關卡。

   ── 一場的一生 ──────────────────────────────────────────────────
     一開始（含 R）      兵營開場那一頁漫畫（comic.js 的 SCRIPT.start）。
     走進第 k 場的範圍   所有的門關上、所有的傳送不通。這一場有開場頁、這一輪還沒翻過的話，
                         書頁直接進來（不放慢動作）；書頁走了一秒後怪物出現（墓室的七隻是從石棺與大墓裡
                         升上來，升完才上場，route.js 的 rise）。
     打死一隻            不當場消失：跟主角倒下一樣往擊退的方向倒（fight.js 的 _fell）。綠色的
                         躺平落地之後 2 秒沉進地裡 3/4、一直留著；幽靈不落地，0.5 秒炸成一團
                         幽靈血；國王躺著。清完的那一場的屍體一直留著，倒下重打的那一次的收掉。
     打死全部            這一場清完：只開通往下一場的門（route.js 的 OPEN）。斬殺的那一刻起
                         演一段劇情（story.js）：慢動作，一大張書頁跑進來蓋住畫面，上面是
                         戰後那一頁漫畫；點一下（或按跳）翻頁、最後一頁書頁跑走，接著玩。
                         沒有戰後頁的那一場（王座廳）只有慢動作，慢完回到正常速度。
     挨打                扣血（頭頂的愛心，fight.js）。BOSS、騎士的屍體落地時（幽靈騎士是炸開時）掉出的靈魂撿起來
                         最大血量 +1，一路帶到後面的場。沒撿的不必回去找：離開有靈魂的房間（route.js 的
                         roomOf；走過去、被送過去——墓室打完翻漫畫的時候——、倒下回到休息點都算）就算撿到，
                         還沒從屍體掉出來的也算（Fight.bank）。
     獻靈魂              國王躺下之後，在牠身邊長按跳：0.5 秒後頭頂最上面那一顆心閃 0.5 秒、
                         不見（最大血量 −1），一顆靈魂拋到國王身上；一直按著就一顆接一顆。放手
                         就停，再按重新等 0.5 秒。一輪掉得出幾顆就要交幾顆（route.js 的 SOULS），
                         交出去的只有撿來的那幾顆（最大血量最少剩一開始的 3 顆）；還沒交滿就交
                         不出去的話提示需要更多，自己回去撿（offer.js）。在國王身邊按跳不跳。
                         王座廳打完不翻戰後頁，只有慢動作。交滿之後不慢：最後一顆靈魂落到國王身上的那一刻，
                         國王復甦（fight.js 的 REVIVE）——屍體炸成一團幽靈血，血慢下來再加速聚攏，
                         活著的國王（原本的灰毛）從 0 長到原本大小；演完才慢動作，翻國王復活那一頁
                         （第 14 頁）。
     國王復活之後        第 14 頁蓋住畫面的時候，每一張圖撒出王國的人民（folk.js：每一張 1～3 叢、
                         每一叢 2～4 隻，第 14 頁那幾隻）。書頁走了，國王走回王座坐下（king.js 的
                         enthrone；人民不撒在牠要走的路上）。人民與國王的頭都跟著主角轉（gaze.js）。
                         門在王座廳打完的那一刻就全開了，之後一直開著（route.js 的 doorsFor）。
     不在戰鬥中          清完一場之後、還沒走進下一場之前：很快回血到最大血量
                         （combat.js 的 regen）。
     倒下（血扣光）      不當幀重生，先演一段（death.js）：怪物失去目標、站著；人被那一下
                         打飛、當場倒下，落地之後靈魂從屍體浮起來；暗下去（浮出「死亡」），全黑的
                         時候怪物收起來、血補滿，人回到這一場的入口外面、面朝入口（route.js 的
                         restAt），門照「還沒打第 k 場」開著；亮回來的時候畫面糊了又清楚幾下，
                         浮出「原來是夢」「我又不小心睡著了」。
                         不在同一個房間裡重生；自己走回去，一進房間就重打。
     R                   重玩：回到起點，六場全部重來。
     1–6                 從第幾場開始（前面的當作打完了），在那一場的入口外面。

   音樂：開打（門關上）到清完或倒下放戰鬥那一首，其餘的時候放探索那一首（music.js）。

   這一頁跟其他模式一樣不存檔：重新整理就是重玩。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { loadZoo } from './critter.js';
import { Pad } from './pad.js';
import { Hud } from './hud.js';
import { portalAt } from './walk.js';
import { makeCam, snapCam, updateCam } from './camera.js';
import { Controls, fitView, wardrobe } from './controls.js';
import { buildStage } from './stage.js';
import { createLight } from './light.js';
import { makeHero, steerHero, moveHero } from './hero.js';
import { Transit } from './transit.js';
import { Death } from './death.js';
import { Story } from './story.js';
import { SCRIPT, pagesOf, preloadComic } from './comic.js';
import { Fight, DEATH_TEXT } from './fight.js';
import { Folk } from './folk.js';
import { Sound } from './sound.js';
import { Music } from './music.js';
import { resetLife, refill, regen, KINDS } from './combat.js';
import { BLOCKS, THRONE } from './blocks.js';
import { thronePath, pathGap } from './king.js';
import { STAGES, START, SOULS, roomOf, signposts, foesOf, inStage, makeRun, doorsFor, portalsOn, restAt } from './route.js';
import { Signpost } from './signpost.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa28a6d, 42, 165);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 420);

/* ── 遺跡 ────────────────────────────────────────────────────────
   地形模式那一片（stage.js）。門不再用 O 開關，由路線決定（`applyDoors`）。 */
const stage = buildStage(scene, renderer);
const { ruins, doors, setDoor, arenaAt } = stage;
/** 主角腳邊指著這個房間每一扇開著的門的箭頭與字（signpost.js）。 */
const signpost = new Signpost(document.getElementById('signpost'), canvas);
const COLS = stage.cols;
/** 光影（light.js）：陰影、火光、霧、後製。 */
const light = createLight({ scene, renderer, camera, ruins, cols: COLS, arenas: ruins.arenas });
const NO_PORTALS = [];
/** 怪物站在哪一張圖（combat.js 的 FIELD 那一種）：那一張的黑牆、整片遺跡的碰撞、現在的門。 */
const fieldOf = (block) => ({ arena: ruins.arenas.find((a) => a.id === block), cols: COLS, doors });

/* ── 動物 ────────────────────────────────────────────────────────── */
const zoo = await loadZoo({ look: 'dog-prick/yellow', height: 1.0 });
scene.add(zoo.root);

const player = { ...makeHero(0, 0, 0), block: 'wallwalk' };

/* 戰鬥：打死的怪物就沒了（不重生），場上沒有怪物就是這一場清完。每一場的怪物現在就把
   外觀建好——牠是進場之後才上場的，那時候才建就是一頓。 */
const fight = new Fight(scene, zoo, { respawn: false, renderer, sound: new Sound(), souls: SOULS });
fight.preload(STAGES.map((_, k) => foesOf(k)));

/** 國王復活之後的王國人民（folk.js）。 */
const folk = new Folk(scene, zoo);

/** 背景音樂：探索與戰鬥兩首，換的時候淡出淡入（music.js）。 */
const music = new Music();

const cam = makeCam(0, 0);

/** 穿過感測區的那一下暗下去再亮回來（transit.js）。 */
const transit = new Transit(document.getElementById('fade'));
const STILL = { ix: 0, iz: 0, mag: 0 };

/** 倒下的那一段：倒、變成幽靈浮起、暗下去、在門前醒來（death.js）。 */
const death = new Death(scene, zoo, {
  fade: document.getElementById('fade'), view: canvas, words: document.getElementById('dream'),
});

/** 場與場之間的漫畫：書頁、翻頁、戰後的慢動作（story.js），翻哪幾頁照 comic.js。 */
const story = new Story(document.getElementById('story'));
preloadComic();

/* ── 路線 ────────────────────────────────────────────────────────
   run 是路線的狀態（route.js 的 makeRun）：下一場是第幾場、是不是正在打。
   `spawnIn` 是開打之後離怪物出現還有幾秒（0 = 已經出現或沒在打）。 */
let run = makeRun();
let spawnIn = 0;
/** 這一輪翻過開場頁的那幾場：倒下之後走回去重打不再翻。 */
let opened = new Set();
/** 這一輪進過的房間（roomOf）：還沒進過的，路標寫去那裡的目的，不寫地名（route.js 的 signposts）。 */
let seen = new Set();
/** 倒下幾次（這一輪）。 */
let deaths = 0;
/** 上一幀在不在國王身邊（獻靈魂）：走過去的那一刻提示一次怎麼交。 */
let byAltar = false;
/** 怪物出現前的那一下：門關上、人站穩，再讓牠出來。 */
const SPAWN_DELAY = 1.0;

const stageName = (k) => (k < STAGES.length ? STAGES[k].name : '全部打完');

/** 門照路線的狀態開關。 */
function applyDoors() {
  const want = doorsFor(run);
  for (const [id, open] of Object.entries(want)) if (doors[id] !== open) setDoor(id, open);
}

/** 把人放到 (x, y, z)、面朝 yaw，鏡頭跟過去。 */
function place(at) {
  player.x = at.x; player.y = at.y + 0.2; player.z = at.z;
  player.vx = player.vy = player.vz = 0;
  player.grounded = false;
  player.aimX = Math.sin(at.yaw); player.aimZ = Math.cos(at.yaw);
  player.block = at.block;
  cam.yaw = at.yaw;
  snapCam(cam, player.x, player.z);
}

/**
 * 從第 k 場開始：前面的當作打完了，人在第 k 場的入口外面（第一場就是起點）。
 * R（重玩）就是從第 0 場開始。
 */
function startFrom(k) {
  transit.cancel();
  death.cancel();
  story.cancel();
  run = makeRun(k);
  spawnIn = 0;
  opened = new Set();
  // 從第 k 場開始：前面那幾場當作打完了，房間也當作進過。
  seen = new Set(STAGES.slice(0, k).map((s) => s.room));
  deaths = 0;
  resetLife(player);
  fight.lineup([], fieldOf('wallwalk'));
  fight.reset();                          // 地上沒撿的靈魂一起清掉
  folk.clear();
  applyDoors();
  place(k === 0 ? { ...ruins.arrivals[START] } : restAt(k, ruins));
  const say = k === 0 ? `從頭開始：${STAGES[0].name}` : `從第 ${k + 1} 場開始：${STAGES[k].name}`;
  if (k === 0) story.start(pagesOf(SCRIPT.start), { then: () => hud.flash(say) });
  else hud.flash(say);
  hud.paint({ block: STAGES[k].id });
}

/**
 * 走進了下一場：關門、斷傳送，怪物等一下出現。有開場頁的話先翻（這一輪第一次進來才翻），
 * 怪物等書頁走了才開始倒數（見主迴圈）。
 */
function engage() {
  const k = run.next;
  run.active = true;
  spawnIn = SPAWN_DELAY;
  applyDoors();
  const say = () => hud.flash(`第 ${k + 1} 場：${stageName(k)}`);
  if (SCRIPT.open[k] && !opened.has(k)) {
    opened.add(k);
    story.start(pagesOf(SCRIPT.open[k]), { then: say });
  } else say();
}

/**
 * 怪物全部打死了：這一場清完，演劇情（慢動作、書頁、漫畫），開往下一場的門。門等書頁整個
 * 蓋住的那一刻才開：漫畫講完「接下來去哪」，書頁走了門已經開好，路標（signpost.js）這時才
 * 淡進來。沒有戰後頁的那一場（王座廳）慢動作完才開。字等書頁走了才浮，不然被蓋住。
 */
function clear() {
  run.active = false;
  run.next++;
  fight.keep();
  const done = run.next >= STAGES.length;
  const k = run.next - 1;
  // 墓室打完不走回去：書頁蓋住的時候直接送到下一場的休息點（route.js 的 warp）。
  const warpTo = STAGES[k].warp && !done ? () => place(restAt(run.next, ruins)) : null;
  const say = () => hud.flash(done ? '六場全部打完——門全開了' : `這一場清完了。下一場：${stageName(run.next)}`);
  // 沒有戰後頁的那一場（王座廳：要先交靈魂，comic.js 的 SCRIPT.offered）只有慢動作，慢完才開門、浮字。
  const pages = SCRIPT.after[k] ? pagesOf(SCRIPT.after[k]) : [];
  const cover = () => { applyDoors(); if (warpTo) warpTo(); };
  story.start(pages, { slow: true, cover: pages.length ? cover : null, then: pages.length ? say : () => { applyDoors(); say(); } });
  if (!done) hud.paint({ block: STAGES[run.next].id });
}

/**
 * 倒下：開始演倒下那一段（death.js）。門還關著、這一場還算在打、怪物留在場上但失去
 * 目標（Fight.standDown），到全黑的那一刻才收起來、回到入口外面（rest）。
 *
 * 屍體打不到：guard 開到無限大，fight.js 就整個不判玩家挨打（combat.js 的 untouchable），
 * 也就不會再倒下一次。它讓玩家一閃一閃、墨線變金色的那兩件事，death.js 每幀蓋回來。
 * 收招，之後不再 lead：貼著怪物的屍體不會自動出第一擊。
 */
function fall(cause) {
  transit.cancel();
  story.cancel();
  deaths++;
  player.guard = Infinity;
  fight.disarm();
  fight.standDown();
  death.start(player, camera.position.x, camera.position.z);
  hud.flash(DEATH_TEXT[cause]);
}

/** 倒下演完、畫面全黑：怪物收起來，血補滿（guard 一起清掉），回到這一場的入口外面休息。 */
function rest() {
  refill(player);
  const k = run.next;
  run.active = false;
  spawnIn = 0;
  fight.lineup([], fieldOf(player.block));
  applyDoors();
  place(k === 0 ? { ...ruins.arrivals[START] } : restAt(k, ruins));
}

/** 王座（世界座標）：blocks.js 的 THRONE 加上王座廳的位置。 */
const SEAT = (() => {
  const [ox, oz] = BLOCKS.find((b) => b.id === 'throne').origin;
  return { x: THRONE.x + ox, y: THRONE.y, z: THRONE.z + oz, stair: THRONE.stair + oz };
})();

/**
 * 國王復活：每一張圖撒人民（folk.js）。主角與國王腳邊 FOLK_AWAY 公尺以內不撒，國王走回王座的那一條路
 * （king.js 的 thronePath）兩邊 FOLK_AWAY 以內也不撒。
 */
const FOLK_AWAY = 3;
function populate() {
  const at = fight.king.at, path = at ? thronePath(at, SEAT) : [];
  folk.spawn(ruins, COLS, doors, (x, z) => Math.hypot(x - player.x, z - player.z) < FOLK_AWAY
    || (at && pathGap(at, path, x, z) < FOLK_AWAY));
}

/** 感測區把人送走（沒在打的時候才會發生）。換了區塊就報名字。 */
function warp(dest) {
  const crossed = dest.block !== player.block;
  place(dest);
  if (crossed) hud.flash(BLOCKS.find((b) => b.id === dest.block).name);
}

/* ── 外觀、HUD、操作 ──────────────────────────────────────────────
   右邊那塊面板列出六場：亮的是下一場，點一下（或 1–6）從那一場開始。
   這個模式自己的鍵：R 重玩、1–6 從第幾場開始、P 傳送範圍。 */
const looks = wardrobe(zoo, () => hud, () => fight.follow());
const hud = new Hud({
  zoo, blocks: STAGES, onLook: looks.setLook, onHat: looks.toggleHat,
  onBlock: (id) => startFrom(STAGES.findIndex((s) => s.id === id)),
});
const pad = new Pad(document.getElementById('pad'));
const controls = new Controls(canvas, pad, cam, (k, e) => {
  if (looks.key(k, e)) return;
  if (k === 'r') startFrom(0);
  if (k === 'p') hud.flash(stage.togglePortalLines() ? '顯示傳送範圍' : '隱藏傳送範圍');
  if (k >= '1' && k <= '9' && STAGES[+k - 1]) startFrom(+k - 1);
});

/* ── 主迴圈 ──────────────────────────────────────────────────── */
let last = performance.now();
/** 世界的時鐘（毫秒）：跟著慢動作走、書頁蓋住的時候停住。火光、旗子這些照它動。 */
let clock = last;
let fpsAcc = 0, fpsN = 0, hudAcc = 0;

function frame(now) {
  // 第一幀的時間戳可能比 `last`（載入完的那一刻）早：夾在 0 以上，不然劇情的鐘會倒退。
  const real = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  pad.update(real);

  /* 劇情（story.js）先決定世界這一幀走多快：慢動作的時候慢、書頁整個蓋住的時候停——
     那時候整幀不算也不畫，畫面上反正只有書頁。這一下跳是給書頁的還是給連段的，
     也是它先問。 */
  const tapped = controls.jumpPressed();
  const dt = real * story.update(real, tapped);
  if (story.covered) {
    hud.tick(real, null);
    signpost.hide();
    requestAnimationFrame(frame);
    return;
  }
  clock += dt * 1000;

  /* 連段先決定這一下跳是什麼（破防攻擊一發動就接管速度），然後操控、移動——
     破防攻擊裡不操控、迴旋中不移動（見 fight.js）。滑落的時候不能跳。 */
  // 快被送走的那一段（畫面正在暗下去）、倒下的那一段與劇情的慢動作不操作：身體照慣性停下。
  const still = transit.busy || death.busy || story.busy;
  const input = still ? STILL : controls.axis();
  const pressed = tapped && !still;
  const sliding = player.grounded && player.slip === 'fall';
  // 在國王身邊（還收得了靈魂）：跳留給獻靈魂，不跳、不出招。
  const altar = fight.nearAltar(player);
  if (altar && !byAltar) hud.flash('長按跳，把靈魂交給國王');
  byAltar = altar;
  if (!death.busy) fight.lead(dt, player, pressed && !sliding && !altar);
  // 被擊退的那一段（combat.js 的 knockHero）也不操控：照那一下的速度飛，落地才還回來。
  if (!fight.breaking && !player.knocked) steerHero(player, dt, controls, input);
  const portals = portalsOn(run) ? ruins.portals : NO_PORTALS;
  const speed = fight.spinning ? 0 : moveHero(player, dt, COLS, portals, doors);

  // 感測區：打的時候全部不通。畫面先暗下去，全黑的時候才送（transit.js）。
  // 劇情的慢動作裡也不問：門剛開，暗下去的黑幕跟書頁搶同一個畫面。
  {
    const due = transit.update(dt);
    if (due) warp(due);
    const gate = !transit.busy && !story.busy && portalAt(portals, player.x, player.y, player.z, doors);
    if (gate) transit.go(gate.dest);
  }
  player.block = arenaAt(player.x, player.z).id;
  /* 離開有靈魂的房間就是撿了（走過去、被送過去、倒下回到休息點都算）：不在主角這個房間的靈魂——
     還沒從屍體掉出來的也算——直接收下。每一幀問，所以主角走了才掉出來的那一顆也是一掉就收。 */
  {
    const here = roomOf(player.block, player.y);
    const n = fight.bank(player, (o) => roomOf(arenaAt(o.x, o.z).id, o.y) !== here);
    if (n) hud.flash(`沒撿的 ${n} 顆靈魂收下了，最大血量 +${n}`);
  }

  // 路線：走進下一場就開打；怪物等一下出現；全部打死就清完。
  if (!run.active && run.next < STAGES.length && inStage(run.next, player.block, player.x, player.y, player.z)) engage();
  if (run.active && spawnIn > 0 && !story.on) {
    spawnIn -= dt;
    if (spawnIn <= 0) {
      spawnIn = 0;
      fight.lineup(foesOf(run.next), fieldOf(STAGES[run.next].room.split(':')[0]));
      hud.flash(`${foesOf(run.next).length > 1 ? '怪物' : KINDS[foesOf(run.next)[0].kind].name}出現了`);
    }
  }
  const { hit, died, souls } = fight.resolve(dt, player);
  if (souls) hud.flash(`撿到靈魂，最大血量 +${souls}`);
  {
    const gift = fight.give(dt, player, !still && controls.jumpDown());
    const { given, need } = fight.offer;
    // 交滿：最後那一顆落到國王身上之後國王復甦（fight.js 的 REVIVE），演完才慢動作、翻國王復活的那一頁。
    // 書頁蓋住的時候撒人民（建一堆動物要一下子，蓋著看不到）：不撒在主角與國王腳邊。
    // 書頁走了國王走回王座。
    if (gift.risen) story.start(pagesOf(SCRIPT.offered), { slow: true, cover: populate, then: () => fight.king.enthrone(COLS, SEAT) });
    if (gift.done) hud.flash(`${need} 顆靈魂都交給國王了`);
    else if (gift.short) hud.flash(`還需要 ${need - given} 顆靈魂——回去找找沒撿到的`);
    else if (gift.gave) hud.flash(`交出一顆靈魂（${given}/${need}）`);
  }
  if (!run.active && !death.busy) regen(player, dt);     // 不在戰鬥中：很快回血
  if (run.active && spawnIn === 0 && !fight.foes.length && !fight.emerging && !death.busy) clear();
  if (died) fall(died);
  else if (hit) hud.flash(`${DEATH_TEXT[hit.cause]}，扣 ${hit.dmg} 點血`);
  music.want(run.active ? 'fight' : 'explore');

  // 動物
  zoo.root.position.set(player.x, player.y, player.z);
  if (!death.busy) zoo.setFacing(fight.faceYaw(player));
  const viewYaw = Math.atan2(camera.position.x - player.x, camera.position.z - player.z);
  zoo.update(dt, { speed, grounded: player.grounded, vy: player.vy, viewYaw, move: fight.move(dt) });

  stage.animate(clock);

  // 相機
  {
    const rig = updateCam(cam, dt, player, arenaAt(cam.px, cam.pz), COLS);
    camera.position.set(rig.pos[0], rig.pos[1], rig.pos[2]);
    camera.lookAt(rig.look[0], rig.look[1], rig.look[2]);
  }
  // 路標只在不打、也不在演劇情（慢動作、書頁）的時候出現：開打的那一刻淡出去，漫畫走了才淡進來。
  seen.add(roomOf(player.block, player.y));
  signpost.show(signposts(ruins.portals, roomOf(player.block, player.y), seen), doors, player, camera, real, !run.active && !story.on);

  fight.draw(dt, camera, player);
  folk.update(dt, camera, player, player.block);
  if (death.update(dt, player, viewYaw)) rest();
  const king = fight.king && fight.king.body();
  light.update({
    dt, now: clock, player, block: player.block, foes: fight.foes.map((f) => f.m),
    crowd: king ? [...folk.here(player.block), king] : folk.here(player.block),
  });
  light.render();
  pad.draw();

  fpsAcc += real; fpsN++; hudAcc += real;
  let line = null;
  if (hudAcc > 0.25) {
    const st = fight.status();
    const where = run.next >= STAGES.length ? '全部打完'
      : `第 ${run.next + 1} 場 ${stageName(run.next)}・${run.active ? (spawnIn > 0 ? '開打' : '戰鬥中') : '還沒進去'}`;
    line = `${Math.round(fpsN / fpsAcc)} fps ・ ${where} ・ 血 ${player.hp}/${player.max} ・ 倒下 ${deaths} 次`
      + `${st.foeLine ? ` ・ ${st.foeLine}` : ''} ・ ${st.phase} ・ `
      + `${fight.altar() ? `靈魂 ${fight.offer.given}/${fight.offer.need}${fight.offer.held > 0 ? `（按著 ${fight.offer.held.toFixed(1)} 秒）` : ''} ・ ` : ''}`
      + `x ${player.x.toFixed(1)} y ${player.y.toFixed(1)} z ${player.z.toFixed(1)}`;
    fpsAcc = 0; fpsN = 0; hudAcc = 0;
  }
  hud.tick(real, line);
  requestAnimationFrame(frame);
}

fitView({
  renderer, camera, pad, hud,
  ink: (px, h) => { zoo.setInkPx(px, h); fight.setInkPx(px, h); death.setInkPx(px, h); folk.setInkPx(px, h); },
});

document.getElementById('boot').remove();
startFrom(0);
requestAnimationFrame(frame);

// 給主控台一個把手，方便手動看東西。run 會被換掉，所以是 getter。
window.flowArea = {
  scene, camera, renderer, zoo, player, ruins, cam, pad, hud, fight, folk, music, doors, death, story, startFrom,
  get run() { return run; },
  get foes() { return fight.foes; },
};
