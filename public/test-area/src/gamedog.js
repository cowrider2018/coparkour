/* ── test-area/src/gamedog.js ────────────────────────────────────────
   遊戲那隻狗，本人，跑在 three.js 裡。

   這一頁一開始是自己捏了一隻造型接近的狗；換掉了。現在載入的是遊戲的
   `public/assets/cat.bin`，經過遊戲自己的 `buildDog`（立耳）、`dress`
   （漁夫帽）與 `yellow` 毛色——22,405 個頂點、23 根骨頭的剛體階層、
   `pose.js` 的對角步與彈簧尾巴，一個位元組都沒有重畫。

   ── 搬過來的是什麼、沒搬的是什麼 ─────────────────────────────────
   搬的是「這隻動物是什麼」：

     幾何   `rig.js` 的 parseCat 讀檔，`dog.js` 的 buildDog 把貓改成狗
            （吻、鼻、寬耳、短尾、去鬍鬚），`wear.js` 的 dress 加上帽子。
            三個顏色群組（lit／unlit／outline）的頂點範圍原封不動搬進
            一個 BufferGeometry，一個群組一個 draw range。
     骨架   `rig.js` 的 Rig，每幀 rig.update() 算出 23+ 根骨頭的世界矩陣，
            整批當成 mat4 陣列丟給著色器。沒有蒙皮權重——每個頂點屬於
            一根骨頭，骨號存在顏色的 alpha 位元組裡（低五位）。
     動作   `pose.js` 的 Driver（步態、呼吸、尾巴的擺）與 Sway（尾巴那條
            17 節的彈簧）。步頻跟著實際速度走，跟遊戲一樣。
     配色   cat.bin 自己的頂點色，三種毛色共用同一份幾何。
     圓角   `shape.js` 的部位表、它量出來的矩形，以及整個二次變形。
            這一段是每幀在頂點著色器裡做的，見下面「圓角方形」那一段。

   沒搬的是「那個渲染器是什麼」，而那是刻意的：

     · 正交側視相機本身。變形跟過來了，那台相機沒有——這一頁的二維平面
       是透視投影之後的螢幕座標。
     · 尾巴尖的方頭（TAIL_CAP_GLSL）。rrRadius 這裡已經有了（變形要用），
       所以它是可以補上的；沒補是因為它只影響尾巴末端那兩三個像素，而
       尾巴本身不是一個「部位」——shape.js 說得很清楚，一根管子不需要
       矩形。
     · gl.depthRange 分段遮擋，與遠側那隻眼睛的收合。兩個都是為了「一排
       貓在 2D 畫面上疊起來」：這裡只有一隻，而且有真的深度緩衝；而正面
       看得到兩隻眼睛的時候，收掉一隻會變成獨眼。
     · 三階調著色器本身。改用 three 的 MeshToonMaterial 加同一張 3 階
       梯度圖（palette.js 的 ramp），所以狗和石頭是被同一盞燈、同一組
       色階照的——那才是「同一個作品」的意思。

   ── 圓角方形：每幀的二次變形 ─────────────────────────────────────
   那個造型是這隻動物的招牌，所以它整個跟過來了：`shape.js` 的
   `measureShapes` 量出每個部位的中心、三個半徑、圓角比例與 norm，
   那一組數字就是遊戲那支著色器吃的 uniform，一個都沒有換；而變形本身
   （SHAPE_GLSL 的 `warpToRect`）也照搬，包含它那兩段：

     第一段  把部位的包圍橢圓映射到圓角矩形。落在橢圓上的落在矩形上，
             裡面的按同比例跟著走。
     第二段  只作用在「法線側視 + 已經靠外」的頂點上，把輪廓精確拉到
             矩形邊上。兩個條件都要：只看法線會抓到部位中間的一道摺並
             把它拖到邊上，只看半徑就是第一段留下的坑坑巴巴。

   換掉的只有「那個二維平面是什麼」：遊戲是正交側視的螢幕像素，這裡是
   透視投影之後、以 y 正規化的螢幕座標（ndc.x × aspect, ndc.y）。那個
   空間是等向的，所以圓角矩形在畫面上是圓角矩形而不是被拉扁的。深度不
   動，跟遊戲一樣——這一段只搬動頂點落在畫面上的哪裡。

   ── 為什麼不是在載入時烘進幾何 ───────────────────────────────────
   試過，而且留在 `test-area-roundbox-bake` 那個 branch 上：把每個部位
   在骨頭的局部空間映射到一個 3D 圓角盒，一次算完、每幀零成本、繞著看
   不會變形。但畫出來跟這個造型有明顯落差，原因是幾何上的：

     · 3D 圓角盒的輪廓只有從三個軸的方向看才是圓角矩形。從斜的方向看，
       三個軸的圓角一起出現在輪廓上，讀起來是一團圓的東西——而遊戲相機
       在這一頁永遠是斜的。
     · 那一段「法線側視才拉到底」的第二段是視角相關的，烘的時候沒有視角
       可用，所以只能整體按比例推，內部曲面也一起被壓掉。
     · 烘完的形狀是固定的，於是「輪廓精確是矩形」這件事在任何角度都
       不成立，只是「接近」。

   代價是這一版每幀每頂點多算一個部位框（三次矩陣乘法、幾十個乘加）與
   一次圓角矩形求交。25,723 個頂點、兩趟（皮毛與墨線），在任何 2015 年
   之後的 GPU 上都量不出來。

   ── 為什麼不是照抄那支著色器 ─────────────────────────────────────
   照抄要連正交投影、uPlace/uXform 的像素座標系、彎折與 depthRange 一起
   抄，而那四件事在這個場景裡全部要拆掉。剩下的（骨頭、彈簧、三階調）
   本來就是 3D 的，所以這裡的做法是把那三件事接到 three 的材質上：
   `onBeforeCompile` 把骨頭與彈簧插進 three 自己的頂點著色器，其餘的
   （光、霧、色彩管理、輪廓）交給 three。插進去的那段 GLSL 是唯一新寫的
   東西，而它讀的常數（TAIL_AXIS）是直接從 pose.js import 進來的，不是
   複製的——那張表在兩個地方各有一份就是它們遲早不一致的原因。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { parseCat, Rig } from '../../src/cat/rig.js';
import { buildDog } from '../../src/cat/dog.js';
import { dress } from '../../src/cat/wear.js';
import { Driver, Sway, applyPose, TAIL_AXIS, TAIL_LIFT } from '../../src/cat/pose.js';
import { DOG_SKINS } from '../../src/cat/looks.js';
import { measureShapes, SIL_NORMAL, SIL_RADIUS } from '../../src/cat/shape.js';
import { ramp, INK } from './palette.js';

/** 毛色。名字給選單用，值就是 cat.bin 裡的那幾套（src/cat/dog.js）。 */
export const COATS = {
  yellow: { name: '黃' },
  grey: { name: '灰' },
  cow: { name: '牛' },
};

/* 顏色 alpha 位元組的編碼，跟 src/cat/cat.js 一樣：低五位是骨號，
   高三位是彈簧群組。 */
const SWAY_NONE = 0, SWAY_TAIL = 1;
const NODES = TAIL_AXIS.length;          // 17

/* 墨線外殼往外推多少（模型單位）。cat.bin 自己烘了 build.js 的 SHELL
   （0.05），這是加上去的那一點——遊戲那邊是用像素算的（INK_PX 1.25 px
   除以每單位幾像素），這裡是透視相機，沒有「每單位幾像素」這個數字，
   所以直接給一個模型單位的值。0.022 × 這隻狗的縮放 ≈ 5 mm。 */
const INK_GROW = 0.022;

/* 墨線在畫面上有多寬（像素）。遊戲是 INK_PX = 1.25 px，理由是那邊的貓
   只有 45 px 高；這一頁的狗離鏡頭近的時候有兩三百 px，所以粗一點才看得
   出是一條線而不是一圈鋸齒。

   單位是像素而不是世界長度，這一點跟遊戲一樣，而且在 3D 裡也是對的：
   卡通描邊的寬度是「畫面上的一條線」，不是「模型上的一層皮」——遠處的
   狗如果連線都跟著縮小，那個造型在遠處就消失了。 */
const INK_PX = 2.0;

/* 一個步幅跨多遠（公尺）。遊戲那邊是 2.67 個碰撞箱高，換算到這一頁的
   尺度會得到一隻慢動作的狗：遊戲裡的狗每秒跑 9.6 個身高，這裡只有 3 個
   （場景是照建築的尺度做的，不是照跑酷的速度）。所以步幅照這個世界重新
   給：0.6 公尺高的狗小跑一步約 1.15 公尺，這也是真狗的數字。 */
const STRIDE_LEN = 1.15;
const STRIDE_HZ_MIN = 1.0, STRIDE_HZ_MAX = 5.5;
/** 低於這個速度就是站著（src/cat/cat.js 的 IDLE_SPEED 同一個意思）。 */
const IDLE_SPEED = 0.2;
/** 彈簧的次步長上限，跟 cat.js 的 MAX_SUB_DT 一樣。 */
const MAX_SUB_DT = 0.005;

/* ── 插進 three 頂點著色器的那一段 ───────────────────────────────
   剛體骨架 + 尾巴的彈簧。兩件事都是純 3D 的，所以照搬得動：
   swayPoint／swayNormal／tailNodes 的算法與 src/cat/cat.js 的 VERT
   一字不差，只有「投影」那一段沒有跟過來（three 自己會做）。

   一個環是被「搬」的而不是被「甩」的：先繞著它在尾巴中心線上的那一點
   轉，再放到那一點移動後的地方去。兩個節點都算一次再內插，所以每個頂點
   的支點都在自己旁邊。 */
const axisGLSL = () => TAIL_AXIS
  .map((a) => `vec3(${a.map((v) => v.toFixed(4)).join(', ')})`)
  .join(',\n  ');

const DECL = (boneN, partN) => `
uniform mat4 uBones[${boneN}];
uniform vec4 uSwayQ[${NODES}];
uniform vec3 uSwayBend[${NODES}];
uniform float uGrow;
attribute float aBone;
attribute float aSway;
attribute float aOuter;

const vec3 CP_TAIL_AXIS[${NODES}] = vec3[${NODES}](
  ${axisGLSL()}
);

vec3 cpQRot(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
void cpNodes(float o, out int lo, out int hi, out float t) {
  float x = clamp(o, 0.0, 1.0) * float(${NODES - 1});
  float i = floor(x);
  lo = int(i);
  hi = min(lo + 1, ${NODES - 1});
  t = x - i;
}
vec3 cpSwayPoint(vec3 p, float o) {
  int lo, hi; float t;
  cpNodes(o, lo, hi, t);
  vec3 a = cpQRot(uSwayQ[lo], p - CP_TAIL_AXIS[lo]) + CP_TAIL_AXIS[lo] + uSwayBend[lo];
  vec3 b = cpQRot(uSwayQ[hi], p - CP_TAIL_AXIS[hi]) + CP_TAIL_AXIS[hi] + uSwayBend[hi];
  return mix(a, b, t);
}
vec3 cpSwayNormal(vec3 n, float o) {
  int lo, hi; float t;
  cpNodes(o, lo, hi, t);
  return normalize(mix(cpQRot(uSwayQ[lo], n), cpQRot(uSwayQ[hi], n), t));
}

/* 位置與法線各自一支，而且各自把「擺 → 骨頭」整套算完。

   會這樣切，是因為 three 的 basic 著色器把 <beginnormal_vertex> 包在
   一個 #if 裡面（只有 envmap 或 skinning 才展開），而 toon 是無條件
   展開的。如果讓位置去讀法線那一段算好的變數，那麼同一段插入碼在 toon
   上編得過、在 basic 上會找不到變數——而 basic 正是臉和墨線用的那顆。
   各自算一遍的代價是十七節的內插做兩次，幾十個乘加，不值得為它冒那個險。 */
vec3 cpSkinPos() {
  vec3 p = position;
  vec3 n = normal;
  if (aSway > 0.5) {                       // 只有尾巴會擺（狗沒有鬍鬚）
    p = cpSwayPoint(p, aOuter);
    n = cpSwayNormal(n, aOuter);
  }
  p += n * uGrow;                          // 墨線外殼沿法線長出去
  return (uBones[int(aBone + 0.5)] * vec4(p, 1.0)).xyz;
}
vec3 cpSkinNrm() {
  vec3 n = normal;
  if (aSway > 0.5) n = cpSwayNormal(n, aOuter);
  return normalize(mat3(uBones[int(aBone + 0.5)]) * n);
}

/* ── 二次變形：把每個部位的輪廓壓成圓角矩形 ──────────────────────
   這一段是 src/cat/shape.js 的 SHAPE_GLSL，搬到透視相機上。搬過來的是
   整個構造，包含那兩段：

     第一段  把部位的包圍橢圓映射到圓角矩形。落在橢圓上的落在矩形上，
             裡面的按同比例跟著走。
     第二段  只作用在「法線側視 + 已經靠外」的頂點上，把輪廓精確拉到
             矩形邊上。兩個條件都要：只看法線會抓到部位中間的一道摺並
             把它拖到邊上，只看半徑就是第一段留下的那個坑坑巴巴。

   換掉的只有「那個二維平面是什麼」：遊戲是正交側視的螢幕像素，這裡是
   透視投影後、以 y 正規化的螢幕座標（ndc.x × aspect, ndc.y）。那個空間
   是等向的，所以圓角矩形在畫面上是圓角矩形而不是被拉長的。深度不動——
   跟遊戲一樣，這一段只搬動頂點落在畫面上的哪裡。

   部位的框每幀由骨頭矩陣現算：中心投影一次，三個半徑軸各投影一次，
   兩個半長是三者在框的兩個方向上的支撐、用平方和合成。平方和而不是
   相加，因為相加是「盒」的支撐，而盒在對角線上最寬——頭的 X 與 Z 半徑
   只差 3%，用相加它會在轉身途中胖 40%。

   透視的代價講清楚：一個部位的三個半徑是在「部位中心那個深度」上換算
   成畫面大小的，所以同一個部位裡比中心近的頂點會被算得略小、遠的略大。
   頭在三公尺外的深度差是 ±5%，看不出來；貼到鏡頭前面就會看出來，而那
   個距離下這頁的相機本來就不會停。 */
#define CP_PARTS ${partN}
uniform vec4 uPart[CP_PARTS];       // 中心 xyz，w = 掛在哪根骨頭
uniform vec4 uPartB[CP_PARTS];      // 三個半徑，w = 圓角佔短邊的比例
uniform float uPartNorm[CP_PARTS];  // 真實輪廓比橢圓多伸出去多少
uniform int uBonePart[${boneN}];    // 每根骨頭：被哪個部位彎，−1 = 不彎
uniform int uBoneRide[${boneN}];    // 1 = 被那個部位帶著走，不被它彎
uniform float uInkOut;              // 這一趟要落在矩形外多遠（螢幕單位）
uniform float uBend;                // 0/1，B 鍵

/** 圓角矩形的中心到邊界有多遠，沿單位方向。精確解，不是近似：矩形是
    半徑 (h − r) 的盒被半徑 r 的圓掃過，射線要嘛從平邊出去（答案就是 h
    除以方向自己的分量），要嘛從圓角出去（一個二次式）。 */
float cpRR(vec2 d, vec2 h, float r) {
  vec2 a = abs(d);
  vec2 e = max(h - r, vec2(0.0));
  if (h.x * a.y <= e.y * a.x) return h.x / max(a.x, 1e-6);
  if (h.y * a.x <= e.x * a.y) return h.y / max(a.y, 1e-6);
  float K = a.x * e.x + a.y * e.y;
  return K + sqrt(max(0.0, K * K - (dot(e, e) - r * r)));
}

float cpAspect() {
  return projectionMatrix[1][1] / max(projectionMatrix[0][0], 1e-6);
}
/** 一個視空間的方向，換成「在中心那個深度上」的畫面長度。 */
vec2 cpProjDir(vec3 dirView, float wc, float asp) {
  vec4 q = projectionMatrix * vec4(dirView, 0.0);
  return vec2(q.x / wc * asp, q.y / wc);
}

/** 部位在畫面上的框：中心 c、橫向 uHat、縱向 vHat，以及兩個半長。 */
void cpPartFrame(int id, out vec2 c, out vec2 uHat, out vec2 vHat, out float lu, out float lv) {
  vec4 P = uPart[id], B = uPartB[id];
  mat4 mv = viewMatrix * modelMatrix * uBones[int(P.w + 0.5)];
  vec4 cc = projectionMatrix * (mv * vec4(P.xyz, 1.0));
  float wc = max(cc.w, 1e-4);
  float asp = cpAspect();
  c = vec2(cc.x / wc * asp, cc.y / wc);

  vec2 ex = cpProjDir(mv[0].xyz * B.x, wc, asp);
  vec2 ey = cpProjDir(mv[1].xyz * B.y, wc, asp);
  vec2 ez = cpProjDir(mv[2].xyz * B.z, wc, asp);

  /* 縱向取骨頭自己的 +Y 投影：那是部位的「上」——沿著一條腿、順著身體。
     所以沒有轉動的骨頭在整個轉身過程中框都不會歪，只有真的轉了的骨頭
     才會跟著傾。 */
  float ly = length(ey);
  vHat = ly > 1e-5 ? ey / ly : vec2(0.0, 1.0);
  uHat = vec2(vHat.y, -vHat.x);
  lu = length(vec3(dot(ex, uHat), dot(ey, uHat), dot(ez, uHat)));
  lv = length(vec3(dot(ex, vHat), dot(ey, vHat), dot(ez, vHat)));
}

/**
 * 把一個 clip space 的點放到圓角矩形要它去的地方。
 *
 * sil 是這個頂點的法線有多側對鏡頭：0 是正對，1 是正好在輪廓上。
 */
vec4 cpWarp(vec4 clip, int id, float sil) {
  vec2 c, uHat, vHat; float lu, lv;
  cpPartFrame(id, c, uHat, vHat, lu, lv);
  if (lu < 1e-5 || lv < 1e-5) return clip;

  float wv = max(clip.w, 1e-4);
  float asp = cpAspect();
  vec2 off = vec2(clip.x / wv * asp, clip.y / wv) - c;
  vec2 p = vec2(dot(off, uHat), dot(off, vHat));
  float len = length(p);
  if (len < 1e-6) return clip;

  // 這個頂點落在包圍盒隱含的那個橢圓上的哪裡。
  float t = length(vec2(p.x / lu, p.y / lv)) / max(uPartNorm[id], 1e-6);
  vec2 dir = p / len;

  float r = min(min(lu, lv) * uPartB[id].w, min(lu, lv));
  float R = cpRR(dir, vec2(lu, lv), r);

  /* 墨線是「拉到稍微大一點的矩形」而不是「把殼加厚」，這樣線的寬度到處
     都剛好是 uInkOut——連角上也是，而沿模型法線長出來的殼從來做不到
     這件事（它在角上會比在邊上寬）。 */
  float target = 1.0 + uInkOut / max(R, 1e-6);
  float w = smoothstep(${SIL_NORMAL[0].toFixed(2)}, ${SIL_NORMAL[1].toFixed(2)}, sil)
          * smoothstep(${SIL_RADIUS[0].toFixed(2)}, ${SIL_RADIUS[1].toFixed(2)}, t);
  // 拉起沒到邊的，壓下超出去的：矩形因此是邊界而不是目標。
  float tt = min(mix(t, target, w), target);
  vec2 np = dir * tt * R;
  vec2 ns = c + np.x * uHat + np.y * vHat;
  return vec4(ns.x / asp * wv, ns.y * wv, clip.z, clip.w);
}
`;

const BEGIN_NORMAL = `
  vec3 objectNormal = cpSkinNrm();
`;
const BEGIN_VERTEX = `
  vec3 transformed = cpSkinPos();
`;

/* 二次變形接在 three 算完 gl_Position 之後。這個位置是刻意的：變形要的
   是「這個頂點落在畫面上的哪裡」，那個答案在 project_vertex 之前還不
   存在，而在它之後 mvPosition 與 gl_Position 都在手上。

   `sil` 需要視空間的法線與視線。法線這裡自己算（basic 材質沒有 vNormal，
   而墨線與臉都是 basic），視線就是 mvPosition——透視相機下每個頂點的
   視線方向都不一樣，這正是遊戲那個正交版本沒有的東西。 */
const WARP = `
#include <project_vertex>
  {
    int cpB = int(aBone + 0.5);
    int cpP = uBonePart[cpB];
    if (uBend > 0.5 && cpP >= 0 && uBoneRide[cpB] == 0) {
      vec3 cpNV = normalize(normalMatrix * cpSkinNrm());
      float cpSil = 1.0 - abs(dot(cpNV, normalize(mvPosition.xyz)));
      gl_Position = cpWarp(gl_Position, cpP, cpSil);
    }
  }
`;

/**
 * 把骨架接到一顆 three 材質上。
 *
 * 材質仍然是 three 的（光、霧、色彩管理、三階調的梯度圖全部照 three 的
 * 那一套走），只有「頂點在哪裡」被換掉。
 */
function rig3(material, uniforms, opts) {
  const { boneN, partN, grow, warp } = opts;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      uGrow: { value: grow },
      uInkOut: opts.inkOut,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DECL(boneN, partN)}`)
      .replace('#include <beginnormal_vertex>', BEGIN_NORMAL)
      .replace('#include <begin_vertex>', BEGIN_VERTEX);
    /* 臉不做二次變形——眼睛、鼻子、嘴巴被拉出去就是一張糊掉的臉，這是
       shape.js 的結論（「把整張臉留在網格放它的地方，是唯一一種臉還是
       臉的版本」）。所以臉那顆材質根本不插這一段。 */
    if (warp) {
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', WARP);
    }
  };
  /* 不同 grow、有沒有變形的材質要各自編譯一份，不然 three 會共用同一支
     編好的程式，而它們的頂點著色器其實不一樣。 */
  material.customProgramCacheKey = () => `cpdog${boneN}:${partN}:${grow}:${warp ? 1 : 0}`;
  return material;
}

/**
 * 載入那隻狗。
 *
 * @param {object} opts
 *   buffer  cat.bin 的 ArrayBuffer。給了就不 fetch（離線驗證用）。
 *   url     去哪裡拿 cat.bin，預設 /assets/cat.bin
 *   ear     'prick'（立耳，預設）或 'drop'
 *   skin    毛色，預設 'yellow'
 *   height  這隻狗在這個世界裡多高（公尺，含帽子），預設 1.0
 */
export async function loadGameDog(opts = {}) {
  const buffer = opts.buffer
    || await fetch(opts.url || '/assets/cat.bin').then((r) => {
      if (!r.ok) throw new Error(`cat.bin: ${r.status}`);
      return r.arrayBuffer();
    });
  const cat = parseCat(buffer);
  const data = dress(buildDog(cat, { ear: opts.ear || 'prick' }), { wears: ['bucket'] });
  return new GameDog(data, opts);
}

export class GameDog {
  constructor(data, opts = {}) {
    this.data = data;
    this.model = data.model;
    this.skins = DOG_SKINS.filter((s) => data.colors.has(s));
    this.coatId = this.skins.includes(opts.skin) ? opts.skin : this.skins[0];

    /* 骨架與動作。Driver 與 Sway 是遊戲那兩支，連內部的彈簧常數都沒動。 */
    this.rig = new Rig(data.header);
    this.drv = new Driver();
    this.sway = new Sway();
    this.sway.seed(0, 0);
    this._yaw = 0;
    this._yawGoal = 0;
    this._vySmooth = 0;
    this._hat = true;

    /* 帽子的骨頭。dress() 讓每件服裝都「穿著」到場（彎折要量得到它的
       矩形），所以沒穿的那幾件是被縮到零的——這一頁只有一件，脫帽就是
       把它縮掉。做法照 src/cat/cat.js 的 shrink/grow。 */
    const wardrobe = this.model.wear || {};
    this._hatBones = (wardrobe.bucket || []).map((n) => this.rig.bone(n));

    /* 部位的矩形。measureShapes 是 shape.js 的，回傳的就是遊戲那支
       著色器吃的那一組 uniform：每個部位的中心、三個半徑、圓角比例、
       norm，以及「每根骨頭被哪個部位彎、還是被它帶著走」兩張表。

       它內部會 reset 並 update 骨架去量，所以一定要在姿勢開始跑之前
       叫——這裡是建構子，後面 _buildMesh 會再擺一次待機姿勢。 */
    this.shape = measureShapes(data, this.rig, this.model.parts, this.model.ride, this.model.patch);
    this._bend = true;
    this._buildGeometry();
    this._buildMesh(opts);
  }

  /* ── 幾何 ─────────────────────────────────────────────────────
     一份 BufferGeometry，三個 draw range。範圍就是檔案自己的三個群組，
     順序也是檔案自己的（lit、unlit、outline，頂點範圍互不重疊）——
     那個佈局是 build.js 保證的，這裡只是照著用。 */
  _buildGeometry() {
    const d = this.data;
    const nv = d.header.vertexCount;
    const g = new THREE.BufferGeometry();

    g.setAttribute('position', new THREE.Float32BufferAttribute(d.position.slice(), 3));

    // 法線是 snorm16 ×4：xyz 是法線，w 是 outerness（尾巴上的位置）。
    const nrm = new Float32Array(nv * 3);
    const outer = new Float32Array(nv);
    for (let v = 0; v < nv; v++) {
      for (let k = 0; k < 3; k++) nrm[v * 3 + k] = d.normal[v * 4 + k] / 32767;
      outer[v] = d.normal[v * 4 + 3] / 32767;
    }
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aOuter', new THREE.Float32BufferAttribute(outer, 1));

    /* 骨號與彈簧群組。它們住在顏色的 alpha 位元組裡，而每個毛色的
       alpha 都一樣（src/cat/dog.js 的注解就是這麼說的），所以讀第一個
       毛色就夠。四捨五入而不是截斷：8/255 這種數字進不了 float 的整數。 */
    const anySkin = d.colors.get(this.skins[0]);
    const bone = new Float32Array(nv);
    const swayG = new Float32Array(nv);
    for (let v = 0; v < nv; v++) {
      const packed = anySkin[v * 4 + 3];
      bone[v] = packed & 31;
      swayG[v] = (packed >> 5) === SWAY_TAIL ? 1 : SWAY_NONE;
    }
    g.setAttribute('aBone', new THREE.Float32BufferAttribute(bone, 1));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(swayG, 1));

    g.setIndex(new THREE.BufferAttribute(d.index.slice(), 1));
    const G = {};
    for (const q of d.header.groups) G[q.name] = q;
    /* 材質的順序就是這裡的順序：0 = 有光的皮毛、1 = 不吃光的臉、
       2 = 翻面的墨線外殼。 */
    g.addGroup(G.lit.start, G.lit.count, 0);
    g.addGroup(G.unlit.start, G.unlit.count, 1);
    g.addGroup(G.outline.start, G.outline.count, 2);
    this.geometry = g;
    this._colorAttr = new THREE.Float32BufferAttribute(new Float32Array(nv * 3), 3);
    g.setAttribute('color', this._colorAttr);
    this.setCoat(this.coatId);
  }

  _buildMesh(opts) {
    const boneN = this.rig.count;
    const S = this.shape;
    const partN = S.parts.length;

    /* 部位表攤平成 uniform。一個部位三顆：中心＋骨號、三個半徑＋圓角、
       norm。骨頭兩張表：被哪個部位彎、是不是被帶著走。 */
    const part = new Float32Array(partN * 4);
    const partB = new Float32Array(partN * 4);
    const partNorm = new Float32Array(partN);
    S.parts.forEach((p, i) => {
      part[i * 4] = p.center[0];
      part[i * 4 + 1] = p.center[1];
      part[i * 4 + 2] = p.center[2];
      part[i * 4 + 3] = p.bone;
      partB[i * 4] = p.half[0];
      partB[i * 4 + 1] = p.half[1];
      partB[i * 4 + 2] = p.half[2];
      partB[i * 4 + 3] = p.radius;
      partNorm[i] = p.norm;
    });

    this._inkOut = { value: 0 };            // 墨線那一趟才不是 0，見 setInkPx
    this._bendU = { value: 1 };
    this._uniforms = {
      uBones: { value: this.rig.matrices },
      uSwayQ: { value: this.sway.qs },
      uSwayBend: { value: this.sway.bend },
      uPart: { value: part },
      uPartB: { value: partB },
      uPartNorm: { value: partNorm },
      uBonePart: { value: Int32Array.from(S.byBone) },
      uBoneRide: { value: Int32Array.from(S.rides) },
      uBend: this._bendU,
    };
    const zero = { value: 0 };

    /* 皮毛：three 的三階調材質，梯度圖是 palette.js 那一張——石頭用的
       同一張。狗和牆因此是同一盞燈照的，那是這一頁最要緊的一致性。 */
    const fur = rig3(new THREE.MeshToonMaterial({
      vertexColors: true, gradientMap: ramp(),
    }), this._uniforms, { boneN, partN, grow: 0, warp: true, inkOut: zero });
    /* 臉：cat.bin 的 `unlit` 群組——眼睛、鼻子、嘴。它在遊戲裡就是不吃
       光的，所以這裡是 Basic 而不是 Toon。 */
    const face = rig3(new THREE.MeshBasicMaterial({
      vertexColors: true,
      /* 臉不變形，而它周圍的臉皮會被拉出去——所以臉要贏得了深度測試，
         不然眼睛會被自己的臉頰蓋掉。遊戲是把整個 unlit 群組往鏡頭方向
         拉 FACE_LIFT；這裡有真的深度緩衝，polygonOffset 就是為這件事
         存在的工具，而且不必動到頂點。 */
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }), this._uniforms, { boneN, partN, grow: 0, warp: false, inkOut: zero });
    /* 墨線：翻面外殼。cat.bin 的 `outline` 群組佔 44% 的三角形，就是為
       這個存在的——正面剔除之後剩下背面，被身體擋住，只在輪廓外露出一圈。
       three 這邊 side: BackSide 就是「剔除正面」。 */
    const ink = rig3(new THREE.MeshBasicMaterial({
      color: INK, side: THREE.BackSide,
    }), this._uniforms, { boneN, partN, grow: INK_GROW, warp: true, inkOut: this._inkOut });

    this.mesh = new THREE.Mesh(this.geometry, [fur, face, ink]);
    // 骨頭在著色器裡才動，three 算不出正確的邊界球，所以別讓它裁掉。
    this.mesh.frustumCulled = false;

    /* 大小與腳的位置。兩個都是量出來的：先擺一次待機姿勢，量整隻的
       高度與最低點，再算縮放與要抬多少。這樣以後改服裝或改耳朵，
       這兩個數字自己會跟著變。 */
    this.rig.reset();
    applyPose(this.rig, this.drv.pose);
    this.rig.update();
    const box = this._measure();
    const height = opts.height || 1.0;
    this._scale = height / (box.max[1] - box.min[1]);
    this.mesh.scale.setScalar(this._scale);
    this.mesh.position.y = -box.min[1] * this._scale;
    this.height = height;

    this.root = new THREE.Group();
    this.root.add(this.mesh);
  }

  /** 現在這個姿勢下，整隻狗的世界座標邊界（模型單位）。 */
  _measure() {
    const d = this.data;
    const M = this.rig.matrices;
    const anySkin = d.colors.get(this.skins[0]);
    const min = [1e30, 1e30, 1e30], max = [-1e30, -1e30, -1e30];
    for (let v = 0; v < d.header.vertexCount; v++) {
      const o = (anySkin[v * 4 + 3] & 31) * 16;
      const x = d.position[v * 3], y = d.position[v * 3 + 1], z = d.position[v * 3 + 2];
      const w = [
        M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12],
        M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13],
        M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14],
      ];
      for (let k = 0; k < 3; k++) {
        if (w[k] < min[k]) min[k] = w[k];
        if (w[k] > max[k]) max[k] = w[k];
      }
    }
    return { min, max };
  }

  /* ── 外觀 ───────────────────────────────────────────────────── */

  /**
   * 換毛色。三種毛色共用同一份幾何，只換頂點色——這正是 cat.bin 的
   * 存法（幾何存一次，顏色區塊每個毛色一份）。
   *
   * 顏色在檔案裡是 sRGB 位元組，而 three 的頂點色屬性是「工作色彩空間」
   * 也就是線性的，所以這裡轉一次。不轉的話狗會比石頭亮一整階。
   */
  setCoat(id) {
    if (!this.skins.includes(id)) return;
    this.coatId = id;
    const col = this.data.colors.get(id);
    const out = this._colorAttr.array;
    const c = new THREE.Color();
    for (let v = 0; v < out.length / 3; v++) {
      c.setRGB(col[v * 4] / 255, col[v * 4 + 1] / 255, col[v * 4 + 2] / 255, THREE.SRGBColorSpace);
      out[v * 3] = c.r; out[v * 3 + 1] = c.g; out[v * 3 + 2] = c.b;
    }
    this._colorAttr.needsUpdate = true;
  }

  /**
   * 二次變形開或關。關掉就是 cat.bin 原本的曲面網格（等於遊戲
   * `CatLayer` 的 `mesh` 樣式），開著是圓角矩形的輪廓。
   *
   * 切的是一顆 uniform，所以是同一幀立即生效、沒有任何重建——這一鍵
   * 存在是為了用眼睛比對，而比對只有在同一個姿勢、同一個角度下才算。
   */
  setBend(on) {
    this._bend = !!on;
    this._bendU.value = this._bend ? 1 : 0;
  }

  get bendOn() { return this._bend; }

  /**
   * 墨線在畫面上多寬。
   *
   * 要知道視窗多高才算得出來：變形是在「y 正規化的螢幕座標」裡做的，
   * 那個空間的 y 從 −1 到 +1 橫跨整個畫面高，所以一個像素是 2/height。
   * main.js 在每次 resize 時叫一次。
   */
  setInkPx(px, viewportHeight) {
    this._inkPx = px;
    this._inkOut.value = (2 * px) / Math.max(1, viewportHeight);
  }

  /** 戴不戴帽子。脫帽＝把帽子那幾根骨頭縮到零。 */
  setHat(on) { this._hat = !!on; }
  get hatOn() { return this._hat; }

  /** 想面對哪個方向（世界 yaw）。模型的前進軸是 +Z，見遊戲那邊的量測。 */
  setFacing(yaw) { this._yawGoal = yaw; }

  /* ── 每幀 ───────────────────────────────────────────────────── */

  /**
   * @param {number} dt 秒
   * @param {object} st { speed 水平速度 m/s, grounded 在地上, vy 垂直速度 }
   */
  update(dt, st) {
    const d = Math.min(0.1, Math.max(0, dt || 0));
    const speed = Math.abs(st.speed || 0);
    const grounded = st.grounded !== false;
    const moving = grounded && speed > IDLE_SPEED;
    const state = grounded ? (moving ? 'run' : 'idle') : ((st.vy || 0) > 0 ? 'air' : 'fall');

    // 轉身：連續轉過去，走最短的一邊。14 rad/s 是遊戲的 TURN_RATE。
    let diff = ((this._yawGoal - this._yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    const step = 14 * d;
    this._yaw += Math.abs(diff) < step ? diff : Math.sign(diff) * step;
    this.root.rotation.y = this._yaw;

    /* 步頻跟著實際速度走。speed01 是 Driver 要的「有多用力在跑」，
       遊戲那邊是除以 REF_SPEED，這裡除以自己世界的衝刺速度。 */
    const speed01 = moving ? Math.min(1, speed / 6.2) : 0;
    const strideHz = moving
      ? Math.min(STRIDE_HZ_MAX, Math.max(STRIDE_HZ_MIN, speed / STRIDE_LEN))
      : undefined;

    /* 分成小步跑，讓彈簧鏈不管這一幀多長都待在穩定範圍裡（cat.js 的
       MAX_SUB_DT 同一個理由）。 */
    const steps = Math.max(1, Math.ceil(d / MAX_SUB_DT));
    const sd = d / steps;
    let p = this.drv.pose;
    for (let i = 0; i < steps; i++) {
      p = this.drv.step(sd, speed01, 0, strideHz);
      // 空中的垂直速度平滑一次再交給尾巴——鏈子要看到會動的驅動，
      // 不是一階一階跳的。±1 是一次全力跳，所以除以跳躍初速。
      this._vySmooth += ((st.vy || 0) - this._vySmooth) * (1 - Math.exp(-sd / 0.09));
      this.sway.step(sd, this.drv.time, this._yaw, p.bodyPitch, p, this._vySmooth / 4.6);
    }

    this.rig.reset();
    applyPose(this.rig, p);
    if (!grounded) authored(this.rig, state);

    // 帽子：戴著就是骨頭的原尺寸，脫掉就縮到零。
    for (const b of this._hatBones) {
      const s = this._hat ? this.rig.rest.scale : null;
      for (let k = 0; k < 3; k++) this.rig.scale[b * 3 + k] = s ? s[b * 3 + k] : 0;
    }

    this.rig.update();       // → this.rig.matrices，就是著色器讀的那一份
  }
}

/* ── 空中的兩個姿勢 ─────────────────────────────────────────────
   數值抄自 src/cat/cat.js 的 poseAir／poseFall（那兩支是那個檔案的
   私有函式，不能 import，所以這裡是照抄的兩組角度，連為什麼是這些角度
   的理由也在那邊寫著）：

     air   前腿往前上方伸、後腿往後拖直——那是「正在離開地面」的形狀，
           而它是 air 和 fall 唯一一眼分得出來的差別。
     fall  相反：前腳去找地板、後腿收到肚子底下準備落地。

   `rig._cache` 是 applyPose 建的骨號表，所以這支一定要在 applyPose
   之後才叫得動。 */
function authored(rig, state) {
  const B = rig._cache;
  if (!B) return;
  const set = (front, hind, knee, torso, head, tail) => {
    rig.rotation[B.frontA * 3] = front;
    rig.rotation[B.frontB * 3] = front;
    rig.rotation[B.hindA * 3] = hind;
    rig.rotation[B.hindB * 3] = hind;
    rig.rotation[B.kneeA * 3] = knee;
    rig.rotation[B.kneeB * 3] = knee;
    rig.rotation[B.torso * 3] = torso;
    rig.rotation[B.head * 3] = head;
    rig.rotation[B.tail * 3] = tail;
  };
  if (state === 'air') set(-0.85, 0.62, 0.26, -0.22, -0.14, TAIL_LIFT - 0.30);
  else set(-0.34, -0.30, 0.34, 0.14, 0.02, TAIL_LIFT + 0.42);
}
