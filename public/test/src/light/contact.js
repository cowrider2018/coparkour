/* ── test/src/light/contact.js ─────────────────────────────────────────
   腳下的接觸陰影：每個角色一片扁的墨色橢圓，離地越高越小越淡

   跑酷最難讀的一件事是「我現在離地多高、會落在哪」。投影（shadow.js）跟著
   主光斜斜地落，跳起來的時候影子跑到旁邊去，正好不是要讀的那一點。這一片
   是正下方的：貼在腳下那一層地板上，玩家與每一隻怪物各一片。

     · 墨色（palette.js 的 INK），硬邊，邊緣只用 fwidth 抹一個像素——跟五階調
       的交界同一種邊，不是一團軟的漸層。
     · 離地 h 公尺：長寬縮到 1 − SHRINK·u、濃度乘 (1 − u)²，u = h / FADE_H。
       跳躍頂點（1.38）還很清楚，FADE_H 公尺以上就沒了。
     · 地板高度問 walk.js 的 supportInfo——跟身體落地用的是同一支，所以影子落
       在哪，腳就落在哪。站在盒子或圓柱頂上的時候，影子裁在那一面的邊界裡
       （碰撞體的那個矩形或圓）：站在台子邊上，另一半不會懸在半空中。
     · 長軸朝著角色面向的方向（狗是長的）。大小照體型：怪物看 monster.js 的
       sizeOf（BOSS 兩倍、騎士 1.2 倍），玩家是 1。不是怪物的那幾隻（國王復活之後的人民與
       國王，f.crowd）自己帶著 size。

   怎麼畫：一個 InstancedMesh、固定 POOL 片，一個 draw call；每幀只改實例
   矩陣與兩個實例屬性，不配置任何東西。不寫深度、往鏡頭拉一點（polygonOffset）
   免得跟地面打架。renderOrder −1：排在所有半透明的東西前面畫——黑牆與黑霧
   （stage.js 的 hazeMesh）不寫深度，影子要是排在它後面畫，就會蓋到擋在前面
   的黑牆上。地上的預告（fx.js，2～4）與半透明的怪物（5）都在它之後，蓋得住它。

   `?contact=0` 整個不建。
   ------------------------------------------------------------------ */

import * as THREE from '../../vendor/three.module.js';
import { INK } from '../palette.js';
import { supportInfo } from '../walk.js';

/* 離線驗證（tools/verify-*.mjs）在 node 裡 import palette.js，連帶 import 到這裡，
   那邊沒有 location。 */
const ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('contact') !== '0';

/** 最多幾片：玩家一片，其餘給怪物（國王召喚滿場也不到這麼多）。 */
const POOL = 24;
/** 墨色的濃度（貼地的時候）。 */
const ALPHA = 0.4;
/** 體型 1 的那一片：半長（沿面向）、半寬，公尺。狗的身體，不含尾巴。 */
const HALF_L = 0.46, HALF_W = 0.3;
/** 離地這麼高就看不見了（公尺）。 */
const FADE_H = 6;
/** 到 FADE_H 的時候縮到原本的 1 − SHRINK。 */
const SHRINK = 0.6;
/** 往上抬這麼多，剩下的交給 polygonOffset。鋪面的石板頂比碰撞的地面（0）高一點，
    跟黑牆那圈地面漸層（veil.js 的 skirtY）同一個數字才蓋得住。 */
const LIFT = 0.03;
/** 裁切：沒有、矩形（minX, minZ, maxX, maxZ）、圓（x, z, r）。 */
const CLIP_NONE = 0, CLIP_BOX = 1, CLIP_DISC = 2;

/** 接進地形五階調著色器的那一段（見 ../light.js）：這一片是自己的網格，不接。 */
export const shade = null;

const VERT = /* glsl */ `
attribute vec2 aFade;         // x 濃度（0～1），y 裁切的種類
attribute vec4 aClip;
varying vec2 vQ;              // 橢圓裡的座標，邊緣是 |vQ| = 1
varying vec2 vW;              // 世界 xz，裁切用
varying vec2 vFade;
varying vec4 vClip;
#include <fog_pars_vertex>
void main() {
  vQ = uv * 2.0 - 1.0;
  vFade = aFade;
  vClip = aClip;
  vec4 w = instanceMatrix * vec4(position, 1.0);
  vW = w.xz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3 uInk;
uniform float uAlpha;
varying vec2 vQ;
varying vec2 vW;
varying vec2 vFade;
varying vec4 vClip;
#include <fog_pars_fragment>
void main() {
  // 橢圓的邊：一個像素寬的 fwidth，跟五階調的交界同一種硬邊。
  float r = length(vQ);
  float e = max(fwidth(r), 1e-4);
  float a = 1.0 - smoothstep(1.0 - e, 1.0, r);
  // 裁在腳下那一面裡（d < 0 是裡面），邊一樣只抹一個像素。
  if (vFade.y > 0.5) {
    float d;
    if (vFade.y < 1.5) {
      vec2 o = max(vClip.xy - vW, vW - vClip.zw);
      d = max(o.x, o.y);
    } else {
      d = length(vW - vClip.xy) - vClip.z;
    }
    float f = max(fwidth(d), 1e-4);
    a *= 1.0 - smoothstep(-f, 0.0, d);
  }
  a *= uAlpha * vFade.x;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uInk, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** @param {object} ctx 見 ../light.js */
export function setup(ctx) {
  if (!ON) return null;
  const { scene, cols } = ctx;

  const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);   // 朝上，±1
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uInk: { value: new THREE.Color(INK) }, uAlpha: { value: ALPHA } },
    ]),
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, fog: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, POOL);
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 2), 2);
  const clip = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 4), 4);
  fade.setUsage(THREE.DynamicDrawUsage);
  clip.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFade', fade);
  geo.setAttribute('aClip', clip);
  mesh.count = 0;
  mesh.frustumCulled = false;     // 實例散在整片場地上，包圍球算一次就過時了
  mesh.renderOrder = -1;          // 理由見檔頭
  scene.add(mesh);

  /* 體型在 monster.js（sizeOf）。不能在模組頂層 import 它：palette.js → light.js →
     這裡 → monster.js → critter.js → palette.js 繞一圈，critter.js 在頂層就讀
     palette.js 的 INK，那時它還沒跑完。setup 的時候模式早就把 monster.js 讀進來了，
     這裡只是從已經載好的那一份拿；拿到之前（頭一兩幀）一律當 1。等到第一次有怪物
     才去拿：地形模式沒有怪物，不必為了它多讀一串戰鬥的檔案。 */
  let sizeOf = null, asked = false;

  const M = mesh.instanceMatrix.array, F = fade.array, K = clip.array;

  /** 第 i 片放到角色 a 的腳下。回 false 是這一片不畫（太高）。 */
  function place(i, a, size) {
    const sup = supportInfo(cols, a.x, a.z, a.y);
    const h = Math.max(0, a.y - sup.y);
    const u = h / FADE_H;
    if (u >= 1) return false;
    const k = 1 - u;
    const s = size * (1 - SHRINK * u);

    // 面向：沒有（或還是 0）就朝 +z。
    let fx = a.aimX || 0, fz = a.aimZ || 0;
    const n = Math.hypot(fx, fz);
    if (n > 1e-6) { fx /= n; fz /= n; } else { fx = 0; fz = 1; }

    const on = sup.on;
    const y = sup.y + LIFT;

    // 實例矩陣（直行優先）：本地 x → 側面、本地 z → 面向，各乘半寬、半長。
    const sx = s * HALF_W, sz = s * HALF_L, o = i * 16;
    M[o] = fz * sx; M[o + 1] = 0; M[o + 2] = -fx * sx; M[o + 3] = 0;
    M[o + 4] = 0; M[o + 5] = 1; M[o + 6] = 0; M[o + 7] = 0;
    M[o + 8] = fx * sz; M[o + 9] = 0; M[o + 10] = fz * sz; M[o + 11] = 0;
    M[o + 12] = a.x; M[o + 13] = y; M[o + 14] = a.z; M[o + 15] = 1;

    F[i * 2] = k * k;
    const c = i * 4;
    if (!on) F[i * 2 + 1] = CLIP_NONE;
    else if (on.shape === 'circle') {
      F[i * 2 + 1] = CLIP_DISC;
      K[c] = on.x; K[c + 1] = on.z; K[c + 2] = on.r;
    } else {
      F[i * 2 + 1] = CLIP_BOX;
      K[c] = on.min[0]; K[c + 1] = on.min[2]; K[c + 2] = on.max[0]; K[c + 3] = on.max[2];
    }
    return true;
  }

  return {
    update(f) {
      let n = 0;
      if (f.player && place(n, f.player, 1)) n++;
      const foes = f.foes;
      if (foes.length && !asked) {
        asked = true;
        import('../monster.js').then((mod) => { sizeOf = mod.sizeOf; });
      }
      for (let j = 0; j < foes.length && n < POOL; j++) {
        const m = foes[j];
        if (place(n, m, (sizeOf && sizeOf(m.kind)) || 1)) n++;
      }
      for (let j = 0; j < f.crowd.length && n < POOL; j++) if (place(n, f.crowd[j], f.crowd[j].size || 1)) n++;
      mesh.count = n;
      if (!n) return;
      mesh.instanceMatrix.needsUpdate = true;
      fade.needsUpdate = true;
      clip.needsUpdate = true;
    },
  };
}
