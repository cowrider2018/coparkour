/* ── test/src/controls.js ────────────────────────────────────────────
   每一個模式都一樣的那一層：輸入、版面、換裝。

   以前每個模式的主程式各抄一份（指標路由、雙指縮放、鍵盤、軸的長度、
   resize、換動物），幾百行裡只差一兩個按鍵。現在一份在這裡，模式只寫自己
   多出來的按鍵（`onKey`）。

   ── 指標路由 ────────────────────────────────────────────────────
   按下的那一刻決定這根手指屬於誰，之後就不換：搖桿、跳躍鈕，或是中間
   那片畫面（視角）。所以左手走、右手轉不會互搶，也不會有一次拖曳中途
   從轉視角變成走路。雙指只縮放，不轉——同時做兩件事的話，兩根手指必然
   有一點旋轉分量，畫面會一邊縮一邊歪。

   ── 跳的兩種意思 ────────────────────────────────────────────────
   地形模式按著空白會落地就再跳（`jumpHeld`）；有連段的模式裡跳同時是連段
   的按鍵，按一下就只能算一下（`jumpPressed`）。兩種都吃手把的跳躍鈕。
   ------------------------------------------------------------------ */

import { PHYS } from './walk.js';
import { CAM } from './camera.js';
import { lookInfo } from '../../src/cat/looks.js';

/**
 * 這一幀的軸 → 想要的速度。
 *
 * 走與衝是兩件事，不是同一條斜坡的兩段：軸的長度只管走（搖桿推多少就
 * 走多快，到底是 PHYS.walk），衝刺是另外一個開關——鍵盤是 ⇧，搖桿是
 * 手指整個出了搖桿圈（見 pad.js 的 `_aim`）。開著的時候不管推多深都是
 * PHYS.run，所以圈內推得再滿也不會衝。
 */
export function speedFor({ mag, sprint }) {
  if (mag <= 0) return 0;
  return sprint ? PHYS.run : PHYS.walk * mag;
}

/** 搶走瀏覽器預設動作的鍵（捲頁）。 */
const EATEN = [' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

export class Controls {
  /**
   * @param {HTMLCanvasElement} canvas 接指標的那一張（遊戲畫面）
   * @param {import('./pad.js').Pad} pad
   * @param {object} cam camera.js 的相機狀態（拖曳改 yaw／pitch、縮放改 dist）
   * @param {(k: string, e: KeyboardEvent) => void} onKey 按下一個鍵（小寫，不含連發）
   */
  constructor(canvas, pad, cam, onKey) {
    this.pad = pad;
    this.cam = cam;
    this.keys = new Set();
    this._queued = false;
    const drag = new Map(), owners = new Map();
    /** 兩根手指的距離，用來縮放。null = 現在不是雙指。 */
    let pinch = null;
    const pinchSpan = () => {
      const ps = [...drag.values()];
      if (ps.length < 2) return null;
      return Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
    };
    const zoom = (d) => { cam.dist = Math.max(CAM.near, Math.min(CAM.far, d)); };

    canvas.addEventListener('pointerdown', (e) => {
      const zone = pad.hit(e.clientX, e.clientY);
      owners.set(e.pointerId, zone || 'view');
      if (zone) pad.down(zone, e.pointerId, e.clientX, e.clientY);
      else drag.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { canvas.setPointerCapture(e.pointerId); } catch { /* 沒有就算了 */ }
    });
    canvas.addEventListener('pointermove', (e) => {
      const who = owners.get(e.pointerId);
      if (who === 'joy' || who === 'jmp') { pad.move(e.pointerId, e.clientX, e.clientY); return; }
      const d = drag.get(e.pointerId);
      if (!d) return;
      if (drag.size >= 2) {
        const before = pinch ?? pinchSpan();
        d.x = e.clientX; d.y = e.clientY;
        const after = pinchSpan();
        if (before && after) zoom(cam.dist * (before / after));
        pinch = after;
        return;
      }
      cam.yaw -= (e.clientX - d.x) * 0.006;
      cam.pitch = Math.max(-0.35, Math.min(1.15, cam.pitch + (e.clientY - d.y) * 0.004));
      d.x = e.clientX; d.y = e.clientY;
    });
    const release = (e) => {
      pad.up(e.pointerId);
      owners.delete(e.pointerId);
      drag.delete(e.pointerId);
      pinch = drag.size >= 2 ? pinchSpan() : null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoom(cam.dist + Math.sign(e.deltaY) * 0.6);
    }, { passive: false });

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ') this._queued = true;
      onKey(k, e);
      if (EATEN.includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  held(...names) { return names.some((n) => this.keys.has(n)); }

  /**
   * 這一幀的軸：鍵盤先湊成一個向量再正規化（斜著按兩個鍵不會比直著按快
   * 41%），再加上搖桿。搖桿往畫面下方推＝往後走，所以 z 取負。
   * `sprint`：按著 ⇧，或手指在搖桿圈外（見 speedFor）。
   * @returns {{ix: number, iz: number, mag: number, sprint: boolean}}
   */
  axis() {
    let ix = 0, iz = 0;
    if (this.held('w', 'arrowup')) iz += 1;
    if (this.held('s', 'arrowdown')) iz -= 1;
    if (this.held('a', 'arrowleft')) ix -= 1;
    if (this.held('d', 'arrowright')) ix += 1;
    const km = Math.hypot(ix, iz);
    if (km > 0) { ix /= km; iz /= km; }
    const pad = this.pad;
    if (pad.mag > 0) { ix += pad.axis.x; iz -= pad.axis.y; }
    let mag = Math.hypot(ix, iz);
    if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }
    return { ix, iz, mag, sprint: this.held('shift') || pad.sprint };
  }

  /**
   * 軸 → 世界裡的方向。相機站在玩家的 −(sin yaw, cos yaw) 方向上，所以「前」
   * 就是 +(sin yaw, cos yaw)；「右」是 cross(前, 上)，在 Y 軸朝上的右手系裡
   * 等於 (−cos yaw, +sin yaw)——少了這兩個負號就是 A、D 互換，像在鏡子裡走路。
   * 軸是 0 的時候回 null（朝向不變）。
   */
  aim({ ix, iz, mag }) {
    if (mag <= 1e-4) return null;
    const fwdX = Math.sin(this.cam.yaw), fwdZ = Math.cos(this.cam.yaw);
    const rgtX = -fwdZ, rgtZ = fwdX;
    return [(fwdX * iz + rgtX * ix) / mag, (fwdZ * iz + rgtZ * ix) / mag];
  }

  /** 跳，按著就一直算（地形模式：落地就再跳）。 */
  jumpHeld() {
    const pad = this.pad.takeJump();
    this._queued = false;
    return pad || this.held(' ');
  }

  /** 跳，按一下只算一下（連段的按鍵）。 */
  jumpPressed() {
    const pad = this.pad.takeJump();
    const key = this._queued;
    this._queued = false;
    return pad || key;
  }
}

/** 安全區。CSS 已經接成自訂屬性，這裡讀回來給 pad.js 擺元件。 */
function safeArea() {
  const cs = getComputedStyle(document.documentElement);
  const px = (n) => parseFloat(cs.getPropertyValue(n)) || 0;
  return { l: px('--sa-l'), r: px('--sa-r'), t: px('--sa-t'), b: px('--sa-b') };
}

/**
 * 畫面大小變了（以及一開始的那一次）：畫布、相機、操作列、面板、墨線。
 *
 * 操作列的幾何由 pad.js 算，算完寫回 CSS——DOM 的面板與畫布上的搖桿因此
 * 永遠對齊在同一條列裡。生物那張表跟著直欄寬度降級；直向沒有直欄，那時候
 * 面板是橫躺在上帶裡的，寬度有半個畫面，所以直接當成最寬的那一級。
 *
 * 墨線的寬度是「畫面上幾個像素」，所以它得知道畫面多高：`ink(px, height)`
 * 交給呼叫端，場上有幾隻會描線的東西只有它知道。
 */
export function fitView({ renderer, camera, pad, hud, ink }) {
  const run = () => {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = renderer.getPixelRatio();
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    pad.layout(w, h, dpr, safeArea());
    const st = document.documentElement.style;
    st.setProperty('--rail', `${pad.rail}px`);
    st.setProperty('--barT', `${pad.barT}px`);
    st.setProperty('--barB', `${pad.barB}px`);
    st.setProperty('--ctrl', `${pad.ctrlTop}px`);
    document.body.classList.toggle('pad-land', !pad.portrait);
    document.body.classList.toggle('pad-port', pad.portrait);
    hud.fit(pad.portrait ? 999 : pad.rail);
    ink(2.0, h * dpr);
  };
  addEventListener('resize', run);
  run();
}

/**
 * 換裝：換 look、同一種動物換下一件毛色（C）、換下一種動物而毛色留在同一欄（X）、
 * 帽子（H）。`hud` 是取得 HUD 的函式——HUD 建的時候要這幾個 callback，所以
 * 這裡先建、HUD 後建。`after` 在 look 換好之後叫（例如把刀掛到新那一隻頭上）。
 */
export function wardrobe(zoo, hud, after = () => {}) {
  const setLook = (look) => {
    if (!zoo.setLook(look)) return;
    after();
    hud().flash(lookInfo(look).name);
    hud().paint();
  };
  const cycleSkin = (step) => {
    const { model, skin } = lookInfo(zoo.look);
    const skins = zoo.critters.get(model).skins;
    const i = (skins.indexOf(skin) + step + skins.length) % skins.length;
    setLook(`${model}/${skins[i]}`);
  };
  const cycleModel = (step) => {
    const { model, skin } = lookInfo(zoo.look);
    const ms = zoo.models;
    const next = ms[(ms.indexOf(model) + step + ms.length) % ms.length];
    const col = Math.max(0, zoo.critters.get(model).skins.indexOf(skin));
    const skins = zoo.critters.get(next).skins;
    setLook(`${next}/${skins[Math.min(col, skins.length - 1)]}`);
  };
  const toggleHat = () => {
    zoo.setHat(!zoo.hatOn);
    hud().flash(zoo.hatOn ? '戴上漁夫帽' : '脫下漁夫帽');
    hud().paint();
  };
  /** H／C／X。是這三個之一就處理掉、回 true。 */
  const key = (k, e) => {
    if (k === 'h') toggleHat();
    else if (k === 'c') cycleSkin(e.shiftKey ? -1 : 1);
    else if (k === 'x') cycleModel(e.shiftKey ? -1 : 1);
    else return false;
    return true;
  };
  return { setLook, toggleHat, key };
}
