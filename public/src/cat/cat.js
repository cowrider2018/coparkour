/* ── src/cat/cat.js ──────────────────────────────────────────────────
   The real 3D cat, drawn live, flattened into a cartoon by its shading
   and — since the body was restyled — by its geometry as well.

   "3D rendered to 2D" is not a sprite sheet here. The animation is
   genuinely three-dimensional and continuous: a 23-bone rig and a
   spring-chain tail integrated with the real frame dt, every frame, per
   character. The whole asset is still drawn — every triangle, every
   vertex colour, every normal — and the rectangles are made by BENDING
   it on the way to the screen. `shape.js` owns that bend and explains
   it; this file owns everything else and applies it in one place, at
   the end of the vertex shader, after the projection and after the
   normal has been written.

   That it is a bend and not a replacement is the whole design, and it
   is the second attempt. The first generated rectangles from the bone
   matrices and drew those instead, which meant inventing a normal for
   a surface that no longer existed and averaging each part to one
   colour. Both showed: the three tones came out identical on every
   part instead of 52/14/34 on a head and 28/40/32 on a paw, and the
   tabby lost its stripes. Bending keeps them because it keeps the
   vertices they live on.

   What the bend leaves alone is the ears — a triangle is what an ear
   is — and the face, which is the whole `unlit` group. The lighting is
   untouched by any of it:

     · the diffuse term is quantised into exactly three tones, with a
       boundary only as wide as `fwidth` says it must be to stop the
       terminator crawling. No gradient survives it.
     · the three tones are built from the day cycle's own `tint` and
       `ambient`, so the cat belongs to the hour without ever going
       smooth.
     · the `outline` group — an inverted hull, 44% of its triangles —
       is drawn in flat ink, and the bend sends it to a rectangle
       exactly one ink-width outside the fill's, which is a more even
       line than the grown hull managed on its own.

   `opts.style = 'mesh'` maps every bone to no part and leaves the cat
   exactly as it was, which is one branch to keep and settles any
   argument about what the stylisation actually changed.

   ── the constants, and where they come from ───────────────────────
   FORWARD AXIS is +Z, measured off the data rather than assumed. With
   the rest pose resolved to world space, the head bone's vertex
   centroid sits at z = +0.571 and the tail bone's at z = −1.221; the
   eyes are at z = +1.50 and the whiskers at z = +1.38, the furthest
   forward anything gets. Up is +Y (feet at y = −1.563, ear tips at
   y = +2.429). So the profile camera looks along +X with screen-right
   mapped to world +Z, and a cat at rest faces screen-right.

   FACING is a yaw the cat animates through, not a mirror: it turns to
   face the way it is asked, head first, in about 224 ms. The angle is
   measured from the camera so that showing the animal's back is not
   representable rather than merely avoided — see TURN_RATE, which is
   where the whole of it is written down.

   CULL MODE: the `outline` group is an inverted hull — the same shells,
   grown outward. It is drawn with FRONT-face culling, and the winding
   is the reason it has to be: summing the signed volume of each group
   off cat.bin gives +81.3 for `lit` and +93.4 for `outline`, so the
   shells are wound outward exactly like the body, and only bigger. Cull
   their front and what is left is the shell's far side, which the body
   hides everywhere except past its own silhouette. Cull their back —
   the usual way — and the shell simply covers the cat. `lit`/`unlit`
   use BACK. Both are constant at every angle of the turn: a yaw is a
   proper rotation and preserves winding, where the mirror this used to
   do for a left-facing cat reversed it and had to flip both.

   FIT (unchanged from the atlas version, so nothing else in the game
   has to move): the cat's rest height, feet to ear tips (3.9922 model
   units), is drawn at 1.10 × boxH. At the game's boxH = 40 a running
   cat comes to about 61 px wide and 45 tall in a 26 × 40 box — tail
   well past the left edge, nose past the right, an ear over the top,
   and the feet on the floor line. Which is what a cat does to a box meant for a
   person.

   ── two draw calls per cat, and why that is the floor ─────────────
   The three index groups turn out to use DISJOINT vertex ranges —
   lit [0, 11170), unlit [11170, 12825), outline [12825, 22405) — and
   `lit` and `unlit` are adjacent in the index buffer. So those two are
   issued as ONE call over the merged range and told apart inside the
   shader by `gl_VertexID` against the boundary, which is read off the
   file at load rather than hardcoded. The outline cannot join them: it
   needs the opposite cull face, and that is pipeline state.

   ── what this costs, honestly ─────────────────────────────────────
   39,328 triangles per cat, every frame, and there is no LOD. See
   `stats` and the note above `_drawOne` for why not, and for what is
   done instead (off-screen culling, depth-range slicing, skin batching).

   ── what the page has to give it ──────────────────────────────────
   Its own canvas, stacked ABOVE the Canvas2D game layer, which this
   module clears to (0,0,0,0) every frame so the platforms show
   through. Per frame:

       fx.begin(cam, { w: W / zoom, h: H / zoom }, sky);
       for (const g of ghosts) fx.cat(g.id, g.x, g.y, …, 0.58);
       fx.cat('self', player.x, player.y, …, 1);   // last = in front
       fx.end();

   `cam` and `view` are the same numbers the 2D layer uses, so the cat
   lands on the platform it is standing on — the camera is rounded here
   exactly as `render.js` rounds it before translating.
   ------------------------------------------------------------------ */

import { PHYS, PLAYER_W, PLAYER_H } from '../constants.js';
import { parseCat, Rig } from './rig.js';
import { Driver, Sway, applyPose, TAIL_AXIS, TAIL_LIFT } from './pose.js';
import {
  measureShapes, SHAPE_GLSL, TAIL_CAP_GLSL, SHAPE_PARTS, SHAPE_RIDE, FACE_LIFT,
} from './shape.js';
import { CAT_SKINS } from './looks.js';

/* Re-exported because every caller that draws a cat used to get the
   list from here. The list itself lives in looks.js now — see there for
   why it has to be at the bottom of the dependency graph. */
export { CAT_SKINS };

/* ── how big the cat is, and where its feet are ─────────────────── */

/** Rest pose feet-to-ear-tip. `bounds.max[1] - bounds.min[1]`. */
const MODEL_REST_HEIGHT = 3.9922;
/** …drawn at this many collision-box heights. See the header. */
const CAT_HEIGHT_IN_BOXH = 1.10;

/** Horizontal centre of the model, in world Z. The rest pose spans
    −1.93 (tail) … +1.85 (whiskers), so this is its middle, and it is
    this point that is put on the box's centre line. */
const CENTER_Z = -0.04;

/** Half-depth of the orthographic box, along the camera's own axis
    (model +X). The model spans about −1.35…+1.55, so this leaves room
    for the outline shell and for a pose that reaches. */
const DEPTH_HALF = 4.0;

/* ── what the layer needs to know about the animal it is drawing ──
   Everything above is a property of the CAT, and the cat is no longer
   the only thing this file draws: `dog.js` builds a second animal on
   the same rig, the same shader and the same bend, and it has its own
   colourways, its own rectangle for a muzzle the cat has no bone for,
   and its own middle — a muzzle sticking half a unit further forward
   moves the point that should sit on the box's centre line.

   So the four numbers that vary are gathered here, and a parsed asset
   may carry a `model` of its own; `CatLayer` falls back to this one,
   which is exactly what it used to hardcode. */
export const CAT_MODEL = {
  skins: CAT_SKINS,
  parts: SHAPE_PARTS,
  ride: SHAPE_RIDE,
  restHeight: MODEL_REST_HEIGHT,
  heightInBoxH: CAT_HEIGHT_IN_BOXH,
  centerZ: CENTER_Z,
  /** bone → how far to sink its ink. The cat's whole outline is one
      grown shell of one mesh, so it has nothing to merge. */
  inkSink: {},
};

/* ── stride ───────────────────────────────────────────────────────
   The feet are asked to keep pace with the ground, so the stride RATE
   is a linear function of how fast the character is actually moving:
   one stride per STRIDE_PER_BOXH box-heights travelled. At the game's
   boxH = 40 that is 107 px per stride, so the player's top speed of
   385 px/s comes out at 3.6 strides a second — a gallop, and the right
   cadence for a cat covering two and a half of its own body lengths a
   stride.

   Being honest about what this does NOT fix: the rig's shoulder swings
   ±0.62 rad, which moves a paw about 13 px at this size, so a planted
   foot cannot actually travel the 107 px the ground does. True
   foot-planting is not reachable from this asset's amplitudes — it was
   authored for a cat ambling around a lake, not for a parkour runner.
   What IS fixed is the part the eye catches: leg rate is proportional
   to ground speed, so slowing down slows the legs by the same factor
   and the gait never runs at a pace unrelated to the movement. */
const STRIDE_PER_BOXH = 2.67;
const STRIDE_HZ_MIN = 0.55;
const STRIDE_HZ_MAX = 5.5;
/** |vx| that counts as "flat out", for swing amplitude / bob / ears.
    PHYS.runSpeed. Kept here rather than imported because it is an
    animation-tuning reference, not the physics number. */
const REF_SPEED = 385;
/** Below this the character is standing still as far as the gait is
    concerned, so the idle drift takes over. */
const IDLE_SPEED = 12;

/* ── what the air does to the tail ────────────────────────────────
   `Sway`'s chains are driven by the way the BODY is moving, and until
   now the only thing that reached them from the vertical was the
   gait's `bodyPitch` — a function of SPEED and nothing else. Airborne,
   `speed01` is zero, `bodyPitch` is zero, the drive was a constant, and
   a constant drive has no lag in it. The tail's curve through a jump
   never moved at all.

   So the character's own vy is handed to `Sway.air`, normalised by
   PHYS.jumpVel so that ±1 is a full-speed jump and pose.js's TAIL_GA
   decides what that is worth in tail. Sign: the chain reports how far a
   node TRAILS its base, so a drive that falls leaves a positive lag,
   and a positive angle on the tail's own X channel carries it forward
   and up over the back (see TAIL_ROOT in pose.js). A cat dropping is a
   cat whose tail is left above it — hence the minus.

   And note what does NOT happen: at a steady vy the drive is constant
   and the lag decays to nothing, which is right. A tail is dragged by
   ACCELERATION, so it is the ballistic arc that bends it — flat out
   for the whole flight, because gravity is constant — and terminal
   velocity that lets it settle. In a level whose jumps are 172 px high
   nothing ever reaches terminal velocity, so the tail is bent for the
   whole of every jump.

   ── why vy is smoothed first ──
   Because vy is a STEP. A jump sets it from 0 to −830 between one
   frame and the next, and `lag(o) = a[o] − a[0]` turns a step at the
   base into the full deflection at EVERY node on the same frame: the
   chain's base-leads-tip-follows only exists for a drive that is
   continuous. Nothing else here trips it — `c.yaw` is rate-limited by
   `_turn`, `tailSwish` is a sine — which is why this is the one drive
   that needs its own smoothing.

   Measured at the takeoff frame, unsmoothed: every node reached half
   its peak at 17 ms, all together. One pole at AIR_TAU staggers that
   base-to-tip across 67 ms.

   AIR_TAU is not a fudge factor, it is the push-off. A velocity step is
   an infinite acceleration and no animal produces one; a cat's hind
   legs extend over something like 80 to 120 ms, and that is how long
   the impulse takes to arrive. 90 ms sits in the middle of it and costs
   6% of the bend the flight itself puts in the tail. */
const AIR_TAU = 0.09;

/* ── the turn ─────────────────────────────────────────────────────
   A cat does not change direction by becoming its own reflection. It
   turns, and the way it turns is the signature detail of the model this
   asset came from: the head goes first and the body comes round after
   it, because a cat looks at a thing by turning its head and only
   swings the shoulders when the head runs out of neck.

   ── the parameter ──
   `yaw` here (ψ below) is measured so that the one rule that must never
   break is impossible to break rather than merely enforced:

       ψ = 0      the nose points at the camera
       ψ = +π/2   profile, facing screen-right
       ψ = −π/2   profile, facing screen-left

   ψ is clamped to [−π/2, +π/2]. The cat's back is at ψ = ±π, which is
   outside the interval, so no sequence of inputs can reach it — a
   reversal is a slew between the two ends of a closed interval and it
   passes through 0, face-on, every time. There is no shortest-arc
   branch to get wrong and no wrap to handle, and mashing left/right
   just reverses a slew already in flight.

   The rig is turned by ψ − π/2 about the vertical axis: a right-handed
   Y rotation takes the rest forward (+Z, screen-right) to (sin θ, 0,
   cos θ), so θ = 0 leaves the cat in its old right-facing profile and
   θ = −π/2 puts the nose on −X, which is where the camera is. See the
   vertex shader, which does the rotation.

   ── the rate ──
   The original walks a cat round a lake at TURN_RATE_COURSE = 6.0
   rad/s: a 180° reversal takes π/6 ≈ 524 ms. A platformer changes
   direction several times a second and half a second of pirouette
   would leave the cat facing the wrong way for most of a jump, so the
   body here turns at 14 rad/s — π/14 ≈ 224 ms, about thirteen frames
   at 60 Hz. Thirteen frames is deliberate on both sides: fewer than
   about six and the turn stops being a turn and becomes a pop, and the
   head could not visibly lead something that was over in three frames;
   many more and the input stops feeling connected to the animal. */
const TURN_RATE = 14.0;

/** ψ at either profile, and therefore the clamp that puts the cat's
    back out of reach. */
const HALF_PI = Math.PI / 2;

/** The neck's range, from the original. The head can cover this much of
    the turn on its own before the shoulders have to help. */
const HEAD_YAW_MAX = 0.9;

/* How fast the head's aim moves toward what it wants (attack) and back
   to rest afterwards (release), as exponential time constants.

   ATTACK is the original's 0.05 — two or three frames, so the head is
   already committed while the body is barely under way, which is the
   whole read. RELEASE is cut from the original's 0.45 to 0.14: at 0.45
   the head would still be unwinding a third of a second after the body
   had arrived, which on a lakeside stroll is a cat looking back at
   something and in a platformer is just a head that has come loose.
   0.14 lands the head about two frames after the body — the beat of
   follow-through that stops the turn ending flat. */
const AIM_ATTACK = 0.05;
const AIM_RELEASE = 0.14;

/** The yaw rate that counts as a full-strength turn for the gait's own
    lean and tail swish. The original's TURN_RATE, kept at its value so
    the Driver receives the signal it was tuned against: at 14 rad/s the
    body saturates this the moment it starts moving, which is right —
    a direction reversal IS a hard turn. */
const TURN_LEAN_REF = 3.2;

/* ── the head, still turned a little toward the camera ────────────
   A pure profile of this model shows no face. The eyes are flat discs
   pressed onto the front of the head (the `unlit` group lives at
   z = 1.37…1.70, all of it facing +Z) so edge-on they are two pixels of
   nothing, and a cat with no eye does not read as a cat at 40 px.

   The fix is in the rig, not the camera: `pose.js` already has an
   `aimYaw`/`aimWeight` pair for "the head is being aimed at something",
   and the something here is the viewer — the same pair the turn drives,
   so there is one head aim and not two fighting each other.

   This was 0.40 rad when the only view of the cat was a locked profile
   and the constant was the sole source of a face. Now that a turn
   brings the whole head round on its own it can be smaller, and it is
   cut to 0.22 (13°): enough that a cat running steadily still shows an
   eye, a cheek and the near ear, and little enough that it no longer
   looks like an animal running one way while staring at the player.
   It is applied toward ψ = 0 — toward the camera — from whichever
   profile the cat is holding. */
const REST_AIM = 0.22;

/* ── the ink ──────────────────────────────────────────────────────
   The outline group is drawn in one flat colour rather than in its own
   vertex colours, and that is a deliberate correction to the asset.

   In the model source every outline shell is built with
   `basic(COL.out)` — a plain material whose colour is 0x2b2320, the
   same ink for all three skins. But the offline bake takes a vertex's
   colour from `geometry.attributes.color` **when the geometry has
   one**, and only falls back to the material otherwise. The body and
   the head are the two vertex-painted meshes, and their outline shells
   share their geometry — so those 4,554 shell vertices came out of the
   bake carrying cream and orange instead of ink, while the other 5,004
   (legs, ears, paws, tail, whose meshes are flat-coloured) came out
   correct. Counted straight off cat.bin: the outline group holds
   exactly three distinct colours, 43,35,32 on 5,004 vertices and the
   two coat colours on the rest.

   Rendered as stored, the effect is a cat with ink around its legs and
   a cream halo around its body, which at 40 px is no outline at all.
   So the whole group is forced to the ink the shells were authored
   with — the value is read off the group's own majority, not invented.

   The shells that still get drawn are the ears', and the bake got
   those RIGHT — the ears are flat-coloured meshes, so their shells are
   among the 5,004 vertices that came out as ink. The correction is
   kept anyway, because `opts.style = 'mesh'` puts the rest back, and
   because it is the same constant `shape.js` inks its rectangles
   with: one ink for the whole animal, not one per pass. */
const INK = [43 / 255, 35 / 255, 32 / 255];

/** How wide the ink line should be on screen, in CSS pixels, ON TOP OF
    whatever thickness the model baked into its shells.

    This is the one number the live renderer gets to do better than the
    atlas did. The shells the model carries were drawn for a cat filling
    a 1080-pixel frame; at boxH = 40 they come to about 0.6 px, which is
    barely a line. The atlas had to bake a fixed model-space growth and
    wear whatever it scaled to. Here the growth is recomputed per cat
    from its actual on-screen size, so the line is the same weight at
    every zoom instead of thinning out as the view widens. */
const INK_PX = 1.25;
/** …and a ceiling in model units, so a cat drawn very large does not
    grow a shell thick enough to swallow its own legs. */
const INK_GROW_MAX = 0.16;

/* ── the three tones ──────────────────────────────────────────────
   Not three unrelated constants: three samples of the SAME lighting
   equation the rest of the game uses. `daycycle.shade()` is

       albedo × (tint × ndl × 2.4 + ambient × 1.5)

   so the cat's bands are that expression evaluated at three values of
   `ndl` — full, a little, and none — and the result is that a cat at
   dusk has warm lit tones and cool blue shadows for the same reason the
   platforms do.

   How they reach the pixel matters. Evaluating all three in linear and
   tone-mapping each separately does not work: ACES compresses hard at
   the top, so the lit and mid bands converge into each other and the
   cel look collapses back into "slightly posterised 3D". So the SHADER
   tone-maps the fully-lit colour once, and the mid and shadow bands are
   flat MULTIPLIERS on that — computed here, on the CPU, as the ratio
   the tone map actually produces at a representative albedo. Even
   steps, and the colour shift survives. */
const BAND_KEY = [1.0, 0.24, 0.035];   // ndl per band
const BAND_AMB = [1.0, 1.0, 1.06];     // ambient gain per band
const SHADE_KEY_GAIN = 2.4;            // daycycle.shade()'s own numbers
const SHADE_AMB_GAIN = 1.5;
/** The albedo the band ratios are measured at. Mid-grey: the ratio a
    tone map produces depends on the value it is fed, and this is the
    middle of the cat's own range (its coat runs about 0.2…0.9 linear). */
const TONE_REF_ALBEDO = 0.55;
/** Ratios are held inside these bands however the sky moves. At
    midnight the ambient dominates and the physically-correct ratios all
    crowd toward 1, which would leave the cat a flat dark blob; at noon
    they spread far enough apart that the shadow band goes to mud. A cel
    cat needs three tones you can tell apart at every hour, so the
    LUMINANCE of each ratio is clamped and all three channels are scaled
    by the same factor — which keeps the hue shift and only moves the
    step size. */
const MID_RANGE = [0.50, 0.72];
const SHADOW_RANGE = [0.24, 0.42];

/** Where the two band boundaries sit, in dot(normal, light). The first
    is just below the terminator so the whole away-facing side is one
    flat shadow; the second is high enough that the lit band is a
    definite shape on the animal rather than most of it. */
const BAND_EDGE = [-0.06, 0.42];
/** How wide a boundary is allowed to be, as a multiple of the
    screen-space derivative of the diffuse term. Enough to stop the
    terminator crawling and aliasing, and no more — this is the number
    that decides whether the result is a cartoon or a gradient. */
const BAND_SOFT = 0.6;
/** …and a floor, for surfaces so flat that fwidth returns ~0 and the
    step would land entirely inside one pixel. */
const BAND_SOFT_MIN = 0.004;

/** Where the key light comes from, over and above the sun's own screen
    direction. `sky.dir` is a 3D sun/moon vector and the 2D game reads
    its x and y as the on-screen direction, which leaves the depth axis
    unspecified — so the cat's key gets a fixed lean toward the viewer,
    because a light exactly edge-on to a profile puts the whole near
    side of the animal in one tone and there is nothing to band. The
    upward bias keeps a readable key at dawn and dusk, when the sun's
    own y is zero and a pure side light would cut the cat in half. */
const KEY_TOWARD_VIEWER = 0.55;
const KEY_LIFT = 0.42;
const KEY_SUN_Y = 0.80;

/* ── how a state change reaches the pose ──────────────────────────
   Long enough to see as a movement rather than a cut, short enough that
   a cat landing does not float through the transition. */
const BLEND_TIME = 0.13;

/* ── the integrator's step ceiling ────────────────────────────────
   The tail and the whiskers are spring chains advanced with symplectic
   Euler, and that has a hard stability bound: the step may not exceed
   2/ω of the fastest mode. It comes apart LOUDLY when it does, as a
   face full of whisker spaghetti and a tail tied in a knot. (Found
   exactly that way, on a test that stepped 80 ms a frame.)

   `Driver` clamps its own dt to 0.05 internally and so was never the
   problem; `Sway` has no such clamp and must not be given one, because
   silently swallowing time would drift the tail out of step with the
   body that is dragging it. So the frame's dt is SUBDIVIDED instead:
   every substep is at most this long, and their sum is exactly the dt
   the caller passed.

   The ceiling moved with the chain. Taking the wave out of the tail
   meant a stiffer spring — pose.js's CH_K is 2048 now, not 240, and
   the derivation is there — and a stiffer spring is a shorter step:
   swept numerically, that chain survives to dt ≈ 0.0223 and blows up
   past it. 0.005 keeps the factor of four and a half this was always
   written to have, and costs four substeps at 60 fps rather than two —
   about 8 µs a cat. A dropped frame or a tab coming back from the
   background is then a handful of extra substeps, not an explosion. */
const MAX_SUB_DT = 0.005;

/* ── shaders ────────────────────────────────────────────────────── */

const SWAY_N = 17;   // must equal Sway.count
const SWAY_NONE = 0, SWAY_TAIL = 1, SWAY_WHISKER_L = 3;

const VERT = (boneN, partN, centerZ) => `#version 300 es
precision highp float;
#define BONE_N ${boneN}
#define SWAY_N ${SWAY_N}
#define SWAY_NONE ${SWAY_NONE}
#define SWAY_TAIL ${SWAY_TAIL}
#define SWAY_WHISKER_L ${SWAY_WHISKER_L}

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aNormal;   // xyz normal, w = outerness
layout(location = 2) in vec4 aColor;    // rgb sRGB, a = bone | sway << 5

uniform mat4 uBones[BONE_N];
uniform vec4 uSwayQ[SWAY_N];
uniform vec3 uSwayBend[SWAY_N];
uniform vec2 uWhisker[SWAY_N];

/** Model → world px. (centreX, feetY, pxPerUnit, pxPerUnit) */
uniform vec4 uPlace;
/** The body's yaw about the vertical, as (cos θ, sin θ). θ = ψ − π/2,
    so (1, 0) is the rest pose in right-facing profile. See TURN_RATE. */
uniform vec2 uYaw;
/** The camera's pitch, as (cos φ, sin φ), applied AFTER the yaw and
    about the screen's own horizontal axis: it tips the view up over the
    animal or down under it. (1, 0) — level — for the whole game.

    It has to come after the yaw and not before, because it is a camera
    and not a joint. Rotating the model would tip it out of its own
    collision box and off the platform it stands on; rotating the VIEW
    leaves the animal upright in the world and moves where that world is
    seen from, which is what looking at a thing from above means.

    Only the layer's own pin() sets it, and pinning is not something the
    game does. Level, this is the identity in every line it appears in,
    which is why it costs nothing to leave in. */
uniform vec2 uPitch;
/** World px → clip. (ax, bx, ay, by), so clip.x = wx·ax + bx. */
uniform vec4 uXform;
/** The model Y that stands on the box's bottom edge. */
uniform float uGroundY;
/** Extra push along the normal, in model units. Non-zero only for the
    outline group; see INK_PX. */
uniform float uGrow;
/** First vertex of the 'unlit' range, read off the file at load. */
uniform int uUnlitStart;
/** The tail's tube radius, for the tip. See TAIL_CAP_GLSL. */
uniform float uTailRadius;
uniform int uTailBone;
/** Also declared in the fragment shader, and the same uniform: it is
    what tells the bend that this is the ink shell and not the fill.
    The "unlit" test below cannot be used for that — the outline
    group's vertices all sit ABOVE uUnlitStart, so vUnlit is 1 across
    the whole shell. */
uniform float uInkMode;
/** Toward the camera, for the face only. See FACE_LIFT. */
uniform float uFaceLift;
/** Per bone: how far to push that bone's INK shell BACK, in model
    units, and only on the ink pass. Zero for every bone of the cat.

    This is how two parts come to share one outline. The ink is an
    inverted hull whose far side is drawn behind its own part's fill, so
    a part gets a ring exactly where nothing of its own covers it — and
    that is per PART. A muzzle standing out in front of a head has its
    ring drawn over the head's cheek, because the muzzle's shell really
    is nearer than the head there, and what the eye reads is a seam
    across the face rather than one animal.

    Sinking the muzzle's ink past the head's own depth makes the head's
    FILL win wherever there is head, and leaves the ring standing
    wherever there is not. What comes out is one line around the union
    of the two, which is what a snout on a head looks like.

    Per bone rather than per part, because it costs one uniform array
    and no extra draw call: the ink is still the same single pass over
    the same inverted hull. */
uniform float uInkSink[BONE_N];

out vec3 vNormal;
out vec3 vColor;
flat out float vUnlit;

/* The tail's rest centreline, at the same nodes as pose.js. Kept in
   step with the copy there, which is where it is explained. */
const vec3 TAIL_AXIS[SWAY_N] = vec3[SWAY_N](
  vec3(0.0143, 0.0418, -0.0334), vec3(0.0143, 0.1674, -0.1336),
  vec3(0.0143, 0.3348, -0.2673), vec3(0.0143, 0.4601, -0.3679),
  vec3(0.0143, 0.6222, -0.5078), vec3(0.0140, 0.8239, -0.6916),
  vec3(0.0140, 0.9426, -0.7806), vec3(0.0141, 1.0988, -0.8711),
  vec3(0.0143, 1.2850, -0.9439), vec3(0.0140, 1.5485, -0.9984),
  vec3(0.0140, 1.7333, -0.9876), vec3(0.0140, 1.8596, -0.9510),
  vec3(0.0141, 2.0868, -0.8062), vec3(0.0139, 2.2143, -0.6736),
  vec3(0.0140, 2.2832, -0.5405), vec3(0.0142, 2.3377, -0.3679),
  vec3(0.0014, 2.3985, -0.1488)
);

vec3 qRot(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
vec3 rotZ(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
}
vec3 rotY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

void tailNodes(float o, out int lo, out int hi, out float t) {
  float x = clamp(o, 0.0, 1.0) * float(SWAY_N - 1);
  float i = floor(x);
  lo = int(i);
  hi = min(lo + 1, SWAY_N - 1);
  t = x - i;
}
vec2 sampleWhisker(float o) {
  int lo, hi; float t;
  tailNodes(o, lo, hi, t);
  return mix(uWhisker[lo], uWhisker[hi], t);
}

/* A ring is carried, not swung: turned about its own place on the
   tail's line and then set down where that place has moved to. Skinned
   to both of its nodes so every vertex has a pivot next to itself. */
vec3 swayPoint(vec3 p, float o, int group) {
  if (group == SWAY_TAIL) {
    int lo, hi; float t;
    tailNodes(o, lo, hi, t);
    vec3 a = qRot(uSwayQ[lo], p - TAIL_AXIS[lo]) + TAIL_AXIS[lo] + uSwayBend[lo];
    vec3 b = qRot(uSwayQ[hi], p - TAIL_AXIS[hi]) + TAIL_AXIS[hi] + uSwayBend[hi];
    return mix(a, b, t);
  }
  vec2 a = sampleWhisker(o);
  if (group == SWAY_WHISKER_L) a = -a;
  return rotY(rotZ(p, a.y), a.x);
}

/** The same deformation with the carry left off: a normal is a
    direction, so it can only be turned. */
vec3 swayNormal(vec3 n, float o, int group) {
  if (group == SWAY_TAIL) {
    int lo, hi; float t;
    tailNodes(o, lo, hi, t);
    return normalize(mix(qRot(uSwayQ[lo], n), qRot(uSwayQ[hi], n), t));
  }
  vec2 a = sampleWhisker(o);
  if (group == SWAY_WHISKER_L) a = -a;
  return rotY(rotZ(n, a.y), a.x);
}

/* The two projections the shape block needs, factored out of main so
   that there is exactly one copy of this arithmetic: a rectangle and
   the ear sitting on top of it have to agree about where they are to
   well under a pixel, every frame. */
vec2 screenOf(vec3 w) {
  float rx = w.x * uYaw.x + (w.z - ${centerZ.toFixed(4)}) * uYaw.y;
  float rz = -w.x * uYaw.y + (w.z - ${centerZ.toFixed(4)}) * uYaw.x;
  float up = (w.y - uGroundY) * uPitch.x - rx * uPitch.y;
  return vec2(uPlace.x + rz * uPlace.z, uPlace.y - up * uPlace.w);
}
/** A DIRECTION, in (screen-right, screen-up) — no CENTER_Z, and the
    sign on Y flipped once here so everything downstream can think in
    (right, UP) while "wy" still grows downward. */
vec2 projectDir(vec3 d) {
  float rx = d.x * uYaw.x + d.z * uYaw.y;
  return vec2((-d.x * uYaw.y + d.z * uYaw.x) * uPlace.z,
              (d.y * uPitch.x - rx * uPitch.y) * uPlace.w);
}

${SHAPE_GLSL(partN, boneN)}
${TAIL_CAP_GLSL(SWAY_N)}

void main() {
  /* The colour's alpha byte carries the bone in its low five bits and
     the sway group in its top three. Rounding rather than truncating
     matters: 8/255 does not survive the trip to float exactly. */
  int packed = int(aColor.a * 255.0 + 0.5);
  int b = packed & 31;
  int group = packed >> 5;
  mat4 bone = uBones[b];

  vec3 local = aPosition;
  vec3 normal = aNormal.xyz;
  float o = aNormal.w;

  /* The tail's tip, squared off before anything else touches it. It
     has to happen here, in the tail's own rest space, because that is
     where the chain's centreline is a known constant; a node later and
     the spring has already carried it somewhere. */
  if (b == uTailBone && group == SWAY_TAIL) local = tailCap(local, o);

  if (group != SWAY_NONE) {
    local = swayPoint(local, o, group);
    normal = swayNormal(normal, o, group);
  }

  /* The outline's own thickness is whatever the model baked into its
     shells, and this adds to it — along the vertex normal, which is how
     the model's own outlineShell helper was built, so it grows evenly
     on a limb instead of ballooning off a distant origin. */
  local += normal * uGrow;

  vec4 world = bone * vec4(local, 1.0);

  /* The body's yaw: a right-handed rotation about the vertical axis
     that runs through the model's own centre, so a turning cat spins
     on the spot instead of swinging its whole body sideways out of the
     collision box. That axis is x = 0, z = CENTER_Z — the same z the
     projection below calls the middle of the box — so the rotation is
     done on coordinates already measured from it and rz comes out
     ready to use.

     This replaces the mirror that used to make a left-facing cat. A
     rotation preserves handedness where a mirror reverses it, which is
     why the cull faces below are now constant and why the inverted
     hull keeps working at every angle in between: it is the same solid
     seen from a new direction rather than a reflected one. */
  float rx = world.x * uYaw.x + (world.z - ${centerZ.toFixed(4)}) * uYaw.y;
  float rz = -world.x * uYaw.y + (world.z - ${centerZ.toFixed(4)}) * uYaw.x;

  /* Turned by the YAW only, and deliberately not by the pitch. The
     normal that goes to the fragment shader is what the key light is
     measured against, and the light is meant to be the hour's — up in
     the world, over the animal. Turning the normal with the camera as
     well would nail the sun to the viewer's forehead: tipped 50° over
     the animal's back, every upward surface would face the light at
     once and the three tones would collapse into one. What is wanted
     from tipping the view is a look at the animal, not a different
     lighting of it.

     The pitch is still needed one line further down, where the depth
     axis is what is being asked for rather than the light. */
  vec3 n = mat3(bone) * normal;
  vNormal = vec3(n.x * uYaw.x + n.z * uYaw.y, n.y, -n.x * uYaw.y + n.z * uYaw.x);
  vColor = aColor.rgb;
  /* The three groups own disjoint vertex ranges, so which one a
     triangle belongs to is a comparison rather than an attribute — and
     that is what lets 'lit' and 'unlit' share a draw call. */
  vUnlit = gl_VertexID >= uUnlitStart ? 1.0 : 0.0;

  /* Orthographic, from the side. Screen right is post-yaw +Z, which at
     θ = 0 is the direction the head, eyes and whiskers point, so a cat
     at rest faces right. Screen up is world +Y, and the game's world Y
     grows DOWNWARD, hence the subtraction. Depth grows with post-yaw
     +X: the camera is at −X, so nearer is smaller, as gl.LESS wants.
     Yaw leaves Y alone, so the ground measurement is unaffected by it
     and a turning cat's feet stay on the box's floor. */
  float up = (world.y - uGroundY) * uPitch.x - rx * uPitch.y;
  vec2 screen = vec2(uPlace.x + rz * uPlace.z, uPlace.y - up * uPlace.w);

  /* ── and then the outline is made rectangular ──
     Everything above this line is the cat as it was: real bones, real
     sway, real normals, real colours, projected exactly as before.
     This moves WHERE the vertex lands and nothing else — vNormal is
     already written and is not touched, so what gets drawn is a
     rounded rectangle lit as the curved thing it actually is.

     A carried bone — an ear, an eye, a whisker — is translated by
     whatever the bend does to its own origin, so it keeps its shape
     and its place on the face. See SHAPE_RIDE. */
  /* The face — eyes, nose, whiskers, the whole unlit group — is left
     where the mesh put it, along with the ears. See SHAPE_RIDE. */
  bool face = uInkMode < 0.5 && vUnlit > 0.5;

  int part = uBonePart[b];
  if (part >= 0 && uBoneRide[b] == 0 && !face) {
    /* How edge-on this vertex is: 1 exactly on the silhouette, 0
       facing the camera. vNormal is turned by the yaw but not by the
       pitch — see above — so the view's depth axis is its x and y mixed
       by the pitch, which is the one place that mixing is wanted. Level,
       it is vNormal.x and nothing has changed. */
    vec3 vn = normalize(vNormal);
    float sil = 1.0 - abs(vn.x * uPitch.x + vn.y * uPitch.y);
    screen = warpToRect(screen, part, sil);
  }

  /* Depth takes the pitch too, or a view from above would still sort
     the animal as if seen from the side. */
  float depth = rx * uPitch.x + (world.y - uGroundY) * uPitch.y;
  gl_Position = vec4(
    screen.x * uXform.x + uXform.y,
    screen.y * uXform.z + uXform.w,
    (depth - (face ? uFaceLift : 0.0) + (uInkMode > 0.5 ? uInkSink[b] : 0.0))
      * ${(1 / DEPTH_HALF).toFixed(6)},
    1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vColor;
flat in float vUnlit;
out vec4 outColor;

/** 1 = this draw is the ink shell. */
uniform float uInkMode;
uniform vec3 uInk;
/** Linear light multiplier for the LIT band: tint·2.4 + ambient·1.5. */
uniform vec3 uKeyLit;
/** Flat multipliers on the tone-mapped lit colour. LIT is implicitly 1. */
uniform vec3 uMidTone;
uniform vec3 uShadowTone;
/** Key light in VIEW space, which is where vNormal now arrives: the
    vertex shader turns the normal by the body's yaw along with the
    position, so one light vector serves every angle of the turn. Its
    screen-horizontal component is swung with the cat by the CPU (see
    _drawOne) so the key never ends up behind a cat in profile. */
uniform vec3 uLightDir;
/** The two band boundaries in dot(n, l). */
uniform vec2 uBandEdge;
/** Eyes and nose: authored display colours, scaled by how bright the
    hour is so they do not glow at midnight. */
uniform float uUnlitGain;
uniform float uAlpha;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

/* ACES (Narkowicz) at the day cycle's own EXPOSURE, and NO sRGB encode
   afterwards — which looks wrong written down and is exactly what
   daycycle.css() does for every platform and coin in the game. Matching
   it is the difference between a cat that sits in the scene and a cat
   pasted on top of it. */
vec3 aces(vec3 x) {
  x = max(x, vec3(0.0)) * 1.25;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  if (uInkMode > 0.5) {
    outColor = vec4(uInk * uAlpha, uAlpha);
    return;
  }
  if (vUnlit > 0.5) {
    outColor = vec4(vColor * uUnlitGain * uAlpha, uAlpha);
    return;
  }

  vec3 albedo = srgbToLinear(vColor);
  float d = dot(normalize(vNormal), uLightDir);

  /* THE CEL STEP. Two smoothsteps, each only as wide as one pixel's
     worth of change in d, so what lands on screen is three flat plates
     of colour with a clean edge between them — not a ramp with three
     landmarks on it. Everything else in this shader exists to give
     these three plates a colour; nothing else varies across a face. */
  float e = max(fwidth(d) * ${BAND_SOFT}, ${BAND_SOFT_MIN});
  float s1 = smoothstep(uBandEdge.x - e, uBandEdge.x + e, d);
  float s2 = smoothstep(uBandEdge.y - e, uBandEdge.y + e, d);

  vec3 base = aces(albedo * uKeyLit);
  vec3 tone = mix(uShadowTone, uMidTone, s1);
  tone = mix(tone, vec3(1.0), s2);

  outColor = vec4(base * tone * uAlpha, uAlpha);
}
`;

/* ── the four authored poses ──────────────────────────────────────
   These are NOT the gait — there is no jump or death in `pose.js` to
   borrow — so they are authored here, on top of the real rig, using the
   same channels `applyPose` uses and the same sign conventions:

     rotation.x on a leg bone swings the paw BACKWARD when positive
     (a point below the pivot rotates toward −Z), so reaching forward is
     negative. `applyPose` writes `-p.shoulderA` for exactly that reason.

     rotation.x on the torso or root tips the nose DOWN when positive,
     which is why the gait's `bodyPitch` is negative at speed.

     rotation.x on the HEAD is absolute here, not an offset: the bake's
     old nose-down rest lean is gone (pose.js's HEAD_LEAN is 0 now, so
     an idle cat looks level down the line it runs along) and what these
     poses want is a stated aim, not a nudge off one.

     rotation.x on the TAIL is the other way round — an offset, off
     pose.js's TAIL_LIFT. These four are gestures against the resting
     tail ("up as a counterweight", "trailing"), so they are written as
     the gesture and the rest is added back.

   Each runs AFTER `applyPose`, so the gait's own head, ear and tail
   motion is still underneath and a cat frozen in `fall` still breathes.
   Cross-fading between them is done on the channel arrays; see
   `_poseCat`.                                                        */

function poseAir(rig, B) {
  /* Rising out of a jump. The front legs reach up and forward and the
     hind legs TRAIL, straight out behind — they are what threw the cat
     off the ground and they have not folded back up yet. This is the
     shape that says "leaving" rather than "arriving", and it is the
     one thing about the pose that must be right, because it is the
     only thing distinguishing it from `fall` at a glance.

     Trailing means positive on the hip: a positive rotation.x takes a
     point below the pivot toward −Z, and +Z is forward, so positive
     swings the leg BACKWARD. (This pose had it negative and read as a
     cat sitting down in mid-air.) The hind paw carries a smaller
     positive angle on top of its hip's, which straightens the leg out
     along the same line rather than kinking it — a hind leg at full
     extension is nearly a straight line from hip to toe. */
  legs(rig, B, -0.85, 0.62, 0.26);
  rig.rotation[B.torso * 3] = -0.22;
  head(rig, B, -0.14);
  rig.rotation[B.tail * 3] = TAIL_LIFT - 0.30;
}

function poseFall(rig, B) {
  /* Coming down, and deliberately the opposite shape at the hips. The
     front paws reach for the floor and the hind legs GATHER — swung
     forward under the belly, folded, ready to take the landing. So the
     hip goes negative where `air` had it positive, and the knee stays
     a little positive so the lower leg is tucked back under the hip
     instead of the whole leg pointing forward like a second pair of
     arms. Tail up as a counterweight, head level and looking where it
     is going. */
  legs(rig, B, -0.34, -0.30, 0.34);
  rig.rotation[B.torso * 3] = 0.14;
  head(rig, B, 0.02);
  rig.rotation[B.tail * 3] = TAIL_LIFT + 0.42;
}

function poseWall(rig, B) {
  /* Against a wall, sliding: reared up onto the hind legs with the
     front paws high on the wall it is facing. Deliberately only ~30°
     off upright rather than fully vertical, so the hind paws stay near
     the box's floor line and the cat still sits in its box. */
  rig.rotation[B.root * 3] = -0.55;
  legs(rig, B, -1.05, 0.30, 0.16);
  head(rig, B, -0.18);
  rig.rotation[B.tail * 3] = TAIL_LIFT + 0.55;
}

function poseDead(rig, B) {
  /* Flat out, and the small angles here are the whole trick.

     An anisotropic scale on the root SHEARS every rotated child under
     it — so the first two attempts, which squashed the root AND threw
     the legs out and dropped the neck, came out as a cat skewed down a
     diagonal rather than one lying on the floor. Built out of joint
     angles alone instead, with no squash, it stays upright and tall,
     because this model is very nearly as long as it is high and no
     amount of pitching it over makes it shorter.

     So: squash the root, and keep everything under it close to rest,
     where a shear has almost nothing to bite on. The result is 24 px
     tall against the standing cat's 45 — flat, which is what the state
     has to say at a glance. */
  rig.scale[B.root * 3 + 1] = 0.55;
  rig.scale[B.root * 3 + 2] = 1.15;
  legs(rig, B, -0.35, 0.35, 0.12);
  head(rig, B, 0.26);
  rig.rotation[B.tail * 3] = TAIL_LIFT + 0.10;
  // No lids on this model — a shut eye is a squashed eyeball.
  for (const e of B.eyes) rig.scale[e * 3 + 1] = 0.08;
}

function legs(rig, B, front, hind, knee) {
  rig.rotation[B.frontA * 3] = front;
  rig.rotation[B.frontB * 3] = front;
  rig.rotation[B.hindA * 3] = hind;
  rig.rotation[B.hindB * 3] = hind;
  rig.rotation[B.kneeA * 3] = knee;
  rig.rotation[B.kneeB * 3] = knee;
}
function head(rig, B, x) {
  rig.rotation[B.head * 3] = x;          // absolute; see the note above
}

/** The authored states, and whether the pose is meant to stand on the
    floor. `air` is the one that is not: a cat on the way up has its
    feet off the ground, and that is the whole point of it. */
const AUTHORED = {
  air: { fn: poseAir, ground: false },
  fall: { fn: poseFall, ground: true },
  wall: { fn: poseWall, ground: true },
  dead: { fn: poseDead, ground: true },
};
const STATES = ['run', 'idle', 'air', 'fall', 'wall', 'dead'];

/* ── channel packing ──────────────────────────────────────────────
   A pose is 23 bones × (rotation, position, scale) = 207 floats, packed
   flat so a cross-fade is one loop rather than three. Euler angles are
   blended componentwise, which is only safe because every angle in
   play here is under about 1.2 rad and none of them cross a wrap — a
   cat does not spin. */

function packChannels(rig, out) {
  const n = rig.count * 3;
  out.set(rig.rotation, 0);
  out.set(rig.position, n);
  out.set(rig.scale, n * 2);
  return out;
}
function unpackChannels(rig, src) {
  const n = rig.count * 3;
  rig.rotation.set(src.subarray(0, n));
  rig.position.set(src.subarray(n, n * 2));
  rig.scale.set(src.subarray(n * 2, n * 3));
}

/* ── odds and ends ──────────────────────────────────────────────── */

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** ACES at the day cycle's exposure, on the CPU. Must match `aces()` in
    the fragment shader exactly — the band ratios are measured with this
    and applied with that. */
function acesJS(x) {
  x = Math.max(0, x) * 1.25;
  return clamp01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
}

/**
 * The lowest point of a posed mesh, in world Y — which is what the cat
 * has to stand on.
 *
 * Taken over the bone matrices alone, with the sway deformation left
 * out. That is exact for the four authored poses, where the chain has
 * been let settle and its rotations are identity; and it is harmless
 * for the gait, where the lowest thing on the animal is a paw and the
 * tail is up over its back. Nothing here is ever floored by a whisker.
 *
 * Called five times at load and never again — it is a 22,405-vertex
 * loop and has no business on a frame.
 */
function lowestY(matrices, position, color, count) {
  let lo = Infinity;
  for (let i = 0; i < count; i++) {
    const m = (color[i * 4 + 3] & 31) * 16;
    const x = position[i * 3], y = position[i * 3 + 1], z = position[i * 3 + 2];
    const wy = matrices[m + 1] * x + matrices[m + 5] * y + matrices[m + 9] * z + matrices[m + 13];
    if (wy < lo) lo = wy;
  }
  return lo;
}

function buildProgram(gl, vsrc, fsrc) {
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(`cat shader: ${gl.getShaderInfoLog(sh)}`);
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, vsrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`cat program: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}

/* ═══ one model ═══════════════════════════════════════════════════
   Everything about ONE animal: its asset, its skeleton, its program,
   its buffers, its measurements. A layer holds as many of these as it
   was given and picks between them per character.

   It has to be a whole object and not a few extra arrays, because the
   program is compiled around the asset — the bone count and the part
   count are `#define`s and the centre Z is a literal — so two animals
   with different skeletons cannot share one. Everything downstream of
   that follows: its own uniform locations, its own VAOs, its own
   measured ground.

   The field names are the ones the layer used when it could only hold
   one, and deliberately so: every method moved here reads exactly as it
   did, which is what makes it possible to see that this was a move and
   not a rewrite. */

class Model {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {object} data  a parsed asset — cat.bin, or something
   *   `dog.js` built out of it
   * @param {object} opts  `{ style, restAim }`, the layer's own
   */
  constructor(gl, data, opts) {
    this.gl = gl;
    this._data = data;
    this._style = opts.style;
    this._restAim = opts.restAim;

    /* Which animal this is. A builder such as `dog.js` hands its own
       descriptor down on the parsed data; anything that came straight
       off cat.bin is the cat. */
    const model = this._model = data.model || CAT_MODEL;
    /** The colourways this asset actually carries, in the model's own
        order — the first of them is the default and the one the ground
        is measured on. */
    this._skins = model.skins.filter((sk) => data.colors.has(sk));
    if (!this._skins.length) throw new Error("cat: asset carries none of the model's skins");
    /** World px per model unit at boxH = 1. */
    this._unitsPerBoxH = model.restHeight / model.heightInBoxH;
    this._rig = new Rig(data.header);
    /* `mesh` style still compiles the bend, with every bone mapped to
       no part, so there is one shader to keep rather than two. */
    this._shapeParts = model.parts.length;
    this._noBend = new Int32Array(this._rig.count).fill(-1);
    /** Per bone, how far its ink is pushed back. See uInkSink. */
    this._inkSink = new Float32Array(this._rig.count);
    for (const [name, by] of Object.entries(model.inkSink || {})) {
      this._inkSink[this._rig.bone(name)] = by;
    }
    this._prog = buildProgram(gl,
      VERT(this._rig.count, this._shapeParts, model.centerZ), FRAG);
    this._chanN = this._rig.count * 9;

    /* ── the eye on the far side ──
       This model has two eyes and the camera can only ever be on one
       side of it, so in a true profile the far eye is inside the head
       and invisible. It does not stay that way once the head is aimed
       at the viewer: the near eye swings BACK across the face and the
       far one is left sitting at the front of the muzzle, where the
       white sparkle the model paints on every eye pokes out past the
       silhouette and reads as a chip in the ink line. A cat drawn in
       profile has one eye. So the far one is collapsed to zero scale.
       Its 608 triangles are still submitted — they sit in the middle of
       a merged index range and splitting the draw to skip them would
       cost more than it saved — but degenerate triangles cover no
       pixels, so they are free of everything except vertex shading.

       All of which is an argument about PROFILE, and once the cat can
       turn it stops being true continuously. Head-on there is no far
       eye — there are two eyes, both of them on the front of the face,
       and collapsing either would leave a one-eyed cat staring at the
       player. So the collapse is now a function of how side-on the
       head is, and which eye it applies to is decided per frame; see
       `_eyeFade`. The two eyes are recorded here by the sign of their
       rest x, which is the axis they are separated along. */
    this._eyePlusX = -1;
    this._eyeMinusX = -1;
    for (let i = 0; i < this._rig.count; i++) {
      if (!this._rig.names[i].startsWith('eye')) continue;
      if (this._rig.rest.position[i * 3] >= 0) this._eyePlusX = i;
      else this._eyeMinusX = i;
    }

    this._buildBuffers();
    this._locateUniforms();
    this._measureShape();
    this._measureGround();

    // Scratch, reused every frame so a frame allocates nothing.
    this._scratch = new Float32Array(this._chanN);
  }

  /** Give back everything this model holds on the GPU. */
  dispose() {
    const gl = this.gl;
    for (const v of this._vaos.values()) gl.deleteVertexArray(v);
    for (const b of this._cbufs.values()) gl.deleteBuffer(b);
    gl.deleteBuffer(this._pbuf);
    gl.deleteBuffer(this._nbuf);
    gl.deleteBuffer(this._ibo);
    gl.deleteProgram(this._prog);
    this._shape = null;
  }

  /* ── setup ────────────────────────────────────────────────────── */

  _buildBuffers() {
    const gl = this.gl, data = this._data;

    const arrayBuf = (src) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, src, gl.STATIC_DRAW);
      return b;
    };
    this._pbuf = arrayBuf(data.position);
    this._nbuf = arrayBuf(data.normal);

    /* Which triangles of the asset this style still draws, and in what
       order. In `shape` that is the ears and the unlit bits only, so
       the buffer is rebuilt rather than uploaded whole; in `mesh` the
       plan is the file's own layout and the array is the file's own. */
    const plan = this._planIndex();
    this._ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, plan.index, gl.STATIC_DRAW);

    /* One VAO per skin. The colour block is the ONLY thing a colourway
       owns — 90 KB each, all three resident — so switching skins is a
       VAO bind instead of a 90 KB upload, and the queue is sorted by
       skin so it happens at most three times a frame. */
    this._vaos = new Map();
    this._cbufs = new Map();
    for (const name of this._skins) {
      const colors = data.colors.get(name);
      if (!colors) continue;
      const cbuf = arrayBuf(colors);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._pbuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._nbuf);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.SHORT, true, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, cbuf);
      gl.enableVertexAttribArray(2);
      // Not-normalised for .a alone is not an option, so the bone index
      // is un-normalised in the shader instead.
      gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._ibo);
      this._vaos.set(name, vao);
      this._cbufs.set(name, cbuf);
    }
    gl.bindVertexArray(null);

    this._indexType = data.header.indexBits === 32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    this._indexBytes = data.header.indexBits === 32 ? 4 : 2;

    this._solid = plan.solid;
    this._outline = plan.outline;
    this._unlitStart = plan.unlitStart;

    this._trisPerCat = 0;
    for (const s of this._solid) this._trisPerCat += s.count / 3;
    if (this._outline) this._trisPerCat += this._outline.count / 3;
    this._drawsPerCat = this._solid.length + (this._outline ? 1 : 0);
  }

  /**
   * The draw ranges, and the vertex boundary the shader uses to tell
   * lit from unlit — measured off the file rather than hardcoded, so a
   * re-bake that moves them still works. `lit` and `unlit` are merged
   * only if they are genuinely adjacent; if a future bake separates
   * them this quietly falls back to three draws.
   *
   * Nothing is filtered out any more. The whole asset is drawn: the
   * rectangles are made by BENDING it, so every triangle is still
   * needed, and the inverted hull is still what draws the ink — grown
   * along the normal before the bend, it comes out of the bend just
   * outside the fill, which is the line.
   */
  _planIndex() {
    const groups = this._data.header.groups;
    const g = (name) => groups.find((x) => x.name === name);
    const lit = g('lit'), unlit = g('unlit'), outline = g('outline');

    let lo = Infinity;
    if (unlit) {
      for (let i = unlit.start; i < unlit.start + unlit.count; i++) {
        if (this._data.index[i] < lo) lo = this._data.index[i];
      }
    }
    const solid = [];
    if (lit && unlit && lit.start + lit.count === unlit.start) {
      solid.push({ start: lit.start, count: lit.count + unlit.count });
    } else {
      if (lit) solid.push({ start: lit.start, count: lit.count });
      if (unlit) solid.push({ start: unlit.start, count: unlit.count });
    }
    return {
      index: this._data.index,
      solid,
      outline: outline ? { start: outline.start, count: outline.count } : null,
      unlitStart: unlit ? lo : this._data.header.vertexCount,
    };
  }

  /**
   * The part table, measured off the asset and flattened into the
   * uniform arrays the vertex shader indexes. No GPU objects: the bend
   * is part of the one program that was already there.
   */
  _measureShape() {
    if (this._style !== 'shape') { this._shape = null; return; }
    const { parts, tail, byBone, rides } =
      measureShapes(this._data, this._rig, this._model.parts, this._model.ride);
    const n = parts.length;
    const pa = new Float32Array(n * 4), pb = new Float32Array(n * 4);
    const pn = new Float32Array(n);
    parts.forEach((p, i) => {
      pa.set([p.center[0], p.center[1], p.center[2], p.bone], i * 4);
      pb.set([p.half[0], p.half[1], p.half[2], p.radius], i * 4);
      pn[i] = p.norm;
    });
    this._shape = {
      parts: n, tail, pa, pb, pn,
      bonePart: new Int32Array(byBone),
      boneRide: new Int32Array(rides),
    };
  }

  _locateUniforms() {
    const gl = this.gl, p = this._prog;
    const U = (n) => gl.getUniformLocation(p, n);
    this._u = {
      bones: U('uBones[0]'), swayQ: U('uSwayQ[0]'),
      swayBend: U('uSwayBend[0]'), whisker: U('uWhisker[0]'),
      place: U('uPlace'), xform: U('uXform'), groundY: U('uGroundY'),
      yaw: U('uYaw'), pitch: U('uPitch'),
      grow: U('uGrow'), unlitStart: U('uUnlitStart'),
      part: U('uPart[0]'), partB: U('uPartB[0]'), partNorm: U('uPartNorm[0]'),
      bonePart: U('uBonePart[0]'), boneRide: U('uBoneRide[0]'),
      tailRadius: U('uTailRadius'), tailBone: U('uTailBone'), inkOut: U('uInkOut'),
      faceLift: U('uFaceLift'), inkSink: U('uInkSink[0]'),
      inkMode: U('uInkMode'), ink: U('uInk'),
      keyLit: U('uKeyLit'), midTone: U('uMidTone'), shadowTone: U('uShadowTone'),
      lightDir: U('uLightDir'), bandEdge: U('uBandEdge'),
      unlitGain: U('uUnlitGain'), alpha: U('uAlpha'),
    };
  }

  /**
   * Where the floor is, and how far each authored pose has to be
   * dropped to reach it. Five 22k-vertex passes, once, at load.
   *
   * The floor is taken off the IDLE pose and not off the run, and that
   * choice is worth writing down: this rig swings its legs about fixed
   * hips while the root bobs, so a "planted" paw travels an arc and the
   * deepest run frames reach about a fifth of a unit lower than a
   * standing cat does. Stand everything on the run's minimum and the
   * idle cat hovers over the platform, which the eye has all the time
   * in the world to notice. Stand it on the idle and the run presses a
   * paw the same distance INTO the platform twice a stride, which reads
   * as weight. So: idle on the line, run allowed to press.
   */
  _measureGround() {
    const rig = this._rig, data = this._data;
    const colors = data.colors.get(this._skins[0]);
    const nv = data.header.vertexCount;

    const drv = new Driver();
    const sway = new Sway();
    // Right-facing rest: the standing bias points toward the camera,
    // which from ψ = +π/2 is the negative direction. The head does not
    // move the feet, so this only has to be representative.
    drv.pose.aimYaw = -this._restAim;
    drv.pose.aimWeight = 1;
    /* Let the tail chain and the speed easing settle. Stepped at
       MAX_SUB_DT and not at some convenient round number of its own:
       this is the same integrator under the same stability bound, and
       a settle loop that ignored it would hand `lowestY` a rig with a
       NaN tail. 2.25 s of it, as before. */
    for (let i = 0; i < Math.round(2.25 / MAX_SUB_DT); i++) {
      const p = drv.step(MAX_SUB_DT, 0, 0);
      sway.step(MAX_SUB_DT, drv.time, 0, 0, p);
    }
    const settled = drv.pose;
    settled.bob = 0;
    settled.headTilt = 0;

    rig.reset();
    applyPose(rig, settled);
    this.groundY = lowestY(rig.update(), data.position, colors, nv);

    /* Each authored pose rears up, squashes or splays, and each moves
       the lowest point of the animal by a different amount — four
       hand-tuned drops would go stale the moment a pose is touched, so
       the pose is measured and put down instead. The number ends up on
       the root's Y channel, which means it cross-fades with everything
       else for free. */
    this._groundAdjust = {};
    const B = rig._cache;
    for (const name of Object.keys(AUTHORED)) {
      const { fn, ground } = AUTHORED[name];
      if (!ground) { this._groundAdjust[name] = 0; continue; }
      rig.reset();
      applyPose(rig, settled);
      fn(rig, B);
      const my = lowestY(rig.update(), data.position, colors, nv);
      this._groundAdjust[name] = this.groundY - my;
    }
  }

}

/* ═══ the layer ═══════════════════════════════════════════════════ */

export class CatLayer {
  /**
   * Load `cat.bin` and take over the given canvas with a WebGL2
   * context. Rejects if WebGL2 is unavailable or the fetch fails, so
   * the caller can fall back to whatever it drew before.
   *
   * `opts.models` turns the one asset into the roster the layer will
   * hold: it is handed the parsed cat.bin and returns
   * `[{ id, data }, …]`. Left out, the layer holds the cat alone, which
   * is what it always held.
   *
   * @param {HTMLCanvasElement} canvas  the #fx canvas
   * @param {string} url                where cat.bin lives
   * @param {object} opts   `{ signal, boxW, boxH, models }`
   */
  static async load(canvas, url, opts = {}) {
    if (!canvas) throw new Error('cat: no canvas');
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok) throw new Error(`cat.bin: HTTP ${res.status}`);
    const data = parseCat(await res.arrayBuffer());
    const roster = opts.models ? opts.models(data) : data;
    return new CatLayer(canvas, roster, opts);
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object|Array} roster  one parsed asset, or `[{id, data}, …]`
   * @param {object} [opts]
   */
  constructor(canvas, roster, opts = {}) {
    this.canvas = canvas;
    this.boxW = opts.boxW || PLAYER_W;
    this.boxH = opts.boxH || PLAYER_H;
    /** The head's standing bias toward the viewer when there is no turn
        to lead. See REST_AIM; exposed so it can be dialled, or set to 0
        for a cat in strict profile, without editing the module. */
    this._restAim = opts.restAim == null ? REST_AIM : Math.abs(opts.restAim);
    /** `shape` (the default) draws the body as rounded rectangles and
        keeps only the ears and the face as triangles; `mesh` is the
        asset drawn whole, which is what this was before and is kept
        because it costs one branch and settles any argument about what
        the stylisation changed. */
    this._style = opts.style === 'mesh' ? 'mesh' : 'shape';
    this.lost = false;

    /** Live counters for the frame just drawn. */
    this.stats = { cats: 0, culled: 0, draws: 0, tris: 0 };

    const gl = canvas.getContext('webgl2', {
      // Transparent, because the platforms are on the Canvas2D layer
      // underneath and have to show through.
      alpha: true,
      depth: true,
      stencil: false,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      desynchronized: true,
    });
    if (!gl) throw new Error('cat: WebGL2 unavailable');
    this.gl = gl;

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });

    /* ── the roster ──
       One layer, many animals, and it has to be one layer: `begin`
       clears the canvas, so a second layer stacked on the same one
       would wipe the first, and two canvases cannot sort against each
       other's depth. A cat and a dog standing in front of one another
       is the whole reason this is a map and not a field.

       They share the context, the frame, the queue and the depth
       slices; what they do not share is the program, because that is
       compiled around the skeleton. See Model. */
    const list = Array.isArray(roster) ? roster : [{ id: 'cat', data: roster }];
    if (!list.length) throw new Error('cat: no models to draw');
    /** id → Model. Insertion order matters: the first is the default. */
    this._models = new Map();
    list.forEach(({ id, data }, i) => {
      const m = new Model(gl, data, { style: this._style, restAim: this._restAim });
      /* Where it sits in the roster, and the only thing `end` may sort
         models by. The obvious key — the program object — is an opaque
         handle, and comparing two of them with `<` coerces both to
         "[object Object]": every pair compares equal, the comparator
         stops being an ordering, and the sort quietly leaves the queue
         interleaved. Which costs a program switch per character. */
      m._order = i;
      this._models.set(id, m);
    });
    this._defaultId = list[0].id;

    /** id → per-character animation state. */
    this._cats = new Map();
    /** id → a heading pinned by the caller. See `pin`. */
    this._pins = new Map();
    /** Cats queued this frame, drawn in `end()`. */
    this._queue = [];
    this._frameOK = false;

    this._eyeScratch = { far: -1, scale: 1 };
    this._tones = {
      keyLit: [1, 1, 1], mid: [0.6, 0.6, 0.6], shadow: [0.3, 0.3, 0.3],
      key: [0, 1, 0], light: new Float32Array(3), unlitGain: 1, ink: INK.slice(),
    };
  }

  /**
   * A LOOK — which animal, wearing which colourway — resolved to the
   * pair the layer draws with.
   *
   * One flat string, "model/skin", because that is the shape the rest
   * of the game needs it in: it is stored, sent over the wire, checked
   * by the server and handed back here, and every one of those is
   * happier with one opaque token than with two fields that can
   * disagree. A bare "tabby" is the default model wearing it, which is
   * what every existing caller passes.
   *
   * Anything unrecognised falls back rather than throwing: a look is
   * data that arrived over a socket, and a character with a name this
   * build has never heard of should be drawn as SOMETHING.
   *
   * @param {string} look
   */
  _look(look) {
    const slash = typeof look === 'string' ? look.indexOf('/') : -1;
    const wanted = slash < 0 ? this._defaultId : look.slice(0, slash);
    const m = this._models.get(wanted) || this._models.get(this._defaultId);
    const skin = slash < 0 ? look : look.slice(slash + 1);
    return { m, skin: m._vaos.has(skin) ? skin : m._skins[0] };
  }

  /** Every look this layer can draw, as the flat ids `cat()` takes. */
  looks() {
    const out = [];
    for (const [id, m] of this._models) for (const sk of m._skins) out.push(`${id}/${sk}`);
    return out;
  }

  /* ── frame ────────────────────────────────────────────────────── */

  /** @param {number} cssW @param {number} cssH @param {number} dpr */
  resize(cssW, cssH, dpr) {
    try {
      const c = this.canvas;
      if (!Number.isFinite(cssW) || !Number.isFinite(cssH)) return;
      const d = Number.isFinite(dpr) && dpr > 0 ? Math.max(0.5, Math.min(dpr, 3)) : 1;
      const w = Math.max(1, Math.round(cssW * d));
      const h = Math.max(1, Math.round(cssH * d));
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      this._dpr = d;
    } catch (e) { /* never take the frame down */ }
  }

  /**
   * Start a frame: clear to transparent and work out the hour's light.
   *
   * @param {object} cam   {x, y} world-space camera top-left
   * @param {object} view  {w, h} world units visible
   * @param {object} sky   the object from daycycle.js skyAt()
   */
  begin(cam, view, sky) {
    this._frameOK = false;
    this._queue.length = 0;
    this.stats.cats = 0;
    this.stats.culled = 0;
    this.stats.draws = 0;
    this.stats.tris = 0;
    try {
      const gl = this.gl;
      if (!gl || this.lost || gl.isContextLost()) return;
      if (!cam || !view || !(view.w > 0) || !(view.h > 0)) return;

      const W = this.canvas.width, H = this.canvas.height;
      if (!(W > 0) || !(H > 0)) return;

      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      /* The 2D layer rounds the camera before it translates, so this
         has to round it the same way or the cat drifts up to a pixel
         against the platform it is standing on. */
      this._cam = { x: Math.round(cam.x), y: Math.round(cam.y) };
      this._view = { w: view.w, h: view.h };
      this._pxScale = W / view.w;          // device px per world px
      this._computeTones(sky);
      this._frameOK = true;
    } catch (e) {
      this._frameOK = false;
    }
  }

  /**
   * Queue one cat. Call between `begin()` and `end()`; the order of the
   * calls is the depth order, back to front, so ghosts go before the
   * local player.
   *
   * The pose is integrated HERE, with this character's own `dt`, even
   * for a cat that turns out to be off screen — a Driver that stops
   * being stepped resumes with a stale phase, and the gait would jump
   * the moment the character came back into view. The turn is
   * integrated in the same place and for the same reason: a character
   * that changed direction behind the camera should have finished
   * turning by the time it comes back.
   *
   * `facing` is +1 for screen-right and −1 for screen-left, and it is a
   * TARGET, not a transform. The cat turns to face it, head first,
   * taking about 224 ms to reverse; see TURN_RATE. Callers do not have
   * to debounce it — holding it steady, flipping it once, or flipping
   * it every frame are all sensible inputs and all animate sensibly.
   *
   * Anything BETWEEN −1 and +1 is a heading in between, and 0 is the
   * animal looking straight down the camera: the target is facing ×
   * π/2, and ψ is already measured from the camera precisely so that
   * "how far round" means something (see TURN_RATE). The game only ever
   * has a side to give, so it only ever passes ±1 and gets exactly what
   * it always did; the catalogue page is what wants the half-turns, and
   * it drives the same turn this way rather than reaching past it.
   *
   * `vy` is the character's vertical velocity in world px/s, screen
   * axis, so falling is POSITIVE. Optional, and a caller that leaves it
   * out gets what this always did — the tail simply does not know the
   * character is in the air. See AIR_TAU.
   */
  cat(id, x, y, facing, state, speed, dt, look, alpha, vy) {
    try {
      if (!this._frameOK) return;
      const st = STATES.indexOf(state) >= 0 ? state : 'idle';
      // A caller that leaves it out gets the right-facing profile, as
      // the old `facing < 0 ? -1 : 1` gave it.
      const dir = Number.isFinite(facing) ? Math.max(-1, Math.min(1, facing)) : 1;
      const { m, skin } = this._look(look);
      const c = this._catState(id, dir, m);
      /* `facing` is a target for the turn now, not a mirror flag: the
         cat is asked to face that way and takes TURN_RATE to get
         there. A caller that flips it every frame gets a cat rocking a
         few degrees in place — it never commits to either side — which
         is the honest picture of that input rather than a strobe. */
      this._poseCat(c, st, speed, dt, dir, vy || 0, this._pins.get(id));

      const a = alpha == null ? 1 : Math.min(1, Math.max(0, alpha));
      if (!(a > 0)) return;

      const boxW = this.boxW, boxH = this.boxH;
      /* Off-screen cats are posed but not drawn. This is culling, not a
         cap: every cat whose drawn pixels could land in the viewport is
         drawn, however many there are. The margin is generous because
         the cat overflows its box — the tail is carried up and back at
         45° and reaches twenty-nine px past the left edge at boxH = 40
         (thirty-one in `air`, and thirty-five on the way UP out of a
         jump, where TAIL_GA streams it backwards), inside the
         thirty-nine px `mx` gives it, and a reared `wall` pose is
         taller still. */
      const mx = boxW * 1.5, myTop = boxH * 1.2, myBot = boxH * 0.4;
      const cam = this._cam, view = this._view;
      if (x + boxW + mx < cam.x || x - mx > cam.x + view.w ||
          y + boxH + myBot < cam.y || y - myTop > cam.y + view.h) {
        this.stats.culled++;
        return;
      }

      this._queue.push({
        c, m, skin,
        centerX: x + boxW * 0.5,
        feetY: y + boxH,
        alpha: a,
      });
    } catch (e) { /* never take the frame down */ }
  }

  /** Draw everything queued this frame. */
  end() {
    try {
      if (!this._frameOK) return;
      const gl = this.gl;
      const q = this._queue;
      const n = q.length;
      if (!n) return;

      /* Depth slices, assigned by QUEUE order — the order the caller
         asked for — and then the queue is sorted by skin so the VAO
         binds at most three times. Sorting is safe precisely because
         the slice, not the draw order, decides what is in front. */
      for (let i = 0; i < n; i++) {
        // Cat 0 was queued first, so it belongs at the BACK: the
        // farthest slice, nearest to depth 1.
        q[i].near = (n - 1 - i) / n;
        q[i].far = (n - i) / n;
      }
      /* By MODEL first and then by skin: a model change costs a
         program and a fresh set of uniforms, a skin change costs a VAO
         bind, so the expensive one is the outer loop. */
      q.sort((a, b) => (a.m !== b.m
        ? a.m._order - b.m._order
        : (a.skin < b.skin ? -1 : a.skin > b.skin ? 1 : 0)));

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);

      /* NO BLENDING, and that is a decision rather than an oversight.

         This canvas is composited over the game by the browser, so a
         cat's own translucency is carried by the alpha it writes and
         needs no blend at all: the fragments are premultiplied
         (rgb × a, a) and simply replace what is under them, and the
         browser does the one real composite.

         Blending here would be actively WRONG. The cat is opaque
         geometry drawn in arbitrary triangle order; with blend on, a
         far fragment that happens to be drawn first and a near one that
         passes the depth test in front of it both contribute, so a
         ghost at alpha 0.58 comes out at 0.82 wherever it overlaps
         itself — an ear over a cheek, a tail over a flank — and the
         result is mottled. Replacement gives exactly one layer of the
         animal at exactly the alpha asked for.

         What it costs: a translucent cat in front of another cat
         replaces it rather than letting it show through. A depth
         prepass would fix that and would double the geometry for every
         ghost, which at 39 k triangles a cat is not a trade worth
         making for two characters that happen to overlap. */
      gl.disable(gl.BLEND);

      let boundModel = null, boundSkin = null;
      for (let i = 0; i < n; i++) {
        const item = q[i];
        if (item.m !== boundModel) {
          this._useModel(item.m);
          boundModel = item.m;
          boundSkin = null;
        }
        if (item.skin !== boundSkin) {
          gl.bindVertexArray(item.m._vaos.get(item.skin));
          boundSkin = item.skin;
        }
        this._drawOne(item);
      }
      gl.bindVertexArray(null);

      gl.depthRange(0, 1);
      this.stats.cats = n;
    } catch (e) { /* never take the frame down */ }
  }

  /**
   * Make one model current: its program, and everything on it that does
   * not change from character to character.
   *
   * Once per model per frame rather than once per frame, and that is
   * the whole cost of holding more than one — a uniform belongs to a
   * program, so a second animal means sending this block again. It is
   * about eighty floats.
   */
  _useModel(m) {
    const gl = this.gl, u = m._u, t = this._tones;
    gl.useProgram(m._prog);
    gl.uniform4f(u.xform,
        2 / this._view.w, -1 - 2 * this._cam.x / this._view.w,
        -2 / this._view.h, 1 + 2 * this._cam.y / this._view.h);
    gl.uniform1f(u.groundY, m.groundY);
    gl.uniform1i(u.unlitStart, m._unlitStart);
    const sh = m._shape;
      /* The bend's whole configuration, and it never changes after
         load — but a uniform is per-program state, so it is re-sent
         once a frame rather than tracked. Nine floats a part. */
    gl.uniform1iv(u.bonePart, sh ? sh.bonePart : m._noBend);
    gl.uniform1iv(u.boneRide, sh ? sh.boneRide : m._noBend);
      if (sh) {
        gl.uniform4fv(u.part, sh.pa);
        gl.uniform4fv(u.partB, sh.pb);
        gl.uniform1fv(u.partNorm, sh.pn);
        gl.uniform1i(u.tailBone, sh.tail.bone);
        gl.uniform1f(u.tailRadius, sh.tail.radius);
        gl.uniform1f(u.faceLift, FACE_LIFT);
      gl.uniform1fv(u.inkSink, m._inkSink);
      }
      gl.uniform3fv(u.keyLit, t.keyLit);
      gl.uniform3fv(u.midTone, t.mid);
      gl.uniform3fv(u.shadowTone, t.shadow);
      gl.uniform3fv(u.ink, t.ink);
      gl.uniform2f(u.bandEdge, BAND_EDGE[0], BAND_EDGE[1]);
      gl.uniform1f(u.unlitGain, t.unlitGain);

  }

  /**
   * One cat: two draw calls and 39,328 triangles, and there is no LOD
   * hiding behind that number.
   *
   * Making the cat rectangular did not change it. The bend is a dozen
   * lines at the end of the vertex shader, so the whole asset is still
   * submitted — which is the price of keeping the coat and the
   * shading, and the reason it is worth paying is in the note at the
   * top of this file.
   *
   * There is no honest LOD to add either. Counted per bone off
   * cat.bin, the lit group is body 4,472 / head 4,408 / ears 4,256 /
   * tail 2,148 / legs and paws 4,672, and the outline shell mirrors
   * it. Every one of those is silhouette, and the silhouette is now
   * the thing being shaped. The parts that ARE expendable at 40 px —
   * six whiskers at 116 triangles each — come to 1.8% of the mesh,
   * which is not an LOD, it is a rounding error.
   *
   * So what is done instead is all in the scheduling: off-screen cats
   * are skipped, the depth buffer is sliced instead of cleared 12
   * times, and the queue is sorted so three colourways cost three VAO
   * binds. The triangle count is what it is, and `stats` reports it.
   */
  _drawOne(item) {
    const gl = this.gl, m = item.m, u = m._u, c = item.c;

    /* Each cat gets its own slice of the depth range instead of a
       depth clear between cats. Twelve clears of a full-screen depth
       buffer is twelve full-screen writes a frame; twelve slices is
       twelve calls to depthRange and nothing else. The slices are
       disjoint, so no part of one cat can ever test against another —
       which a shared range would allow, since every cat maps the same
       model X to the same depth. A 24-bit buffer still leaves ~1.4 M
       levels inside a twelfth of the range, far more than a 3-unit-deep
       cat needs. */
    gl.depthRange(item.near, item.far);

    const S = this.boxH / m._unitsPerBoxH;         // world px per model unit
    gl.uniform4f(u.place, item.centerX, item.feetY, S, S);
    gl.uniform1f(u.alpha, item.alpha);

    /* The body's yaw, as the cosine and sine the shader wants. ψ is the
       animated angle; θ = ψ − π/2 is what actually turns the model, and
       cos(ψ−π/2) = sin ψ, sin(ψ−π/2) = −cos ψ, so the two trig calls
       here are the only ones the turn costs. */
    const sinP = Math.sin(c.yaw), cosP = Math.cos(c.yaw);
    gl.uniform2f(u.yaw, sinP, -cosP);
    gl.uniform2f(u.pitch, Math.cos(c.pitch), Math.sin(c.pitch));

    /* The key light swings its screen-horizontal component with the
       cat and keeps its depth and height fixed. sin ψ is exactly the
       right factor for that with no special cases: ±1 at the two
       profiles, which reproduces the old mirrored pair, and 0 at
       face-on, where a light biased to either side would be wrong and
       what is wanted is a key straight from the viewer and above. */
    const k = this._tones.key, L = this._tones.light;
    const lz = k[2] * sinP;
    const inv = 1 / Math.max(1e-4, Math.hypot(k[0], k[1], lz));
    L[0] = k[0] * inv; L[1] = k[1] * inv; L[2] = lz * inv;
    gl.uniform3fv(u.lightDir, L);

    gl.uniformMatrix4fv(u.bones, false, c.bones);
    gl.uniform4fv(u.swayQ, c.sway.qs);
    gl.uniform3fv(u.swayBend, c.sway.bend);
    gl.uniform2fv(u.whisker, c.sway.whiskers);

    /* Constant now, where the mirror used to make them depend on which
       way the cat faced: a yaw is a proper rotation and leaves winding
       alone. Solid geometry culls its back faces; the ink shell is an
       inverted hull, so it culls its FRONT faces and what survives is
       the inside of the far surface, drawn a little larger than the
       cat and therefore only visible around the edge. */

    gl.uniform1f(u.inkMode, 0);
    gl.uniform1f(u.inkOut, 0);
    gl.uniform1f(u.grow, 0);
    gl.cullFace(gl.BACK);
    for (const s of m._solid) {
      gl.drawElements(gl.TRIANGLES, s.count, m._indexType, s.start * m._indexBytes);
      this.stats.draws++;
      this.stats.tris += s.count / 3;
    }

    if (m._outline) {
      /* The ink is grown to a fixed number of CSS pixels rather than a
         fixed number of model units, so the line keeps its weight at
         every zoom. Device px per model unit is (world px per unit) ×
         (device px per world px); dividing the wanted CSS width by that
         and by dpr gives the growth in model units. */
      const perUnit = S * this._pxScale;
      const grow = Math.min(INK_GROW_MAX, (INK_PX * (this._dpr || 1)) / Math.max(perUnit, 1e-3));
      gl.uniform1f(u.inkMode, 1);
      gl.uniform1f(u.grow, grow);
      /* The same width, in the world px the bend works in. `grow` is
         still sent because the ears do not bend and still get their
         line from the hull the way they always did. */
      gl.uniform1f(u.inkOut, (INK_PX * (this._dpr || 1)) / Math.max(this._pxScale || 1, 1e-3));
      gl.cullFace(gl.FRONT);
      gl.drawElements(gl.TRIANGLES, m._outline.count, m._indexType,
        m._outline.start * m._indexBytes);
      this.stats.draws++;
      this.stats.tris += m._outline.count / 3;
    }
  }

  /**
   * Hold a character at an absolute heading instead of letting it turn
   * toward a `facing`, or pass null to give it back.
   *
   * `pitch` tips the VIEW up over the animal or down under it, also in
   * radians, positive looking down from above. It is a camera angle and
   * not a joint: the animal stays upright in the world and on its own
   * floor line, and what moves is where it is being seen from. Left out
   * or zero, the view is level, which is where the game always keeps
   * it.
   *
   * `yaw` is ψ, in radians, measured exactly as the turn measures it:
   * +π/2 is the right-facing profile, 0 is the animal looking down the
   * camera, −π/2 the left profile. Unlike `facing` it is NOT bounded to
   * those two ends and NOT wrapped — π is the animal's back, 3π is the
   * same back one and a half turns later, and both are drawn. The
   * bounds exist so that the GAME cannot accidentally show a character
   * from behind (see TURN_RATE); a caller that has asked for an angle
   * has not asked by accident.
   *
   * Keep it continuous across frames. The tail's spring chain is handed
   * the heading to trail, so a jump from π to −π is a real jump to it
   * and the tail cracks like a whip.
   *
   * While pinned the head stops leading: there is no turn left for it
   * to cover, and the resting bias toward the camera has no meaning
   * once the animal is past its own profiles. The gait still gets the
   * lean and the tail swish, taken from how fast the pin is actually
   * moving, so spinning one by hand looks like spinning an animal.
   *
   * @param {string} id
   * @param {number|null} yaw
   * @param {number} [pitch]
   */
  pin(id, yaw, pitch) {
    try {
      if (yaw == null || !Number.isFinite(yaw)) this._pins.delete(id);
      else this._pins.set(id, { yaw, pitch: Number.isFinite(pitch) ? pitch : 0 });
    } catch (e) { /* never take the frame down */ }
  }

  /** Drop per-cat state for a character that left. */
  forget(id) {
    try { this._cats.delete(id); this._pins.delete(id); } catch (e) { /* nothing to do */ }
  }

  /* ── per-character animation ──────────────────────────────────── */

  _catState(id, facing, m) {
    let c = this._cats.get(id);
    /* A character that changed ANIMAL starts again. Its channel buffers
       and its bone matrices are sized to the skeleton it was drawn with,
       and there is no sensible way to blend a cat's pose into a dog's —
       what a look change means is that a different creature is standing
       there now. Its id, and so its place in the depth order, is the
       one thing that survives. */
    if (c && c.m !== m) c = undefined;
    if (!c) {
      const drv = new Driver();
      /* The head's aim rides on the channel `pose.js` keeps for exactly
         this, and `aimWeight` is pinned at 1 for the character's whole
         life. The original faded this pair in and out because its cat
         was sometimes aiming at something and sometimes not; here the
         head is ALWAYS aimed — at the turn it is making, or, when there
         is no turn, at the camera — so the weight has nothing to say
         and the attack/release lives on the angle instead, where it can
         be asymmetric. `Sway.step` reads the same pair, which is what
         makes the whiskers trail the head that is actually drawn. */
      drv.pose.aimWeight = 1;

      /* A character arrives already facing the way it was asked to
         face: spawning at ψ = 0 would make every cat in the level turn
         to face outward on its first frame. */
      const yaw0 = facing * HALF_PI;
      const aim0 = facing < 0 ? this._restAim : -this._restAim;
      drv.pose.aimYaw = aim0;

      const sway = new Sway();
      /* The sway chains lag whatever drives them, so a chain full of
         zeros meeting a drive of ±π/2 on frame one would read as the
         cat's tail and whiskers being blown flat sideways for the
         quarter second they took to catch up. Seeded to the rest value
         instead, they start with no lag, which is what a cat standing
         still has. */
      sway.seed(yaw0, aim0);

      c = {
        m,
        drv,
        sway,
        state: null,
        /** ψ: 0 is nose-at-camera, ±π/2 the two profiles. See TURN_RATE. */
        yaw: yaw0,
        /** φ: the view's pitch, and zero for anything the game draws. */
        pitch: 0,
        /** The neck's own angle, added to ψ to get where the head points. */
        aim: aim0,
        /** Signed, −1…1, the gait's lean and tail-swish input. */
        turnRate: 0,
        /** vy, low-passed at AIR_TAU, in px/s. Zero is the honest
            seed: a character is spawned standing on something. */
        vySmooth: 0,
        chan: new Float32Array(m._chanN),
        blendFrom: new Float32Array(m._chanN),
        blendT: 1,
        bones: new Float32Array(m._rig.count * 16),
      };
      this._cats.set(id, c);
    }
    return c;
  }

  /**
   * Advance one character's turn by `d` seconds.
   *
   * Two things move: the body, at a fixed rate toward the profile it
   * has been asked for, and the head, which covers as much of what the
   * body has NOT yet done as the neck allows. That is the whole of
   * "the head leads and the body follows" — no second timeline, no
   * anticipation curve, just a neck that is quicker than a spine and a
   * standing bias toward the camera underneath for when there is no
   * turn left to lead.
   *
   * Called once per animation sub-step so the sway chains see a drive
   * that moves smoothly rather than one that jumps once a frame.
   */
  _turn(c, d, facing, pin) {
    /* Pinned: the caller owns ψ outright. Everything below this is
       about GETTING somewhere — a rate limit, the bounds, a head that
       leads and then unwinds — and none of it applies to an angle that
       has already been decided. What is still wanted is the lean and
       the tail swish, and those come from how far the pin moved, which
       is the same measurement the free turn makes. */
    if (pin != null) {
      const was = c.yaw;
      c.yaw = pin.yaw;
      c.pitch = pin.pitch;
      c.turnRate = d > 0
        ? Math.max(-1, Math.min(1, (c.yaw - was) / (TURN_LEAN_REF * d)))
        : 0;
      c.aim += (0 - c.aim) * (1 - Math.exp(-d / AIM_RELEASE));
      return;
    }
    c.pitch = 0;

    const target = facing * HALF_PI;

    /* No wrapping and no shortest-arc test: ψ and its target are both
       inside [−π/2, +π/2], so the difference is the turn, it is never
       more than π, and it goes through 0 — face-on — every time. This
       is the whole reason the parameter is measured from the camera
       rather than from the cat's own forward. */
    const before = c.yaw;
    const step = TURN_RATE * d;
    const delta = target - c.yaw;
    c.yaw += delta < -step ? -step : delta > step ? step : delta;
    if (c.yaw > HALF_PI) c.yaw = HALF_PI;
    else if (c.yaw < -HALF_PI) c.yaw = -HALF_PI;

    /* One turn signal for the gait, taken from the yaw that ACTUALLY
       happened rather than from the yaw that was asked for, so a cat
       already facing the right way contributes nothing and a cat whose
       turn is being reversed mid-flight gets the sign of the reversal
       on the frame it happens. */
    c.turnRate = d > 0
      ? Math.max(-1, Math.min(1, (c.yaw - before) / (TURN_LEAN_REF * d)))
      : 0;

    /* What is left of the turn is what the head tries to cover, plus
       the standing bias toward the camera, which points at ψ = 0 from
       whichever side the cat is on. During a reversal the bias is a
       rounding error against a π of remaining error; at rest it is all
       that is left. */
    const err = target - c.yaw;
    /* Signed off the target, so a heading of 0 — the animal already
       looking at the camera — asks for no bias at all, instead of the
       ±restAim that "which side is it on" would have to invent for a
       cat that is on neither. At ±1 it is the same number it was. */
    const bias = -this._restAim * Math.sign(target);
    let want = err + bias;
    if (want > HEAD_YAW_MAX) want = HEAD_YAW_MAX;
    else if (want < -HEAD_YAW_MAX) want = -HEAD_YAW_MAX;

    // Quick to commit, slower to unwind: the asymmetry is the follow-
    // through, and it is the only place the turn is not linear.
    const rate = Math.abs(want) > Math.abs(c.aim) ? AIM_ATTACK : AIM_RELEASE;
    c.aim += (want - c.aim) * (1 - Math.exp(-d / rate));

    /* And the head obeys the same rule as the body, one notch tighter:
       ψ + aim, the angle the head actually points at, is held inside
       ±(π/2 − restAim) — never further round than the head's own
       resting angle.

       Both halves of that are load-bearing and both were found by
       looking at frames rather than by reasoning.

       The outer bound first. The neck unwinds on a 0.14 s time
       constant and the body covers its last 0.9 rad in 64 ms, so
       without a bound the body arrives while the neck is still most of
       the way out and the head sails 30° PAST the far profile — the
       animal finishes a left turn looking over its own left shoulder,
       back of the head to the player, which is the one thing the whole
       parameterisation exists to prevent.

       Then the notch. Bounding at exactly ±π/2 fixed that but left the
       head dead edge-on for the five frames the neck took to unwind to
       its resting bias, and edge-on is precisely where this model has
       no face: the eyes are flat discs on the front of the skull, so
       the cat lost its face for about 80 ms at the end of every turn
       and then faded it back in. Bounding at the resting angle instead
       means the neck is ALREADY at its rest value the moment the body
       arrives, with nothing left to unwind and nothing to see.

       Clamping the stored angle rather than the drawn one is what
       makes it continuous: once the head is on the line, c.aim is
       pinned to (limit − ψ) and shrinks smoothly as the body rotates
       underneath it, so what is drawn is a head that locks onto the
       new direction and then holds dead still while the shoulders
       swing round to meet it. Which is what a cat does. */
    const limit = HALF_PI - this._restAim;
    const lo = -limit - c.yaw, hi = limit - c.yaw;
    if (c.aim < lo) c.aim = lo;
    else if (c.aim > hi) c.aim = hi;
  }

  /**
   * How much of the far eye to hide, and which eye that is.
   *
   * The head's angle to the camera is ψ + aim, and `sin` of it is the
   * one number both questions need: its magnitude is how side-on the
   * head is — 1 in profile, 0 face-on — and its sign says which eye is
   * the far one, because the far eye is the one at greater depth and a
   * yaw of θ = ψ − π/2 sends rest x to x·cos θ = x·sin ψ.
   *
   * Returns the fade as a multiplier on the eye's scale, so a pose that
   * has already done something to the eyes — `dead` squashes both —
   * keeps whatever it did to the eye that survives.
   */
  _eyeFade(c, out) {
    const s = Math.sin(c.yaw + c.aim);
    const m = Math.abs(s);
    /* Full profile hides it, face-on keeps it, and the crossover sits
       high: the eye only becomes a problem once it is far enough round
       to poke past the muzzle, and hiding it early would cost a cat
       three-quarter-on the eye that is doing all the work. */
    let k = (m - 0.62) / (0.94 - 0.62);
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    k = k * k * (3 - 2 * k);
    out.far = s >= 0 ? c.m._eyePlusX : c.m._eyeMinusX;
    out.scale = 1 - k;
    return out;
  }

  /**
   * Advance one character's pose by `dt` and leave its bone matrices in
   * `c.bones`.
   *
   * States are cross-faded rather than cut. When the state changes, the
   * pose being SHOWN at that instant is frozen into `blendFrom` and the
   * new state's pose is what the gait keeps driving; over BLEND_TIME
   * the frozen copy fades out. Freezing the old pose rather than
   * running two Drivers is what keeps the gait undamped — the live
   * animation is never lerped against a moving target, only against a
   * still one, so a cat that has been running for a while is running at
   * exactly the amplitude the Driver says.
   */
  _poseCat(c, state, speed, dt, facing, vy, pin) {
    const rig = c.m._rig;
    const d = Math.min(0.1, Math.max(0, dt || 0));
    const sp = Math.abs(speed) || 0;

    /* run/idle is not a state the caller has to be right about — it is
       whether the character is moving. A caller that says 'run' while
       standing on a platform gets an idle cat, which is what the eye
       expects. */
    const moving = state === 'run' && sp > IDLE_SPEED;
    const speed01 = moving ? Math.min(1, sp / REF_SPEED) : 0;
    const strideHz = moving
      ? Math.min(STRIDE_HZ_MAX, Math.max(STRIDE_HZ_MIN, sp / (STRIDE_PER_BOXH * this.boxH)))
      : undefined;

    /* Subdivided, so the spring chains stay inside their stability
       bound however long the frame was. See MAX_SUB_DT. */
    const steps = Math.max(1, Math.ceil(d / MAX_SUB_DT));
    const sd = d / steps;
    let p = c.drv.pose;
    for (let i = 0; i < steps; i++) {
      /* The turn first, because everything after it in this loop reads
         the result: the Driver takes `turnRate` as its lean and tail
         swish, `applyPose` puts `aimYaw` on the neck, and `Sway` is
         given ψ as the body heading its chains trail, so one turn moves
         the shoulders, the head, the whiskers and the tail together
         instead of four separate things being told about it. */
      this._turn(c, sd, facing, pin);
      c.drv.pose.aimYaw = c.aim;
      p = c.drv.step(sd, speed01, c.turnRate, strideHz);
      /* Smoothed in HERE and not once a frame, for the same reason the
         turn is integrated in here: the chains have to see a drive that
         moves, not one that arrives in steps. See AIR_TAU. */
      c.vySmooth += ((vy || 0) - c.vySmooth) * (1 - Math.exp(-sd / AIR_TAU));
      c.sway.step(sd, c.drv.time, c.yaw, p.bodyPitch, p,
        -c.vySmooth / PHYS.jumpVel);
    }

    /* Build the target channels: the gait first, then the authored
       state on top of it, so a cat frozen in `fall` still breathes and
       still has a tail that trails. */
    rig.reset();
    applyPose(rig, p);
    const authored = AUTHORED[state];
    if (authored) {
      authored.fn(rig, rig._cache);
      rig.position[rig._cache.root * 3 + 1] += c.m._groundAdjust[state];
    }
    /* Last, and multiplied rather than assigned, so it composes with
       both `applyPose` and the authored poses instead of overruling
       them: `dead` shuts the eyes by squashing them, and the eye that
       survives this has to stay shut. */
    const eye = this._eyeFade(c, this._eyeScratch);
    if (eye.far >= 0 && eye.scale < 1) {
      const e = eye.far * 3;
      rig.scale[e] *= eye.scale;
      rig.scale[e + 1] *= eye.scale;
      rig.scale[e + 2] *= eye.scale;
    }
    const target = packChannels(rig, c.m._scratch);

    if (c.state === null) {
      c.chan.set(target);
      c.state = state;
      c.blendT = 1;
    } else if (state !== c.state) {
      c.blendFrom.set(c.chan);
      c.state = state;
      c.blendT = 0;
    }

    if (c.blendT < 1) {
      c.blendT = Math.min(1, c.blendT + d / BLEND_TIME);
      const t = c.blendT;
      const k = t * t * (3 - 2 * t);            // smoothstep, so it eases out
      const from = c.blendFrom, out = c.chan;
      for (let i = 0; i < out.length; i++) {
        out[i] = from[i] + (target[i] - from[i]) * k;
      }
    } else {
      c.chan.set(target);
    }

    unpackChannels(rig, c.chan);
    c.bones.set(rig.update());
  }

  /* ── the hour → three tones ───────────────────────────────────── */

  _computeTones(sky) {
    const t = this._tones;
    const tint = (sky && sky.tint) || [1, 1, 1];
    const amb = (sky && sky.ambient) || [0.1, 0.12, 0.16];

    const band = (i) => [
      tint[0] * SHADE_KEY_GAIN * BAND_KEY[i] + amb[0] * SHADE_AMB_GAIN * BAND_AMB[i],
      tint[1] * SHADE_KEY_GAIN * BAND_KEY[i] + amb[1] * SHADE_AMB_GAIN * BAND_AMB[i],
      tint[2] * SHADE_KEY_GAIN * BAND_KEY[i] + amb[2] * SHADE_AMB_GAIN * BAND_AMB[i],
    ];
    const lit = band(0), mid = band(1), shadow = band(2);
    t.keyLit[0] = lit[0]; t.keyLit[1] = lit[1]; t.keyLit[2] = lit[2];

    /* The ratio the tone map ACTUALLY produces at a representative
       albedo — not the ratio of the linear values, which the shoulder
       of the curve would flatten into near-nothing between lit and mid. */
    const R = TONE_REF_ALBEDO;
    const ratio = (b) => {
      const out = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        const L = acesJS(lit[i] * R);
        out[i] = L > 1e-4 ? acesJS(b[i] * R) / L : 0;
      }
      return out;
    };
    /* Held inside a legible range by scaling all three channels
       together, which moves the step size without touching the hue —
       so a shadow stays as blue as the ambient makes it. */
    const hold = (r, lo, hi) => {
      const l = lum(r);
      const k = l > 1e-4 ? Math.min(hi, Math.max(lo, l)) / l : 0;
      return [r[0] * k, r[1] * k, r[2] * k];
    };
    const m = hold(ratio(mid), MID_RANGE[0], MID_RANGE[1]);
    const s = hold(ratio(shadow), SHADOW_RANGE[0], SHADOW_RANGE[1]);
    t.mid[0] = m[0]; t.mid[1] = m[1]; t.mid[2] = m[2];
    t.shadow[0] = s[0]; t.shadow[1] = s[1]; t.shadow[2] = s[2];

    /* How bright the hour is, as one number, for the two things that
       are not shaded: the eyes and the ink. */
    const gain = clamp01(acesJS(lum(lit) * 0.55));
    t.unlitGain = Math.max(0.30, gain);
    const inkGain = 0.55 + 0.45 * gain;
    t.ink[0] = INK[0] * inkGain;
    t.ink[1] = INK[1] * inkGain;
    t.ink[2] = INK[2] * inkGain;

    /* The key, in VIEW space, stored unnormalised because `_drawOne`
       swings its Z with the cat and has to normalise afterwards anyway.

       X is the depth axis: a fixed lean toward the viewer, because a
       light exactly edge-on to a profile leaves the whole near side in
       one tone and there is nothing to band. Y is the sun's height,
       straight from the day cycle. Z is screen-horizontal, and the 2D
       game reads the sun's x as its on-screen direction, so the sun's
       screen-x is what goes there. */
    const dir = (sky && sky.dir) || [0, 1, 0];
    t.key[0] = -KEY_TOWARD_VIEWER;
    t.key[1] = dir[1] * KEY_SUN_Y + KEY_LIFT;
    t.key[2] = dir[0];
  }

  /** Release the GPU objects. */
  dispose() {
    try {
      const gl = this.gl;
      for (const m of this._models.values()) m.dispose();
      this._models.clear();
      this._cats.clear();
    } catch (e) { /* nothing to do */ }
  }
}
