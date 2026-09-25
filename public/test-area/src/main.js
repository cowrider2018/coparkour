/* ── test-area/src/main.js ───────────────────────────────────────────
   /test-area/ 這一頁的組裝與操作。

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
import { C, toonVC, toon, glow, inkLine } from './palette.js';
import { SURF, surfaceTextures } from './surface.js';
import { buildRuins, BLOCKS } from './blocks.js';
import { loadZoo } from './critter.js';
import { Pad } from './pad.js';
import { Hud } from './hud.js';
import { facet } from './geom.js';
import { PHYS, solveXZ, supportInfo, steer, slideDrift, slideAccel, arenaGap, portalAt } from './walk.js';
import { CAM, makeCam, snapCam, updateCam } from './camera.js';
import { buildVeil } from './veil.js';
import { lookInfo } from '../../src/cat/looks.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa28a6d, 42, 165);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 420);

/* ── 沒有天空 ────────────────────────────────────────────────────
   四個場地都被黑牆封了頂（見 veil.js），所以天空一片都看不到——這一頁
   以前有一顆從裡面看的漸層球，現在拿掉了：畫一個永遠看不到的東西不如
   不畫。清除色是黑的，所以萬一哪裡有縫，露出來的也是同一個黑。

   之後要做天井房（不封頂）的話，那顆球在 git 裡（`git log -S sky`）。
   ------------------------------------------------------------------ */

/* ── 沒有燈 ──────────────────────────────────────────────────────
   場景裡一顆 three 的燈都沒有：石頭的五階調與狗的三階調都是材質自己
   算的（palette.js 的 banded、critter.js 的 FUR_FRAG），兩邊讀的是同一
   個方向 palette.js 的 KEY_POS。加一盞 three 的燈在這裡不會亮任何東西，
   只會讓人以為光是它給的。
   ------------------------------------------------------------------ */

/* ── 表面紋路開不開 ──────────────────────────────────────────────
   `?surf=0` 關掉石紋與木紋（貼圖不算、著色器不接），其他一模一樣——
   同一台手機上開關各看一次 fps，就是紋路的成本。烘在頂點色裡的那一層
   （逐塊深淺、牆根）不受影響：那一層在載入時就算完了，每幀不花任何東西。 */
const SURF_ON = new URLSearchParams(location.search).get('surf') !== '0';
if (SURF_ON) {
  /* 各向異性過濾：地板是斜著看的，沒有它的話幾公尺外的石板紋路就糊成一片。
     開到 4 就夠——再高，手機上多花的填色率換不到看得出來的差別。 */
  const an = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  for (const t of surfaceTextures()) t.anisotropy = an;
}

/* 地面。石板鋪面比它高 0.06，所以不會打架。 */
const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), toon(0x6a5844, SURF_ON ? SURF.dirt : false));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.06;
scene.add(ground);

/* ── 廢墟 ────────────────────────────────────────────────────── */
const ruins = buildRuins();
const stoneMat = toonVC({ surf: SURF_ON }), inkMat = inkLine();
scene.add(new THREE.Mesh(ruins.geometry, stoneMat), new THREE.LineSegments(ruins.ink, inkMat));
const COLS = ruins.colliders;

/* ── 門 ──────────────────────────────────────────────────────────
   每一組門的狀態（組名 → 開著嗎）是執行時的，一開始照 blocks.js 的
   `doors`。兩種狀態的門扇都砌好了，各自一個 mesh，換狀態只換哪一個看得到；
   感測區認不認得這一組門也看這一份（walk.js 的 portalAt）。 */
const doors = { ...ruins.doors };
const doorMeshes = ruins.pieces.map((q) => {
  const g = new THREE.Group();
  if (q.geometry.attributes.position.count) g.add(new THREE.Mesh(q.geometry, stoneMat));
  if (q.ink.attributes.position.count) g.add(new THREE.LineSegments(q.ink, inkMat));
  // 開著的門洞裡那幾層黑霧：跟黑牆同一種材質，所以門洞的盡頭跟黑牆是同一個黑。
  if (q.haze.alpha.length) g.add(hazeMesh(q.haze));
  scene.add(g);
  return { node: g, door: q.door, open: q.open };
});
/* ── 路標 ────────────────────────────────────────────────────────
   懸浮在門口的一行字（blocks.js 的 `sign`），一張永遠朝著鏡頭的字卡。屬於
   一組門：那一組門開著才看得到——沒有門扇的門就靠它說「這裡走得過去」。
   字是金色（跟面板的 accent2 同一個）描一圈深褐，不吃霧：黑牆前面的拱洞
   是全場最暗的地方，路標要在那裡讀得出來。 */
const SIGN_H = 0.55;                 // 字卡高幾公尺（字高約六成）
function signSprite(text) {
  const px = 72, pad = px * 0.5;
  const font = `600 ${px}px system-ui, "Noto Sans TC", sans-serif`;
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width + pad * 2);
  c.height = Math.round(px * 1.6);
  g = c.getContext('2d');            // 改了尺寸，畫布的狀態全部重設
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = px * 0.2;
  g.strokeStyle = '#1e1810';
  g.strokeText(text, c.width / 2, c.height / 2);
  g.fillStyle = '#f2c14e';
  g.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sp.scale.set(SIGN_H * (c.width / c.height), SIGN_H, 1);
  /* 排在所有半透明的東西之後畫。黑牆與黑霧是同一個 mesh、原點在世界的原點，
     three 照原點的遠近排半透明物件，於是它常常排在路標後面畫——路標不寫深度，
     後畫的那一片黑就整個蓋上來，只剩被鐵閘柵條擋住的那幾條縫露得出字。 */
  sp.renderOrder = 1;
  return sp;
}
const signs = ruins.signs.map((s) => {
  const node = signSprite(s.text);
  node.position.set(s.x, s.y, s.z);
  scene.add(node);
  return { node, door: s.door, y: s.y, phase: s.x * 0.37 + s.z * 0.23 };
});

function setDoor(group, open) {
  doors[group] = open;
  for (const m of doorMeshes) if (m.door === group) m.node.visible = m.open === open;
  for (const s of signs) if (s.door === group) s.node.visible = open;
}
for (const g of Object.keys(doors)) setDoor(g, doors[g]);

/* ── 黑牆 ────────────────────────────────────────────────────────
   形狀、尺寸、高度與黑霧的層次全部在 veil.js（那一支只吐頂點與透明度，
   而且它算得對不對 node 驗得出來——三角形的繞向錯了，單面材質會把整片
   剔掉，畫面上是「黑牆沒出現」，跟「還沒做」長得一模一樣）。

   這裡只負責把那份資料變成一個 mesh：一顆材質、一個 draw。
   ------------------------------------------------------------------ */
/** 黑牆與黑霧的 mesh：veil.js 吐的那一份，或門洞裡的那幾層（同一種資料）。 */
function hazeMesh(v) {
  /* 純黑，不是調色盤的 C.fog（#1e1810）——牆要黑，而 #1e1810 在暖色的
     天光下看起來是深褐色的一塊布。顏色在這裡而不在 veil.js，因為 sRGB
     到線性的轉換是 three 的事。 */
  const c = new THREE.Color(0x000000);
  const col = new Float32Array(v.alpha.length * 4);
  for (let i = 0; i < v.alpha.length; i++) {
    col[i * 4] = c.r; col[i * 4 + 1] = c.g; col[i * 4 + 2] = c.b;
    col[i * 4 + 3] = v.alpha[i];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v.pos, 3));
  // 四個分量：透明度靠頂點色帶著走，所以整圈黑牆加黑霧是一個 draw。
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.computeBoundingSphere();
  /* 單面，法線朝內。這不是省一半的填色率而已——雙面的話，玩家走進霧殼
     與牆之間那一公尺時，那層霧會跑到鏡頭前面，整個畫面被染暗一次。 */
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, side: THREE.FrontSide,
    fog: false, depthWrite: false,
  }));
}
scene.add(hazeMesh(buildVeil(ruins.arenas)));

/** 站在哪個場地裡。取「離邊界最裡面」的那一個——四個場地互不重疊。 */
function arenaAt(x, z) {
  let best = ruins.arenas[0], bg = -Infinity;
  for (const a of ruins.arenas) {
    const g = arenaGap(a, x, z);
    if (g > bg) { bg = g; best = a; }
  }
  return best;
}

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
  /* 腳底下那個面站不站得住，由 walk.js 的 supportInfo 給：null = 站得住，
     'slide' = 可操作的緩滑，'fall' = 失去操作的滑落。欄位名字跟著它，
     所以 slideDrift／slideAccel 直接吃 player，不必抄一份。 */
  slip: null, sin: 0, dx: 0, dz: 0,
  /* 最後一次操控的方向。移動與朝向都讀它：移動是「沿著它的那一份速度」
     （walk.js 的 steer），朝向是「轉到這裡為止」。放開手之後它不會被
     清掉——那正是「停下來還會轉完最後那一下」的全部機制。
     初值 +Z，因為模型的靜止朝向就是 +Z。 */
  aimX: 0, aimZ: 1,
};

/* 碰撞的規則在 walk.js——那一支 tools/verify-test-area.mjs 也在用，
   於是「中心夠空曠」這條設計規則可以離線踩過一遍來驗，而不是靠看。 */

/* ── 相機 ────────────────────────────────────────────────────────
   規則在 camera.js（吊臂、dead zone、釘住樞紐），那一支 node 跑得動，
   所以「被牆逼到最近的時候角色會不會離開畫面中心」是驗得出來的，不是
   靠看。這裡只有玩家的輸入寫進 yaw／pitch／dist。 */
const cam = makeCam(0, 0);
const CAM_NEAR = CAM.near, CAM_FAR = CAM.far;

/** 正在轉視角的那幾根手指。兩根以上就是縮放。 */
const drag = new Map();

/** 把角色放到某個區塊的出生點。 */
function goto(id) {
  const s = ruins.spawns[id];
  if (!s) return;
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

/** O：這個區塊裡的每一組門一起開或關（試玩用；之後由別的東西來開）。 */
function toggleDoors() {
  const mine = Object.keys(doors).filter((g) => g.startsWith(`${player.block}.`));
  if (!mine.length) { hud.flash('這裡沒有門'); return; }
  const open = !doors[mine[0]];
  for (const g of mine) setDoor(g, open);
  hud.flash(open ? '門開了' : '門關了');
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
  if (k === 'o') toggleDoors();
  if (k >= '1' && k <= '9' && BLOCKS[+k - 1]) goto(BLOCKS[+k - 1].id);
  if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

/* ── 主迴圈 ──────────────────────────────────────────────────── */
const critterTris = zoo.active.data.header.groups.reduce((n, g) => n + g.count, 0) / 3;
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

  /* 站在不可踩的圓頂上（樹梢那種）：操作整個失效，只剩重力。判斷用
     的是**上一幀**踩到的那個面——這一幀踩到什麼要等垂直那一段算完才
     知道，而輸入得在那之前處理。差一幀，16 毫秒，手上感覺不到。 */
  const locked = player.grounded && player.slip === 'fall';
  if (locked) { ix = 0; iz = 0; mag = 0; }

  /* 相機站在玩家的 −(sin yaw, cos yaw) 方向上，所以「前」就是
     +(sin yaw, cos yaw)。「右」是 cross(前, 上)——在 Y 軸朝上的右手系裡
     那等於 (−cos yaw, +sin yaw)，不是 (+cos yaw, −sin yaw)。
     少了這兩個負號就是 A、D 互換：畫面上看起來像在鏡子裡走路。 */
  const fwdX = Math.sin(cam.yaw), fwdZ = Math.cos(cam.yaw);
  const rgtX = -fwdZ, rgtZ = fwdX;
  if (mag > 1e-4) {
    // 操控的方向當幀就是移動的方向。轉向沒有延遲，加速量照舊。
    player.aimX = (fwdX * iz + rgtX * ix) / mag;
    player.aimZ = (fwdZ * iz + rgtZ * ix) / mag;
  }

  if (locked) {
    /* 沿著面加速 g·sinθ。不走 accel／brake 那一段：煞車是 23，比滑落的
       加速度還大，兩個一起算的結果是站在上面紋風不動。 */
    const [ax, az] = slideAccel(player);
    player.vx += ax * dt;
    player.vz += az * dt;
  } else {
    [player.vx, player.vz] = steer(
      player.vx, player.vz, player.aimX, player.aimZ, speedFor(mag), dt,
    );
  }

  const jumped = pad.takeJump() || held(' ');
  if (jumped && player.grounded && !locked) {
    player.vy = PHYS.jump;
    player.grounded = false;
  }

  /* 緩滑（屋頂、斜坡、大石）。它是一個**終端速度**而不是一個加速度，
     所以加在位移上而不是加進速度裡：加進速度的話，在斜面上站著不動的
     每一幀都會再累積一次，一秒之後就不是緩滑而是摔下去了。走路、跳躍、
     撞牆全部照常——這就是跑酷遊戲抓著牆往下溜的那個狀態。 */
  const [driftX, driftZ] = player.grounded ? slideDrift(player) : [0, 0];

  /* 水平。撞到東西不必把速度清掉：速度永遠只沿著操控的方向，所以「沿著
     牆一直加速」不會發生（速率被 speedFor 封在 8 以內），而正面撞牆之後
     轉開，新方向上的投影本來就是 0——以前那兩行逐軸清零做的事，現在是
     steer 的投影在做。 */
  const mvx = player.vx + driftX, mvz = player.vz + driftZ;
  const [sx, sz] = solveXZ(COLS, player.x + mvx * dt, player.z + mvz * dt, player.y, doors);
  player.x = sx; player.z = sz;

  // 垂直
  const prevY = player.y;
  player.vy -= PHYS.gravity * dt;
  player.y += player.vy * dt;
  const sup = supportInfo(COLS, player.x, player.z, prevY);
  if (player.y <= sup.y && player.vy <= 0) {
    player.y = sup.y;
    player.vy = 0;
    player.grounded = true;
    /* 踩到的是什麼跟踩在多高是同一次搜尋的結果。分開問兩次的話，兩次
       之間隔著一個位移，而那正是「明明已經滑下來了卻還被鎖著」。 */
    player.slip = sup.slip;
    player.sin = sup.sin;
    player.dx = sup.dx;
    player.dz = sup.dz;
  } else {
    player.grounded = false;
    player.slip = null;                 // 在空中：控制權回來
  }

  /* 感測區（井底、沒入黑霧的路、開著的門）：走進去就被送到它的目的地。
     判斷在 walk.js，驗證器淹水的時候問的是同一支；門關著的那幾個不算。 */
  {
    const gate = portalAt(ruins.portals, player.x, player.y, player.z, doors);
    if (gate) warp(gate.dest);
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
  const realSpeed = Math.hypot(mvx, mvz);
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

  // 路標浮著：上下晃五公分，兩秒多一個來回，每一塊的相位不同。
  for (const sg of signs) sg.node.position.y = sg.y + Math.sin(now / 1000 * 2.6 + sg.phase) * 0.05;

  // 相機。規則在 camera.js，這裡只把算出來的兩個點交給 three。
  {
    const rig = updateCam(cam, dt, player, arenaAt(cam.px, cam.pz), COLS);
    camera.position.set(rig.pos[0], rig.pos[1], rig.pos[2]);
    camera.lookAt(rig.look[0], rig.look[1], rig.look[2]);
  }

  renderer.render(scene, camera);
  pad.draw();

  fpsAcc += dt; fpsN++; hudAcc += dt;
  let line = null;
  if (hudAcc > 0.25) {
    fpsShown = Math.round(fpsN / fpsAcc);
    fpsAcc = 0; fpsN = 0; hudAcc = 0;
    line = `${fpsShown} fps${SURF_ON ? '' : '（無紋路）'} ・ 關卡 ${(ruins.tris / 1000).toFixed(0)}k tri ・ `
      + `${(ruins.inkLines / 1000).toFixed(0)}k 墨線 ・ 動物 ${(critterTris / 1000).toFixed(0)}k ・ `
      + `x ${player.x.toFixed(1)} y ${player.y.toFixed(1)} z ${player.z.toFixed(1)}`
      + (player.slip ? `・${player.slip === 'fall' ? '滑落' : '緩滑'}` : '');
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

  /* 墨線的寬度是「畫面上幾個像素」，所以它得知道畫面多高。墨線是在
     y 正規化的螢幕座標裡推的（見 critter.js），那個空間橫跨畫面高
     是 2，所以一個像素是 2/height。 */
  zoo.setInkPx(2.0, h * dpr);
}
addEventListener('resize', resize);
resize();

document.getElementById('boot').remove();
goto('courtyard');
requestAnimationFrame(frame);

// 給主控台一個把手，方便手動看東西（這頁沒有存檔，改了重載就回原樣）。
window.testArea = { scene, camera, renderer, zoo, player, ruins, cam, pad, hud, goto, warp, setLook, doors, setDoor };
