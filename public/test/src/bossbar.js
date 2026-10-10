/* ── test/src/bossbar.js ─────────────────────────────────────────────
   這一場的 BOSS 的血條（route.js 的 STAGES，foes 裡帶 `boss` 的那一隻）：畫面最上方、
   遊戲那一片的正中間，上面一行是牠的名字。不寫數字——剩多少血看橙色那一截還有多長。

   ── 樣子 ──────────────────────────────────────────────────────────
   一條很圓的圓角長條（兩端是半圓），跟遊戲的卡通著色一樣是分層的、硬邊的：墨線框住，底下
   墊一道往下偏的影子；槽是凹的（上緣一道更暗的內影），每一層血都是三階——中間是底色、
   下面一截是暗面、上面一條細的亮面，沒有漸層。沒有別的裝飾。

   ── 一生 ──────────────────────────────────────────────────────────
     出現   BOSS 出生的那一刻（開始從地底升上來，或在漫畫底下生好）：從中間往左右
            長開，0 長到全寬（OPEN 秒），一直是那個圓角長條的形狀；名字隨後淡進來。
     挨打   三層，由下往上是白、黃、橙（`meter`）。橙色那一截馬上縮到剩下的血；這一下扣掉的
            那一段變黃，黃色 HIT.yellow 秒縮到底，白色 HIT.white 秒才縮到剩下的血。
            連著挨打：黃與白都從它們這一刻的位置重新縮向新的血，不跳回去。
     死掉   最後一下的黃色縮完，整條（連名字與影子）像灰塵一樣由左到右散掉：一條
            掃過去的線（DUST.sweep 秒），掃過的那一點碎成小方塊，往右上飄、淡掉。
     收起來 倒下、重玩：直接不見（沒死就不散）。

   時間是真實時間：殺死 BOSS 的那一刻世界是慢動作（story.js），血條照常散。

   畫在一張 2D 畫布（#bossbar）上：散掉那一段是一粒一粒的灰，DOM 做不到。畫布在黑幕
   （#fade）與書頁底下。血條在的時候 body 帶 `boss`，toast 往下讓（index.html）。
   ------------------------------------------------------------------ */

/** 從中間長開幾秒。 */
const OPEN = 0.6;
/** 挨打：黃色那一段幾秒縮到底，白色幾秒縮到剩下的血。 */
export const HIT = { yellow: 0.05, white: 0.5 };
/**
 * 散掉：掃過整條幾秒；每一粒比掃到它的那一刻再晚 0 到 jitter 秒才碎（邊緣是毛的）；
 * 一粒多大（CSS 像素）、飄幾秒；往右的風與往上的浮力（像素／秒²）。
 */
const DUST = { sweep: 0.9, jitter: 0.12, cell: 2, life: [0.45, 0.9], wind: 40, lift: 30 };

/**
 * 版面（CSS 像素）：畫布多高，名字的中線，條的上緣與高（不含墨線），條的寬是遊戲那一片的幾成
 * （夾在 min～max），墨線多粗，影子往下偏多少。圓角是高的一半：兩端是半圓。
 */
const BOX = { h: 64, name: 18, y: 31, bar: 14, w: 0.56, min: 180, max: 520, line: 2.5, drop: 3 };

/** 每一層三階：底色、暗面（下面那一截）、亮面（上面那一條）。槽的「亮面」是上緣的內影。 */
const COL = {
  ink: 'rgb(43, 35, 32)', shadow: 'rgba(0, 0, 0, 0.35)', name: '#f7efdd',
  track: ['#3a2c22', '#2e231b', '#1d1611'],
  white: ['#fff6e6', '#ddcdb4', '#ffffff'],
  yellow: ['#ffd84a', '#e3a922', '#fff3a6'],
  orange: ['#f39a3a', '#c9621b', '#ffc77e'],
};

/** 暗面佔下面幾成、亮面在上面幾成到幾成（條的高）。 */
const BAND = { shade: 0.38, light: [0.16, 0.34] };

/** 圓角長條的路徑：(x, y) 起、寬 w、高 h，圓角半徑是高的一半（不夠寬就更小）。 */
function pill(g, x, y, w, h) {
  const r = Math.min(h / 2, w / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** 血條的三層（0..1）：橙（剩下的血）、黃、白，與黃、白正在縮的那一段（從哪裡、縮了幾秒）。 */
export const makeMeter = () => ({ hp: 1, yellow: 1, white: 1, y: null, w: null });

/**
 * 血變成 r。少了：黃從它現在的位置（至少是這一下之前的血）、白從它現在的位置，各自重新開始
 * 縮向 r。多了（不會發生，保險）：三層一起跳到 r。
 */
export function meterSet(mt, r) {
  r = clamp01(r);
  if (r < mt.hp) {
    mt.y = { from: Math.max(mt.yellow, mt.hp), t: 0 };
    mt.w = { from: mt.white, t: 0 };
  } else if (r > mt.hp) {
    mt.yellow = mt.white = r;
    mt.y = mt.w = null;
  }
  mt.hp = r;
}

/** 往前 dt 秒：黃、白照 HIT 的秒數等速縮到剩下的血。 */
export function meterStep(mt, dt) {
  for (const [k, dur] of [['y', HIT.yellow], ['w', HIT.white]]) {
    const s = mt[k];
    if (!s) continue;
    s.t += dt;
    const u = Math.min(1, s.t / dur);
    mt[k === 'y' ? 'yellow' : 'white'] = s.from + (mt.hp - s.from) * u;
    if (u >= 1) mt[k] = null;
  }
}

export class BossBar {
  /** @param {HTMLCanvasElement} el 最上方那一張 2D 畫布（#bossbar） */
  constructor(el) {
    this.el = el;
    this.g = el.getContext('2d');
    /** null（沒有）、'live'（在場上）、'dying'（死了，等黃色縮完）、'dust'（散掉中）。 */
    this.state = null;
    this.t = 0;
    this.name = '';
    this.meter = makeMeter();
    this._dust = null;
  }

  get on() { return this.state !== null; }

  /** BOSS 出生：從中間長開，血是滿的。 */
  show(name) {
    this.state = 'live';
    this.t = 0;
    this.name = name;
    this.meter = makeMeter();
    this._dust = null;
    document.body.classList.add('boss');
  }

  /** 剩下的血（0..1）。 */
  set(ratio) {
    if (this.state === 'live') meterSet(this.meter, ratio);
  }

  /** 死了：血歸零，最後那一下的黃色縮完就散掉（update）。 */
  die() {
    if (this.state !== 'live') return;
    meterSet(this.meter, 0);
    this.state = 'dying';
  }

  /** 馬上不見。 */
  hide() {
    this.state = null;
    this._dust = null;
    document.body.classList.remove('boss');
    this.g.clearRect(0, 0, this.el.width, this.el.height);
  }

  /** 一幀（真實時間）。 */
  update(dt) {
    if (!this.state) return;
    this.t += dt;
    meterStep(this.meter, dt);
    if (this.state === 'dying' && !this.meter.y) {
      this.state = 'dust';
      this.t = 0;
      this._dust = this._shatter();
    }
    const dpr = this._fit(), g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.el.width, this.el.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.state === 'dust') {
      if (!this._drawDust(g)) this.hide();
      return;
    }
    const u = Math.min(1, this.t / OPEN);
    this._paint(g, 1 - (1 - u) ** 3, clamp01((this.t - OPEN * 0.4) / (OPEN * 0.6)));
  }

  /** 畫布跟著自己在頁面上的大小（與像素比）走。回傳像素比。 */
  _fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.el.clientWidth * dpr), h = Math.round(this.el.clientHeight * dpr);
    if (this.el.width !== w || this.el.height !== h) { this.el.width = w; this.el.height = h; }
    return dpr;
  }

  /** 條在畫布上的位置（CSS 像素）：中心 cx、寬 w。 */
  _geom() {
    const W = this.el.clientWidth;
    return { cx: W / 2, w: Math.min(BOX.max, Math.max(BOX.min, W * BOX.w)) };
  }

  /** 畫一條：長開了 open（0..1，從中間往兩邊長，一直是圓角長條），名字的透明度 alpha。 */
  _paint(g, open, alpha) {
    const { cx, w: full } = this._geom(), { y, bar: h, line, drop } = BOX, mt = this.meter;
    const w = full * open, x0 = cx - w / 2, o = line / 2;
    if (w > 1) {
      // 影子、墨線框（往外 line），裡面是槽與三層血：都剪在條的圓角裡。
      g.fillStyle = COL.shadow;
      pill(g, x0 - line, y - line + drop, w + line * 2, h + line * 2);
      g.fill();
      g.fillStyle = COL.ink;
      pill(g, x0 - line, y - line, w + line * 2, h + line * 2);
      g.fill();
      g.save();
      pill(g, x0, y, w, h);
      g.clip();
      const band = (cols, from, to) => {
        if (to <= from) return;
        g.fillStyle = cols[0];
        g.fillRect(from, y, to - from, h);
        g.fillStyle = cols[1];
        g.fillRect(from, y + h * (1 - BAND.shade), to - from, h * BAND.shade);
        g.fillStyle = cols[2];
        g.fillRect(from, y + h * BAND.light[0], to - from, h * (BAND.light[1] - BAND.light[0]));
      };
      // 槽是凹的：底色、下面一截稍亮，上緣一道內影。
      g.fillStyle = COL.track[0];
      g.fillRect(x0, y, w, h);
      g.fillStyle = COL.track[1];
      g.fillRect(x0, y + h * (1 - BAND.shade), w, h * BAND.shade);
      g.fillStyle = COL.track[2];
      g.fillRect(x0, y, w, h * 0.3);
      band(COL.white, x0, x0 + w * mt.white);
      band(COL.yellow, x0, x0 + w * mt.yellow);
      band(COL.orange, x0, x0 + w * mt.hp);
      // 每一層的右緣一道墨線：分層是硬邊的。
      g.fillStyle = COL.ink;
      for (const v of [mt.hp, mt.yellow, mt.white]) if (v > 0 && v < 1) g.fillRect(x0 + w * v - o / 2, y, o, h);
      g.restore();
    }
    if (alpha > 0) {
      g.globalAlpha = alpha;
      g.font = '600 15px system-ui, "Noto Sans TC", sans-serif';
      if ('letterSpacing' in g) g.letterSpacing = '4px';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = 3.5;
      g.strokeStyle = COL.ink;
      g.strokeText(this.name, cx + 2, BOX.name);
      g.fillStyle = COL.name;
      g.fillText(this.name, cx + 2, BOX.name);
      if ('letterSpacing' in g) g.letterSpacing = '0px';
      g.globalAlpha = 1;
    }
  }

  /**
   * 把整條（長開了、名字也在）畫到一張一樣大的畫布上，切成 DUST.cell 的小方塊，每一塊不透明的
   * 一粒灰：顏色是那一塊中心的顏色，掃到它的那一刻（照它離左端多遠）再晚一點點才碎。
   */
  _shatter() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const img = document.createElement('canvas');
    img.width = this.el.width;
    img.height = this.el.height;
    const g = img.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._paint(g, 1, 1);
    const { cx, w } = this._geom(), left = cx - w / 2 - BOX.line - 1, span = w + BOX.line * 2 + 2;
    const data = g.getImageData(0, 0, img.width, img.height).data;
    const W = this.el.clientWidth, c = DUST.cell, motes = [];
    for (let y = 0; y < BOX.h; y += c) {
      for (let x = Math.max(0, Math.floor(left)); x < Math.min(W, left + span); x += c) {
        const px = Math.min(img.width - 1, Math.round((x + c / 2) * dpr));
        const py = Math.min(img.height - 1, Math.round((y + c / 2) * dpr));
        const i = (py * img.width + px) * 4;
        if (data[i + 3] < 24) continue;
        const base = clamp01((x - left) / span) * DUST.sweep;
        motes.push({
          x, y, a: data[i + 3] / 255, rgb: `rgb(${data[i]}, ${data[i + 1]}, ${data[i + 2]})`,
          t0: base + Math.random() * DUST.jitter,
          vx: 10 + Math.random() * 40, vy: -(5 + Math.random() * 25),
          life: DUST.life[0] + Math.random() * (DUST.life[1] - DUST.life[0]), seed: Math.random() * 6.28,
        });
      }
    }
    return { img, left, span, motes };
  }

  /**
   * 散掉的一幀：掃線右邊（還沒輪到的）照原樣畫那張圖；掃過的每一粒還沒碎的待在原地，碎了的往右上
   * 飄、縮小、淡掉。全部飄完回傳 false。
   */
  _drawDust(g) {
    const { img, left, span, motes } = this._dust, t = this.t, c = DUST.cell;
    const edge = left + clamp01(t / DUST.sweep) * span;
    if (edge < left + span) {
      const dpr = img.width / this.el.clientWidth;
      const sx = Math.max(0, Math.floor(edge));
      g.drawImage(img, sx * dpr, 0, img.width - sx * dpr, img.height, sx, 0, img.width / dpr - sx, img.height / dpr);
    }
    let alive = false;
    for (const m of motes) {
      if (m.x >= Math.floor(edge)) { alive = true; continue; }     // 還在那張圖上
      const age = t - m.t0;
      if (age >= m.life) continue;
      alive = true;
      g.fillStyle = m.rgb;
      if (age < 0) {
        g.globalAlpha = m.a;
        g.fillRect(m.x, m.y, c, c);
        continue;
      }
      const k = age / m.life, s = c * (1 - 0.4 * k);
      g.globalAlpha = m.a * (1 - k) ** 2;
      g.fillRect(
        m.x + m.vx * age + 0.5 * DUST.wind * age * age,
        m.y + m.vy * age - 0.5 * DUST.lift * age * age + Math.sin(age * 6 + m.seed) * 1.5,
        s, s,
      );
    }
    g.globalAlpha = 1;
    return alive;
  }
}
