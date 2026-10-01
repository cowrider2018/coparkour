/* ── test/src/gust.js ─────────────────────────────────────────────────
   國王劈砍推出去的氣流：畫出來（規則——多快、多寬、停在哪、打到誰——在 skills.js 的
   gustsStep）。

   不是光，是被劈開、往前壓的空氣：一片貼著地板、往前凸的彎月，裡面的畫面被推歪
   ——像熱氣讓後面的東西扭一下。要的是看得出邊界、又不是畫上去的一塊顏色：

     扭曲  彎月裡的每一個像素讀「畫面上離它一點點遠的那個像素」（拷一份這一幀已經畫好的
           畫面來讀），偏移順著氣流在畫面上走的方向。偏移量從邊上 0 開始，EDGE 個像素裡
           拉滿——位移是連續的，畫面不會撕開一條縫；但拉得夠快，看起來就是一道邊。裡面
           再疊幾圈跟邊平行的起伏（RIPPLE），往裡面跑：空氣在震。
     壓暗  裡面整片暗一點（DIM）：平塗的地方沒有紋路可以扭，光靠扭曲會看不見。
     墨線  邊外面一圈墨線（INK 像素寬，狗的墨線那個顏色）：跟周圍分得清清楚楚。

   像素寬照螢幕量（fwidth），遠近都一樣粗——跟 qi.js 的抗鋸齒同一招。

   ── 形狀 ─────────────────────────────────────────────────────────
   兩個圓切出來的彎月：外圓的弧是前緣，正中間剛好在氣流的前緣（skills.js 的 `to`）上，
   兩個尖在後面，左右張開氣流那一條的寬（`w`）——畫出來的就是打得到的那一條的寬。
   內圓從後面挖掉一塊，正中間留 THICK 那麼厚。

   ── 一道的一生 ─────────────────────────────────────────────────────
   推出去的頭 GROW 秒從小長到全大；之後跟著前緣走；停下來（撞上東西或黑牆）那一刻
   在原地 FADE 秒縮到沒有。

   ── 成本 ─────────────────────────────────────────────────────────
   場上有氣流的那幾幀才拷畫面（每幀一次，全螢幕），之外完全不花。網址給 `?gust=0`
   就不拷、不扭——只剩壓暗與墨線——同一台手機開關各看一次 fps，就是扭曲的成本。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';

/** 彎月正中間多厚、從前緣到兩個尖往後多長（公尺）。寬是氣流的 w。 */
const THICK = 0.32, DEPTH = 0.62;

/** 離地板多高：比斬痕（scar.js）、血泊、預告都高——扭的是它們。 */
const LIFT = 0.035;

/** 偏移最大多少（畫面高度的幾成）、邊上幾個像素拉滿、壓暗幾成、墨線幾個像素。 */
const AMP = 0.03, EDGE = 2.5, DIM = 0.16, INK = 1.6;

/** 裡面的起伏：一圈多寬（公尺，從邊往裡量）、一秒往裡跑幾圈、佔偏移的幾成。 */
const RIPPLE = { len: 0.09, hz: 9, share: 0.35 };

/** 墨線的顏色：跟狗的墨線同一個（43, 35, 32）。 */
const INK_COL = [43 / 255, 35 / 255, 32 / 255];

/** 推出去的頭幾秒長到全大、停下來幾秒縮到沒有。 */
const GROW = 0.06, FADE = 0.12;

/** 平面比彎月大一圈（公尺）：墨線在邊外面，遠的時候幾個像素也有好幾公分。 */
const PAD = 0.3;

const f = (x) => x.toFixed(4);

/** 彎月的兩個圓（外圓的弧過前緣正中間與兩個尖，內圓過兩個尖與往後 THICK 那一點）。 */
function circles(w) {
  const a2 = (w / 2) ** 2, d = DEPTH, e = DEPTH - THICK;
  const r1 = (a2 + d * d) / (2 * d), r2 = (a2 + e * e) / (2 * e);
  return { r1, c1: -r1, r2, c2: -THICK - r2 };
}

const VERT = /* glsl */ `
varying vec2 vL;   // 彎月自己的座標（公尺）：x 橫的，y 往前，前緣正中間是原點
void main() {
  vL = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = (screen) => /* glsl */ `
uniform sampler2D uScreen;
uniform vec2 uRes;      // 畫面多大（像素）
uniform vec2 uDir;      // 氣流在畫面上往哪走（單位向量，像素空間）
uniform float uR1, uC1, uR2, uC2, uTime;
varying vec2 vL;
void main() {
  // 在彎月裡是負的：外圓裡面、內圓外面。
  float sd = max(length(vL - vec2(0.0, uC1)) - uR1, uR2 - length(vL - vec2(0.0, uC2)));
  float px = -sd / max(fwidth(sd), 1e-6);             // 離邊幾個像素（裡面是正的）
  if (px < -${f(INK)} - 1.0) discard;
  float s = smoothstep(0.0, ${f(EDGE)}, px);
  float wave = 1.0 - ${f(RIPPLE.share)} * (0.5 + 0.5 * cos(6.2832 * (-sd / ${f(RIPPLE.len)} - uTime * ${f(RIPPLE.hz)})));
  vec4 ink = vec4(${INK_COL.map(f).join(', ')}, 0.9 * smoothstep(-${f(INK)} - 1.0, -${f(INK)}, px));
  ${screen ? `
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 off = uDir * s * wave * ${f(AMP)} * vec2(uRes.y / uRes.x, 1.0);
  vec3 c = texture2D(uScreen, uv - off).rgb * (1.0 - ${f(DIM)} * s);
  vec4 inside = vec4(c, 1.0);` : `
  vec4 inside = vec4(0.0, 0.0, 0.0, ${f(DIM)} * s);`}
  gl_FragColor = mix(ink, inside, smoothstep(-0.5, 0.5, px));
}`;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _size = new THREE.Vector2();

/**
 * 場上的氣流：每一道一片彎月。每幀 draw 一次（在 renderer.render 之前），讀 world.gusts。
 * 畫面在畫到第一片彎月的時候才拷（onBeforeRender），那時候其他東西都畫好了。
 */
export class Gusts {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer | null} renderer 沒給、或網址 `?gust=0`：不扭，只壓暗與描邊
   */
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.screen = !!renderer && new URLSearchParams(location.search).get('gust') !== '0';
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
        vertexShader: VERT, fragmentShader: FRAG(this.screen),
        uniforms: {
          uScreen: { value: this.tex }, uRes: { value: new THREE.Vector2(1, 1) }, uDir: { value: new THREE.Vector2(0, 1) },
          uR1: { value: 1 }, uC1: { value: 0 }, uR2: { value: 1 }, uC2: { value: 0 }, uTime: { value: 0 },
        },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      if (this.screen) {
        mesh.onBeforeRender = (renderer) => this._copy(renderer);
        this.renderer.getDrawingBufferSize(mat.uniforms.uRes.value);
      }
      this.scene.add(mesh);
      v = { mesh, mat, w: -1 };
    }
    v.mesh.visible = true;
    return v;
  }

  /** 平面的大小跟著氣流的寬：彎月的外框再加一圈 PAD。前緣正中間在原點、往 +y 是前面。 */
  _shape(v, w) {
    if (v.w === w) return;
    v.w = w;
    const g = new THREE.PlaneGeometry(w + 2 * PAD, DEPTH + 2 * PAD);
    g.translate(0, PAD - (DEPTH + 2 * PAD) / 2, 0);
    v.mesh.geometry.dispose();
    v.mesh.geometry = g;
    const c = circles(w), u = v.mat.uniforms;
    u.uR1.value = c.r1; u.uC1.value = c.c1; u.uR2.value = c.r2; u.uC2.value = c.c2;
  }

  /** 全部收掉（回到站位、換陣容）。 */
  clear() {
    for (const v of this.views) { v.mesh.visible = false; this.spare.push(v); }
    this.views.length = 0;
  }

  /**
   * @param {number} dt
   * @param {object} world skills.js 的 makeWorld：讀 gusts
   * @param {THREE.Camera} camera 算氣流在畫面上往哪走
   */
  draw(dt, world, camera) {
    this.time += dt;
    for (const g of world.gusts) {
      if (g.view) continue;
      const v = this._view();
      v.gust = g; v.t = 0; v.end = null;
      g.view = v;
      this._shape(v, g.w);
      this.views.push(v);
    }
    this.views = this.views.filter((v) => {
      const g = v.gust;
      v.t += dt;
      if (g.done && v.end === null) v.end = v.t;
      const out = v.end === null ? 0 : (v.t - v.end) / FADE;
      if (out >= 1) { v.mesh.visible = false; v.gust = null; this.spare.push(v); return false; }
      const k = Math.min(1, 0.3 + 0.7 * (v.t / GROW)) * (1 - out * out);
      const x = g.x + g.dirX * g.to, z = g.z + g.dirZ * g.to;
      v.mesh.position.set(x, g.y + LIFT, z);
      // 平面躺下（法線朝上、+y 變成 −z），再繞 y 轉到 +y 朝著往前（dirX, dirZ）。
      v.mesh.rotation.set(-Math.PI / 2, Math.atan2(-g.dirX, -g.dirZ), 0, 'YXZ');
      v.mesh.scale.setScalar(Math.max(1e-3, k));
      // 氣流在畫面上往哪走：前緣與它往前一公尺投影到畫面上，相減。
      _a.set(x, g.y, z).project(camera);
      _b.set(x + g.dirX, g.y, z + g.dirZ).project(camera);
      const u = v.mat.uniforms, dx = (_b.x - _a.x) * u.uRes.value.x, dy = (_b.y - _a.y) * u.uRes.value.y, n = Math.hypot(dx, dy);
      if (n > 1e-6) u.uDir.value.set(dx / n, dy / n);
      u.uTime.value = this.time;
      return true;
    });
  }
}
