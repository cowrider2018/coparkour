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
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { Critter } from './critter.js';
import { LUNGE, kindOf } from './combat.js';
import { SKILL } from './skills.js';
import { Mover } from './moves.js';

/** 毛色：body 身上、face 鼻子與嘴。 */
const ZOMBIE = { body: [0.24, 0.80, 0.22], face: [0.08, 0.36, 0.08] };
const GHOST = { body: [0.78, 0.88, 0.98], face: [0.34, 0.44, 0.60] };
/**
 * 每一類的外觀，鍵跟 combat.js 的 KINDS 一樣：毛色、畫多高（公尺）、不透明度
 * （1 = 不透明）。
 */
const LOOKS = {
  minion: { coat: ZOMBIE, height: 1.0, alpha: 1 },
  boss: { coat: ZOMBIE, height: 2.0, alpha: 1 },
  ghost: { coat: GHOST, height: 1.0, alpha: 0.5 },
};
/** 這一類畫多高，跟狗（1）比。落地的粉塵照它算（dust.js）。 */
export const sizeOf = (kind) => LOOKS[kind].height;

const RED = [0.95, 0.08, 0.06];
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
};

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
    this._out = { move: null, lift: 0, air: false, vy: null };
  }

  /**
   * @param {number} dt
   * @param {object} m combat.js 的怪物
   * @returns {{move: object, lift: number, air: boolean, vy: number | null}}
   *   move 疊在上面的動作（給 critter.update）、lift 身體畫得比 m.y 高多少（公尺）、
   *   air 畫成在空中、vy 交給 Critter 的垂直速度（null = 用 m.vy）
   */
  step(dt, m) {
    const o = this._out;
    o.lift = 0; o.air = false; o.vy = null;
    const [stage, t] = this._stage(m);
    if (stage === 'dash') this._hop(o, m, t);
    o.move = this.mover.step(dt, stage, t);
    return o;
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
