/* ── test/src/stage.js ───────────────────────────────────────────────
   遺跡的場景：地面、砌體與墨線、門、路標、傳送範圍的線框、黑牆、火焰。

   地形模式與完整流程模式都站在這一片遺跡上，所以它從地形模式的主程式裡
   搬出來，自己一支：`buildStage` 把東西放進場景，回報碰撞、門的狀態、
   開關門的那一支與每幀要叫的 `animate`。玩家、相機、HUD 都不在這裡——
   那是每個模式自己的事。

   門的狀態（`doors`，id → 開著嗎）是執行時的，一開始照名冊上的 `open`；
   換狀態一律走 `setDoor`，門扇、路標、感測區的線框才會一起換。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { C, toonVC, toon, glow, inkLine } from './palette.js';
import { SURF, surfaceTextures } from './surface.js';
import { buildRuins } from './blocks.js';
import { facet } from './geom.js';
import { arenaGap } from './walk.js';
import { buildVeil } from './veil.js';

/** 黑牆與黑霧的 mesh：veil.js 吐的那一份，或門洞裡的那幾層（同一種資料）。 */
export function hazeMesh(v) {
  /* 純黑，不是調色盤的 C.fog（#1e1810）——牆要黑，而 #1e1810 在暖色的
     天光下看起來是深褐色的一塊布。顏色在這裡而不在 veil.js，因為 sRGB
     到線性的轉換是 three 的事。 */
  const c = new THREE.Color(0x000000);
  const col = new Float32Array(v.alpha.length * 4);
  for (let i = 0; i < v.alpha.length; i++) {
    col[i * 4] = c.r; col[i * 4 + 1] = c.g; col[i * 4 + 2] = c.b;
    col[i * 4 + 3] = v.alpha[i];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v.pos, 3));
  // 四個分量：透明度靠頂點色帶著走，所以整圈黑牆加黑霧是一個 draw。
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.computeBoundingSphere();
  /* 單面，法線朝內。這不是省一半的填色率而已——雙面的話，玩家走進霧殼
     與牆之間那一公尺時，那層霧會跑到鏡頭前面，整個畫面被染暗一次。 */
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, side: THREE.FrontSide,
    fog: false, depthWrite: false,
  }));
}

/**
 * 砌出整片遺跡、放進場景。
 *
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer 表面紋路的各向異性過濾要問它
 */
export function buildStage(scene, renderer) {
  /* ── 沒有天空 ────────────────────────────────────────────────────
     四個場地都被黑牆封了頂（見 veil.js），所以天空一片都看不到——這一頁
     以前有一顆從裡面看的漸層球，現在拿掉了：畫一個永遠看不到的東西不如
     不畫。清除色是黑的，所以萬一哪裡有縫，露出來的也是同一個黑。

     之後要做天井房（不封頂）的話，那顆球在 git 裡（`git log -S sky`）。
     ------------------------------------------------------------------ */

  /* ── 沒有燈 ──────────────────────────────────────────────────────
     場景裡一顆 three 的燈都沒有：石頭的五階調與狗的三階調都是材質自己
     算的（palette.js 的 banded、critter.js 的 FUR_FRAG），兩邊讀的是同一
     個方向 palette.js 的 KEY_POS。加一盞 three 的燈在這裡不會亮任何東西，
     只會讓人以為光是它給的。
     ------------------------------------------------------------------ */

  /* ── 表面紋路開不開 ──────────────────────────────────────────────
     `?surf=0` 關掉石紋與木紋（貼圖不算、著色器不接），其他一模一樣——
     同一台手機上開關各看一次 fps，就是紋路的成本。烘在頂點色裡的那一層
     （逐塊深淺、牆根）不受影響：那一層在載入時就算完了，每幀不花任何東西。 */
  const SURF_ON = new URLSearchParams(location.search).get('surf') !== '0';
  if (SURF_ON) {
    /* 各向異性過濾：地板是斜著看的，沒有它的話幾公尺外的石板紋路就糊成一片。
       開到 4 就夠——再高，手機上多花的填色率換不到看得出來的差別。 */
    const an = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    for (const t of surfaceTextures()) t.anisotropy = an;
  }

  /* 地面。石板鋪面比它高 0.06，所以不會打架。 */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), toon(0x6a5844, SURF_ON ? SURF.dirt : false));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  scene.add(ground);

  /* ── 廢墟 ────────────────────────────────────────────────────── */
  const ruins = buildRuins();
  const stoneMat = toonVC({ surf: SURF_ON }), inkMat = inkLine();
  scene.add(new THREE.Mesh(ruins.geometry, stoneMat), new THREE.LineSegments(ruins.ink, inkMat));
  const COLS = ruins.colliders;

  /* ── 門 ──────────────────────────────────────────────────────────
     每一扇門的狀態（blocks.js `DOORS` 的 id → 開著嗎）是執行時的，一開始照
     名冊上的 `open`。兩種狀態的門扇都砌好了，各自一個 mesh，換狀態只換哪一個看得到；
     感測區認不認得這一組門也看這一份（walk.js 的 portalAt）。 */
  const doors = { ...ruins.doors };
  const doorMeshes = ruins.pieces.map((q) => {
    const g = new THREE.Group();
    if (q.geometry.attributes.position.count) g.add(new THREE.Mesh(q.geometry, stoneMat));
    if (q.ink.attributes.position.count) g.add(new THREE.LineSegments(q.ink, inkMat));
    // 開著的門洞裡那幾層黑霧：跟黑牆同一種材質，所以門洞的盡頭跟黑牆是同一個黑。
    if (q.haze.alpha.length) g.add(hazeMesh(q.haze));
    scene.add(g);
    return { node: g, door: q.door, open: q.open };
  });
  /* ── 路標 ────────────────────────────────────────────────────────
     懸浮在門口的一行字（blocks.js 的 `sign`），一張永遠朝著鏡頭的字卡。屬於
     一組門：那一組門開著才看得到——沒有門扇的門就靠它說「這裡走得過去」。
     字是金色（跟面板的 accent2 同一個）描一圈深褐，不吃霧：黑牆前面的拱洞
     是全場最暗的地方，路標要在那裡讀得出來。 */
  const SIGN_H = 0.55;                 // 字卡高幾公尺（字高約六成）
  function signSprite(text) {
    const px = 72, pad = px * 0.5;
    const font = `600 ${px}px system-ui, "Noto Sans TC", sans-serif`;
    const c = document.createElement('canvas');
    let g = c.getContext('2d');
    g.font = font;
    c.width = Math.ceil(g.measureText(text).width + pad * 2);
    c.height = Math.round(px * 1.6);
    g = c.getContext('2d');            // 改了尺寸，畫布的狀態全部重設
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = px * 0.2;
    g.strokeStyle = '#1e1810';
    g.strokeText(text, c.width / 2, c.height / 2);
    g.fillStyle = '#f2c14e';
    g.fillText(text, c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    sp.scale.set(SIGN_H * (c.width / c.height), SIGN_H, 1);
    /* 排在所有半透明的東西之後畫。黑牆與黑霧是同一個 mesh、原點在世界的原點，
       three 照原點的遠近排半透明物件，於是它常常排在路標後面畫——路標不寫深度，
       後畫的那一片黑就整個蓋上來，只剩被鐵閘柵條擋住的那幾條縫露得出字。 */
    sp.renderOrder = 1;
    return sp;
  }
  const signs = ruins.signs.map((s) => {
    const node = signSprite(s.text);
    node.position.set(s.x, s.y, s.z);
    scene.add(node);
    return { node, door: s.door, y: s.y, phase: s.x * 0.37 + s.z * 0.23 };
  });

  /* ── 傳送範圍（P）────────────────────────────────────────────────
     每一個感測區的觸發範圍畫成一個線框：方的是一個盒子，圓的是上下兩圈加四根直線。
     亮金色是現在走進去會被送走的（沒有門，或門開著），暗灰色是門關著的。線框不吃
     深度，隔著牆也看得到——這是調傳送點用的，不是遊戲的一部分，所以一開始關著。 */
  const portalLines = (() => {
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);
    const lit = new THREE.LineBasicMaterial({ color: 0xf2c14e, depthTest: false, fog: false });
    const dim = new THREE.LineBasicMaterial({ color: 0x6b655c, depthTest: false, fog: false });
    const items = ruins.portals.map((p) => {
      const v = [];
      const seg = (a, b) => v.push(...a, ...b);
      if (p.shape === 'box') {
        const xs = [p.x0, p.x1], zs = [p.z0, p.z1];
        for (const y of [p.y0, p.y1]) {
          seg([p.x0, y, p.z0], [p.x1, y, p.z0]); seg([p.x1, y, p.z0], [p.x1, y, p.z1]);
          seg([p.x1, y, p.z1], [p.x0, y, p.z1]); seg([p.x0, y, p.z1], [p.x0, y, p.z0]);
        }
        for (const x of xs) for (const z of zs) seg([x, p.y0, z], [x, p.y1, z]);
      } else {
        const N = 32, at = (k, y) => [p.x + Math.cos((k / N) * Math.PI * 2) * p.r, y, p.z + Math.sin((k / N) * Math.PI * 2) * p.r];
        for (const y of [p.y0, p.y1]) for (let k = 0; k < N; k++) seg(at(k, y), at(k + 1, y));
        for (let k = 0; k < N; k += N / 4) seg(at(k, p.y0), at(k, p.y1));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      const line = new THREE.LineSegments(g, lit);
      line.renderOrder = 2;
      group.add(line);
      return { line, door: p.door };
    });
    const paint = () => { for (const it of items) it.line.material = !it.door || doors[it.door] ? lit : dim; };
    return { group, paint };
  })();

  function setDoor(group, open) {
    doors[group] = open;
    for (const m of doorMeshes) if (m.door === group) m.node.visible = m.open === open;
    for (const s of signs) if (s.door === group) s.node.visible = open;
    portalLines.paint();
  }

  /** P：傳送範圍的線框，開或關。回報現在看不看得到。 */
  function togglePortalLines() {
    portalLines.group.visible = !portalLines.group.visible;
    return portalLines.group.visible;
  }
  for (const g of Object.keys(doors)) setDoor(g, doors[g]);

  /* ── 黑牆 ────────────────────────────────────────────────────────
     形狀、尺寸、高度與黑霧的層次全部在 veil.js（那一支只吐頂點與透明度，
     而且它算得對不對 node 驗得出來——三角形的繞向錯了，單面材質會把整片
     剔掉，畫面上是「黑牆沒出現」，跟「還沒做」長得一模一樣）。

     這裡只負責把那份資料變成一個 mesh：一顆材質、一個 draw。
     ------------------------------------------------------------------ */
  scene.add(hazeMesh(buildVeil(ruins.arenas)));

  /** 站在哪個場地裡。取「離邊界最裡面」的那一個——四個場地互不重疊。 */
  function arenaAt(x, z) {
    let best = ruins.arenas[0], bg = -Infinity;
    for (const a of ruins.arenas) {
      const g = arenaGap(a, x, z);
      if (g > bg) { bg = g; best = a; }
    }
    return best;
  }

  /* 火焰。一份幾何、一顆材質，逐盆一個 mesh——它們要各自抖，所以不能合併。
     抖法是三個不成比例的正弦相加（3.1／5.7／11.3 Hz），沒有一個週期看得
     出來；火焰同時是唯一一個不吃霧的東西，遠處那幾點才亮得起來。 */
  const flameGeo = facet(new THREE.ConeGeometry(0.3, 0.72, 7, 1));
  const flameMat = glow(C.flame);
  flameMat.fog = false;
  const coreMat = glow(C.flameCore);
  coreMat.fog = false;
  const flames = ruins.flames.map((f) => {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(flameGeo, flameMat);
    const core = new THREE.Mesh(flameGeo, coreMat);
    core.scale.set(0.5, 0.62, 0.5);
    core.position.y = -0.06;
    g.add(outer, core);
    g.position.set(f.x, f.y + 0.32 * f.s, f.z);
    g.scale.setScalar(f.s);
    scene.add(g);
    return { node: g, outer, base: f.s, phase: Math.random() * 9 };
  });

  /** 每幀：火焰抖、路標浮。 */
  function animate(now) {
    for (const f of flames) {
      const t = now / 1000 + f.phase;
      const w = 1
        + Math.sin(t * 3.1) * 0.10
        + Math.sin(t * 5.7) * 0.06
        + Math.sin(t * 11.3) * 0.035;
      f.node.scale.set(f.base, f.base * w * 1.05, f.base);
      f.outer.rotation.y = t * 1.4;
      f.outer.position.y = (w - 1) * 0.2;
    }
    // 路標浮著：上下晃五公分，兩秒多一個來回，每一塊的相位不同。
    for (const sg of signs) sg.node.position.y = sg.y + Math.sin(now / 1000 * 2.6 + sg.phase) * 0.05;
  }

  return { ruins, cols: COLS, doors, setDoor, togglePortalLines, arenaAt, animate, surf: SURF_ON };
}
