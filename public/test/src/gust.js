/* ── test/src/gust.js ─────────────────────────────────────────────────
   國王劈砍推出去的氣流：畫出來（規則——多快、多寬、停在哪、打到誰——在 skills.js 的
   gustsStep）。

   ── 形狀：那一刀的劍光，變成一塊 ────────────────────────────────────
   形狀就是國王那一刀的劍光（trail.js 的 cleave：三道 BANDS 合起來，起點那一頭三條尖尾、
   往刀那一頭變寬，照劍長 SKILL.hew.len / REACH 縮放），在劈的那個直立面上；再往左右各
   加厚紅條（劈的那一條）的半寬——一片劍光成了一塊有體積的東西，像火球一樣沿那一條
   飛出去。不是平頂：正中間是整片劍光，往兩邊照橢圓壓低（skills.js 的 gustRise），像刀背。
   劍光最後落在地上的那一頭（全寬的平邊）的最前端就是氣流的前緣（skills.js 的
   `to`），所以推出去的那一刻，這一塊剛好疊在國王劈下去的那一道劍光上。

   判定就是這一塊（skills.js 的 gustHits，近似：三道的尖尾不算）——跳不過，只能往旁邊閃。

   ── 體積用扭曲畫 ─────────────────────────────────────────────────
   不是光，是被劈開、往前壓的空氣：這一塊後面的畫面被推歪。每一個像素沿著自己的視線
   穿過這一塊，找出視線上最深的那一點離表面多深（D，公尺；沒穿過的是負的，絕對值是
   視線離這一塊最近有多遠）——D 在輪廓上剛好是 0，裡外都是連續的。

     扭曲  讀「畫面上離它一點點遠的那個像素」（拷一份這一幀已經畫好的畫面來讀），偏移
           順著氣流在畫面上走的方向。偏移量從輪廓上 0 開始，EDGE 個像素裡拉滿（D 除以
           它在螢幕上的變化率就是離輪廓幾個像素）——位移是連續的，畫面不會撕開一條縫；
           但拉得夠快，看起來就是一道邊。裡面再疊幾層跟表面平行的起伏（RIPPLE，照 D
           排），往裡面跑：空氣在震。
   不描邊、不壓暗：看不看得出來全靠變形——邊界就是扭曲在那裡驟降。

   視線上找最深那一點：在這一塊的外框（一個盒子）裡等距取 STEPS 點，找到最深的那一點
   之後在它兩邊再三分逼近 REFINE 次——只取等距點的話輪廓會有階梯。

   ── 一道的一生 ─────────────────────────────────────────────────────
   推出去的頭 GROW 秒扭曲從 0 長到滿；之後跟著前緣走；停下來（撞上東西或黑牆）那一刻
   在原地以前緣為中心 FADE 秒縮到沒有。

   ── 成本 ─────────────────────────────────────────────────────────
   場上有氣流的那幾幀才拷畫面（每幀一次，全螢幕），之外完全不花。著色只在包住這一塊
   的殼（劍光的外框往外撐 PAD）蓋到的像素上跑，每個像素沿視線算 STEPS + 2·REFINE 次形狀。
   網址給 `?gust=0` 就整個不畫——同一台手機開關各看一次 fps，就是扭曲的成本。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { FAN } from './combat.js';
import { GUST } from './skills.js';
import { BANDS } from './trail.js';

/** 劍光照劍長縮放多少、外緣離刀根多遠（前緣在刀根前面這麼遠）、最寬時最靠內的內緣（殼的內圈從這裡往內撐）、
    邊上剩正中間的幾成高。 */
const { scale: SCALE, top: TOP, inner: INNER, edge: EDGE_RISE } = GUST;

/** 起點收成尖的那一段多長（公尺，沿著外緣量；qi.js 的 END）。 */
const END = 0.35;

/** 從起點尖到全寬花掉掃的角度的幾成（trail.js 的 RISE）。 */
const RISE = 0.6;

/** 偏移最大多少（畫面高度的幾成）、輪廓上幾個像素拉滿。 */
const AMP = 0.08, EDGE = 2.5;

/** 裡面的起伏：一層多厚（公尺，從表面往裡量）、一秒往裡跑幾層、佔偏移的幾成。 */
const RIPPLE = { len: 0.14, hz: 8, share: 0.3 };

/** 推出去的頭幾秒扭曲長到滿、停下來幾秒縮到沒有。 */
const GROW = 0.06, FADE = 0.12;

/** 殼比劍光大一圈（公尺）：fwidth 要輪廓兩邊都有像素可比。 */
const PAD = 0.12;

/** 視線上等距取幾點、找到最深的之後三分逼近幾次。 */
const STEPS = 32, REFINE = 12;

const f = (x) => x.toFixed(5);

/* 這一塊自己的座標（公尺，跟世界一樣大）：x 往前、y 往上、z 往旁邊；前緣（劍光外緣落在
   地上的那一點）是原點，刀根在 (−TOP, 0, 0)。 */

const VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** 形狀離表面多遠（裡面是負的）：三道合起來（trail.js 的 BANDS、sideAt，qi.js 的 END），往旁邊加厚 uHalf。 */
const SHAPE = /* glsl */ `
uniform float uHalf;
float side(float th) {
  float u = clamp(th / ${f(FAN.sweep)} / ${f(RISE)}, 0.0, 1.0);
  float s = 0.04 + 0.96 * pow(sin(1.5708 * u), 0.7);
  return s * clamp(${f(TOP)} * th / ${f(END)}, 0.0, 1.0);
}
float shape(vec3 q) {
  // 兩側矮（skills.js 的 gustRise）：高度先除回正中間那麼高再量，量完乘回去（距離只會少算、不會多算）。
  float t = min(1.0, abs(q.z) / uHalf), rise = ${f(EDGE_RISE)} + ${f(1 - GUST.edge)} * sqrt(max(0.0, 1.0 - t * t));
  vec2 p = vec2(q.x + ${f(TOP)}, q.y / rise);
  float r = length(p);
  float th = ${f(FAN.sweep)} - atan(p.y, p.x);          // 從起點（正上方）往下劈了多少
  float ang = max(-th, th - ${f(FAN.sweep)}) * r;        // 掃的角度以外：離那一條邊多遠
  float s = side(clamp(th, 0.0, ${f(FAN.sweep)}));
  float d = 1.0e3;
${BANDS.map((B) => `  d = min(d, max(ang, max(${f((B.out - B.wide) * SCALE)} + ${f(B.wide * SCALE)} * (1.0 - s) - r, r - ${f(B.out * SCALE)})));`).join('\n')}
  return max(d * rise, abs(q.z) - uHalf);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uScreen;
uniform vec2 uRes;        // 畫面多大（像素）
uniform vec2 uDir;        // 氣流在畫面上往哪走（單位向量，像素空間）
uniform vec3 uO, uF, uS;  // 前緣（世界）、往前、往旁邊
uniform float uK, uAmp, uTime;
varying vec3 vW;
${SHAPE}
vec3 local(vec3 w) {
  vec3 d = w - uO;
  return vec3(dot(d, uF), d.y, dot(d, uS)) / uK;
}
void main() {
  vec3 ro = local(cameraPosition), rd = normalize(local(vW) - ro);
  // 視線在外框（盒子）裡的那一段。
  vec3 lo = vec3(${f(-TOP - PAD)}, ${f(-PAD)}, -uHalf - ${f(PAD)});
  vec3 hi = vec3(${f(PAD)}, ${f(TOP + PAD)}, uHalf + ${f(PAD)});
  vec3 inv = 1.0 / (rd + vec3(1e-6));
  vec3 ta = (lo - ro) * inv, tb = (hi - ro) * inv;
  float t0 = max(max(max(min(ta.x, tb.x), min(ta.y, tb.y)), min(ta.z, tb.z)), 0.0);
  float t1 = min(min(max(ta.x, tb.x), max(ta.y, tb.y)), max(ta.z, tb.z));
  // 等距找最深的那一點，再在它兩邊三分逼近。沒穿過盒子的當成很遠（discard 留到 fwidth 之後）。
  float D = -1.0e3;
  if (t1 > t0) {
    float h = (t1 - t0) / ${STEPS.toFixed(1)}, best = 1.0e3, bt = t0;
    for (int i = 0; i <= ${STEPS}; i++) {
      float t = t0 + h * float(i), d = shape(ro + rd * t);
      if (d < best) { best = d; bt = t; }
    }
    float a = max(t0, bt - h), b = min(t1, bt + h);
    for (int i = 0; i < ${REFINE}; i++) {
      float m1 = a + (b - a) / 3.0, m2 = b - (b - a) / 3.0;
      if (shape(ro + rd * m1) < shape(ro + rd * m2)) b = m2; else a = m1;
    }
    D = -min(best, shape(ro + rd * (0.5 * (a + b)))) * uK;      // 最深那一點多深（公尺）
  }
  float px = D / max(fwidth(D), 1e-6);                          // 離輪廓幾個像素（裡面是正的）
  if (px <= 0.0) discard;
  float s = smoothstep(0.0, ${f(EDGE)}, px) * uAmp;
  float wave = 1.0 - ${f(RIPPLE.share)} * (0.5 + 0.5 * cos(6.2832 * (D / ${f(RIPPLE.len)} - uTime * ${f(RIPPLE.hz)})));
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 off = uDir * s * wave * ${f(AMP)} * vec2(uRes.y / uRes.x, 1.0);
  gl_FragColor = vec4(texture2D(uScreen, uv - off).rgb, 1.0);
}`;

/**
 * 包住這一塊的殼：劍光那一片（直立面上的四分之一圈，刀根在 (−TOP, 0)、從水平往前到
 * 正上方）往外撐 PAD，再往旁邊擠出 2·(half + PAD) 厚。著色只在它蓋到的像素上跑。
 */
function shell(half) {
  const R = TOP + PAD, r = Math.max(0.02, INNER - PAD), e = PAD / TOP, n = 24;
  const at = (rad, i) => {
    const a = -e + ((Math.PI / 2 + 2 * e) * i) / n;
    return new THREE.Vector2(-TOP + Math.cos(a) * rad, Math.sin(a) * rad);
  };
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(at(R, i));
  for (let i = n; i >= 0; i--) pts.push(at(r, i));
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 2 * (half + PAD), bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -(half + PAD));
  return g;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _size = new THREE.Vector2();

/**
 * 場上的氣流：每一道一塊。每幀 draw 一次（在 renderer.render 之前），讀 world.gusts。
 * 畫面在畫到第一塊的時候才拷（onBeforeRender），那時候其他東西都畫好了。
 */
export class Gusts {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer | null} renderer 拷畫面用。沒給、或網址 `?gust=0`：不畫
   */
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.on = !!renderer && new URLSearchParams(location.search).get('gust') !== '0';
    this.tex = null;
    this._frame = -1;
    this.views = [];
    this.spare = [];
    this.time = 0;
  }

  /** 這一幀第一次要讀畫面：拷一份（大小跟著畫布變）。 */
  _copy(renderer) {
    const frame = renderer.info.render.frame;
    if (frame === this._frame) return;
    this._frame = frame;
    renderer.getDrawingBufferSize(_size);
    if (!this.tex || this.tex.image.width !== _size.x || this.tex.image.height !== _size.y) {
      if (this.tex) this.tex.dispose();
      this.tex = new THREE.FramebufferTexture(_size.x, _size.y);
      this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
      for (const v of [...this.views, ...this.spare]) v.mat.uniforms.uScreen.value = this.tex;
    }
    renderer.copyFramebufferToTexture(this.tex);
    for (const v of this.views) v.mat.uniforms.uRes.value.copy(_size);
  }

  _view() {
    let v = this.spare.pop();
    if (!v) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          uScreen: { value: this.tex }, uRes: { value: new THREE.Vector2(1, 1) }, uDir: { value: new THREE.Vector2(0, 1) },
          uO: { value: new THREE.Vector3() }, uF: { value: new THREE.Vector3() }, uS: { value: new THREE.Vector3() },
          uHalf: { value: 0.5 }, uK: { value: 1 }, uAmp: { value: 0 }, uTime: { value: 0 },
        },
        transparent: true, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      mesh.onBeforeRender = (renderer) => this._copy(renderer);
      this.renderer.getDrawingBufferSize(mat.uniforms.uRes.value);
      this.scene.add(mesh);
      v = { mesh, mat, half: -1 };
    }
    v.mesh.visible = true;
    return v;
  }

  /** 殼跟著氣流的寬（紅條的寬）。 */
  _shape(v, half) {
    if (v.half === half) return;
    v.half = half;
    v.mesh.geometry.dispose();
    v.mesh.geometry = shell(half);
    v.mat.uniforms.uHalf.value = half;
  }

  /** 全部收掉（回到站位、換陣容）。 */
  clear() {
    for (const v of this.views) { v.mesh.visible = false; v.gust = null; this.spare.push(v); }
    this.views.length = 0;
  }

  /**
   * @param {number} dt
   * @param {object} world skills.js 的 makeWorld：讀 gusts
   * @param {THREE.Camera} camera 算氣流在畫面上往哪走
   */
  draw(dt, world, camera) {
    if (!this.on) return;
    this.time += dt;
    for (const g of world.gusts) {
      if (g.view) continue;
      const v = this._view();
      v.gust = g; v.t = 0; v.end = null;
      g.view = v;
      this._shape(v, g.w / 2);
      this.views.push(v);
    }
    this.views = this.views.filter((v) => {
      const g = v.gust;
      v.t += dt;
      if (g.done && v.end === null) v.end = v.t;
      const out = v.end === null ? 0 : (v.t - v.end) / FADE;
      if (out >= 1) { v.mesh.visible = false; v.gust = null; this.spare.push(v); return false; }
      const k = Math.max(1e-3, 1 - out * out);
      const x = g.x + g.dirX * g.to, z = g.z + g.dirZ * g.to, u = v.mat.uniforms;
      // 殼：前緣在原點、+x 朝往前（dirX, dirZ）、+z 朝旁邊（−dirZ, dirX），以前緣為中心縮。
      v.mesh.position.set(x, g.y, z);
      v.mesh.rotation.set(0, Math.atan2(-g.dirZ, g.dirX), 0);
      v.mesh.scale.setScalar(k);
      u.uO.value.set(x, g.y, z);
      u.uF.value.set(g.dirX, 0, g.dirZ);
      u.uS.value.set(-g.dirZ, 0, g.dirX);
      u.uK.value = k;
      u.uAmp.value = Math.min(1, v.t / GROW);
      u.uTime.value = this.time;
      // 氣流在畫面上往哪走：前緣與它往前一公尺投影到畫面上，相減。
      _a.set(x, g.y, z).project(camera);
      _b.set(x + g.dirX, g.y, z + g.dirZ).project(camera);
      const dx = (_b.x - _a.x) * u.uRes.value.x, dy = (_b.y - _a.y) * u.uRes.value.y, n = Math.hypot(dx, dy);
      if (n > 1e-6) u.uDir.value.set(dx / n, dy / n);
      return true;
    });
  }
}
