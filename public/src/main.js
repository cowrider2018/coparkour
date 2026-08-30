import { Level } from './level.js';
import { hashStr } from './rng.js';
import { Player } from './player.js';
import { Camera, Renderer, playerState } from './render.js';
import { Net, GhostPool } from './net.js';
import { Input } from './input.js';
import { WaterBall } from './touch.js';
import { Pad } from './pad.js';
import { WORLD } from './constants.js';
import { skyAt, hourForSeed, DAY_SECONDS } from './gfx/daycycle.js';
import { Decor } from './gfx/decor.js';
import { Trees } from './gfx/tree.js';
import { CAT_SKINS } from './cat/cat.js';

const $ = (id) => document.getElementById(id);
const cfg = window.GAME_CONFIG || {};
const qs = new URLSearchParams(location.search);

const SOLO = qs.get('solo') === '1';
const SERVER = SOLO
  ? ''
  : (qs.get('server') || cfg.WS_URL || '').trim() ||
    (location.protocol === 'http:' || location.protocol === 'https:' ? location.origin : '');
const ROOM = (qs.get('room') || cfg.DEFAULT_ROOM || 'lobby').slice(0, 24);
const NOGL = qs.get('nogl') === '1';   // 強制走 Canvas 2D 備援，方便對照

const canvas = $('game');
const ctx = canvas.getContext('2d');
const bgCanvas = $('bg');
const fxCanvas = $('fx');
const uiCanvas = $('ui');
const uictx = uiCanvas.getContext('2d');
const renderer = new Renderer(ctx);
const cam = new Camera();
const ghosts = new GhostPool();

let level = null;
let player = null;
let net = null;
let background = null;      // WebGL 背景層，載不起來就是 null
let cats = null;            // WebGL 角色層（即時 3D 三階調），載不起來就是 null
let seed = hashStr('local:' + ROOM);
let W = 0, H = 0, zoom = 1;
let running = false;
let bestDist = Number(localStorage.getItem('pk_best') || 0);
let roomBoard = [];
let alone = true;
let skin = localStorage.getItem('pk_skin') || CAT_SKINS[0];
if (!CAT_SKINS.includes(skin)) skin = CAT_SKINS[0];

// 手把：預設關閉，開了就記住（含左右配置）
let padOn = localStorage.getItem('pk_pad') === '1';
let padSwap = localStorage.getItem('pk_padside') === '1';

// 房間 seed 決定起始時刻與天氣——變化來自免費的地方
let hour0 = 0;
let weather = { rain: 0, snow: 0, wind: 0.5 };
let elapsed = 0;

// ── 畫布尺寸 ───────────────────────────────────────────
// env() 塞在自訂屬性裡 JS 讀不回來，所以量一個真的有 padding 的探針
function safeInsets() {
  const cs = getComputedStyle($('saProbe'));
  return {
    t: parseFloat(cs.paddingTop) || 0,
    r: parseFloat(cs.paddingRight) || 0,
    b: parseFloat(cs.paddingBottom) || 0,
    l: parseFloat(cs.paddingLeft) || 0,
  };
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  uiCanvas.width = Math.round(W * dpr);
  uiCanvas.height = Math.round(H * dpr);
  uictx.setTransform(dpr, 0, 0, dpr, 0, 0);
  zoom = Math.max(0.6, Math.min(1, W / 1000));
  if (background) background.resize(W, H, dpr);
  if (cats) cats.resize(W, H, dpr);
  ball.resize(W, H);

  // 手把的幾何是唯一真相，算完回寫成 CSS 變數——
  // 底板、儀表板、畫布上的搖桿因此不可能對不齊。
  pad.layout(W, H, safeInsets());
  const st = document.documentElement.style;
  st.setProperty('--rail', pad.rail + 'px');
  st.setProperty('--barT', pad.barT + 'px');
  st.setProperty('--barB', pad.barB + 'px');
  st.setProperty('--zone', pad.zoneH + 'px');
  st.setProperty('--ctrl', pad.ctrlTop + 'px');
  document.body.classList.toggle('pad-port', pad.portrait);
  document.body.classList.toggle('pad-land', !pad.portrait);
}
addEventListener('resize', resize);

// ── 關卡 / 重生 ────────────────────────────────────────
function buildLevel(newSeed) {
  seed = newSeed >>> 0;
  level = new Level(seed);
  player = new Player(level);
  renderer.setSeed(seed);
  renderer.decor = new Decor(seed);
  renderer.trees = new Trees(seed);
  cam.init = false;

  hour0 = hourForSeed(seed);
  weather = weatherForSeed(seed);
  elapsed = 0;

  $('seedTag').textContent = '#' + seed.toString(16).padStart(8, '0');
  $('weatherTag').textContent = weather.label;
}

// 一個房間的天氣：七成晴、兩成雨、一成雪。同房間所有人一致。
function weatherForSeed(s) {
  const r = ((s >>> 16) & 0xffff) / 65536;
  const wind = 0.25 + (((s >>> 3) & 0xff) / 255) * 0.6;
  if (r < 0.70) return { rain: 0, snow: 0, wind, label: '晴' };
  if (r < 0.90) return { rain: 1, snow: 0, wind: Math.max(wind, 0.55), label: '雨' };
  return { rain: 0, snow: 1, wind: wind * 0.7, label: '雪' };
}

function restart() {
  if (!level) return;
  for (const c of level.coins) c.taken = false;
  player.reset();
  $('dead').classList.add('hidden');
  running = true;
}

const input = new Input(
  () => { if (player && !player.dead) player.queueJump(); },
  () => { if (player && player.dead) restart(); }
);

// 手機的預設操作介面：一顆水球，沒有按鈕。開手把就整個關掉——
// 「中央乾淨」的意思包含中央完全不收指標事件，誤觸不會亂跳。
const ball = new WaterBall(uiCanvas, {
  onJump: (hold) => input.touchJump(hold),
  enabled: () => running && !!player && !player.dead && !padOn,
});

// 螢幕手把：跟水球共用同一張操作層畫布，兩者永遠只有一個活著
const pad = new Pad(uiCanvas, {
  onJump: () => input.setPadJump(true),
  onJumpEnd: () => input.setPadJump(false),
  enabled: () => running && !!player && !player.dead,
});
pad.setSwapped(padSwap);
pad.mix = padSwap ? 1 : 0;   // 開機就是這個配置，不用播對調動畫

// ── 連線 ───────────────────────────────────────────────
function connect(name) {
  if (!SERVER) { setStatus('單機模式', 'warn'); return; }
  net = new Net({
    url: SERVER, room: ROOM, name, skin,
    on: {
      status: (s) => {
        if (s === 'online') setStatus('已連線', 'ok');
        else if (s === 'connecting') setStatus('連線中…', 'warn');
        else if (s === 'bad-url') setStatus('伺服器網址有誤', 'bad');
        else setStatus('離線（重連中）', 'bad');
      },
      welcome: (m) => {
        ghosts.clear();
        for (const p of m.players || []) ghosts.upsert(p.id, p.name, p.skin);
        if ((m.seed >>> 0) !== seed) { buildLevel(m.seed); restart(); }
        roomBoard = m.board || [];
        renderBoard();
      },
      join: (m) => { ghosts.upsert(m.id, m.name, m.skin); renderBoard(); },
      leave: (m) => { ghosts.remove(m.id); if (cats) cats.forget(m.id); renderBoard(); },
      s: (m) => ghosts.onState(m),
      board: (m) => { roomBoard = m.list || []; renderBoard(); },
      seed: (m) => { buildLevel(m.seed); roomBoard = []; restart(); renderBoard(); },
      full: () => setStatus('房間已滿', 'bad'),
    },
  });
  net.connect();
}

function setStatus(text, kind) {
  const el = $('conn');
  el.textContent = text;
  el.className = 'pill ' + kind;
}

// ── UI ─────────────────────────────────────────────────
function renderBoard() {
  const live = ghosts.roster(performance.now());
  const rows = live.map((g) => ({ name: g.name, dist: g.dist, coins: g.coins, me: false, dead: g.state === 'dead' }));
  rows.push({ name: '你', dist: player ? player.dist : 0, coins: player ? player.coins : 0, me: true, dead: player ? player.dead : false });
  rows.sort((a, b) => b.dist - a.dist);
  alone = rows.length <= 1;

  $('liveList').innerHTML = rows.slice(0, 12)
    .map((r, i) => `<li class="${r.me ? 'me' : ''}${r.dead ? ' out' : ''}"><span class="rank">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="ds">${r.dist}m</span></li>`)
    .join('');

  $('bestList').innerHTML = roomBoard.length
    ? roomBoard.slice(0, 8).map((r, i) => `<li><span class="rank">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="ds">${r.dist}m</span></li>`).join('')
    : '<li class="empty">還沒有紀錄</li>';

  $('online').textContent = rows.length + ' 人在線';
  $('reseedBtn').disabled = !(net && net.connected && alone);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── 主迴圈 ─────────────────────────────────────────────
const STEP = 1 / 120;
let acc = 0, last = 0, uiTick = 0, wasDead = false;

function frame(now) {
  requestAnimationFrame(frame);
  if (!level) return;
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  elapsed += dt;

  ball.update(dt);
  pad.update(dt);
  input.setTouch(ball.active, ball.axis);
  input.setPad(pad.jOn, pad.axis);

  if (running) {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps++ < 8) { input.tick(STEP); player.update(STEP, input); acc -= STEP; }
    if (steps >= 8) acc = 0;
  }

  // 相機對準「看得到的那一片」的中心：操作列吃掉多少，取景就往回讓多少。
  // pad.k 是無過衝的進退場進度，所以開關的那 0.4 秒是滑過去的，不是跳過去的。
  const k = pad.k;
  const il = pad.inset.l * k, ir = pad.inset.r * k;
  const it = pad.inset.t * k, ib = pad.inset.b * k;
  cam.follow(player, W / zoom, H / zoom, dt,
    il + 0.34 * (1 - il - ir), it + 0.55 * (1 - it - ib));
  level.ensure(cam.x + W / zoom + WORLD.chunkAhead);

  const hour = (hour0 + (elapsed / DAY_SECONDS) * 24) % 24;
  const sky = skyAt(hour);
  const time = now / 1000;

  if (background && !background.lost) {
    try {
      background.draw({
        cam, view: { w: W / zoom, h: H / zoom },
        sky, seed, time, weather,
      });
    } catch (e) { background = null; }
  } else if (background) {
    background = null;                    // context lost → 退回 Canvas 2D
    bgCanvas.style.display = 'none';
  }

  const list = ghosts.sample(now);
  renderer.draw(W, H, {
    cam, level, player, ghosts: list, time, zoom, sky, skin,
    wind: weather.wind, glBackground: !!background, hasCats: !!cats,
  });

  // 角色層：即時 3D、三階調著色。順序就是混色順序，所以自己最後畫。
  if (cats) {
    try {
      cats.begin(cam, { w: W / zoom, h: H / zoom }, sky);
      for (const g of list) {
        cats.cat(g.id, g.x, g.y, g.facing, g.state, g.vx || 0, dt, g.skin, 0.58, g.vy || 0);
      }
      if (!player.dead) {
        cats.cat('me', player.x, player.y, player.facing,
          playerState(player), Math.abs(player.vx), dt, skin, 1, player.vy);
      }
      cats.end();
    } catch (e) {
      try { cats.dispose(); } catch (e2) { /* ignore */ }
      cats = null;
      fxCanvas.style.display = 'none';
    }
  }

  // 操作層最後畫，蓋在所有東西上面
  uictx.clearRect(0, 0, W, H);
  ball.draw(uictx, W, H);
  pad.draw(uictx);

  if (net) net.sendState(player, now, playerState(player));

  if (player.dead && !wasDead) {
    wasDead = true;
    running = false;
    if (player.dist > bestDist) { bestDist = player.dist; localStorage.setItem('pk_best', String(bestDist)); }
    if (net) net.sendScore(player.dist, player.coins, player.deadReason);
    $('deadReason').textContent = player.deadReason;
    $('deadDist').textContent = player.dist + ' m';
    $('deadCoins').textContent = player.coins;
    $('deadBest').textContent = bestDist + ' m';
    $('dead').classList.remove('hidden');
  }
  if (!player.dead) wasDead = false;

  uiTick += dt;
  if (uiTick > 0.1) {
    uiTick = 0;
    $('dist').textContent = player.dist;
    $('coins').textContent = player.coins;
    $('best').textContent = bestDist;
    $('speed').textContent = Math.round(Math.abs(player.vx));
    $('clock').textContent = fmtHour(hour);
    if (net && net.rtt != null) $('rtt').textContent = net.rtt + 'ms';
    renderBoard();
  }
}

function fmtHour(h) {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// ── 圖層：WebGL 背景 + 貓 ──────────────────────────────
async function bootGraphics() {
  if (!NOGL) {
    try {
      const { Background } = await import('./gl/background.js');
      background = new Background(bgCanvas);
      bgCanvas.style.display = 'block';
    } catch (e) {
      background = null;
      bgCanvas.style.display = 'none';
    }
  } else {
    bgCanvas.style.display = 'none';
  }
  resize();

  if (NOGL) { $('catNote').textContent = '（強制備援模式：角色是方塊）'; return; }
  try {
    const { CatLayer } = await import('./cat/cat.js');
    cats = await CatLayer.load(fxCanvas, './assets/cat.bin');
    fxCanvas.style.display = 'block';
    cats.resize(W, H, Math.min(devicePixelRatio || 1, 2));
    $('catNote').textContent = '';
  } catch (e) {
    cats = null;
    fxCanvas.style.display = 'none';
    $('catNote').textContent = '（這台裝置畫不出貓，改用方塊）';
  }
}

// ── 啟動 ───────────────────────────────────────────────
function start() {
  const name = ($('nameInput').value || '').trim().slice(0, 14) || '無名跑者';
  localStorage.setItem('pk_name', name);
  localStorage.setItem('pk_skin', skin);
  $('menu').classList.add('hidden');
  buildLevel(seed);
  restart();
  connect(name);
  resize();
}

function buildSkinPicker() {
  const box = $('skinPicker');
  const LABEL = { orangin: '橘白', tabby: '虎斑', calico: '三花' };
  box.innerHTML = CAT_SKINS.map((s) =>
    `<button type="button" class="skin" data-skin="${s}" aria-pressed="${s === skin}">
       <span class="chip chip-${s}"></span>${LABEL[s] || s}
     </button>`).join('');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.skin');
    if (!b) return;
    skin = b.dataset.skin;
    localStorage.setItem('pk_skin', skin);
    box.querySelectorAll('.skin').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.skin === skin)));
    if (net) net.setSkin(skin);
  });
}

$('nameInput').value = localStorage.getItem('pk_name') || '';
$('roomTag').textContent = ROOM;
$('best').textContent = bestDist;
buildSkinPicker();
$('startBtn').addEventListener('click', start);
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
$('retryBtn').addEventListener('click', restart);
$('reseedBtn').addEventListener('click', () => { if (net) net.requestReseed(); });
$('shareBtn').addEventListener('click', async () => {
  const url = new URL(location.href);
  url.searchParams.set('room', ROOM);
  try {
    await navigator.clipboard.writeText(url.toString());
    $('shareBtn').textContent = '已複製連結 ✓';
    setTimeout(() => ($('shareBtn').textContent = '複製房間連結'), 1600);
  } catch { prompt('複製這個連結分享給朋友：', url.toString()); }
});
// ── 手把開關 ───────────────────────────────────────────
// 儀表板從角落飛進操作列這件事，靠的是 FLIP：切 class 之前先量位置，
// 切完再量一次，然後用「舊減新」的位移倒著播回來。
// 只動葉節點（五格數字卡和右側面板），不動它們的容器——
// 父子都套一次位移會疊加成兩倍。位移只用 translate 不用 scale，
// 卡片裡的字才不會在那 0.34 秒被拉扁。
function flip(els, mutate) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = els.map((el) => el.getBoundingClientRect());
  mutate();
  if (still) return;
  els.forEach((el, i) => {
    if (!el.animate) return;
    const a = before[i], b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    el.animate(
      [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }],
      { duration: 340, delay: i * 22, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
  });
}

function hudMovers() {
  return [...document.querySelectorAll('.hud-top .stat'), document.querySelector('.hud-side')];
}

function setPadMode(on, animate = true) {
  if (padOn === on) return;
  padOn = on;
  localStorage.setItem('pk_pad', on ? '1' : '0');
  pad.setEnabled(on);

  const sw = $('padSwitch');
  sw.setAttribute('aria-checked', String(on));
  sw.classList.add('moving');
  $('padBtn').setAttribute('aria-pressed', String(on));
  $('swapBtn').disabled = !on;
  $('sideRow').classList.toggle('off', !on);

  const apply = () => document.body.classList.toggle('pad', on);
  if (animate) flip(hudMovers(), apply); else apply();
}

function setPadSide(swapped) {
  padSwap = swapped;
  localStorage.setItem('pk_padside', swapped ? '1' : '0');
  pad.setSwapped(swapped);
  $('padSide').dataset.side = swapped ? 'b' : 'a';
  $('padSide').querySelectorAll('button').forEach((b) =>
    b.setAttribute('aria-pressed', String((b.dataset.v === 'b') === swapped)));
}

// 展開／收起。高度交給 CSS 的 0fr→1fr 補間，這裡只負責切 class。
function setSettingsOpen(open) {
  $('settings').classList.toggle('open', open);
  $('setToggle').setAttribute('aria-expanded', String(open));
}

$('setToggle').addEventListener('click', () =>
  setSettingsOpen(!$('settings').classList.contains('open')));

$('padSwitch').addEventListener('click', () => setPadMode(!padOn));
$('padSwitch').addEventListener('animationend', (e) => e.currentTarget.classList.remove('moving'));
$('padBtn').addEventListener('click', () => setPadMode(!padOn));
$('swapBtn').addEventListener('click', () => setPadSide(!padSwap));
$('padSide').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setPadSide(b.dataset.v === 'b');
});

addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (e.code === 'KeyG') setPadMode(!padOn);
  else if (e.code === 'KeyH' && padOn) setPadSide(!padSwap);
});

// 開機先把記住的設定套上去，這一次不播動畫（沒有「從哪裡飛過來」可言）
setPadSide(padSwap);
if (padOn) { padOn = false; setPadMode(true, false); }

if (!SERVER) $('serverHint').classList.remove('hidden');
bootGraphics();
requestAnimationFrame(frame);

window.__parkour = {
  get player() { return player; },
  get level() { return level; },
  get net() { return net; },
  get background() { return background; },
  get cats() { return cats; },
  get renderer() { return renderer; },
  get sky() { return skyAt((hour0 + (elapsed / DAY_SECONDS) * 24) % 24); },
  setHour(h) { hour0 = h; elapsed = 0; },
  setWeather(w) { weather = Object.assign(weather, w); },
  ghosts, cam, restart, pad, ball,
  setPad: setPadMode, setPadSide,
};
