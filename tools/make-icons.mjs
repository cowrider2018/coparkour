// tools/make-icons.mjs — 加到主畫面用的圖示。
//
// 圖案就是 index.html 那顆 favicon（32 格的方框裡一個人、一條地），只是
// 放大成 PNG：Chrome 要 192 與 512 兩種 PNG 才肯把它當成可安裝的 App
// ——不夠格的話「加到主畫面」只是一個捷徑，點開還是有網址列的分頁。
//
//   any       整張底色，圖案照 favicon 的比例。系統自己切圓角。
//   maskable  同一張，但圖案縮進中央 80% 的安全圈，給 Android 切成任何形狀。
//   apple     iOS 的主畫面圖示，180 見方，跟 any 一樣。
//
// 用法：npm run icons   （輸出到 public/icons/）

import { mkdirSync } from 'node:fs';
import { writePNG } from './lib/png.mjs';

const OUT = new URL('../public/icons/', import.meta.url);
const BG = [0x1e, 0x18, 0x10];
const FG = [0x9b, 0xd9, 0x4e];
/** favicon 的兩個圓角矩形：x, y, w, h, r，單位是 32 格裡的一格。 */
const SHAPES = [[9, 7, 11, 15, 4], [6, 24, 20, 3, 1.5]];
const SS = 4; // 每個像素 4×4 取樣，邊緣才是平的

function inside(x, y, [rx, ry, w, h, r]) {
  if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
  const dx = Math.max(rx + r - x, 0, x - (rx + w - r));
  const dy = Math.max(ry + r - y, 0, y - (ry + h - r));
  return dx * dx + dy * dy <= r * r;
}

/** scale：圖案相對於整張的大小，以 32 格的中心（16,16）縮放。 */
function render(size, scale) {
  const lin = (c) => Math.pow(c / 255, 2.2); // writePNG 收線性值
  const rgb = new Float32Array(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((px + (sx + 0.5) / SS) / size * 32 - 16) / scale + 16;
          const v = ((py + (sy + 0.5) / SS) / size * 32 - 16) / scale + 16;
          if (SHAPES.some((s) => inside(u, v, s))) hit++;
        }
      }
      const a = hit / (SS * SS);
      for (let k = 0; k < 3; k++) {
        rgb[(py * size + px) * 3 + k] = lin(BG[k]) * (1 - a) + lin(FG[k]) * a;
      }
    }
  }
  return rgb;
}

mkdirSync(OUT, { recursive: true });
for (const [name, size, scale] of [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['maskable-512.png', 512, 0.72],
  ['apple-touch-icon.png', 180, 1],
]) {
  writePNG(new URL(name, OUT), render(size, scale), size, size);
  console.log(`icons/${name}  ${size}×${size}`);
}
