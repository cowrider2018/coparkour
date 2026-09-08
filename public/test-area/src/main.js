/* ── test-area/src/main.js ───────────────────────────────────────────
   /test-area/ 這一頁的組裝與操作。

   這頁只做兩件事：走路，以及把那隻狗拿起來看。沒有計分、沒有連線、
   沒有敵人、不寫 localStorage——它是一個試玩場，不是一個關卡。

   ── 場景一共幾個 draw call ───────────────────────────────────────
     地圖      2（合併後的砌體 + 合併後的墨線）
     地面      1
     天空      1
     火焰      每盆 1（十幾盆）
     狗        3（皮毛、臉、翻面的墨線外殼）——遊戲那隻本人，
               25,723 個頂點、69,300 個三角形，一份幾何三個 draw range。
               圓角方形是每幀在頂點著色器裡做的二次變形，見 gamedog.js
   靜態的東西之所以是兩個 draw，是因為它們真的不會動；會動的東西才各自
   一份。這個分界就是 blocks.js 為什麼不把火焰砌進緩衝區的原因。

   ── 相機 ────────────────────────────────────────────────────────
   第三人稱，用彈簧跟著狗。拖曳轉方向、滾輪拉遠近，而移動的方向是相機
   的方向——這是這類遊戲唯一不會讓人走錯邊的組合。觀賞模式（V）把相機
   收到 2.2 公尺、自己繞著狗轉，並且停掉輸入：那時候要看的是狗，不是路。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { C, toonVC, toon, glow, inkLine, lights, ramp } from './palette.js';
import { buildRuins, BLOCKS } from './blocks.js';
import { loadGameDog, COATS } from './gamedog.js';
import { facet } from './geom.js';
import { PHYS, solveXZ, supportAt } from './walk.js';

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
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(520, 520),
  toon(0x6a5844),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.06;
scene.add(ground);

/* ── 廢墟 ────────────────────────────────────────────────────── */
const ruins = buildRuins();
const ruinMesh = new THREE.Mesh(ruins.geometry, toonVC());
const ruinInk = new THREE.LineSegments(ruins.ink, inkLine());
scene.add(ruinMesh, ruinInk);
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

/* ── 狗 ──────────────────────────────────────────────────────────
   遊戲那隻本人：cat.bin 經過 buildDog（立耳）與 dress（漁夫帽），
   yellow 毛色。頂層 await——這一頁沒有牠就沒有東西可以試玩，所以沒有
   「先跑起來再說」這個選項。 */
const dog = await loadGameDog({ skin: 'yellow', ear: 'prick', height: 1.0 });
scene.add(dog.root);

const player = {
  x: ruins.spawns.courtyard[0], y: 0, z: ruins.spawns.courtyard[2],
  vx: 0, vy: 0, vz: 0, grounded: true, block: 'courtyard',
};

/** 把狗放到某個區塊的出生點。 */
function goto(id) {
  const s = ruins.spawns[id];
  if (!s) return;
  player.x = s[0]; player.y = s[1] + 0.2; player.z = s[2];
  player.vx = player.vy = player.vz = 0;
  player.block = id;
  cam.yaw = Math.PI;
  hud.flash(BLOCKS.find((b) => b.id === id).name);
}

/* 碰撞的規則在 walk.js——那一支 tools/verify-test-area.mjs 也在用，
   於是「中心夠空曠」這條設計規則可以離線踩過一遍來驗，而不是靠看。 */

/* ── 輸入 ────────────────────────────────────────────────────── */
const keys = new Set();
const held = (...names) => names.some((n) => keys.has(n));
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'h') { dog.setHat(!dog.hatOn); hud.flash(dog.hatOn ? '戴上漁夫帽' : '脫下漁夫帽'); }
  if (k === 'c') cycleCoat();
  if (k === 'v') setInspect(!inspect);
  if (k === 'b') {
    dog.setBend(!dog.bendOn);
    hud.flash(dog.bendOn ? '圓角方形：開（二次變形）' : '圓角方形：關（原始曲面網格）');
  }
  if (k === 'r') goto(player.block);
  if (k >= '1' && k <= '4') goto(BLOCKS[+k - 1].id);
  if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

/* 相機：拖曳轉、滾輪縮。dist 是彈簧的目標，不是相機的位置——
   撞到牆的時候相機會被拉近，但目標不動，所以離開牆它自己回去。 */
const cam = { yaw: Math.PI, pitch: 0.30, dist: 7.0, curDist: 7.0 };
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  cam.yaw -= (e.clientX - drag.x) * 0.006;
  cam.pitch = Math.max(-0.35, Math.min(1.15, cam.pitch + (e.clientY - drag.y) * 0.004));
  drag = { x: e.clientX, y: e.clientY };
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.dist = Math.max(1.6, Math.min(16, cam.dist + Math.sign(e.deltaY) * 0.6));
}, { passive: false });

/* 觸控搖桿：手機上沒有 WASD。左半邊按住當方向鍵，右半邊拖曳轉相機。 */
let stick = null;
canvas.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  if (t.clientX < window.innerWidth * 0.5) stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (!stick) return;
  for (const t of e.changedTouches) {
    if (t.identifier !== stick.id) continue;
    stick.dx = Math.max(-1, Math.min(1, (t.clientX - stick.ox) / 60));
    stick.dy = Math.max(-1, Math.min(1, (t.clientY - stick.oy) / 60));
  }
}, { passive: true });
const dropStick = (e) => {
  if (!stick) return;
  for (const t of e.changedTouches) if (t.identifier === stick.id) stick = null;
};
canvas.addEventListener('touchend', dropStick, { passive: true });
canvas.addEventListener('touchcancel', dropStick, { passive: true });

/* ── 觀賞模式 ────────────────────────────────────────────────────
   相機收到 2.2 公尺、自己繞著狗轉、輸入停掉。狗留在原地做牠的待機
   動作（呼吸、慢慢甩尾、偶爾抽一下耳朵）——那三件事是「牠是活的」的
   全部證據，站著不動的時候才看得到。 */
let inspect = false;
let inspectSpin = 0;
let savedDist = 7;
function setInspect(on) {
  inspect = on;
  if (on) { savedDist = cam.dist; cam.dist = 2.3; cam.pitch = 0.18; inspectSpin = cam.yaw; }
  else cam.dist = savedDist;
  document.body.classList.toggle('inspecting', on);
  hud.flash(on ? '觀賞模式：拖曳可轉，V 離開' : '試玩模式');
}

const COAT_IDS = dog.skins;
function cycleCoat() {
  const next = COAT_IDS[(COAT_IDS.indexOf(dog.coatId) + 1) % COAT_IDS.length];
  dog.setCoat(next);
  hud.flash(`毛色：${COATS[next].name}`);
  hud.paintCoat();
}

/* ── HUD ─────────────────────────────────────────────────────── */
const dogTris = dog.data.header.groups.reduce((n, g) => n + g.count, 0) / 3;
const hud = {
  where: document.getElementById('where'),
  stats: document.getElementById('stats'),
  toast: document.getElementById('toast'),
  coatRow: document.getElementById('coats'),
  _fade: 0,
  flash(msg) {
    this.toast.textContent = msg;
    this.toast.classList.add('on');
    this._fade = 1.8;
  },
  paintCoat() {
    for (const el of this.coatRow.children) {
      el.classList.toggle('on', el.dataset.coat === dog.coatId);
    }
  },
  tick(dt, fps, refresh) {
    if (this._fade > 0) {
      this._fade -= dt;
      if (this._fade <= 0) this.toast.classList.remove('on');
    }
    if (!refresh) return;
    const b = BLOCKS.find((x) => x.id === player.block);
    this.where.innerHTML = `<strong>${b.name}</strong><span>${b.hint}</span>`;
    this.stats.textContent =
      `${fps} fps ・ 關卡 ${(ruins.tris / 1000).toFixed(0)}k 三角形 ・ ${(ruins.inkLines / 1000).toFixed(0)}k 墨線 ・ `
      + `狗 ${(dogTris / 1000).toFixed(0)}k ・ ${COLS.length} 碰撞盒 ・ `
      + `x ${player.x.toFixed(1)} y ${player.y.toFixed(1)} z ${player.z.toFixed(1)}`;
  },
};

// 區塊按鈕與毛色按鈕。做成按鈕而不只是快捷鍵，是為了手機也點得到。
const blockRow = document.getElementById('blocks');
BLOCKS.forEach((b, i) => {
  const el = document.createElement('button');
  el.innerHTML = `<b>${i + 1}</b> ${b.name}`;
  el.onclick = () => { goto(b.id); canvas.focus(); };
  blockRow.appendChild(el);
});
/* 選色鈕上那一點顏色，直接從 cat.bin 讀：那隻狗身上最多的那個顏色就是
   牠的底色。寫死一組十六進位是另一個「遲早跟資產不一致」的地方。 */
function swatchOf(id) {
  const col = dog.data.colors.get(id);
  const tally = new Map();
  for (let v = 0; v < dog.data.header.vertexCount; v += 7) {
    const k = (col[v * 4] << 16) | (col[v * 4 + 1] << 8) | col[v * 4 + 2];
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  let best = 0, bestN = -1;
  for (const [k, n] of tally) if (n > bestN) { best = k; bestN = n; }
  return `#${best.toString(16).padStart(6, '0')}`;
}

COAT_IDS.forEach((id) => {
  const el = document.createElement('button');
  el.dataset.coat = id;
  el.textContent = COATS[id].name;
  el.style.setProperty('--sw', swatchOf(id));
  el.onclick = () => { dog.setCoat(id); hud.paintCoat(); };
  hud.coatRow.appendChild(el);
});
hud.paintCoat();
document.getElementById('btn-hat').onclick = () => { dog.setHat(!dog.hatOn); hud.flash(dog.hatOn ? '戴上漁夫帽' : '脫下漁夫帽'); };
document.getElementById('btn-look').onclick = () => setInspect(!inspect);
document.getElementById('btn-bend').onclick = () => {
  dog.setBend(!dog.bendOn);
  hud.flash(dog.bendOn ? '圓角方形：開（二次變形）' : '圓角方形：關（原始曲面網格）');
};

/* ── 主迴圈 ──────────────────────────────────────────────────── */
const _cv = new THREE.Vector3();
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsShown = 0, hudAcc = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  /* 移動方向是相機的方向。前後左右各投影到水平面上，再正規化——
     斜著按兩個鍵不會比直著按快，那個 bug 在這種相機下特別明顯。 */
  let ix = 0, iz = 0;
  if (!inspect) {
    if (held('w', 'arrowup')) iz += 1;
    if (held('s', 'arrowdown')) iz -= 1;
    if (held('a', 'arrowleft')) ix -= 1;
    if (held('d', 'arrowright')) ix += 1;
    if (stick) { ix += stick.dx; iz -= stick.dy; }
  }
  const mag = Math.hypot(ix, iz);
  if (mag > 1) { ix /= mag; iz /= mag; }

  /* 相機站在玩家的 −(sin yaw, cos yaw) 方向上，所以「前」就是
     +(sin yaw, cos yaw)。「右」是 cross(前, 上)——在 Y 軸朝上的右手系裡
     那等於 (−cos yaw, +sin yaw)，不是 (+cos yaw, −sin yaw)。
     少了這兩個負號就是 A、D 互換：畫面上看起來像在鏡子裡走路。 */
  const fwdX = Math.sin(cam.yaw), fwdZ = Math.cos(cam.yaw);
  const rgtX = -fwdZ, rgtZ = fwdX;
  const wantX = fwdX * iz + rgtX * ix;
  const wantZ = fwdZ * iz + rgtZ * ix;
  const top = held('shift') ? PHYS.run : PHYS.walk;
  const tgtX = wantX * top, tgtZ = wantZ * top;

  const rate = (mag > 0.01 ? PHYS.accel : PHYS.brake) * dt;
  player.vx += Math.max(-rate, Math.min(rate, tgtX - player.vx));
  player.vz += Math.max(-rate, Math.min(rate, tgtZ - player.vz));

  if (!inspect && held(' ') && player.grounded) {
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
  player.block = best;

  // 狗
  const speed = Math.hypot(player.vx, player.vz);
  dog.root.position.set(player.x, player.y, player.z);
  if (speed > 0.35) dog.setFacing(Math.atan2(player.vx, player.vz));
  dog.update(dt, { speed, grounded: player.grounded, vy: player.vy });

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

  // 相機
  if (inspect) {
    inspectSpin += dt * 0.35;
    if (!drag) cam.yaw = inspectSpin;
  }
  cam.curDist += (cam.dist - cam.curDist) * Math.min(1, dt * 6);
  const eyeH = inspect ? 0.55 : 0.95;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  _cv.set(
    player.x - Math.sin(cam.yaw) * cp * cam.curDist,
    player.y + eyeH + sp * cam.curDist,
    player.z - Math.cos(cam.yaw) * cp * cam.curDist,
  );
  // 相機不鑽到地底下。只擋地面：拿支撐面來擋的話，站在牆邊時相機會被
  // 牆頂頂上去，而那看起來像鏡頭自己跳了一下。
  camera.position.set(_cv.x, Math.max(_cv.y, 0.45), _cv.z);
  camera.lookAt(player.x, player.y + eyeH * (inspect ? 1.0 : 0.75), player.z);

  renderer.render(scene, camera);

  fpsAcc += dt; fpsN++; hudAcc += dt;
  let refresh = false;
  if (hudAcc > 0.25) {
    fpsShown = Math.round(fpsN / fpsAcc);
    fpsAcc = 0; fpsN = 0; hudAcc = 0;
    refresh = true;
  }
  hud.tick(dt, fpsShown, refresh);
  requestAnimationFrame(frame);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  /* 墨線的寬度是「畫面上幾個像素」，所以它得知道畫面多高。二次變形是
     在 y 正規化的螢幕座標裡做的（見 gamedog.js），那個空間橫跨畫面高
     是 2，所以一個像素是 2/height。 */
  dog.setInkPx(2.0, h * renderer.getPixelRatio());
}
addEventListener('resize', resize);
resize();

// 讓 ramp 這張 3 階梯度圖在第一幀之前就上傳，免得第一幀是平光的。
ramp();
document.getElementById('boot').remove();
goto('courtyard');
requestAnimationFrame(frame);

// 給主控台一個把手，方便手動看東西（這頁沒有存檔，改了重載就回原樣）。
window.testArea = { scene, camera, renderer, dog, player, ruins, cam, goto, setInspect };
