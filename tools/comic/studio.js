/* ── tools/comic/studio.js ───────────────────────────────────────────
   漫畫的攝影棚（studio.html）。照 shots.js 一格一格把角色擺好、拍下來，背景透明，出成書頁上
   那一格的圖（make-comic.mjs 開無頭瀏覽器來這裡拿圖、存檔）。

   這一頁不在網站上：它是畫漫畫的工具，跟著 tools/ 走、不部署。make-comic.mjs 起的伺服器把
   public/ 與這個資料夾（在 /studio/ 底下）一起供出來，所以角色、著色、王冠這些直接 import
   遊戲本身的那幾支（/test/src/…），不是抄一份。

   角色是遊戲那幾隻本人（critter.js 的 Critter：同一份 cat.bin、同一副骨架、同一個三階
   著色、同一條墨線），不是另外畫的——漫畫裡的主角跟遊戲裡的主角是同一隻。姿勢是
   moveOverlay 那幾個欄位（跟出招用的同一套），倒下是 death.js 那一種繞著身體側緣轉。

   ── 漫畫質感：一道後製 ────────────────────────────────────────
   三階的平塗與墨線本來就是 2D 的光影；後製再在暗的地方疊網點（45° 的圓點網，越暗點越大，
   點是那一塊自己的顏色壓暗——全彩，不是黑白網點）。先畫進一張離屏的圖，再整張過一次網點
   畫到畫布上；透明的地方留透明。

   ── 表情：畫在圖上 ────────────────────────────────────────────
   模型的眼睛演不了戲，漫畫的表情靠眼睛與眉毛。有指定表情（face）的那一隻，拍之前把兩隻
   眼睛的骨頭縮成零（模型那兩片藏起來），從眼睛骨頭投影出每一隻眼睛在畫面上的位置、大小、
   頭頂朝哪、鼻樑在哪一側，拍完之後用 2D 照 faces.js 畫上去——在網點之後畫，線是乾淨的。
   遠的那一隻照模型自己的遠眼收合（critter.js）縮小：模型那一片縮到幾成，畫上去的就縮到幾成，
   四分之三側的遠眼才不會原尺寸壓在吻部上；收到幾乎沒有就不畫。

   ── 剪影的道具 ────────────────────────────────────────────────
   背景與道具是素色的剪影：一個顏色、不分階、沒有墨線（現在只有王座）。

   ── 投影的深度圖 ───────────────────────────────────────────────
   毛皮與王冠的著色器宣告了接收投影的 sampler2DShadow（light/shadow.js）。沒有綁一張設了
   比較模式的深度圖，ANGLE 會整個 draw 不畫——畫面是一片墨色（戰鬥場的地面當初就是這樣
   不見的）。這裡沒有東西投影，照戰鬥場那樣讓 shadow.js 綁一張清成最遠的 1×1。

   打開來看：畫面是紙色，上面是那一格拍出來的樣子；← → 換一格。
   給工具用的把手是 window.comic：
     ids             每一格的 id
     render(id)      擺好、拍下來，回傳 PNG 的 data URL
   ------------------------------------------------------------------ */

import * as THREE from '/test/vendor/three.module.js';
import { loadZoo, Critter, LIGHT_DIR } from '/test/src/critter.js';
import { Crown } from '/test/src/crown.js';
import { Blade } from '/test/src/blade.js';
import { INK, KEY_POS, U_KEYDIR } from '/test/src/palette.js';
import * as shadowLight from '/test/src/light/shadow.js';
import { Driver, Sway } from '/src/cat/pose.js';
import { SHOTS } from './shots.js';
import { drawFace } from './faces.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
shadowLight.setup({ scene, renderer, camera, ruins: null, cols: [], arenas: [] });

/* ── 網點 ────────────────────────────────────────────────────────
   一格網點寬 size[1] / HALFTONE.cells 像素；亮度（感知的，sRGB）在 lo 以下點最大、hi 以上沒有點。
   點的顏色是底色乘 HALFTONE.ink。離屏那一張存的是預乘過 alpha 的顏色（清成透明再畫上去），
   這裡先除回來再算亮度。 */
const HALFTONE = { cells: 120, lo: 0.06, hi: 0.5, ink: 0.45 };
const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
const screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: target.texture }, uCell: { value: 8 } },
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
uniform sampler2D tSrc;
uniform float uCell;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tSrc, vUv);
  if (c.a < 0.003) discard;
  c.rgb /= c.a;
  float lum = dot(pow(max(c.rgb, 0.0), vec3(1.0 / 2.2)), vec3(0.299, 0.587, 0.114));
  float t = smoothstep(${HALFTONE.hi.toFixed(2)}, ${HALFTONE.lo.toFixed(2)}, lum);
  const float A = 0.7853982;
  vec2 q = mat2(cos(A), -sin(A), sin(A), cos(A)) * gl_FragCoord.xy / uCell;
  float d = length(fract(q) - 0.5);
  float r = 0.53 * sqrt(t);
  float e = fwidth(d);
  float dotIn = (1.0 - smoothstep(r - e, r + e, d)) * step(0.02, t);
  c.rgb = mix(c.rgb, c.rgb * ${HALFTONE.ink.toFixed(2)}, dotIn);
  gl_FragColor = c;
  #include <colorspace_fragment>
}`,
  transparent: true, depthTest: false, depthWrite: false,
}));
const screenScene = new THREE.Scene();
screenScene.add(screen);
const screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/* ── 角色 ────────────────────────────────────────────────────────
   主角：遊戲預設那一隻（立耳犬、黃、戴漁夫帽）。國王：活著的時候——垂耳犬、灰、王冠、
   1.4 倍高（怪物的國王是同一隻，只是穿幽靈那一件、半透明，monster.js 的 LOOKS.king）。 */
const zoo = await loadZoo({ look: 'dog-prick/yellow', height: 1.0 });
const ROLES = {
  hero: { model: 'dog-prick', skin: 'yellow', height: 1.0, hat: true },
  king: { model: 'dog-drop', skin: 'grey', height: 1.4, hat: false, crown: true },
};
/** 每一種角色一隻（一格裡同一種角色只會出現一次）。 */
const actors = {};
for (const [who, r] of Object.entries(ROLES)) {
  const c = new Critter(zoo.critters.get(r.model).data, r.model, { height: r.height, skin: r.skin });
  c.setCoat(r.skin);
  c.setHat(r.hat);
  const crown = r.crown ? new Crown() : null;
  if (crown) crown.follow(c);
  // 倒下轉的是外面這一層（death.js 轉 Zoo 的 root 也是一樣的道理：朝向在裡面那一層）。
  const wrap = new THREE.Group();
  wrap.add(c.root);
  // 腳下一塊墨色的影子：沒有地面的時候，它是唯一告訴人「牠站在地上」的東西。
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.42 * r.height, 40),
    new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1, 1.6, 1);
  scene.add(wrap, shadow);
  actors[who] = { c, crown, wrap, shadow, height: r.height, blades: {} };
}

/** 這一隻嘴裡咬著哪一把（blade.js 的 SWORDS：knife、knight、king），null 是空手。第一次用到才做。 */
function arm(a, kind) {
  for (const b of Object.values(a.blades)) b.node.visible = false;
  if (!kind) return null;
  const b = a.blades[kind] ??= new Blade(kind);
  b.follow(a.c);
  b.node.visible = true;
  return b;
}

/* ── 剪影的道具 ──────────────────────────────────────────────────
   王座：座面、椅背、扶手、椅背頂上兩顆圓頭，一個顏色。尺寸是 scale = 1 的時候（公尺）；座面頂在
   THRONE_SEAT × scale。 */
const THRONE_SEAT = 0.5;
function makeThrone(color) {
  const mat = new THREE.MeshBasicMaterial({ color });
  const g = new THREE.Group();
  const box = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  box(1.15, THRONE_SEAT, 0.95, 0, THRONE_SEAT / 2, 0);            // 座
  box(1.15, 1.75, 0.18, 0, 1.75 / 2, -0.48);                       // 椅背
  for (const s of [-1, 1]) {
    box(0.14, 0.32, 0.9, s * 0.58, THRONE_SEAT + 0.16, 0.02);     // 扶手
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), mat);
    knob.position.set(s * 0.5, 1.8, -0.48);
    g.add(knob);
  }
  return g;
}
const PROPS = { throne: makeThrone(0x7a6650) };
for (const p of Object.values(PROPS)) scene.add(p);

const UP = new THREE.Vector3(0, 1, 0);
const _side = new THREE.Vector3(), _axis = new THREE.Vector3();
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Vector3(), _f = new THREE.Vector3();

/** 骨頭 b 的局部座標 (x, y, z) → 畫布像素 [x, y]。 */
function toScreen(c, b, x, y, z, w, h, out) {
  _m.fromArray(c.rig.matrices, b * 16);
  out.set(x, y, z).applyMatrix4(_m).applyMatrix4(c.mesh.matrixWorld).project(camera);
  return [(out.x + 1) / 2 * w, (1 - out.y) / 2 * h];
}

/** 遠眼收到原本的幾成以下就不畫了（只剩一點，畫出來是一顆浮著的墨點）。 */
const EYE_GONE = 0.15;

/**
 * 藏起模型的兩隻眼睛，回傳看得到的那幾隻在畫面上的錨點（faces.js 的格式）。要在姿勢擺好、
 * 世界矩陣更新之後叫。每一隻帶著模型那一片縮到幾成（s，遠眼收合）；r 是沒縮的原尺寸，
 * 縮多少由 drawFace 照 s 乘上去（最細的線寬限制要算在原尺寸上，遠眼才縮得下去）。
 */
function eyeAnchors(c, w, h) {
  const eyes = [c._eyeMinusX, c._eyePlusX];
  const s = eyes.map((b) => c.rig.scale[b * 3] / c.rig.rest.scale[b * 3]);
  const shown = s.map((v) => v > EYE_GONE);
  const at = eyes.map((b) => {
    const o = toScreen(c, b, 0, 0, 0.05, w, h, _p);
    const top = toScreen(c, b, 0, 0.21, 0.05, w, h, _q);
    const front = toScreen(c, b, 0, 0, 1.0, w, h, _f);
    return { o, top, front };
  });
  for (const b of eyes) for (let k = 0; k < 3; k++) c.rig.scale[b * 3 + k] = 0;
  c.rig.update();
  const out = [];
  at.forEach(({ o, top, front }, i) => {
    if (!shown[i]) return;
    const r = Math.hypot(top[0] - o[0], top[1] - o[1]) / s[i];
    const up = Math.atan2(top[1] - o[1], top[0] - o[0]);
    // 鼻樑在哪一側：兩隻都看得到就是往另一隻；只看得到一隻就是往眼睛的正前方（側面時那是吻部）。
    const other = at[1 - i].o;
    const [dx, dy] = shown[1 - i] ? [other[0] - o[0], other[1] - o[1]] : [front[0] - o[0], front[1] - o[1]];
    // 眼睛自己的 +x 在畫面上是 up 轉 +90°（canvas 的 y 往下，所以是順時針）。
    const side = dx * Math.cos(up + Math.PI / 2) + dy * Math.sin(up + Math.PI / 2);
    out.push({ x: o[0], y: o[1], r, s: s[i], up, inward: side >= 0 ? 1 : -1, i });
  });
  return out;
}

/** 一隻的臉在哪（世界座標）：兩隻眼睛骨頭的中點。 */
function faceAt(c, out) {
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const [bone, v] of [[c._eyeMinusX, a], [c._eyePlusX, b]]) {
    _m.fromArray(c.rig.matrices, bone * 16);
    v.set(0, 0, 0.05).applyMatrix4(_m).applyMatrix4(c.mesh.matrixWorld);
  }
  return out.addVectors(a, b).multiplyScalar(0.5);
}

/**
 * 擺鏡頭。兩種寫法：
 *   { pos, look, fov }                       世界座標
 *   { focus, yaw, pitch, dist, fov, frame }  對準 focus 那一隻的臉：從臉往 yaw（世界方位，0 = +Z 那一側）、
 *                                            pitch（仰角，負的是從下往上拍）退 dist 公尺看著臉；frame [fx, fy]
 *                                            是臉落在畫面上的哪裡（從正中間算，畫面寬高的幾分之幾，+y 往下）
 */
function aim(cam, w, h) {
  camera.clearViewOffset();
  if (cam.focus) {
    const f = faceAt(actors[cam.focus].c, new THREE.Vector3());
    const cp = Math.cos(cam.pitch || 0);
    camera.position.set(
      f.x + cam.dist * cp * Math.sin(cam.yaw), f.y + cam.dist * Math.sin(cam.pitch || 0), f.z + cam.dist * cp * Math.cos(cam.yaw),
    );
    camera.lookAt(f);
    const [fx, fy] = cam.frame || [0, 0];
    if (fx || fy) camera.setViewOffset(w, h, -fx * w, -fy * h, w, h);
  } else {
    camera.position.set(...cam.pos);
    camera.lookAt(...cam.look);
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/** 鏡頭大概在哪個方位（擺姿勢的時候要知道：頭會稍微轉向鏡頭）。 */
const camYawFrom = (cam, x, z) => (cam.focus ? cam.yaw : Math.atan2(cam.pos[0] - x, cam.pos[2] - z));

/**
 * 一隻角色的動態狀態歸零成剛建好的樣子（critter.js 的 Critter 建構子裡那幾個）：呼吸與步態的
 * 驅動、尾巴的彈簧、空中姿勢的權重、出招的累積量。同一隻角色在每一格之間共用，不歸零的話
 * 上一格的狀態會帶進這一格——同一筆設定單獨拍跟接在別格後面拍，會是兩張不一樣的圖。
 */
function fresh(c) {
  c.drv = new Driver();
  c.sway = new Sway();
  c._vySmooth = c._airW = c._riseW = c._dip = c._dipV = c._lastVy = 0;
  c._wasGrounded = true;
  c._mvYaw = c._mvYawPrev = c._mvTail = c._mvPitch = 0;
}

/** 擺好一隻：站哪、面朝哪、什麼姿勢、倒了幾度。姿勢跑幾十幀讓呼吸與尾巴的彈簧穩下來。 */
function pose(a, spec, cam) {
  const { c, crown, wrap, shadow } = a;
  fresh(c);
  const [x, z] = spec.at;
  const y0 = spec.y || 0;
  c._yaw = c._yawGoal = spec.yaw;
  const viewYaw = camYawFrom(cam, x, z);
  for (let i = 0; i < 45; i++) c.update(1 / 60, { speed: 0, grounded: true, vy: 0, viewYaw, move: spec.move });
  if (crown) crown.update();
  arm(a, spec.blade)?.update();
  // 往牠自己的 +X 側倒：支點在那一側的身體外緣（大約半個身寬）。
  const tip = spec.tip || 0, half = 0.28 * a.height;
  _side.set(Math.cos(spec.yaw), 0, -Math.sin(spec.yaw));
  _axis.crossVectors(UP, _side).normalize();
  wrap.quaternion.setFromAxisAngle(_axis, tip);
  wrap.position.set(x + half * _side.x * (1 - Math.cos(tip)), y0 + half * Math.sin(tip), z + half * _side.z * (1 - Math.cos(tip)));
  shadow.position.set(x + half * _side.x * Math.sin(tip) * 0.6, y0 + 0.002, z + half * _side.z * Math.sin(tip) * 0.6);
  shadow.visible = spec.shadow !== false;
  shadow.rotation.z = -spec.yaw;
}

/** 拍好的那一張（網點之後）再畫上表情：一張 2D 畫布。 */
const sheet = document.createElement('canvas');
const sheetG = sheet.getContext('2d');

/** 拍第 id 格：回傳 PNG 的 data URL。 */
function render(id) {
  const shot = SHOTS.find((s) => s.id === id);
  if (!shot) throw new Error(`沒有這一格：${id}`);
  const [w, h] = shot.size;
  renderer.setSize(w, h, false);
  camera.fov = shot.cam.fov;
  camera.aspect = w / h;
  // 主光從哪裡來：這一格自己的（世界方向，指向光），沒給就是遊戲那一盞。毛皮與王冠各讀一份。
  const key = new THREE.Vector3(...(shot.light || KEY_POS)).normalize();
  LIGHT_DIR.value.copy(key);
  U_KEYDIR.value.copy(key);
  for (const a of Object.values(actors)) { a.wrap.visible = false; a.shadow.visible = false; }
  for (const p of Object.values(PROPS)) p.visible = false;
  for (const spec of shot.props || []) {
    const p = PROPS[spec.shape];
    p.visible = true;
    p.position.set(spec.at[0], 0, spec.at[1]);
    p.rotation.y = spec.yaw || 0;
    p.scale.setScalar(spec.scale || 1);
  }
  const faces = [];
  for (const spec of shot.cast) {
    const a = actors[spec.who];
    a.wrap.visible = true;
    a.c.setInkPx(shot.ink, h);
    pose(a, spec, shot.cam);
  }
  scene.updateMatrixWorld(true);
  aim(shot.cam, w, h);
  for (const spec of shot.cast) {
    if (spec.face) faces.push([spec.face, eyeAnchors(actors[spec.who].c, w, h), spec.eyes]);
  }
  target.setSize(w, h);
  screen.material.uniforms.uCell.value = h / HALFTONE.cells;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(screenScene, screenCam);
  sheet.width = w;
  sheet.height = h;
  sheetG.clearRect(0, 0, w, h);
  sheetG.drawImage(canvas, 0, 0);
  for (const [face, anchors, eyes] of faces) drawFace(sheetG, face, anchors, shot.ink, eyes);
  return sheet.toDataURL('image/png');
}

/* ── 打開來看 ─────────────────────────────────────────────────── */
const label = document.createElement('div');
label.id = 'shot-label';
const shown = document.createElement('img');
shown.id = 'shot';
document.body.append(shown, label);
let at = 0;
function show(i) {
  at = (i + SHOTS.length) % SHOTS.length;
  shown.src = render(SHOTS[at].id);
  label.textContent = `${SHOTS[at].id}　（← → 換一格）`;
}
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') show(at + 1);
  if (e.key === 'ArrowLeft') show(at - 1);
});

document.getElementById('boot')?.remove();
show(0);

window.comic = { ids: SHOTS.map((s) => s.id), render };
