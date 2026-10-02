/* ── test/src/death.js ───────────────────────────────────────────────
   倒下（完整流程模式，mode-flow.js）：不是當幀就回到門前，而是演完一段——

   ── 一次倒下 ────────────────────────────────────────────────────
     倒下     DEATH.tip 秒，從直立轉到橫躺。從血扣光的那一刻就開始轉，不等落地：
              半空中被打死的話，身體一邊照重力往下掉一邊倒。越倒越快（u²），
              躺平的那一刻停住——是倒下去，不是被放下去。
     幽靈     DEATH.ghost 秒。躺平的那一刻那一隻變成幽靈（monster.js 的
              makeGhostCritter：同一隻動物，幽靈那一件、半透明），照躺著的樣子
              浮起 DEATH.rise 公尺，先慢後快再慢（smoothstep）。
     暗下去   DEATH.fade：暗下去、全黑、亮回來（transit.js，同一層黑幕）。全黑的
              那一刻 `update` 回傳 true，模式把人放回門前（跟以前的倒下一樣）。
     醒來     開始亮回來的那一刻起 WAKE.time 秒：畫面在模糊與清楚之間簡諧地來回
              （WAKE.cycles 個來回，從最模糊開始、停在清楚），中間浮出「原來是夢」：
              WAKE.words 的四個時間點是開始浮現、完全清楚、開始淡出、淡完。

   倒下到全黑之前操作收起來（`busy`）：身體照慣性停下。醒來那一段已經站在門前，
   操作還回來了，模糊只是畫面。

   ── 怎麼倒 ──────────────────────────────────────────────────────
   繞著前進軸轉，支點是倒向那一側的腳邊（離中線半個身寬）：轉 90° 之後身體的側面
   剛好貼著腳下那一層，不會一半埋進地板。倒向離鏡頭遠的那一側，所以四條腿朝著鏡頭。
   轉的是 Zoo 的 root（動物自己的朝向在它底下那一層，critter.js），所以步態、
   出招的姿勢照常疊在上面。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { Transit } from './transit.js';
import { makeGhostCritter } from './monster.js';

/** 倒下幾秒、幽靈浮幾秒、浮多高（公尺）、暗下去—全黑—亮回來各幾秒。 */
export const DEATH = { tip: 1.0, ghost: 2.0, rise: 1.0, fade: { out: 0.5, hold: 0.3, in: 0.5 } };
/**
 * 醒來（秒、CSS 像素）：多久、模糊與清楚之間幾個來回（n + 0.5 才會從模糊開始、停在清楚）、
 * 最模糊多糊；字的四個時間點（開始浮現、完全清楚、開始淡出、淡完）、字浮現前多糊。
 */
export const WAKE = { time: 1.75, cycles: 2.5, blur: 8, words: [0.25, 0.75, 1.25, 1.75], wordsBlur: 6 };

const smooth = (u) => { const k = Math.min(1, Math.max(0, u)); return k * k * (3 - 2 * k); };
const UP = new THREE.Vector3(0, 1, 0);
const _side = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** 這一刻（倒下之後 t 秒）倒了幾度：越倒越快，DEATH.tip 秒躺平。 */
export const tipAngle = (t) => (Math.PI / 2) * Math.min(1, t / DEATH.tip) ** 2;

/** 醒來之後 t 秒畫面多糊（像素）：從最模糊開始，簡諧地來回，WAKE.time 秒停在清楚。 */
export function wakeBlur(t) {
  if (t >= WAKE.time) return 0;
  t = Math.max(0, t);
  return (WAKE.blur * (1 + Math.cos((2 * Math.PI * WAKE.cycles * t) / WAKE.time))) / 2;
}

/** 醒來之後 t 秒「原來是夢」多清楚（0～1）：浮現、停住、淡出。 */
export function wordsShown(t) {
  const [a, b, c, d] = WAKE.words;
  if (t < a || t >= d) return 0;
  if (t < b) return smooth((t - a) / (b - a));
  if (t < c) return 1;
  return 1 - smooth((t - c) / (d - c));
}

/**
 * 半個身寬（公尺）：待機姿勢下，身體離中線最遠的那一點（左右）。服裝不算——帽簷比頭寬
 * 一大截，照它算的話躺下來身體是浮著的；帽簷寧可壓進地板一點。
 */
function halfWidth(c) {
  const d = c.data, M = c.rig.matrices, skin = d.colors.get(c.skins[0]);
  let far = 0;
  for (let v = 0; v < d.header.vertexCount; v++) {
    const b = skin[v * 4 + 3] & 31;
    if (c.rig.names[b].startsWith('wear')) continue;
    const o = b * 16, x = d.position[v * 3], y = d.position[v * 3 + 1], z = d.position[v * 3 + 2];
    far = Math.max(far, Math.abs(M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]));
  }
  return far * c._scale;
}

export class Death {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./critter.js').Zoo} zoo 玩家那一隻
   * @param {{fade: HTMLElement | null, view: HTMLElement | null, words: HTMLElement | null}} els
   *   黑幕、要糊的畫面、「原來是夢」那一行
   */
  constructor(scene, zoo, { fade, view, words }) {
    this.zoo = zoo;
    this.view = view;
    this.words = words;
    this.fade = new Transit(fade, DEATH.fade);
    /* 每一隻動物各一隻幽靈，現在就建好——倒下的那一刻才建就是一頓。身寬也是現在量
       （halfWidth），倒的支點離中線半個身寬。 */
    this.ghosts = new Map();
    for (const model of zoo.models) {
      const c = makeGhostCritter(zoo, model);
      const root = new THREE.Group();
      root.add(c.root);
      root.visible = false;
      scene.add(root);
      this.ghosts.set(model, { c, root, half: halfWidth(c) });
    }
    /** 倒下之後幾秒；-1 = 沒在倒。 */
    this.t = -1;
    /** 醒來之後幾秒（還在全黑裡是負的）；null = 沒在醒。 */
    this.wake = null;
    this.ghost = null;
    this._side = new THREE.Vector3();
    this._paintWake();
  }

  /** 倒下到全黑（送回門前）之前：操作收起來、路線不動。 */
  get busy() { return this.t >= 0; }

  /** 線寬照視窗走（跟 Zoo 一起，controls.js 的 fitView）。 */
  setInkPx(px, h) { for (const g of this.ghosts.values()) g.c.setInkPx(px, h); }

  /**
   * 血扣光的那一刻。`camX`／`camZ` 是鏡頭現在在哪：倒向離它遠的那一側。
   */
  start(player, camX, camZ) {
    this.cancel();
    this.t = 0;
    this.yaw = this.zoo.active._yaw;
    this.zoo.setFacing(this.yaw);          // 不再轉身：倒的軸是這一刻的前進軸
    this.ghost = this.ghosts.get(this.zoo.modelId);
    // 前進軸的水平垂直方向，挑離鏡頭遠的那一邊。
    _side.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (_side.x * (player.x - camX) + _side.z * (player.z - camZ) < 0) _side.negate();
    this._side.copy(_side);
  }

  /** 不演了（重玩、從第幾場開始）：動物站回來、幽靈收起來、畫面清楚。 */
  cancel() {
    this.t = -1;
    this.wake = null;
    this.fade.cancel();
    this._stand();
    this._paintWake();
  }

  /**
   * 每幀一次，在 fight.draw 之後（它每幀重設玩家看不看得到）、算圖之前。
   * 到了全黑、該送回門前的那一刻回傳 true（只回傳一次）。
   *
   * @param {number} dt
   * @param {{x: number, y: number, z: number}} player 身體在哪（倒下的時候照常移動）
   * @param {number} viewYaw 鏡頭在哪個方向（給幽靈轉遠側那隻眼睛）
   */
  update(dt, player, viewYaw) {
    let due = false;
    if (this.t >= 0) {
      this.t += dt;
      const T = this.t, alive = T < DEATH.tip;
      const half = this.ghost.half;
      // 倒：Zoo 的 root 繞前進軸、支點在倒向那一側的腳邊。
      this._tip(this.zoo.root, tipAngle(T), half, player, 0);
      this.zoo.root.visible = alive;
      // 躺平的那一刻換成幽靈：接手那一隻的朝向與步態，照躺著的樣子往上浮。
      const g = this.ghost;
      if (!alive && !g.root.visible) {
        g.c.adopt(this.zoo.active);
        g.c.setHat(this.zoo.hatOn);
        g.root.visible = true;
      }
      if (!alive) {
        const u = (T - DEATH.tip) / DEATH.ghost;
        this._tip(g.root, Math.PI / 2, half, player, DEATH.rise * smooth(u));
        g.c.setFacing(this.yaw);
        g.c.update(dt, { speed: 0, grounded: false, vy: 1, viewYaw });
      }
      // 浮完：暗下去。全黑的那一刻送回門前、動物站回來、開始醒。
      if (T >= DEATH.tip + DEATH.ghost && this.fade.t < 0) this.fade.go(true);
      if (this.fade.update(dt)) {
        due = true;
        this.t = -1;
        this._stand();
        this.wake = -DEATH.fade.hold;      // 全黑那一段過完、開始亮回來才算醒
      }
    } else {
      this.fade.update(dt);
    }
    if (this.wake !== null) {
      this.wake += dt;
      if (this.wake >= WAKE.time) this.wake = null;
      this._paintWake();
    }
    return due;
  }

  /** 把 `node` 擺成倒了 `angle`、再往上浮 `lift` 公尺。 */
  _tip(node, angle, half, player, lift) {
    const s = this._side;
    _axis.crossVectors(UP, s).normalize();
    _q.setFromAxisAngle(_axis, angle);
    node.quaternion.copy(_q);
    // 支點 P = 身體 + s·half；root 在 P + q·(−s·half) = 身體 + half·(s(1 − cos) + up·sin)。
    const c = Math.cos(angle), n = Math.sin(angle);
    node.position.set(
      player.x + half * s.x * (1 - c),
      player.y + half * n + lift,
      player.z + half * s.z * (1 - c),
    );
  }

  /** 動物站回來、幽靈收起來。Zoo 的位置每幀由模式擺，這裡只歸零轉的那一下。 */
  _stand() {
    this.zoo.root.quaternion.identity();
    this.zoo.root.visible = true;
    for (const g of this.ghosts.values()) g.root.visible = false;
    this.ghost = null;
  }

  _paintWake() {
    const t = this.wake ?? Infinity;
    if (this.view) {
      const b = wakeBlur(t);
      this.view.style.filter = b > 0.01 ? `blur(${b.toFixed(2)}px)` : '';
    }
    if (this.words) {
      const a = wordsShown(t);
      this.words.style.opacity = a.toFixed(3);
      this.words.style.visibility = a > 0 ? 'visible' : 'hidden';
      // 浮現的時候從糊到清楚；淡出只是淡，不再糊回去。
      const [, clear] = WAKE.words;
      const b = t >= 0 && t < clear ? WAKE.wordsBlur * (1 - a) : 0;
      this.words.style.filter = b > 0.01 ? `blur(${b.toFixed(2)}px)` : '';
    }
  }
}
