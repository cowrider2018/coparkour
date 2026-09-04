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
   is the whole of it: the menu builds itself from `LOOKS`, the
   catalogue page builds itself from `SPECIES`, and the server accepts
   the new ids because it reads the same list.
   ------------------------------------------------------------------ */

import { buildDog } from './dog.js';
import { DOG_EARS, MODELS, MODEL_SKINS } from './looks.js';

/**
 * Turn the one parsed asset into the roster a layer holds.
 *
 * Handed to `CatLayer.load` as `opts.models`. The cat is not a special
 * case with an `if` around it — its recipe is "keep what arrived",
 * which is what makes the list read as a list.
 *
 * @param {object} cat  the object `parseCat` returned
 * @returns {{id: string, data: object}[]}
 */
export function speciesModels(cat) {
  return [
    { id: 'cat', data: cat },
    ...DOG_EARS.map((ear) => ({ id: `dog-${ear}`, data: buildDog(cat, { ear }) })),
  ];
}

/**
 * The same roster as metadata, for anything that wants to list the
 * animals without building them — a menu, a catalogue, a shop.
 */
export const SPECIES = MODELS.map((id) => ({ id, skins: MODEL_SKINS[id] }));
