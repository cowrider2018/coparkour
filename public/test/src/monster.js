/* ── test/src/monster.js ──────────────────────────────────────
   怪物的外觀：立耳犬，紅眼睛。一個系列一件毛，系列裡靠體型分：

     minion  殭屍：純綠色，一般大小。
     boss    殭屍 BOSS：同一件綠毛，兩倍大。
     ghost   幽靈：淡藍白，半透明，一般大小。

   只是看起來大：碰撞還是 combat.js 那同一個 PHYS 圓柱。

   半透明是畫兩趟：Critter 原本那一個網格只寫深度、不上色，再疊一個共用同一份
   幾何與骨頭的網格照 alpha 混色。只畫一趟的話，自己身體後面的腿、墨線的內面
   都會透出來，看起來是一團疊在一起的線。兩個網格的 renderOrder 一樣、位置一樣，
   three 的半透明排序這時照建立的先後（id），所以先建的那一個（寫深度）先畫。

   是遊戲那隻狗本人（試玩場 critter.js 的 Critter，同一份 cat.bin 資料），
   只是毛色不是 cat.bin 裡的任何一件：每個頂點的顏色在這裡直接寫，
   照它屬於哪一根骨頭分——眼睛那兩根是紅的，其他全部是那一類的毛色。臉上的
   鼻子與嘴（`unlit` 群組裡不是眼睛的那些）用深一階的同色，不然整張臉糊成
   一片，看不出哪一邊是頭。

   顏色跟 cat.bin 一樣是 sRGB 的 0～1（Critter 的著色器自己轉線性），
   所以這裡的數字就是畫面上看到的那個顏色，不必先轉。

   ── 衝刺的動作 ──────────────────────────────────────────────────
   衝刺（combat.js 的 LUNGE）照 m.lunge.t 切成三段，各有一套動作，用主角
   那一個播放器播（moves.js 的 Mover，招與招之間一樣是淡進淡出）：

     windup   後傾低頭：身體往後坐、前半身仰起來，頭反過來壓低，後腿收到
              肚子底下、膝蓋彎著，尾巴垂下去——壓住的彈簧，眼睛盯著前面。
     dash     主角的跳躍動作組：不疊動作，而是跟 Critter 說「在空中」，垂直
              速度從往上換成往下，所以是跳起來前腿前伸、過頂點換成找地板、
              落地那一沉（critter.js 的 airPose）。身體畫得跳起一點點（DASH_HOP）
              讓那個姿勢站得住——只是畫面，碰撞還是地上那一個圓柱。
     recover  僵直：先低頭 BOW_TIME 秒（頭垂下去、尾巴放低），之後才甩——
              甩頭（頭左右甩、跟著側過去）、甩尾巴（跟頭反向）、身體左右
              搖晃（慢一拍、幅度小），一邊甩一邊把頭抬回來，一開始最用力、
              到僵直結束收乾淨。

   ── BOSS 放招的動作 ──────────────────────────────────────────────
   放招（skills.js 的 m.cast）照 cast.t 播倒數那一套，出招之後的僵直（m.stun）
   播那一招的收尾——僵直本身不記是哪一招，Motion 記著上一次在放哪一招。

     orb   仰頭伸展蓄力：胸口挺起、頭往後仰到朝天、尾巴翹起來，越蓄越仰；
           倒數最後那一下頭往前甩，球出去的那一刻正甩到一半——吐出去的；
           甩到底停一下，然後在僵直裡慢慢回到原本的樣子。
     cone  前肢抬起：整個前半身立起來、兩隻前腳離地收在胸前，頭反過來壓低
           盯著主角；倒數最後那一下整隻砸下去，打下去的那一刻前腳踩到地；
           僵直裡再往下一沉，然後慢慢起身。
     leap  俯身看主角蓄力：壓低身子、膝蓋彎到底、頭抬起來盯著主角，越蓄越低；
           最後那一段飛過去的時候跟衝刺一樣是主角的跳躍動作組（在空中、垂直
           速度照那一條拋物線）；落地俯身緩衝，停一下，然後在僵直裡慢慢站起來。

   ── 會飛的漂 ──────────────────────────────────────────────────────
   會飛的（幽靈）一直是空中姿勢、不走路，所以移動的時候另外常駐一套漂（DRIFT）：
   四條腿一起慢慢往後擺、往前回，尾巴同一個相位一起擺——腿往後的時候尾巴往上。
   力道跟著牠飛得多快（速度 / 腳程）追過去，停下來就淡掉，只剩空中姿勢。
   衝刺、放招、僵直那幾段（還有收尾沒播完的）不漂，讓給那一套動作。

   「盯著主角」不只是姿勢裡把頭壓低：放招鎖定的是倒數開始那一刻的方向，主角
   之後還在跑，所以頭另外跟著主角現在的位置左右轉（LOOK，最多 LOOK.max）。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { Critter } from './critter.js';
import { LUNGE, kindOf } from './combat.js';
import { SKILL } from './skills.js';
import { PHYS } from './walk.js';
import { Mover } from './moves.js';

/** 毛色：body 身上、face 鼻子與嘴。 */
const ZOMBIE = { body: [0.24, 0.80, 0.22], face: [0.08, 0.36, 0.08] };
const GHOST = { body: [0.78, 0.88, 0.98], face: [0.34, 0.44, 0.60] };
/**
 * 每一類的外觀，鍵跟 combat.js 的 KINDS 一樣：毛色、畫多高（公尺）、不透明度
 * （1 = 不透明）、挨打噴出來的是哪一種血（bleed.js 的 STYLE）。
 */
const LOOKS = {
  minion: { coat: ZOMBIE, height: 1.0, alpha: 1, blood: 'blood' },
  boss: { coat: ZOMBIE, height: 2.0, alpha: 1, blood: 'blood' },
  ghost: { coat: GHOST, height: 1.0, alpha: 0.5, blood: 'ecto' },
};
/** 這一類畫多高，跟狗（1）比。落地的粉塵照它算（dust.js）。 */
export const sizeOf = (kind) => LOOKS[kind].height;
/** 這一類挨打噴出來的是哪一種血（bleed.js 的 STYLE）：幽靈是半透明白色的靈質。 */
export const bloodOf = (kind) => LOOKS[kind].blood;

const RED = [0.95, 0.08, 0.06];

/** 攻擊中（combat.js 的 attacking）的墨線顏色。 */
export const ATTACK_INK = new THREE.Color(0xd41414);
/** 半透明的怪物畫在地上那些預告與攻擊範圍（fx.js，renderOrder 2～4）之後，才透得出它們。 */
const SEE_THROUGH_ORDER = 5;

/**
 * 做一隻怪物的外觀。借玩家那個 Zoo 已經讀好的立耳犬資料，不再讀一次 cat.bin。
 *
 * @param {import('./critter.js').Zoo} zoo
 * @param {string} kind KINDS 的鍵
 * @returns {Critter}
 */
export function makeMonsterCritter(zoo, kind) {
  const data = zoo.critters.get('dog-prick').data;
  const look = LOOKS[kind];
  const c = new Critter(data, 'dog-prick', { height: look.height });
  c.setHat(false);
  paint(c, look.coat);
  if (look.alpha < 1) seeThrough(c, look.alpha);
  return c;
}

/** 讓一隻 Critter 半透明：原本的網格只寫深度，另一個網格照 alpha 上色（理由見檔頭）。 */
function seeThrough(c, alpha) {
  const depth = c.mesh;
  /* 材質的 clone 不帶 onBeforeCompile 與快取鍵，要自己接上——骨頭與毛色的
     著色都在那裡面。uniform 是 rig3 閉包裡的同一份，所以兩個網格一起動。 */
  const tint = depth.material.map((m) => {
    const t = m.clone();
    t.onBeforeCompile = m.onBeforeCompile;
    t.customProgramCacheKey = m.customProgramCacheKey;
    t.transparent = true;
    t.opacity = alpha;
    t.depthWrite = false;
    return t;
  });
  c._inkMats.push(tint[2]);              // 畫出來的墨線是這一份，換墨色要連它一起換
  for (const m of depth.material) { m.transparent = true; m.colorWrite = false; }
  const mesh = new THREE.Mesh(c.geometry, tint);
  mesh.position.copy(depth.position);
  mesh.scale.copy(depth.scale);
  mesh.frustumCulled = false;
  depth.renderOrder = mesh.renderOrder = SEE_THROUGH_ORDER;
  depth.parent.add(mesh);
}

/** 照骨頭上色。Critter 沒有「自訂毛色」的入口，所以直接寫它的顏色屬性。 */
function paint(c, coat) {
  const out = c._colorAttr.array;
  const nv = out.length / 3;
  const face = new Uint8Array(nv);
  const idx = c.data.index, g = c._unlitGroup;
  for (let i = g.start; i < g.start + g.count; i++) face[idx[i]] = 1;
  for (let v = 0; v < nv; v++) {
    const eye = c.rig.names[c._boneId[v]].startsWith('eye');
    const col = eye ? RED : face[v] ? coat.face : coat.body;
    out[v * 3] = col[0]; out[v * 3 + 1] = col[1]; out[v * 3 + 2] = col[2];
  }
  c._colorAttr.needsUpdate = true;
}

/* ── 衝刺的動作 ── */

/** 蓄力：後傾低頭。pitch 是整個上半身（連頭），headPitch 再把頭壓回去、壓過頭。 */
const CROUCH = {
  pitch: -0.30, headPitch: 0.78, drop: 0.08, tailPitch: -0.40,
  front: -0.35, hind: -0.50, knee: -0.60, legs: 0.8, w: 1,
};

/** 僵直的前 BOW_TIME 秒：低頭。0.12 秒垂到底，之後停著。 */
const BOW = { pitch: 0.15, headPitch: 0.55, tailPitch: -0.25, w: 1 };
const BOW_TIME = 0.2;

/** 僵直的甩：每一個欄位 [幅度, 每秒幾下, 相位]。尾巴跟頭反向、身體慢一拍。 */
const SHAKE = {
  headYaw: [0.60, 6, 0], headTilt: [0.25, 6, 0],
  tailYaw: [0.75, 5, Math.PI],
  lean: [0.18, 3, Math.PI], twist: [0.14, 3, 0],
};
/** 甩的力道（u 是甩的那一段走到哪，0～1）：頭 10% 甩到最大，前半撐著、後半收到僵直結束。 */
const shakeEnv = (u) => Math.min(1, u / 0.1) * (1 - u * u);

/**
 * 僵直的關鍵影格：先低頭，停到 BOW_TIME；之後照 SHAKE 每 20 毫秒取一格，
 * 低頭的那一份跟著淡掉（頭一邊甩一邊抬回來），最後一格回到原本的樣子。
 */
function shakeKeys() {
  const T = LUNGE.recover, span = T - BOW_TIME, step = 0.02;
  const keys = [[0, {}], [0.12, BOW, 'out'], [BOW_TIME, BOW, 'lin']];
  for (let s = step; s < span - 1e-6; s += step) {
    const u = s / span, e = shakeEnv(u), b = 1 - u * u * (3 - 2 * u);
    const pose = { w: 1 };
    for (const k in BOW) if (k !== 'w') pose[k] = BOW[k] * b;
    for (const [k, [a, hz, ph]] of Object.entries(SHAKE)) pose[k] = (pose[k] || 0) + a * e * Math.sin(2 * Math.PI * hz * s + ph);
    keys.push([BOW_TIME + s, pose, 'lin']);
  }
  keys.push([T, {}, 'lin']);
  return keys;
}

/* ── 火球 ── 蓄到最後是 STRETCH_MAX；吐出去的那一刻在 SPIT_MID，甩到底是 SPIT。 */
const STRETCH = { pitch: -0.35, headPitch: -0.50, drop: -0.06, tailPitch: 0.50, front: -0.20, hind: 0.20, legs: 0.6, w: 1 };
const STRETCH_MAX = { ...STRETCH, pitch: -0.40, headPitch: -0.62, drop: -0.08, tailPitch: 0.60 };
const SPIT = { pitch: 0.20, headPitch: 0.45, drop: 0.04, tailPitch: -0.20, w: 1 };
const SPIT_MID = { pitch: -0.10, headPitch: -0.08, drop: -0.02, tailPitch: 0.20, front: -0.10, hind: 0.10, legs: 0.3, w: 1 };

/* ── 扇形地震 ── 立起來是 REAR，砸下去是 STOMP。 */
const REAR = {
  pitch: -0.80, headPitch: 0.95, drop: -0.12, tailPitch: 0.40,
  front: -1.10, knee: 0.70, hind: -0.20, legs: 1, w: 1,
};
const STOMP = {
  pitch: 0.30, headPitch: 0.10, drop: 0.12, tailPitch: 0.20,
  front: -0.40, hind: 0.20, knee: -0.30, legs: 0.8, w: 1,
};

/* ── 跳砸 ── 蓄力是 COIL，落地緩衝是 LAND。 */
const COIL = {
  pitch: 0.50, headPitch: -0.70, drop: 0.34, tailPitch: 0.45,
  front: -0.90, hind: -0.60, knee: -1.00, legs: 1, w: 1,
};
const LAND = {
  pitch: 0.40, headPitch: 0.10, drop: 0.25, tailPitch: 0.40,
  front: -0.30, hind: -0.50, knee: -0.80, legs: 0.9, w: 1,
};
/** 跳砸站著蓄力的那一段有多長（之後 SKILL.leap.air 秒在飛）。 */
const LEAP_WIND = SKILL.leap.windup - SKILL.leap.air;

/**
 * 頭跟著主角轉：哪幾段要盯（值是盯多用力）、多快轉過去與放掉（秒）、最多轉多少（弳）。
 */
const LOOK = { stages: { coneWind: 1, leapWind: 1 }, tau: 0.12, max: 1.0 };

/**
 * 怪物的每一套動作（moves.js 的 MOVES 那一種寫法），鍵就是 Motion 挑的那一段：
 * 衝刺的蓄力、衝、僵直，BOSS 每一招的倒數（…Wind）與出招後的僵直（…Rec）。
 */
const MOVES = {
  windup: { blend: 0.05, keys: [[0, {}], [0.16, CROUCH, 'out'], [LUNGE.windup, { ...CROUCH, headPitch: 0.86, drop: 0.10 }, 'inOut']] },
  dash: { blend: 0.05, keys: [[0, {}]] },
  recover: { blend: 0.04, keys: shakeKeys() },
  orbWind: {
    blend: 0.08,
    keys: [[0, {}], [0.55, STRETCH, 'out'], [SKILL.orb.windup - 0.06, STRETCH_MAX, 'inOut'], [SKILL.orb.windup, SPIT_MID, 'in']],
  },
  orbRec: { blend: 0.02, keys: [[0, SPIT_MID], [0.05, SPIT, 'out'], [0.14, SPIT, 'lin'], [SKILL.recover, {}, 'inOut']] },
  coneWind: {
    blend: 0.1,
    keys: [
      [0, {}], [0.6, REAR, 'out'],
      [SKILL.cone.windup - 0.14, { ...REAR, pitch: -0.88, headPitch: 1.02, drop: -0.14 }, 'inOut'],
      [SKILL.cone.windup, STOMP, 'in'],
    ],
  },
  coneRec: { blend: 0.02, keys: [[0, STOMP], [0.08, { ...STOMP, pitch: 0.36, drop: 0.16 }, 'out'], [SKILL.recover, {}, 'inOut']] },
  leapWind: { blend: 0.1, keys: [[0, {}], [0.35, COIL, 'out'], [LEAP_WIND, { ...COIL, drop: 0.38, knee: -1.05 }, 'inOut']] },
  leapAir: { blend: 0.06, keys: [[0, {}]] },
  leapRec: { blend: 0.03, keys: [[0, {}], [0.08, LAND, 'out'], [0.18, LAND, 'lin'], [SKILL.recover, {}, 'inOut']] },
};

/**
 * 會飛的移動時的漂：每一條 [中心, 幅度]（弳；腿正值往後、尾巴正值往上），四條腿
 * 與尾巴同一個相位。hz 一秒擺幾下（慢）；tau 力道追速度的時間常數（秒）；yield 讓給
 * 別的動作的時候收得多快（秒）——衝刺的蓄力只有 LUNGE.windup，要在那裡面收乾淨。
 */
const DRIFT = {
  front: [0.35, 0.25], hind: [0.75, 0.25], knee: [0.20, 0.10], tailPitch: [0.10, 0.30],
  hz: 0.6, tau: 0.25, yield: 0.05,
};
const DRIFT_LEGS = ['front', 'hind', 'knee'];

/** 衝的時候畫得跳多高：體型（sizeOf）的這麼多倍，公尺。 */
const DASH_HOP = 0.25;

/**
 * 一隻怪物的動作：每幀看牠在做什麼，挑 MOVES 的哪一段、播到第幾秒，交給
 * 主角那一個播放器（段與段之間淡進淡出）。有幾段是「跳」：不疊動作，而是跟
 * Critter 說在空中、垂直速度多少，讓牠擺跳躍的姿勢（見檔頭）。
 */
export class Motion {
  constructor() {
    this.mover = new Mover(MOVES, (phase, t) => [phase, t]);
    /** 上一次在放哪一招：出招之後的僵直播它的收尾。 */
    this._skill = null;
    /** 頭跟著主角轉的那一份現在有多少（0～1，追 LOOK.stages 給的目標）。 */
    this._look = 0;
    /** 漂的力道（0～1，追速度）與擺到哪（弳）。 */
    this._drift = 0;
    this._swing = 0;
    this._pose = {};
    this._driftPose = {};
    this._out = { move: null, lift: 0, air: false, vy: null };
  }

  /**
   * @param {number} dt
   * @param {object} m combat.js 的怪物
   * @param {{x: number, z: number}} player 主角：要盯著的時候頭轉向牠
   * @returns {{move: object, lift: number, air: boolean, vy: number | null}}
   *   move 疊在上面的動作（給 critter.update）、lift 身體畫得比 m.y 高多少（公尺）、
   *   air 畫成在空中、vy 交給 Critter 的垂直速度（null = 用 m.vy）
   */
  step(dt, m, player) {
    const o = this._out;
    o.lift = 0; o.air = false; o.vy = null;
    const [stage, t] = this._stage(m);
    if (stage === 'dash') this._hop(o, m, t);
    if (stage === 'leapAir') this._fly(o, m, t);
    const move = this.mover.step(dt, stage, t);
    o.move = this._lookAt(dt, stage, m, player, this._float(dt, stage, m, move));
    return o;
  }

  /**
   * 會飛的漂（DRIFT）疊到播放器的那一份上：尾巴是加的；腿跟 moveOverlay 一樣是
   * 「換成那個姿勢多少」，所以跟那一招自己的 legs 合成一份——那一招換多少先算，
   * 剩下的才是漂的。播放器的那一份不能改，寫在自己的一份上。
   */
  _float(dt, stage, m, move) {
    const K = kindOf(m);
    const free = !stage && !this.mover.name;
    const goal = K.fly && free ? Math.min(1, Math.hypot(m.vx, m.vy, m.vz) / K.speed) : 0;
    this._drift += (goal - this._drift) * (1 - Math.exp(-dt / (free ? DRIFT.tau : DRIFT.yield)));
    this._swing = (this._swing + 2 * Math.PI * DRIFT.hz * dt) % (2 * Math.PI);
    const w = this._drift;
    if (w < 1e-3) return move;
    const s = Math.sin(this._swing), at = ([c, a]) => c + a * s;
    const pose = Object.assign(this._driftPose, move);
    const L0 = Math.min(1, Math.max(0, move.legs)), L = L0 + (1 - L0) * w;
    for (const k of DRIFT_LEGS) pose[k] = (L0 * move[k] + (1 - L0) * w * at(DRIFT[k])) / L;
    pose.legs = L;
    pose.tailPitch = move.tailPitch + w * at(DRIFT.tailPitch);
    return pose;
  }

  /**
   * 頭跟著主角轉：主角在身體朝向的哪一邊，頭就再轉那麼多（夾在 ±LOOK.max）。
   * 轉多少乘上 _look，進出那幾段是追過去的，不是一幀跳過去。頭既然在看人，
   * 就不轉向鏡頭（w 至少是 _look）。播放器的那一份不能改（它下一招從那裡淡），
   * 所以寫在自己的一份上。
   */
  _lookAt(dt, stage, m, player, move) {
    const goal = LOOK.stages[stage] || 0;
    this._look += (goal - this._look) * (1 - Math.exp(-dt / LOOK.tau));
    if (this._look < 1e-3 || !player) return move;
    const face = Math.atan2(m.aimX, m.aimZ), to = Math.atan2(player.x - m.x, player.z - m.z);
    let d = to - face;
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    const pose = Object.assign(this._pose, move);
    pose.headYaw = move.headYaw + Math.max(-LOOK.max, Math.min(LOOK.max, d)) * this._look;
    pose.w = Math.max(move.w, this._look);
    return pose;
  }

  /**
   * 現在在哪一段、這一段走了幾秒。沒在做什麼是 [null, 0]。被擊退、定住、推開
   * 的時候也是——動作淡掉，交回給空中姿勢。
   */
  _stage(m) {
    if (m.air || m.held || m.slide) return [null, 0];
    const c = m.cast;
    if (c) {
      this._skill = c.skill;
      if (c.skill === 'leap' && c.t >= LEAP_WIND) return ['leapAir', c.t - LEAP_WIND];
      return MOVES[`${c.skill}Wind`] ? [`${c.skill}Wind`, c.t] : [null, 0];
    }
    if (m.stun > 0 && MOVES[`${this._skill}Rec`]) return [`${this._skill}Rec`, SKILL.recover - m.stun];
    const L = m.lunge;
    if (!L) return [null, 0];
    if (L.t < LUNGE.windup) return ['windup', L.t];
    const s = L.t - LUNGE.windup;
    return s < LUNGE.time ? ['dash', s] : ['recover', s - LUNGE.time];
  }

  /**
   * 跳砸飛過去的那一段：位置是 skills.js 一幀一幀擺的（牠身上的 vy 一直是 0），
   * 所以垂直速度照那一條拋物線自己算——從往上換成往下，交給 Critter 擺跳躍的姿勢。
   */
  _fly(o, m, s) {
    const c = m.cast, A = SKILL.leap.air, u = Math.min(1, Math.max(0, s / A));
    o.air = true;
    o.vy = ((c.ty - c.y0) + (PHYS.gravity * A * A / 2) * (1 - 2 * u)) / A;
  }

  /**
   * 衝的那一段畫成一跳：第 s 秒身體畫得高出多少（拋物線，頭尾是 0），以及
   * 那條拋物線的垂直速度——交給 Critter 的 vy，空中姿勢照它從前伸換成找地板，
   * 落地那一沉照它踢多重。會飛的不跳（本來就飄著），只換姿勢。
   */
  _hop(o, m, s) {
    const u = Math.min(1, Math.max(0, s / LUNGE.time));
    const h = DASH_HOP * sizeOf(m.kind);
    o.lift = kindOf(m).fly ? 0 : h * 4 * u * (1 - u);
    o.air = true;
    o.vy = (h * 4 * (1 - 2 * u)) / LUNGE.time;
  }
}
