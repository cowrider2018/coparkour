// 音樂：public/assets/music/recorded/ 的兩首原檔 → 遊戲載的那兩個檔。
// 用法：node tools/make-music.mjs
//
// 原檔是 192 kbps 的 MP3，一首 4 MB 多。這裡做三件事：
//   · 切掉尾巴的靜音（fight 最後有 2.7 秒、explore 有將近 1 秒）。循環是遊戲在淡出淡入
//     （music.js），尾巴是空的話，那一段淡的是靜音，聽起來是斷掉。
//   · 響度拉到同一個 LOUDNESS：兩首原本差 1 LU，換場的時候不該一首比另一首大聲。
//     只調整首的音量（量一次、整首乘一個數），不做動態壓縮，原曲的大小聲照舊。
//   · 編成 96 kbps 的 AAC（立體聲、44.1 kHz 照原檔），一首約 2 MB。
//
// 多大聲在遊戲裡調（music.js 的 VOLUME），這裡不壓小聲：壓小了編碼只是白丟細節。
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'music');
const REC = join(OUT, 'recorded');

/** 每一首拉到的整體響度（LUFS）。原檔是 -12、-13，往下拉，真峰值就不會過 0。 */
const LOUDNESS = -16;
/** 尾巴比這個小聲（dBFS）的就算靜音，切掉。 */
const SILENT = -50;

/** 從尾巴往前切掉靜音：倒過來切開頭的靜音，再倒回來。 */
const TRIM = `areverse,silenceremove=start_periods=1:start_threshold=${SILENT}dB,areverse`;

/** 跑一次 ffmpeg，回它的 stderr（量測的結果印在那裡）。失敗就整支停下來。 */
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stderr;
}

/** 切完尾巴之後的整體響度（LUFS）。loudnorm 在這裡只拿來量。 */
function measure(src) {
  const log = ffmpeg(['-i', src, '-af', `${TRIM},loudnorm=print_format=json`, '-f', 'null', '-']);
  const json = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
  return Number(json.input_i);
}

const duration = (file) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout);

for (const name of ['explore', 'fight']) {
  const src = join(REC, `${name}.mp3`), dst = join(OUT, `${name}.m4a`);
  const before = measure(src), gain = LOUDNESS - before;
  ffmpeg(['-y', '-i', src, '-af', `${TRIM},volume=${gain.toFixed(2)}dB`, '-c:a', 'aac', '-b:a', '96k', '-map_metadata', '-1', '-movflags', '+faststart', dst]);
  console.log(`${name.padEnd(7)} ${duration(src).toFixed(1)} → ${duration(dst).toFixed(1)} 秒  ${before.toFixed(1)} → ${LOUDNESS} LUFS（${gain.toFixed(1)} dB）  `
    + `${(statSync(src).size / 1e6).toFixed(2)} → ${(statSync(dst).size / 1e6).toFixed(2)} MB`);
}
