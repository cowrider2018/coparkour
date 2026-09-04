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
   A colourway: add it to that animal's list below, and to `dog.js`'s
   own coat table. A whole animal: add its id here and its recipe to
   `species.js`. Nothing else needs telling — the menu, the catalogue
   page and the server all read this file.
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
 *  want them apart: the catalogue heads a card with the animal and
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
