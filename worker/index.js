// ── Coparkour ───────────────────────────────────────────
// 同一個 Cloudflare Worker 同時做兩件事：
//   · 前端（public/）由 Workers Static Assets 直接送出，不會進到這支程式，也不計費
//   · 只有 /ws 和 /health 會叫醒這支 Worker
//
// 伺服器「不跑物理、不存地形」，只負責：
//   1. 發給同房間的所有人同一個 seed（地形由前端自己生成）
//   2. 把每個人的座標轉送給同房間的其他人
//   3. 記錄本房最佳成績
// 用 WebSocket Hibernation API，沒人講話時 DO 會休眠、不計費。

const MAX_PLAYERS = 12;      // 一間房上限
const MAX_MSG_BYTES = 2048;  // 單則訊息大小上限
const MSG_PER_SEC = 40;      // 每人每秒訊息上限（超過直接丟棄）
const BOARD_SIZE = 10;
const STATES = new Set(['run', 'idle', 'air', 'fall', 'wall', 'dead']);
const SKINS = new Set(['orangin', 'tabby', 'calico']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, ts: Date.now() });
    }

    if (url.pathname === '/ws') {
      const room = cleanRoom(url.searchParams.get('room'));
      const id = env.ROOMS.idFromName(room);
      return env.ROOMS.get(id).fetch(request);
    }

    // 其他路徑：靜態檔案存在的話根本不會走到這裡
    return new Response('Not found', { status: 404, headers: CORS });
  },
};

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.latest = new Map(); // id -> 最後一次座標（純記憶體，休眠後掉了也沒關係）
    this.rate = new Map();   // id -> 速率限制計數
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= MAX_PLAYERS) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      server.send(JSON.stringify({ t: 'full', max: MAX_PLAYERS }));
      server.close(1013, 'room full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const url = new URL(request.url);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const id = crypto.randomUUID().slice(0, 8);
    const name = cleanName(url.searchParams.get('name'));
    const skin = cleanSkin(url.searchParams.get('skin'));

    // Hibernation API：接手這條連線，之後由 webSocketMessage/Close 回呼處理
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, name, skin });

    const seed = await this.getSeed();
    const board = (await this.ctx.storage.get('board')) || [];
    const players = [];
    for (const ws of sockets) {
      const a = safeAttach(ws);
      if (a) players.push({ id: a.id, name: a.name, skin: a.skin || 'orangin', ...(this.latest.get(a.id) || {}) });
    }

    server.send(JSON.stringify({ t: 'welcome', id, seed, players, board, max: MAX_PLAYERS }));
    this.broadcast({ t: 'join', id, name, skin }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_MSG_BYTES) return;
    const a = safeAttach(ws);
    if (!a) return;
    if (!this.allow(a.id)) return;

    let m;
    try { m = JSON.parse(message); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    switch (m.t) {
      case 's': {
        const s = {
          t: 's',
          id: a.id,
          name: a.name,
          x: num(m.x),
          y: num(m.y),
          f: m.f === -1 ? -1 : 1,
          st: STATES.has(m.st) ? m.st : 'air',
          k: a.skin || 'orangin',
          d: num(m.d),
          c: num(m.c),
        };
        this.latest.set(a.id, { x: s.x, y: s.y, f: s.f, st: s.st, d: s.d, c: s.c });
        this.broadcast(s, ws);
        break;
      }

      case 'skin': {
        // 換花色：改寫 attachment（休眠後還在），再廣播一次讓別人更新
        const next = cleanSkin(m.s);
        if (next === a.skin) return;
        ws.serializeAttachment({ id: a.id, name: a.name, skin: next });
        this.broadcast({ t: 'join', id: a.id, name: a.name, skin: next }, ws);
        break;
      }

      case 'ping':
        try { ws.send(JSON.stringify({ t: 'pong', ts: m.ts })); } catch { /* ignore */ }
        break;

      case 'score':
        await this.recordScore(a.name, num(m.d), num(m.c));
        break;

      case 'reseed': {
        // 只有房間裡剩自己一個人時才能換地形，避免打斷別人
        if (this.ctx.getWebSockets().length > 1) return;
        const seed = randSeed();
        await this.ctx.storage.put('seed', seed);
        await this.ctx.storage.put('board', []);
        this.broadcast({ t: 'seed', seed });
        this.broadcast({ t: 'board', list: [] });
        break;
      }
    }
  }

  webSocketClose(ws) { this.dropped(ws); }
  webSocketError(ws) { this.dropped(ws); }

  dropped(ws) {
    const a = safeAttach(ws);
    if (!a) return;
    this.latest.delete(a.id);
    this.rate.delete(a.id);
    this.broadcast({ t: 'leave', id: a.id }, ws);
  }

  // ── 工具 ────────────────────────────────────────────
  broadcast(obj, except) {
    const payload = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(payload); } catch { /* 對方已離線 */ }
    }
  }

  allow(id) {
    const now = Date.now();
    let r = this.rate.get(id);
    if (!r || now - r.t > 1000) { r = { n: 0, t: now }; this.rate.set(id, r); }
    r.n++;
    return r.n <= MSG_PER_SEC;
  }

  async getSeed() {
    let s = await this.ctx.storage.get('seed');
    if (typeof s !== 'number') {
      s = randSeed();
      await this.ctx.storage.put('seed', s);
    }
    return s;
  }

  async recordScore(name, dist, coins) {
    // 分數是前端回報的，這裡只做基本上限，不是防作弊
    if (!(dist > 0) || dist > 1e6) return;
    coins = Math.max(0, Math.min(1e6, coins));
    const board = (await this.ctx.storage.get('board')) || [];
    const mine = board.find((e) => e.name === name);
    if (mine) {
      if (dist <= mine.dist) return; // 沒進步就不寫入（省 storage 額度）
      mine.dist = dist;
      mine.coins = coins;
      mine.at = Date.now();
    } else {
      if (board.length >= BOARD_SIZE && dist <= board[board.length - 1].dist) return;
      board.push({ name, dist, coins, at: Date.now() });
    }
    board.sort((x, y) => y.dist - x.dist);
    const list = board.slice(0, BOARD_SIZE);
    await this.ctx.storage.put('board', list);
    this.broadcast({ t: 'board', list });
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
}

function safeAttach(ws) {
  try { return ws.deserializeAttachment(); } catch { return null; }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-1e7, Math.min(1e7, Math.round(n))) : 0;
}

function randSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

function cleanRoom(v) {
  // 房名可以用中文，只擋掉控制字元和會影響網址的符號
  const s = String(v || 'lobby').trim().replace(/[\u0000-\u001f\s/?#&=]/g, '').slice(0, 24);
  return s || 'lobby';
}

function cleanSkin(v) {
  const s = String(v || '');
  return SKINS.has(s) ? s : 'orangin';
}

function cleanName(v) {
  const s = String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
  return s || '無名跑者';
}
