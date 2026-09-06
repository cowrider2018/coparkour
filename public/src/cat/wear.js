/* ── src/cat/wear.js ─────────────────────────────────────────────────
   The wardrobe: things an animal can wear on its head.

   ── why one size fits everything ──────────────────────────────────
   Because the head is a RECTANGLE. `shape.js` bends every part of this
   animal into a rounded rectangle on the screen, and the head's is
   measured off the skull — which is the same skull on all three
   species: the dog is the cat with a muzzle, wider ears and a shorter
   tail, and its head bone carries the cat's own geometry untouched. So
   a hat cut to fit that one rectangle fits every animal in the game,
   now and after the next one is added, without a single per-species
   number anywhere in this file.

   That is the whole reason the wardrobe is worth having at all: a
   costume is authored ONCE, in the head bone's own space, against
   measurements that do not vary.

   ── what a costume is made of ────────────────────────────────────
   Pieces. Each piece is one generated solid on a bone of its own,
   parented to `head`, and the bone is what makes the piece a piece:
   `shape.js` measures one rectangle per BONE, so a brim and a crown
   sharing a bone would come out as a single rounded box with no brim
   in it. Two bones for the one costume, against a five-bit bone field
   with room for thirty-two — see the count in `dress`.

   ── where a hat is allowed to sit ────────────────────────────────
   Above the eyes, and that is not a taste. The eyes, the mouth and the
   painted nose are all lifted FACE_LIFT toward the camera, and the
   bend moves screen position without touching depth — so a brim that
   lands PART WAY through any of them does not hide that half, it draws
   it on the felt. Over the eye line there is nothing to argue with.

   The ears are the other thing in the way, and there is no arrangement
   that keeps them visible under a clean hat silhouette: in profile the
   near ear is at |x| ≤ 1.14 and any crown sitting on a 1.28-wide skull
   is nearer to the camera than that. So the crown swallows the ears
   that stand up in it, and what is left telling the species apart is
   the muzzle, and the dropped dog's flaps, which hang below the brim.

   ── nothing here is in the game ──────────────────────────────────
   A costume is not part of a LOOK. `looks.js` is what the server
   validates and what goes over the socket, and it knows nothing about
   any of this; the name and the swatch below are here rather than
   there for exactly that reason. When a costume does reach the game
   they move to `looks.js`, and they move for the same reason the coat
   names live there: the server would have to agree about them.

   Until then the only caller is the catalogue page, which asks
   `species.js` for a dressed roster and drives it with
   `CatLayer.wear()`.
   ------------------------------------------------------------------ */

import { CAT_MODEL } from './model.js';
import { SHELL, INK, superQuad, shellOf, placed, Block, flatten } from './build.js';

/* ── the head, measured ───────────────────────────────────────────
   Every number in this file is in the HEAD bone's own space, which is
   where the skull's geometry lives, and these are what they are
   measured against. Read off cat.bin's outline group and identical on
   all three species:

     skull      x ±1.28   y −0.06 … 2.30   z −1.18 … 1.37
     eyes       x ±0.59   y  1.03 … 1.45   z  0.89 … 1.17
     cat ears   x ±0.98   y  1.45 … 2.50   z −0.54 … 0.36
     dog ears   x ±1.14   y  1.35 … 2.56   z −0.68 … 0.41   (pricked)
     dog muzzle x ±0.55   y  0.30 … 1.20   z  0.96 … 1.78

   and the rectangle the head is actually DRAWN as, which is the box
   above shrunk by the 0.93 it fills and by the 0.86 the part table
   takes off its height so the ears clear it:

     head rect  x ±1.19   y  0.18 … 2.06   z −1.09 … 1.28

   `tools/verify-wear.mjs` re-measures all of it and fails if a hat has
   drifted off the head it was cut for. */

/** Where a brim sits to be just clear of the eyes (1.45), its own ink
    shell counted in. */
const OVER_EYES = 1.74;
/* ── the costume ──────────────────────────────────────────────────
   A piece is:

     at      its centre, head space
     half    half-extents
     e       superquadric exponent
     radius  the corner rounding of its rectangle
     paint   its colour

   Pieces are generated as ELLIPSOIDS (e = 1) and squared off by the
   bend, which is what the dog's muzzle does and is not a detail:
   `measureNorm` measures how much of its own bounding box a part fills
   and grows the rectangle back to it, so a part generated already-boxy
   would be drawn about a fifth larger than the shape it was cut to. */

/* ── the skull, and what "the same size" means ────────────────────
   The hat's body is the head's own size, and sits on the head's own
   middle. That is not a style rule, it is what stops the numbers being
   guesswork: a body cut to the skull needs nothing tuned but its
   HEIGHT, because the two axes that decide whether it looks stuck on
   are already the head's.

   ── and it is the DRAWN size that has to match, not the authored one ──
   The head is drawn as a rounded rectangle of half (1.192, 0.940,
   1.182) centred at (0, 1.120, 0.095) — measured, not chosen; see
   `measureShapes`. A generated piece is drawn at (half + SHELL) × its
   own measured `norm`, which for an ellipsoid of these proportions
   comes out at 0.932. So the authored halves below are the drawn ones
   divided back through that, and they are NOT the same number in x and
   z, because the head is not: it is 0.010 deeper than it is wide.

   The middle matters as much as the size and was the thing that was
   wrong. The head's box is centred at z 0.095, not at 0 — the skull
   leans forward — so a hat centred anywhere else is a hat that fits in
   front and overhangs behind, by exactly the difference. */
const SKULL_W = 1.227;
const SKULL_D = 1.216;
/** The head's own middle, front to back. */
const SKULL_Z = 0.095;

const WEAR = {
  /* ── 漁夫帽 ──
     Pulled down: the brim clears the eyes by 0.05 and the crown covers
     everything above it — the skull's top at 2.30 and both species'
     ear tips at 2.50 and 2.56, ink shells counted. */
  bucket: {
    name: '漁夫帽',
    swatch: ['#8a7d40', '#6b6234'],
    pieces: [
      {
        role: 'brim',
        at: [0, OVER_EYES, SKULL_Z], half: [1.95, 0.19, 1.95], e: 1,
        // Half the short side: a brim seen edge-on is a bar with round
        // ends, which is the same answer the paws get.
        radius: 0.50,
        paint: [80, 74, 40],
      },
      {
        /* As short as it is allowed to be, which is not very. It has
           to reach from the brim to over the tallest ear tip — the
           pricked dog's, at 2.56, its ink shell counted — and that
           span is the crown. Anything shorter is a hat with an ear
           coming out of the top of it.

           Its two other axes are not a choice at all: they are the
           head's, to the hundredth. See the note above SKULL_W. */
        role: 'crown',
        at: [0, 2.14, SKULL_Z], half: [SKULL_W, 0.50, SKULL_D], e: 1,
        radius: 0.45,
        paint: [104, 96, 54],
      },
    ],
  },
};

/** The costumes, in the order a picker should offer them. */
export const WEARS = Object.keys(WEAR);

/** @param {string} id @returns {string} what to call that costume. */
export const wearName = (id) => (WEAR[id] ? WEAR[id].name : id);
/** @param {string} id @returns {string[]} two stops for a chip. */
export const wearSwatch = (id) => (WEAR[id] ? WEAR[id].swatch : ['#8a8a8a']);

/* ── the build ════════════════════════════════════════════════════ */

/** The bone a piece hangs off is named for the costume and the piece,
    which is also the name `model.wear` hands back to the layer. */
const boneName = (wear, role) => `wear-${wear}-${role}`;

/**
 * Dress a parsed asset.
 *
 * Takes the object `parseCat` returned — or anything `dog.js` built out
 * of it — and hands back one of the same shape, with every costume's
 * geometry added on bones of its own and a `model.wear` saying which
 * bones belong to which costume. Nothing about the input is modified.
 *
 * Every costume arrives WORN, and it is `CatLayer` that hides the ones
 * that are not being worn, by scaling their bones to nothing. That is
 * the wrong way round until you try the other one: a bone whose rest
 * scale is zero has no size for `measureNorm` to measure its part
 * against, and what comes out of that division is NaN — a rectangle
 * that is not a number, on the frame the costume is first put on. A
 * bone with a real size at rest cannot do that, so the hiding is the
 * layer's job and a dressed model that no layer has spoken to wears
 * everything at once.
 *
 * @param {object} data      the parsed asset to dress
 * @param {object} [opts]    `{ wears }` — which costumes to build in
 */
export function dress(data, opts = {}) {
  const wears = (opts.wears || WEARS).filter((w) => WEAR[w]);
  const base = data.model || CAT_MODEL;
  const src = data.header;

  const HEAD = src.bones.findIndex((b) => b.name === 'head');
  if (HEAD < 0) throw new Error('wear: the asset has no "head" bone to hang a hat on');

  /* Five bits of every vertex's colour alpha carry its bone, so 32 is
     the hard ceiling and it is worth failing at rather than wrapping
     into: a bone index of 32 comes out of `packed & 31` as 0, and the
     hat would be drawn hanging off the animal's root. */
  const pieces = wears.flatMap((w) => WEAR[w].pieces.map((p) => ({ ...p, wear: w })));
  if (src.bones.length + pieces.length > 32) {
    throw new Error(`wear: ${src.bones.length} bones plus ${pieces.length} pieces is past`
      + ' the 32 the colour alpha can name — drop a costume, or drop a piece');
  }

  /* One bone per piece, at the head's own origin and unrotated, so the
     numbers in the table above are read in the same space the skull's
     own geometry is written in. */
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const worn = new Map(wears.map((w) => [w, []]));
  pieces.forEach((p, i) => {
    p.bone = src.bones.length + i;
    p.boneName = boneName(p.wear, p.role);
    worn.get(p.wear).push(p.boneName);
  });

  /* ── the animal, copied ──
     Ascending source order rather than order of first reference, and
     that is not a stylistic choice. `shape.js` finds the cat's painted
     nose as a RANGE of vertex numbers and throws if what it finds is
     not one clean run; the run survives only if the copy leaves the
     relative order of the vertices exactly as the bake wrote it. */
  const col = data.colors.get(src.skins[0]);
  const blocks = { lit: new Block(), unlit: new Block(), outline: new Block() };
  const group = (n) => {
    const g = src.groups.find((x) => x.name === n);
    if (!g) throw new Error(`wear: the asset has no "${n}" group`);
    return g;
  };
  for (const name of ['lit', 'unlit', 'outline']) {
    const g = group(name), block = blocks[name];
    const seen = new Set();
    for (let i = g.start; i < g.start + g.count; i++) seen.add(data.index[i]);
    for (const v of [...seen].sort((a, b) => a - b)) block.take(data, col, v);
    for (let i = g.start; i < g.start + g.count; i++) {
      block.index.push(block.take(data, col, data.index[i]));
    }
  }

  /* ── and then the costumes ── */
  for (const p of pieces) {
    const geo = placed(superQuad(p.half, p.e), p.at);
    blocks.lit.add(geo, p.bone, `${p.wear}/${p.role}`);
    blocks.outline.add(shellOf(geo, SHELL), p.bone, 'ink');
  }

  const {
    nv, ni, position, normal, index, groups, srcOf, roleOf, alphaOf,
  } = flatten(blocks);

  /* ── one colour block per colourway ──
     The animal's own paint, copied byte for byte, and the costume's
     from the table. A costume is the same colour on every coat, which
     is the point of it being a costume and not a marking. */
  const paint = new Map(pieces.map((p) => [`${p.wear}/${p.role}`, p.paint]));
  paint.set('ink', INK);
  const colors = new Map();
  for (const skin of src.skins) {
    const from = data.colors.get(skin);
    if (!from) continue;
    const out = new Uint8Array(nv * 4);
    for (let v = 0; v < nv; v++) {
      const rgb = roleOf[v] ? paint.get(roleOf[v]) : null;
      if (rgb) {
        out[v * 4] = rgb[0]; out[v * 4 + 1] = rgb[1]; out[v * 4 + 2] = rgb[2];
      } else {
        const o = srcOf[v] * 4;
        out[v * 4] = from[o]; out[v * 4 + 1] = from[o + 1]; out[v * 4 + 2] = from[o + 2];
      }
      out[v * 4 + 3] = alphaOf[v];
    }
    colors.set(skin, out);
  }

  /* ── the skeleton ──
     The animal's own, untouched, plus one child of `head` per piece.
     Position and rotation are zero and the offset is the identity, so
     a piece's bone IS the head's frame and the table above is read in
     head space. */
  const dressed = src.bones.map((b) => ({
    name: b.name,
    parent: b.parent,
    order: b.order,
    position: b.position.slice(),
    rotation: b.rotation.slice(),
    scale: b.scale.slice(),
    offset: Array.from(b.offset),
    userData: b.userData ? { ...b.userData } : null,
  }));
  for (const p of pieces) {
    dressed.push({
      name: p.boneName,
      parent: HEAD,
      order: 'XYZ',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      offset: identity,
      userData: null,
    });
  }

  const header = {
    vertexCount: nv,
    indexCount: ni,
    indexBits: nv > 65535 ? 32 : 16,
    skins: src.skins.slice(),
    groups,
    bones: dressed,
    /* The animal's own, and it has to be: the costumes are worn on top
       of it and none of them is what the camera sizes the animal by.
       Measuring these again with a hat on would draw the animal
       smaller for having put a hat on. */
    bounds: src.bounds,
  };

  const model = {
    ...base,
    parts: [
      ...base.parts,
      ...pieces.map((p) => ({ bone: p.boneName, radius: p.radius, scale: 1 })),
    ],
    ride: base.ride,
    /** costume → the bones it is made of. What `CatLayer.wear` reads. */
    wear: Object.fromEntries(worn),
  };

  return { header, position, normal, colors, index, model };
}
