import { NET } from './constants.js';

// 與 Cloudflare Worker（Durable Object）之間的 WebSocket 連線。
// 伺服器只做三件事：發房間 seed、轉送別人的座標、記排行榜。
import { DEFAULT_LOOK } from './cat/looks.js';

export class Net {
  constructor({ url, room, name, look, on }) {
    this.baseUrl = url;
    this.room = room;
    this.name = name;
    this.look = look || DEFAULT_LOOK;
    this.on = on || {};
    this.ws = null;
    this.id = null;
    this.retry = 0;
    this.closed = false;
    this.lastSent = 0;
    this.pingTimer = null;
    this.rtt = null;
  }

  get connected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  connect() {
    if (this.closed) return;
    let u;
    try {
      u = new URL(this.baseUrl);
    } catch {
      this.emit('status', 'bad-url');
      return;
    }
    u.protocol = u.protocol === 'http:' ? 'ws:' : u.protocol === 'https:' ? 'wss:' : u.protocol;
    if (!u.pathname.endsWith('/ws')) u.pathname = u.pathname.replace(/\/$/, '') + '/ws';
    u.searchParams.set('room', this.room);
    u.searchParams.set('name', this.name);
    // 線上的欄位名維持 skin，值是 look：換掉會跟舊的伺服器與舊分頁對不上。
    u.searchParams.set('skin', this.look);

    this.emit('status', 'connecting');
    const ws = new WebSocket(u.toString());
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.emit('status', 'online');
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: Date.now() }), NET.pingMs);
    };

    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') {
        this.id = m.id;
        this.emit('welcome', m);
      } else if (m.t === 'pong') {
        this.rtt = Date.now() - m.ts;
      } else {
        this.emit(m.t, m);
      }
    };

    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.closed) return;
      this.emit('status', 'offline');
      this.retry = Math.min(this.retry + 1, 6);
      setTimeout(() => this.connect(), 400 * Math.pow(1.8, this.retry));
    };

    ws.onerror = () => { /* onclose 會接手重連 */ };
  }

  emit(t, m) {
    const fn = this.on[t];
    if (fn) fn(m);
  }

  send(obj) {
    if (!this.connected) return;
    try { this.ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
  }

  // 節流後送出自己的位置
  sendState(p, now, st) {
    // 死掉在看結算畫面時降到 1Hz，省免費額度
    const interval = p.dead ? 1000 : 1000 / NET.sendHz;
    if (now - this.lastSent < interval) return;
    this.lastSent = now;
    this.send({
      t: 's',
      x: Math.round(p.x),
      y: Math.round(p.y),
      f: p.facing,
      st: st || (p.dead ? 'dead' : p.grounded ? 'run' : 'air'),
      d: p.dist,
      c: p.coins,
    });
  }

  /** 換花色。只在改變時送一次，不進每幀的狀態封包。 */
  setLook(s) {
    this.look = s;
    this.send({ t: 'skin', s });
  }

  sendScore(dist, coins, reason) {
    this.send({ t: 'score', d: dist, c: coins, r: reason });
  }

  requestReseed() {
    this.send({ t: 'reseed' });
  }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    if (this.ws) try { this.ws.close(); } catch { /* ignore */ }
  }
}

// 幽靈玩家：收到的是 10Hz 的離散座標，這裡做延遲插值讓移動變滑順
export class GhostPool {
  constructor() { this.map = new Map(); }

  upsert(id, name, look) {
    if (!this.map.has(id)) {
      this.map.set(id, {
        id, name, look: look || DEFAULT_LOOK,
        buf: [], dist: 0, coins: 0, state: 'air', facing: 1,
      });
    }
    const g = this.map.get(id);
    if (name) g.name = name;
    if (look) g.look = look;
    return g;
  }

  onState(m) {
    const g = this.upsert(m.id, m.name, m.k);
    const prev = g.buf[g.buf.length - 1];
    // 對方重新開始（位置瞬間跳回起點）就不要插值，直接瞬移
    if (prev && Math.abs(m.x - prev.x) > 400) g.buf.length = 0;
    g.buf.push({ t: performance.now(), x: m.x, y: m.y, f: m.f, st: m.st });
    if (g.buf.length > 24) g.buf.shift();
    g.dist = m.d ?? g.dist;
    g.coins = m.c ?? g.coins;
    g.state = m.st || g.state;
    g.facing = m.f || g.facing;
    g.lastSeen = performance.now();
  }

  remove(id) { this.map.delete(id); }
  clear() { this.map.clear(); }

  // 排行榜用：所有還在線上的人（包含已經摔死、正在等重來的）
  roster(now) {
    const out = [];
    for (const g of this.map.values()) {
      if (now - (g.lastSeen || 0) > NET.staleMs) continue;
      out.push({ id: g.id, name: g.name, look: g.look, dist: g.dist || 0, coins: g.coins || 0, state: g.state });
    }
    return out;
  }

  // 畫面用：可以畫出來的幽靈（死掉的先不畫）
  sample(now) {
    const out = [];
    const target = now - NET.interpDelay;
    for (const g of this.map.values()) {
      if (!g.buf.length) continue;
      if (now - (g.lastSeen || 0) > NET.staleMs) continue;
      if (g.state === 'dead') continue;
      const buf = g.buf;
      let a = buf[0], b = buf[buf.length - 1];
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].t <= target && buf[i + 1].t >= target) { a = buf[i]; b = buf[i + 1]; break; }
      }
      const span = b.t - a.t;
      const k = span > 0 ? Math.max(0, Math.min(1, (target - a.t) / span)) : 1;
      // 步頻要用速度，而不是用時間——不然腳會打滑
      const vx = span > 0 ? Math.abs((b.x - a.x) / span) * 1000 : 0;
      // vy 要帶正負號（往下為正）：尾巴靠它知道自己在上升還是下墜
      const vy = span > 0 ? ((b.y - a.y) / span) * 1000 : 0;
      out.push({
        vx,
        vy,
        id: g.id,
        name: g.name,
        look: g.look,
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        facing: b.f || 1,
        state: b.st || 'air',
        dist: g.dist,
        coins: g.coins,
      });
    }
    return out;
  }
}
