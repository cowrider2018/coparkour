/* ── test-area/src/main.js ───────────────────────────────────────────
   /test-area/ 這一頁的組裝與操作。

   這頁只做兩件事：走路，以及把那隻動物拿起來看。沒有計分、沒有連線、
   沒有敵人、不寫 localStorage——它是一個試玩場，不是一個關卡。

   ── 場景一共幾個 draw call ───────────────────────────────────────
     地圖      2（合併後的砌體 + 合併後的墨線）
     地面      1
     天空      1
     火焰      每盆 1（十幾盆）
     動物      3（皮毛、臉、翻面的墨線外殼）——遊戲那幾隻本人，一份幾何
               三個 draw range；圓角方形是每幀在頂點著色器裡做的二次
               變形，見 critter.js。沒被選到的那兩隻 visible = false。
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
import { C, toonVC, toon, glow, inkLine, lights, ramp } from './palette.js';
import { buildRuins, BLOCKS } from './blocks.js';
import { loadZoo } from './critter.js';
import { Pad } from './pad.js';
import { Hud } from './hud.js';
import { facet } from './geom.js';
import { PHYS, solveXZ, supportAt } from './walk.js';
import { lookInfo } from '../../src/cat/looks.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(C.fog);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa28a6d, 42, 165);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 420);

/* ── 天空 ────────────────────────────────────────────────────────
   一顆從裡面看的球，顏色靠頂點色由上往下漸層——不用著色器，也不用貼圖。
   下緣的顏色就是霧的顏色，所以遠處的廢墟是「淡進天空裡」而不是「淡進
   一片色塊裡」，那是這種遠景唯一要緊的事。 */
function sky() {
  const g = new THREE.SphereGeometry(320, 24, 16);
  const pos = g.attributes.position;
  const col = [];
  const top = new THREE.Color(0x2f3a54), hor = new THREE.Color(0xc9a173), low = new THREE.Color(0x5a4a3c);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 320;
    if (t >= 0) c.copy(hor).lerp(top, Math.pow(t, 0.55));
    else c.copy(hor).lerp(low, Math.min(1, -t * 2.2));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  return new THREE.Mesh(g, m);
}
scene.add(sky());

const { key, amb } = lights();
scene.add(key, amb);

/* 地面。石板鋪面比它高 0.06，所以不會打架。 */
const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), toon(0x6a5844));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.06;
scene.add(ground);

/* ── 廢墟 ────────────────────────────────────────────────────── */
const ruins = buildRuins();
scene.add(new THREE.Mesh(ruins.geometry, toonVC()), new THREE.LineSegments(ruins.ink, inkLine()));
const COLS = ruins.colliders;

/* 火焰。一份幾何、一顆材質，逐盆一個 mesh——它們要各自抖，所以不能合併。
   抖法是三個不成比例的正弦相加（3.1／5.7／11.3 Hz），沒有一個週期看得
   出來；火焰同時是唯一一個不吃霧的東西，遠處那幾點才亮得起來。 */
const flameGeo = facet(new THREE.ConeGeometry(0.3, 0.72, 7, 1));
const flameMat = glow(C.flame);
flameMat.fog = false;
const coreMat = glow(C.flameCore);
coreMat.fog = false;
const flames = ruins.flames.map((f) => {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(flameGeo, flameMat);
  const core = new THREE.Mesh(flameGeo, coreMat);
  core.scale.set(0.5, 0.62, 0.5);
  core.position.y = -0.06;
  g.add(outer, core);
  g.position.set(f.x, f.y + 0.32 * f.s, f.z);
  g.scale.setScalar(f.s);
  scene.add(g);
  return { node: g, outer, base: f.s, phase: Math.random() * 9 };
});

/* ── 動物 ────────────────────────────────────────────────────────
   遊戲那幾隻本人：一份 cat.bin，經過 species.js 生出貓與兩種狗，每一種
   都戴得上漁夫帽。頂層 await——這一頁沒有牠們就沒有東西可以試玩，所以
   沒有「先跑起來再說」這個選項。 */
const zoo = await loadZoo({ look: 'dog-prick/yellow', height: 1.0 });
scene.add(zoo.root);

const player = {
  x: ruins.spawns.courtyard[0], y: 0, z: ruins.spawns.courtyard[2],
  vx: 0, vy: 0, vz: 0, grounded: true, block: 'courtyard',
};

/* 碰撞的規則在 walk.js——那一支 tools/verify-test-area.mjs 也在用，
   於是「中心夠空曠」這條設計規則可以離線踩過一遍來驗，而不是靠看。 */

/* ── 相機的狀態 ──────────────────────────────────────────────────
   dist 是彈簧的目標、curDist 是它現在的位置，所以縮放是滑進去的而不是
   跳過去的。最近 1.2 公尺——那個距離下動物佔半個畫面高，臉上的每一塊
   都看得清楚，這就是「觀賞」。 */
const cam = { yaw: Math.PI, pitch: 0.30, dist: 7.0, curDist: 7.0 };
const CAM_NEAR = 1.2, CAM_FAR = 16;
/** 正在轉視角的那幾根手指。兩根以上就是縮放。 */
const drag = new Map();

/** 把角色放到某個區塊的出生點。 */
function goto(id) {
  const s = ruins.spawns[id];
  if (!s) return;
  player.x = s[0]; player.y = s[1] + 0.2; player.z = s[2];
  player.vx = player.vy = player.vz = 0;
  player.block = id;
  cam.yaw = Math.PI;
  hud.flash(BLOCKS.find((b) => b.id === id).name);
  hud.paint({ block: id });
}

/* ── 外觀 ────────────────────────────────────────────────────── */
function setLook(look) {
  if (!zoo.setLook(look)) return;
  hud.flash(lookInfo(look).name);
  hud.paint();
}
/** C：同一種動物換下一件毛色。X：換下一種動物，毛色留在同一欄。 */
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
/* ── HUD ─────────────────────────────────────────────────────── */
const hud = new Hud({
  zoo,
  blocks: BLOCKS,
  onLook: setLook,
  onBlock: goto,
  onHat: toggleHat,
});

/* ── 螢幕上的操作 ─────────────────────────────────────────────────
   pad.js 那一份，就是遊戲的手把：左搖桿、右跳躍。 */
const pad = new Pad(document.getElementById('pad'));

/* ── 指標路由 ────────────────────────────────────────────────────
   按下的那一刻決定這根手指屬於誰，之後就不換：搖桿、跳躍鈕，或是中間
   那片畫面（視角）。所以左手走、右手轉不會互搶，也不會有一次拖曳中途
   從轉視角變成走路。 */
const owners = new Map();
canvas.addEventListener('pointerdown', (e) => {
  const zone = pad.hit(e.clientX, e.clientY);
  owners.set(e.pointerId, zone || 'view');
  if (zone) pad.down(zone, e.pointerId, e.clientX, e.clientY);
  else drag.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { canvas.setPointerCapture(e.pointerId); } catch { /* 沒有就算了 */ }
});
/** 兩根手指的距離，用來縮放。null = 現在不是雙指。 */
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
    /* 雙指：只縮放，不轉。同時做兩件事的話，兩根手指必然有一點旋轉分量，
       畫面會一邊縮一邊歪。 */
    const before = pinch ?? pinchSpan();
    d.x = e.clientX; d.y = e.clientY;
    const after = pinchSpan();
    if (before && after) {
      cam.dist = Math.max(CAM_NEAR, Math.min(CAM_FAR, cam.dist * (before / after)));
    }
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
  cam.dist = Math.max(CAM_NEAR, Math.min(CAM_FAR, cam.dist + Math.sign(e.deltaY) * 0.6));
}, { passive: false });

/* ── 鍵盤 ────────────────────────────────────────────────────── */
const keys = new Set();
const held = (...names) => names.some((n) => keys.has(n));
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'h') toggleHat();
  if (k === 'c') cycleSkin(e.shiftKey ? -1 : 1);
  if (k === 'x') cycleModel(e.shiftKey ? -1 : 1);
  if (k === 'r') goto(player.block);
  if (k >= '1' && k <= '4') goto(BLOCKS[+k - 1].id);
  if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

/* ── 主迴圈 ──────────────────────────────────────────────────── */
const critterTris = zoo.active.data.header.groups.reduce((n, g) => n + g.count, 0) / 3;
const _cv = new THREE.Vector3();
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsShown = 0, hudAcc = 0;

/**
 * 軸的長度 → 想要的速度。
 *
 * 類比的，而且兩種輸入共用一條式子：搖桿推多少就走多快；鍵盤送進來的
 * 長度是「按著＝0.72、加上 ⇧＝1」，於是鍵盤的預設速度剛好落在
 * PHYS.walk 上，而推到底的搖桿與 ⇧ 一樣是 PHYS.run。
 */
function speedFor(mag) {
  if (mag <= 0) return 0;
  if (mag <= 0.72) return PHYS.walk * (mag / 0.72);
  return PHYS.walk + (PHYS.run - PHYS.walk) * ((mag - 0.72) / 0.28);
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  pad.update(dt);

  /* 一個軸，兩種來源。鍵盤先湊成一個向量再正規化——斜著按兩個鍵不會比
     直著按快 41%，那個 bug 在這種相機下特別明顯。 */
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
  // 搖桿：往畫面下方推＝往後走，所以 z 取負。
  if (pad.mag > 0) { ix += pad.axis.x; iz -= pad.axis.y; }
  let mag = Math.hypot(ix, iz);
  if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }

  /* 相機站在玩家的 −(sin yaw, cos yaw) 方向上，所以「前」就是
     +(sin yaw, cos yaw)。「右」是 cross(前, 上)——在 Y 軸朝上的右手系裡
     那等於 (−cos yaw, +sin yaw)，不是 (+cos yaw, −sin yaw)。
     少了這兩個負號就是 A、D 互換：畫面上看起來像在鏡子裡走路。 */
  const fwdX = Math.sin(cam.yaw), fwdZ = Math.cos(cam.yaw);
  const rgtX = -fwdZ, rgtZ = fwdX;
  const speed = speedFor(mag);
  const dirX = mag > 1e-4 ? (fwdX * iz + rgtX * ix) / mag : 0;
  const dirZ = mag > 1e-4 ? (fwdZ * iz + rgtZ * ix) / mag : 0;
  const tgtX = dirX * speed, tgtZ = dirZ * speed;

  const rate = (mag > 0.01 ? PHYS.accel : PHYS.brake) * dt;
  player.vx += Math.max(-rate, Math.min(rate, tgtX - player.vx));
  player.vz += Math.max(-rate, Math.min(rate, tgtZ - player.vz));

  const jumped = pad.takeJump() || held(' ');
  if (jumped && player.grounded) {
    player.vy = PHYS.jump;
    player.grounded = false;
  }

  // 水平：先解 x 再解 z，兩次都用同一支推出器（它自己會選軸）。
  const [sx, sz] = solveXZ(COLS, player.x + player.vx * dt, player.z + player.vz * dt, player.y);
  // 被推回來多少就把那個方向的速度吃掉，不然會沿著牆一直加速。
  if (Math.abs(sx - (player.x + player.vx * dt)) > 1e-4) player.vx = 0;
  if (Math.abs(sz - (player.z + player.vz * dt)) > 1e-4) player.vz = 0;
  player.x = sx; player.z = sz;

  // 垂直
  const prevY = player.y;
  player.vy -= PHYS.gravity * dt;
  player.y += player.vy * dt;
  const sup = supportAt(COLS, player.x, player.z, prevY);
  if (player.y <= sup && player.vy <= 0) {
    player.y = sup;
    player.vy = 0;
    player.grounded = true;
  } else {
    player.grounded = false;
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
  const realSpeed = Math.hypot(player.vx, player.vz);
  zoo.root.position.set(player.x, player.y, player.z);
  if (realSpeed > 0.35) zoo.setFacing(Math.atan2(player.vx, player.vz));
  zoo.update(dt, { speed: realSpeed, grounded: player.grounded, vy: player.vy });

  // 火焰
  for (const f of flames) {
    const t = now / 1000 + f.phase;
    const w = 1
      + Math.sin(t * 3.1) * 0.10
      + Math.sin(t * 5.7) * 0.06
      + Math.sin(t * 11.3) * 0.035;
    f.node.scale.set(f.base, f.base * w * 1.05, f.base);
    f.outer.rotation.y = t * 1.4;
    f.outer.position.y = (w - 1) * 0.2;
  }

  /* 相機。眼高跟著距離收：拉近看動物的時候鏡頭要降下來平視牠，
     不然近距離只會看到一顆帽子頂。 */
  cam.curDist += (cam.dist - cam.curDist) * Math.min(1, dt * 6);
  const near = 1 - Math.min(1, (cam.curDist - CAM_NEAR) / 3.5);
  const eyeH = 0.95 - 0.42 * near;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  _cv.set(
    player.x - Math.sin(cam.yaw) * cp * cam.curDist,
    player.y + eyeH + sp * cam.curDist,
    player.z - Math.cos(cam.yaw) * cp * cam.curDist,
  );
  // 相機不鑽到地底下。只擋地面：拿支撐面來擋的話，站在牆邊時相機會被
  // 牆頂頂上去，而那看起來像鏡頭自己跳了一下。
  camera.position.set(_cv.x, Math.max(_cv.y, 0.45), _cv.z);
  camera.lookAt(player.x, player.y + eyeH * (0.75 + 0.25 * near), player.z);

  renderer.render(scene, camera);
  pad.draw();

  fpsAcc += dt; fpsN++; hudAcc += dt;
  let line = null;
  if (hudAcc > 0.25) {
    fpsShown = Math.round(fpsN / fpsAcc);
    fpsAcc = 0; fpsN = 0; hudAcc = 0;
    line = `${fpsShown} fps ・ 關卡 ${(ruins.tris / 1000).toFixed(0)}k tri ・ `
      + `${(ruins.inkLines / 1000).toFixed(0)}k 墨線 ・ 動物 ${(critterTris / 1000).toFixed(0)}k ・ `
      + `x ${player.x.toFixed(1)} y ${player.y.toFixed(1)} z ${player.z.toFixed(1)}`;
  }
  hud.tick(dt, line);
  if (crossed) hud.paint({ block: player.block });
  requestAnimationFrame(frame);
}

/** 安全區。CSS 已經接成自訂屬性，這裡讀回來給 pad.js 擺元件。 */
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

  /* 操作列的幾何由 pad.js 算，算完寫回 CSS——DOM 的面板與畫布上的搖桿
     因此永遠對齊在同一條列裡，這是遊戲那邊的做法。 */
  pad.layout(w, h, dpr, safeArea());
  const st = document.documentElement.style;
  st.setProperty('--rail', `${pad.rail}px`);
  st.setProperty('--barT', `${pad.barT}px`);
  st.setProperty('--barB', `${pad.barB}px`);
  st.setProperty('--ctrl', `${pad.ctrlTop}px`);
  document.body.classList.toggle('pad-land', !pad.portrait);
  document.body.classList.toggle('pad-port', pad.portrait);
  /* 生物那張表跟著直欄寬度降級。直向沒有直欄，那時候面板是橫躺在上帶
     裡的，寬度有半個畫面，所以直接當成最寬的那一級。 */
  hud.fit(pad.portrait ? 999 : pad.rail);

  /* 墨線的寬度是「畫面上幾個像素」，所以它得知道畫面多高。二次變形是
     在 y 正規化的螢幕座標裡做的（見 critter.js），那個空間橫跨畫面高
     是 2，所以一個像素是 2/height。 */
  zoo.setInkPx(2.0, h * dpr);
}
addEventListener('resize', resize);
resize();

// 讓 ramp 這張 3 階梯度圖在第一幀之前就上傳，免得第一幀是平光的。
ramp();
document.getElementById('boot').remove();
goto('courtyard');
requestAnimationFrame(frame);

// 給主控台一個把手，方便手動看東西（這頁沒有存檔，改了重載就回原樣）。
window.testArea = { scene, camera, renderer, zoo, player, ruins, cam, pad, hud, goto, setLook };
