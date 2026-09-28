/* ── test/src/mode-combat.js ────────────────────────────────────────
   /test/?mode=combat：戰鬥模式的組裝與操作。

   地形模式（mode-terrain.js）拿掉地形之後剩下的東西：一塊黑牆圍起來
   的空地、那隻動物、第三人稱鏡頭、手把。走路、跳、鏡頭、手把的規則都
   不在這裡，是直接 import 試玩場那幾支——這一頁只多了戰鬥：規則在 combat.js
   與 skills.js，接到迴圈上、擺外觀的是 fight.js（完整流程模式用的同一份）。

   ── 場景一共幾個 draw call ───────────────────────────────────────
     地面      1
     黑牆      1（牆、頂、霧殼、牆腳漸層是同一個 mesh）
     動物      3（皮毛、臉、翻面的墨線外殼）
     刀        9（刀身、刀背、護手、刀柄、柄頭，除了刀背各自一份墨線殼）
     怪物      3（同上，另一份幾何）
     劍氣      每一道 2（煙的兩層），掃完淡掉之前都在；流體場醒著的時候另外
               14 個畫到貼圖上的 pass（fluid.js）。`?fluid=0` 是以前的高亮：
               出招的那 0.2 秒 1
     粉塵      落地揚起的每一團 2（同上），一秒上下；跟劍氣共用同一個流體場，
               pass 數不因為多一團塵而增加
     提示圈    亮著的時候 1
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
import { hazeMesh } from './stage.js';
import { Controls, speedFor, fitView, wardrobe } from './controls.js';
import { ARENA, COLS, SPAWN, MODES, DEFAULT_MODE, KINDS, resetLife, refill } from './combat.js';
import { Fight, DEATH_TEXT } from './fight.js';

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
   veil.js 吐的那一份，mesh 是 stage.js 的 hazeMesh（遺跡的黑牆是同一種）。 */
scene.add(hazeMesh(buildVeil([ARENA])));

/* ── 動物 ────────────────────────────────────────────────────────
   玩家那一隻：試玩場的 Zoo，一樣換得了動物、毛色、帽子。 */
const zoo = await loadZoo({ look: 'dog-prick/yellow', height: 1.0 });
scene.add(zoo.root);

const player = {
  x: SPAWN.player.x, y: 0, z: SPAWN.player.z,
  vx: 0, vy: 0, vz: 0, grounded: true,
  aimX: 0, aimZ: -1,
};
resetLife(player);

/* 戰鬥：怪物、連段、打中與被打中、刀。場上有哪幾隻由陣容決定（setMode）；
   這一頁打死的怪物在牠的重生點重生。 */
const fight = new Fight(scene, zoo, { respawn: true, renderer });
let mode = DEFAULT_MODE;

/** 倒下（血扣光）過幾次。 */
let deaths = 0;

const cam = makeCam(0, 0);

/** 回到站位：玩家在中線 2/3、怪物在 1/3，都面向中心，鏡頭在玩家背後。血補滿（撿到的最大血量留著）。 */
function resetStance() {
  const s = SPAWN.player;
  refill(player);
  player.x = s.x; player.y = 0; player.z = s.z;
  player.vx = player.vy = player.vz = 0;
  player.grounded = true;
  player.aimX = Math.sin(s.yaw); player.aimZ = Math.cos(s.yaw);
  cam.yaw = s.yaw;
  snapCam(cam, player.x, player.z);
  fight.reset();
}

/** 換陣容：換一批怪物上場，全部回到站位。 */
function setMode(id) {
  const md = MODES.find((x) => x.id === id);
  if (!md) return;
  mode = id;
  fight.lineup(md.monsters);
  resetStance();
}

/* ── 外觀、HUD、操作 ──────────────────────────────────────────────
   輸入與版面在 controls.js（每個模式都一樣）；換了動物，刀跟著掛到新那一隻頭上。
   右邊那塊面板在地形模式是選地形，這裡借它選陣容：同一種按鈕、同一個「選中」的
   樣子、同一組數字鍵。這個模式自己的鍵：R 重新站位、1–4 陣容。 */
const looks = wardrobe(zoo, () => hud, () => fight.follow());
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

/* ── 主迴圈 ──────────────────────────────────────────────────── */
let last = performance.now();
let fpsAcc = 0, fpsN = 0, hudAcc = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  pad.update(dt);

  const input = controls.axis();
  fight.lead(dt, player, controls.jumpPressed());

  /* 操控。破防攻擊裡不操控：突進與跳離是拋物線，迴旋的位置由 spinStep 擺——
     steer 會把速度投影到搖桿的方向上，那一投影就把突進的速度吃掉了。 */
  if (!fight.breaking) {
    const aim = controls.aim(input);
    if (aim) [player.aimX, player.aimZ] = aim;
    [player.vx, player.vz] = steer(player.vx, player.vz, player.aimX, player.aimZ, speedFor(input.mag), dt);
  }

  if (!fight.spinning) {
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

  /* 怪物與打中。挨一下扣血；血扣光了雙方回到站位。打死的怪物在牠的重生點重生。 */
  const { hit, died, kills, souls } = fight.resolve(dt, player);
  for (const k of kills) hud.flash(`打死${KINDS[k].name}，牠在重生點重生${KINDS[k].soul ? '，掉出一顆靈魂' : ''}`);
  if (souls) hud.flash(`撿到靈魂，最大血量 +${souls}`);
  if (died) {
    deaths++;
    resetStance();
    hud.flash(`${DEATH_TEXT[died]}——血扣光了，回到站位`);
  } else if (hit) hud.flash(`${DEATH_TEXT[hit.cause]}，扣 ${hit.dmg} 點血`);

  // 動物
  zoo.root.position.set(player.x, player.y, player.z);
  zoo.setFacing(fight.faceYaw(player));
  const viewYaw = Math.atan2(camera.position.x - player.x, camera.position.z - player.z);
  zoo.update(dt, {
    speed: Math.hypot(player.vx, player.vz), grounded: player.grounded, vy: player.vy, viewYaw,
    move: fight.move(dt),
  });

  // 相機
  {
    const rig = updateCam(cam, dt, player, ARENA, COLS);
    camera.position.set(rig.pos[0], rig.pos[1], rig.pos[2]);
    camera.lookAt(rig.look[0], rig.look[1], rig.look[2]);
  }

  fight.draw(dt, camera, player);
  renderer.render(scene, camera);
  pad.draw();

  fpsAcc += dt; fpsN++; hudAcc += dt;
  let line = null;
  if (hudAcc > 0.25) {
    const st = fight.status();
    line = `${Math.round(fpsN / fpsAcc)} fps ・ 血 ${player.hp}/${player.max} ・ 倒下 ${deaths} 次 ・ ${st.foeLine} ・ ${st.phase} ・ `
      + `x ${player.x.toFixed(1)} y ${player.y.toFixed(1)} z ${player.z.toFixed(1)}`;
    fpsAcc = 0; fpsN = 0; hudAcc = 0;
  }
  hud.tick(dt, line);
  requestAnimationFrame(frame);
}

/* 墨線：玩家那一隻，加上場上的怪物。 */
fitView({
  renderer, camera, pad, hud,
  ink: (px, h) => { zoo.setInkPx(px, h); fight.setInkPx(px, h); },
});

document.getElementById('boot').remove();
setMode(DEFAULT_MODE);
hud.paint({ block: DEFAULT_MODE });
requestAnimationFrame(frame);

// 給主控台一個把手，方便手動看東西。foes 會隨陣容換掉，所以是 getter。
window.combatArea = {
  scene, camera, renderer, zoo, fight, player, cam, pad, hud, resetStance, setMode,
  get blade() { return fight.blade; },
  get mover() { return fight.mover; },
  get combo() { return fight.combo; },
  get foes() { return fight.foes; },
  get monster() { return fight.foes[0].m; },
  get mode() { return mode; },
};
