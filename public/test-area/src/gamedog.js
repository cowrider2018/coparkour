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
     圓角   `shape.js` 的部位表與它量出來的矩形。遊戲在螢幕空間把每個
            部位的輪廓壓成圓角矩形；這裡改成在載入時把那個形狀烘進頂點，
            見下面「圓角方形」那一段。

   沒搬的是「那個渲染器是什麼」，而那是刻意的：

     · 螢幕空間那個作法本身（shape.js 的 warpToRect），以及它第二段
       「法線側視才拉」的視角門檻。理由見下面那一段。
     · 尾巴尖的方頭（TAIL_CAP_GLSL）。它要 rrRadius，是彎折那一套的一部分，
       而它只影響尾巴末端那兩三個像素。
     · gl.depthRange 分段遮擋、遠側那隻眼睛的收合、正交側視相機。前兩個
       是為了「一排貓在 2D 畫面上疊起來」，這裡只有一隻而且有真的深度緩衝；
       第三個正是這一頁不要的東西。
     · 三階調著色器本身。改用 three 的 MeshToonMaterial 加同一張 3 階
       梯度圖（palette.js 的 ramp），所以狗和石頭是被同一盞燈、同一組
       色階照的——那才是「同一個作品」的意思。

   ── 圓角方形：為什麼是烘進幾何，而不是照抄螢幕空間那一版 ─────────
   那個造型是這隻動物的招牌，所以它必須跟過來；跟過來的方式換了。

   遊戲的作法是在螢幕上做：拿骨頭 +Y 投影到螢幕當「上」，三個半徑用
   平方和求支撐得到一個橢圓，再把每個頂點按同方向、同比例送到圓角矩形
   的邊界上。那個矩形只在那台正交側視相機下有定義——這一頁的相機是自由
   的，同一個部位從別的角度看，「螢幕上的矩形」是另一個矩形，於是繞著
   看的時候形狀會跟著鏡頭變。那讀起來是抖動，不是造型。

   所以這裡把同一件事搬到骨頭的局部空間，並且在載入時做一次：

     · 部位表與矩形都是 shape.js 的。`measureShapes` 回傳的 `half` 已經
       把 `scale` 與 `norm`（部位實際填滿它自己包圍盒的比例）折進去了，
       所以頭的 0.86、每個部位的圓角比例、耳朵與臉不彎的規則，全部是
       遊戲那一份，不是這裡重新猜的。頭的 0.86 尤其不能少：圓角矩形的
       頂是一條線而不是一個點，少了它那條線會升起來吃掉耳朵。
     · 每個頂點量它在「部位的橢球」上的比例 u，再放到「圓角盒」邊界的
       同一個比例上。落在橢球上的落在盒上，裡面的跟著走——這就是遊戲
       那第一段。超出去的（u > 1）夾在盒上，所以盒是邊界而不是目標，
       那是遊戲那句 `min(mix(t, target, w), target)` 的意思。
     · 法線不動。這是整個作法的重點：出來的是圓角矩形的輪廓，照真實
       曲面著色。所以三階調的色階分佈還是那隻狗的（頭 52/14/34、
       前掌 28/40/32），不是每個部位都一樣。
     · `outline` 群組烘到「大一圈」的盒上（半徑加 INK_OUT）。少了這一步
       墨線會被壓進填色裡而消失——遊戲那邊是用 uInkOut 做同一件事。
     · 沒有搬過來的是第二段那個視角門檻（法線側視 + 已經靠外才拉到底）。
       它需要視線方向，而視線方向在自由相機下每幀都不一樣，那正是上面
       說的抖動。少了它，輪廓不會「精確」是矩形而是「非常接近」矩形，
       而那個差在遊戲裡是 40 px 高的貓身上的 2 px。

   代價講清楚：深度那一軸（模型 X）也被壓成方的。遊戲沒有約束它，因為
   側視相機永遠看不到它；這一頁看得到，而看得到的時候「三個軸都是圓角
   盒」比「兩軸方、一軸圓」一致。

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

/* 烘圓角盒的時候，`outline` 群組的目標盒要比填色的大這麼多（模型單位）。
   跟 INK_GROW 同一個值：一個是沿法線推的那一點，一個是輪廓上那一圈，
   兩者疊起來就是墨線的寬度。 */
const INK_OUT = INK_GROW;

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

const DECL = (boneN) => `
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
`;

const BEGIN_NORMAL = `
  vec3 objectNormal = cpSkinNrm();
`;
const BEGIN_VERTEX = `
  vec3 transformed = cpSkinPos();
`;

/**
 * 把骨架接到一顆 three 材質上。
 *
 * 材質仍然是 three 的（光、霧、色彩管理、三階調的梯度圖全部照 three 的
 * 那一套走），只有「頂點在哪裡」被換掉。
 */
function rig3(material, uniforms, boneN, grow) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uGrow: { value: grow } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DECL(boneN)}`)
      .replace('#include <beginnormal_vertex>', BEGIN_NORMAL)
      .replace('#include <begin_vertex>', BEGIN_VERTEX);
  };
  // 同一顆材質的不同 grow 要各自編譯一份，不然 three 會把它們當同一支程式。
  material.customProgramCacheKey = () => `cpdog${boneN}:${grow}`;
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

    /* 兩份頂點：原封不動的那一份，與烘成圓角盒的那一份。留著原始的那份
       是為了 B 鍵——同一隻狗、同一個姿勢，一鍵切換有沒有圓角，是唯一能
       判斷「圓角調得對不對」的方式，而那個判斷只能在瀏覽器裡用眼睛做。 */
    this.rawPosition = Float32Array.from(data.position);
    this.position = Float32Array.from(data.position);
    this.bakeStats = this._bakeRoundBox();
    this._bend = true;
    this._buildGeometry();
    this._buildMesh(opts);
  }

  /* ── 圓角方形，烘進頂點 ────────────────────────────────────────
     檔頭那一段講了為什麼是烘的。這裡是怎麼烘的。

     頂點本來就住在自己那根骨頭的局部空間裡（著色器是 bone × position，
     沒有蒙皮權重），而包圍盒也是在那個空間量的，所以這件事不需要任何
     座標轉換——量完就地改。

     ── 為什麼不用 shape.js 的 measureShapes ──────────────────────
     部位表（哪幾根骨頭、圓角多少、頭的 0.86、耳朵騎在頭上）用的是它的，
     那是那個造型的品味所在，重新猜一遍毫無意義。但矩形的「大小」這裡
     自己量，因為 measureShapes 回傳的 half 已經折進了 `norm`——那是
     「真實輪廓相對於平方和支撐橢圓能伸多遠」，量的是螢幕上那個二維構造
     （0.93 給頭）。搬到三維會答錯方向：橢球比支撐橢圓小，於是 half 再乘
     0.93 之後，大量頂點落在橢球外面，全部被夾到盒面上——實測 18,128 個
     被移動的頂點裡有 13,081 個是被夾的，出來是一隻縮了一圈、外殼硬掉的
     狗。用原始包圍盒就沒有這個問題，而且尺寸自己會對：軸向上橢球半徑
     等於盒半徑，所以映射在三個軸上是恆等式，只有斜向被推出去。 */
  _bakeRoundBox() {
    const d = this.data;
    const col = d.colors.get(this.skins[0]);
    const range = groupVertexRanges(d);
    const boxes = boneBoxes(d, col, range.outline);

    /* 部位表 → 每根骨頭一份 {half, radius}。`ride` 的那幾根（耳朵）記成
       「不准彎」而不是「沒有矩形」：兩者在這裡的行為一樣，但寫成前者才
       說得出為什麼——耳朵是三角形，圓掉它就不是那隻動物了。 */
    const byBone = new Map();
    const rides = new Set();
    for (const p of this.model.parts) {
      const b = this.rig.bone(p.bone);
      const box = boxes.get(b);
      if (!box) continue;                // 這根骨頭在 outline 群組裡沒有幾何
      const sc = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale;
      byBone.set(b, {
        center: [0, 1, 2].map((k) => (box.max[k] + box.min[k]) / 2),
        half: [0, 1, 2].map((k) => Math.max(1e-4, ((box.max[k] - box.min[k]) / 2) * sc[k])),
        radius: p.radius,
      });
    }
    for (const child of Object.keys(this.model.ride || {})) {
      try { rides.add(this.rig.bone(child)); } catch { /* 這副骨架沒有這根 */ }
    }

    const P = this.position;
    let moved = 0, clamped = 0;
    for (let v = 0; v < d.header.vertexCount; v++) {
      const b = col[v * 4 + 3] & 31;
      const part = byBone.get(b);
      if (!part || rides.has(b)) continue;
      if (v >= range.unlit[0] && v < range.unlit[1]) continue;   // 臉不彎
      const ink = (v >= range.outline[0] && v < range.outline[1]) ? INK_OUT : 0;

      const h = part.half;
      const cx = part.center[0], cy = part.center[1], cz = part.center[2];
      /* 先把空間按三個半徑正規化，圓角在「單位立方」上做，做完再縮回去。

         這一步不是為了漂亮，是為了帽簷。圓角比例在 shape.js 的定義是
         「較短半邊的幾分之幾」，那句話在螢幕上的二維矩形裡沒有問題；
         三維直接取三軸的最小值就會答錯：帽簷的半徑是 (1.95, 0.19, 1.95)，
         最小的是厚度 0.19，於是圓角只有 0.095——一片幾乎是直角的方板。
         正規化之後圓角是「每個軸各佔自己半徑的同一個比例」，帽簷因此在
         平面上圓成一個盤、在厚度上圓成一個軟邊，正是它該有的樣子。
         而在三軸差不多長的部位（頭、身體）上，兩種算法幾乎一樣。 */
      const nx = (P[v * 3] - cx) / h[0];
      const ny = (P[v * 3 + 1] - cy) / h[1];
      const nz = (P[v * 3 + 2] - cz) / h[2];
      const u = Math.hypot(nx, ny, nz);
      if (u < 1e-6) continue;
      const dx = nx / u, dy = ny / u, dz = nz / u;

      /* 正規化之後，部位的橢球就是單位球（每個方向半徑都是 1），所以
         u 本身就是「這個頂點在橢球上的比例」。圓角立方的邊界半徑照方向
         算一次，映射就是把 u 乘上去。 */
      const rBox = roundUnitCube(dx, dy, dz, part.radius);
      // 盒是邊界不是目標：伸出橢球外面的頂點夾在盒上。
      const want = Math.min(u * rBox, rBox);
      if (Math.abs(want - u) > 1e-5) moved++;
      if (u * rBox > rBox) clamped++;
      let wx = cx + dx * want * h[0];
      let wy = cy + dy * want * h[1];
      let wz = cz + dz * want * h[2];
      /* 墨線那一圈：外殼再沿「世界方向」往外推 INK_OUT。在正規化空間裡
         加的話，薄的那一軸會被放大成一大塊，所以這一步要在縮回去之後做。 */
      if (ink) {
        const ex = dx * h[0], ey = dy * h[1], ez = dz * h[2];
        const el = Math.hypot(ex, ey, ez) || 1;
        wx += (ex / el) * ink; wy += (ey / el) * ink; wz += (ez / el) * ink;
      }
      P[v * 3] = wx;
      P[v * 3 + 1] = wy;
      P[v * 3 + 2] = wz;
    }
    return { parts: byBone.size, rides: rides.size, moved, clamped, total: d.header.vertexCount };
  }

  /* ── 幾何 ─────────────────────────────────────────────────────
     一份 BufferGeometry，三個 draw range。範圍就是檔案自己的三個群組，
     順序也是檔案自己的（lit、unlit、outline，頂點範圍互不重疊）——
     那個佈局是 build.js 保證的，這裡只是照著用。 */
  _buildGeometry() {
    const d = this.data;
    const nv = d.header.vertexCount;
    const g = new THREE.BufferGeometry();

    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));

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
    this._uniforms = {
      uBones: { value: this.rig.matrices },
      uSwayQ: { value: this.sway.qs },
      uSwayBend: { value: this.sway.bend },
    };

    /* 皮毛：three 的三階調材質，梯度圖是 palette.js 那一張——石頭用的
       同一張。狗和牆因此是同一盞燈照的，那是這一頁最要緊的一致性。 */
    const fur = rig3(new THREE.MeshToonMaterial({
      vertexColors: true, gradientMap: ramp(),
    }), this._uniforms, boneN, 0);
    /* 臉：cat.bin 的 `unlit` 群組——眼睛、鼻子、嘴。它在遊戲裡就是不吃
       光的，所以這裡是 Basic 而不是 Toon。 */
    const face = rig3(new THREE.MeshBasicMaterial({
      vertexColors: true,
    }), this._uniforms, boneN, 0);
    /* 墨線：翻面外殼。cat.bin 的 `outline` 群組佔 44% 的三角形，就是為
       這個存在的——正面剔除之後剩下背面，被身體擋住，只在輪廓外露出一圈。
       three 這邊 side: BackSide 就是「剔除正面」。 */
    const ink = rig3(new THREE.MeshBasicMaterial({
      color: INK, side: THREE.BackSide,
    }), this._uniforms, boneN, INK_GROW);

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
      const P = this.position;
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
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
   * 圓角方形開或關。關掉就是 cat.bin 原本的曲面網格（等於遊戲
   * `CatLayer` 的 `mesh` 樣式），開著是烘過的圓角盒。
   *
   * 換的是同一個 attribute 的內容，不是重建幾何——所以切換不會有一幀
   * 空白，也不會重新配置 GPU 記憶體。
   */
  setBend(on) {
    if (!!on === this._bend) return;
    this._bend = !!on;
    const attr = this.geometry.attributes.position;
    attr.array.set(this._bend ? this.position : this.rawPosition);
    attr.needsUpdate = true;
  }

  get bendOn() { return this._bend; }

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

/* ── 圓角立方的邊界 ─────────────────────────────────────────────
   半徑 1 的立方，角上圓掉 r（r = 0.5 是一顆球，r = 0 是一個方塊）。
   從中心沿方向 d 射出去，邊界在 sdf(t·d) = 0 的地方；sdf 沿著射線單調
   遞增，所以二分法就夠，而且是精確的——這是載入時做一次的事，不必為它
   找封閉解。呼叫的人已經把空間正規化過，所以這裡沒有半徑，只有比例。 */
function roundUnitCube(dx, dy, dz, radiusFrac) {
  const r = Math.min(0.999, Math.max(0, radiusFrac));
  const b = 1 - r;
  const sd = (t) => {
    const qx = Math.abs(dx * t) - b;
    const qy = Math.abs(dy * t) - b;
    const qz = Math.abs(dz * t) - b;
    const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
    return Math.hypot(mx, my, mz) + Math.min(Math.max(qx, qy, qz), 0) - r;
  };
  let lo = 0, hi = 2;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (sd(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/* 三個群組各自的頂點範圍。build.js 的 flatten 是照 lit、unlit、outline
   的順序鋪的，所以每一群的頂點是一段連續的區間——但那是「保證」而不是
   「假設」，所以這裡照索引量一遍，量完順手檢查它們真的不重疊。 */
function groupVertexRanges(data) {
  const out = {};
  for (const g of data.header.groups) {
    let lo = Infinity, hi = -1;
    for (let i = g.start; i < g.start + g.count; i++) {
      const v = data.index[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out[g.name] = [lo, hi + 1];
  }
  const order = ['lit', 'unlit', 'outline'];
  for (let i = 1; i < order.length; i++) {
    const a = out[order[i - 1]], b = out[order[i]];
    if (!a || !b || a[1] > b[0]) {
      throw new Error(`gamedog: ${order[i - 1]} 與 ${order[i]} 的頂點範圍重疊了`);
    }
  }
  return out;
}

/* 每根骨頭在某個群組裡的包圍盒，量在骨頭自己的局部空間。
   用 `outline` 群組量，跟 shape.js 一樣：外殼是整個部位的最外圈，
   所以它的盒就是這個部位「有多大」。 */
function boneBoxes(data, col, vertexRange) {
  const boxes = new Map();
  for (let v = vertexRange[0]; v < vertexRange[1]; v++) {
    const b = col[v * 4 + 3] & 31;
    let a = boxes.get(b);
    if (!a) { a = { min: [1e30, 1e30, 1e30], max: [-1e30, -1e30, -1e30] }; boxes.set(b, a); }
    for (let k = 0; k < 3; k++) {
      const p = data.position[v * 3 + k];
      if (p < a.min[k]) a.min[k] = p;
      if (p > a.max[k]) a.max[k] = p;
    }
  }
  return boxes;
}
