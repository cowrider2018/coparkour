/* ── test/src/audio.js ───────────────────────────────────────────────
   這一頁的那一個 AudioContext：音效（sound.js）與音樂（music.js）共用。

   瀏覽器要等使用者碰過頁面才准出聲：第一次按鍵或觸碰的時候才建 AudioContext，
   在那之前是 null。要用它的在 onWake 登記，叫醒的那一刻（還在那一下按鍵或觸碰
   裡面）一起叫——有些瀏覽器的媒體元素只在這種時候准播。

   機器沒有 Web Audio、或網址給了 `?sound=0`，就永遠不叫醒：整頁沒有聲音。

   不搶手機的媒體播放：聲音全部走這個 AudioContext，不用 <audio>（媒體元素在 Android
   會拿走音訊焦點、把使用者自己在聽的音樂停掉，還會在背景繼續放）；iOS 把音訊工作階段
   設成 ambient，跟別的 App 的聲音混著放（靜音開關打開時不出聲）。切到背景就整個停住，
   回來再接著放。
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

/* 留著不拆：手機切到背景再回來，AudioContext 可能被系統停掉，下一次碰頁面要再叫醒。 */
if (audible) {
  if (globalThis.navigator?.audioSession) navigator.audioSession.type = 'ambient';
  for (const type of ['pointerdown', 'keydown', 'touchend']) {
    addEventListener(type, wake, { capture: true, passive: true });
  }
  // 看不到這一頁（切 App、鎖螢幕、換分頁）就停住；看得到了再接著放（不准的話等下一次碰頁面）。
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else ctx.resume().catch(() => {});
  });
}
