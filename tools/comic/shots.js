/* ── tools/comic/shots.js ─────────────────────────────────────────────
   漫畫每一格的鏡頭（攝影棚 studio.js 照這張表擺、拍、出圖）：誰在場、站哪、
   面朝哪、什麼姿勢，鏡頭在哪、看哪，背後有哪些剪影。剪影以外是透明的——書頁上看到的是紙。

   每一格：
     id     圖檔名（public/test/comic/<id>.png），也是 comic.js 那一格的 src
     size   出圖的像素（寬、高）。比例照它在橫向版面裡那一格（四格頁：a 約 2.9、b 1.3、c 1.7、d 2.6 比 1）；
            直向或別的比例由書頁照 comic.js 的 focus 裁
     cast   在場的角色（同一種可以好幾隻）：
              who    'hero'（主角：立耳犬、黃、戴漁夫帽）、'king'（活著的國王：垂耳犬、灰、王冠、1.4 倍高）、
                     怪物 'zombie'、'boss'、'knight'、'ghost'、'ghostKing'（國王的亡魂）、'knightGhost'
                     （騎士幽靈），或 'folk'（王國的人民，look 給哪一隻：'cat/tabby'、'dog-drop/cow'……）
              name   鏡頭要對準同一種的第二隻以後的那一隻時，給牠一個名字（cam.focus 用）
              at     [x, z]（公尺），yaw 面朝哪（0 = +Z，π/2 = +X）
              speed  在跑（公尺／秒）：步態跑 frames 幀（預設 45）停在那一格；air 在空中（垂直速度）
              scale  整隻放大；alpha 半透明的那幾隻散到剩幾成；shields 國王的亡魂繞著幾面盾
              move   疊在上面的姿勢（critter.js 的 moveOverlay：pitch、headPitch、front、knee、legs…）
              tip    整隻往側邊倒幾弳（0 = 站著、π/2 = 躺平；death.js 那一種倒法，往牠自己的 +X 側倒）
              blade  嘴裡橫咬哪一把（blade.js：'knife' 主角的刀、'knight'、'king'），沒給是空手
              y      墊高幾公尺（坐在王座上）；shadow: false 不畫腳下的影子
              face   漫畫的表情（faces.js 的 FACES），沒給就是模型原本的眼睛
              eyes   { lift, spread }：畫上去的眼睛往額頭抬、往外分開多少（眼睛半高的幾倍；正面特寫用）
     bg     背景：遊戲地形零件的剪影，照構圖拼貼（不是擺在 3D 場景裡）。每一件
            { piece, x, y, size, view, tilt, flip, ...零件自己的參數 }：piece 見 studio.js 的 PIECES（column、
            banner、pavilion、weaponRack、standard、dummy、rampart、throneSeat……）；底邊正中間放在畫面的
            (x, y)（寬高的比例，y 往下），高 size（畫面高的比例）；view 轉幾弳再從正面平拍，tilt 往前傾、
            flip 左右翻。剪影只取形狀：一個顏色、沒有透視、不分遠近，排在哪裡是構圖的事
     horizon  地平線在畫面高的幾成（0 = 頂、1 = 底），從這裡往下畫滿地面的排線；沒給就沒有地面
     props  角色碰得到的道具（國王坐的王座）：{ piece, at: [x, z], y, yaw, scale, ...零件的參數 }，擺在 3D 場景裡
            跟角色一起拍，顏色跟背景的剪影一樣；{ blade, at, y, yaw, size } 是一把掉在地上的刀劍（原本的顏色）
     souls  靈魂（發光的狗頭）：[{ at: [x, y, z], yaw, scale, seed }]
     rays   光芒：{ at: [fx, fy], n, from, to, inner, width, color, alpha }（或好幾道的陣列），畫在角色底下
     speedLines  速度線：{ angle, rows, band, len, width, seed }，畫在角色底下
     puffs  霧與塵：[{ x, y, r, color, alpha, n, seed }]，大團、沒有墨線，畫在最上層
     focusLines  集中線（緊張的格子）：true，或 { n, clear, width, seed }——幾條、中間留多大的空白
            （畫面高的幾倍）、外端多寬、亂數種子。收向 cam.focus 那張臉，給了 at（畫面的比例）就收向那裡
     cam    鏡頭，兩種寫法：{ pos, look, fov }（世界座標），或 { focus: 'hero', yaw, pitch, dist, fov, frame }
            ——對準那一隻的臉，從臉往 yaw 方位、pitch 仰角（負的是從下往上拍）退 dist 公尺；frame [fx, fy]
            是臉落在畫面上哪裡（從正中間算，寬高的幾分之幾，+y 往下）。特寫用後面那一種。
            戴帽子的主角從上往下拍會被帽簷擋住眼睛：鏡頭放在眼睛的高度或更低，或讓牠抬頭。
     light  主光從哪個方向來（指向光的向量；沒給就是遊戲那一盞 KEY_POS）
     ink    墨線幾像素（出圖的高度是 size[1]）

   表情是畫在圖上面的，被別的東西擋住的眼睛也照畫——仰頭的時候從前上方看，吻部會擋在眼睛前面，
   選看得到眼睛的角度（側一點、低一點）。

   取景：多用特寫，至少裁掉一部分身體——整隻完整入鏡的遠景只留給「很小、很孤單」那種格子。

   主角固定畫成遊戲的預設那一隻（立耳犬、黃、戴帽子）：漫畫是事先畫好的，不會跟著玩家選的動物換。
   ------------------------------------------------------------------ */

/** 昂首：胸口挺出來、頭抬高、尾巴翹起來。 */
const HEROIC = { pitch: -0.2, headPitch: -0.32, tailPitch: 0.6, w: 1 };
/** 坐（國王坐在王座上）：後腿收在身體底下，上半身立起來，前腳撐直。 */
const SIT = {
  pitch: -0.5, headPitch: 0.3, drop: 0.12, tailPitch: -0.5,
  front: 0.25, hind: 1.3, knee: -1.1, legs: 1, w: 1,
};
/** 猛然彈起來：後半身還坐著，上半身往上撐、前腳往前伸，頭往後仰。 */
const STARTLE = {
  pitch: -0.45, headPitch: -0.1, drop: -0.04, tailPitch: 0.8,
  front: -1.0, hind: 0.9, knee: 0.6, legs: 1, w: 1,
};
/** 沒睡飽：頭往下垂、往一邊歪。 */
const DROWSY = { headPitch: 0.28, headTilt: 0.22, pitch: 0.06, tailPitch: -0.5, w: 1 };
/** 四處張望：頭轉向一邊、抬起來。 */
const LOOK_AROUND = { headYaw: 0.35, headPitch: -0.4, tailPitch: -0.3, w: 1 };
/** 倒下（被打倒的怪物）：整隻趴平、下巴貼地，前腳往前、後腳往後攤開，尾巴垂在地上。 */
const FLOP = { drop: 0.35, pitch: 0.1, headPitch: 0.45, front: -1.4, hind: 1.4, knee: 0, legs: 1, tailPitch: -0.6, w: 1 };
/** 立起來（BOSS 扇形地震的起手，monster.js 的 REAR）：整個前半身立起來、兩隻前腳收在胸前。 */
const REAR = {
  pitch: -0.80, headPitch: 0.95, drop: -0.12, tailPitch: 0.40,
  front: -1.10, knee: 0.70, hind: -0.20, legs: 1, w: 1,
};
/** 喘氣：身體往前沉、頭垂一點，尾巴放低。 */
const PANT = { pitch: 0.12, headPitch: 0.12, drop: 0.05, tailPitch: -0.35, w: 1 };

/* p1-1 王座廳：王座（遊戲王座廳那一張）是國王坐的，是 3D 的道具。 */
const THRONE_AT = [-2.2, -4.2];

export const SHOTS = [
  {
    // 王國最強的戰士：主角橫咬著刀在前（略從下往上拍、裁到胸口），國王坐在後面的王座上，
    // 王座廳的柱子與垂旗在更後面。刀要橫過畫面，所以臉幾乎正對鏡頭——側過去的話刀柄或刀身會
    // 橫在眼睛前面。頭不抬（抬頭從下面看，吻部會壓到眼睛），眼睛往額頭抬、分開。
    id: 'p1-1', size: [1800, 620], ink: 3.5,
    // 構圖：大柱子框住左右兩邊、裁出畫面，兩根小一號的柱子夾著王座，大柱與小柱之間垂著旗。
    props: [{ piece: 'throneSeat', at: THRONE_AT, yaw: Math.PI + 0.3 }],
    horizon: 0.82,
    bg: [
      { piece: 'column', r: 0.5, h: 6.4, x: 0.04, y: 0.9, size: 1.05 },
      { piece: 'column', r: 0.5, h: 6.4, x: 0.96, y: 0.9, size: 1.05 },
      { piece: 'column', r: 0.5, h: 6.4, x: 0.24, y: 0.85, size: 0.8 },
      { piece: 'column', r: 0.5, h: 6.4, x: 0.6, y: 0.85, size: 0.8 },
      { piece: 'banner', s: 0.9, x: 0.14, y: 0.5, size: 0.42 },
      { piece: 'banner', s: 0.9, x: 0.86, y: 0.5, size: 0.42 },
    ],
    cast: [
      { who: 'king', at: [THRONE_AT[0] + 0.05, THRONE_AT[1] + 0.1], y: 0.5, yaw: 0.3, move: SIT, face: 'calm', shadow: false, eyes: { lift: 0.25, spread: 0.2 } },
      { who: 'hero', at: [0, 0], yaw: -0.4, move: { ...HEROIC, headPitch: 0 }, face: 'proud', blade: 'knife', eyes: { lift: 1.1, spread: 0.45 } },
    ],
    cam: { focus: 'hero', yaw: -0.1, pitch: -0.1, dist: 1.7, fov: 34, frame: [0.17, 0.02] },
    light: [-4, 7, 5],
  },
  {
    // 驚醒：臉的大特寫，嚇出眼淚，集中線。頭往後仰，鏡頭從前上方對著臉。
    id: 'p1-2', size: [900, 700], ink: 4.5, focusLines: true,
    cast: [{ who: 'hero', at: [0, 0], yaw: 0.75, move: STARTLE, face: 'shock', eyes: { lift: 0.9, spread: 0.35 } }],
    cam: { focus: 'hero', yaw: 0.95, pitch: 0.08, dist: 1.0, fov: 32, frame: [0, 0.08] },
    light: [5, 7, 4],
  },
  {
    // ……睡過頭了：近景，橫線的疲憊眼睛。鏡頭在眼睛的高度，帽簷不擋。後面是兵器架（武器一把都沒少）、
    // 隔壁的營帳，太陽已經很高。
    id: 'p1-3', size: [1200, 720], ink: 4,
    // 構圖：臉佔左邊，右邊是插滿長槍的兵器架（一把都沒少），後面露出一角營帳。
    horizon: 0.8,
    bg: [
      { piece: 'pavilion', R: 1.9, h: 1.45, roof: 1.25, x: 0.98, y: 0.82, size: 0.46 },
      { piece: 'weaponRack', x: 0.77, y: 0.86, size: 0.5 },
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: -0.45, move: DROWSY, face: 'tired' }],
    cam: { focus: 'hero', yaw: -0.8, pitch: -0.08, dist: 1.0, fov: 32, frame: [-0.12, 0.08] },
    light: [-3, 6, 6],
  },
  {
    // 人呢？：中景、裁到腳，抬頭張望、冒汗。背景比其他格遠得多（其他格幾公尺，這一格幾十公尺）：
    // 一排排空帳篷、旗桿，更遠的城牆與城樓，小小一條貼在地平線上、淡得快融進紙裡。
    id: 'p1-4', size: [1600, 620], ink: 3.5,
    // 構圖：地平線拉得很高、背景縮成很小的一條貼在地平線上（城牆、一排帳篷、軍旗），底下一大片
    // 排線的空地——比其他格遠，靠的是構圖，不是透視。
    horizon: 0.34,
    bg: [
      { piece: 'rampart', from: [-60, 0], to: [60, 0], h: 3.6, thick: 2.2, ruin: 0, x: 0.5, y: 0.3, size: 0.07 },
      ...[0.05, 0.17, 0.29, 0.79, 0.91].map((x) => ({ piece: 'pavilion', R: 1.9, h: 1.45, roof: 1.25, x, y: 0.35, size: 0.09 })),
      ...[0.23, 0.85].map((x) => ({ piece: 'standard', x, y: 0.35, size: 0.16 })),
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: 0.3, move: LOOK_AROUND, face: 'dazed' }],
    cam: { focus: 'hero', yaw: 0.55, pitch: 0.12, dist: 1.9, fov: 30, frame: [0.08, -0.05] },
  },

  /* ── 第 2 頁　兵營・戰後 ─────────────────────────────────────── */
  {
    // 殭屍倒了一地，主角站在中間喘氣：略低的中景，裁到前腳，三隻殭屍躺在四周（前景那一隻只露一截）。
    id: 'p2-1', size: [860, 720], ink: 3.5,
    horizon: 0.5,
    bg: [
      { piece: 'pavilion', R: 1.9, h: 1.45, roof: 1.25, x: 0.1, y: 0.52, size: 0.26 },
      { piece: 'weaponRack', x: 0.88, y: 0.52, size: 0.26 },
      { piece: 'standard', x: 0.7, y: 0.52, size: 0.36 },
    ],
    // 殭屍趴平在地上、下巴貼地、叉叉眼，頭朝各個方向。鏡頭從高一點的地方往下看，看得到牠們躺著；
    // 主角仰著頭喘，帽簷才不會擋住眼睛。
    cast: [
      { who: 'zombie', at: [-1.9, -1.2], yaw: 0.9, move: { ...FLOP, headTilt: 0.4 }, face: 'ko', eyes: { lift: 0.3 } },
      { who: 'zombie', at: [1.3, -1.1], yaw: -0.3, move: { ...FLOP, headTilt: -0.3 }, face: 'ko', eyes: { lift: 0.3 } },
      { who: 'zombie', at: [-2.4, 0.7], yaw: 1.2, move: { ...FLOP, headTilt: 0.5 }, face: 'ko', eyes: { lift: 0.3 } },
      { who: 'hero', at: [0, 0], yaw: 0.35, move: { ...PANT, headPitch: -0.3 }, face: 'pant', blade: 'knife' },
    ],
    cam: { focus: 'hero', yaw: 0.45, pitch: 0.3, dist: 3.9, fov: 34, frame: [0.02, -0.04] },
    light: [3, 7, 5],
  },
  {
    // 這些傢伙從哪來的？：過肩往下看，主角的頭與肩在左下（背對我們、低著頭），腳邊趴著一隻殭屍。
    id: 'p2-2', size: [1200, 720], ink: 3.5,
    horizon: -0.1,
    cast: [
      { who: 'zombie', at: [0.35, 1.6], yaw: Math.PI + 0.75, move: { ...FLOP, headPitch: 0.2, headTilt: 0.35 }, face: 'ko', eyes: { lift: 0.3 } },
      { who: 'hero', at: [0, 0], yaw: 0.15, move: { headPitch: 0.6, pitch: 0.12, tailPitch: -0.3, w: 1 } },
    ],
    cam: { focus: 'zombie', yaw: Math.PI + 1.0, pitch: 0.5, dist: 3.4, fov: 40, frame: [0.15, 0] },
  },
  {
    // 去中庭問問其他人：背影，裁到腰，面朝南邊——兵營南端的城牆開了一個缺口，路從那裡出去。
    id: 'p2-3', size: [1200, 720], ink: 3.5,
    horizon: 0.72,
    bg: [
      { piece: 'rampart', from: [-30, 0], to: [0, 0], h: 4.2, thick: 2.2, ruin: 0.3, x: 0.2, y: 0.73, size: 0.16 },
      { piece: 'rampart', from: [0, 0], to: [30, 0], h: 4.2, thick: 2.2, ruin: 0.3, x: 0.98, y: 0.73, size: 0.16 },
      { piece: 'pavilion', R: 1.9, h: 1.45, roof: 1.25, x: 0.9, y: 0.75, size: 0.2 },
      { piece: 'standard', x: 0.5, y: 0.74, size: 0.24 },
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: Math.PI, move: { headYaw: -0.15, tailPitch: -0.1, w: 1 }, blade: 'knife' }],
    cam: { focus: 'hero', yaw: -0.3, pitch: 0.1, dist: 2.9, fov: 34, frame: [-0.22, 0.02] },
  },

  /* ── 第 3 頁　中庭・開場 ─────────────────────────────────────── */
  {
    // 有人嗎？：遠景，一整隻小小的、孤單地站在空中庭的一角（整隻入鏡只給這種格子）。兩側的拱廊框住畫面，
    // 一圈斷柱排在地平線上，最後面是門樓。主角剛從東拱洞（右邊）走出來，四處張望。
    id: 'p3-1', size: [860, 720], ink: 3,
    horizon: 0.56,
    bg: [
      { piece: 'gateway', span: 5, rise: 3.6, h: 6.4, side: 5, x: 0.5, y: 0.57, size: 0.17 },
      ...[[0.08, 0.5], [0.25, 0], [0.36, 0.7], [0.66, 0.6], [0.77, 0], [0.93, 0.4]].map(([x, broken], i) => (
        { piece: 'column', r: 0.46, h: 5.2, broken, seed: 3 + i, x, y: 0.575, size: 0.15 * (1 - broken * 0.8) })),
      { piece: 'arcade', bays: 1, span: 3.1, pier: 0.95, legH: 2.6, depth: 1.0, ruin: 0.5, seed: 7, x: 0.0, y: 0.62, size: 0.3 },
      { piece: 'arcade', bays: 1, span: 3.1, pier: 0.95, legH: 2.6, depth: 1.0, ruin: 0.22, seed: 9, x: 1.0, y: 0.62, size: 0.3 },
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: -0.5, move: LOOK_AROUND, face: 'dazed' }],
    cam: { focus: 'hero', yaw: -0.15, pitch: 0.12, dist: 17, fov: 30, frame: [0.2, 0.2] },
  },
  {
    // 地面震一下：貼著地面拍，碎石在鏡頭前跳起來、塵土噴開；主角後面被震得一愣（驚嚇的白眼、驚嚇線）。
    id: 'p3-2', size: [1200, 720], ink: 3.5,
    horizon: 0.74,
    bg: [
      { piece: 'rubble', r: 0.5, n: 6, seed: 3, x: 0.13, y: 0.5, size: 0.12 },
      { piece: 'rubble', r: 0.4, n: 5, seed: 8, x: 0.86, y: 0.36, size: 0.1 },
      { piece: 'rubble', r: 0.4, n: 4, seed: 12, x: 0.7, y: 0.14, size: 0.08 },
      { piece: 'rubble', r: 0.6, n: 7, seed: 21, x: 0.3, y: 0.22, size: 0.07 },
    ],
    puffs: [
      { x: 0.14, y: 0.86, r: 0.12, color: '#cdbb9c', alpha: 0.8, seed: 4 },
      { x: 0.9, y: 0.84, r: 0.14, color: '#cdbb9c', alpha: 0.8, seed: 6 },
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: 0.35, move: { drop: -0.05, tailPitch: 0.8, w: 1 }, face: 'shock', eyes: { lift: 0.9, spread: 0.35 } }],
    cam: { focus: 'hero', yaw: 0.5, pitch: -0.1, dist: 2.3, fov: 38, frame: [0.02, -0.14] },
    light: [4, 7, 5],
  },
  {
    // ……問錯人了。：仰角。BOSS 在門樓前立起來（兩倍大、頭盔、紅眼瞪著），壓在畫面上方；主角是前景右下角
    // 的背影，抬頭看著牠。集中線收向 BOSS 的臉。
    id: 'p3-3', size: [1200, 720], ink: 3.5,
    horizon: 0.86,
    bg: [{ piece: 'gateway', span: 5, rise: 3.6, h: 6.4, side: 6, x: 0.44, y: 1.05, size: 1.45 }],
    focusLines: { clear: 0.26, n: 90 },
    cast: [
      { who: 'boss', at: [0, 0], yaw: 0.1, move: { ...REAR, headPitch: 0.6 }, face: 'glare', eyes: { lift: 0.4 } },
      { who: 'hero', at: [1.45, 0.75], yaw: Math.PI + 0.9, move: { tailPitch: -0.5, headPitch: -0.3, w: 1 } },
    ],
    cam: { focus: 'boss', yaw: 0.36, pitch: -0.42, dist: 3.6, fov: 54, frame: [-0.06, -0.2] },
    light: [2, 6, 6],
  },

  /* ── 第 4 頁　中庭・戰後 ─────────────────────────────────────── */
  {
    // BOSS 倒下，靈魂從身上浮出來：中景，BOSS 側著趴平（頭盔蓋住了臉），一顆發光的狗頭從牠背上升起來。
    id: 'p4-1', size: [860, 720], ink: 3.5,
    horizon: 0.62,
    bg: [
      { piece: 'gateway', span: 5, rise: 3.6, h: 6.4, side: 5, x: 0.5, y: 0.63, size: 0.36 },
      { piece: 'column', r: 0.46, h: 5.2, broken: 0.6, seed: 4, x: 0.08, y: 0.64, size: 0.2 },
      { piece: 'column', r: 0.46, h: 5.2, seed: 5, x: 0.93, y: 0.64, size: 0.44 },
    ],
    cast: [{ who: 'boss', at: [0, 0], yaw: 2.0, move: { ...FLOP, headTilt: 0.35 } }],
    souls: [{ at: [-0.3, 2.6, -0.2], yaw: 0.6, scale: 1.3 }],
    cam: { pos: [3.2, 1.1, 5.6], look: [0.0, 1.35, 0], fov: 42 },
  },
  {
    // 好渴……：近景。主角坐在一根斷得很低的柱子上，累得眼睛擠成一條、喘氣。三分之四側拍，正面的話
    // 表情會畫到吻部上。
    id: 'p4-2', size: [1200, 720], ink: 4,
    horizon: 0.82,
    bg: [
      { piece: 'arcade', bays: 1, span: 3.1, pier: 0.95, legH: 2.6, depth: 1.0, ruin: 0.3, seed: 9, x: 0.88, y: 0.84, size: 0.7 },
      { piece: 'column', r: 0.46, h: 5.2, broken: 0.45, seed: 2, x: 0.06, y: 0.84, size: 0.6 },
    ],
    props: [{ piece: 'column', r: 0.46, h: 5.2, broken: 0.86, seed: 1, at: [0, 0] }],
    cast: [{ who: 'hero', at: [0, 0.05], y: 1.1, yaw: 0.2, move: { ...SIT, headPitch: 0.05, tailPitch: -0.7 }, face: 'pant', shadow: false, eyes: { lift: 0.3 } }],
    cam: { focus: 'hero', yaw: 1.3, pitch: -0.05, dist: 2.4, fov: 34, frame: [-0.12, -0.05] },
    light: [4, 7, 5],
  },
  {
    // 窄巷有口井：過肩。主角的後腦勺與肩在右下，往西拱洞看出去——拱洞框住遠遠的窄巷，兩排房子的盡頭
    // 是小廣場上的那口井。
    id: 'p4-3', size: [1200, 720], ink: 3.5,
    horizon: 0.6,
    bg: [
      { piece: 'house', W: 4.6, D: 4, e: 5.4, seed: 3, x: 0.35, y: 0.6, size: 0.3 },
      { piece: 'house', W: 4.6, D: 4, e: 4.8, seed: 5, x: 0.62, y: 0.6, size: 0.27 },
      { piece: 'well', r: 1.1, seed: 2, x: 0.485, y: 0.62, size: 0.1 },
      { piece: 'gateway', span: 3.1, rise: 2.6, h: 5.6, side: 6, x: 0.48, y: 1.25, size: 1.6 },
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: Math.PI + 0.35, move: { headPitch: -0.05, headYaw: 0.15, w: 1 }, face: 'hope', eyes: { lift: 0.2 } }],
    cam: { focus: 'hero', yaw: 0.25, pitch: 0.05, dist: 1.6, fov: 40, frame: [0.3, 0.32] },
  },

  /* ── 第 5 頁　窄巷・開場 ─────────────────────────────────────── */
  {
    // 找到了。：主角的視角往巷底看。兩側的連棟屋從畫面的左右兩邊夾進來（大、裁出畫面），越往中間越小，
    // 貼在拉高的地平線上；巷底小廣場的正中間是那口井。主角的帽頂在畫面最下面。
    id: 'p5-1', size: [1800, 620], ink: 3.5,
    horizon: 0.62,
    bg: [
      { piece: 'house', W: 4.6, D: 4, e: 5.0, seed: 7, x: 0.36, y: 0.63, size: 0.36 },
      { piece: 'house', W: 4.6, D: 4, e: 4.6, seed: 8, x: 0.64, y: 0.63, size: 0.34 },
      { piece: 'well', r: 1.1, seed: 2, x: 0.5, y: 0.64, size: 0.13 },
      { piece: 'house', W: 4.6, D: 4, e: 5.6, seed: 3, x: 0.2, y: 0.7, size: 0.62 },
      { piece: 'house', W: 4.6, D: 4, e: 5.2, seed: 4, x: 0.8, y: 0.7, size: 0.6 },
      { piece: 'house', W: 4.6, D: 4, e: 6.0, seed: 5, x: 0.01, y: 0.8, size: 1.05 },
      { piece: 'house', W: 4.6, D: 4, e: 5.6, seed: 6, x: 0.99, y: 0.8, size: 1.0 },
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: Math.PI, move: { headPitch: -0.1, w: 1 } }],
    cam: { focus: 'hero', yaw: 0, pitch: 0.12, dist: 1.6, fov: 34, frame: [0, 0.62] },
  },
  {
    // 井口特寫：井（絞盤、垂下去的繩與吊桶）佔滿畫面，主角從左邊探出頭來，盯著井眼睛發亮。
    id: 'p5-2', size: [900, 720], ink: 4,
    horizon: 0.86,
    bg: [{ piece: 'well', r: 1.1, seed: 2, x: 0.58, y: 0.94, size: 0.84 }],
    cast: [{ who: 'hero', at: [0, 0], yaw: 1.1, move: { headPitch: 0.05, w: 1 }, face: 'hope', eyes: { lift: 0.3 } }],
    cam: { focus: 'hero', yaw: 0.3, pitch: 0.0, dist: 1.35, fov: 36, frame: [-0.3, -0.02] },
    light: [-2, 7, 6],
  },
  {
    // 井後面的騎士：中景。井在前面（道具），殭屍騎士在井的後面背對著我們遊蕩，劍從頭的兩側伸出去。
    id: 'p5-3', size: [1150, 720], ink: 3.5,
    horizon: 0.5,
    bg: [
      { piece: 'house', W: 4.6, D: 4, e: 5.4, seed: 3, x: 0.12, y: 0.5, size: 0.6 },
      { piece: 'house', W: 4.6, D: 4, e: 5.0, seed: 4, x: 0.9, y: 0.5, size: 0.56 },
      { piece: 'barrel', x: 0.75, y: 0.52, size: 0.09 },
      { piece: 'crate', s: 0.9, x: 0.8, y: 0.52, size: 0.09 },
    ],
    props: [{ piece: 'well', r: 1.1, seed: 2, at: [0, 0] }],
    cast: [{ who: 'knight', at: [2.3, -2.0], yaw: Math.PI - 0.9, blade: 'knight', move: { headPitch: 0.1, tailPitch: -0.2, w: 1 }, speed: 1.2, frames: 50 }],
    cam: { pos: [-0.6, 1.9, 6.0], look: [1.0, 0.75, -1.2], fov: 32 },
  },
  {
    // 騎士轉頭，看見主角：騎士的頭的大特寫，從肩膀上轉過來，紅眼瞪著鏡頭；集中線。
    id: 'p5-4', size: [1800, 720], ink: 4.5,
    focusLines: { clear: 0.4 },
    cast: [{ who: 'knight', at: [0, 0], yaw: Math.PI - 0.4, blade: 'knight', move: { headYaw: -1.0, headPitch: 0.15, twist: -0.3, w: 1 }, face: 'visor', eyes: { lift: 0.35, spread: 0.1 } }],
    cam: { focus: 'knight', yaw: 0.45, pitch: 0.02, dist: 1.5, fov: 34, frame: [0.12, 0.05] },
    light: [3, 6, 6],
  },
];
