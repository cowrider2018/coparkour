/* ── test-area/src/surface.js ────────────────────────────────────────
   石紋、木紋、灰泥、瓦、鐵、布：表面的那一層。

   ── 為什麼是「載入時算出來的貼圖」而不是著色器裡的雜訊 ─────────────
   紋路要在遠處還讀得出來、又不能閃。著色器裡即時算的雜訊沒有 mipmap，
   遠處一個像素蓋住十幾道木紋，它只能取其中一點——於是整面牆在走路時
   沙沙地爬。貼圖有 mipmap，遠處取的是平均，自然就淡成素色。

   貼圖不是檔案，是開場用 JS 算出來的：兩張 256² 的 RGBA，每一個通道是
   一種材料的「高度場」（0 = 溝、0.5 = 平、1 = 凸）。通道各自無縫拼接，
   所以 REPEAT 取樣、mipmap 都照 GPU 自己的來，沒有圖集的接縫問題。

   ── 分階，不是漸層 ───────────────────────────────────────────────
   高度場本身是平滑的，但它**不直接**乘上去：片段著色器把它切成三階
   （溝／平／凸），交界只留 fwidth 那麼寬——跟 palette.js 的五階調是同一
   招。所以近看是一塊一塊的平色（手繪感），遠看 mipmap 把場平均成 0.5，
   三階收成「平」那一階，紋路就這樣淡掉，不會閃。

   256² 夠用也是因為這件事：一個平滑的場拿去切階，放大之後邊緣仍然是
   銳利的（那其實就是距離場字型的做法），貼圖本身的解析度只決定形狀的
   細節，不決定邊緣的銳利度。

   ── 投影 ────────────────────────────────────────────────────────
   沒有 UV（geom.js 的 facet 把它刪了）。每一塊幾何帶著自己的「紋理方向」
   （它最長的那一軸，見 geom.js 的 Build.add），著色器用它在每一個面上
   立一組座標：u 沿著紋理方向、v 橫過去。木紋因此順著木料走、瓦沿著簷口
   排、磚上的鑿痕順著磚長。端面（法線跟紋理方向平行）改用另一組軸，木料
   的端面換成木口的紋路。

   每一塊還帶一個 0～15 的偏移，所以相鄰兩塊磚的紋路不會連成一片——那樣
   看起來是一張紋路貼在一面牆上，而不是一塊一塊的石頭。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';

/** 材料編號。0 = 素色（不上紋）。頂點屬性只放得下 0～7。 */
export const SURF = {
  none: 0, stone: 1, granite: 2, wood: 3, plaster: 4, tile: 5, iron: 6, cloth: 7,
  /* 以下兩個不進頂點屬性：dirt 是地面那一片（單色材質，用 define 指定），
     endGrain 是著色器自己在木料的端面上換過去的。 */
  dirt: 8, endGrain: 9,
};

/** 貼圖一邊多少像素。 */
export const TEX_N = 256;

/* ── 每一種材料怎麼上 ──────────────────────────────────────────────
   tex/ch   在哪一張、哪一個通道
   size     一張貼圖在世界裡蓋多大（u 沿紋理方向, v 橫過去），公尺
   lo/hi    切階的兩道界：高度場低於 lo 是溝、高於 hi 是凸
   dark/lit 溝與凸乘上去的倍數

   對比是刻意拉大的（溝 ×0.6 上下、凸 ×1.15 上下）：這一頁的材質要在
   十幾公尺外還分得出「這是石頭、那是木頭」。唯一收一點的是花崗岩——它
   是狗在上面跑的那片地板，紋路太搶會讓人看不清地面在哪裡。 */
export const SURF_DEF = [
  /* 0 none     */ { tex: 0, ch: 0, size: [1, 1], lo: 0, hi: 1, dark: 1, lit: 1 },
  /* 1 stone    */ { tex: 0, ch: 0, size: [1.6, 1.6], lo: 0.30, hi: 0.66, dark: 0.62, lit: 1.17 },
  /* 2 granite  */ { tex: 1, ch: 0, size: [1.5, 1.5], lo: 0.30, hi: 0.68, dark: 0.74, lit: 1.12 },
  /* 3 wood     */ { tex: 0, ch: 1, size: [1.2, 0.36], lo: 0.32, hi: 0.66, dark: 0.58, lit: 1.16 },
  /* 4 plaster  */ { tex: 0, ch: 2, size: [2.4, 2.4], lo: 0.30, hi: 0.68, dark: 0.80, lit: 1.08 },
  /* 5 tile     */ { tex: 0, ch: 3, size: [1.0, 0.34], lo: 0.30, hi: 0.68, dark: 0.60, lit: 1.15 },
  /* 6 iron     */ { tex: 1, ch: 1, size: [0.6, 0.6], lo: 0.30, hi: 0.68, dark: 0.62, lit: 1.32 },
  /* 7 cloth    */ { tex: 1, ch: 2, size: [0.9, 0.9], lo: 0.30, hi: 0.68, dark: 0.80, lit: 1.10 },
  /* 8 dirt     */ { tex: 1, ch: 3, size: [2.0, 2.0], lo: 0.30, hi: 0.68, dark: 0.78, lit: 1.12 },
  /* 9 endGrain */ { tex: 1, ch: 3, size: [0.5, 0.5], lo: 0.30, hi: 0.68, dark: 0.66, lit: 1.12 },
];

/** 石頭頂面的苔：用灰泥那個通道的大塊斑，另外一個尺度取樣。mix 是苔色蓋掉多少石色。 */
export const MOSS = { size: 3.0, at: 0.63, mix: 0.7 };

/* ── 可拼接的雜訊 ─────────────────────────────────────────────────
   全部是週期的：格點座標先對週期取模再雜湊，所以 (0, y) 與 (1, y) 取到
   的是同一個格點。x、y 的週期可以不一樣——木紋是一個沿紋理方向拉長的場，
   它的格子在 u 上疏、在 v 上密。 */

function hash(i, j, s) {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const wrap = (i, p) => ((i % p) + p) % p;
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ── 雜訊是「先建好、再取樣」的 ─────────────────────────────────────
   一個像素要問幾百次雜湊，而格點只有幾千個。所以每一支雜訊在模組載入時
   就把自己的格點表算好、綁進閉包，取樣時只剩查表與內插——直接算雜湊的話
   開場要多等一半的時間（node 上量過：310 ms → 210 ms）。 */

function lattice(px, py, s) {
  const L = new Float32Array(px * py);
  for (let j = 0; j < py; j++) for (let i = 0; i < px; i++) L[j * px + i] = hash(i, j, s);
  return L;
}

/** 值雜訊。取樣的 x, y ∈ [0,1)，px／py 是兩軸各有幾個格子。 */
function vnoise(px, py, s) {
  const L = lattice(px, py, s);
  return (x, y) => {
    const fx = x * px, fy = y * py;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fade(fx - ix), ty = fade(fy - iy);
    const x0 = wrap(ix, px), x1 = wrap(ix + 1, px);
    const y0 = wrap(iy, py) * px, y1 = wrap(iy + 1, py) * px;
    const a = L[y0 + x0], b = L[y0 + x1];
    const c = L[y1 + x0], d = L[y1 + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

/** 碎形疊加：每一層的週期加倍。取樣回傳大致落在 [0,1]、平均 0.5。 */
function fbm(px, py, oct, s) {
  const ns = [], amps = [];
  let amp = 0.5, tot = 0;
  for (let k = 0; k < oct; k++) {
    ns.push(vnoise(px << k, py << k, s + k * 101));
    amps.push(amp); tot += amp; amp *= 0.5;
  }
  return (x, y) => {
    let v = 0;
    for (let k = 0; k < oct; k++) v += ns[k](x, y) * amps[k];
    return v / tot;
  };
}

/**
 * Worley：每一格一個抖過的點。取樣把「到最近兩點的距離」（格子單位）與
 * 「最近那一點的身分」（一個 [0,1) 的雜湊，當成那一塊自己的明暗）寫進 out。
 */
function worley(p, s) {
  const JX = lattice(p, p, s), JY = lattice(p, p, s + 7), ID = lattice(p, p, s + 13);
  return (x, y, out) => {
    const fx = x * p, fy = y * p;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let f1 = 99, f2 = 99, id = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const cx = ix + di, cy = iy + dj;
        const w = wrap(cy, p) * p + wrap(cx, p);
        const ex = fx - cx - JX[w], ey = fy - cy - JY[w];
        const d = ex * ex + ey * ey;           // 先比平方，最後才開根號
        if (d < f1) { f2 = f1; f1 = d; id = ID[w]; } else if (d < f2) f2 = d;
      }
    }
    out[0] = Math.sqrt(f1); out[1] = Math.sqrt(f2); out[2] = id;
    return out;
  };
}

/* ── 八種高度場 ───────────────────────────────────────────────────
   每一支吃 (u, v) ∈ [0,1)，吐 [0,1]。0.5 是「平」，切階的兩道界大約在
   0.3 與 0.67——所以「溝」要壓到 0.3 以下才會出現，「凸」要頂到 0.67 以上。
   每一支都是同一個配方：一層大塊的色面（手繪時的第一層）、一層線或點
   （鑿痕、木紋、瓦縫），各自的比例照那種材料實際長什麼樣。 */

const W1 = [0, 0, 0], W2 = [0, 0, 0];

/** 石：鑿出來的平面、少數幾道裂、幾個坑。 */
const stoneField = (() => {
  const m = fbm(4, 4, 4, 11), facets = worley(3, 12), cracks = worley(5, 14);
  const crackMask = fbm(3, 3, 2, 15), pits = worley(9, 16);
  return (u, v) => {
    facets(u, v, W1);
    const facet = (W1[2] - 0.5) * 0.46;            // 每一塊鑿面自己的明暗
    cracks(u, v, W2);
    const crack = (1 - smoothstep(0.015, 0.06, W2[1] - W2[0])) * smoothstep(0.58, 0.68, crackMask(u, v));
    pits(u, v, W1);
    const pit = W1[2] < 0.3 ? 1 - smoothstep(0.1, 0.22, W1[0]) : 0;
    return 0.52 + facet + (m(u, v) - 0.5) * 0.5 - crack * 0.55 - pit * 0.4;
  };
})();

/** 木：沿 u 走的年輪線、被扭過的節、幾道長的亮紋。 */
const woodField = (() => {
  const KNOTS = [[0.23, 0.31, 0.09], [0.71, 0.77, 0.07]];
  const ASP = SURF_DEF[3].size[0] / SURF_DEF[3].size[1];   // u 在世界裡比 v 長幾倍
  const warp = fbm(2, 6, 3, 21), broken = fbm(3, 5, 2, 22), streaks = fbm(1, 12, 3, 23);
  return (u, v) => {
    let w = v * 10 + (warp(u, v) - 0.5) * 3.0;
    let core = 0;
    for (const [ku, kv, kr] of KNOTS) {
      let du = Math.abs(u - ku); du = Math.min(du, 1 - du);
      let dv = Math.abs(v - kv); dv = Math.min(dv, 1 - dv);
      const d = Math.sqrt(du * du * ASP * ASP + dv * dv) / kr;
      w += 2.4 * Math.exp(-d * d);                 // 年輪繞著節彎過去
      core = Math.max(core, 1 - smoothstep(0.25, 0.45, d));
    }
    const f = w - Math.floor(w);
    const line = (1 - smoothstep(0.04, 0.16, Math.min(f, 1 - f)))
      * smoothstep(0.32, 0.52, broken(u, v));        // 有些線斷掉
    return 0.5 - line * 0.42 + (streaks(u, v) - 0.5) * 1.0 - core * 0.5;
  };
})();

/** 灰泥：大塊的斑、水漬、幾條髮絲裂。 */
const plasterField = (() => {
  const b = fbm(3, 3, 5, 31), stains = fbm(2, 2, 3, 32), cracks = worley(4, 33), crackMask = fbm(2, 2, 2, 34);
  return (u, v) => {
    cracks(u, v, W1);
    const crack = (1 - smoothstep(0.015, 0.045, W1[1] - W1[0])) * smoothstep(0.6, 0.7, crackMask(u, v));
    return 0.46 + (b(u, v) - 0.5) * 1.2 - smoothstep(0.58, 0.7, stains(u, v)) * 0.3 - crack * 0.5;
  };
})();

/** 瓦：沿簷口一片一片，片與片之間一道暗縫，每一片自己的深淺。 */
const tileField = (() => {
  const N = 4, tones = lattice(N, 1, 41), wear = fbm(4, 2, 3, 42);
  return (u, v) => {
    const x = u * N, col = Math.floor(x), fu = x - col;
    const gap = 1 - smoothstep(0.02, 0.07, Math.min(fu, 1 - fu));
    return 0.5 + (tones[col % N] - 0.5) * 0.5 - gap * 0.5 + (wear(u, v) - 0.5) * 1.2;
  };
})();

/** 花崗岩：細的斑點（深的、亮的），加一層淡淡的斑駁與少數裂。 */
const graniteField = (() => {
  const m = fbm(3, 3, 3, 51), dots = worley(28, 52), cracks = worley(3, 53), crackMask = fbm(2, 2, 2, 54);
  return (u, v) => {
    dots(u, v, W1);
    const dot = 1 - smoothstep(0.12, 0.3, W1[0]);
    const tone = W1[2] < 0.35 ? -0.4 : W1[2] > 0.8 ? 0.3 : 0;
    cracks(u, v, W2);
    const crack = (1 - smoothstep(0.015, 0.05, W2[1] - W2[0])) * smoothstep(0.55, 0.65, crackMask(u, v));
    return 0.5 + (m(u, v) - 0.5) * 0.6 + dot * tone - crack * 0.45;
  };
})();

/** 鐵：錘過的淺坑（中間亮、邊緣暗）與幾塊鏽。 */
const ironField = (() => {
  const dents = worley(6, 61), rust = fbm(3, 3, 4, 62);
  return (u, v) => {
    dents(u, v, W1);
    return 0.5 + (0.42 - W1[0]) * 0.8 - smoothstep(0.6, 0.72, rust(u, v)) * 0.35;
  };
})();

/** 布：磨淡的地方、髒的地方，加一層很淡的斜紋。 */
const clothField = (() => {
  const wear = fbm(3, 3, 4, 71);
  return (u, v) => {
    const t = (u + v) * 24, rib = Math.abs(t - Math.floor(t) - 0.5) * 2;
    return 0.5 + (wear(u, v) - 0.5) * 1.0 + (rib - 0.5) * 0.12;
  };
})();

/** 碎粒：地面的小石子與土，木口也用它。 */
const gritField = (() => {
  const m = fbm(4, 4, 3, 81), pebbles = worley(14, 82);
  return (u, v) => {
    pebbles(u, v, W1);
    const peb = 1 - smoothstep(0.25, 0.45, W1[0]);
    const tone = W1[2] < 0.4 ? -0.3 : W1[2] > 0.75 ? 0.28 : 0;
    return 0.5 + (m(u, v) - 0.5) * 0.7 + peb * tone;
  };
})();

/** 兩張貼圖、各四個通道。順序就是 SURF_DEF 裡的 tex／ch。 */
export const FIELDS = [
  [stoneField, woodField, plasterField, tileField],
  [graniteField, ironField, clothField, gritField],
];

/**
 * 把兩張貼圖的像素算出來。node 底下也跑得動（驗證器靠它查無縫與分佈）。
 * @returns {Uint8Array[]} 兩份 RGBA，各 TEX_N² × 4
 */
export function surfacePixels() {
  return FIELDS.map((fs) => {
    const px = new Uint8Array(TEX_N * TEX_N * 4);
    for (let j = 0; j < TEX_N; j++) {
      const v = (j + 0.5) / TEX_N;
      for (let i = 0; i < TEX_N; i++) {
        const u = (i + 0.5) / TEX_N, o = (j * TEX_N + i) * 4;
        for (let c = 0; c < 4; c++) {
          const x = fs[c](u, v);
          px[o + c] = Math.round(Math.min(1, Math.max(0, x)) * 255);
        }
      }
    }
    return px;
  });
}

let TEX = null;
/** 兩張貼圖本身。第一次要的時候才算，之後同一份。 */
export function surfaceTextures() {
  if (TEX) return TEX;
  TEX = surfacePixels().map((px) => {
    const t = new THREE.DataTexture(px, TEX_N, TEX_N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = THREE.NoColorSpace;          // 這是高度場，不是顏色
    t.needsUpdate = true;
    return t;
  });
  return TEX;
}

/** 攤平成兩組 vec4：(tex, ch, 1/su, 1/sv) 與 (lo, hi, dark, lit)。 */
export function surfaceUniforms() {
  const a = [], b = [];
  for (const d of SURF_DEF) {
    a.push(new THREE.Vector4(d.tex, d.ch, 1 / d.size[0], 1 / d.size[1]));
    b.push(new THREE.Vector4(d.lo, d.hi, d.dark, d.lit));
  }
  return { a, b };
}

/* ── 頂點屬性的編法 ───────────────────────────────────────────────
   aSurf 是 4 個正規化的 int8：xyz 是紋理方向，w 是 材料 × 16 + 偏移。
   w 只用到 0～127，所以 (w × 127) 取整數就解得回來。 */
export const packSurf = (mat, off) => (mat & 7) * 16 + (off & 15);
