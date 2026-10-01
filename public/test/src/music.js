/* ── test/src/music.js ───────────────────────────────────────────────
   背景音樂：探索一首、戰鬥一首（public/assets/music/，tools/make-music.mjs 做的）。

   呼叫端每幀說現在要哪一首（`want`），這裡負責換：
     換曲    正在放的那一首淡出 SWITCH 秒、要的那一首同時淡入。換回來的時候接著上次
             停下的地方放，不從頭。
     循環    快放完的時候，同一首從頭再起一份淡入、這一份淡出（LOOP 秒），交叉著接上，
             不是放完停一下再從頭。所以每一首有兩份播放器輪流用。
   每一次響起、停下都是淡的，沒有硬切。

   一首三分鐘，解碼成 AudioBuffer 要 60 MB 上下，所以不像音效那樣整個解開，而是用
   <audio> 一邊下載一邊放，接到 audio.js 的 AudioContext 上，淡入淡出用 GainNode
   （iOS 的 <audio> 不准改 volume）。

   跟音效一起由 audio.js 決定能不能出聲（`?sound=0` 全部關掉）；`?music=0` 只關音樂。
   ------------------------------------------------------------------ */

import { audible, onWake } from './audio.js';

/** 檔案在哪（相對這一支）。 */
const BASE = new URL('../../assets/music/', import.meta.url);

/** 有哪幾首（檔名）。 */
export const TRACKS = ['explore', 'fight'];

/** 音樂的總音量：墊在底下，比音效小聲很多。 */
const VOLUME = 0.25;
/** 換曲的淡出淡入（秒）。 */
const SWITCH = 2;
/** 同一首循環接回開頭的交叉淡（秒）。 */
const LOOP = 4;

/** 一份播放器：一個 <audio>，接一個自己的音量。 */
class Voice {
  constructor(ctx, track, bus, preload) {
    this.track = track;
    this.el = new Audio(new URL(`${track}.m4a`, BASE).href);
    this.el.preload = preload;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    ctx.createMediaElementSource(this.el).connect(this.gain).connect(bus);
    /** 正在用（放著，或淡出中還沒停）。 */
    this.live = false;
    /** 淡出完的那一刻（AudioContext 的時間），到了就停；0 = 沒在淡出。 */
    this.until = 0;
  }
}

export class Music {
  constructor() {
    this._ctx = null;
    /** 每一首的兩份播放器。 */
    this._voices = {};
    /** 現在要的那一首、正在淡入或放著的那一份；每一首上一次用的是哪一份（換回來接著放）。 */
    this._track = null;
    this._voice = null;
    this._last = {};

    if (!audible || new URLSearchParams(location.search).get('music') === '0') return;
    onWake((ctx) => {
      this._ctx = ctx;
      const bus = ctx.createGain();
      bus.gain.value = VOLUME;
      bus.connect(ctx.destination);
      // 第二份要循環的時候才用，那時候第一份已經把檔載完了，從快取拿。
      for (const t of TRACKS) this._voices[t] = [new Voice(ctx, t, bus, 'auto'), new Voice(ctx, t, bus, 'none')];
      /* 叫醒的這一刻還在使用者的那一下按鍵裡：每一份都先播一下再停（音量是 0，聽不到）。
         iOS 只准使用者碰過的 <audio> 之後自己開始播。 */
      for (const v of this._all()) {
        v.el.play().then(() => { if (!v.live) v.el.pause(); }).catch(() => {});
      }
    });
  }

  _all() { return Object.values(this._voices).flat(); }

  /** 一份播放器的音量從現在的值線性走到 to，花 sec 秒。走到 0 的那一刻停下來（want 裡停）。 */
  _fade(v, to, sec) {
    const now = this._ctx.currentTime, g = v.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(to, now + sec);
    v.until = to === 0 ? now + sec : 0;
  }

  /** 放這一份、淡入 sec 秒。 */
  _play(v, sec) {
    v.live = true;
    if (v.el.paused) v.el.play().catch(() => {});
    this._fade(v, 1, sec);
    this._last[v.track] = v;
    return v;
  }

  /** 這一份快放完了嗎（該接下一輪了）。長度還不知道（沒載到）就不算。 */
  static _ending(v) {
    const d = v.el.duration;
    return v.el.ended || (Number.isFinite(d) && v.el.currentTime >= d - LOOP);
  }

  /**
   * 每幀叫：現在要哪一首（TRACKS 的一個，null = 不要音樂）。還不能出聲的時候什麼都不做，
   * 叫醒之後的第一幀就照這一幀要的開始放。
   */
  want(track) {
    const ctx = this._ctx;
    if (!ctx || ctx.state !== 'running') return;
    // 淡出完的停下來（停在那裡，換回來的時候接著放）。
    for (const v of this._all()) {
      if (v.until && ctx.currentTime >= v.until) { v.until = 0; v.live = false; v.el.pause(); }
    }

    if (track !== this._track) {
      if (this._voice) this._fade(this._voice, 0, SWITCH);
      this._track = track;
      this._voice = null;
      if (!track) return;
      // 上次用的那一份：還在淡出就把它淡回來，停了就從停的地方接著放；快到結尾了就從頭。
      const v = this._last[track] || this._voices[track][0];
      if (!v.live && Music._ending(v)) v.el.currentTime = 0;
      this._voice = this._play(v, SWITCH);
      return;
    }

    // 同一首快放完了：另一份從頭淡入，這一份淡出。
    const v = this._voice;
    if (!v || !Music._ending(v)) return;
    const next = this._voices[track].find((x) => x !== v);
    this._fade(v, 0, v.el.ended ? 0.05 : LOOP);
    next.el.preload = 'auto';
    next.el.currentTime = 0;
    this._voice = this._play(next, LOOP);
  }
}
