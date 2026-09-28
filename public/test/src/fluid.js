/* ── test/src/fluid.js ───────────────────────────────────────────────
   共用的流體場：一張 GPU 上的二維流體模擬，切成幾格，給會冒煙的特效借。

   ── 為什麼是一張而不是每個特效一張 ──────────────────────────────
   模擬的成本在「每幀跑幾個 pass、每個 pass 幾個像素」，跟格子裡有沒有煙
   無關。所以把所有的煙擠在同一張圖上：落地的塵、之後 BOSS 圓圈技能的煙
   各借一格（`acquire`），一幀一律是同一串 pass——特效再多，成本不變。
   整張圖上都沒有煙的時候（最後一次注入過了 `sleep` 秒）整串跳過，不花任何
   東西。

   ── 一格是什麼 ──────────────────────────────────────────────────
   一格就是一片正方形的二維空間，放在世界裡的哪裡、朝哪邊，是借它的那個
   特效的事（`Sheet`：一片擺在世界裡的方格，上面畫那一格的煙）。流體場
   只認格子自己的座標：(0, 0) 到 (1, 1)，叫「格內座標」。

   格子與格子之間不相通：每一個 pass 取鄰居的時候都夾在自己那一格裡面
   （`inTile`），所以一格的邊就是一道牆，煙不會流進別人那一格。

   ── 一幀 ────────────────────────────────────────────────────────
   Stable Fluids（Jos Stam）的那一套，照 Pavel Dobryakov 的 WebGL 版本排：
     渦度     算 curl、把渦旋推回去（vorticity confinement）——不然數值黏性
              會把捲起來的那幾圈很快抹平，看起來像糖漿不像煙
     投影     Jacobi 解壓力 `jacobi` 次（散度在每一步裡算）、扣掉壓力的梯度——
              讓流場不可壓縮，捲起來的地方才會是一圈一圈的渦
     平流     速度沿自己平流、濃度沿速度平流，各帶一點消散；這一幀排進來的
              注入在同一個 pass 裡一次加上去
   一共 1 + jacobi + 1 + 2 個 pass，有沒有注入都一樣。
   速度用 `sim` 見方一格，濃度用比較細的 `dye`：渦旋的大小由速度的格子決定，
   煙的邊有多銳利由濃度的格子決定，後者只多一個平流的 pass。

   ── 成本 ────────────────────────────────────────────────────────
   一個 pass 的成本幾乎全在「換一次畫到哪張圖」，跟圖多大、取幾次值關係不大
   （Iris Xe 內顯上 8×8 與 256² 都是一個 pass 約 0.1ms）。所以醒著的時候一幀
   大約是 pass 數 × 0.1ms，格子切多細、同時有幾格在冒煙都不影響；要省就是
   少幾個 pass——能併進別的 pass 的計算（curl、散度、注入）都併了。

   單位：速度是「速度格子的格數 / 秒」，壓力與散度用速度格子當長度單位——
   Pavel 那一版的常數（渦度強度、消散）就是這個單位下調的，照搬就對得上。

   瀏覽器不能畫到半浮點的貼圖上（沒有 EXT_color_buffer_float / _half_float）
   的話，`Fluid.supported` 是 false，用得到它的地方退回不用流體的畫法。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { KEY_DIR, INK } from './palette.js';

/** 流體場的大小與手感。 */
export const FLUID = {
  /** 一邊幾格：grid² 格可以同時有煙。落地的粉塵一團一格，一套連段加上幾隻被打飛
      落地的怪物就是五六格。 */
  grid: 3,
  /** 一格的速度格子幾見方。渦旋最小就是幾格大，所以這個數決定擾動的尺寸：
      64 在 7 公尺見方的一片上是一格 11 公分，捲起來的是大而少的渦；128 的話
      渦小一半、多一倍，一片細碎。 */
  sim: 64,
  /** 一格的濃度格子幾見方。 */
  dye: 256,
  /** 解壓力幾次。少了流場不夠不可壓縮（渦變成往外散），多了就是多幾個 pass。 */
  jacobi: 10,
  /** 渦度推回去多強。 */
  curl: 14,
  /** 速度與濃度每秒消散多少（/(1 + k·dt)）。 */
  velDecay: 0.8,
  dyeDecay: 1.6,
  /** 上一次注入之後幾秒整張圖停下來。這時候濃度已經剩不到百分之一。 */
  sleep: 2.5,
  /** 一幀最多幾筆注入（多的丟掉）。一團落地的塵一幀 8 筆，同一幀落地的最多四團。 */
  splats: 32,
};

/* ── 著色器 ──────────────────────────────────────────────────────── */

/** 全畫面的那一個三角形：position 就是裁切座標。 */
const PASS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** 每個 pass 都要的：這個像素在哪一格、把一個座標夾進那一格裡。 */
const TILE_GLSL = /* glsl */ `
uniform float uGrid;
uniform vec2 uTexel;
vec2 inTile(vec2 uv) {
  vec2 t = floor(vUv * uGrid) / uGrid;
  return clamp(uv, t + 0.5 * uTexel, t + 1.0 / uGrid - 0.5 * uTexel);
}`;

const pass = (body, uniforms = {}) => new THREE.ShaderMaterial({
  vertexShader: PASS_VERT,
  fragmentShader: `precision highp float;\nvarying vec2 vUv;\n${TILE_GLSL}\n${body}`,
  uniforms: { uGrid: { value: FLUID.grid }, uTexel: { value: new THREE.Vector2() }, ...uniforms },
  depthTest: false, depthWrite: false, blending: THREE.NoBlending,
});

/* 注入：一筆是一段線段（落地的塵是腳下那一圈的一段弧），不是一個點——一圈
   用點得排好幾十個才連得起來。離線段的距離取高斯，線段兩端的
   值線性內插。只畫在那一筆自己的格子裡。

   注入不自己一個 pass，併在平流的 pass 的最後（見 ADVECT）。 */
const SPLAT_GLSL = /* glsl */ `
#define N ${FLUID.splats}
uniform int uCount;
uniform vec4 uSeg[N];   // 兩端，圖上座標
uniform vec4 uVal[N];   // 兩端的值（速度：xy / zw；濃度：x / z）
uniform vec4 uInfo[N];  // 半徑（圖上座標）、格子的左下角 xy
float weight(int i, out float s) {
  vec2 a = uSeg[i].xy, ab = uSeg[i].zw - a;
  s = clamp(dot(vUv - a, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
  vec2 d = vUv - (a + ab * s);
  vec2 t = floor(vUv * uGrid) / uGrid;
  if (any(greaterThan(abs(t - uInfo[i].yz), vec2(1e-4)))) return 0.0;
  return exp(-dot(d, d) / (uInfo[i].x * uInfo[i].x));
}`;

/** 四個鄰居（夾在格子裡）。 */
const NEIGHBORS = /* glsl */ `
vec2 L() { return inTile(vUv - vec2(uTexel.x, 0.0)); }
vec2 R() { return inTile(vUv + vec2(uTexel.x, 0.0)); }
vec2 B() { return inTile(vUv - vec2(0.0, uTexel.y)); }
vec2 T() { return inTile(vUv + vec2(0.0, uTexel.y)); }`;

/* 渦度：curl 不另外畫一張圖，這一個 pass 自己在中心與四個鄰居各算一次（多取
   十幾次速度）。一個 pass 的成本幾乎全在「換一次畫到哪張圖」，不在取幾次值——
   8×8 的圖與 256² 的圖一個 pass 花的時間差不多——所以能併的 pass 都併。 */
const VORTICITY = pass(`uniform sampler2D uVel; uniform float uStrength; uniform float uDt;${NEIGHBORS}
float curlAt(vec2 p) {
  return 0.5 * (texture2D(uVel, inTile(p + vec2(uTexel.x, 0.0))).y - texture2D(uVel, inTile(p - vec2(uTexel.x, 0.0))).y
              - texture2D(uVel, inTile(p + vec2(0.0, uTexel.y))).x + texture2D(uVel, inTile(p - vec2(0.0, uTexel.y))).x);
}
void main() {
  float l = curlAt(L()), r = curlAt(R()), b = curlAt(B()), t = curlAt(T());
  float c = curlAt(vUv);
  vec2 f = 0.5 * vec2(abs(t) - abs(b), abs(r) - abs(l));
  f /= length(f) + 1e-4;
  f *= uStrength * c;
  f.y *= -1.0;
  vec2 v = texture2D(uVel, vUv).xy + f * uDt;
  gl_FragColor = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}`, { uVel: { value: null }, uStrength: { value: FLUID.curl }, uDt: { value: 0 } });

/* Jacobi 的一步，散度也在這裡算（理由同上）。uKeep 是上一幀的壓力留幾成當起點
   （第一步 0.8、之後 1）——從上一幀的解開始，十步就夠；從 0 開始要多得多。 */
const JACOBI = pass(`uniform sampler2D uP; uniform sampler2D uVel; uniform float uKeep;${NEIGHBORS}
void main() {
  float div = 0.5 * (texture2D(uVel, R()).x - texture2D(uVel, L()).x
                   + texture2D(uVel, T()).y - texture2D(uVel, B()).y);
  float s = texture2D(uP, L()).r + texture2D(uP, R()).r + texture2D(uP, B()).r + texture2D(uP, T()).r;
  gl_FragColor = vec4((s * uKeep - div) * 0.25, 0.0, 0.0, 1.0);
}`, { uP: { value: null }, uVel: { value: null }, uKeep: { value: 1 } });

const GRADIENT = pass(`uniform sampler2D uP; uniform sampler2D uVel;${NEIGHBORS}
void main() {
  vec2 g = 0.5 * vec2(texture2D(uP, R()).r - texture2D(uP, L()).r,
                      texture2D(uP, T()).r - texture2D(uP, B()).r);
  gl_FragColor = vec4(texture2D(uVel, vUv).xy - g, 0.0, 1.0);
}`, { uP: { value: null }, uVel: { value: null } });

/* 平流：從這個像素沿速度倒退 dt，取那裡的值。uStep 是速度格子的一格在圖上多長
   （速度的單位是速度格子的格數 / 秒）。平流完就地加上這一幀的注入：
     速度  往刀帶起來的速度拉過去，不是一直加上去——同一個地方被掃過好幾次也不會
           越來越快
     濃度  加上去，封頂 3 */
const advect = (inject) => pass(`${SPLAT_GLSL}
uniform sampler2D uVel; uniform sampler2D uSrc; uniform vec2 uStep; uniform float uDt; uniform float uDecay;
void main() {
  vec2 at = inTile(vUv - uDt * texture2D(uVel, vUv).xy * uStep);
  vec4 x = texture2D(uSrc, at) / (1.0 + uDecay * uDt);
  for (int i = 0; i < N; i++) {
    if (i >= uCount) break;
    float s, w = weight(i, s);
    ${inject}
  }
  gl_FragColor = x;
}`, {
  uVel: { value: null }, uSrc: { value: null }, uStep: { value: new THREE.Vector2() },
  uDt: { value: 0 }, uDecay: { value: 0 },
  uCount: { value: 0 }, uSeg: { value: [] }, uVal: { value: [] }, uInfo: { value: [] },
});
const ADVECT_VEL = advect('x.xy = mix(x.xy, mix(uVal[i].xy, uVal[i].zw, s), w);');
const ADVECT_DYE = advect('x.r = min(x.r + mix(uVal[i].x, uVal[i].z, s) * w, 3.0);');

/* ── 模擬 ───────────────────────────────────────────────────────── */

/** 一張可以畫、可以讀的貼圖。format 是 RedFormat（一個數）或 RGFormat（速度）。 */
function target(size, format) {
  return new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType, format,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
}

/** 兩張輪流：讀 read、畫到 write，畫完 swap。 */
function double(size, format) {
  return {
    read: target(size, format), write: target(size, format),
    swap() { [this.read, this.write] = [this.write, this.read]; },
  };
}

export class Fluid {
  /** 這台機器畫不畫得到半浮點的貼圖。不行的話就不要 new。 */
  static supported(renderer) {
    const x = renderer.extensions;
    return renderer.capabilities.isWebGL2 && (x.has('EXT_color_buffer_float') || x.has('EXT_color_buffer_half_float'));
  }

  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    const G = FLUID.grid, S = FLUID.sim * G, D = FLUID.dye * G;
    this.vel = double(S, THREE.RGFormat);
    this.dye = double(D, THREE.RedFormat);
    this.pressure = double(S, THREE.RedFormat);

    this._scene = new THREE.Scene();
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this._quad = new THREE.Mesh(tri);
    this._quad.frustumCulled = false;
    this._quad.matrixAutoUpdate = false;
    this._scene.add(this._quad);
    this._cam = new THREE.Camera();

    /** 每一格：誰借走的（任何東西，還的時候比對）與什麼時候借的。 */
    this._tiles = Array.from({ length: G * G }, () => ({ owner: null, since: -Infinity }));
    /** 這一幀排進來的注入。 */
    this._splats = [];
    /** 模擬自己的時鐘，與最後一次注入的時間（過了 sleep 秒就不跑）。 */
    this._now = 0;
    this._lastSplat = -Infinity;
    /** 需要清掉的格子（借出去的那一刻排進來，下一次 step 清）。 */
    this._dirty = new Set();
    /** 上一次 step 跑了幾個 pass（0 = 睡著）。給量成本用。 */
    this.passes = 0;
  }

  /** 濃度那張圖（Sheet 讀它）。每次 step 之後換一張，所以每幀重新拿。 */
  get texture() { return this.dye.read.texture; }

  /**
   * 借一格。格子都借光了就收回借得最久的那一格——煙最淡的那一格。
   * 借到的格子是乾淨的（速度、壓力、濃度都是 0）。
   *
   * @param {*} owner 還的時候比對用
   * @returns {number} 格子的編號
   */
  acquire(owner) {
    let best = 0;
    this._tiles.forEach((t, i) => {
      const b = this._tiles[best];
      if ((t.owner === null) !== (b.owner === null) ? t.owner === null : t.since < b.since) best = i;
    });
    this._tiles[best] = { owner, since: this._now };
    this._dirty.add(best);
    return best;
  }

  /** 還一格。已經被別人收走的話什麼都不做。 */
  release(tile, owner) {
    if (this._tiles[tile].owner === owner) this._tiles[tile].owner = null;
  }

  /** 這一格還是不是 owner 的（借得太久、被收走了就不是）。 */
  owns(tile, owner) { return this._tiles[tile].owner === owner; }

  /** 格子在圖上的左下角與邊長。 */
  tileRect(tile) {
    const G = FLUID.grid;
    return { x: (tile % G) / G, y: Math.floor(tile / G) / G, size: 1 / G };
  }

  /**
   * 排一筆注入：格內座標上從 a 到 b 的一段線段。
   *
   * @param {number} tile
   * @param {number[]} a 一端 [u, v]（格內座標）
   * @param {number[]} b 另一端
   * @param {number[]} va a 那一端帶起來的速度 [du, dv]（格內座標 / 秒）
   * @param {number[]} vb b 那一端的
   * @param {number} ca a 那一端注入多少濃度（1 大約是「看得很清楚」）
   * @param {number} cb b 那一端的
   * @param {number} radius 多粗（格內座標，高斯的寬）
   */
  splat(tile, a, b, va, vb, ca, cb, radius) {
    if (this._splats.length >= FLUID.splats) return;
    this._splats.push({ tile, a, b, va, vb, ca, cb, radius });
    this._lastSplat = this._now;
  }

  /** 醒著嗎：最後一次注入之後還沒過 sleep 秒。 */
  get awake() { return this._now - this._lastSplat < FLUID.sleep || this._splats.length > 0; }

  /** 往前推一幀。在 renderer.render 之前叫。 */
  step(dt) {
    this._now += dt;
    this.passes = 0;
    if (!this.awake && !this._dirty.size) return;
    const r = this.renderer;
    const prev = r.getRenderTarget(), autoClear = r.autoClear;
    r.autoClear = false;
    for (const tile of this._dirty) this._clear(tile);
    this._dirty.clear();
    if (this.awake) this._simulate(Math.min(dt, 1 / 30));
    r.setRenderTarget(prev);
    r.autoClear = autoClear;
  }

  _run(mat, rt, texel) {
    mat.uniforms.uTexel.value.set(1 / texel, 1 / texel);
    this._quad.material = mat;
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this._scene, this._cam);
    this.passes++;
  }

  /** 一格的四張圖清成 0（scissor 只清那一格）。 */
  _clear(tile) {
    const r = this.renderer, { x, y, size } = this.tileRect(tile);
    const color = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const rt of [this.vel.read, this.dye.read, this.pressure.read]) {
      const n = rt.width;
      rt.scissor.set(x * n, y * n, size * n, size * n);
      rt.scissorTest = true;
      r.setRenderTarget(rt);
      r.clear(true, false, false);
      rt.scissorTest = false;
    }
    r.setClearColor(color, alpha);
  }

  _simulate(dt) {
    const S = this.vel.read.width, D = this.dye.read.width;
    const { vel, dye, pressure } = this;

    VORTICITY.uniforms.uVel.value = vel.read.texture;
    VORTICITY.uniforms.uDt.value = dt;
    this._run(VORTICITY, vel.write, S);
    vel.swap();

    JACOBI.uniforms.uVel.value = vel.read.texture;
    for (let i = 0; i < FLUID.jacobi; i++) {
      JACOBI.uniforms.uP.value = pressure.read.texture;
      JACOBI.uniforms.uKeep.value = i === 0 ? 0.8 : 1;
      this._run(JACOBI, pressure.write, S);
      pressure.swap();
    }

    GRADIENT.uniforms.uP.value = pressure.read.texture;
    GRADIENT.uniforms.uVel.value = vel.read.texture;
    this._run(GRADIENT, vel.write, S);
    vel.swap();

    /* 這一幀的注入。uniform 陣列要補滿 N 個：three 照陣列的長度上傳。 */
    const seg = [], velv = [], dyev = [], info = [];
    for (const sp of this._splats) {
      const { x, y, size } = this.tileRect(sp.tile);
      const at = (p) => [x + p[0] * size, y + p[1] * size];
      const [ax, ay] = at(sp.a), [bx, by] = at(sp.b);
      seg.push(new THREE.Vector4(ax, ay, bx, by));
      /* 格內座標 / 秒 → 速度格子的格數 / 秒。 */
      const k = FLUID.sim;
      velv.push(new THREE.Vector4(sp.va[0] * k, sp.va[1] * k, sp.vb[0] * k, sp.vb[1] * k));
      dyev.push(new THREE.Vector4(sp.ca, 0, sp.cb, 0));
      info.push(new THREE.Vector4(sp.radius * size, x, y, 0));
    }
    const n = this._splats.length;
    this._splats.length = 0;
    while (seg.length < FLUID.splats) {
      seg.push(new THREE.Vector4()); velv.push(new THREE.Vector4());
      dyev.push(new THREE.Vector4()); info.push(new THREE.Vector4(1, -1, -1, 0));
    }

    for (const [mat, src, val, decay, size] of [
      [ADVECT_VEL, vel, velv, FLUID.velDecay, S], [ADVECT_DYE, dye, dyev, FLUID.dyeDecay, D],
    ]) {
      const u = mat.uniforms;
      u.uStep.value.set(1 / S, 1 / S);
      u.uDt.value = dt; u.uDecay.value = decay;
      u.uVel.value = vel.read.texture; u.uSrc.value = src.read.texture;
      u.uCount.value = n; u.uSeg.value = seg; u.uVal.value = val; u.uInfo.value = info;
      this._run(mat, src.write, size);
      src.swap();
    }
  }

  dispose() {
    for (const f of [this.vel, this.dye, this.pressure]) { f.read.dispose(); f.write.dispose(); }
  }
}

/* ── 一片煙 ──────────────────────────────────────────────────────────
   把流體場的一格擺進世界：一片 2h 見方的方格，原點 o、格內座標的 u 軸沿 U、
   v 軸沿 V（兩個單位向量，互相垂直）。畫法是卡通的：濃度場硬切成一塊，
   跟場景裡的石頭與狗同一套——明確的邊、墨線、幾階平色。流動只剩那道邊
   在動。

     邊    濃度先取一圈平均再硬切：流體會拉出比一兩格還細的絲，直接切的話
           邊是一排鋸齒與尖刺，抹掉之後才是圓滑的大塊。切在哪由 fwidth 換成
           「離邊幾個像素」，所以邊在任何距離都是一個像素寬的抗鋸齒。
     墨線  離邊 INK_PX 個像素以內是墨色，跟狗的描邊一樣粗（controls.js 的
           ink(2.0)）、同一個墨色（palette.js 的 INK）。
     明暗  法線從濃度的梯度算（濃度當成高度場），吃 palette.js 的主光，硬切成
           兩階：迎光的白、背光的淡藍灰。
     體積  兩層網格，一層往法線正面鼓、一層往背面鼓，鼓多高看那裡的濃度——
           所以側著看是一片有厚度的透鏡，不是一條線。
     格邊  格子的邊一圈把濃度壓到 0：那是一道牆，煙貼在牆上看起來像被切掉。

   `fade` 是特效自己的淡出（1 → 0）。卡通的煙不是慢慢變透明，是被吃掉：
   fade 往下，切的門檻往上抬，邊從外往內縮，細的地方先斷，最後剩幾塊最濃的
   再消失。 */

/** 描邊幾個像素寬（裝置像素）。 */
const INK_PX = 2.0;

const SHEET_VERT = /* glsl */ `
uniform sampler2D uDye;
uniform vec4 uTile;      // 左下角 xy、邊長 z
uniform float uThick, uSide, uTexel, uSoft;
varying vec2 vA;
varying vec2 vUv2;
float dye(vec2 a) { return texture2D(uDye, a).r; }
float edge(vec2 uv) {
  vec2 e = smoothstep(0.0, 0.06, uv) * smoothstep(0.0, 0.06, 1.0 - uv);
  return e.x * e.y;
}
void main() {
  vec2 a = uTile.xy + uv * uTile.z;
  float k = uSoft * uTexel;
  // 網格比濃度粗，取五點平均再鼓，不然鼓出來的面會一格一格地抖。
  float d = (2.0 * dye(a) + dye(a + vec2(k, 0.0)) + dye(a - vec2(k, 0.0))
           + dye(a + vec2(0.0, k)) + dye(a - vec2(0.0, k))) / 6.0;
  float h = uThick * (1.0 - exp(-1.6 * d)) * edge(uv);
  vA = a; vUv2 = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(0.0, 0.0, uSide * h), 1.0);
}`;

/* INK 是 sRGB 的十六進位；這個著色器不經過 three 的色彩空間轉換，直接寫進畫面，
   所以照原樣拆成三個 0～1 的數。 */
const INK_RGB = [(INK >> 16) & 255, (INK >> 8) & 255, INK & 255].map((c) => (c / 255).toFixed(4)).join(', ');

const SHEET_FRAG = /* glsl */ `
uniform sampler2D uDye;
uniform float uSide, uTexel, uFade, uSoft;
uniform vec3 uU, uV, uN, uKey, uLit, uShade;
varying vec2 vA;
varying vec2 vUv2;
float dye(vec2 a) { return texture2D(uDye, a).r; }
// 一圈九點平均，半徑三格：比這還細的絲抹掉，切出來的邊才是大塊。
float soft(vec2 a) {
  float k = uSoft * uTexel, q = 0.7071 * k;
  return (2.0 * dye(a)
        + dye(a + vec2(k, 0.0)) + dye(a - vec2(k, 0.0)) + dye(a + vec2(0.0, k)) + dye(a - vec2(0.0, k))
        + dye(a + vec2(q, q)) + dye(a - vec2(q, q)) + dye(a + vec2(q, -q)) + dye(a - vec2(q, -q))) / 10.0;
}
void main() {
  vec2 e2 = smoothstep(0.0, 0.08, vUv2) * smoothstep(0.0, 0.08, 1.0 - vUv2);
  float d = soft(vA) * e2.x * e2.y;
  float th = mix(1.3, 0.3, uFade);            // 淡出：門檻往上抬，邊往內縮
  float px = (d - th) / max(fwidth(d), 1e-5); // 離邊幾個像素，裡面是正的
  if (px < -0.5) discard;
  float cover = clamp(px + 0.5, 0.0, 1.0);

  float k = (uSoft + 1.0) * uTexel;
  float gx = soft(vA + vec2(k, 0.0)) - soft(vA - vec2(k, 0.0));
  float gy = soft(vA + vec2(0.0, k)) - soft(vA - vec2(0.0, k));
  vec3 nl = normalize(vec3(-gx * 3.0, -gy * 3.0, uSide));
  vec3 n = normalize(nl.x * uU + nl.y * uV + nl.z * uN);
  if (!gl_FrontFacing) n = -n;
  float ndl = dot(n, uKey), w = max(fwidth(ndl), 1e-4);
  float lit = smoothstep(0.1 - w, 0.1 + w, ndl);
  vec3 col = mix(uShade, uLit, lit);

  float ink = 1.0 - clamp(px - ${INK_PX.toFixed(1)} + 0.5, 0.0, 1.0);
  col = mix(col, vec3(${INK_RGB}), ink);
  gl_FragColor = vec4(col, cover * mix(0.9, 1.0, ink));
}`;

/*
 * 一片煙長什麼樣（擺的時候給，見 Sheet.place；dust.js 的 DUST_LOOK 就是一個）：
 *   thick 最濃的地方往一面鼓多高（公尺）
 *   lit   迎光那一階的顏色（sRGB，0～1）
 *   shade 背光那一階
 *   soft  硬切之前抹平的半徑（濃度格子的格數）：越大，細絲與細長的指狀越會融回圓的團塊
 */

export class Sheet {
  /**
   * 網格是 2 見方（半邊長 1），實際多大在 place 用矩陣縮放——同一片可以借給大小
   * 不同的煙。
   *
   * @param {Fluid} fluid
   */
  constructor(fluid) {
    this.fluid = fluid;
    this.half = 1;
    const geo = new THREE.PlaneGeometry(2, 2, 56, 56);
    this.node = new THREE.Group();
    this.node.matrixAutoUpdate = false;
    this.node.visible = false;
    this._axes = { uU: new THREE.Vector3(1, 0, 0), uV: new THREE.Vector3(0, 1, 0), uN: new THREE.Vector3(0, 0, 1) };
    this._mats = [1, -1].map((side) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: SHEET_VERT, fragmentShader: SHEET_FRAG,
        uniforms: {
          uDye: { value: null }, uTile: { value: new THREE.Vector4() },
          uThick: { value: 0.1 }, uSide: { value: side }, uTexel: { value: 1 / (FLUID.dye * FLUID.grid) },
          uLit: { value: new THREE.Vector3() }, uShade: { value: new THREE.Vector3() }, uSoft: { value: 3 },
          uFade: { value: 1 }, uKey: { value: KEY_DIR }, ...Object.fromEntries(Object.entries(this._axes).map(([k, v]) => [k, { value: v }])),
        },
        transparent: true, depthWrite: true, side: THREE.DoubleSide, fog: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 3;
      m.frustumCulled = false;
      this.node.add(m);
      return mat;
    });
    /** 這一片的原點與兩軸（世界座標），place 給。 */
    this.o = new THREE.Vector3();
    this.tile = -1;
  }

  /**
   * 擺在世界裡：原點 o、u 軸沿 U、v 軸沿 V（單位向量、互相垂直）、半邊長 half（公尺）、
   * 長什麼樣 look（見上面）。
   */
  place(o, U, V, half, look) {
    const { uU, uV, uN } = this._axes;
    this.half = half;
    this.o.set(...o); uU.set(...U); uV.set(...V);
    uN.crossVectors(uU, uV);
    const s = (v) => v.clone().multiplyScalar(half);
    this.node.matrix.makeBasis(s(uU), s(uV), s(uN)).setPosition(this.o);
    this.node.matrixWorldNeedsUpdate = true;
    for (const m of this._mats) {
      /* 鼓的高度在網格自己的單位裡量，網格被放大了 half 倍，所以除回去。 */
      m.uniforms.uThick.value = look.thick / half;
      m.uniforms.uLit.value.set(...look.lit);
      m.uniforms.uShade.value.set(...look.shade);
      m.uniforms.uSoft.value = look.soft;
    }
  }

  /** 世界座標的一點 → 格內座標 [u, v]。 */
  toTile(p) {
    const dx = p[0] - this.o.x, dy = p[1] - this.o.y, dz = p[2] - this.o.z;
    const { uU, uV } = this._axes, s = 2 * this.half;
    return [(dx * uU.x + dy * uU.y + dz * uU.z) / s + 0.5, (dx * uV.x + dy * uV.y + dz * uV.z) / s + 0.5];
  }

  /** 世界座標的一個速度 → 格內座標 / 秒。 */
  toTileVel(v) {
    const { uU, uV } = this._axes, s = 2 * this.half;
    return [(v[0] * uU.x + v[1] * uU.y + v[2] * uU.z) / s, (v[0] * uV.x + v[1] * uV.y + v[2] * uV.z) / s];
  }

  /** 這一幀畫哪一格、淡出到哪（fade 1 → 0，見上面）。fade 0 或沒有格子就收起來。 */
  show(tile, fade) {
    this.tile = tile;
    this.node.visible = tile >= 0 && fade > 0;
    if (!this.node.visible) return;
    const { x, y, size } = this.fluid.tileRect(tile);
    for (const m of this._mats) {
      m.uniforms.uDye.value = this.fluid.texture;
      m.uniforms.uTile.value.set(x, y, size, 0);
      m.uniforms.uFade.value = fade;
    }
  }
}
