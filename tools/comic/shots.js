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
     souls  靈魂（發光的狗頭）：[{ at: [x, y, z], yaw, scale, seed, trail }]——trail 是周圍的小球冒幾幀（預設 90），
            同一格好幾顆的時候給少一點
     rays   光芒：{ at: [fx, fy], n, from, to, inner, width, color, alpha, front }（或好幾道的陣列），畫在角色底下、
            剪影後面；front 的畫在剪影前面
     speedLines  速度線：{ angle, rows, band, len, width, seed }，畫在角色底下
     puffs  霧與塵：[{ x, y, r, color, alpha, n, seed }]，大團、沒有墨線，畫在最上層
     focusLines  集中線（緊張的格子）：true，或 { n, clear, width, seed }——幾條、中間留多大的空白
            （畫面高的幾倍）、外端多寬、亂數種子。收向 cam.focus 那張臉，給了 at（畫面的比例）就收向那裡
     cam    鏡頭，兩種寫法：{ pos, look, fov }（世界座標），或 { focus: 'hero', yaw, pitch, dist, fov, frame }
            ——對準那一隻的臉，從臉往 yaw 方位、pitch 仰角（負的是從下往上拍）退 dist 公尺；frame [fx, fy]
            是臉落在畫面上哪裡（從正中間算，寬高的幾分之幾，+y 往下），roll 是鏡頭繞視線歪幾弳。特寫用後面那一種。
     collage  拼貼：[{ cast, cam, light, front }]，另外幾組角色各用自己的鏡頭與光拍、疊進同一格（front 的
            疊在主畫面上面）——現實裡不可能同時成立的視角拼在一起
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
/** 跪下：前半身伏低、頭垂下去（騎士幽靈在主角面前行禮）。 */
const KNEEL = { pitch: 0.35, headPitch: 0.55, drop: 0.3, front: 1.2, knee: -1.6, hind: 0, legs: 1, tailPitch: -0.5, w: 1 };
/** 捧著：上半身立起來，兩隻前腳收在胸前（捧出自己的靈魂）。 */
const OFFER = { pitch: -0.8, headPitch: 0.6, drop: -0.1, front: -1.2, knee: 1.2, hind: -0.2, legs: 1, tailPitch: 0.3, w: 1 };
/** 立誓：前腳收在身下跪著、頭垂下去，後半身還撐著（主角在國王面前跪下）。 */
const VOW = { pitch: 0.2, headPitch: 0.5, drop: 0.18, front: 1.1, knee: -1.5, hind: 0, legs: 1, tailPitch: -0.4, w: 1 };
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
      { who: 'boss', at: [0, 0], yaw: 0.1, move: { ...REAR, headPitch: 1.05 }, face: 'glare', eyes: { lift: 1.8, spread: 0.15 } },
      { who: 'hero', at: [1.45, 0.75], yaw: Math.PI + 0.9, move: { tailPitch: -0.5, headPitch: -0.3, w: 1 } },
    ],
    cam: { focus: 'boss', yaw: 0.36, pitch: -0.55, dist: 3.4, fov: 54, frame: [-0.06, -0.24] },
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

  /* ── 第 6 頁　窄巷・戰後 ─────────────────────────────────────── */
  {
    // 騎士倒下，劍掉在井邊：中景。騎士側著趴平在井旁（頭盔還戴著），那把雙刃劍掉在井腳下。
    id: 'p6-1', size: [860, 720], ink: 3.5,
    horizon: 0.5,
    bg: [
      { piece: 'house', W: 4.6, D: 4, e: 5.4, seed: 3, x: 0.1, y: 0.52, size: 0.5 },
      { piece: 'house', W: 4.6, D: 4, e: 5.0, seed: 4, x: 0.92, y: 0.52, size: 0.46 },
    ],
    props: [
      { piece: 'well', r: 1.1, seed: 2, at: [-1.6, -0.6] },
      { blade: 'knight', at: [-0.2, 0.9], yaw: -0.5, size: 1.2 },
    ],
    cast: [{ who: 'knight', at: [0.9, -0.3], yaw: 2.2, move: { ...FLOP, headTilt: 0.35 } }],
    cam: { pos: [1.6, 2.4, 5.4], look: [-0.2, 0.4, -0.2], fov: 40 },
  },
  {
    // 主角再次看向井口：過肩，井在畫面正中，主角的頭與肩在右下角。
    id: 'p6-2', size: [1200, 720], ink: 3.5,
    horizon: 0.66,
    bg: [
      { piece: 'house', W: 4.6, D: 4, e: 5.4, seed: 3, x: 0.08, y: 0.67, size: 0.75 },
      { piece: 'house', W: 4.6, D: 4, e: 5.0, seed: 5, x: 0.9, y: 0.67, size: 0.7 },
      { piece: 'well', r: 1.1, seed: 2, x: 0.47, y: 0.7, size: 0.42 },
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: Math.PI + 0.35, move: { headPitch: 0.1, w: 1 }, face: 'hope', eyes: { lift: 0.2 } }],
    cam: { focus: 'hero', yaw: 0.25, pitch: 0.05, dist: 1.6, fov: 40, frame: [0.3, 0.32] },
  },
  {
    // 水……：從井底往上拍。四周密密的集中線是井壁，中間留出一圈天空；主角站在井緣上，頭從圈的下緣探進來
    // 往下看。
    id: 'p6-3', size: [1200, 720], ink: 4,
    focusLines: { clear: 0.5, n: 220, width: 0.02, at: [0.5, 0.42] },
    cast: [{ who: 'hero', at: [0, -1.05], yaw: 0, move: { pitch: 0.35, headPitch: 0.7, w: 1 }, face: 'hope', eyes: { lift: 0.9, spread: 0.4 }, shadow: false }],
    cam: { pos: [0, -1.7, 0.05], look: [0, 0.9, -0.05], fov: 46 },
    light: [0, -2, 5],
  },

  /* ── 第 7 頁　水窖・開場 ─────────────────────────────────────── */
  {
    // 趴在井緣上往下看：側面中景。主角整隻趴上井圈，前半身探出井口、脖子伸得長長的往下。
    id: 'p7-1', size: [1800, 620], ink: 3.5,
    horizon: 0.78,
    bg: [
      { piece: 'house', W: 4.6, D: 4, e: 5.4, seed: 3, x: 0.08, y: 0.8, size: 1.0 },
      { piece: 'house', W: 4.6, D: 4, e: 5.0, seed: 4, x: 0.93, y: 0.8, size: 0.95 },
    ],
    props: [{ piece: 'well', r: 1.1, seed: 2, at: [0, 0] }],
    cast: [{ who: 'hero', at: [0, -1.05], y: 0.7, yaw: 0, move: { pitch: 0.55, headPitch: 0.55, drop: 0.12, front: -0.9, hind: 0.6, legs: 0.8, tailPitch: 0.7, w: 1 }, face: 'hope', shadow: false }],
    cam: { pos: [4.2, 1.15, -0.6], look: [0, 0.75, -0.6], fov: 30 },
    light: [5, 7, 2],
  },
  {
    // 腳下的石頭鬆脫：主角探出井口的前半身，前腳踩空往下滑，嚇一跳；碎石與速度線往下掉（井緣不入鏡，
    // 擋在臉前面的話表情會畫在石頭上）。
    id: 'p7-2', size: [900, 720], ink: 4,
    bg: [
      { piece: 'rubble', r: 0.4, n: 5, seed: 8, x: 0.24, y: 0.88, size: 0.11 },
      { piece: 'rubble', r: 0.4, n: 4, seed: 12, x: 0.5, y: 1.0, size: 0.09 },
      { piece: 'rubble', r: 0.5, n: 6, seed: 3, x: 0.74, y: 0.8, size: 0.08 },
    ],
    speedLines: { angle: Math.PI / 2, rows: 12, band: [0.2, 0.8], len: [0.35, 0.55], seed: 5 },
    cast: [{ who: 'hero', at: [0, 0], y: 0.7, yaw: 0, move: { pitch: 0.55, headPitch: -0.45, drop: 0.05, front: -1.2, hind: 0.6, legs: 0.9, tailPitch: 0.9, w: 1 }, face: 'shock', eyes: { lift: 0.6, spread: 0.3 }, shadow: false }],
    cam: { focus: 'hero', yaw: 0.8, pitch: -0.3, dist: 1.8, fov: 40, frame: [0.06, -0.2] },
    light: [4, 7, 5],
  },
  {
    // 啊——：從井底往上拍。主角四腳朝天往下掉，哭出來；四周的集中線是井壁，中間一圈天空（跟上一頁同一個井）。
    id: 'p7-3', size: [1150, 720], ink: 4,
    focusLines: { clear: 0.46, n: 220, width: 0.02, at: [0.5, 0.45] },
    cast: [{ who: 'hero', at: [0, 0], y: 1.2, yaw: 0, tip: 1.9, air: -6, move: { headPitch: -0.1, tailPitch: 0.8, w: 1 }, face: 'tears', eyes: { lift: 0.6, spread: 0.3 }, shadow: false }],
    cam: { focus: 'hero', yaw: 0.1, pitch: -0.4, dist: 2.2, fov: 44, frame: [0, -0.02] },
    light: [0, -3, 4],
  },
  {
    // 摔在水窖地上，幽靈浮出來：大遠景。一圈拱廊與斷柱、垂下來的鎖鏈；主角小小一隻趴在正中間發愣，
    // 拱廊後面幾隻幽靈浮出來，紅眼睛。
    id: 'p7-4', size: [1800, 720], ink: 3,
    horizon: 0.62,
    bg: [
      ...[0.06, 0.3, 0.7, 0.94].map((x, i) => ({ piece: 'arcade', bays: 1, span: 3.0, pier: 0.9, legH: 2.8, depth: 1.0, ruin: 0.3 + i * 0.1, seed: 11 + i, x, y: 0.63, size: 0.42 })),
      ...[0.18, 0.42, 0.58, 0.82].map((x, i) => ({ piece: 'column', r: 0.42, h: 4.4, broken: [0, 0.5, 0, 0.35][i], seed: 21 + i, x, y: 0.64, size: [0.36, 0.18, 0.36, 0.24][i] })),
      { piece: 'chain', from: [0, 3.2, 0], to: [1.4, 0, 0], n: 12, sag: 0.9, x: 0.26, y: 0.36, size: 0.36 },
      { piece: 'chain', from: [0, 3.2, 0], to: [-1.4, 0, 0], n: 12, sag: 0.9, x: 0.76, y: 0.34, size: 0.34 },
    ],
    cast: [
      { who: 'hero', at: [0, 0], yaw: 0.2, move: { ...FLOP, headPitch: -0.1, headTilt: 0.2 }, face: 'dazed' },
      { who: 'ghost', at: [-6.5, -9], yaw: 0.6, y: 0.5, air: 0, face: 'glare', shadow: false },
      { who: 'ghost', at: [-2.8, -10], yaw: 0.3, y: 0.9, air: 0, face: 'glare', shadow: false },
      { who: 'ghost', at: [3.0, -9.5], yaw: -0.3, y: 0.6, air: 0, face: 'glare', shadow: false },
      { who: 'ghost', at: [6.8, -8.5], yaw: -0.6, y: 1.0, air: 0, face: 'glare', shadow: false },
    ],
    cam: { pos: [0, 2.2, 8.5], look: [0, 1.0, -2], fov: 42 },
  },

  /* ── 第 8 頁　水窖・戰後 ─────────────────────────────────────── */
  {
    // 最後一隻幽靈散成霧：中景。主角咬著刀剛砍完（左），最後一隻幽靈（右）淡得快看不見，叉叉眼，
    // 身上一團一團的霧散開。
    id: 'p8-1', size: [1800, 620], ink: 3.5,
    horizon: 0.8,
    bg: [
      { piece: 'arcade', bays: 1, span: 3.0, pier: 0.9, legH: 2.8, depth: 1.0, ruin: 0.3, seed: 12, x: 0.5, y: 0.81, size: 0.62 },
      { piece: 'column', r: 0.42, h: 4.4, seed: 22, x: 0.05, y: 0.81, size: 0.9 },
      { piece: 'column', r: 0.42, h: 4.4, broken: 0.5, seed: 23, x: 0.93, y: 0.81, size: 0.5 },
    ],
    cast: [
      { who: 'hero', at: [-0.9, 0], yaw: 1.1, move: { headYaw: -0.5, twist: -0.25, pitch: 0.08, tailPitch: 0.4, w: 1 }, face: 'proud', blade: 'knife' },
      { who: 'ghost', at: [1.0, -0.2], y: 0.35, yaw: -1.3, air: 0, alpha: 0.22, tip: 0.35, face: 'ko', shadow: false },
    ],
    puffs: [
      { x: 0.66, y: 0.42, r: 0.11, alpha: 0.7, seed: 3 },
      { x: 0.78, y: 0.3, r: 0.08, alpha: 0.6, seed: 5 },
      { x: 0.72, y: 0.62, r: 0.07, alpha: 0.6, seed: 9 },
    ],
    cam: { pos: [0.1, 1.0, 5.2], look: [0.1, 0.7, 0], fov: 32 },
  },
  {
    // 霧往南邊的鐵閘飄：遠景。拱門裡放下來的鐵閘，閘後透出冷光（光芒），幾團霧往閘飄過去。
    id: 'p8-2', size: [900, 720], ink: 3.5,
    horizon: 0.78,
    rays: { at: [0.5, 0.62], n: 18, from: Math.PI, to: Math.PI * 2, inner: 0.05, width: 0.45, color: '#d7ecf8', alpha: 0.95 },
    bg: [{ piece: 'gateway', span: 3.0, rise: 2.4, h: 5.6, side: 4, lift: 0, x: 0.5, y: 0.8, size: 0.8 }],
    puffs: [
      { x: 0.26, y: 0.66, r: 0.07, alpha: 0.7, seed: 3 },
      { x: 0.4, y: 0.6, r: 0.055, alpha: 0.6, seed: 5 },
      { x: 0.14, y: 0.74, r: 0.09, alpha: 0.7, seed: 7 },
    ],
    cast: [{ who: 'ghost', at: [0, -6], y: 0.2, yaw: Math.PI, air: 0, alpha: 0.15, shadow: false }],
    cam: { pos: [-1.5, 1.6, 4], look: [0.2, 1.2, -6], fov: 40 },
  },
  {
    // 牠們是從那裡來的。：主角的臉的近景，瞇眼盯著畫面外的鐵閘，閘後的冷光從那一側照過來。
    id: 'p8-3', size: [1150, 720], ink: 4.5,
    rays: { at: [1.1, 0.4], n: 14, from: Math.PI * 0.75, to: Math.PI * 1.25, inner: 0.3, width: 0.5, color: '#d7ecf8', alpha: 0.9 },
    cast: [{ who: 'hero', at: [0, 0], yaw: 0.9, move: { headPitch: -0.05, tailPitch: 0.3, w: 1 }, face: 'proud', eyes: { lift: 0.3 } }],
    cam: { focus: 'hero', yaw: 0.35, pitch: 0.0, dist: 1.2, fov: 32, frame: [-0.16, 0.2] },
    light: [6, 3, 2],
  },
  {
    // 去查清楚。：背影。主角往鐵閘走去，鐵閘在畫面正前方，閘後透出冷光。
    id: 'p8-4', size: [1800, 720], ink: 3.5,
    horizon: 0.74,
    rays: { at: [0.58, 0.55], n: 22, from: Math.PI * 0.95, to: Math.PI * 2.05, inner: 0.06, width: 0.45, color: '#d7ecf8', alpha: 0.95 },
    bg: [
      { piece: 'gateway', span: 3.0, rise: 2.4, h: 5.6, side: 5, lift: 0, x: 0.58, y: 0.76, size: 0.7 },
      { piece: 'column', r: 0.42, h: 4.4, seed: 22, x: 0.08, y: 0.76, size: 0.66 },
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: Math.PI + 0.1, speed: 1.6, frames: 52, blade: 'knife' }],
    cam: { focus: 'hero', yaw: 0.35, pitch: 0.12, dist: 2.6, fov: 36, frame: [-0.2, 0.08] },
  },

  /* ── 第 9 頁　墓室・開場 ─────────────────────────────────────── */
  {
    // 鐵閘升起，主角走進來：從墓室裡往外拍。門洞的鐵閘升到頂，主角從門洞走進來（迎著鏡頭），
    // 背後是水窖那一頭的冷光。
    id: 'p9-1', size: [860, 720], ink: 3.5,
    horizon: 0.84,
    rays: { at: [0.5, 0.62], n: 18, from: Math.PI, to: Math.PI * 2, inner: 0.05, width: 0.45, color: '#d7ecf8', alpha: 0.95 },
    bg: [{ piece: 'gateway', span: 3.0, rise: 2.4, h: 5.6, side: 4, lift: 2.4, x: 0.5, y: 0.86, size: 1.0 }],
    cast: [{ who: 'hero', at: [0, 0], yaw: 0.1, speed: 1.4, frames: 40, move: { headYaw: 0.15, headPitch: -0.1, tailPitch: -0.3, w: 1 }, face: 'dazed', blade: 'knife', eyes: { lift: 0.9, spread: 0.35 } }],
    cam: { focus: 'hero', yaw: 0.05, pitch: -0.05, dist: 4.2, fov: 32, frame: [0, 0.12] },
    light: [2, 6, 6],
  },
  {
    // ……墓室？：大遠景。頭頂一道一道拱肋框住畫面，兩排石棺一路排到地平線，棺蓋上點著蠟燭；主角在
    // 正中間，小小的背影。
    id: 'p9-2', size: [1200, 720], ink: 3,
    horizon: 0.6,
    // 兩排石棺從左右兩邊往中間的地平線排過去（構圖給的大小：近的大、裁出畫面），每一具棺蓋上一根蠟燭。
    bg: [
      { piece: 'pointedArch', span: 14, rise: 9, thick: 0.5, depth: 0.55, ruin: 0, seed: 10, x: 0.5, y: 0.63, size: 0.5 },
      { piece: 'pointedArch', span: 14, rise: 9, thick: 0.5, depth: 0.55, ruin: 0, seed: 11, x: 0.5, y: 1.0, size: 1.15 },
      ...[[0.38, 0.62, 0.05], [0.31, 0.64, 0.065], [0.21, 0.67, 0.09], [0.06, 0.72, 0.13]].flatMap(([x, y, size], i) => [
        { piece: 'sarcophagus', candle: [-0.42, i % 2 ? 0.85 : -0.85], view: Math.PI / 2, x, y, size },
        { piece: 'sarcophagus', candle: [0.42, i % 2 ? -0.85 : 0.85], view: Math.PI / 2, x: 1 - x, y, size },
      ]),
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: Math.PI, move: { headPitch: -0.3, headYaw: 0.2, w: 1 } }],
    cam: { focus: 'hero', yaw: 0.1, pitch: 0.12, dist: 9, fov: 32, frame: [0, 0.3] },
  },
  {
    // 石棺縫裡冒出幽靈：近景。棺蓋滑開一截，一隻幽靈從縫裡升起來（下半身還在棺裡），紅眼瞪著鏡頭；集中線。
    id: 'p9-3', size: [1200, 720], ink: 4,
    focusLines: { clear: 0.42 },
    props: [{ piece: 'sarcophagus', slide: 0.45, yaw: 0.1, candle: [-0.42, -0.85], at: [0, 0] }],
    cast: [{ who: 'ghost', at: [0, -0.92], y: 0.62, yaw: 0.35, air: 0, move: { headPitch: 0.15, pitch: -0.25, w: 1 }, face: 'glare', eyes: { lift: 0.3 }, shadow: false }],
    cam: { focus: 'ghost', yaw: 0.6, pitch: 0.12, dist: 3.0, fov: 36, frame: [0.08, -0.12] },
    light: [3, 6, 5],
  },

  /* ── 第 10 頁　墓室・戰後 ────────────────────────────────────── */
  {
    // 幽靈散去，墓室只剩燭火：中景。主角站在兩排石棺之間的走道上，愣愣地四處看；最後幾團霧散掉。
    id: 'p10-1', size: [1500, 720], ink: 3.5,
    horizon: 0.66,
    bg: [
      { piece: 'pointedArch', span: 14, rise: 9, thick: 0.5, depth: 0.55, ruin: 0, seed: 11, x: 0.5, y: 1.0, size: 1.3 },
      ...[[0.06, 0.2], [0.24, 0.14], [0.76, 0.14], [0.94, 0.2]].map(([x, size], i) => (
        { piece: 'sarcophagus', candle: [0.42 * (x < 0.5 ? 1 : -1), i % 2 ? 0.85 : -0.85], view: Math.PI / 2, x, y: 0.68 + size * 0.15, size })),
    ],
    puffs: [
      { x: 0.2, y: 0.3, r: 0.06, alpha: 0.5, seed: 3 },
      { x: 0.83, y: 0.22, r: 0.05, alpha: 0.45, seed: 5 },
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: 0.3, move: LOOK_AROUND, face: 'dazed', eyes: { lift: 0.4, spread: 0.15 } }],
    cam: { focus: 'hero', yaw: 0.8, pitch: 0.06, dist: 3.4, fov: 34, frame: [0, 0.05] },
    light: [4, 7, 6],
  },
  {
    // 全都……在這裡。：主角的臉在左邊（難過、一顆大淚珠），右邊一排一排的石棺一路排到很遠——
    // 地平線拉高，石棺縮成一列一列，數不完。
    id: 'p10-2', size: [1500, 720], ink: 4,
    horizon: 0.42,
    bg: [
      ...[0, 1, 2, 3].flatMap((row) => Array.from({ length: 8 - row }, (_, i) => ({
        piece: 'sarcophagus', view: Math.PI / 2, candle: [0.42, i % 2 ? 0.85 : -0.85],
        x: 0.42 + (i + 0.5 + (row % 2) * 0.35) / (8 - row) * 0.6, y: 0.43 + row * 0.15, size: 0.045 + row * 0.02,
      }))),
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: 1.35, move: { headPitch: 0.1, tailPitch: -0.6, w: 1 }, face: 'sad', eyes: { lift: 0.2 } }],
    cam: { focus: 'hero', yaw: 0.85, pitch: 0.0, dist: 1.25, fov: 34, frame: [-0.28, 0.1] },
    light: [4, 6, 6],
  },
  {
    // 騎士幽靈跪下：中景、側面。騎士幽靈（頭盔、半透明、劍擱在嘴裡）伏在主角面前行禮，主角愣著。
    id: 'p10-3', size: [1000, 720], ink: 3.5,
    horizon: 0.66,
    bg: [{ piece: 'pointedArch', span: 14, rise: 9, thick: 0.5, depth: 0.55, ruin: 0, seed: 11, x: 0.5, y: 0.66, size: 0.62 }],
    cast: [
      { who: 'knightGhost', at: [0.9, 0], yaw: -Math.PI / 2 + 0.3, scale: 1.2, blade: 'knight', move: KNEEL },
      { who: 'hero', at: [-1.0, 0], yaw: Math.PI / 2 - 0.5, move: { headPitch: 0.15, w: 1 }, face: 'dazed' },
    ],
    cam: { pos: [0.4, 0.9, 4.0], look: [0, 0.55, 0], fov: 38 },
  },
  {
    // 捧出靈魂：特寫。騎士幽靈立起上半身，兩隻前腳在胸前捧著一顆發光的狗頭（自己的靈魂），遞過來。
    id: 'p10-4', size: [1000, 720], ink: 4,
    cast: [{ who: 'knightGhost', at: [0, 0], yaw: 0, scale: 1.2, move: { ...OFFER, headPitch: 0.9 } }],
    souls: [{ at: [0, 0.64, 0.62], yaw: 0.9, scale: 0.6, seed: 8 }],
    cam: { pos: [1.9, 0.75, 1.5], look: [0.0, 0.95, 0.35], fov: 40 },
  },
  {
    // 國王……拜託你了。：側面的仰角。騎士幽靈仰起頭往上看（國王在上面），身體越來越淡、散成霧往上飄。
    id: 'p10-5', size: [1000, 720], ink: 3.5,
    cast: [{ who: 'knightGhost', at: [0, 0], yaw: 0, scale: 1.2, alpha: 0.3, blade: 'knight', move: { pitch: -0.25, headPitch: -0.4, tailPitch: -0.4, w: 1 } }],
    puffs: [
      { x: 0.32, y: 0.2, r: 0.07, alpha: 0.6, seed: 3 },
      { x: 0.7, y: 0.14, r: 0.06, alpha: 0.55, seed: 5 },
      { x: 0.76, y: 0.42, r: 0.08, alpha: 0.6, seed: 9 },
      { x: 0.24, y: 0.5, r: 0.05, alpha: 0.5, seed: 11 },
    ],
    cam: { focus: 'knightGhost', yaw: 0.55, pitch: -0.32, dist: 3.0, fov: 40, frame: [0.05, 0.12] },
  },

  /* ── 第 11 頁　回程 ──────────────────────────────────────────── */
  {
    // 沿著水窖貼牆的旋轉梯往上跑：由下往上拍。一級一級的懸臂石階（道具）往右上爬，主角咬著刀、
    // 拿著騎士給的靈魂往上衝；斜的速度線。
    id: 'p11-1', size: [860, 720], ink: 3.5,
    speedLines: { angle: -0.6, rows: 12, band: [0.15, 0.85], len: [0.4, 0.7], seed: 7 },
    bg: [
      { piece: 'arcade', bays: 1, span: 3.0, pier: 0.9, legH: 2.8, depth: 1.0, ruin: 0.4, seed: 12, x: 0.72, y: 1.0, size: 0.75 },
      { piece: 'chain', from: [0, 3.2, 0], to: [1.4, 0, 0], n: 12, sag: 0.9, x: 0.2, y: 0.55, size: 0.5 },
    ],
    props: [{ piece: 'stair', x: 0, z: 0, y: 0, yaw: -Math.PI / 2, steps: 10, rise: 0.32, run: 0.62, w: 2.0, seed: 4, at: [0, 0] }],
    cast: [{ who: 'hero', at: [-3.4, 0.6], y: 1.92, yaw: -Math.PI / 2 + 0.3, speed: 6, frames: 37, blade: 'knife', face: 'proud', eyes: { lift: 0.5, spread: 0.2 } }],
    cam: { focus: 'hero', yaw: -0.3, pitch: -0.14, dist: 4.2, fov: 40, frame: [0.05, -0.12] },
    light: [-4, 6, 6],
  },
  {
    // 跑過窄巷，經過井邊那把劍：側面追拍。主角往右跑，井與掉在井腳的雙刃劍從後面掠過；橫的速度線。
    id: 'p11-2', size: [1200, 720], ink: 3.5,
    horizon: 0.78,
    speedLines: { angle: 0, rows: 14, band: [0.1, 0.75], len: [0.35, 0.6], seed: 9 },
    bg: [
      { piece: 'house', W: 4.6, D: 4, e: 5.4, seed: 3, x: 0.12, y: 0.8, size: 0.9 },
      { piece: 'house', W: 4.6, D: 4, e: 5.0, seed: 4, x: 0.92, y: 0.8, size: 0.85 },
    ],
    props: [
      { piece: 'well', r: 1.1, seed: 2, at: [-1.6, -1.6] },
      { blade: 'knight', at: [-1.0, -0.2], yaw: 0.3, size: 1.2 },
    ],
    cast: [{ who: 'hero', at: [0.6, 0.6], yaw: Math.PI / 2, speed: 7, frames: 33, blade: 'knife', face: 'proud', eyes: { lift: 0.3 } }],
    cam: { focus: 'hero', yaw: 0.25, pitch: 0.05, dist: 4.2, fov: 36, frame: [0.15, -0.05] },
    light: [3, 7, 6],
  },
  {
    // 衝進中庭：正面，主角迎著鏡頭衝過來；集中線收向牠，背後是中庭的斷柱與拱廊。
    id: 'p11-3', size: [1200, 720], ink: 4,
    horizon: 0.74,
    focusLines: { clear: 0.36, n: 100 },
    bg: [
      { piece: 'arcade', bays: 1, span: 3.1, pier: 0.95, legH: 2.6, depth: 1.0, ruin: 0.3, seed: 9, x: 0.1, y: 0.76, size: 0.55 },
      { piece: 'column', r: 0.46, h: 5.2, broken: 0.5, seed: 4, x: 0.82, y: 0.76, size: 0.36 },
      { piece: 'column', r: 0.46, h: 5.2, seed: 5, x: 0.95, y: 0.76, size: 0.62 },
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: 0.1, speed: 7, frames: 31, blade: 'knife', face: 'proud', eyes: { lift: 0.9, spread: 0.35 } }],
    cam: { focus: 'hero', yaw: 0.05, pitch: -0.08, dist: 2.2, fov: 40, frame: [0, 0.02] },
    light: [2, 6, 6],
  },

  /* ── 第 12 頁　中庭（回來）・開場 ───────────────────────────────── */
  {
    // 抬頭看門樓：背影、仰角。主角咬著刀站在中庭中央，門樓高高地壓在上面，鐵閘還放著，牆頭兩隻獸像。
    id: 'p12-1', size: [860, 720], ink: 3.5,
    horizon: 0.86,
    bg: [
      { piece: 'gateway', span: 5, rise: 3.6, h: 6.4, side: 5, lift: 0, x: 0.5, y: 0.88, size: 0.8 },
      { piece: 'gargoyle', s: 0.9, seed: 3, x: 0.12, y: 0.215, size: 0.1 },
      { piece: 'gargoyle', s: 0.9, seed: 4, flip: true, x: 0.88, y: 0.215, size: 0.1 },
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: Math.PI, move: { headPitch: -0.45, tailPitch: 0.1, w: 1 }, blade: 'knife' }],
    cam: { focus: 'hero', yaw: 0.35, pitch: -0.12, dist: 2.6, fov: 40, frame: [-0.08, 0.26] },
  },
  {
    // 鐵閘緩緩升起：特寫。拱裡的鐵閘升到一半，底下透出王座廳那一頭的光，塵土從閘底落下。
    id: 'p12-2', size: [1200, 720], ink: 3.5,
    horizon: 0.9,
    rays: { at: [0.5, 0.9], n: 20, from: Math.PI, to: Math.PI * 2, inner: 0.04, width: 0.45, color: '#fff1c4', alpha: 0.95 },
    bg: [{ piece: 'gateway', span: 5, rise: 3.6, h: 6.4, side: 3, lift: 1.2, x: 0.5, y: 0.92, size: 1.25 }],
    puffs: [
      { x: 0.3, y: 0.86, r: 0.07, color: '#cdbb9c', alpha: 0.8, seed: 4 },
      { x: 0.7, y: 0.88, r: 0.08, color: '#cdbb9c', alpha: 0.8, seed: 6 },
    ],
    cast: [],
    cam: { pos: [0, 1, 6], look: [0, 1, 0], fov: 40 },
  },
  {
    // 國王。：背影。鐵閘升到頂，主角往門洞走，門洞裡透出光。
    id: 'p12-3', size: [1200, 720], ink: 3.5,
    horizon: 0.82,
    rays: { at: [0.58, 0.72], n: 22, from: Math.PI * 0.95, to: Math.PI * 2.05, inner: 0.05, width: 0.45, color: '#fff1c4', alpha: 0.95 },
    bg: [{ piece: 'gateway', span: 5, rise: 3.6, h: 6.4, side: 5, lift: 2.3, x: 0.58, y: 0.84, size: 0.82 }],
    cast: [{ who: 'hero', at: [0, 0], yaw: Math.PI - 0.1, speed: 1.4, frames: 44, move: { headPitch: -0.1, w: 1 }, blade: 'knife' }],
    cam: { focus: 'hero', yaw: -0.3, pitch: 0.06, dist: 2.4, fov: 36, frame: [-0.18, 0.12] },
  },

  /* ── 第 13 頁　王座廳・開場 ──────────────────────────────────── */
  {
    // 兩列柱子、台座、空著的王座：主角的視角往廳底看。兩列柱子從左右兩邊夾進來（近的大、裁出畫面），
    // 越往中間越小，柱與柱之間垂著旗；廳底的台座上一張空王座、兩尊騎士石像（後面的殘牆不畫，畫了會跟
    // 王座黏成一片）。
    // 主角的帽頂在畫面最下面。
    id: 'p13-1', size: [1200, 720], ink: 3.5,
    horizon: 0.6,
    bg: [
      { piece: 'dais', x: 0.5, y: 0.63, size: 0.24 },
      ...[[0.37, 0.61, 0.3], [0.3, 0.63, 0.4], [0.2, 0.67, 0.58], [0.04, 0.76, 0.95]].flatMap(([x, y, size], i) => [
        { piece: 'column', r: 0.5, h: 6.4, seed: 10 + i, x, y, size },
        { piece: 'column', r: 0.5, h: 6.4, seed: 20 + i, x: 1 - x, y, size },
      ]),
      ...[[0.335, 0.3, 0.1], [0.25, 0.28, 0.15]].flatMap(([x, y, size]) => [
        { piece: 'banner', s: 0.9, x, y, size },
        { piece: 'banner', s: 0.9, x: 1 - x, y, size },
      ]),
    ],
    cast: [{ who: 'hero', at: [0, 0], yaw: Math.PI, move: { headPitch: -0.1, w: 1 }, blade: 'knife' }],
    cam: { focus: 'hero', yaw: 0, pitch: 0.12, dist: 2.1, fov: 34, frame: [0, 0.62] },
  },
  {
    // 回憶：我發誓，用這條命守護王。跟第 1 頁第 1 格同一個構圖——國王坐在左後方的王座上，主角在右前方，
    // 柱子與垂旗在後面——只是這一次主角背對我們、朝著國王跪下、低著頭，刀放在面前的地上。
    id: 'p13-2', size: [1200, 720], ink: 3.5,
    props: [
      { piece: 'throneSeat', at: THRONE_AT, yaw: Math.PI + 0.48 },
      { blade: 'knife', at: [-0.55, -0.55], yaw: 1.0, size: 1 },
    ],
    horizon: 0.8,
    bg: [
      { piece: 'column', r: 0.5, h: 6.4, x: 0.03, y: 0.9, size: 1.05 },
      { piece: 'column', r: 0.5, h: 6.4, x: 0.97, y: 0.9, size: 1.05 },
      { piece: 'column', r: 0.5, h: 6.4, x: 0.22, y: 0.84, size: 0.78 },
      { piece: 'column', r: 0.5, h: 6.4, x: 0.62, y: 0.84, size: 0.78 },
      { piece: 'banner', s: 0.9, x: 0.12, y: 0.5, size: 0.42 },
      { piece: 'banner', s: 0.9, x: 0.85, y: 0.5, size: 0.42 },
    ],
    cast: [
      { who: 'king', at: [THRONE_AT[0] + 0.05, THRONE_AT[1] + 0.1], y: 0.5, yaw: 0.48, move: SIT, face: 'calm', shadow: false, eyes: { lift: 0.25, spread: 0.2 } },
      { who: 'hero', at: [0, 0], yaw: -2.6, move: VOW },
    ],
    cam: { pos: [2.7, 0.7, 1.7], look: [-0.9, 0.95, -1.9], fov: 38 },
    light: [5, 7, 3],
  },
  {
    // 回到現在：王座前的地面裂開，光從縫裡透上來。貼著地面拍，台座與王座在後面，一道裂縫橫過前景，
    // 冷光（地底是墓室）從整條縫一起往上冒：一組光芒的中心放在畫面底下外面，光從縫那一條弧開始，
    // 一道一道幾乎平行地往上，碎石跳起來。
    id: 'p13-3', size: [1200, 720], ink: 3.5,
    horizon: 0.78,
    rays: { at: [0.5, 1.9], n: 22, from: Math.PI * 1.3, to: Math.PI * 1.7, inner: 1.05, width: 0.5, color: '#d7ecf8', alpha: 0.95, front: true },
    bg: [
      { piece: 'dais', x: 0.5, y: 0.8, size: 0.5 },
      { piece: 'rubble', r: 0.4, n: 5, seed: 8, x: 0.24, y: 0.66, size: 0.07 },
      { piece: 'rubble', r: 0.5, n: 6, seed: 3, x: 0.76, y: 0.56, size: 0.06 },
      { piece: 'rubble', r: 0.4, n: 4, seed: 12, x: 0.56, y: 0.42, size: 0.05 },
    ],
    puffs: [
      { x: 0.06, y: 0.92, r: 0.1, color: '#cdbb9c', alpha: 0.8, seed: 4 },
      { x: 0.95, y: 0.9, r: 0.11, color: '#cdbb9c', alpha: 0.8, seed: 6 },
    ],
    cast: [],
    cam: { pos: [0, 1, 6], look: [0, 1, 0], fov: 40 },
  },
  {
    // 國王從地底升起：整頁最大的一格，仰角。國王的亡魂（半透明、王冠、咬著劍）從裂縫裡升上來，三面盾繞著他轉，
    // 眼睛還閉著；腳還埋在往兩邊推開的塵土裡，冷光從他身後往外放，碎石飛起來。
    id: 'p13-4', size: [1700, 720], ink: 3.5,
    rays: { at: [0.5, 0.5], n: 30, inner: 0.12, width: 0.45, color: '#d7ecf8', alpha: 0.95 },
    bg: [
      { piece: 'rubble', r: 0.4, n: 5, seed: 8, x: 0.12, y: 0.3, size: 0.08 },
      { piece: 'rubble', r: 0.5, n: 6, seed: 3, x: 0.88, y: 0.2, size: 0.07 },
      { piece: 'rubble', r: 0.4, n: 4, seed: 12, x: 0.25, y: 0.66, size: 0.06 },
      { piece: 'rubble', r: 0.4, n: 4, seed: 21, x: 0.76, y: 0.62, size: 0.06 },
    ],
    puffs: [
      { x: 0.06, y: 0.92, r: 0.15, color: '#cdbb9c', alpha: 0.9, seed: 4 },
      { x: 0.24, y: 0.98, r: 0.12, color: '#cdbb9c', alpha: 0.9, seed: 7 },
      { x: 0.44, y: 0.9, r: 0.13, color: '#cdbb9c', alpha: 0.95, seed: 11 },
      { x: 0.57, y: 0.92, r: 0.13, color: '#cdbb9c', alpha: 0.95, seed: 13 },
      { x: 0.76, y: 0.98, r: 0.12, color: '#cdbb9c', alpha: 0.9, seed: 9 },
      { x: 0.94, y: 0.92, r: 0.16, color: '#cdbb9c', alpha: 0.9, seed: 6 },
    ],
    cast: [{ who: 'ghostKing', at: [0, 0], y: 0.4, yaw: 0.2, air: 2, shields: 3, spin: 1.3, blade: 'king', move: { headPitch: 0.1, tailPitch: -0.4, w: 1 }, face: 'rest', eyes: { lift: 0.9, spread: 0.35 }, shadow: false }],
    cam: { focus: 'ghostKing', yaw: 0.25, pitch: -0.3, dist: 3.3, fov: 44, frame: [0, -0.1] },
    light: [2, 6, 6],
  },
  {
    // 國王睜開眼：眼睛的大特寫，紅眼瞪著鏡頭；集中線。
    id: 'p13-5', size: [860, 720], ink: 4.5,
    focusLines: { clear: 0.42 },
    cast: [{ who: 'ghostKing', at: [0, 0], y: 0.4, yaw: 0.25, air: 0, blade: 'king', move: { headPitch: 0.1, w: 1 }, face: 'glare', eyes: { lift: 0.4, spread: 0.15 }, shadow: false }],
    cam: { focus: 'ghostKing', yaw: 0.3, pitch: 0.0, dist: 1.25, fov: 34, frame: [0, 0.08] },
    light: [2, 6, 6],
  },

  /* ── 第 14 頁　王座廳・結局 ──────────────────────────────────── */
  {
    // 國王跪倒在台座前，身體快散掉了：中景。國王的亡魂伏在台座的階前、閉著眼，淡得快看不見、一團一團的霧
    // 散開，盾不見了、劍掉在地上；主角在右前方背對我們看著他。
    id: 'p14-1', size: [1200, 720], ink: 3.5,
    horizon: 0.62,
    bg: [{ piece: 'dais', x: 0.4, y: 0.64, size: 0.42 }],
    props: [{ blade: 'king', at: [-0.9, 1.0], yaw: 0.4, size: 1.4 }],
    puffs: [
      { x: 0.3, y: 0.32, r: 0.06, alpha: 0.6, seed: 3 },
      { x: 0.55, y: 0.24, r: 0.05, alpha: 0.55, seed: 5 },
      { x: 0.24, y: 0.55, r: 0.05, alpha: 0.5, seed: 9 },
    ],
    cast: [
      { who: 'ghostKing', at: [0, 0], yaw: 0.6, alpha: 0.3, move: { ...KNEEL, headPitch: 0.05 }, face: 'rest', eyes: { lift: 0.3 }, shadow: false },
      { who: 'hero', at: [2.3, 1.4], yaw: -Math.PI / 2 - 0.5, move: { headPitch: 0.15, tailPitch: -0.3, w: 1 }, blade: 'knife' },
    ],
    cam: { pos: [1.3, 0.75, 4.4], look: [0.6, 0.55, 0], fov: 40 },
    light: [4, 7, 6],
  },
  {
    // 主角把一路收集的靈魂倒在國王身上：近景、側面。主角低頭看著跪著的國王，BOSS、騎士、騎士幽靈的
    // 三顆靈魂（發光的狗頭）從主角身前一顆接一顆落到國王身上。
    id: 'p14-2', size: [1200, 720], ink: 4,
    cast: [
      { who: 'ghostKing', at: [-0.9, 0], yaw: Math.PI / 2, alpha: 0.2, move: { ...KNEEL, headPitch: 0.4 }, face: 'rest', shadow: false },
      { who: 'hero', at: [0.75, 0], yaw: -Math.PI / 2 + 0.35, move: { headPitch: 0.35, tailPitch: -0.2, w: 1 }, face: 'hope', blade: 'knife' },
    ],
    souls: [
      { at: [0.25, 1.35, 0.1], yaw: -1.2, scale: 0.55, seed: 3, trail: 25 },
      { at: [-0.25, 1.15, 0], yaw: -1.4, scale: 0.55, seed: 5, trail: 25 },
      { at: [-0.7, 0.95, 0.05], yaw: -1.6, scale: 0.55, seed: 7, trail: 25 },
    ],
    cam: { pos: [0.1, 1.0, 3.6], look: [-0.05, 0.85, 0], fov: 38 },
    light: [2, 7, 6],
  },
  {
    // 國王從半透明變回實體，光從他身上擴散出去：中景、逆光。國王（垂耳犬、灰、王冠，原本的毛色）在台座前
    // 立起上半身，背後的光往四周放出去，光從他的左後方打過來，臉的一半落在暗部裡。
    id: 'p14-3', size: [1200, 720], ink: 3.5,
    horizon: 0.82,
    rays: { at: [0.5, 0.4], n: 28, inner: 0.1, width: 0.5, color: '#fff1c4', alpha: 0.95, front: true },
    bg: [{ piece: 'dais', x: 0.5, y: 0.84, size: 0.55 }],
    puffs: [
      { x: 0.2, y: 0.3, r: 0.05, alpha: 0.5, seed: 3 },
      { x: 0.82, y: 0.22, r: 0.045, alpha: 0.45, seed: 5 },
    ],
    cast: [{ who: 'king', at: [0, 0], yaw: 0.15, move: { pitch: -0.25, headPitch: -0.05, tailPitch: 0.3, w: 1 }, face: 'calm', eyes: { lift: 0.3 } }],
    cam: { focus: 'king', yaw: 0.2, pitch: -0.12, dist: 3.2, fov: 40, frame: [0, -0.05] },
    light: [-5, 6, 2],
  },
  // 光掃過中庭、窄巷、兵營，殭屍和幽靈變回原來的人：三條細長分格並排，每一條一個地方、一隻變回來的人民，
  // 從左上角斜斜掃下來的光，身上殘留的霧散掉。
  {
    // 中庭：斷柱與拱廊，一隻貓愣愣地四處看。
    id: 'p14-4a', size: [600, 1100], ink: 3.5,
    horizon: 0.72,
    rays: { at: [-0.3, -0.1], n: 10, from: 0.1, to: Math.PI / 2 - 0.1, inner: 0.2, width: 0.5, color: '#fff1c4', alpha: 0.95 },
    bg: [
      { piece: 'arcade', bays: 1, span: 3.1, pier: 0.95, legH: 2.6, depth: 1.0, ruin: 0.3, seed: 9, x: 0.2, y: 0.73, size: 0.4 },
      { piece: 'column', r: 0.46, h: 5.2, broken: 0.5, seed: 4, x: 0.85, y: 0.73, size: 0.22 },
    ],
    puffs: [{ x: 0.16, y: 0.3, r: 0.04, color: '#cfe3c4', alpha: 0.6, seed: 3 }, { x: 0.84, y: 0.22, r: 0.035, color: '#cfe3c4', alpha: 0.55, seed: 5 }],
    cast: [{ who: 'folk', look: 'cat/orangin', at: [0, 0], yaw: 0.3, move: LOOK_AROUND, face: 'dazed' }],
    cam: { focus: 'folk', yaw: 0.5, pitch: 0.05, dist: 2.4, fov: 40, frame: [0, 0.08] },
    light: [-4, 7, 5],
  },
  {
    // 窄巷：兩排房子與井，一隻花斑垂耳犬抬起頭來。
    id: 'p14-4b', size: [600, 1100], ink: 3.5,
    horizon: 0.72,
    rays: { at: [-0.3, -0.1], n: 10, from: 0.1, to: Math.PI / 2 - 0.1, inner: 0.2, width: 0.5, color: '#fff1c4', alpha: 0.95 },
    bg: [
      { piece: 'house', W: 4.6, D: 4, e: 5.4, seed: 3, x: 0.1, y: 0.73, size: 0.45 },
      { piece: 'house', W: 4.6, D: 4, e: 5.0, seed: 4, x: 0.92, y: 0.73, size: 0.42 },
      { piece: 'well', r: 1.1, seed: 2, x: 0.55, y: 0.74, size: 0.1 },
    ],
    puffs: [{ x: 0.16, y: 0.26, r: 0.04, alpha: 0.6, seed: 7 }, { x: 0.82, y: 0.18, r: 0.035, alpha: 0.55, seed: 9 }],
    cast: [{ who: 'folk', look: 'dog-drop/cow', at: [0, 0], yaw: -0.3, move: { headPitch: -0.3, tailPitch: 0.4, w: 1 }, face: 'hope' }],
    cam: { focus: 'folk', yaw: -0.5, pitch: 0.05, dist: 2.4, fov: 40, frame: [0, 0.08] },
    light: [-4, 7, 5],
  },
  {
    // 兵營：營帳與兵器架，一隻灰色立耳犬站起來四處看。
    id: 'p14-4c', size: [600, 1100], ink: 3.5,
    horizon: 0.72,
    rays: { at: [-0.3, -0.1], n: 10, from: 0.1, to: Math.PI / 2 - 0.1, inner: 0.2, width: 0.5, color: '#fff1c4', alpha: 0.95 },
    bg: [
      { piece: 'pavilion', R: 1.9, h: 1.45, roof: 1.25, x: 0.15, y: 0.74, size: 0.22 },
      { piece: 'weaponRack', x: 0.82, y: 0.74, size: 0.2 },
    ],
    puffs: [{ x: 0.84, y: 0.3, r: 0.04, color: '#cfe3c4', alpha: 0.6, seed: 4 }, { x: 0.18, y: 0.2, r: 0.035, color: '#cfe3c4', alpha: 0.55, seed: 6 }],
    cast: [{ who: 'folk', look: 'dog-prick/grey', at: [0, 0], yaw: 0.4, move: { ...LOOK_AROUND, headYaw: -0.3, headPitch: -0.1 }, face: 'dazed', eyes: { lift: 0.5 } }],
    cam: { focus: 'folk', yaw: 0.6, pitch: 0.05, dist: 2.4, fov: 40, frame: [0, 0.08] },
    light: [-4, 7, 5],
  },
  {
    // 完：國王回到王座上，廳裡站滿了人，主角咬著刀站在旁邊——跟第 1 頁第 1 格呼應（同樣的柱子、垂旗、
    // 左後方的王座），只是這一次廳裡不是空的。
    id: 'p14-5', size: [1700, 720], ink: 3,
    props: [{ piece: 'throneSeat', at: [0, -4.2], yaw: Math.PI }],
    horizon: 0.78,
    bg: [
      { piece: 'column', r: 0.5, h: 6.4, x: 0.03, y: 0.88, size: 1.05 },
      { piece: 'column', r: 0.5, h: 6.4, x: 0.97, y: 0.88, size: 1.05 },
      { piece: 'column', r: 0.5, h: 6.4, x: 0.27, y: 0.8, size: 0.78 },
      { piece: 'column', r: 0.5, h: 6.4, x: 0.73, y: 0.8, size: 0.78 },
      { piece: 'banner', s: 0.9, x: 0.15, y: 0.5, size: 0.42 },
      { piece: 'banner', s: 0.9, x: 0.85, y: 0.5, size: 0.42 },
    ],
    cast: [
      { who: 'king', at: [0.05, -4.1], y: 0.5, yaw: 0, move: SIT, face: 'calm', shadow: false, eyes: { lift: 0.25, spread: 0.2 } },
      { who: 'hero', at: [1.5, -3.2], yaw: -0.25, move: HEROIC, face: 'proud', blade: 'knife', eyes: { lift: 0.6, spread: 0.3 } },
      ...[
        ['cat/orangin', -3.4, -1.0, 0.5], ['dog-drop/cow', -2.0, 0.2, 0.3], ['cat/tabby', -0.8, 1.2, 0.1],
        ['dog-prick/grey', 0.7, 1.4, -0.1], ['cat/calico', 2.1, 0.6, -0.3], ['dog-drop/yellow', 3.4, -0.6, -0.5],
        ['dog-prick/cow', -4.4, 0.9, 0.6], ['cat/orangin', 4.3, 1.0, -0.6],
      ].map(([look, x, z, yaw]) => ({ who: 'folk', look, at: [x, z], yaw: yaw + Math.PI, move: { headPitch: -0.25, tailPitch: 0.5, w: 1 } })),
    ],
    cam: { pos: [0, 2.8, 7.5], look: [0, 0.9, -2.6], fov: 36 },
    light: [-3, 7, 6],
  },
];
