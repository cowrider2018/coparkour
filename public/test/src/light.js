/* ── test/src/light.js ───────────────────────────────────────────
   光影的集合點。

   每一種光影效果是 light/ 底下的一支檔案，各自可以交出兩樣東西：

     · `shade`   一段接進地形五階調著色器（palette.js 的 banded）的 GLSL：
                   decl  宣告（uniform、函式），放在片段著色器的 common 後面
                   pre   在算出 cpD = dot(N, KEY_DIR) 之後、分階之前——
                         改 cpD 就是改這個片段落在哪一階（投影就是把它壓到
                         最暗那一階的下緣以下）
                   post  在 `diffuseColor.rgb *= cpTone` 之後——加光、加霧
                 可用的值：vLightP（世界座標）、vBandN（世界法線，未正規化）、
                 cpD、cpTone、diffuseColor、uKeyDir、cameraPosition。
                 變數一律 cp 開頭、再加自己的縮寫（cpSh…、cpFl…），免得撞名。
     · `setup(ctx)`  建場景物件，回傳 { update?(f), render?(draw) }。
                   ctx = { scene, renderer, camera, ruins (沒有遺跡的那一頁是
                         null), cols, arenas }
                   f   = { dt, now, player, block, foes, crowd }（foes 是怪物狀態，
                         各有 x y z；crowd 是不是怪物的那幾隻（人民、國王），
                         各有 x y z aimX aimZ size；沒有就是空陣列）
                   render(draw)：要接管最後那一筆畫面（後製）的才給；draw()
                         就是原本的 renderer.render(scene, camera)。只能有一支。

   順序就是下面這張表的順序。shade 的字串在材質第一次編譯時才讀（見
   palette.js），所以 light/ 底下的檔案可以 import palette.js，只要不在
   模組頂層就去讀它的值。
   ------------------------------------------------------------------ */

import * as mood from './light/mood.js';
import * as shadow from './light/shadow.js';
import * as flame from './light/flame.js';
import * as air from './light/air.js';
import * as contact from './light/contact.js';
import * as post from './light/post.js';

const PARTS = [mood, shadow, flame, air, contact, post];

/** 所有 shade 接成一份：palette.js 的 banded 在 onBeforeCompile 裡叫。 */
export function lightShade() {
  const out = { uniforms: {}, decl: '', pre: '', post: '' };
  for (const p of PARTS) {
    const s = p.shade;
    if (!s) continue;
    Object.assign(out.uniforms, s.uniforms || {});
    out.decl += s.decl || '';
    out.pre += s.pre || '';
    out.post += s.post || '';
  }
  return out;
}

/**
 * 一頁的光影。三個模式各建一份，每幀 `update`，最後用 `render` 取代
 * `renderer.render(scene, camera)`。
 */
export function createLight({ scene, renderer, camera, ruins = null, cols = [], arenas = [] }) {
  const ctx = { scene, renderer, camera, ruins, cols, arenas };
  const live = PARTS.map((p) => (p.setup ? p.setup(ctx) : null)).filter(Boolean);
  const draw = () => renderer.render(scene, camera);
  const owner = live.find((l) => l.render);
  return {
    /** @param {{dt: number, now: number, player: object, block?: string, foes?: object[], crowd?: object[]}} f */
    update(f) {
      const g = { block: null, foes: [], crowd: [], ...f };
      for (const l of live) if (l.update) l.update(g);
    },
    render() {
      if (owner) owner.render(draw);
      else draw();
    },
  };
}
