/* ── combat-area/src/monster.js ──────────────────────────────────────
   怪物的外觀：立耳犬，每一類一件純色的毛、紅眼睛。

     minion  小怪：純綠色。
     boss    BOSS：紫色。

   是遊戲那隻狗本人（試玩場 critter.js 的 Critter，同一份 cat.bin 資料），
   只是毛色不是 cat.bin 裡的任何一件：每個頂點的顏色在這裡直接寫，
   照它屬於哪一根骨頭分——眼睛那兩根是紅的，其他全部是那一類的毛色。臉上的
   鼻子與嘴（`unlit` 群組裡不是眼睛的那些）用深一階的同色，不然整張臉糊成
   一片，看不出哪一邊是頭。

   顏色跟 cat.bin 一樣是 sRGB 的 0～1（Critter 的著色器自己轉線性），
   所以這裡的數字就是畫面上看到的那個顏色，不必先轉。
   ------------------------------------------------------------------ */

import { Critter } from '../../test-area/src/critter.js';

/** 每一類的毛色：body 身上、face 鼻子與嘴。鍵跟 combat.js 的 KINDS 一樣。 */
const COATS = {
  minion: { body: [0.24, 0.80, 0.22], face: [0.08, 0.36, 0.08] },
  boss: { body: [0.50, 0.22, 0.72], face: [0.20, 0.07, 0.30] },
};
const RED = [0.95, 0.08, 0.06];

/**
 * 做一隻怪物的外觀。借玩家那個 Zoo 已經讀好的立耳犬資料，不再讀一次 cat.bin。
 *
 * @param {import('../../test-area/src/critter.js').Zoo} zoo
 * @param {string} kind KINDS 的鍵
 * @returns {Critter}
 */
export function makeMonsterCritter(zoo, kind) {
  const data = zoo.critters.get('dog-prick').data;
  const c = new Critter(data, 'dog-prick', { height: 1.0 });
  c.setHat(false);
  paint(c, COATS[kind]);
  return c;
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
