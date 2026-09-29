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
     resolve  怪物追人、放招、球往前飛（撞到東西就炸掉），然後才判打中——兩個身體都走完這一幀了，
              範圍是對著畫面上的位置判的。打死 BOSS 掉出靈魂，靈魂往下掉、漂，碰到
              就撿起來。回報玩家挨了哪一下、倒下沒有、打死了誰、撿了幾顆靈魂。
     draw     怪物、劍光（攻擊範圍）與粉塵（落地、BOSS 範圍攻擊的地震）、BOSS 的預告與球、靈魂、破防的兩圈、刀、
              頭頂的愛心。
              在相機擺好之後（破防的兩圈與愛心正對這一幀的鏡頭）；流體場也在這裡
              往前推一幀，所以要在 renderer.render 之前。
   ------------------------------------------------------------------ */

import { PHYS, supportInfo } from './walk.js';
import {
  FIELD, REACH, KNOCK_SCALE, DAMAGE, KINDS, BREAK_WINDOW, hurt, makeMonster, harm, lifeStep, gainHeart,
  SOUL, dropSoul, soulStep, grabs,
  breaking, breakTarget, startBreak, breakContact, latch, spinStep, separate, placeMonster, monsterStep, bites, knock,
  inSlash, inFan, inRing, slashTip, makeCombo, comboStep, invulnerable, untouchable, cueing, attacking, taken,
} from './combat.js';
import { makeMonsterCritter, sizeOf, bloodOf, swordOf, helmOf, Motion, ATTACK_INK, CHOP_LEAD } from './monster.js';
import { GUARD_INK } from './critter.js';
import { Blood } from './blood.js';
import { Fireballs } from './fireball.js';
import { hitFrame, pushFrame, spurtOf } from './bleed.js';
import { Blade } from './blade.js';
import { Helm } from './helm.js';
import { Mover } from './moves.js';
import {
  cueFx, showFx, breakFx, showBreak, laneFx, showLane, circleFx, showCircle,
  coneFx, showCone, stripFx, showStrip, soulMesh,
} from './fx.js';
import { SKILL, WHIRL_LEN, makeWorld, bossStep, shotsStep, shotHits, strikeHits, laneLength } from './skills.js';
import { Hearts } from './hearts.js';
import { Fluid, Sheet } from './fluid.js';
import { TRAILS } from './trail.js';
import { Qi } from './qi.js';
import { dustOf, dustFade, DUST_LOOK, PUSH_TIME, QUAKE, quakeBands, quakeFade } from './dust.js';

/** 一團塵：腳下那一圈切成幾段注入。 */
const DUST_RING = 8;

/** 地震的一道弧切成幾段：每一段大約這麼長（公尺），而且每 60° 至少一段（小圈切得太少，
    弦離弧太遠，一圈會變成多邊形）。短的弧不硬切成好幾段——段比注入的寬度還短的話，
    段與段疊在一起，那一道會比別道濃、比別道高。 */
const QUAKE_SEG = 0.6, QUAKE_TURN = Math.PI / 3;

/** 弧段與弧段之間留的空隙：每一段兩頭各縮這麼多個注入半徑。注入是沿著線段的高斯，
    接在一起的兩段在接點上各給滿，濃度是兩倍，鼓出一根刺；各縮 √ln2 ≈ 0.83 個半徑，
    兩邊的尾巴在空隙正中間加起來剛好是一倍。 */
const QUAKE_JOINT = Math.sqrt(Math.LN2);

/** 一團塵的濃度：dust.js 的 amount 乘上這個，是 PUSH_TIME 那幾幀加起來注入的量。 */
const DUST_DYE = 1.4;

/** 右上那一行小字：現在在連段的哪裡。 */
export const PHASE_NAME = {
  idle: '待機', slash: '第一段', rest: '第一段收招', rise: '第二段', air: '第二段之後', leap: '第三段起跳', slam: '第三段落地',
  dash: '破防突進', spin: '破防迴旋', vault: '破防跳離',
};

/** 玩家挨了哪一下 → 給人看的一句話。 */
export const DEATH_TEXT = { bitten: '被咬到了', shot: '被球打中了', struck: '被怪物的招打中了' };

export class Fight {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./critter.js').Zoo} zoo 玩家那一隻（刀掛在牠頭上，怪物借牠的立耳犬資料）
   * @param {{respawn?: boolean, renderer?: THREE.WebGLRenderer}} o respawn：打死的怪物在牠的
   *   重生點重生（戰鬥模式）；false 的話打死就離場（完整流程）。renderer：落地粉塵的流體場畫在
   *   它上面，沒給就沒有粉塵
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

    /* BOSS 放出來的球：畫成火球（fireball.js）；尾巴的火粒要 renderer 畫場。 */
    this.world = makeWorld();
    this._fire = new Fireballs(scene, SKILL.orb.radius, renderer);

    /* 連段的狀態與按鍵的提示圈。 */
    this.combo = makeCombo();
    this._fx = { cue: cueFx() };
    scene.add(this._fx.cue.node);
    /** 劍光：三段攻擊的範圍，同心的三道劍氣（trail.js 算形狀、qi.js 畫）。還看得到的
        每一刀，與收掉的那幾刀（下一刀借）。 */
    this._qis = [];
    this._spare = [];
    /** 怪物挨打噴出來的血（bleed.js 算、blood.js 畫）。 */
    this._blood = new Blood(scene, renderer);
    /* 落地的粉塵畫在共用的流體場（fluid.js）上，一團借一格。畫不出流體的機器、或網址
       給了 `?fluid=0`，就沒有粉塵——同一台手機上開關各看一次 fps，就是流體的成本。 */
    const fluidOn = new URLSearchParams(location.search).get('fluid') !== '0';
    this.fluid = renderer && fluidOn && Fluid.supported(renderer) ? new Fluid(renderer) : null;
    /** 收回來的那幾片煙（下一團塵借）。 */
    this._sheets = [];
    /** 還看得到的每一團落地的塵，與每一個身體上一幀的高度、往下掉多快、站著沒有。 */
    this._puffs = [];
    this._feet = new WeakMap();
    /** BOSS 的範圍攻擊（扇形、跳砸的圓）打下去揚起的地震塵：還看得到的每一片，與這一幀
        剛打下去、還沒揚的。跳砸落地的那一隻這一幀不揚落地的塵（_quiet）——那一下是地震。 */
    this._quakes = [];
    this._stomps = [];
    this._quiet = new Set();
    /** 上一幀在哪一段：換段的那一刻起一道劍光。 */
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
    this._blood.setInkPx(px, h);
    this._fire.setInkPx(px, h);
  }

  /** 一隻怪物噴一次血：frame 是方向（bleed.js），at 是牠這一刻在哪（帶著 field）。 */
  _bleed(frame, at, kind) {
    this._blood.spurt(spurtOf(frame, at, sizeOf(kind), bloodOf(kind)), at.field);
  }

  _slot(kind, i) {
    if (!this._pool.has(kind)) this._pool.set(kind, []);
    const list = this._pool.get(kind);
    while (list.length <= i) {
      const slot = {
        critter: makeMonsterCritter(this.zoo, kind), breakFx: breakFx(),
        lane: laneFx(SKILL.orb.radius), circle: circleFx(SKILL.leap.radius), cone: coneFx(SKILL.cone.radius, SKILL.cone.half),
        whirl: stripFx(SKILL.whirl.radius, true), cleave: stripFx(SKILL.cleave.width / 2, false),
        blade: null, helm: null,
      };
      // 咬著劍的那幾類（騎士）：劍掛在牠自己的頭上，跟主角那把一樣每幀跟著頭。
      if (swordOf(kind)) { slot.blade = new Blade(swordOf(kind)); slot.blade.follow(slot.critter); }
      // 戴頭盔的那幾類（騎士、BOSS）：一樣掛在頭上，墨線跟著牠的墨色換。
      if (helmOf(kind)) { slot.helm = new Helm(); slot.helm.follow(slot.critter); }
      if (this._inkPx) slot.critter.setInkPx(...this._inkPx);
      this.scene.add(slot.critter.root, slot.breakFx.node, slot.lane.node, slot.circle.node, slot.cone.node, slot.whirl.node, slot.cleave.node);
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
    s.whirl.node.visible = false;
    s.cleave.node.visible = false;
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
      return { m: makeMonster(s, field), motion: new Motion(), ...slot };
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
      f.motion = new Motion();
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
    const strikes = [];
    for (const { m } of foes) {
      const st = bossStep(m, dt, player, this.world);
      if (!st) continue;
      strikes.push(st);
      // 地震的塵只有 BOSS 砸下去的那兩種（dust.js 的 QUAKE）。
      if (!this.fluid || !QUAKE[st.shape]) continue;
      this._stomps.push(st);
      if (st.shape === 'circle') this._quiet.add(m);
    }
    // 撞到黑牆或場上東西的球炸掉。
    for (const s of shotsStep(this.world, dt)) this._fire.explode(s);
    for (const { m } of foes) monsterStep(m, dt, player);
    separate(foes.map((f) => f.m));
    /* 每一隻這一刻在哪：扣到 0 的那一下 hurt 就把牠搬回重生點了，靈魂要掉在死的地方。 */
    const spot = new Map(foes.map(({ m }) => [m, { x: m.x, y: m.y, z: m.z, field: m.field }]));
    // 破防攻擊：突進碰到目標就定住牠、進迴旋；迴旋轉完就扣血、跳離。
    if (combo.phase === 'dash' && breakContact(player, combo.target)) latch(combo, player, combo.target);
    const dead = new Set();
    if (combo.phase === 'spin') {
      const m = combo.target, r = spinStep(combo, player, m);
      if (r.died) dead.add(m);
      // 破防攻擊沒有劍氣：往牠被推開的方向噴，從牠被定住的地方（打死的話已經搬回重生點了）。
      if (r.took > 0) this._bleed(pushFrame(combo.dashX, combo.dashZ), spot.get(m) || m, m.kind);
    }
    const reach = this._reach[combo.phase];
    const body = this.body(player);
    for (const { m } of foes) {
      if (reach && !combo.hit.has(m) && reach(body, m)) {
        knock(m, body.x, body.z, body.aimX, body.aimZ, KNOCK_SCALE[combo.phase]);
        combo.hit.add(m);
        if (taken(m, DAMAGE[combo.phase]) > 0) this._bleed(hitFrame(combo.phase, body, combo.tip, m, sizeOf(m.kind)), m, m.kind);
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
    if (!untouchable(combo, player)) {
      const take = (cause, dmg) => { if (!hit || dmg > hit.dmg) hit = { cause, dmg }; };
      for (const { m } of this.foes) if (bites(player, m)) take('bitten', KINDS[m.kind].bite);
      for (const s of this.world.shots) if (shotHits(s, player)) take('shot', s.dmg);
      for (const st of strikes) if (strikeHits(st, player)) take('struck', st.dmg);
      if (hit) {
        harm(player, hit.dmg);
        // 打中人的球炸掉消失。
        if (hit.cause === 'shot') {
          this.world.shots = this.world.shots.filter((s) => {
            if (!shotHits(s, player)) return true;
            this._fire.explode(s);
            return false;
          });
        }
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
    // 無敵的時候墨線金色：跟碰到算不算（untouchable）同一個判斷。
    this.zoo.setInkColor(untouchable(combo, player) ? GUARD_INK : null);
    this.hearts.show(player.hp, player.max, player.x, player.y, player.z, camera.quaternion);
    for (const { m, critter, motion, blade, helm } of this.foes) {
      /* 衝刺與放招的動作（monster.js 的 Motion）：疊一套動作，跳的那幾段畫成在空中、
         垂直速度照那一跳。 */
      const mo = motion.step(dt, m, player);
      critter.root.position.set(m.x, m.y + mo.lift, m.z);
      critter.setFacing(Math.atan2(m.aimX, m.aimZ));
      // 攻擊中墨線紅色：跟不可打斷（armored）同出自 attacking。
      critter.setInkColor(attacking(m) ? ATTACK_INK : null);
      // 會飛的一直是飄著的姿勢：不踩地、不走路。
      critter.update(dt, {
        speed: Math.hypot(m.vx, m.vz), grounded: m.grounded && !KINDS[m.kind].fly && !mo.air, vy: mo.vy ?? m.vy,
        viewYaw: Math.atan2(camera.position.x - m.x, camera.position.z - m.z),
        move: mo.move,
      });
      if (blade) blade.update();
      if (helm) helm.update();
    }

    // 攻擊範圍：劍光，跟著玩家的腳與出招時鎖住的面向走（騎士的劍迴旋跟著牠）。落地的粉塵。
    this._whirls();
    this._qi(dt, this.body(player));
    this._blood.step(dt, camera);
    if (this.fluid) this._dust(dt, player);
    // 提示圈不淡：亮著就是「現在按」。貼在玩家腳下那一層地板上（人可能在空中）。
    const floor = supportInfo(this.world.field.cols, player.x, player.z, player.y).y;
    showFx(fx.cue, cueing(combo) ? 0 : Infinity, 1, player.x, floor, player.z, 0);

    // 怪物技能的預告：貼在牠（或跳砸的落點）那一層地板上。
    for (const { m, lane, circle, cone, whirl, cleave } of this.foes) {
      const c = m.cast;
      const orb = !!c && c.skill === 'orb', leap = !!c && c.skill === 'leap', fan = !!c && c.skill === 'cone';
      /* 劍迴旋衝刺：從起步的地方往鎖定的方向，衝得到多遠（黑牆擋住的話到牆前）。衝的時候
         亮著滿的——那一條就是還會被掃到的地方。 */
      const wh = !!c && c.skill === 'whirl';
      showStrip(whirl, wh, wh ? Math.min(1, c.t / SKILL.whirl.windup) : 0, wh ? c.x0 : 0, wh ? c.z0 : 0,
        wh ? Math.atan2(c.dirX, c.dirZ) : 0,
        wh ? Math.min(WHIRL_LEN, Math.max(0, laneLength(c.x0, c.z0, c.dirX, c.dirZ, m.field.arena) - PHYS.radius)) : 0, c ? c.y0 : 0);
      /* 跳砍：從落點往前的那一條（正中間是主角被鎖定的地方），貼在落點那一層地板上；飛的時候
         亮著滿的。落地之後換成上挑那一條（從牠腳下往主角、長 REACH），等的那 gap 秒從牠腳下長滿，
         打得到的那 swing 秒亮著滿的，之後收掉。 */
      const cl = !!c && c.skill === 'cleave', CL = SKILL.cleave;
      if (cl && c.up) {
        const u = c.t - CL.windup - CL.air;
        showStrip(cleave, u <= CL.up.gap + CL.up.swing, Math.min(1, u / CL.up.gap), c.up.x, c.up.z,
          Math.atan2(c.up.dirX, c.up.dirZ), REACH, c.up.y);
      } else {
        showStrip(cleave, cl, cl ? Math.min(1, c.t / CL.windup) : 0, cl ? c.lx : 0, cl ? c.lz : 0,
          cl ? Math.atan2(c.dirX, c.dirZ) : 0, CL.len, cl ? c.ly : 0);
      }
      showLane(lane, orb, orb ? Math.min(1, c.t / SKILL.orb.windup) : 0, m.x, m.z,
        orb ? Math.atan2(c.dirX, c.dirZ) : 0, orb ? laneLength(m.x, m.z, c.dirX, c.dirZ, m.field.arena) : 0, m.y);
      showCircle(circle, leap, leap ? Math.min(1, c.t / SKILL.leap.windup) : 0, leap ? c.tx : 0, leap ? c.tz : 0, leap ? c.ty : 0);
      showCone(cone, fan, fan ? Math.min(1, c.t / SKILL.cone.windup) : 0, m.x, m.z, fan ? Math.atan2(c.dirX, c.dirZ) : 0, m.y);
    }

    // 飛著的球（火球）。
    this._fire.draw(dt, this.world.shots, camera);

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
   * 騎士的劍迴旋衝刺：倒數完、開始衝的那一幀起一道兩圈的劍光（trail.js 的 whirl），
   * 照迴旋的半徑縮放，跟著牠的腳與鎖定的方向走——牠一邊衝一邊鋪，所以留下來的是
   * 一圈往前拉開的劍光。高度照牠的體型抬：主角的劍光在身高中間，牠畫得高。
   * 跳砍與之後的上挑交給 _cleave。
   */
  _whirls() {
    for (const { m } of this.foes) {
      const c = m.cast;
      if (c && c.skill === 'cleave') { this._cleave(m, c); continue; }
      if (!c || c.skill !== 'whirl' || c.t < SKILL.whirl.windup || c.qi) continue;
      const q = this._spare.pop() || new Qi();
      if (!q.node.parent) this.scene.add(q.node);
      q.start('whirl', null, SKILL.whirl.radius / REACH);
      const lift = (PHYS.height / 2) * (sizeOf(m.kind) - 1), body = { x: 0, y: 0, z: 0, aimX: 0, aimZ: 1 };
      q.owner = () => Object.assign(body, { x: m.x, y: m.y + lift, z: m.z, aimX: c.dirX, aimZ: c.dirZ });
      q.cast = c;
      q.foe = m;
      c.qi = true;
      this._qis.push(q);
    }
  }

  /**
   * 騎士的跳砍兩道劍光，跟著牠的腳走：
   *   劈  落地前 CHOP_LEAD 秒（頭往前甩的那一下）起一道 cleave，從正上方劈到指著
   *       那一條的遠端，照那一條的長度縮放——劍光的終點就是劈的那一條。
   *   上挑 起跳那一幀起一道主角第二段的劍光（rise），末端點是那一片扇形的
   *       （skills.js 的 aimUp）——跟判定同一片。
   */
  _cleave(m, c) {
    const S = SKILL.cleave;
    if (!c.chopQi && c.t >= S.windup + S.air - CHOP_LEAD) {
      const tip = { x: c.lx + c.dirX * S.len, y: c.ly, z: c.lz + c.dirZ * S.len };
      this._foeQi(m, c, 'cleave', tip, S.len / REACH, c.dirX, c.dirZ);
      c.chopQi = true;
    }
    if (c.up && !c.qi && c.t >= S.windup + S.air + S.up.gap) {
      this._foeQi(m, c, 'rise', c.up.tip, 1, c.up.dirX, c.up.dirZ);
      c.qi = true;
    }
  }

  /** 怪物身上起一道劍光：跟著牠的腳，朝 (aimX, aimZ)，招被打斷就收（見 _qi）。 */
  _foeQi(m, c, kind, tip, scale, aimX, aimZ) {
    const q = this._spare.pop() || new Qi();
    if (!q.node.parent) this.scene.add(q.node);
    q.start(kind, tip, scale);
    const body = { x: 0, y: 0, z: 0, aimX, aimZ };
    q.owner = () => Object.assign(body, { x: m.x, y: m.y, z: m.z });
    q.cast = c;
    q.foe = m;
    this._qis.push(q);
  }

  /**
   * 劍光的一幀：進了新的一段就起一道（掛在出招這一刻），每一道往前一幀——還在掃
   * 就把這一幀掃過的那一截鋪上去——收完了就收起來。
   *
   * @param {object} body 玩家這一幀（出招時是鎖住面向的那一份，fight.body）
   */
  _qi(dt, body) {
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
        q.owner = null;
        this._qis.push(q);
      }
    }
    this._qis = this._qis.filter((q) => {
      /* 怪物的那一道：招被打斷了（破防攻擊定住、死了重生）就收掉。衝完收招的那一刻
         進了僵直，劍光照常收完。 */
      const cut = q.owner && q.foe.cast !== q.cast && !(q.foe.stun > 0);
      if (!cut && q.step(dt, q.owner ? q.owner() : body)) return true;
      q.stop();
      this._spare.push(q);
      return false;
    });
  }

  /**
   * 粉塵的一幀：有身體落地就揚一團塵，剛落地的那幾幀把塵往外推，流體往前推一幀，
   * 然後擺好每一片煙。散完了、或格子被別的煙收走了，就收起來。
   *
   * @param {object} player 玩家本人（落地看它）
   */
  _dust(dt, player) {
    const fluid = this.fluid;
    this._land(dt, player);
    for (const st of this._stomps) this._quakes.push(this._startQuake(st));
    this._stomps.length = 0;
    for (const pf of this._puffs) {
      if (pf.tau < PUSH_TIME && fluid.owns(pf.tile, pf)) this._kick(pf, dt);
      pf.tau += dt;
    }
    for (const q of this._quakes) {
      if (fluid.owns(q.tile, q)) this._quake(q, dt);
      q.tau += dt;
    }
    fluid.step(dt);
    this._puffs = this._puffs.filter((pf) => {
      const alive = pf.tau < pf.d.life && fluid.owns(pf.tile, pf);
      if (alive) pf.sheet.show(pf.tile, dustFade(pf.d, pf.tau));
      else this._endPuff(pf);
      return alive;
    });
    this._quakes = this._quakes.filter((q) => {
      const alive = q.tau < QUAKE.life && fluid.owns(q.tile, q);
      if (alive) q.sheet.show(q.tile, quakeFade(q.tau));
      else this._endPuff(q);
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
   * 腳下揚一團塵，多濃照體型與落地速度（dust.js）。BOSS 跳砸落地不算：那一下揚的是地震的塵。落地速度用上一幀的高度差算，
   * 不讀身上的 vy——BOSS 跳砸是一幀一幀直接擺位置的，vy 一直是 0；落地那一幀的
   * vy 也已經被歸零了。
   */
  _land(dt, player) {
    const bodies = [[player, 1]];
    for (const { m } of this.foes) if (!KINDS[m.kind].fly) bodies.push([m, sizeOf(m.kind)]);
    for (const [b, size] of bodies) {
      const s = this._feet.get(b);
      if (s && b.grounded && !s.grounded && !this._quiet.has(b)) {
        const d = dustOf(size, -s.vy);
        if (d) this._puffs.push(this._startPuff(b, d));
      }
      this._feet.set(b, { y: b.y, vy: s && dt > 0 ? (b.y - s.y) / dt : 0, grounded: b.grounded });
    }
    this._quiet.clear();
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

  /**
   * 範圍攻擊揚一片地震的塵：借一格流體、一片煙，平貼在打下去的那一層地上，蓋住整個
   * 範圍，再留一段往外推的距離。
   *   扇形  煙片正中間放在扇形半徑的一半處：扇形上離那裡最遠的是兩個角（0.62 r）。
   *   圓    煙片正中間就是圓心，半邊長是半徑。
   */
  _startQuake(st) {
    const sheet = this._sheet();
    const q = { tau: 0, sheet, st, bands: quakeBands(st.shape, st.r) };
    const k = QUAKE[st.shape];
    q.tile = this.fluid.acquire(q);
    const fan = st.shape === 'cone';
    const c = fan ? [st.x + (st.dirX * st.r) / 2, st.z + (st.dirZ * st.r) / 2] : [st.x, st.z];
    sheet.place([c[0], st.y + 0.03, c[1]], [1, 0, 0], [0, 0, -1], (fan ? 0.62 : 1) * st.r + 0.6,
      { ...DUST_LOOK, thick: k.thick, soft: k.soft, rise: QUAKE.rise });
    return q;
  }

  /**
   * 地震的一幀：震波從腳下（扇形的尖、圓心）往外走，走到的每一道（quakeBands）在那一段
   * QUAKE.inject 秒裡沿著那一圈弧注入、往外推——扇形是扇形那一段弧，圓是一整圈。弧照
   * 長度切成每段 QUAKE_SEG 左右，越外面的弧越長、段越多；段與段之間留 QUAKE_JOINT 的
   * 空隙。濃度按 dt 分攤，跟幀率無關。
   */
  _quake(q, dt) {
    const st = q.st, s = q.sheet, k = QUAKE[st.shape];
    const [a0, span] = st.shape === 'cone'
      ? [Math.atan2(st.dirX, st.dirZ) - st.half, 2 * st.half]
      : [0, 2 * Math.PI];
    const rad = k.width / (2 * s.half);
    for (const b of q.bands) {
      if (q.tau < b.at || q.tau >= b.at + QUAKE.inject) continue;
      const r = st.r * b.u;
      const n = Math.max(Math.ceil(span / QUAKE_TURN - 1e-9), Math.ceil((r * span) / QUAKE_SEG));
      const c = (DUST_DYE * b.amount * Math.min(dt, QUAKE.inject)) / QUAKE.inject;
      const trim = Math.min((QUAKE_JOINT * k.width) / r, span / n / 4);
      const dir = (k, e) => { const a = a0 + (span * k) / n + e; return [Math.sin(a), Math.cos(a)]; };
      const at = ([x, z]) => s.toTile([st.x + x * r, st.y, st.z + z * r]);
      const vel = ([x, z]) => s.toTileVel([x * k.push, 0, z * k.push]);
      for (let j = 0; j < n; j++) {
        const d0 = dir(j, trim), d1 = dir(j + 1, -trim);
        this.fluid.splat(q.tile, at(d0), at(d1), vel(d0), vel(d1), c, c, rad);
      }
    }
  }

  /** 收掉一團塵（落地的、地震的）：還格子、收起那一片煙留給下一團借。 */
  _endPuff(pf) {
    this.fluid.release(pf.tile, pf);
    pf.sheet.show(-1, 0);
    this._sheets.push(pf.sheet);
  }

  /** 全部的劍光與塵收起來（回到站位、換陣容）。 */
  _dropTrails() {
    for (const q of this._qis) { q.stop(); this._spare.push(q); }
    this._qis = [];
    this._blood.clear();
    this._phase = this.combo.phase;
    if (!this.fluid) return;
    for (const pf of this._puffs) this._endPuff(pf);
    for (const q of this._quakes) this._endPuff(q);
    this._puffs = [];
    this._quakes = [];
    this._stomps.length = 0;
    this._quiet.clear();
  }

  /** 右上那一行小字的戰鬥那幾段：每一隻怪物的血與破防、連段在哪。 */
  status() {
    const foeLine = this.foes.map(({ m }) => `${KINDS[m.kind].name} 血 ${m.hp}/${KINDS[m.kind].hp}`
      + `${m.deaths ? `（打死 ${m.deaths}）` : ''} 破防 ${m.breakT > 0 ? '中' : `${m.gauge}/${KINDS[m.kind].breakAt}`}`).join(' ・ ');
    const phase = `${PHASE_NAME[this.combo.phase]}${invulnerable(this.combo) ? '（無敵）' : ''}`;
    return { foeLine, phase };
  }
}
