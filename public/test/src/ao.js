/* ── test/src/ao.js ─────────────────────────────────────────────
   石頭腳下那一圈暗：接觸陰影，烘一次，零 runtime。

   ── 它是什麼 ────────────────────────────────────────────────────
   五階調只看法線，所以一根柱子跟地面的交界，兩邊各自是各自的亮度——柱子
   看起來是「擺」在地上的，而不是「壓」在地上。真的石頭在那一條縫裡是暗的：
   光從上面來，柱腳那一圈地面有一半的天空被柱子擋掉了。這一支在地面上、
   每一塊落地的石頭四周，鋪兩道窄窄的墨色：貼著石頭的那一道深，外面那一道
   淡，然後就沒了。兩階、硬邊——跟石頭本身的五階調同一種語言，不是一片
   柔焦的漸層。

   ── 為什麼是距離場而不是一圈一圈的環 ──────────────────────────
   最直接的做法是每個碰撞體外面擠一圈環（跟 veil.js 的牆腳同一招）。但半
   透明的環疊在一起會再暗一次：一道牆是十幾個盒子並排，每兩個之間的接縫
   就是一個疊暗的三角形，整道牆腳變成一排鋸齒。要「兩圈靠近的時候合成
   一圈」，得先把所有的腳印合起來才算邊——那就是距離場：每一格存「離最近
   那塊石頭多遠」，取最小值，聯集就是免費的。著色器再把這個距離切成兩階。

   距離場用很粗的格子（16 格／公尺）也切得出銳利的邊：雙線性內插一個距離，
   在直線的附近是精確的（這就是向量字型用的那一招），而階的邊靠 fwidth
   反鋸齒，跟 palette.js 的 BAND_SOFT 一樣。

   ── 腳印從哪裡來 ────────────────────────────────────────────────
   不是碰撞體：碰撞體是軸對齊的盒子，圓形水窖那一圈斜著的牆在碰撞清單上是
   一排鋸齒狀的盒子，照它畫出來的陰影就是一排鋸齒。腳印取的是**真的幾何**：
   geom.js 記下每一塊夠高的石頭在頂點緩衝區裡的範圍（`feet`），這裡取它
   貼地那一截的頂點、投到地面上、包一個凸包。斜的牆就是斜的、十稜的柱就是
   十邊形。距離取「到每一條邊的有號距離的最大值」——凸多邊形這樣算出來的
   外擴是尖角的（方的石頭外面是方的一圈），比圓角更像鑿出來的東西。

   ── 地面不只一層 ────────────────────────────────────────────────
   王座的台座、城牆的步道上面也站著東西。每一片 'floor' 碰撞體（盒子就是
   那個東西本身，頂面就是看得到的頂面——見 geom.js）的頂面算一層，站在上面
   的石頭在那一層上鋪自己的陰影；那一層的 quad 照台面的範圍裁，不會懸在
   台座的邊外面。階梯不算一層：水窖的螺旋梯是斜的，它的碰撞盒比踏面大，
   照盒子裁會把陰影鋪到空中。

   ── 輸出 ───────────────────────────────────────────────────────
   跟 veil.js 同一個分工：這裡只吐資料（頂點、uv、一張單通道的貼圖），
   材質與 mesh 是 stage.js 的事。地面切成 2 公尺見方的磚，只有有陰影的磚才
   出一個 quad、在貼圖集裡佔一格——空曠的場地中央一個片段都不畫。
   ------------------------------------------------------------------ */

export const AO = {
  res: 16,            // 每公尺幾格
  tile: 2,            // 一塊磚幾公尺
  max: 0.5,           // 距離場存到多遠（貼圖的 255）
  bands: [[0.16, 0.45], [0.38, 0.22]],  // [離石頭多遠以內, 透明度]，由內而外
  lift: 0.03,         // 躺在地面上方這麼高（跟黑牆的牆腳同一個數，蓋得住鋪面）
  reach: 0.4,         // 取石頭貼地那一截多高的頂點當腳印
  minH: 0.12,         // 比這矮的不算（碎石片、鋪面）
  atlas: 1024,        // 貼圖集多寬
};

/** 單調鏈凸包，xz 平面，逆時針（從上往下看是順時針——無所謂，下面兩種都認）。 */
function hull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-9) lo.pop();
    lo.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 1e-9) hi.pop();
    hi.push(p);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/**
 * 一個凸包 → 每一條邊的外法線與常數（n·p − c = 到那條邊的有號距離）。
 * 退化的（一條線、一個點）回傳 null：那是一片垂直的薄片，壓不出陰影。
 */
function planes(H) {
  if (H.length < 3) return null;
  let area = 0;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(area) < 1e-4) return null;
  const s = area > 0 ? 1 : -1;      // 繞向，換成外法線的方向
  const E = [];
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const L = Math.hypot(ex, ez);
    if (L < 1e-6) continue;
    const nx = (ez / L) * s, nz = (-ex / L) * s;
    E.push(nx, nz, nx * a[0] + nz * a[1]);
  }
  return E;
}

/** 一組軸對齊的矩形 → 不重疊的小矩形（聯集）。用所有邊切一張格子，中心落在任何一個裡面的格子就收。 */
function unionCells(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  const zs = [...new Set(rects.flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      if (rects.some((r) => cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3])) {
        out.push([xs[i], zs[j], xs[i + 1], zs[j + 1]]);
      }
    }
  }
  return out;
}

/**
 * @param {object} ruins blocks.js 的 buildRuins() 的結果（要 geometry、feet、colliders、arenas）
 * @returns {{pos: Float32Array, uv: Float32Array, tris: number,
 *   tex: {data: Uint8Array, w: number, h: number}, tiles: number, feet: number}}
 */
export function buildAO(ruins) {
  const P = ruins.geometry.attributes.position.array;
  const F = ruins.feet;
  const { res, tile, max, lift, reach, minH } = AO;
  const N = tile * res, S = N + 2;        // 一塊磚 N×N 格，四周多一圈給內插用

  /* ── 層 ── 地面（第 0 層，範圍是各個場地）與每一個台面的高度。 */
  const levels = [{ y: 0, rects: null }];
  const COLS = ruins.colliders;
  for (const c of COLS) {
    if (c.kind !== 'floor' || c.shape === 'circle' || c.air || c.door) continue;
    const top = c.max[1];
    if (top < minH) continue;
    let L = levels.find((l) => l.rects && Math.abs(l.y - top) < 0.02);
    if (!L) levels.push(L = { y: top, rects: [] });
    L.rects.push([c.min[0], c.min[2], c.max[0], c.max[2]]);
  }
  for (const L of levels) if (L.rects) L.cells = unionCells(L.rects);
  const pits = COLS.filter((c) => c.kind === 'pit');
  const arenas = ruins.arenas;
  const inArena = (x, z) => arenas.some((a) => (a.shape === 'circle'
    ? (x - a.x) ** 2 + (z - a.z) ** 2 < a.r * a.r
    : x > a.x0 && x < a.x1 && z > a.z0 && z < a.z1));

  /* ── 腳印 ── 每一塊落地的石頭：落在哪一層、貼地那一截的凸包。 */
  const tiles = new Map();                // `${層}:${tx}:${tz}` → { li, tx, tz, d }
  let used = 0;
  for (let k = 0; k < F.length; k += 2) {
    const i0 = F[k], i1 = F[k + 1];
    let y0 = Infinity, y1 = -Infinity;
    for (let i = i0 + 1; i < i1; i += 3) { if (P[i] < y0) y0 = P[i]; if (P[i] > y1) y1 = P[i]; }
    /* 落在哪一層：底在那一層附近（地面的話可以埋進去），而且高出那一層夠多。
       埋進地下的牆基也算地面的——它從地面長出來，交界就在 y = 0。 */
    let li = -1;
    if (y0 > -0.7 && y0 < 0.06 && y1 > minH) li = 0;
    else {
      for (let l = 1; l < levels.length; l++) {
        if (Math.abs(y0 - levels[l].y) < 0.06 && y1 > levels[l].y + minH) { li = l; break; }
      }
    }
    if (li < 0) continue;
    const ly = levels[li].y;
    const cut = Math.max(y0, ly) + reach;
    const pts = [];
    for (let i = i0; i < i1; i += 3) if (P[i + 1] <= cut) pts.push([P[i], P[i + 2]]);
    const H = hull(pts);
    // 台面上的：凸包的中心要在台面上，不然它是站在別的東西上、剛好同高。
    if (li > 0) {
      let cx = 0, cz = 0;
      for (const p of H) { cx += p[0]; cz += p[1]; }
      cx /= H.length; cz /= H.length;
      if (!levels[li].cells.some((r) => cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3])) continue;
    }
    const E = planes(H);
    if (!E) continue;
    used++;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of H) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
    }
    x0 -= max; z0 -= max; x1 += max; z1 += max;
    for (let tx = Math.floor(x0 / tile); tx <= Math.floor(x1 / tile); tx++) {
      for (let tz = Math.floor(z0 / tile); tz <= Math.floor(z1 / tile); tz++) {
        const key = `${li}:${tx}:${tz}`;
        let T = tiles.get(key);
        if (!T) tiles.set(key, T = { li, tx, tz, d: new Float32Array(S * S).fill(max) });
        // 第 k 格的中心在 tx·tile + (k − 0.5)/res（k = 0 與 S−1 是外圈那一格）
        const bx = tx * tile, bz = tz * tile;
        const k0 = Math.max(0, Math.floor((x0 - bx) * res + 0.5)), k1 = Math.min(S - 1, Math.ceil((x1 - bx) * res + 0.5));
        const m0 = Math.max(0, Math.floor((z0 - bz) * res + 0.5)), m1 = Math.min(S - 1, Math.ceil((z1 - bz) * res + 0.5));
        for (let m = m0; m <= m1; m++) {
          const z = bz + (m - 0.5) / res;
          for (let kk = k0; kk <= k1; kk++) {
            const x = bx + (kk - 0.5) / res;
            let d = -Infinity;
            for (let e = 0; e < E.length; e += 3) {
              const s = E[e] * x + E[e + 1] * z - E[e + 2];
              if (s > d) d = s;
            }
            const j = m * S + kk;
            if (d < T.d[j]) T.d[j] = d < 0 ? 0 : d;
          }
        }
      }
    }
  }

  /* ── 遮罩 ── 地面那一層：黑牆外面、井口裡面都沒有地面可以鋪。圓的場地
     靠這一步裁（quad 是方的）；方的場地下面另外照框裁 quad。 */
  const wOut = AO.bands[AO.bands.length - 1][0];
  const live = [];
  for (const T of tiles.values()) {
    const bx = T.tx * tile, bz = T.tz * tile;
    let any = false;
    for (let m = 0; m < S; m++) {
      const z = bz + (m - 0.5) / res;
      for (let kk = 0; kk < S; kk++) {
        const j = m * S + kk;
        if (T.d[j] >= max) continue;
        const x = bx + (kk - 0.5) / res;
        if (T.li === 0 && (!inArena(x, z) || pits.some((p) => (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r))) {
          T.d[j] = max;
          continue;
        }
        if (T.d[j] < wOut) any = true;
      }
    }
    if (any) live.push(T);
  }

  /* ── 貼圖集與 quad ── */
  const per = Math.floor(AO.atlas / S);
  const W = AO.atlas, Hh = Math.max(1, Math.ceil(live.length / per)) * S;
  const data = new Uint8Array(W * Hh);
  const pos = [], uv = [];
  live.forEach((T, n) => {
    const ox = (n % per) * S, oy = Math.floor(n / per) * S;
    for (let m = 0; m < S; m++) {
      for (let kk = 0; kk < S; kk++) {
        data[(oy + m) * W + ox + kk] = Math.round((Math.min(T.d[m * S + kk], max) / max) * 255);
      }
    }
    const bx = T.tx * tile, bz = T.tz * tile;
    const L = levels[T.li];
    const y = L.y + lift;
    // 世界座標 → 貼圖集的 uv：第 k 格的中心在 ox + k + 0.5，對到 bx + (k − 0.5)/res
    const U = (x) => (ox + (x - bx) * res + 1) / W, V = (z) => (oy + (z - bz) * res + 1) / Hh;
    /* 這一塊磚要鋪在哪些矩形裡：地面是場地的外框，台面是台面的聯集。
       繞向讓法線朝上（從上面看得到，跟黑牆的牆腳一樣）。 */
    const clips = L.rects ? L.cells : arenas.map((a) => (a.shape === 'circle'
      ? [a.x - a.r, a.z - a.r, a.x + a.r, a.z + a.r] : [a.x0, a.z0, a.x1, a.z1]));
    for (const r of clips) {
      const x0 = Math.max(bx, r[0]), x1 = Math.min(bx + tile, r[2]);
      const z0 = Math.max(bz, r[1]), z1 = Math.min(bz + tile, r[3]);
      if (x1 - x0 < 1e-4 || z1 - z0 < 1e-4) continue;
      const q = [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]];
      for (const [x, z] of q) { pos.push(x, y, z); uv.push(U(x), V(z)); }
    }
  });

  return {
    pos: new Float32Array(pos),
    uv: new Float32Array(uv),
    tris: pos.length / 9,
    tex: { data, w: W, h: Hh },
    tiles: live.length,
    feet: used,
  };
}
