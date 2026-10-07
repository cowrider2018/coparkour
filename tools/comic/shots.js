/* ── tools/comic/shots.js ─────────────────────────────────────────────
   漫畫每一格的鏡頭（攝影棚 studio.js 照這張表擺、拍、出圖）：誰在場、站哪、
   面朝哪、什麼姿勢，鏡頭在哪、看哪，背後有哪些剪影。剪影以外是透明的——書頁上看到的是紙。

   每一格：
     id     圖檔名（public/test/comic/<id>.png），也是 comic.js 那一格的 src
     size   出圖的像素（寬、高）。比例照它在橫向版面裡那一格（四格頁：a 約 2.9、b 1.3、c 1.7、d 2.6 比 1）；
            直向或別的比例由書頁照 comic.js 的 focus 裁
     cast   在場的角色：
              who    'hero'（主角：立耳犬、黃、戴漁夫帽）或 'king'（活著的國王：垂耳犬、灰、王冠、1.4 倍高）
              at     [x, z]（公尺），yaw 面朝哪（0 = +Z，π/2 = +X）
              move   疊在上面的姿勢（critter.js 的 moveOverlay：pitch、headPitch、front、knee、legs…）
              tip    整隻往側邊倒幾弳（0 = 站著、π/2 = 躺平；death.js 那一種倒法，往牠自己的 +X 側倒）
              blade  嘴裡橫咬哪一把（blade.js：'knife' 主角的刀、'knight'、'king'），沒給是空手
              y      墊高幾公尺（坐在王座上）；shadow: false 不畫腳下的影子
              face   漫畫的表情（faces.js：proud、calm、tears、shock、tired、dazed），沒給就是模型原本的眼睛
              eyes   { lift, spread }：畫上去的眼睛往額頭抬、往外分開多少（眼睛半高的幾倍；正面特寫用）
     props  背景與道具的剪影：{ shape, at: [x, z], yaw, scale, y, color, len }。shape 見 studio.js 的 SHAPES
            （throne、column、banner、tent、rack、wall、tower、flag、sun）。顏色照離鏡頭多遠自動褪向紙色，
            遠景要放得真的遠（幾十公尺）才讀得出遠；color 只給太陽那種不照距離的
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

export const SHOTS = [
  {
    // 王國最強的戰士：主角昂首在前（從下往上拍、裁到胸口），國王坐在後面的王座上。
    id: 'p1-1', size: [1800, 620], ink: 3.5,
    props: [{ shape: 'throne', at: [-2.7, -2.0], yaw: 0.6, scale: 1.4 }],
    cast: [
      { who: 'king', at: [-2.7, -1.95], y: 0.7, yaw: 0.6, move: SIT, face: 'calm', shadow: false },
      { who: 'hero', at: [0, 0], yaw: -0.5, move: HEROIC, face: 'proud' },
    ],
    cam: { focus: 'hero', yaw: 0.35, pitch: -0.28, dist: 1.5, fov: 34, frame: [0.17, 0.02] },
    light: [-4, 7, 5],
  },
  {
    // 驚醒：臉的大特寫，嚇出眼淚。頭往後仰，鏡頭從前上方對著臉。
    id: 'p1-2', size: [900, 700], ink: 4.5,
    cast: [{ who: 'hero', at: [0, 0], yaw: 0.75, move: STARTLE, face: 'shock', eyes: { lift: 0.9, spread: 0.35 } }],
    cam: { focus: 'hero', yaw: 0.95, pitch: 0.08, dist: 1.0, fov: 32, frame: [0, 0.08] },
    light: [5, 7, 4],
  },
  {
    // ……睡過頭了：近景，橫線的疲憊眼睛。鏡頭在眼睛的高度，帽簷不擋。
    id: 'p1-3', size: [1200, 720], ink: 4,
    cast: [{ who: 'hero', at: [0, 0], yaw: -0.45, move: DROWSY, face: 'tired' }],
    cam: { focus: 'hero', yaw: -0.8, pitch: -0.08, dist: 1.0, fov: 32, frame: [-0.12, 0.08] },
    light: [-3, 6, 6],
  },
  {
    // 人呢？：中景、裁到腳，抬頭張望、冒汗。
    id: 'p1-4', size: [1600, 620], ink: 3.5,
    cast: [{ who: 'hero', at: [0, 0], yaw: 0.3, move: LOOK_AROUND, face: 'dazed' }],
    cam: { focus: 'hero', yaw: 0.55, pitch: 0.12, dist: 1.9, fov: 30, frame: [0.08, -0.05] },
  },
];
