// tools/lib/png.mjs — 把 soft-raster 畫出來的浮點像素寫成 PNG，以及把
// 好幾張並排拼成一張。
//
// 這裡沒有壓縮以外的第三方相依：zlib 是 node 自己的，PNG 的區塊格式就
// 這麼多。會存在是因為驗證器不只一支——狗一支、服裝一支——而「畫出來看」
// 是這些工具唯一有意義的輸出，兩份各自的 CRC 表沒有任何好處。

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/* ── PNG（PPM 沒有人看得動） ─────────────────────────────────────── */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePNG(path, rgb, w, h) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w * 3; x++) {
      const v = rgb[y * w * 3 + x];
      raw[o++] = Math.max(0, Math.min(255, Math.round(Math.pow(v, 1 / 2.2) * 255)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

/** 幾張圖橫著拼成一張，才看得出一排東西的差別。 */
export function tile(frames, w, h) {
  const n = frames.length;
  const out = new Float32Array(w * n * h * 3);
  frames.forEach((f, k) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) out[(y * w * n + k * w + x) * 3 + c] = f[(y * w + x) * 3 + c];
      }
    }
  });
  return out;
}
