/* ── test/src/shots.js ───────────────────────────────────────────────
   漫畫每一格的鏡頭（攝影棚模式 mode-comic.js 照這張表擺、拍、出圖）：誰在場、站哪、
   面朝哪、什麼姿勢，鏡頭在哪、看哪。只畫主體，背景是透明的——書頁上看到的是紙。

   每一格：
     id     圖檔名（public/test/comic/<id>.png），也是 comic.js 那一格的 src
     size   出圖的像素（寬、高）
     cast   在場的角色：
              who    'hero'（主角：立耳犬、黃、戴漁夫帽）或 'king'（活著的國王：垂耳犬、灰、王冠、1.4 倍高）
              at     [x, z]（公尺），yaw 面朝哪（0 = +Z，π/2 = +X）
              move   疊在上面的姿勢（critter.js 的 moveOverlay：pitch、headPitch、front、knee、legs…）
              tip    整隻往側邊倒幾弳（0 = 站著、π/2 = 躺平；death.js 那一種倒法，往牠自己的 +X 側倒）
     cam    鏡頭：pos、look（世界座標）、fov（度）
     light  主光從哪個方向來（指向光的向量；沒給就是遊戲那一盞 KEY_POS）
     ink    墨線幾像素（出圖的高度是 size[1]）

   主角固定畫成遊戲的預設那一隻（立耳犬、黃、戴帽子）：漫畫是事先畫好的，不會跟著玩家選的動物換。
   ------------------------------------------------------------------ */

/** 單膝跪下、低頭受封：前腳收起來、身體往前壓低、頭垂下。 */
const KNEEL = {
  pitch: 0.18, headPitch: 0.42, drop: 0.1, tailPitch: -0.3,
  front: 0.8, knee: -1.2, hind: -0.3, legs: 1, w: 1,
};
/** 國王站得挺：抬頭、胸口挺出來。 */
const PROUD = { pitch: -0.12, headPitch: -0.18, tailPitch: 0.2, w: 1 };
/** 猛然彈起來：後半身還坐著，上半身往上撐、前腳往前伸，頭往後仰。 */
const STARTLE = {
  pitch: -0.55, headPitch: -0.35, drop: -0.04, tailPitch: 0.8,
  front: -1.0, hind: 0.9, knee: 0.6, legs: 1, w: 1,
};
/** 愣在那裡：頭歪一邊。 */
const DAZED = { headTilt: 0.32, headPitch: 0.08, tailPitch: -0.35, w: 1 };
/** 四處張望：頭轉向一邊。 */
const LOOK_AROUND = { headYaw: 0.75, headPitch: -0.1, w: 1 };

export const SHOTS = [
  {
    id: 'p1-1', size: [1500, 900], ink: 3,
    cast: [
      { who: 'king', at: [-0.85, 0], yaw: Math.PI / 2, move: PROUD },
      { who: 'hero', at: [0.75, 0], yaw: -Math.PI / 2, move: KNEEL },
    ],
    cam: { pos: [0.2, 0.75, 4.2], look: [0, 0.62, 0], fov: 32 },
  },
  {
    id: 'p1-2', size: [900, 900], ink: 4,
    cast: [{ who: 'hero', at: [0, 0], yaw: 1.35, move: STARTLE }],
    cam: { pos: [0.9, 0.65, 2.1], look: [0.1, 0.55, 0], fov: 34 },
    light: [5, 7, 4],
  },
  {
    id: 'p1-3', size: [1300, 900], ink: 3,
    cast: [{ who: 'hero', at: [0, 0], yaw: 0.35, move: DAZED }],
    cam: { pos: [-2.3, 1.05, -0.7], look: [0.1, 0.5, 0.4], fov: 32 },
    light: [-6, 7, -1],
  },
  {
    id: 'p1-4', size: [1500, 900], ink: 2.5,
    cast: [{ who: 'hero', at: [0, 0], yaw: 0.6, move: LOOK_AROUND }],
    cam: { pos: [0, 3.4, 7.5], look: [0, 0.4, 0], fov: 22 },
  },
];
