/* ── test/src/king.js ────────────────────────────────────────────────
   復活的國王（完整流程模式）：獻靈魂交滿之後，幽靈國王的屍體炸開、血聚攏回來，聚到的那一點
   長出活著的國王（fight.js 的 REVIVE 管什麼時候、長到幾成）。這一支是牠的外觀與牠自己的動作。

   外觀是 monster.js 的 makeLivingKing（垂耳犬原本的灰毛、1.4 倍高），戴王冠（crown.js）。
   一開始就建好、藏著：復甦的那一刻才建、才編的話就頓一下。
   ------------------------------------------------------------------ */

import { PHYS } from './walk.js';
import { makeLivingKing, sizeOf } from './monster.js';
import { Crown } from './crown.js';

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
  }

  setInkPx(px, h) { this.critter.setInkPx(px, h); }

  /** 復甦開始：之後在 (x, y, z) 長出來、面朝 yaw。長之前還藏著。 */
  place(x, y, z, yaw) {
    this.at = { x, y, z, yaw };
    const c = this.critter;
    c._yaw = c._yawGoal = yaw;
  }

  /** 收起來（重玩）。 */
  hide() {
    this.at = null;
    this.critter.root.visible = false;
  }

  /**
   * 這一幀：`grown` 是長到幾成（0 = 藏著、1 = 原本大小），繞著腰那一點放大。在相機擺好之後叫。
   */
  draw(dt, camera, grown) {
    const { critter, crown, at } = this;
    critter.root.visible = !!at && grown > 0;
    if (!critter.root.visible) return;
    const waist = (PHYS.height / 2) * sizeOf('king');
    critter.root.position.set(at.x, at.y + waist * (1 - grown), at.z);
    critter.root.scale.setScalar(grown);
    critter.setFacing(at.yaw);
    critter.update(dt, {
      speed: 0, grounded: true, vy: 0, viewYaw: Math.atan2(camera.position.x - at.x, camera.position.z - at.z), move: null,
    });
    crown.update();
  }
}
