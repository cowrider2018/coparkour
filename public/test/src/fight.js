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
     draw     怪物、劍氣（攻擊範圍）與落地的粉塵、BOSS 的預告與球、靈魂、破防的兩圈、刀、
              頭頂的愛心。
              在相機擺好之後（破防的兩圈與愛心正對這一幀的鏡頭）；流體場也在這裡
              往前推一幀，所以要在 renderer.render 之前。
   ------------------------------------------------------------------ */

import { PHYS, supportInfo } from './walk.js';
import {
  FIELD, SWING, KNOCK_SCALE, DAMAGE, KINDS, BREAK_WINDOW, hurt, makeMonster, harm, lifeStep, gainHeart,
  SOUL, dropSoul, soulStep, grabs,
  breaking, breakTarget, startBreak, breakContact, latch, spinStep, separate, placeMonster, monsterStep, bites, knock,
  inSlash, inFan, inRing, slashTip, fanFrame, makeCombo, comboStep, invulnerable, cueing, REACH,
} from './combat.js';
import { makeMonsterCritter, sizeOf } from './monster.js';
import { Blade } from './blade.js';
import { Mover } from './moves.js';
import {
  slashFx, fanFx, ringFx, cueFx, showFx, breakFx, showBreak, laneFx, showLane, orbMesh, circleFx, showCircle,
  coneFx, showCone, soulMesh,
} from './fx.js';
import { SKILL, makeWorld, bossStep, shotsStep, shotHits, strikeHits, laneLength } from './skills.js';
import { Hearts } from './hearts.js';
import { Fluid, Sheet, QI_LOOK } from './fluid.js';
import { TRAILS, HALF, PIECE, sweepAt, fadeAt, swellAt, sheetFrame, qiAt } from './trail.js';
import { dustOf, dustFade, DUST_LOOK, PUSH_TIME } from './dust.js';

/** 劍氣的起伏：往外推的速度沿著月牙多或少這麼多（公尺 / 秒，見 trail.js 的 swellAt）。 */
const QI_SWELL = 1.2;

/** 劍氣的一段線段注入多少濃度（段長不到月牙的寬度就按比例少）。 */
const QI_DYE = 1.5;

/** 一團塵：腳下那一圈切成幾段注入。 */
const DUST_RING = 8;

/** 一團塵的濃度：dust.js 的 amount 乘上這個，是 PUSH_TIME 那幾幀加起來注入的量。 */
const DUST_DYE = 1.4;

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
   * @param {{respawn?: boolean, renderer?: THREE.WebGLRenderer}} o respawn：打死的怪物在牠的
   *   重生點重生（戰鬥模式）；false 的話打死就離場（完整流程）。renderer：劍氣的流體場畫在它上面，
   *   沒給就是以前那幾片高亮
   */
  constructor(scene, zoo, { respawn = true, renderer = null } = {}) {
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

    /* 連段的狀態與每一段的高亮。 */
    this.combo = makeCombo();
    this._fx = { slash: slashFx(), fan: fanFx(), ring: ringFx(), cue: cueFx() };
    scene.add(this._fx.slash.node, this._fx.fan.node, this._fx.ring.node, this._fx.cue.node);
    /* 劍氣：三段攻擊的範圍畫成一道煙（trail.js），煙是共用流體場（fluid.js）的一格。
       畫不出流體的機器、或網址給了 `?fluid=0`，就是上面那幾片高亮——同一台手機上
       開關各看一次 fps，就是流體的成本。 */
    const fluidOn = new URLSearchParams(location.search).get('fluid') !== '0';
    this.fluid = renderer && fluidOn && Fluid.supported(renderer) ? new Fluid(renderer) : null;
    /** 還看得到的每一道劍氣，與收回來的那幾片煙（下一道借）。 */
    this._trails = [];
    this._sheets = [];
    /** 還看得到的每一團落地的塵，與每一個身體上一幀的高度、往下掉多快、站著沒有。 */
    this._puffs = [];
    this._feet = new WeakMap();
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

    // 攻擊範圍：劍氣，畫不出流體的話是高亮。都跟著玩家的腳與面向走。
    const body = this.body(player);
    if (this.fluid) this._smoke(dt, body, player);
    else {
      const yaw = Math.atan2(body.aimX, body.aimZ);
      const lit = (phase) => (combo.phase === phase ? combo.t : Infinity);
      showFx(fx.slash, lit('slash'), SWING, player.x, player.y, player.z, yaw);
      if (combo.tip) {
        const fr = fanFrame(body, combo.tip);
        showFx(fx.fan, lit('rise'), SWING, player.x, player.y, player.z, Math.atan2(fr.dirX, fr.dirZ), fr.a0);
      }
      showFx(fx.ring, lit('slam'), SWING, player.x, player.y, player.z, yaw);
    }
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
   * 流體場的一幀：劍氣與落地的粉塵。進了新的一段就起一道劍氣、有身體落地就揚一團塵；
   * 掃的時候把刀氣注入、剛落地的那幾幀把塵往外推；流體往前推一幀；然後擺好每一片煙。
   * 淡完了、或格子被別的煙收走了，就收起來。
   *
   * @param {object} body 玩家這一幀（出招時是鎖住面向的那一份，fight.body）：劍氣跟著它
   * @param {object} player 玩家本人：落地看它（body 可能是每幀重用的同一份替身）
   */
  _smoke(dt, body, player) {
    const combo = this.combo, fluid = this.fluid;
    if (combo.phase !== this._phase) {
      this._phase = combo.phase;
      if (TRAILS[combo.phase] && (combo.phase !== 'rise' || combo.tip)) this._trails.push(this._startTrail(combo.phase, body));
    }
    for (const tr of this._trails) {
      const prev = tr.tau;
      tr.tau += dt;
      if (prev <= TRAILS[tr.kind].t1 && fluid.owns(tr.tile, tr)) this._inject(tr, prev, tr.tau, dt, body);
    }
    this._land(dt, player);
    for (const pf of this._puffs) {
      if (pf.tau < PUSH_TIME && fluid.owns(pf.tile, pf)) this._kick(pf, dt);
      pf.tau += dt;
    }
    fluid.step(dt);
    this._trails = this._trails.filter((tr) => {
      const alive = tr.tau < TRAILS[tr.kind].life && fluid.owns(tr.tile, tr);
      if (alive) tr.sheet.show(tr.tile, fadeAt(tr.kind, tr.tau));
      else this._endTrail(tr);
      return alive;
    });
    this._puffs = this._puffs.filter((pf) => {
      const alive = pf.tau < pf.d.life && fluid.owns(pf.tile, pf);
      if (alive) pf.sheet.show(pf.tile, dustFade(pf.d, pf.tau));
      else this._endTrail(pf);
      return alive;
    });
  }

  /** 借一片煙（收回來的先用）。 */
  _sheet() {
    let sheet = this._sheets.pop();
    if (!sheet) {
      sheet = new Sheet(this.fluid);
      this.scene.add(sheet.node);
    }
    return sheet;
  }

  /**
   * 落地：每一個踩地的身體（玩家、不會飛的怪物）上一幀在空中、這一幀站住了，就在
   * 腳下揚一團塵，多濃照體型與落地速度（dust.js）。落地速度用上一幀的高度差算，
   * 不讀身上的 vy——BOSS 跳砸是一幀一幀直接擺位置的，vy 一直是 0；落地那一幀的
   * vy 也已經被歸零了。
   */
  _land(dt, player) {
    const bodies = [[player, 1]];
    for (const { m } of this.foes) if (!KINDS[m.kind].fly) bodies.push([m, sizeOf(m.kind)]);
    for (const [b, size] of bodies) {
      const s = this._feet.get(b);
      if (s && b.grounded && !s.grounded) {
        const d = dustOf(size, -s.vy);
        if (d) this._puffs.push(this._startPuff(b, d));
      }
      this._feet.set(b, { y: b.y, vy: s && dt > 0 ? (b.y - s.y) / dt : 0, grounded: b.grounded });
    }
  }

  /** 揚一團塵：借一格流體、一片煙，平貼在落地那一點的地上（之後不動）。 */
  _startPuff(b, d) {
    const sheet = this._sheet();
    const pf = { d, tau: 0, sheet, x: b.x, y: b.y, z: b.z, seed: Math.random() * 2 * Math.PI };
    pf.tile = this.fluid.acquire(pf);
    sheet.place([b.x, b.y + 0.03, b.z], [1, 0, 0], [0, 0, -1], d.half, { ...DUST_LOOK, thick: d.thick });
    return pf;
  }

  /**
   * 落地之後 PUSH_TIME 秒之內，每一幀把腳下那一圈塵往外推：一圈切成 DUST_RING 段，
   * 每一段注入同樣的濃度、帶著往外的速度。推的快慢沿著一圈有三個大起伏（每一團的
   * 相位隨機）——不然是一個完美的圓環往外擴，看起來像水波不像塵。濃度按 dt 分攤，
   * 那幾幀加起來是固定的量，跟幀率無關。
   */
  _kick(pf, dt) {
    const d = pf.d, s = pf.sheet;
    const c = (DUST_DYE * d.amount * Math.min(dt, PUSH_TIME)) / PUSH_TIME;
    const at = (a) => s.toTile([pf.x + Math.cos(a) * d.foot, pf.y, pf.z + Math.sin(a) * d.foot]);
    const vel = (a) => {
      const k = d.push * (1 + 0.35 * Math.sin(3 * a + pf.seed * 2));
      return s.toTileVel([Math.cos(a) * k, 0, Math.sin(a) * k]);
    };
    const rad = (0.7 * d.foot) / (2 * d.half);
    for (let i = 0; i < DUST_RING; i++) {
      const a0 = pf.seed + (2 * Math.PI * i) / DUST_RING, a1 = pf.seed + (2 * Math.PI * (i + 1)) / DUST_RING;
      this.fluid.splat(pf.tile, at(a0), at(a1), vel(a0), vel(a1), c, c, rad);
    }
  }

  /** 起一道劍氣：借一格流體、一片煙，擺在出招這一刻的位置上（之後不動）。 */
  _startTrail(kind, player) {
    const sheet = this._sheet();
    const tr = { kind, tau: 0, tip: this.combo.tip, sheet, phase: Math.random() * 2 * Math.PI };
    tr.tile = this.fluid.acquire(tr);
    const { o, U, V } = sheetFrame(kind, player, tr.tip);
    sheet.place(o, U, V, HALF, QI_LOOK);
    return tr;
  }

  /** 收掉一道劍氣或一團塵：還格子、收起那一片煙留給下一個借。 */
  _endTrail(tr) {
    this.fluid.release(tr.tile, tr);
    tr.sheet.show(-1, 0);
    this._sheets.push(tr.sheet);
  }

  /** 全部的劍氣與塵收起來（回到站位、換陣容）。 */
  _dropTrails() {
    if (!this.fluid) return;
    for (const tr of [...this._trails, ...this._puffs]) this._endTrail(tr);
    this._trails = [];
    this._puffs = [];
    this._phase = this.combo.phase;
  }

  /**
   * 劍氣從 τ0 掃到 τ1 的這一段注入流體：月牙沿著刀尖的路徑切成幾段線段（一段最多
   * 掃 PIECE），每一段從上一段的尾巴（tr.last）接起——所以整道是連續的一筆，人在
   * 揮的時候轉向也只是讓那一筆彎一下，不會斷。線段多粗就是那裡的月牙多寬。
   *
   * 一段注入多少照它多長算：刀慢下來（第三段收尾）的時候一段比月牙的寬度還短，
   * 好幾段疊在同一個地方，照段數算的話那裡會堆成一塊實心的白。
   *
   * 帶起來的速度是刀在那一點的速度的 drag 成，加上往外推的 push，再沿著月牙一鼓
   * 一縮（swellAt）——沒有它的話流場太乾淨，煙只會被拉長，捲不起來；而它是一條
   * 平滑的波、不是每一段各抽一次亂數，捲起來的才是少數幾個大的。
   */
  _inject(tr, t0, t1, dt, player) {
    const T = TRAILS[tr.kind], s = tr.sheet;
    const a0 = sweepAt(tr.kind, t0), a1 = sweepAt(tr.kind, t1);
    if (a1 === a0 || dt <= 0) return;
    const spin = (a1 - a0) / dt;
    const at = (th) => {
      const q = qiAt(tr.kind, th, player, tr.tip), r = REACH - q.w / 2;
      const j = QI_SWELL * swellAt(tr.kind, th, tr.phase);
      q.v = s.toTileVel([0, 1, 2].map((c) => q.b.t[c] * spin * r * T.drag + q.b.d[c] * (T.push + j)));
      q.uv = s.toTile(q.p);
      return q;
    };
    if (!tr.last) tr.last = at(a0);
    const n = Math.min(8, Math.ceil(Math.abs(a1 - a0) / PIECE));
    for (let i = 1; i <= n; i++) {
      const q = at(a0 + ((a1 - a0) * i) / n), l = tr.last;
      const w = (q.w + l.w) / 2;
      const len = Math.hypot(q.p[0] - l.p[0], q.p[1] - l.p[1], q.p[2] - l.p[2]);
      const c = QI_DYE * Math.min(1, len / w);
      this.fluid.splat(tr.tile, l.uv, q.uv, l.v, q.v, c, c, w / 2 / (2 * HALF));
      tr.last = q;
    }
  }

  /** 右上那一行小字的戰鬥那幾段：每一隻怪物的血與破防、連段在哪。 */
  status() {
    const foeLine = this.foes.map(({ m }) => `${KINDS[m.kind].name} 血 ${m.hp}/${KINDS[m.kind].hp}`
      + `${m.deaths ? `（打死 ${m.deaths}）` : ''} 破防 ${m.breakT > 0 ? '中' : `${m.gauge}/${KINDS[m.kind].breakAt}`}`).join(' ・ ');
    const phase = `${PHASE_NAME[this.combo.phase]}${invulnerable(this.combo) ? '（無敵）' : ''}`;
    return { foeLine, phase };
  }
}
