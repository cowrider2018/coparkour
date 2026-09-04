/* ── src/cat/showcase.js ─────────────────────────────────────────────
   一隻動物站在一個框裡：天空、地面、小跑、每兩秒一次的跳，以及「按住
   拖曳，把牠轉過來看」。

   這支模組存在，是因為它有兩個使用者：/preview/ 的圖鑑（一格一種動物，
   格子裡是牠所有毛色）與開始選單左邊那一格（就是你現在選中的那一隻）。
   兩邊必須是同一隻動物在同一種光底下做同一件事——不是「看起來很像」，
   是同一組數字，因為選單就是拿來決定「等一下跑出去的會是什麼樣子」的。
   兩份各自調整的常數遲早會漂開，而漂開的那一天沒有人會發現。

   框裡的內容一律固定：同一個時辰、同一個大小、同一組動作。唯一的互動是
   把牠轉過來看，而且鬆手就盪回去——所以放開手，兩邊又是同一個樣子。

   這支只管一個框。誰在框裡、框排成什麼樣、標題寫什麼，是頁面的事。
   ------------------------------------------------------------------ */

import { skyAt, skyBands, css } from '../gfx/daycycle.js';
import { PHYS, PLAYER_W, PLAYER_H } from '../constants.js';

/* ── 框裡的一切 ───────────────────────────────────────────────────
   全部固定，沒有一項是可調的。

   放大的是「相機」而不是角色：boxH 維持遊戲的 40，只把可視範圍縮小。
   這件事是必要的，不是偷懶——步頻是 speed /(STRIDE_PER_BOXH × boxH)，擺幅
   卻是 speed / REF_SPEED，兩者對 boxH 的反應不一樣，所以把 boxH 加大來放大
   角色會順手把步態改成另一種東西。縮相機則什麼都不動：步態、墨線寬、跳躍
   弧線全都是遊戲裡的那一份，只是看得比較大。

   ── 為什麼是比例而不是倍率 ──────────────────────────────────
   這裡以前是 ZOOM = 1.9，「一個 CSS px 等於幾個世界 px」的固定倍率。框的
   大小固定時那沒問題（圖鑑每格都是 320 px 高），但選單那一格是跟著卡片
   伸縮的：同一隻動物在桌機 187 px 的框裡佔四成高，到了手機的 143 px 就
   變成五成三，尾巴直接甩出框外。固定倍率的意思就是「框越小，動物越大」，
   而那正好是反的。

   FILL 是動物的高度佔框高的幾成，倍率由它跟框的實際尺寸現算。框多大，
   動物就多大。

   預設值就是圖鑑一直以來的那個大小：40 世界 px 的動物、320 px 的框、
   ZOOM 1.9，也就是 40 ÷ (320 / 1.9)。改寫成比例之後，圖鑑一格也沒有動。 */
export const FILL = PLAYER_H / (320 / 1.9);
const FLOOR = 0.80;          // 地面線落在框高的幾成處
const HOUR = 9;              // 固定的時辰
const WALK = 150;            // 世界 px/s：這副骨架在 boxH = 40 時的小跑

/* 時辰固定，所以光也固定：算一次，兩個頁面共用。 */
const SKY = skyAt(HOUR);
const BANDS = skyBands(SKY);

/* 每兩秒做一次跳躍動作——動作而已，腳不離地。

   框是給人看一隻動物的，不是給牠跑的：真的騰空 62 px 之後，牠有半秒不在
   原來的位置上，而在一排格子裡，會動的東西應該是動物本身，不是牠在框裡的
   位置。所以位移不畫，姿勢照做。

   時間軸仍然是真的一次跳躍算出來的：用遊戲自己的重力和起跳速度收到六成
   （`PHYS.jumpCut` 說鬆開跳躍鍵會保留 42%，所以小跳是這遊戲真有的動作），
   得到 0.5 秒的滯空，上升的那半段是 `air`、下降的那半段是 `fall`。vy 也照
   那條弧線給，所以尾巴知道自己正在往上衝或往下掉——那個甩動本來就是這個
   動作的一部分，少了它就只剩兩張定格。 */
export const BEAT = 2.0;
const HOP = 0.60;
const HOP_V = PHYS.jumpVel * HOP;
const HOP_AIR = (2 * HOP_V) / PHYS.gravity;

/**
 * 節拍上的這一刻是什麼姿勢。
 *
 * 由呼叫的人算、傳進來給每一個框，而不是各框自己算：圖鑑上九隻各跳各的
 * 會變成閃爍，一起跳才是一個節拍。
 *
 * @param {number} clock  累積秒數
 * @returns {{state: string, vy: number}}
 */
export function beat(clock) {
  const t = clock % BEAT;
  if (t >= HOP_AIR) return { state: 'run', vy: 0 };
  // 世界 y 往下長，所以上升是負的 vy。位移不用，只用它的正負與大小。
  const vy = -HOP_V + PHYS.gravity * t;
  return { state: vy < 0 ? 'air' : 'fall', vy };
}

/* ── 拿起來看 ─────────────────────────────────────────────────────
   ψ 是「從鏡頭量起」的角度，HOME 的 +π/2 就是這裡陳列用的右側面。拖曳時
   直接把 ψ 釘住（`layer.pin`），不經過遊戲那套轉身——那套有速率上限、有
   ±π/2 的邊界、還有一顆會先轉過去再收回來的頭，全都是為了「轉到某個方向」
   服務的，而這裡的方向已經由手決定了。

   ψ 刻意不取模。尾巴的彈簧鏈是拿 ψ 當「身體朝向」在後面拖的，從 π 跳到 −π
   對它來說是真的跳了一下，尾巴會甩成一條鞭子。連續地累加就沒有這回事，而
   sin/cos 本來就不在乎轉了幾圈。

   SPIN 是每 px 轉多少弧度：一圈約 400 px，一個圖鑑格子的寬度大致是半圈。 */
const HOME = Math.PI / 2;
const SPIN = (Math.PI * 2) / 400;
const SETTLE = 0.18;         // 鬆手後盪回去的時間常數，秒

/* 上下拖是鏡頭的俯仰：往上拖 = 爬到牠上面往下看，往下拖 = 蹲到牠下面
   往上看。手往哪走，鏡頭就往哪走。

   夾在 ±70° 而不是讓它翻過頭去——過了頂點之後畫面會上下顛倒，那不是
   「從上面看」，那是把整頁倒過來，而使用者手上並沒有一個能還原它的東西。 */
const TILT = (Math.PI * 2) / 900;
const TILT_MAX = 1.22;

/**
 * 一個框。
 *
 * 建構時把天空、地面與畫布放進 `view`，然後請呼叫的人在那張畫布上開一層
 * ——`makeLayer` 會拿到畫布、回傳一個 `CatLayer`。之所以是回呼而不是直接
 * 收一個 layer：畫布是這裡造的，而 layer 非有畫布不可，兩者只能有一個先。
 * makeLayer 丟出的例外會照原樣往外傳，讓「這台裝置畫不出來」還是走呼叫端
 * 原本那條退路。
 */
export class Showcase {
  /**
   * @param {HTMLElement} view  要填滿的框
   * @param {(canvas: HTMLCanvasElement) => object} makeLayer
   * @param {object} [opts]  `{ looks, scenery, fill }`
   */
  constructor(view, makeLayer, opts = {}) {
    this.view = view;
    /** 這一格站著誰：一排扁平的 look，等距排開。隨時可以換。 */
    this.looks = opts.looks || [];
    /** 動物佔框高的幾成。見 FILL。 */
    this.fill = opts.fill || FILL;

    /* 布景：天空那一層，加上腳下那條地面線。

       可以整組不要（`scenery: false`），而且那不是「把顏色設成透明」——
       是兩個元素根本不建、每幀也不去碰它們。選單那一格就是這樣：它站在
       卡片上，卡片自己就是它的背景，多畫一片天只是在卡片上挖一個洞。

       不要布景並不會換掉光。動物身上的三階調仍然是同一個時辰算出來的
       （見 SKY），因為那是「這隻動物長什麼樣」的一部分，而布景只是它
       站在哪裡——圖鑑跟選單要一致的是前者。 */
    this.scenery = opts.scenery !== false;

    /* 畫布是透明的（CatLayer 每幀清成 rgba(0,0,0,0)），有布景的時候天空
       畫在它下面那一層，讓三階調的顏色有個對的環境可以看。

       這幾條是結構不是外觀，所以寫在這裡：天空在後、畫布在前、地面是一條
       壓在天空上的線。框的圓角、邊框和大小仍然是頁面自己的樣式。 */
    this.sky = null;
    this.floor = null;
    this.canvas = document.createElement('canvas');
    if (this.scenery) {
      this.sky = document.createElement('div');
      this.floor = document.createElement('div');
      this.sky.style.cssText = 'position:absolute;inset:0;z-index:0';
      this.floor.style.cssText =
        'position:absolute;left:0;right:0;z-index:0;border-top:1px solid rgba(0,0,0,.28)';
      view.append(this.sky, this.floor);
    }
    /* 畫布也是絕對定位的，所以框有多大完全是 CSS 說了算：框可以是
       固定高（圖鑑）也可以是 aspect-ratio（選單那個正方形）。若畫布留在
       流裡，它的高度又反過來決定框的高度，比例就圈回去了。 */
    this.canvas.style.cssText =
      'display:block;position:absolute;inset:0;width:100%;height:100%;z-index:1';
    view.append(this.canvas);
    /* touch-action 是必要的：不關掉的話，手機上橫向拖曳會被瀏覽器判成
       捲頁，pointermove 直接斷在半路。 */
    view.style.position = 'relative';
    view.style.touchAction = 'none';

    this.layer = makeLayer(this.canvas);

    /* yaw 為 null 表示這一格沒被碰過，讓 CatLayer 自己管朝向。一旦拿起來
       看過，它就一直是這一格說了算，直到盪回原位才交還。 */
    this.yaw = null;
    this.pitch = 0;
    this._grab = null;
    this._hold();
  }

  /* ── 手勢 ───────────────────────────────────────────────────────
     指標捕捉（setPointerCapture）不是可有可無的：沒有它，手一離開框的邊界
     就收不到 pointermove，轉到一半會卡住，而且 pointerup 也可能落在別處，
     框會永遠以為自己還被按著。 */

  _hold() {
    const v = this.view;
    v.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      v.setPointerCapture(e.pointerId);
      v.classList.add('held');
      this._grab = {
        id: e.pointerId, x: e.clientX, y: e.clientY,
        yaw: this.yaw == null ? HOME : this.yaw, pitch: this.pitch,
      };
      e.preventDefault();
    });
    v.addEventListener('pointermove', (e) => {
      const g = this._grab;
      if (!g || e.pointerId !== g.id) return;
      this.yaw = g.yaw + (e.clientX - g.x) * SPIN;
      const tilt = g.pitch - (e.clientY - g.y) * TILT;
      this.pitch = Math.max(-TILT_MAX, Math.min(TILT_MAX, tilt));
    });
    const drop = (e) => {
      if (!this._grab || e.pointerId !== this._grab.id) return;
      this._grab = null;
      v.classList.remove('held');
    };
    v.addEventListener('pointerup', drop);
    v.addEventListener('pointercancel', drop);
  }

  /** 鬆手後往原始角度盪回去，並在到家的那一刻把朝向還給 CatLayer。 */
  _settle(dt) {
    if (this._grab || this.yaw == null) return;
    /* 回最近的那一個 HOME，不是回 HOME 本身：轉了三圈之後，短的那條路是
       往回一點點，不是把三圈倒著轉完。 */
    const home = HOME + Math.round((this.yaw - HOME) / (Math.PI * 2)) * Math.PI * 2;
    const k = 1 - Math.exp(-dt / SETTLE);
    this.yaw += (home - this.yaw) * k;
    this.pitch += (0 - this.pitch) * k;
    // 兩件事都到家了才交還，不然會在最後一幀跳一下。
    if (Math.abs(home - this.yaw) < 0.002 && Math.abs(this.pitch) < 0.002) {
      this.yaw = null;
      this.pitch = 0;
    }
  }

  /**
   * 畫一幀。
   *
   * @param {number} dt    秒
   * @param {{state: string, vy: number}} pose  `beat()` 給的節拍姿勢
   */
  draw(dt, pose) {
    this._settle(dt);

    const w = this.view.clientWidth || 400;
    const h = this.view.clientHeight || 400;
    this.layer.resize(w, h, Math.min(devicePixelRatio || 1, 2));

    /* 腳下那條線在框高的八成處，不管畫不畫得出來——動物站在哪裡是幾何，
       不是布景，沒有布景的那一格站的還是同一個位置。 */
    const floorPx = Math.round(h * FLOOR);
    if (this.scenery) {
      this.sky.style.background =
        `linear-gradient(${css(BANDS.top)}, ${css(BANDS.hor)} 62%, ${css(BANDS.bot)})`;
      this.floor.style.top = floorPx + 'px';
      /* 地面線是一條水平線，而俯仰之後腳下那個平面就不再是水平的了。與其
         畫一條說謊的線，不如讓它隨著鏡頭抬起而淡掉。 */
      this.floor.style.opacity = String(Math.max(0, 1 - Math.abs(this.pitch) / 0.45));
    }

    /* 相機是從框的實際尺寸現算的：框高 × fill 是動物該有的 CSS px 高度，
       除以牠真正的世界高度就是倍率。所以框縮小，動物跟著縮小，牠在框裡
       佔的比例不變——這正是固定倍率做不到的那件事。 */
    const zoom = (h * this.fill) / PLAYER_H;
    const vw = w / zoom, vh = h / zoom;
    const feet = floorPx / zoom;
    const n = this.looks.length;

    this.layer.begin({ x: 0, y: 0 }, { w: vw, h: vh }, SKY);
    this.looks.forEach((look, i) => {
      this.layer.pin(look, this.yaw, this.pitch);
      const cx = (vw * (i + 0.5)) / n;
      this.layer.cat(look, cx - PLAYER_W / 2, feet - PLAYER_H,
        1, pose.state, WALK, dt, look, 1, pose.vy);
    });
    this.layer.end();
  }

  /** 收掉這一格的 GL 資源。框自己與監聽器隨 DOM 一起走。 */
  dispose() {
    try { this.layer.dispose(); } catch (e) { /* 已經沒了就算了 */ }
  }
}
