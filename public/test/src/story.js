/* ── test/src/story.js ───────────────────────────────────────────────
   關卡與關卡之間的劇情（完整流程模式，mode-flow.js）：斬殺最後一隻怪物的那一刻
   起，慢動作一小段，一大張書頁從右邊跑進畫面把它整個蓋住，書頁上是一頁漫畫；
   點一下（或按跳）書頁往左邊跑走，遊戲接著玩。

   ── 一次劇情 ────────────────────────────────────────────────────
     慢動作   STORY.slow 秒（真實時間）。世界的時間乘上 STORY.scale：最後那一下的
              擊退、血、靈魂掉出來都慢慢地走。操作收起來（身體照慣性停下）。
     書頁進來 STORY.enter 秒。世界還是慢動作，書頁從右邊斜著滑進來，越來越慢，
              停下來的時候是正的、四邊都超出畫面。
     蓋住     世界停住（scale 0、模式整幀不算也不畫——反正看不到）。分格一格一格
              浮出來；STORY.ready 秒之後才收按鍵——在那之前按的（打怪的時候一直在
              按跳）都不算，不然最後一刀的那一下跳就把漫畫跳過了。
     書頁離開 點一下（或按跳）：STORY.leave 秒往左邊滑走、越走越快。世界一開始走就
              是正常速度，操作也還回來了——跟 transit.js 亮回來那一段一樣，書頁走到
              一半就想走是對的。走完之後 `then`（模式要浮的那一行字）。

   ── 漫畫 ────────────────────────────────────────────────────────
   COMICS 照場次排：第 k 場打完放第 k 頁。每一格是 { src }（圖）或 { note }（還沒畫，
   放佔位：格號與這一格要畫什麼）。現在全部是佔位；漫畫畫好了，把 src 填進去就好，
   版面（index.html 的 #story，照直向／橫向各一套）不用動。

   `el` 給 null 也跑得動（node 裡驗時間軸用）。
   ------------------------------------------------------------------ */

/** 慢動作幾秒、慢成幾倍、書頁進來幾秒、蓋住之後幾秒才收按鍵、書頁離開幾秒（全部是真實時間）。 */
export const STORY = { slow: 1.1, scale: 0.15, enter: 0.7, ready: 0.9, leave: 0.6 };

/** 分格一格一格浮出來，每一格比前一格晚幾秒。 */
const STAGGER = 0.12;

/** 還沒畫的一格：只有佔位。 */
const TODO = { note: '' };

/**
 * 每一場打完的那一頁的分格，照場次排（跟 route.js 的 STAGES 一樣長；少了的那幾場用 FALLBACK）。
 * 現在全部是佔位。版面是四格（styles 在 index.html 的 #story：橫向一寬兩窄再一寬，
 * 直向上寬、中間兩格、下寬），第 i 格放進 grid-area 'abcd'[i]。
 */
export const COMICS = Array.from({ length: 6 }, () => ({ panels: [TODO, TODO, TODO, TODO] }));
const FALLBACK = { panels: [TODO, TODO, TODO, TODO] };

const easeOut = (u) => 1 - (1 - u) ** 3;
const easeIn = (u) => u * u * u;

export class Story {
  /** @param {HTMLElement | null} el 整張書頁的容器（#story） */
  constructor(el) {
    this.el = el;
    /** 這一次劇情開始之後幾秒（真實時間）；-1 = 沒在演。 */
    this.t = -1;
    /** 書頁開始離開之後幾秒；-1 = 還沒離開。 */
    this.out = -1;
    this.then = null;
    /** 點了書頁（DOM 的 click 沒辦法等到下一幀才發生，先記著）。 */
    this._tapped = false;
    if (el) {
      el.innerHTML = '<div class="page"><div class="sheet"><h3 class="title"></h3>'
        + '<div class="panels"></div><div class="folio"></div><div class="next">點一下或按跳繼續</div></div></div>';
      this.page = el.querySelector('.page');
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this._tapped = true; });
    }
    this._paint();
  }

  /** 慢動作、書頁進來、蓋住的時候：操作收起來。書頁一開始離開就還回來。 */
  get busy() { return this.t >= 0 && this.out < 0; }

  /** 書頁整個蓋住畫面（世界停住，不用算也不用畫）。 */
  get covered() { return this.t >= STORY.slow + STORY.enter && this.out < 0; }

  /**
   * 第 k 場（名字是 `name`）打完：開始演。`then` 在書頁走完的時候叫（模式拿來浮字——書頁還在的時候浮
   * 的字被蓋住了，看不到）。
   */
  start(k, name, then = null) {
    this.t = 0;
    this.out = -1;
    this.then = then;
    this._tapped = false;
    if (this.el) this._fill(COMICS[k] || FALLBACK, k, name);
    this._paint();
  }

  /** 不演了（重玩、從第幾場開始、倒下）：書頁直接收掉，`then` 不叫。 */
  cancel() {
    this.t = -1;
    this.out = -1;
    this.then = null;
    this._paint();
  }

  /**
   * 每幀一次，在世界的任何東西之前。`pressed` 是這一幀有沒有按跳。
   * 回傳世界的時間這一幀要乘幾倍（1 = 正常、0 = 停住）。
   * @param {number} real 真實時間過了幾秒
   * @param {boolean} pressed
   */
  update(real, pressed) {
    const tapped = this._tapped;
    this._tapped = false;
    if (this.t < 0) return 1;
    if (this.out >= 0) {
      this.out += real;
      if (this.out >= STORY.leave) {
        const then = this.then;
        this.cancel();
        if (then) then();
        return 1;
      }
      this._paint();
      return 1;
    }
    this.t += real;
    if ((pressed || tapped) && this.t >= STORY.slow + STORY.enter + STORY.ready) this.out = 0;
    this._paint();
    if (this.out >= 0) return 1;
    return this.covered ? 0 : STORY.scale;
  }

  /** 換成第 k 場那一頁：標題、分格、頁碼。分格浮出來的動畫由 CSS 管（蓋住、.shown 加上去的時候開始）。 */
  _fill(comic, k, name) {
    const sheet = this.el.querySelector('.sheet');
    sheet.querySelector('.title').textContent = `第 ${k + 1} 場・${name}`;
    sheet.querySelector('.folio').textContent = `— ${k + 1} —`;
    const box = sheet.querySelector('.panels');
    box.textContent = '';
    comic.panels.forEach((p, i) => {
      const cell = document.createElement('div');
      cell.className = 'panel-cell';
      cell.style.gridArea = 'abcdefgh'[i];
      cell.style.setProperty('--delay', `${(i * STAGGER).toFixed(2)}s`);
      if (p.src) {
        const img = document.createElement('img');
        img.src = p.src;
        img.alt = p.note || '';
        cell.append(img);
      } else {
        cell.classList.add('todo');
        const n = document.createElement('b');
        n.textContent = `分格 ${i + 1}`;
        const s = document.createElement('span');
        s.textContent = p.note ? `待繪：${p.note}` : '待繪';
        cell.append(n, s);
      }
      box.append(cell);
    });
  }

  _paint() {
    if (!this.el) return;
    const on = this.t >= 0;
    this.el.classList.toggle('on', on);
    // 分格照劇情的時間浮出來（不是照 CSS 自己的鐘：卡頓的時候兩個鐘會差開）。
    this.el.classList.toggle('shown', on && (this.out >= 0 || this.t >= STORY.slow + STORY.enter));
    this.el.classList.toggle('ready', on && this.out < 0 && this.t >= STORY.slow + STORY.enter + STORY.ready);
    // 書頁：進來是從右邊斜著滑進來、越來越慢；離開是往左邊滑走、越來越快，一邊再斜回去。
    let x = 130, rot = 9;
    if (this.out >= 0) {
      const u = easeIn(Math.min(1, this.out / STORY.leave));
      x = -135 * u; rot = -7 * u;
    } else if (on) {
      const u = easeOut(Math.min(1, Math.max(0, (this.t - STORY.slow) / STORY.enter)));
      x = 130 * (1 - u); rot = 9 * (1 - u);
    }
    this.page.style.transform = `translateX(${x.toFixed(2)}vw) rotate(${rot.toFixed(2)}deg)`;
  }
}
