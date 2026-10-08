/* ── test/src/hearts.js ─────────────────────────────────────────────
   主角頭頂上那一排愛心：最大血量幾顆，還剩的那幾顆是滿的、扣掉的是空的
   （combat.js 的 LIFE）。

   一顆心是一張 Sprite（永遠正對鏡頭），整排掛在一個 Group 上、Group 轉成鏡頭的
   朝向，所以排開的方向是畫面上的左右。一排最多 ROW 顆，多的往上疊一排。
   不吃深度、不吃霧：牆或怪物擋在前面也看得到。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { INK } from './palette.js';

/** 一顆心多大（公尺）、隔多遠、一排幾顆、離腳多高。 */
const SIZE = 0.3;
const GAP = 0.32;
const ROW = 5;
const LIFT = 1.55;

const INK_CSS = `#${INK.toString(16).padStart(6, '0')}`;

/**
 * 心形的外框，在 64×64 的格子裡：上面兩個圓的瓣，兩側往外鼓著收到底下一個圓的
 * 尖——側邊的控制點都在弦的外側，所以整條邊是凸的，沒有往裡凹的地方。
 */
function heartPath(g) {
  g.beginPath();
  g.moveTo(29, 55.5);
  g.bezierCurveTo(20, 50, 7.5, 40, 7.5, 25);
  g.arc(20, 24.5, 12.5, Math.PI, Math.PI * 2 - 0.55);
  g.arc(44, 24.5, 12.5, Math.PI + 0.55, Math.PI * 2);
  g.bezierCurveTo(56.5, 40, 44, 50, 35, 55.5);
  g.quadraticCurveTo(32, 58.5, 29, 55.5);
  g.closePath();
}

/**
 * 一顆心的圖（128 px 畫 64 格）。
 *   滿的  紅色；右下沿著邊一層深一點的弧形陰影（整顆心往左上縮一點之後剩下的那
 *         一圈），看起來是鼓的；細的墨線描邊。
 *   空的  半透明的深色，一樣的描邊——扣掉的血。
 */
function heartTexture(full) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.scale(2, 2);
  g.lineJoin = 'round';
  heartPath(g);
  if (full) {
    g.save();
    g.clip();
    g.fillStyle = '#b8262a';
    g.fillRect(0, 0, 64, 64);
    g.translate(-2.2, -2.4);
    g.translate(32, 32);
    g.scale(0.94, 0.94);
    g.translate(-32, -32);
    heartPath(g);
    g.fillStyle = '#e8403a';
    g.fill();
    g.restore();
  } else {
    g.fillStyle = 'rgba(43, 35, 32, 0.45)';
    g.fill();
  }
  heartPath(g);
  g.lineWidth = 2.2;
  g.strokeStyle = INK_CSS;
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Hearts {
  constructor(scene) {
    this.node = new THREE.Group();
    scene.add(this.node);
    const mat = (full) => new THREE.SpriteMaterial({
      map: heartTexture(full), transparent: true, depthTest: false, depthWrite: false, fog: false,
    });
    this._full = mat(true);
    this._empty = mat(false);
    this._list = [];
  }

  /**
   * 擺 max 顆心（前 hp 顆是滿的）在 (x, y, z)（腳下）的頭頂上，正對鏡頭（quat 是鏡頭的朝向）。
   * `dim`：最上面那一顆這一幀不畫（獻靈魂，要交出去的那一顆在閃）。
   */
  show(hp, max, x, y, z, quat, dim = false) {
    while (this._list.length < max) {
      const s = new THREE.Sprite(this._full);
      s.scale.setScalar(SIZE);
      s.renderOrder = 5;
      this.node.add(s);
      this._list.push(s);
    }
    this.node.position.set(x, y + LIFT, z);
    this.node.quaternion.copy(quat);
    this._list.forEach((s, i) => {
      s.visible = i < max && !(dim && i === max - 1);
      if (i >= max) return;
      s.material = i < hp ? this._full : this._empty;
      const row = Math.floor(i / ROW), inRow = Math.min(ROW, max - row * ROW);
      s.position.set((i % ROW - (inRow - 1) / 2) * GAP, row * GAP, 0);
    });
  }
}
