/* ── test-area/src/hud.js ────────────────────────────────────────────
   兩塊面板：左上選生物，右上選地形。

   ── 為什麼是這兩塊，而且在那兩根直欄的上半段 ─────────────────────
   版面是遊戲手把模式的版面：兩側各一根操作列，上半段面板、下半段操作
   元件，中間整片留給遊戲。這一頁只做兩件事——走路，以及看那隻動物——
   所以那兩塊面板剛好是那兩件事的入口：左邊是「牠是什麼」，右邊是「這裡
   是哪裡」。位置與寬度由 pad.js 的幾何決定（CSS 變數 --rail / --ctrl），
   所以面板與它底下的搖桿永遠在同一條列裡。

   沒有觀賞模式，也沒有「關掉圓角」的開關：想細看動物就把鏡頭拉近再繞著
   轉，那件事中間那片畫面本來就做得到，多一個模式只是多一個狀態。

   ── 生物那張表要跟著直欄寬度降級 ─────────────────────────────────
   直欄寬度不是斷點，是算出來的：`min(W·0.155, H·0.44)` 夾在 96 到 190
   之間。所以它可以是 96，而 96 的欄扣掉面板的邊與內距只剩 70 px——那裡
   放不下「動物名 + 三個帶字的色票」，硬塞的結果是每一格折成兩行、整塊
   面板長到蓋住搖桿。

   降級由 `railTier()` 決定，而它吃的就是 pad.js 算出來的那個欄寬，
   不是 `@media (max-width)`：同樣 800 px 寬的畫面，橫放 360 高的手機
   欄寬是 158，豎放 900 高的平板是 124，媒體查詢分不出這兩個，而它們
   要的版面不一樣。

     wide（≥150）  動物用全名（貓／立耳犬／垂耳犬）
     mid（≥112）   動物用全名，格子縮到只剩色點
     narrow（<112）動物用單字（貓／立／垂），格子只剩色點

   色票沒有字的時候，「現在選的是哪一件」由標題那一行說（生物・立耳犬
   ・黃）與選中時中央那一閃說。滑鼠停在格子上還有 title。

   ── 生物那張表就是遊戲選單那張表 ─────────────────────────────────
   一行一種動物、一列一件毛色，行列由 `looks.js` 的 `lookGrid` 算——連
   名字（貓／立耳犬／垂耳犬、橘白／虎斑／三花…）與色票（`swatchCss`）
   都是那一份。遊戲哪天加了第四種動物，這張表自己會多一行；毛色數參差
   也只是右邊少幾格，不會錯行。那支檔案的注解把這件事講得很清楚，這裡
   照著用而不是自己排。

   底下那一行是帽子。它跟毛色是同一類的事情（外觀），但它不是 look 的
   一部分——伺服器不認得服裝，`looks.js` 也不管它，所以它在表格外面、
   自己一行。

   ── 這支只碰 DOM ─────────────────────────────────────────────────
   選了什麼由 callback 往外送，面板不知道場景長什麼樣，也不碰 zoo 以外
   的任何東西。狀態的唯一來源是 zoo 與 main.js，`paint()` 只是把那個狀態
   畫成選中的樣子。
   ------------------------------------------------------------------ */

import { lookInfo, swatchCss, modelName } from '../../src/cat/looks.js';

/**
 * 直欄有多寬 → 生物那張表穿哪一套。
 *
 * 純函式，所以離線驗得到——這幾個門檻是量出來的：一格色點連邊框與內距
 * 是 16 px，三格加兩道 3 px 的縫是 54；動物的全名（三個字，10 px）約
 * 34 px、單字約 13 px；面板自己吃掉 16 px 的邊與 10 px 的內距。
 * 於是全名 + 三個色點要 114，單字 + 三個色點要 93。
 */
export const railTier = (rail) => (rail >= 150 ? 'wide' : rail >= 112 ? 'mid' : 'narrow');

export class Hud {
  /**
   * @param {object} o
   *   zoo      Zoo，用來知道有哪些 look 與現在選哪一個
   *   blocks   區塊名冊（blocks.js 的 BLOCKS）
   *   onLook   選了某個 look
   *   onBlock  選了某個區塊 id
   *   onHat    切帽子
   */
  constructor(o) {
    this.o = o;
    this.zoo = o.zoo;
    this.el = {
      looks: document.getElementById('looks'),
      lookName: document.getElementById('look-name'),
      hat: document.getElementById('hat-row'),
      terrain: document.getElementById('terrain'),
      hint: document.getElementById('terrain-hint'),
      stats: document.getElementById('stats'),
      toast: document.getElementById('toast'),
    };
    this._fade = 0;
    this._build();
  }

  _build() {
    /* ── 生物：一行一種動物，最左邊是動物的名字 ── */
    const cells = this.zoo.looks();
    const rows = Math.max(...cells.map((c) => c.row));
    const cols = Math.max(...cells.map((c) => c.col));
    /* minmax(0, 1fr) 而不是 1fr：1fr 的下限是內容的最小寬度，所以格子
       在 96 的欄裡會擠不進去而把整張表推寬（然後被面板裁掉）。 */
    this.el.looks.style.gridTemplateColumns = `auto repeat(${cols}, minmax(0, 1fr))`;
    this.lookBtns = new Map();
    /* 每一行最左邊是動物的名字。全名與單字都先寫進去，切哪一個由 CSS
       決定（見 railTier）——換裝的時候不動 DOM，才不會在轉螢幕的那一幀
       重建整張表。 */
    this.rowNames = [];
    for (let r = 1; r <= rows; r++) {
      const first = cells.find((c) => c.row === r);
      const name = modelName(lookInfo(first.look).model);
      const label = document.createElement('span');
      label.className = 'rowname';
      label.title = name;
      label.style.gridRow = String(r);
      label.style.gridColumn = '1';
      const full = document.createElement('b');
      full.className = 'full';
      full.textContent = name;
      const short = document.createElement('b');
      short.className = 'short';
      short.textContent = name[0];
      label.append(full, short);
      this.el.looks.appendChild(label);
      this.rowNames.push(label);
    }
    for (const c of cells) {
      const info = lookInfo(c.look);
      const b = document.createElement('button');
      b.className = 'chip';
      b.style.gridRow = String(c.row);
      b.style.gridColumn = String(c.col + 1);
      b.title = info.name;
      const sw = document.createElement('i');
      sw.style.background = swatchCss(info.swatch);
      // 名字包在 span 裡：極窄的畫面只留色點（見 index.html 的 media query）。
      const name = document.createElement('span');
      name.textContent = info.skinName;
      b.append(sw, name);
      b.onclick = () => this.o.onLook(c.look);
      this.el.looks.appendChild(b);
      this.lookBtns.set(c.look, b);
    }

    /* ── 帽子：表格外面、自己一行 ── */
    this.hatBtn = document.createElement('button');
    this.hatBtn.className = 'wide';
    this.hatBtn.onclick = () => this.o.onHat();
    this.el.hat.appendChild(this.hatBtn);

    /* ── 地形 ── */
    this.blockBtns = new Map();
    this.o.blocks.forEach((blk, i) => {
      const b = document.createElement('button');
      b.className = 'wide';
      b.innerHTML = `<b>${i + 1}</b>${blk.name}`;
      b.onclick = () => this.o.onBlock(blk.id);
      this.el.terrain.appendChild(b);
      this.blockBtns.set(blk.id, b);
    });

    this.paint();
  }

  /**
   * 直欄寬度變了：換一套裝。
   *
   * main.js 在每次 resize 之後叫，值就是 pad.js 算出來的欄寬，所以面板
   * 與它底下的搖桿看到的是同一個數字。
   */
  fit(rail) {
    const tier = railTier(rail);
    if (tier === this._tier) return;
    this._tier = tier;
    document.body.dataset.rail = tier;
  }

  /** 把 zoo 與 main.js 的狀態畫成「選中」的樣子。 */
  paint(state = {}) {
    for (const [look, b] of this.lookBtns) b.classList.toggle('on', look === this.zoo.look);
    /* 色票在窄欄裡沒有字，所以「現在選的是哪一件」由標題那一行說。 */
    if (this.el.lookName) this.el.lookName.textContent = lookInfo(this.zoo.look).name;
    this.hatBtn.textContent = this.zoo.hatOn ? '帽子：戴著' : '帽子：脫掉';
    this.hatBtn.classList.toggle('on', this.zoo.hatOn);
    if (state.block) {
      for (const [id, b] of this.blockBtns) b.classList.toggle('on', id === state.block);
      const blk = this.o.blocks.find((x) => x.id === state.block);
      if (blk) this.el.hint.textContent = blk.hint;
    }
  }

  flash(msg) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('on');
    this._fade = 1.8;
  }

  /**
   * @param {number} dt
   * @param {object} [line] 要寫進右上那一行小字的東西
   */
  tick(dt, line) {
    if (this._fade > 0) {
      this._fade -= dt;
      if (this._fade <= 0) this.el.toast.classList.remove('on');
    }
    if (line) this.el.stats.textContent = line;
  }
}
