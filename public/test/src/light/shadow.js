/* ── test/src/light/shadow.js ─────────────────────────────────────────
   主光的投射陰影：被遮的片段落到最暗那一階

   從主光（palette.js 的 KEY_DIR）的方向拍一張深度圖，片段著色器拿自己
   的位置去比：被別的石頭擋住的，就把 cpD 壓到最後一道邊界（−0.06）以下。
   於是投影跟背光面是**同一塊**平色——卡通的規矩：陰影不是另一種暗，是
   「沒照到光」那一階本身，柱子投在地上的影子跟柱子背面接起來看不出縫。

   ── 為什麼只在換區塊的時候拍 ──────────────────────────────────────
   地形不會動（見 blocks.js：整片遺跡合併成一個 mesh），所以深度圖拍一次
   就一直對。正交相機只框玩家所在的那一個場地（`arenas` 裡 id 等於
   f.block 的那一格，從地面到封頂 `lid`），換了區塊才重拍；中間唯一會變
   的是門——開門關門換的是哪一個 mesh 看得到，所以每幀數一次「投影的
   mesh 裡有哪些看得到」，變了也重拍。這一數是幾十個布林，沒有配置。

   框是固定的，所以鏡頭怎麼轉，深度圖的格子都不動，影子邊緣不會爬。框的
   四邊仍然對齊到一格的整數倍——哪天改成跟著玩家走，就不會開始閃。

   ── 誰投影 ────────────────────────────────────────────────────────
   setup 那一刻場景裡、用分階材質（palette.js 的 banded）的不透明 mesh：
   合併後的砌體、門扇。不投影的：黑牆與黑霧（半透明）、墨線、火焰、路標、
   地面那一片（平的、在最底下，擋不到任何東西），以及之後才加進來的一切
   ——角色與他們身上的頭盔、刀、盾也用分階材質，但它們會動，拍進一張只
   在換區塊時重拍的圖裡就是一個留在原地的影子。角色腳下的那一塊暗是
   contact.js 的事。它們仍然**接收**投影（同一支著色器），走進拱門底下
   頭盔一樣會暗。

   ── 邊緣 ──────────────────────────────────────────────────────────
   硬體的比較取樣（sampler2DShadow + 線性過濾）一次就是 2×2 的 PCF，再錯開
   半格取四次，得到一個在影子邊緣上連續走的 0～1。然後在 0.5 那裡切一刀，
   寬度只留 fwidth 說得出的那麼多（跟 palette.js 的 BAND_SOFT 同一個想法）：
   近看邊緣是一條硬線，遠看是一個像素寬的反鋸齒，不會變成一圈漸層。

   偏移兩種都用：沿法線把取樣點推出去（越斜推越多，倒角石塊的斜面才不會
   長出一格一格的痘痕），再加一個常數的深度偏移。

   `?shadow=0` 關掉（著色器不接、不拍圖）；`?shadow=1024` 之類指定深度圖
   的邊長。預設桌機 2048、觸控裝置 1024。
   ------------------------------------------------------------------ */

import * as THREE from '../../vendor/three.module.js';
/* palette.js 反過來 import 這一頁（見 ../light.js），所以它的值只在 setup 之後讀。 */
import { U_KEYDIR } from '../palette.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('shadow') : null;
const ON = Q !== '0';

/** 投影的 mesh 掛在這一層，深度相機只看這一層。 */
const LAYER = 7;
/** 沿法線推出去幾格：正對光 MIN，越斜越多，躺平時 MIN + SLOPE。 */
const N_MIN = 0.6, N_SLOPE = 1.6;
/** 常數的深度偏移，幾格寬的深度。 */
const BIAS = 1.0;
/** 被遮住的片段 cpD 壓到多少：最後一道邊界（−0.06）再往下，連交界的 cpE 一起越過。 */
const DARK = -0.3;

/* 沒拍圖之前（或這一頁沒有東西投影），矩陣把每個點都送到 [0,1] 外面 = 全亮。 */
const OUTSIDE = new THREE.Matrix4().makeScale(0, 0, 0).setPosition(2, 2, 2);

const U = {
  cpShMap: { value: null },
  cpShMat: { value: OUTSIDE.clone() },
  /* x：一格在世界裡多寬（公尺）；y：一格在貼圖座標裡多寬；z：深度偏移（深度單位）。 */
  cpShK: { value: new THREE.Vector3(0.05, 1 / 2048, 0) },
};

/* 宣告與兩支函式。地形的分階著色器與（之後）critter.js 共用這一段。 */
const DECL = `
uniform sampler2DShadow cpShMap;
uniform mat4 cpShMat;
uniform vec3 cpShK;
/* p 世界座標、n 世界法線（正規化）、l 指向光。回傳 PCF 的 0（全遮）～1（全亮）。 */
float cpShRaw(vec3 p, vec3 n, vec3 l) {
  float cpNl = clamp(dot(n, l), 0.0, 1.0);
  vec3 cpQ = p + n * cpShK.x * (${N_MIN.toFixed(2)} + ${N_SLOPE.toFixed(2)} * sqrt(1.0 - cpNl * cpNl));
  vec3 cpC = (cpShMat * vec4(cpQ, 1.0)).xyz;
  cpC.z -= cpShK.z;
  float cpO = cpShK.y * 0.5;
  float cpS = 0.25 * (texture(cpShMap, cpC + vec3(-cpO, -cpO, 0.0))
                    + texture(cpShMap, cpC + vec3( cpO, -cpO, 0.0))
                    + texture(cpShMap, cpC + vec3(-cpO,  cpO, 0.0))
                    + texture(cpShMap, cpC + vec3( cpO,  cpO, 0.0)));
  bool cpIn = all(greaterThan(cpC, vec3(0.0))) && all(lessThan(cpC, vec3(1.0)));
  return cpIn ? cpS : 1.0;
}
/* 在 0.5 切一刀，交界只留 fwidth 寬。要在一致的控制流裡叫（fwidth）。 */
float cpShCut(float s) {
  float cpW = max(fwidth(s) * 0.7, 0.002);
  return smoothstep(0.5 - cpW, 0.5 + cpW, s);
}
`;

/**
 * 接進地形五階調著色器的那一段（見 ../light.js）。
 * `cpShL` 留在 pre 之後的 hook 裡讀得到：1 是照到光，0 是在投影裡。
 */
export const shade = ON ? {
  uniforms: U,
  decl: DECL,
  pre: `
  float cpShL = cpShCut(cpShRaw(vLightP, normalize(vBandN), uKeyDir));
  cpD = mix(min(cpD, ${DARK.toFixed(2)}), cpD, cpShL);
`,
  post: '',
} : null;

/**
 * 給別的著色器接收投影用（例如 critter.js 的毛皮，還沒接）。
 *
 *   sh.uniforms 併入 `receiver.uniforms`（同一份物件，拍新圖時跟著變）；
 *   片段著色器的宣告區接 `receiver.decl`；然後
 *     float lit = receiver.lit('vWorldP', 'N', 'uKeyDir')   // 0～1，硬邊
 *   照自己的分階去用（三階調就是 lit < 0.5 落到最暗那一階）。
 *   decl 跟地形的那一份同名，同一支著色器裡不要接兩次。
 * `?shadow=0` 時是 null。
 */
export const receiver = ON ? {
  uniforms: U,
  decl: DECL,
  /** @param {string} p 世界座標 @param {string} n 世界法線（正規化） @param {string} l 指向光 */
  lit: (p, n, l) => `cpShCut(cpShRaw(${p}, ${n}, ${l}))`,
} : null;

/** 分階材質（palette.js 的 banded）認得出來：它給 three 的程式鍵是 `banded:…`。 */
const isBanded = (m) => !!m && !Array.isArray(m) && m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey
  && String(m.customProgramCacheKey()).startsWith('banded:');

/** @param {object} ctx 見 ../light.js */
export function setup(ctx) {
  if (!ON) return null;
  const { scene, renderer, arenas } = ctx;
  if (!arenas || !arenas.length) return null;

  /* ── 誰投影：此刻場景裡的靜態砌體 ── */
  const casters = [];
  const box = new THREE.Box3();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || !isBanded(o.material) || o.material.transparent) return;
    box.setFromObject(o);
    if (box.max.y - box.min.y < 0.01) return;      // 平的（地面）：擋不到東西
    o.layers.enable(LAYER);
    casters.push(o);
  });
  if (!casters.length) return null;                // 戰鬥場：只有一片地，什麼都不投影

  /* ── 深度圖 ── */
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const want = Number(Q) >= 256 ? Number(Q) : coarse ? 1024 : 2048;
  const S = Math.min(want, renderer.capabilities.maxTextureSize);
  const depth = new THREE.DepthTexture(S, S);
  depth.minFilter = depth.magFilter = THREE.LinearFilter;
  depth.compareFunction = THREE.LessEqualCompare;
  const rt = new THREE.WebGLRenderTarget(S, S, {
    depthBuffer: true, depthTexture: depth,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
  });
  U.cpShMap.value = depth;

  /* 只寫深度。不吃霧、不寫顏色。 */
  const write = new THREE.MeshBasicMaterial({ colorWrite: false, fog: false });

  /* 相機在原點、朝光行進的方向看；框用光空間的座標給，所以「對齊到一格」
     就是把四邊取整。 */
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  cam.layers.set(LAYER);
  cam.position.set(0, 0, 0);
  const key = new THREE.Vector3();
  const BIASM = new THREE.Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1,
  );
  const v = new THREE.Vector3();

  /** 把正交相機框到一個場地上（地面到封頂，外加一點邊）。 */
  function fit(a) {
    // 拍的那一刻才讀光的方向：日後若有誰轉了光，重拍時就跟上。
    key.copy(U_KEYDIR.value).normalize();
    cam.up.set(0, 1, 0);
    cam.lookAt(v.copy(key).negate());
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse;
    const [x0, x1, z0, z1] = a.shape === 'circle'
      ? [a.x - a.r, a.x + a.r, a.z - a.r, a.z + a.r]
      : [a.x0, a.x1, a.z0, a.z1];
    const y0 = -0.5, y1 = (a.lid || 12) + 0.5;
    let lx = Infinity, hx = -Infinity, ly = Infinity, hy = -Infinity, lz = Infinity, hz = -Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0).applyMatrix4(inv);
      lx = Math.min(lx, v.x); hx = Math.max(hx, v.x);
      ly = Math.min(ly, v.y); hy = Math.max(hy, v.y);
      lz = Math.min(lz, v.z); hz = Math.max(hz, v.z);
    }
    // 方的：一格在兩個方向上一樣寬。
    const ext = Math.max(hx - lx, hy - ly) + 1;
    const tex = ext / S;
    const cx = Math.round((lx + hx) / 2 / tex) * tex, cy = Math.round((ly + hy) / 2 / tex) * tex;
    const h = (S / 2) * tex;
    cam.left = cx - h; cam.right = cx + h;
    cam.bottom = cy - h; cam.top = cy + h;
    // 鏡頭看的是 −z：近的那一面是 z 最大的。往光那邊多留幾公尺，封頂以上沒有東西了，但牆頭的雉堞可能貼著。
    cam.near = -hz - 4; cam.far = -lz + 1;
    cam.updateProjectionMatrix();
    U.cpShMat.value.multiplyMatrices(BIASM, cam.projectionMatrix).multiply(inv);
    U.cpShK.value.set(tex, 1 / S, (BIAS * tex) / (cam.far - cam.near));
  }

  function shoot() {
    const prevT = renderer.getRenderTarget();
    const prevO = scene.overrideMaterial;
    const prevA = renderer.autoClear;
    scene.overrideMaterial = write;
    renderer.autoClear = true;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevT);
    renderer.autoClear = prevA;
    scene.overrideMaterial = prevO;
  }

  /** 投影的 mesh 裡有哪些看得到（連父節點一起算），壓成一個數。 */
  function seen() {
    let h = 0;
    for (let i = 0; i < casters.length; i++) {
      let o = casters[i], vis = true;
      while (o) { if (!o.visible) { vis = false; break; } o = o.parent; }
      if (vis) h = (h * 31 + i + 1) % 2147483647;
    }
    return h;
  }

  let at = undefined, was = -1;
  return {
    update(f) {
      const id = f.block || arenas[0].id;
      const s = seen();
      if (id === at && s === was) return;
      const a = arenas.find((x) => x.id === id) || arenas[0];
      if (id !== at) fit(a);
      at = id; was = s;
      shoot();
    },
  };
}

