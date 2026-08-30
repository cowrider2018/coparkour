// ── 物理參數（單位：px、秒）─────────────────────────────
// 這些數值同時被「地形生成器」拿來算最大可跳距離，改動時請一起跑 tools/verify-level.mjs
export const PHYS = {
  gravity: 2000,
  maxFall: 1250,

  runSpeed: 385,
  accelGround: 3800,
  accelAir: 2300,
  frictionGround: 4600,

  jumpVel: 830,
  jumpCut: 0.42, // 放開跳躍鍵時保留的上升速度比例（可變跳躍高度）
  coyoteTime: 0.1, // 離開地面後仍可起跳的寬容時間
  jumpBuffer: 0.12, // 落地前先按跳躍的緩衝時間
  airJumps: 1, // 二段跳次數

  wallSlideSpeed: 210,
  wallJumpVX: 430,
  wallJumpVY: 780,
  wallStick: 0.12, // 蹬牆後鎖住水平輸入的時間

  respawnY: 1100, // 掉到這個高度以下就算死亡
};

export const PLAYER_W = 26;
export const PLAYER_H = 40;

// 單次跳躍的最大高度 / 水平距離（生成器用來確保關卡一定跳得過去）
export const JUMP_HEIGHT = (PHYS.jumpVel * PHYS.jumpVel) / (2 * PHYS.gravity); // ≈ 172
export const JUMP_AIRTIME = (2 * PHYS.jumpVel) / PHYS.gravity; // ≈ 0.83s
export const JUMP_RANGE = PHYS.runSpeed * JUMP_AIRTIME; // ≈ 320

export const WORLD = {
  yMin: 60, // 平台最高可以到多高
  yMax: 640, // 平台最低可以到多低
  startY: 520,
  chunkAhead: 2600, // 相機前方要先生成多少距離
};

export const NET = {
  sendHz: 10, // 每秒送幾次自己的座標（免費額度友善）
  pingMs: 15000,
  interpDelay: 120, // 幽靈玩家的插值延遲（ms），讓移動平滑
  staleMs: 8000, // 超過這麼久沒更新就不畫這個幽靈
};

export const PALETTE = {
  skyTop: '#0d1330',
  skyBottom: '#2b1c4a',
  hillFar: '#1a2450',
  hillNear: '#232f63',
  platformTop: '#5ef2c0',
  platformBody: '#14314a',
  platformEdge: '#2a5f77',
  spike: '#ff5d73',
  coin: '#ffd36e',
  self: '#5ef2c0',
  ghost: '#8fb7ff',
};
