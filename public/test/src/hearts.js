/* ── test/src/hearts.js ─────────────────────────────────────────────
   主角頭頂上那一排愛心：還剩幾點血就幾顆（combat.js 的 LIFE）。

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

/** 一顆心的圖：參數式的心形，紅色填滿、墨色描邊。 */
function heartTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath();
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    const px = 32 + x * 1.7, py = 29 - y * 1.7;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
  g.fillStyle = '#e8403a';
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = `#${INK.toString(16).padStart(6, '0')}`;
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Hearts {
  constructor(scene) {
    this.node = new THREE.Group();
    this.node.renderOrder = 5;
    scene.add(this.node);
    this._mat = new THREE.SpriteMaterial({ map: heartTexture(), transparent: true, depthTest: false, depthWrite: false, fog: false });
    this._list = [];
  }

  /** 擺 n 顆心在 (x, y, z)（腳下）的頭頂上，正對鏡頭（quat 是鏡頭的朝向）。 */
  show(n, x, y, z, quat) {
    while (this._list.length < n) {
      const s = new THREE.Sprite(this._mat);
      s.scale.setScalar(SIZE);
      s.renderOrder = 5;
      this.node.add(s);
      this._list.push(s);
    }
    this.node.position.set(x, y + LIFT, z);
    this.node.quaternion.copy(quat);
    this._list.forEach((s, i) => {
      s.visible = i < n;
      if (i >= n) return;
      const row = Math.floor(i / ROW), inRow = Math.min(ROW, n - row * ROW);
      s.position.set((i % ROW - (inRow - 1) / 2) * GAP, row * GAP, 0);
    });
  }
}
