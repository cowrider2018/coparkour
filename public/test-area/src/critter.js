/* ── test-area/src/critter.js ────────────────────────────────────────
   遊戲的那幾隻動物，本人，跑在 three.js 裡。

   `public/assets/cat.bin` 一份檔，經過遊戲自己的 `species.js`：貓、
   立耳犬、垂耳犬三種模型，每一種三種毛色，全部戴得上 `wear.js` 的漁夫帽
   ——就是選單上那張 3×3 的表。22,405 個頂點、23 根骨頭的剛體階層、
   `pose.js` 的對角步與彈簧尾巴，一個位元組都沒有重畫。

   一種模型一個 `Critter`（自己的骨架、自己的姿勢驅動、自己的部位矩形），
   三個一起住在一個 `Zoo` 裡。切換是換哪一個 mesh 可見——不是重建，因為
   三隻都要能立刻切回來，而它們合起來也只有幾 MB。

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
     圓角   `shape.js` 的部位表：每個部位的中心、三個半徑與圓角比例。
            造型在載入時烘進頂點，見下面「圓角方形」那一段。

   沒搬的是「那個渲染器是什麼」，而那是刻意的：

     · 正交側視相機，以及遊戲在那台相機的畫面上每幀做的二次變形。這一頁
       的鏡頭會繞著轉、會從斜上方看，造型改成烘進 3D 幾何。
     · 尾巴尖的方頭（TAIL_CAP_GLSL）。沒補是因為它只影響尾巴末端那兩三個像素，而
       尾巴本身不是一個「部位」——shape.js 說得很清楚，一根管子不需要
       矩形。
     · gl.depthRange 分段遮擋，與遠側那隻眼睛的收合。兩個都是為了「一排
       貓在 2D 畫面上疊起來」：這裡只有一隻，而且有真的深度緩衝；而正面
       看得到兩隻眼睛的時候，收掉一隻會變成獨眼。
     · 三階調著色器本身。搬過來的是它的算式（見下面「毛色」那一段），
       不是它那支檔案；狗和石頭因此是被同一個方向的光打的，只是石頭
       分五階而狗分三階（理由在 palette.js 的「為什麼是五階」）。

   ── 圓角方形：烘進幾何 ─────────────────────────────────────────
   那個造型是這隻動物的招牌，所以它跟過來了，但不是照遊戲那樣每幀做。
   遊戲是正交側視，永遠從同一個方向看，在畫面上把輪廓拉成圓角矩形就夠
   了；這一頁的鏡頭會繞著轉，所以造型直接烘進 3D 幾何：`_bakeGeometry()`
   在載入時把每個部位的皮放到一顆**超橢球**上
   （|x/hx|ⁿ + |y/hy|ⁿ + |z/hz|ⁿ = 1），一次算完、每幀零成本。n = 2 是
   橢球、n → ∞ 是方盒，n 由 shape.js 量到的每個部位自己的圓角比例定，
   落在 4.4～5.6。方的特徵留著，但表面處處平滑，所以從任何方向看——包含
   斜上方——輪廓都還是圓角矩形似的曲線。圓角盒與橢圓柱都試過，為什麼不用
   寫在 `_bakeGeometry` 那一段。

   這一頁先前也搬過遊戲那支每幀的二次變形（透視版），與烘焙版並存過一陣
   子給人用眼睛比對；定案的是烘焙版，那一支已經拿掉了
   （`git log -S cpWarp`）。

   墨線是螢幕空間的：翻面外殼沿烘焙後的表面法線，在畫面上往外推固定的
   像素數（見 INK_PUSH），所以遠近一樣粗、處處等寬。

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
import { speciesModels } from '../../src/cat/species.js';
import { Driver, Sway, applyPose, TAIL_AXIS, TAIL_LIFT } from '../../src/cat/pose.js';
import { MODELS, MODEL_SKINS } from '../../src/cat/looks.js';
import { measureShapes } from '../../src/cat/shape.js';
import {
  BAND_KEY, BAND_AMB, SHADE_KEY_GAIN, SHADE_AMB_GAIN,
  TONE_REF_ALBEDO, MID_RANGE, SHADOW_RANGE, BAND_EDGE, REST_AIM,
} from '../../src/cat/cat.js';
import { skyAt, acesTone } from '../../src/gfx/daycycle.js';
import { INK, KEY_POS } from './palette.js';

/* ── 毛色：照遊戲那支著色器算，不照 three 的燈 ───────────────────
   這一頁本來讓狗跟石頭吃同一盞 three 的燈。那在「同一個作品」的意義上
   是對的，但量出來的
   結果是毛色跟 2D 差很多：亮調只有遊戲的 0.2～0.6 倍，深色毛最慘。

   差在哪：遊戲是 `aces(albedo × keyLit)`，keyLit ≈ 2.55，也就是先大幅
   提亮再用 ACES 壓回來；這一頁是 `albedo × 2.05/π ≈ 0.65` 配一盞暖色
   方向光、而且沒有 tone mapping。前者的亮調會頂到接近白，後者永遠低於
   albedo 本身。

   所以毛皮改成整段照抄 cat.js 的 FRAG：三階的色調、色階的邊界、ACES 的
   曝光，全部是那支檔案自己的常數（現在從那邊 import，不是抄一份）。天色
   固定取正午——這一頁沒有日夜循環。

   石頭、苔、旗子走的是 palette.js 的五階調——同一個光的方向，不同的
   色階與曝光。 */

const SKY = skyAt(12);

/** cat.js `_computeTones` 的搬運：三階的色調，正午這一格。 */
const TONES = (() => {
  const band = (i) => [0, 1, 2].map((k) => (
    SKY.tint[k] * SHADE_KEY_GAIN * BAND_KEY[i] + SKY.ambient[k] * SHADE_AMB_GAIN * BAND_AMB[i]
  ));
  const lit = band(0);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  /* 色調比要量在 tone map 之後，不是線性值的比——ACES 的肩部會把亮調
     與中調壓成幾乎一樣。理由見 cat.js 那一段注解。 */
  const ratio = (b) => b.map((v, k) => {
    const L = acesTone(lit[k] * TONE_REF_ALBEDO);
    return L > 1e-4 ? acesTone(v * TONE_REF_ALBEDO) / L : 0;
  });
  /* 三個通道一起縮，只動階距、不動色相——所以陰影該多藍就多藍。 */
  const hold = (r, lo, hi) => {
    const l = lum(r);
    const k = l > 1e-4 ? Math.min(hi, Math.max(lo, l)) / l : 0;
    return r.map((v) => v * k);
  };
  return {
    keyLit: lit,
    mid: hold(ratio(band(1)), MID_RANGE[0], MID_RANGE[1]),
    shadow: hold(ratio(band(2)), SHADOW_RANGE[0], SHADOW_RANGE[1]),
    /* 不吃光的那些（眼睛、嘴）在遊戲裡是乘這個增益的。 */
    unlitGain: Math.max(0.30, acesTone(lum(lit) * 0.55)),
    inkGain: 0.55 + 0.45 * Math.max(0, Math.min(1, acesTone(lum(lit) * 0.55))),
  };
})();

/** 墨色，乘上這個時刻的增益——跟遊戲的 `t.ink` 同一條式子。 */
const INK_TONED = new THREE.Color(INK).multiplyScalar(TONES.inkGain);

/**
 * 主光的方向（世界空間，指向光源）。
 *
 * 用的是 palette.js 的 KEY_POS，也就是石頭那五階調讀的同一個方向——
 * 換掉的只有「色調是什麼顏色」，不是「光從哪裡來」。所以狗與石頭是被
 * 同一盞燈打的，只是狗的色階照遊戲的來（三階、ACES），石頭照場景的
 * 來（五階、線性）。
 */
const LIGHT_DIR = { value: new THREE.Vector3(...KEY_POS).normalize() };

/* 顏色 alpha 位元組的編碼，跟 src/cat/cat.js 一樣：低五位是骨號，
   高三位是彈簧群組。 */
const SWAY_NONE = 0, SWAY_TAIL = 1;
const NODES = TAIL_AXIS.length;          // 17

/* cat.bin 的 `outline` 群組自己烘了 build.js 的 SHELL：每個外殼頂點都已經
   沿法線推出去 0.05 了（量過，中位數正好 0.0500）。

   烘焙模式必須先把它退回去。不退的話，那 0.05 是**模型空間**的厚度，一路
   活過烘焙留在幾何裡，投影到畫面就變成隨距離與角度改變的寬度——量出來
   2～39 px，而螢幕空間那一推只佔其中 2.5 px。退回去之後外殼與毛皮重合，
   線寬就完全由螢幕空間那一推決定，處處相等。

   這正是 shape.js 對 runtime 講的同一件事：「拉到稍微大一點的矩形，而不是
   把殼加厚」，因為加厚的殼在角落會比在邊上寬。 */
const ASSET_SHELL = 0.05;



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
attribute float aBone;
attribute float aSway;
attribute float aOuter;
attribute vec3 aBakeN;              // 烘焙後的表面法線，墨線往外推的方向

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
  if (aSway > 0.5) p = cpSwayPoint(p, aOuter);   // 只有尾巴會擺（狗沒有鬍鬚）
  return (uBones[int(aBone + 0.5)] * vec4(p, 1.0)).xyz;
}
vec3 cpSkinNrm() {
  vec3 n = normal;
  if (aSway > 0.5) n = cpSwayNormal(n, aOuter);
  return normalize(mat3(uBones[int(aBone + 0.5)]) * n);
}
/** 墨線往外推的方向：烘焙後的表面法線。著色用的 normal 是原始曲面的，
    那是 shape.js 堅持的（三階調要真的法線），所以兩份分開放。 */
vec3 cpInkNrm() {
  vec3 n = aBakeN;
  if (aSway > 0.5) n = cpSwayNormal(n, aOuter);
  return normalize(mat3(uBones[int(aBone + 0.5)]) * n);
}

#define CP_PARTS ${partN}
uniform vec4 uPart[CP_PARTS];       // 中心 xyz，w = 掛在哪根骨頭（臉要找頭）
uniform float uInkOut;              // 墨線往外推多遠（螢幕單位），皮毛與臉是 0
attribute float aInkW;              // 這個頂點露在外面的程度（烘焙時量的）

float cpAspect() {
  return projectionMatrix[1][1] / max(projectionMatrix[0][0], 1e-6);
}
`;

const BEGIN_NORMAL = `
  vec3 objectNormal = cpSkinNrm();
`;
const BEGIN_VERTEX = `
  vec3 transformed = cpSkinPos();
`;

/* ── 毛色的片段著色：cat.js 的 FRAG，搬到 three 的 basic 材質上 ──
   `vColor` 帶的是檔案裡原本的 sRGB 位元組（沒有轉線性，見 setCoat），
   跟遊戲那支一樣。算完之後才轉線性交還給 three——因為遊戲是「ACES 之後
   不做 sRGB 編碼」直接寫進畫面，而 three 會在最後替我們編碼一次，所以
   這裡要先還原成線性，兩邊的最終像素才會是同一個值。

   色階的邊界用 fwidth，寬度就是一個像素的變化量——那是遊戲那支決定
   「這是卡通還是漸層」的地方，原樣搬過來。 */
const SHADE_COMMON = `
vec3 cpSrgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
`;
const FUR_FRAG_DECL = `
${SHADE_COMMON}
uniform vec3 uCpKeyLit;
uniform vec3 uCpMid;
uniform vec3 uCpShadow;
uniform vec3 uCpLightDir;
varying vec3 vCpN;

/** ACES（Narkowicz），套在 linear × EXPOSURE 上，之後不做 sRGB 編碼。 */
vec3 cpAces(vec3 x) {
  x = max(x, vec3(0.0)) * ${1.25};
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
`;
const FUR_FRAG = `
  vec3 cpAlbedo = cpSrgbToLinear(vColor);
  float cpD = dot(normalize(vCpN), uCpLightDir);
  float cpE = max(fwidth(cpD) * ${0.6}, ${0.004});
  float cpS1 = smoothstep(${BAND_EDGE[0].toFixed(3)} - cpE, ${BAND_EDGE[0].toFixed(3)} + cpE, cpD);
  float cpS2 = smoothstep(${BAND_EDGE[1].toFixed(3)} - cpE, ${BAND_EDGE[1].toFixed(3)} + cpE, cpD);
  vec3 cpTone = mix(mix(uCpShadow, uCpMid, cpS1), vec3(1.0), cpS2);
  diffuseColor.rgb = cpSrgbToLinear(cpAces(cpAlbedo * uCpKeyLit) * cpTone);
`;
/** 臉：不吃光，就是原色乘一個增益——遊戲那支的 vUnlit 分支。 */
const FACE_FRAG_DECL = `
${SHADE_COMMON}
uniform float uCpUnlit;
`;
const FACE_FRAG = `
  diffuseColor.rgb = cpSrgbToLinear(vColor * uCpUnlit);
`;

/* ── 臉往鏡頭推 ────────────────────────────────────────────────
   沿視線往鏡頭推一點。遊戲有 FACE_LIFT 在做同一件事（那邊是螢幕空間，
   臉待在原地就贏得了深度測試）；烘焙模式會真的在 3D 裡把頭皮推出去，
   所以這裡需要一個真的位移才壓得住。視線每幀都不一樣，所以只能每幀算，
   烘不進去。

   臉不另外轉向鏡頭：頭骨本身已經照 cat.js 的 REST_AIM 轉向觀眾，臉跟著
   頭骨走，再轉一次就是轉兩次。 */
const FACE_DECL = `
uniform float uFaceLift;
uniform int uFaceHost;

/** 在視空間做，因為相機在那裡就是原點——不必反轉任何矩陣。 */
vec3 cpFacePlace(vec3 v) {
  if (uFaceHost < 0) return v;
  mat4 hm = viewMatrix * modelMatrix * uBones[int(uPart[uFaceHost].w + 0.5)];
  vec3 hc = (hm * vec4(uPart[uFaceHost].xyz, 1.0)).xyz;
  float tl = length(hc);
  if (tl < 1e-5) return v;
  return v - (hc / tl) * uFaceLift;
}
`;

/* ── 墨線：在螢幕空間往外推 ──────────────────────────────────────
   接在 three 算完 gl_Position 之後，沿法線往外推固定的像素數。模型空間
   的外殼在這裡是行不通的——線寬會隨鏡頭遠近變，近看粗得像一圈黑邊，而且
   在部位交界那種掠射角上還會攤開成一片，那正是「墨線看起來膨脹」的來源。
   遊戲那邊的 INK_PX 也是像素。 */
const INK_PUSH = `
#include <project_vertex>
  {
    /* 推的方向要用**烘焙後**的表面法線。用原始法線的話，烘完之後有
       46% 的外殼頂點偏掉 15°～60°，推出去的量變成 cos(夾角) 倍——線寬
       就不等寬了。aBakeN 就是為這件事存在的。 */
    vec3 cpN = normalize(normalMatrix * cpInkNrm());
    vec4 cpPN = projectionMatrix * vec4(cpN, 0.0);
    float cpA = cpAspect();
    vec2 cpS = vec2(cpPN.x * cpA, cpPN.y);
    if (length(cpS) > 1e-6) {
      cpS = normalize(cpS);
      /* 埋在別的部位裡的外殼不往外推，它就貼在皮上、被皮擋住——
         內部交界的那些線因此消失，只剩整隻動物最外圈的輪廓。 */
      gl_Position.xy += vec2(cpS.x / cpA, cpS.y) * uInkOut * aInkW * gl_Position.w;
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
  const { boneN, partN } = opts;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uInkOut: opts.inkOut });
    /* 宣告一次寫齊，順序要對：臉那段會讀 uBones 與 uPart，所以它必須排在
       DECL 之後。分兩次 replace('#include <common>') 會踩到坑——第二次會
       配到第一次換進去的那個 include，把後面的程式碼插到宣告前面去，而
       GLSL 是要先宣告後使用的。眼睛整片消失就是這麼來的。 */
    const extra = opts.shade === 'fur' ? 'varying vec3 vCpN;'
      : opts.shade === 'face' ? FACE_DECL : '';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DECL(boneN, partN)}\n${extra}`)
      .replace('#include <beginnormal_vertex>', BEGIN_NORMAL)
      .replace('#include <begin_vertex>', BEGIN_VERTEX);

    /* 毛色與臉的片段著色，見上面那一段。 */
    if (opts.shade === 'fur') {
      Object.assign(shader.uniforms, {
        uCpKeyLit: { value: new THREE.Vector3(...TONES.keyLit) },
        uCpMid: { value: new THREE.Vector3(...TONES.mid) },
        uCpShadow: { value: new THREE.Vector3(...TONES.shadow) },
        uCpLightDir: opts.lightDir,
      });
      /* begin_vertex 上面已經換掉了，所以這裡接在換進去的那段後面。 */
      shader.vertexShader = shader.vertexShader
        .replace(BEGIN_VERTEX, `${BEGIN_VERTEX}\n  vCpN = mat3(modelMatrix) * cpSkinNrm();`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FUR_FRAG_DECL}`)
        .replace('#include <color_fragment>', FUR_FRAG);
    } else if (opts.shade === 'face') {
      shader.uniforms.uCpUnlit = { value: TONES.unlitGain };
      Object.assign(shader.uniforms, opts.face);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FACE_FRAG_DECL}`)
        .replace('#include <color_fragment>', FACE_FRAG);
      /* 臉的擺位接在 project_vertex 之後：那裡 mvPosition 已經在手上，
         而擺位要的正是視空間的座標。 */
      shader.vertexShader = shader.vertexShader
        .replace('#include <project_vertex>', `#include <project_vertex>
  mvPosition.xyz = cpFacePlace(mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;`);
    }
    if (opts.shade === 'ink') {
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', INK_PUSH);
    }
  };
  /* 三顆材質的頂點著色器都不一樣，要各自編譯一份，不然 three 會共用同一
     支編好的程式。 */
  material.customProgramCacheKey = () => `cpdog${boneN}:${partN}:${opts.shade}`;
  return material;
}

/**
 * 載入整個動物園。
 *
 * `species.js` 的 `speciesModels` 是遊戲自己的名冊：它拿一份 cat.bin
 * 生出貓與兩種狗，`opts.wear` 再讓每一種都把服裝的幾何帶著。這一頁用
 * 的就是那一份，所以「有哪些動物」這件事在遊戲和這裡永遠一致——遊戲加
 * 第四種動物的那一天，這一頁的 3×3 自己會變成 4×3。
 *
 * @param {object} opts
 *   buffer  cat.bin 的 ArrayBuffer。給了就不 fetch（離線驗證用）。
 *   url     去哪裡拿 cat.bin，預設 /assets/cat.bin
 *   look    一開始選哪一隻，如 'dog-prick/yellow'
 *   height  動物在這個世界裡多高（公尺，含帽子），預設 1.0
 */
export async function loadZoo(opts = {}) {
  const buffer = opts.buffer
    || await fetch(opts.url || '/assets/cat.bin').then((r) => {
      if (!r.ok) throw new Error(`cat.bin: ${r.status}`);
      return r.arrayBuffer();
    });
  const cat = parseCat(buffer);
  const roster = speciesModels(cat, { wear: ['bucket'] });
  return new Zoo(roster, opts);
}

/**
 * 三隻動物與「現在是哪一隻」。
 *
 * 對外的介面跟一隻動物一樣（`update`／`setFacing`／`setHat`…），因為
 * main.js 不該知道有幾隻——它只有一個角色在跑。
 */
export class Zoo {
  constructor(roster, opts = {}) {
    this.root = new THREE.Group();
    this.critters = new Map();
    for (const { id, data } of roster) {
      const c = new Critter(data, id, opts);
      c.root.visible = false;
      this.root.add(c.root);
      this.critters.set(id, c);
    }
    /** 名冊的順序就是 looks.js 的順序，選單照它排。 */
    this.models = MODELS.filter((m) => this.critters.has(m));
    this.look = null;
    this.setLook(opts.look || `${this.models[0]}/${this.critters.get(this.models[0]).skins[0]}`);
  }

  /** 現在在跑的那一隻。 */
  get active() { return this.critters.get(this.modelId); }

  /**
   * 換一隻動物、或換同一隻的毛色。`look` 是 looks.js 的那個字串
   * （'dog-prick/yellow'），跟伺服器認得的是同一個格式。
   *
   * 換模型的時候朝向要接過去：不接的話換一隻動物會順手把牠轉回正面，
   * 而玩家只是在選毛色。
   */
  setLook(look) {
    const slash = look.indexOf('/');
    const model = look.slice(0, slash), skin = look.slice(slash + 1);
    const c = this.critters.get(model);
    if (!c || !c.skins.includes(skin)) return false;
    if (this.modelId && this.modelId !== model) {
      const prev = this.active;
      prev.root.visible = false;
      c.adopt(prev);
    }
    this.modelId = model;
    c.root.visible = true;
    c.setCoat(skin);
    c.setHat(this._hat !== false);
    if (this._inkPx) c.setInkPx(this._inkPx[0], this._inkPx[1]);
    this.look = look;
    return true;
  }

  /** 這一頁畫得出來的每一個 look，攤成 looks.js 的那張表。 */
  looks() {
    const out = [];
    this.models.forEach((m, row) => {
      this.critters.get(m).skins.forEach((s, col) => {
        out.push({ look: `${m}/${s}`, row: row + 1, col: col + 1 });
      });
    });
    return out;
  }

  setHat(on) { this._hat = !!on; this.active.setHat(on); }
  get hatOn() { return this._hat !== false; }
  setInkPx(px, h) { this._inkPx = [px, h]; for (const c of this.critters.values()) c.setInkPx(px, h); }
  setFacing(yaw) { this.active.setFacing(yaw); }
  update(dt, st) { this.active.update(dt, st); }
  get height() { return this.active.height; }
}

/**
 * shape.js 的 `rrRadius`，一字不改的同一條式子：圓角矩形的中心到邊界有多遠，沿單位方向 (dx, dy)。
 */
function rrRadius(dx, dy, hu, hv, r) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const ex = Math.max(hu - r, 0), ey = Math.max(hv - r, 0);
  if (hu * ay <= ey * ax) return hu / Math.max(ax, 1e-6);
  if (hv * ax <= ex * ay) return hv / Math.max(ay, 1e-6);
  const K = ax * ex + ay * ey;
  return K + Math.sqrt(Math.max(0, K * K - (ex * ex + ey * ey - r * r)));
}

/* ── 超橢球：介於橢球與方盒之間的那個形狀 ─────────────────────────
   |x/hx|ⁿ + |y/hy|ⁿ + |z/hz|ⁿ = 1。n = 2 是橢球，n → ∞ 是方盒，中間
   是「方的，但邊是弧的」——而且它處處平滑，所以從任何方向看輪廓都還是
   一條圓角矩形似的曲線。圓角盒做不到這件事：它真的有三組稜，斜著看會
   把三組稜一起擺進輪廓裡。 */

/** 沿單位方向 dir 到超橢球表面有多遠。閉式解，不用解方程式。 */
const superRadius = (dx, dy, dz, h, n) => (
  Math.abs(dx / h[0]) ** n + Math.abs(dy / h[1]) ** n + Math.abs(dz / h[2]) ** n
) ** (-1 / n);

/**
 * 圓角比例 → 超橢球指數。
 *
 * 在 45° 對角線上對齊單位方形的圓角矩形：那是兩種形狀差最多的方向，
 * 所以拿它定 n。radius = 0.40 → n ≈ 5.6（比較方），0.50 → n ≈ 4.4
 * （比較圓），radius → 1 會回到 n = 2 的橢球。
 */
function shapeExponent(radius) {
  const R = rrRadius(Math.SQRT1_2, Math.SQRT1_2, 1, 1, Math.min(radius, 1));
  return Math.log(2) / Math.log(Math.SQRT2 / R);
}

/**
 * 每個墨線外殼頂點，對應到哪個毛皮頂點。
 *
 * 外殼是毛皮沿法線推 ASSET_SHELL 出去的一份拷貝，所以退回去就找得到雙生
 * 頂點。但「退回去」不精確——量過，退完離最近的毛皮頂點還有中位 0.009、
 * p90 0.033，而那點殘差烘完會變成模型空間的間隙，投影出去就是粗細不一的
 * 線。所以這裡不靠減法，直接把對應關係找出來記著：烘的時候外殼頂點**照抄**
 * 雙生毛皮頂點的結果，兩者因此逐位元重合，線寬就完全由螢幕空間那一推決定。
 *
 * 用格子雜湊找最近點，不然 11k × 12k 的兩兩比對在載入時是感覺得到的。
 */
function twinMap(pos, nrm, boneId, isInk, isLit, nv) {
  const CELL = 0.12;
  const key = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  const grid = new Map();
  for (let v = 0; v < nv; v++) {
    if (!isLit[v]) continue;
    const k = key(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    let a = grid.get(k);
    if (!a) { a = []; grid.set(k, a); }
    a.push(v);
  }
  const twin = new Int32Array(nv).fill(-1);
  for (let v = 0; v < nv; v++) {
    if (!isInk[v]) continue;
    const qx = pos[v * 3] - nrm[v * 3] * ASSET_SHELL;
    const qy = pos[v * 3 + 1] - nrm[v * 3 + 1] * ASSET_SHELL;
    const qz = pos[v * 3 + 2] - nrm[v * 3 + 2] * ASSET_SHELL;
    const cx = Math.floor(qx / CELL), cy = Math.floor(qy / CELL), cz = Math.floor(qz / CELL);
    let best = Infinity, bw = -1;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          const a = grid.get(`${cx + i},${cy + j},${cz + k}`);
          if (!a) continue;
          for (const w of a) {
            if (boneId[w] !== boneId[v]) continue;
            const dd = (pos[w * 3] - qx) ** 2 + (pos[w * 3 + 1] - qy) ** 2 + (pos[w * 3 + 2] - qz) ** 2;
            if (dd < best) { best = dd; bw = w; }
          }
        }
      }
    }
    twin[v] = bw;
  }
  return twin;
}

/* 「埋在別的部位裡」的過渡帶，單位是對方包圍橢球的半徑。0.80 以內完全
   不動，1.00 以外完全照烘，中間平滑——所以表面不會在交界處裂開。上界取
   在對方表面上而不是更外面，是因為再往外就看得見了，那裡要的是烘焙的
   形狀。 */
const BURY_IN = 0.80, BURY_OUT = 1.00;

/* ── 皮的球面徑向圖 ───────────────────────────────────────────────
   「原本的皮在方向 d 上有多遠」。只有臉要用它——臉要保住相對皮的絕對
   深度，所以得知道它上面那層皮原本在哪。

   分箱取最大值再雙線性內插。用內插而不是像先前那樣「跟鄰居取大」，是因為
   取大會在箱與箱之間留下稜，而那道稜會原封不動出現在烘出來的臉上。 */
const RM_AZ = 48, RM_EL = 24;

const radialMapNew = () => ({ r: new Float32Array(RM_AZ * RM_EL) });

const radialMapCell = (dx, dy, dz) => {
  const a = (Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2) * RM_AZ;
  const e = (Math.max(-1, Math.min(1, dy)) + 1) / 2 * (RM_EL - 1);
  return [a, e];
};

function radialMapAdd(m, ox, oy, oz) {
  const len = Math.hypot(ox, oy, oz);
  if (len < 1e-9) return;
  const [a, e] = radialMapCell(ox / len, oy / len, oz / len);
  const i = ((Math.floor(a) % RM_AZ) + RM_AZ) % RM_AZ;
  const j = Math.max(0, Math.min(RM_EL - 1, Math.round(e)));
  const k = j * RM_AZ + i;
  if (len > m.r[k]) m.r[k] = len;
}

/** 補空格（沒有頂點落進去的方向）並抹平一次。 */
function radialMapFinish(m) {
  const r = m.r;
  for (let pass = 0; pass < 4; pass++) {
    const o = r.slice();
    for (let j = 0; j < RM_EL; j++) {
      for (let i = 0; i < RM_AZ; i++) {
        const k = j * RM_AZ + i;
        if (o[k] > 0) continue;
        let sum = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= RM_EL) continue;
          for (let di = -1; di <= 1; di++) {
            const v = o[jj * RM_AZ + ((i + di + RM_AZ) % RM_AZ)];
            if (v > 0) { sum += v; n++; }
          }
        }
        if (n) r[k] = sum / n;
      }
    }
  }
  const o = r.slice();
  for (let j = 0; j < RM_EL; j++) {
    for (let i = 0; i < RM_AZ; i++) {
      let sum = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= RM_EL) continue;
        for (let di = -1; di <= 1; di++) {
          sum += o[jj * RM_AZ + ((i + di + RM_AZ) % RM_AZ)]; n++;
        }
      }
      r[j * RM_AZ + i] = sum / n;
    }
  }
}

function radialMapGet(m, dx, dy, dz) {
  const [a, e] = radialMapCell(dx, dy, dz);
  const i0 = Math.floor(a), j0 = Math.floor(e);
  const fa = a - i0, fe = e - j0;
  const at = (i, j) => m.r[Math.max(0, Math.min(RM_EL - 1, j)) * RM_AZ + ((i % RM_AZ) + RM_AZ) % RM_AZ];
  return (at(i0, j0) * (1 - fa) + at(i0 + 1, j0) * fa) * (1 - fe)
    + (at(i0, j0 + 1) * (1 - fa) + at(i0 + 1, j0 + 1) * fa) * fe;
}

/** 這個形狀掛在哪根骨頭上（shapeOf 的反查）。 */
function boneOfShape(shapeOf, si) {
  for (let b = 0; b < shapeOf.length; b++) if (shapeOf[b] === si) return b;
  return -1;
}

/** 把角度收進 −π…π。 */
const wrapPi = (a) => {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
};

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 兩根骨頭之間的座標轉換：A 的骨頭座標 → 世界 → B 的骨頭座標。
 *
 * 回傳一支現成的函式，因為它要被每個頂點呼叫，而矩陣的反轉一個部位
 * 對只要做一次。
 */
function chain(ma, mb) {
  // mb 的仿射反矩陣：3×3 反轉，再扣掉平移。
  const a = [mb[0], mb[1], mb[2], mb[4], mb[5], mb[6], mb[8], mb[9], mb[10]];
  const det = a[0] * (a[4] * a[8] - a[5] * a[7])
    - a[3] * (a[1] * a[8] - a[2] * a[7])
    + a[6] * (a[1] * a[5] - a[2] * a[4]);
  if (Math.abs(det) < 1e-12) return () => [1e9, 1e9, 1e9];
  const i = [
    (a[4] * a[8] - a[5] * a[7]) / det, -(a[1] * a[8] - a[2] * a[7]) / det, (a[1] * a[5] - a[2] * a[4]) / det,
    -(a[3] * a[8] - a[5] * a[6]) / det, (a[0] * a[8] - a[2] * a[6]) / det, -(a[0] * a[5] - a[2] * a[3]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det, -(a[0] * a[7] - a[1] * a[6]) / det, (a[0] * a[4] - a[1] * a[3]) / det,
  ];
  return (x, y, z) => {
    const wx = ma[0] * x + ma[4] * y + ma[8] * z + ma[12] - mb[12];
    const wy = ma[1] * x + ma[5] * y + ma[9] * z + ma[13] - mb[13];
    const wz = ma[2] * x + ma[6] * y + ma[10] * z + ma[14] - mb[14];
    return [
      i[0] * wx + i[3] * wy + i[6] * wz,
      i[1] * wx + i[4] * wy + i[7] * wz,
      i[2] * wx + i[5] * wy + i[8] * wz,
    ];
  };
}

/**
 * 一份網格自己的表面法線，面積加權。
 *
 * 只給墨線外殼當「往外長」的方向用，不給著色用——著色要的是原始曲面的
 * 法線，那是 shape.js 的結論（三階調要真的法線，見那支檔案開頭）。
 *
 * 退化的三角形（烘焙會把一整圈頂點壓到同一點，例如部位的極點）算出來
 * 是零向量，那種頂點就留原本的法線。
 */
function surfaceNormals(pos, index, nv, fallback) {
  const N = new Float32Array(nv * 3);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    const e1x = pos[b * 3] - pos[a * 3];
    const e1y = pos[b * 3 + 1] - pos[a * 3 + 1];
    const e1z = pos[b * 3 + 2] - pos[a * 3 + 2];
    const e2x = pos[c * 3] - pos[a * 3];
    const e2y = pos[c * 3 + 1] - pos[a * 3 + 1];
    const e2z = pos[c * 3 + 2] - pos[a * 3 + 2];
    // 沒有正規化＝面積加權。
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz;
    }
  }
  for (let v = 0; v < nv; v++) {
    const L = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
    if (L < 1e-12) {
      for (let k = 0; k < 3; k++) N[v * 3 + k] = fallback[v * 3 + k];
    } else {
      for (let k = 0; k < 3; k++) N[v * 3 + k] /= L;
    }
  }
  /* 外殼是翻面畫的（BackSide），但三角形的繞向沒變，所以算出來的朝向
     與原始法線同向；真要反了就跟著原始法線翻回來。 */
  for (let v = 0; v < nv; v++) {
    const d = N[v * 3] * fallback[v * 3]
      + N[v * 3 + 1] * fallback[v * 3 + 1]
      + N[v * 3 + 2] * fallback[v * 3 + 2];
    if (d < 0) for (let k = 0; k < 3; k++) N[v * 3 + k] = -N[v * 3 + k];
  }
  return N;
}

export class Critter {
  constructor(data, modelId, opts = {}) {
    this.data = data;
    this.modelId = modelId;
    this.model = data.model;
    this.skins = (MODEL_SKINS[modelId] || data.header.skins).filter((s) => data.colors.has(s));
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

    /* 兩隻眼睛，用靜置位置的 x 正負分左右——跟 cat.js 記錄它們的方式
       一樣。哪一隻是「遠的」每幀才決定，見 update 的 _eyeFade 那一段。 */
    this._eyePlusX = -1;
    this._eyeMinusX = -1;
    for (let i = 0; i < this.rig.count; i++) {
      if (!this.rig.names[i].startsWith('eye')) continue;
      if (this.rig.rest.position[i * 3] >= 0) this._eyePlusX = i;
      else this._eyeMinusX = i;
    }

    /* 部位表。measureShapes 是 shape.js 的：每個部位的中心、三個半徑、
       圓角比例——烘焙的超橢球就照它定，見 _bakeGeometry。

       它內部會 reset 並 update 骨架去量，所以一定要在姿勢開始跑之前
       叫——這裡是建構子，後面 _buildMesh 會再擺一次待機姿勢。 */
    this.shape = measureShapes(data, this.rig, this.model.parts, this.model.ride, this.model.patch);
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

    this._posRaw = d.position.slice();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this._posRaw.slice(), 3));

    // 法線是 snorm16 ×4：xyz 是法線，w 是 outerness（尾巴上的位置）。
    const nrm = new Float32Array(nv * 3);
    const outer = new Float32Array(nv);
    for (let v = 0; v < nv; v++) {
      for (let k = 0; k < 3; k++) nrm[v * 3 + k] = d.normal[v * 4 + k] / 32767;
      outer[v] = d.normal[v * 4 + 3] / 32767;
    }
    this._nrmRaw = nrm;
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aOuter', new THREE.Float32BufferAttribute(outer, 1));
    /* 墨線往外推的方向。先擺原始法線，烘完換成烘焙後的表面法線（見
       _buildMesh 最後那一段）。 */
    g.setAttribute('aBakeN', new THREE.Float32BufferAttribute(nrm.slice(), 3));
    /* 每個頂點露在外面的程度，烘焙時量（見 _bakeGeometry）。墨線用它決定
       要不要往外推——埋在別的部位裡的就不推。 */
    g.setAttribute('aInkW', new THREE.Float32BufferAttribute(new Float32Array(nv).fill(1), 1));

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
    this._boneId = bone;
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
    this._unlitGroup = G.unlit;
    this._litGroup = G.lit;
    this._outlineGroup = G.outline;
  }

  /* ── 烘進幾何 ─────────────────────────────────────────────────────
     目標形狀是**超橢球**：|x/hx|ⁿ + |y/hy|ⁿ + |z/hz|ⁿ = 1。n = 2 是橢球、
     n → ∞ 是方盒，中間是「方的但邊是弧的」，而且表面處處平滑——所以從任何
     方向（含正上方）看，輪廓都還是一條圓角矩形似的曲線。圓角盒與橢圓柱都
     試過：盒真的有三組稜，斜著看會把三組稜一起擺進輪廓；柱從正上方看是
     一個橢圓。

     ── 為什麼是「放上去」而不是「推過去」 ───────────────────────────
     先前這裡做的是變形：拿每個頂點量它離**包圍橢球**多遠，再按比例縮到
     目標上。那個尺規從一開始就是錯的——網格不填滿自己的包圍橢球，而差多少
     每個部位、每個方向都不一樣（shape.js 量過：軀幹 ±15%、前腳掌 ±20%、
     後腳掌 ±3%）。於是填得滿的部位貼到目標、填不滿的差一截，比例就歪了。
     後面每補一層（norm、夾住 t、擬合縮放、方向分箱正規化），誤差就換一個
     地方冒出來。

     正確的作法只需要一個事實：**皮的頂點依定義就在部位表面上**。`lit` 與
     `outline` 是曲面網格，不是體積，所以不必問「這個頂點伸出去多遠」——
     它就是表面。目標半徑直接就是解析曲面在它自己方向上的值：

         皮   p = center + dir · R(dir)
         臉   p = center + dir · ( R(dir) − (ρ(dir) − len) )

     皮因此逐點精確落在超橢球上，每個方向、每個部位都一樣，不靠任何量測或
     擬合。輪廓從此就是那個曲面本身。臉（unlit）要保住它相對皮的**絕對**
     深度，所以要知道原本的皮在那個方向有多遠，那就是 ρ——只有臉需要它。

     ── 代價，寫清楚 ─────────────────────────────────────────────────
       · 斜 45° 方位比遊戲的圓角矩形胖到 25%。超橢球的支撐是 ℓᵐ
         （m = n/(n−1)）、遊戲的矩形照 ℓ²（橢球支撐）做，兩者在對角差
         2^(1/m − 1/2)。正交軸向的輪廓則完全相同。這是幾何上消不掉的。
       · 部位內部的凹陷會被填平（腿窩、耳根的凹角）——「皮 = 超橢球」就是
         這個意思，部位變成嚴格凸的一塊。
       · 遊戲那支變形裡「法線側視才精確拉到邊」那一段是視角相關的，烘不進去。

     ── 每個圖形都有自己的中心 ───────────────────────────────────────
     後大腿、後小腿、吻部本來就各自是一個部位，各有自己的中心與超橢球。
     耳朵不烘，理由見下面。 */
  _bakeGeometry() {
    const d = this.data;
    const nv = d.header.vertexCount;
    const S = this.shape;
    const raw = this._posRaw;
    const baked = raw.slice();

    const mark = (grp) => {
      const m = new Uint8Array(nv);
      if (grp) for (let i = grp.start; i < grp.start + grp.count; i++) m[d.index[i]] = 1;
      return m;
    };
    const isFace = mark(this._unlitGroup);
    const isInk = mark(this._outlineGroup);
    const isLit = mark(this._litGroup);
    if (!this._twin) {
      this._twin = twinMap(raw, this._nrmRaw, this._boneId, isInk, isLit, nv);
    }
    const twin = this._twin;

    /* ── 有哪些形狀，各自的中心在哪 ────────────────────────────────
       就是 shape.js 的部位表，中心與半徑是它量的。

       「被帶著走」的骨頭（耳朵）不在裡面，所以下面那個迴圈會直接跳過
       它們的頂點——耳朵完全不烘，維持網格原本的三角形。這是 shape.js
       的立場，也是遊戲的行為：

         「三角形才是耳朵，把它磨圓是唯一一個會讓這隻動物不再讀作貓的
           改動，所以它們保留自己確切的形狀與確切的位置。」

       試過把耳朵也升格成獨立形狀：超橢球沒有任何指數會給出三角形（n 只
       在橢球與方盒之間走），加上收尖才勉強像個錐——但那已經是在另外雕一
       隻耳朵，不是把原本那隻整理乾淨。不烘就是對的。 */
    const shapes = S.parts.map((p) => ({
      name: p.name, center: p.center, half: p.half, radius: p.radius,
    }));
    const shapeOf = new Int32Array(this.rig.count).fill(-1);
    S.parts.forEach((p, i) => { shapeOf[p.bone] = i; });


    const fit = shapes.map((sh) => ({ n: shapeExponent(sh.radius), target: Array.from(sh.half) }));

    /* ── 原本的皮在每個方向有多遠（只有臉要用） ────────────────────
       球面徑向圖，載入時一個形狀建一張。雙線性內插而不是分箱取最大值——
       取最大值會在箱與箱之間留下稜，那是先前那版的毛病之一。 */
    const skin = shapes.map(() => null);
    for (let v = 0; v < nv; v++) {
      const b = this._boneId[v];
      const si = shapeOf[b];
      if (si < 0 || !isLit[v] || isFace[v]) continue;
      if (!skin[si]) skin[si] = radialMapNew();
      const c = shapes[si].center;
      radialMapAdd(skin[si], raw[v * 3] - c[0], raw[v * 3 + 1] - c[1], raw[v * 3 + 2] - c[2]);
    }
    for (const m of skin) if (m) radialMapFinish(m);

    /* ── 擺上去 ──────────────────────────────────────────────────── */
    const inkW = new Float32Array(nv).fill(1);
    const worn = new Set();
    for (const bones of Object.values(this.model.wear || {})) {
      for (const n of bones) worn.add(this.rig.bone(n));
    }
    this.rig.reset();
    const RM = this.rig.update();
    const boneMat = (b) => RM.subarray(b * 16, b * 16 + 16);
    /* 形狀 A 的骨頭座標 → 形狀 B 的骨頭座標，用來判斷「埋在別人裡面」。
       服裝不算遮蔽物：帽子隨時可以脫，拿它當遮蔽物會讓頭頂永遠不烘。 */
    const cross = shapes.map((_, ai) => shapes.map((_, bi) => {
      if (ai === bi) return null;
      const ab = boneOfShape(shapeOf, ai), bb = boneOfShape(shapeOf, bi);
      if (ab < 0 || bb < 0 || worn.has(bb)) return null;
      return chain(boneMat(ab), boneMat(bb));
    }));

    for (let v = 0; v < nv; v++) {
      const si = shapeOf[this._boneId[v]];
      if (si < 0) continue;
      if (isInk[v] && twin[v] >= 0) continue;      // 第二趟照抄雙生頂點
      const sh = shapes[si], f = fit[si];

      const ox = raw[v * 3] - sh.center[0];
      const oy = raw[v * 3 + 1] - sh.center[1];
      const oz = raw[v * 3 + 2] - sh.center[2];
      const len = Math.hypot(ox, oy, oz);
      if (len < 1e-6) continue;
      const dx = ox / len, dy = oy / len, dz = oz / len;

      const R = superRadius(dx, dy, dz, f.target, f.n);
      let out;
      if (isFace[v]) {
        /* 臉：保留它相對於皮的**絕對**深度。ρ 是原本的皮在這個方向有多遠，
           ρ − len 就是這個頂點原本埋在皮下面多深，減掉它，深度跟原始網格
           一模一樣。鬍鬚（ρ − len < 0）自動也對，照原本的量留在外面。 */
        const rho = skin[si] ? radialMapGet(skin[si], dx, dy, dz) : len;
        out = R - (rho - len);
      } else {
        // 皮就在表面上，所以目標半徑就是 R——不量、不縮、不夾。
        out = R;
      }

      /* 「埋在別的形狀裡多深」只拿來決定**墨線要不要往外推**，不再拿來
         按住頂點。遊戲的部位本來就自由重疊互穿、靠深度處理，
         按住皮會讓頸部與腿根塌陷，部位就黏成一團——量過，先前髖部有
         一半以上的皮根本沒烘。頭的墨線蓋住吻部那件事改由 aInkW
         處理（只留整隻動物最外圈的輪廓），那才是對症的藥。 */
      let u = Infinity;
      const row = cross[si];
      for (let bi = 0; bi < row.length; bi++) {
        const T = row[bi];
        if (!T) continue;
        const q = T(raw[v * 3], raw[v * 3 + 1], raw[v * 3 + 2]);
        const o = shapes[bi];
        const ub = Math.hypot(
          (q[0] - o.center[0]) / o.half[0],
          (q[1] - o.center[1]) / o.half[1],
          (q[2] - o.center[2]) / o.half[2],
        );
        if (ub < u) u = ub;
      }
      inkW[v] = smoothstep(BURY_IN, BURY_OUT, u);

      baked[v * 3] = sh.center[0] + dx * out;
      baked[v * 3 + 1] = sh.center[1] + dy * out;
      baked[v * 3 + 2] = sh.center[2] + dz * out;
    }

    /* 墨線外殼照抄雙生毛皮頂點：兩者逐位元重合，所以外殼的輪廓就是毛皮的
       輪廓，線寬完全由螢幕空間那一推決定，處處相等。 */
    for (let v = 0; v < nv; v++) {
      const w = twin[v];
      if (!isInk[v] || w < 0) continue;
      baked[v * 3] = baked[w * 3];
      baked[v * 3 + 1] = baked[w * 3 + 1];
      baked[v * 3 + 2] = baked[w * 3 + 2];
      inkW[v] = inkW[w];
    }

    /* 貓的嘴——鼻子下面那個小小的「⌣」——在烘焙版不畫。認它的方法跟
       src/cat/dog.js 的 isCatMouth 一樣：`unlit` 群組裡掛在 head 上的
       就是它，沒有別的。狗的 cat.bin 早就把它丟了、畫的是自己的嘴，所以
       只有貓要處理。收成一點就好：三角形退化成零面積，光柵化不會畫它，
       臉的抬起是整張臉同一個位移，也不會把它拉開。 */
    if (this.modelId === 'cat') {
      const head = this.rig.names.indexOf('head');
      let at = -1;
      for (let v = 0; v < nv; v++) {
        if (!isFace[v] || this._boneId[v] !== head) continue;
        if (at < 0) at = v;
        baked[v * 3] = baked[at * 3];
        baked[v * 3 + 1] = baked[at * 3 + 1];
        baked[v * 3 + 2] = baked[at * 3 + 2];
      }
    }
    return { pos: baked, nrm: surfaceNormals(baked, d.index, nv, this._nrmRaw), inkW };
  }

  _buildMesh(opts) {
    const boneN = this.rig.count;
    const S = this.shape;
    const partN = S.parts.length;

    /* 部位的中心＋骨號，攤平成 uniform。只有臉要用：它得知道頭在哪裡。 */
    const part = new Float32Array(partN * 4);
    S.parts.forEach((p, i) => {
      part[i * 4] = p.center[0];
      part[i * 4 + 1] = p.center[1];
      part[i * 4 + 2] = p.center[2];
      part[i * 4 + 3] = p.bone;
    });

    this._inkOut = { value: 0 };            // 墨線那一趟才不是 0，見 setInkPx
    /* 臉往鏡頭推多遠，見 FACE_DECL。0.15 是遊戲 shape.js 的 FACE_LIFT，
       做的是同一件事，所以用同一個數字。 */
    this._faceLift = { value: 0.15 };
    const host = S.parts.findIndex((p) => p.name === 'head');
    this._faceHost = { value: host };
    this._uniforms = {
      uBones: { value: this.rig.matrices },
      uSwayQ: { value: this.sway.qs },
      uSwayBend: { value: this.sway.bend },
      uPart: { value: part },
    };
    const zero = { value: 0 };

    /* 皮毛：three 的三階調材質，梯度圖是 palette.js 那一張——石頭用的
       同一張。狗和牆因此是同一盞燈照的，那是這一頁最要緊的一致性。 */
    const fur = rig3(new THREE.MeshBasicMaterial({
      vertexColors: true,
    }), this._uniforms, {
      boneN, partN, inkOut: zero, shade: 'fur', lightDir: LIGHT_DIR,
    });
    /* 臉：cat.bin 的 `unlit` 群組——眼睛、鼻子、嘴。它在遊戲裡就是不吃
       光的，所以這裡是 Basic 而不是 Toon。 */
    const face = rig3(new THREE.MeshBasicMaterial({
      vertexColors: true,
      /* 臉要贏得了深度測試，不然眼睛會被自己的臉頰蓋掉。皮是真的在 3D
         裡被放到超橢球上的；臉雖然已經照原始網格的深度擺好了（見
         _bakeGeometry），還是要一點偏移收尾。 */
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    }), this._uniforms, {
      boneN, partN, inkOut: zero, shade: 'face',
      face: {
        uFaceLift: this._faceLift,
        uFaceHost: this._faceHost,
      },
    });
    /* 墨線：翻面外殼。cat.bin 的 `outline` 群組佔 44% 的三角形，就是為
       這個存在的——正面剔除之後剩下背面，被身體擋住，只在輪廓外露出一圈。
       three 這邊 side: BackSide 就是「剔除正面」。 */
    const ink = rig3(new THREE.MeshBasicMaterial({
      color: INK_TONED, side: THREE.BackSide,
    }), this._uniforms, {
      boneN, partN, inkOut: this._inkOut, shade: 'ink',
    });

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

    /* 造型烘進幾何：頂點位置、墨線往外推的方向、每個頂點露在外面的程度，
       載入時算一次。大小與腳的位置上面是照原始網格量的，所以烘焙不會
       改動牠有多高、站在哪裡。 */
    const b = this._bakeGeometry();
    this._posBaked = b.pos;
    const A = this.geometry.attributes;
    A.position.array.set(b.pos);
    A.aBakeN.array.set(b.nrm);
    A.aInkW.array.set(b.inkW);
  }

  /**
   * 接手另一隻的狀態。換動物用：朝向、步態的相位、尾巴的驅動全部接過來，
   * 所以換一隻不會讓角色原地轉回正面、也不會從靜止重新起步——玩家做的
   * 事只是換了外觀。
   */
  adopt(other) {
    this._yaw = other._yaw;
    this._yawGoal = other._yawGoal;
    this._vySmooth = other._vySmooth;
    this.root.rotation.y = this._yaw;
    this.drv.time = other.drv.time;
    this.sway.seed(this._yaw, 0);
  }

  /** 現在這個姿勢下，整隻動物的世界座標邊界（模型單位）。 */
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
    /* 原樣搬，不轉線性——著色器吃的就是檔案裡那個 sRGB 位元組，跟遊戲
       那支 FRAG 的 vColor 是同一個東西（它自己在裡面 srgbToLinear）。
       轉換交給片段著色，見 FUR_FRAG。 */
    for (let v = 0; v < out.length / 3; v++) {
      out[v * 3] = col[v * 4] / 255;
      out[v * 3 + 1] = col[v * 4 + 1] / 255;
      out[v * 3 + 2] = col[v * 4 + 2] / 255;
    }
    this._colorAttr.needsUpdate = true;
  }

  /**
   * 墨線在畫面上多寬。
   *
   * 要知道視窗多高才算得出來：墨線是在「y 正規化的螢幕座標」裡推的，
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
    const speed01 = moving ? Math.min(1, speed / 8) : 0;
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
    /* ── 頭稍微轉向觀眾 ──────────────────────────────────────────
       這是遊戲自己的解法，不是這裡發明的：cat.js 的 REST_AIM。

         「純側面的這個模型看不到臉。眼睛是壓在頭前面的扁圓片
           （unlit 群組整個朝 +Z），所以側過去就是兩個像素的空白，
           而一隻沒有眼睛的貓在 40 px 下讀不出是貓。修法在骨架，不在
           相機。」

       關鍵在「修法在骨架」：轉的是**頭這根骨頭**，所以頭骨、吻部、耳朵、
       眼睛是一起轉的，部位的超橢球也跟著骨頭走。先前那版只轉臉那一片
       貼皮，接近 90° 側面時臉會從頭上滑掉——那是把一片貼紙繞著球轉，
       不是把頭轉過來。

       用的是 pose.js 既有的 aimYaw／aimWeight，跟轉身共用同一組，所以
       不會有兩個頭部朝向在打架。 */
    const psi = st.viewYaw === undefined
      ? 0
      : wrapPi(st.viewYaw - this._yaw);
    /* 用 sin(ψ) 而不是把 ψ 夾住：夾住的話鏡頭繞到正後方時 ψ 會在 ±180°
       之間翻號，頭就跟著彈 25°。sin 在那裡是 0、而且在正側面剛好給滿，
       也就是最需要那張臉的時候最用力，繞一圈完全連續。 */
    const aim = REST_AIM * Math.sin(psi);
    p.aimYaw = aim;
    p.aimWeight = 1;

    applyPose(this.rig, p);
    if (!grounded) authored(this.rig, state);

    // 帽子：戴著就是骨頭的原尺寸，脫掉就縮到零。
    for (const b of this._hatBones) {
      const s = this._hat ? this.rig.rest.scale : null;
      for (let k = 0; k < 3; k++) this.rig.scale[b * 3 + k] = s ? s[b * 3 + k] : 0;
    }

    /* ── 遠側那隻眼睛收合 ────────────────────────────────────────
       cat.js 的 `_eyeFade`，連兩個門檻都照抄。這個模型有兩隻眼睛而相機
       只會在其中一側，所以真正的側面裡遠的那隻是埋在頭裡的——但它是
       「壓在臉上的扁片」，側過去之後模型畫在每隻眼睛上的白色高光會戳出
       輪廓外，變成頭後面多一顆浮著的點。真的側臉只有一隻眼睛，所以遠的
       那隻縮到零。

       交叉點放得高（0.62～0.94）：眼睛要轉到夠遠、開始戳出吻部之外才算
       問題，太早收掉會讓四分之三側的貓失去那隻正在賣力工作的眼睛。

       用乘的不是指定的，這樣它跟 applyPose 與空中姿勢是疊加的關係。 */
    /* 量的是**頭轉過去之後**與鏡頭還差多少，不是身體差多少——所以是減。
       cat.js 那邊寫成 `sin(c.yaw + c.aim)` 是因為它的 ψ 與 aim 都在螢幕
       座標裡量，aim 是往 ψ = 0 扳回去的，符號本來就相反；換到這裡的
       「鏡頭相對於狗」座標就是同一件事的減法。

       這個差別是看得出來的：用加的話四分之三側（45°）遠眼就只剩 0.22，
       而那正是遊戲注解說「會讓那隻正在賣力工作的眼睛消失」的情況。 */
    const sEye = Math.sin(psi - aim);
    let k = (Math.abs(sEye) - 0.62) / (0.94 - 0.62);
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    k = k * k * (3 - 2 * k);
    /* ψ > 0 表示鏡頭在狗自己的 +X 那一側，所以 +X 那隻是**近**的，要收的
       是 −X 那隻。cat.js 寫成相反是因為它的 ψ 在螢幕座標裡量，方向本來
       就跟這裡的「鏡頭相對於狗」差一個號。 */
    const far = sEye >= 0 ? this._eyeMinusX : this._eyePlusX;
    if (far >= 0 && k > 0) {
      const e = far * 3;
      for (let i = 0; i < 3; i++) this.rig.scale[e + i] *= 1 - k;
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
