/* ── src/cat/dog.js ──────────────────────────────────────────────────
   A dog, built out of the cat.

   There is no dog.bin and there is not going to be one. The cat is a
   23-bone rig, a gait, a spring tail, a three-tone cel shader and a
   screen-space bend that turns every part into a rounded rectangle —
   and every one of those is about an ANIMAL, not about a cat. What
   makes the cat a cat is a handful of shapes hanging off that rig. So
   this file takes the parsed `cat.bin` and hands back a parsed asset of
   the same shape, with those shapes changed:

     · a MUZZLE, which is the whole difference at a glance. A cat's
       face is flat against the front of a round head; a dog's sticks
       out. It is a new bone and a new rectangle — an ellipsoid that the
       same bend squares off, exactly like the head and the body, so it
       shades and inks like the rest of the animal instead of being
       pasted on.
     · a NOSE at the end of it, built to the cat's own three
       measurements and painted the cat's own nose colour. It lives in
       the `unlit` group, which is the group the bend leaves alone, so
       it is built as a rounded BOX rather than as a capsule: nothing is
       going to square it off later. There is no mouth: at the size this
       animal is drawn the snout and the nose carry the face on their
       own, and a second mark under them read as a strap.
     · a SHORT TAIL — the cat's own seventeen-node spring tube, kept
       whole and made short and thick instead of replaced. It was a
       generated rigid nub once, and a rigid nub is exactly what a tail
       must not be: what makes the cat's tail read is that it lags,
       overshoots and settles. See the note above TAIL for how the
       spring survives being shrunk.
     · WIDER EARS, in two variants. The PRICKED one is the cat's cone,
       widened where it shows, and it stays a cone: what an upright ear
       does is come to a point. The DROPPED one cannot be that cone —
       a cone rolled over is a spike pointing down — so that variant
       replaces the mesh with a long flat FLAP. Both hang off the same
       bone and both ride the head unbent, so each keeps the shape it
       was given.
     · and no WHISKERS, which is the one thing removed rather than
       changed.
     · THREE COATS, each recoloured off whichever of the cat's own
       skins is already arranged the way that coat needs.

   ── what is NOT changed ───────────────────────────────────────────
   The rig, the gait, the poses, the turn, the shader, the bend, the
   ink, the three tones. A dog runs on the cat's four legs at the cat's
   cadence, and that is not laziness: the gait in `pose.js` is a
   diagonal-pair trot with a two-bob stride, which is what a dog does
   too.

   ── how the vertices are put together ─────────────────────────────
   `cat.bin`'s three groups own DISJOINT vertex ranges — lit, then
   unlit, then outline — and two things downstream depend on it: the
   shader tells lit from unlit by comparing `gl_VertexID` against the
   first unlit vertex, and `lit`/`unlit` share one draw call because
   they are adjacent in the index buffer. New geometry cannot simply be
   appended, then, because a lit muzzle vertex at the end of the buffer
   would sit above that boundary and be shaded as if it were an eye.

   So the buffers are rebuilt rather than extended: each group is walked
   in turn, its surviving vertices are copied in the order they are
   first referenced, the new geometry for that group is appended right
   after them, and the indices are renumbered as they go. Three blocks,
   still disjoint, still in the same order, and the dropped whiskers and
   tail simply never get copied.
   ------------------------------------------------------------------ */

import { Rig } from './rig.js';
import { SHAPE_PARTS, SHAPE_RIDE } from './shape.js';
import { Driver, applyPose, TAIL_AXIS } from './pose.js';

/** The dog's colourways. The name is the coat. */
export const DOG_SKINS = ['yellow', 'grey', 'cow'];
/** The two ear variants. Same mesh, different resting angle. */
export const DOG_EARS = ['prick', 'drop'];

/* ── the coats ────────────────────────────────────────────────────
   A colourway is not a palette applied to the dog. It is a palette
   applied to one of the CAT's, because what the dog needs from cat.bin
   is not colour but the arrangement of it: which triangles are back and
   which are belly, where the socks stop, which patch is a patch. That
   arrangement is different in each of the cat's three skins, and the
   right source is a different one depending on what is being painted.

     TABBY is a base tone over the head, hips, ears and back, a light
     tone on the belly and all four paws, and a dark tone as stripes
     over the top. Recoloured, that is an animal with a coloured back
     and a pale underside and some shape to the shading — which is what
     `yellow` and `grey` want, and `grey` most of all, since "grey on
     top, white underneath" is exactly the tabby's own division.

     CALICO is a white ground with big irregular patches of two darker
     tones over the head, the back, the tail and one hip, one ear dark
     and the other not. Paint the ground white and both patch tones
     black and that is a cow, patches and asymmetry included. No amount
     of recolouring gets it out of the tabby, whose dark tone is
     stripes: what comes out of that is a tiger.

   So each coat names its source, and the three keys below say which of
   that source's colours is which. Everything not named — the ink, the
   pupil, the eye's white sparkle — is not the coat and is left alone.

   `dark` is OPTIONAL, and leaving it out is how a coat says it has no
   markings: the source's dark tone is then painted as the base and
   disappears into it. The tabby-sourced coats all leave it out, because
   the tabby's dark tone is STRIPES — over the spine, the skull and most
   of the tail — and a dog of one colour does not wear them. The calico
   keeps its own, because there the dark tone is a patch and the patches
   are the whole point.

   `ear`, `muzzle` and `nose` are the parts this file builds rather than
   recolours, so they are chosen outright. */
const SOURCE_KEYS = {
  tabby: { base: '176,138,94', light: '228,213,184', dark: '107,82,54', nose: '162,112,92' },
  calico: { base: '239,159,87', light: '248,243,236', dark: '58,50,47', nose: '217,144,140' },
};

const DOG_COATS = {
  /* Yellow all over rather than yellow over cream: the light tone is a
     paler YELLOW, so the underside still lifts and the dog still reads
     as one colour. No `dark`, so the tabby's stripes go.

     The whole family has moved onto what used to be the EAR's tone —
     warmer, and a good deal less saturated than the coat it came off.
     The other four are rebuilt around it rather than picked again, by
     taking the intervals the old palette had (light was +0.13 in
     lightness at 1.10× the saturation, the nose +0.11 at 0.91×) and
     applying them to the new base. That is what keeps five tones one
     dog; choosing each of them by eye is how a coat ends up with a
     muzzle that belongs to a different animal.

     The ear then steps down again by the same interval it always had,
     because it cannot simply BE the base: the dropped variant is a flap
     lying over the skull, and one line between two areas of identical
     coat reads as a crease. It is the one tone that has to stay apart
     from the rest. */
  yellow: {
    from: 'tabby',
    base: [190, 125, 65],
    // The belly and all four socks are the base as well: yellow all
    // over, with nothing pale under it.
    light: [190, 125, 65],
    ear: [142, 99, 66],
    /* The snout is the one thing still lifted, and it has to be: it
       shares its outline with the skull now (see MUZZLE_INK_SINK), so
       there is no line between them and nothing but tone left to say
       where the head stops. A paler yellow, not a white. */
    muzzle: [211, 162, 110],
    nose: [52, 50, 53],
  },
  /* Grey on top, white underneath, which is the tabby's own division
     with the two tones swapped for a colour and a non-colour. No
     `dark`, so the tabby's stripes go.

     The grey tones have been taken toward black twice now, 20% and
     then another 30%, which leaves them at a little over half what they
     started at. The three of them and not the white: it is the GREY
     that was too light, and the white underside is the thing it is read
     against. */
  grey: {
    from: 'tabby',
    base: [84, 85, 88],
    light: [243, 243, 241],
    ear: [67, 69, 72],
    muzzle: [243, 243, 241],
    nose: [52, 50, 53],
  },
  /* Black and white, off the calico's patches. This one DOES keep a
     `dark`: both of the calico's darker tones are patches, not markings
     over a coat, so both go to black. */
  cow: {
    from: 'calico',
    base: [52, 48, 48],
    light: [246, 246, 244],
    dark: [40, 37, 37],
    ear: [46, 43, 43],
    muzzle: [246, 246, 244],
    nose: [58, 52, 50],
  },
};

const INK = [43, 35, 32];

/* The ears get their own, deeper tone, and it is not decoration — it is
   the only thing that makes a DROPPED ear legible. A dropped ear hangs
   over the side of the skull, and in a side-on view "over the skull" is
   the whole of it: the flap never reaches past the head's outline, so
   its shape is carried entirely by the ink line around it. One line
   between two areas of the identical coat reads as a crease in the
   head, not as an ear. Two tones and it reads as an ear at a glance.

   It costs the pricked variant nothing and arguably suits it: darker
   ears are what most dogs of one colour actually have.

   Inside and out, and that is the other half of it. The cat's ear is
   two-toned, a pink lining inside a coat-coloured cone, and a flop past
   a right angle turns the lining to face the camera — so a dropped ear
   painted the cat's way is a pale wedge lying across the head, which is
   what it looked like. One tone all over and the flap is the same ear
   whichever way it has fallen. */

/* ── the muzzle ───────────────────────────────────────────────────
   In the HEAD bone's own space, where the head's geometry runs y 0…2.24
   and z −1.12…1.34 and the ball of the skull is centred near
   (0, 1.12, 0.10).

   The centre is low and forward so that the back half of the muzzle is
   buried in the skull and the front half is not: the head's rectangle
   reaches z = 1.28 in head space, and the muzzle reaches 1.93, so about
   two thirds of a unit — seven pixels at the game's boxH = 40 — sticks
   out past the face. It sits just under the eyes (which are at head-y
   1.24 with a half-height of 0.21) rather than across them.

   `radius` is the corner rounding as a fraction of the SHORT half-side,
   the same convention the rest of the part table uses. 0.36 on a
   rectangle drawn 1.12 × 0.60 is a snout with corners, not a capsule. */
/* How far the muzzle's ink is pushed back, in model units.

   Without it the snout gets an ink ring of its own, and the part of
   that ring lying over the head is drawn — the muzzle really is nearer
   than the cheek behind it — so the face comes out as a box stuck on a
   head with a line between them. Sinking the ring past the head's own
   depth hands those pixels to the head's fill and leaves the ring
   standing only where there is no head, which is one outline around the
   two of them. See uInkSink in cat.js.

   1.5 rather than something smaller: head-on, where the snout is
   furthest in front of the face, the gap to beat is about two thirds of
   a unit, and the muzzle's own depth swings by another half through the
   turn. Rather than something larger, because this is added to a depth
   that is divided by DEPTH_HALF = 4 and has to stay inside the clip
   range: the muzzle reaches 2.05 of that 4 on its own. */
const MUZZLE_INK_SINK = 1.5;

const MUZZLE = {
  at: [0, 0.75, 1.37],
  half: [0.50, 0.40, 0.36],
  radius: 0.36,
};

/* ── the nose: the cat's, to the number ───────────────────────────
   `half` is not chosen. It is the cat's own nose measured off cat.bin —
   0.312 wide, 0.192 tall, 0.168 deep — and the colour is the cat's nose
   colour put through the same recolouring as the coat. What is chosen
   is where it goes, and that it is BUILT rather than moved.

   Built, because the cat's nose is not a separate object: it is a
   raised, differently-painted patch of the skull's own skin, 352
   triangles with 84 border edges. Lift those out and the head has a
   hole in the front of it. So the patch stays where it is and is
   painted back into the coat — a bump nobody can see — and the dog gets
   the same shape again at the end of its snout.

   In `unlit`, which is where every other feature of this face lives.
   That costs the shading on a nose drawn about three pixels across and
   buys the one thing that matters at the end of a snout: the unlit
   group is lifted FACE_LIFT toward the camera, so the nose is in front
   of the muzzle's own skin instead of fighting it for the same depth.

   `at` is its centre as a FRACTION of the muzzle's own half-extents,
   not as a distance, and that is the whole reason it is written this
   way: the snout is a shape somebody will want to tune, and a nose
   pinned to absolute coordinates falls off the end of it the first time
   the snout gets shorter. In fractions it stays where it was put.

   It still has to land inside the muzzle's rounded rectangle — against
   the CORNER ARC and not just the sides, since nothing clips it — and
   that is checked at build time rather than left to be noticed.

   `e` is the superquadric exponent: 1 is an ellipsoid, and 0.55 is the
   softly rounded lump a nose is. */
const NOSE = {
  at: [0, 0.30, 0.72],
  half: [0.156, 0.096, 0.084],
  e: 0.55,
};


/* ── the short tail, and how it keeps the spring ──────────────────
   Asked for in the two numbers that describe a tail — how long, how
   thick — and both are in WORLD units, the same units the rest of this
   file is written in.

   Neither of them is applied where you would expect, and the reason is
   the spring. `pose.js` integrates a seventeen-stage chain and hands
   the shader one quaternion per node; the shader turns each ring of the
   tube about `TAIL_AXIS[node]`, a compile-time constant shared by the
   cat. Move the geometry off that line and every ring is turned about a
   pivot that is no longer inside it — the tail does not shorten, it
   comes apart. So the chain, the axis and the geometry are left exactly
   as the cat has them, and the two numbers are applied on either side
   of them instead:

     LENGTH is a uniform scale on the tail BONE, applied after the sway
     has already happened in the cat's own space. The chain runs at full
     size against its own pivots, and what comes out is scaled down as
     one piece — the whole spring, lag and overshoot included, just
     smaller. A scale is not a channel `applyPose` writes, so nothing
     fights it.

     THICKNESS is a radial fattening of the mesh, done here, before
     anything: each vertex is pushed away from the centreline it belongs
     to, along the perpendicular only. That leaves the vertex on the
     same side of the same pivot at the same place along the tail, so
     the sway does not notice, and it is what stops "short" from also
     meaning "thin" — a uniform scale alone would have taken the cat's
     0.23 radius down with the length and left a piece of string. The
     same push, varied along the tail, is also what tapers it into a
     cone; see `tip` below.

   The length is not the length that shows, either. The bone sits at
   world (0, −0.70, −0.70), inside the rump, and the body's rectangle
   reaches back to z = −1.21, so roughly the first half of the tail is
   buried and hidden by the body — which is what a tail root should be.

   And it is NOT in the part table. A tube of constant radius already
   has a constant-width silhouette at every angle, which is the
   rounded-rectangle answer for a tail; the cat leaves its own tail out
   of the bend for exactly this reason, and the squared-off tip comes
   from `TAIL_CAP_GLSL` either way. */
const TAIL = {
  len: 1.55,
  /* Square in section, one width from root to tip.

     Round was the cat's, and on the cat it is deliberate: a tube of
     constant RADIUS already has a constant-width silhouette at every
     angle, which is the rounded-rectangle answer for a tail, so the cat
     leaves its own tail out of the bend. That reasoning gives a
     silhouette and stops there — it says nothing about the surface, and
     the surface is where this animal's three tones live. A square
     section has flat faces, and flat faces take one tone each, which is
     what every other part of the dog does.

     So the section is remapped here, ring by ring, from a circle to a
     rounded square: the same rounded-rectangle construction the rest of
     the model is drawn with, applied across the tail instead of across
     the screen. `width` is the half-side and `corner` is the rounding
     as a fraction of it — 0.5 would be back to a circle.

     Constant along the length, and it has to be: it is what keeps the
     silhouette one width. The taper that was here made a cone of it. */
  width: 0.25,
  corner: 0.34,
};

/* ── the pricked ear ──────────────────────────────────────────────
   The cat's cone, widened in the ear's own space: x is across the head,
   z is front to back — and z is the one that shows, because the camera
   is side-on and the silhouette of an ear is its y-z outline. Widening
   x alone would be a broader ear nobody can see.

   A cone and not a rounded box, which everything else about this animal
   is. It was a box once and it came out as a tab: what an upright ear
   does at this size is come to a POINT, and the point is most of what
   the ear is for. The cat keeps its own ears out of the bend for the
   same reason, and this is the same exception rather than a new one.

   Baked into the geometry rather than set as a bone scale, because the
   shader turns normals with `mat3(bone)` and no inverse transpose, so a
   non-uniform bone scale would tilt the shading on one of the two parts
   that are left un-bent and are therefore read as a shape. */
const EAR_SCALE = [1.35, 1.15, 1.25];

/* ── the dropped ear ──────────────────────────────────────────────
   Its own mesh, and it has to be: a cone rolled past a right angle is
   still a cone, a spike pointing down. What reads as a drop ear is a
   long flat FLAP, so this variant throws the cone away and hangs a
   rounded box off the same bone instead.

   Half-extents in the ear bone's own space, and the shape is the whole
   point of the three numbers: x is across the head and is what makes it
   FLAT, y runs down the flap and is what makes it LONG, z is front to
   back and is the width the side-on camera actually sees. `radius` is
   the corner rounding, 1 being an ellipsoid and 0 a hard box.

   It is built hanging along −Y from the root rather than standing up
   and being rolled over, which leaves `base` meaning what it means on
   the pricked ear — how far the ear splays outward — instead of having
   to carry 155° of flop as well. The gait's flick then swings the flap
   sideways off its resting splay, which is what an ear does.

   Its length is measured against the skull rather than chosen: rooted
   at head-y 1.70 and
   hanging 1.36, the tip lands just below the head rectangle's bottom
   edge at world y 0.105, so the flap BREAKS the head's outline instead
   of living entirely inside it. That is worth a surprising amount —
   inside the outline an ear is carried only by its own ink line and its
   darker tone, and past the bottom edge it is carried by the silhouette
   like everything else. */
const DROP_EAR = { half: [0.09, 0.68, 0.30], radius: 0.35 };

/* Rest angles per variant, in the ear bone's YXZ channels, and where
   the ear is rooted in the head's own space. `base` is the roll that
   splays an ear outward from vertical, and it is the whole of the flop:
   `applyPose` writes `userData.base + flick`, so past a right angle the
   ear hangs instead of standing and the gait's flick still rides on top
   of it. Signs are mirrored between the two ears, which is what `base`
   was for.

   The DROP ear also moves, and it has to. Shape alone gives an ear that
   hangs where nobody can see it: the camera is side-on, so "beside the
   head" is along the DEPTH axis, and an ear pinned at |x| = 0.62 hangs
   inside a skull whose near surface is at 1.17. It is not hidden by the
   head's outline — it is behind the head's cheek. Rooting it at 1.12
   puts the whole flap in front of that surface, where its own ink line
   draws it against the cheek, which is how a drop ear is drawn in
   profile anyway. 1.32 rather than 1.19 — the skull's own widest — so
   that head-on it hangs clear of the head's rectangle instead of
   vanishing into its edge. From the front the same move reads as an ear hanging
   just past the side of the head, which is also what it should do.

   Rooted lower, too, and for a reason of the same kind: at head-y 2.00,
   where the pricked ears sit, the skull has narrowed to 0.80 and an ear
   1.12 out would be floating. At 1.50 the skull is 1.09 wide and the
   base of the ear still lands on it. */
const EAR_ROOT = [0.62, 2.00, -0.05];   // the cat's, in head space
const EARS = {
  prick: { at: EAR_ROOT, x: 0.262, y: -0.262, base: 0.34 },
  drop: { at: [1.07, 1.70, -0.08], x: 0.10, y: 0.2, base: -0.20 },
};

/** How far the ink shell stands off the skin, in model units. Measured
    off the cat: head 0.06, body 0.05, a paw 0.02. */
const SHELL = 0.05;

/** Rings and segments for a generated blob. Twenty and twenty-eight is
    about 1,100 triangles a part — a fortieth of what the cat already
    submits, so the count is not worth economising and a smooth
    silhouette is worth having. */
const RINGS = 20, SEGS = 28;

/* ═══ the generated shapes ════════════════════════════════════════ */

/**
 * A superquadric: an ellipsoid at e = 1, a rounded box as e falls.
 *
 * The normal has a closed form — the same expression with the exponent
 * reflected to 2 − e — so the muzzle arrives with exact normals rather
 * than averaged face normals, which matters because the three-tone
 * shading reads them directly and a seam in the normals is a seam in
 * the tone.
 *
 * @param {number[]} half  half-extents
 * @param {number} e       1 = ellipsoid, → 0 = box
 */
function superQuad(half, e) {
  const c = (t, k) => Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), k);
  const s = (t, k) => Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), k);
  const k = 2 - e;
  const position = [], normal = [], index = [];

  for (let i = 0; i <= RINGS; i++) {
    const eta = -Math.PI / 2 + (i / RINGS) * Math.PI;
    for (let j = 0; j <= SEGS; j++) {
      const om = -Math.PI + (j / SEGS) * Math.PI * 2;
      position.push(half[0] * c(eta, e) * c(om, e), half[1] * s(eta, e), half[2] * c(eta, e) * s(om, e));
      const n = [
        c(eta, k) * c(om, k) / half[0],
        s(eta, k) / half[1],
        c(eta, k) * s(om, k) / half[2],
      ];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      normal.push(n[0] / l, n[1] / l, n[2] / l);
    }
  }
  const row = SEGS + 1;
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGS; j++) {
      const a = i * row + j, b = a + 1, d = a + row, f = d + 1;
      index.push(a, d, b, b, d, f);
    }
  }
  return orientOutward({ position, normal, index });
}

/**
 * Make a generated mesh wind the way the asset's own does.
 *
 * Both `lit` and `outline` in cat.bin are wound OUTWARD — the shells
 * are the same solid, only bigger, which is why the ink pass culls
 * front faces rather than back ones. A generated blob that came out the
 * other way would be invisible in the fill pass and a solid blot in the
 * ink pass, so the winding is measured rather than trusted: sum the
 * signed volume, and flip every triangle if it came out negative.
 */
function orientOutward(geo) {
  const { position, index } = geo;
  let vol = 0;
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const ax = position[a], ay = position[a + 1], az = position[a + 2];
    const bx = position[b], by = position[b + 1], bz = position[b + 2];
    const cx = position[c], cy = position[c + 1], cz = position[c + 2];
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol < 0) {
    for (let i = 0; i < index.length; i += 3) {
      const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t;
    }
  }
  return geo;
}

/**
 * How far it is from the centre of a rounded rectangle to its edge
 * along one direction. shape.js's `rrRadius`, in JS, and the only
 * reason it is here too is that nothing clips a face feature to the
 * snout it is drawn on — this is what says whether it fits.
 */
function rrRadius(d, h, r) {
  const a = [Math.abs(d[0]), Math.abs(d[1])];
  const e = [Math.max(h[0] - r, 0), Math.max(h[1] - r, 0)];
  if (h[0] * a[1] <= e[1] * a[0]) return h[0] / Math.max(a[0], 1e-6);
  if (h[1] * a[0] <= e[0] * a[1]) return h[1] / Math.max(a[1], 1e-6);
  const K = a[0] * e[0] + a[1] * e[1];
  return K + Math.sqrt(Math.max(0, K * K - (e[0] * e[0] + e[1] * e[1] - r * r)));
}

/**
 * The outward normal of that same rounded rectangle, at the point the
 * ray leaves it. A rounded rectangle is a box grown by a disc, so the
 * normal is the direction from the nearest point of the INNER box —
 * constant along each flat side and turning only around the corners,
 * which is what makes a squared-off tail shade as flat faces.
 */
function rrNormal(dir, h, r) {
  const R = rrRadius(dir, h, r);
  const q = [dir[0] * R, dir[1] * R];
  const e = [Math.max(h[0] - r, 0), Math.max(h[1] - r, 0)];
  const d = [
    q[0] - Math.max(-e[0], Math.min(e[0], q[0])),
    q[1] - Math.max(-e[1], Math.min(e[1], q[1])),
  ];
  const l = Math.hypot(d[0], d[1]);
  return l > 1e-6 ? [d[0] / l, d[1] / l] : dir;
}

/**
 * Throw unless a box of half-extents `half` centred at `at` fits inside
 * the muzzle's rounded rectangle, corner arc included.
 *
 * Both views are tested, because the rectangle is drawn in a different
 * pair of axes depending on which way the animal is facing: (z, y)
 * side-on, (x, y) head-on. A feature that fits one and not the other is
 * a feature that pokes through the ink halfway round the turn.
 */
function fitsMuzzle(what, at, half) {
  const H = MUZZLE.half;
  for (const [u, v] of [[2, 1], [0, 1]]) {
    const h = [H[u], H[v]];
    const r = Math.min(h[0], h[1]) * MUZZLE.radius;
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        const q = [at[u] + su * half[u], at[v] + sv * half[v]];
        const len = Math.hypot(q[0], q[1]);
        if (len < 1e-6) continue;
        if (len > rrRadius([q[0] / len, q[1] / len], h, r) + 1e-4) {
          throw new Error(`dog: the ${what} sticks out of the muzzle's rectangle`
            + ` at (${q[0].toFixed(3)}, ${q[1].toFixed(3)}) — move it in, or grow MUZZLE.half`);
        }
      }
    }
  }
}


/** The same solid, grown along its own normals: an ink shell. */
function shellOf(geo, grow) {
  const position = geo.position.slice();
  for (let i = 0; i < position.length; i++) position[i] += geo.normal[i] * grow;
  return { position, normal: geo.normal.slice(), index: geo.index.slice() };
}

/** Move a generated mesh to where it belongs in its bone's space. */
function placed(geo, at) {
  const position = geo.position.slice();
  for (let i = 0; i < position.length; i += 3) {
    position[i] += at[0]; position[i + 1] += at[1]; position[i + 2] += at[2];
  }
  return { position, normal: geo.normal, index: geo.index };
}

/* ═══ the block builder ═══════════════════════════════════════════ */

/**
 * One of the three vertex blocks — lit, unlit, outline — while it is
 * being filled. Vertices arrive either copied from the cat (`take`) or
 * generated (`add`), and either way the block hands back the new index
 * for each one.
 */
class Block {
  constructor() {
    this.position = [];
    this.normal = [];      // xyz + outerness, snorm16
    this.alpha = [];       // the packed bone | sway byte, one per vertex
    /** Per vertex: the cat vertex it was copied from, or −1. */
    this.src = [];
    /** Per vertex: which built part it belongs to, or null if copied. */
    this.role = [];
    this.index = [];
    this._map = new Map(); // old vertex → new vertex
  }

  get count() { return this.position.length / 3; }

  take(cat, col, v) {
    let n = this._map.get(v);
    if (n !== undefined) return n;
    n = this.count;
    this._map.set(v, n);
    this.position.push(cat.position[v * 3], cat.position[v * 3 + 1], cat.position[v * 3 + 2]);
    for (let k = 0; k < 4; k++) this.normal.push(cat.normal[v * 4 + k]);
    this.alpha.push(col[v * 4 + 3]);
    this.src.push(v);
    this.role.push(null);
    return n;
  }

  /** @param {object} geo @param {number} bone @param {string} role */
  add(geo, bone, role) {
    const base = this.count;
    const n = geo.position.length / 3;
    for (let i = 0; i < n; i++) {
      this.position.push(geo.position[i * 3], geo.position[i * 3 + 1], geo.position[i * 3 + 2]);
      for (let k = 0; k < 3; k++) {
        this.normal.push(Math.max(-32767, Math.min(32767, Math.round(geo.normal[i * 3 + k] * 32767))));
      }
      // Outerness is what the sway chain reads to know how far along a
      // tail a vertex is, and nothing generated here sways.
      this.normal.push(0);
      this.alpha.push(bone);
      this.src.push(-1);
      this.role.push(role);
    }
    for (const i of geo.index) this.index.push(base + i);
  }
}


/* ═══ the build ═══════════════════════════════════════════════════ */

/** …drawn at this many collision-box heights, as the cat's 1.10 is. */
const DOG_HEIGHT_IN_BOXH = 1.10;

/** The pricked dog's rest bounds, which size every variant. See below. */
let PRICK_BOUNDS = null;

/* The cat's parts, unchanged, plus the one the dog has of its own. The
   tail is deliberately absent, as the cat's is: see TAIL. */
const DOG_PARTS = [
  ...SHAPE_PARTS,
  { bone: 'muzzle', radius: MUZZLE.radius, scale: 1 },
];

/**
 * Build a dog from a parsed `cat.bin`.
 *
 * The result is the same shape a parsed asset is — `{header, position,
 * normal, colors, index}` — plus a `model` that tells `CatLayer` which
 * animal it is holding. Nothing about the cat's own data is modified;
 * every array here is new.
 *
 * @param {object} cat        the object `parseCat` returned
 * @param {object} [opts]     `{ ear: 'prick' | 'drop' }`
 */
export function buildDog(cat, opts = {}) {
  const ear = DOG_EARS.includes(opts.ear) ? opts.ear : DOG_EARS[0];
  const src = cat.header;
  /* Any skin will do to read the geometry by: the bone and the sway
     group live in the alpha byte and every colourway of cat.bin carries
     the same one. What each coat is PAINTED from is its own source, and
     that is resolved at the end, once per skin. */
  for (const need of new Set(Object.values(DOG_COATS).map((c) => c.from))) {
    if (!cat.colors.get(need)) throw new Error(`dog: cat.bin has no "${need}" skin to paint from`);
  }
  const col = cat.colors.get(Object.values(DOG_COATS)[0].from);

  const bones = src.bones.map((b) => b.name);
  const boneOf = (n) => {
    const i = bones.indexOf(n);
    if (i < 0) throw new Error(`dog: cat.bin has no bone "${n}"`);
    return i;
  };
  const HEAD = boneOf('head'), TAIL_BONE = boneOf('tail');
  const EAR_L = boneOf('earL'), EAR_R = boneOf('earR');
  const MUZZLE_BONE = src.bones.length;
  /* Bones whose cat geometry this dog does not keep. The dropped-ear
     variant throws away the cone as well, and grows a flap instead. */
  const cut = new Set(bones.map((n, i) => (n.startsWith('whisker') ? i : -1)).filter((i) => i >= 0));
  if (ear === 'drop') { cut.add(EAR_L); cut.add(EAR_R); }

  /* The cat's MOUTH — the small "⌣" under its nose — is the one piece
     of the face that cannot be named by a bone: it hangs off `head`,
     like the skull does. What separates it is the GROUP: inside
     `unlit`, the head bone is that mark and nothing else. The dog draws
     its own, so this one goes. */
  const isCatMouth = (v, group) => group === 'unlit' && (col[v * 4 + 3] & 31) === HEAD;

  const g = (n) => {
    const x = src.groups.find((q) => q.name === n);
    if (!x) throw new Error(`dog: cat.bin has no "${n}" group`);
    return x;
  };
  const gLit = g('lit'), gUnlit = g('unlit'), gOut = g('outline');



  /* How fat the tail has to be MADE, so that the bone scale that
     shortens it leaves it the thickness that was asked for. Both halves
     are measured rather than assumed: the arc off the chain's own
     centreline, and the radius off the mesh, from the one extent of a
     tube that is a diameter and not a length. */
  const tailArc = (() => {
    let L = 0;
    for (let i = 1; i < TAIL_AXIS.length; i++) {
      L += Math.hypot(TAIL_AXIS[i][0] - TAIL_AXIS[i - 1][0],
        TAIL_AXIS[i][1] - TAIL_AXIS[i - 1][1], TAIL_AXIS[i][2] - TAIL_AXIS[i - 1][2]);
    }
    return L;
  })();
  const tailRadius = (() => {
    let lo = 1e30, hi = -1e30;
    const seen = new Set();
    for (let i = gLit.start; i < gLit.start + gLit.count; i++) {
      const v = cat.index[i];
      if (seen.has(v) || (col[v * 4 + 3] & 31) !== TAIL_BONE) continue;
      seen.add(v);
      const x = cat.position[v * 3];
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    return (hi - lo) / 2;
  })();
  const tailScale = TAIL.len / tailArc;
  /* The half-side wanted in the FINISHED animal, put back into the
     tail's own space, where the bone scale has not happened yet. */
  const tailHalf = [TAIL.width / tailScale, TAIL.width / tailScale];
  const tailCorner = (TAIL.width / tailScale) * TAIL.corner;

  /* Two per-vertex reshapes, both cached because a vertex is reached
     once per triangle that uses it.

     The ear is a plain scale in its own space; positions scale, normals
     scale by the INVERSE and are renormalised, which is what keeps a
     scaled surface lit as the shape it now is rather than as the shape
     it was.

     The tail is remapped, and only across the centreline: the vertex's
     place ALONG the tail and the pivot it belongs to have to come out
     untouched or the spring chain turns it about a point that is no
     longer inside it. So the offset from the centreline is split into
     the part along the local tangent, which is kept, and the part
     across it, which is put back on a rounded SQUARE at the same
     fraction of the way out. The normal is split the same way, and its
     across-part is replaced by the square's own outward normal — which
     is the whole point, since a flat face still lit like a tube is not
     a flat face.

     The square's two axes are the animal's own +X, which no bend of
     this chain can tilt away from the perpendicular, and whatever
     completes the frame. Both are built from the tangent, so they turn
     with the sway and the tail keeps its corners wherever it swings. */
  const reshaped = new Map();
  const reshape = (v, bone) => {
    let w = reshaped.get(v);
    if (w) return w;
    const p = [0, 1, 2].map((k) => cat.position[v * 3 + k]);
    const n = [0, 1, 2].map((k) => cat.normal[v * 4 + k] / 32767);

    if (bone === EAR_L || bone === EAR_R) {
      for (let k = 0; k < 3; k++) { p[k] *= EAR_SCALE[k]; n[k] /= EAR_SCALE[k]; }
    } else if (bone === TAIL_BONE) {
      const N = TAIL_AXIS.length;
      const x = Math.min(1, Math.max(0, cat.normal[v * 4 + 3] / 32767)) * (N - 1);
      const lo = Math.min(Math.floor(x), N - 1);
      const hi = Math.min(lo + 1, N - 1);
      const t = x - Math.floor(x);
      const a = TAIL_AXIS[lo], b = TAIL_AXIS[hi];
      // At the last node there is no segment ahead; take the one behind.
      const s0 = lo === hi ? TAIL_AXIS[N - 2] : a, s1 = lo === hi ? TAIL_AXIS[N - 1] : b;
      const tan = [s1[0] - s0[0], s1[1] - s0[1], s1[2] - s0[2]];
      const tl = Math.hypot(tan[0], tan[1], tan[2]) || 1;
      for (let k = 0; k < 3; k++) tan[k] /= tl;
      // The frame across the tail: the animal's +X, squared up against
      // the tangent, and the one direction left over.
      const uAx = [1 - tan[0] * tan[0], -tan[0] * tan[1], -tan[0] * tan[2]];
      const ul = Math.hypot(uAx[0], uAx[1], uAx[2]) || 1;
      for (let k = 0; k < 3; k++) uAx[k] /= ul;
      const wAx = [
        tan[1] * uAx[2] - tan[2] * uAx[1],
        tan[2] * uAx[0] - tan[0] * uAx[2],
        tan[0] * uAx[1] - tan[1] * uAx[0],
      ];

      const c = [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);
      const off = [0, 1, 2].map((k) => p[k] - c[k]);
      const along = off[0] * tan[0] + off[1] * tan[1] + off[2] * tan[2];
      const nAlong = n[0] * tan[0] + n[1] * tan[1] + n[2] * tan[2];
      const perp = [0, 1, 2].map((k) => off[k] - along * tan[k]);
      const pu = perp[0] * uAx[0] + perp[1] * uAx[1] + perp[2] * uAx[2];
      const pw = perp[0] * wAx[0] + perp[1] * wAx[1] + perp[2] * wAx[2];
      const rad = Math.hypot(pu, pw);
      if (rad < 1e-6) {
        // On the centreline: nothing across to remap.
        for (let k = 0; k < 3; k++) p[k] = c[k] + tan[k] * along;
      } else {
        const dir = [pu / rad, pw / rad];
        /* The same fraction of the way out, measured against the square
           instead of against the circle — which is exactly how the rest
           of the model is squared off, and is why the tip's hemisphere
           comes through as a rounded lump rather than as a spike. */
        const reach = (rad / tailRadius) * rrRadius(dir, tailHalf, tailCorner);
        const nn = rrNormal(dir, tailHalf, tailCorner);
        for (let k = 0; k < 3; k++) {
          p[k] = c[k] + tan[k] * along + (uAx[k] * dir[0] + wAx[k] * dir[1]) * reach;
          n[k] = tan[k] * nAlong + uAx[k] * nn[0] + wAx[k] * nn[1];
        }
      }
    } else {
      return null;
    }

    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    w = { p, n: n.map((q) => Math.max(-32767, Math.min(32767, Math.round((q / l) * 32767)))) };
    reshaped.set(v, w);
    return w;
  };

  const blocks = { lit: new Block(), unlit: new Block(), outline: new Block() };

  /* Walk each group's triangles. Every triangle of this asset is rigid
     — one bone for all three corners — so the bone of its first vertex
     decides whether it survives, and that is asserted rather than
     assumed. */
  const copy = (grp, name) => {
    const block = blocks[name];
    for (let i = grp.start; i < grp.start + grp.count; i += 3) {
      const v0 = cat.index[i];
      const b = col[v0 * 4 + 3] & 31;
      if (cut.has(b) || isCatMouth(v0, name)) continue;
      for (let k = 0; k < 3; k++) {
        const v = cat.index[i + k];
        if ((col[v * 4 + 3] & 31) !== b) throw new Error('dog: a triangle spans two bones');
        const at = block.take(cat, col, v);
        const w = reshape(v, b);
        if (w) {
          for (let k = 0; k < 3; k++) {
            block.position[at * 3 + k] = w.p[k];
            block.normal[at * 4 + k] = w.n[k];
          }
        }
        block.index.push(at);
      }
    }
  };
  copy(gLit, 'lit');
  copy(gUnlit, 'unlit');
  copy(gOut, 'outline');

  /* ── and then the dog's own shapes ── */
  const muzzle = superQuad(MUZZLE.half, 1);
  blocks.lit.add(muzzle, MUZZLE_BONE, 'muzzle');
  blocks.outline.add(shellOf(muzzle, SHELL), MUZZLE_BONE, 'ink');
  /* Fractions of the snout become distances here, and are checked
     against the rectangle the snout is actually drawn as before they
     are used — a face feature that has slid outside it does not fail,
     it just quietly hangs off the ink, so it is worth an exception. */
  const onMuzzle = (frac) => [0, 1, 2].map((k) => frac[k] * MUZZLE.half[k]);
  const noseAt = onMuzzle(NOSE.at);
  fitsMuzzle('nose', noseAt, NOSE.half);
  blocks.unlit.add(placed(superQuad(NOSE.half, NOSE.e), noseAt), MUZZLE_BONE, 'nose');
  /* The flap, hanging from the ear bone's origin down its own −Y. Built
     once and used for both ears, because the mirroring is on the BONE
     — the two ear bones face opposite ways already. */
  if (ear === 'drop') {
    const flap = placed(superQuad(DROP_EAR.half, DROP_EAR.radius), [0, -DROP_EAR.half[1], 0]);
    for (const b of [EAR_L, EAR_R]) {
      blocks.lit.add(flap, b, 'ear');
      blocks.outline.add(shellOf(flap, SHELL), b, 'ink');
    }
  }

  /* ── one buffer out of the three blocks ── */
  const order = [blocks.lit, blocks.unlit, blocks.outline];
  const nv = order.reduce((s, b) => s + b.count, 0);
  const ni = order.reduce((s, b) => s + b.index.length, 0);

  const position = new Float32Array(nv * 3);
  const normal = new Int16Array(nv * 4);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  /** Per vertex, flattened out of the blocks: where its colour comes
      from, and the alpha byte that carries its bone. */
  const srcOf = new Int32Array(nv);
  const roleOf = new Array(nv);
  const alphaOf = new Uint8Array(nv);

  const groups = [];
  let vAt = 0, iAt = 0;
  order.forEach((b, k) => {
    position.set(b.position, vAt * 3);
    normal.set(b.normal, vAt * 4);
    srcOf.set(b.src, vAt);
    alphaOf.set(b.alpha, vAt);
    for (let i = 0; i < b.count; i++) roleOf[vAt + i] = b.role[i];
    for (let i = 0; i < b.index.length; i++) index[iAt + i] = b.index[i] + vAt;
    groups.push({ name: ['lit', 'unlit', 'outline'][k], start: iAt, count: b.index.length });
    vAt += b.count;
    iAt += b.index.length;
  });

  /* ── and then one colour block per coat ──
     The geometry is shared; a colourway owns nothing but 4 bytes a
     vertex, which is exactly how cat.bin stores its three and why
     switching between them costs a VAO bind rather than an upload. */
  const colors = new Map();
  for (const skin of DOG_SKINS) {
    const coat = DOG_COATS[skin];
    const from = cat.colors.get(coat.from);
    const keys = SOURCE_KEYS[coat.from];
    const out = new Uint8Array(nv * 4);
    for (let v = 0; v < nv; v++) {
      const bone = alphaOf[v] & 31;
      let rgb;
      if (roleOf[v]) {
        rgb = roleOf[v] === 'ink' ? INK : coat[roleOf[v]];
      } else {
        const o = srcOf[v] * 4;
        const key = from[o] + ',' + from[o + 1] + ',' + from[o + 2];
        /* The cat's nose, painted out. Its geometry cannot leave the
           head — it is a patch of the skull's own skin, and lifting it
           would leave a hole — so what goes is the paint, and the dog's
           nose is built again at the end of the snout. See NOSE. */
        if (bone === EAR_L || bone === EAR_R) rgb = coat.ear;
        else if (bone === HEAD && key === keys.nose) rgb = coat.base;
        else if (key === keys.base) rgb = coat.base;
        else if (key === keys.light) rgb = coat.light;
        // No `dark` on the coat means no markings; see DOG_COATS.
        else if (key === keys.dark) rgb = coat.dark || coat.base;
        // Ink, pupil, the eye's white sparkle: not the coat, left alone.
        else rgb = [from[o], from[o + 1], from[o + 2]];
      }
      out[v * 4] = rgb[0];
      out[v * 4 + 1] = rgb[1];
      out[v * 4 + 2] = rgb[2];
      out[v * 4 + 3] = alphaOf[v];
    }
    colors.set(skin, out);
  }

  /* ── the skeleton ── */
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const skeleton = (which) => {
    const out = src.bones.map((b) => {
      const bone = {
        name: b.name,
        parent: b.parent,
        order: b.order,
        position: b.position.slice(),
        rotation: b.rotation.slice(),
        scale: b.scale.slice(),
        offset: Array.from(b.offset),
        userData: b.userData ? { ...b.userData } : null,
      };
      if (b.name === 'tail') bone.scale = [tailScale, tailScale, tailScale];
      if (b.name === 'earL' || b.name === 'earR') {
        // earL is the −x ear; the table is written for +x and mirrored.
        const side = b.name === 'earL' ? -1 : 1;
        const e = EARS[which];
        /* The rest position is what is left after the bone's own static
           offset, which for an ear is the 1.12 that lifts it to the top
           of the skull. */
        bone.position = [side * e.at[0], e.at[1] - b.offset[13], e.at[2]];
        bone.rotation = [e.x, side * e.y, -side * e.base];
        bone.userData = { base: -side * e.base };
      }
      return bone;
    });
    out.push({
      name: 'muzzle',
      parent: HEAD,
      order: 'XYZ',
      position: MUZZLE.at.slice(),
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      offset: identity,
      userData: null,
    });
    return out;
  };
  const dogBones = skeleton(ear);

  const header = {
    vertexCount: nv,
    indexCount: ni,
    indexBits: nv > 65535 ? 32 : 16,
    skins: DOG_SKINS.slice(),
    groups,
    bones: dogBones,
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  };

  const data = {
    header,
    position,
    normal,
    colors,
    index,
  };

  /* How big the animal is and where its middle is, measured off the
     standing pose rather than declared — the muzzle moved the middle
       forward by half a unit and the short tail moved the back edge
     forward by more, and a hand-written centre would be wrong the
     moment either of those numbers is touched. */
  /* Measured on the PRICKED dog whichever variant this is, so that the
     two are drawn at one scale: a dropped ear is a shorter animal, and
     sizing each variant to its own height would draw the same dog
     bigger for having put its ears down. The pricked build measures
     itself; the dropped one asks for a pricked build once and remembers
     the answer, since the geometry it is measuring never varies. */
  const box = ear === 'prick'
    ? (PRICK_BOUNDS = restBounds(data, dogBones))
    : (PRICK_BOUNDS || (PRICK_BOUNDS = buildDog(cat, { ear: 'prick' }).header.bounds));
  header.bounds = box;
  data.model = {
    skins: DOG_SKINS,
    parts: DOG_PARTS,
    ride: SHAPE_RIDE,
    restHeight: box.max[1] - box.min[1],
    heightInBoxH: DOG_HEIGHT_IN_BOXH,
    centerZ: (box.max[2] + box.min[2]) / 2,
    // The snout and the skull share one outline; see MUZZLE_INK_SINK.
    inkSink: { muzzle: MUZZLE_INK_SINK },
  };
  return data;
}

/**
 * The standing animal's world-space bounds: the rig at rest with the
 * neutral pose written onto it, which is the same pose `CatLayer`
 * measures the ground from.
 */
function restBounds(data, bones) {
  const rig = new Rig({ ...data.header, bones });
  rig.reset();
  applyPose(rig, new Driver().pose);
  const M = rig.update();
  const col = data.colors.get(DOG_SKINS[0]);
  const min = [1e30, 1e30, 1e30], max = [-1e30, -1e30, -1e30];
  for (let v = 0; v < data.header.vertexCount; v++) {
    const o = (col[v * 4 + 3] & 31) * 16;
    const x = data.position[v * 3], y = data.position[v * 3 + 1], z = data.position[v * 3 + 2];
    const w = [
      M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12],
      M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13],
      M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14],
    ];
    for (let k = 0; k < 3; k++) {
      if (w[k] < min[k]) min[k] = w[k];
      if (w[k] > max[k]) max[k] = w[k];
    }
  }
  return { min, max };
}
