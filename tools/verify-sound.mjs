// 聲音的登記表對得上嗎：sound.js 的 CUES 指的檔都在、fight.js 說的每一件事都有登記，
// music.js 的每一首與 mode-flow.js 要的每一首都有檔。
// 用法：node tools/verify-sound.mjs
//
// 播不播得出來要開瀏覽器聽；這裡只抓打錯字——CUES 的鍵是 fight.js 手上現成的字
// （連段的 phase、skills.js 每一下的 shape），任何一邊改了名字，那一聲就默默不見了。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUES } from '../public/test/src/sound.js';
import { TRACKS } from '../public/test/src/music.js';
import { makeCombo } from '../public/test/src/combat.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let bad = 0;
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) bad++; };

// 每一個檔都在，速率與音量是正數。
for (const [event, [file, rate, gain]] of Object.entries(CUES)) {
  check(existsSync(join(ROOT, 'public/assets/sfx', `${file}.m4a`)), `${event} → ${file}.m4a 在`);
  check(rate > 0 && gain > 0, `${event} 的速率 ${rate}、音量 ${gain} 是正數`);
}

// fight.js 直接寫出來的那幾件事都有登記。
const fight = read('public/test/src/fight.js');
const said = [...fight.matchAll(/sound\.play\('(\w+)'\)/g)].map((m) => m[1]);
check(said.length > 0, `fight.js 說了 ${said.length} 件事`);
for (const e of new Set(said)) check(e in CUES, `fight.js 的 '${e}' 有登記`);

// 怪物那一下的形狀（skills.js 的 shape）：有登記的都是真的形狀，真的形狀都有登記。
const shapes = new Set([...read('public/test/src/skills.js').matchAll(/shape: '(\w+)'/g)].map((m) => m[1]));
for (const s of shapes) check(s in CUES, `skills.js 的形狀 '${s}' 有登記`);

// 連段的段（combat.js 的 phase）：有登記的段都是 comboStep 真的會進的。
const combat = read('public/test/src/combat.js');
const phases = new Set([makeCombo().phase, ...[...combat.matchAll(/go\('(\w+)'\)|c\.phase = '(\w+)'/g)].map((m) => m[1] || m[2])]);
for (const p of ['slash', 'rise', 'slam', 'dash', 'spin']) check(phases.has(p) && p in CUES, `連段的 '${p}' 是真的段、有登記`);

// 音樂：每一首都有檔；mode-flow.js 要的（music.want('…')）都是登記過的那幾首。
for (const t of TRACKS) check(existsSync(join(ROOT, 'public/assets/music', `${t}.m4a`)), `音樂 ${t}.m4a 在`);
const wants = read('public/test/src/mode-flow.js').split('\n').filter((l) => l.includes('music.want('));
const asked = wants.flatMap((l) => [...l.matchAll(/'(\w+)'/g)].map((m) => m[1]));
check(asked.length > 0 && asked.every((w) => TRACKS.includes(w)), `mode-flow.js 要的 ${[...new Set(asked)].join('、')} 都有登記`);

console.log(bad ? `\n${bad} 項不對` : '\n全部對得上');
process.exit(bad ? 1 : 0);
