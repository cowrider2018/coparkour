/* ── test/src/lobby.js ───────────────────────────────────────────────
   完整遊戲的開始畫面（mode-flow.js 的 GAME）。只在載入頁面（F5）的時候出現，按開始之後就
   不再回來——重玩就是重新整理。

   畫面上只有兩個元件：

     外觀   正中間那隻主角。上下滑換物種（貓、立耳犬、垂耳犬），左右滑換同一種的毛色。
            帽子一直戴著，不能選。換的時候畫面左右兩邊各開一個黑洞：牠朝滑的方向走進那一邊
            的黑洞（越走近縮得越小，被吸進去），新的造型從另一邊的黑洞走出來（從一個點長回
            原本大小），走到中間轉回來，兩個黑洞闔上。往左滑（或往上滑）是下一件，牠從左邊
            出去、新的從右邊進來；往右（往下）反過來。鍵盤是方向鍵。
     開始   底下那顆圓鈕（只畫一個三角形，不寫字）。Enter 或空白也算。

   ── 背景 ──────────────────────────────────────────────────────────
   遊戲那一片照常畫（同一個 renderer、同一套光影），只是鏡頭換成 `aimBackdrop`：站在中庭的
   正中間、四個狗高那麼高，低頭斜斜地往下看，慢慢繞著轉。整張畫布由 CSS 糊掉（index.html 的
   body.lobby），所以清楚的只有前面這隻。

   主角畫在自己的一張透明畫布（#lobby）上，用自己的 renderer 與場景：背景糊掉而牠不糊，
   同一張畫布做不到。牠就是遊戲裡那一隻（mode-flow.js 的 zoo，連嘴上的刀）：開始畫面借走
   zoo.root，結束的時候還回去，選好的造型因此直接就是遊戲裡的造型。
   ------------------------------------------------------------------ */

import * as THREE from '../vendor/three.module.js';
import { DOG_H } from './combat.js';

/**
 * 背景的鏡頭：在 (x, z) 那一點的正上方 eye 公尺，往下 pitch（弧度）看，每秒繞 spin（弧度）。
 */
export const BACKDROP = { eye: 4 * DOG_H, pitch: 0.5, spin: 0.06 };

/**
 * 前面那一隻的鏡頭與黑洞（公尺；主角約 1 公尺高）。
 *   fov, dist, lift  垂直視角（度）、離主角多遠、比主角腰高多少（往下看一點）
 *   span             畫面最少要看得到中心兩側各這麼寬：直向的窄畫面把鏡頭往後拉
 *   rest             站著的時候面向哪裡（0 是正對鏡頭，正的往畫面右邊轉一點，是四分之三側面）
 *   walk             走進、走出黑洞的速度
 *   suck             離黑洞中心這麼近開始縮，到中心縮成一個點
 *   hole             黑洞：中心離畫面中線最多多遠（不超過畫面半寬的 edge 倍）、寬、高、中心多高、
 *                    在主角後面多遠、張開與闔上幾秒
 *   swipe            滑多長（CSS 像素）才算一次
 */
export const LOBBY = {
  fov: 30, dist: 4.4, lift: 0.4, span: 1.1, rest: 0.5,
  walk: 2.4, suck: 0.8,
  hole: { x: 2.0, edge: 0.78, w: 1.1, h: 1.45, y: 0.62, back: 0.35, open: 0.3 },
  swipe: 36,
};

/** 背景的鏡頭擺到 (cx, cz) 上方，繞了 t 秒。 */
export function aimBackdrop(camera, t, cx, cz) {
  const yaw = t * BACKDROP.spin;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const down = Math.tan(BACKDROP.pitch);
  camera.position.set(cx, BACKDROP.eye, cz);
  camera.lookAt(cx + fx, BACKDROP.eye - down, cz + fz);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (u) => u * u * (3 - 2 * u);

/* 黑洞：一片面朝鏡頭的橢圓。中心全黑，往外是三條慢慢轉進去的暗紫旋臂，外緣柔邊。 */
const HOLE_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const HOLE_FRAG = /* glsl */`
uniform float uOpen;
uniform float uTime;
uniform float uSpin;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p) / max(uOpen, 1e-3);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x) * uSpin;
  float arms = 0.5 + 0.5 * sin(a * 3.0 - r * 7.0 + uTime * 3.0);
  float edge = smoothstep(1.0, 0.72, r);
  float core = smoothstep(0.78, 0.25, r);
  vec3 col = mix(vec3(0.21, 0.16, 0.26) * arms, vec3(0.0), core);
  gl_FragColor = vec4(col, edge * (0.5 + 0.5 * max(core, arms)));
}`;

/* 腳下的影子：一團往外淡掉的黑，跟著主角走、跟著主角縮。 */
const SHADOW_FRAG = /* glsl */`
varying vec2 vUv;
void main() {
  float r = length((vUv - 0.5) * 2.0);
  gl_FragColor = vec4(0.0, 0.0, 0.0, 0.42 * smoothstep(1.0, 0.2, r));
}`;

export class Lobby {
  /**
   * @param {object} o
   *   zoo      mode-flow.js 的那一群動物（借走 zoo.root）
   *   layer    主角那一張透明畫布（#lobby）
   *   start    開始鈕（#start）
   *   onLook   造型換好的那一刻（把刀掛到新那一隻嘴上）
   *   onStart  按了開始
   */
  constructor(o) {
    this.o = o;
    this.zoo = o.zoo;
    this.layer = o.layer;
    this.renderer = new THREE.WebGLRenderer({ canvas: o.layer, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(LOBBY.fov, 1, 0.1, 60);

    const z = this.zoo.root;
    z.position.set(0, 0, 0);
    z.scale.setScalar(1);
    this.scene.add(z);
    this.zoo.setHat(true);
    this.zoo.setFacing(LOBBY.rest);

    const H = LOBBY.hole;
    this.holes = [-1, 1].map((side) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: HOLE_VERT, fragmentShader: HOLE_FRAG, transparent: true, depthWrite: false,
        uniforms: { uOpen: { value: 0 }, uTime: { value: 0 }, uSpin: { value: side } },
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(H.w, H.h), mat);
      m.position.set(side * H.x, H.y, -H.back);
      m.visible = false;
      this.scene.add(m);
      return m;
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.9), new THREE.ShaderMaterial({
      vertexShader: HOLE_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false,
    }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.002;
    this.scene.add(this.shadow);

    /** 主角在哪（x，公尺）、黑洞張開多少（0..1）、黑洞的中心離中線多遠（fit 算）。 */
    this.x = 0;
    this.open = 0;
    this.holeX = H.x;
    this.t = 0;
    /** 正在換的那一次：{ dir, look, phase: 'open' | 'out' | 'in' | 'close' }；排著的下一次。 */
    this.move = null;
    this.queue = [];
    /** 已經決定好（含排著的）的造型：再滑一次從這一件往下數。 */
    this.target = this.zoo.look;

    this._fit = () => this.fit();
    addEventListener('resize', this._fit);
    this.fit();

    /* 滑：按下的那一點到放開的那一點。橫的比直的長就是換毛色，反過來是換物種。 */
    let down = null;
    this._down = (e) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
    this._up = (e) => {
      if (!down || e.pointerId !== down.id) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      down = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < LOBBY.swipe) return;
      if (Math.abs(dx) >= Math.abs(dy)) this.step('skin', dx < 0 ? 1 : -1);
      else this.step('model', dy < 0 ? 1 : -1);
    };
    this._cancel = () => { down = null; };
    this.layer.addEventListener('pointerdown', this._down);
    this.layer.addEventListener('pointerup', this._up);
    this.layer.addEventListener('pointercancel', this._cancel);
    this._key = (e) => {
      if (e.repeat) return;
      const k = e.key;
      if (k === 'ArrowLeft') this.step('skin', 1);
      else if (k === 'ArrowRight') this.step('skin', -1);
      else if (k === 'ArrowUp') this.step('model', 1);
      else if (k === 'ArrowDown') this.step('model', -1);
      else if (k === 'Enter' || k === ' ') this.o.onStart();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', this._key);
    this._click = () => this.o.onStart();
    o.start.addEventListener('click', this._click);
  }

  /**
   * 換下一件（n = 1）或上一件（n = −1）：`skin` 是同一種動物的毛色，`model` 是換一種動物、
   * 毛色留在同一欄（沒有那一欄就取最後一件）。下一件從左邊出去、右邊進來；上一件反過來。
   */
  step(axis, n) {
    const zoo = this.zoo;
    const slash = this.target.indexOf('/');
    const model = this.target.slice(0, slash), skin = this.target.slice(slash + 1);
    const skins = zoo.critters.get(model).skins;
    let look;
    if (axis === 'skin') {
      look = `${model}/${skins[(skins.indexOf(skin) + n + skins.length) % skins.length]}`;
    } else {
      const ms = zoo.models;
      const next = ms[(ms.indexOf(model) + n + ms.length) % ms.length];
      const ns = zoo.critters.get(next).skins;
      look = `${next}/${ns[Math.min(Math.max(0, skins.indexOf(skin)), ns.length - 1)]}`;
    }
    this.target = look;
    // 排著的只留一次：滑很快的話中間那幾件不必一件一件走過。
    this.queue = [{ dir: n > 0 ? -1 : 1, look }];
  }

  /** 畫面大小變了：畫布、鏡頭往後拉多少、黑洞擺多開、墨線多粗。 */
  fit() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const tan = Math.tan((LOBBY.fov * Math.PI) / 360);
    const dist = Math.max(LOBBY.dist, LOBBY.span / (tan * aspect));
    this.camera.aspect = aspect;
    this.camera.position.set(0, LOBBY.lift + dist * 0.12, dist);
    this.camera.lookAt(0, LOBBY.lift, 0);
    this.camera.updateProjectionMatrix();
    this.holeX = Math.min(LOBBY.hole.x, dist * tan * aspect * LOBBY.hole.edge);
    for (const m of this.holes) m.position.x = Math.sign(m.position.x) * this.holeX;
    this.zoo.setInkPx(2.0, h * this.renderer.getPixelRatio());
  }

  /** 往前 dt 秒（真實時間）：換造型的那一段、主角的步伐、黑洞的旋臂。 */
  update(dt) {
    this.t += dt;
    const H = LOBBY.hole;
    if (!this.move && this.queue.length) this.move = { ...this.queue.shift(), phase: 'open' };
    const m = this.move;
    let speed = 0;
    if (m) {
      if (m.phase === 'open') {
        this.open = Math.min(1, this.open + dt / H.open);
        if (this.open >= 1) { m.phase = 'out'; this.zoo.setFacing((m.dir * Math.PI) / 2); }
      } else if (m.phase === 'out' || m.phase === 'in') {
        speed = LOBBY.walk;
        this.x += m.dir * LOBBY.walk * dt;
        if (m.phase === 'out' && m.dir * this.x >= this.holeX) {
          // 整隻吸進去了：換成新的造型，從另一邊的黑洞出來。
          this.zoo.setLook(m.look);
          this.o.onLook();
          this.zoo.setFacing((m.dir * Math.PI) / 2);
          this.x = -m.dir * this.holeX;
          m.phase = 'in';
        } else if (m.phase === 'in' && m.dir * this.x >= 0) {
          this.x = 0;
          speed = 0;
          // 還排著下一次：黑洞不闔，直接接著走出去。
          if (this.queue.length) {
            this.move = { ...this.queue.shift(), phase: 'out' };
            this.zoo.setFacing((this.move.dir * Math.PI) / 2);
          } else {
            m.phase = 'close';
            this.zoo.setFacing(LOBBY.rest);
          }
        }
      } else if (m.phase === 'close') {
        this.open = Math.max(0, this.open - dt / H.open);
        if (this.open <= 0) this.move = null;
      }
    }

    // 離黑洞中心 suck 公尺以內開始縮，到中心縮成一個點，一邊縮一邊往黑洞的中心浮。
    const s = ease(clamp01((this.holeX - Math.abs(this.x)) / LOBBY.suck));
    const z = this.zoo.root;
    z.position.set(this.x, (1 - s) * (H.y - 0.15), 0);
    z.scale.setScalar(Math.max(1e-3, s));
    this.shadow.position.x = this.x;
    this.shadow.scale.setScalar(Math.max(1e-3, s));
    for (const hole of this.holes) {
      hole.visible = this.open > 0;
      hole.material.uniforms.uOpen.value = ease(this.open);
      hole.material.uniforms.uTime.value = this.t;
    }
    const viewYaw = Math.atan2(this.camera.position.x - this.x, this.camera.position.z);
    this.zoo.update(dt, { speed, grounded: true, vy: 0, viewYaw });
  }

  render() { this.renderer.render(this.scene, this.camera); }

  /**
   * 收掉：還沒走完的那一次直接換好（按開始的時候牠可能還在黑洞裡），zoo.root 擺回原樣交還，
   * 這一張畫布的 GL 資源放掉。之後 zoo.root 由呼叫端加回遊戲的場景。
   */
  end() {
    if (this.zoo.look !== this.target) { this.zoo.setLook(this.target); this.o.onLook(); }
    const z = this.zoo.root;
    z.position.set(0, 0, 0);
    z.scale.setScalar(1);
    this.scene.remove(z);
    removeEventListener('resize', this._fit);
    removeEventListener('keydown', this._key);
    this.layer.removeEventListener('pointerdown', this._down);
    this.layer.removeEventListener('pointerup', this._up);
    this.layer.removeEventListener('pointercancel', this._cancel);
    this.o.start.removeEventListener('click', this._click);
    for (const m of [...this.holes, this.shadow]) { m.geometry.dispose(); m.material.dispose(); }
    this.renderer.dispose();
  }
}
