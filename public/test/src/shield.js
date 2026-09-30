/* ── test/src/shield.js ───────────────────────────────────────
   國王身邊的盾（combat.js 的 parry）：幾面鳶形盾，在牠腰的高度繞著牠轉。

     一面盾  鳶形（上緣平、兩側直下、底下收成一個尖）：金色的邊框是一片擠出的厚板，
             正面再貼一片小一圈的深藍盾面，盾面正中一顆金色的圓釘。盾面朝外。
     繞      剩幾面就平均分在一圈上（RING.r 公尺，照體型放大），整圈每 RING.spin 秒
             轉一圈，每一面再各自上下浮一點點。
     少一面  盾被用掉：最後那一面在 POP 秒內縮到沒有，其他幾面滑到新的平均間隔。
     多一面  補回來：那一面從沒有長回原本的大小，一樣滑進去。

   跟王冠一樣，墨線是外推一點、只畫背面的殼，材質交給那隻動物的墨色一起換（攻擊中轉紅）。
   不掛在骨頭上：盾在世界座標裡繞著牠的腳，每幀照牠的位置擺。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { toon, INK } from './palette.js';

/** 一面盾：寬、高（公尺，體型 1 的時候）、邊框厚、盾面內縮多少、圓釘半徑。 */
const PLATE = { w: 0.34, h: 0.42, t: 0.04, inset: 0.035, boss: 0.045 };
/** 繞的那一圈：半徑、離腳多高（都是體型 1 的時候的公尺）、幾秒轉一圈、上下浮多少與週期。 */
const RING = { r: 0.72, y: 0.42, spin: 3, bob: 0.03, period: 1.6 };
/** 多一面、少一面：長出來與縮掉的時間常數、滑到新間隔的時間常數（秒）。 */
const POP = 0.08, SLIDE = 0.12;
const INK_OUT = 0.012;
/** 尺寸（驗證器用）。 */
export const SHIELD = { PLATE, RING, POP, SLIDE };
const COL = { rim: 0xe8b53a, field: 0x2f4f9e };

/** 鳶形的輪廓（寬 w、高 h，原點在正中），往外長 grow。 */
function kite(w, h, grow = 0) {
  const x = w / 2 + grow, top = h * 0.42 + grow, side = -h * 0.08, tip = -h * 0.58 - grow;
  const s = new THREE.Shape();
  s.moveTo(-x, top);
  s.lineTo(x, top);
  s.lineTo(x, side);
  s.quadraticCurveTo(x, tip * 0.7, 0, tip);
  s.quadraticCurveTo(-x, tip * 0.7, -x, side);
  s.closePath();
  return s;
}

/** 一片擠出的板：輪廓 shape、厚 depth，正面朝 +Z、背面貼在 z = z0。 */
function slab(shape, depth, z0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
  g.translate(0, 0, z0);
  return g;
}

/** 一面盾（邊框、盾面、圓釘，各自一份墨線殼），盾面朝 +Z。 */
function buildPlate(inkMat) {
  const { w, h, t, inset, boss } = PLATE;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(slab(kite(w, h), t, -t / 2), toon(COL.rim)));
  g.add(new THREE.Mesh(slab(kite(w, h, INK_OUT), t + 2 * INK_OUT, -t / 2 - INK_OUT), inkMat));
  g.add(new THREE.Mesh(slab(kite(w - 2 * inset, h - 2 * inset), t * 0.35, t / 2), toon(COL.field)));
  for (const [r, mat] of [[boss, toon(COL.rim)], [boss + INK_OUT, inkMat]]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
    b.position.set(0, 0, t / 2 + t * 0.35);
    b.scale.z = 0.6;
    g.add(b);
  }
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

export class ShieldRing {
  /** @param {number} count 最多幾面（KINDS 的 `shields`） */
  constructor(count) {
    /** 墨線外殼共用一顆材質：交給動物的墨色一起換（follow）。 */
    this.ink = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    this.node = new THREE.Group();
    this.node.visible = false;
    /** 每一面：外觀、現在多大（0～1）、現在在圈上的哪個角度（相對整圈）。 */
    this.plates = Array.from({ length: count }, (_, i) => {
      const obj = buildPlate(this.ink);
      this.node.add(obj);
      return { obj, k: 1, a: (2 * Math.PI * i) / count };
    });
    this._spin = 0;
    this._t = 0;
  }

  /** 墨線跟著這一隻的墨色換（Critter 的 setInkColor）。 */
  follow(critter) {
    if (!critter._inkMats.includes(this.ink)) critter._inkMats.push(this.ink);
  }

  /** 一下子擺到定位（剛上場、回到站位）：剩幾面就是幾面，不從別的樣子長過來。 */
  snap(n) {
    this.plates.forEach((p, i) => { p.k = i < n ? 1 : 0; p.a = n ? (2 * Math.PI * Math.min(i, n - 1)) / n : 0; });
  }

  /**
   * 擺這一幀：繞著 (x, y, z) 的腳，剩 n 面，體型 size（monster.js 的 sizeOf）。
   * 前 n 面長到滿、平均分在一圈上；其他的縮到沒有。
   */
  show(dt, n, x, y, z, size) {
    this.node.visible = true;
    this._spin = (this._spin + (2 * Math.PI * dt) / RING.spin) % (2 * Math.PI);
    this._t += dt;
    const grow = 1 - Math.exp(-dt / POP), slide = 1 - Math.exp(-dt / SLIDE);
    this.node.position.set(x, y + RING.y * size, z);
    this.plates.forEach((p, i) => {
      const on = i < n;
      p.k += ((on ? 1 : 0) - p.k) * grow;
      if (on) {
        let d = (2 * Math.PI * i) / n - p.a;
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
        p.a += d * slide;
      }
      const a = p.a + this._spin, r = RING.r * size;
      const o = p.obj;
      o.visible = p.k > 0.01;
      o.position.set(Math.sin(a) * r, RING.bob * size * Math.sin((2 * Math.PI * this._t) / RING.period + i * 2.1), Math.cos(a) * r);
      o.rotation.y = a;
      o.scale.setScalar(size * p.k);
    });
  }

  hide() { this.node.visible = false; }
}
