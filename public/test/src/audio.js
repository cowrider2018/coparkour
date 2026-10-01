/* ── test/src/audio.js ───────────────────────────────────────────────
   這一頁的那一個 AudioContext：音效（sound.js）與音樂（music.js）共用。

   瀏覽器要等使用者碰過頁面才准出聲：第一次按鍵或觸碰的時候才建 AudioContext，
   在那之前是 null。要用它的在 onWake 登記，叫醒的那一刻（還在那一下按鍵或觸碰
   裡面）一起叫——有些瀏覽器的媒體元素只在這種時候准播。

   機器沒有 Web Audio、或網址給了 `?sound=0`，就永遠不叫醒：整頁沒有聲音。
   ------------------------------------------------------------------ */

const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
const muted = typeof location !== 'undefined' && new URLSearchParams(location.search).get('sound') === '0';

/** 這一頁能不能出聲。 */
export const audible = !!Ctx && !muted && typeof addEventListener === 'function';

let ctx = null;
const waiters = [];

/** 叫醒之後的 AudioContext；還沒叫醒是 null。 */
export const audioContext = () => ctx;

/** ctx 建好的那一刻叫 fn(ctx)；已經建好了就馬上叫。 */
export function onWake(fn) {
  if (ctx) fn(ctx);
  else waiters.push(fn);
}

function wake() {
  if (!ctx) {
    ctx = new Ctx();
    for (const fn of waiters.splice(0)) fn(ctx);
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}

/* 留著不拆：手機切到背景再回來，AudioContext 會被停掉，下一次碰頁面要再叫醒。 */
if (audible) {
  for (const type of ['pointerdown', 'keydown', 'touchend']) {
    addEventListener(type, wake, { capture: true, passive: true });
  }
}
