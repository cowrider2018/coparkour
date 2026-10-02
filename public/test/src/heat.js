/* ── test/src/heat.js ─────────────────────────────────────────────────
   國王旋風斬推出去的熱氣流：畫出來（規則——多快、多厚、哪一段被什麼擋下、打到誰——在
   skills.js 的 ringsStep、ringHits）。

   ── 形狀 ─────────────────────────────────────────────────────────
   轉的那一圈劍光（主角第三擊那一道，照劍長縮放）往外推：從前緣往後 RING.depth 那麼深的
   一圈環帶，在國王腰的高度上下各厚 RING.half；不是平的，往上下照橢圓壓淺（skills.js 的
   ringDepth），前緣整圈一樣齊。推出去的那一刻剛好疊在轉的那一圈劍光上。

   ── 擋下 ─────────────────────────────────────────────────────────
   每個方向的前緣是 min(走到哪, 那個方向被擋下的地方)：表是 skills.js 挑招那一刻算好的
   遮擋（occlude.js），烘成一張一圈 SHADE_N 格的貼圖，著色器每一步照方向讀它。所以撞上柱子
   的那一段就停在柱子上，旁邊的照走；停下來的那一段在原地 FADE 秒縮到沒有（前緣不動，深度與
   厚度一起收），跟劈砍的氣流停下來那一下一樣。劍長以內就被擋住的方向一開始就沒有。

   ── 體積用扭曲畫 ─────────────────────────────────────────────────
   跟劈砍的氣流（gust.js）同一套：每個像素沿視線找最深的那一點有多深，照深度推歪後面的
   畫面（偏移量、從輪廓往裡淡、裡面的起伏、長出來與縮掉都是 gust.js 那幾個數）。偏移順著
   氣流在畫面上往哪走——這裡是往外，每一點不一樣，所以在最深那一點自己投影算。

   ── 殼 ───────────────────────────────────────────────────────────
   包住它的是一個墊圈（兩個同心圓柱夾一段高度，一圈 SEG 段），內外半徑與高度每幀照前緣
   給（頂點著色器撐開，幾何共用一份）：外圈在前緣（最遠是整圈最遠的那一點）外 PAD，內圈在
   還在縮的那幾段的後緣再往內 PAD。只畫朝著鏡頭的面，片段從自己那一點沿視線走到出殼為止——
   一條視線穿過這一圈兩次（從上面斜看）的話兩次都算，近的那一次蓋過遠的（寫深度，沒有扭曲的
   像素丟掉、不寫）。

   ── 成本 ─────────────────────────────────────────────────────────
   拷畫面跟劈砍的氣流共用一份（grab.js）。著色只在殼蓋到的像素上跑：殼很薄（不到半公尺），
   從上面斜看下來一條視線在裡面走一公尺上下，每一點讀一次貼圖。網址給 `?gust=0` 跟劈砍的
   氣流一起不畫。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { AMP, FEATHER, RIPPLE, GROW, FADE, PAD, STEPS, REFINE } from './gust.js';
import { SKILL, GUST, RING } from './skills.js';
import { SHADE_N, bakeShade } from './occlude.js';

/** 殼一圈切幾段。 */
const SEG = 256;

/** 每秒走多遠、停下來之後縮掉的那段時間裡它本來會再走多遠（殼的內圈要包住還在縮的那幾段）。 */
const SPEED = SKILL.gale.wave.speed, TAIL = SPEED * FADE;

/** 最深的地方離表面多深（往上下換算成同樣的尺度之後）：深度的一半。 */
const DEEP = RING.depth / 2;

const f = (x) => x.toFixed(5);

const VERT = /* glsl */ `
attribute vec3 aRing;      // 方向（弧度，atan2(x, z) 那一種）、內外（0、1）、上下（0、1）
uniform vec2 uC;
uniform float uRin, uRout, uY0, uY1;
varying vec3 vW;
void main() {
  float r = mix(uRin, uRout, aRing.y);
  vec3 w = vec3(uC.x + sin(aRing.x) * r, mix(uY0, uY1, aRing.z), uC.y + cos(aRing.x) * r);
  vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const FRAG = /* glsl */ `
uniform mat4 projectionMatrix;   // three 只在頂點那一段宣告它；這裡自己宣告，照名字設的是同一個值
uniform sampler2D uScreen, uShade;
uniform vec2 uRes, uC;
uniform float uMid, uTo, uAmp, uTime, uRin, uRout, uY0, uY1;
varying vec3 vW;

// 離表面多遠（裡面是負的，公尺）。
float shape(vec3 p) {
  vec2 rel = p.xz - uC;
  float rho = length(rel);
  float d = texture2D(uShade, vec2((atan(rel.x, rel.y) + 3.14159265) / 6.28318531, 0.5)).r;
  if (d < ${f(SKILL.gale.radius)}) return 1.0e3;              // 劍長以內就擋住：這個方向沒有
  float k = 1.0;
  if (d < uTo) {                                              // 停下來了：照停了多久縮
    float s = (uTo - d) / ${f(TAIL)};
    k = 1.0 - s * s;
    if (k <= 0.0) return 1.0e3;
  }
  float hh = ${f(RING.half)} * k, y = p.y - uMid;   // （half 是 GLSL 的保留字）
  float t = min(1.0, abs(y) / hh);
  float deep = ${f(RING.depth)} * k * (${f(GUST.edge)} + ${f(1 - GUST.edge)} * sqrt(max(0.0, 1.0 - t * t)));
  float x = rho - min(uTo, d);
  return max(max(x, -x - deep), (abs(y) - hh) * ${f(DEEP / RING.half)});
}

// 從 o 沿 r 走，第一次離開半徑 R 的圓柱（在裡面的話）／第一次進去（在外面的話）是多遠。
vec2 cyl(vec3 o, vec3 r, float R) {
  vec2 q = o.xz - uC, v = r.xz;
  float a = dot(v, v), b = dot(q, v), c = dot(q, q) - R * R, h = b * b - a * c;
  if (a < 1.0e-12 || h < 0.0) return vec2(1.0e9, -1.0e9);
  h = sqrt(h);
  return vec2((-b - h) / a, (-b + h) / a);
}

void main() {
  vec3 ro = cameraPosition, rd = normalize(vW - ro);
  float t0 = length(vW - ro);
  // 出殼：上下兩面、外圈、往裡走碰到內圈。
  float t1 = 1.0e9;
  if (rd.y > 1.0e-6) t1 = (uY1 - ro.y) / rd.y;
  if (rd.y < -1.0e-6) t1 = (uY0 - ro.y) / rd.y;
  t1 = min(t1, cyl(ro, rd, uRout).y);
  vec2 inner = cyl(ro, rd, uRin);
  if (inner.x > t0 + 1.0e-4) t1 = min(t1, inner.x);
  if (t1 <= t0) discard;
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
  float tm = 0.5 * (a + b), D = -min(best, shape(ro + rd * tm));
  if (D <= 0.0) discard;
  // 往外在畫面上往哪走：最深那一點與它往外一點點，投影相減。
  vec3 P = ro + rd * (best < shape(ro + rd * tm) ? bt : tm);
  vec2 out2 = normalize(P.xz - uC + vec2(1.0e-6, 0.0));
  vec4 c0 = projectionMatrix * viewMatrix * vec4(P, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(P + vec3(out2.x, 0.0, out2.y) * 0.1, 1.0);
  vec2 dir = (c1.xy / c1.w - c0.xy / c0.w) * uRes;
  dir = length(dir) > 1.0e-6 ? normalize(dir) : vec2(0.0, 1.0);
  float s = smoothstep(0.0, ${f(FEATHER * DEEP)}, D) * uAmp;
  float wave = 1.0 - ${f(RIPPLE.share)} * (0.5 + 0.5 * cos(6.2832 * (D / ${f(RIPPLE.len)} - uTime * ${f(RIPPLE.hz)})));
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 off = dir * s * wave * ${f(AMP)} * vec2(uRes.y / uRes.x, 1.0);
  gl_FragColor = vec4(texture2D(uScreen, uv - off).rgb, 1.0);
}`;

/**
 * 墊圈的幾何：一圈 SEG 段，每段外圈、內圈、上面、下面四片，每一片朝外（三角形的方向照它該朝的
 * 那一邊排，著色器只畫朝著鏡頭的面）。頂點只帶 aRing，位置由頂點著色器照 uniform 撐開。
 */
function washer() {
  const ring = [], idx = [];
  // 只為了排三角形的方向：內圈 1、外圈 2、高 0～1 的那一個。
  const at = (i, o, u) => { const a = (2 * Math.PI * i) / SEG, r = 1 + o; return [Math.sin(a) * r, u, Math.cos(a) * r]; };
  const vid = (i, o, u) => (i * 4) + o * 2 + u;
  for (let i = 0; i <= SEG; i++) for (const o of [0, 1]) for (const u of [0, 1]) ring.push((2 * Math.PI * i) / SEG, o, u);
  const tri = (p, q, r, want) => {
    const A = at(...p), B = at(...q), C = at(...r);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const w = want(A);
    const ids = [vid(...p), vid(...q), vid(...r)];
    if (n[0] * w[0] + n[1] * w[1] + n[2] * w[2] < 0) ids.reverse();
    idx.push(...ids);
  };
  const quad = (a, b, c, d, want) => { tri(a, b, c, want); tri(b, d, c, want); };
  for (let i = 0; i < SEG; i++) {
    const j = i + 1;
    quad([i, 1, 0], [i, 1, 1], [j, 1, 0], [j, 1, 1], (A) => [A[0], 0, A[2]]);     // 外圈：往外
    quad([i, 0, 0], [i, 0, 1], [j, 0, 0], [j, 0, 1], (A) => [-A[0], 0, -A[2]]);   // 內圈：往圓心
    quad([i, 0, 1], [i, 1, 1], [j, 0, 1], [j, 1, 1], () => [0, 1, 0]);            // 上面
    quad([i, 0, 0], [i, 1, 0], [j, 0, 0], [j, 1, 0], () => [0, -1, 0]);           // 下面
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ring.length), 3));
  g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 3));
  g.setIndex(idx);
  return g;
}

/**
 * 場上的熱氣流：每一圈一個殼。每幀 draw 一次（在 renderer.render 之前），讀 world.rings。
 * 前緣走過整圈最遠的那一點之後規則就收掉它（skills.js），這裡自己再往前推 TAIL，讓最後停下來的
 * 那幾段縮完。
 */
export class Heats {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./grab.js').Grab | null} grab 拷畫面用。沒給、或網址 `?gust=0`：不畫
   */
  constructor(scene, grab) {
    this.scene = scene;
    this.grab = grab;
    this.on = !!grab && new URLSearchParams(location.search).get('gust') !== '0';
    this.views = [];
    this.spare = [];
    this.time = 0;
    this.geometry = this.on ? washer() : null;
    // 先收著一個：第一圈推出去之前就編得到、畫得到（fight.js 的 _compile）。
    if (this.on) {
      const v = this._view();
      v.mesh.visible = false;
      this.spare.push(v);
    }
  }

  _view() {
    let v = this.spare.pop();
    if (!v) {
      const data = new Float32Array(2 * SHADE_N);
      const tex = new THREE.DataTexture(data, SHADE_N, 1, THREE.RGFormat, THREE.FloatType);
      tex.minFilter = tex.magFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          uScreen: this.grab.screen, uRes: this.grab.res, uShade: { value: tex }, uC: { value: new THREE.Vector2() },
          uMid: { value: 0 }, uTo: { value: 0 }, uAmp: { value: 0 }, uTime: { value: 0 },
          uRin: { value: 0 }, uRout: { value: 1 }, uY0: { value: 0 }, uY1: { value: 1 },
        },
        transparent: true, depthWrite: true,
      });
      const mesh = new THREE.Mesh(this.geometry, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      mesh.onBeforeRender = () => this.grab.copy();
      this.scene.add(mesh);
      v = { mesh, mat, data, tex };
    }
    v.mesh.visible = true;
    return v;
  }

  /** 全部收掉（回到站位、換陣容）。 */
  clear() {
    for (const v of this.views) { v.mesh.visible = false; v.ring = null; this.spare.push(v); }
    this.views.length = 0;
  }

  /**
   * @param {number} dt
   * @param {object} world skills.js 的 makeWorld：讀 rings
   */
  draw(dt, world) {
    if (!this.on) return;
    this.time += dt;
    for (const g of world.rings) {
      if (g.view) continue;
      const v = this._view();
      v.ring = g; v.t = 0; v.extra = 0;
      g.view = v;
      bakeShade(g.env, v.data, () => 0);
      v.tex.needsUpdate = true;
      this.views.push(v);
    }
    this.views = this.views.filter((v) => {
      const g = v.ring;
      v.t += dt;
      if (g.done) v.extra += SPEED * dt;
      const to = g.to + v.extra;
      if (to - g.far >= TAIL) { v.mesh.visible = false; v.ring = null; this.spare.push(v); return false; }
      const u = v.mat.uniforms;
      u.uC.value.set(g.x, g.z);
      u.uMid.value = g.mid;
      u.uTo.value = to;
      u.uRout.value = Math.min(to, g.far) + PAD;
      u.uRin.value = Math.max(0, to - TAIL - RING.depth - PAD);
      u.uY0.value = g.mid - RING.half - PAD;
      u.uY1.value = g.mid + RING.half + PAD;
      u.uAmp.value = Math.min(1, v.t / GROW);
      u.uTime.value = this.time;
      return true;
    });
  }
}
