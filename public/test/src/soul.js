/* ── test/src/soul.js ─────────────────────────────────────────────────
   靈魂（BOSS 死掉掉出來的，combat.js 的 SOUL）的外觀：一顆發光的狗頭，
   周圍冒著一顆顆往上飄、融在一起的小球。

   是那隻立耳犬本人的頭：Zoo 已經讀好、烘好的 dog-prick，把頭、兩隻耳朵、
   吻部（連鼻子與嘴）那幾根骨頭的三角形挑出來，頂點換到頭骨座標（靜置姿勢），
   拼成一份不會動的幾何。

     頭     幽靈那一身（monster.js 的 GHOST、GHOST_ALPHA）：淡藍白、半透明。
            跟幽靈一樣畫兩趟——先只寫深度、再照 alpha 上色，不然耳根、吻部
            後面那幾層皮會透出來疊成一團。兩趟都排在半透明那一批裡（`ORDER`），
            只寫深度的那一趟才不會比牆先畫、把後面的牆擋掉。
     描邊   淺色的：跟頭盔、刀一樣是外推一點、只畫背面的殼（皮沿烘焙後的法線
            往外推 INK_OUT），只是顏色不是墨色。
     發光   一片永遠面向鏡頭的光暈（加色混合），比頭先畫：輪廓外面是一圈往外
            淡掉的光，半透明的頭底下也透著它，所以頭是亮的。
     眼睛   不用原本那兩顆，換成黑色的叉叉，放在原本眼睛的位置。遠側那一隻照
            那隻狗的做法收合（見下面）。
     小球   見下面「小球」那一段。

   ── 臉（叉叉、鼻子、嘴）為什麼要往鏡頭推 ─────────────────────────────
   烘焙把皮放到超橢球上（critter.js 的 _bakeGeometry），臉沒有跟著出去，所以
   大半埋在皮後面。那隻狗是在著色器裡把臉沿視線往鏡頭推 0.15 公尺（critter.js
   的 FACE_DECL、`_faceLift`）才看得到——這裡照做，推的量也一樣（FACE_LIFT）。
   沿視線推不改變它在畫面上的位置，只改變它贏不贏得過皮的深度。

   ── 遠側那隻眼睛收合 ─────────────────────────────────────────────
   critter.js 的那一段（源頭是 cat.js 的 `_eyeFade`），門檻照抄：鏡頭相對於這顆頭
   轉過去 ψ，|sin ψ| 從 EYE_FADE[0] 到 EYE_FADE[1] 之間，遠的那一隻（鏡頭在頭的
   +X 那一側，遠的就是 −X 那隻）照 smoothstep 從原尺寸縮到零。理由也一樣：臉是
   往鏡頭推出來的，轉到側面，遠的那隻會從輪廓戳出去，變成頭旁邊浮著一個叉；
   真的側臉只有一隻眼睛。這顆頭不轉向鏡頭（沒有 REST_AIM），所以 ψ 就是鏡頭
   相對於頭的方位，不必再扣。

   ── 小球 ─────────────────────────────────────────────────────────
   頭的周圍（含頭裡面）一直冒出小球：每秒 BUBBLE.rate 顆，大小在 BUBBLE.r 之間
   隨機，位置在頭四周那一圈（BUBBLE.spread）裡隨機，冒出來之後慢慢往上飄
   （BUBBLE.rise），活 BUBBLE.life 秒：一出生很快長到原本的大小，最後那一段
   縮到沒有。小球在世界座標裡飄，不跟著頭轉、也不跟著頭上下漂。

   畫法是 metaball：所有小球是同一個距離場（每一顆一個球的距離，用平滑的
   min 接起來，BUBBLE.blend 是接合的寬度），在一個包住它們的盒子上逐像素
   往裡走（ray marching）找表面，所以兩顆靠近會長出頸子、融成一團，而不是
   兩顆硬碰硬的球。走到的那一點寫進深度（gl_FragDepth），深度測試照常做——
   頭那一趟只寫深度的皮已經在深度緩衝裡了，所以小球在頭顱裡面的那一段被頭
   擋掉，露在外面的那一段照常畫。盒子排在頭上色之後（`ORDER.bubble`），頭
   前面的小球蓋在頭上。

   一份幾何、一份材質，每顆靈魂一個 SoulView 共用。頭的原點在頭的正中（包圍盒
   的中心），所以轉起來是在原地轉；轉多少是 soulStep 算的 `yaw`（每 SOUL.spin
   秒一圈），這裡只照著擺。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { Rig } from '../../src/cat/rig.js';
import { toon, KEY_DIR } from './palette.js';
import { GHOST, GHOST_ALPHA } from './monster.js';

/** 一個模型單位多少公尺。頭寬約 2.4 單位，畫出來約 0.6 公尺——跟撿得到的那顆球（SOUL.r）一樣寬。 */
const SCALE = 0.25;
/** 挑哪幾根骨頭的三角形。眼睛（eye0／eye1）不挑，換成叉叉。 */
const PARTS = ['head', 'earL', 'earR', 'muzzle'];
/** 淺色描邊與光暈的顏色（sRGB 0～1，跟 GHOST 一樣的寫法）。 */
const RIM = [0.93, 0.97, 1.0];
const EYE = 0x111111;
/** 臉往鏡頭推多遠（公尺）：critter.js 的 `_faceLift`。 */
const FACE_LIFT = 0.15;
/** 遠側那隻眼睛從 |sin ψ| 多少開始收、到多少收完：critter.js 的那兩個門檻。 */
const EYE_FADE = [0.62, 0.94];
/** 描邊外殼推多遠（模型單位）。 */
const INK_OUT = 0.06;
/** 叉叉：每一劃多長、多粗、多厚（模型單位），兩劃交叉 ±45°。 */
const CROSS = { len: 0.46, w: 0.1, t: 0.03 };
/** 光暈：多寬（公尺）、多亮。 */
const GLOW = { size: 1.5, opacity: 0.55 };
/**
 * 小球（公尺、秒）：
 *   rate    每秒冒幾顆          r       半徑的範圍（隨機）
 *   life    活多久的範圍（隨機） rise    往上飄多快
 *   spread  冒出來的範圍：以頭的正中為中心，水平半徑 xz、上下 ±y
 *   grow    出生後多久長到原本的大小（占 life 的比例）；fade 最後多少比例縮到沒有
 *   blend   兩顆融在一起的接合寬度（平滑 min 的 k）
 *   max     同時最多幾顆（著色器的陣列有多長）
 */
const BUBBLE = {
  rate: 24, r: [0.025, 0.09], life: [1.2, 2.0], rise: 0.22,
  spread: { xz: 0.42, y: 0.34 }, grow: 0.15, fade: 0.45, blend: 0.06, max: 64,
};
/** 半透明那一批裡的先後：光暈、只寫深度、描邊、上色、小球、臉、叉叉。叉叉排在只寫深度之後，
    從背面看才會被頭擋住，不會隔著半透明的頭透出來（幽靈的眼睛也是這樣）。 */
const ORDER = { glow: 0, depth: 1, rim: 2, tint: 3, bubble: 4, face: 5, eye: 6 };

export const SOUL_LOOK = { SCALE, PARTS, FACE_LIFT, EYE_FADE, INK_OUT, CROSS, GLOW, BUBBLE };

const srgb = ([r, g, b]) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * 從一隻烘好的 Critter 把頭挑出來，換到頭骨座標。
 *
 * @param {import('./critter.js').Critter} c
 * @returns {{skin: THREE.BufferGeometry, face: THREE.BufferGeometry, eyes: number[][], center: number[], raw: object}}
 *   eyes 是兩隻眼睛的中心（頭骨座標，原本的位置）；raw 是皮的頂點、法線、索引陣列（描邊外殼用）
 */
export function headParts(c) {
  const rig = new Rig(c.data.header);
  rig.update();
  const M = rig.matrices, head = rig.bone('head');
  const inv = new THREE.Matrix4().fromArray(M, head * 16).invert();
  const toHead = rig.names.map((_, b) => new THREE.Matrix4().fromArray(M, b * 16).premultiply(inv));
  const nrmOf = toHead.map((m) => new THREE.Matrix3().getNormalMatrix(m));
  const want = new Set(PARTS.map((n) => rig.bone(n)));
  const eyeBones = rig.names.map((n, b) => (n.startsWith('eye') ? b : -1)).filter((b) => b >= 0);

  const pos = c._posBaked, bakeN = c.geometry.attributes.aBakeN.array, bone = c._boneId, idx = c.data.index;
  const G = Object.fromEntries(c.data.header.groups.map((q) => [q.name, q]));
  const v = new THREE.Vector3();
  const at = (i) => v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(toHead[bone[i]]).toArray();

  /** 一個群組裡、三個頂點都屬於 bones 的三角形，重新編號成一份幾何的陣列。 */
  const pick = (grp, bones) => {
    const map = new Map(), P = [], N = [], I = [];
    for (let k = grp.start; k < grp.start + grp.count; k += 3) {
      const tri = [idx[k], idx[k + 1], idx[k + 2]];
      if (!tri.every((i) => bones.has(bone[i]))) continue;
      for (const i of tri) {
        if (!map.has(i)) {
          map.set(i, P.length / 3);
          P.push(...at(i));
          N.push(...v.set(bakeN[i * 3], bakeN[i * 3 + 1], bakeN[i * 3 + 2]).applyMatrix3(nrmOf[bone[i]]).normalize().toArray());
        }
        I.push(map.get(i));
      }
    }
    return { P, N, I };
  };
  const skin = pick(G.lit, want);
  const face = pick(G.unlit, want);

  // 眼睛的中心：那兩根骨頭的頂點的包圍盒中心（平均會被頂點的疏密拉偏）。
  const eyes = eyeBones.map((b) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < bone.length; i++) {
      if (bone[i] !== b) continue;
      const p = at(i);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    }
    return lo.map((l, k) => (l + hi[k]) / 2);
  });

  const geo = ({ P, N, I }) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setIndex(I);
    return g;
  };
  const skinGeo = geo(skin);
  skinGeo.computeBoundingBox();
  const center = skinGeo.boundingBox.getCenter(new THREE.Vector3()).toArray();
  return { skin: skinGeo, face: geo(face), eyes, center, raw: skin };
}

/** 皮沿法線往外推 out 的一份（描邊外殼）。 */
function inflate({ P, N, I }, out) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.map((p, k) => p + N[k] * out), 3));
  g.setIndex(I);
  return g;
}

/**
 * 一顆沿視線往鏡頭推 FACE_LIFT 公尺的材質（臉用，見檔頭）。推的方向是從鏡頭看向
 * `anchor`（物體自己座標裡的一點）的那條線，整張臉同一個方向，所以形狀不會歪。
 */
function lifted(color, anchor) {
  const m = new THREE.MeshBasicMaterial({ color });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLift = { value: FACE_LIFT };
    sh.uniforms.uAnchor = { value: new THREE.Vector3(...anchor) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uLift;\nuniform vec3 uAnchor;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec3 cpA = (modelViewMatrix * vec4(uAnchor, 1.0)).xyz;
    float cpL = length(cpA);
    if (cpL > 1e-5) mvPosition.xyz -= (cpA / cpL) * uLift;
    gl_Position = projectionMatrix * mvPosition;
  }`);
  };
  m.customProgramCacheKey = () => `soul-lift:${anchor.join(',')}`;
  return m;
}

/** 一個叉叉：兩劃 ±45°，中心在 (x, y, z)、面朝 +Z。縮放（遠側收合）就是縮這個 Group。 */
function cross(at, mat) {
  const g = new THREE.Group();
  const bar = new THREE.BoxGeometry(CROSS.len, CROSS.w, CROSS.t);
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const m = new THREE.Mesh(bar, mat);
    m.rotation.z = a;
    m.renderOrder = ORDER.eye;
    g.add(m);
  }
  g.position.set(...at);
  return g;
}

/** 光暈的貼圖：中間亮、往外平滑淡到 0 的一個圓。 */
function glowTexture(n = 64) {
  const px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const a = Math.max(0, 1 - r) ** 2;
      px.set([255, 255, 255, Math.round(a * 255)], (y * n + x) * 4);
    }
  }
  const t = new THREE.DataTexture(px, n, n);
  t.needsUpdate = true;
  return t;
}

/* ── 小球的著色器 ─────────────────────────────────────────────────
   盒子只畫背面（鏡頭走進盒子裡也畫得出來），光線從鏡頭出發、先跟盒子求交，
   在盒子裡面照距離場走。沒走到表面就丟掉這個像素。 */
const BUBBLE_VERT = `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const BUBBLE_FRAG = `
#define N ${BUBBLE.max}
uniform vec4 uBalls[N];      // xyz 世界座標，w 半徑（0 = 沒有這一顆）
uniform int uCount;
uniform float uBlend;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uColor;
uniform vec3 uRim;
uniform vec3 uKeyDir;
uniform float uAlpha;
uniform mat4 projectionMatrix;   // three 只在頂點著色器裡宣告它；寫深度要用
varying vec3 vWorld;

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float field(vec3 p) {
  float d = 1e3;
  for (int i = 0; i < N; i++) {
    if (i >= uCount) break;
    d = smin(d, length(p - uBalls[i].xyz) - uBalls[i].w, uBlend);
  }
  return d;
}
vec3 fieldNormal(vec3 p) {
  const vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(
    field(p + e.xyy) - field(p - e.xyy),
    field(p + e.yxy) - field(p - e.yxy),
    field(p + e.yyx) - field(p - e.yyx)));
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uBoxMin - ro) * inv, t1 = (uBoxMax - ro) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float t = max(max(max(tn.x, tn.y), tn.z), 0.0);
  float tEnd = min(min(tf.x, tf.y), tf.z);
  bool hit = false;
  for (int k = 0; k < 64; k++) {
    if (t > tEnd) break;
    float d = field(ro + rd * t);
    if (d < 0.001) { hit = true; break; }
    t += max(d, 0.002);
  }
  if (!hit) discard;
  vec3 p = ro + rd * t;
  vec3 n = fieldNormal(p);
  // 跟石頭、頭同一個方向的光，分三階；邊緣往淺色的描邊色亮上去（發光的那一圈）。
  float dl = dot(n, uKeyDir);
  float tone = dl > 0.42 ? 1.0 : dl > -0.06 ? 0.84 : 0.7;
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
  gl_FragColor = vec4(mix(uColor * tone, uRim, rim * 0.8), mix(uAlpha, 1.0, rim * 0.6));
  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
  #include <colorspace_fragment>
}
`;

/**
 * 一顆靈魂身邊的那一群小球：出生、上飄、長大、縮掉（BUBBLE），每幀把活著的
 * 那幾顆交給著色器，盒子跟著包住它們。
 */
class Bubbles {
  constructor(mat) {
    this.balls = [];
    this._due = 0;
    this.mat = mat;
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    this.mesh.renderOrder = ORDER.bubble;
    this.mesh.frustumCulled = false;
  }

  clear() { this.balls.length = 0; this._due = 0; }

  /** 這一幀：以 (x, y, z)（頭的正中）為中心冒新的、讓舊的上飄與老去。 */
  step(dt, x, y, z) {
    const B = BUBBLE, rnd = (a, b) => a + Math.random() * (b - a);
    this._due += dt * B.rate;
    while (this._due >= 1 && this.balls.length < B.max) {
      this._due -= 1;
      const a = Math.random() * 2 * Math.PI, rr = B.spread.xz * Math.sqrt(Math.random());
      this.balls.push({
        x: x + Math.cos(a) * rr, y: y + rnd(-B.spread.y, B.spread.y), z: z + Math.sin(a) * rr,
        r: rnd(B.r[0], B.r[1]), life: rnd(B.life[0], B.life[1]), age: 0,
      });
    }
    if (this._due > 1) this._due = 1;
    for (const b of this.balls) { b.age += dt; b.y += B.rise * dt; }
    this.balls = this.balls.filter((b) => b.age < b.life);
  }

  /** 把活著的小球寫進著色器，盒子包住它們（留一個接合寬度）。 */
  paint() {
    const U = this.mat.uniforms, n = this.balls.length;
    this.mesh.visible = n > 0;
    if (!n) return;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    this.balls.forEach((b, i) => {
      const u = b.age / b.life;
      const r = b.r * smooth(0, BUBBLE.grow, u) * (1 - smooth(1 - BUBBLE.fade, 1, u));
      U.uBalls.value[i].set(b.x, b.y, b.z, r);
      [b.x, b.y, b.z].forEach((c, k) => { lo[k] = Math.min(lo[k], c - b.r); hi[k] = Math.max(hi[k], c + b.r); });
    });
    U.uCount.value = n;
    const pad = BUBBLE.blend;
    U.uBoxMin.value.set(lo[0] - pad, lo[1] - pad, lo[2] - pad);
    U.uBoxMax.value.set(hi[0] + pad, hi[1] + pad, hi[2] + pad);
    this.mesh.position.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    this.mesh.scale.set(hi[0] - lo[0] + 2 * pad, hi[1] - lo[1] + 2 * pad, hi[2] - lo[2] + 2 * pad);
  }
}

/**
 * 一顆靈魂畫在場上的樣子（SoulLook.make 做的）：頭、光暈、小球。`root` 加進場景
 * 一次就好，之後每幀 `show`。
 */
class SoulView {
  constructor(look) {
    const M = look.mats;
    const mesh = (geo, key) => Object.assign(new THREE.Mesh(geo, M[key]), { renderOrder: ORDER[key] });
    const head = new THREE.Group();
    this.eyes = look._eyes.map((e) => cross(e, M.eye));
    head.add(mesh(look._skin, 'depth'), mesh(look._rim, 'rim'), mesh(look._skin, 'tint'), mesh(look._face, 'face'), ...this.eyes);
    head.scale.setScalar(SCALE);
    head.position.set(...look._center.map((c) => -c * SCALE));
    const glow = new THREE.Sprite(M.glow);
    glow.scale.set(GLOW.size, GLOW.size, 1);
    glow.renderOrder = ORDER.glow;
    /** 頭與光暈：擺在靈魂的位置、轉 yaw。 */
    this.node = new THREE.Group();
    this.node.add(glow, head);
    /** 小球在世界座標裡，不跟著頭轉。 */
    this.bubbles = new Bubbles(look.newBubbleMat());
    this.root = new THREE.Group();
    this.root.add(this.node, this.bubbles.mesh);
    this.root.visible = false;
  }

  /**
   * 這一幀的靈魂（combat.js 的 dropSoul 那一種；null = 這一格沒有靈魂，收起來）。
   * `camera` 給遠側眼睛收合用。
   */
  show(sl, dt, camera) {
    this.root.visible = !!sl;
    if (!sl) { this.bubbles.clear(); return; }
    this.node.position.set(sl.x, sl.y, sl.z);
    this.node.rotation.y = sl.yaw;

    // 遠側那隻眼睛收合（見檔頭）。ψ > 0：鏡頭在頭的 +X 那一側，遠的是 −X 那隻。
    const psi = wrapPi(Math.atan2(camera.position.x - sl.x, camera.position.z - sl.z) - sl.yaw);
    const s = Math.sin(psi), k = smooth(EYE_FADE[0], EYE_FADE[1], Math.abs(s));
    for (const e of this.eyes) {
      const far = s >= 0 ? e.position.x < 0 : e.position.x >= 0;
      e.scale.setScalar(far ? Math.max(1e-3, 1 - k) : 1);
      e.visible = !far || k < 1;
    }

    this.bubbles.step(dt, sl.x, sl.y, sl.z);
    this.bubbles.paint();
  }
}

/**
 * 靈魂的外觀：一組共用的幾何與材質，`make()` 做一顆（SoulView）。借玩家那個 Zoo
 * 已經讀好、烘好的立耳犬，不再讀一次 cat.bin。
 */
export class SoulLook {
  /** @param {import('./critter.js').Zoo} zoo */
  constructor(zoo) {
    const h = headParts(zoo.critters.get('dog-prick'));
    this._skin = h.skin;
    this._face = h.face;
    this._rim = inflate(h.raw, INK_OUT);
    this._eyes = h.eyes;
    this._center = h.center;
    const tint = toon(srgb(GHOST.body));
    tint.transparent = true;
    tint.opacity = GHOST_ALPHA;
    tint.depthWrite = false;
    const face = lifted(srgb(GHOST.face), h.center);
    face.transparent = true;
    face.opacity = GHOST_ALPHA;
    face.depthWrite = false;
    this.mats = {
      depth: new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true }),   // 第一趟：只寫深度
      tint,                                                                          // 第二趟：照 alpha 上色
      face,
      rim: new THREE.MeshBasicMaterial({ color: srgb(RIM), side: THREE.BackSide, transparent: true }),
      eye: Object.assign(lifted(EYE, [0, 0, 0]), { transparent: true }),   // 每一劃的原點就是眼睛中心
      glow: new THREE.SpriteMaterial({
        map: glowTexture(), color: srgb(RIM), opacity: GLOW.opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }),
    };
  }

  /** 一群小球的材質：著色器共用，uniform 每一群自己一份（各自的小球、各自的盒子）。 */
  newBubbleMat() {
    return new THREE.ShaderMaterial({
      vertexShader: BUBBLE_VERT,
      fragmentShader: BUBBLE_FRAG,
      uniforms: {
        uBalls: { value: Array.from({ length: BUBBLE.max }, () => new THREE.Vector4()) },
        uCount: { value: 0 },
        uBlend: { value: BUBBLE.blend },
        uBoxMin: { value: new THREE.Vector3() },
        uBoxMax: { value: new THREE.Vector3() },
        uColor: { value: srgb(GHOST.body) },
        uRim: { value: srgb(RIM) },
        uKeyDir: { value: KEY_DIR },
        uAlpha: { value: GHOST_ALPHA },
      },
      side: THREE.BackSide, transparent: true, depthWrite: false,
    });
  }

  /** 一顆靈魂的樣子。 */
  make() {
    return new SoulView(this);
  }
}
