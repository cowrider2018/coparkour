/* ── tools/verify-story.mjs ──────────────────────────────────────────
   場與場之間那一段劇情（public/test/src/story.js）的時間軸與漫畫的頁表
   （public/test/src/comic.js），不開瀏覽器：

     1. 沒在演   世界照正常速度走，操作不收。
     2. 戰後頁   斬殺之後到書頁蓋住之前，世界是 STORY.scale 倍、操作收起來；蓋住之後
                 世界停住（0 倍）。STORY.ready 秒之前按跳都不算——打怪的時候一直在按，
                 最後一刀那一下不能把漫畫跳過。ready 之後按一下：書頁開始走，世界當場
                 回到正常速度、操作還回來；走完叫 `then` 一次。
     3. 開場頁   沒有慢動作：書頁進來的時候世界照常走，STORY.enter 秒就蓋住。
     4. 拼格子   蓋住之後分格一格一格滑進來，拼完（builtIn）才翻得動；拼到一半按一下是
                 把剩下的直接拼好，不翻頁。
     5. 翻頁     不是最後一頁的時候按一下是翻頁：一直蓋著、世界一直停住；下一頁從頭拼，
                 STORY.readyNext 秒之前按的不算。`cover` 在第一次蓋住的那一幀叫一次。
     6. 取消     演到一半取消（重玩、倒下）：直接收掉，`then`、`cover` 都不叫。
     7. 頁表     十四頁、每頁 3～5 格（index.html 有那幾種版面）、SCRIPT 指到的頁都在、
                 每一頁剛好被翻一次。

   跑法：node tools/verify-story.mjs
   ------------------------------------------------------------------ */

import { Story, STORY, PANEL, builtIn } from '../public/test/src/story.js';
import { PAGES, SCRIPT, pagesOf } from '../public/test/src/comic.js';
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
/** 等到這一頁拼好、而且過了收按鍵的那幾秒。 */
const settle = (s) => run(s, Math.max(builtIn(s.pages[s.i].panels.length),
  s.i === 0 ? STORY.ready : STORY.readyNext) - s.since + DT);
const ONE = pagesOf([2]);
const THREE = pagesOf([10, 11, 12]);

console.log('1. 沒在演');
{
  const s = new Story(null);
  ok(s.update(DT, true) === 1 && !s.busy && !s.covered && !s.on, '正常速度、操作不收、沒蓋住');
}

console.log('2. 戰後頁');
{
  const s = new Story(null);
  let called = 0;
  s.start(ONE, { slow: true, then: () => called++ });
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
  ok(k === 1 && !s.busy && !s.covered && s.on, '按一下：書頁開始走，世界正常速度、操作還回來');
  ok(called === 0, '書頁還在走的時候 then 還沒叫');
  run(s, STORY.leave + DT);
  ok(called === 1 && !s.on, '書頁走完：then 叫了一次，劇情結束');
  run(s, 1, true);
  ok(called === 1, 'then 不會再叫第二次');
}

console.log('3. 開場頁');
{
  const s = new Story(null);
  s.start(pagesOf([3]));
  const enter = run(s, STORY.enter - 2 * DT, true);
  ok(enter.every((k) => k === 1) && s.busy && !s.covered, '書頁進來的時候世界照常走、操作收起來');
  run(s, 3 * DT);
  ok(s.covered && s.update(DT, false) === 0, `${STORY.enter} 秒就蓋住、世界停住`);
}

console.log('4. 拼格子');
{
  const s = new Story(null);
  s.start(THREE, { slow: true });
  const n = THREE[0].panels.length;
  ok(builtIn(n) > STORY.ready, `${n} 格拼完要 ${builtIn(n).toFixed(2)} 秒，比收按鍵的 ${STORY.ready} 秒久`);
  run(s, STORY.slow + STORY.enter + STORY.ready + DT);
  ok(s.since < builtIn(n), '還在拼');
  s.update(DT, true);
  ok(s.turn < 0 && s.i === 0 && s.since >= builtIn(n), '拼到一半按一下：剩下的直接拼好，沒有翻頁');
  s.update(DT, true);
  ok(s.turn >= 0, '拼好之後再按一下才翻頁');
}

console.log('5. 翻頁');
{
  const s = new Story(null);
  let called = 0, covers = 0;
  s.start(THREE, { slow: true, then: () => called++, cover: () => covers++ });
  run(s, STORY.slow + STORY.enter + DT);
  ok(covers === 1 && s.i === 0, '第一次蓋住的那一幀叫了 cover');
  settle(s);
  s.update(DT, true);
  ok(s.turn >= 0 && s.covered, '第一頁按一下：開始翻頁，還蓋著');
  const turning = run(s, STORY.turn + DT, true);
  ok(turning.every((k) => k === 0) && s.i === 1, '翻頁的時候世界停住（一直按也不會連翻），翻完是第二頁');
  ok(s.turn < 0 && s.covered && s.since < PANEL.step, `第二頁從頭拼，${STORY.readyNext} 秒內按的不算`);
  settle(s);
  s.update(DT, true);
  run(s, STORY.turn + DT);
  ok(s.i === 2 && s.covered, '拼好之後再按一下翻到第三頁');
  settle(s);
  s.update(DT, true);
  run(s, STORY.leave + DT);
  ok(called === 1 && covers === 1 && !s.on, '最後一頁按一下書頁走掉，then 叫一次、cover 只叫過一次');
}

console.log('6. 取消');
{
  const s = new Story(null);
  let called = 0, covers = 0;
  const opts = { slow: true, then: () => called++, cover: () => covers++ };
  s.start(ONE, opts);
  run(s, STORY.slow / 2);
  s.cancel();
  ok(s.update(DT, false) === 1 && !s.busy && called === 0 && covers === 0, '慢動作裡取消：正常速度、then 與 cover 都不叫');
  s.start(THREE, opts);
  run(s, STORY.slow + STORY.enter);
  settle(s);
  s.update(DT, true);
  ok(s.turn >= 0, '（翻頁中）');
  s.cancel();
  run(s, 1, true);
  ok(!s.covered && !s.on && called === 0, '翻頁翻到一半取消：書頁收掉、then 不叫');
}

console.log('7. 頁表');
ok(PAGES.length === 14, `十四頁（${PAGES.length}）`);
ok(PAGES.every((p) => p.panels.length >= 3 && p.panels.length <= 5), '每一頁 3～5 格');
ok(SCRIPT.open.length === STAGES.length && SCRIPT.after.length === STAGES.length,
  `開場頁與戰後頁照場次排（${STAGES.length} 場）`);
{
  const used = [SCRIPT.start, ...SCRIPT.open, ...SCRIPT.after].filter(Boolean).flat().sort((a, b) => a - b);
  ok(used.length === PAGES.length && used.every((n, i) => n === i + 1), '每一頁剛好被翻一次，頁碼 1～14 都在');
}
ok(SCRIPT.after.every((a, k) => a.length === 1 || STAGES[k].warp), '一次翻好幾頁的只有打完要傳送的那一場（墓室）');

console.log(fails ? `\n${fails} 項沒過` : '\n全部通過');
process.exit(fails ? 1 : 0);
