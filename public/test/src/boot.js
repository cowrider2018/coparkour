/* ── test/src/boot.js ────────────────────────────────────────────────
   /test/ 這一頁選模式：讀網址的 `?mode=`，收拾頁面，載入那個模式的主程式。

   一頁幾個模式，而不是幾頁：它們共用同一份版面、面板、走路、鏡頭、手把與
   動物，分成幾頁的話 index.html 就是幾份幾乎一樣的抄本（以前就是這樣，
   兩份 HTML 只差面板裡那幾行字）。

   面板裡只屬於某個模式的東西在 index.html 標了 `data-for="模式"`，不是這個
   模式的就在這裡拿掉——拿掉而不是藏起來，各模式的主程式用 id 找元素
   （#keys 兩個模式各一份），留著會找到別人的那一份。

   沒給模式、或給了不認得的，就是 DEFAULT。
   ------------------------------------------------------------------ */

/** 每一個模式：分頁標題、主程式。 */
export const MODES = {
  terrain: { title: '試玩場：城堡遺跡', entry: './mode-terrain.js' },
  combat: { title: '試打場', entry: './mode-combat.js' },
  flow: { title: '完整流程', entry: './mode-flow.js' },
};

/** 沒給模式的時候：完整流程——另外兩個是它的零件各自拿出來試。 */
export const DEFAULT = 'flow';

const asked = new URLSearchParams(location.search).get('mode');
const mode = Object.hasOwn(MODES, asked) ? asked : DEFAULT;

document.body.dataset.mode = mode;
document.title = MODES[mode].title;
for (const el of document.querySelectorAll('[data-for]')) {
  if (!el.dataset.for.split(/\s+/).includes(mode)) el.remove();
}

await import(MODES[mode].entry);
