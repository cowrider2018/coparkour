/* ── tools/verify-story.mjs ──────────────────────────────────────────
   關卡之間那一段劇情（public/test/src/story.js）的時間軸，不開瀏覽器：

     1. 沒在演   世界照正常速度走，操作不收。
     2. 慢動作   斬殺之後到書頁蓋住之前，世界是 STORY.scale 倍、操作收起來。
     3. 蓋住     世界停住（0 倍）。STORY.ready 秒之前按跳都不算——打怪的時候一直
                 在按，最後一刀那一下不能把漫畫跳過。
     4. 離開     ready 之後按一下：書頁開始走，世界當場回到正常速度、操作還回來；
                 走完叫 `then` 一次。
     5. 取消     演到一半取消（重玩、倒下）：直接收掉，`then` 不叫。

   跑法：node tools/verify-story.mjs
   ------------------------------------------------------------------ */

import { Story, STORY, COMICS } from '../public/test/src/story.js';
import { STAGES } from '../public/test/src/route.js';

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok ' : ' FAIL'} ${msg}`);
  if (!cond) fails++;
};

const DT = 1 / 60;
/** 跑 `secs` 秒，每幀按 `press`；回傳每幀的倍數。 */
const run = (s, secs, press = false) => {
  const out = [];
  for (let t = 0; t < secs - 1e-9; t += DT) out.push(s.update(DT, press));
  return out;
};

console.log('1. 沒在演');
{
  const s = new Story(null);
  ok(s.update(DT, true) === 1 && !s.busy && !s.covered, '正常速度、操作不收、沒蓋住');
}

console.log('2–4. 一次劇情');
{
  const s = new Story(null);
  let called = 0;
  s.start(0, STAGES[0].name, () => called++);
  const slow = run(s, STORY.slow + STORY.enter - 2 * DT, true);
  ok(slow.every((k) => k === STORY.scale), `慢動作與書頁進來的時候一直是 ${STORY.scale} 倍（一直按跳也一樣）`);
  ok(s.busy && !s.covered, '操作收起來、還沒蓋住');
  const cover = run(s, STORY.ready - 4 * DT + 2 * DT, true);
  ok(s.covered && cover.slice(2).every((k) => k === 0), '蓋住之後世界停住');
  ok(s.busy, `蓋住之後 ${STORY.ready} 秒內按跳不算`);
  run(s, 4 * DT);
  ok(s.covered, 'ready 之後不按就一直蓋著');
  run(s, 3);
  ok(s.covered, '多等三秒也還蓋著');
  const k = s.update(DT, true);
  ok(k === 1 && !s.busy && !s.covered, '按一下：書頁開始走，世界正常速度、操作還回來');
  ok(called === 0, '書頁還在走的時候 then 還沒叫');
  run(s, STORY.leave + DT);
  ok(called === 1 && s.t < 0, '書頁走完：then 叫了一次，劇情結束');
  run(s, 1, true);
  ok(called === 1, 'then 不會再叫第二次');
}

console.log('5. 取消');
{
  const s = new Story(null);
  let called = 0;
  s.start(2, STAGES[2].name, () => called++);
  run(s, STORY.slow / 2);
  s.cancel();
  ok(s.update(DT, false) === 1 && !s.busy && called === 0, '慢動作裡取消：正常速度、then 不叫');
  s.start(2, STAGES[2].name, () => called++);
  run(s, STORY.slow + STORY.enter + STORY.ready + DT);
  s.cancel();
  ok(!s.covered && called === 0, '蓋住的時候取消：書頁收掉、then 不叫');
}

console.log('6. 每一場都有一頁');
ok(COMICS.length === STAGES.length, `漫畫 ${COMICS.length} 頁、路線 ${STAGES.length} 場`);
ok(COMICS.every((c) => c.panels.length >= 1 && c.panels.length <= 8), '每一頁 1～8 格（grid-area a～h）');

console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
