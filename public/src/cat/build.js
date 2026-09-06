/* ── src/cat/build.js ────────────────────────────────────────────────
   The tools for making a new animal out of `cat.bin`.

   Nothing here knows what a dog or a hat is. What it knows is the
   SHAPE of the asset `rig.js` parses and the rules that shape has to
   obey, because those rules are not written down anywhere else and
   breaking one of them does not throw — it draws something wrong:

     · the three groups — lit, unlit, outline — own DISJOINT vertex
       ranges, in that order. The shader tells lit from unlit by
       comparing `gl_VertexID` against the first unlit vertex, so a lit
       vertex appended past that boundary is shaded as if it were an
       eye.
     · `lit` and `unlit` are ADJACENT in the index buffer, which is the
       only reason they share one draw call.
     · a generated mesh has to wind the way the asset's own does, or it
       is invisible in the fill pass and a solid blot in the ink pass.

   So a builder never extends the buffers. It walks each group in turn,
   copies the vertices that survive in the order they are first
   referenced, appends its own geometry for that group right after
   them, and renumbers the indices as it goes — which is what `Block`
   and `flatten` are between them.

   This file was `dog.js`'s own toolbox first. It moved out when a
   second builder wanted it: `wear.js` generates rounded boxes, grows
   ink shells around them and puts them into the same three blocks, and
   two copies of that arithmetic would have drifted apart at the first
   change to any of it.
   ------------------------------------------------------------------ */

/** How far the ink shell stands off the skin, in model units. Measured
    off the cat: head 0.06, body 0.05, a paw 0.02. */
export const SHELL = 0.05;

/** What a shell is painted, read off cat.bin's own outline group. It
    lives next to `shellOf` because the two only ever appear together:
    anything that grows a shell has to paint it this, and a shell in
    some other near-black is a line that does not match the lines
    around it. */
export const INK = [43, 35, 32];

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
export function superQuad(half, e) {
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
export function rrRadius(d, h, r) {
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
export function rrNormal(dir, h, r) {
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
 * a HOST rounded rectangle, corner arc included.
 *
 * Both views are tested, because the rectangle is drawn in a different
 * pair of axes depending on which way the animal is facing: (z, y)
 * side-on, (x, y) head-on. A feature that fits one and not the other is
 * a feature that pokes through the ink halfway round the turn.
 *
 * Nothing clips a feature to the part it is drawn on, which is why this
 * is worth an exception rather than a shrug: a nose that has slid off
 * the end of a snout does not fail — it quietly hangs in the air
 * beside it.
 *
 * @param {string} what  the subject of the message, builder's name included
 * @param {number[]} at    the feature's centre, in the host's space
 * @param {number[]} half  the feature's half-extents
 * @param {{half: number[], radius: number}} host  the rectangle it is on
 * @param {string} [grow]  what to tell the reader to make bigger
 */
export function fitsRect(what, at, half, host, grow = 'the part') {
  const H = host.half;
  for (const [u, v] of [[2, 1], [0, 1]]) {
    const h = [H[u], H[v]];
    const r = Math.min(h[0], h[1]) * host.radius;
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        const q = [at[u] + su * half[u], at[v] + sv * half[v]];
        const len = Math.hypot(q[0], q[1]);
        if (len < 1e-6) continue;
        if (len > rrRadius([q[0] / len, q[1] / len], h, r) + 1e-4) {
          throw new Error(`${what} sticks out of the rectangle it is drawn on`
            + ` at (${q[0].toFixed(3)}, ${q[1].toFixed(3)}) — move it in, or grow ${grow}`);
        }
      }
    }
  }
}
/** The same solid, grown along its own normals: an ink shell. */
export function shellOf(geo, grow) {
  const position = geo.position.slice();
  for (let i = 0; i < position.length; i++) position[i] += geo.normal[i] * grow;
  return { position, normal: geo.normal.slice(), index: geo.index.slice() };
}

/** Move a generated mesh to where it belongs in its bone's space. */
export function placed(geo, at) {
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
export class Block {
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


/**
 * The three blocks, as one set of buffers.
 *
 * Everything the groups have to promise is kept here in one place: the
 * blocks are laid down lit, unlit, outline, so their vertex ranges come
 * out disjoint and in that order, and their index ranges come out
 * adjacent, so lit and unlit still merge into one draw call.
 *
 * What comes back alongside the buffers is what a caller needs to PAINT
 * them: per vertex, the source vertex it was copied from (or −1), the
 * role it was generated as (or null), and the packed bone-and-sway byte
 * that has to be written back into every colourway's alpha.
 *
 * @param {{lit: Block, unlit: Block, outline: Block}} blocks
 */
export function flatten(blocks) {
  const order = [blocks.lit, blocks.unlit, blocks.outline];
  const nv = order.reduce((s, b) => s + b.count, 0);
  const ni = order.reduce((s, b) => s + b.index.length, 0);

  const position = new Float32Array(nv * 3);
  const normal = new Int16Array(nv * 4);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
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

  return { nv, ni, position, normal, index, groups, srcOf, roleOf, alphaOf };
}
