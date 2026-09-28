/* ── test/src/mode-combat.js ────────────────────────────────────────
   /test/?mode=combat：戰鬥模式的組裝與操作。

   地形模式（mode-terrain.js） 拿掉地形之後剩下的東西：一塊黑牆圍起來
   的空地、那隻動物、第三人稱鏡頭、手把。走路、跳、鏡頭、手把的規則都
   不在這裡，是直接 import 試玩場那幾支——這一頁只多了戰鬥（combat.js）
   與一隻怪物（monster.js）。

   ── 場景一共幾個 draw call ───────────────────────────────────────
     地面      1
     黑牆      1（牆、頂、霧殼、牆腳漸層是同一個 mesh）
     動物      3（皮毛、臉、翻面的墨線外殼）
     刀        9（刀身、刀背、護手、刀柄、柄頭，除了刀背各自一份墨線殼）
     怪物      3（同上，另一份幾何）
     攻擊範圍  出招的那 0.2 秒 1；提示圈亮著的時候 1
     破防      破防中的每一隻 2（淡圓 + 亮圓）
     BOSS 技能 預告 2（淺色 + 亮色）；飛著的球每顆 1
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { toon } from './palette.js';
import { SURF, surfaceTextures } from './surface.js';
import { loadZoo } from './critter.js';
import { Pad } from './pad.js';
import { Hud } from './hud.js';
import { PHYS, solveXZ, supportInfo, steer } from './walk.js';
import { makeCam, snapCam, updateCam } from './camera.js';
import { buildVeil } from './veil.js';
import { Controls, speedFor, fitView, wardrobe } from './controls.js';
import {
  ARENA, COLS, SPAWN, MODES, DEFAULT_MODE, SWING, KNOCK_SCALE, DAMAGE, KINDS, BREAK_WINDOW, hurt, makeMonster,
  breaking, breakTarget, startBreak, breakContact, latch, spinStep, separate, placeMonster, monsterStep, bites, knock,
  inSlash, inFan, inRing, slashTip, fanFrame, makeCombo, comboStep, invulnerable, cueing,
} from './combat.js';
import { makeMonsterCritter } from './monster.js';
import { Blade } from './blade.js';
import { Mover } from './moves.js';
import {
  slashFx, fanFx, ringFx, cueFx, showFx, breakFx, showBreak, laneFx, showLane, orbMesh, circleFx, showCircle,
  coneFx, showCone,
} from './fx.js';
import { SKILL, makeWorld, bossStep, shotsStep, shotHits, strikeHits, laneLength } from './skills.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa28a6d, 42, 165);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 420);

/* 表面紋路：`?surf=0` 關掉，跟試玩場同一個開關。 */
const SURF_ON = new URLSearchParams(location.search).get('surf') !== '0';
if (SURF_ON) {
  const an = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  for (const t of surfaceTextures()) t.anisotropy = an;
}

/* 地面。試玩場那一片，只是這裡上面什麼都沒有。 */
const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), toon(0x6a5844, SURF_ON ? SURF.dirt : false));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.06;
scene.add(ground);

/* ── 黑牆 ────────────────────────────────────────────────────────
   veil.js 吐的那一份，材質照 mode-terrain.js 的 hazeMesh：純黑、透明度在
   頂點色的第四個分量、單面朝內。 */
{
  const v = buildVeil([ARENA]);
  const col = new Float32Array(v.alpha.length * 4);
  for (let i = 0; i < v.alpha.length; i++) col[i * 4 + 3] = v.alpha[i];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.computeBoundingSphere();
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, side: THREE.FrontSide,
    fog: false, depthWrite: false,
  })));
}

/* ── 動物 ────────────────────────────────────────────────────────
   玩家那一隻：試玩場的 Zoo，一樣換得了動物、毛色、帽子。 */
const zoo = await loadZoo({ look: 'dog-prick/yellow', height: 1.0 });
scene.add(zoo.root);
/** 咬在嘴裡的刀：掛在現在那一隻的頭上，換動物就跟著換過去。 */
const blade = new Blade();
blade.follow(zoo.active);
/** 出招的動作：照連段的狀態播，疊在步態與空中姿勢上面。 */
const mover = new Mover();

const player = {
  x: SPAWN.player.x, y: 0, z: SPAWN.player.z,
  vx: 0, vy: 0, vz: 0, grounded: true,
  aimX: 0, aimZ: -1,
};

/* 怪物：每一隻是「狀態」（combat.js 的 makeMonster）加上「外觀」（monster.js 的
   Critter 與破防的兩圈）。場上有哪幾隻由陣容決定（setMode），下面每一條規則都是
   對 foes 這張清單逐隻做的。

   外觀是每一類一個池子，換陣容的時候借用、多的藏起來：一隻 Critter 是一份自己的
   幾何，來回切陣容不該每次重建。 */
let foes = [];
const critters = { pool: new Map(), inkPx: null };
function lookFor(kind, i) {
  if (!critters.pool.has(kind)) critters.pool.set(kind, []);
  const list = critters.pool.get(kind);
  while (list.length <= i) {
    const slot = {
      critter: makeMonsterCritter(zoo, kind), breakFx: breakFx(),
      lane: laneFx(SKILL.orb.radius), circle: circleFx(SKILL.leap.radius), cone: coneFx(SKILL.cone.radius, SKILL.cone.half),
    };
    if (critters.inkPx) slot.critter.setInkPx(...critters.inkPx);
    scene.add(slot.critter.root, slot.breakFx.node, slot.lane.node, slot.circle.node, slot.cone.node);
    list.push(slot);
  }
  return list[i];
}
let mode = DEFAULT_MODE;

/* BOSS 放出來的球。規則在 skills.js，這裡只有外觀：一顆球一個 mesh，不夠就多做。 */
const world = makeWorld();
const orbs = [];
function syncOrbs() {
  while (orbs.length < world.shots.length) {
    const o = orbMesh(SKILL.orb.radius);
    scene.add(o);
    orbs.push(o);
  }
  orbs.forEach((o, i) => {
    const s = world.shots[i];
    o.visible = !!s;
    if (s) o.position.set(s.x, s.y, s.z);
  });
}

/** 被咬過幾次。 */
let deaths = 0;

/* 連段的狀態與每一段的高亮。 */
const combo = makeCombo();
const fxSlash = slashFx(), fxFan = fanFx(), fxRing = ringFx(), fxCue = cueFx();
scene.add(fxSlash.node, fxFan.node, fxRing.node, fxCue.node);

/** 這一幀在哪一段，它的範圍打不打得到怪物。第二段指著上一次第一段的末端點。 */
const REACHES = { slash: inSlash, rise: (p, m) => inFan(p, m, combo.tip), slam: inRing };

const cam = makeCam(0, 0);

/** 回到站位：玩家在中線 2/3、怪物在 1/3，都面向中心，鏡頭在玩家背後。 */
function resetStance() {
  const s = SPAWN.player;
  player.x = s.x; player.y = 0; player.z = s.z;
  player.vx = player.vy = player.vz = 0;
  player.grounded = true;
  player.aimX = Math.sin(s.yaw); player.aimZ = Math.cos(s.yaw);
  cam.yaw = s.yaw;
  snapCam(cam, player.x, player.z);
  for (const f of foes) {
    placeMonster(f.m);
    f.critter.setFacing(f.m.spawn.yaw);
  }
  Object.assign(combo, makeCombo());
  world.shots.length = 0;
}

/** 換陣容：借好每一隻的外觀、藏起用不到的，全部回到站位。 */
function setMode(id) {
  const md = MODES.find((x) => x.id === id);
  if (!md) return;
  mode = id;
  for (const list of critters.pool.values()) {
    for (const s of list) { s.critter.root.visible = false; s.breakFx.node.visible = false; s.lane.node.visible = false; s.circle.node.visible = false; s.cone.node.visible = false; }
  }
  const used = new Map();
  foes = md.monsters.map((s) => {
    const i = used.get(s.kind) || 0;
    used.set(s.kind, i + 1);
    const slot = lookFor(s.kind, i);
    slot.critter.root.visible = true;
    return { m: makeMonster(s), ...slot };
  });
  resetStance();
}

/* ── 外觀、HUD、操作 ──────────────────────────────────────────────
   輸入與版面在 controls.js（每個模式都一樣）；換了動物，刀跟著掛到新那一隻頭上。
   右邊那塊面板在地形模式是選地形，這裡借它選陣容：同一種按鈕、同一個「選中」的
   樣子、同一組數字鍵。這個模式自己的鍵：R 重新站位、1–4 陣容。 */
const looks = wardrobe(zoo, () => hud, () => blade.follow(zoo.active));
const hud = new Hud({
  zoo, blocks: MODES, onLook: looks.setLook, onHat: looks.toggleHat,
  onBlock: (id) => { setMode(id); hud.flash(MODES.find((x) => x.id === id).name); hud.paint({ block: id }); },
});
const pad = new Pad(document.getElementById('pad'));
const controls = new Controls(canvas, pad, cam, (k, e) => {
  if (looks.key(k, e)) return;
  if (k === 'r') { resetStance(); hud.flash('重新站位'); }
  if (k >= '1' && k <= '9' && MODES[+k - 1]) hud.o.onBlock(MODES[+k - 1].id);
});

/** 右上那一行小字：現在在連段的哪裡。 */
const PHASE_NAME = {
  idle: '待機', slash: '第一段', rest: '第一段收招', rise: '第二段', air: '第二段之後', leap: '第三段起跳', slam: '第三段落地',
  dash: '破防突進', spin: '破防迴旋', vault: '破防跳離',
};

/* ── 主迴圈 ──────────────────────────────────────────────────── */
let last = performance.now();
let fpsAcc = 0, fpsN = 0, hudAcc = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  pad.update(dt);

  const input = controls.axis();

  /* 連段決定這一下跳是什麼：普通的跳、某一段的出手，或是破防攻擊。站不站在
     地上看的是上一幀的結果，跟試玩場判斷能不能跳是同一個時間點。擺在操控
     之前，因為破防攻擊一發動就接管速度。 */
  const pressed = controls.jumpPressed();
  const target = breakTarget(player, foes.map((f) => f.m));
  const act = comboStep(combo, dt, {
    pressed, grounded: player.grounded, near: foes.some((f) => inSlash(player, f.m)),
    breakable: !!target,
  });
  if (act.start === 1) combo.tip = slashTip(player);
  if (act.brk) startBreak(combo, player, target);
  if (act.jump) {
    player.vy = PHYS.jump;
    player.grounded = false;
  }

  /* 操控。破防攻擊裡不操控：突進與跳離是拋物線，迴旋的位置由 spinStep 擺——
     steer 會把速度投影到搖桿的方向上，那一投影就把突進的速度吃掉了。 */
  if (!breaking(combo)) {
    const aim = controls.aim(input);
    if (aim) [player.aimX, player.aimZ] = aim;
    [player.vx, player.vz] = steer(player.vx, player.vz, player.aimX, player.aimZ, speedFor(input.mag), dt);
  }

  if (combo.phase !== 'spin') {
    // 水平：只有黑牆擋。
    [player.x, player.z] = solveXZ(COLS, player.x + player.vx * dt, player.z + player.vz * dt, player.y);

    // 垂直
    const prevY = player.y;
    player.vy -= PHYS.gravity * dt;
    player.y += player.vy * dt;
    const sup = supportInfo(COLS, player.x, player.z, prevY);
    if (player.y <= sup.y && player.vy <= 0) {
      player.y = sup.y;
      player.vy = 0;
      player.grounded = true;
    } else {
      player.grounded = false;
    }
  }

  /* 怪物追人（或是被擊退、在空中飛）。然後才判打中：兩個身體都走完這一幀
     了，範圍是對著畫面上的位置判的。 */
  // BOSS 先決定這一幀在不在放招（放招中 monsterStep 讓牠站著），球往前飛。
  const strikes = foes.map(({ m }) => bossStep(m, dt, player, world)).filter(Boolean);
  shotsStep(world, dt);
  for (const { m } of foes) monsterStep(m, dt, player);
  separate(foes.map((f) => f.m));
  // 破防攻擊：突進碰到目標就定住牠、進迴旋；迴旋轉完就扣血、跳離。
  if (combo.phase === 'dash' && breakContact(player, combo.target)) latch(combo, player, combo.target);
  if (combo.phase === 'spin') {
    const r = spinStep(combo, player, combo.target);
    if (r.died) hud.flash(`打死${KINDS[combo.target.kind].name}，牠在重生點重生`);
  }
  const reach = REACHES[combo.phase];
  for (const { m } of foes) {
    if (reach && !combo.hit.has(m) && reach(player, m)) {
      knock(m, player.x, player.z, player.aimX, player.aimZ, KNOCK_SCALE[combo.phase]);
      combo.hit.add(m);
      if (hurt(m, DAMAGE[combo.phase])) hud.flash(`打死${KINDS[m.kind].name}，牠在重生點重生`);
    }
  }
  /* 碰到玩家，玩家就死，雙方回到站位。被擊退、還沒落地的怪物不算；第三段
     起跳之後、落地之前的玩家也不算。 */
  /* BOSS 的技能也是碰到就死，規則跟被咬一樣（無敵的時候不算）。 */
  if (!invulnerable(combo)) {
    const bitten = foes.some((f) => bites(player, f.m));
    const shot = world.shots.some((s) => shotHits(s, player));
    const struck = strikes.some((st) => strikeHits(st, player));
    if (bitten || shot || struck) {
      deaths++;
      resetStance();
      hud.flash(bitten ? '被咬到了' : shot ? '被球打中了' : '被 BOSS 的招打中了');
    }
  }

  // 動物
  zoo.root.position.set(player.x, player.y, player.z);
  zoo.setFacing(Math.atan2(player.aimX, player.aimZ));
  const viewYaw = Math.atan2(camera.position.x - player.x, camera.position.z - player.z);
  zoo.update(dt, {
    speed: Math.hypot(player.vx, player.vz), grounded: player.grounded, vy: player.vy, viewYaw,
    move: mover.step(dt, combo.phase, combo.t),
  });
  blade.update();
  for (const { m, critter } of foes) {
    critter.root.position.set(m.x, m.y, m.z);
    critter.setFacing(Math.atan2(m.aimX, m.aimZ));
    // 會飛的一直是飄著的姿勢：不踩地、不走路。
    critter.update(dt, {
      speed: Math.hypot(m.vx, m.vz), grounded: m.grounded && !KINDS[m.kind].fly, vy: m.vy,
      viewYaw: Math.atan2(camera.position.x - m.x, camera.position.z - m.z),
    });
  }

  // 攻擊範圍的高亮：跟著玩家的腳與面向走。
  {
    const yaw = Math.atan2(player.aimX, player.aimZ);
    const lit = (phase) => (combo.phase === phase ? combo.t : Infinity);
    showFx(fxSlash, lit('slash'), SWING, player.x, player.y, player.z, yaw);
    if (combo.tip) {
      const fr = fanFrame(player, combo.tip);
      showFx(fxFan, lit('rise'), SWING, player.x, player.y, player.z, Math.atan2(fr.dirX, fr.dirZ), fr.a0);
    }
    showFx(fxRing, lit('slam'), SWING, player.x, player.y, player.z, yaw);
    // 提示圈不淡：亮著就是「現在按」。
    showFx(fxCue, cueing(combo) ? 0 : Infinity, 1, player.x, 0, player.z, 0);
  }

  // 相機
  {
    const rig = updateCam(cam, dt, player, ARENA, COLS);
    camera.position.set(rig.pos[0], rig.pos[1], rig.pos[2]);
    camera.lookAt(rig.look[0], rig.look[1], rig.look[2]);
  }

  // BOSS 的預告與飛著的球。
  for (const { m, lane, circle, cone } of foes) {
    const c = m.cast;
    const orb = !!c && c.skill === 'orb', leap = !!c && c.skill === 'leap', fan = !!c && c.skill === 'cone';
    showLane(lane, orb, orb ? Math.min(1, c.t / SKILL.orb.windup) : 0, m.x, m.z,
      orb ? Math.atan2(c.dirX, c.dirZ) : 0, orb ? laneLength(m.x, m.z, c.dirX, c.dirZ) : 0);
    showCircle(circle, leap, leap ? Math.min(1, c.t / SKILL.leap.windup) : 0, leap ? c.tx : 0, leap ? c.tz : 0);
    showCone(cone, fan, fan ? Math.min(1, c.t / SKILL.cone.windup) : 0, m.x, m.z, fan ? Math.atan2(c.dirX, c.dirZ) : 0);
  }
  syncOrbs();

  // 破防的兩圈：套在怪物身體的中間，正對這一幀的鏡頭。
  for (const { m, breakFx: bf } of foes) {
    showBreak(bf, m.breakT / BREAK_WINDOW, m.x, m.y + PHYS.height / 2, m.z, camera.quaternion);
  }

  renderer.render(scene, camera);
  pad.draw();

  fpsAcc += dt; fpsN++; hudAcc += dt;
  let line = null;
  if (hudAcc > 0.25) {
    const foeLine = foes.map(({ m }) => `${KINDS[m.kind].name} 血 ${m.hp}/${KINDS[m.kind].hp}`
      + `${m.deaths ? `（打死 ${m.deaths}）` : ''} 破防 ${m.breakT > 0 ? '中' : `${m.gauge}/${KINDS[m.kind].breakAt}`}`).join(' ・ ');
    line = `${Math.round(fpsN / fpsAcc)} fps ・ 被咬 ${deaths} 次 ・ ${foeLine} ・ `
      + `${PHASE_NAME[combo.phase]}${invulnerable(combo) ? '（無敵）' : ''} ・ `
      + `x ${player.x.toFixed(1)} y ${player.y.toFixed(1)} z ${player.z.toFixed(1)}`;
    fpsAcc = 0; fpsN = 0; hudAcc = 0;
  }
  hud.tick(dt, line);
  requestAnimationFrame(frame);
}

/* 墨線：玩家那一隻，加上池子裡每一隻怪物（之後才借出去的也要，所以記在 critters.inkPx）。 */
fitView({
  renderer, camera, pad, hud,
  ink: (px, h) => {
    zoo.setInkPx(px, h);
    critters.inkPx = [px, h];
    for (const list of critters.pool.values()) for (const s of list) s.critter.setInkPx(px, h);
  },
});

document.getElementById('boot').remove();
setMode(DEFAULT_MODE);
hud.paint({ block: DEFAULT_MODE });
requestAnimationFrame(frame);

// 給主控台一個把手，方便手動看東西。foes 會隨陣容換掉，所以是 getter。
window.combatArea = {
  scene, camera, renderer, zoo, blade, mover, player, combo, cam, pad, hud, resetStance, setMode,
  get foes() { return foes; },
  get monster() { return foes[0].m; },
  get mode() { return mode; },
};
