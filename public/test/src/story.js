/* ── test/src/story.js ───────────────────────────────────────────────
   場與場之間的劇情（完整流程模式，mode-flow.js）：一大張書頁從右邊跑進畫面把它
   整個蓋住，書頁上是一頁漫畫；點一下（或按跳）翻到下一頁，最後一頁再點一下書頁
   往左邊跑走，遊戲接著玩。翻哪幾頁、什麼時候翻是 comic.js 的 SCRIPT。

   ── 一次劇情 ────────────────────────────────────────────────────
     慢動作   只有戰後頁有（`slow`）：STORY.slow 秒（真實時間），世界的時間乘上
              STORY.scale——最後那一下的擊退、血、靈魂掉出來都慢慢地走。開場頁沒有
              這一段，書頁直接進來。操作收起來（身體照慣性停下）。
     書頁進來 STORY.enter 秒，書頁從右邊斜著滑進來，越來越慢，停下來的時候是正的、
              四邊都超出畫面。世界照常走（戰後頁還是慢動作）。
     蓋住     世界停住（scale 0、模式整幀不算也不畫——反正看不到）。分格一格一格
              從右邊滑進來、落到自己的位置（跟書頁進來一樣：斜著、越來越慢、停下來的
              時候擺正），每一格比前一格晚 PANEL.step 秒，拼完這一頁才算翻得動——拼到一半
              按一下是把剩下的直接拼好。第一頁 STORY.ready 秒之後才收按鍵——在那之前按的（打怪的時候
              一直在按跳）都不算，不然最後一刀的那一下跳就把漫畫跳過了；後面幾頁是
              STORY.readyNext 秒（翻頁的時候手已經停了，只防連按兩下翻過一頁）。
     翻頁     不是最後一頁：STORY.turn 秒，這一頁往左邊翻走，底下已經是下一頁的紙
              （標題、頁碼），分格等翻完才一格一格滑進來。
     書頁離開 最後一頁：STORY.leave 秒往左邊滑走、越走越快。世界一開始走就是正常
              速度，操作也還回來了——跟 transit.js 亮回來那一段一樣，書頁走到一半就
              想走是對的。走完之後 `then`。

   書頁是兩張輪流用的 .page：在上面的那一張是這一頁，翻頁的時候下一頁先畫在底下那一張，
   上面那一張翻走之後兩張對調。

   ── 漫畫 ────────────────────────────────────────────────────────
   每一頁 { title, folio, panels }（comic.js 的 pagesOf）。每一格是 { src }（圖）或
   { note, say }（還沒畫，放佔位：格號、這一格要畫什麼、格子裡的字）。版面照格數
   （3～5 格）與直向／橫向各一套，在 index.html 的 #story。

   `el` 給 null 也跑得動（node 裡驗時間軸用）。
   ------------------------------------------------------------------ */

/**
 * 慢動作幾秒、慢成幾倍、書頁進來幾秒、蓋住之後第一頁／後面幾頁幾秒才收按鍵、翻一頁幾秒、
 * 書頁離開幾秒（全部是真實時間）。
 */
export const STORY = { slow: 1.1, scale: 0.15, enter: 0.7, ready: 0.9, readyNext: 0.35, turn: 0.55, leave: 0.6 };

/** 分格滑進來：每一格比前一格晚幾秒、一格滑幾秒（真實時間）。 */
export const PANEL = { step: 0.28, dur: 0.5 };

/** n 格的一頁，從開始拼到最後一格落定要幾秒。 */
export const builtIn = (n) => (n - 1) * PANEL.step + PANEL.dur;

/**
 * 格子裡的字：「誰：說什麼」。旁白放進方框；有人名的（對白）人名另起一行；沒有的是心聲。
 * 回傳一個 .cap，裡面是（人名）與那一句。
 */
function caption(say) {
  const [, who, words] = /^(?:(.+?)：)?(.+)$/.exec(say);
  const box = document.createElement('div');
  box.className = `cap ${who === '旁白' ? 'narr' : who ? 'speech' : 'thought'}`;
  if (who && who !== '旁白') {
    const w = document.createElement('small');
    w.textContent = who;
    box.append(w);
  }
  const q = document.createElement('q');
  if (who === '旁白') q.className = 'narr';
  q.textContent = words;
  box.append(q);
  return box;
}

const easeOut = (u) => 1 - (1 - u) ** 3;
const easeIn = (u) => u * u * u;
const clamp01 = (u) => Math.min(1, Math.max(0, u));

export class Story {
  /** @param {HTMLElement | null} el 整張書頁的容器（#story） */
  constructor(el) {
    this.el = el;
    /** 這一次劇情開始之後幾秒（真實時間）；-1 = 沒在演。 */
    this.t = -1;
    this.pages = [];
    /** 現在是第幾頁（pages 的索引）。 */
    this.i = 0;
    /** 這一頁蓋住（或翻到）之後幾秒。 */
    this.since = 0;
    /** 翻頁開始之後幾秒；-1 = 沒在翻。 */
    this.turn = -1;
    /** 書頁開始離開之後幾秒；-1 = 還沒離開。 */
    this.out = -1;
    this.slow = false;
    this.then = null;
    this.cover = null;
    /** 點了書頁（DOM 的 click 沒辦法等到下一幀才發生，先記著）。 */
    this._tapped = false;
    if (el) {
      const page = '<div class="page"><div class="sheet"><h3 class="title"></h3>'
        + '<div class="panels"></div><div class="folio"></div><div class="next"></div></div></div>';
      el.innerHTML = page + page;
      /** [上面那一張, 底下那一張]。 */
      this.sheets = [...el.querySelectorAll('.page')];
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this._tapped = true; });
    }
    this._paint();
  }

  /** 在演（從開始到書頁走完）。 */
  get on() { return this.t >= 0; }

  /** 慢動作、書頁進來、蓋住、翻頁的時候：操作收起來。書頁一開始離開就還回來。 */
  get busy() { return this.t >= 0 && this.out < 0; }

  /** 書頁從開始到整個蓋住要幾秒（戰後頁多一段慢動作）。 */
  get _lead() { return (this.slow ? STORY.slow : 0) + STORY.enter; }

  /** 書頁整個蓋住畫面（世界停住，不用算也不用畫）。 */
  get covered() { return this.t >= this._lead && this.out < 0; }

  /**
   * 開始翻 `pages`（comic.js 的 pagesOf）。
   *   slow   先慢動作再進來（戰後頁）；否則書頁直接進來（開場頁）。
   *   then   書頁走完的時候叫（模式拿來浮字、讓怪物出來——書頁還在的時候都看不到）。
   *   cover  書頁剛好整個蓋住的那一幀叫一次（模式拿來把人送走——那一跳落在書頁底下）。
   */
  start(pages, { slow = false, then = null, cover = null } = {}) {
    this.t = 0;
    this.pages = pages;
    this.i = 0;
    this.since = 0;
    this.turn = -1;
    this.out = -1;
    this.slow = slow;
    this.then = then;
    this.cover = cover;
    this._tapped = false;
    if (this.el) {
      this._fill(this.sheets[0], 0);
      this.sheets[1].style.visibility = 'hidden';
    }
    this._paint();
  }

  /** 不演了（重玩、從第幾場開始、倒下）：書頁直接收掉，`then`、`cover` 都不叫。 */
  cancel() {
    this.t = -1;
    this.turn = -1;
    this.out = -1;
    this.then = null;
    this.cover = null;
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
    if (this.covered && this.cover) {
      const cover = this.cover;
      this.cover = null;
      cover();
    }
    if (this.turn >= 0) {
      this.turn += real;
      if (this.turn >= STORY.turn) this._turned();
    } else if (this.covered) {
      this.since += real;
      const wait = this.i === 0 ? STORY.ready : STORY.readyNext;
      if ((pressed || tapped) && this.since >= wait) {
        if (!this._built) this.since = builtIn(this.pages[this.i].panels.length);
        else if (this.i + 1 < this.pages.length) this._turn();
        else this.out = 0;
      }
    }
    this._paint();
    if (this.out >= 0) return 1;
    if (this.covered) return 0;
    return this.slow ? STORY.scale : 1;
  }

  /** 這一頁的分格全部拼好了。 */
  get _built() { return this.since >= builtIn(this.pages[this.i].panels.length); }

  /** 開始翻到下一頁：下一頁先畫在底下那一張。 */
  _turn() {
    this.turn = 0;
    if (this.el) this._fill(this.sheets[1], this.i + 1);
  }

  /** 翻完：底下那一張變成這一頁。 */
  _turned() {
    this.turn = -1;
    this.i++;
    this.since = 0;
    if (this.el) this.sheets.reverse();
  }

  /** 把第 i 頁畫進 `page`：標題、分格、頁碼、提示。分格滑進來由 _paint 照劇情的時間擺。 */
  _fill(page, i) {
    const comic = this.pages[i];
    page.classList.remove('ready');
    page.querySelector('.title').textContent = comic.title;
    page.querySelector('.folio').textContent = `— ${comic.folio} —`;
    page.querySelector('.next').textContent = i + 1 < this.pages.length ? '點一下或按跳翻頁' : '點一下或按跳繼續';
    const box = page.querySelector('.panels');
    box.dataset.n = comic.panels.length;
    box.textContent = '';
    comic.panels.forEach((p, k) => {
      const cell = document.createElement('div');
      cell.className = 'panel-cell';
      cell.style.gridArea = 'abcdefgh'[k];
      if (p.memory) cell.classList.add('memory');
      if (p.src) {
        const img = document.createElement('img');
        img.src = p.src;
        img.alt = p.note || '';
        if (p.focus) img.style.objectPosition = p.focus;
        cell.append(img);
        if (p.say) {
          const cap = caption(p.say);
          if (p.capAt === 'bottom') cap.classList.add('low');
          cell.append(cap);
        }
      } else {
        cell.classList.add('todo');
        const n = document.createElement('b');
        n.textContent = `分格 ${k + 1}`;
        const s = document.createElement('span');
        s.textContent = p.note ? `待繪：${p.note}` : '待繪';
        cell.append(n, s);
        if (p.say) cell.append(...caption(p.say).childNodes);
      }
      box.append(cell);
    });
  }

  _paint() {
    if (!this.el) return;
    const on = this.t >= 0;
    this.el.classList.toggle('on', on);
    const [top, under] = this.sheets;
    top.classList.toggle('ready', on && this.out < 0 && this.turn < 0 && this.covered && this._built
      && this.since >= (this.i === 0 ? STORY.ready : STORY.readyNext));
    // 分格照劇情的時間滑進來（不是照 CSS 自己的鐘：卡頓的時候兩個鐘會差開）。書頁走的時候是拼好的。
    const since = !on ? 0 : this.out >= 0 || this.turn >= 0 ? Infinity : this.covered ? this.since : 0;
    this._lay(top, since);
    this._lay(under, 0);
    // 上面那一張：進來是從右邊斜著滑進來、越來越慢；翻走與離開是往左邊滑走、越來越快，一邊再斜回去。
    let x = 130, rot = 9;
    if (this.out >= 0 || this.turn >= 0) {
      const u = easeIn(clamp01(this.out >= 0 ? this.out / STORY.leave : this.turn / STORY.turn));
      x = -135 * u; rot = -7 * u;
    } else if (on) {
      const u = easeOut(clamp01((this.t - (this.slow ? STORY.slow : 0)) / STORY.enter));
      x = 130 * (1 - u); rot = 9 * (1 - u);
    }
    top.style.transform = `translateX(${x.toFixed(2)}vw) rotate(${rot.toFixed(2)}deg)`;
    top.style.zIndex = '2';
    top.style.visibility = '';
    // 底下那一張：翻頁的時候已經擺正在原位，分格跟著浮出來；其他時候藏起來。
    under.style.zIndex = '1';
    under.style.transform = 'none';
    under.style.visibility = this.turn >= 0 ? '' : 'hidden';
  }

  /**
   * 拼到 `since` 秒的時候每一格在哪：還沒輪到的在右邊畫面外，滑的時候斜著、浮起來一點、
   * 底下有影子（一張紙片蓋上去），越來越慢，落定的時候擺正、貼平。
   */
  _lay(page, since) {
    page.querySelectorAll('.panel-cell').forEach((cell, k) => {
      const e = easeOut(clamp01((since - k * PANEL.step) / PANEL.dur));
      if (e >= 1) {
        cell.style.transform = 'none';       // 不是 ''：那會退回 CSS 的「在畫面外」
        cell.style.boxShadow = '';
        return;
      }
      const u = 1 - e;
      cell.style.transform = `translate(${(110 * u).toFixed(2)}vw, ${(-2 * u).toFixed(2)}vmin) `
        + `rotate(${(7 * u).toFixed(2)}deg) scale(${(1 + 0.04 * u).toFixed(4)})`;
      cell.style.boxShadow = `0 ${(1.5 * u).toFixed(2)}vmin ${(4 * u).toFixed(2)}vmin rgba(0, 0, 0, ${(0.35 * u).toFixed(3)})`;
    });
  }
}
