/* ── src/cat/shape.js ────────────────────────────────────────────────
   The cat's outline, made rectangular.

   This does not draw anything. It measures the animal, and it hands
   `cat.js` a block of GLSL that BENDS the real mesh — the same 22,405
   vertices, the same 23 bones, the same vertex colours — so that each
   part's silhouette comes out as a rounded rectangle on the screen.

   ── why the mesh is bent instead of replaced ──────────────────────
   It was replaced once, by rounded rectangles generated from the bone
   matrices, and that lost two things which turned out to be most of
   what the cat looked like.

   The first was the three-tone shading. A generated rectangle has no
   surface, so its normal had to be invented — a cushion, tipping
   outward from the middle — and an invented normal is the same on
   every part. Measured against the real mesh on a standing cat, the
   bands came out at 45% lit / 33% mid / 22% shadow on EVERY rectangle,
   where the mesh gives the head 52/14/34, a front paw 28/40/32 and an
   ear 59/26/15. Every part shaded identically, mid inflated by half,
   shadow thinned: the cat went flat.

   The second was the coat. Counted off `cat.bin`, the head carries 3–4
   distinct vertex colours, the body 2–3, the tail 2–3, the ears 2 —
   the tabby's stripes, the calico's patches, the tail's tip. Only the
   six leg parts are genuinely one colour each. Averaging a part to its
   mean threw all of that away.

   Bending keeps both, because both are properties of vertices this
   still draws. The normals are the real normals and are NOT bent —
   that is the whole point: what reaches the screen is a rounded
   rectangle lit as the curved thing it really is.

   ── how the bend works ───────────────────────────────────────────
   Per part, in screen space:

     · Take the frame from the bone's own +Y column projected to the
       screen — the part's UP, which is along a leg and up a body — and
       the perpendicular to it. A yaw leaves model Y alone, so an
       unrotated part keeps one orientation through a whole turn and
       only a bone that really rotated tips its rectangle.
     · Take the size as the support of all three half-extents on those
       two directions, combined in quadrature. All three: drop the X
       one and the rectangle collapses to a line at ψ = 0, when the cat
       is looking at the player and the Z extent has gone edge-on. In
       quadrature rather than summed, because summing is the support of
       a BOX, and a box is widest across its diagonal — a head, whose X
       and Z extents are within 3% of each other, would swell by 40%
       halfway through every turn.
     · That gives an ellipse. Every vertex is measured against it, and
       then put back at the same fraction of the way to the ROUNDED
       RECTANGLE boundary in the same direction. Vertices on the
       ellipse land on the rectangle; everything inside follows.

   ── and why that alone is not enough ─────────────────────────────
   Because a part is not an ellipsoid, and the ellipse it is measured
   against is only its bounding box. Measured over both gaits and every
   15° of the turn, the real silhouette wanders around that ellipse by

       hips ±0%   hind paws ±3%   head ±7%   body ±15%   front paws ±20%

   which for the body is about 2 px at boxH = 40 — a visibly lumpy
   rectangle. (The front paws are worse in percent and invisible in
   pixels: they are 2 px wide to begin with.)

   So the bend has a second term, and it is gated on the one thing that
   says "this vertex is ON the silhouette" without knowing anything
   about the shape: its own normal, edge-on to the camera. Vertices
   whose normal is near perpendicular to the view AND which are already
   out near the boundary are pulled the last of the way onto the
   rectangle exactly, and the pull fades out over the outer eighth of
   the radius. The silhouette is then the rectangle whatever the part's
   real shape is, and the interior never moves far.

   Both conditions matter. Normal alone would grab a crease or a
   concave fold somewhere in the middle of a part and drag it to the
   edge; radius alone is what was already wrong.
   ------------------------------------------------------------------ */

/* ── the part table ───────────────────────────────────────────────
   Which bones get a rectangle, and how round its corners are, as a
   fraction of the SHORTER half-side — so 0.5 is a stadium, and the
   small parts, at 0.5, come out as capsules rather than as tiny
   squares with a hint of a chamfer.

   `scale` is a multiplier on the part's TRUE drawn size, not on its
   bounding box, and 1 means "the size it already was". That
   distinction is the difference between a cat and a slightly bloated
   one: a round head inscribed in its own bounding box only reaches
   93% of it, so sizing the rectangle from the box drew the head 7.5%
   too big, and every part had to have that error guessed back out of
   it by hand. It is measured instead — see measureShapes — and these
   are all 1 because nothing here wants to be a different size than it
   was. They are here to be turned, not because they are needed.

   The ears are absent, and so is every part of the face: see
   SHAPE_RIDE. */
export const SHAPE_PARTS = [
  { bone: 'body', radius: 0.40, scale: 1 },
  /* The head is the one part that does not want its true height, and
     the ears are why. A round head's top is a POINT, so an ear rooted
     to one side of it clears the skull easily; a rounded rectangle's
     top is a LINE at full height right across the width, and it rises
     to swallow exactly the ears that made the animal a cat. Taking
     0.86 of the height puts the flat top back under them. Nothing else
     needs this, because nothing else has anything sitting on it. */
  { bone: 'head', radius: 0.42, scale: [1, 0.86, 1] },
  { bone: 'hipHL', radius: 0.50, scale: 1 },
  { bone: 'hipHR', radius: 0.50, scale: 1 },
  { bone: 'pawHL', radius: 0.50, scale: 1 },
  { bone: 'pawHR', radius: 0.50, scale: 1 },
  { bone: 'pawFL', radius: 0.50, scale: 1 },
  { bone: 'pawFR', radius: 0.50, scale: 1 },
];

/* ── what is left alone ───────────────────────────────────────────
   The ears, and only the ears. A triangle is what an ear is, and
   rounding it off is the one change that stops the animal reading as a
   cat, so they keep their exact shape and their exact place.

   Leaving them alone is enough, and needs no displacement to carry
   them: along +Y the rounded rectangle's boundary IS the part's
   bounding box, which is where the top of the head already was, so the
   head's skin does not move under an ear at all and the ear goes on
   sitting on it. That is also why the head's `scale` is 1: shrink the
   rectangle and the skin drops away from ears that did not.

   The face is left alone too, but it cannot be listed here, because
   the nose is on the `head` bone itself and no bone tells it apart
   from the head's own skin. What does tell it apart is the GROUP: the
   eyes, the nose and all six whiskers are the whole of `unlit`, and
   the shader already knows which vertices those are — it has to, to
   shade them flat. So the rule in cat.js is "unlit does not bend", and
   between that and this table the entire face and both ears come
   through untouched.

   Both halves of that were arrived at the hard way. Bending the face
   with the head smears it: the muzzle sits near the head's front, so
   the bend's pull is strong there, and the eyes slide toward the cheek
   while the nose stretches into an oval and the whiskers cross. Riding
   the eyes but bending the nose is worse still — the face comes apart,
   because the two halves are being moved by different rules. Leaving
   all of it exactly where the mesh put it is the only version where
   the face stays a face, and it is safe because the rounded rectangle
   CONTAINS the ellipse the bend measures against: the nose sits at
   t ≈ 0.89 of the head's radius and the eyes nearer still, so none of
   it was ever near the boundary the skin gets pulled to. */
export const SHAPE_RIDE = { earL: 'head', earR: 'head' };

/* ── the tail ─────────────────────────────────────────────────────
   The tail needs none of the above. Measured off the file it is a tube
   of CONSTANT radius — 0.230 model units, and all seventeen chain
   nodes agree to within 0.005 — so its silhouette is ALREADY a
   constant-width ribbon at every angle, which is the rounded-rectangle
   answer for a tail. Bending it would only damage a shape that is
   already right.

   What is wrong with it is the tip: a hemisphere, 298 of the tail's
   748 silhouette vertices. That is the one piece replaced, in the
   tail's own local space before the spring chain deforms it — a flat
   end with two rounded corners, in the same language as the body. The
   swing is untouched.

   Both numbers are in units of the tail's own radius, so they read the
   same at every zoom. The end is carried a little short of where the
   hemisphere reached; the corners are half a radius, the same "half
   the short side" the paws and hips use. */
export const TAIL_CAP_LEN = 0.85;
export const TAIL_CAP_R = 0.50;

/* ── the gate on the silhouette pull ──────────────────────────────
   How edge-on a normal has to be, and how far out a vertex has to be,
   before it is pulled the last of the way onto the rectangle. On a
   sphere `s` = 1 − |n·view| reaches 0.5 at 87% of the radius, so the
   pull lives in the outer eighth and the middle of a part never moves
   from where the mesh put it. */
/** How far the face is lifted toward the camera, in model units.

    The face is left where the mesh put it while the skin around it
    bends, and screen-space bending moves skin ACROSS the face without
    changing its depth — so a cheek that used to be beside an eye can
    end up over it, at a depth that still wins. A quarter of a unit is
    more than the bend ever slides the skin sideways and a fifth of the
    head's own radius, so it lifts the face clear of its own head
    without lifting it clear of anything else: the far eye stays inside
    the skull, where it belongs.

    It earns its place: measured by rendering with and without it, it
    is the difference between roughly 200 pixels of face showing and
    not showing, on a cat drawn 250 pixels tall. */
export const FACE_LIFT = 0.15;

export const SIL_NORMAL = [0.50, 1.00];
export const SIL_RADIUS = [0.40, 0.70];

/* ═══ measuring the parts off the asset ═══════════════════════════ */

/**
 * Per-part centre, half-extents, and the one number that cannot be
 * read straight off a bounding box: how far the real silhouette sits
 * from the ellipse that box implies.
 *
 * The extents come from the `outline` group — the grown silhouette
 * shell, which is what decided the cat's outline before this and is
 * the right thing to size a replacement outline from.
 *
 * `norm` is then measured, not assumed. For each part the rest pose is
 * projected at eight yaws, the furthest vertex in each of 36 screen
 * directions is found, and the mean of those is taken. Dividing by it
 * puts the silhouette at exactly 1, which is where the bend expects
 * it: without it a head, whose mesh reaches 6% past its own inscribed
 * ellipse, would be drawn 6% larger than its rectangle and would poke
 * out of its own ink. Across yaws the number moves by about 1%, which
 * is why one of it per part is enough.
 *
 * @param {object} data  the parsed cat.bin
 * @param {import('./rig.js').Rig} rig
 */
export function measureShapes(data, rig) {
  const { header, position, index, colors } = data;
  const nv = header.vertexCount;
  const group = (n) => header.groups.find((g) => g.name === n);
  const outline = group('outline'), lit = group('lit');
  const col = colors.get(header.skins[0]);

  /* A group is a range of INDICES, so a vertex no triangle of the
     group references is not part of it: walk the indices. */
  const boxes = new Map();
  const seen = new Uint8Array(nv);
  for (let i = outline.start; i < outline.start + outline.count; i++) {
    const v = index[i];
    if (seen[v]) continue;
    seen[v] = 1;
    const b = col[v * 4 + 3] & 31;
    let a = boxes.get(b);
    if (!a) { a = { min: [1e30, 1e30, 1e30], max: [-1e30, -1e30, -1e30] }; boxes.set(b, a); }
    for (let k = 0; k < 3; k++) {
      const p = position[v * 3 + k];
      if (p < a.min[k]) a.min[k] = p;
      if (p > a.max[k]) a.max[k] = p;
    }
  }

  const parts = SHAPE_PARTS.map((p) => {
    const bone = rig.bone(p.bone);
    const box = boxes.get(bone);
    if (!box) throw new Error(`cat shape: bone "${p.bone}" has no outline geometry`);
    return {
      name: p.bone,
      bone,
      center: [0, 1, 2].map((k) => (box.max[k] + box.min[k]) / 2),
      half: [0, 1, 2].map((k) => (box.max[k] - box.min[k]) / 2),
      radius: p.radius,
      scale: typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale,
      norm: 1,
    };
  });

  /* Measured against the raw bounding box, so what comes back is how
     much of that box the part actually fills — 0.93 for the head,
     0.99 for the body, 0.93 for a hip. Folding it into the extents is
     what makes the rectangle the size of the PART rather than the size
     of the box drawn round it, and it is what lets every `scale` above
     be 1 and mean it. */
  measureNorm(parts, data, rig, lit);
  for (const p of parts) {
    p.half = p.half.map((h, k) => h * p.norm * p.scale[k]);
    /* The extents already carry it, so the bend must not divide by it
       twice. What is left is the artistic multiplier — and only the
       part of it that is uniform, since an axis-by-axis squash is a
       change of SHAPE and belongs in the extents alone. */
    p.norm = 1;
  }

  const tailBox = boxes.get(rig.bone('tail'));
  const tail = {
    bone: rig.bone('tail'),
    /* A tube's radius is half of the one extent that is a diameter
       rather than a length: X, across the animal, which no bend of the
       chain can lengthen. */
    radius: (tailBox.max[0] - tailBox.min[0]) / 2,
  };

  /** bone → {part, ride}. Everything else is left exactly alone. */
  const byBone = new Int8Array(rig.count).fill(-1);
  const rides = new Uint8Array(rig.count);
  parts.forEach((p, i) => { byBone[p.bone] = i; });
  for (const [child, host] of Object.entries(SHAPE_RIDE)) {
    const hi = parts.findIndex((p) => p.name === host);
    if (hi < 0) continue;
    const b = rig.bone(child);
    byBone[b] = hi;
    rides[b] = 1;
  }

  return { parts, tail, byBone, rides };
}

/**
 * The `norm` pass. Deliberately run on the REST pose only: the number
 * it produces varies by about 1% across the gait and across the turn,
 * and a load-time measurement that has to drive the rig through both
 * would cost far more than the 1% is worth.
 */
function measureNorm(parts, data, rig, lit) {
  const { index, position, colors, header } = data;
  const col = colors.get(header.skins[0]);
  const byBone = new Map(parts.map((p) => [p.bone, p]));
  const BINS = 36, YAWS = 8;

  rig.reset();
  const M = rig.update();
  const colOf = (m, c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
  const xform = (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
  const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
  const totals = new Map(parts.map((p) => [p.name, []]));

  for (let y = 0; y < YAWS; y++) {
    const yaw = (y / YAWS) * Math.PI * 2;
    const uY = [Math.sin(yaw), -Math.cos(yaw)];
    // Direction only, and only the two screen axes: (right, up).
    const pd = (d) => [-d[0] * uY[1] + d[2] * uY[0], d[1]];
    const frames = new Map();
    for (const p of parts) {
      const m = M.subarray(p.bone * 16, p.bone * 16 + 16);
      const e = [0, 1, 2].map((k) => pd(colOf(m, k)).map((x) => x * p.half[k]));
      const ey = Math.hypot(e[1][0], e[1][1]);
      const vH = ey > 1e-5 ? [e[1][0] / ey, e[1][1] / ey] : [0, 1];
      const uH = [vH[1], -vH[0]];
      frames.set(p.bone, {
        uH, vH,
        lu: Math.hypot(...e.map((x) => dot2(x, uH))),
        lv: Math.hypot(...e.map((x) => dot2(x, vH))),
        c: pd(xform(m, p.center)),
      });
    }

    const bins = new Map();
    const seen = new Uint8Array(header.vertexCount);
    for (let i = lit.start; i < lit.start + lit.count; i++) {
      const v = index[i];
      if (seen[v]) continue;
      seen[v] = 1;
      const p = byBone.get(col[v * 4 + 3] & 31);
      if (!p) continue;
      const f = frames.get(p.bone);
      const m = M.subarray(p.bone * 16, p.bone * 16 + 16);
      const w = pd(xform(m, [position[v * 3], position[v * 3 + 1], position[v * 3 + 2]]));
      const off = [w[0] - f.c[0], w[1] - f.c[1]];
      const nx = dot2(off, f.uH) / f.lu, ny = dot2(off, f.vH) / f.lv;
      const t = Math.hypot(nx, ny);
      if (t < 1e-4) continue;
      const bin = Math.floor(((Math.atan2(ny, nx) + Math.PI) / (Math.PI * 2)) * BINS) % BINS;
      const k = p.name + '|' + bin;
      const prev = bins.get(k);
      if (prev === undefined || t > prev) bins.set(k, t);
    }
    for (const [k, t] of bins) totals.get(k.split('|')[0]).push(t);
  }

  for (const p of parts) {
    const a = totals.get(p.name);
    p.norm = a.length ? a.reduce((s, x) => s + x, 0) / a.length : 1;
  }
}

/* ═══ the GLSL ════════════════════════════════════════════════════
   Handed to `cat.js` rather than compiled here, because there is only
   one program: this is a modification to how the mesh is projected,
   not a second thing drawn on top of it. */

/**
 * @param {number} partCount
 * @param {number} boneCount
 */
export const SHAPE_GLSL = (partCount, boneCount) => `
#define PARTS ${partCount}

/** centre.xyz, and the bone the part hangs on. */
uniform vec4 uPart[PARTS];
/** the three half-extents, and the corner radius as a fraction of the
    short side of the rectangle they make. */
uniform vec4 uPartB[PARTS];
/** how far the real silhouette sits past the ellipse; see measureNorm. */
uniform float uPartNorm[PARTS];
/** per bone: which part bends it, or -1. */
uniform int uBonePart[${boneCount}];
/** per bone: 1 to be carried by that part rather than bent by it. */
uniform int uBoneRide[${boneCount}];
/** How far outside the rectangle this pass lands, in world px. Zero
    for the fill; the ink width for the shell. See warpToRect. */
uniform float uInkOut;

/**
 * How far it is from the centre of a rounded rectangle to its edge,
 * along a unit direction. Exact, not an approximation: the rectangle
 * is a box of half-extents (h − r) grown by a disc of radius r, so the
 * ray leaves it either through a flat side — where the answer is just
 * h over the direction's own component — or through a corner arc,
 * which is one quadratic.
 */
float rrRadius(vec2 d, vec2 h, float r) {
  vec2 a = abs(d);
  vec2 e = max(h - r, vec2(0.0));
  if (h.x * a.y <= e.y * a.x) return h.x / max(a.x, 1e-6);
  if (h.y * a.x <= e.x * a.y) return h.y / max(a.y, 1e-6);
  float K = a.x * e.x + a.y * e.y;
  return K + sqrt(max(0.0, K * K - (dot(e, e) - r * r)));
}

/** The part's frame and size on screen. "uHat" runs across the
    rectangle, "vHat" up it, and the two lengths are the support of all
    three half-extents on those directions. */
void partFrame(int id, out vec2 c, out vec2 uHat, out vec2 vHat, out float lu, out float lv) {
  vec4 P = uPart[id], B = uPartB[id];
  mat4 m = uBones[int(P.w + 0.5)];

  vec3 w = (m * vec4(P.xyz, 1.0)).xyz;
  c = screenOf(w);

  vec2 ex = projectDir(m[0].xyz) * B.x;
  vec2 ey = projectDir(m[1].xyz) * B.y;
  vec2 ez = projectDir(m[2].xyz) * B.z;

  float ly = length(ey);
  vHat = ly > 1e-5 ? ey / ly : vec2(0.0, 1.0);
  uHat = vec2(vHat.y, -vHat.x);

  lu = length(vec3(dot(ex, uHat), dot(ey, uHat), dot(ez, uHat)));
  lv = length(vec3(dot(ex, vHat), dot(ey, vHat), dot(ez, vHat)));
}

/**
 * Put one screen point where the rounded rectangle wants it.
 *
 * "sil" is how edge-on this vertex's normal is to the camera, 0 facing
 * it and 1 exactly on the silhouette. It is what makes the outline the
 * rectangle rather than merely rectangle-ish — see the note at the top
 * of this file — and it is passed as 0 for a carried bone, where there
 * is no surface to be on the edge of.
 */
vec2 warpToRect(vec2 screenPt, int id, float sil) {
  vec2 c, uHat, vHat; float lu, lv;
  partFrame(id, c, uHat, vHat, lu, lv);

  // Into the part's own frame, in (right, up).
  vec2 off = vec2(screenPt.x - c.x, -(screenPt.y - c.y));
  vec2 p = vec2(dot(off, uHat), dot(off, vHat));
  float len = length(p);
  if (len < 1e-5) return screenPt;

  // Where this vertex sits on the ellipse the bounding box implies.
  float t = length(vec2(p.x / lu, p.y / lv)) / uPartNorm[id];
  vec2 dir = p / len;

  float r = min(min(lu, lv) * uPartB[id].w, min(lu, lv));
  float R = rrRadius(dir, vec2(lu, lv), r);

  /* The silhouette pull. Gated on BOTH tests: the normal alone would
     grab a crease in the middle of a part, the radius alone is what
     left the outline lumpy in the first place.

     And the ink is a pull to a slightly BIGGER rectangle rather than a
     thicker shell, which is what makes the line exactly one width.
     The inverted hull on its own no longer works here: the pull would
     land the shell's silhouette on the same rectangle as the fill's
     and there would be no line at all. Asking for the boundary plus
     uInkOut px instead gives a ring of exactly uInkOut everywhere,
     corners included — which the grown hull never managed, since a
     hull grown by a fixed amount in MODEL space comes out of the bend
     wider at the corners than along the sides. */
  float target = 1.0 + uInkOut / max(R, 1e-3);
  float w = smoothstep(${SIL_NORMAL[0].toFixed(2)}, ${SIL_NORMAL[1].toFixed(2)}, sil)
          * smoothstep(${SIL_RADIUS[0].toFixed(2)}, ${SIL_RADIUS[1].toFixed(2)}, t);

  /* The pull raises a silhouette that falls short; this stops one that
     overshoots, and between them the rectangle is a boundary rather
     than a target. The overshoot is real and the pull cannot catch it:
     a vertex can be far out radially and still be facing the camera —
     the body's shoulder, where it runs up into the neck — so its
     normal never says "silhouette" and it would sit outside the
     rectangle it belongs to. Only the couple of percent of vertices
     past the edge are touched, and they are compressed onto it. */
  float tt = min(mix(t, target, w), target);
  vec2 np = dir * tt * R;

  vec2 no = np.x * uHat + np.y * vHat;
  return vec2(c.x + no.x, c.y - no.y);
}
`;

/**
 * The tail's tip, in the tail bone's own space and before the spring
 * chain touches it. A hemisphere of radius R becomes the same rounded
 * profile the rest of the animal uses, by the same construction: what
 * fraction of the way out a point is, kept, and the boundary it is
 * measured against, changed.
 *
 * Only the normals are left behind — a flattened cap is still shaded
 * as the hemisphere it was. At the size a tail tip is drawn, two or
 * three pixels, there is nothing there to see it on.
 */
export const TAIL_CAP_GLSL = (nodes) => `
vec3 tailCap(vec3 p, float o) {
  if (o < 0.999) return p;
  vec3 base = TAIL_AXIS[${nodes - 1}];
  vec3 tan = normalize(base - TAIL_AXIS[${nodes - 2}]);
  vec3 off = p - base;
  float along = dot(off, tan);
  if (along <= 0.0) return p;

  vec3 side = off - along * tan;
  float rad = length(side);
  vec2 q = vec2(along, rad);
  float len = length(q);
  if (len < 1e-6) return p;

  float R = uTailRadius;
  vec2 dir = q / len;
  float target = rrRadius(dir, vec2(R * ${TAIL_CAP_LEN.toFixed(2)}, R), R * ${TAIL_CAP_R.toFixed(2)});
  vec2 nq = dir * (len / R) * target;

  return base + nq.x * tan + (rad > 1e-6 ? side * (nq.y / rad) : vec3(0.0));
}
`;
