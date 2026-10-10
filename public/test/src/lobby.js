/* ── test/src/lobby.js ───────────────────────────────────────────────
   完整遊戲的開始畫面（mode-flow.js 的 GAME）。只在載入頁面（F5）的時候出現，按開始之後就
   不再回來——重玩就是重新整理。

   版面照 2D 跑酷的開始選單：畫面正中間一張卡片，卡片底下兩樣東西——

     窗口   上面那一格正方形，像漫畫的一格（墨線框、紙色的底），裡面是主角。所有造型排成
            一張表：同一種動物的每一件毛色排成橫的一列，同一欄的每一種動物排成直的一行。
            左右拖是沿著那一列看毛色，上下拖是沿著那一行看物種；一次只動一個軸（按下去之後
            先動得多的那一軸說了算）。放開就滑到最近的那一隻停下（甩得快就往甩的方向多走
            一隻），停在哪一隻就是選了哪一隻。拖的時候只畫正在動的那一軸，停下來才兩軸都畫，
            旁邊那幾隻在窗口的邊上露出一截。帽子一直戴著，不能選。鍵盤是方向鍵。
     START  底下那顆鍵（2D 那顆「開始跑」的樣子：綠色、底下一條唇邊）。Enter 或空白也算。

   卡片本身是一頁漫畫的紙（跟 story.js 的書頁同一種紙：米色、四邊壓暗、細細的紙紋）。

   ── 背景 ──────────────────────────────────────────────────────────
   遊戲那一片照常畫（同一個 renderer、同一套光影），只是鏡頭換成 `aimBackdrop`：站在中庭的
   正中間、四個狗高那麼高，低頭斜斜地往下看，慢慢繞著轉。整張畫布由 CSS 糊掉（index.html 的
   body.lobby）。

   窗口裡的每一隻是另外建的（monster.js 也是這樣建怪物的：同一份模型資料、各自一件毛色），
   畫在窗口自己那一張畫布上。選好的那一件交給遊戲的 zoo（mode-flow.js），開始的時候遊戲裡就是
   那一隻。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { Critter } from './critter.js';
import { DOG_H } from './combat.js';

/**
 * 背景的鏡頭：在 (x, z) 那一點的正上方 eye 公尺，往下 pitch（弧度）看，每秒繞 spin（弧度）。
 */
export const BACKDROP = { eye: 4 * DOG_H, pitch: 0.5, spin: 0.06 };

/**
 * 窗口（公尺；一隻約 1 公尺高）。
 *   fov, half   垂直視角（度）；窗口的半邊看得到多寬——比一隻的半寬大一點，鄰居才露得出一截
 *   gap         表上相鄰兩隻隔多遠（橫的、直的一樣）
 *   mid         窗口中心對著一隻的多高（大約是牠的腰）
 *   rest        面向哪裡（0 是正對鏡頭，正的往畫面右邊轉，四分之三側面）
 *   lock        按下去之後動了幾像素才決定是哪一軸
 *   flick       放開那一刻多快（每秒幾個 gap）算「甩」：往甩的方向多走一隻
 *   snap        滑到停下的快慢（每秒的收斂率）
 *   rubber      拖過頭（第一隻之前、最後一隻之後）只跟手這麼多
 */
export const LOBBY = {
  fov: 30, half: 0.95, gap: 1.3, mid: 0.5, rest: 0.5,
  lock: 6, flick: 1.2, snap: 14, rubber: 0.35,
};

/** 背景的鏡頭擺到 (cx, cz) 上方，繞了 t 秒。 */
export function aimBackdrop(camera, t, cx, cz) {
  const yaw = t * BACKDROP.spin;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const down = Math.tan(BACKDROP.pitch);
  camera.position.set(cx, BACKDROP.eye, cz);
  camera.lookAt(cx + fx, BACKDROP.eye - down, cz + fz);
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 拖過頭的那一段打折：表的範圍 [0, n − 1] 外面只跟手 rubber 倍。 */
function rubber(u, n) {
  if (u < 0) return u * LOBBY.rubber;
  if (u > n - 1) return n - 1 + (u - n + 1) * LOBBY.rubber;
  return u;
}

/* 每一隻腳下的影子：一團往外淡掉的黑。 */
const SHADOW_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SHADOW_FRAG = /* glsl */`
varying vec2 vUv;
void main() {
  float r = length((vUv - 0.5) * 2.0);
  gl_FragColor = vec4(0.17, 0.14, 0.12, 0.35 * smoothstep(1.0, 0.2, r));
}`;

export class Lobby {
  /**
   * @param {object} o
   *   zoo      mode-flow.js 的那一群動物：表從它的名冊排，選好的那一件換給它
   *   view     窗口那一張畫布（#lobby-view）
   *   start    START 鍵（#start）
   *   onStart  按了開始
   */
  constructor(o) {
    this.o = o;
    this.zoo = o.zoo;
    this.view = o.view;
    this.renderer = new THREE.WebGLRenderer({ canvas: o.view, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(LOBBY.fov, 1, 0.1, 60);
    this.dist = LOBBY.half / Math.tan((LOBBY.fov * Math.PI) / 360);

    /* 表：一行一種動物（zoo.models 的順序），一列一件毛色。每一格一隻，腳下一團影子。 */
    const shadowGeo = new THREE.PlaneGeometry(0.95, 0.6);
    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false,
    });
    this.shadowGeo = shadowGeo;
    this.rows = this.zoo.models.map((model) => {
      const own = this.zoo.critters.get(model);
      return own.skins.map((skin) => {
        const c = new Critter(own.data, model, { height: own.height, skin });
        c.setHat(true);
        c.setFacing(LOBBY.rest);
        const sh = new THREE.Mesh(shadowGeo, this.shadowMat);
        sh.rotation.x = -Math.PI / 2;
        sh.position.y = 0.002;
        c.root.add(sh);
        c.root.visible = false;
        this.scene.add(c.root);
        return { look: `${model}/${skin}`, critter: c };
      });
    });

    /* 現在停在哪一格（r 行 c 列），與窗口正對著的連續位置（u 沿著列、v 沿著行，單位是格）。 */
    const at = this._find(this.zoo.look);
    this.r = at.r; this.c = at.c;
    this.u = this.c; this.v = this.r;
    /** 正在動的那一軸：null（停著）、'h'（毛色）、'v'（物種）。 */
    this.axis = null;
    /** 放開之後要滑到的那一格（沿著 axis）；null = 手還按著或停著。 */
    this.goal = null;
    this.drag = null;

    this._fit = () => this.fit();
    addEventListener('resize', this._fit);
    this.fit();

    this._down = (e) => {
      if (this.drag) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, u: this.u, v: this.v, t: performance.now(), vel: 0, last: null };
      this.goal = null;
      try { this.view.setPointerCapture(e.pointerId); } catch { /* 沒有就算了 */ }
    };
    this._move = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!this.axis) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < LOBBY.lock) return;
        this.axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      }
      // 內容跟著手指走：往左拖，窗口往右看（下一件）；往上拖，窗口往下看（下一種）。
      const k = this._perPx / LOBBY.gap;
      const now = performance.now();
      const pos = this.axis === 'h' ? d.u - dx * k : d.v - dy * k;
      if (d.last) {
        const dt = Math.max(1, now - d.last.t) / 1000;
        d.vel = d.vel * 0.6 + ((pos - d.last.pos) / dt) * 0.4;
      }
      d.last = { t: now, pos };
      const n = this.axis === 'h' ? this.rows[this.r].length : this.rows.length;
      if (this.axis === 'h') this.u = rubber(pos, n);
      else this.v = rubber(pos, n);
    };
    this._up = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      if (!this.axis) return;
      const pos = this.axis === 'h' ? this.u : this.v;
      const from = this.axis === 'h' ? this.c : this.r;
      const n = this.axis === 'h' ? this.rows[this.r].length : this.rows.length;
      let to = Math.round(pos);
      // 甩：往甩的方向至少走一隻（原本就要走過去的不再多加）。手停住一下才放開的不算甩。
      const vel = d.last && performance.now() - d.last.t < 100 ? d.vel : 0;
      if (Math.abs(vel) > LOBBY.flick && to === from) to = from + Math.sign(vel);
      this.goal = clamp(to, 0, n - 1);
    };
    this.view.addEventListener('pointerdown', this._down);
    this.view.addEventListener('pointermove', this._move);
    this.view.addEventListener('pointerup', this._up);
    this.view.addEventListener('pointercancel', this._up);

    this._key = (e) => {
      if (e.repeat) return;
      const k = e.key;
      if (k === 'ArrowLeft') this.step('h', -1);
      else if (k === 'ArrowRight') this.step('h', 1);
      else if (k === 'ArrowUp') this.step('v', -1);
      else if (k === 'ArrowDown') this.step('v', 1);
      else if (k === 'Enter' || k === ' ') this.o.onStart();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', this._key);
    this._click = () => this.o.onStart();
    o.start.addEventListener('click', this._click);
  }

  /** look 在表上的哪一格（找不到就是第一格）。 */
  _find(look) {
    for (let r = 0; r < this.rows.length; r++) {
      const c = this.rows[r].findIndex((x) => x.look === look);
      if (c >= 0) return { r, c };
    }
    return { r: 0, c: 0 };
  }

  /** 第 i 行裡對著第 c 列的那一隻：那一種毛色比較少的話取最後一件。 */
  _cell(i, c) { const row = this.rows[i]; return row[Math.min(c, row.length - 1)]; }

  /** 鍵盤：沿著 axis 走一格。正在滑另一軸的話先不理。 */
  step(axis, n) {
    if (this.drag || (this.axis && this.axis !== axis)) return;
    const from = this.goal ?? (axis === 'h' ? this.c : this.r);
    const len = axis === 'h' ? this.rows[this.r].length : this.rows.length;
    this.axis = axis;
    this.goal = clamp(from + n, 0, len - 1);
  }

  /** 窗口大小變了：畫布、一個像素是多少公尺、墨線多粗。 */
  fit() {
    const w = this.view.clientWidth || 1, h = this.view.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._perPx = (2 * LOBBY.half) / h;
    const dpr = this.renderer.getPixelRatio();
    for (const row of this.rows) for (const x of row) x.critter.setInkPx(2.0, h * dpr);
  }

  /** 現在選的是哪一件：停著的那一格，滑著的話是要停的那一格。 */
  get look() {
    if (this.goal === null) return this.rows[this.r][this.c].look;
    return this.axis === 'h' ? this.rows[this.r][this.goal].look : this._cell(this.goal, this.c).look;
  }

  /** 往前 dt 秒（真實時間）：滑到停、擺位置、每一隻的待機動作。 */
  update(dt) {
    if (this.goal !== null) {
      const k = 1 - Math.exp(-LOBBY.snap * dt);
      const key = this.axis === 'h' ? 'u' : 'v';
      this[key] += (this.goal - this[key]) * k;
      if (Math.abs(this.goal - this[key]) < 0.002) {
        this[key] = this.goal;
        if (this.axis === 'h') this.c = this.goal;
        else { this.r = this.goal; this.c = Math.min(this.c, this.rows[this.r].length - 1); }
        this.u = this.c; this.v = this.r;
        this.goal = null;
        this.axis = null;
      }
    }

    /* 擺位置：列 r 橫著排在 y = 0，第 c 欄的那一行直著排在 x = c。拖哪一軸就只畫哪一軸。 */
    const G = LOBBY.gap;
    for (const row of this.rows) for (const x of row) x.critter.root.visible = false;
    const show = (cell, x, y) => {
      const c = cell.critter;
      c.root.visible = true;
      c.root.position.set(x * G, -y * G, 0);
    };
    if (this.axis !== 'v') this.rows[this.r].forEach((cell, j) => show(cell, j, this.r));
    if (this.axis !== 'h') this.rows.forEach((_, i) => { if (i !== this.r || this.axis === 'v') show(this._cell(i, this.c), this.c, i); });

    const cx = this.u * G, cy = -this.v * G + LOBBY.mid;
    this.camera.position.set(cx, cy, this.dist);
    this.camera.lookAt(cx, cy, 0);
    for (const row of this.rows) {
      for (const x of row) {
        if (!x.critter.root.visible) continue;
        const p = x.critter.root.position;
        const viewYaw = Math.atan2(cx - p.x, this.dist);
        x.critter.update(dt, { speed: 0, grounded: true, vy: 0, viewYaw });
      }
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }

  /** 收掉：選好的那一件換給遊戲的 zoo（換了就回 true），窗口的 GL 資源放掉。 */
  end() {
    const look = this.look;
    removeEventListener('resize', this._fit);
    removeEventListener('keydown', this._key);
    this.view.removeEventListener('pointerdown', this._down);
    this.view.removeEventListener('pointermove', this._move);
    this.view.removeEventListener('pointerup', this._up);
    this.view.removeEventListener('pointercancel', this._up);
    this.o.start.removeEventListener('click', this._click);
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    for (const row of this.rows) {
      for (const x of row) {
        x.critter.root.traverse((n) => { if (n.isMesh && n.geometry !== this.shadowGeo) n.geometry.dispose(); });
      }
    }
    this.renderer.dispose();
    this.zoo.setHat(true);
    return this.zoo.setLook(look);
  }
}
