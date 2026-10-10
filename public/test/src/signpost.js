/* ── test/src/signpost.js ───────────────────────────────────────────
   動態路標：主角身邊一圈（主角身高的一半那麼高），這個房間裡每一扇開著的門（route.js 的
   signposts：門、霧口、井、殘階）一支箭頭指著它，箭頭外面一行小字是通到哪裡
   （還沒去過的寫去那裡的目的）。
   主角走到哪，那一圈跟到哪；換了房間就換一套。

   箭頭照門的高度上下偏：指的那一點是感測區高度的 1/3（門是門檻上半個狗高），從主角身高的
   一半指過去——站在門前的那一層就是水平的；水窖往窄巷的殘階在上面，箭頭往上翹，窄巷的井
   在底下，箭頭往下壓。圈本身還是水平的（箭頭排在 xz 平面的一圈上），只有箭頭轉向。

   什麼時候有：不在打（模式給 `calm`）、門開著（沒有門的井與殘階一直開著）、主角
   還沒站到門口（離門口 NEAR 公尺以內就不指）。關著的門不指。每一支自己淡進淡出
   （FADE 秒）：開打、門關上、走到門口、換了房間，都是慢慢消失，不是一下子不見。

   畫在一張疊在 GL 上面的 2D 畫布（#signpost）上，不是放進場景裡：箭頭的四個角是
   世界裡的點，投影到畫面上再填色——所以它照透視縮，但永遠畫在最上面，
   主角站在它前面也擋不住。字是畫面上正的（讀得出來就好）。這一層在黑幕（#fade）
   與書頁底下，暗下去、翻漫畫的時候一起被蓋住。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { PHYS } from './walk.js';

/**
 * 箭頭在離主角中心多遠的那一圈上（公尺，水平量，指的是箭頭的中心）、箭頭多長多寬、字在多遠、
 * 站得多近就不指，淡進淡出幾秒。圈的高度是主角身高的一半（PHYS.height / 2）。
 */
const RING = 1.0;
const ARROW = { len: 0.46, half: 0.19, notch: 0.12 };
const LABEL = 1.6;
const NEAR = 1.5;
const FADE = 0.25;

const GOLD = '#f2c14e';
const INK = 'rgb(43, 35, 32)';

export class Signpost {
  /**
   * @param {HTMLCanvasElement} layer 疊在畫面上的那一張 2D 畫布（#signpost）
   * @param {HTMLCanvasElement} view GL 的畫布：投影出來的位置照它在頁面上的那一塊換算
   */
  constructor(layer, view) {
    this.layer = layer;
    this.view = view;
    this.g = layer.getContext('2d');
    /** 每一個感測區一筆：透明度（追 0 或 1）、名字、最後一次指的那一點。 */
    this._posts = new Map();
    this._v = new THREE.Vector3();
  }

  /** 世界座標 (x, y, z) → 頁面上的像素；在鏡頭後面的話是 null。 */
  _screen(camera, rect, x, y, z) {
    const v = this._v.set(x, y, z).project(camera);
    if (v.z > 1) return null;
    return [rect.left + (v.x + 1) / 2 * rect.width, rect.top + (1 - v.y) / 2 * rect.height];
  }

  /**
   * 這一幀：`posts` 是主角這個房間的路標（route.js 的 signposts），`doors` 每一扇門開不開
   * （stage.js 的 doors），`player` 是主角（腳在 x, y, z），`calm` 是不在打。
   */
  show(posts, doors, player, camera, dt, calm = true) {
    const { x, y, z } = player;
    const want = new Set();
    for (const sp of posts) {
      const open = !sp.door || !!doors[sp.door];
      if (!calm || !open || Math.hypot(sp.x - x, sp.z - z) < NEAR) continue;
      want.add(sp.portal);
      const o = this._posts.get(sp.portal);
      if (o) Object.assign(o, { x: sp.x, y: sp.y, z: sp.z, name: sp.name });
      else this._posts.set(sp.portal, { a: 0, name: sp.name, x: sp.x, y: sp.y, z: sp.z });
    }
    for (const [p, o] of this._posts) {
      o.a = Math.max(0, Math.min(1, o.a + (want.has(p) ? dt : -dt) / FADE));
      if (o.a === 0 && !want.has(p)) this._posts.delete(p);
    }
    this._draw(player, camera);
  }

  /** 全部馬上收掉（書頁蓋住的時候）：蓋住的這段時間不畫，掀開之後再淡進來。 */
  hide() {
    this._posts.clear();
    this._fit();
    this.g.clearRect(0, 0, this.layer.width, this.layer.height);
  }

  /** 畫布跟著視窗大小（與像素比）走。 */
  _fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
    if (this.layer.width !== w || this.layer.height !== h) { this.layer.width = w; this.layer.height = h; }
    return dpr;
  }

  _draw(player, camera) {
    const dpr = this._fit(), g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.layer.width, this.layer.height);
    if (!this._posts.size) return;
    camera.updateMatrixWorld();
    const rect = this.view.getBoundingClientRect();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineJoin = 'round';
    g.font = '600 13px system-ui, "Noto Sans TC", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const { x, z } = player, y = player.y + PHYS.height / 2;
    for (const o of this._posts.values()) {
      const dx = o.x - x, dy = o.y - y, dz = o.z - z, h = Math.hypot(dx, dz) || 1, d = Math.hypot(h, dy);
      const hx = dx / h, hz = dz / h;                              // 水平往門：箭頭排在圈上的哪裡
      const ux = dx / d, uy = dy / d, uz = dz / d, vx = -hz, vz = hx;   // 箭頭的長軸（往門，含上下）、橫軸（水平）
      // 箭頭：中心在圈上，長軸指著門（上下偏），四個點是尖、右後角、尾巴的凹、左後角。
      const cx = x + hx * RING, cz = z + hz * RING;
      const at = (along, side) => this._screen(camera, rect,
        cx + ux * along + vx * side, y + uy * along, cz + uz * along + vz * side);
      const L = ARROW.len / 2;
      const pts = [at(L, 0), at(-L, ARROW.half), at(-L + ARROW.notch, 0), at(-L, -ARROW.half)];
      // 字在箭頭外面，順著箭頭的方向（往上翹的箭頭，字也在上面）。
      const label = at(LABEL - RING, 0);
      if (pts.some((p) => !p) || !label) continue;
      g.globalAlpha = o.a;
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.closePath();
      g.lineWidth = 2.4;
      g.strokeStyle = INK;
      g.stroke();
      g.fillStyle = GOLD;
      g.fill();
      g.lineWidth = 3.5;
      g.strokeText(o.name, label[0], label[1]);
      g.fillText(o.name, label[0], label[1]);
    }
    g.globalAlpha = 1;
  }
}
