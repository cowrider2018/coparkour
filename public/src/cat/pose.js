/* ── src/cat/pose.js ─────────────────────────────────────────────────
   What the cat is doing, and how that reaches the bones.

   Adapted from `src/scenes/cat/pose.js` of the project that baked
   `assets/cat.bin`. This is the REAL gait, not a re-invention: the
   stride rate, the swing amplitudes, the diagonal pairing, the knee's
   quarter-cycle lag, the two-bobs-per-stride and the tail's spring
   chain are all the original's own numbers.

   What has been trimmed: everything about water. The upstream scene had
   a lake and a swim/paddle blend crossfaded against the walk; a parkour
   game has neither, so `swim` is gone and with it the paddle constants,
   the tail's flip/lay-back, and the float. The `water > 0` branches in
   the sway chain are therefore removed rather than left permanently
   false. Nothing on the dry-land path has been changed.

   `Driver` also wanted a world to walk on: it does not read terrain
   directly, it only takes `speed` (0…1) and `turn` (-1…1). This game
   has no terrain to hand it either — the cat runs on flat platforms —
   so cat.js drives it with FLAT GROUND and NO STEERING (`turn` is
   always 0), and feeds `speed` from the character's own |vx|. One
   `Driver` and one `Sway` per character, stepped with the real dt, so
   the gait is continuous rather than sampled.

   Two halves, deliberately separate:

     Driver     decides the pose — a walk cycle when it is moving, idle
                breathing when it is not
     applyPose  writes that pose onto the rig
   ------------------------------------------------------------------ */

/* Rest offsets the model bakes in and the pose has to build on top of.

   HEAD_LEAN was 0.12 — the bake tips the head about seven degrees
   nose-down, which on a cat that is standing still reads as sulking.
   Standing still it should be LEVEL, looking straight down the line it
   is about to run along, so the rest lean is gone and the gait's own
   `headPitch` is left to do all of it. */
const HEAD_LEAN = 0;      // the head is level at rest
const TAIL_REST = -0.15;  // tail's resting roll

/* ── the tail's spring chain ──
   A tail is not a stick. It is carried by the body, and every point
   along it is dragged by the point nearer the base — so the tip is the
   last thing to start moving and the last thing to stop.

   Modelled as a chain of nodes, each pulled toward its inboard
   neighbour by a spring. The pull is one-way: a node never tugs back on
   the one ahead of it, so the body leads and the tail follows.

   Sixteen segments and not eight, and the number is load-bearing: the
   turn a segment carries is what folds a tube, and halving the angle
   per segment takes the margin back. */
const SEG = 16;

/* ── and what that doubling did to the spring ──
   CH_K = 240 / CH_C = 15 are the model's own numbers — `tools/cat-model.js`
   in the reference project tunes them, and it tunes them for a chain of
   EIGHT stages. `pose.js` doubled the stage count for a GEOMETRIC reason
   (maxTurn, above) and carried the spring over untouched, which is where
   the wave in the tail came from.

   A stage is a second-order lag: ω = √K, ζ = C/(2√K) = 0.484.
   Under-damped, so a stage AMPLIFIES near its own frequency — 1.18×
   at the peak — and lags it by up to 66°. Neither matters
   once; both compound down a cascade. At eight stages that is 3.7× and
   a bit over half a wave, which is the trailing tail the model wanted.
   At sixteen it is 14× and three full waves: measured on the chain, a
   0.20 rad swish arrives at the tip as 1.9 rad, with the middle of the
   tail on the far side of the drive from both ends. That is not a tail
   following a body, it is a standing wave, and the eye reads it as the
   tail shaking.

   The reference never met it because its stride rate is capped at
   STRIDE_HZ = 1.45 Hz. This game drives the phase from px/s instead
   (cat.js's strideHz), so the stride sweeps 0.55 → 3.6 Hz on every
   acceleration and parks the drive right on the resonance.

   So the chain is stated the way it is actually meant, in terms that
   do not move when SEG does:

     CH_LAG   how long the tip takes to hear about the base. A stage's
              group delay at low frequency is C/K, so the chain's is
              SEG·C/K — 8 × 15/240 = 0.5 s for the model, and that is
              the number worth keeping, because it is what "soft" means
              here. It is SEG-free by construction.
     CH_ZETA  per-stage damping. 1/√2 is not a taste call: it is
              exactly where a second-order lag stops peaking. At or
              above it no frequency is amplified by a stage, so no
              number of stages can build a wave, whatever the stride
              rate does.

   K and C follow: C = 2ζ√K and SEG·C/K = CH_LAG give
   √K = 2·SEG·ζ/CH_LAG. At SEG = 16 that is 2048 and 64.
   Change SEG and they re-derive; the tail keeps the same softness and
   still cannot resonate. */
const CH_LAG = 0.5;
const CH_ZETA = Math.SQRT1_2;
const CH_K = (2 * SEG * CH_ZETA / CH_LAG) ** 2;   // 2048
const CH_C = 2 * CH_ZETA * Math.sqrt(CH_K);       // 64

/* ── the tail's own line ──
   Where the rest pose puts the centre of the tail at each node,
   measured off the mesh rather than assumed: the bake curves this tail
   hard — nearly four tenths of its length off the chord — so a bend
   applied about a straight axis would be bending the wrong thing.

   Each ring is *moved* rather than swung: rotated about its own place
   on this line, and then set down on the line's bent copy, which the
   CPU integrates one segment at a time. Rings can no longer pass
   through each other, because nothing is being swung past anything.

   KEEP IN STEP with the copy in the vertex shader in cat.js. */
export const TAIL_AXIS = [
  [0.0143, 0.0418, -0.0334],
  [0.0143, 0.1674, -0.1336],
  [0.0143, 0.3348, -0.2673],
  [0.0143, 0.4601, -0.3679],
  [0.0143, 0.6222, -0.5078],
  [0.0140, 0.8239, -0.6916],
  [0.0140, 0.9426, -0.7806],
  [0.0141, 1.0988, -0.8711],
  [0.0143, 1.2850, -0.9439],
  [0.0140, 1.5485, -0.9984],
  [0.0140, 1.7333, -0.9876],
  [0.0140, 1.8596, -0.9510],
  [0.0141, 2.0868, -0.8062],
  [0.0139, 2.2143, -0.6736],
  [0.0140, 2.2832, -0.5405],
  [0.0142, 2.3377, -0.3679],
  [0.0014, 2.3985, -0.1488],
];

/** How thick the tail is, measured off the mesh: the mean distance of
    its vertices from its own centreline. It is what decides how far the
    thing can be bent — see maxTurn. */
const TAIL_RADIUS = 0.215;

/* The same line, chewed once at load: which way each segment runs, how
   long it is, and how far it is allowed to turn. */
const TAIL_SEG = (() => {
  const out = [null];
  for (let i = 1; i < TAIL_AXIS.length; i++) {
    const d = [
      TAIL_AXIS[i][0] - TAIL_AXIS[i - 1][0],
      TAIL_AXIS[i][1] - TAIL_AXIS[i - 1][1],
      TAIL_AXIS[i][2] - TAIL_AXIS[i - 1][2],
    ];
    const len = Math.hypot(d[0], d[1], d[2]);
    out.push({ dir: d.map((v) => v / len), len });
  }

  /* How far each segment is allowed to turn. A ring of radius r carried
     along a line that turns dθ over a length ds sweeps its inside edge
     backwards by r·dθ while the line goes forward by ds, so once
     r·dθ/ds passes one the inside of the bend travels further back than
     the segment travels forward and the surface passes through itself.
     Equivalently: the radius a thing is bent to may not go below the
     radius of the thing.

     Nine tenths of the limit, because the rings between two nodes are
     blended rather than placed exactly, and the blend needs somewhere
     to be wrong. */
  for (let i = 1; i < out.length; i++) {
    out[i].maxTurn = 0.9 * out[i].len / TAIL_RADIUS;
  }
  return out;
})();

/* ── the tail's resting line ──
   The bake's tail is a hook, and it is the wrong hook. Measured off
   TAIL_AXIS it leaves the rump 39° BEHIND vertical, sweeps up and back,
   then curls 75° FORWARD at the tip — 113° of turn, three quarters of
   it in the last third. Standing still, that reads as a scorpion.

   What an idle cat carries is a tail up and BACK off the rump, curving
   evenly the whole way, so that is the line stated here: out of the
   body at 45° above the horizontal and turning at one steady rate
   along its length — a circular arc, no straight run and no hinge.
   Backwards and not forwards is not a taste call — the root sits at
   z = −0.70 and the body runs forward of it to z ≈ +1.0, so a tail
   bent forwards is a tail bent through the animal.

   Two pieces do it, and they have to be two, because the chain cannot
   set the root on its own: segment 1 may only turn `maxTurn` = 38.6°
   away from the ring at node 0, and a root angle is a turn the whole
   tail makes at once. Asking the chain for it would sit the first
   segment on its fold limit and pinch the tube there.

     TAIL_LIFT  a pitch on the tail BONE, which carries the whole tail
                and its base ring together — no turn, nothing to pinch
     TAIL_SET   the rest of it, per node, on the same channel the sway
                already bends the tail with

   TAIL_SET is a difference and not a shape: at each node it is the
   angle the line wants, less the angle the bake has, less the lift the
   bone has already applied. TAIL_LIFT is therefore not free — it is
   whatever makes that difference ZERO at node 1, so the root arrives
   with no turn in it at all. Move TAIL_ROOT and TAIL_LIFT follows.

   The whole of it is a REST shape, so it is on every state, not just
   idle — the authored poses in cat.js swing the tail from here. */

/* Angles off straight up, positive forward, in the tail's own space. */
const TAIL_ROOT = -1.45;  // −45°: the root leaves the rump at 45° above
                           // the horizontal, pointing back
const TAIL_RAISE = 0.15;   // 尾根抬高，模型單位；正值往上
const TAIL_FURL = 0.35;  // and bends a further 45° by the tip, spread
                           // evenly — see the loop below. Eighty degrees
                           // was right when the first half was held
                           // straight; spread over the whole length the
                           // same eighty lays the tail out flat

/** What the tail BONE carries, so that TAIL_SET[1] comes out at zero:
    the root angle wanted, less the one the bake's first segment has
    (−38.6°). */
export const TAIL_LIFT = TAIL_ROOT - Math.atan2(TAIL_SEG[1].dir[2], TAIL_SEG[1].dir[1]);

const TAIL_SET = (() => {
  const total = TAIL_SEG.reduce((a, s) => a + (s ? s.len : 0), 0);
  const out = new Float64Array(TAIL_SEG.length);
  let run = 0;
  for (let i = 1; i < TAIL_SEG.length; i++) {
    const seg = TAIL_SEG[i];
    run += seg.len;
    /* LINEAR in arclength, which is the whole point of it: turning by
       the same angle over every unit of length is constant curvature,
       and constant curvature is a circular arc. Anything with a shape
       to it — a smoothstep, an ease, holding the first half straight —
       puts the curvature somewhere rather than everywhere, and what
       the eye reads then is a straight run with a bend in it: one
       hinge, not a tail. Just under three degrees per segment, all
       sixteen of them. */
    const o = run / total;
    const want = TAIL_ROOT + TAIL_FURL * o;
    // Where the bake already points this segment.
    const have = Math.atan2(seg.dir[2], seg.dir[1]);
    out[i] = want - have - TAIL_LIFT;
  }
  return out;
})();

/* Gains from body motion to tail deflection. The bake's own numbers. */
const TAIL_GY = 0.30;  // to yaw — the sideways swish when it turns
const TAIL_GP = 0.30;  // to pitch — the fore-and-aft float

/* ── and the gain from the body being FLUNG ──
   A third channel, and it needs to be a third rather than more of
   TAIL_GP, because it is a different kind of motion and it bends the
   tail into a different shape.

   `lag(o)` on its own is the right answer for a body that TURNS: a limp
   tail left behind by a rotation is counter-rotated as one rigid piece,
   every node by the same angle, and that flat profile is what the eye
   reads as a tail hanging while the cat turns under it. TAIL_GY and
   TAIL_GP are unweighted for exactly that reason.

   A body that ACCELERATES ALONG A LINE leaves a completely different
   shape behind. There is no rotation to counter; there is a transverse
   drag spread down a cantilever, and a cantilever's slope starts at
   nothing where it is clamped and grows to its most at the free end.
   Feeding that through an unweighted `lag(o)` gives the flat profile
   again — measured at the takeoff frame, every node from the third
   outward sat on the same 0.086 rad, which is the whole tail swinging
   as a stick and not a tail at all.

   So this one is scaled by outerness, the same way the breeze above is
   and for the same reason: the base stays put and the far end is what
   travels. Linear in `o`, which is the honest resolution here — a real
   cantilever's slope goes as 3o − 3o² + o³ under a uniform load, and
   this tail's load is not uniform anyway because its mass tapers.

   The chain is still doing the timing. Weighting alone would bend the
   tail into the right SHAPE instantly; the chain is what makes the
   base arrive at it first and the tip a fifteenth of a second later. */
const TAIL_GA = 0.80;  // to being flung — the drag through a jump

/* Whiskers follow the head rather than the body, and barely move. */
const WHISKER_GY = 0.12;
const WHISKER_GP = 0.12;

/* ── quaternions ── (x, y, z, w), same convention as everywhere here. */
const qMul = (a, b, out) => {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
};
/** A turn about one of the three axes: 0 = x, 1 = y, 2 = z. */
const qAxis = (axis, angle, out) => {
  out[0] = out[1] = out[2] = 0;
  out[axis] = Math.sin(angle * 0.5);
  out[3] = Math.cos(angle * 0.5);
  return out;
};
const qRot = (q, v, out) => {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  out[0] = v[0] + w * tx + y * tz - z * ty;
  out[1] = v[1] + w * ty + z * tx - x * tz;
  out[2] = v[2] + w * tz + x * ty - y * tx;
  return out;
};

class Chain {
  constructor() {
    this.a = new Float64Array(SEG + 1);
    this.v = new Float64Array(SEG + 1);
  }

  /** Advance one step, with the base pinned to whatever drives it. */
  step(drive, d) {
    const { a, v } = this;
    a[0] = drive;
    v[0] = 0;
    for (let i = 1; i <= SEG; i++) {
      const acc = CH_K * (a[i - 1] - a[i]) - CH_C * v[i];
      v[i] += acc * d;
      a[i] += v[i] * d;
    }
  }

  /** Fill the chain with one value, at rest. Not in the original,
      which only ever started its chains at zero because its cat always
      started at heading zero; here a character can be spawned already
      facing left, and a chain of zeros meeting a drive of −π/2 would
      read as a tail blown flat sideways for the quarter second it took
      to catch up. */
  seed(v) {
    this.a.fill(v);
    this.v.fill(0);
  }

  /** How far the point at `o` (0 base → 1 tip) trails the base. */
  lag(o) {
    const x = o * SEG;
    let i = Math.floor(x);
    if (i >= SEG) i = SEG - 1;
    const f = x - i;
    return this.a[i] * (1 - f) + this.a[i + 1] * f - this.a[0];
  }
}

/* ── breeze ──
   Independent of the lag: a tail is never quite still. Two slow sines
   beating against each other so it never repeats visibly, scaled by
   outerness so the base stays put and only the tip drifts. */
const windAz = (o, t) => (0.05 * Math.sin(t * 1.3 + o * 2.0) + 0.03 * Math.sin(t * 0.7 + 0.5)) * o;
const windAx = (o, t) => 0.035 * Math.sin(t * 1.0 + o * 1.6 + 1.0) * o;

/**
 * The tail's softness, as SEG+1 frames the vertex shader can
 * interpolate between: a rotation per node and the place that node's
 * ring has been carried to. The pair of them is an arc; either one
 * alone is a crease.
 */
export class Sway {
  constructor() {
    this.yaw = new Chain();
    this.pitch = new Chain();
    /** What the body's own travel through the air drags the tail
        through. Its own chain and not the pitch one, because the two
        are weighted differently down the length — see TAIL_GA. */
    this.air = new Chain();
    /** The head's own chains. Whiskers hang off the head, not the body,
        so they trail a turn of the neck the body never made. */
    this.headYaw = new Chain();
    this.headPitch = new Chain();
    this.qs = new Float32Array((SEG + 1) * 4);
    this.bend = new Float32Array((SEG + 1) * 3);
    // Scratch, so a frame allocates nothing.
    this._q = new Float64Array(4);
    this._tmp = new Float64Array(4);
    this._acc = new Float64Array(4);
    this._prevQ = new Float64Array(4);
    this._v = new Float64Array(3);
    /** (ay, az) per node for the whiskers, for one side of the face. */
    this.whiskers = new Float32Array((SEG + 1) * 2);
    this.count = SEG + 1;
  }

  /** Start every chain at the heading the character is spawned with,
      so its first frame has no lag in it. `aim` is the neck's own
      angle, which the head chains are driven by on top of the body's.
      See `Chain.seed`. */
  seed(yaw, aim) {
    this.yaw.seed(yaw);
    this.pitch.seed(0);
    this.air.seed(0);
    this.headYaw.seed(yaw + aim);
    this.headPitch.seed(0);
  }

  /**
   * @param {number} d      seconds, already clamped
   * @param {number} t      wall time, for the breeze
   * @param {number} yaw    the body's heading
   * @param {number} pitch  the body's pitch
   * @param {object} pose   the frame's pose
   * @param {number} [air]  how hard the character is being flung along
   *   its own vertical, normalised so that ±1 is a full-speed jump.
   *   Dimensionless on purpose: the caller knows how fast a character
   *   can travel, this file knows how much tail that is worth. Left out
   *   it is zero, which is a character that never leaves the ground.
   */
  step(d, t, yaw, pitch, pose, air) {
    /* The swish drives the same chain as the body's turn, so a
       deliberate flick also arrives at the tip late rather than moving
       the whole tail as one rigid piece. */
    this.yaw.step(yaw + pose.tailSwish, d);
    this.pitch.step(pitch, d);
    this.air.step(air || 0, d);

    // The head's absolute aim: where the body points, plus where the
    // neck is turned on top of it. Same multipliers `applyPose` uses.
    this.headYaw.step(yaw + pose.headYaw * 0.85 + pose.aimYaw * pose.aimWeight, d);
    this.headPitch.step(pitch + pose.headPitch * 0.8 + pose.aimPitch * pose.aimWeight, d);

    const q = this._q, tmp = this._tmp, acc = this._acc, v = this._v;
    q[0] = q[1] = q[2] = 0; q[3] = 1;
    this.qs[0] = 0; this.qs[1] = 0; this.qs[2] = 0; this.qs[3] = 1;
    this.bend[0] = this.bend[1] = this.bend[2] = 0;
    this.whiskers[0] = this.headYaw.lag(0) * WHISKER_GY;
    this.whiskers[1] = this.headPitch.lag(0) * WHISKER_GP;

    const prev = this._prevQ;
    prev[0] = prev[1] = prev[2] = 0; prev[3] = 1;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 1; i <= SEG; i++) {
      const o = i / SEG;
      const seg = TAIL_SEG[i];

      // The frame starts at the bake's rest shape; TAIL_SET restates
      // that line as the one an idle cat carries, and the walk's own
      // chain is laid on top of both.
      q[0] = 0; q[1] = 0; q[2] = 0; q[3] = 1;
      qMul(qAxis(2, this.yaw.lag(o) * TAIL_GY + windAz(o, t), tmp), q, acc);
      qMul(qAxis(0, TAIL_SET[i] + this.pitch.lag(o) * TAIL_GP
        + this.air.lag(o) * TAIL_GA * o + windAx(o, t), tmp), acc, q);

      /* And now the rule. The turn this segment is actually making is
         the frame it ends at against the one before it; if that is more
         than the segment can carry, the axis is kept and the angle is
         cut back to the ceiling. Nothing downstream of here can fold. */
      tmp[0] = -prev[0]; tmp[1] = -prev[1]; tmp[2] = -prev[2]; tmp[3] = prev[3];
      qMul(tmp, q, acc);                      // the segment's own turn
      const half = Math.acos(Math.min(1, Math.abs(acc[3])));
      if (half * 2 > seg.maxTurn) {
        const sn = Math.sin(half);
        const k = sn > 1e-9 ? Math.sin(seg.maxTurn * 0.5) / sn : 0;
        const w = Math.cos(seg.maxTurn * 0.5) * (acc[3] < 0 ? -1 : 1);
        acc[0] *= k; acc[1] *= k; acc[2] *= k; acc[3] = w;
        qMul(prev, acc, q);
      }
      prev[0] = q[0]; prev[1] = q[1]; prev[2] = q[2]; prev[3] = q[3];

      this.qs[i * 4] = q[0];
      this.qs[i * 4 + 1] = q[1];
      this.qs[i * 4 + 2] = q[2];
      this.qs[i * 4 + 3] = q[3];

      // Where that leaves this segment, and where its ring ends up.
      v[0] = seg.dir[0] * seg.len;
      v[1] = seg.dir[1] * seg.len;
      v[2] = seg.dir[2] * seg.len;
      qRot(q, v, acc);
      cx += acc[0] - v[0];
      cy += acc[1] - v[1];
      cz += acc[2] - v[2];
      this.bend[i * 3] = cx;
      this.bend[i * 3 + 1] = cy;
      this.bend[i * 3 + 2] = cz;

      // No breeze on these: a whisker is far too stiff for it.
      this.whiskers[i * 2] = this.headYaw.lag(o) * WHISKER_GY;
      this.whiskers[i * 2 + 1] = this.headPitch.lag(o) * WHISKER_GP;
    }
    return this.qs;
  }
}

/* ── gait ──
   A cat walks diagonally: front-left with hind-right. One phase drives
   everything, with the two diagonals half a cycle apart. */
export const STRIDE_HZ = 1.45;   // cycles per second per unit of speed
const SWING_HIND = 0.55;  // hind leg swing amplitude, radians
const SWING_KNEE = 0.34;  // knee follows the hip, lagging a quarter turn
const SWING_FRONT = 0.62; // front leg swing
const BOB_AMP = 0.055;    // vertical travel of the whole body per step

/** The idle drift's slowest term: the tail's own sine, at 1.1 rad/s. */
export const IDLE_HZ = 1.1 / (Math.PI * 2);

export class Driver {
  constructor() {
    this.phase = 0;
    this.time = 0;
    this.speed = 0;      // smoothed, so the gait does not snap on keydown
    this.turn = 0;

    this.pose = {
      headPitch: 0, headYaw: 0, headTilt: 0,
      earL: 0, earR: 0,
      tailYaw: 0, lean: 0, bob: 0,
      tailSwish: 0,
      bodyYaw: 0, bodyPitch: 0,
      eyeOpen: 1,
      // Named by diagonal, not by side: A is one hind leg plus the front
      // leg across from it, B is the other pair. Which physical legs
      // those are is settled in `buildCache`.
      hipA: 0, kneeA: 0, shoulderA: 0,
      hipB: 0, kneeB: 0, shoulderB: 0,
      /* Where the head is being aimed, over and above whatever the gait
         is doing with it, and how much of that to apply. */
      aimYaw: 0, aimPitch: 0, aimWeight: 0,
    };
  }

  /**
   * @param {number} dt      seconds
   * @param {number} speed   0…1, how hard it is being driven forward
   * @param {number} turn    -1…1, steering, for the lean into a corner
   * @param {number} [strideHz]  strides per second, overriding the
   *   built-in `STRIDE_HZ × speed`. THE ONE ADDITION TO THE ORIGINAL.
   *
   *   Upstream, stride rate and swing amplitude were the same number:
   *   `speed` scaled both, so a cat could only ever run at the one pace
   *   the constant described. That is fine for a scene where the cat
   *   sets its own speed and wrong here, where the game says how fast
   *   the character is moving and the legs have to agree with the
   *   ground. Splitting them lets `speed` keep doing what it always did
   *   — amplitude, bob, pitch, ears — while the phase advances at
   *   whatever rate the caller's px/s implies. Passing nothing gives
   *   exactly the original behaviour.
   */
  step(dt, speed, turn, strideHz) {
    const d = Math.min(0.05, Math.max(0, dt));
    this.time += d;

    // Ease into and out of the gait. Stepping straight from 0 to full
    // stride on a keypress reads as a glitch, not as a cat.
    this.speed += (speed - this.speed) * (1 - Math.exp(-d * 9));
    this.turn += (turn - this.turn) * (1 - Math.exp(-d * 6));

    const p = this.pose;
    const s = this.speed;
    const t = this.time;

    // A walk's stride advances with speed so the feet keep pace with the
    // ground instead of scrubbing along it.
    const drive = s;
    const rate = strideHz === undefined
      ? STRIDE_HZ * Math.max(drive, 0.0001)
      : Math.max(0, strideHz);
    this.phase += d * rate * Math.PI * 2;
    // A while, not an if: a caller handing over a big dt and a fast
    // stride can wrap more than once, and one subtraction would leave
    // the phase outside its range for the rest of the run.
    while (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;

    const a = this.phase;
    const legs = drive;

    /* Which legs go together. One diagonal swings while the other is
       planted, half a cycle apart: a hind leg and the front leg *across*
       from it move together. That is what a walk is, and pairing
       same-side legs instead gives a rocking horse. */
    const swingA = Math.sin(a), swingB = -swingA;

    p.hipA = swingA * SWING_HIND * legs;
    p.hipB = swingB * SWING_HIND * legs;
    p.shoulderA = swingA * SWING_FRONT * legs;
    p.shoulderB = swingB * SWING_FRONT * legs;

    // The knee trails the hip — the lower leg is still catching up when
    // the thigh has already reversed, which is what makes a walk read as
    // jointed rather than as a pendulum.
    p.kneeA = Math.max(0, Math.sin(a - Math.PI / 2)) * SWING_KNEE * legs;
    p.kneeB = Math.max(0, Math.sin(a + Math.PI / 2)) * SWING_KNEE * legs;

    // Two bobs per stride — the body rises on each diagonal, not once
    // per cycle. Idle breathing takes over as the gait fades out.
    p.bob = Math.sin(a * 2) * BOB_AMP * s + Math.sin(t * 1.6) * 0.012 * (1 - s);
    p.bodyPitch = -s * 0.10 + Math.sin(a * 2 + 1.0) * 0.02 * s;

    // Lean into the turn, and let the tail counterweight it.
    p.lean = -this.turn * 0.16 * Math.max(s, 0.35);
    const swish = Math.sin(t * 1.1) * 0.10 * (1 - s)     // idle drift
      + Math.sin(a + 0.6) * 0.20 * s                     // sway with the gait
      + this.turn * 0.28;                                // swing wide on a corner

    p.tailSwish = swish;
    // The bone carries the walk's flick and nothing else.
    p.tailYaw = swish;

    // The head leads the turn and lifts a little at speed.
    p.headYaw = this.turn * 0.30;
    p.headPitch = -s * 0.10;
    p.headTilt = Math.sin(t * 0.7) * 0.03 * (1 - s);

    // Ears flick back as it picks up speed, and twitch at rest.
    const twitch = Math.max(0, Math.sin(t * 0.9) - 0.96) * 12;
    p.earL = -s * 0.22 + twitch * (1 - s);
    p.earR = -s * 0.22 - twitch * (1 - s) * 0.6;

    /* The original blinked here, on a random timer. Left open: every
       character in the room shares this one module, and a blink driven
       off Math.random would have each client blinking its ghosts at
       different moments, which reads as flicker rather than as life.
       `eyeOpen` is still a channel, and cat.js squashes it for 'dead'. */
    p.eyeOpen = 1;
    return p;
  }
}

/* ═══ pose → bones ════════════════════════════════════════════════ */

/**
 * Resolve the bones once, and resolve the legs by *where they are*
 * rather than by what they are called.
 *
 * The upstream model names its two pairs from opposite ends —
 * `hindHips[s < 0 ? 'R' : 'L']` against `frontPaws[s < 0 ? 'L' : 'R']` —
 * so `hipHL` sits at x = +0.82 while `pawFL` sits at x = −0.35.
 * Trusting those names pairs each hind leg with the front leg on its
 * *own* side, and the cat walks like a rocking horse.
 *
 * A cat's walk is diagonal. The only thing that reliably says which
 * flank a leg is on is its rest position, so that is what decides here.
 */
function buildCache(rig) {
  const xOf = (name) => rig.rest.position[rig.bone(name) * 3];
  const side = (a, b) => (xOf(a) > xOf(b) ? [a, b] : [b, a]);

  const [hindPlus, hindMinus] = side('hipHL', 'hipHR');
  const [frontPlus, frontMinus] = side('pawFL', 'pawFR');
  // The knee hangs off its own hip, so it follows whichever hip it is
  // parented to rather than being resolved separately.
  const kneeOf = { hipHL: 'pawHL', hipHR: 'pawHR' };

  return {
    root: rig.bone('root'), torso: rig.bone('torso'),
    bodyPivot: rig.bone('bodyPivot'), head: rig.bone('head'),
    earL: rig.bone('earL'), earR: rig.bone('earR'), tail: rig.bone('tail'),

    // Diagonal pairs: each hind leg swings with the front leg on the
    // *opposite* flank.
    hindA: rig.bone(hindPlus), kneeA: rig.bone(kneeOf[hindPlus]), frontA: rig.bone(frontMinus),
    hindB: rig.bone(hindMinus), kneeB: rig.bone(kneeOf[hindMinus]), frontB: rig.bone(frontPlus),

    eyes: rig.names.map((n, i) => (n.startsWith('eye') ? i : -1)).filter((i) => i >= 0),
  };
}

/**
 * Write a pose onto the rig. Every channel is absolute — set, never
 * accumulated — so a dropped frame cannot leave the cat bent.
 */
export function applyPose(rig, p) {
  const B = rig._cache ??= buildCache(rig);

  /* The aim rides on top of the gait's own head motion rather than
     replacing it. */
  rig.setRotation(B.head,
    HEAD_LEAN + p.headPitch * 0.8 + p.aimPitch * p.aimWeight,
    p.headYaw * 0.85 + p.aimYaw * p.aimWeight,
    p.headTilt);

  // The ears carry a rest roll that splays them outward; the pose adds
  // to it rather than replacing it, and mirrored so both flick the same
  // way in world space.
  rig.rotation[B.earL * 3 + 2] = rig.userData[B.earL].base + p.earL * 0.6;
  rig.rotation[B.earR * 3 + 2] = rig.userData[B.earR].base - p.earR * 0.6;

  /* The bone carries the resting lift and the walk's swish, and nothing
     else; the softness is done along the sway chain, where it grows
     from the first node outward instead of turning at the root.

     The lift is on x and the swish on z, so they do not fight: one
     stands the tail up, the other waves it sideways. The authored
     states in cat.js overwrite x to put the tail where each of them
     wants it, and they are written relative to this. */
  rig.rotation[B.tail * 3] = TAIL_LIFT;
  rig.rotation[B.tail * 3 + 2] = TAIL_REST + p.tailYaw;
  rig.position[B.tail * 3 + 1] = rig.rest.position[B.tail * 3 + 1] + TAIL_RAISE;
  rig.rotation[B.bodyPivot * 3 + 2] = p.lean;

  // Two diagonals, half a cycle apart. Hind legs swing at the hip and
  // again at the knee; front legs swing at the shoulder. All negative-
  // forward, matching how the joints were authored.
  rig.rotation[B.hindA * 3] = -p.hipA;
  rig.rotation[B.kneeA * 3] = -p.kneeA;
  rig.rotation[B.frontA * 3] = -p.shoulderA;
  rig.rotation[B.hindB * 3] = -p.hipB;
  rig.rotation[B.kneeB * 3] = -p.kneeB;
  rig.rotation[B.frontB * 3] = -p.shoulderB;

  // Blinking is a squash of the eyeball, which is how the model has
  // always done it — there are no lids to close.
  const open = Math.max(0.08, p.eyeOpen);
  for (const e of B.eyes) rig.scale[e * 3 + 1] = open;

  rig.position[B.root * 3 + 1] = rig.rest.position[B.root * 3 + 1] + p.bob;
  rig.rotation[B.root * 3 + 2] = p.headTilt * 0.04;
  rig.rotation[B.root * 3 + 1] = p.bodyYaw;
  rig.rotation[B.torso * 3] = p.bodyPitch;
}
