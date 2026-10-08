/* ── test/src/king.js ────────────────────────────────────────────────
   復活的國王（完整流程模式）：獻靈魂交滿之後，幽靈國王的屍體炸開、血聚攏回來，聚到的那一點
   長出活著的國王（fight.js 的 REVIVE 管什麼時候、長到幾成）。這一支是牠的外觀與牠自己的動作。

   外觀是 monster.js 的 makeLivingKing（垂耳犬原本的灰毛、1.4 倍高），戴王冠（crown.js）。
   一開始就建好、藏著：復甦的那一刻才建、才編的話就頓一下。頭跟著主角轉（gaze.js），跟人民一樣。

   ── 走上王座 ────────────────────────────────────────────────────
   國王復活那一頁（第 14 頁）翻完，牠走回王座坐下（enthrone）：
     走     照 thronePath 那一條走，KING.walk 公尺每秒，照常的步態。先橫著走到王座前面那一條
            中線上（還在階梯前面），再沿著中線走上階梯、走到座前 KING.front 公尺（台座上）。
            腳下的高度照 walk.js 的 supportInfo，問到台座那麼高為止：王座廳的階梯是反著砌的（最高的
            那一級 0.9 對著廳裡、往台座那一邊一級一級變矮），主角走不上去、要跳，國王是爬上去的。
            遇到一級高低不一樣的就停下來，KING.climb 公尺每秒爬上去（或下來），爬完再走。
     轉身   KING.turn 秒轉過去，背對王座。
     坐     KING.sit 秒退上座面：位置從座前移到座面中心、高度升到座面（中間多拱 KING.hop），
            姿勢從站著淡進坐姿（SIT，跟漫畫裡國王坐在王座上的那一個一樣）。
     坐著   一直坐著，頭照樣跟著主角。
   路上不碰撞：路是照王座廳排好的（中殿中間是空的），模式撒人民的時候也避開這一條（pathGap）。
   ------------------------------------------------------------------ */

import { PHYS, supportInfo } from './walk.js';
import { makeLivingKing, sizeOf } from './monster.js';
import { Crown } from './crown.js';
import { Gaze, aimHead, GAZE } from './gaze.js';

/** 走多快（公尺每秒）、坐在座前多遠的地方轉身、轉身幾秒、退上座面幾秒、退上去中間多拱多高。 */
export const KING = { walk: 1.6, climb: 2.0, front: 1.2, turn: 0.5, sit: 0.7, hop: 0.15 };

/** 坐：後腿收在身體底下，上半身立起來，前腳撐直（tools/comic/shots.js 的 SIT）。 */
const SIT = { pitch: -0.5, headPitch: 0.3, drop: 0.12, tailPitch: -0.5, front: 0.25, hind: 1.3, knee: -1.1, legs: 1, w: 1 };

/** 坐姿淡進來 u（0～1）：每一個角度乘 u（w 不乘：頭一直是 gaze 管的）。 */
const sitting = (u) => Object.fromEntries(Object.entries(SIT).map(([k, v]) => [k, k === 'w' ? v : v * u]));

const smooth = (u) => u * u * (3 - 2 * u);

/**
 * 從 `from`（{x, z}）走到王座的路：先橫著走到中線上（在階梯前面），再沿著中線走到座前。
 * `seat` 是王座（世界座標：x、z 是座面中心、stair 是階梯底的 z，王座朝 −z）。
 *
 * @returns {{x: number, z: number}[]} 要依序走到的點（不含起點）
 */
export function thronePath(from, seat) {
  const out = [];
  if (Math.abs(from.x - seat.x) > 0.05) out.push({ x: seat.x, z: Math.min(from.z, seat.stair - 0.6) });
  out.push({ x: seat.x, z: seat.z - KING.front });
  return out;
}

/** (x, z) 離這一條路（從 from 開始）多遠（公尺，水平）。 */
export function pathGap(from, path, x, z) {
  let best = Infinity, a = from;
  for (const b of path) {
    const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L)) : 0;
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
    a = b;
  }
  return best;
}

export class LivingKing {
  /**
   * @param {import('../vendor/three.module.js').Scene} scene
   * @param {import('./critter.js').Zoo} zoo
   */
  constructor(scene, zoo) {
    this.critter = makeLivingKing(zoo);
    this.crown = new Crown();
    this.crown.follow(this.critter);
    this.critter.root.visible = false;
    scene.add(this.critter.root);
    /** 站在哪、面朝哪（{x, y, z, yaw}）；還沒復甦是 null。 */
    this.at = null;
    this.gaze = new Gaze();
    /** 走上王座（enthrone）：{cols, seat, path, phase, t, from}；還沒開始是 null。 */
    this.trip = null;
  }

  setInkPx(px, h) { this.critter.setInkPx(px, h); }

  /** 復甦開始：之後在 (x, y, z) 長出來、面朝 yaw。長之前還藏著。 */
  place(x, y, z, yaw) {
    this.at = { x, y, z, yaw };
    this.trip = null;
    const c = this.critter;
    c._yaw = c._yawGoal = yaw;
    this.gaze.reset();
  }

  /**
   * 走回王座坐下（見檔頭）。`cols` 是碰撞體（腳下的高度照它），`seat` 是王座（世界座標，
   * blocks.js 的 THRONE 加上王座廳的位置）。
   */
  enthrone(cols, seat) {
    if (!this.at) return;
    this.trip = { cols, seat, path: thronePath(this.at, seat), phase: 'walk', t: 0 };
  }

  /** 看得到的時候腳下那一片接觸陰影要的（light/contact.js 的 crowd）；藏著是 null。 */
  body() {
    if (!this.critter.root.visible) return null;
    const { at } = this, y = this.critter._yaw;
    return { x: at.x, y: at.y, z: at.z, aimX: Math.sin(y), aimZ: Math.cos(y), size: this.critter.root.scale.x * sizeOf('king') };
  }

  /** 收起來（重玩）。 */
  hide() {
    this.at = null;
    this.trip = null;
    this.critter.root.visible = false;
  }

  /**
   * 走上王座的一幀：挪 `at`，回傳這一幀的步速與疊上去的姿勢（坐姿，沒有是 null）。
   */
  _walk(dt) {
    const v = this.trip, at = this.at;
    if (!v) return { speed: 0, pose: null };
    v.t += dt;
    if (v.phase === 'walk') {
      // 腳下的地板（問到台座那麼高）：跟現在的高度不一樣就停下來爬，爬完才走。
      const floor = supportInfo(v.cols, at.x, at.z, v.seat.y).y, rise = floor - at.y, lift = KING.climb * dt;
      if (Math.abs(rise) > 1e-6) {
        at.y = Math.abs(rise) <= lift ? floor : at.y + Math.sign(rise) * lift;
        return { speed: 0, pose: null };
      }
      const goal = v.path[0];
      const dx = goal.x - at.x, dz = goal.z - at.z, d = Math.hypot(dx, dz), step = KING.walk * dt;
      if (d > 1e-6) at.yaw = Math.atan2(dx, dz);
      if (d <= step) { at.x = goal.x; at.z = goal.z; v.path.shift(); } else { at.x += (dx / d) * step; at.z += (dz / d) * step; }
      if (!v.path.length) {
        v.phase = 'turn'; v.t = 0;
        v.from = { x: at.x, y: at.y, z: at.z };
        at.yaw = Math.atan2(at.x - v.seat.x, at.z - v.seat.z);   // 背對王座
      }
      return { speed: KING.walk, pose: null };
    }
    if (v.phase === 'turn') {
      at.y = v.from.y;
      if (v.t >= KING.turn) {
        v.phase = 'sit'; v.t = 0;
        v.top = supportInfo(v.cols, v.seat.x, v.seat.z, v.seat.y + 1).y;
      }
      return { speed: 0, pose: null };
    }
    const u = Math.min(1, v.t / KING.sit), e = smooth(u);
    at.x = v.from.x + (v.seat.x - v.from.x) * e;
    at.z = v.from.z + (v.seat.z - v.from.z) * e;
    at.y = v.from.y + (v.top - v.from.y) * e + KING.hop * Math.sin(Math.PI * u);
    if (u >= 1) v.phase = 'seated';
    return { speed: 0, pose: sitting(e) };
  }

  /**
   * 這一幀：`grown` 是長到幾成（0 = 藏著、1 = 原本大小），繞著腰那一點放大；在走上王座的話
   * 照著走；頭跟著 `player`。在相機擺好之後叫。
   */
  draw(dt, camera, grown, player) {
    const { critter, crown, at } = this;
    critter.root.visible = !!at && grown > 0;
    if (!critter.root.visible) return;
    const { speed, pose } = this._walk(dt);
    const waist = (PHYS.height / 2) * sizeOf('king');
    critter.root.position.set(at.x, at.y + waist * (1 - grown), at.z);
    critter.root.scale.setScalar(grown);
    critter.setFacing(at.yaw);
    const aim = aimHead(critter._yaw, at.x, at.y + GAZE.eye * critter.height * grown, at.z,
      player.x, player.y + GAZE.eye * PHYS.height, player.z);
    critter.update(dt, {
      speed, grounded: true, vy: 0, viewYaw: Math.atan2(camera.position.x - at.x, camera.position.z - at.z),
      move: this.gaze.step(dt, aim, pose),
    });
    crown.update();
  }
}
