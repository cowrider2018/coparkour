/* ── test/src/grab.js ─────────────────────────────────────────────────
   拷一份這一幀已經畫好的畫面，給扭曲畫面的那幾樣讀（國王劈砍的氣流 gust.js、旋風斬的
   熱氣流 heat.js）。

   一幀最多拷一次：第一個要讀畫面的東西畫之前（它的 onBeforeRender 叫 copy）才拷，那時候
   其他東西都畫好了；同一幀後面再叫就不拷。場上沒有那幾樣的時候完全不花。

   讀的人共用兩個 uniform（`screen`、`res`）：畫布換大小、貼圖重建的時候，大家一起換到。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';

const _size = new THREE.Vector2();

export class Grab {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this._frame = -1;
    /** 拷下來的畫面（材質的 uScreen 直接用這一個 uniform）。 */
    this.screen = { value: null };
    /** 畫面多大（像素，材質的 uRes 直接用這一個 uniform）。 */
    this.res = { value: new THREE.Vector2(1, 1) };
    renderer.getDrawingBufferSize(this.res.value);
  }

  /** 這一幀第一次要讀畫面：拷一份（大小跟著畫布變）。 */
  copy() {
    const renderer = this.renderer, frame = renderer.info.render.frame;
    if (frame === this._frame) return;
    this._frame = frame;
    renderer.getDrawingBufferSize(_size);
    let tex = this.screen.value;
    if (!tex || tex.image.width !== _size.x || tex.image.height !== _size.y) {
      if (tex) tex.dispose();
      tex = this.screen.value = new THREE.FramebufferTexture(_size.x, _size.y);
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
    }
    renderer.copyFramebufferToTexture(tex);
    this.res.value.copy(_size);
  }
}
