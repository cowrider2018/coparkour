/* ── test/src/transit.js ─────────────────────────────────────────────
   走進感測區（門洞、沒入黑霧的路、井底）的那一下：畫面先暗下去，全黑的
   那一刻才把人送走，再從到達點亮回來。

   以前是當幀就送，而兩頭的鏡頭都看得到——前一幀還在門口，下一幀就站在
   另一張圖的門前，中間那一跳就是「看著自己被搬過去」。暗下去再亮起來，
   那一跳落在全黑裡，看不到。

   ── 一次穿越 ────────────────────────────────────────────────────
     暗下去   TRANSIT.out 秒從透明到全黑。操作先收起來（身體照慣性停下、
              照重力往下掉），感測區不再問——已經要被送走了。
     全黑     停 TRANSIT.hold 秒，這一段的開頭把人送走（`update` 回傳目的地）。
     亮回來   TRANSIT.in 秒從全黑到透明。操作已經還回來了：人站在到達點，
              亮到一半就想走是對的。

   要蓋的只有遊戲那一片：黑幕疊在 #view 上面、操作列與面板下面，所以區塊
   的名字（toast）是在變亮的畫面上浮出來的，而不是被一起蓋掉。

   什麼時候送、送到哪還是模式的事（mode-terrain.js／mode-flow.js 的 `warp`），
   這裡只管時間與那一層黑。`el` 給 null 也跑得動（node 裡驗時間軸用）。
   ------------------------------------------------------------------ */

/** 暗下去、全黑、亮回來各幾秒。 */
export const TRANSIT = { out: 0.22, hold: 0.08, in: 0.35 };

const ease = (u) => u * u * (3 - 2 * u);

export class Transit {
  /** @param {HTMLElement | null} el 那一層黑幕 */
  constructor(el) {
    this.el = el;
    /** 這一次穿越走了幾秒；-1 = 沒在穿越。 */
    this.t = -1;
    this.dest = null;
    this._paint(0);
  }

  /** 還沒送到（暗下去與全黑那一段的開頭之前）：操作收起來、感測區不問。 */
  get busy() {
    return this.dest !== null;
  }

  /** 開始送去 `dest`。已經在穿越的話不理——一次只送一個地方。 */
  go(dest) {
    if (this.t >= 0) return;
    this.t = 0;
    this.dest = dest;
    this._paint(0);
  }

  /** 別的東西直接把人放走了（重生、換區塊、重玩）：這一次不送了，畫面直接亮。 */
  cancel() {
    this.t = -1;
    this.dest = null;
    this._paint(0);
  }

  /** 每幀一次。到了該送的那一刻回傳目的地（只回傳一次），其他時候是 null。 */
  update(dt) {
    if (this.t < 0) return null;
    this.t += dt;
    const { out, hold, in: back } = TRANSIT;
    let due = null;
    if (this.dest && this.t >= out) {
      due = this.dest;
      this.dest = null;
    }
    if (this.t >= out + hold + back) {
      this.t = -1;
      this._paint(0);
    } else {
      this._paint(this.t < out ? ease(this.t / out)
        : this.t < out + hold ? 1 : 1 - ease((this.t - out - hold) / back));
    }
    return due;
  }

  _paint(a) {
    if (!this.el) return;
    this.el.style.opacity = a.toFixed(3);
    this.el.style.visibility = a > 0 ? 'visible' : 'hidden';
  }
}
