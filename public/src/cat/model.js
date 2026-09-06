/* ── src/cat/model.js ────────────────────────────────────────────────
   What the layer needs to know about the animal it is drawing, and the
   cat's own answer to it.

   A parsed asset may carry a `model` of its own — `dog.js` builds one,
   `wear.js` extends whichever it is handed — and `CatLayer` falls back
   to the cat's, which is what it used to hardcode.

   It is here rather than in `cat.js` because of who needs it. A BUILDER
   needs it: dressing an animal adds parts to the table and leaves the
   other six fields exactly as they were, so it has to be able to read
   the descriptor of the animal it is dressing, and for an asset that
   came straight off cat.bin that descriptor is this one. Importing
   `cat.js` to reach it would put the whole renderer — a WebGL2 context,
   two thousand lines of shader — behind every builder, and `main.js`
   loads that file lazily on purpose.

   Nothing here imports anything but names and measurements.
   ------------------------------------------------------------------ */

import { SHAPE_PARTS, SHAPE_RIDE, SHAPE_PATCH } from './shape.js';
import { CAT_SKINS } from './looks.js';

/* ── how big the cat is, and where its feet are ─────────────────── */

/** Rest pose feet-to-ear-tip. `bounds.max[1] - bounds.min[1]`. */
const MODEL_REST_HEIGHT = 3.9922;
/** …drawn at this many collision-box heights. See cat.js's header. */
const CAT_HEIGHT_IN_BOXH = 1.10;

/** Horizontal centre of the model, in world Z. The rest pose spans
    −1.93 (tail) … +1.85 (whiskers), so this is its middle, and it is
    this point that is put on the box's centre line. */
const CENTER_Z = -0.04;

/* ── the cat's descriptor ─────────────────────────────────────────
   Everything above is a property of the CAT, and the cat is not the
   only thing the layer draws: `dog.js` builds a second animal on the
   same rig, the same shader and the same bend, and it has its own
   colourways, its own rectangle for a muzzle the cat has no bone for,
   and its own middle — a muzzle sticking half a unit further forward
   moves the point that should sit on the box's centre line.

   So the fields that vary are gathered here. */
export const CAT_MODEL = {
  skins: CAT_SKINS,
  parts: SHAPE_PARTS,
  ride: SHAPE_RIDE,
  patch: SHAPE_PATCH,
  restHeight: MODEL_REST_HEIGHT,
  heightInBoxH: CAT_HEIGHT_IN_BOXH,
  centerZ: CENTER_Z,
  /** bone → how far to sink its ink. The cat's whole outline is one
      grown shell of one mesh, so it has nothing to merge. */
  inkSink: {},
};
