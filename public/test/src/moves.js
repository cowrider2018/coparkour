/* ── test/src/moves.js ────────────────────────────────────────
   主角出招的動作。

   刀是橫咬在嘴裡的（blade.js）：刀身從右頰伸出去、刃朝前。所以「揮刀」
   就是「甩頭」——但只甩頭的話是一顆頭在轉，身體像插在地上的樁。每一招
   因此都是全身的：頭帶著刀、上半身扭過去帶著頭、整隻轉過去帶著上半身，
   尾巴往反方向甩出去平衡。尾巴那一份還會經過尾巴自己的彈簧鏈（critter.js
   的 moveOverlay），所以尾巴尖是晚一拍才到的。

     第一段  咬著刀橫砍：先往右擰、刀收在右後方（蓄），一口氣往左甩過去，
             刀從右後方掃過正前方；尾巴往右甩、身體往左倒，然後收回來。
     第二段  咬著刀往上撩：頭側過去（左耳朝上、刀豎起來），低頭、身體
             前傾（蓄），跳起來的同時整個仰上去，刀從前下方掃過頭頂；前腳
             往上伸、尾巴往下壓。
     第三段  二段跳起來的時候縮成一團、往右擰到底（蓄）；落地那一下蹲低、
             整隻往左轉一圈多一點，刀水平伸在外面掃一整圈，尾巴被甩平。

   破防攻擊（突進、迴旋、跳離）也各給一個姿勢，不然那一招裡牠是用平常
   跳躍的樣子在飛。

   ── 怎麼描述一招 ──────────────────────────────────────────────
   一招是一串關鍵影格：[時間, 姿勢, 從上一格到這一格怎麼加減速]。姿勢是
   critter.js moveOverlay 的那些欄位，缺了就是 0；最後一格是 {}（回到原本
   的樣子）的，就是一招有頭有尾——收完招還會把剩下的影格播完，不管戰鬥的
   狀態機已經走到哪。最後一格不是 {} 的，就停在那一格，直到狀態機換招。

   時間照戰鬥狀態機（combat.js 的 phase、t）走，不是自己另計：第一段的
   時間 = slash 的 t，接著是 SWING + rest 的 t。所以動作跟判定永遠對得上。

   ── 招與招怎麼接 ──────────────────────────────────────────────
   換招的那一刻記下「現在長什麼樣」，新的一招在頭 `blend` 秒裡從那個樣子
   淡進來。所以第一段收到一半接第二段、第二段在空中接第三段，都不會跳。
   沒有招的時候就是從那個樣子淡回 {}。

   ── 出招中不轉身 ──────────────────────────────────────────────
   連段的四招（hold）一出手，身體的朝向就停在出手那一刻，招連同收尾播完
   才轉向搖桿指的方向（fight.js 用 holding 決定）。動作是照「面向前方」
   編的：中途跟著搖桿轉，橫砍會變成甩頭，迴旋會多轉或少轉一截。破防攻擊
   不鎖——那幾招的朝向本來就是招自己擺的（朝目標飛、繞著牠面向牠）。
   ------------------------------------------------------------------ */

import { SWING } from './combat.js';

const TAU = Math.PI * 2;

/** 加減速。strike 是出手那一下：頭尾更慢、中段更快的 smootherstep，像甩鞭子。
    沒有用更陡的曲線，是因為畫面上沒有動態模糊：最快的那一幀刀尖要是一口氣
    跨過半個身體，看起來是瞬移，不是揮。out2 是迴旋用的：一開始就快，但
    最快只有平均的兩倍。 */
const EASE = {
  lin: (u) => u,
  inOut: (u) => u * u * (3 - 2 * u),
  out: (u) => 1 - (1 - u) ** 3,
  out2: (u) => 1 - (1 - u) ** 2,
  in: (u) => u * u * u,
  strike: (u) => u * u * u * (u * (u * 6 - 15) + 10),
};

/* ── 第一段 ── */
const SLASH_WIND = {
  yaw: -0.42, twist: -0.38, headYaw: -0.50, headTilt: 0.10, lean: 0.12, pitch: 0.06,
  tailYaw: -0.40, drop: 0.10, w: 1,
};
const SLASH_HIT = {
  yaw: 0.50, twist: 0.44, headYaw: 0.58, headTilt: -0.14, lean: -0.16, pitch: 0.10,
  tailYaw: 0.60, drop: 0.13, w: 1,
};

/* ── 第二段 ── 頭側 −1.1（左耳朝上約 63°）再加上身體往右倒 0.28，刀豎起來將近 80°。 */
const RISE_WIND = {
  headTilt: -1.10, lean: -0.28, headPitch: 0.62, pitch: 0.34, twist: 0.12,
  tailPitch: 0.35, drop: 0.08, w: 1,
};
const RISE_HIT = {
  headTilt: -1.10, lean: -0.26, headPitch: -0.58, pitch: -0.50, twist: 0.12,
  tailPitch: -0.50, tailYaw: 0.15, front: -1.25, hind: 0.75, knee: 0.20, legs: 0.85, w: 1,
};

/* ── 第三段 ── */
const COIL = {
  yaw: -0.85, twist: -0.55, headYaw: -0.35, pitch: 0.38, headPitch: -0.22, lean: 0.10,
  tailYaw: -0.55, tailPitch: 0.40, front: 0.75, hind: -0.75, knee: -0.60, legs: 0.85, w: 1,
};
const SPUN = {
  yaw: TAU + 0.30, twist: 0.35, headYaw: 0.30, pitch: 0.16, headTilt: -0.12, lean: -0.24,
  tailPitch: -0.55, drop: 0.30, front: -0.45, hind: 0.55, knee: -0.45, legs: 0.85, w: 1,
};

/* ── 破防攻擊 ── */
const LUNGE_POSE = {
  pitch: -0.22, headPitch: -0.10, headTilt: -0.25, lean: -0.08,
  tailPitch: -0.50, front: -1.25, hind: 0.85, knee: 0.30, legs: 0.9, w: 1,
};
const ORBIT_POSE = {
  twist: 0.45, headYaw: 0.70, headTilt: 0.12, lean: -0.18, pitch: 0.12,
  tailYaw: 0.45, front: 0.55, hind: -0.55, knee: -0.40, legs: 0.7, w: 1,
};
const VAULT_POSE = {
  pitch: -0.45, headPitch: -0.20, tailPitch: -0.40,
  front: -0.95, hind: 0.65, knee: 0.20, legs: 0.6, w: 1,
};

/**
 * 每一招：hold 出招中鎖住朝向、blend 淡進來多久、keys 關鍵影格 [時間, 姿勢, 加減速]。
 * 第一格的時間一律是 0。
 */
export const MOVES = {
  slash: {
    hold: true,
    blend: 0.08,
    keys: [
      [0, SLASH_WIND],
      [0.07, { ...SLASH_WIND, yaw: -0.52, twist: -0.46, headYaw: -0.58 }, 'out'],
      [0.18, SLASH_HIT, 'strike'],
      [0.28, { ...SLASH_HIT, yaw: 0.58, twist: 0.50, headYaw: 0.62, tailYaw: 0.45, drop: 0.07 }, 'out'],
      [0.62, {}, 'inOut'],
    ],
  },
  rise: {
    hold: true,
    blend: 0.07,
    keys: [
      [0, RISE_WIND],
      [0.06, { ...RISE_WIND, headTilt: -1.15, headPitch: 0.70 }, 'out'],
      [0.19, RISE_HIT, 'strike'],
      [0.30, { ...RISE_HIT, headPitch: -0.62, pitch: -0.52, legs: 0.6 }, 'out'],
      [0.66, {}, 'inOut'],
    ],
  },
  leap: {
    hold: true,
    blend: 0.14,
    keys: [
      [0, {}],
      [0.14, COIL, 'out'],
      [0.40, { ...COIL, yaw: -1.0, twist: -0.62, tailYaw: -0.65 }, 'inOut'],
    ],
  },
  slam: {
    hold: true,
    blend: 0.06,
    keys: [
      [0, { ...COIL, yaw: -1.0, twist: -0.62, drop: 0.34, front: -0.30, hind: 0.45, knee: -0.55 }],
      [0.40, SPUN, 'out2'],
      [0.50, { ...SPUN, yaw: TAU, twist: 0.05, headYaw: 0.05, lean: -0.06, drop: 0.20, legs: 0.5 }, 'inOut'],
      [0.76, { yaw: TAU }, 'inOut'],
    ],
  },
  dash: {
    blend: 0.08,
    keys: [[0, {}], [0.12, LUNGE_POSE, 'out']],
  },
  spin: {
    blend: 0.06,
    keys: [[0, LUNGE_POSE], [0.18, ORBIT_POSE, 'inOut']],
  },
  vault: {
    blend: 0.05,
    keys: [[0, ORBIT_POSE], [0.22, VAULT_POSE, 'inOut']],
  },
};

/** 戰鬥狀態機的 phase → 哪一招、這一招播到第幾秒。 */
function moveOf(phase, t) {
  switch (phase) {
    case 'slash': return ['slash', t];
    case 'rest': return ['slash', SWING + t];
    case 'rise': return ['rise', t];
    case 'air': return ['rise', SWING + t];
    case 'leap': return ['leap', t];
    case 'slam': return ['slam', t];
    case 'dash': case 'spin': case 'vault': return [phase, t];
    default: return [null, 0];
  }
}

const last = (mv) => mv.keys[mv.keys.length - 1];
/** 這一招有沒有收尾（最後一格是 {}，或只剩一整圈的轉）。有的話播到最後一格就結束。 */
const ends = (mv) => Object.keys(last(mv)[1]).every((k) => k === 'yaw');
const duration = (mv) => last(mv)[0];

/** 一招在第 τ 秒的姿勢，寫進 out（先清成 0）。 */
function sample(mv, tau, out) {
  for (const k of CHANNELS) out[k] = 0;
  const K = mv.keys;
  let i = 0;
  while (i < K.length - 1 && K[i + 1][0] <= tau) i++;
  const [t0, a] = K[i];
  if (i === K.length - 1) { for (const k in a) out[k] = a[k]; return out; }
  const [t1, b, ease] = K[i + 1];
  const u = EASE[ease || 'inOut'](Math.min(1, Math.max(0, (tau - t0) / (t1 - t0))));
  for (const k of CHANNELS) {
    const x = a[k] || 0, y = b[k] || 0;
    out[k] = x + (y - x) * u;
  }
  return out;
}

/** 動作的每一個欄位（critter.js moveOverlay 認得的那些）。 */
export const CHANNELS = [
  'yaw', 'twist', 'lean', 'pitch', 'headYaw', 'headPitch', 'headTilt',
  'tailYaw', 'tailPitch', 'drop', 'front', 'hind', 'knee', 'legs', 'w',
];

/** 淡出去（沒有招）要多久。 */
const BLEND_OUT = 0.16;

const wrapPi = (a) => a - TAU * Math.round(a / TAU);

/**
 * 動作播放器：每幀給它狀態機的 phase 與 t，拿回一份姿勢交給 critter.update
 * 的 `move`。預設播主角的招（MOVES，照連段的 phase）；給了別的動作表與
 * 「phase → [哪一招, 第幾秒]」的對應，就播別人的。
 */
export class Mover {
  /**
   * @param {object} moves 動作表，長得跟 MOVES 一樣
   * @param {(phase: string, t: number) => [string | null, number]} of phase → 哪一招、播到第幾秒
   */
  constructor(moves = MOVES, of = moveOf) {
    this.moves = moves;
    this.moveOf = of;
    this.name = null;       // 正在播哪一招（null = 沒有）
    this.tau = 0;           // 播到第幾秒
    this.age = 0;           // 這一招開始多久了（淡入用，跟 tau 分開：tau 可能從中間開始）
    this.from = Object.fromEntries(CHANNELS.map((k) => [k, 0]));
    this.out = Object.fromEntries(CHANNELS.map((k) => [k, 0]));
    this._pose = Object.fromEntries(CHANNELS.map((k) => [k, 0]));
  }

  /** 正在播一招要鎖住朝向的招，而且還沒播完（收尾也算）。 */
  get holding() {
    const mv = this.name ? this.moves[this.name] : null;
    return !!mv && !!mv.hold && (!ends(mv) || this.tau < duration(mv));
  }

  /** 從現在的樣子換到 name 這一招（或 null），τ 從 tau 起。 */
  _switch(name, tau) {
    Object.assign(this.from, this.out);
    // 轉了一整圈的等於沒轉：從 2π 淡回 0 會倒著再轉一圈。
    this.from.yaw = wrapPi(this.from.yaw);
    this.name = name;
    this.tau = tau;
    this.age = 0;
  }

  /**
   * @param {number} dt
   * @param {string} phase 狀態機的 phase（主角的是 combat.js 的 combo.phase）
   * @param {number} t     這個 phase 走了幾秒（combo.t）
   * @returns {object} 這一幀的姿勢
   */
  step(dt, phase, t) {
    let [name, tau] = this.moveOf(phase, t);
    if (!name && this.name) {
      /* 狀態機已經不在這一招裡了。有收尾的招把收尾播完，停在最後一格的招
         直接淡出去。 */
      const mv = this.moves[this.name];
      if (ends(mv) && this.tau + dt < duration(mv)) { name = this.name; tau = this.tau + dt; }
    }
    if (name !== this.name || (name && tau < this.tau - 1e-6)) this._switch(name, tau);
    else { this.tau = tau; this.age += dt; }

    const mv = name ? this.moves[name] : null;
    const pose = mv ? sample(mv, this.tau, this._pose) : this._pose;
    if (!mv) for (const k of CHANNELS) pose[k] = 0;
    const span = mv ? mv.blend : BLEND_OUT;
    const f = span > 0 ? EASE.inOut(Math.min(1, this.age / span)) : 1;
    for (const k of CHANNELS) this.out[k] = this.from[k] + (pose[k] - this.from[k]) * f;

    /* 一招播完、姿勢回到原點：沒有招了。停在 2π 的轉也收回 0。 */
    if (mv && ends(mv) && this.tau >= duration(mv)) {
      this.out.yaw = wrapPi(this.out.yaw);
      if (!this.moveOf(phase, t)[0]) { this.name = null; Object.assign(this.from, this.out); this.age = BLEND_OUT; }
    }
    return this.out;
  }
}
