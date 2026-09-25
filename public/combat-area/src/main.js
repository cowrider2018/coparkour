/* ── combat-area/src/main.js ─────────────────────────────────────────
   /combat-area/ 這一頁的組裝與操作。

   試玩場（/test-area/）的 main.js 拿掉地形之後剩下的東西：一塊黑牆圍起來
   的空地、那隻動物、第三人稱鏡頭、手把。走路、跳、鏡頭、手把的規則都
   不在這裡，是直接 import 試玩場那幾支——這一頁只多了戰鬥（combat.js）
   與一隻怪物（monster.js）。

   ── 場景一共幾個 draw call ───────────────────────────────────────
     地面      1
     黑牆      1（牆、頂、霧殼、牆腳漸層是同一個 mesh）
     動物      3（皮毛、臉、翻面的墨線外殼）
     怪物      3（同上，另一份幾何）
     攻擊範圍  出招的那 0.2 秒 1；提示圈亮著的時候 1
   ------------------------------------------------------------------ */

import * as THREE from '../../test-area/vendor/three.module.js';
import { toon } from '../../test-area/src/palette.js';
import { SURF, surfaceTextures } from '../../test-area/src/surface.js';
import { loadZoo } from '../../test-area/src/critter.js';
import { Pad } from '../../test-area/src/pad.js';
import { Hud } from '../../test-area/src/hud.js';
import { PHYS, solveXZ, supportInfo, steer } from '../../test-area/src/walk.js';
import { CAM, makeCam, snapCam, updateCam } from '../../test-area/src/camera.js';
import { buildVeil } from '../../test-area/src/veil.js';
import { lookInfo } from '../../src/cat/looks.js';
import {
  ARENA, COLS, SPAWN, SWING, KNOCK_SCALE, makeMonster, placeMonster, monsterStep, bites, knock,
  inSlash, inFan, inRing, slashTip, fanFrame, makeCombo, comboStep, invulnerable, cueing,
} from './combat.js';
import { makeMonsterCritter } from './monster.js';
import { slashFx, fanFx, ringFx, cueFx, showFx } from './fx.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa28a6d, 42, 165);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 420);

/* 表面紋路：`?surf=0` 關掉，跟試玩場同一個開關。 */
const SURF_ON = new URLSearchParams(location.search).get('surf') !== '0';
if (SURF_ON) {
  const an = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  for (const t of surfaceTextures()) t.anisotropy = an;
}

/* 地面。試玩場那一片，只是這裡上面什麼都沒有。 */
const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), toon(0x6a5844, SURF_ON ? SURF.dirt : false));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.06;
scene.add(ground);

/* ── 黑牆 ────────────────────────────────────────────────────────
   veil.js 吐的那一份，材質照試玩場 main.js 的 hazeMesh：純黑、透明度在
   頂點色的第四個分量、單面朝內。 */
{
  const v = buildVeil([ARENA]);
  const col = new Float32Array(v.alpha.length * 4);
  for (let i = 0; i < v.alpha.length; i++) col[i * 4 + 3] = v.alpha[i];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.computeBoundingSphere();
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, side: THREE.FrontSide,
    fog: false, depthWrite: false,
  })));
}

/* ── 動物 ────────────────────────────────────────────────────────
   玩家那一隻：試玩場的 Zoo，一樣換得了動物、毛色、帽子。 */
const zoo = await loadZoo({ look: 'dog-prick/yellow', height: 1.0 });
scene.add(zoo.root);

const player = {
  x: SPAWN.player.x, y: 0, z: SPAWN.player.z,
  vx: 0, vy: 0, vz: 0, grounded: true,
  aimX: 0, aimZ: -1,
};

/* 怪物：綠色、紅眼睛的立耳犬，借玩家那個 Zoo 讀好的資料。 */
const monster = makeMonster();
const beast = makeMonsterCritter(zoo);
scene.add(beast.root);

/** 被咬過幾次。 */
let deaths = 0;

/* 連段的狀態與每一段的高亮。 */
const combo = makeCombo();
const fxSlash = slashFx(), fxFan = fanFx(), fxRing = ringFx(), fxCue = cueFx();
scene.add(fxSlash.node, fxFan.node, fxRing.node, fxCue.node);

/** 這一幀在哪一段，它的範圍打不打得到怪物。第二段指著上一次第一段的末端點。 */
const REACHES = { slash: inSlash, rise: (p, m) => inFan(p, m, combo.tip), slam: inRing };

const cam = makeCam(0, 0);

/** 回到站位：玩家在中線 2/3、怪物在 1/3，都面向中心，鏡頭在玩家背後。 */
function resetStance() {
  const s = SPAWN.player;
  player.x = s.x; player.y = 0; player.z = s.z;
  player.vx = player.vy = player.vz = 0;
  player.grounded = true;
  player.aimX = Math.sin(s.yaw); player.aimZ = Math.cos(s.yaw);
  cam.yaw = s.yaw;
  snapCam(cam, player.x, player.z);
  placeMonster(monster);
  beast.setFacing(SPAWN.monster.yaw);
  Object.assign(combo, makeCombo());
}

/* ── 外觀 ────────────────────────────────────────────────────── */
function setLook(look) {
  if (!zoo.setLook(look)) return;
  hud.flash(lookInfo(look).name);
  hud.paint();
}
function cycleSkin(step) {
  const { model, skin } = lookInfo(zoo.look);
  const skins = zoo.critters.get(model).skins;
  const i = (skins.indexOf(skin) + step + skins.length) % skins.length;
  setLook(`${model}/${skins[i]}`);
}
function cycleModel(step) {
  const { model, skin } = lookInfo(zoo.look);
  const ms = zoo.models;
  const next = ms[(ms.indexOf(model) + step + ms.length) % ms.length];
  const col = Math.max(0, zoo.critters.get(model).skins.indexOf(skin));
  const skins = zoo.critters.get(next).skins;
  setLook(`${next}/${skins[Math.min(col, skins.length - 1)]}`);
}
function toggleHat() {
  zoo.setHat(!zoo.hatOn);
  hud.flash(zoo.hatOn ? '戴上漁夫帽' : '脫下漁夫帽');
  hud.paint();
}

/* ── HUD ─────────────────────────────────────────────────────────
   試玩場那一份。沒有區塊可以選，所以右邊那塊面板的按鈕列是空的。 */
const hud = new Hud({ zoo, blocks: [], onLook: setLook, onBlock: () => {}, onHat: toggleHat });

/* ── 螢幕上的操作與指標路由：照試玩場 ─────────────────────────── */
const pad = new Pad(document.getElementById('pad'));
const drag = new Map();
const owners = new Map();
canvas.addEventListener('pointerdown', (e) => {
  const zone = pad.hit(e.clientX, e.clientY);
  owners.set(e.pointerId, zone || 'view');
  if (zone) pad.down(zone, e.pointerId, e.clientX, e.clientY);
  else drag.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { canvas.setPointerCapture(e.pointerId); } catch { /* 沒有就算了 */ }
});
let pinch = null;
const pinchSpan = () => {
  const ps = [...drag.values()];
  if (ps.length < 2) return null;
  return Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
};
canvas.addEventListener('pointermove', (e) => {
  const who = owners.get(e.pointerId);
  if (who === 'joy' || who === 'jmp') { pad.move(e.pointerId, e.clientX, e.clientY); return; }
  const d = drag.get(e.pointerId);
  if (!d) return;
  if (drag.size >= 2) {
    const before = pinch ?? pinchSpan();
    d.x = e.clientX; d.y = e.clientY;
    const after = pinchSpan();
    if (before && after) cam.dist = Math.max(CAM.near, Math.min(CAM.far, cam.dist * (before / after)));
    pinch = after;
    return;
  }
  cam.yaw -= (e.clientX - d.x) * 0.006;
  cam.pitch = Math.max(-0.35, Math.min(1.15, cam.pitch + (e.clientY - d.y) * 0.004));
  d.x = e.clientX; d.y = e.clientY;
});
const release = (e) => {
  pad.up(e.pointerId);
  owners.delete(e.pointerId);
  drag.delete(e.pointerId);
  pinch = drag.size >= 2 ? pinchSpan() : null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.dist = Math.max(CAM.near, Math.min(CAM.far, cam.dist + Math.sign(e.deltaY) * 0.6));
}, { passive: false });

/* ── 鍵盤 ────────────────────────────────────────────────────────
   跳是「按下的那一下」，不是「按著」：試玩場按著空白會落地就再跳，這裡
   的跳同時是連段的按鍵，按一下就只能算一下。 */
const keys = new Set();
const held = (...names) => names.some((n) => keys.has(n));
let jumpQueued = false;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === ' ') jumpQueued = true;
  if (k === 'h') toggleHat();
  if (k === 'c') cycleSkin(e.shiftKey ? -1 : 1);
  if (k === 'x') cycleModel(e.shiftKey ? -1 : 1);
  if (k === 'r') { resetStance(); hud.flash('重新站位'); }
  if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

/** 軸的長度 → 想要的速度。試玩場那一條。 */
function speedFor(mag) {
  if (mag <= 0) return 0;
  if (mag <= 0.72) return PHYS.walk * (mag / 0.72);
  return PHYS.walk + (PHYS.run - PHYS.walk) * ((mag - 0.72) / 0.28);
}

/** 右上那一行小字：現在在連段的哪裡。 */
const PHASE_NAME = {
  idle: '待機', slash: '第一段', rest: '第一段收招', rise: '第二段', air: '第二段之後', leap: '第三段起跳', slam: '第三段落地',
};

/* ── 主迴圈 ──────────────────────────────────────────────────── */
let last = performance.now();
let fpsAcc = 0, fpsN = 0, hudAcc = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  pad.update(dt);

  let ix = 0, iz = 0;
  if (held('w', 'arrowup')) iz += 1;
  if (held('s', 'arrowdown')) iz -= 1;
  if (held('a', 'arrowleft')) ix -= 1;
  if (held('d', 'arrowright')) ix += 1;
  const km = Math.hypot(ix, iz);
  if (km > 0) {
    const want = held('shift') ? 1 : 0.72;
    ix = (ix / km) * want; iz = (iz / km) * want;
  }
  if (pad.mag > 0) { ix += pad.axis.x; iz -= pad.axis.y; }
  let mag = Math.hypot(ix, iz);
  if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }

  const fwdX = Math.sin(cam.yaw), fwdZ = Math.cos(cam.yaw);
  const rgtX = -fwdZ, rgtZ = fwdX;
  if (mag > 1e-4) {
    player.aimX = (fwdX * iz + rgtX * ix) / mag;
    player.aimZ = (fwdZ * iz + rgtZ * ix) / mag;
  }
  [player.vx, player.vz] = steer(player.vx, player.vz, player.aimX, player.aimZ, speedFor(mag), dt);

  /* 連段決定這一下跳是什麼：普通的跳，或是某一段的出手。站不站在地上
     看的是上一幀的結果，跟試玩場判斷能不能跳是同一個時間點。 */
  const pressed = pad.takeJump() || jumpQueued;
  jumpQueued = false;
  const act = comboStep(combo, dt, {
    pressed, grounded: player.grounded, near: inSlash(player, monster),
  });
  if (act.start === 1) combo.tip = slashTip(player);
  if (act.jump) {
    player.vy = PHYS.jump;
    player.grounded = false;
  }

  // 水平：只有黑牆擋。
  [player.x, player.z] = solveXZ(COLS, player.x + player.vx * dt, player.z + player.vz * dt, player.y);

  // 垂直
  const prevY = player.y;
  player.vy -= PHYS.gravity * dt;
  player.y += player.vy * dt;
  const sup = supportInfo(COLS, player.x, player.z, prevY);
  if (player.y <= sup.y && player.vy <= 0) {
    player.y = sup.y;
    player.vy = 0;
    player.grounded = true;
  } else {
    player.grounded = false;
  }

  /* 怪物追人（或是被擊退、在空中飛）。然後才判打中：兩個身體都走完這一幀
     了，範圍是對著畫面上的位置判的。 */
  monsterStep(monster, dt, player);
  const reach = REACHES[combo.phase];
  if (reach && !combo.hit && reach(player, monster)) {
    knock(monster, player.x, player.z, player.aimX, player.aimZ, KNOCK_SCALE[combo.phase]);
    combo.hit = true;
  }
  /* 碰到玩家，玩家就死，雙方回到站位。被擊退、還沒落地的怪物不算；第三段
     起跳之後、落地之前的玩家也不算。 */
  if (bites(player, monster) && !invulnerable(combo)) {
    deaths++;
    resetStance();
    hud.flash('被咬到了');
  }

  // 動物
  zoo.root.position.set(player.x, player.y, player.z);
  zoo.setFacing(Math.atan2(player.aimX, player.aimZ));
  const viewYaw = Math.atan2(camera.position.x - player.x, camera.position.z - player.z);
  zoo.update(dt, {
    speed: Math.hypot(player.vx, player.vz), grounded: player.grounded, vy: player.vy, viewYaw,
  });
  beast.root.position.set(monster.x, monster.y, monster.z);
  beast.setFacing(Math.atan2(monster.aimX, monster.aimZ));
  beast.update(dt, {
    speed: Math.hypot(monster.vx, monster.vz), grounded: monster.grounded, vy: monster.vy,
    viewYaw: Math.atan2(camera.position.x - monster.x, camera.position.z - monster.z),
  });

  // 攻擊範圍的高亮：跟著玩家的腳與面向走。
  {
    const yaw = Math.atan2(player.aimX, player.aimZ);
    const lit = (phase) => (combo.phase === phase ? combo.t : Infinity);
    showFx(fxSlash, lit('slash'), SWING, player.x, player.y, player.z, yaw);
    if (combo.tip) {
      const fr = fanFrame(player, combo.tip);
      showFx(fxFan, lit('rise'), SWING, player.x, player.y, player.z, Math.atan2(fr.dirX, fr.dirZ), fr.a0);
    }
    showFx(fxRing, lit('slam'), SWING, player.x, player.y, player.z, yaw);
    // 提示圈不淡：亮著就是「現在按」。
    showFx(fxCue, cueing(combo) ? 0 : Infinity, 1, player.x, 0, player.z, 0);
  }

  // 相機
  {
    const rig = updateCam(cam, dt, player, ARENA, COLS);
    camera.position.set(rig.pos[0], rig.pos[1], rig.pos[2]);
    camera.lookAt(rig.look[0], rig.look[1], rig.look[2]);
  }

  renderer.render(scene, camera);
  pad.draw();

  fpsAcc += dt; fpsN++; hudAcc += dt;
  let line = null;
  if (hudAcc > 0.25) {
    line = `${Math.round(fpsN / fpsAcc)} fps ・ 被咬 ${deaths} 次 ・ 打中 ${monster.hits} 下 ・ `
      + `${PHASE_NAME[combo.phase]}${invulnerable(combo) ? '（無敵）' : ''} ・ `
      + `x ${player.x.toFixed(1)} y ${player.y.toFixed(1)} z ${player.z.toFixed(1)}`;
    fpsAcc = 0; fpsN = 0; hudAcc = 0;
  }
  hud.tick(dt, line);
  requestAnimationFrame(frame);
}

function safeArea() {
  const cs = getComputedStyle(document.documentElement);
  const px = (n) => parseFloat(cs.getPropertyValue(n)) || 0;
  return { l: px('--sa-l'), r: px('--sa-r'), t: px('--sa-t'), b: px('--sa-b') };
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = renderer.getPixelRatio();
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  pad.layout(w, h, dpr, safeArea());
  const st = document.documentElement.style;
  st.setProperty('--rail', `${pad.rail}px`);
  st.setProperty('--barT', `${pad.barT}px`);
  st.setProperty('--barB', `${pad.barB}px`);
  st.setProperty('--ctrl', `${pad.ctrlTop}px`);
  document.body.classList.toggle('pad-land', !pad.portrait);
  document.body.classList.toggle('pad-port', pad.portrait);
  hud.fit(pad.portrait ? 999 : pad.rail);
  zoo.setInkPx(2.0, h * dpr);
  beast.setInkPx(2.0, h * dpr);
}
addEventListener('resize', resize);
resize();

document.getElementById('boot').remove();
resetStance();
requestAnimationFrame(frame);

// 給主控台一個把手，方便手動看東西。
window.combatArea = { scene, camera, renderer, zoo, player, monster, beast, combo, cam, pad, hud, resetStance };
