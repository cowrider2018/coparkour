/* ── test/src/monster.js ──────────────────────────────────────
   怪物的外觀：立耳犬，紅眼睛。一個系列一件毛，系列裡靠體型分：

     minion  殭屍：純綠色，一般大小。
     boss    殭屍 BOSS：同一件綠毛，兩倍大。
     ghost   幽靈：淡藍白，半透明，一般大小。

   只是看起來大：碰撞還是 combat.js 那同一個 PHYS 圓柱。

   半透明是畫兩趟：Critter 原本那一個網格只寫深度、不上色，再疊一個共用同一份
   幾何與骨頭的網格照 alpha 混色。只畫一趟的話，自己身體後面的腿、墨線的內面
   都會透出來，看起來是一團疊在一起的線。兩個網格的 renderOrder 一樣、位置一樣，
   three 的半透明排序這時照建立的先後（id），所以先建的那一個（寫深度）先畫。

   是遊戲那隻狗本人（試玩場 critter.js 的 Critter，同一份 cat.bin 資料），
   只是毛色不是 cat.bin 裡的任何一件：每個頂點的顏色在這裡直接寫，
   照它屬於哪一根骨頭分——眼睛那兩根是紅的，其他全部是那一類的毛色。臉上的
   鼻子與嘴（`unlit` 群組裡不是眼睛的那些）用深一階的同色，不然整張臉糊成
   一片，看不出哪一邊是頭。

   顏色跟 cat.bin 一樣是 sRGB 的 0～1（Critter 的著色器自己轉線性），
   所以這裡的數字就是畫面上看到的那個顏色，不必先轉。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { Critter } from './critter.js';

/** 毛色：body 身上、face 鼻子與嘴。 */
const ZOMBIE = { body: [0.24, 0.80, 0.22], face: [0.08, 0.36, 0.08] };
const GHOST = { body: [0.78, 0.88, 0.98], face: [0.34, 0.44, 0.60] };
/**
 * 每一類的外觀，鍵跟 combat.js 的 KINDS 一樣：毛色、畫多高（公尺）、不透明度
 * （1 = 不透明）。
 */
const LOOKS = {
  minion: { coat: ZOMBIE, height: 1.0, alpha: 1 },
  boss: { coat: ZOMBIE, height: 2.0, alpha: 1 },
  ghost: { coat: GHOST, height: 1.0, alpha: 0.5 },
};
/** 這一類畫多高，跟狗（1）比。落地的粉塵照它算（dust.js）。 */
export const sizeOf = (kind) => LOOKS[kind].height;

const RED = [0.95, 0.08, 0.06];
/** 半透明的怪物畫在地上那些預告與攻擊範圍（fx.js，renderOrder 2～4）之後，才透得出它們。 */
const SEE_THROUGH_ORDER = 5;

/**
 * 做一隻怪物的外觀。借玩家那個 Zoo 已經讀好的立耳犬資料，不再讀一次 cat.bin。
 *
 * @param {import('./critter.js').Zoo} zoo
 * @param {string} kind KINDS 的鍵
 * @returns {Critter}
 */
export function makeMonsterCritter(zoo, kind) {
  const data = zoo.critters.get('dog-prick').data;
  const look = LOOKS[kind];
  const c = new Critter(data, 'dog-prick', { height: look.height });
  c.setHat(false);
  paint(c, look.coat);
  if (look.alpha < 1) seeThrough(c, look.alpha);
  return c;
}

/** 讓一隻 Critter 半透明：原本的網格只寫深度，另一個網格照 alpha 上色（理由見檔頭）。 */
function seeThrough(c, alpha) {
  const depth = c.mesh;
  /* 材質的 clone 不帶 onBeforeCompile 與快取鍵，要自己接上——骨頭與毛色的
     著色都在那裡面。uniform 是 rig3 閉包裡的同一份，所以兩個網格一起動。 */
  const tint = depth.material.map((m) => {
    const t = m.clone();
    t.onBeforeCompile = m.onBeforeCompile;
    t.customProgramCacheKey = m.customProgramCacheKey;
    t.transparent = true;
    t.opacity = alpha;
    t.depthWrite = false;
    return t;
  });
  for (const m of depth.material) { m.transparent = true; m.colorWrite = false; }
  const mesh = new THREE.Mesh(c.geometry, tint);
  mesh.position.copy(depth.position);
  mesh.scale.copy(depth.scale);
  mesh.frustumCulled = false;
  depth.renderOrder = mesh.renderOrder = SEE_THROUGH_ORDER;
  depth.parent.add(mesh);
}

/** 照骨頭上色。Critter 沒有「自訂毛色」的入口，所以直接寫它的顏色屬性。 */
function paint(c, coat) {
  const out = c._colorAttr.array;
  const nv = out.length / 3;
  const face = new Uint8Array(nv);
  const idx = c.data.index, g = c._unlitGroup;
  for (let i = g.start; i < g.start + g.count; i++) face[idx[i]] = 1;
  for (let v = 0; v < nv; v++) {
    const eye = c.rig.names[c._boneId[v]].startsWith('eye');
    const col = eye ? RED : face[v] ? coat.face : coat.body;
    out[v * 3] = col[0]; out[v * 3 + 1] = col[1]; out[v * 3 + 2] = col[2];
  }
  c._colorAttr.needsUpdate = true;
}
