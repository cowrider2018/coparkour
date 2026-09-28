/* ── test/src/mode-flow.js ───────────────────────────────────────────
   /test/?mode=flow：完整流程模式的組裝與操作。

   地形模式的遺跡（stage.js、hero.js）加上戰鬥模式的戰鬥（fight.js），照
   route.js 的路線一場一場打。每一場一隻 BOSS——這個模式現在只確認流程
   （開打、關門、打完開門、倒下、重玩），不設計關卡。

   ── 一場的一生 ──────────────────────────────────────────────────
     走進第 k 場的範圍   所有的門關上、所有的傳送不通；一秒後 BOSS 出現。
     打死 BOSS           這一場清完：只開通往下一場的門（route.js 的 OPEN）。
     挨打                扣血（頭頂的愛心，fight.js）。BOSS 死掉掉出的靈魂撿起來
                         最大血量 +1，一路帶到後面的場。
     不在戰鬥中          清完一場之後、還沒走進下一場之前：很快回血到最大血量
                         （combat.js 的 regen）。
     倒下（血扣光）      BOSS 收起來，血補滿，人回到這一場的入口外面休息、面朝入口
                         （route.js 的 restAt），門照「還沒打第 k 場」開著。
                         不在同一個房間裡重生；自己走回去，一進房間就重打。
     R                   重玩：回到起點，六場全部重來。
     1–6                 從第幾場開始（前面的當作打完了），在那一場的入口外面。

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
import { makeHero, steerHero, moveHero } from './hero.js';
import { Fight, DEATH_TEXT } from './fight.js';
import { resetLife, refill, regen } from './combat.js';
import { BLOCKS } from './blocks.js';
import { STAGES, START, bossPost, inStage, makeRun, doorsFor, portalsOn, restAt } from './route.js';

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
const COLS = stage.cols;
const NO_PORTALS = [];
/** 怪物站在哪一張圖（combat.js 的 FIELD 那一種）：那一張的黑牆、整片遺跡的碰撞、現在的門。 */
const fieldOf = (block) => ({ arena: ruins.arenas.find((a) => a.id === block), cols: COLS, doors });

/* ── 動物 ────────────────────────────────────────────────────────── */
const zoo = await loadZoo({ look: 'dog-prick/yellow', height: 1.0 });
scene.add(zoo.root);

const player = { ...makeHero(0, 0, 0), block: 'wallwalk' };

/* 戰鬥：打死的 BOSS 就沒了（不重生），場上沒有怪物就是這一場清完。 */
const fight = new Fight(scene, zoo, { respawn: false, renderer });

const cam = makeCam(0, 0);

/* ── 路線 ────────────────────────────────────────────────────────
   run 是路線的狀態（route.js 的 makeRun）：下一場是第幾場、是不是正在打。
   `spawnIn` 是開打之後離 BOSS 出現還有幾秒（0 = 已經出現或沒在打）。 */
let run = makeRun();
let spawnIn = 0;
/** 倒下幾次（這一輪）。 */
let deaths = 0;
/** BOSS 出現前的那一下：門關上、人站穩，再讓牠出來。 */
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
  run = makeRun(k);
  spawnIn = 0;
  deaths = 0;
  resetLife(player);
  fight.lineup([], fieldOf('wallwalk'));
  fight.reset();                          // 地上沒撿的靈魂一起清掉
  applyDoors();
  place(k === 0 ? { ...ruins.arrivals[START] } : restAt(k, ruins));
  hud.flash(k === 0 ? `從頭開始：${STAGES[0].name}` : `從第 ${k + 1} 場開始：${STAGES[k].name}`);
  hud.paint({ block: STAGES[k].id });
}

/** 走進了下一場：關門、斷傳送，BOSS 等一下出現。 */
function engage() {
  run.active = true;
  spawnIn = SPAWN_DELAY;
  applyDoors();
  hud.flash(`第 ${run.next + 1} 場：${stageName(run.next)}`);
}

/** BOSS 打死了：這一場清完，開往下一場的門。 */
function clear() {
  run.active = false;
  run.next++;
  applyDoors();
  const done = run.next >= STAGES.length;
  hud.flash(done ? '六場全部打完——門全開了' : `打倒 BOSS！撿起牠的靈魂，最大血量 +1。下一場：${stageName(run.next)}`);
  if (!done) hud.paint({ block: STAGES[run.next].id });
}

/** 倒下：BOSS 收起來，血補滿，回到這一場的入口外面休息。 */
function fall(cause) {
  deaths++;
  refill(player);
  const k = run.next;
  run.active = false;
  spawnIn = 0;
  fight.lineup([], fieldOf(player.block));
  applyDoors();
  place(k === 0 ? { ...ruins.arrivals[START] } : restAt(k, ruins));
  hud.flash(`${DEATH_TEXT[cause]}——在入口外面休息，準備好再進去`);
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
let fpsAcc = 0, fpsN = 0, hudAcc = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  pad.update(dt);

  /* 連段先決定這一下跳是什麼（破防攻擊一發動就接管速度），然後操控、移動——
     破防攻擊裡不操控、迴旋中不移動（見 fight.js）。滑落的時候不能跳。 */
  const input = controls.axis();
  const pressed = controls.jumpPressed();
  const sliding = player.grounded && player.slip === 'fall';
  fight.lead(dt, player, pressed && !sliding);
  if (!fight.breaking) steerHero(player, dt, controls, input);
  const portals = portalsOn(run) ? ruins.portals : NO_PORTALS;
  const speed = fight.spinning ? 0 : moveHero(player, dt, COLS, portals, doors);

  // 感測區：打的時候全部不通。
  {
    const gate = portalAt(portals, player.x, player.y, player.z, doors);
    if (gate) warp(gate.dest);
  }
  player.block = arenaAt(player.x, player.z).id;

  // 路線：走進下一場就開打；BOSS 等一下出現；打死就清完。
  if (!run.active && run.next < STAGES.length && inStage(run.next, player.block, player.x, player.y, player.z)) engage();
  if (run.active && spawnIn > 0) {
    spawnIn -= dt;
    if (spawnIn <= 0) {
      spawnIn = 0;
      fight.lineup([bossPost(run.next)], fieldOf(STAGES[run.next].room.split(':')[0]));
      hud.flash('BOSS 出現了');
    }
  }
  const { hit, died, souls } = fight.resolve(dt, player);
  if (souls) hud.flash(`撿到靈魂，最大血量 +${souls}`);
  if (!run.active) regen(player, dt);     // 不在戰鬥中：很快回血
  if (run.active && spawnIn === 0 && !fight.foes.length) clear();
  if (died) fall(died);
  else if (hit) hud.flash(`${DEATH_TEXT[hit.cause]}，扣 ${hit.dmg} 點血`);

  // 動物
  zoo.root.position.set(player.x, player.y, player.z);
  zoo.setFacing(Math.atan2(player.aimX, player.aimZ));
  const viewYaw = Math.atan2(camera.position.x - player.x, camera.position.z - player.z);
  zoo.update(dt, { speed, grounded: player.grounded, vy: player.vy, viewYaw, move: fight.move(dt) });

  stage.animate(now);

  // 相機
  {
    const rig = updateCam(cam, dt, player, arenaAt(cam.px, cam.pz), COLS);
    camera.position.set(rig.pos[0], rig.pos[1], rig.pos[2]);
    camera.lookAt(rig.look[0], rig.look[1], rig.look[2]);
  }

  fight.draw(dt, camera, player);
  renderer.render(scene, camera);
  pad.draw();

  fpsAcc += dt; fpsN++; hudAcc += dt;
  let line = null;
  if (hudAcc > 0.25) {
    const st = fight.status();
    const where = run.next >= STAGES.length ? '全部打完'
      : `第 ${run.next + 1} 場 ${stageName(run.next)}・${run.active ? (spawnIn > 0 ? '開打' : '戰鬥中') : '還沒進去'}`;
    line = `${Math.round(fpsN / fpsAcc)} fps ・ ${where} ・ 血 ${player.hp}/${player.max} ・ 倒下 ${deaths} 次`
      + `${st.foeLine ? ` ・ ${st.foeLine}` : ''} ・ ${st.phase} ・ `
      + `x ${player.x.toFixed(1)} y ${player.y.toFixed(1)} z ${player.z.toFixed(1)}`;
    fpsAcc = 0; fpsN = 0; hudAcc = 0;
  }
  hud.tick(dt, line);
  requestAnimationFrame(frame);
}

fitView({
  renderer, camera, pad, hud,
  ink: (px, h) => { zoo.setInkPx(px, h); fight.setInkPx(px, h); },
});

document.getElementById('boot').remove();
startFrom(0);
requestAnimationFrame(frame);

// 給主控台一個把手，方便手動看東西。run 會被換掉，所以是 getter。
window.flowArea = {
  scene, camera, renderer, zoo, player, ruins, cam, pad, hud, fight, doors, startFrom,
  get run() { return run; },
  get foes() { return fight.foes; },
};
