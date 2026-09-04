import { Level } from './level.js';
import { hashStr } from './rng.js';
import { Player } from './player.js';
import { Camera, Renderer, playerState } from './render.js';
import { Net, GhostPool } from './net.js';
import { Input } from './input.js';
import { WaterBall } from './touch.js';
import { Pad } from './pad.js';
import { WORLD, PLAYER_W, PLAYER_H, PX_PER_M } from './constants.js';
import { NpcPool, NPC, priceFor } from './npc.js';
import { skyAt, hourForSeed, DAY_SECONDS } from './gfx/daycycle.js';
import { Decor } from './gfx/decor.js';
import { Trees } from './gfx/tree.js';
import { seasonBlend } from './gfx/season.js';
import { CAT_SKINS } from './cat/cat.js';
import { LOOKS, DEFAULT_LOOK, isLook, lookInfo } from './cat/looks.js';
import { speciesModels } from './cat/species.js';

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
let W = 0, H = 0, zoom = 1, zoomBase = 1;
let running = false;
let bestDist = Number(localStorage.getItem('pk_best') || 0);
let roomBoard = [];
let alone = true;
let npcs = null;            // 在地圖上遊蕩的 NPC（位置是世界時間的函數，不走網路）
let wallet = 0;             // 伺服器記的金幣餘額（死掉不歸零、同房同人累積）
let flushed = 0;            // 這條命撿到的金幣裡，已經回報給伺服器的部分
let flushAt = 0;
let myName = '無名跑者';
/* 造型：一個扁平的 "模型/毛色"，存這裡、上網路、進伺服器都是同一個字串。
   舊存檔存的是裸毛色名（'tabby'），一律當成貓的那一件補回去。 */
let look = localStorage.getItem('pk_look')
  || (localStorage.getItem('pk_skin') ? `cat/${localStorage.getItem('pk_skin')}` : '');
if (!isLook(look)) look = DEFAULT_LOOK;

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
  // 基準視距只跟畫布寬度有關；每幀的實際 zoom 由 cam.fitZoom() 從這裡往下調。
  zoomBase = Math.max(0.6, Math.min(1, W / 1000));
  zoom = Math.min(zoom, zoomBase) || zoomBase;
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
function buildLevel(newSeed, t0) {
  seed = newSeed >>> 0;
  level = new Level(seed);
  player = new Player(level);
  // 單機沒有伺服器發時鐘，就自己記一個：這樣重新整理之後 NPC 還在原本的節奏上
  const key = 'pk_t0:' + ROOM + ':' + seed;
  let epoch = t0 || Number(localStorage.getItem(key) || 0);
  if (!epoch) { epoch = Date.now(); }
  if (!t0) localStorage.setItem(key, String(epoch));
  if (npcs) {
    npcs.rebind(seed, level, epoch);
  } else {
    npcs = new NpcPool(seed, level);
    npcs.t0 = epoch;
  }
  if (!SERVER) loadLocalRoom();
  renderer.setSeed(seed);
  renderer.decor = new Decor(seed);
  renderer.trees = new Trees(seed);
  cam.init = false;

  hour0 = hourForSeed(seed);
  weather = weatherForSeed(seed);
  elapsed = 0;

  $('seedTag').textContent = '#' + seed.toString(16).padStart(8, '0');
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
  // 買過重生點就從最遠的那個出生。距離照世界座標算，所以一開跑就有里程——
  // 這正是買重生點的意義。
  const sp = npcs ? npcs.mySpawn(myName) : null;
  if (sp) level.ensure(sp.x + WORLD.chunkAhead);
  player.reset(sp ? { x: sp.x - PLAYER_W / 2, y: sp.y } : undefined);
  if (sp) cam.init = false;   // 不然鏡頭會從起點一路橫掃過去
  flushed = 0;
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
    url: SERVER, room: ROOM, name, look,
    on: {
      status: (s) => {
        if (s === 'online') setStatus('已連線', 'ok');
        else if (s === 'connecting') setStatus('連線中…', 'warn');
        else if (s === 'bad-url') setStatus('伺服器網址有誤', 'bad');
        else setStatus('離線（重連中）', 'bad');
      },
      welcome: (m) => {
        ghosts.clear();
        for (const p of m.players || []) ghosts.upsert(p.id, p.name, p.look);
        if ((m.seed >>> 0) !== seed) { buildLevel(m.seed, m.t0); restart(); }
        // 世界時鐘：t0 是原點，now 用來校正本機時鐘（誤差是 ping 的一半）
        if (npcs) {
          npcs.setClock(m.t0, m.now ? m.now - Date.now() : 0);
          npcs.setOwners(m.owners || []);
        }
        wallet = m.coins || 0;
        flushed = player ? player.coins : 0;
        roomBoard = m.board || [];
        renderBoard();
      },
      // 有人買下了一隻 NPC（自己買的也會收到）
      own: (m) => {
        if (!npcs) return;
        npcs.setOwner(m);
        const n = npcs.list().find((q) => q.i === m.i);
        if (n) n.say(m.name === myName ? '成交！這裡是你的重生點了' : m.name + ' 買下了這裡');
      },
      wallet: (m) => { wallet = m.v || 0; },
      buyfail: (m) => {
        const n = npcs && npcs.list().find((q) => q.i === m.i);
        if (!n) return;
        n.invite = 0;
        n.say(m.why === 'taken' ? '這隻已經有主人了' : `還差 ${Math.max(0, (m.need || 0) - (m.have || 0))} 枚金幣`);
      },
      join: (m) => { ghosts.upsert(m.id, m.name, m.look); renderBoard(); },
      leave: (m) => { ghosts.remove(m.id); if (cats) cats.forget(m.id); renderBoard(); },
      s: (m) => ghosts.onState(m),
      board: (m) => { roomBoard = m.list || []; renderBoard(); },
      seed: (m) => {
        // 換地形＝換一個世界：重生點、錢包、時鐘全部跟著重來（伺服器那邊也清了）
        buildLevel(m.seed, m.t0);
        wallet = 0;
        roomBoard = [];
        restart();
        renderBoard();
      },
      full: () => setStatus('房間已滿', 'bad'),
    },
  });
  net.connect();
}

// 連線狀態說兩次：房名藥丸的底色（常駐看得到）＋「更多」裡的文字
function setStatus(text, kind) {
  $('conn').textContent = text;
  const pill = $('roomPill');
  pill.className = 'pill room ' + kind;
  pill.title = text;
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
  // 兩個人以上就永遠換不成了，按鈕捲出去把位置讓給「複製房間連結」
  $('reseedBtn').classList.toggle('gone', rows.length > 2);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── 主迴圈 ─────────────────────────────────────────────
const STEP = 1 / 120;
let acc = 0, last = 0, uiTick = 0, wasDead = false, npcAcc = 0;

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

  // NPC 走自己的時鐘，不受「玩家死了」影響——牠們是世界的一部分，不是這一局的一部分。
  // 餵進去的世界時間由伺服器的 t0 決定，所以同一個房間的每個人算出來的都一樣。
  if (npcs && player) {
    npcAcc += dt;
    const wt = npcs.worldTime();
    let ns = 0;
    while (npcAcc >= STEP && ns < 8) { npcs.update(player.x, STEP, wt + ns * STEP); npcAcc -= STEP; ns++; }
    if (ns >= 8) npcAcc = 0;
  }

  // 相機對準「看得到的那一片」的中心：操作列吃掉多少，取景就往回讓多少。
  // pad.k 是無過衝的進退場進度，所以開關的那 0.4 秒是滑過去的，不是跳過去的。
  const k = pad.k;
  const il = pad.inset.l * k, ir = pad.inset.r * k;
  const it = pad.inset.t * k, ib = pad.inset.b * k;
  const fx = il + 0.34 * (1 - il - ir);
  const fy = it + 0.55 * (1 - it - ib);
  // 視距要在 follow() 之前定案：follow 吃的是世界座標的視野大小，那由 zoom 決定。
  zoom = cam.fitZoom(level, player, W, H, zoomBase, fx, fy, { t: it, b: ib }, dt);
  cam.follow(player, W / zoom, H / zoom, dt, fx, fy);
  level.ensure(cam.x + W / zoom + WORLD.chunkAhead);

  const hour = (hour0 + (elapsed / DAY_SECONDS) * 24) % 24;
  const sky = skyAt(hour);
  const time = now / 1000;

  if (background && !background.lost) {
    try {
      background.draw({
        cam, view: { w: W / zoom, h: H / zoom },
        sky, seed, time, weather,
        // 遠山跟腳下的草皮讀同一條季節線。查鏡頭中心那一點就夠了：
        // 一整條山脈是一個面，過渡帶上它會隨鏡頭平順地換過去。
        ridgeTint: seasonBlend(cam.x + W / (zoom * 2), 'ridge'),
      });
    } catch (e) { background = null; }
  } else if (background) {
    background = null;                    // context lost → 退回 Canvas 2D
    bgCanvas.style.display = 'none';
  }

  const list = ghosts.sample(now);
  const npcList = npcs ? npcs.list() : [];
  renderer.draw(W, H, {
    cam, level, player, ghosts: list, npcs: npcList, myName, time, zoom, sky, look,
    wind: weather.wind, glBackground: !!background, hasCats: !!cats,
  });

  // 角色層：即時 3D、三階調著色。順序就是混色順序，所以自己最後畫。
  if (cats) {
    try {
      cats.begin(cam, { w: W / zoom, h: H / zoom }, sky);
      for (const g of list) {
        cats.cat(g.id, g.x, g.y, g.facing, g.state, g.vx || 0, dt, g.look, 0.58, g.vy || 0);
      }
      // NPC 用滿的不透明度：牠們真的在這個世界裡，不是別人畫面的投影
      for (const n of npcList) {
        cats.cat('npc' + n.i, n.x, n.y, n.p.facing, playerState(n.p),
          // 旅貓還是貓。要讓路上什麼都有，把這行換成 LOOKS 就行。
          Math.abs(n.p.vx), dt, `cat/${CAT_SKINS[n.i % CAT_SKINS.length]}`, 1, n.p.vy);
      }
      if (!player.dead) {
        cats.cat('me', player.x, player.y, player.facing,
          playerState(player), Math.abs(player.vx), dt, look, 1, player.vy);
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
    flushCoins(true);
    const sp = npcs ? npcs.mySpawn(myName) : null;
    $('retryBtn').innerHTML = sp
      ? `從 ${Math.round(sp.x / PX_PER_M)}m 重新開始 <span class="kbdhint">R</span>`
      : `再跑一次 <span class="kbdhint">R</span>`;
    $('deadReason').textContent = player.deadReason;
    $('deadDist').textContent = player.dist + ' m';
    $('deadCoins').textContent = coinTotal();
    $('deadBest').textContent = bestDist + ' m';
    $('dead').classList.remove('hidden');
  }
  if (!player.dead) wasDead = false;

  uiTick += dt;
  if (uiTick > 0.1) {
    uiTick = 0;
    $('dist').textContent = player.dist;
    $('coins').textContent = coinTotal();
    if (now - flushAt > 60000) flushCoins(false);
    $('best').textContent = bestDist;
    $('rtt').textContent = net && net.rtt != null ? net.rtt + 'ms' : '--';
    renderBoard();
  }
}

// ── NPC：金幣、重生點、點擊購買 ────────────────────────
// 錢包在伺服器那邊（死掉不歸零、同房同人累積）。這裡只記「本條命撿到的金幣裡，
// 已經回報過多少」，顯示的數字則是餘額加上還沒回報的那一段。
function coinTotal() {
  return wallet + (player ? player.coins - flushed : 0);
}

function flushCoins(force) {
  if (!player) return;
  const add = player.coins - flushed;
  if (add <= 0 && !force) return;
  flushed = player.coins;
  flushAt = performance.now();
  if (add <= 0) return;
  wallet += add;                       // 先自己加上去，伺服器回來的值會覆蓋它
  if (net && net.connected) net.send({ t: 'coins', n: add });
  else saveLocalRoom();
}

// 單機／離線時的房間狀態。連上線之後一律以伺服器為準。
function localKey() { return 'pk_room:' + ROOM + ':' + seed; }

function loadLocalRoom() {
  let st = {};
  try { st = JSON.parse(localStorage.getItem(localKey()) || '{}'); } catch { /* 壞了就當空的 */ }
  wallet = st.wallet || 0;
  if (npcs) npcs.setOwners(st.owners || []);
}

function saveLocalRoom() {
  if (SERVER && net && net.connected) return;
  try {
    localStorage.setItem(localKey(), JSON.stringify({
      wallet, owners: npcs ? [...npcs.owners.values()] : [],
    }));
  } catch { /* 存不下就算了 */ }
}

// 玩家必須是靜止的才點得到 NPC。跑動中誤觸會直接偷走一次操作
//（水球正在控制左右、手把正在推），那比買不到重生點嚴重得多。
function playerStill() {
  return !!player && !player.dead && player.grounded &&
    Math.abs(player.vx) < 8 && input.axis === 0;
}

// 螢幕座標 → 世界座標。跟 render.js 的 ctx.scale(zoom)+translate(-round(cam)) 是同一組變換。
function screenToWorld(sx, sy) {
  const r = uiCanvas.getBoundingClientRect();
  return {
    x: Math.round(cam.x) + (sx - r.left) / zoom,
    y: Math.round(cam.y) + (sy - r.top) / zoom,
  };
}

// 掛在 window 的捕獲階段：命中 NPC 才吃掉這次點擊，其餘一律放行給水球／手把。
// （掛在畫布上不行——同一個節點上的監聽器照註冊順序跑，水球註冊得比較早。）
addEventListener('pointerdown', (e) => {
  if (!running || !npcs || !playerStill()) return;
  const w = screenToWorld(e.clientX, e.clientY);
  const n = npcs.nearest(w.x, w.y, 46);        // 點在貓身上
  if (!n) return;
  const dx = n.cx - (player.x + PLAYER_W / 2);
  const dy = n.cy - (player.y + PLAYER_H / 2);
  if (dx * dx + dy * dy > NPC.talkPx * NPC.talkPx) return; // 沒有極靠近就不算
  e.preventDefault();
  e.stopPropagation();
  tapNpc(n);
}, true);

// 兩段式：第一次點跳出邀請，第二次點成交。
function tapNpc(n) {
  const own = n.owner;
  if (own) {
    n.say(own.name === myName ? '這裡是你的重生點' : own.name + ' 的重生點');
    return;
  }
  const price = priceFor(npcs.ownedBy(myName));
  if (n.invite > 0) {
    n.invite = 0;
    flushCoins(true);                 // 先把這條命撿到的金幣結清，才知道買不買得起
    if (wallet < price) { n.say(`還差 ${price - wallet} 枚金幣`); return; }
    buyNpc(n, price);
  } else {
    n.invite = 4;
    n.say(`在這裡設重生點？${price} 枚金幣 — 再點一次成交`, 4);
  }
}

function buyNpc(n, price) {
  // 買的是「牠現在站的那塊板子」：重生點 X 是板子中心、Y 是頂面。
  const plat = npcs.platformAt(n.cx, n.p.y + PLAYER_H) || n.target.p;
  const x = Math.round(plat.x + plat.w / 2);
  const y = Math.round(plat.y);
  if (net && net.connected) {
    net.send({ t: 'buy', i: n.i, x, y });       // 成不成由伺服器裁定（先到先得）
    n.say('……');
  } else {
    wallet -= price;
    npcs.setOwner({ i: n.i, name: myName, at: Date.now(), x, y });
    saveLocalRoom();
    n.say('成交！這裡是你的重生點了');
  }
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
    /* 一層裝下所有物種。名冊由 species.js 給，這裡不認識任何一種動物。 */
    cats = await CatLayer.load(fxCanvas, './assets/cat.bin', { models: speciesModels });
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
  myName = name;
  localStorage.setItem('pk_name', name);
  localStorage.setItem('pk_look', look);
  $('menu').classList.add('hidden');
  buildLevel(seed);
  restart();
  connect(name);
  resize();
}

/* 選單就是 LOOKS 本身。名字和色票都從 looks.js 來，所以多一種動物或多一件
   毛色不用改這裡——那正是把名單放在一個地方的理由。 */
function buildSkinPicker() {
  const box = $('skinPicker');
  box.innerHTML = LOOKS.map((id) => {
    const info = lookInfo(id);
    const stops = info.swatch.length === 2
      ? `${info.swatch[0]} 50%, ${info.swatch[1]} 50%`
      : info.swatch.map((c, i, a) => `${c} ${Math.round((i / a.length) * 100)}% ${Math.round(((i + 1) / a.length) * 100)}%`).join(', ');
    return `<button type="button" class="skin" data-look="${id}" aria-pressed="${id === look}">
       <span class="chip" style="background:linear-gradient(135deg, ${stops})"></span>${info.name}
     </button>`;
  }).join('');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.skin');
    if (!b) return;
    look = b.dataset.look;
    localStorage.setItem('pk_look', look);
    box.querySelectorAll('.skin').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.look === look)));
    if (net) net.setLook(look);
  });
}

myName = localStorage.getItem('pk_name') || '無名跑者';
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

// 「更多」：房名、即時排名、延遲以外的東西都在裡面。
// 手把模式操作列裝不下，預設收起，要看再展開（它自己會捲）。
function setHudMore(open) {
  document.querySelector('.hud-side').classList.toggle('more-open', open);
  $('moreBtn').setAttribute('aria-expanded', String(open));
}

function hudMoreOpen() {
  return document.querySelector('.hud-side').classList.contains('more-open');
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

  const apply = () => {
    document.body.classList.toggle('pad', on);
    setHudMore(!on);
  };
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

$('moreBtn').addEventListener('click', () => setHudMore(!hudMoreOpen()));
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
setHudMore(!padOn);
setPadSide(padSwap);
if (padOn) { padOn = false; setPadMode(true, false); }

if (!SERVER) {
  $('serverHint').classList.remove('hidden');
  $('rtt').hidden = true;          // 單機沒有延遲可言，那顆藥丸就不要佔位
}
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
  get npcs() { return npcs; },
  get wallet() { return wallet; },
  get running() { return running; },
  input,
  giveCoins(n) { if (player) player.coins += n; },
  setPad: setPadMode, setPadSide, setHudMore,
};
