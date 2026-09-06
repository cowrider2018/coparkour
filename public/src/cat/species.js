/* ── src/cat/species.js ──────────────────────────────────────────────
   The roster: every animal this game can draw, and how to make it.

   There is exactly one asset — `cat.bin` — and everything else is built
   out of it at load. This file is the list of those recipes, and it
   exists so that nothing else has to know there IS more than one: the
   game, the catalogue page and anything else hand `speciesModels` to
   `CatLayer.load` and get a layer that can draw all of them.

   It is separate from `looks.js` because of who reads what. `looks.js`
   is names, and the server reads it. This is recipes, and a recipe
   imports `dog.js`, which imports the rig and the mesh builder — none
   of which belongs anywhere near a Worker bundle.

   ── adding an animal ─────────────────────────────────────────────
   Add its id to `MODELS` in looks.js, its colourways to `MODEL_SKINS`
   there, and one line here saying how to build it out of the cat. That
   is the whole of it: the menu and the catalogue page both build
   themselves from `lookGrid()`, and the server accepts the new ids
   because it reads the same list.
   ------------------------------------------------------------------ */

import { buildDog } from './dog.js';
import { dress } from './wear.js';
import { DOG_EARS, MODELS, MODEL_SKINS } from './looks.js';

/**
 * Turn the one parsed asset into the roster a layer holds.
 *
 * Handed to `CatLayer.load` as `opts.models`. The cat is not a special
 * case with an `if` around it — its recipe is "keep what arrived",
 * which is what makes the list read as a list.
 *
 * `opts.wear` asks for the same animals with a wardrobe built into
 * them: the costume ids from `wear.js`, or all of them. It is opt-in
 * and the game does not ask, so what the game loads is byte for byte
 * what it loaded before — a dressed model carries about 30% more
 * geometry and six more bones, and none of it is any use to a player
 * who cannot choose a hat yet. The catalogue page is what asks.
 *
 * @param {object} cat  the object `parseCat` returned
 * @param {object} [opts]  `{ wear }` — costume ids to build in
 * @returns {{id: string, data: object}[]}
 */
export function speciesModels(cat, opts = {}) {
  const bare = [
    { id: 'cat', data: cat },
    ...DOG_EARS.map((ear) => ({ id: `dog-${ear}`, data: buildDog(cat, { ear }) })),
  ];
  if (!opts.wear) return bare;
  return bare.map(({ id, data }) => ({ id, data: dress(data, { wears: opts.wear }) }));
}

/**
 * The same roster as metadata, for anything that wants to list the
 * animals without building them — a menu, a catalogue, a shop.
 */
export const SPECIES = MODELS.map((id) => ({ id, skins: MODEL_SKINS[id] }));
