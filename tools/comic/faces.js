/* ── tools/comic/faces.js ─────────────────────────────────────────────
   漫畫的表情（只在漫畫裡：攝影棚 studio.js 拍完之後畫在圖上，遊戲裡的眼睛不變）。

   模型的眼睛是固定的兩片，演不了戲；漫畫的表情幾乎全靠眼睛與眉毛，所以拍的時候把模型
   那兩片藏起來，照這一隻的眼睛在畫面上的位置、大小、頭的傾斜，用 2D 畫上漫畫的眼睛、
   眉毛、眼淚、汗。

   每一隻眼睛一個錨點（studio.js 從眼睛那根骨頭投影出來）：
     x, y    眼睛中心（畫布像素）
     r       眼睛的半高（像素，沒收合的原尺寸）——所有尺寸都是它的倍數，所以特寫與遠景一樣比例
     s       這一隻縮到幾成（模型的遠眼收合，critter.js）：近的那隻是 1，四分之三側的遠眼小一號。
             整個表情（眼、眉、淚、汗）一起縮，「單邊縮小」
     up      畫面上「頭頂」的方向（弳，canvas 座標：0 = 往右，−π/2 = 往上）
     inward  +1 / −1：眼睛自己的 +x 是往鼻樑那一側（+1）還是往外（−1）
     i       第幾隻（0、1）：左右不對稱的表情（愣住時挑一邊的眉）用

   在每一隻眼睛自己的座標裡畫：原點是眼睛中心，−y 是頭頂，+x 是往鼻樑那一側，單位是 r。

   ── 規則 ──────────────────────────────────────────────────────
     · 沒有「不完全包覆的邊線」：一個形狀的墨線要嘛整圈包住它，要嘛不畫。沿著眼睛下緣描半圈淚光
       那種線不行——要表示淚就在那個位置放淚珠（各自整圈包邊）。眉毛、橫線眼、眼瞼那一刀是
       「線」本身，不是誰的邊，不受這一條限制。
     · 水滴（淚、汗）一律是橢圓，沒有尖角。
     · 哭：一隻眼睛一顆大淚珠（左右各一顆），是橫的橢圓，不要一排小淚珠或飛出去的一串。
   ------------------------------------------------------------------ */

const INK = 'rgb(43, 35, 32)';
const TEAR = '#8fd8ff';
const SWEAT = '#bfe9ff';

/** 一條墨線：點是 [x, y]（單位 r），w 是線寬（單位 r）。 */
function stroke(g, pts, w, close = false) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close) g.closePath();
  g.lineWidth = w;
  g.lineCap = g.lineJoin = 'round';
  g.strokeStyle = INK;
  g.stroke();
}

/** 一條弧線（二次曲線）：從 a 經過控制點 c 到 b。 */
function arc(g, a, c, b, w) {
  g.beginPath();
  g.moveTo(...a);
  g.quadraticCurveTo(...c, ...b);
  g.lineWidth = w;
  g.lineCap = 'round';
  g.strokeStyle = INK;
  g.stroke();
}

function ellipse(g, x, y, rx, ry, fill, line = 0) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (line) { g.lineWidth = line; g.strokeStyle = INK; g.stroke(); }
}

/**
 * 一滴水（眼淚、汗）：橢圓，沒有尖角，整圈包邊，左上一點高光。中心 (x, y)、半徑 rx × ry、
 * 長軸轉 rot 弳（飛出去的淚沿著飛的方向拉長一點）。
 */
function drop(g, x, y, rx, ry, color, line, rot = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  ellipse(g, 0, 0, rx, ry, color, line);
  ellipse(g, -rx * 0.35, -ry * 0.3, rx * 0.28, ry * 0.26, 'rgba(255,255,255,0.85)');
  g.restore();
}

/**
 * 一顆大淚珠：橫的橢圓（寬比高大），掛在眼睛（半徑 ex × ey）的下眼眶、偏外眼角，蓋住眼睛下緣一截。一隻眼睛只有這一顆
 * ——不要一排小淚珠、也不要飛出去的一串。
 */
function bigTear(g, ex, ey) {
  drop(g, -ex * 0.4, ey * 0.95, ex * 1.08, ey * 0.63, TEAR, 0.1);
}

/** 實心的眼睛加一顆高光（模型原本那一種，畫成漫畫的）。 */
function solidEye(g, rx, ry, dy = 0) {
  ellipse(g, 0, dy, rx, ry, INK);
  ellipse(g, -rx * 0.3, dy - ry * 0.4, rx * 0.32, rx * 0.32, '#fff');
}

/** 每一種表情：在一隻眼睛的座標裡畫（單位 r）。 */
const FACES = {
  /** 堅定、昂首：眼睛微瞇，眉毛粗、往鼻樑那一側壓下來。 */
  proud(g) {
    solidEye(g, 0.5, 0.72, 0.05);
    // 上眼瞼壓一刀：眼睛上緣是平的
    stroke(g, [[-0.62, -0.42], [0.62, -0.58]], 0.22);
    stroke(g, [[-0.85, -1.15], [0.75, -0.82]], 0.34);
  },
  /** 沉穩（國王）：半睜，上眼瞼一道厚線，眉毛平、略高。 */
  calm(g) {
    g.save();
    g.beginPath();
    g.rect(-1, -0.05, 2, 2);
    g.clip();
    solidEye(g, 0.48, 0.66, 0.05);
    g.restore();
    arc(g, [-0.62, 0.0], [0, -0.22], [0.62, 0.0], 0.2);
    stroke(g, [[-0.8, -1.0], [0.7, -1.05]], 0.24);
  },
  /** 嚇到、嚇出眼淚：睜大的白眼、小瞳孔，眉毛往鼻樑那一側挑高，下眼眶一顆大淚珠。 */
  tears(g, a) {
    ellipse(g, 0, 0, 0.78, 1.0, '#fff', 0.14);
    ellipse(g, 0.05, 0.08, 0.2, 0.24, INK);
    arc(g, [-0.9, -1.35], [-0.1, -1.95], [0.75, -1.75], 0.24);
    bigTear(g, 0.78, 1.0);
    // 一顆汗（只畫在第一隻眼睛那一側）
    if (a.i === 0) drop(g, -1.35, -1.45, 0.22, 0.3, SWEAT, 0.07);
  },
  /** 驚醒：白眼睜到最大、瞳孔縮成一點，眉毛彈得老高；嚇出眼淚——下眼眶一顆大淚珠。 */
  shock(g, a) {
    ellipse(g, 0, 0, 0.82, 1.08, '#fff', 0.15);
    ellipse(g, 0, 0, 0.13, 0.13, INK);
    arc(g, [-0.9, -1.55], [0, -2.15], [0.8, -1.7], 0.26);
    bigTear(g, 0.82, 1.08);
    if (a.i === 0) {
      // 驚嚇線：頭頂外側三道短線
      for (const k of [-1, 0, 1]) stroke(g, [[-1.1 + k * 0.45, -2.3 - Math.abs(k) * 0.1], [-1.25 + k * 0.6, -2.95]], 0.12);
    }
  },
  /** 疲憊：橫線眼（外側往下垂），下面一道眼袋，眉毛低、往外垂。 */
  tired(g) {
    arc(g, [-0.72, 0.12], [0, -0.06], [0.68, 0.0], 0.22);
    arc(g, [-0.5, 0.45], [0, 0.6], [0.45, 0.42], 0.09);
    arc(g, [-0.85, -0.6], [-0.05, -0.92], [0.7, -0.85], 0.2);
  },
  /** 愣住：小豆眼，一邊的眉挑高、一邊平；外側一顆汗。 */
  dazed(g, a) {
    ellipse(g, 0, 0.05, 0.24, 0.3, INK);
    if (a.i === 0) arc(g, [-0.75, -1.05], [0, -1.6], [0.6, -1.25], 0.2);
    else stroke(g, [[-0.7, -0.95], [0.6, -0.95]], 0.2);
    if (a.i === 0) drop(g, -1.25, -0.85, 0.24, 0.32, SWEAT, 0.07);
  },
};

export const FACE_NAMES = Object.keys(FACES);

/**
 * 在 2D 畫布 `g` 上畫一隻的表情。`anchors` 是看得到的那幾隻眼睛（見檔頭），`ink` 是這一格
 * 的墨線粗細（像素）——線寬最細不比它細太多，遠景的小臉才不會畫成髮絲。
 * `lift`、`spread`（單位 r）：畫上去的眼睛往頭頂抬、往外側分開多少。模型的眼睛貼在吻部的
 * 上角，正面看吻部會壓在眼睛上；漫畫的眼睛比較大，抬到額頭、分開一點才不會畫在鼻子上。
 */
export function drawFace(g, face, anchors, ink, { lift = 0, spread = 0 } = {}) {
  const draw = FACES[face];
  if (!draw) throw new Error(`沒有這個表情：${face}`);
  for (const a of anchors) {
    g.save();
    g.translate(a.x, a.y);
    g.rotate(a.up + Math.PI / 2);          // 讓 −y 對到頭頂
    const r = Math.max(a.r, ink * 2.2) * (a.s ?? 1);
    g.scale(r * a.inward, r);
    g.translate(-spread, -lift);
    draw(g, a);
    g.restore();
  }
}
