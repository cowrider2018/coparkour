/* ── test/src/sound.js ───────────────────────────────────────────────
   戰鬥的聲音：場上發生了什麼 → 播哪一個檔、多快、多大聲。

   檔案是 public/assets/sfx/ 那十二個（tools/make-sfx.mjs 從錄音做出來的）。事件比檔
   多：同一個檔調速率（音高跟著變）與音量給好幾件事用，全部登記在 CUES。fight.js
   只說「發生了什麼」（`sound.play('rise')`），不知道有哪些檔。

   瀏覽器要等使用者碰過頁面才准出聲：第一次按鍵或觸碰的時候才建 AudioContext、
   解碼；在那之前 play 什麼都不做。檔案沒載到、機器沒有 Web Audio、或網址給了
   `?sound=0`，也是什麼都不做——沒有聲音不該讓遊戲跑不起來。
   ------------------------------------------------------------------ */

/** 檔案在哪（相對這一支）。 */
const BASE = new URL('../../assets/sfx/', import.meta.url);

/**
 * 每一件事：[檔名, 速率, 音量]。鍵是 fight.js 手上現成的字——連段的 phase、
 * 怪物那一下的形狀（skills.js 的 shape）——所以那邊不用再翻譯一次。
 */
export const CUES = {
  // 玩家的連段（combat.js 的 phase）：進了那一段的那一刻。
  slash: ['slash', 1, 0.8],
  rise: ['slash', 1.2, 0.8],
  slam: ['whirl', 1, 0.9],
  dash: ['slash', 0.8, 0.7],
  spin: ['break', 1, 1],           // 破防攻擊碰到牠、定住（被盾擋掉的是 parry）

  // 玩家打中怪物。
  hit: ['hit', 1, 1],
  parry: ['clang', 1, 0.9],        // 被盾擋掉（國王）
  /* 破防是三聲：窗口開了（這一聲）、破防攻擊碰到牠（spin）、轉完離開（hit）。 */
  break: ['break', 1, 1],
  kill: ['sparkle', 1, 0.9],

  // 怪物衝刺衝出去：咬下去的那一聲，咬不咬得到都有。
  lunge: ['bite', 1, 1],

  // 玩家挨打。被咬到是咬的那一聲（lunge）再加一下打中；其餘的是 hurt。
  bitten: ['hit', 1, 1],
  hurt: ['hurt', 1, 1],
  down: ['die', 1, 1],             // 血扣光

  soul: ['pickup', 1, 0.8],

  // 怪物的招：球射出去、球炸掉。
  shot: ['boom', 1, 0.8],
  burst: ['boom', 1, 1],

  // 怪物的招打下去（skills.js 每一下的 shape）。地震的兩種是每一道塵揚起來響一次
  // （dust.js 的 quakeBands：跳砸 3 道、扇形 4 道），不是打下去的那一刻響一次。
  circle: ['thud', 0.8, 1],        // 跳砸
  cone: ['thud', 1.1, 0.9],        // 扇形
  strip: ['slash', 0.75, 0.9],     // 跳砍劈下去、國王的直劈
  fan: ['slash', 1.1, 0.9],        // 跳砍之後的上挑
  capsule: ['whirl', 0.9, 0.9],    // 劍迴旋衝刺
};

/** 總音量。 */
const MASTER = 0.7;

/** 同一件事這麼多秒內不重播：一刀同一幀砍到三隻，不該是三倍大聲的同一聲。 */
const GAP = 0.05;

/** 不出聲的那一個：fight.js 沒拿到聲音的時候用。 */
export const MUTE = { play() {} };

export class Sound {
  constructor() {
    this._ctx = null;
    this._out = null;
    /** 檔名 → 還沒解碼的位元組；檔名 → 解好的 AudioBuffer。 */
    this._raw = new Map();
    this._buf = new Map();
    /** 每一件事上一次播是什麼時候。 */
    this._last = new Map();

    this._Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!this._Ctx || new URLSearchParams(location.search).get('sound') === '0') return;

    for (const name of new Set(Object.values(CUES).map(([file]) => file))) {
      fetch(new URL(`${name}.m4a`, BASE))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((bytes) => { this._raw.set(name, bytes); this._decode(); })
        .catch(() => {});
    }
    /* 留著不拆：手機切到背景再回來，AudioContext 會被停掉，下一次碰頁面要再叫醒。 */
    for (const type of ['pointerdown', 'keydown', 'touchend']) {
      addEventListener(type, () => this._wake(), { capture: true, passive: true });
    }
  }

  _wake() {
    if (!this._ctx) {
      this._ctx = new this._Ctx();
      this._out = this._ctx.createGain();
      this._out.gain.value = MASTER;
      this._out.connect(this._ctx.destination);
      this._decode();
    }
    if (this._ctx.state !== 'running') this._ctx.resume().catch(() => {});
  }

  /** 載到了、AudioContext 也有了的檔解碼。 */
  _decode() {
    if (!this._ctx) return;
    for (const [name, bytes] of this._raw) {
      this._raw.delete(name);
      this._ctx.decodeAudioData(bytes).then((buf) => this._buf.set(name, buf)).catch(() => {});
    }
  }

  /** 發生了這一件事（CUES 的鍵）。不認得的、還不能出聲的，什麼都不做。 */
  play(event) {
    const cue = CUES[event], ctx = this._ctx;
    if (!cue || !ctx || ctx.state !== 'running') return;
    const [file, rate, gain] = cue, buf = this._buf.get(file);
    if (!buf || ctx.currentTime - (this._last.get(event) ?? -Infinity) < GAP) return;
    this._last.set(event, ctx.currentTime);
    const src = ctx.createBufferSource(), vol = ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = rate;
    vol.gain.value = gain;
    src.connect(vol).connect(this._out);
    src.start();
  }
}
