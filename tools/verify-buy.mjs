// 端對端：真的開一個瀏覽器，把整條購買動線跑一遍——
//   走到 NPC 旁邊 → 點兩下買下重生點 → 死掉從那裡重生 → 牠定居在那塊板子上，
// 外加兩件用單元測試看不到的事：跑動中點擊不會被吃掉，以及兩個分頁看到同一隻 NPC 在同一個地方。
//
// 這一支不進 CI（要有瀏覽器跟伺服器），是改動購買流程時自己跑的。用法：
//   npx wrangler dev
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/pk1 http://localhost:8787/
//   chrome --headless=new --remote-debugging-port=9223 --user-data-dir=/tmp/pk2 http://localhost:8787/   ← 選配，同步檢查要用
//   node tools/verify-buy.mjs
//
// 為什麼是兩個瀏覽器而不是兩個分頁：背景分頁不跑 requestAnimationFrame，
// 整個遊戲迴圈都停著——那不是不同步，是根本沒在跑。
const PORT = 9222;
const PORT2 = 9223;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('8787'));
if (!page) { console.log('找不到分頁', targets.map((t) => t.url)); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
};
const send = (method, params) => new Promise((res) => {
  const n = ++id;
  waiting.set(n, res);
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 等到 NPC 站定：一個時槽 6 秒，前 2 秒在移動，之後都站著
const waitIdle = async () => {
  for (let i = 0; i < 60; i++) {
    const ok = await evalJs(`(() => {
      const P = __parkour, n = P.npcs.list()[0];
      if (!n || !n.p.grounded) return false;
      const t = P.npcs.worldTime();
      return t - Math.floor(t / 6) * 6 > 2.6;
    })()`);
    if (ok) return true;
    await sleep(250);
  }
  return false;
};
// 摔死了就重來。測試中會刻意讓玩家跑動（驗誤觸守則），跑一跑掉下去是正常的，
// 但死掉之後主迴圈會停，後面什麼都測不了。
const ensureAlive = async () => {
  if (!(await evalJs(`__parkour.player.dead || !__parkour.running`))) return;
  await evalJs(`__parkour.restart()`);
  await sleep(300);
  await evalJs(TELEPORT);
  await sleep(900);
};

// 站到第一隻 NPC 旁邊、同一塊板子上
const standNextTo = () => evalJs(`(() => {
  const P = __parkour, n = P.npcs.list()[0];
  if (!n) return false;
  const pl = n.target.p;
  P.player.dead = false;
  P.player.x = Math.max(pl.x + 2, Math.min(pl.x + pl.w - 28, n.cx - 34));
  P.player.y = pl.y - 44;
  P.player.vx = 0; P.player.vy = 0;
  return true;
})()`);
const step = (msg, ok) => console.log(`${ok ? '✓' : '✗'} ${msg}`);
let bad = 0;
const check = (msg, ok) => { step(msg, ok); if (!ok) bad++; };

// 乾淨的起點。重生點與錢包是「房間」的狀態——單機記在 localStorage，連線記在伺服器上，
// 所以每次跑都換一間新房間，不然第二次跑會撞上第一次買下的那隻。
const ROOM = 'buytest' + Date.now().toString(36);
const URL0 = `http://localhost:8787/?room=${ROOM}`;
await evalJs(`localStorage.clear(); location.href = ${JSON.stringify(URL0)};`);
await sleep(2000);
await evalJs(`document.getElementById('startBtn').click()`);
await sleep(700);
// 連上線之後伺服器才發 seed，關卡會重建一次；等它塵埃落定再開始動手腳
for (let i = 0; i < 40; i++) {
  if (await evalJs(`!!(__parkour.net && __parkour.net.connected) || !__parkour.net`)) break;
  await sleep(250);
}
await sleep(500);
check('開始跑', await evalJs(`!!(window.__parkour && __parkour.player && !__parkour.player.dead)`));

// 傳送到第一隻 NPC 的家附近。一定要落在真的板子上——懸空的話會一路掉出世界摔死，
// 死了之後主迴圈就停了（running=false），後面什麼都測不成。
const TELEPORT = `(() => {
  const P = __parkour;
  P.level.ensure(14000);
  let b = null;
  P.level.forEachPlatform(8000, 14000, (pl) => {
    if (pl.h >= 60 || pl.w < 100) return;
    if (!b || Math.abs(pl.x - 10000) < Math.abs(b.x - 10000)) b = pl;
  });
  if (!b) return false;
  P.player.dead = false;
  P.player.x = b.x + 20; P.player.y = b.y - 44;
  P.player.vx = 0; P.player.vy = 0; P.cam.init = false;
  return true;
})()`;
check('傳送到 NPC 的家附近', await evalJs(TELEPORT));
await sleep(900);
const n0 = await evalJs(`(() => { const l = __parkour.npcs.list(); return l.length ? { i: l[0].i, x: l[0].cx, y: l[0].cy } : null; })()`);
check('NPC 生出來了 ' + JSON.stringify(n0), !!n0);

// 馬上踩到實地上：懸空的話會一路掉到世界外面摔死，接下來什麼都測不了
await standNextTo();
await waitIdle();       // 一個時槽 6 秒，前 2 秒在移動——等牠站定再談生意
await standNextTo();
await evalJs(`__parkour.giveCoins(80)`);
await sleep(400);
const still = await evalJs(`(() => { const p = __parkour.player; return { g: p.grounded, vx: Math.round(p.vx), coins: p.coins }; })()`);
check('玩家站定在旁邊 ' + JSON.stringify(still), still.g && Math.abs(still.vx) < 8);

// ── 跑動中的點擊一定要放行 ──────────────────────────────
// 這是這個功能唯一可能傷到既有操作的地方：跑到一半誤觸如果被當成「跟 NPC 講話」，
// 那一次左右操作就被偷走了。所以按著方向鍵的時候，同一個位置點下去必須什麼都不發生。
// 這一段一定要排在購買之前——買完之後那隻就有主人了，點下去本來就不會跳邀請。
// （宣告在下面，這裡只是說明順序）

// 螢幕位置每一幀都在動（鏡頭的縮放是連續的），所以每次點之前重算
const where = () => evalJs(`(() => {
  const P = __parkour, n = P.npcs.list()[0];
  const c = document.getElementById('ui').getBoundingClientRect();
  const z = P.cam.zoom;
  return { x: Math.round((n.cx - Math.round(P.cam.x)) * z + c.left), y: Math.round((n.cy - Math.round(P.cam.y)) * z + c.top) };
})()`);
const clickOn = async (i) => {
  const pt = await evalJs(`(() => {
    const P = __parkour, n = P.npcs.list().find((q) => q.i === ${i});
    const c = document.getElementById('ui').getBoundingClientRect();
    const z = P.cam.zoom;
    return { x: Math.round((n.cx - Math.round(P.cam.x)) * z + c.left), y: Math.round((n.cy - Math.round(P.cam.y)) * z + c.top) };
  })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  }
};

const click = async () => {
  const pt = await where();
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  }
};

// 講話的條件是「牠站著、我也站著、而且靠得夠近」——所以每次點之前都重新對位。
// 這不是在繞過規則，是在把測試放到規則成立的那一刻：真人也是走到牠旁邊等牠停下來才點的。
const talkClick = async () => {
  await ensureAlive();
  await waitIdle();
  await standNextTo();
  await sleep(260);
  await click();
};
// 先驗「跑動中點不到」，再驗「站定就點得到」——順序不能反，買完就沒有乾淨的對照組了
await waitIdle();
await standNextTo();
await sleep(260);
await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ArrowRight', key: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
await sleep(150);
await click();
await sleep(150);
const held = await evalJs(`(() => {
  const P = __parkour, n = P.npcs.list()[0];
  return { axis: P.input.axis, invite: !!n && n.invite > 0 };
})()`);
await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ArrowRight', key: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
check(`跑動中（搖桿 ${held.axis}）點擊不會被吃掉`, held.axis !== 0 && !held.invite);
await sleep(300);

await talkClick();
await sleep(200);
const invited = await evalJs(`(() => { const n = __parkour.npcs.list()[0]; return { invite: n.invite > 0, says: n.says }; })()`);
check('第一下：跳出購買邀請「' + invited.says + '」', invited.invite);

// 第二下：成交
await talkClick();
await sleep(400);
const bought = await evalJs(`(() => {
  const P = __parkour, n = P.npcs.list()[0];
  const o = n.owner;
  return { owner: o ? o.name : null, x: o ? o.x : 0, y: o ? o.y : 0, says: n.says, wallet: P.wallet };
})()`);
check('第二下：成交，主人是「' + bought.owner + '」餘額 ' + bought.wallet, !!bought.owner);

// 重生點該是那塊板子的中心與頂面
const spot = await evalJs(`(() => {
  const P = __parkour, n = P.npcs.list()[0], o = n.owner;
  const pl = P.npcs.platformAt(o.x, o.y);
  return pl ? { ok: Math.abs(pl.x + pl.w / 2 - o.x) < 1 && Math.abs(pl.y - o.y) < 1, w: Math.round(pl.w) } : null;
})()`);
check('重生點 = 板子中心 + 頂面（板寬 ' + (spot && spot.w) + '）', !!spot && spot.ok);

// 掉下去看看會不會從重生點重生
await evalJs(`(() => { const p = __parkour.player; p.y = 3000; })()`);
await sleep(400);
await evalJs(`__parkour.restart()`);
await sleep(400);
const reborn = await evalJs(`(() => {
  const P = __parkour, o = P.npcs.list().find((q) => q.owner)?.owner;
  return { px: Math.round(P.player.x), spawn: o ? Math.round(o.x) : null, dist: P.player.dist };
})()`);
check(`從重生點出生（x=${reborn.px} 重生點=${reborn.spawn} 里程=${reborn.dist}m）`,
  reborn.spawn !== null && Math.abs(reborn.px - reborn.spawn) < 30 && reborn.dist > 900);

// ── 兩個瀏覽器看到同一件事 ──────────────────────────────
// NPC 的座標一個位元組都沒有經過網路，這一條驗的就是「不傳座標，大家還是看到同一件事」。
let other = null;
try {
  const ts2 = await (await fetch(`http://127.0.0.1:${PORT2}/json`)).json();
  other = ts2.find((t) => t.type === 'page' && t.url.includes('8787'));
} catch { /* 沒開第二個瀏覽器就跳過 */ }

if (other) {
  const w2 = new WebSocket(other.webSocketDebuggerUrl);
  await new Promise((r) => (w2.onopen = r));
  let id2 = 0; const wait2 = new Map();
  w2.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait2.has(m.id)) { wait2.get(m.id)(m); wait2.delete(m.id); } };
  const ev2 = (x) => new Promise((res) => { const n = ++id2; wait2.set(n, res); w2.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression: x, returnByValue: true } })); })
    .then((r) => r.result?.result?.value);
  const until2 = async (expr, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      if (await ev2(expr)) return true;
      await sleep(250);
    }
    return false;
  };

  await ev2(`localStorage.clear(); location.href = ${JSON.stringify(URL0)};`);
  const loaded = await until2(`!!(window.__parkour && document.getElementById('startBtn'))`);
  await ev2(`document.getElementById('startBtn').click()`);
  const started = await until2(`!!(window.__parkour.player && window.__parkour.running)`);
  // 連上線之後伺服器才會發 seed，那一刻整個關卡會被重建、玩家也會被重置——
  // 在那之前傳送過去等於白傳
  await until2(`!!(__parkour.net && __parkour.net.connected) || !__parkour.net`);
  await sleep(500);
  // 帶到同一個地方，讓同一隻 NPC 在兩邊都被材質化
  await ev2(`(() => {
    const P = __parkour;
    P.level.ensure(14000);
    let b = null;
    P.level.forEachPlatform(8000, 14000, (pl) => {
      if (pl.h >= 60 || pl.w < 100) return;
      if (!b || Math.abs(pl.x - 10000) < Math.abs(b.x - 10000)) b = pl;
    });
    if (!b) return false;
    P.player.x = b.x + 20; P.player.y = b.y - 44; P.player.vx = 0; P.player.vy = 0; P.cam.init = false;
    return true;
  })()`);
  const spawned = await until2(`__parkour.npcs.list().length > 0`);
  check(`第二個瀏覽器進得了同一間房（載入 ${loaded} 開跑 ${started} 看得到 NPC ${spawned}）`,
    loaded && started && spawned);

  // 待機段才比：移動中的那 2 秒本來就允許有幾 px 的差（槽尾會收斂回來）
  await until2(`(() => { const t = __parkour.npcs.worldTime(); return t - Math.floor(t / 6) * 6 > 3; })()`);
  const snap = `(() => {
    const P = __parkour, t = P.npcs.worldTime();
    const n = P.npcs.list()[0];
    return n ? { i: n.i, x: Math.round(n.x * 100) / 100, y: Math.round(n.y * 100) / 100,
      tIn: Math.round((t - Math.floor(t / 6) * 6) * 10) / 10 } : null;
  })()`;
  const A = await evalJs(snap);
  const B = await ev2(snap);
  const same = A && B && A.i === B.i && Math.abs(A.x - B.x) < 1 && Math.abs(A.y - B.y) < 1;
  check(`兩邊的 NPC 在同一個地方 A=${JSON.stringify(A)} B=${JSON.stringify(B)}`, !!same);

  // 買下來的那一隻，另一邊也要看得到主人
  const owner2 = await ev2(`(() => { const n = __parkour.npcs.list()[0]; return n && n.owner ? n.owner.name : null; })()`);
  check(`另一邊也看得到牠的主人：${owner2}`, !!owner2);
  w2.close();
} else {
  console.log(`· 沒有第二個瀏覽器（127.0.0.1:${PORT2}），跳過同步檢查`);
}

// ── 定居 ────────────────────────────────────────────────
// 成交是在「下一個時槽」生效的（那一刻全房間同步切換），所以要等過了那個槽才驗。
await evalJs(`(async () => {
  const P = __parkour;
  for (let i = 0; i < 60; i++) {
    const n = P.npcs.list().find((q) => q.owner);
    if (n && Math.floor(P.npcs.worldTime() / 6) > P.npcs.slotOf(n.owner) + 1) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
})()`);
const settled = await evalJs(`(() => {
  const P = __parkour, n = P.npcs.list().find((q) => q.owner);
  if (!n) return null;
  const home = P.npcs.platformAt(n.owner.x, n.owner.y);
  return {
    onHome: !!home && n.target.p === home,
    grounded: n.p.grounded,
    w: home ? Math.round(home.w) : null,
  };
})()`);
check(`定居在買下的那塊板子上（板寬 ${settled && settled.w}）`, !!settled && settled.onHome);

// 再看兩個時槽，牠不該離開那塊板子，也不該跳起來
const stayed = await evalJs(`(async () => {
  const P = __parkour, n = P.npcs.list().find((q) => q.owner);
  const home = P.npcs.platformAt(n.owner.x, n.owner.y);
  let jumped = false, left = false;
  for (let i = 0; i < 140; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const m = P.npcs.list().find((q) => q.i === n.i);
    if (!m || !m.ready) continue;
    if (m.p.vy < -1) jumped = true;
    if (m.cx < home.x - 2 || m.cx > home.x + home.w + 2) left = true;
  }
  return { jumped, left };
})()`);
check('兩個時槽內牠沒跳、也沒離開那塊板子', !!stayed && !stayed.jumped && !stayed.left);

console.log(bad === 0 ? '\n全部通過' : `\n${bad} 個問題`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
