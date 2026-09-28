/* ── test/src/fight.js ───────────────────────────────────────────────
   一場戰鬥在畫面上跑起來的那一層：場上的怪物與牠們的外觀、玩家的連段、
   打中與被打中、BOSS 的招與球、刀與出招的動作。

   規則全在 combat.js 與 skills.js（node 驗得動）；這裡把規則接到一幀一幀的
   迴圈上，並且擺好 three 的東西。戰鬥模式（一塊空地）與完整流程模式（遺跡）
   用的是同一份，差別只在怪物站在什麼樣的場地（`lineup` 的 field）、以及打死
   之後怎樣（`respawn`）。

   ── 一幀的順序 ──────────────────────────────────────────────────
     lead     按跳交給連段：普通的跳、某一段的出手，或是破防攻擊。在操控之前，
              因為破防攻擊一發動就接管速度。
     （模式自己操控、移動玩家：`breaking` 的時候不操控，`spinning` 的時候不移動）
     resolve  怪物追人、放招、球往前飛，然後才判打中——兩個身體都走完這一幀了，
              範圍是對著畫面上的位置判的。打死 BOSS 掉出靈魂，靈魂往下掉、漂，碰到
              就撿起來。回報玩家挨了哪一下、倒下沒有、打死了誰、撿了幾顆靈魂。
     draw     怪物、劍氣（攻擊範圍）、BOSS 的預告與球、靈魂、破防的兩圈、刀、頭頂的愛心。
              在相機擺好之後（破防的兩圈與愛心正對這一幀的鏡頭）。
   ------------------------------------------------------------------ */

import { PHYS, supportInfo } from './walk.js';
import {
  FIELD, KNOCK_SCALE, DAMAGE, KINDS, BREAK_WINDOW, hurt, makeMonster, harm, lifeStep, gainHeart,
  SOUL, dropSoul, soulStep, grabs,
  breaking, breakTarget, startBreak, breakContact, latch, spinStep, separate, placeMonster, monsterStep, bites, knock,
  inSlash, inFan, inRing, slashTip, makeCombo, comboStep, invulnerable, cueing,
} from './combat.js';
import { makeMonsterCritter } from './monster.js';
import { Blade } from './blade.js';
import { Mover } from './moves.js';
import {
  cueFx, showFx, breakFx, showBreak, laneFx, showLane, orbMesh, circleFx, showCircle,
  coneFx, showCone, soulMesh,
} from './fx.js';
import { SKILL, makeWorld, bossStep, shotsStep, shotHits, strikeHits, laneLength } from './skills.js';
import { Hearts } from './hearts.js';
import { TRAILS } from './trail.js';
import { Qi } from './qi.js';

/** 右上那一行小字：現在在連段的哪裡。 */
export const PHASE_NAME = {
  idle: '待機', slash: '第一段', rest: '第一段收招', rise: '第二段', air: '第二段之後', leap: '第三段起跳', slam: '第三段落地',
  dash: '破防突進', spin: '破防迴旋', vault: '破防跳離',
};

/** 玩家挨了哪一下 → 給人看的一句話。 */
export const DEATH_TEXT = { bitten: '被咬到了', shot: '被球打中了', struck: '被 BOSS 的招打中了' };

export class Fight {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./critter.js').Zoo} zoo 玩家那一隻（刀掛在牠頭上，怪物借牠的立耳犬資料）
   * @param {{respawn?: boolean}} o respawn：打死的怪物在牠的重生點重生（戰鬥模式）；
   *   false 的話打死就離場（完整流程）
   */
  constructor(scene, zoo, { respawn = true } = {}) {
    this.scene = scene;
    this.zoo = zoo;
    this.respawn = respawn;
    /** 咬在嘴裡的刀：掛在現在那一隻的頭上，換動物就跟著換過去（`follow`）。 */
    this.blade = new Blade();
    this.blade.follow(zoo.active);
    /** 出招的動作：照連段的狀態播，疊在步態與空中姿勢上面。 */
    this.mover = new Mover();
    /** 出招中鎖住的朝向 [x, z]（null = 沒鎖，跟著 aim）。見 body。 */
    this._face = null;
    this._body = {};

    /* 怪物：每一隻是「狀態」（combat.js 的 makeMonster）加上「外觀」（monster.js 的
       Critter、破防的兩圈、三種預告）。外觀是每一類一個池子，換陣容的時候借用、多的
       藏起來：一隻 Critter 是一份自己的幾何，來回切陣容不該每次重建。 */
    this.foes = [];
    this._pool = new Map();
    this._inkPx = null;

    /* BOSS 放出來的球。一顆球一個 mesh，不夠就多做。 */
    this.world = makeWorld();
    this._orbs = [];

    /* 連段的狀態與按鍵的提示圈。 */
    this.combo = makeCombo();
    this._fx = { cue: cueFx() };
    scene.add(this._fx.cue.node);
    /** 劍氣：三段攻擊的範圍，一道卡通的月牙（trail.js 算形狀、qi.js 畫）。還看得到的
        每一道，與收掉的那幾道（下一道借）。 */
    this._qis = [];
    this._spare = [];
    /** 上一幀在哪一段：換段的那一刻起一道劍氣。 */
    this._phase = this.combo.phase;
    /** 這一幀在哪一段，它的範圍打不打得到怪物。第二段指著上一次第一段的末端點。 */
    this._reach = { slash: inSlash, rise: (p, m) => inFan(p, m, this.combo.tip), slam: inRing };

    /** 玩家頭頂的愛心：還剩幾點血。 */
    this.hearts = new Hearts(scene);

    /* BOSS 掉出來的靈魂（combat.js 的 dropSoul）。換陣容不清——完整流程裡打完一場就換
       下一場，沒撿的留在原地；回到站位（reset）才清。一顆一個 mesh，不夠就多做。 */
    this.souls = [];
    this._soulMeshes = [];
  }

  /** 換了動物：刀掛到新那一隻頭上。 */
  follow() { this.blade.follow(this.zoo.active); }

  /** 墨線多粗（controls.js 的 fitView 給）。之後才借出去的外觀也要，所以記著。 */
  setInkPx(px, h) {
    this._inkPx = [px, h];
    for (const list of this._pool.values()) for (const s of list) s.critter.setInkPx(px, h);
  }

  _slot(kind, i) {
    if (!this._pool.has(kind)) this._pool.set(kind, []);
    const list = this._pool.get(kind);
    while (list.length <= i) {
      const slot = {
        critter: makeMonsterCritter(this.zoo, kind), breakFx: breakFx(),
        lane: laneFx(SKILL.orb.radius), circle: circleFx(SKILL.leap.radius), cone: coneFx(SKILL.cone.radius, SKILL.cone.half),
      };
      if (this._inkPx) slot.critter.setInkPx(...this._inkPx);
      this.scene.add(slot.critter.root, slot.breakFx.node, slot.lane.node, slot.circle.node, slot.cone.node);
      list.push(slot);
    }
    return list[i];
  }

  static _hide(s) {
    s.critter.root.visible = false;
    s.breakFx.node.visible = false;
    s.lane.node.visible = false;
    s.circle.node.visible = false;
    s.cone.node.visible = false;
  }

  /**
   * 換一批怪物上場：借好每一隻的外觀、藏起用不到的，每一隻站在自己的站位上。
   * 連段與飛著的球一起清掉。空的清單就是清場。
   *
   * @param {object[]} spawns 站位（combat.js 的 makeMonster 吃的那一種）
   * @param {object} field 牠們站在什麼樣的場地（combat.js 的 FIELD 那一種）
   */
  lineup(spawns, field = FIELD) {
    for (const list of this._pool.values()) for (const s of list) Fight._hide(s);
    const used = new Map();
    this.foes = spawns.map((s) => {
      const i = used.get(s.kind) || 0;
      used.set(s.kind, i + 1);
      const slot = this._slot(s.kind, i);
      slot.critter.root.visible = true;
      slot.critter.setFacing(s.yaw);
      return { m: makeMonster(s, field), ...slot };
    });
    this.world = makeWorld(field);
    Object.assign(this.combo, makeCombo());
    this._dropTrails();
  }

  /** 怪物全部回到站位（血滿、破防歸零），連段與球清掉。 */
  reset() {
    for (const f of this.foes) {
      placeMonster(f.m);
      f.critter.setFacing(f.m.spawn.yaw);
    }
    Object.assign(this.combo, makeCombo());
    this._face = null;
    this.world.shots.length = 0;
    this.souls.length = 0;
    this._dropTrails();
  }

  /** 破防攻擊裡：突進與跳離是拋物線、迴旋的位置由 spinStep 擺，模式不要操控玩家。 */
  get breaking() { return breaking(this.combo); }

  /** 迴旋中：玩家的位置由 spinStep 擺，模式不要移動玩家。 */
  get spinning() { return this.combo.phase === 'spin'; }

  /**
   * 出招的那個身體：位置是玩家的，面向是出手那一刻鎖住的。
   *
   * 連段的招一出手就不跟著搖桿轉身（moves.js 的 hold），招連同收尾播完才放開。
   * 腳還是跟著搖桿走——鎖的只有朝向。範圍、擊退、劍氣都照這個身體算，所以畫面上
   * 刀掃到哪、判定就在哪，不會身體還朝著舊方向、範圍已經跟著搖桿轉過去。
   * 沒鎖的時候就是玩家本人。
   */
  body(player) {
    if (!this._face) return player;
    const b = Object.assign(this._body, player);
    b.aimX = this._face[0]; b.aimZ = this._face[1];
    return b;
  }

  /** 動物這一幀該面向哪（給 setFacing）：出招中是鎖住的朝向，其餘跟著 aim。 */
  faceYaw(player) {
    const b = this.body(player);
    return Math.atan2(b.aimX, b.aimZ);
  }

  /**
   * 按跳交給連段。站不站在地上看的是上一幀的結果，跟判斷能不能跳是同一個時間點。
   * 要起跳的話這裡就把垂直速度給玩家。
   */
  lead(dt, player, pressed) {
    const combo = this.combo;
    const target = breakTarget(player, this.foes.map((f) => f.m));
    const act = comboStep(combo, dt, {
      pressed, grounded: player.grounded, near: this.foes.some((f) => inSlash(this.body(player), f.m)),
      breakable: !!target,
    });
    /* 出手就鎖住朝向。前一招還沒播完（還鎖著）的話沿用那一個：接招不轉身。 */
    if (act.start) this._face ??= [player.aimX, player.aimZ];
    if (act.brk) this._face = null;
    if (act.start === 1) combo.tip = slashTip(this.body(player));
    if (act.brk) startBreak(combo, player, target);
    if (act.jump) {
      player.vy = PHYS.jump;
      player.grounded = false;
    }
    return act;
  }

  /**
   * 怪物這一幀，然後判打中。
   *
   * @returns {{hit: null | {cause: string, dmg: number}, died: null | string, kills: string[]}}
   *   hit   玩家這一幀挨了哪一下（cause 是 DEATH_TEXT 的鍵）、扣了幾點血。被衝刺咬到
   *         扣那一類的 `bite`、被球或範圍攻擊打到扣那一招的 `damage`；同一幀碰到好幾下
   *         只算最重的那一下。玩家無敵（第三段、破防攻擊）或剛挨過一下（LIFE.guard）
   *         都不算。
   *   died  這一下把血扣光了：倒下，怎麼倒的（hit 的 cause）。
   *   kills 這一幀打死的怪物是哪一類（KINDS 的鍵）。
   *   souls 這一幀撿了幾顆靈魂（最大血量已經加上去了）。
   */
  resolve(dt, player) {
    const combo = this.combo, foes = this.foes;
    const kills = [];
    lifeStep(player, dt);
    // BOSS 先決定這一幀在不在放招（放招中 monsterStep 讓牠站著），球往前飛。
    const strikes = foes.map(({ m }) => bossStep(m, dt, player, this.world)).filter(Boolean);
    shotsStep(this.world, dt);
    for (const { m } of foes) monsterStep(m, dt, player);
    separate(foes.map((f) => f.m));
    /* 每一隻這一刻在哪：扣到 0 的那一下 hurt 就把牠搬回重生點了，靈魂要掉在死的地方。 */
    const spot = new Map(foes.map(({ m }) => [m, { x: m.x, y: m.y, z: m.z, field: m.field }]));
    // 破防攻擊：突進碰到目標就定住牠、進迴旋；迴旋轉完就扣血、跳離。
    if (combo.phase === 'dash' && breakContact(player, combo.target)) latch(combo, player, combo.target);
    const dead = new Set();
    if (combo.phase === 'spin') {
      const r = spinStep(combo, player, combo.target);
      if (r.died) dead.add(combo.target);
    }
    const reach = this._reach[combo.phase];
    const body = this.body(player);
    for (const { m } of foes) {
      if (reach && !combo.hit.has(m) && reach(body, m)) {
        knock(m, body.x, body.z, body.aimX, body.aimZ, KNOCK_SCALE[combo.phase]);
        combo.hit.add(m);
        if (hurt(m, DAMAGE[combo.phase])) dead.add(m);
      }
    }
    for (const m of dead) {
      kills.push(m.kind);
      if (KINDS[m.kind].soul) this.souls.push(dropSoul(spot.get(m)));
    }
    /* 打死：hurt 已經讓牠在重生點重生了。不重生的話就離場——外觀藏起來，下一幀
       起不在清單裡。 */
    if (!this.respawn && dead.size) {
      for (const f of foes) if (dead.has(f.m)) Fight._hide(f);
      this.foes = foes.filter((f) => !dead.has(f.m));
    }

    let hit = null;
    if (!invulnerable(combo) && !(player.guard > 0)) {
      const take = (cause, dmg) => { if (!hit || dmg > hit.dmg) hit = { cause, dmg }; };
      for (const { m } of this.foes) if (bites(player, m)) take('bitten', KINDS[m.kind].bite);
      for (const s of this.world.shots) if (shotHits(s, player)) take('shot', s.dmg);
      for (const st of strikes) if (strikeHits(st, player)) take('struck', st.dmg);
      if (hit) {
        harm(player, hit.dmg);
        // 打中人的球就消失。
        if (hit.cause === 'shot') this.world.shots = this.world.shots.filter((s) => !shotHits(s, player));
      }
    }
    const died = hit && player.hp <= 0 ? hit.cause : null;

    // 靈魂：往下掉、漂；碰到就撿起來，最大血量 +1。倒下的這一幀不撿（血等一下就補滿了）。
    let souls = 0;
    for (const sl of this.souls) soulStep(sl, dt);
    if (!died) {
      const left = this.souls.filter((sl) => !grabs(player, sl));
      souls = this.souls.length - left.length;
      for (let i = 0; i < souls; i++) gainHeart(player);
      this.souls = left;
    }
    return { hit, died, kills, souls };
  }

  /** 玩家這一幀疊在步態上面的出招動作（給 zoo.update 的 move）。 */
  move(dt) {
    const out = this.mover.step(dt, this.combo.phase, this.combo.t);
    // 招播完了（收尾也播完）：放開朝向，下一幀起轉向搖桿指的方向。
    if (!this.mover.holding) this._face = null;
    return out;
  }

  /** 擺好這一幀的外觀。在 zoo.update 與相機之後叫。 */
  draw(dt, camera, player) {
    const combo = this.combo, fx = this._fx;
    this.blade.update();
    // 剛挨過一下（guard 還開著）：玩家一閃一閃的。頭頂是最大血量幾顆心、剩下的幾顆是滿的。
    this.zoo.root.visible = !(player.guard > 0) || Math.floor(player.guard * 12) % 2 === 0;
    this.hearts.show(player.hp, player.max, player.x, player.y, player.z, camera.quaternion);
    for (const { m, critter } of this.foes) {
      critter.root.position.set(m.x, m.y, m.z);
      critter.setFacing(Math.atan2(m.aimX, m.aimZ));
      // 會飛的一直是飄著的姿勢：不踩地、不走路。
      critter.update(dt, {
        speed: Math.hypot(m.vx, m.vz), grounded: m.grounded && !KINDS[m.kind].fly, vy: m.vy,
        viewYaw: Math.atan2(camera.position.x - m.x, camera.position.z - m.z),
      });
    }

    // 攻擊範圍：劍氣，跟著玩家的腳與出招時鎖住的面向走。
    this._qi(dt, this.body(player));
    // 提示圈不淡：亮著就是「現在按」。貼在玩家腳下那一層地板上（人可能在空中）。
    const floor = supportInfo(this.world.field.cols, player.x, player.z, player.y).y;
    showFx(fx.cue, cueing(combo) ? 0 : Infinity, 1, player.x, floor, player.z, 0);

    // BOSS 的預告：貼在牠（或跳砸的落點）那一層地板上。
    for (const { m, lane, circle, cone } of this.foes) {
      const c = m.cast;
      const orb = !!c && c.skill === 'orb', leap = !!c && c.skill === 'leap', fan = !!c && c.skill === 'cone';
      showLane(lane, orb, orb ? Math.min(1, c.t / SKILL.orb.windup) : 0, m.x, m.z,
        orb ? Math.atan2(c.dirX, c.dirZ) : 0, orb ? laneLength(m.x, m.z, c.dirX, c.dirZ, m.field.arena) : 0, m.y);
      showCircle(circle, leap, leap ? Math.min(1, c.t / SKILL.leap.windup) : 0, leap ? c.tx : 0, leap ? c.tz : 0, leap ? c.ty : 0);
      showCone(cone, fan, fan ? Math.min(1, c.t / SKILL.cone.windup) : 0, m.x, m.z, fan ? Math.atan2(c.dirX, c.dirZ) : 0, m.y);
    }

    // 飛著的球。
    const shots = this.world.shots;
    while (this._orbs.length < shots.length) {
      const o = orbMesh(SKILL.orb.radius);
      this.scene.add(o);
      this._orbs.push(o);
    }
    this._orbs.forEach((o, i) => {
      const s = shots[i];
      o.visible = !!s;
      if (s) o.position.set(s.x, s.y, s.z);
    });

    // 靈魂。
    while (this._soulMeshes.length < this.souls.length) {
      const o = soulMesh(SOUL.r);
      this.scene.add(o);
      this._soulMeshes.push(o);
    }
    this._soulMeshes.forEach((o, i) => {
      const sl = this.souls[i];
      o.visible = !!sl;
      if (sl) o.position.set(sl.x, sl.y, sl.z);
    });

    // 破防的兩圈：套在怪物身體的中間，正對這一幀的鏡頭。
    for (const { m, breakFx: bf } of this.foes) {
      showBreak(bf, m.breakT / BREAK_WINDOW, m.x, m.y + PHYS.height / 2, m.z, camera.quaternion);
    }
  }

  /**
   * 劍氣的一幀：進了新的一段就起一道（掛在出招這一刻），每一道往前一幀——還在掃
   * 就把這一幀掃過的那一截鋪上去——被吃完了就收起來。
   */
  _qi(dt, player) {
    const combo = this.combo;
    if (combo.phase !== this._phase) {
      this._phase = combo.phase;
      if (TRAILS[combo.phase] && (combo.phase !== 'rise' || combo.tip)) {
        let q = this._spare.pop();
        if (!q) {
          q = new Qi();
          this.scene.add(q.node);
        }
        q.start(combo.phase, combo.tip);
        this._qis.push(q);
      }
    }
    this._qis = this._qis.filter((q) => {
      if (q.step(dt, player)) return true;
      this._spare.push(q);
      return false;
    });
  }

  /** 全部的劍氣收起來（回到站位、換陣容）。 */
  _dropTrails() {
    for (const q of this._qis) { q.stop(); this._spare.push(q); }
    this._qis = [];
    this._phase = this.combo.phase;
  }

  /** 右上那一行小字的戰鬥那幾段：每一隻怪物的血與破防、連段在哪。 */
  status() {
    const foeLine = this.foes.map(({ m }) => `${KINDS[m.kind].name} 血 ${m.hp}/${KINDS[m.kind].hp}`
      + `${m.deaths ? `（打死 ${m.deaths}）` : ''} 破防 ${m.breakT > 0 ? '中' : `${m.gauge}/${KINDS[m.kind].breakAt}`}`).join(' ・ ');
    const phase = `${PHASE_NAME[this.combo.phase]}${invulnerable(this.combo) ? '（無敵）' : ''}`;
    return { foeLine, phase };
  }
}
