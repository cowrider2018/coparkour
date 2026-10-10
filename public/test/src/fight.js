/* ── test/src/fight.js ───────────────────────────────────────────────
   一場戰鬥在畫面上跑起來的那一層：場上的怪物與牠們的外觀、玩家的連段、
   打中與被打中、殭屍王的招與球、刀與出招的動作。

   規則全在 combat.js 與 skills.js（node 驗得動）；這裡把規則接到一幀一幀的
   迴圈上，並且擺好 three 的東西。戰鬥模式（一塊空地）與完整流程模式（遺跡）
   用的是同一份，差別只在怪物站在什麼樣的場地（`lineup` 的 field）、以及打死
   之後怎樣（`respawn`）。

   ── 一幀的順序 ──────────────────────────────────────────────────
     lead     按跳交給連段：普通的跳、某一段的出手，或是破防攻擊。在操控之前，
              因為破防攻擊一發動就接管速度。
     （模式自己操控、移動玩家：`breaking` 的時候不操控，`spinning` 的時候不移動）
     resolve  怪物追人、放招、球往前飛（撞到東西就炸掉），然後才判打中——兩個身體都走完這一幀了，
              範圍是對著畫面上的位置判的。打死殭屍王、騎士掉出靈魂，靈魂往下掉、漂，碰到
              就撿起來。回報玩家挨了哪一下、倒下沒有、打死了誰、撿了幾顆靈魂。
              不重生的怪物（完整流程、召喚出來的）打死了不是當場消失，而是變成屍體（_fell）：
              跟主角倒下一樣（death.js）往擊退的方向倒、帶著那一下的擊退飛，躺平而且落地的那一刻
              靈魂才掉出來。之後照 REST：綠色的慢慢沉進地裡、留著，國王躺著。幽靈不會落地，倒著漂
              GHOST_GONE 秒炸成一團幽靈血、收掉。換陣容的時候屍體收掉，清完的那一場的（keep）留著。
     give     （模式叫）獻靈魂：國王躺下之後，在牠身邊長按跳把最大血量一顆一顆交給牠（offer.js），
              交出去的那一顆拋到牠身上。交滿、最後一顆落到牠身上（拋物線的終點）的那一刻，國王復甦（REVIVE）：屍體炸成一團
              幽靈血，血慢下來之後再加速聚攏回來（bleed.js 的 GATHER），聚到的那一刻活著的國王
              從 0 長到原本大小。演完的那一幀回報 risen。
     draw     怪物、屍體、劍光（攻擊範圍）、國王劈砍的斬痕與氣流、旋風斬的熱氣流、粉塵（落地、殭屍王範圍攻擊的地震）、殭屍王的預告與球、靈魂、破防的兩圈、國王的盾、刀、
              頭頂的愛心。
              在相機擺好之後（破防的兩圈與愛心正對這一幀的鏡頭）；流體場也在這裡
              往前推一幀，所以要在 renderer.render 之前。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { PHYS, supportInfo } from './walk.js';
import {
  FIELD, REACH, KNOCK_SCALE, DAMAGE, KINDS, BREAK_WINDOW, hurt, makeMonster, harm, lifeStep, gainHeart,
  dropSoul, soulStep, grabs, bankSouls,
  breaking, broken, breakTarget, startBreak, breakContact, contact, parry, spinStep, separate, placeMonster, monsterStep, bites, knock,
  knockHero, knockLand,
  inSlash, inFan, inRing, slashTip, makeCombo, comboStep, invulnerable, untouchable, cueing, attacking, taken,
} from './combat.js';
import { makeMonsterCritter, sizeOf, bloodOf, swordOf, helmOf, crownOf, riseLift, Motion, ATTACK_INK, CHOP_LEAD } from './monster.js';
import { GUARD_INK } from './critter.js';
import { Blood } from './blood.js';
import { Fireballs } from './fireball.js';
import { hitFrame, burstFrame, hurtFrame, spurtOf, floorUnder, GATHER } from './bleed.js';
import { Blade } from './blade.js';
import { Helm } from './helm.js';
import { Crown } from './crown.js';
import { LivingKing } from './king.js';
import { ShieldRing } from './shield.js';
import { Mover } from './moves.js';
import {
  cueFx, showFx, breakFx, showBreak, laneFx, showLane, circleFx, showCircle,
  coneFx, showCone, stripFx, showStrip, galeFx, showGale,
} from './fx.js';
import { SoulLook } from './soul.js';
import { OFFER, makeOffer, offerStep, offerDone, blinkOf, throwSoul, flySoul } from './offer.js';
import { DEATH, tipAngle, footprint, fallSide, fallHalf, tipNode } from './death.js';
import { SKILL, GUST, WHIRL_LEN, REAP, REND, makeWorld, bossStep, wavesStep, shotsStep, gustsStep, ringsStep, shotHits, strikeHits, gustHits, ringHits, laneLength } from './skills.js';
import { Hearts } from './hearts.js';
import { Fluid, Sheet } from './fluid.js';
import { TRAILS } from './trail.js';
import { Qi } from './qi.js';
import { Gusts } from './gust.js';
import { Grab } from './grab.js';
import { Heats } from './heat.js';
import { Scars, SCAR_REACH } from './scar.js';
import { SHADE_N, bakeShade } from './occlude.js';
import { dustOf, dustFade, DUST_LOOK, PUSH_TIME, QUAKE, quakeBands, quakeFade, PLOW, plowPieces, plowClump } from './dust.js';
import { MUTE } from './sound.js';

/** _compile 記下原本的 scissor 用。 */
const _scissor = new THREE.Vector4();

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

/**
 * 國王劈下去的那一下鏡頭晃（跟收招那一頓同一刻，monster.js 的 hewRec）：往劈的方向
 * ——往下、往前 ahead 那麼多——先推出去，再來回彈幾下收掉。位移 amp·e^(−t/decay)·sin(2π·hz·t)
 * 公尺，life 秒之後不晃。只挪位置、不轉，畫面不會歪。
 */
const SHAKE = { amp: 0.12, hz: 14, decay: 0.08, life: 0.35, ahead: 0.5 };

/**
 * 從站位底下升上來的怪物（站位帶 `rise`：墓室的從石棺與大墓裡、其他圖的從地底）升幾秒：一開始整隻（連耳朵）埋在
 * 站位底下（monster.js 的 riseLift，跟召喚同一條，先快後慢），升完的那一刻腳剛好在站位上——就是牠上場、
 * 開始動的那一刻。升的時候不算上場：不動、打不到也打不到人。
 */
const EMERGE = 1.0;

/** 幽靈的屍體漂幾秒就炸開、收掉：牠不會落地，沒有「落地才收」那一刻。 */
const GHOST_GONE = 0.5;

/**
 * 屍體躺平落地之後怎樣（幽靈不在表上：牠不落地，見 GHOST_GONE）：
 *   sink  綠色的那幾類：SINK.time 秒沉進地裡，沉到躺著的那一身厚度的 SINK.depth，之後一直
 *         露著剩下的那一截。不收。
 *   lie   國王：躺著不動，不收。
 */
const REST = { minion: 'sink', boss: 'sink', knight: 'sink', king: 'lie' };
const SINK = { time: 2, depth: 0.75 };

/**
 * 國王復甦（獻靈魂交滿、拋出去的最後一顆落到國王身上的那一刻起）：
 *   bursts  屍體當場炸開——往全方向噴這麼多次幽靈血（破防攻擊那一種噴法），從躺著的
 *           身體中間噴；每一滴帶著 gather（bleed.js 的 GATHER）：慢下來，再加速聚攏到牠站起來
 *           的腰那一點（屍體的中間、地板上），全部同一刻到
 *   grow    聚到的那一刻起，活著的國王（king.js）從 0 長到原本大小要幾秒，
 *           繞著腰那一點放大，面朝炸開那一刻主角在的方向
 *   hold    長好之後再等幾秒才算演完（模式接著慢動作、翻國王復活那一頁）
 */
const REVIVE = { bursts: 3, grow: 0.7, hold: 0.4 };
/** 復甦開始（炸開）之後幾秒聚到、開始長。 */
const REVIVE_GROW = GATHER.at + GATHER.pull;

/** 右上那一行小字：現在在連段的哪裡。 */
export const PHASE_NAME = {
  idle: '待機', slash: '第一段', rest: '第一段收招', rise: '第二段', air: '第二段之後', leap: '第三段起跳', slam: '第三段落地',
  dash: '破防突進', spin: '破防迴旋', vault: '破防跳離',
};

/** 玩家挨了哪一下 → 給人看的一句話。 */
export const DEATH_TEXT = { bitten: '被咬到了', shot: '被球打中了', struck: '被怪物的招打中了' };

/**
 * 犁地的溝離中線多遠（公尺）：劍氣的半寬，但至少跟斬痕一樣寬——劍長那一截的斬痕才不會被同一刀
 * 揚起的塵蓋住。塵從溝的兩緣揚起，溝裡的不畫。
 */
const plowHalf = (g) => Math.max(g.w / 2, SCAR_REACH);

/** 第二、三段攻擊進行中的那幾個連段階段（Fight.striking）。 */
const STRIKING = new Set(['rise', 'air', 'leap', 'slam']);

export class Fight {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./critter.js').Zoo} zoo 玩家那一隻（刀掛在牠頭上，怪物借牠的立耳犬資料）
   * @param {{respawn?: boolean, renderer?: THREE.WebGLRenderer, sound?: {play: (event: string) => void}, souls?: number}} o
   *   respawn：打死的怪物在牠的重生點重生（戰鬥模式）；false 的話打死就倒下、落地之後離場（完整流程）。
   *   renderer：落地粉塵的流體場畫在它上面，沒給就沒有粉塵。sound：場上發生的事說給它聽
   *   （sound.js 的 Sound），沒給就沒有聲音。souls：國王倒下之後要收幾顆靈魂（offer.js，完整流程
   *   給 route.js 的 SOULS），沒給就不收
   */
  constructor(scene, zoo, { respawn = true, renderer = null, sound = MUTE, souls = 0 } = {}) {
    this.scene = scene;
    this.zoo = zoo;
    this.respawn = respawn;
    this.sound = sound;
    /** 國王要收幾顆靈魂（offer.js）。 */
    this._owed = souls;
    this._renderer = renderer;
    /** 還沒把著色器編好、預先畫過：一開始，與之後每次多建了一份怪物的外觀（見 _compile）。 */
    this._cold = true;
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
    /** 打死、還沒收掉的（_fell）：跟 foes 一樣的一筆，多一份 corpse。不追人、不挨打、不算在場上。 */
    this._corpses = [];
    /** 正在從站位底下升上來的（EMERGE）：{ slot, spawn, field, t }。升完才進 foes。 */
    this._emerging = [];
    /** 鏡頭上一幀在哪：屍體沒有擊退的話往離它遠的那一邊倒（resolve 的時候還沒有這一幀的鏡頭）。 */
    this._eye = new THREE.Vector3();
    this._pool = new Map();
    this._inkPx = null;

    /* 殭屍王放出來的球：畫成火球（fireball.js）；尾巴的火粒要 renderer 畫場。 */
    this.world = makeWorld();
    this._fire = new Fireballs(scene, SKILL.orb.radius, renderer);

    /* 連段的狀態與按鍵的提示圈。 */
    this.combo = makeCombo();
    this._fx = { cue: cueFx() };
    scene.add(this._fx.cue.node);
    /** 劍光：三段攻擊的範圍，同心的三道劍氣（trail.js 算形狀、qi.js 畫）。還看得到的
        每一刀，與收掉的那幾刀（下一刀借）。先收著一道：著色器才編得到（_compile）。 */
    this._qis = [];
    this._spare = [new Qi()];
    scene.add(this._spare[0].node);
    /** 國王劈砍在劍長以內、旋風斬的熱氣流撞上東西的地方留下的斬痕（scar.js）。 */
    this._scars = new Scars(scene);
    /** 扭曲畫面的那幾樣讀的畫面：一幀拷一次，大家共用（grab.js）。沒有 renderer 就沒有。 */
    this._grab = renderer ? new Grab(renderer) : null;
    /** 國王劈砍推出去的氣流：劍光那一塊，用扭曲畫面畫（gust.js）。 */
    this._gusts = new Gusts(scene, this._grab);
    /** 國王旋風斬推出去的熱氣流：一圈環帶，一樣用扭曲畫面畫（heat.js）。 */
    this._heats = new Heats(scene, this._grab);
    /** 怪物與玩家挨打噴出來的血（bleed.js 算、blood.js 畫）。 */
    this._blood = new Blood(scene, renderer);
    /* 落地的粉塵畫在共用的流體場（fluid.js）上，一團借一格。畫不出流體的機器、或網址
       給了 `?fluid=0`，就沒有粉塵——同一台手機上開關各看一次 fps，就是流體的成本。 */
    const fluidOn = new URLSearchParams(location.search).get('fluid') !== '0';
    this.fluid = renderer && fluidOn && Fluid.supported(renderer) ? new Fluid(renderer) : null;
    /** 收回來的那幾片煙（下一團塵借）。先收著一片，理由同劍光。 */
    this._sheets = [];
    if (this.fluid) this._sheets.push(this._sheet());
    /** 還看得到的每一團落地的塵，與每一個身體上一幀的高度、往下掉多快、站著沒有。 */
    this._puffs = [];
    /** 國王劈砍的氣流犁地揚起的塵：每一道氣流沿路每一段一片（dust.js 的 PLOW）。 */
    this._plows = [];
    this._feet = new WeakMap();
    /** 殭屍王的範圍攻擊（扇形、跳砸的圓）打下去揚起的地震塵：還看得到的每一片，與這一幀
        剛打下去、還沒揚的。跳砸落地的那一隻這一幀不揚落地的塵（_quiet）——那一下是地震。 */
    this._quakes = [];
    this._stomps = [];
    this._quiet = new Set();
    /** 地震的聲音：每一道塵揚起來的那一刻一聲（dust.js 的 quakeBands）。還沒響完的每一次
        地震，與還剩哪幾道（打下去之後幾秒）。跟塵分開記：沒有流體場、沒有塵的機器也聽得到。 */
    this._rumbles = [];
    /** 上一幀在哪一段：換段的那一刻起一道劍光。 */
    this._phase = this.combo.phase;
    /** 同一件事，給聲音的：resolve 的最後看，那時候破防攻擊的換段也走完了。 */
    this._heard = this.combo.phase;
    /** 這一幀在哪一段，它的範圍打不打得到怪物。第二段指著上一次第一段的末端點。 */
    this._reach = { slash: inSlash, rise: (p, m) => inFan(p, m, this.combo.tip), slam: inRing };

    /** 鏡頭還在晃的每一下（SHAKE）：劈下去多久了、往哪個方向（單位向量）。 */
    this._shakes = [];

    /** 玩家頭頂的愛心：還剩幾點血。 */
    this.hearts = new Hearts(scene);
    /** 獻靈魂交到哪裡（offer.js），與拋出去、還在飛的那幾顆。 */
    this.offer = makeOffer(this._owed);
    this._thrown = [];
    /** 復甦（REVIVE）：還沒開始是 null。活著的國王（king.js）：有要收靈魂才建，先藏著。 */
    this._revival = null;
    this._king = souls > 0 ? new LivingKing(scene, zoo) : null;

    /* 殭屍王、騎士掉出來的靈魂（combat.js 的 dropSoul）。換陣容不清——完整流程裡打完一場就換
       下一場，沒撿的留在原地，到主角換房間的那一刻才全部算撿到（bank）；回到站位（reset）也清。
       一顆一個 mesh，不夠就多做。 */
    this.souls = [];
    /** 靈魂的外觀（soul.js 的狗頭）：現在就建、先做好一顆藏著——第一顆掉出來的那一刻
        才建、才編的話就頓一下。 */
    this._soulLook = new SoulLook(zoo);
    this._soulViews = [this._soulLook.make()];
    this._soulViews[0].show(null);
    scene.add(this._soulViews[0].root);
  }

  /**
   * 每一類要幾份外觀才夠這一個陣容：陣容裡的，加上召喚得出來的（每一隻召喚者最多 cap 隻）。
   */
  static _need(spawns) {
    const need = new Map(), add = (kind, n) => need.set(kind, (need.get(kind) || 0) + n);
    for (const s of spawns) {
      add(s.kind, 1);
      if (KINDS[s.kind].skills?.includes('summon')) add(SKILL.summon.kind, SKILL.summon.cap);
    }
    return need;
  }

  /**
   * 載入的時候叫：這個模式會出現的每一個陣容（每一個是站位的清單），每一類照最多要的那麼多份
   * 先把外觀建好。建一隻要上百毫秒，而換陣容（完整流程是進場之後殭屍王才上場）與召喚都在
   * 遊戲中，那時候才建就是一頓。建好的藏著，下一幀跟其他東西一起編、預先畫一次（_compile）。
   *
   * @param {object[][]} lineups
   */
  preload(lineups) {
    const most = new Map();
    for (const spawns of lineups) {
      for (const [kind, n] of Fight._need(spawns)) most.set(kind, Math.max(most.get(kind) || 0, n));
    }
    const busy = new Set([...this.foes, ...this._corpses].map((f) => f.critter));
    for (const [kind, n] of most) {
      const had = this._pool.get(kind)?.length || 0;
      this._slot(kind, n - 1);
      for (const s of this._pool.get(kind).slice(had)) if (!busy.has(s.critter)) Fight._hide(s);
    }
  }

  /** 換了動物：刀掛到新那一隻頭上。 */
  follow() { this.blade.follow(this.zoo.active); }

  /** 墨線多粗（controls.js 的 fitView 給）。之後才借出去的外觀也要，所以記著。 */
  setInkPx(px, h) {
    this._inkPx = [px, h];
    for (const list of this._pool.values()) for (const s of list) s.critter.setInkPx(px, h);
    if (this._king) this._king.setInkPx(px, h);
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
      const critter = makeMonsterCritter(this.zoo, kind);
      const slot = {
        // pts：身體的輪廓，倒下的支點照它算（death.js）。要趁還沒動過、在待機姿勢的時候量。
        critter, pts: footprint(critter), breakFx: breakFx(),
        lane: laneFx(SKILL.orb.radius), circle: circleFx(SKILL.leap.radius), cone: coneFx(SKILL.cone.radius, SKILL.cone.half),
        rend: circleFx(REND.radius),
        whirl: stripFx(SKILL.whirl.radius, true), cleave: stripFx(SKILL.cleave.width / 2, false),
        hew: stripFx(SKILL.hew.width / 2, false), gale: galeFx(SKILL.gale.radius, SHADE_N),
        blade: null, helm: null, crown: null, shields: null,
      };
      // 咬著劍的那幾類（騎士、國王）：劍掛在牠自己的頭上，跟主角那把一樣每幀跟著頭。
      if (swordOf(kind)) { slot.blade = new Blade(swordOf(kind)); slot.blade.follow(slot.critter); }
      // 戴頭盔的那幾類（騎士、殭屍王）：一樣掛在頭上，墨線跟著牠的墨色換。
      if (helmOf(kind)) { slot.helm = new Helm(); slot.helm.follow(slot.critter); }
      // 戴王冠的（國王）：一樣掛在頭上。
      if (crownOf(kind)) { slot.crown = new Crown(); slot.crown.follow(slot.critter); }
      // 有盾的（國王）：幾面盾繞著牠轉，墨線一樣跟著牠的墨色換。
      if (KINDS[kind].shields) { slot.shields = new ShieldRing(KINDS[kind].shields); slot.shields.follow(slot.critter); this.scene.add(slot.shields.node); }
      if (this._inkPx) slot.critter.setInkPx(...this._inkPx);
      this.scene.add(slot.critter.root, slot.breakFx.node, slot.lane.node, slot.circle.node, slot.rend.node, slot.cone.node, slot.whirl.node, slot.cleave.node, slot.hew.node, slot.gale.node);
      list.push(slot);
      this._cold = true;
    }
    return list[i];
  }

  /** 外觀收起來：身體（倒過的轉回來）與身上掛的那幾樣全部。 */
  static _hide(s) {
    s.critter.root.visible = false;
    s.critter.root.quaternion.identity();
    Fight._bare(s);
  }

  /** 只留身體：破防的兩圈、預告、盾收起來（屍體）。 */
  static _bare(s) {
    s.breakFx.node.visible = false;
    s.lane.node.visible = false;
    s.circle.node.visible = false;
    s.rend.node.visible = false;
    s.cone.node.visible = false;
    s.whirl.node.visible = false;
    s.cleave.node.visible = false;
    s.hew.node.visible = false;
    s.gale.node.visible = false;
    if (s.shields) s.shields.hide();
  }

  /** 一隻怪物上場：借來的外觀亮出來、面向站位的方向，配上牠的狀態與動作。 */
  static _enter(slot, spawn, field) {
    slot.critter.root.visible = true;
    slot.critter.setFacing(spawn.yaw);
    const m = makeMonster(spawn, field);
    if (slot.shields) slot.shields.snap(m.shields);
    return { m, motion: new Motion(), rising: null, ...slot };
  }

  /** 借一份這一類沒在用的外觀：場上的與正在升上來的都不借。 */
  _free(kind) {
    const busy = new Set([...this.foes, ...this._corpses].map((f) => f.critter));
    for (const f of this.foes) for (const r of f.rising || []) busy.add(r.slot.critter);
    for (const e of this._emerging) busy.add(e.slot.critter);
    const list = this._pool.get(kind) || [];
    const i = list.findIndex((s) => !busy.has(s.critter));
    return this._slot(kind, i < 0 ? list.length : i);
  }

  /**
   * 召喚：倒數一開始，每一個召喚點借一份外觀（f.rising），倒數的時候從地底升上來（draw）；
   * 倒數完那一幀 skills.js 把牠們放進 world.spawns，這裡照順序接上場——用的就是升上來的
   * 那一份外觀，站在那一點、跟召喚牠的那一隻（`m.by`）同一塊場地。招被打斷（沒冒出來）
   * 的話，升到一半的那幾份收起來。
   */
  _rise() {
    for (const sp of this.world.spawns) {
      const host = this.foes.find((f) => f.m === sp.by);
      const r = host && host.rising && host.rising.shift();
      const f = Fight._enter(r ? r.slot : this._free(sp.kind), sp, sp.by.field);
      f.m.by = sp.by;
      this.foes.push(f);
    }
    this.world.spawns.length = 0;
    for (const f of this.foes) {
      const c = f.m.cast, on = !!c && c.skill === 'summon';
      if (!on) { Fight._sink(f); continue; }
      if (f.rising) continue;
      f.rising = [];
      for (const spot of c.spots) {
        f.rising.push({ slot: this._free(SKILL.summon.kind), spot, yaw: Math.atan2(c.tx - spot.x, c.tz - spot.z) });
      }
    }
  }

  /** 從站位底下升上來的往上一幀：升完（EMERGE 秒）的那一隻上場，這一幀起就追人。 */
  _emerge(dt) {
    this._emerging = this._emerging.filter((e) => {
      e.t += dt;
      if (e.t < EMERGE) return true;
      this.foes.push(Fight._enter(e.slot, e.spawn, e.field));
      return false;
    });
  }

  /** 升到一半的外觀收起來（招被打斷、召喚的那一隻離場、回到站位）。 */
  static _sink(f) {
    for (const r of f.rising || []) Fight._hide(r.slot);
    f.rising = null;
  }

  /**
   * 讓符合條件的那幾隻倒下：下一幀起不在清單裡（不追人、不挨打、不算在場上），變成屍體
   * （_decay 走、_lie 畫）。正在召喚、升到一半的收起來；放到一半的招、衝刺取消，身上那幾樣
   * 預告收起來，只留身體。朝向停在這一刻畫面上的那一個，往擊退的方向倒（沒有擊退就往離
   * 鏡頭遠的那一邊，death.js 的 fallSide）。
   */
  _fell(gone) {
    for (const f of this.foes) {
      if (!gone(f)) continue;
      Fight._sink(f);
      Fight._bare(f);
      const m = f.m, yaw = f.critter._yaw;
      m.cast = null; m.lunge = null; m.held = false; m.breakT = 0; m.stun = 0;
      f.critter.setFacing(yaw);
      const side = fallSide(new THREE.Vector3(), m.vx, m.vz, yaw, m.x, m.z, this._eye.x, this._eye.z);
      /* half：支點離中線多遠（倒向那一邊伸多遠）；thick：躺下來之後多厚——倒向那一邊加上
         另一邊伸多遠。down：躺平落地的那一刻（corpse.t），還沒是 null。 */
      const half = fallHalf(f.pts, side, yaw);
      const thick = half + fallHalf(f.pts, side.clone().negate(), yaw);
      f.corpse = { t: 0, side, half, thick, down: null, kept: false };
      this._corpses.push(f);
    }
    this.foes = this.foes.filter((f) => !gone(f));
  }

  /**
   * 屍體的一幀：照被打飛的拋物線（會飛的照漂的）走完（combat.js 的 monsterStep，沒有目標）。
   * 躺平（DEATH.tip）而且落地的那一刻（一直沒落地的話等到 DEATH.wait）靈魂掉出來，之後照
   * REST（沉下去、躺著，畫在 _lie）。幽靈不落地：GHOST_GONE 秒往全方向炸成一團幽靈血
   * （跟破防攻擊的那一下同一種噴法，bleed.js 的 burstFrame），收掉。
   */
  _decay(dt) {
    this._corpses = this._corpses.filter((f) => {
      const m = f.m, c = f.corpse;
      c.t += dt;
      monsterStep(m, dt, null);
      if (KINDS[m.kind].fly) {
        if (c.t < GHOST_GONE) return true;
        this._bleed(burstFrame(), m, m.kind);
        // 會掉靈魂的（幽靈騎士）：炸開的那一刻從那一團裡掉出來。
        if (KINDS[m.kind].soul && !f.banked) this.souls.push(dropSoul(m));
        Fight._hide(f);
        return false;
      }
      if (c.down !== null || c.t < DEATH.tip || (m.air && c.t < DEATH.wait)) return true;
      c.down = c.t;
      if (KINDS[m.kind].soul && !f.banked) this.souls.push(dropSoul(m));
      if (REST[m.kind]) return true;
      Fight._hide(f);
      return false;
    });
  }

  /**
   * 擺好一具屍體：倒了 tipAngle 那麼多（跟主角一樣，death.js），支點在倒向那一邊的身體外緣，
   * 步態照常疊在上面。在 critter.update 之後擺——它每幀把朝向寫回 root。會沉的（REST 的 sink）
   * 落地之後往下沉，先慢後快再慢（smoothstep），SINK.time 秒沉到底。
   */
  _lie(f, dt, camera) {
    const { m, critter, corpse: c, blade, helm, crown } = f;
    critter.root.visible = true;
    critter.setInkColor(null);
    critter.update(dt, {
      speed: 0, grounded: !m.air && !KINDS[m.kind].fly, vy: m.vy,
      viewYaw: Math.atan2(camera.position.x - m.x, camera.position.z - m.z), move: null,
    });
    let sink = 0;
    if (c.down !== null && REST[m.kind] === 'sink') {
      const u = Math.min(1, (c.t - c.down) / SINK.time);
      sink = SINK.depth * c.thick * u * u * (3 - 2 * u);
    }
    tipNode(critter.root, tipAngle(c.t), c.side, c.half, m.x, m.y - sink, m.z, critter._yaw);
    if (blade) blade.update();
    if (helm) helm.update();
    if (crown) crown.update();
  }

  /** 讓符合條件的那幾隻離場：外觀（連同牠正在召喚、升到一半的）藏起來，下一幀起不在清單裡。 */
  _drop(gone) {
    for (const f of this.foes) if (gone(f)) { Fight._hide(f); Fight._sink(f); }
    this.foes = this.foes.filter((f) => !gone(f));
  }

  /**
   * 這一場清完：場上的屍體留下來——之後換陣容不收，走回來還躺在那裡（或露著沉剩的那一截）。
   * 沒清完就換陣容（倒下、重打）的話，那一次打死的收掉：怪物會重新站出來。
   */
  keep() { for (const f of this._corpses) f.corpse.kept = true; }

  /**
   * 獻靈魂的地方：躺平落地的國王（REST 的 lie）身體的中間——倒向那一邊、離腳半個身高，
   * 高度是躺著那一身的一半。還沒躺下（或沒有國王）是 null。
   */
  altar() {
    const f = this._corpses.find((x) => REST[x.m.kind] === 'lie' && x.corpse.down !== null);
    if (!f) return null;
    const { m, corpse: c } = f, h = (PHYS.height * sizeOf(m.kind)) / 2;
    return { x: m.x + c.side.x * (c.half + h), y: m.y + c.half, z: m.z + c.side.z * (c.half + h) };
  }

  /**
   * 不在主角這裡（away 說的）的靈魂算撿到（combat.js 的 bankSouls）：最大血量照顆數加上去，地上的收掉。
   * 還沒掉出來的也算——屍體在那裡、靈魂還欠著的（幽靈騎士要等炸開，書頁蓋住的時候世界是停的，
   * 被送走的時候常常還沒炸），那一顆現在就算撿到，之後不再掉。完整流程每一幀叫。回傳收了幾顆。
   * @param {(o: {x: number, y: number, z: number}) => boolean} away
   */
  bank(player, away) {
    let n = bankSouls(player, this.souls, away);
    for (const f of this._corpses) {
      if (!KINDS[f.m.kind].soul || f.banked || !Fight._owes(f) || !away(f.m)) continue;
      f.banked = true;
      gainHeart(player);
      n++;
    }
    if (n) this.sound.play('soul');
    return n;
  }

  /** 這具屍體的靈魂還沒掉出來：會飛的炸開才掉（炸開就不在屍體清單裡了），其他的落地才掉。 */
  static _owes(f) {
    return KINDS[f.m.kind].fly || f.corpse.down === null;
  }

  /** 玩家在國王身邊、還收得了靈魂：這時候按跳是獻靈魂，不是跳（模式不交給 lead）。 */
  nearAltar(p) {
    const a = this.altar();
    return !!a && !offerDone(this.offer) && Math.hypot(p.x - a.x, p.z - a.z) < OFFER.near;
  }

  /**
   * 獻靈魂的一幀（offer.js 的 offerStep）：`held` 是跳按著沒有，在國王身邊才算。交出一顆就從
   * 玩家頭頂往國王身上拋一顆靈魂；飛著的往前飛，落到了響一聲、收掉。接著走復甦（_revive）。
   * 回傳 offerStep 的那一份，加上 risen：復甦演完的那一幀（只一次）。
   */
  give(dt, player, held) {
    const a = this.altar();
    const r = offerStep(this.offer, dt, held && this.nearAltar(player), player);
    if (r.gave) this._thrown.push(throwSoul({ x: player.x, y: player.y + PHYS.height, z: player.z }, a));
    this._thrown = this._thrown.filter((s) => {
      if (!flySoul(s, dt)) return true;
      this.sound.play('soul');
      return false;
    });
    return { ...r, risen: this._revive(dt, player) };
  }

  /**
   * 復甦的一幀（REVIVE）：交滿、拋出去的全部落到了、國王躺著，才開始——開始的那一幀屍體就炸開、收掉，
   * 血往回聚攏（bleed.js 照 gather 走，這裡只噴）；活著的國王在 draw 裡照 t 長大。演完的那一幀回傳 true。
   */
  _revive(dt, player) {
    let v = this._revival;
    if (!v) {
      if (!this._king || !this.offer.need || !offerDone(this.offer) || this._thrown.length) return false;
      const f = this._corpses.find((x) => REST[x.m.kind] === 'lie' && x.corpse.down !== null);
      if (!f) return false;
      const a = this.altar(), yaw = Math.atan2(player.x - a.x, player.z - a.z);
      v = this._revival = { t: 0, f, a, x: a.x, y: f.m.y, z: a.z, burst: false, done: false };
      this._king.place(a.x, f.m.y, a.z, yaw);
    }
    if (v.done) return false;
    v.t += dt;
    if (!v.burst) {
      v.burst = true;
      const s = sizeOf('king'), waist = (PHYS.height / 2) * s;
      // spurtOf 從腰那麼高噴：腳往下挪半個身高，噴的地方就是躺著的身體中間。
      const from = { x: v.a.x, y: v.a.y - waist, z: v.a.z };
      for (let k = 0; k < REVIVE.bursts; k++) {
        const list = spurtOf(burstFrame(), from, s, bloodOf('king'));
        this._blood.spurt(list.map((o) => ({ ...o, gather: { x: v.x, y: v.y + waist, z: v.z } })), v.f.m.field);
      }
      Fight._hide(v.f);
      this._corpses = this._corpses.filter((x) => x !== v.f);
      this.sound.play('burst');
    }
    if (v.t < REVIVE_GROW + REVIVE.grow + REVIVE.hold) return false;
    v.done = true;
    return true;
  }

  /** 活著的國王這一幀：聚到之前藏著，之後從 0 長到原本大小（越長越慢）。 */
  _risen(dt, camera, player) {
    if (!this._king) return;
    const v = this._revival, u = v ? Math.min(1, (v.t - REVIVE_GROW) / REVIVE.grow) : 0;
    this._king.draw(dt, camera, u > 0 ? 1 - (1 - u) ** 3 : 0, player);
  }

  /** 還有怪物正在從站位底下升上來（還沒上場）：場上沒有怪物也還不算清完。 */
  get emerging() { return this._emerging.length > 0; }

  /**
   * 這一場的 BOSS（站位帶 `boss` 的那一隻，route.js 的 STAGES）：在場上的，或正在從站位底下升上來的
   * （升的時候血是滿的）。`spawn` 是牠的站位——同一次出場從升上來到上場都是同一份，認得出是不是同一隻。
   * 沒有（還沒出生、死了、收起來了）是 null。
   */
  boss() {
    const f = this.foes.find((x) => x.m.spawn.boss);
    if (f) return { spawn: f.m.spawn, kind: f.m.kind, hp: f.m.hp };
    const e = this._emerging.find((x) => x.spawn.boss);
    return e ? { spawn: e.spawn, kind: e.spawn.kind, hp: KINDS[e.spawn.kind].hp } : null;
  }

  /** 復活的國王（king.js）；沒有要收靈魂（戰鬥模式）是 null。 */
  get king() { return this._king; }

  /**
   * 換一批怪物上場：借好每一隻的外觀、藏起用不到的，每一隻站在自己的站位上。站位帶 `rise` 的
   * 先不上場，從站位底下升上來（EMERGE 秒，_emerge），升完才上場。
   * 留下來的屍體（keep）不動，牠們的外觀不借。連段與飛著的球一起清掉。空的清單就是清場。
   *
   * @param {object[]} spawns 站位（combat.js 的 makeMonster 吃的那一種）
   * @param {object} field 牠們站在什麼樣的場地（combat.js 的 FIELD 那一種）
   */
  lineup(spawns, field = FIELD) {
    /* 召喚得出來的那幾隻也要有外觀：召喚的那一刻才建就是一頓。preload 過的話都已經有了；
       沒有的在這裡補（下面一起藏起來）。 */
    for (const [kind, n] of Fight._need(spawns)) this._slot(kind, n - 1);
    this._corpses = this._corpses.filter((f) => f.corpse.kept);
    const taken = new Set(this._corpses.map((f) => f.critter));
    for (const list of this._pool.values()) for (const s of list) if (!taken.has(s.critter)) Fight._hide(s);
    // 每一隻借這一類第一份沒被拿走的；都被拿走了（留下來的屍體佔著）就多做一份。
    const pick = (kind) => {
      const list = this._pool.get(kind) || [];
      const s = list.find((x) => !taken.has(x.critter)) || this._slot(kind, list.length);
      taken.add(s.critter);
      return s;
    };
    this.foes = spawns.filter((s) => !s.rise).map((s) => Fight._enter(pick(s.kind), s, field));
    this._emerging = spawns.filter((s) => s.rise).map((spawn) => ({ slot: pick(spawn.kind), spawn, field, t: 0 }));
    this.world = makeWorld(field);
    this._calm = false;
    Object.assign(this.combo, makeCombo());
    this._dropTrails();
    this._gusts.clear();
    this._heats.clear();
    this._scars.clear();
  }

  /** 怪物全部回到站位（血滿、破防歸零；還在升的直接站上去），召喚出來的離場，屍體（留下來的也是）收掉，連段與球清掉。 */
  reset() {
    this._drop((f) => f.m.by);
    for (const e of this._emerging) this.foes.push(Fight._enter(e.slot, e.spawn, e.field));
    this._emerging = [];
    for (const f of this._corpses) Fight._hide(f);
    this._corpses = [];
    for (const f of this.foes) {
      placeMonster(f.m);
      f.critter.setFacing(f.m.spawn.yaw);
      f.motion = new Motion();
      f.m.brood = 0;
      Fight._sink(f);
      if (f.shields) f.shields.snap(f.m.shields);
    }
    Object.assign(this.combo, makeCombo());
    this._face = null;
    this.world.shots.length = 0;
    this.world.gusts.length = 0;
    this.world.rings.length = 0;
    this.world.spawns.length = 0;
    this.souls.length = 0;
    this.offer = makeOffer(this._owed);
    this._thrown = [];
    this._revival = null;
    if (this._king) this._king.hide();
    this._dropTrails();
    this._gusts.clear();
    this._heats.clear();
    this._scars.clear();
  }

  /**
   * 失去目標：玩家倒下了。放到一半的招、衝到一半的衝刺取消，之後不再挑招、不再追人——
   * 被打飛的照拋物線落地，其餘站著（combat.js 的 monsterStep 沒有目標的那一段）。已經
   * 出手的（飛著的球、往外走的氣流）照常走完。下一次 lineup 才回來。
   */
  standDown() {
    this._calm = true;
    for (const { m } of this.foes) { m.cast = null; m.lunge = null; }
  }

  /** 收招：連段歸零、朝向放開，怪物不動。倒下的那一刻用（之後不再 lead，屍體不出招）。 */
  disarm() {
    Object.assign(this.combo, makeCombo());
    this._face = null;
  }

  /** 破防攻擊裡：突進與跳離是拋物線、迴旋的位置由 spinStep 擺，模式不要操控玩家。 */
  get breaking() { return breaking(this.combo); }

  /** 迴旋中：玩家的位置由 spinStep 擺，模式不要移動玩家。 */
  get spinning() { return this.combo.phase === 'spin'; }

  /**
   * 第二、三段攻擊的那一整段：從第二段的視窗打開（按跳就是第二段）到第三段收招。跳躍鍵在這一段
   * 畫一把刀，不畫箭頭（pad.js 的 icon）。
   */
  get striking() { return cueing(this.combo) || STRIKING.has(this.combo.phase); }

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
    if (player.knocked) pressed = false;   // 被擊退、還在空中：不能跳（combat.js 的 knockHero）
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
    const kills = [], sound = this.sound;
    /* 這一幀開始的時候已經在破防中的：結束的時候多出來的，就是這一幀窗口剛開的。 */
    const open = new Set(foes.filter(({ m }) => broken(m)).map(({ m }) => m));
    lifeStep(player, dt);
    knockLand(player);
    // 每一隻召喚出來、還在場上的有幾隻（召喚挑不挑得到、召幾隻看它，skills.js）。
    for (const { m } of foes) m.brood = 0;
    for (const { m } of foes) if (m.by) m.by.brood++;
    // 殭屍王先決定這一幀在不在放招（放招中 monsterStep 讓牠站著），球往前飛。
    const strikes = [];
    for (const f of foes) {
      const m = f.m, cast = m.cast, shots = this.world.shots.length;
      const st = this._calm ? null : bossStep(m, dt, player, this.world);
      if (this.world.shots.length > shots) sound.play('shot');
      if (!st) continue;
      /* 打下去的那一刻。劍迴旋與上挑是連著好幾幀都在打，只有頭一幀出聲：記在那一招
         身上（跳砍先劈後挑，形狀換了就是另一下）。地震不在這一刻響，跟著塵一道一道響（_rumble）。 */
      if (cast && cast.heard !== st.shape) {
        cast.heard = st.shape;
        if (QUAKE[st.shape]) this._rumbles.push({ shape: st.shape, t: 0, at: quakeBands(st.shape, st.r).map((b) => b.at) });
        else sound.play(st.shape);
      }
      // 國王劈下去（那一刀帶著氣流）：劍長那一截裂開，鏡頭往劈的方向晃。
      if (st.gust) {
        this._scars.cut(st, this.world.field.cols);
        const n = Math.hypot(SHAKE.ahead, 1);
        this._shakes.push({ t: 0, x: (st.dirX * SHAKE.ahead) / n, y: -1 / n, z: (st.dirZ * SHAKE.ahead) / n });
      }
      // 地震（dust.js 的 QUAKE）是震波，放在 world.waves 一圈圈往外推；其餘的這一幀一次打完。
      if (!QUAKE[st.shape]) { strikes.push(st); continue; }
      if (!this.fluid) continue;
      this._stomps.push(st);
      if (st.shape === 'circle') this._quiet.add(m);
    }
    wavesStep(this.world, dt);
    this._rumble(dt);
    // 召喚：倒數完的上場（這一幀起就追人）；剛開始倒數的借外觀，準備從地底升上來。
    this._rise();
    // 從站位底下升上來的：升完的上場。
    this._emerge(dt);
    // 撞到黑牆或場上東西的球炸掉。
    for (const s of shotsStep(this.world, dt)) { this._fire.explode(s); sound.play('burst'); }
    // 國王劈砍推出去的氣流往前走，走到黑牆或撞上東西就停。
    gustsStep(this.world, dt);
    // 國王旋風斬的熱氣流往外擴散，碰到東西的那一段停下；推出去的那一刻每一個擋下它的東西留一道斬痕。
    for (const g of this.world.rings) if (!g.gashed) { g.gashed = true; this._scars.gash(g, SKILL.gale.wave.speed); }
    ringsStep(this.world, dt);
    for (const { m } of foes) monsterStep(m, dt, this._calm ? null : player);
    this._decay(dt);
    // 衝刺衝出去的那一刻：咬下去的那一聲。國王一次衝好幾下，每一下是新的一份 m.lunge。
    for (const { m } of foes) if (m.lunge && m.lunge.hot && !m.lunge.heard) { m.lunge.heard = true; sound.play('lunge'); }
    separate(foes.map((f) => f.m));
    /* 每一隻這一刻在哪：扣到 0 的那一下 hurt 就把牠搬回重生點了，靈魂要掉在死的地方。
       重生的只有 back 的那幾隻；其餘的打死了留在原地、帶著擊退倒下去（_fell）。 */
    const spot = new Map(foes.map(({ m }) => [m, { x: m.x, y: m.y, z: m.z, field: m.field }]));
    const back = (m) => this.respawn && !m.by;
    // 破防攻擊：突進碰到目標就定住牠、進迴旋（有盾的話被擋掉、直接跳離）；迴旋轉完就扣血、跳離。
    if (combo.phase === 'dash' && breakContact(player, combo.target) && contact(combo, player, combo.target)) sound.play('parry');
    const dead = new Set();
    if (combo.phase === 'spin') {
      const m = combo.target, r = spinStep(combo, player, m, back(m));
      if (r.died) dead.add(m);
      // 破防攻擊沒有劍氣：往全方向噴，從牠被定住的地方（打死的話已經搬回重生點了）。
      if (r.took > 0) { this._bleed(burstFrame(), spot.get(m) || m, m.kind); sound.play('hit'); }
    }
    const reach = this._reach[combo.phase];
    const body = this.body(player);
    for (const { m } of foes) {
      if (reach && !combo.hit.has(m) && reach(body, m)) {
        combo.hit.add(m);
        if (parry(m)) { sound.play('parry'); continue; }   // 盾擋掉了（國王）：這一下整個不算
        sound.play('hit');
        knock(m, body.x, body.z, body.aimX, body.aimZ, KNOCK_SCALE[combo.phase]);
        if (taken(m, DAMAGE[combo.phase]) > 0) this._bleed(hitFrame(combo.phase, body, combo.tip, m, sizeOf(m.kind)), m, m.kind);
        if (hurt(m, DAMAGE[combo.phase], back(m))) dead.add(m);
      }
    }
    if (dead.size) sound.play('kill');
    if (foes.some(({ m }) => broken(m) && !open.has(m))) sound.play('break');
    for (const m of dead) {
      if (!m.by) kills.push(m.kind);
      // 不重生的那幾隻，靈魂等屍體落地才掉（_decay）。
      if (KINDS[m.kind].soul && back(m)) this.souls.push(dropSoul(spot.get(m)));
    }
    /* 打死：重生的 hurt 已經讓牠在重生點重生了。不重生的倒下——變成屍體，下一幀起不在
       清單裡。召喚出來的打死一律倒下（不重生、不算在 kills 裡）；召喚牠們的那一隻死了，
       牠召喚的一起倒下。 */
    if (dead.size) this._fell(({ m }) => (dead.has(m) && !back(m)) || (m.by && dead.has(m.by)));

    let hit = null, by = null;
    if (!untouchable(combo, player)) {
      // by：打中他的那一個（咬的怪物、球、那一下），噴血的形狀與方向照它（bleed.js 的 hurtFrame）。
      const take = (cause, dmg, src) => { if (!hit || dmg > hit.dmg) { hit = { cause, dmg }; by = src; } };
      for (const { m } of this.foes) if (bites(player, m)) take('bitten', KINDS[m.kind].bite, m);
      for (const s of this.world.shots) if (shotHits(s, player)) take('shot', s.dmg, s);
      for (const st of strikes) {
        if (!strikeHits(st, player)) continue;
        take('struck', st.dmg, st);
        if (st.gust) st.gust.spent = true;    // 被劈砍那一刀劈到：同一招的氣流不再算
        if (st.wave) st.wave.spent = true;    // 被旋風斬轉到：同一招的熱氣流不再算
      }
      // 氣流是一陣風壓，不是刀：噴的是一團，順著它走的方向（by 是氣流本身，bleed.js 的 hurtFrame）。
      for (const g of this.world.gusts) {
        if (g.spent || !gustHits(g, player)) continue;
        g.spent = true;
        take('struck', g.dmg, g);
      }
      for (const g of this.world.rings) {
        if (g.spent || !ringHits(g, player)) continue;
        g.spent = true;
        take('struck', g.dmg, g);
      }
      for (const w of this.world.waves) if (strikeHits(w, player)) take('struck', w.dmg, w);
      if (hit) {
        // 玩家跟狗一樣大（體型 1），噴的是血；剛挨過一下（guard）沒扣到就不噴。
        if (harm(player, hit.dmg)) {
          const frame = hurtFrame(hit.cause, by, player);
          this._blood.spurt(spurtOf(frame, player, 1, 'blood'), this.world.field);
          /* 擊退：往血噴出去的那個方向（那一下打過來的方向）。那個方向幾乎是直上直下的話
             （往上挑的那一片），改成離開打中他的那一個；還是分不出來就往後退。 */
          let kx = frame.d[0], kz = frame.d[2], kh = Math.hypot(kx, kz);
          if (kh < 0.2) { kx = player.x - (by.x ?? player.x); kz = player.z - (by.z ?? player.z); kh = Math.hypot(kx, kz); }
          if (kh < 1e-6) { kx = -player.aimX; kz = -player.aimZ; kh = 1; }
          knockHero(player, kx / kh, kz / kh);
          if (hit.cause === 'bitten') sound.play('bitten');
          if (player.hp <= 0) sound.play('down');
          else if (hit.cause !== 'bitten') sound.play('hurt');
        }
        // 打中人的球炸掉消失。
        if (hit.cause === 'shot') {
          this.world.shots = this.world.shots.filter((s) => {
            if (!shotHits(s, player)) return true;
            this._fire.explode(s);
            sound.play('burst');
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
      if (souls) sound.play('soul');
    }
    /* 連段進了新的一段：出手的那一聲。沒有登記的段（收招、起跳、跳離）不出聲。 */
    if (combo.phase !== this._heard) sound.play(this._heard = combo.phase);
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
    if (this._cold) this._compile(camera);
    this._shake(dt, camera);
    this._eye.copy(camera.position);
    this.blade.update();
    // 剛挨過一下（guard 還開著）：玩家一閃一閃的。頭頂是最大血量幾顆心、剩下的幾顆是滿的。
    this.zoo.root.visible = !(player.guard > 0) || Math.floor(player.guard * 12) % 2 === 0;
    // 無敵的時候墨線金色：跟碰到算不算（untouchable）同一個判斷。
    this.zoo.setInkColor(untouchable(combo, player) ? GUARD_INK : null);
    // 獻靈魂：要交出去的那一顆（最上面那一顆）閃。
    const blink = blinkOf(this.offer, player);
    this.hearts.show(player.hp, player.max, player.x, player.y, player.z, camera.quaternion,
      blink >= 0 && Math.floor(blink * 12) % 2 === 1);
    for (const { m, critter, motion, blade, helm, crown, shields } of this.foes) {
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
      if (crown) crown.update();
      // 盾繞著牠的腳轉（衝的時候畫得跳起來，盾跟著）。
      if (shields) shields.show(dt, m.shields, m.x, m.y + mo.lift, m.z, sizeOf(m.kind));
    }
    for (const f of this._corpses) this._lie(f, dt, camera);
    this._risen(dt, camera, player);
    // 從站位底下升上來（石棺裡）：升完的那一刻腳剛好在站位上（monster.js 的 riseLift）。
    for (const { slot, spawn, t } of this._emerging) {
      const c = slot.critter;
      c.root.visible = true;
      c.root.position.set(spawn.x, spawn.y + riseLift(t / EMERGE, spawn.kind), spawn.z);
      c.setFacing(spawn.yaw);
      c.setInkColor(null);
      c.update(dt, { speed: 0, grounded: false, vy: 0, viewYaw: Math.atan2(camera.position.x - spawn.x, camera.position.z - spawn.z), move: null });
      if (slot.blade) slot.blade.update();
      if (slot.helm) slot.helm.update();
    }
    // 召喚中：幽靈從地底升上來，倒數完的那一刻剛好整隻離開地面（monster.js 的 riseLift）。
    for (const f of this.foes) {
      if (!f.rising || !f.m.cast) continue;
      const u = f.m.cast.t / SKILL.summon.windup;
      for (const { slot, spot, yaw } of f.rising) {
        const c = slot.critter;
        c.root.visible = true;
        c.root.position.set(spot.x, spot.y + riseLift(u, SKILL.summon.kind), spot.z);
        c.setFacing(yaw);
        c.setInkColor(null);
        c.update(dt, { speed: 0, grounded: false, vy: 0, viewYaw: Math.atan2(camera.position.x - spot.x, camera.position.z - spot.z), move: null });
      }
    }

    // 攻擊範圍：劍光，跟著玩家的腳與出招時鎖住的面向走（騎士的劍迴旋跟著牠）。落地的粉塵。
    this._whirls();
    this._qi(dt, this.body(player));
    this._scars.draw(dt);
    this._gusts.draw(dt, this.world, camera);
    this._heats.draw(dt, this.world);
    this._blood.step(dt, camera);
    if (this.fluid) this._dust(dt, player);
    // 提示圈不淡：亮著就是「現在按」。貼在玩家腳下那一層地板上（人可能在空中）。
    const floor = supportInfo(this.world.field.cols, player.x, player.z, player.y).y;
    showFx(fx.cue, cueing(combo) ? 0 : Infinity, 1, player.x, floor, player.z, 0);

    // 怪物技能的預告：貼在牠（或跳砸的落點）那一層地板上。
    for (const f of this.foes) {
      const { m, lane, circle, rend, cone, whirl, cleave } = f;
      const c = m.cast;
      this._hew(f);
      this._gale(f);
      const orb = !!c && c.skill === 'orb', leap = !!c && c.skill === 'leap', fan = !!c && c.skill === 'cone';
      /* 劍迴旋衝刺：從起步的地方往鎖定的方向，衝得到多遠（黑牆擋住的話到牆前）。衝的時候
         亮著滿的——那一條就是還會被掃到的地方。 */
      const wh = !!c && c.skill === 'whirl';
      showStrip(whirl, wh, wh ? Math.min(1, c.t / SKILL.whirl.windup) : 0, wh ? c.x0 : 0, wh ? c.z0 : 0,
        wh ? Math.atan2(c.dirX, c.dirZ) : 0,
        wh ? Math.min(WHIRL_LEN, Math.max(0, laneLength(c.x0, c.z0, c.dirX, c.dirZ, m.field.arena) - PHYS.radius)) : 0, c ? c.y0 : 0);
      /* 跳砍：從落點往前的那一條（正中間是主角被鎖定的地方），貼在落點那一層地板上；飛的時候
         亮著滿的。落地之後換成上挑那一條（從牠腳下往主角、長 REACH），等的那 gap 秒從牠腳下長滿，
         打得到的那 swing 秒亮著滿的，之後收掉。
         幽靈騎士的連斬（REAP）後兩下各有各的預告：上挑是那一條，原地轉一圈是一個圓（半徑是轉的
         那一圈 REND.radius，在牠轉的那個高度——腰那麼高，跟國王旋風斬的亮圓一樣）。先出的那一下
         從落地起長，後出的那一下從先出的那一下出手起長，各自長到自己出手、打得到的時候亮著滿的。 */
      const cl = !!c && (c.skill === 'cleave' || !!REAP[c.skill]), CL = SKILL.cleave, P = cl ? REAP[c.skill] : null;
      let spinOn = false, spinFrac = 0;
      if (cl && c.up) {
        const u = c.t - CL.windup - CL.air;
        /** 這一下的預告：at 是牠出手的時刻（落地起算），from 是預告開始長的時刻，swing 是打得到多久。 */
        const cue = (at, swing) => {
          const from = at > CL.up.gap ? CL.up.gap : 0;
          return { on: u >= from && u <= at + swing, frac: Math.min(1, Math.max(0, (u - from) / Math.max(1e-6, at - from))) };
        };
        const up = cue(CL.up.gap + (P?.up ?? 0), CL.up.swing);
        showStrip(cleave, up.on, up.frac, c.up.x, c.up.z, Math.atan2(c.up.dirX, c.up.dirZ), REACH, c.up.y);
        if (P) ({ on: spinOn, frac: spinFrac } = cue(CL.up.gap + P.spin, REND.swing));
      } else {
        showStrip(cleave, cl, cl ? Math.min(1, c.t / CL.windup) : 0, cl ? c.lx : 0, cl ? c.lz : 0,
          cl ? Math.atan2(c.dirX, c.dirZ) : 0, CL.len, cl ? c.ly : 0);
      }
      showLane(lane, orb, orb ? Math.min(1, c.t / SKILL.orb.windup) : 0, m.x, m.z,
        orb ? Math.atan2(c.dirX, c.dirZ) : 0, orb ? laneLength(m.x, m.z, c.dirX, c.dirZ, m.field.arena) : 0, m.y);
      showCircle(circle, leap, leap ? Math.min(1, c.t / SKILL.leap.windup) : 0, leap ? c.tx : 0, leap ? c.tz : 0, leap ? c.ty : 0);
      showCircle(rend, spinOn, spinFrac, m.x, m.z, m.y + REND.waist);
      showCone(cone, fan, fan ? Math.min(1, c.t / SKILL.cone.windup) : 0, m.x, m.z, fan ? Math.atan2(c.dirX, c.dirZ) : 0, m.y);
    }

    // 飛著的球（火球）。
    this._fire.draw(dt, this.world.shots, camera);

    // 靈魂：頭、光暈、冒出來的小球（soul.js）。
    const souls = this._thrown.length ? [...this.souls, ...this._thrown] : this.souls;
    while (this._soulViews.length < souls.length) {
      const o = this._soulLook.make();
      this.scene.add(o.root);
      this._soulViews.push(o);
    }
    this._soulViews.forEach((o, i) => o.show(souls[i] || null, dt, camera));

    // 破防的兩圈：套在怪物身體的中間，正對這一幀的鏡頭。
    for (const { m, breakFx: bf } of this.foes) {
      showBreak(bf, m.breakT / BREAK_WINDOW, m.x, m.y + PHYS.height / 2, m.z, camera.quaternion);
    }
  }

  /**
   * 把會用到的著色器先編好（一開始、與多建了外觀之後的第一幀）。three 是第一次畫到一個材質才編它，
   * 一個要幾十到幾百毫秒：藏著、還沒畫過的那幾樣（預告、召喚的幽靈、劍光、國王的氣流與斬痕、煙、
   * 血）第一次亮出來的那一幀就頓一下——國王一劈下去就是四五樣一起。renderer.compile 連藏著的
   * 都編，所以要用的時候才借的那幾樣各先收著一份（劍光、煙在建構子；氣流、斬痕在它們自己那支）。
   * 畫到貼圖上的（流體場的 pass、血與火球尾巴的場）不在場景裡，對著它們自己的貼圖編——畫到哪裡也算在
   * 著色器的快取鍵裡。
   */
  _compile(camera) {
    this._cold = false;
    const r = this._renderer;
    if (!r) return;
    r.compile(this.scene, camera);
    /* 編好了還不夠：Windows 上的 WebGL（ANGLE，底下是 D3D）第一次真的畫一個東西的時候，才把
       著色器照它的頂點格式再編一次、把幾何送上去，一樣頓一下。所以藏著的全部亮出來畫一次——
       只畫左下角一個像素（scissor），這一幀接著畫的整個畫面會蓋過去——再藏回去。鏡頭外的也要畫：
       沒在用的預告縮成長度 0 擺在原點，照視錐裁掉的話就畫不到，所以這一下不裁。 */
    const hidden = [], culled = [];
    this.scene.traverse((o) => {
      if (!o.visible) { o.visible = true; hidden.push(o); }
      if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); }
    });
    const scissor = r.getScissor(_scissor), test = r.getScissorTest();
    r.setScissor(0, 0, 1, 1);
    r.setScissorTest(true);
    r.render(this.scene, camera);
    r.setScissor(scissor);
    r.setScissorTest(test);
    for (const o of hidden) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
    if (this.fluid) this.fluid.compile();
    this._blood.compile(camera);
    this._fire.compile(camera);
  }

  /**
   * 鏡頭晃：還在晃的每一下（SHAKE）疊起來，加在這一幀擺好的鏡頭位置上。模式每一幀都重新擺
   * 鏡頭，所以不會累積。
   */
  _shake(dt, camera) {
    this._shakes = this._shakes.filter((s) => (s.t += dt) < SHAKE.life);
    for (const s of this._shakes) {
      const k = SHAKE.amp * Math.exp(-s.t / SHAKE.decay) * Math.sin(2 * Math.PI * SHAKE.hz * s.t);
      camera.position.x += s.x * k;
      camera.position.y += s.y * k;
      camera.position.z += s.z * k;
    }
  }

  /**
   * 國王的直線劈砍：倒數的時候是一條從牠腳下往鎖定方向一直到黑牆的長條（氣流最遠走得到那裡），
   * 亮色從腳下長到那一頭；劈下去就收掉——跟球的預告一樣，出手之後不留。
   */
  _hew(f) {
    const { m, hew } = f, c = m.cast, on = !!c && c.skill === 'hew';
    showStrip(hew, on, on ? Math.min(1, c.t / SKILL.hew.windup) : 0, m.x, m.z, on ? Math.atan2(c.dirX, c.dirZ) : 0,
      on ? laneLength(m.x, m.z, c.dirX, c.dirZ, m.field.arena) : 0, m.y);
  }

  /**
   * 國王的旋風斬：倒數的時候整片場地淺紅（擋住的地方挖掉）、腰那麼高的亮圓從中心長到劍長；
   * 轉的那一下就收掉。挑招的那一刻（第一次看到這一招）把 skills.js 算好的那一張遮擋表烘給它。
   */
  _gale(f) {
    const { m, gale } = f, c = m.cast, on = !!c && c.skill === 'gale' && c.t < SKILL.gale.windup;
    if (on && gale.cast !== c) {
      gale.cast = c;
      const A = m.field.arena;
      gale.half = bakeShade(c.env, gale.data, (th) => laneLength(m.x, m.z, Math.sin(th), Math.cos(th), A));
      gale.tex.needsUpdate = true;
    }
    showGale(gale, on, on ? c.t / SKILL.gale.windup : 0, m.x, m.y, m.z, SKILL.gale.waist, on ? gale.half : 1);
  }

  /**
   * 騎士的劍迴旋衝刺：倒數完、開始衝的那一幀起一道兩圈的劍光（trail.js 的 whirl），
   * 照迴旋的半徑縮放，跟著牠的腳與鎖定的方向走——牠一邊衝一邊鋪，所以留下來的是
   * 一圈往前拉開的劍光。高度照牠的體型抬：主角的劍光在身高中間，牠畫得高。國王的旋風斬一樣，
   * 只是一圈（主角第三擊那一道）、不衝。
   * 跳砍與之後的上挑交給 _cleave。
   */
  _whirls() {
    for (const { m } of this.foes) {
      const c = m.cast;
      if (c && (c.skill === 'cleave' || REAP[c.skill])) { this._cleave(m, c); continue; }
      if (c && c.skill === 'hew') { this._hewQi(m, c); continue; }
      // 國王的旋風斬：主角第三擊那一道（一圈），照劍長縮放。
      const spin = !!c && c.skill === 'gale', S = spin ? SKILL.gale : SKILL.whirl;
      if (!c || !(spin || c.skill === 'whirl') || c.t < S.windup || c.qi) continue;
      const q = this._spare.pop() || new Qi();
      if (!q.node.parent) this.scene.add(q.node);
      q.start(spin ? 'slam' : 'whirl', null, S.radius / REACH);
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
   *   轉  幽靈騎士的連斬（REAP）：開始轉的那一幀（對空的是上挑升到頂點、對地的是落地 gap 秒後，
   *       見 REAP）起一道主角第三擊的劍光（slam，一圈），照轉的半徑縮放、高度照牠的體型抬，
   *       跟國王的旋風斬那一道一樣。連斬的上挑照 REAP 晚多少起跳，那一道就晚多少起。
   */
  _cleave(m, c) {
    const S = SKILL.cleave, P = REAP[c.skill] || { up: 0 };
    if (REAP[c.skill] && c.up && !c.spinQi && c.t >= S.windup + S.air + S.up.gap + P.spin) {
      this._foeQi(m, c, 'slam', null, SKILL[c.skill].radius / REACH, c.up.dirX, c.up.dirZ, (PHYS.height / 2) * (sizeOf(m.kind) - 1));
      c.spinQi = true;
    }
    if (!c.chopQi && c.t >= S.windup + S.air - CHOP_LEAD) {
      const tip = { x: c.lx + c.dirX * S.len, y: c.ly, z: c.lz + c.dirZ * S.len };
      this._foeQi(m, c, 'cleave', tip, S.len / REACH, c.dirX, c.dirZ);
      c.chopQi = true;
    }
    if (c.up && !c.qi && c.t >= S.windup + S.air + S.up.gap + P.up) {
      this._foeQi(m, c, 'rise', c.up.tip, 1, c.up.dirX, c.up.dirZ);
      c.qi = true;
    }
  }

  /**
   * 國王的直線劈砍：跟騎士跳砍劈下去那一道一樣——頭往下甩的那一刻（出手前 CHOP_LEAD 秒）
   * 起一道 cleave，從正上方劈到前面，照劍長（SKILL.hew.len）縮放：劍光是那一刀本身，
   * 往前推出去的是氣流。
   */
  _hewQi(m, c) {
    const S = SKILL.hew, L = S.len;
    if (c.chopQi || c.t < S.windup - CHOP_LEAD) return;
    this._foeQi(m, c, 'cleave', { x: m.x + c.dirX * L, y: m.y, z: m.z + c.dirZ * L }, L / REACH, c.dirX, c.dirZ);
    c.chopQi = true;
  }

  /** 怪物身上起一道劍光：跟著牠的腳（往上抬 lift），朝 (aimX, aimZ)，招被打斷就收（見 _qi）。 */
  _foeQi(m, c, kind, tip, scale, aimX, aimZ, lift = 0) {
    const q = this._spare.pop() || new Qi();
    if (!q.node.parent) this.scene.add(q.node);
    q.start(kind, tip, scale);
    const body = { x: 0, y: 0, z: 0, aimX, aimZ };
    q.owner = () => Object.assign(body, { x: m.x, y: m.y + lift, z: m.z });
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
    for (const pl of this._plows) pl.tau += dt;
    for (const g of this.world.gusts) this._plow(g);
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
    this._plows = this._plows.filter((pl) => {
      const alive = pl.tau < PLOW.life && fluid.owns(pl.tile, pl);
      if (alive) pl.sheet.show(pl.tile, dustFade(PLOW, pl.tau));
      else this._endPuff(pl);
      return alive;
    });
  }

  /**
   * 氣流犁地（dust.js 的 PLOW）：落在地上的那一頭（離刀根 inner～top，刀根在前緣後面 top）
   * 這一幀新蓋到的地面——頭一次是整截，之後是前緣走過的那一段——溝的左右兩緣（plowHalf）各注入一道塵，
   * 往外側推、往前帶一點，一團一團各自多快多濃（plowClump）。照段切開，每一段注入到自己那一片；
   * 底下的地板不在氣流那一層的
   * 地方（坑、台階）不揚。
   */
  _plow(g) {
    const from = g.plowed ?? Math.max(0, g.to - GUST.top + GUST.inner);
    if (g.to <= from) return;
    g.plowed = g.to;
    const side = [g.dirZ, 0, -g.dirX], half = plowHalf(g);
    for (const { k, i, a, b } of plowPieces(from, g.to)) {
      const pl = this._plowSheet(g, k), s = pl.sheet, rad = PLOW.width / (2 * s.half);
      for (const e of [-1, 1]) {
        const at = (d) => [g.x + g.dirX * d + side[0] * e * half, g.y, g.z + g.dirZ * d + side[2] * e * half];
        const mid = at((a + b) / 2);
        if (Math.abs(floorUnder(this.world.field.cols, mid[0], mid[2], g.y + 0.05) - g.y) > 0.04) continue;
        const cl = plowClump(i, e), p = PLOW.push * cl.push, c = DUST_DYE * PLOW.amount * cl.amount;
        const v = s.toTileVel([(side[0] * e + g.dirX * PLOW.ahead) * p, 0, (side[2] * e + g.dirZ * PLOW.ahead) * p]);
        this.fluid.splat(pl.tile, s.toTile(at(a)), s.toTile(at(b)), v, v, c, c, rad);
      }
      pl.tau = 0;
    }
  }

  /**
   * 這一道氣流第 k 段的那一片煙：還沒有就借一片、一格，平貼在那一段的地上（之後不動）。u 軸就是
   * 那一條的中線，犁開的那一條溝挖掉不畫（gap，plowHalf）。
   */
  _plowSheet(g, k) {
    let pl = this._plows.find((p) => p.g === g && p.k === k && this.fluid.owns(p.tile, p));
    if (pl) return pl;
    const sheet = this._sheet(), mid = (k + 0.5) * PLOW.seg;
    pl = { g, k, tau: 0, sheet };
    pl.tile = this.fluid.acquire(pl);
    sheet.place([g.x + g.dirX * mid, g.y + 0.03, g.z + g.dirZ * mid], [g.dirX, 0, g.dirZ], [g.dirZ, 0, -g.dirX],
      PLOW.seg / 2 + PLOW.margin, { ...DUST_LOOK, thick: PLOW.thick, gap: plowHalf(g) });
    this._plows.push(pl);
    return pl;
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
   * 落地：每一個踩地的身體（玩家、不會飛的怪物與屍體）上一幀在空中、這一幀站住了，就在
   * 腳下揚一團塵，多濃照體型與落地速度（dust.js）。殭屍王跳砸落地不算：那一下揚的是地震的塵。落地速度用上一幀的高度差算，
   * 不讀身上的 vy——殭屍王跳砸是一幀一幀直接擺位置的，vy 一直是 0；落地那一幀的
   * vy 也已經被歸零了。
   */
  _land(dt, player) {
    const bodies = [[player, 1]];
    for (const { m } of [...this.foes, ...this._corpses]) if (!KINDS[m.kind].fly) bodies.push([m, sizeOf(m.kind)]);
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

  /**
   * 地震的聲音往前一幀：震波走到哪一道、那一道的塵揚起來，就響一聲。先看再加 dt，跟
   * _quake 的塵同一個順序（打下去那一幀是第 0 秒），聲音與塵落在同一幀。
   */
  _rumble(dt) {
    this._rumbles = this._rumbles.filter((r) => {
      while (r.at.length && r.at[0] <= r.t) { r.at.shift(); this.sound.play(r.shape); }
      r.t += dt;
      return r.at.length > 0;
    });
  }

  /** 全部的劍光與塵收起來（回到站位、換陣容）；還沒響完的地震也不響了。 */
  _dropTrails() {
    for (const q of this._qis) { q.stop(); this._spare.push(q); }
    this._qis = [];
    this._blood.clear();
    this._phase = this.combo.phase;
    this._heard = this.combo.phase;
    this._rumbles = [];
    if (!this.fluid) return;
    for (const pf of this._puffs) this._endPuff(pf);
    for (const q of this._quakes) this._endPuff(q);
    for (const pl of this._plows) this._endPuff(pl);
    this._puffs = [];
    this._quakes = [];
    this._plows = [];
    this._stomps.length = 0;
    this._quiet.clear();
  }

  /** 右上那一行小字的戰鬥那幾段：每一隻怪物的血（BOSS 不寫，看血條，bossbar.js）與破防、連段在哪。 */
  status() {
    const foeLine = this.foes.filter(({ m }) => !m.by).map(({ m }) => `${KINDS[m.kind].name}${m.spawn.boss ? '' : ` 血 ${m.hp}/${KINDS[m.kind].hp}`}`
      + `${KINDS[m.kind].shields ? ` 盾 ${m.shields}/${KINDS[m.kind].shields}` : ''}${m.brood ? ` 召喚 ${m.brood}` : ''}`
      + `${m.deaths ? `（打死 ${m.deaths}）` : ''} 破防 ${m.breakT > 0 ? '中' : `${m.gauge}/${KINDS[m.kind].breakAt}`}`).join(' ・ ');
    const phase = `${PHASE_NAME[this.combo.phase]}${invulnerable(this.combo) ? '（無敵）' : ''}`;
    return { foeLine, phase };
  }
}
