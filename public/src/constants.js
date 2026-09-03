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

// 世界的比例尺。距離對玩家一律以公尺呈現（儀表板、NPC 的間距都是），
// 內部座標則一律是 px——換算只在邊界上做這一次。
export const PX_PER_M = 10;

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

// ── 動態視距 ──────────────────────────────────────────
// 橫向手機的畫面很矮（390px 上下），固定視距會讓下一塊地形掉到畫面外。
//
// 規則：左右各取最近的 count 個落腳點，每一個都要落在允許範圍內，容差隨距離放寬——
// 最緊的那一檔要在邊界內側再留 5%（門檻 95%），下一檔 100%，再下一檔超出 5%，往後同理。
// 最緊的那檔不取 100% 而是 95%：貼著邊界等於沒有餘裕，板子的厚度、名牌、
// 相機平滑的殘差任何一項都會讓它剛好被切掉。
// 但門檻不是直接照距離發：最近的那個未必是落差最大的那個，一個小台階排在前面就會
// 拿走 100%，真正會被切掉的大落差卻只拿到 105%。所以最近的 reorder 個先依
// 「有多難框」（落差 ÷ 那一側可用的畫面比例）由難到易重排，再照這個順序發門檻。
// 「邊界」量的是錨點到可視區邊界（扣掉手把佔掉的部分），不是到畫布邊界。
// 越遠的落腳點還有時間慢慢框進來，所以不必為它現在就把世界縮小——階梯就是這個意思。
//
// 鏡頭的縮放是等加速度運動：加速度大小固定，方向由「還來不來得及煞住」決定。
// 沒有速度上限也沒有指數逼近，所以起步與收尾都是同一條拋物線，看不到突然的抽動。
export const VIEW = {
  count: 12,        // 左右各看幾個落腳點
  base: 0.95,      // 容差階梯最緊的那一檔：要落在邊界內側 5% 處，不是壓在邊界上
  slack: 0.05,     // 階梯每退一檔放寬多少（門檻 = base + i×slack）
  reorder: 6,      // 最近的這幾個先依「有多難框」重排，難的拿緊的門檻
  minZoom: 0.35,   // 拉遠的硬底限。唯一會讓上面那條規則不成立的地方
  accel: 0.1,      // 視距的等加速度（zoom/秒²）。全程只有這一個量值，方向由煞車距離決定
  span: 4200,      // 找落腳點的最大搜尋半徑。夠遠就找得滿 8 個，找不滿就是那一側沒有了

  // 量測落腳點高低差的基準面，在「地形」與「貓的實際高度」之間的權重。
  // 0 ＝ 只看地形（貓原地跳時需求完全不變，縮放沒有東西可以反應）；
  // 1 ＝ 完全跟著貓（每一次跳躍都把需求整個帶著走）。0.5 是各半。
  // 貓離畫面中心越遠，落腳點在畫面上就被擠得越靠邊，這個權重就是那份影響力。
  catWeight: 0.5,

  // 縮放的加速度會隨貓的垂直速度放大：貓在上升或墜落的時候，正是視野需求變動最快、
  // 最需要縮放跟上的時候。放大的只有加速度的量值，方向仍然由煞車距離決定。
  // 倍率是 1 + boost × min(1, |vy|/boostRef)，所以最高點與落地都自動回到 1，
  // 不必另外做開關；平飛與站著的時候完全等於原本的 accel。
  boostUp: 7.0,    // 上升段的放大量
  boostDown: 0.25, // 下落段的放大量
  boostRef: PHYS.jumpVel, // 放大量長到滿的參考速度（起跳速度）
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
