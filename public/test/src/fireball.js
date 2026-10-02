/* ── test/src/fireball.js ─────────────────────────────────────────────
   BOSS 吐出來的火球：畫出來（規則——多大、多快、打到誰——在 skills.js 的 orb）。

   跟狗同一種畫法：平塗、硬邊、外面一圈墨線。

   長度單位是球的半徑 R；球自己的座標是球心在原點、前進方向是 +Z。

   ── 球：一圈圈往後推的流體 ───────────────────────────────────────
   一顆完整的球。一圈一圈的流體是球面上的隆起：每一圈從正面那一點生出來，
   順著球面往後走，RINGS 圈平均排開、每一圈 SWEEP 秒走完前半球。每一圈是一段
   cos² 的鼓包，沿球面的法線推出去，所以它貼著球面、越走圈越大；走到赤道就
   離開球面——鼓包在那裡收掉，接下來是尾巴的火粒。

   ── 尾巴：火粒融成一團（跟 blood.js 的血滴同一種畫法）─────────────
   尾巴不是雕出來的網格，是球背面一直噴出來的火粒：每一顆各自往後飄、越飄
   越小、壽命到了就沒了。所有火粒合成一個形狀：靠得近的黏在一起，拉開了才
   斷成一團一團——火舌隨機冒出來、分岔、斷掉、散掉，全是噴的隨機性自己長出來
   的，不用另外規定形狀。

   兩種噴口：

     芯    球的正後方一直噴大顆的（CORE），尾巴的根因此一直跟球黏著，球的輪廓
           順著接下去。
     火舌  TONGUES 個噴口輪流在球背面的邊緣（最大圓周內側）噴小一點的
           （TONGUE）。一個噴口抽一個方向、噴多久、多密、多大、多快，噴完了
           馬上換一個方向重抽——同一個方向噴出來的一串連成一條火舌，換方向就是
           另一條冒出來。

   每一顆火粒的速度是「球的速度 × keep」（keep 每一顆各自抽）再加一點往外、往內
   的橫向：比球慢，所以留在球後面，慢多少就拖多遠。火粒在世界裡飛，不跟著球——
   球轉彎、撞牆消失了，已經噴出去的還是照自己的路散完（球不在了的那幾顆老得快
   一點，ORPHAN）。

   ── 爆炸 ─────────────────────────────────────────────────────────
   球撞到人、黑牆或場上的東西（規則在 skills.js 的 shotsStep、fight.js 的 resolve）
   就消失，原地炸開：一顆大的閃光（BOOM.flash，不動、很快縮掉）加一圈往四面八方
   噴出去的火粒（BOOM.n 顆，方向在球面上均勻）。火粒有阻力（drag，越飛越慢）、
   往上浮（rise，火往上竄），一邊縮小一邊冷掉。畫法跟尾巴是同一個場——跟還沒散完
   的尾巴黏在一起，墨線也是同一圈。爆炸的火粒比尾巴熱（BOOM.heat），所以剛炸開
   的那一下有黃芯，冷下來才轉橙、紅。

   形狀的畫法照 blood.js 的血滴：

     場    每一顆在一張離屏的圖（畫面一半的解析度）上疊一份場值 (1 − x²)²，
           x 是到那一顆的距離除以影響半徑；順著它相對於球的速度在畫面上拉長一點
           （STRETCH 秒走的距離，最多自己半徑的 ELONG 倍——跟著縮小變短，一直是
           一滴往後拖的水滴形）。另一個通道疊「場值 × 熱度」，除回來就是那一點
           的平均熱度（尾巴的火粒剛噴出來是 TAIL_HOT、爆炸的是 BOOM.heat，散掉的
           時候都是 0）。
     合成  每一顆的方片（放大到蓋得住墨線）再畫一次，讀那張圖：場值過了 ISO 是火，
           差一點是墨線（差多少除以場在畫面上的斜率就是離邊緣幾個像素，所以線寬跟
           狗的一樣），再外面丟掉。方片擺在那一顆自己的深度，照常做深度測試。

   ── 顏色：三層溫度 ───────────────────────────────────────────────
   紅、橙、黃三階硬切，照「熱度」分。

     球    熱度 = 正對鏡頭的程度 + 圈頂多一點。從哪個方向看都是黃的芯、外面一圈
           橙、最外面一圈紅。後半球上尾巴蓋到的像素取球與尾巴較熱的那個（尾巴最多
           給到橙）——球的紅邊不會在尾巴裡面另外圈出一道，看起來是同一團火，黃芯
           還是球自己的。「正對鏡頭」大半照沒有鼓包的球面量（FOLLOW），不然
           每一圈都會各自冒出一塊黃。
     尾巴  熱度 = 那裡的平均熱度^0.7 × (TAIL_HEAT[0] + TAIL_HEAT[1] × √場過了 ISO
           多深)。場越深越像正對鏡頭——一團的中間熱、邊緣冷；越老的火粒越冷，所以
           越往尾巴越紅。尾巴的火粒從 TAIL_HOT 起算，最熱也到不了黃——黃只留給球芯
           （不然剛噴出來的火粒會在球的紅邊外面冒出一彎黃）；爆炸的火粒更熱，才有黃。

   ── 墨線：全火球一圈 ─────────────────────────────────────────────
   球是翻面外殼（跟狗的墨線一樣，critter.js 的 INK_PUSH）：同一份幾何只畫背面，
   在螢幕上沿法線往外推 uInkOut。尾巴的墨線是合成那一步畫的。兩者要接成一圈：
   球的外殼每個像素讀尾巴的場，場值過了 ISO（這裡是尾巴）就不畫——尾巴從球的
   輪廓長出去的地方沒有線，只剩整顆火球最外圈的輪廓。三層顏色是同一個表面上的
   著色，不是三個殼，所以層與層之間也沒有線。

   沒給 renderer 的話沒有尾巴，只有球。畫不出浮點圖的機器，場存成 8 位元（先乘
   1/4，讀回來再乘回去），跟 blood.js 一樣。

   碰撞還是那顆球（skills.js 的 shotHits）：尾巴只是畫出來的。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { INK_TONED } from './critter.js';

/** 球切幾圈、繞一圈切幾片。 */
const U_BALL = 48;
const SEG = 24;

/** 同時有幾圈流體、一圈走完前半球要幾秒。 */
const RINGS = 2;
const SWEEP = 0.3;
/** 一圈的鼓包多寬（沿球面的半寬，弧度）、多高（半徑的幾倍）。 */
const RING_W = 0.45;
const RING_H = 0.08;

/**
 * 噴口。rate 每秒幾顆、r 剛噴出來多大（半徑）、life 活幾秒、keep 速度是球的幾倍、
 * side 橫向速度（半徑 / 秒，正的往外）、back 噴出來的地方在赤道後面多遠（半徑）。
 * 火舌另有 dur：一個方向噴多久。
 */
const CORE = { rate: 35, r: [0.5, 0.7], life: [0.15, 0.25], keep: [0.45, 0.6], side: [-0.3, 0.3], back: [0.3, 0.5] };
const TONGUE = {
  rate: [45, 70], r: [0.28, 0.42], life: [0.25, 0.55], keep: [0.25, 0.55], side: [-0.3, 0.15], back: [0.1, 0.35],
  dur: [0.1, 0.3],
};
const TONGUES = 3;
/** 球不在了（撞牆）之後，還沒散完的火粒老得多快（倍）。 */
const ORPHAN = 3;
/** 尾巴的火粒剛噴出來多熱：最熱的地方也剛好到不了黃（見 TAIL_HEAT）。 */
const TAIL_HOT = 0.72;
/**
 * 爆炸。n 幾顆往外噴、r 多大（半徑）、life 活幾秒、speed 初速（半徑 / 秒）、drag 每秒
 * 慢掉多少（指數）、rise 往上浮的加速度（公尺 / 秒²）、heat 剛炸開多熱；flash 是正中間
 * 那一顆大的閃光（不動）。
 */
const BOOM = {
  n: 22, r: [0.45, 0.75], life: [0.28, 0.45], speed: [3, 6], drag: 6, rise: 3, heat: 1.6,
  flash: { r: 1.3, life: 0.22 },
};
/** 最多同時幾顆（所有火球與爆炸加起來）。滿了新的不噴。 */
const MAX_DROPS = 400;

/** 一顆拖多長：畫面上它相對於球的速度這麼多秒走的距離。 */
const STRETCH = 0.12;
/** 拉長最多是自己半徑的幾倍。 */
const ELONG = 3;
/** 場值過了這個就是火。 */
const ISO = 0.5;
/** 影響半徑是半徑的幾倍：單獨一顆的場在 (1 − x²)² = ISO 的地方。 */
const REACH = 1 / Math.sqrt(1 - Math.sqrt(ISO));
/** 場值過了 ISO 多少算最深；尾巴的熱度 = 平均熱度^0.7 × (TAIL_HEAT[0] + TAIL_HEAT[1] × √深度)。 */
const DEEP = 0.8;
const TAIL_HEAT = [0.45, 0.6];

/** 球的分層：圈頂多熱一點；「正對鏡頭」有幾成照鼓起來之後的表面（其餘照沒鼓的球面）。 */
const CREST = 0.06;
const FOLLOW = 0.35;
/** 熱度過了 HEAT[1] 是黃、過了 HEAT[0] 是橙，其餘是紅（球與尾巴共用）。 */
const HEAT = [0.6, 0.86];

/** 三層的顏色（sRGB，照原樣寫進畫面，跟 blood.js 一樣）。 */
const RED = [0.84, 0.15, 0.07];
const ORANGE = [1.0, 0.5, 0.1];
const YELLOW = [1.0, 0.87, 0.32];

const vec3 = (c) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`;
const f2 = (v) => v.toFixed(2);
const INK_SRGB = INK_TONED.clone().convertLinearToSRGB();
const INK_VEC = vec3([INK_SRGB.r, INK_SRGB.g, INK_SRGB.b]);
/** 熱度 → 三層的顏色（GLSL）。 */
const TONE = (h) => `${h} > ${f2(HEAT[1])} ? ${vec3(YELLOW)} : ${h} > ${f2(HEAT[0])} ? ${vec3(ORANGE)} : ${vec3(RED)}`;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const pick = ([a, b]) => lerp(a, b, Math.random());
/** 一段 cos² 的鼓包：x 是離中心幾個半寬。 */
const bell = (x) => {
  if (Math.abs(x) >= 1) return 0;
  const c = Math.cos((x * Math.PI) / 2);
  return c * c;
};

/* 尾巴一個像素的熱度（讀場那張圖）：場過了 ISO 才算，平均熱度^0.7 × (TAIL_HEAT[0] + TAIL_HEAT[1] × √深度)。 */
const TAIL_HEAT_FN = /* glsl */ `
float tailHeat(vec4 t) {
  float f = t.r / uScale;
  if (f < ${f2(ISO)}) return 0.0;
  float age = t.g / max(t.r, 1e-6);
  return pow(age, 0.7) * (${f2(TAIL_HEAT[0])} + ${f2(TAIL_HEAT[1])} * sqrt(clamp((f - ${f2(ISO)}) / ${f2(DEEP)}, 0.0, 1.0)));
}`;

/* ── 球 ── */

const BALL_VERT = /* glsl */ `
attribute float aCrest;
attribute vec3 aBase;
varying vec3 vN, vP;
varying float vCrest, vBack;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalMatrix * mix(aBase, normal, ${f2(FOLLOW)}); vP = mv.xyz;
  vCrest = aCrest;
  vBack = smoothstep(0.1, -0.3, aBase.z);  // 後半球（尾巴長出來的那一半）
  gl_Position = projectionMatrix * mv;
}`;

const BALL_FRAG = /* glsl */ `
uniform sampler2D uField;
uniform vec2 uRes;
uniform float uScale, uTail;
varying vec3 vN, vP;
varying float vCrest, vBack;
${TAIL_HEAT_FN}
void main() {
  float heat = max(dot(normalize(vN), normalize(-vP)), 0.0) + ${f2(CREST)} * vCrest;
  /* 後半球上尾巴蓋到的地方取兩者較熱的，但尾巴最多給到橙：球的紅邊不會在尾巴裡面圈出
     一道，黃芯還是球自己的。前半球不理尾巴——從正面看尾巴在球後面。 */
  if (uTail > 0.5) {
    heat = max(heat, min(tailHeat(texture2D(uField, gl_FragCoord.xy / uRes)), ${f2(HEAT[1] - 0.01)}) * vBack);
  }
  gl_FragColor = vec4(${TONE('heat')}, 1.0);
}`;

/* 球的墨線：背面、在螢幕上沿法線往外推（y 正規化的螢幕座標，critter.js 的 INK_PUSH）；
   蓋在尾巴上的像素不畫（讀尾巴的場）。 */
const INK_VERT = /* glsl */ `
uniform float uInkOut;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec2 s = (projectionMatrix * vec4(normalize(normalMatrix * normal), 0.0)).xy;
  float a = projectionMatrix[1][1] / max(projectionMatrix[0][0], 1e-6);
  s.x *= a;
  if (length(s) > 1e-6) {
    s = normalize(s);
    gl_Position.xy += vec2(s.x / a, s.y) * uInkOut * gl_Position.w;
  }
}`;

const INK_FRAG = /* glsl */ `
uniform sampler2D uField;
uniform vec2 uRes;
uniform float uScale, uTail;
void main() {
  if (uTail > 0.5 && texture2D(uField, gl_FragCoord.xy / uRes).r / uScale > ${f2(ISO)}) discard;
  gl_FragColor = vec4(${INK_VEC}, 1.0);
}`;

const COS = Float32Array.from({ length: SEG + 1 }, (_, j) => Math.cos((j / SEG) * Math.PI * 2));
const SIN = Float32Array.from({ length: SEG + 1 }, (_, j) => Math.sin((j / SEG) * Math.PI * 2));

/** 球的格網：(U_BALL + 1) 圈 × (SEG + 1) 片，每幀改寫的屬性開好。 */
function ballGeometry() {
  const count = (U_BALL + 1) * (SEG + 1);
  const g = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['aBase', 3], ['aCrest', 1]]) {
    const a = new THREE.BufferAttribute(new Float32Array(count * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
  }
  const idx = [];
  for (let i = 0; i < U_BALL; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j, b = a + SEG + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  g.setIndex(idx);
  return g;
}

/* ── 尾巴：火粒的場與合成（blood.js 的 BLOB_VERT、FIELD_FRAG、showFrag 同一套）── */

/* 朝著鏡頭的方片，順著相對速度拉長成膠囊，往外多留 pad。 */
const DROP_VERT = (pad) => /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute float iR;
attribute float iHeat;
uniform float uInkPx, uViewH;
varying vec2 vQ;
varying float vH, vReach, vHeat;
void main() {
  vec4 c = viewMatrix * vec4(iPos, 1.0);
  vec2 vv = (mat3(viewMatrix) * iVel).xy;
  // 拉長最多是自己半徑的 ELONG 倍：縮小的時候跟著變短，一直是一滴，不會拉成一根棍子。
  float L = min(length(vv) * ${STRETCH.toFixed(3)}, iR * ${ELONG.toFixed(2)});
  vec2 u = L > 1e-5 ? vv / length(vv) : vec2(1.0, 0.0), n = vec2(-u.y, u.x);
  // 這個深度上一個像素多少公尺。
  float px = -c.z * 2.0 / (projectionMatrix[1][1] * uViewH);
  float h = 0.5 * L, reach = iR * ${REACH.toFixed(4)}, ext = reach + ${pad};
  vec2 q = vec2(position.x * (h + ext), position.y * ext);
  c.xy += -u * h + u * q.x + n * q.y;      // 頭在 iPos，尾巴拖在後面
  vQ = q; vH = h; vReach = reach; vHeat = iHeat;
  gl_Position = projectionMatrix * c;
}`;

/* 場：r 是場值、g 是場值 × 熱度（都疊加）。 */
const FIELD_FRAG = /* glsl */ `
uniform float uScale;
varying vec2 vQ;
varying float vH, vReach, vHeat;
void main() {
  vec2 q = vec2(sign(vQ.x) * max(abs(vQ.x) - vH, 0.0), vQ.y);
  float x2 = dot(q, q) / (vReach * vReach);
  if (x2 >= 1.0) discard;
  float f = (1.0 - x2) * (1.0 - x2) * uScale;
  gl_FragColor = vec4(f, f * vHeat, 0.0, 0.0);
}`;

/* 合成：過了 ISO 是火（熱度照場多深 × 平均熱度），差一點是墨線，再外面丟掉。 */
const SHOW_FRAG = /* glsl */ `
uniform sampler2D uField;
uniform vec2 uRes;      // 畫面多少像素
uniform vec2 uTexel;    // 場那張圖的一格（uv）
uniform float uScale, uInkPx;
float field(vec2 uv) { return texture2D(uField, uv).r / uScale; }
${TAIL_HEAT_FN}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes, tx = uTexel;
  vec4 t = texture2D(uField, uv);
  float f = t.r / uScale;
  // 場在畫面上每個像素變多少（圖是畫面的一半，一格是 uRes·tx 個像素）。
  vec2 g = vec2(field(uv + vec2(tx.x, 0.0)) - field(uv - vec2(tx.x, 0.0)),
                field(uv + vec2(0.0, tx.y)) - field(uv - vec2(0.0, tx.y))) / (2.0 * uRes * tx);
  float slope = max(length(g), 1e-5);
  if (f < ${f2(ISO)}) {
    if ((${f2(ISO)} - f) / slope > uInkPx) discard;
    gl_FragColor = vec4(${INK_VEC}, 1.0);
    return;
  }
  float heat = tailHeat(t);
  gl_FragColor = vec4(${TONE('heat')}, 1.0);
}`;

/** 畫得到半浮點的圖嗎（跟 blood.js 同一個條件）。 */
const floatOk = (r) => r.capabilities.isWebGL2
  && (r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float'));

const _size = new THREE.Vector2(), _clear = new THREE.Color();

/**
 * 場上飛著的火球與它們噴出來的火粒。每幀 draw 一次（在 renderer.render 之前：尾巴
 * 的場要先畫），setInkPx 跟狗的墨線一起調。一顆火球一個球的 mesh（火與墨線兩個），
 * 不夠就多做；火粒全部火球共用一批。每一顆火球的噴口跟著 world.shots 裡那一個物件
 * 走（WeakMap）。
 */
export class Fireballs {
  /** radius：球的半徑（SKILL.orb.radius）。renderer：畫尾巴的場用，沒給就沒有尾巴。 */
  constructor(scene, radius, renderer = null) {
    this.scene = scene;
    this.radius = radius;
    this.renderer = renderer;
    this._pool = [];
    this._state = new WeakMap();
    this.drops = [];

    this._inkOut = { value: 0 };
    const tail = {
      uField: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2(1, 1) },
      uScale: { value: 1 }, uTail: { value: 0 }, uInkPx: { value: 2 }, uViewH: { value: 900 },
    };
    this._tail = tail;
    this._fire = new THREE.ShaderMaterial({ vertexShader: BALL_VERT, fragmentShader: BALL_FRAG, uniforms: tail });
    this._ink = new THREE.ShaderMaterial({
      vertexShader: INK_VERT, fragmentShader: INK_FRAG,
      uniforms: { uInkOut: this._inkOut, ...tail }, side: THREE.BackSide,
    });

    // 球的輪廓每幀借用的暫存。
    const n = U_BALL + 1;
    this._z = new Float32Array(n); this._r = new Float32Array(n);
    this._nz = new Float32Array(n); this._nr = new Float32Array(n);
    this._crest = new Float32Array(n);

    // 先做好一顆藏著：著色器在第一顆射出去之前就編得到、畫得到（fight.js 的 _compile）。
    this._more();

    if (!renderer) return;
    const half = floatOk(renderer);
    tail.uScale.value = half ? 1 : 0.25;
    this._rt = new THREE.WebGLRenderTarget(1, 1, {
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    tail.uField.value = this._rt.texture;
    tail.uTail.value = 1;

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this._a = {};
    for (const [name, size] of [['iPos', 3], ['iVel', 3], ['iR', 1], ['iHeat', 1]]) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      this._a[name] = a;
    }
    g.instanceCount = 0;
    this._g = g;

    /* 場：疊加、不做深度測試（被擋住的那幾顆也要算進形狀裡，擋不擋是合成那一步的事）。 */
    this._fieldScene = new THREE.Scene();
    const field = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: DROP_VERT('0.0'), fragmentShader: FIELD_FRAG, uniforms: tail,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, transparent: true,
    }));
    field.frustumCulled = false;
    this._fieldScene.add(field);
    /* 合成：每一顆的方片往外多留墨線那幾個像素。 */
    const show = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: DROP_VERT('(uInkPx + 2.0) * px'), fragmentShader: SHOW_FRAG, uniforms: tail,
    }));
    show.frustumCulled = false;
    scene.add(show);
  }

  /** 墨線在畫面上多寬（像素）、畫面多高——跟狗的墨線一樣（critter.js 的 setInkPx）。 */
  setInkPx(px, h) {
    this._inkOut.value = (2 * px) / Math.max(1, h);
    this._tail.uInkPx.value = px;
    this._tail.uViewH.value = Math.max(1, h);
  }

  /** 往前一幀：流體往後推、噴火粒、推火粒，擺好每一顆球，畫尾巴的場。camera：主畫面那一台。 */
  draw(dt, shots, camera) {
    while (this._pool.length < shots.length) this._more();
    const alive = new Set(shots);
    this._pool.forEach((slot, i) => {
      const s = shots[i];
      slot.node.visible = !!s;
      if (!s) return;
      let st = this._state.get(s);
      if (!st) {
        st = { t: 0, core: 0, tongues: Array.from({ length: TONGUES }, () => this._aim({})) };
        this._state.set(s, st);
      }
      st.t += dt;
      this._ball(slot.g, st.t);
      slot.node.position.set(s.x, s.y, s.z);
      slot.node.rotation.y = Math.atan2(s.vx, s.vz);
      if (this.renderer) this._emit(s, st, dt);
    });
    if (!this.renderer) return;
    this._step(dt, alive);
    this._field(camera);
  }

  /** 多做一顆球（藏著，放進池子）。 */
  _more() {
    const g = ballGeometry();
    const node = new THREE.Group();
    for (const mat of [this._fire, this._ink]) {
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false;            // 每幀改形狀，three 的邊界球跟不上
      node.add(m);
    }
    node.visible = false;
    this.scene.add(node);
    this._pool.push({ node, g });
  }

  /** 一個火舌噴口換方向：抽方向、噴多久、多密。 */
  _aim(t) {
    t.ang = Math.random() * Math.PI * 2;
    t.left = pick(TONGUE.dur);
    t.rate = pick(TONGUE.rate);
    t.acc = 0;
    return t;
  }

  /** 這一幀球 s 噴幾顆：芯照固定的密度，火舌照各自噴口的方向與密度，噴完換方向。 */
  _emit(s, st, dt) {
    st.core += CORE.rate * dt;
    for (; st.core >= 1; st.core--) this._spawn(s, CORE, Math.random() * Math.PI * 2, 0);
    for (const t of st.tongues) {
      t.acc += t.rate * dt;
      for (; t.acc >= 1; t.acc--) this._spawn(s, TONGUE, t.ang + (Math.random() - 0.5) * 0.3, 1);
      t.left -= dt;
      if (t.left <= 0) this._aim(t);
    }
  }

  /**
   * 噴一顆：kind 是哪一種噴口，ang 是繞著前進軸的方向，rim 是離軸多遠（0 在軸上，1 貼著
   * 最大圓周內側：外緣剛好在球的輪廓上）。位置與速度照球這一刻的朝向轉到世界裡。
   */
  _spawn(s, kind, ang, rim) {
    if (this.drops.length >= MAX_DROPS) return;
    const R = this.radius, r = pick(kind.r);
    const off = rim * (1 - r), back = pick(kind.back), side = pick(kind.side), keep = pick(kind.keep);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    // 球的座標（x、y 繞著軸，z 往前）→ 世界：繞 y 轉 yaw。
    const sp = Math.hypot(s.vx, s.vz) || 1, fx = s.vx / sp, fz = s.vz / sp;
    const toWorld = (x, y, z) => [x * fz + z * fx, y, -x * fx + z * fz];
    const [px, py, pz] = toWorld(ca * off, sa * off, -back);
    const [sx, sy, sz] = toWorld(ca * side, sa * side, 0);
    const rel = [sx * R - s.vx * (1 - keep), sy * R, sz * R - s.vz * (1 - keep)];
    this.drops.push({
      x: s.x + px * R, y: s.y + py * R, z: s.z + pz * R,
      vx: s.vx + rel[0], vy: rel[1], vz: s.vz + rel[2], rel,
      r0: r * R, life: pick(kind.life), age: 0, heat: TAIL_HOT, shot: s,
    });
  }

  /**
   * 球 s 在它現在的地方炸開：正中間一顆大的閃光，外加一圈往四面八方噴的火粒。球本身
   * 已經不在 world.shots 裡了（下一幀起不畫），還沒散完的尾巴照舊散掉。
   */
  explode(s) {
    if (!this.renderer) return;
    const R = this.radius;
    const add = (d) => { if (this.drops.length < MAX_DROPS) this.drops.push(d); };
    const still = { x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, rel: null, age: 0, heat: BOOM.heat, boom: true };
    add({ ...still, r0: BOOM.flash.r * R, life: BOOM.flash.life });
    for (let i = 0; i < BOOM.n; i++) {
      // 球面上均勻的方向。
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, h = Math.sqrt(1 - u * u);
      const v = pick(BOOM.speed) * R;
      add({
        ...still, vx: Math.cos(a) * h * v, vy: u * v, vz: Math.sin(a) * h * v,
        r0: pick(BOOM.r) * R, life: pick(BOOM.life), drag: BOOM.drag, rise: BOOM.rise,
      });
    }
  }

  /** 推每一顆火粒、收掉散完的，寫進實例屬性。 */
  _step(dt, alive) {
    const A = this._a;
    this.drops = this.drops.filter((d) => {
      d.age += dt * (d.boom || alive.has(d.shot) ? 1 : ORPHAN);
      if (d.drag) {
        const k = Math.exp(-d.drag * dt);
        d.vx *= k; d.vy *= k; d.vz *= k;
      }
      if (d.rise) d.vy += d.rise * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      return d.age < d.life;
    });
    this.drops.forEach((d, i) => {
      const k = d.age / d.life;
      A.iPos.setXYZ(i, d.x, d.y, d.z);
      // 尾巴照相對於球的速度拉長，爆炸的照自己的速度（往外噴的方向）。
      if (d.rel) A.iVel.setXYZ(i, d.rel[0], d.rel[1], d.rel[2]);
      else A.iVel.setXYZ(i, d.vx, d.vy, d.vz);
      A.iR.setX(i, d.r0 * Math.pow(1 - k, d.boom ? 1 : 0.7));   // 爆炸的縮得快一點：散的時候不會剩一地小點
      A.iHeat.setX(i, d.heat * (1 - k));
    });
    for (const k in A) A[k].needsUpdate = true;
    this._g.instanceCount = this.drops.length;
  }

  /** 畫尾巴的場：畫面一半的解析度，清成 0 再把每一顆疊上去。 */
  /**
   * 尾巴的場先空畫一次（fight.js 的 _compile）：沒有火粒的時候平常不畫，著色器要等第一顆球噴出
   * 火粒才編，就頓在那一幀。沒有火粒，畫出來是空的（每一幀都會再清）。
   */
  compile(camera) {
    if (!this.renderer) return;
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(this._rt);
    r.render(this._fieldScene, camera);
    r.setRenderTarget(prev);
  }

  _field(camera) {
    const r = this.renderer, u = this._tail;
    r.getDrawingBufferSize(_size);
    const w = Math.max(1, Math.ceil(_size.x / 2)), h = Math.max(1, Math.ceil(_size.y / 2));
    if (this._rt.width !== w || this._rt.height !== h) this._rt.setSize(w, h);
    u.uRes.value.copy(_size);
    u.uTexel.value.set(1 / w, 1 / h);
    camera.updateMatrixWorld();

    const prev = r.getRenderTarget(), color = r.getClearColor(_clear), alpha = r.getClearAlpha();
    r.setRenderTarget(this._rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    if (this.drops.length) {
      const autoClear = r.autoClear;
      r.autoClear = false;
      r.render(this._fieldScene, camera);
      r.autoClear = autoClear;
    }
    r.setRenderTarget(prev);
    r.setClearColor(color, alpha);
  }

  /** 球：前半球上的每一圈流體鼓起來，走到赤道收掉。t：這一顆的時鐘。 */
  _ball(g, t) {
    const { _z: z, _r: r, _nz: nz, _nr: nr, _crest: crest } = this;
    for (let i = 0; i <= U_BALL; i++) {
      const th = (Math.PI * i) / U_BALL;
      let bump = 0, top = 0;
      for (let k = 0; k < RINGS; k++) {
        const q0 = t / SWEEP + k / RINGS, q = q0 - Math.floor(q0);   // 在前半球上走了幾成
        const b = bell((th - q * (Math.PI / 2)) / RING_W) * smooth(0, 0.45, q) * (1 - smooth(0.8, 1, q));
        bump += b;
        top = Math.max(top, b);
      }
      const d = RING_H * bump * (0.3 + 0.7 * Math.sin(th));
      z[i] = Math.cos(th) * (1 + d); r[i] = Math.sin(th) * (1 + d);
      crest[i] = top;
    }
    r[0] = r[U_BALL] = 0;
    // 2D 輪廓的法線（z, r）：切線轉 90°，兩頭固定朝前、朝後。
    for (let i = 0; i <= U_BALL; i++) {
      const a = Math.max(0, i - 1), b = Math.min(U_BALL, i + 1);
      const dz = z[b] - z[a], dr = r[b] - r[a], l = Math.hypot(dz, dr) || 1;
      nz[i] = dr / l; nr[i] = -dz / l;
    }
    nz[0] = 1; nr[0] = 0; nz[U_BALL] = -1; nr[U_BALL] = 0;

    const R = this.radius, A = g.attributes;
    for (let i = 0; i <= U_BALL; i++) {
      const th = (Math.PI * i) / U_BALL, cz = Math.cos(th), sr = Math.sin(th);
      for (let j = 0; j <= SEG; j++) {
        const v = i * (SEG + 1) + j, c = COS[j], s = SIN[j];
        A.position.setXYZ(v, r[i] * c * R, r[i] * s * R, z[i] * R);
        A.normal.setXYZ(v, nr[i] * c, nr[i] * s, nz[i]);
        A.aBase.setXYZ(v, sr * c, sr * s, cz);
        A.aCrest.setX(v, crest[i]);
      }
    }
    for (const k in A) A[k].needsUpdate = true;
  }
}
