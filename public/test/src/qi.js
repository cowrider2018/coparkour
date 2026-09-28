/* ── test/src/qi.js ─────────────────────────────────────────────────
   劍氣的外觀：一道卡通的月牙（形狀與時間在 trail.js，這裡把它畫出來）。

   跟場景裡的石頭與狗同一套畫法——明確的邊、墨線、兩階平色——擾動只在
   形狀上：邊隨時間慢慢地鼓、縮，消散的時候斷成幾顆、一顆一顆縮掉。

   ── 一串點，融成一個曲面 ──────────────────────────────────────────
   月牙是沿著刀尖路徑的一串點（step 一顆一顆放，間距 trail.js 的 gapAt）。
   每一顆是一顆壓扁的球：半徑是那裡月牙的半寬，沿著月牙所在那個面的法線
   壓成 FLAT——像刀身一樣薄的一片，但有厚度。相鄰的點用 smooth-min 融在
   一起（metaball 那一種融法），所以整道月牙是一個平滑的曲面：沒有一排一排
   的接縫，第三段一整圈頭尾疊在一起的地方也是融起來的。

   一層就有體積：畫出來的是那個曲面本身（raymarch），任何角度看都是一塊有
   厚度的東西，法線從距離場算，不用兩層各鼓一面。

   點放下去的時候就固定了（從那一幀的玩家身上算），人在揮的時候轉向只是讓
   那一串彎一下。刀尖現在的位置另外一顆當頭，下一幀就換掉。

   ── 範圍 ────────────────────────────────────────────────────────
   每一顆的中心在 REACH − 半寬、半徑是半寬，外緣剛好貼著 REACH（trail.js 的
   qiAt）。smooth-min 會讓兩顆之間鼓出去最多 BLEND/4，所以半徑先扣掉這麼多：
   融起來的曲面也不會長出打得到的範圍。擾動與消散都只會讓點變小。

   ── 動 ──────────────────────────────────────────────────────────
     擾動  每一顆的半徑乘上 1 − WOB·noise(沿著月牙的長度, 時間)：單一頻率的
           平滑噪聲，一個起伏 WOBBLE 公尺長——大而少的鼓包。
     消散  一顆放下去 HOLD 秒之後，再等一段隨它在月牙上的位置而定的時間，才在
           SHRINK 秒內縮掉。那段等待是沿著月牙的平滑噪聲（一個起伏 PIECE_LEN
           公尺），所以相鄰的點差不多一起消失：月牙斷成幾大塊，一塊一塊地
           不見，斷口是融起來的圓頭。要是每一顆一起慢慢縮，一串球縮到比間距小
           就斷成一排小珠子。先放的也先開始等，所以大致是從尾巴往頭消失。
   半徑每幀在這裡算好才交給著色器，著色器只管畫。

   ── 怎麼畫 ──────────────────────────────────────────────────────
   外面包一層殼：沿著那一串點的一條方管，每一顆一個方形截面（比那一顆大一點，
   留給融合與墨線），頭尾各多一截把球的前後包進去。只有殼的正面那些像素才
   raymarch——從殼的表面沿著視線往裡走，每一步只算最近那一顆前後 NEAR 顆點的
   距離（最近的那一顆跟著視線走，見 follow）。

     打中  那個像素是曲面：法線吃主光，硬切成白與淡藍灰兩階。
     沒中  但視線曾經離曲面不到 INK_PX 個像素：那是輪廓外的一圈墨線（跟狗的
           描邊一樣粗、palette.js 的 INK）。再遠就丟掉。
   打中的地方寫真的深度（gl_FragDepth），所以狗與劍氣前後擋得對。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { KEY_DIR, INK } from './palette.js';
import { TRAILS, gapAt, sweepAt, fadeAt, qiAt } from './trail.js';

/** 最多幾顆點。第三段一整圈約 45 顆，加上頭。 */
const MAXP = 64;

/** 沿著法線壓成幾成厚。 */
const FLAT = 0.35;

/** 融合的寬度（公尺）：smooth-min 的 k。 */
const BLEND = 0.18;

/** 一個像素算距離的時候，前後各看幾顆點。 */
const NEAR = 2;

/** 擾動：半徑最多少幾成、一個起伏多長（公尺）。 */
const WOB = 0.3;
const WOBBLE = 0.9;

/** 一顆放下去之後至少多久才開始縮（秒）。 */
const HOLD = 0.1;

/** 一顆從開始縮到不見多久（秒）。 */
const SHRINK = 0.2;

/** 消散時一塊多長（公尺）：這麼長的一段差不多同時縮掉。 */
const PIECE_LEN = 1.0;

/** 描邊幾個像素寬（裝置像素）。 */
const INK_PX = 2.0;

/** 殼比點大多少（公尺）：融合鼓出去的那一點，加上墨線（3 個像素在 10 公尺外約 0.05）。殼上多一圈就多一圈要 raymarch 的像素。 */
const MARGIN = BLEND / 4 + 0.06;

/** 找放點的位置時，角度一步走多少（弧度）。 */
const STEP = 0.01;

/* INK 是 sRGB 的十六進位；這個著色器不經過 three 的色彩空間轉換，直接寫進畫面，
   所以照原樣拆成三個 0～1 的數。 */
const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c) => (c / 255).toFixed(4)).join(', ');

/* 跟著色器那一版同一種平滑噪聲，值在 0～1。 */
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

const VERT = /* glsl */ `
attribute float aIdx;   // 殼的這一截對著第幾顆點
varying vec3 vW;
varying float vIdx;
void main() {
  vW = position; vIdx = aIdx;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
#define MAXP ${MAXP}
#define NEAR ${NEAR}
/* 點存在一張 MAXP × 2 的浮點貼圖裡：第 0 列是中心與這一幀的半徑（0 就是不見了），
   第 1 列是月牙所在那個面的法線。不用 uniform 陣列：用變數去索引 uniform 陣列，
   在 ANGLE（Windows 上的 Chrome）底下會變成一長串比較，比讀貼圖慢好幾倍。 */
uniform highp sampler2D uPts;
uniform int uCount;
vec4 P(int i) { return texelFetch(uPts, ivec2(i, 0), 0); }
vec3 N(int i) { return texelFetch(uPts, ivec2(i, 1), 0).xyz; }
uniform mat4 uPV;
uniform float uPxA;      // 一個像素張多大的角（弧度）
uniform vec3 uKey;
varying vec3 vW;
varying float vIdx;
int i0, i1, ic;
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
/* 壓扁的球（橢球）的距離：Inigo Quilez 的近似。比「拉長空間再乘回去」緊得多——
   後者為了不高估，每一步只敢走真實距離的 FLAT 倍，步數多三倍。 */
float blob(int i, vec3 p) {
  vec4 c = P(i);
  if (c.w <= 0.0) return 1e3;
  vec3 n = N(i), q = p - c.xyz;
  float h = dot(q, n), s = length(q - n * h);
  vec2 e = vec2(s / c.w, h / (c.w * ${FLAT.toFixed(2)}));
  vec2 e2 = vec2(s / (c.w * c.w), h / (c.w * c.w * ${(FLAT * FLAT).toFixed(4)}));
  float k0 = length(e), k1 = length(e2);
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
float sdf(vec3 p) {
  float d = 1e3;
  for (int k = 0; k <= 2 * NEAR; k++) {
    int i = i0 + k;
    if (i > i1) break;
    /* 先量到球殼的距離（橢球只會比它更遠）：比目前最近的還遠一個融合寬度，
       這一顆融不進來，橢球那一串就不用算了。 */
    vec4 c = P(i);
    if (c.w <= 0.0 || length(p - c.xyz) - c.w > d + ${BLEND.toFixed(2)}) continue;
    d = smin(d, blob(i, p), ${BLEND.toFixed(2)});
  }
  return d;
}
/* 看哪幾顆：以離 p 最近的那一顆為中心，前後各 NEAR 顆。最近的那一顆沿著視線往前
   找：看隔壁有沒有更近的，有就挪過去——視線沿著月牙走一大段（側看那一圈）的時候，
   真正最近的點早就不在殼的那一截附近了。 */
float cd(int i, vec3 p) { vec3 q = p - P(i).xyz; return dot(q, q); }
void follow(vec3 p) {
  for (int k = 0; k < 4; k++) {
    if (ic > 0 && cd(ic - 1, p) < cd(ic, p)) ic--;
    else if (ic < uCount - 1 && cd(ic + 1, p) < cd(ic, p)) ic++;
    else break;
  }
  i0 = max(ic - NEAR, 0); i1 = min(ic + NEAR, uCount - 1);
}
void main() {
  ic = clamp(int(floor(vIdx + 0.5)), 0, uCount - 1);
  vec3 ro = cameraPosition, rd = normalize(vW - ro);
  float t = length(vW - ro), tEnd = t + 4.0;
  float best = 1e9, bestT = t;
  bool hit = false;
  for (int s = 0; s < 48; s++) {
    follow(ro + rd * t);
    float d = sdf(ro + rd * t);
    if (d / t < best) { best = d / t; bestT = t; }
    if (d < 0.5 * uPxA * t) { hit = true; break; }   // 離曲面不到半個像素
    // 殼只比點大一點：離曲面這麼遠，這條視線已經穿出去了，不會再回來。
    if (d > 0.5 || t > tEnd) break;
    t += max(d, 0.002 * t);
  }
  float miss = best / uPxA;                 // 視線離曲面最近的時候差幾個像素
  if (!hit && miss > ${(INK_PX + 1).toFixed(1)}) discard;
  vec3 p = ro + rd * (hit ? t : bestT);
  vec3 col = vec3(${rgb(INK)});
  float a = 1.0;
  if (hit) {
    vec2 e = vec2(0.002, -0.002);
    vec3 n = normalize(e.xyy * sdf(p + e.xyy) + e.yyx * sdf(p + e.yyx) + e.yxy * sdf(p + e.yxy) + e.xxx * sdf(p + e.xxx));
    float ndl = dot(n, uKey), w = max(fwidth(ndl), 1e-4);
    col = mix(vec3(0.74, 0.82, 0.95), vec3(1.0), smoothstep(0.1 - w, 0.1 + w, ndl));
  } else {
    a = clamp(${(INK_PX + 1).toFixed(1)} - miss, 0.0, 1.0);
  }
  vec4 clip = uPV * vec4(p, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5 + (hit ? 0.0 : 1e-5), 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** 一道劍氣。借來、start、每幀 step，step 回 false 就是收掉了，可以再借。 */
export class Qi {
  constructor() {
    /* 殼：每一顆點一個方形截面（4 個頂點），頭尾各多兩截（包住球、再收成一點）。 */
    const rows = MAXP + 5, g = new THREE.BufferGeometry();
    this._pos = new THREE.BufferAttribute(new Float32Array(rows * 4 * 3), 3);
    this._idx = new THREE.BufferAttribute(new Float32Array(rows * 4), 1);
    for (const a of [this._pos, this._idx]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this._pos);
    g.setAttribute('aIdx', this._idx);
    const idx = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let j = 0; j < 4; j++) {
        const a = r * 4 + j, b = a + 4, a1 = r * 4 + ((j + 1) % 4), b1 = a1 + 4;
        idx.push(a, b, b1, a, b1, a1);
      }
    }
    g.setIndex(idx);
    this.geometry = g;

    this._data = new Float32Array(MAXP * 2 * 4);
    this._tex = new THREE.DataTexture(this._data, MAXP, 2, THREE.RGBAFormat, THREE.FloatType);
    this._tex.minFilter = this._tex.magFilter = THREE.NearestFilter;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uPts: { value: this._tex }, uCount: { value: 0 },
        uPV: { value: new THREE.Matrix4() }, uPxA: { value: 0.001 }, uKey: { value: KEY_DIR },
      },
      transparent: true, depthWrite: true, side: THREE.FrontSide, fog: false,
    });
    const mesh = new THREE.Mesh(g, this.material);
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    /* 著色器要這一幀的投影（寫深度）與一個像素張多大的角（量墨線），畫之前才知道。 */
    const size = new THREE.Vector2();
    mesh.onBeforeRender = (renderer, scene, camera) => {
      const u = this.material.uniforms;
      u.uPV.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      renderer.getDrawingBufferSize(size);
      u.uPxA.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / size.y;
    };
    this.node = mesh;
    this.node.visible = false;
    this.kind = null;
  }

  /** 起一道：哪一段、第二段指著的末端點。 */
  start(kind, tip) {
    this.kind = kind;
    this.tip = tip;
    this.tau = 0;
    this.pts = [];
    this.head = null;
    this._th = null;
    this._seed = Math.random() * 100;
    this.material.uniforms.uCount.value = 0;
    this.geometry.setDrawRange(0, 0);
    this.node.visible = true;
  }

  /** 往前一幀：還在掃就放點，然後算每一顆這一幀多大。回 false 就是收掉了。 */
  step(dt, player) {
    const T = TRAILS[this.kind];
    const prev = this.tau;
    this.tau += dt;
    if (prev <= T.t1) this._lay(sweepAt(this.kind, this.tau), player);
    this._size();
    this.node.visible = this.tau < T.life;
    return this.node.visible;
  }

  /** 收起來。 */
  stop() { this.node.visible = false; }

  /**
   * 掃到 θ 了：從上一顆往 θ 一小步一小步走，離上一顆夠遠（gapAt）就放一顆
   * （第一次先放起點那一顆）。刀尖在 θ 那一顆當頭，不固定。
   */
  _lay(theta, player) {
    const T = TRAILS[this.kind], dir = Math.sign(T.to - T.from);
    const at = (th) => this._point(qiAt(this.kind, th, player, this.tip));
    if (this._th === null) { this._th = T.from; this.pts.push(at(T.from)); }
    for (let th = this._th + STEP * dir; (theta - th) * dir >= 0 && this.pts.length < MAXP - 1; th += STEP * dir) {
      const p = at(th), last = this.pts[this.pts.length - 1];
      if (Math.hypot(...sub(p.c, last.c)) >= gapAt(p.w)) { this.pts.push(p); this._th = th; }
    }
    this.head = theta !== this._th ? at(theta) : null;
    this._hull();
  }

  /** qiAt 的一截 → 一顆點：中心、寬、面法線、刀的方向、沿著月牙的長度、什麼時候放的。 */
  _point(q) {
    const last = this.pts[this.pts.length - 1];
    const l = last ? last.l + Math.hypot(...sub(q.p, last.c)) : 0;
    return { c: q.p, w: q.w, N: norm(cross(q.b.d, q.b.t)), d: q.b.d, l, born: this.tau };
  }

  /** 全部的點（加上頭）。 */
  _all() { return this.head ? [...this.pts, this.head] : this.pts; }

  /**
   * 殼：每一顆一個方形截面——沿著刀的方向 ±(半寬 + MARGIN)、沿著面法線
   * ±(半寬·FLAT + MARGIN)——頭尾沿著路徑再伸出去一個半寬（把球的前後包進去），
   * 最後收成一點把管口封起來。
   */
  _hull() {
    const P = this._all(), n = P.length;
    if (!n) return;
    const rows = [];
    const tan = (i) => norm(n === 1 ? cross(P[0].N, P[0].d) : sub(P[Math.min(i + 1, n - 1)].c, P[Math.max(i - 1, 0)].c));
    const section = (c, p, i, scale) => {
      const R = (p.w / 2 + MARGIN) * scale, H = (p.w / 2 * FLAT + MARGIN) * scale;
      rows.push({ i, corners: [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => [0, 1, 2].map((k) => c[k] + p.d[k] * a * R + p.N[k] * b * H)) });
    };
    const ext = (i, s) => { const t = tan(i), r = P[i].w / 2 + MARGIN; return [0, 1, 2].map((k) => P[i].c[k] + t[k] * s * r); };
    section(ext(0, -1), P[0], 0, 0);
    section(ext(0, -1), P[0], 0, 1);
    P.forEach((p, i) => section(p.c, p, i, 1));
    section(ext(n - 1, 1), P[n - 1], n - 1, 1);
    section(ext(n - 1, 1), P[n - 1], n - 1, 0);
    rows.forEach((r, ri) => r.corners.forEach((v, j) => {
      this._pos.setXYZ(ri * 4 + j, v[0], v[1], v[2]);
      this._idx.setX(ri * 4 + j, r.i);
    }));
    this._pos.needsUpdate = true;
    this._idx.needsUpdate = true;
    this.geometry.setDrawRange(0, (rows.length - 1) * 4 * 6);
  }

  /** 每一顆這一幀多大：扣掉融合鼓出去的那一點、乘上擾動、被吃掉的那幾成。 */
  _size() {
    const P = this._all(), D = this._data;
    /* 最晚放下去的那一顆（t1）等最久也要在 life 縮完。 */
    const spread = Math.max(0, TRAILS[this.kind].life - TRAILS[this.kind].t1 - HOLD - SHRINK);
    const fade = fadeAt(this.kind, this.tau);
    P.forEach((p, i) => {
      const wob = 1 - WOB * noise(p.l / WOBBLE + this._seed, this.tau * 1.4 + this._seed);
      const wait = HOLD + spread * noise(p.l / PIECE_LEN + this._seed * 1.7, this._seed);
      const eat = Math.min(1, Math.max(0, (this.tau - p.born - wait) / SHRINK));
      const r = Math.max(0, p.w / 2 - BLEND / 4) * wob * (1 - eat) * (fade > 0 ? 1 : 0);
      D.set([p.c[0], p.c[1], p.c[2], r], i * 4);
      D.set([p.N[0], p.N[1], p.N[2], 0], (MAXP + i) * 4);
    });
    this._tex.needsUpdate = true;
    this.material.uniforms.uCount.value = P.length;
  }
}
