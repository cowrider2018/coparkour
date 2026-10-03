/* ── fullscreen.js ───────────────────────────────────────────────────
   手機上把網址列拿掉。

   手機 Chrome 只在頁面往下捲的時候收網址列，而遊戲頁整片 overflow:hidden、
   畫布釘滿畫面，根本沒有東西可捲；橫向時它更乾脆把網址列釘著不動。唯一
   收得掉它的是 Fullscreen API，而那支 API 只肯在使用者的手勢裡被叫。

   所以：手指每放開一次，不在全螢幕就要一次。第一下進去；之後被返回鍵或
   邊緣滑動帶出來，下一下就回去。真的想走的人再按一次返回就離開頁面了，
   這裡擋不到他。不另外放一顆「回到全螢幕」的鈕——遊戲裡隨便點一下本來
   就是最近的鈕，而上緣中間那一格在直向時是兩塊面板的接縫，放什麼都會壓到。

   聽的是 touchend，不是 pointerdown：觸控的 pointerdown 不算「使用者啟動」，
   pointerup 算但會被捲動面板的 pointercancel 吃掉，touchend 兩樣都沒有。
   滑鼠不會有 touchend，所以桌機點畫面不會被整個螢幕吃掉。

   從主畫面圖示開的（manifest 的 display: fullscreen）本來就沒有網址列，不碰。
   iPhone 的 Safari 沒有對一般元素的全螢幕，那裡只能靠加到主畫面。
   ------------------------------------------------------------------ */

const root = document.documentElement;
const request = root.requestFullscreen || root.webkitRequestFullscreen;
const current = () => document.fullscreenElement || document.webkitFullscreenElement;

export function installFullscreen() {
  if (!request) return;
  if (matchMedia('(display-mode: fullscreen)').matches) return;

  addEventListener('touchend', () => {
    if (current()) return;
    try {
      const p = request.call(root, { navigationUI: 'hide' });
      if (p && p.catch) p.catch(() => {});
    } catch { /* 不給就算了，網址列留著也能玩 */ }
  }, { capture: true, passive: true });
}
