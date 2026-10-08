/* ── test/src/gaze.js ────────────────────────────────────────────────
   頭跟著主角轉（完整流程模式，國王復活之後：王國的人民與國王，folk.js、king.js）。

   跟的是主角頭那一點的三個座標：左右（headYaw）、上下（headPitch）都照從自己的頭看過去的
   方向給，主角跑遠、跳起來、走到台階上，頭都跟著。左右要轉超過 GAZE.limit（60°）的話不跟了，
   頭回到正前方（那一個姿勢本來的頭）；主角走回前面那 120° 裡又跟上。轉過去、轉回來都是追的
   （GAZE.tau），不是一幀跳過去。上下最多 GAZE.pitch。

   身體本來就仰著的姿勢（國王坐著，pitch 是負的）：頭的上下是疊在身體上的，所以扣掉身體仰的
   那一份，看出去的還是主角。

   疊上去的是 critter.js 的 moveOverlay 那一種動作（w = 1：頭不再另外轉向鏡頭）。
   ------------------------------------------------------------------ */

/** 左右最多跟到幾弳、轉頭追得多快（秒，指數追）、上下最多幾弳、眼睛在身高的幾成。 */
export const GAZE = { limit: Math.PI / 3, tau: 0.2, pitch: 0.7, eye: 0.75 };

const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * 從頭 (hx, hy, hz) 看 (tx, ty, tz)、身體面朝 yaw：頭要左右轉多少（正值往左）、上下轉多少
 * （正值低頭）。左右超過 GAZE.limit 回傳 null——不跟，看前面。
 */
export function aimHead(yaw, hx, hy, hz, tx, ty, tz) {
  const dx = tx - hx, dz = tz - hz;
  const rel = wrap(Math.atan2(dx, dz) - yaw);
  if (Math.abs(rel) > GAZE.limit) return null;
  return { yaw: rel, pitch: clamp(Math.atan2(hy - ty, Math.hypot(dx, dz)), -GAZE.pitch, GAZE.pitch) };
}

/** 一顆頭：現在轉了多少，每幀往要轉的地方追。 */
export class Gaze {
  constructor() {
    this.yaw = 0;
    this.pitch = 0;
  }

  /**
   * 一幀。`aim` 是 aimHead 的結果（null = 看前面），`base` 是這一個姿勢本來的動作（moveOverlay
   * 的欄位，沒有就是站著）。回傳疊上去的動作：base 加上頭現在轉的那一份。
   */
  step(dt, aim, base = null) {
    const b = base || {};
    const yaw = aim ? aim.yaw : b.headYaw || 0;
    const pitch = aim ? aim.pitch - (b.pitch || 0) : b.headPitch || 0;
    const k = 1 - Math.exp(-dt / GAZE.tau);
    this.yaw += (yaw - this.yaw) * k;
    this.pitch += (pitch - this.pitch) * k;
    return { ...b, headYaw: this.yaw, headPitch: this.pitch, w: 1 };
  }

  /** 直接擺到正前方（剛出現的時候）。 */
  reset(base = null) {
    this.yaw = base?.headYaw || 0;
    this.pitch = base?.headPitch || 0;
  }
}
