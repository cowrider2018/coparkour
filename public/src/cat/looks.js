/* ── src/cat/looks.js ────────────────────────────────────────────────
   Every look in the game, and nothing else.

   A LOOK is which animal a character is and which colourway it wears,
   as one flat string: "cat/tabby", "dog-drop/cow". One token, because
   of everywhere it has to go — it is chosen in the menu, written to
   localStorage, put on the join URL, sent down the socket, checked by
   the server, handed back to `CatLayer.cat()` — and every one of those
   is happier with an opaque name than with two fields that can drift
   apart.

   ── why this file has no imports ─────────────────────────────────
   Because the SERVER reads it. `worker/index.js` used to keep its own
   copy of the skin list with a comment saying the two had to be changed
   together, which is the kind of promise that gets broken quietly and
   then costs an afternoon. It can import this instead — but only if
   importing it does not drag in the renderer, the rig and the mesh
   builder, which is what importing `cat.js` or `dog.js` would do.

   So the names live here, alone, and `cat.js` and `dog.js` take theirs
   FROM here rather than declaring their own. This is the bottom of the
   dependency graph and it stays there.

   ── adding one ───────────────────────────────────────────────────
   A colourway: add it to that animal's list below, to `SKIN_NAME` and
   `SWATCH` below that, and to `dog.js`'s own coat table. A whole
   animal: add its id here, its name to `MODEL_NAME`, and its recipe to
   `species.js`.

   Nothing else needs telling. The server reads this file, the catalogue
   page builds itself from `SPECIES`, and the menu's grid counts its own
   rows and columns off `lookGrid()` — including animals whose coat
   counts differ from everyone else's.

   The one step that is not automatic and will not break anything if you
   skip it is the name and the swatch: an unregistered coat falls back to
   its raw id and a grey chip, which looks like a bug and isn't one.
   `tools/verify-looks.mjs` fails on it so it does not ship that way.
   ------------------------------------------------------------------ */

/** The cat's three, in cat.bin's own order. */
export const CAT_SKINS = ['orangin', 'tabby', 'calico'];
/** The dog's coats. See DOG_COATS in dog.js for what they are made of. */
export const DOG_SKINS = ['yellow', 'grey', 'cow'];
/** The dog's ear variants. Each is a separate MODEL: different mesh. */
export const DOG_EARS = ['prick', 'drop'];

/** Model ids, in the order the roster is built and drawn. */
export const MODELS = ['cat', ...DOG_EARS.map((e) => `dog-${e}`)];

/** Which colourways each model carries. */
export const MODEL_SKINS = {
  cat: CAT_SKINS,
  ...Object.fromEntries(DOG_EARS.map((e) => [`dog-${e}`, DOG_SKINS])),
};

/** Every look, as the flat id everything else passes around. */
export const LOOKS = MODELS.flatMap((m) => MODEL_SKINS[m].map((s) => `${m}/${s}`));

/** What a character is drawn as when nothing else is known. */
export const DEFAULT_LOOK = LOOKS[0];

/** @param {string} look @returns {boolean} */
export const isLook = (look) => LOOKS.includes(look);

/**
 * 同樣一份名單，攤成一張表：一行一種動物，一列一件毛色。
 *
 * 選單要的是這個形狀而不是扁平的 LOOKS。扁平的名單交給 CSS 自動換行，
 * 只有在「每種動物的毛色數都一樣」時才會排成整齊的表——第一次有動物
 * 帶兩件或四件毛色，後面每一行就全部錯開，而那是靜靜發生的。
 *
 * 這裡把每一格的行列都算出來，所以參差的名單也只是右邊少幾格，不會錯行。
 * cols 取最寬的那一行，rows 就是動物數。
 *
 * 收 models / skins 當參數而不是直接讀上面那兩個常數，是為了驗證器能餵
 * 一份參差的假名單進來問「那你怎麼排」——不然這件事只有等真的加了第四種
 * 動物才會知道。
 *
 * @param {string[]} [models]
 * @param {Record<string, string[]>} [skins]
 * @returns {{cols: number, rows: number, cells: {look: string, row: number, col: number}[]}}
 */
export function lookGrid(models = MODELS, skins = MODEL_SKINS) {
  const cells = [];
  models.forEach((model, row) => {
    (skins[model] || []).forEach((skin, col) => {
      // row / col 從 1 起算：CSS grid 的行列編號就是這樣數的。
      cells.push({ look: `${model}/${skin}`, row: row + 1, col: col + 1 });
    });
  });
  return {
    cols: models.reduce((n, m) => Math.max(n, (skins[m] || []).length), 0),
    rows: models.length,
    cells,
  };
}

/* ── names and swatches ───────────────────────────────────────────
   Presentation, and deliberately not the coat's own colours: a coat is
   picked to read at forty pixels under the game's own three-tone light,
   and a swatch is a flat 14 px square on a dark menu. They agree about
   which animal is which; they are not the same numbers. */

const MODEL_NAME = { cat: '貓', 'dog-prick': '立耳犬', 'dog-drop': '垂耳犬' };
const SKIN_NAME = {
  orangin: '橘白', tabby: '虎斑', calico: '三花',
  yellow: '黃', grey: '灰白', cow: '乳牛',
};
/** Two or three stops each, painted left to right across the chip. */
const SWATCH = {
  orangin: ['#e8862f', '#f2ece2'],
  tabby: ['#9a7346', '#d9c39e'],
  calico: ['#2e2723', '#f2ece2', '#e8862f'],
  yellow: ['#be7d41', '#e5be7a'],
  grey: ['#54565a', '#f3f3f1'],
  cow: ['#34302f', '#f6f6f4'],
};

/** @param {string} model @returns {string} what to call that animal. */
export const modelName = (model) => MODEL_NAME[model] || model;
/** @param {string} skin @returns {string} what to call that colourway. */
export const skinName = (skin) => SKIN_NAME[skin] || skin;

/** `look` → what to call it and what to paint its chip.
 *  The two halves come out separately as well as joined, because callers
 *  want them apart: the menu's button carries the animal and leaves the
 *  coat to the chip, and the catalogue heads a card with the animal and
 *  labels each coat under it. It used to split the joined string back
 *  apart on the ・, which worked, but only by accident. */
export function lookInfo(look) {
  const slash = look.indexOf('/');
  const model = look.slice(0, slash), skin = look.slice(slash + 1);
  return {
    model,
    skin,
    modelName: modelName(model),
    skinName: skinName(skin),
    name: `${modelName(model)}・${skinName(skin)}`,
    swatch: SWATCH[skin] || ['#8a8a8a'],
  };
}

/** The chip's paint, as one CSS gradient: two stops split down the
 *  middle, three cut into equal thirds. */
export function swatchCss(swatch) {
  const stops = swatch.length === 2
    ? `${swatch[0]} 50%, ${swatch[1]} 50%`
    : swatch.map((c, i, a) => `${c} ${Math.round((i / a.length) * 100)}% ${Math.round(((i + 1) / a.length) * 100)}%`).join(', ');
  return `linear-gradient(135deg, ${stops})`;
}
