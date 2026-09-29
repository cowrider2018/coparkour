/* ── test/src/blood.js ───────────────────────────────────────────────
   怪物挨打噴出來的血：畫出來（規則——噴多少、往哪裡、落到哪裡——在 bleed.js）。

   跟狗同一種畫法：平塗、硬邊、外面一圈墨線。

   ── 血滴是 metaball ──────────────────────────────────────────────
   所有的血滴合成一個形狀：靠得近的黏在一起，拉開了才斷成一顆一顆，而描邊與
   亮暗是照合起來的那個形狀算一次，不是每一滴各描一圈——兩滴黏在一起的地方
   沒有線。分兩步：

     場    每一滴在一張離屏的圖（畫面一半的解析度）上疊一份場值：離牠多遠的
           一個平滑的鐘形，(1 − x²)²，x 是到那一滴的距離除以影響半徑，出了
           影響半徑就是 0。距離量的是到一條線段的距離：順著這一滴在畫面上的
           速度拉長（STRETCH 秒走的距離），頭在牠現在的位置、尾巴拖在後面，
           飛得快的是一條，慢下來縮回一顆。全部加起來。
     合成  在主畫面裡把同一批方片（放大到蓋得住墨線）再畫一次，每一個像素讀
           那張圖：場值過了 ISO 是血；差一點的地方是墨線——差多少除以場在
           畫面上的斜率，就是離邊緣幾個像素，所以墨線跟狗的一樣寬、遠近一樣粗；
           再外面丟掉。

   場只在所有影響半徑的聯集裡不是 0，形狀與墨線都落在那裡面，所以合成的時候
   只畫那些方片就夠，不必鋪滿整個畫面。方片擺在每一滴自己的深度、照常做深度
   測試：血在怪物身體後面的那一段被身體擋住。

   亮暗：法線照場在畫面上的斜率——斜率的方向是往外，邊緣躺平、越往裡面越朝
   鏡頭（照場值過了 ISO 多少）——跟主光（palette.js 的 KEY_DIR）硬切成暗、亮、
   反光三階。整個形狀共用這一個法線場，黏在一起的地方亮暗也是連著的。

   一顆單獨的血滴，場值等於 ISO 的地方在影響半徑的 0.54 倍：影響半徑是半徑
   除以它，所以單獨一顆看起來正好是 bleed.js 給的那麼大。

   畫不出浮點圖的機器，場存成 8 位元（先乘 1/4，讀回來再乘回去）。

   ── 兩種血（bleed.js 的 STYLE）──────────────────────────────────
   血與幽靈的靈質各在場那張圖的一個通道（r、g）：各自融合，不會黏在一起。

   血是不透明的，照上面那樣每一滴的方片各畫一次，疊到的地方畫兩次也是同一個顏色。
   靈質是半透明的白色，這樣畫就不行了——兩張方片疊到的地方會混兩次、變濃，整片
   就不再是「同一個形狀」。所以靈質合成的時候只畫一張蓋滿畫面的方片，每個像素
   一次。深度：場那一步順便在 a 通道記下蓋到這個像素的靈質裡最靠近鏡頭的那一滴
   （1 / (1 + 距離)，混色取最大），合成的時候寫回 gl_FragDepth，照樣被前面的東西
   擋住。8 位元的圖存不下深度，那種機器上靈質不做深度測試。

   ── 一灘 ────────────────────────────────────────────────────────
   貼在地板上的一片橢圓，順著落地的方向拉長，邊緣照角度起伏一點（每一灘相位
   不一樣），平塗一個顏色、不描墨線——它是地上的一塊顏色，不是一個東西。大小照
   bleed.js 的 splatScale 攤開、縮掉。排在地面之後畫（renderOrder），比地上的預告
   （fx.js，y = 0.03）低一點，預告蓋得過它。

   只有血會留一灘（靈質不會）：不透明、不寫深度。

   一種一個 InstancedBufferGeometry，每幀把還在的整批寫進去，一次畫完。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { KEY_DIR } from './palette.js';
import { INK_TONED } from './critter.js';
import { bleedStep, splatScale, dropSize } from './bleed.js';

/** 最多同時幾滴、幾灘。滴滿了新的不噴；灘滿了先收最舊的。 */
const MAX_DROPS = 320;
const MAX_SPLATS = 480;

/** 一滴拖多長：畫面上這麼多秒走的距離。 */
const STRETCH = 0.025;

/** 場值過了這個就是血。 */
const ISO = 0.5;
/** 影響半徑是半徑的幾倍：單獨一顆的場在 (1 − x²)² = ISO 的地方，x = √(1 − √ISO)。 */
const REACH = 1 / Math.sqrt(1 - Math.sqrt(ISO));
/** 場值過了 ISO 多少算是正對鏡頭（亮暗的法線用）。 */
const DEEP = 0.6;

/**
 * 每一種血的樣子（sRGB，照原樣寫進畫面，跟 qi.js 一樣）：暗面、亮面、反光、不透明度。
 * `ch` 是它在場那張圖的哪一個通道。
 */
const LOOK = {
  blood: { ch: 0, shade: [0.46, 0.02, 0.05], lit: [0.80, 0.06, 0.08], glint: [0.98, 0.52, 0.50], alpha: 1 },
  ecto: { ch: 1, shade: [0.72, 0.80, 0.92], lit: [0.95, 0.97, 1.0], glint: [1.0, 1.0, 1.0], alpha: 0.55 },
};
/** 地上的一灘（只有血會留）。 */
const POOL = [0.38, 0.02, 0.04];
/** 亮暗、反光的分界（法線與主光的 cos）。 */
const EDGE = [0.15, 0.93];

/** 一灘離地板多高：比預告（0.03）低。 */
const POOL_LIFT = 0.02;

const vec3 = (c) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`;
const f2 = (v) => v.toFixed(2);
const INK_SRGB = INK_TONED.clone().convertLinearToSRGB();

/*
 * 兩步共用的頂點著色：朝著鏡頭的方片，拉長成那一滴的膠囊，往外多留 pad。
 * skip：哪幾滴不畫（GLSL 的條件；血的合成不畫靈質，靈質另外畫）。
 */
const BLOB_VERT = (pad, skip = 'false') => /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute float iR;
attribute float iStyle;
uniform float uInkPx, uViewH;
varying vec2 vQ;
varying float vH, vReach, vStyle, vDist;
void main() {
  if (${skip}) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 c = viewMatrix * vec4(iPos, 1.0);
  vec2 vv = (mat3(viewMatrix) * iVel).xy;
  float L = length(vv) * ${STRETCH.toFixed(3)};
  vec2 u = L > 1e-5 ? vv / length(vv) : vec2(1.0, 0.0), n = vec2(-u.y, u.x);
  // 這個深度上一個像素多少公尺。
  float px = -c.z * 2.0 / (projectionMatrix[1][1] * uViewH);
  float h = 0.5 * L, reach = iR * ${REACH.toFixed(4)}, ext = reach + ${pad};
  vec2 q = vec2(position.x * (h + ext), position.y * ext);
  vDist = -c.z;
  c.xy += -u * h + u * q.x + n * q.y;      // 頭在 iPos，尾巴拖在後面
  vQ = q; vH = h; vReach = reach; vStyle = iStyle;
  gl_Position = projectionMatrix * c;
}`;

/* 場：r 是血、g 是靈質（加起來），a 是靈質最靠近鏡頭的那一滴（取最大）。 */
const FIELD_FRAG = /* glsl */ `
uniform float uScale;
varying vec2 vQ;
varying float vH, vReach, vStyle, vDist;
void main() {
  vec2 q = vec2(sign(vQ.x) * max(abs(vQ.x) - vH, 0.0), vQ.y);
  float x2 = dot(q, q) / (vReach * vReach);
  if (x2 >= 1.0) discard;
  float f = (1.0 - x2) * (1.0 - x2) * uScale;
  bool ecto = vStyle > 0.5;
  gl_FragColor = vec4(ecto ? 0.0 : f, ecto ? f : 0.0, 0.0, ecto ? 1.0 / (1.0 + vDist) : 0.0);
}`;

/**
 * 合成的片段著色：讀場那一種的通道，過了 ISO 是那一種的顏色，差一點是墨線。
 * depth：從 a 通道寫回 gl_FragDepth（靈質那一張蓋滿畫面的方片用）。
 */
const showFrag = (look, depth) => /* glsl */ `
uniform sampler2D uField;
uniform vec2 uRes;      // 畫面多少像素
uniform vec2 uTexel;    // 場那張圖的一格（uv）
uniform float uScale, uInkPx;
uniform vec3 uLight;    // 主光（視空間）
${depth ? 'uniform mat4 projectionMatrix;   // three 只替頂點著色器宣告它\n' : ''}float field(vec2 uv) { return texture2D(uField, uv)[${look.ch}] / uScale; }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 tx = uTexel;
  float f = field(uv);
${depth ? `  // 深度：最靠近鏡頭的那一滴（1 / (1 + 距離)）換回深度緩衝的值。
  float near = texture2D(uField, uv).a;
  if (near <= 0.0) discard;
  float zv = 1.0 - 1.0 / near;
  gl_FragDepth = 0.5 * (projectionMatrix[2][2] * zv + projectionMatrix[3][2]) / -zv + 0.5;
` : ''}  // 場在畫面上每個像素變多少（圖是畫面的一半，一格是 uRes·tx 個像素）。
  vec2 g = vec2(field(uv + vec2(tx.x, 0.0)) - field(uv - vec2(tx.x, 0.0)),
                field(uv + vec2(0.0, tx.y)) - field(uv - vec2(0.0, tx.y))) / (2.0 * uRes * tx);
  float slope = max(length(g), 1e-5);
  if (f < ${f2(ISO)}) {
    if ((${f2(ISO)} - f) / slope > uInkPx) discard;
    gl_FragColor = vec4(${vec3([INK_SRGB.r, INK_SRGB.g, INK_SRGB.b])}, ${f2(look.alpha)});
    return;
  }
  // 法線：往外是斜率的反方向，邊緣躺平、越往裡面越朝鏡頭。
  float deep = clamp((f - ${f2(ISO)}) / ${f2(DEEP)}, 0.0, 1.0);
  vec3 nrm = vec3(-g / slope * sqrt(1.0 - deep * deep), deep);
  float l = dot(normalize(nrm), uLight);
  vec3 col = l > ${f2(EDGE[1])} ? ${vec3(look.glint)} : l > ${f2(EDGE[0])} ? ${vec3(look.lit)} : ${vec3(look.shade)};
  gl_FragColor = vec4(col, ${f2(look.alpha)});
}`;

/** 蓋滿畫面的一張方片：頂點直接就是裁切座標。 */
const SCREEN_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const SPLAT_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iShape;  // 拉長的方向 (x, z)、順著它的半長、橫著的半寬
attribute float iSeed;
varying vec2 vP;
varying float vSeed;
void main() {
  vec2 a = iShape.xy, b = vec2(-a.y, a.x);
  vec2 w = a * position.x * iShape.z * 1.2 + b * position.y * iShape.w * 1.2;
  vP = position.xy * 1.2; vSeed = iSeed;
  gl_Position = projectionMatrix * viewMatrix * vec4(iPos + vec3(w.x, ${POOL_LIFT.toFixed(3)}, w.y), 1.0);
}`;

const SPLAT_FRAG = /* glsl */ `
varying vec2 vP;
varying float vSeed;
void main() {
  float a = atan(vP.y, vP.x);
  float edge = 1.0 + 0.10 * sin(5.0 * a + vSeed) + 0.06 * sin(9.0 * a + 2.3 * vSeed);
  if (length(vP) > edge) discard;
  gl_FragColor = vec4(${vec3(POOL)}, 1.0);
}`;

/** 一張 -1～1 的方片（position 的 xy 是角落），外加每一個實例的屬性。 */
function quads(max, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const out = {};
  for (const [name, size] of Object.entries(attrs)) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
    out[name] = a;
  }
  g.instanceCount = 0;
  return { g, a: out };
}

/** 畫得到半浮點的圖嗎（跟 fluid.js 的 Fluid.supported 同一個條件）。 */
const floatOk = (r) => r.capabilities.isWebGL2
  && (r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float'));

const _light = new THREE.Vector3(), _size = new THREE.Vector2(), _clear = new THREE.Color();

/**
 * 場上的血：噴出去的每一滴與地上的每一灘。spurt 噴、每幀 step（在 renderer.render
 * 之前：場那一步要先畫）、clear 全收。沒給 renderer 的話血滴畫不出來，只有一灘。
 */
export class Blood {
  constructor(scene, renderer) {
    this.drops = [];
    this.splats = [];
    this.renderer = renderer || null;

    const D = quads(MAX_DROPS, { iPos: 3, iVel: 3, iR: 1, iStyle: 1 });
    this._d = D;
    if (this.renderer) {
      const half = floatOk(this.renderer);
      this._scale = half ? 1 : 0.25;
      this._rt = new THREE.WebGLRenderTarget(1, 1, {
        type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
      });
      const ink = { uInkPx: { value: 2 }, uViewH: { value: 900 } };
      this._ink = ink;
      /* 場：疊加（a 取最大）、不做深度測試（被擋住的那幾滴也要算進形狀裡，擋不擋是
         合成那一步的事）。 */
      const fieldMat = new THREE.ShaderMaterial({
        vertexShader: BLOB_VERT('0.0'), fragmentShader: FIELD_FRAG,
        uniforms: { ...ink, uScale: { value: this._scale } },
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        blendEquationAlpha: THREE.MaxEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
        depthTest: false, depthWrite: false, transparent: true,
      });
      this._fieldScene = new THREE.Scene();
      const field = new THREE.Mesh(D.g, fieldMat);
      field.frustumCulled = false;
      this._fieldScene.add(field);
      /* 合成用的 uniform 兩種血共用一份。 */
      const shared = {
        ...ink, uScale: { value: this._scale }, uField: { value: this._rt.texture },
        uRes: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2(1, 1) },
        uLight: { value: new THREE.Vector3(0, 0, 1) },
      };
      this._shared = shared;
      /* 血：每一滴的方片往外多留墨線那幾個像素；靈質的那幾滴不畫。 */
      const show = new THREE.Mesh(D.g, new THREE.ShaderMaterial({
        vertexShader: BLOB_VERT('(uInkPx + 2.0) * px', 'iStyle > 0.5'),
        fragmentShader: showFrag(LOOK.blood, false), uniforms: shared,
      }));
      show.frustumCulled = false;
      scene.add(show);
      /* 靈質：一張蓋滿畫面的方片，半透明，每個像素混一次。 */
      this._ecto = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        vertexShader: SCREEN_VERT, fragmentShader: showFrag(LOOK.ecto, true), uniforms: shared,
        transparent: true, depthWrite: false, depthTest: half,
      }));
      this._ecto.frustumCulled = false;
      this._ecto.renderOrder = 6;           // 半透明的怪物（monster.js，5）之後
      this._ecto.visible = false;
      scene.add(this._ecto);
    }

    const S = quads(MAX_SPLATS, { iPos: 3, iShape: 4, iSeed: 1 });
    this._s = S;
    const splats = new THREE.Mesh(S.g, new THREE.ShaderMaterial({
      vertexShader: SPLAT_VERT, fragmentShader: SPLAT_FRAG, depthWrite: false, side: THREE.DoubleSide,
    }));
    splats.renderOrder = 1;                 // 地面（renderOrder 0）之後：不寫深度，先畫會被地面蓋掉
    splats.frustumCulled = false;
    scene.add(splats);
  }

  /** 墨線多粗（像素）、畫面多高——跟狗的墨線一樣，fight.js 的 setInkPx 轉給這裡。 */
  setInkPx(px, h) {
    if (!this._ink) return;
    this._ink.uInkPx.value = px;
    this._ink.uViewH.value = Math.max(1, h);
  }

  /** 噴一次（bleed.js 的 spurtOf 給的那一批）。field：噴在哪一場，落地與撞牆照它的碰撞體。 */
  spurt(list, field) {
    for (const o of list) if (this.drops.length < MAX_DROPS) this.drops.push({ ...o, t: 0, field });
  }

  /** 往前一幀：推每一滴、每一灘，寫進網格，畫場。camera：主畫面那一台。 */
  step(dt, camera) {
    const before = this.splats.length;
    bleedStep(this.drops, this.splats, dt);
    for (let i = before; i < this.splats.length; i++) this.splats[i].seed = Math.random() * 6.283;
    if (this.splats.length > MAX_SPLATS) this.splats.splice(0, this.splats.length - MAX_SPLATS);

    const D = this._d.a;
    let ecto = false;
    this.drops.forEach((o, i) => {
      const look = LOOK[o.style || 'blood'];
      D.iPos.setXYZ(i, o.x, o.y, o.z);
      D.iVel.setXYZ(i, o.vx, o.vy, o.vz);
      D.iR.setX(i, dropSize(o));
      D.iStyle.setX(i, look.ch);
      if (look.ch) ecto = true;
    });
    for (const k in D) D[k].needsUpdate = true;
    this._d.g.instanceCount = this.drops.length;
    if (this._ecto) this._ecto.visible = ecto;
    if (this.renderer && this.drops.length) this._field(camera);

    const S = this._s.a;
    this.splats.forEach((p, i) => {
      const k = splatScale(p.t);
      S.iPos.setXYZ(i, p.x, p.y, p.z);
      S.iShape.setXYZW(i, p.ax, p.az, p.r * p.long * k, p.r * k);
      S.iSeed.setX(i, p.seed);
    });
    for (const k in S) S[k].needsUpdate = true;
    this._s.g.instanceCount = this.splats.length;
  }

  /** 畫場：畫面一半的解析度，清成 0 再把每一滴疊上去。 */
  _field(camera) {
    const r = this.renderer;
    r.getDrawingBufferSize(_size);
    const w = Math.max(1, Math.ceil(_size.x / 2)), h = Math.max(1, Math.ceil(_size.y / 2));
    if (this._rt.width !== w || this._rt.height !== h) this._rt.setSize(w, h);
    const u = this._shared;
    u.uRes.value.copy(_size);
    u.uTexel.value.set(1 / w, 1 / h);
    camera.updateMatrixWorld();
    u.uLight.value.copy(_light.copy(KEY_DIR).transformDirection(camera.matrixWorldInverse));

    const prev = r.getRenderTarget(), color = r.getClearColor(_clear), alpha = r.getClearAlpha();
    r.setRenderTarget(this._rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    const autoClear = r.autoClear;
    r.autoClear = false;
    r.render(this._fieldScene, camera);
    r.autoClear = autoClear;
    r.setRenderTarget(prev);
    r.setClearColor(color, alpha);
  }

  /** 全部收掉（回到站位、換陣容）。 */
  clear() {
    this.drops.length = 0;
    this.splats.length = 0;
    this._d.g.instanceCount = 0;
    this._s.g.instanceCount = 0;
    if (this._ecto) this._ecto.visible = false;
  }
}
