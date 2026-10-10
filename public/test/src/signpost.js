/* ── test/src/signpost.js ───────────────────────────────────────────
   動態路標：主角身邊一圈，這個房間裡的每一個感測區（route.js 的 signposts：門、霧口、
   井、殘階）一支箭頭指著它，箭頭外面一行小字是通到哪裡。主角走到哪，那一圈跟到哪；
   換了房間就換一套。

     開著（或沒有門的：井、殘階）  金色——走過去就會被送走。
     關著                          灰色——門在那裡，現在過不去。

   畫在畫面上（#signpost，一層疊在 GL 上面的 DOM），不是放進場景裡：鏡頭在主角
   後上方、幾乎平視，貼地的箭頭從這個角度看是扁的，正前方那一支整個被主角擋住、
   字疊在身上。所以圈是畫面上的一圈，圓心是主角身體中間投影到畫面上的那一點，
   半徑跟著主角在畫面上多高；方向照門在主角的哪一邊、相對鏡頭的朝向擺——正前方
   的門在頭頂上面，右手邊的在右邊，背後的在腳下（像一個跟著鏡頭轉的指南針）。
   這一層在黑幕（#fade）與書頁底下，暗下去、翻漫畫的時候一起被蓋住。

   主角已經站在門口（離門口 NEAR 公尺以內）的那一支不畫：門就在眼前，箭頭只會繞著
   腳下亂轉。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { PHYS } from './walk.js';

/**
 * 圈的半徑是主角在畫面上身高的幾倍（夾在 MIN～MAX 像素）、字從箭頭再往外幾像素，
 * 站得多近（公尺）就不畫。
 */
const RING = { k: 0.95, min: 64, max: 200 };
const GAP = 14;
const NEAR = 1.5;

const ARROW_SVG = '<svg viewBox="-12 -12 24 24" width="24" height="24" aria-hidden="true">'
  + '<path d="M0 -10 L8 8 L0 3.5 L-8 8 Z" /></svg>';

export class Signpost {
  /**
   * @param {HTMLElement} layer 疊在畫面上的那一層（#signpost）
   * @param {HTMLCanvasElement} canvas GL 的畫布：投影出來的位置照它在頁面上的那一塊換算
   */
  constructor(layer, canvas) {
    this.layer = layer;
    this.canvas = canvas;
    /** 每一個感測區一支（第一次用到才建）。 */
    this._posts = new Map();
    this._v = new THREE.Vector3();
    this._f = new THREE.Vector3();
  }

  _post(sp) {
    let o = this._posts.get(sp.portal);
    if (o) return o;
    const arrow = document.createElement('i');
    arrow.innerHTML = ARROW_SVG;
    const label = document.createElement('span');
    label.textContent = sp.name;
    this.layer.append(arrow, label);
    o = { arrow, label };
    this._posts.set(sp.portal, o);
    return o;
  }

  /** (x, y, z) 投影到頁面上的像素位置。 */
  _screen(camera, x, y, z) {
    const r = this.canvas.getBoundingClientRect();
    const v = this._v.set(x, y, z).project(camera);
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
  }

  /**
   * 擺這一幀：`posts` 是主角這個房間的路標（route.js 的 signposts），`doors` 是每一扇門
   * 開不開（stage.js 的 doors），`player` 是主角（腳在 x, y, z）。`posts` 以外的全部收起來。
   */
  show(posts, doors, player, camera) {
    const { x, y, z } = player;
    camera.updateMatrixWorld();
    const [cx, cy] = this._screen(camera, x, y + PHYS.height / 2, z);
    const [, top] = this._screen(camera, x, y + PHYS.height, z);
    const [, foot] = this._screen(camera, x, y, z);
    const R = Math.min(RING.max, Math.max(RING.min, RING.k * Math.abs(foot - top)));
    // 鏡頭水平的前方與右手邊：門在主角的哪一邊就照這兩個方向換成畫面上的方向。
    const f = camera.getWorldDirection(this._f);
    const fl = Math.hypot(f.x, f.z) || 1, fx = f.x / fl, fz = f.z / fl;
    const on = new Set();
    for (const sp of posts) {
      const dx = sp.x - x, dz = sp.z - z;
      if (Math.hypot(dx, dz) < NEAR) continue;
      const o = this._post(sp);
      on.add(o);
      const a = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);   // 0 = 正前方，往右是正
      const sx = Math.sin(a), sy = -Math.cos(a);
      const open = !sp.door || !!doors[sp.door];
      o.arrow.className = o.label.className = open ? 'open' : 'shut';
      o.arrow.style.transform = `translate(${cx + sx * R}px, ${cy + sy * R}px) translate(-50%, -50%) rotate(${a}rad)`;
      // 字貼在箭頭外面：靠圓心的那一邊對著箭頭，往外長。
      o.label.style.transform = `translate(${cx + sx * (R + GAP)}px, ${cy + sy * (R + GAP)}px) `
        + `translate(${-50 + 50 * sx}%, ${-50 + 50 * sy}%)`;
      o.arrow.hidden = o.label.hidden = false;
    }
    for (const o of this._posts.values()) if (!on.has(o)) o.arrow.hidden = o.label.hidden = true;
  }

  /** 全部收起來（書頁蓋住、沒有主角的時候）。 */
  hide() {
    for (const o of this._posts.values()) o.arrow.hidden = o.label.hidden = true;
  }
}
