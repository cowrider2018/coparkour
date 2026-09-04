// showcase.js 的無頭驗證器：選單左邊那一格跟圖鑑是不是同一件事。
//
// 這一支之所以存在，是因為那一格現在有兩個使用者，而它們對它的要求不一樣：
// 圖鑑一格站一排毛色、開始選單一格只站你選中的那一隻，而且選單那一格會在
// 使用者按按鈕的時候換人。換人這件事沒有別的地方驗得到——遊戲裡的 look 是
// 開跑之後才用的，選單裡的 look 只影響這一格。
//
// 驗的是這幾件事：
//
//   · 建構就把天空、地面、畫布放進框裡，並且照著疊（天空在後、畫布在前）
//   · 一排 look 等距排開，腳踩在地面線上，而地面線在框高的八成處
//   · looks 換一隻，下一幀畫的就是那一隻（而且真的換了模型，不是只換毛色）
//   · 節拍：兩秒一輪，開頭是 air→fall 的跳，其餘時間是 run
//   · 拿起來看：拖曳把 ψ 釘住，鬆手盪回右側面，到家之後把朝向還給 CatLayer
//   · 俯仰抬起來的時候，那條說謊的地面線會淡掉
//   · 框縮小，動物跟著縮小：它在框裡佔的比例不隨框的大小改變
//
// 用法：node tools/verify-showcase.mjs

import { readFileSync } from 'node:fs';
import { fakeGL, fakeCanvas } from './lib/fake-gl.mjs';

/* ── 一個剛好夠 showcase 用的 DOM ──────────────────────────────── */

const gl = fakeGL();

function el(tag) {
  const node = {
    tag,
    style: {},
    children: [],
    classes: new Set(),
    handlers: new Map(),
    clientWidth: 140,
    clientHeight: 140,
    append: (...kids) => node.children.push(...kids),
    appendChild: (k) => node.children.push(k),
    addEventListener: (k, fn) => node.handlers.set(k, fn),
    setPointerCapture: () => {},
    classList: {
      add: (c) => node.classes.add(c),
      remove: (c) => node.classes.delete(c),
      contains: (c) => node.classes.has(c),
    },
  };
  if (tag === 'canvas') {
    const c = fakeCanvas(gl);
    node.width = c.width;
    node.height = c.height;
    node.getContext = c.getContext;
  }
  return node;
}

globalThis.document = { createElement: el };
globalThis.devicePixelRatio = 2;

const { parseCat } = await import('../public/src/cat/rig.js');
const { CatLayer } = await import('../public/src/cat/cat.js');
const { speciesModels } = await import('../public/src/cat/species.js');
const { Showcase, beat, BEAT, FILL } = await import('../public/src/cat/showcase.js');
const { PLAYER_W, PLAYER_H } = await import('../public/src/constants.js');

const buf = readFileSync('public/assets/cat.bin');
const roster = speciesModels(parseCat(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/* ── 起一格 ──────────────────────────────────────────────────────
   用的就是選單那一格的參數：140 px 見方（正方形是 CSS 的 aspect-ratio
   說的，這裡直接給一個量得到的框），站一隻。 */

const W = 140, H = 140;
const view = el('div');
const show = new Showcase(view, (canvas) => new CatLayer(canvas, roster, {}),
  { looks: ['cat/tabby'] });

/* 記帳：把 cat/pin 攔下來看它收到什麼，再照原樣往下傳。 */
const drawn = [];
const pinned = [];
const realCat = show.layer.cat.bind(show.layer);
const realPin = show.layer.pin.bind(show.layer);
show.layer.cat = (id, x, y, facing, state, speed, dt, look, alpha, vy) => {
  drawn.push({ id, x, y, state, look, vy });
  return realCat(id, x, y, facing, state, speed, dt, look, alpha, vy);
};
show.layer.pin = (id, yaw, pitch) => {
  pinned.push({ id, yaw, pitch });
  return realPin(id, yaw, pitch);
};

const step = (dt, clock) => {
  drawn.length = 0;
  pinned.length = 0;
  show.draw(dt, beat(clock));
};
const REST = BEAT * 0.9;   // 節拍的後段：站著跑，不在跳

/* ── 1. 框裡有什麼、照什麼順序疊 ───────────────────────────────── */

ok(view.children.length === 3, `框裡有 ${view.children.length} 個東西，應該是 3`);
ok(view.children[2] === show.canvas, '畫布不是最後一個（會被天空蓋掉）');
ok(/z-index:0/.test(show.sky.style.cssText) && /z-index:1/.test(show.canvas.style.cssText),
  '天空與畫布的疊層反了');
ok(view.style.touchAction === 'none', '框沒關掉 touch-action，手機上拖到一半會變成捲頁');

/* 沒有布景的那一格（選單用的）：天空跟地面線根本不建，只有一張透明畫布。
   「不建」跟「建了設成透明」不一樣，後者仍然會每幀去寫兩個元素的樣式，
   而且在卡片上留下一層擋著的東西。 */
const bare = el('div');
const bareShow = new Showcase(bare, (canvas) => new CatLayer(canvas, roster, {}),
  { looks: ['cat/tabby'], scenery: false });
ok(bare.children.length === 1, `沒有布景的框裡有 ${bare.children.length} 個東西，應該只有畫布`);
ok(bare.children[0] === bareShow.canvas, '沒有布景的框裡那個不是畫布');
ok(bareShow.sky === null && bareShow.floor === null, '說了不要布景卻還是建了天空或地面線');
ok(!/background/.test(bareShow.canvas.style.cssText), '畫布自己不該有底色');

const bareDrawn = [];
const bareReal = bareShow.layer.cat.bind(bareShow.layer);
bareShow.layer.cat = (id, x, y, f, st, sp, dt, lk, a, vy) => {
  bareDrawn.push({ x, y });
  return bareReal(id, x, y, f, st, sp, dt, lk, a, vy);
};
bareShow.draw(1 / 60, beat(REST));   // 不能因為 sky 是 null 就炸掉
ok(bareDrawn.length === 1, '沒有布景就畫不出動物了');

/* ── 2. 站的位置 ────────────────────────────────────────────────── */

step(1 / 60, REST);
ok(drawn.length === 1, `畫了 ${drawn.length} 隻，應該是 1`);
ok(drawn[0].look === 'cat/tabby', `畫的是 ${drawn[0].look}`);

const zoomOf = (h, fill = FILL) => (h * fill) / PLAYER_H;
const vw = W / zoomOf(H), vh = H / zoomOf(H);
const feet = Math.round(H * 0.8) / zoomOf(H);
ok(near(drawn[0].x, vw / 2 - PLAYER_W / 2), `沒站在中間：x = ${drawn[0].x}`);
ok(near(drawn[0].y, feet - PLAYER_H), `腳沒踩在地面線上：y = ${drawn[0].y}`);
ok(show.floor.style.top === Math.round(H * 0.8) + 'px', `地面線在 ${show.floor.style.top}`);
ok(/height:100%/.test(show.canvas.style.cssText),
  '畫布沒有填滿框：框多大應該是 CSS 說了算');
ok(show.canvas.width === W * 2 && show.canvas.height === H * 2,
  `畫布沒照 dpr 放大：${show.canvas.width}×${show.canvas.height}`);
ok(vh > PLAYER_H, '可視高度比一隻動物還矮，框裡會塞不下');

/* 拿掉布景不會把動物挪走：站在哪裡是幾何，天空是背景。 */
ok(near(bareDrawn[0].x, drawn[0].x) && near(bareDrawn[0].y, drawn[0].y),
  `沒有布景的那一格站的位置不一樣：${bareDrawn[0].x},${bareDrawn[0].y}`
  + ` vs ${drawn[0].x},${drawn[0].y}`);
bareShow.dispose();

/* 一排三件毛色：等距，而且腳都在同一條線上。 */
show.looks = ['dog-drop/yellow', 'dog-drop/grey', 'dog-drop/cow'];
step(1 / 60, REST);
ok(drawn.length === 3, `一排畫了 ${drawn.length} 隻，應該是 3`);
const xs = drawn.map((d) => d.x);
ok(near(xs[1] - xs[0], xs[2] - xs[1]), `沒等距：${xs.map((x) => x.toFixed(2)).join(' ')}`);
ok(drawn.every((d) => near(d.y, feet - PLAYER_H)), '一排裡有誰沒站在地上');

/* ── 2b. 框縮小，動物跟著縮小 ───────────────────────────
   這是手機上真的壞掉的那一件事。以前這裡是固定倍率，意思是動物在框裡
   的絕對大小不變——框從桌機的 187 px 縮到手機的 143 px，動物一樣大，
   佔的比例就從四成變成五成三，尾巴甩出框外。

   現在量的是比例：兩個尺寸差很多的框，動物佔的比例要一樣。 */

const sizes = [187, 143, 96];
const fracs = sizes.map((px) => {
  const v = el('div');
  v.clientWidth = px;
  v.clientHeight = px;
  const sc = new Showcase(v, (canvas) => new CatLayer(canvas, roster, {}),
    { looks: ['cat/tabby'], scenery: false, fill: 0.38 });
  let got = null;
  const real = sc.layer.cat.bind(sc.layer);
  sc.layer.cat = (id, x, y, f, st, sp, dt, lk, a, vy) => {
    // 動物的 CSS px 高度 = 世界高 × 倍率；佔框高的幾成，就是 fill。
    got = { x, y };
    return real(id, x, y, f, st, sp, dt, lk, a, vy);
  };
  sc.draw(1 / 60, beat(REST));
  const zoom = zoomOf(px, 0.38);
  const bodyTop = got.y * zoom;                 // 頭頂在框裡的 CSS px
  const bodyPx = PLAYER_H * zoom;               // 動物的 CSS px 高
  sc.dispose();
  return { px, frac: bodyPx / px, headFrac: bodyTop / px, bodyPx };
});
ok(fracs.every((f) => near(f.frac, 0.38, 1e-9)),
  '動物佔框高的比例跟框的大小有關：'
  + fracs.map((f) => `${f.px}px→${(f.frac * 100).toFixed(1)}%`).join(' '));
/* 位置只能差在地面線那一次 Math.round 上——那條線要落在整數 px 才不會糊。
   所以每一個都跟「沒有取整的理想值」比，各自容許半個 px；互相比會把兩次
   取整的誤差疊起來（一個進位、一個捨去就是一整個 px），那不是偏移。
   理想的頭頂位置：地面線在八成處，動物往上長 fill 成。 */
const idealHead = 0.8 - 0.38;
ok(fracs.every((f) => Math.abs(f.headFrac - idealHead) * f.px < 0.5),
  '動物在框裡的位置沒有跟框一起縮：'
  + fracs.map((f) => `${f.px}px→${(f.headFrac * 100).toFixed(1)}%`).join(' ')
  + `（應該都是 ${(idealHead * 100).toFixed(1)}%）`);
ok(fracs[0].bodyPx > fracs[2].bodyPx, '框縮小了動物卻沒有跟著縮小');
/* 而圖鑑那邊一格也沒有動：預設的 FILL 就是舊的 ZOOM 1.9 在 320 px 框裡
   的那個大小，換算回去要分毫不差。 */
ok(near(zoomOf(320, FILL), 1.9, 1e-9),
  `圖鑑的大小變了：320 px 的框算出來的倍率是 ${zoomOf(320, FILL)}，應該是 1.9`);

/* ── 3. 換一隻就是換一隻 ────────────────────────────────────────── */

const modelOf = (look) => {
  const r = show.layer._look(look);
  return [...show.layer._models].find(([, m]) => m === r.m)[0];
};
show.looks = ['cat/calico'];
step(1 / 60, REST);
ok(drawn.length === 1 && drawn[0].look === 'cat/calico',
  `換回貓之後畫的是 ${drawn[0] && drawn[0].look}`);
ok(modelOf('cat/calico') === 'cat', '貓沒解到貓');
ok(modelOf('dog-drop/cow') === 'dog-drop', '垂耳犬沒解到垂耳犬');
ok(modelOf('dog-prick/cow') === 'dog-prick', '立耳犬沒解到立耳犬');
ok(modelOf('dog-drop/cow') !== modelOf('dog-prick/cow'), '兩種耳朵解到同一個模型');

/* ── 4. 節拍 ────────────────────────────────────────────────────── */

const states = [];
for (let t = 0; t < BEAT - 1e-9; t += BEAT / 40) states.push(beat(t).state);
ok(states[0] === 'air', `一輪的開頭是 ${states[0]}，應該是起跳`);
ok(states.includes('fall'), '一輪裡沒有下降段');
ok(states[states.length - 1] === 'run', `一輪的結尾是 ${states[states.length - 1]}，應該落地在跑`);
ok(beat(0.0001).vy < 0, '起跳的 vy 不是往上（世界 y 往下長，往上是負的）');
ok(beat(REST).vy === 0, '沒在跳的時候 vy 應該是 0');
ok(beat(BEAT + 0.0001).state === 'air', '第二輪沒有重新起跳');
const hop = states.filter((s) => s !== 'run').length;
ok(hop > 2 && hop < states.length / 2, `跳佔了一輪的 ${hop}/${states.length}，比例不對`);

/* ── 5. 拿起來看 ────────────────────────────────────────────────── */

step(1 / 60, REST);
ok(pinned[0].yaw === null, '沒被碰過的時候應該不釘朝向，讓 CatLayer 自己管');

const down = (id, x, y) => view.handlers.get('pointerdown')(
  { button: 0, pointerId: id, clientX: x, clientY: y, preventDefault() {} });
const move = (id, x, y) => view.handlers.get('pointermove')({ pointerId: id, clientX: x, clientY: y });
const up = (id) => view.handlers.get('pointerup')({ pointerId: id });

down(1, 0, 0);
ok(view.classes.has('held'), '按下去之後沒有 held');
move(1, 100, -40);
const heldYaw = show.yaw, heldPitch = show.pitch;
ok(heldYaw !== null && heldYaw > Math.PI / 2, `往右拖沒有把 ψ 帶大：${heldYaw}`);
ok(heldPitch > 0, `往上拖沒有抬起鏡頭：${heldPitch}`);
step(1 / 60, REST);
ok(pinned[0].yaw === heldYaw, '拖曳中的角度沒有釘進 layer');
ok(Number(show.floor.style.opacity) < 1, '鏡頭抬起來了，地面線卻還是實的');

/* 拖過頭：夾在 ±70°，不讓畫面翻過去。 */
move(1, 100, -4000);
ok(show.pitch <= 1.22 + 1e-9, `俯仰沒夾住：${show.pitch}`);
move(1, 100, 4000);
ok(show.pitch >= -1.22 - 1e-9, `俯仰往下沒夾住：${show.pitch}`);

/* 別人的指標不算數。 */
const mine = show.yaw;
move(9, -500, 0);
ok(show.yaw === mine, '另一根手指也能轉這一格');

up(1);
ok(!view.classes.has('held'), '鬆手之後還留著 held');

/* 鬆手：盪回右側面，然後把朝向還給 CatLayer。 */
let frames = 0;
while (show.yaw !== null && frames < 600) { step(1 / 60, REST); frames++; }
ok(show.yaw === null, `盪了 ${frames} 幀還沒把朝向還回去`);
ok(frames < 120, `盪回去花了 ${frames} 幀（${(frames / 60).toFixed(2)} 秒），太久`);
ok(show.pitch === 0, `俯仰沒歸零：${show.pitch}`);
step(1 / 60, REST);
ok(pinned[0].yaw === null, '到家之後沒有把朝向交還');
ok(Number(show.floor.style.opacity) === 1, '鏡頭放平了，地面線沒有變回實線');

/* 轉了好幾圈之後，回家走的是短的那條路。 */
down(2, 0, 0);
move(2, 1240, 0);              // 三圈多
const far = show.yaw;
ok(far > Math.PI * 6, `轉了 ${far.toFixed(2)} rad，沒有累加成連續的角度`);
up(2);
step(1 / 60, REST);
ok(show.yaw < far && show.yaw > Math.PI * 6, `回家把三圈倒著轉了：${show.yaw.toFixed(2)}`);

/* ── 6. 收掉 ────────────────────────────────────────────────────── */

show.dispose();
ok(show.layer._models.size === 0, '收掉之後模型還在');

/* ── 帳 ─────────────────────────────────────────────────────────── */

console.log(`一格 ${W}×${H} px：相機 ${vw.toFixed(1)}×${vh.toFixed(1)} 世界 px`
  + `，動物 ${PLAYER_W}×${PLAYER_H}，腳在 ${feet.toFixed(1)}`);
console.log('框縮小時動物佔的比例：'
  + fracs.map((f) => `${f.px}px → ${f.bodyPx.toFixed(1)}px (${(f.frac * 100).toFixed(1)}%)`).join('，'));
console.log(`節拍 ${BEAT} 秒：` + states.map((s) => s[0]).join(''));
if (fails.length) {
  console.error(`\n✗ ${fails.length} 項不對：`);
  for (const f of fails) console.error('  · ' + f);
  process.exit(1);
}
console.log('✓ 全部通過');
