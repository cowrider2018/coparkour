/* ── test-area/src/palette.js ────────────────────────────────────────
   這一區的顏色與材質。

   形狀走 Dota／黑魂那種厚重的石造感（見 geom.js 的倒角石塊），但顏色
   一律是本專案卡通調色盤的值——不是重新配色，是把遊戲裡已經在用的那幾
   個數字搬過來，所以這一頁的石頭和遊戲裡的狗站在一起不會像兩個作品：

     · 石材與木材      取自 /preview/ 圖鑑那張深色卡片色票
                       （#1e1810 底、#2b2218 卡片、#4a3b29 邊、#6b563c 線）
     · 苔與布的亮色    accent #9bd94e、accent2 #e8862f
     · 墨線            43,35,32——src/cat/cat.js 的 INK，同一個值
     · 光              src/gfx/daycycle.js 的 NOON tint 與 AMBIENT_DAY

   ── 為什麼光不再是 three 的燈 ────────────────────────────────────
   這一頁本來是 MeshToonMaterial 加一張 3 階的 gradientMap，外加一盞
   方向光與一盞 HemisphereLight。分階的部分是對的，**半球光不是**：它的
   照度是 mix(地色, 天色, 0.5·n·上 + 0.5)，也就是一條隨法線連續走的
   漸層，蓋在每一塊石頭上。畫面上看到的因此是「三階調再加一層連續的
   灰」——倒角、柱身、拱腹那些斜面全部糊成漸層，而那正是這種造型最需要
   分階的地方。

   所以石頭改成跟狗走同一條路：MeshBasicMaterial 加自己的片段著色，
   three 的燈一盞都不留（`lights()` 因此沒有了，主光只剩 KEY_POS 這一個
   方向）。環境光變成一個常數項——扁的、不隨法線走，於是整片地形上再也
   沒有一條連續的漸層，只有五塊平調。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { SURF, SURF_DEF, MOSS, surfaceTextures, surfaceUniforms } from './surface.js';

/** 墨色。src/cat/cat.js 的 INK = [43, 35, 32]。 */
export const INK = 0x2b2320;

/** 這一區用到的所有顏色。名字說的是「材質」，不是「顏色」。 */
export const C = {
  /* 石材四階。由亮到暗，亮的用在朝光的新鮮斷面，暗的用在牆根與內側。 */
  stoneLit: 0xc6b08c,
  stone: 0xa89270,
  stoneDark: 0x6b563c,
  stoneDeep: 0x4a3b29,
  /* 花崗岩：地板與台基，比牆冷一階，好讓中央空地跟周圍的裝飾分開。 */
  granite: 0x8d8577,
  graniteDark: 0x6d675c,
  /* 苔。亮的在頂面，暗的在縫裡。 */
  moss: 0x9bd94e,
  mossDark: 0x5f8f33,
  /* 木料、鐵件、布、金。 */
  wood: 0x7a5433,
  woodDark: 0x4c351f,
  iron: 0x3b3a3c,
  ironLit: 0x565459,
  banner: 0xc2452f,
  bannerAlt: 0xe8862f,
  gold: 0xe8b23a,
  /* 城裡的東西：屋瓦兩階、骨頭（墓室的頭骨與蠟燭）。瓦比石頭飽和，好讓一排
     屋頂在一片石色裡讀得出是另一種材料。 */
  tile: 0x9a4b32,
  /* 抹灰牆兩階。木構房子的牆面是一整片素色，磚縫只留在牆基——整排房子
     都是磚的話，巷子裡滿眼都是縫。 */
  plaster: 0xd8c7a2,
  plasterAlt: 0xc7b089,
  tileDark: 0x6e3222,
  bone: 0xd9ccaa,
  /* 營地：帳篷的帆布兩階（亮的是帳身，暗的是門洞裡的內襯）、麻袋、稻草、
     繩。帆布比抹灰冷一點、灰一點——城牆底下那一排帳篷要讀得出是布，
     不是一排矮房子。 */
  canvas: 0xcfc4a4,
  canvasDark: 0x5a4c38,
  sack: 0xa98d62,
  straw: 0xcaa75a,
  rope: 0x8f7652,
  /* 火與水。火是自發光，水是一片平的半透明。 */
  flame: 0xffb43c,
  flameCore: 0xfff0c0,
  water: 0x2f4a52,
  /* 天空與霧。#1e1810 是圖鑑那頁的底色。 */
  sky: 0x2a2b3a,
  fog: 0x1e1810,
};

/* ── 光 ──────────────────────────────────────────────────────────
   一盞，方向固定。critter.js 讀的也是這一個數字（狗自己算牠的三階調，
   但「光從哪裡來」只該有一份），所以石頭與狗是被同一個方向的光打的。 */

/** 主光的位置（世界座標）。方向就是它的正規化。 */
export const KEY_POS = [-9, 14, 7];

/** 主光的方向（世界空間，指向光源）。 */
export const KEY_DIR = new THREE.Vector3(...KEY_POS).normalize();

/* ── 五階調 ──────────────────────────────────────────────────────
   跟 src/cat/cat.js 的三階調是同一個做法：漫射項硬切成幾塊平調，交界
   只留 fwidth 說得出的那麼寬（那個寬度是為了不讓交界爬動與鋸齒，再寬
   一點就變回漸層了）。

   ── 為什麼是五階而不是三階 ──────────────────────────────────────
   狗是一團連續的曲面，三階在牠身上剛好：亮面、側面、背光面，每一塊都
   有足夠的面積讀得出形狀。石造物相反——它的資訊幾乎全在斜面上（每一道
   倒角、柱身那十片稜、拱腹的一圈），那些面的法線密集地落在中段的 ndl
   裡，三階會把它們整批壓進同一塊平色，於是一根柱子讀起來是一塊平板。
   五階把中段切成三塊，倒角與柱稜因此各自落在不同階上。

   ── 階與邊界 ────────────────────────────────────────────────────
   由亮到暗五階。每一階的顏色是同一條照明式子在一個代表 ndl 上的取樣：

       階色 = 主光色 × KEY_GAIN × BAND_KEY[i] + 環境色 × BAND_AMB[i]

   KEY_GAIN／AMB_GAIN 是原本那兩盞燈的強度除以 π（three 的 Lambert BRDF
   就是乘 1/π），所以換掉整條光路之後畫面的明度跟原本對得上——換掉的是
   「階怎麼分」，不是「這一頁有多亮」。

   最暗那一階的 BAND_KEY 是 0.26 而不是 0：背光面收到四分之一的主光是
   假的補光，但原本那張 3 階梯度圖的最暗格就是 70/255 ≈ 0.27，照抄它才
   不會把整片背光的牆變成死黑。暗階的環境光增益多幾個百分點，於是陰影
   偏藍——那是環境光在暗階裡佔比變大的自然結果，不是另外調的色。 */

const KEY_TINT = 0xffeed1;          // daycycle.js 的 NOON tint
const KEY_GAIN = 2.05 / Math.PI;    // 原本那盞 DirectionalLight(2.05) ÷ π
const AMB_SKY = 0x9fb4e6;           // AMBIENT_DAY 的天色
const AMB_GROUND = 0x3a2d1f;        // …與地色
const AMB_GAIN = 0.85 / Math.PI;    // 原本那盞 HemisphereLight(0.85) ÷ π

/** 每一階代表的 ndl，由亮到暗。 */
export const BAND_KEY = [1.0, 0.75, 0.55, 0.39, 0.26];
/** 每一階的環境光增益。暗的兩階多一點，免得陰影掉成一塊死黑。 */
export const BAND_AMB = [1.0, 1.0, 1.0, 1.03, 1.06];
/**
 * 四道邊界，落在 dot(normal, light) 上，由亮到暗；BAND_EDGE[i] 是第 i
 * 階的下緣。
 *
 * 最後一道是 −0.06，就在明暗交界線下面一點點——所以整個背光側是一塊平的
 * 陰影（cat.js 的規矩，理由一樣：背光面本來就沒有形狀資訊可讀，在那邊
 * 分階只會多出幾條沒有意義的界線）。四道邊界因此全部花在受光側。
 */
export const BAND_EDGE = [0.66, 0.38, 0.16, -0.06];
/** 交界最寬可以是螢幕空間導數的幾倍。cat.js 的 BAND_SOFT，同一個值。 */
const BAND_SOFT = 0.6;
/** …以及一個下限，給 fwidth 幾乎是 0 的大平面（一整片鋪面）用。 */
const BAND_SOFT_MIN = 0.004;

/** 五階的顏色，攤平成 vec3[5]。three 的色彩管理已經把它們轉成線性。 */
const TONES = (() => {
  const key = new THREE.Color(KEY_TINT);
  const amb = new THREE.Color(AMB_SKY).lerp(new THREE.Color(AMB_GROUND), 0.5)
    .multiplyScalar(AMB_GAIN);
  const out = new Float32Array(15);
  for (let i = 0; i < 5; i++) {
    const k = KEY_GAIN * BAND_KEY[i], a = BAND_AMB[i];
    out[i * 3] = key.r * k + amb.r * a;
    out[i * 3 + 1] = key.g * k + amb.g * a;
    out[i * 3 + 2] = key.b * k + amb.b * a;
  }
  return out;
})();

/* 所有分階材質共用這兩個 uniform 物件，所以要動燈只有一個地方可動。 */
const U_BAND = { value: TONES };
const U_KEYDIR = { value: KEY_DIR };

const BAND_DECL = `
uniform vec3 uBand[5];
uniform vec3 uKeyDir;
varying vec3 vBandN;
`;
/* 由暗往亮一階一階 mix 上去。邊界是遞減的，而 smoothstep 在自己的邊界
   以下是 0、以上是 1，所以這一串等價於「d 落在哪一階就取哪一階」，只有
   邊界那 2·cpE 寬的地方是混的。 */
const BAND_FRAG = `
  float cpD = dot(normalize(vBandN), uKeyDir);
  float cpE = max(fwidth(cpD) * ${BAND_SOFT}, ${BAND_SOFT_MIN});
  vec3 cpTone = uBand[4];
${BAND_EDGE.map((e, i) => `  cpTone = mix(cpTone, uBand[${i}], `
  + `smoothstep(${e.toFixed(3)} - cpE, ${e.toFixed(3)} + cpE, cpD));`).reverse().join('\n')}
  diffuseColor.rgb *= cpTone;
`;

/* ── 表面紋路 ─────────────────────────────────────────────────────
   貼圖怎麼來、每一種材料怎麼切階，全部在 surface.js。這裡只負責把它接到
   著色器上：切出來的三階（溝／平／凸）乘在 diffuseColor 上，**然後**才
   進五階調——所以紋路是材料的顏色，光照照舊只有那五塊平調。

   頂點那邊送三樣東西到片段：世界座標（投影用）、紋理方向、材料與偏移。
   材料編號在一塊幾何的三個頂點上都一樣，所以內插不會把它混掉，片段那邊
   取整數就是原值。 */

const SURF_U = (() => {
  const { a, b } = surfaceUniforms();
  return { a: { value: a }, b: { value: b } };
})();
const U_MOSS = { value: new THREE.Color(C.mossDark) };
let U_TEX = null;
const surfTex = () => {
  if (!U_TEX) {
    const [ta, tb] = surfaceTextures();
    U_TEX = { a: { value: ta }, b: { value: tb } };
  }
  return U_TEX;
};

const SURF_VERT_DECL = `
varying vec3 vSurfP;
varying vec3 vSurfG;
varying vec2 vSurf;
varying float vMossAt;
#ifndef CP_SURF_CONST
attribute vec4 aSurf;
attribute float aMoss;
#endif
`;
const SURF_VERT = `
  vSurfP = (modelMatrix * vec4(transformed, 1.0)).xyz;
#ifdef CP_SURF_CONST
  vSurfG = vec3(1.0, 0.0, 0.0);
  vSurf = vec2(float(CP_SURF_CONST), 0.0);
  vMossAt = 2.0;
#else
  vMossAt = aMoss;
  vSurfG = mat3(modelMatrix) * aSurf.xyz;
  float cpSW = floor(aSurf.w * 127.0 + 0.5);
  vSurf = vec2(floor(cpSW / 16.0), mod(cpSW, 16.0));
#endif
`;
const SURF_FRAG_DECL = `
uniform sampler2D uSurfTexA;
uniform sampler2D uSurfTexB;
uniform vec4 uSurfA[${SURF_DEF.length}];
uniform vec4 uSurfB[${SURF_DEF.length}];
uniform vec3 uMoss;
varying vec3 vSurfP;
varying vec3 vSurfG;
varying vec2 vSurf;
varying float vMossAt;
`;
/* 導數一律在分支之外取（dFdx／fwidth 在分支裡是未定義的），取樣用
   textureGrad 帶著顯式導數——一個面換到下一個面時投影的軸跳了，但世界
   座標是連續的，所以 mipmap 的層級不會在面與面的交界上跳一下。 */
const SURF_FRAG = `
  {
    vec3 cpN = normalize(vBandN);
    vec3 cpG = normalize(vSurfG + vec3(1e-5, 2e-5, 3e-5));
    float cpEnd = abs(dot(cpN, cpG));
    /* 端面：紋理方向正對著鏡頭這一面，換一組軸（上方向，或 x）。 */
    vec3 cpH = cpEnd > 0.7 ? (abs(cpN.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)) : cpG;
    vec3 cpT = normalize(cross(cpN, cpH));
    vec3 cpU = cross(cpT, cpN);
    int cpMi = int(vSurf.x + 0.5);
    if (cpMi == ${SURF.wood} && cpEnd > 0.7) cpMi = ${SURF.endGrain};
    vec4 cpA = uSurfA[cpMi], cpB = uSurfB[cpMi];
    vec3 cpDx = dFdx(vSurfP), cpDy = dFdy(vSurfP);
    vec3 cpP = vSurfP + vSurf.y * vec3(7.31, 3.17, 5.53);
    vec2 cpUV = vec2(dot(cpP, cpU), dot(cpP, cpT)) * cpA.zw;
    vec2 cpGX = vec2(dot(cpDx, cpU), dot(cpDx, cpT)) * cpA.zw;
    vec2 cpGY = vec2(dot(cpDy, cpU), dot(cpDy, cpT)) * cpA.zw;
    vec4 cpS = cpA.x < 0.5 ? textureGrad(uSurfTexA, cpUV, cpGX, cpGY)
                           : textureGrad(uSurfTexB, cpUV, cpGX, cpGY);
    float cpV = dot(cpS, vec4(equal(vec4(cpA.y), vec4(0.0, 1.0, 2.0, 3.0))));
    float cpW = max(fwidth(cpV) * 0.7, 0.012);
    float cpK = mix(cpB.z, 1.0, smoothstep(cpB.x - cpW, cpB.x + cpW, cpV));
    cpK = mix(cpK, cpB.w, smoothstep(cpB.y - cpW, cpB.y + cpW, cpV));
    if (cpMi == 0) cpK = 1.0;
    diffuseColor.rgb *= cpK;

    /* 苔：只長在石頭朝上的面上，一大塊一大塊的，而且跨磚連續（不吃每塊
       的偏移）——苔是從牆頂長過去的，不是一塊磚一塊磚貼上去的。也不整片
       換成苔色，底下的石色留三成：苔是「石頭的顏色變了」，不是一層漆。
       門檻逐頂點給（aMoss）：每一張圖的苔量不一樣，見 surface.js 的 mossAt。 */
    vec2 cpMU = vSurfP.xz / ${MOSS.size.toFixed(2)};
    float cpMv = textureGrad(uSurfTexA, cpMU, cpDx.xz / ${MOSS.size.toFixed(2)}, cpDy.xz / ${MOSS.size.toFixed(2)}).b;
    float cpMw = max(fwidth(cpMv) * 0.7, 0.012);
    float cpMoss = smoothstep(vMossAt - cpMw, vMossAt + cpMw, cpMv)
      * step(0.7, cpN.y) * (cpMi == ${SURF.stone} ? 1.0 : 0.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, uMoss * mix(0.8, 1.0, step(vMossAt + 0.09, cpMv)), cpMoss * ${MOSS.mix.toFixed(2)});
  }
`;

/**
 * 把五階調接到一顆 three 的 MeshBasicMaterial 上。
 *
 * 用 basic 而不是 toon／lambert，是因為這裡不需要 three 的燈——整個漫射
 * 項就是上面那五格，接在 `color_fragment` 之後（那時候 diffuseColor 已經
 * 是材質色 × 頂點色），霧與色彩管理仍然照 three 自己那一套走。
 *
 * @param {object} [o] surf：false 不上紋路；數字 = 整顆材質一種材料
 *   （單色材質用，沒有 aSurf 屬性）；true／不給 = 讀頂點的 aSurf
 */
function banded(m, o = {}) {
  const surf = o.surf === undefined ? true : o.surf;
  const konst = typeof surf === 'number';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBand = U_BAND;
    sh.uniforms.uKeyDir = U_KEYDIR;
    let vs = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBandN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBandN = mat3(modelMatrix) * normal;');
    let fs = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${BAND_DECL}`);
    if (surf !== false) {
      const T = surfTex();
      sh.uniforms.uSurfTexA = T.a;
      sh.uniforms.uSurfTexB = T.b;
      sh.uniforms.uSurfA = SURF_U.a;
      sh.uniforms.uSurfB = SURF_U.b;
      sh.uniforms.uMoss = U_MOSS;
      const def = konst ? `#define CP_SURF_CONST ${surf}\n` : '';
      vs = vs
        .replace('#include <common>', `${def}#include <common>\n${SURF_VERT_DECL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SURF_VERT}`);
      fs = fs
        .replace('#include <common>', `#include <common>\n${SURF_FRAG_DECL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${SURF_FRAG}\n${BAND_FRAG}`);
    } else {
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n${BAND_FRAG}`);
    }
    sh.vertexShader = vs;
    sh.fragmentShader = fs;
  };
  /* 開不開紋路、哪一種材料，是兩份不同的程式——three 用這個字串決定要
     不要重編，不給的話兩顆材質會共用第一顆編出來的那一份。 */
  m.customProgramCacheKey = () => `banded:${surf}`;
  return m;
}

/**
 * 一個吃頂點色的五階調材質。
 *
 * 整個區塊的幾何最後會合併成極少數幾個 mesh（見 geom.js 的 merge），
 * 顏色靠頂點色帶著走，所以這裡不分材質——四階石材、苔、鐵、布全部用
 * 同一顆材質畫完，一個 draw call。材料的紋路也一樣：每個頂點帶著自己是
 * 哪一種材料（aSurf），同一顆材質按頂點分。
 *
 * @param {object} [o] surf：false 關掉紋路（`?surf=0`，比效能用）
 */
export const toonVC = (o = {}) => banded(new THREE.MeshBasicMaterial({
  color: 0xffffff,
  vertexColors: true,
}), { surf: o.surf === false ? false : true });

/**
 * 單色的五階調材質（地面那一片、水面以外的道具）。
 * @param {number} color
 * @param {number|false} [surf] 整片是哪一種材料（SURF 的編號），false = 素色
 */
export const toon = (color, surf = false) => banded(new THREE.MeshBasicMaterial({ color }), { surf });

/* ── 顏色 → 材料 ──────────────────────────────────────────────────
   零件只說「這塊是什麼顏色」，材料由顏色認：石材四階都是石、兩階木料
   都是木……零件的呼叫端因此一行都不用改，而新加一個顏色時，它在這張表裡
   找不到就是素色——不上紋是安全的那一邊。要例外的零件在 `add` 給 `surf`。 */
export const SURF_OF = new Map([
  [C.stoneLit, SURF.stone], [C.stone, SURF.stone], [C.stoneDark, SURF.stone], [C.stoneDeep, SURF.stone],
  [C.granite, SURF.granite], [C.graniteDark, SURF.granite],
  [C.wood, SURF.wood], [C.woodDark, SURF.wood],
  [C.plaster, SURF.plaster], [C.plasterAlt, SURF.plaster],
  [C.tile, SURF.tile], [C.tileDark, SURF.tile],
  [C.iron, SURF.iron], [C.ironLit, SURF.iron],
  [C.banner, SURF.cloth], [C.bannerAlt, SURF.cloth],
  // 帆布、麻袋、稻草都是編出來的，走布紋。繩太細，紋路看不到，留素色。
  [C.canvas, SURF.cloth], [C.canvasDark, SURF.cloth], [C.sack, SURF.cloth], [C.straw, SURF.cloth],
]);

/** 自發光：火焰。不受光，直接就是那個顏色。 */
export const glow = (color) => new THREE.MeshBasicMaterial({ color });

/* ── 墨線 ────────────────────────────────────────────────────────
   只畫輪廓，不畫轉折。

   一塊倒角石頭上「兩面夾角超過 24°」的邊有四十幾條，全部畫出來的結果是
   每一塊石頭被自己的格線包住，幾千塊疊起來就是一張網——那不是卡通的
   墨線，那是線框圖。主角狗從來不是這樣描的：牠的墨線是一層翻面外殼，
   只在**輪廓**上露出來，身上的摺、關節、部位交界一條線都沒有。

   石頭不能用外殼（平法線的外殼會在每道倒角上裂開，這是這一段原本的
   結論，仍然成立），所以改成在同一批線上做輪廓判定：一條邊是輪廓，
   當且僅當它兩側的面一個朝著鏡頭、一個背對鏡頭。這件事每個頂點自己算
   得出來——邊的兩個面法線跟著幾何一起烘進緩衝區（見 geom.js 的 edgesOf），
   著色器量它們與視線的內積，同號就丟掉。

   於是：一個 draw、線還是那批線、鏡頭轉到哪裡就露出哪裡的輪廓；內部的
   轉折永遠畫不出來，因為它兩側的面永遠同時朝著鏡頭。

   判定放在**片段**著色器而不是頂點著色器：一條長邊可能只有一半是輪廓
   （曲面上很常見），逐片段丟棄會讓線從端點長出來或縮回去，逐頂點開關
   則是整條一起閃。 */

/** 墨線用的材質。輪廓判定接在 three 自己的 basic 著色器上。 */
export const inkLine = () => {
  const m = new THREE.LineBasicMaterial({ color: INK });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aN0;
attribute vec3 aN1;
varying vec2 vSil;`)
      /* 透視相機，所以視線是「從表面指向鏡頭」而不是一個常數方向。
         cameraPosition 是 three 一定會宣告的 uniform。 */
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vec3 cpV = cameraPosition - (modelMatrix * vec4(transformed, 1.0)).xyz;
  vSil = vec2(dot(aN0, cpV), dot(aN1, cpV));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSil;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  if (vSil.x * vSil.y > 0.0) discard;   // 兩側同時朝鏡頭／同時背對 = 內部轉折`);
  };
  return m;
};
