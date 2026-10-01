// 音效：十二個全部從 public/assets/sfx/recorded/ 那五個錄音做出來。
// 用法：node tools/make-sfx.mjs            全部重做
//       node tools/make-sfx.mjs hit boom   只做這幾個
//
// 錄音每個都是 1.045 秒，真正有聲音的只有中間零點幾秒，前後是底噪。五個原樣的
// 就是把那一段切出來（揮劍與迴旋另外降半個八度、削掉一些高頻）；另外六個是同樣那幾段變速（連音高
// 一起變）、過濾波器、加快衰減、疊在一起。沒有一個取樣是算出來的。寫成 16-bit WAV 交給 ffmpeg 編成 96 kbps 的
// AAC，放進 public/assets/sfx/。
//
// 一個檔給好幾個事件用（播放的時候調速率與音量），所以這裡的名字講的是
// 聲音本身，不是用途：
//
//   slash   揮劍                whirl   迴旋
//   bite    咬合                break   破防
//   thud    落地、地震          hit     砍到肉
//   hurt    玩家扣血            clang   盾擋下來
//   boom    球炸掉              pickup  撿魂、加心
//   die     倒下                sparkle 打死怪物
//
// 切的起點照「聽起來開始」的地方，不是第一個有聲音的取樣：慢慢鼓起來的那幾個
// （slash、whirl、bite）從最前面切，最響的地方要晚一百多毫秒才到，跟畫面對不上。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 48000;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'sfx');
const REC = join(OUT, 'recorded');

/** 正規化之後的峰值（-5 dBFS）：AAC 解出來會過衝，最多量到 3 dB。 */
const PEAK = 0.56;
/** 頭淡進幾秒（免得第一個取樣不在 0 上而爆音）；尾巴淡出幾秒（切掉的地方還有底噪）。 */
const FADE_IN = 0.001, FADE_OUT = 0.05;
/** 錄音裡聲音從哪裡開始：第一個超過峰值這麼多的取樣（cut 的 `at` 沒給的話）。 */
const ONSET = 0.05;

/** 狀態變數濾波器（TPT）。 */
class Svf {
  constructor() { this.a = 0; this.b = 0; this.low = 0; this.high = 0; }
  step(x, fc, q) {
    const g = Math.tan(Math.PI * Math.min(fc, SR * 0.45) / SR), k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - this.b, v1 = a1 * this.a + a2 * v3, v2 = this.b + a2 * this.a + a3 * v3;
    this.a = 2 * v1 - this.a; this.b = 2 * v2 - this.b;
    this.low = v2; this.high = x - k * v1 - v2;
    return this;
  }
}

const peakOf = (buf) => buf.reduce((p, v) => Math.max(p, Math.abs(v)), 0);

const loaded = {};
/**
 * 一個錄音整段，峰值拉到 1（五個錄得不一樣大聲，疊的時候才好配比例）。
 * semis：移調幾個半音，長度不變（ffmpeg 的 rubberband）。跟 rate 不一樣，降了音高
 * 起音不會跟著變慢，最響的地方不會遲到。整段先移調再切，切的起點照移調之後的找。
 */
function load(name, semis = 0) {
  const key = `${name}@${semis}`;
  if (loaded[key]) return loaded[key];
  const shift = semis ? ['-af', `rubberband=pitch=${2 ** (semis / 12)}:transients=crisp`] : [];
  const raw = execFileSync('ffmpeg', [
    '-loglevel', 'error', '-i', join(REC, `${name}.m4a`), ...shift, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-',
  ], { maxBuffer: 1 << 26 });
  const buf = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
  const peak = peakOf(buf);
  return (loaded[key] = buf.map((v) => v / peak));
}

/**
 * 錄音裡有聲音的那一段：第一個超過峰值 `at` 倍的取樣往前 lead 秒起，取 sec 秒。
 * 慢慢鼓起來的給大一點的 at：前面那一截淡進來的切掉，最響的地方才不會遲到。
 */
function cut(name, sec, { lead = 0.008, at = ONSET, semis = 0 } = {}) {
  const buf = load(name, semis);
  const from = Math.max(0, buf.findIndex((v) => Math.abs(v) > at) - Math.round(lead * SR));
  return buf.slice(from, from + Math.round(sec * SR));
}

const lp = (buf, fc) => { const f = new Svf(); return buf.map((v) => f.step(v, fc, 0.707).low); };
const hp = (buf, fc) => { const f = new Svf(); return buf.map((v) => f.step(v, fc, 0.707).high); };
const drive = (buf, k) => buf.map((v) => Math.tanh(k * v));
/** 加快衰減：乘上一條 tau 秒走掉 63% 的指數，取前 sec 秒。 */
const decay = (buf, tau, sec) => buf.slice(0, Math.round(sec * SR)).map((v, i) => v * Math.exp(-i / SR / tau));

/** 變速：r 倍快，音高跟著高 r 倍、長度變 1/r。變快之前先濾掉會折回來的高頻。 */
function rate(buf, r) {
  const src = r > 1 ? lp(lp(buf, 0.45 * SR / r), 0.45 * SR / r) : buf;
  const out = new Float32Array(Math.floor((src.length - 1) / r));
  for (let i = 0; i < out.length; i++) {
    const x = i * r, j = Math.floor(x), u = x - j;
    out[i] = src[j] * (1 - u) + src[j + 1] * u;
  }
  return out;
}

/** 疊起來：每一層 [波形, 第幾秒進來, 多大聲]。 */
function mix(...layers) {
  const out = new Float32Array(Math.max(...layers.map(([buf, at]) => Math.round(at * SR) + buf.length)));
  for (const [buf, at, gain] of layers) {
    const from = Math.round(at * SR);
    for (let i = 0; i < buf.length; i++) out[from + i] += gain * buf[i];
  }
  return out;
}

/** 揮劍與迴旋削掉的高頻：從這裡往上每八度少 12 dB。 */
const DULL = 4000;

/** 揮劍與迴旋降幾個半音。 */
const LOWER = -6;

/** 揮劍、迴旋與咬合從最響的三成切（見檔頭）。 */
const SWELL = { lead: 0.015, at: 0.3 };

const SFX = {
  /* 這五個是錄音本人，只切掉前後的底噪。 */
  slash: () => lp(cut('slash', 0.30, { ...SWELL, semis: LOWER }), DULL),
  /* 迴旋移調之後起音被抹開了一點，從最響的四成切，才跟揮劍一樣四十毫秒內到最響。 */
  whirl: () => lp(cut('whirl', 0.32, { ...SWELL, at: 0.4, semis: LOWER }), DULL),
  bite: () => cut('bite', 0.25, SWELL),
  break: () => cut('break', 0.45),
  thud: () => cut('thud', 0.45),

  /* 砍到肉：落地那一下調高、收得很快。 */
  hit: () => decay(rate(cut('thud', 0.30), 1.6), 0.04, 0.15),

  /* 自己挨打：咬合放慢變悶，底下墊一點破防。 */
  hurt: () => mix(
    [lp(rate(cut('bite', 0.25, SWELL), 0.62), 2200), 0, 1],
    [rate(cut('break', 0.30), 1.3), 0, 0.35],
  ),

  /* 盾擋下來：揮劍調高兩種不成倍數的速率疊著（金屬的泛音不成倍數），前面是破防最脆的那一下。 */
  clang: () => mix(
    [hp(rate(cut('slash', 0.30), 1.6), 1200), 0, 1],
    [hp(rate(cut('slash', 0.30), 2.1), 1200), 0, 0.5],
    [hp(rate(cut('break', 0.20), 2.2), 2500), 0, 0.7],
  ),

  /* 爆炸：落地那一下放慢（比它低）、收得快，再壓一下讓它飽。 */
  boom: () => drive(decay(rate(cut('thud', 0.45), 0.7), 0.12, 0.4), 1.5),

  /* 撿到東西：咬合調高，一口叼起來。 */
  pickup: () => rate(cut('bite', 0.25, SWELL), 1.4),

  /* 一閃：揮劍調得很高只留亮的那一層，先後兩下、第二下更高。 */
  sparkle: () => mix(
    [hp(rate(cut('slash', 0.25), 2.0), 2000), 0, 1],
    [hp(rate(cut('slash', 0.25), 2.67), 2000), 0.07, 0.9],
  ),

  /* 倒下：迴旋放慢成一口長長的氣，然後身體落地。 */
  die: () => mix(
    [lp(rate(cut('whirl', 0.32, SWELL), 0.6), 3000), 0, 1],
    [rate(cut('thud', 0.45), 0.8), 0.2, 0.6],
  ),
};

/** 峰值拉到 PEAK、頭尾淡掉（尾巴最多淡掉後面三成）。回這一段的 RMS（dBFS）。 */
function finish(buf) {
  const gain = PEAK / peakOf(buf);
  const n = buf.length, fin = FADE_IN * SR, fout = Math.min(FADE_OUT * SR, 0.3 * n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    buf[i] *= gain * Math.min(1, i / fin, (n - 1 - i) / fout);
    sum += buf[i] * buf[i];
  }
  return 10 * Math.log10(sum / n);
}

/** 單聲道 16-bit PCM 的 WAV。 */
function wav(buf) {
  const out = Buffer.alloc(44 + buf.length * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + buf.length * 2, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
  return out;
}

const want = process.argv.slice(2);
const unknown = want.filter((name) => !SFX[name]);
if (unknown.length) {
  console.error(`沒有這個音效：${unknown.join('、')}（有的是 ${Object.keys(SFX).join(' ')}）`);
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'sfx-'));
let total = 0;
try {
  for (const name of want.length ? want : Object.keys(SFX)) {
    const buf = SFX[name]();
    const rms = finish(buf);
    const src = join(tmp, `${name}.wav`), dst = join(OUT, `${name}.m4a`);
    writeFileSync(src, wav(buf));
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', src,
      '-c:a', 'aac', '-b:a', '96k', '-map_metadata', '-1', '-movflags', '+faststart', dst,
    ]);
    const bytes = statSync(dst).size;
    total += bytes;
    console.log(`${name.padEnd(7)} ${(buf.length / SR).toFixed(2)} 秒  RMS ${rms.toFixed(1)} dBFS  ${bytes} bytes`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`共 ${total} bytes → ${OUT}`);
