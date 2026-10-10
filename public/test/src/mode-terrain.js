/* ── test/src/mode-terrain.js ───────────────────────────────────────
   /test/?mode=terrain：地形模式的組裝與操作。

   這頁只做兩件事：走路，以及把那隻動物拿起來看。沒有計分、沒有連線、
   沒有敵人、不寫 localStorage——它是一個試玩場，不是一個關卡。

   ── 場景一共幾個 draw call ───────────────────────────────────────
     地圖      2（合併後的砌體 + 合併後的墨線）
     門        每扇門看得到的那一種狀態 1～2（門扇 + 墨線；開著的黑門洞沒有墨線）
     地面      1
     天空      1
     火焰      每盆 1（十幾盆）
     動物      3（皮毛、臉、翻面的墨線外殼）——遊戲那幾隻本人，一份幾何
               三個 draw range；圓角方形在載入時烘進頂點，見
               critter.js。沒被選到的那兩隻 visible = false。
   靜態的東西之所以是兩個 draw，是因為它們真的不會動；會動的東西才各自
   一份。這個分界就是 blocks.js 為什麼不把火焰砌進緩衝區的原因。

   ── 版面與操作 ──────────────────────────────────────────────────
   照遊戲手把模式的版面：兩側各一根操作列（上面板、下操作元件），中間
   那一整片留給遊戲。幾何由 pad.js 算，這裡把 rail / barT / barB / ctrl
   寫進 CSS 變數，所以 DOM 的面板與畫布上的搖桿共用同一條列。

   一個軸、一顆跳，兩種來源餵同一組數字：鍵盤（WASD／⇧／空白）與螢幕上
   那支搖桿。所以「速度是類比的」這件事在兩邊都成立，而不是觸控一套、
   鍵盤一套。

   指標事件在這裡路由：落在搖桿或跳躍鈕的範圍裡就交給 pad.js，落在中間
   那片畫面上的是視角——一根手指轉、兩根手指縮放。一次拖曳要嘛是走路
   要嘛是轉視角，中途不換手，所以是照按下的位置決定。

   ── 相機 ────────────────────────────────────────────────────────
   第三人稱，用彈簧跟著角色。移動的方向是相機的方向——這是這類遊戲唯一
   不會讓人走錯邊的組合。想細看動物就把鏡頭拉近再繞著轉，所以沒有另外
   的觀賞模式：那會是一個什麼都不多做的狀態。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { buildRuins, BLOCKS, DOORS } from './blocks.js';
import { loadZoo } from './critter.js';
import { Pad } from './pad.js';
import { Hud } from './hud.js';
import { PHYS, portalAt } from './walk.js';
import { makeCam, snapCam, updateCam } from './camera.js';
import { Controls, fitView, wardrobe } from './controls.js';
import { buildStage } from './stage.js';
import { createLight } from './light.js';
import { makeHero, steerHero, moveHero } from './hero.js';
import { Transit } from './transit.js';
import { roomOf, signposts } from './route.js';
import { Signpost } from './signpost.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa28a6d, 42, 165);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 420);

/* ── 遺跡 ────────────────────────────────────────────────────────
   地面、砌體、門、黑牆、火焰：stage.js（完整流程模式站的是同一片）。 */
const stage = buildStage(scene, renderer);
const { ruins, doors, setDoor, arenaAt } = stage;
/** 主角腳邊指著這個房間每一扇開著的門的箭頭與字（signpost.js）。 */
const signpost = new Signpost(document.getElementById('signpost'), canvas);
const COLS = stage.cols;
/** 光影（light.js）：陰影、火光、霧、後製。 */
const light = createLight({ scene, renderer, camera, ruins, cols: COLS, arenas: ruins.arenas });

/** P：傳送範圍的線框，開或關。 */
function togglePortalLines() {
  hud.flash(stage.togglePortalLines() ? '顯示傳送範圍' : '隱藏傳送範圍');
}

/* ── 動物 ────────────────────────────────────────────────────────
   遊戲那幾隻本人：一份 cat.bin，經過 species.js 生出貓與兩種狗，每一種
   都戴得上漁夫帽。頂層 await——這一頁沒有牠們就沒有東西可以試玩，所以
   沒有「先跑起來再說」這個選項。 */
const zoo = await loadZoo({ look: 'dog-prick/yellow', height: 1.0 });
scene.add(zoo.root);

const player = { ...makeHero(ruins.spawns.courtyard[0], 0, ruins.spawns.courtyard[2]), block: 'courtyard' };

/* 碰撞的規則在 walk.js——那一支 tools/verify-terrain.mjs 也在用，
   於是「中心夠空曠」這條設計規則可以離線踩過一遍來驗，而不是靠看。 */

/* ── 相機 ────────────────────────────────────────────────────────
   規則在 camera.js（吊臂、dead zone、釘住樞紐），那一支 node 跑得動，
   所以「被牆逼到最近的時候角色會不會離開畫面中心」是驗得出來的，不是
   靠看。這裡只有玩家的輸入寫進 yaw／pitch／dist。 */
const cam = makeCam(0, 0);

/** 穿過感測區的那一下暗下去再亮回來（transit.js）。 */
const transit = new Transit(document.getElementById('fade'));
const STILL = { ix: 0, iz: 0, mag: 0 };

/** 把角色放到某個區塊的出生點。 */
function goto(id) {
  const s = ruins.spawns[id];
  if (!s) return;
  transit.cancel();
  player.x = s[0]; player.y = s[1] + 0.2; player.z = s[2];
  player.vx = player.vy = player.vz = 0;
  player.block = id;
  cam.yaw = s[3] ?? Math.PI;          // 區塊可以指定出生時面朝哪裡
  snapCam(cam, player.x, player.z);
  hud.flash(BLOCKS.find((b) => b.id === id).name);
  hud.paint({ block: id });
}

/** 把角色送到一個感測區的目的地（blocks.js 解好的 `dest`）。換了區塊才報名字。 */
function warp(dest) {
  const crossed = dest.block !== player.block;
  player.x = dest.x; player.y = dest.y + 0.2; player.z = dest.z;
  player.vx = player.vy = player.vz = 0;
  player.block = dest.block;
  cam.yaw = dest.yaw;
  snapCam(cam, player.x, player.z);
  if (crossed) {
    hud.flash(BLOCKS.find((b) => b.id === dest.block).name);
    hud.paint({ block: dest.block });
  }
}

/** O：連著這個區塊的每一扇門一起開或關（試玩用；之後由別的東西來開）。 */
function toggleDoors() {
  const mine = DOORS.filter((d) => d.blocks.includes(player.block)).map((d) => d.id);
  if (!mine.length) { hud.flash('這裡沒有門'); return; }
  const open = !doors[mine[0]];
  for (const g of mine) setDoor(g, open);
  hud.flash(open ? '門開了' : '門關了');
}

/* ── 外觀、HUD、操作 ──────────────────────────────────────────────
   輸入與版面在 controls.js（每個模式都一樣）；這裡只有這個模式自己的鍵：
   R 回出生點、O 開關門、P 傳送範圍、1–6 換地形。 */
const looks = wardrobe(zoo, () => hud);
const hud = new Hud({
  zoo,
  blocks: BLOCKS,
  onLook: looks.setLook,
  onBlock: goto,
  onHat: looks.toggleHat,
});
const pad = new Pad(document.getElementById('pad'));
const controls = new Controls(canvas, pad, cam, (k, e) => {
  if (looks.key(k, e)) return;
  if (k === 'r') goto(player.block);
  if (k === 'o') toggleDoors();
  if (k === 'p') togglePortalLines();
  if (k >= '1' && k <= '9' && BLOCKS[+k - 1]) goto(BLOCKS[+k - 1].id);
});

/* ── 主迴圈 ──────────────────────────────────────────────────── */
const critterTris = zoo.active.data.header.groups.reduce((n, g) => n + g.count, 0) / 3;
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsShown = 0, hudAcc = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  pad.update(dt);

  // 快被送走的那一段（畫面正在暗下去）不操作：身體照慣性停下。
  const input = transit.busy ? STILL : controls.axis();

  const locked = steerHero(player, dt, controls, input);

  const jumped = controls.jumpHeld();
  if (jumped && player.grounded && !locked && !transit.busy) {
    player.vy = PHYS.jump;
    player.grounded = false;
  }

  const realSpeed = moveHero(player, dt, COLS, ruins.portals, doors);

  /* 感測區（井底、沒入黑霧的路、開著的門）：走進去就被送到它的目的地——
     畫面先暗下去，全黑的時候才送（transit.js）。判斷在 walk.js，驗證器淹水
     的時候問的是同一支；門關著的那幾個不算。 */
  {
    const due = transit.update(dt);
    if (due) warp(due);
    const gate = !transit.busy && portalAt(ruins.portals, player.x, player.y, player.z, doors);
    if (gate) transit.go(gate.dest);
  }

  // 走到哪個區塊了。用出生點最近的那一個，不用方框——區塊之間是連著的。
  let best = player.block, bd = Infinity;
  for (const b of BLOCKS) {
    const s = ruins.spawns[b.id];
    const d = Math.hypot(player.x - s[0], player.z - s[2]);
    if (d < bd) { bd = d; best = b.id; }
  }
  const crossed = best !== player.block;
  player.block = best;

  // 動物
  zoo.root.position.set(player.x, player.y, player.z);
  /* 朝向只看操控，不看位移，而且每幀都送：
       · 停下來之後還會繼續轉到最後推的那個方向才停（目標不會被清掉）。
       · 緩滑的時候不會被下坡的方向帶著轉——人沒有下那個指令。
     轉多快是外觀的事，在 critter.js 的 TURN_RATE。 */
  zoo.setFacing(Math.atan2(player.aimX, player.aimZ));
  /* 鏡頭在哪個方位，給「頭稍微轉向觀眾」與「遠側那隻眼睛收合」用——
     兩件事都是遊戲自己的做法，見 critter.js 的 REST_AIM 與 _eyeFade。 */
  const viewYaw = Math.atan2(camera.position.x - player.x, camera.position.z - player.z);
  zoo.update(dt, {
    speed: realSpeed, grounded: player.grounded, vy: player.vy, viewYaw,
  });

  stage.animate(now);

  // 相機。規則在 camera.js，這裡只把算出來的兩個點交給 three。
  {
    const rig = updateCam(cam, dt, player, arenaAt(cam.px, cam.pz), COLS);
    camera.position.set(rig.pos[0], rig.pos[1], rig.pos[2]);
    camera.lookAt(rig.look[0], rig.look[1], rig.look[2]);
  }
  signpost.show(signposts(ruins.portals, roomOf(player.block, player.y)), doors, player, camera, dt);

  light.update({ dt, now, player, block: player.block });
  light.render();
  pad.draw();

  fpsAcc += dt; fpsN++; hudAcc += dt;
  let line = null;
  if (hudAcc > 0.25) {
    fpsShown = Math.round(fpsN / fpsAcc);
    fpsAcc = 0; fpsN = 0; hudAcc = 0;
    line = `${fpsShown} fps${stage.surf ? '' : '（無紋路）'} ・ 關卡 ${(ruins.tris / 1000).toFixed(0)}k tri ・ `
      + `${(ruins.inkLines / 1000).toFixed(0)}k 墨線 ・ 動物 ${(critterTris / 1000).toFixed(0)}k ・ `
      + `x ${player.x.toFixed(1)} y ${player.y.toFixed(1)} z ${player.z.toFixed(1)}`
      + (player.slip ? `・${player.slip === 'fall' ? '滑落' : '緩滑'}` : '');
  }
  hud.tick(dt, line);
  if (crossed) hud.paint({ block: player.block });
  requestAnimationFrame(frame);
}

fitView({ renderer, camera, pad, hud, ink: (px, h) => zoo.setInkPx(px, h) });

document.getElementById('boot').remove();
goto('courtyard');
requestAnimationFrame(frame);

// 給主控台一個把手，方便手動看東西（這頁沒有存檔，改了重載就回原樣）。
window.testArea = { scene, camera, renderer, zoo, player, ruins, cam, pad, hud, goto, warp, setLook: looks.setLook, doors, setDoor, togglePortalLines };
