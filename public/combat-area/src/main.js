/* ── combat-area/src/main.js ─────────────────────────────────────────
   /combat-area/ 這一頁的組裝與操作。

   試玩場（/test-area/）的 main.js 拿掉地形之後剩下的東西：一塊黑牆圍起來
   的空地、那隻動物、第三人稱鏡頭、手把。走路、跳、鏡頭、手把的規則都
   不在這裡，是直接 import 試玩場那幾支——這一頁只多了戰鬥（combat.js）。

   ── 場景一共幾個 draw call ───────────────────────────────────────
     地面      1
     黑牆      1（牆、頂、霧殼、牆腳漸層是同一個 mesh）
     動物      3（皮毛、臉、翻面的墨線外殼）
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
import { ARENA, COLS, SPAWN } from './combat.js';

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

const cam = makeCam(0, 0);

/** 回到站位：玩家在中線 2/3、面向中心，鏡頭在牠背後。 */
function resetStance() {
  const s = SPAWN.player;
  player.x = s.x; player.y = 0; player.z = s.z;
  player.vx = player.vy = player.vz = 0;
  player.grounded = true;
  player.aimX = Math.sin(s.yaw); player.aimZ = Math.cos(s.yaw);
  cam.yaw = s.yaw;
  snapCam(cam, player.x, player.z);
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

  const pressed = pad.takeJump() || jumpQueued;
  jumpQueued = false;
  if (pressed && player.grounded) {
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

  // 動物
  zoo.root.position.set(player.x, player.y, player.z);
  zoo.setFacing(Math.atan2(player.aimX, player.aimZ));
  const viewYaw = Math.atan2(camera.position.x - player.x, camera.position.z - player.z);
  zoo.update(dt, {
    speed: Math.hypot(player.vx, player.vz), grounded: player.grounded, vy: player.vy, viewYaw,
  });

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
    line = `${Math.round(fpsN / fpsAcc)} fps ・ x ${player.x.toFixed(1)} y ${player.y.toFixed(1)} z ${player.z.toFixed(1)}`;
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
}
addEventListener('resize', resize);
resize();

document.getElementById('boot').remove();
resetStance();
requestAnimationFrame(frame);

// 給主控台一個把手，方便手動看東西。
window.combatArea = { scene, camera, renderer, zoo, player, cam, pad, hud, resetStance };
