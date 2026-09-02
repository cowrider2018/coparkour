// ── gl/background.js ────────────────────────────────────────────────
// 遊戲後面的一整片天：天空、星星、日月、地平線的光、四層山脊、還有下的雨雪。
// 全部在一支 WebGL2 的 fullscreen triangle 裡，外加落下的東西一支 draw call。
//
// 這一層跟 Canvas2D 的遊戲層完全不共用資料——它只吃 draw() 傳進來的那個
// 物件。那不是潔癖，是因為兩張 canvas 疊在一起時，任何「兩邊各存一份鏡頭」
// 的設計都會在某一幀對不上，而對不上的天空是所有人第一眼就會看到的東西。
//
// 顏色一律 linear 作者化，最後走 ACES Narkowicz 套在 linear × 1.25、
// 不做 sRGB 編碼——跟 gfx/daycycle.js 的 acesTone() 一模一樣。這件事錯了
// 整個畫面會亮兩倍而且發灰，而且會跟 Canvas2D 那層畫的東西對不上。

import { cell } from '../gfx/field.js';

/* ── 世界裡的地平線 ────────────────────────────────────────────
   平台活在 world y ∈ [60, 640]，掉到 1100 算死。地平線放在 620：
   比最低的平台再低一點點，所以山脊永遠在可走的地面「後面」，
   而不是穿過它。

   CAM_REF 是「典型的鏡頭高度」——玩家在 y≈520 時 Camera.follow 會把
   cam.y 停在 520 - 0.55·VH ≈ 124，加上一點上下浮動，150 是個誠實的中位數。
   四層山脊的基準線都以它為錨：在這個高度四層剛好都貼在地平線上，
   離開它時近的層跟著鏡頭上下移動得比遠的層多，這就是垂直視差。 */
const HORIZON_Y = 620.0;
const CAM_REF = 150.0;

/* ── 四層山脊 ──────────────────────────────────────────────────
   波長 74/41/23/13 來自 gfx/field.js，是刻意互不成整數比的一組，所以
   跑多遠都不會看到重複。SCALE 把「單位」換成像素：玩家 40px 高，
   最遠那層的主波長是 74 × 12 ≈ 890px，差不多一個螢幕寬；但它的視差
   只有 0.05，鏡頭要跑 890 / 0.05 ≈ 18000px（跑者大約四十五秒）才走完
   一個起伏——遠山本來就應該慢到幾乎不動。最近那層 74 × 22 ≈ 1630px，
   視差 0.40，大約十秒一座山。

   AMP 是振幅（field 的值域約 ±0.85）。最近一層 150 ≈ 3.7 個玩家高，
   夠大到讓天際線有事發生，又不會蓋掉玩家要看的平台。

   SCALE 跟 AMP 一起往上走，比例大致固定，因為那才是「同一種山，
   離得比較近」該有的樣子：近的山又高又寬。四層的最大斜率
   （AMP / SCALE × SLOPE_PER_AMP，SLOPE_PER_AMP ≈ 0.165）落在
   0.55 到 1.12 之間——近的稍陡，因為近看本來就看得到更多起伏。
   只放大 AMP 不放大 SCALE 的第一版把最近那層做成了 73° 的尖刺。

   OFF 是各層基準線相對地平線往下推多少。峰頂刻意一層比一層低：
   最遠的山脊在天空上畫出天際線，越近的越低，最近那層的峰頂剛好
   壓在地平線下面——它不是山，它是玩家腳下那片地的遠端。

   HAZE 是往空氣色靠過去多少——遠的多、近的少；ALB 是反照率倍率——
   遠的亮、近的暗。這兩件事必須一起做：只做霧會讓遠山變灰而不是變遠，
   只做暗度會讓近山看起來像剪紙。空氣透視是「遠的東西同時變亮且變沒對比」。*/
const R_PLX = [0.05, 0.11, 0.22, 0.40];
const R_SCALE = [12.0, 15.0, 18.0, 22.0];
const R_AMP = [40.0, 62.0, 98.0, 150.0];
const R_OFF = [-30.0, 22.0, 83.0, 165.0];
const R_HAZE = [0.86, 0.62, 0.37, 0.15];
const R_ALB = [1.0, 0.84, 0.68, 0.54];

/* 每層一個固定的受光量，不逐像素算。跟 render.js 備援山脈的那條
   `0.10 + i * 0.09` 是同一組數字——兩層 canvas 要看起來像同一個場景，
   山脈的著色規則就得是同一條。 */
const R_NDL = [0.10, 0.19, 0.28, 0.37];

/* 跟備援山脈的 shade(..., 1.6) 是同一個增益。平的受光量比原本逐像素
   算出來的平均低（原本迎光的坡面可以衝到 1），少了這一項近山會整片壓成黑。 */
const R_GAIN = 1.6;

/* 山脊的底色，偏藍紫——跟 PALETTE.hillFar/hillNear 是同一家人。

   這是「反照率」，不是「畫出來的顏色」，兩者差一個 2.4 倍的直接光增益
   加上一條 ACES 曲線。第一版寫 (0.30, 0.34, 0.52)——那是雪的反照率，
   正午整片山脊被推到 tonemap 的頂端，四層全部糊成同一片淡紫，什麼
   空氣透視都看不出來。真實的岩石與矮樹叢大約在 0.08 到 0.12 之間，
   而 shadeDirect 的增益就是為那個範圍校準的。 */
const R_TINT = [0.075, 0.085, 0.115];

/* ……但它現在是預設值，不是常數。遠山跟腳下的草皮是同一片地理的兩個尺度，
   所以季節換的時候它們要一起換：夏天遠山是被矮樹叢蓋住的綠、秋天轉琥珀、
   冬天壓成雪的藍灰。實際的值由 draw() 的 f.ridgeTint 傳進來（見 gfx/season.js），
   沒傳就退回上面那組。

   為什麼是 lerp 而不是像草那樣抽籤：一整條山脈是一個面，不是一群個體，
   沒有東西可以拿來抽。抽籤的規則屬於「有很多個」的東西。 */

/* ── 落下的東西 ────────────────────────────────────────────────
   雨滴數依強度給。上限是為了 SwiftShader 這種沒有 GPU 的環境留條活路。 */
const RAIN_DROPS = 2600;
const SNOW_FLAKES = 800;

const GLSL_HASH = /* glsl */ `
/* gfx/field.js 的 cell() 原封不動搬過來。

   為什麼不用 hash33 那種 fract(p * 0.1031) 的浮點雜湊：那一族在座標
   大到幾千的時候會開始出現可見的結構，而這個遊戲的鏡頭會一路跑到
   world x 幾萬。整數雜湊沒有這個問題，而且跟 JS 那邊逐位元相同——
   同一個 room seed 在兩邊問同一個格子會拿到同一個答案。 */
uint ihash(int ix, int iy, int k) {
  uint h = uint(ix) * 0x27d4eb2du ^ uint(iy) * 0x165667b1u ^ uint(k) * 0x9e3779b1u;
  h ^= h >> 15; h *= 0x2c1b3c6du;
  h ^= h >> 12; h *= 0x297a2d39u;
  h ^= h >> 15;
  return h;
}

/* 取高 24 bit 才轉 float：float 只有 24 bit 尾數，直接轉整個 uint32
   會把低位丟掉——丟掉的剛好是雜湊裡最亂的那幾位。 */
float rnd(int ix, int iy, int k) { return float(ihash(ix, iy, k) >> 8) / 16777216.0; }
`;

const GLSL_COLOR = /* glsl */ `
/** ACES Narkowicz。套在 linear × 1.25 上，之後不做 sRGB 編碼。 */
vec3 acesFilm(vec3 x) {
  x = max(x, 0.0) * 1.25;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

/* 4×4 有序 Bayer，振幅剛好半個 8-bit LSB。夜空的底色大約是 linear
   0.004，過完 tonemap 只剩一兩個 8-bit 碼——沒有 dither 的話那是一片
   會走路的色帶，而且是整個畫面最大的一塊。螢幕空間靜態，所以它不蠕動。*/
float bayer4(vec2 p) {
  vec2 c = floor(mod(p, 4.0));
  const float m[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0);
  return m[int(c.x + c.y * 4.0)] / 16.0 - 0.5;
}
`;

const VERT_FULLSCREEN = /* glsl */ `#version 300 es
out vec2 vUv;
/* 一個蓋過整個 clip space 的三角形，沒有 attribute 也沒有 buffer。
   兩個三角形拼成的矩形會在對角線上重複跑一次 quad 的 fragment，
   而且對角線兩側的導數是不連續的；一個超大三角形兩者都沒有。 */
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAG_SKY = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uRes;        // drawing buffer 的實際像素數
uniform vec2 uCam;        // 視野左上角的世界座標
uniform vec2 uView;       // 視野涵蓋多少世界單位
uniform vec3 uLightDir;   // sky.dir，y 是仰角的 sin
uniform vec3 uTint;       // sky.tint，已經含強度
uniform vec3 uAmbient;    // sky.ambient
uniform float uDay;       // sky.day
uniform float uTime;
uniform int uSeed;
uniform vec4 uPhase[4];   // 每層山脊、每個波的相位偏移，由 seed 決定
uniform vec3 uRidgeTint;  // 這一段 x 的季節給的遠山反照率

${GLSL_HASH}
${GLSL_COLOR}

/* ── 天空的顏色表 ──────────────────────────────────────────────
   直接抄 cluster.js 的 SKY block，也就是 daycycle.js 的 skyBands()
   讀的同一組數字。這裡選擇「在 GLSL 裡從 uDay + uLightDir.y 重算」
   而不是把三個顏色當 uniform 傳進來，理由跟原作一樣：uDay 有十一個
   小時都是 1，光靠它天空整個白天不會動；真正一直在動的是 uLightDir.y。
   既然 shader 本來就需要 uLightDir 來畫日月和地平線的光，重算三個
   mix 比多傳三個 vec3 還便宜，而且不會有 CPU/GPU 兩份色表走鐘的風險。 */
const vec3 NOON_TOP = vec3(0.082, 0.180, 0.430);
const vec3 NOON_HOR = vec3(0.195, 0.265, 0.390);
const vec3 NOON_BOT = vec3(0.045, 0.060, 0.090);

const vec3 DUSK_TOP = vec3(0.042, 0.046, 0.115);
const vec3 DUSK_HOR = vec3(0.105, 0.092, 0.140);
const vec3 DUSK_BOT = vec3(0.024, 0.019, 0.026);

const vec3 NIGHT_TOP = vec3(0.006, 0.009, 0.022);
const vec3 NIGHT_HOR = vec3(0.012, 0.016, 0.030);
const vec3 NIGHT_BOT = vec3(0.004, 0.005, 0.010);

/** 低空的那道光。加法，因為它是「多出來的光」而不是「換掉的空氣」。 */
const vec3 LOW_GLOW = vec3(0.55, 0.200, 0.055);

const float HORIZON_Y = ${HORIZON_Y.toFixed(1)};
const float CAM_REF = ${CAM_REF.toFixed(1)};

/* 仰角 1.0 對應到地平線上方多少個「視野高度」。

   這個數字是整份 shader 唯一一個不是物理的常數，它是取景。真正的
   正午太陽在 66.5° 仰角，用任何誠實的透視投影它都在畫面外——側視角
   捲軸遊戲的垂直視野只有二三十度。0.62 是反推出來的：典型鏡頭高度下
   地平線在畫面 31% 處，正午的 uLightDir.y = 0.917 要落在 88% 左右
   才看得到，(0.88 - 0.31) / 0.917 ≈ 0.62。 */
const float SKY_H = 0.62;

/* 方位角 ±1 對應到畫面寬度的多少。0.43 而不是 0.5：日出時
   uLightDir.x ≈ -0.99，用 0.5 太陽會有一半被切在畫面外。 */
const float SKY_X = 0.43;

/* ── 非諧波正弦場，gfx/field.js 的 GLSL 版 ────────────────────
   權重讓 w·k 幾乎相等（每一項貢獻同樣多的斜率），這是正弦版的
   gain = 1/lacunarity。回傳 (高度, d/dx)——正弦和給得起解析導數，
   這就是為什麼山脊的法線是免費的，不用差分也不用查表。 */
const vec4 W_LAM = vec4(74.0, 41.0, 23.0, 13.0);
const vec4 W_PH  = vec4(0.00, 1.70, 3.90, 0.60);
const vec4 W_W   = vec4(1.00, 0.55, 0.30, 0.17) / 2.02;

vec2 ridgeField(float x, float scale, vec4 phase) {
  vec4 k = 6.28318530718 / (W_LAM * scale);
  vec4 a = k * x + W_PH + phase;
  return vec2(dot(W_W, sin(a)), dot(W_W * k, cos(a)));
}

const float R_PLX[4]   = float[4](${R_PLX.map((v) => v.toFixed(3)).join(', ')});
const float R_SCALE[4] = float[4](${R_SCALE.map((v) => v.toFixed(2)).join(', ')});
const float R_AMP[4]   = float[4](${R_AMP.map((v) => v.toFixed(1)).join(', ')});
const float R_OFF[4]   = float[4](${R_OFF.map((v) => v.toFixed(1)).join(', ')});
const float R_HAZE[4]  = float[4](${R_HAZE.map((v) => v.toFixed(3)).join(', ')});
const float R_ALB[4]   = float[4](${R_ALB.map((v) => v.toFixed(3)).join(', ')});
const float R_NDL[4]   = float[4](${R_NDL.map((v) => v.toFixed(3)).join(', ')});
const float R_GAIN     = ${R_GAIN.toFixed(2)};


/* ── 星星 ──────────────────────────────────────────────────────
   格子邊長（視野單位）、多少格子裡有星星、星星多大（佔格子的比例）。

   STAR_JIT 跟 STAR_R 是綁在一起的：每個 fragment 只問自己那一格，
   所以一顆星如果會長到格子外面就會在邊界上被切一半。抖動 ±0.3 格、
   半徑最多 0.18 格，加起來 0.48 < 0.5，永遠不會越界。 */
const float STAR_CELL = 26.0;
const float STAR_ODDS = 0.918;
const float STAR_JIT = 0.30;
const float STAR_R = 0.18;

/* 星星的視差。天上的東西照理說應該完全不動，但完全不動的星空在側捲軸
   裡看起來像貼在鏡頭玻璃上的貼紙。0.04 是原本 Canvas2D 那版用的值，
   小到不會有人說「星星在跑」，大到眼睛知道鏡頭有在動。 */
const float STAR_PLX = 0.04;

void main() {
  /* 地平線在畫面上的位置（uv 空間）。

     它跟最遠那層山脊用同一個視差係數，而不是 1.0。第一版讓它跟著鏡頭
     一比一跑，結果玩家往上跳的時候整片天空跟太陽都跟著往下掉一大截，
     鏡頭飛高一點地平線就掉出畫面，天空剩一片沒有漸層的藍——但山脊
     還在原地。地平線是無限遠的東西，它必須跟無限遠的東西一起動。 */
  float hScreen = (HORIZON_Y - CAM_REF) + R_PLX[0] * (CAM_REF - uCam.y);
  float hUv = 1.0 - hScreen / uView.y;

  /* 假的仰角。地平線是 0，正上方是 1。整支 shader 就靠這一個數字
     決定天空的顏色、地平線那道光的高度、以及星星要不要出現。 */
  float ely = (vUv.y - hUv) / SKY_H;

  // 日月在畫面上的位置，跟量測用的距離（以畫面高度為單位，所以圓的是圓的）
  vec2 bodyUv = vec2(0.5 + uLightDir.x * SKY_X, hUv + uLightDir.y * SKY_H);
  float aspect = uRes.x / max(uRes.y, 1.0);
  float dBody = length((vUv - bodyUv) * vec2(aspect, 1.0));

  /* ── 三段色帶 ───────────────────────────────────────────────
     low 是「打光的那顆星有多低」，warm 是「這件事該算多少」。一到
     地平線，四十度以上就沒了——所以暖色是在日出日落前後一小時左右
     慢慢來的，不是在某個時刻啪一聲打開。uDay 擋著它，因為天黑之後
     同一個方向站的是月亮，而月出不會把天空染橘。 */
  float low = 1.0 - smoothstep(-0.02, 0.62, uLightDir.y);
  float warm = low * smoothstep(0.0, 0.45, uDay);

  vec3 top = mix(mix(NOON_TOP, DUSK_TOP, warm), NIGHT_TOP, 1.0 - uDay);
  vec3 hor = mix(mix(NOON_HOR, DUSK_HOR, warm), NIGHT_HOR, 1.0 - uDay);
  vec3 bot = mix(mix(NOON_BOT, DUSK_BOT, warm), NIGHT_BOT, 1.0 - uDay);

  float e = clamp(ely, -1.0, 1.0);
  vec3 air = mix(bot, hor, smoothstep(-0.30, 0.0, e));
  air = mix(air, top, smoothstep(0.0, 1.0, e));

  /* ── 燒起來的那一邊 ─────────────────────────────────────────
     兩個因子缺一不可：只看方位會畫出一根一路燒到天頂的暖色柱子，
     只看高度會畫出一圈繞著整個畫面的暖色環。

     兩邊的衰減都比第一版陡得多，理由值得寫下來：cos 和平方要到跟
     太陽成直角才降到十分之一，所以第一版把四分之一的日出亮度放進了
     「背對太陽的那半邊天」。整張圖變成一片粉紅裡有一塊比較亮的地方
     ——那是調色，不是日出。日落之所以成立，是因為被燒的那半邊天跟
     已經轉紫的那半邊天有對比。 */
  if (warm > 0.002) {
    float az = 1.0 - abs(vUv.x - bodyUv.x) * 1.6;
    float toward = smoothstep(-0.30, 1.0, az);
    float band = exp(-max(ely, 0.0) * 4.6) * smoothstep(-0.40, -0.02, ely);
    air += LOW_GLOW * warm * toward * toward * band;
  }

  /* ── 日月的光暈 ─────────────────────────────────────────────
     這一段跟圓盤本身分開：光暈算「空氣」，遠山會透過霧吃到它；
     圓盤不算，因為山擋在太陽前面時你看到的是山，不是太陽。

     夜裡光暈必須收緊，否則同樣的寬度攤在暗一百倍的天空上會把月亮
     整個吞掉，留下一團看不出邊界的白霧。 */
  air += uTint * mix(0.030, 0.14, uDay)
       * exp(-dBody * mix(70.0, 16.0, uDay));

  vec3 col = air;

  /* ── 圓盤 ───────────────────────────────────────────────────
     不需要知道自己是太陽還是月亮：uTint 已經同時帶著那顆星的顏色跟
     強度，所以同樣兩行畫得出正午的白太陽、黃昏的紅太陽、跟夜裡的
     小月亮。乘 4.0 是為了讓正午的盤面在 tonemap 之後確實 clip 到白。*/
  float discR = 0.021;
  float aa = 1.0 / max(uRes.y, 1.0) * 1.5;
  col += uTint * 4.0 * smoothstep(discR + aa, discR - aa, dBody);

  /* ── 星星 ───────────────────────────────────────────────────
     不是一個 JS 陣列，是把螢幕空間切成格子再雜湊格子索引。差別在於
     這個星空是無限大的：鏡頭跑到 world x = 90000 也還是有星星，而且
     是同一批星星——回頭跑會看到剛才那幾顆。陣列版做不到，除非陣列
     跟世界一樣長。 */
  float night = 1.0 - smoothstep(0.0, 0.62, uDay);
  if (night > 0.002 && ely > -0.05) {
    // 星空的座標系：視差 STAR_PLX，所以它幾乎不動，但不是完全不動
    vec2 sp = vec2(vUv.x * uView.x, (1.0 - vUv.y) * uView.y) + uCam * STAR_PLX;
    sp /= STAR_CELL;
    vec2 ci = floor(sp);
    int ix = int(ci.x) ^ uSeed;              // seed 揉進格子索引，
    int iy = int(ci.y);                      // 換一個房間就換一片星空
    int k = uSeed & 0xff;
    float pick = rnd(ix, iy, k + 1);
    if (pick > STAR_ODDS) {
      vec2 jit = vec2(rnd(ix, iy, k + 2), rnd(ix, iy, k + 3)) - 0.5;
      float mag = rnd(ix, iy, k + 4);
      vec2 d = sp - ci - 0.5 - jit * (STAR_JIT * 2.0);
      float r = STAR_R * (0.35 + 0.65 * mag);
      float s = max(0.0, 1.0 - length(d) / r);
      /* 三次方而不是線性：星星要有一個小小的核心加上幾乎看不見的
         暈，線性衰減會給出一顆有硬邊的圓餅。 */
      s = s * s * s * (0.25 + 0.75 * mag);
      // 閃爍。振幅刻意小——大振幅的閃爍會讓整片天看起來在放電。
      s *= 1.0 + 0.35 * sin(uTime * 2.2 + mag * 6.283);
      // 貼近地平線的星星要淡掉：那裡空氣最厚，而且山馬上就要擋住了
      col += vec3(0.86, 0.90, 1.0) * s * night * 1.5
           * smoothstep(-0.05, 0.28, ely);
    }
  }

  /* ── 四層山脊 ───────────────────────────────────────────────
     由遠而近疊上去，近的直接蓋掉遠的——山是不透明的。

     視差的代數：一個在自己那層座標系裡固定在 (X, Y) 的點，會出現在
     螢幕的 (X - p·cam.x, Y - p·cam.y)。p = 1 就退化成一般的世界座標。
     反過來就是下面兩行。 */
  float pxv = uView.y / max(uRes.y, 1.0);  // 一個裝置像素等於幾個視野單位

  /* 霧要跟著「空氣本身有多亮」走。霧是空氣散射進來的光：白天空氣亮，
     遠山被它洗掉；夜裡沒有那道光可以散射，遠山只會變暗、變沒對比。

     第一版把 R_HAZE 當成固定值，於是夜裡遠山被洗成幾乎全黑、近山反而
     是整個畫面最亮的東西——空氣透視整個反過來。讀 hor 而不是這個像素
     的 air，是因為霧的量是一整片天空的性質，不是某個像素的。 */
  float hazeGain = smoothstep(0.002, 0.09, dot(hor, vec3(0.30, 0.59, 0.11)));

  for (int i = 0; i < 4; i++) {
    float p = R_PLX[i];
    float X = vUv.x * uView.x + p * uCam.x;
    float Y = (1.0 - vUv.y) * uView.y + p * uCam.y;

    /* 基準線。以 CAM_REF 為錨，讓四層在典型鏡頭高度時都貼在地平線上；
       離開那個高度，近的層跟著鏡頭上下移動得比遠的層多。 */
    float base = (HORIZON_Y - CAM_REF) + R_OFF[i] + p * CAM_REF;
    vec2 f = ridgeField(X, R_SCALE[i], uPhase[i]);
    float surf = base + R_AMP[i] * f.x;

    /* 最近那一層不准把山谷谷底留在畫面裡。直式手機的視野高達 1300 多
       個世界單位，山谷底部只到 850——中間那段會露出天空，看起來像
       山浮在半空中。把它壓到畫面底緣以下，讀起來就是「近山跑出畫面」，
       那本來就是它該有的樣子。 */
    if (i == 3) surf = min(surf, uView.y * 0.99 + p * uCam.y);

    float cover = smoothstep(-pxv, pxv, Y - surf);
    if (cover <= 0.0) continue;

    /* 一層山＝一個顏色。這裡曾經逐像素算法線（切線 (1, dY/dX) 的垂線），
       讓夕陽挑山脊的一邊打亮、另一邊留在暗處——但那道亮暗是連續變化的，
       整片山看起來就是一團漸層，四層之間的分界反而被它洗掉了。
       山脈這個尺度上要讀的是「有幾層、哪層比較近」，那是層與層之間的
       色差在講的事，不是一層之內的明暗在講的。所以受光量改成每層一個常數。

       f.y（解析導數）因此用不到了。它還是被算出來，因為 ridgeField 是
       高度與斜率一起出的；編譯器會把死掉的那一半消掉。 */
    float facing = R_NDL[i];

    /* 遊戲裡每個東西的顏色都走這一行：
       albedo × (tint × facing × 2.4 + ambient × 1.5)。
       跟 daycycle.js 的 shade() 逐項相同，所以山脊跟平台是被同一盞燈
       照的——這是兩層 canvas 看起來像同一個場景的全部原因。 */
    vec3 alb = uRidgeTint * R_ALB[i];

    /* uAmbient 是「一個朝上的平面收到的天光」。一道遠山的斜坡不是那樣：
       它只看得到半邊天，而且自己的地形會互相遮蔽。白天這件事被地面
       彼此反射的太陽光補回來大半，夜裡沒有那道反射可以補——所以天光
       這一項在夜裡要打折，白天不用。

       沒有這一折，夜裡最近那層山會比它背後的天空還亮，整個下半畫面
       變成一片發光的navy，山看起來像光源而不是地面。 */
    float skyBounce = mix(0.42, 1.0, uDay);
    vec3 lit = alb * (uTint * facing * 2.4 + uAmbient * 1.5 * skyBounce) * R_GAIN;

    /* 往「空氣」靠過去，而不是往某個固定的灰色，所以黃昏時遠山會自己
       吃到天空的顏色，不需要第二套顏色來對齊。

       但要靠過去的是「這一層山所在的高度上的空氣」，不是「這個像素的空氣」。
       讀逐像素的 air 等於把天空的上下漸層印在山身上，一層山又變回一團漸層；
       改讀單一個 hor 又太粗——四層山跨了地平線上下一大段，全部拉向同一個
       地平線色會把它們洗成同一片藍，四層的色差（也就是深度）就沒了。

       所以在這一層的基準線上取一次天空色：一層一個值，山身上是平的，
       而層與層之間仍然差著它們各自站的那段空氣。 */
    float vyBase = 1.0 - (base - p * uCam.y) / uView.y;
    float eBase = clamp((vyBase - hUv) / SKY_H, -1.0, 1.0);
    vec3 hazeTo = mix(bot, hor, smoothstep(-0.30, 0.0, eBase));
    hazeTo = mix(hazeTo, top, smoothstep(0.0, 1.0, eBase));
    lit = mix(lit, hazeTo, R_HAZE[i] * hazeGain);
    col = mix(col, lit, cover);
  }

  /* Dither 在 tonemap 之後、量化之前，這是唯一有意義的位置：色帶是
     量化造成的，在量化前才擋得住。 */
  outColor = vec4(acesFilm(col) + bayer4(gl_FragCoord.xy) / 255.0, 1.0);
}
`;

const VERT_PRECIP = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uCam, uView;
uniform float uTime, uWind;
uniform float uSnowy;   // 0 畫雨，1 畫雪。下面每個數字都讀它做 mix
uniform int uSeed;

out float vSide;   // -1..1 橫過雨滴
out float vAlong;  //  0..1 沿著雨滴的長度
out float vFade;

${GLSL_HASH}

/* gfx/field.js 的慢風。雪片讀它，雨滴不讀——一顆雨滴在空中待一秒，
   陣風來不及對它做什麼；一片雪花飄半分鐘，陣風就是它的全部行程。 */
float slowGust(float x, float t) { return sin(x * 0.0106 - t * 1.10); }

void main() {
  int id = gl_VertexID / 6;
  int corner = gl_VertexID % 6;
  float along = (corner == 1 || corner == 3 || corner == 4) ? 1.0 : 0.0;
  float side  = (corner == 2 || corner == 4 || corner == 5) ? 1.0 : -1.0;

  int k = uSeed & 0xff;
  float h0 = rnd(id, 17, k + 11);
  float h1 = rnd(id, 29, k + 12);
  float h2 = rnd(id, 41, k + 13);
  float h3 = rnd(id, 53, k + 14);

  /* 深度：近的雨滴大、快、亮。沒有這個變化整片雨會像一張貼在鏡頭前
     的網子，因為所有東西以完全相同的速度移動就是一張網子。 */
  float depth = 0.45 + h2 * 0.95;

  /* 這個框跟著鏡頭走，比視野大 1.5 倍——所以 wrap 的接縫永遠在畫面外，
     沒有人會看到雨滴憑空出現。框裡的雨滴用世界座標移動，鏡頭橫移時
     它們留在原地，這才是雨落在世界裡而不是落在鏡頭上。 */
  vec2 box = uView * 1.5;
  vec2 origin = uCam + uView * 0.5 - box * 0.5;

  /* 雨比雪快一個數量級，而這個比例本身就是「還沒看清形狀之前就知道
     哪個是雨哪個是雪」的全部理由。 */
  float fall = mix(1500.0, 110.0, uSnowy) * depth * (0.78 + h3 * 0.44);
  float drift = uWind * mix(420.0, 130.0, uSnowy) * (0.6 + h3 * 0.8);

  vec2 p = origin + vec2(h0, h1) * box;
  p.y += uTime * fall;
  p.x += uTime * drift;

  if (uSnowy > 0.5) {
    /* 雪花自己的游移，雨滴不給。會左右抖的雨滴看起來像 bug，
       直直落下的雪花看起來像灰燼。 */
    float w = 0.35 + 0.65 * uWind;
    p.x += sin(uTime * (0.55 + h2 * 0.9) + h1 * 6.283) * 26.0 * w;
    p.y += cos(uTime * (0.50 + h1 * 0.9) + h0 * 6.283) * 9.0 * w;
    // 加上整片場景都在吹的那陣風，squall 才會同時掃過雪和草
    p.x += slowGust(p.x, uTime) * uWind * 34.0;
  }

  p = origin + mod(p - origin, box);

  vec2 r = p - uCam;  // 視野單位，y 往下

  /* 沿著自己的速度方向拉長——那就是雨的照片長什麼樣子，也是為什麼
     這種速度下的雨看得見。雪用同樣的構造，只是把拉長關掉，
     四邊形變成接近正方形讓 fragment 把它磨成圓的。

     長度刻意短於雨滴一幀真正走過的距離：畫成真實長度會讀成鏡頭上的
     刮痕而不是雨——眼睛要的是很多道短痕，不是幾道長痕。 */
  vec2 v = normalize(vec2(drift, fall));
  vec2 across = vec2(-v.y, v.x);
  /* 四邊形的總長是 len、總寬是 2 × wide。雪的那組刻意是 8 對 2×4，
     也就是正方形——第一版寫成 5 對 2×5，雪片全部是躺著的橢圓。 */
  float len = mix(20.0, 8.0, uSnowy) * depth;
  float wide = mix(1.1, 4.0, uSnowy) * depth;
  r += v * (along - 0.5) * len + across * side * wide;

  vec2 ee = abs(p - (uCam + uView * 0.5)) / (box * 0.5);
  vFade = (1.0 - smoothstep(0.62, 1.0, max(ee.x, ee.y))) * (0.45 + depth * 0.5);
  vSide = side;
  vAlong = along;

  gl_Position = vec4(r.x / uView.x * 2.0 - 1.0, 1.0 - r.y / uView.y * 2.0, 0.0, 1.0);
}
`;

const FRAG_PRECIP = /* glsl */ `#version 300 es
precision highp float;

in float vSide;
in float vAlong;
in float vFade;
out vec4 outColor;

uniform float uSnowy;
uniform float uIntensity;
uniform vec3 uTint, uAmbient;

${GLSL_COLOR}

void main() {
  if (vFade <= 0.002) discard;

  float across = 1.0 - abs(vSide);
  float down = vAlong * 2.0 - 1.0;

  // 一道痕：中間亮，兩端收掉
  float streak = pow(across, 1.7) * (1.0 - abs(down) * 0.30);
  // 一片雪：圓的、軟的、邊緣暗，所以它沒有邊
  float flake = pow(max(0.0, 1.0 - length(vec2(vSide, down))), 1.5);
  float shape = mix(streak, flake, uSnowy);

  /* 雨是它反射的東西的顏色，而在這裡它反射的是天空。所以它自己被
     這一刻的光照著：正午的雨是亮的白藍，午夜的雨只剩一點點微光。
     沒有這一項，夜裡的雨會是整個畫面最亮的東西。 */
  vec3 base = mix(vec3(0.62, 0.72, 0.92), vec3(1.0), uSnowy);
  vec3 lit = base * (uTint * 0.9 + uAmbient * 2.0 + 0.06);

  /* 加法混色疊在已經 tonemap 過的畫面上，所以這裡自己先過一次曲線
     ——這樣「一顆雨滴的亮度」跟天空是同一個尺度上的數字。 */
  outColor = vec4(acesFilm(lit) * shape * vFade * uIntensity, 1.0);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('background: shader compile failed\n' + log);
  }
  return sh;
}

function link(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error('background: program link failed\n' + log);
  }
  // uniform 位置在連結時全部抓完。每幀去問 getUniformLocation 是字串
  // 比對加一次 driver 呼叫，而這一層每幀要設三十幾個 uniform。
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export class Background {
  /**
   * @param {HTMLCanvasElement} canvas 疊在遊戲 Canvas2D 底下的那一張
   * @throws 沒有 WebGL2 就丟——呼叫端接住之後退回純 Canvas2D。
   */
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,             // 這是最底下那層，沒有東西在它後面
      antialias: false,         // 全螢幕三角形沒有幾何邊緣可以 MSAA
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('background: WebGL2 unavailable');

    this.canvas = canvas;
    this.gl = gl;
    this._lost = false;
    this._w = 0; this._h = 0; this._dpr = 0;
    this._seed = -1;
    this._phase = new Float32Array(16);
    this._disposed = false;

    this._onLost = (e) => { e.preventDefault(); this._lost = true; };
    this._onRestored = () => {
      if (this._disposed) return;
      try { this._build(); this._lost = false; this._w = 0; } catch { this._lost = true; }
    };
    canvas.addEventListener('webglcontextlost', this._onLost, false);
    canvas.addEventListener('webglcontextrestored', this._onRestored, false);

    this._build();
  }

  _build() {
    const gl = this.gl;
    this.sky = link(gl, VERT_FULLSCREEN, FRAG_SKY);
    this.precip = link(gl, VERT_PRECIP, FRAG_PRECIP);
    // WebGL2 一定要綁一個 VAO 才能 draw，即使一個 attribute 都不用
    this.vao = gl.createVertexArray();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  /** CSS 尺寸 + DPR。每幀呼叫也不痛：沒變就直接回。 */
  resize(cssW, cssH, dpr) {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (w === this._w && h === this._h && dpr === this._dpr) return;
    this._w = w; this._h = h; this._dpr = dpr;
    this.canvas.width = w;
    this.canvas.height = h;
    if (!this._lost) this.gl.viewport(0, 0, w, h);
  }

  /**
   * 一幀一組 draw call。
   * @param {{cam:{x:number,y:number}, view:{w:number,h:number}, sky:object,
   *          seed:number, time:number, ridgeTint?:number[],
   *          weather?:{rain?:number, snow?:number, wind?:number}}} f
   */
  draw(f) {
    if (this._lost || this._disposed || !this._w) return;
    const gl = this.gl;
    const { cam, view, sky, seed, time } = f;
    const weather = f.weather || {};
    const rain = weather.rain || 0;
    const snow = weather.snow || 0;
    const wind = weather.wind || 0;

    /* seed 換了才重算山脊的相位。四個波各給一個獨立的偏移——只給整層
       一個共同偏移的話那只是平移，天際線的形狀不會變，換房間看起來
       會像同一座山往旁邊挪了一點。 */
    const s = seed >>> 0;
    if (s !== this._seed) {
      this._seed = s;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) this._phase[i * 4 + j] = cell(s ^ (i * 7919), j, 0x51 + i) * 6.283185;
      }
    }

    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    const { p, u } = this.sky;
    gl.useProgram(p);
    gl.uniform2f(u.uRes, this._w, this._h);
    gl.uniform2f(u.uCam, cam.x, cam.y);
    gl.uniform2f(u.uView, view.w, view.h);
    gl.uniform3f(u.uLightDir, sky.dir[0], sky.dir[1], sky.dir[2]);
    gl.uniform3f(u.uTint, sky.tint[0], sky.tint[1], sky.tint[2]);
    gl.uniform3f(u.uAmbient, sky.ambient[0], sky.ambient[1], sky.ambient[2]);
    gl.uniform1f(u.uDay, sky.day);
    gl.uniform1f(u.uTime, time);
    gl.uniform1i(u.uSeed, s | 0);
    const rt = f.ridgeTint || R_TINT;
    gl.uniform3f(u.uRidgeTint, rt[0], rt[1], rt[2]);
    gl.uniform4fv(u.uPhase, this._phase);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 沒下的時候一個 draw call 都不花，而不是花一個畫零個粒子
    const amount = Math.max(rain, snow);
    if (amount > 0.002) {
      const snowy = snow > rain;
      const drops = Math.round((snowy ? SNOW_FLAKES : RAIN_DROPS) * Math.min(1, amount));
      if (drops > 0) {
        const q = this.precip;
        gl.useProgram(q.p);
        gl.uniform2f(q.u.uCam, cam.x, cam.y);
        gl.uniform2f(q.u.uView, view.w, view.h);
        gl.uniform1f(q.u.uTime, time);
        gl.uniform1f(q.u.uWind, wind);
        gl.uniform1f(q.u.uSnowy, snowy ? 1 : 0);
        gl.uniform1i(q.u.uSeed, s | 0);
        gl.uniform3f(q.u.uTint, sky.tint[0], sky.tint[1], sky.tint[2]);
        gl.uniform3f(q.u.uAmbient, sky.ambient[0], sky.ambient[1], sky.ambient[2]);
        /* 雨每一滴比較暗但數量多，雪反過來。這是對著加法混色調的：
           重要的是一個像素上的總和，不是任何一滴的值。 */
        gl.uniform1f(q.u.uIntensity, (snowy ? 0.80 : 0.38) * Math.min(1, amount));
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.TRIANGLES, 0, drops * 6);
        gl.disable(gl.BLEND);
      }
    }

    gl.bindVertexArray(null);
  }

  /** 放掉 GL 資源。之後再呼叫 draw() 是安全的 no-op。 */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this._onLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
    const gl = this.gl;
    if (!this._lost) {
      if (this.sky) gl.deleteProgram(this.sky.p);
      if (this.precip) gl.deleteProgram(this.precip.p);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.sky = this.precip = this.vao = null;
  }

  /** context 掉過就是 true，呼叫端看到之後退回 Canvas2D。 */
  get lost() { return this._lost; }
}
