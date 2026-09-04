// looks.js 的驗證器：名單本身，以及選單照著它排出來的那張表。
//
// 這一支的重點是「加一種動物不用改別的地方」這句話到底成不成立。名單長
// 什麼樣是資料，而選單的版面是從資料算出來的——算錯了不會壞掉、不會丟
// 例外，只會排歪，而排歪要等到真的有人加了第四種動物才看得到。所以這裡
// 直接餵幾份假名單問它「那你怎麼排」。
//
// 驗的是這幾件事：
//
//   · 扁平的 look 是「模型/毛色」，而且 LOOKS 就是名單的全部組合
//   · isLook 認得每一個、不認得亂編的
//   · lookGrid 的格子恰好是 LOOKS，一個不多一個不少，而且沒有兩格重疊
//   · 參差的名單（某種動物毛色比較少或比較多）不會錯行：行仍然是動物
//   · 欄數取最寬的那一行，列數就是動物數
//   · 名字與色票查不到時是退回，不是丟例外
//
// 用法：node tools/verify-looks.mjs

import {
  MODELS, MODEL_SKINS, LOOKS, DEFAULT_LOOK, isLook,
  lookInfo, lookGrid, modelName, skinName, swatchCss,
} from '../public/src/cat/looks.js';

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ── 1. 名單本身 ────────────────────────────────────────────────── */

const want = MODELS.reduce((n, m) => n + MODEL_SKINS[m].length, 0);
ok(LOOKS.length === want, `LOOKS 有 ${LOOKS.length} 項，名單算出來是 ${want}`);
ok(new Set(LOOKS).size === LOOKS.length, 'LOOKS 裡有重複的');
ok(LOOKS.every((l) => l.split('/').length === 2), 'look 不是「模型/毛色」兩段');
ok(LOOKS.every(isLook), 'isLook 不認得自己名單上的東西');
ok(!isLook('沒這種/沒這件') && !isLook('') && !isLook(undefined),
  'isLook 認了不該認的');
ok(isLook(DEFAULT_LOOK), `預設造型 ${DEFAULT_LOOK} 不在名單上`);

/* 拆開的兩半要跟合起來的那個一致。圖鑑跟選單各拿一半用。 */
for (const l of LOOKS) {
  const i = lookInfo(l);
  ok(`${i.model}/${i.skin}` === l, `lookInfo 拆不回原本的 ${l}`);
  ok(i.name === `${i.modelName}・${i.skinName}`, `${l} 的合併名字對不上兩半`);
  /* 退回的灰球只有一個色。名單上的每一件毛色都該有自己的色票——這是
     加動物時唯一不會自動長出來、又不會壞掉所以沒人會發現的一步。 */
  ok(i.swatch.length >= 2, `${l} 沒有登記色票（SWATCH 裡少了 ${i.skin}）`);
  ok(/^linear-gradient\(/.test(swatchCss(i.swatch)), `${l} 的色球畫不出漸層`);
}

/* 查不到的名字要退回原字串、查不到的色票要退回一顆灰球——這些是從
   socket 上收來的資料，沒聽過的名字應該被畫成「某個東西」而不是炸掉。 */
ok(modelName('沒這種') === '沒這種', '沒登記的物種名沒有退回原字串');
ok(skinName('沒這件') === '沒這件', '沒登記的毛色名沒有退回原字串');
ok(lookInfo('沒這種/沒這件').swatch.length >= 1, '沒登記的毛色沒有退回色票');

/* ── 2. 真名單排出來的那張表 ────────────────────────────────────── */

const grid = lookGrid();
ok(grid.rows === MODELS.length, `列數是 ${grid.rows}，動物有 ${MODELS.length} 種`);
ok(grid.cols === Math.max(...MODELS.map((m) => MODEL_SKINS[m].length)),
  `欄數是 ${grid.cols}，最寬的一行不是這個數`);
ok(grid.cells.length === LOOKS.length,
  `表上有 ${grid.cells.length} 格，LOOKS 有 ${LOOKS.length} 項`);
ok(grid.cells.map((c) => c.look).join() === LOOKS.join(),
  '表上的造型跟 LOOKS 不是同一份、同一個順序');

/* ── 3. 參差的名單 ──────────────────────────────────────────────
   這是「全自動」真正要撐住的情況：每種動物的毛色數不一樣。丟給網格自動
   排的話，第一個毛色數不同的動物之後，每一行都會往前擠、跟動物對不上；
   格子的行列指定好就只是右邊少幾格。 */

const check = (label, models, skins) => {
  const g = lookGrid(models, skins);
  const total = models.reduce((n, m) => n + (skins[m] || []).length, 0);
  ok(g.rows === models.length, `${label}：列數 ${g.rows}，應該是 ${models.length}`);
  ok(g.cols === Math.max(0, ...models.map((m) => (skins[m] || []).length)),
    `${label}：欄數 ${g.cols} 不是最寬的那一行`);
  ok(g.cells.length === total, `${label}：格子 ${g.cells.length} 個，造型有 ${total} 種`);

  // 沒有兩格搶同一個位置
  const seen = new Set();
  const clash = g.cells.filter((c) => {
    const k = `${c.row},${c.col}`;
    if (seen.has(k)) return true;
    seen.add(k);
    return false;
  });
  ok(clash.length === 0, `${label}：有 ${clash.length} 格疊在一起`);

  // 一行就是一種動物：同一行的格子，模型必須全都一樣，而且照名單的順序
  models.forEach((m, i) => {
    const row = g.cells.filter((c) => c.row === i + 1);
    ok(row.length === (skins[m] || []).length,
      `${label}：第 ${i + 1} 行有 ${row.length} 格，${m} 有 ${(skins[m] || []).length} 件毛色`);
    ok(row.every((c) => c.look.slice(0, c.look.indexOf('/')) === m),
      `${label}：第 ${i + 1} 行混進了別種動物`);
    ok(row.every((c, j) => c.col === j + 1),
      `${label}：第 ${i + 1} 行的欄位沒有從 1 開始連續排`);
  });

  // 每一格都在表的範圍內
  ok(g.cells.every((c) => c.row >= 1 && c.row <= g.rows && c.col >= 1 && c.col <= g.cols),
    `${label}：有格子跑到表外面`);
  return g;
};

check('現況（三種各三件）', MODELS, MODEL_SKINS);

const raggedModels = ['cat', 'dog-prick', 'bird', 'fish'];
const raggedSkins = {
  cat: ['orangin', 'tabby', 'calico'],
  'dog-prick': ['yellow', 'grey', 'cow'],
  bird: ['blue', 'red'],                              // 比較少
  fish: ['gold', 'koi', 'silver', 'black'],           // 比較多
};
const rag = check('參差（2/3/4 件毛色）', raggedModels, raggedSkins);
ok(rag.cols === 4 && rag.rows === 4, `參差的表是 ${rag.cols}×${rag.rows}，應該是 4×4`);
ok(rag.cells.filter((c) => c.row === 3).length === 2, '只有兩件毛色的那一行不是兩格');
ok(rag.cells.find((c) => c.look === 'fish/black').col === 4,
  '四件毛色的最後一件沒有排在第四欄');

check('一種動物一件毛色', ['cat'], { cat: ['orangin'] });
check('多到一頁排不下', Array.from({ length: 9 }, (_, i) => `m${i}`),
  Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`m${i}`, ['a', 'b', 'c']])));

/* ── 帳 ─────────────────────────────────────────────────────────── */

console.log(`名單：${MODELS.length} 種動物、${LOOKS.length} 種造型`);
console.log(`選單排成 ${grid.cols} 欄 × ${grid.rows} 列`);
for (const m of MODELS) {
  console.log(`  ${modelName(m).padEnd(4, '　')} ${MODEL_SKINS[m].map(skinName).join('、')}`);
}
console.log(`參差的假名單（2/3/4 件）排成 ${rag.cols} 欄 × ${rag.rows} 列，沒有錯行`);
if (fails.length) {
  console.error(`\n✗ ${fails.length} 項不對：`);
  for (const f of fails) console.error('  · ' + f);
  process.exit(1);
}
console.log('✓ 全部通過');
