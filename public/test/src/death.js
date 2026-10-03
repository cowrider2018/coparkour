/* ── test/src/death.js ───────────────────────────────────────────────
   倒下（完整流程模式，mode-flow.js）：不是當幀就回到門前，而是演完一段——

   ── 一次倒下 ────────────────────────────────────────────────────
     失去目標 血扣光的那一刻，所有怪物不再追、不再出招（Fight.standDown，模式叫）。
              那一下照常把主角打飛（combat.js 的 knockHero）。
     倒下     血扣光的那一刻就開始倒，在空中也是（被打飛的身體一邊飛一邊倒）：DEATH.tip
              秒從直立轉到橫躺，越倒越快（u²），躺平的那一刻停住——是倒下去，不是被放下去。
     幽靈     DEATH.ghost 秒。躺平而且落地之後（knockHero 那一段結束、站到地上；一直沒
              落地的話等到 DEATH.wait 秒），牠的靈魂從屍體浮起來（monster.js 的
              makeGhostCritter：同一隻動物，幽靈那一件、半透明）：一出來跟屍體疊在
              一起、一樣躺著，DEATH.right 秒擺正成直立（倒下那一下倒過來播，支點一樣，
              先慢後快再慢），同時往上浮 DEATH.rise 公尺（smoothstep，整段 DEATH.ghost 秒）。
              屍體留在地上，一直躺到全黑。
     暗下去   DEATH.fade：暗下去、全黑停一下、亮回來（transit.js，同一層黑幕）。全黑的
              那一刻 `update` 回傳 true，模式把怪物收掉、把人放回門前。
     醒來     開始亮回來的那一刻起 WAKE.time 秒：畫面在模糊與清楚之間簡諧地來回，
              每 WAKE.period 秒一次，從最模糊開始：清楚、再糊一次、清楚的那一刻停。

   字（CAPTIONS，一次一行，用同一個元素）：每一行四個時間點——開始淡入、完全清楚、
   開始淡出、淡完——從「開始亮回來」那一刻起算，所以暗下去那一段是負的：

     死亡              暗下去的同時淡入，全黑停著，亮回來的同時淡出
     原來是夢          0.5 秒起：淡入 0.25、停 0.5、淡出 0.25
     我又不小心睡著了  緊接著 1.5 秒起，一樣；淡完（2.5 秒）之後閃爍再閃半次，3 秒停

   倒下到全黑之前操作收起來（`busy`）：身體照慣性停下。怪物不收，站著（或照被打飛的
   拋物線落地）到全黑那一刻。醒來那一段已經站在門前，操作還回來了，模糊只是畫面。

   ── 怎麼倒 ──────────────────────────────────────────────────────
   繞著前進軸轉，支點是倒向那一側的腳邊（離中線半個身寬）：轉 90° 之後身體的側面
   剛好貼著腳下那一層，不會一半埋進地板。倒向離鏡頭遠的那一側，所以四條腿朝著鏡頭。
   轉的是 Zoo 的 root（動物自己的朝向在它底下那一層，critter.js），所以步態、
   出招的姿勢照常疊在上面。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { Transit } from './transit.js';
import { makeGhostCritter } from './monster.js';

/**
 * 倒下幾秒、幽靈浮幾秒、浮多高（公尺）、幽靈幾秒擺正、幽靈等落地最多等到倒下之後幾秒；暗下去—全黑—亮回來各幾秒。
 */
export const DEATH = { tip: 0.25, ghost: 2.0, rise: 1.0, right: 1.0, wait: 2.0, fade: { out: 0.5, hold: 0.5, in: 0.5 } };
/** 醒來（秒、CSS 像素）：閃多久、多久閃一次、最模糊多糊、字淡入的時候從多糊開始。 */
export const WAKE = { time: 3, period: 2, blur: 8, wordsBlur: 6 };

const F = DEATH.fade;
/** 一行一行的字：[開始淡入, 完全清楚, 開始淡出, 淡完]，從開始亮回來那一刻起算（秒）。 */
export const CAPTIONS = [
  { text: '死亡', at: [-(F.out + F.hold), -F.hold, 0, F.in] },
  { text: '原來是夢', at: [0.5, 0.75, 1.25, 1.5] },
  { text: '我又不小心睡著了', at: [1.5, 1.75, 2.25, 2.5] },
];
/** 醒來那一段演到哪一刻為止：閃爍與最後一行字都完了。 */
const WAKE_END = Math.max(WAKE.time, ...CAPTIONS.map((c) => c.at[3]));

const smooth = (u) => { const k = Math.min(1, Math.max(0, u)); return k * k * (3 - 2 * k); };
const UP = new THREE.Vector3(0, 1, 0);
const _side = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** 倒下之後 t 秒倒了幾度：越倒越快，DEATH.tip 秒躺平。 */
export const tipAngle = (t) => (Math.PI / 2) * Math.min(1, t / DEATH.tip) ** 2;

/** 開始亮回來之後 t 秒畫面多糊（像素）：從最模糊開始，每 WAKE.period 秒一次，WAKE.time 秒停在清楚。 */
export function wakeBlur(t) {
  if (t < 0 || t >= WAKE.time) return 0;
  return (WAKE.blur * (1 + Math.cos((2 * Math.PI * t) / WAKE.period))) / 2;
}

/** 開始亮回來之後 t 秒是哪一行字、多清楚（0～1）、是不是還在淡入；沒有字是 null。 */
export function captionAt(t) {
  for (const c of CAPTIONS) {
    const [a, b, k, d] = c.at;
    if (t < a || t >= d) continue;
    if (t < b) return { text: c.text, shown: smooth((t - a) / (b - a)), rising: true };
    return { text: c.text, shown: t < k ? 1 : 1 - smooth((t - k) / (d - k)), rising: false };
  }
  return null;
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
   *   黑幕、要糊的畫面、字（CAPTIONS）那一行
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
    /** 幽靈浮了幾秒；null = 還沒躺平落地、還沒出來。 */
    this.up = null;
    /** 開始亮回來之後幾秒（暗下去、全黑那兩段是負的）；null = 沒在演這一段。 */
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
    this.up = null;
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
   * 每幀一次，在 fight.draw 之後（它每幀照 guard 重設玩家看不看得到、墨線是不是金色，
   * 倒下的時候這裡蓋回來）、算圖之前。
   * 到了全黑、該送回門前的那一刻回傳 true（只回傳一次）。
   *
   * @param {number} dt
   * @param {{x: number, y: number, z: number, grounded: boolean, knocked?: boolean}} player
   *   身體在哪（倒下的時候照常移動）、落地了沒
   * @param {number} viewYaw 鏡頭在哪個方向（給幽靈轉遠側那隻眼睛）
   */
  update(dt, player, viewYaw) {
    let due = false;
    if (this.t >= 0) {
      this.t += dt;
      const g = this.ghost;
      // 倒：Zoo 的 root 繞前進軸、支點在倒向那一側的腳邊。倒下的身體不閃、墨線不是金的。
      this._tip(this.zoo.root, tipAngle(this.t), g.half, player);
      this.zoo.root.visible = true;
      this.zoo.setInkColor(null);
      // 躺平、落地（或等太久了）的那一刻靈魂出來：接手那一隻的朝向與步態，從屍體的姿勢一邊擺正一邊往上浮。
      if (this.up !== null) this.up += dt;
      else if (this.t >= DEATH.tip && ((player.grounded && !player.knocked) || this.t >= DEATH.wait)) {
        this.up = 0;
        g.c.adopt(this.zoo.active);
        g.c.setHat(this.zoo.hatOn);
        g.root.visible = true;
      }
      if (g.root.visible) {
        const u = this.up / DEATH.ghost;
        this._tip(g.root, (Math.PI / 2) * (1 - smooth(this.up / DEATH.right)), g.half, player);
        g.root.position.y += DEATH.rise * smooth(u);
        g.c.setFacing(this.yaw);
        g.c.update(dt, { speed: 0, grounded: false, vy: 1, viewYaw });
      }
      // 浮完：暗下去（「死亡」同時淡入）。全黑的那一刻送回門前、屍體站回來、靈魂收起來。
      if (this.up !== null && this.up >= DEATH.ghost && this.fade.t < 0) {
        this.fade.go(true);
        this.wake = -(F.out + F.hold);
      }
      if (this.fade.update(dt)) {
        due = true;
        this.t = -1;
        this._stand();
      }
    } else {
      this.fade.update(dt);
    }
    if (this.wake !== null) {
      this.wake += dt;
      if (this.wake >= WAKE_END) this.wake = null;
      this._paintWake();
    }
    return due;
  }

  /** 把 `node` 擺成倒了 `angle`。 */
  _tip(node, angle, half, player) {
    const s = this._side;
    _axis.crossVectors(UP, s).normalize();
    _q.setFromAxisAngle(_axis, angle);
    node.quaternion.copy(_q);
    // 支點 P = 身體 + s·half；root 在 P + q·(−s·half) = 身體 + half·(s(1 − cos) + up·sin)。
    const c = Math.cos(angle), n = Math.sin(angle);
    node.position.set(
      player.x + half * s.x * (1 - c),
      player.y + half * n,
      player.z + half * s.z * (1 - c),
    );
  }

  /** 動物站回來、幽靈收起來（幽靈的轉向也歸零）。Zoo 的位置每幀由模式擺，這裡只歸零轉的那一下。 */
  _stand() {
    this.zoo.root.quaternion.identity();
    this.zoo.root.visible = true;
    for (const g of this.ghosts.values()) { g.root.visible = false; g.root.quaternion.identity(); }
    this.ghost = null;
  }

  _paintWake() {
    const t = this.wake ?? Infinity;
    if (this.view) {
      const b = wakeBlur(t);
      this.view.style.filter = b > 0.01 ? `blur(${b.toFixed(2)}px)` : '';
    }
    if (this.words) {
      const c = captionAt(t);
      const a = c ? c.shown : 0;
      if (c && this.words.textContent !== c.text) this.words.textContent = c.text;
      this.words.style.opacity = a.toFixed(3);
      this.words.style.visibility = a > 0 ? 'visible' : 'hidden';
      // 淡入的時候從糊到清楚；淡出只是淡，不再糊回去。
      const b = c && c.rising ? WAKE.wordsBlur * (1 - a) : 0;
      this.words.style.filter = b > 0.01 ? `blur(${b.toFixed(2)}px)` : '';
    }
  }
}
