/* ── test/src/light/air.js ─────────────────────────────────────────
   空氣：地面低霧，與假光柱（柱裡飄著的灰塵）

   `?air=0` 整支關掉：著色器一行不接、場景一個物件不加。

   ── 低霧 ────────────────────────────────────────────────────────
   只在低、封閉的房間裡：墓室、水窖，王座廳淡淡一層。霧貼著地，從地面到
   腳踝與膝蓋之間（`top`），所以它接在地形五階調的 post 上，用片段的世界
   高度（vLightP.y）算。

   濃淡不是「這一點離地多高」——那樣整片地板是同一個濃度，看起來只是地板
   換了一個顏色。量的是**視線在霧層裡走了多長**：從鏡頭到這一點的那條線，
   落在 y < top 那一段的長度（直線，所以就是全長 × 霧層佔的那一段高度比）。
   腳邊的地板因此是清的、遠處的地板一層一層糊掉，柱腳與牆根一圈霧——那正
   是地面霧該有的樣子，而且每個片段只多一個除法、一個 exp。

   著色器是所有地形共用的一份，所以霧是逐區塊的 uniform：換區塊時一秒內
   漸變過去（多半剛好落在穿過感測區那一下黑幕裡）。濃淡切成三階，交界只
   比 fwidth 寬一點——這一頁的光是分階的，霧也分階，但霧是空氣，邊可以軟
   一點。three 自己的場景霧接在更後面（fog_fragment），兩者是相乘的關係，
   不打架：這一層只管牆內那幾公尺的事。

   狗與怪物走的是自己的著色器（critter.js），不吃這層霧——腳踝高的霧蓋不
   住牠們多少，而為了這點去改另一支著色器不划算。

   ── 光柱 ────────────────────────────────────────────────────────
   有天的地方（中庭、城牆步道、沒了屋頂的王座廳）放幾根斜的光柱，方向就
   是主光（palette.js 的 KEY_DIR），所以它跟石頭上的明暗是同一盞光打的。

   每一根是一段開口的圓筒，加色混合、不寫深度、雙面。圓筒的兩面疊起來
   中間厚、邊上薄，再乘上「這個面多正對鏡頭」，輪廓就淡掉了，讀起來是一
   柱體積而不是一根管子。沿長度的淡入淡出是頂點透明度（跟 veil.js 一樣，
   載入時烘好）：下端在落地之前就淡到零，所以圓筒插進地板的那一圈切口
   看不到。鏡頭走進光柱裡時近的那幾面也淡掉，免得整個畫面被染一次。

   一個區塊一個 mesh：黑牆不寫深度（見 stage.js 的 hazeMesh），加色的東西
   畫在它後面就會透過來，所以不在這個區塊的光柱直接不畫。灰塵同理，一個
   區塊一個 Points，飄動全在頂點著色器裡（一個時間 uniform），每幀 CPU 端
   只寫幾個數字。

   戰鬥那一頁只有一個場地、封頂 8 公尺，是室內的競技場——不放。
   ------------------------------------------------------------------ */

import * as THREE from '../../vendor/three.module.js';
import { KEY_DIR } from '../palette.js';

const ON = (() => {
  try { return new URLSearchParams(globalThis.location?.search || '').get('air') !== '0'; } catch { return true; }
})();

/* ── 低霧 ──────────────────────────────────────────────────────── */

/**
 * 每個區塊的霧：top 霧層多高（公尺）、k 最濃的時候蓋掉幾成、d 每公尺多濃、
 * color 霧色（sRGB）。不在表上的區塊沒有霧。
 *
 * 墓室與水窖偏冷、偏灰，比地板亮一點——地下室的霧是被燭火與水面照到的
 * 濕氣，不是煙。王座廳只是一層薄的暖灰，讓中殿遠端的地板退下去。
 */
const FOG = {
  crypt: { top: 1.0, k: 0.45, d: 0.30, color: 0x95a2b2 },
  cistern: { top: 0.8, k: 0.42, d: 0.30, color: 0x8fa8a2 },
  throne: { top: 0.5, k: 0.35, d: 0.22, color: 0xd6c8ac },
};
/** 換區塊時霧漸變多久（秒）。 */
const FOG_FADE = 1.0;

const U_FOG_C = { value: new THREE.Color(0, 0, 0) };
/** x：濃淡上限（0 = 沒霧），y：霧層頂，z：每公尺多濃。 */
const U_FOG = { value: new THREE.Vector3(0, 1, 0.3) };

/* 三階。a 是「視線在霧裡走過的那段」換成的濃度（0～1）；切在 1/6、1/2、
   5/6，所以每一階代表的是它那一段的中間值。交界寬度 = fwidth × 1.5 再加
   一點底：比五階調的 BAND_SOFT 軟，霧不該有刀切的邊，但還讀得出是三塊。 */
const FOG_POST = `
  {
    float cpAt = uCpAir.y;
    float cpAy = vLightP.y;
    float cpAc = max(cameraPosition.y - cpAy, 0.05);
    float cpAl = length(cameraPosition - vLightP) * clamp((cpAt - cpAy) / cpAc, 0.0, 1.0);
    float cpAa = 1.0 - exp(-cpAl * uCpAir.z);
    float cpAw = fwidth(cpAa) * 1.5 + 0.03;
    float cpAq = (smoothstep(0.167 - cpAw, 0.167 + cpAw, cpAa)
      + smoothstep(0.5 - cpAw, 0.5 + cpAw, cpAa)
      + smoothstep(0.833 - cpAw, 0.833 + cpAw, cpAa)) / 3.0;
    diffuseColor.rgb = mix(diffuseColor.rgb, uCpAirC, cpAq * uCpAir.x);
  }
`;

/** 接進地形五階調著色器的那一段（見 ../light.js）。 */
export const shade = ON ? {
  uniforms: { uCpAirC: U_FOG_C, uCpAir: U_FOG },
  decl: 'uniform vec3 uCpAirC;\nuniform vec3 uCpAir;\n',
  pre: '',
  post: FOG_POST,
} : null;

/* ── 光柱 ──────────────────────────────────────────────────────── */

/**
 * 每個區塊的光柱：[x, z, 半徑, 頂高]。x、z 是落地點，相對於**場地的中心**
 * （方的取兩邊的中點，圓的取圓心）——不是區塊的原點，這樣這一支不必去讀
 * blocks.js。頂高是光柱的上端離地多高，上端沿著主光方向往 −x、+z 退
 * （每公尺高退 0.64、0.50），所以頂高也決定了它從哪裡進來。
 *
 *   中庭    落在中央那片空地上，從西南角的拱廊與南牆上方斜進來。
 *   王座廳  沒了屋頂的中殿：三根落在穹稜之間（王座廳的場地中心在區塊
 *           的 z = 2，所以這裡的 z 比區塊座標少 2）。
 *   城牆步道 從幕牆上方越過垛口，落在牆內兵營那一側（−z）。上端停在
 *           z ≈ −1，正好在走道上方：從牆頂看是從頭上斜下去的光。
 *
 * 全部避開出生點正前方幾公尺——出生時鏡頭在人後面七公尺，光柱擋在臉前
 * 面就只剩一片亮。
 */
const SHAFTS = {
  courtyard: [[-2.5, -5.0, 1.0, 10.5], [3.2, -1.2, 0.8, 10.5], [5.8, -7.4, 1.2, 10.0]],
  throne: [[-1.6, -7.0, 0.9, 11.5], [1.4, -0.6, 1.1, 11.5], [-0.6, 6.4, 0.8, 9.0]],
  wallwalk: [[-5.5, -8.0, 1.2, 12.0], [2.6, -10.5, 0.9, 12.0], [9.0, -6.5, 1.0, 11.0]],
};
/** 光柱的顏色（sRGB）與強度。顏色就是主光的色（palette.js 的 KEY_TINT）。 */
const SHAFT_TINT = 0xffeed1;
const SHAFT_K = 0.32;
/** 圓筒切幾面、沿長度的幾圈：[位置（0 = 落地、1 = 上端）, 透明度]。 */
const SEG = 14;
const RINGS = [[0, 0], [0.16, 0.8], [0.42, 1], [0.78, 0.65], [1, 0]];
/** 每根光柱幾顆灰塵。 */
const MOTES = 36;

const SHAFT_VERT = `
attribute float aA;
varying float vA;
varying vec3 vN;
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vA = aA;
  vN = normal;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
/* 邊的淡出用 |N·V| 的平方：一次方的話輪廓那一圈還是看得到一條亮邊。 */
const SHAFT_FRAG = `
uniform vec3 uColor;
uniform float uK;
varying float vA;
varying vec3 vN;
varying vec3 vW;
#include <fog_pars_fragment>
void main() {
  vec3 v = cameraPosition - vW;
  float dist = length(v);
  float e = abs(dot(normalize(vN), v / dist));
  float a = vA * e * e * smoothstep(1.5, 5.0, dist) * uK;
#ifdef USE_FOG
  #ifdef FOG_EXP2
  a *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
  a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#endif
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

/* 灰塵：每一顆沿著自己那根光柱的軸慢慢上下飄（速度可正可負），再加一點
   橫向的晃。走到兩端就淡出、從另一端淡入（fract 繞回去那一下看不到）。
   點的大小照距離縮（跟透視一樣），所以遠的是一粒、近的是一顆。 */
const MOTE_VERT = `
uniform float uT;
uniform float uH;
uniform vec3 uUp;
attribute vec4 aM;   // 相位、光柱長、速度（公尺／秒）、晃的相位
varying float vA;
#include <fog_pars_vertex>
void main() {
  float u = fract(aM.x + uT * aM.z / aM.y);
  vec3 p = position + uUp * (u * aM.y)
    + vec3(sin(uT * 0.37 + aM.w), sin(uT * 0.23 + aM.w * 1.7) * 0.5, cos(uT * 0.29 + aM.w * 1.3)) * 0.18;
  vec4 mvPosition = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float z = max(-mvPosition.z, 0.1);
  gl_PointSize = clamp(0.045 * projectionMatrix[1][1] * uH / z, 1.0, 7.0);
  vA = sin(3.14159 * u) * smoothstep(1.2, 3.0, z);
  #include <fog_vertex>
}
`;
const MOTE_FRAG = `
uniform vec3 uColor;
uniform float uK;
varying float vA;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  float a = vA * uK;
#ifdef USE_FOG
  #ifdef FOG_EXP2
  a *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
  a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#endif
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

/** 場地的中心（SHAFTS 的座標是相對於它的）。 */
const centreOf = (a) => (a.shape === 'circle' ? [a.x, a.z] : [(a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2]);

/** 一個區塊的光柱：所有圓筒合成一份幾何，加上灰塵的點。 */
function buildShafts(list, [cx, cz], up, rnd) {
  const side = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0)).normalize();
  const fwd = new THREE.Vector3().crossVectors(side, up).normalize();
  const pos = [], nrm = [], alpha = [], idx = [];
  const mp = [], mm = [];
  for (const [x, z, r, h] of list) {
    const len = h / up.y;
    const base = new THREE.Vector3(cx + x, 0, cz + z);
    const v0 = pos.length / 3;
    for (const [t, a] of RINGS) {
      const c = base.clone().addScaledVector(up, t * len);
      for (let i = 0; i <= SEG; i++) {
        const th = (i / SEG) * Math.PI * 2;
        const n = side.clone().multiplyScalar(Math.cos(th)).addScaledVector(fwd, Math.sin(th));
        pos.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
        nrm.push(n.x, n.y, n.z);
        alpha.push(a);
      }
    }
    for (let k = 0; k < RINGS.length - 1; k++) {
      for (let i = 0; i < SEG; i++) {
        const p0 = v0 + k * (SEG + 1) + i, p1 = p0 + SEG + 1;
        idx.push(p0, p0 + 1, p1 + 1, p0, p1 + 1, p1);
      }
    }
    /* 灰塵撒在圓筒裡面（半徑的七成以內，取平方根才不會擠在軸上）。 */
    for (let i = 0; i < MOTES; i++) {
      const th = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * r * 0.7;
      const p = base.clone().addScaledVector(side, Math.cos(th) * rr).addScaledVector(fwd, Math.sin(th) * rr);
      mp.push(p.x, p.y, p.z);
      mm.push(rnd(), len, (rnd() < 0.5 ? -1 : 1) * (0.08 + rnd() * 0.12), rnd() * 6.28);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aA', new THREE.Float32BufferAttribute(alpha, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
  pg.setAttribute('aM', new THREE.Float32BufferAttribute(mm, 4));
  /* 點會沿著軸飄出原本的位置，包圍球照圓筒的算，不然它會在還看得到的時候被剔掉。 */
  pg.boundingSphere = g.boundingSphere.clone();
  return { g, pg };
}

/** 一個小的固定亂數（灰塵的位置每次載入都一樣）。 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {object} ctx 見 ../light.js */
export function setup(ctx) {
  if (!ON) return null;
  const { scene, renderer, arenas } = ctx;

  /* ── 光柱與灰塵：一個區塊一組 ── */
  const up = KEY_DIR.clone();
  const tint = new THREE.Color(SHAFT_TINT);
  const fogU = THREE.UniformsLib.fog;
  const U_T = { value: 0 }, U_H = { value: 270 };
  const sets = {};
  let seed = 0x41a7;
  for (const a of arenas) {
    const list = SHAFTS[a.id];
    if (!list) continue;
    const { g, pg } = buildShafts(list, centreOf(a), up, rng(seed++));
    const uK = { value: 0 };
    const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([fogU, { uColor: { value: tint } }]),
      vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: true,
    }));
    mesh.material.uniforms.uK = uK;
    const dots = new THREE.Points(pg, new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([fogU, { uColor: { value: tint } }]),
      vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    }));
    Object.assign(dots.material.uniforms, { uK: { value: 0 }, uT: U_T, uH: U_H, uUp: { value: up } });
    mesh.visible = dots.visible = false;
    scene.add(mesh, dots);
    sets[a.id] = { mesh, dots, uK, uD: dots.material.uniforms.uK, k: 0 };
  }

  /* ── 霧的漸變：從換區塊那一刻的值走到新區塊的值，FOG_FADE 秒 ── */
  const cur = { r: 0, g: 0, b: 0, k: 0, top: 1, d: 0.3 };
  const from = { ...cur }, to = { ...cur };
  let t = 1, block = undefined;
  const tmp = new THREE.Color();
  const size = new THREE.Vector2();

  return {
    update(f) {
      if (f.block !== block) {
        block = f.block;
        Object.assign(from, cur);
        const F = FOG[block];
        if (F) {
          tmp.set(F.color);
          Object.assign(to, { r: tmp.r, g: tmp.g, b: tmp.b, k: F.k, top: F.top, d: F.d });
        } else {
          Object.assign(to, { r: cur.r, g: cur.g, b: cur.b, k: 0, top: cur.top, d: cur.d });
        }
        // 從沒霧淡入：顏色與高度直接用新的，只有濃淡在走。
        if (from.k < 1e-3) Object.assign(from, { r: to.r, g: to.g, b: to.b, top: to.top, d: to.d });
        t = 0;
      }
      if (t < 1) {
        t = Math.min(1, t + f.dt / FOG_FADE);
        const s = t * t * (3 - 2 * t);
        for (const key in cur) cur[key] = from[key] + (to[key] - from[key]) * s;
        U_FOG_C.value.setRGB(cur.r, cur.g, cur.b);
        U_FOG.value.set(cur.k, cur.top, cur.d);
      }

      /* 光柱：在這個區塊的淡入，其他的淡出；淡到零就不畫。 */
      const step = f.dt / FOG_FADE;
      for (const id in sets) {
        const S = sets[id];
        S.k = id === block ? Math.min(1, S.k + step) : Math.max(0, S.k - step);
        S.uK.value = S.k * SHAFT_K;
        S.uD.value = S.k * 0.8;
        S.mesh.visible = S.dots.visible = S.k > 0;
      }
      U_T.value = f.now / 1000;
      renderer.getDrawingBufferSize(size);
      U_H.value = size.y / 2;
    },
  };
}
