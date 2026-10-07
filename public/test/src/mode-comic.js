/* ── test/src/mode-comic.js ──────────────────────────────────────────
   /test/?mode=comic：漫畫的攝影棚。照 shots.js 一格一格把角色擺好、拍下來，背景透明，
   出成書頁上那一格的圖（tools/make-comic.mjs 開無頭瀏覽器來這裡拿圖、存檔）。

   角色是遊戲那幾隻本人（critter.js 的 Critter：同一份 cat.bin、同一副骨架、同一個三階
   著色、同一條墨線），不是另外畫的——漫畫裡的主角跟遊戲裡的主角是同一隻。姿勢是
   moveOverlay 那幾個欄位（跟出招用的同一套），倒下是 death.js 那一種繞著身體側緣轉。

   ── 漫畫質感：一道後製 ────────────────────────────────────────
   三階的平塗與墨線本來就是 2D 的光影；後製再在暗的地方疊網點（45° 的圓點網，越暗點越大，
   點是那一塊自己的顏色壓暗——全彩，不是黑白網點）。先畫進一張離屏的圖，再整張過一次網點
   畫到畫布上；透明的地方留透明。

   ── 投影的深度圖 ───────────────────────────────────────────────
   毛皮與王冠的著色器宣告了接收投影的 sampler2DShadow（light/shadow.js）。沒有綁一張設了
   比較模式的深度圖，ANGLE 會整個 draw 不畫——畫面是一片墨色（戰鬥場的地面當初就是這樣
   不見的）。這裡沒有東西投影，照戰鬥場那樣讓 shadow.js 綁一張清成最遠的 1×1。

   打開來看：畫面是紙色，上面是那一格拍出來的樣子；← → 換一格。
   給工具用的把手是 window.comic：
     ids             每一格的 id
     render(id)      擺好、拍下來，回傳 PNG 的 data URL
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { loadZoo, Critter, LIGHT_DIR } from './critter.js';
import { Crown } from './crown.js';
import { INK, KEY_POS, U_KEYDIR } from './palette.js';
import * as shadowLight from './light/shadow.js';
import { SHOTS } from './shots.js';

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
  actors[who] = { c, crown, wrap, shadow, height: r.height };
}

const UP = new THREE.Vector3(0, 1, 0);
const _side = new THREE.Vector3(), _axis = new THREE.Vector3();

/** 擺好一隻：站哪、面朝哪、什麼姿勢、倒了幾度。姿勢跑幾十幀讓呼吸與尾巴的彈簧穩下來。 */
function pose(a, spec, cam) {
  const { c, crown, wrap, shadow } = a;
  const [x, z] = spec.at;
  c._yaw = c._yawGoal = spec.yaw;
  const viewYaw = Math.atan2(cam.pos[0] - x, cam.pos[2] - z);
  for (let i = 0; i < 45; i++) c.update(1 / 60, { speed: 0, grounded: true, vy: 0, viewYaw, move: spec.move });
  if (crown) crown.update();
  // 往牠自己的 +X 側倒：支點在那一側的身體外緣（大約半個身寬）。
  const tip = spec.tip || 0, half = 0.28 * a.height;
  _side.set(Math.cos(spec.yaw), 0, -Math.sin(spec.yaw));
  _axis.crossVectors(UP, _side).normalize();
  wrap.quaternion.setFromAxisAngle(_axis, tip);
  wrap.position.set(x + half * _side.x * (1 - Math.cos(tip)), half * Math.sin(tip), z + half * _side.z * (1 - Math.cos(tip)));
  shadow.position.set(x + half * _side.x * Math.sin(tip) * 0.6, 0.002, z + half * _side.z * Math.sin(tip) * 0.6);
  shadow.rotation.z = -spec.yaw;
}

/** 拍第 id 格：回傳 PNG 的 data URL。 */
function render(id) {
  const shot = SHOTS.find((s) => s.id === id);
  if (!shot) throw new Error(`沒有這一格：${id}`);
  const [w, h] = shot.size;
  renderer.setSize(w, h, false);
  camera.fov = shot.cam.fov;
  camera.aspect = w / h;
  camera.position.set(...shot.cam.pos);
  camera.lookAt(...shot.cam.look);
  camera.updateProjectionMatrix();
  // 主光從哪裡來：這一格自己的（世界方向，指向光），沒給就是遊戲那一盞。毛皮與王冠各讀一份。
  const key = new THREE.Vector3(...(shot.light || KEY_POS)).normalize();
  LIGHT_DIR.value.copy(key);
  U_KEYDIR.value.copy(key);
  for (const a of Object.values(actors)) { a.wrap.visible = false; a.shadow.visible = false; }
  for (const spec of shot.cast) {
    const a = actors[spec.who];
    a.wrap.visible = true;
    a.shadow.visible = true;
    a.c.setInkPx(shot.ink, h);
    pose(a, spec, shot.cam);
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
  return canvas.toDataURL('image/png');
}

/* ── 打開來看 ─────────────────────────────────────────────────── */
const label = document.createElement('div');
label.id = 'shot-label';
document.body.append(label);
let at = 0;
function show(i) {
  at = (i + SHOTS.length) % SHOTS.length;
  render(SHOTS[at].id);
  label.textContent = `${SHOTS[at].id}　（← → 換一格）`;
}
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') show(at + 1);
  if (e.key === 'ArrowLeft') show(at - 1);
});

document.getElementById('boot').remove();
show(0);

window.comic = { ids: SHOTS.map((s) => s.id), render };
