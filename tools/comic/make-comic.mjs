/* ── tools/comic/make-comic.mjs ──────────────────────────────────────
   把漫畫的每一格拍成圖：public/test/comic/<id>.png（id 是 shots.js 那一格）。

   拍照的是攝影棚（studio.html／studio.js，就在這個資料夾），它用的是遊戲本身的渲染器——
   角色、著色、墨線跟遊戲裡一模一樣。這台機器沒有 headless WebGL 給 node 用，所以開一個
   無頭 Chrome（軟體 GL：SwiftShader）來拍：這支起一個靜態伺服器，供 public/（遊戲的
   模組與 cat.bin）以及這個資料夾（在 /studio/ 底下），用 DevTools 協定叫頁面上的
   window.comic.render(id)，把回來的 PNG 存檔。攝影棚因此不在網站上、不會被部署。

   跑法：node tools/comic/make-comic.mjs [id …]   不給 id 就全部重拍
         node tools/comic/make-comic.mjs --serve  只起伺服器，印出攝影棚的網址，用瀏覽器打開來看
   Chrome 不在預設位置的話：CHROME=/path/to/chrome node tools/comic/make-comic.mjs
   ------------------------------------------------------------------ */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 這個資料夾（攝影棚在這裡），與遊戲的 public/。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', 'public');
const OUT = path.join(ROOT, 'test', 'comic');
const PORT = 9333;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.bin': 'application/octet-stream',
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
};
/* /studio/… 是這個資料夾（首頁是 studio.html），其餘的是 public/。 */
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  const studio = p === '/studio' || p.startsWith('/studio/');
  const base = studio ? HERE : ROOT;
  if (studio) p = p.slice('/studio'.length) || '/';
  if (p.endsWith('/')) p += studio ? 'studio.html' : 'index.html';
  const f = path.join(base, p);
  if (!f.startsWith(base)) { r.writeHead(403); r.end(); return; }
  fs.readFile(f, (e, d) => {
    if (e) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    r.end(d);
  });
}).listen(process.argv.includes('--serve') ? 8790 : 0);
const site = `http://127.0.0.1:${server.address().port}`;

if (process.argv.includes('--serve')) {
  console.log(`攝影棚：${site}/studio/   （← → 換一格；Ctrl+C 結束）`);
  await new Promise(() => {});
}

const CHROMES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const chromePath = CHROMES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error('找不到 Chrome：用 CHROME=/path/to/chrome 指定');
  process.exit(1);
}


const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'make-comic-'));
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--user-data-dir=${profile}`, '--window-size=800,600', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 收掉 Chrome 與伺服器、結束。回傳一個不會完成的 promise：await 它，後面的就不會再跑。 */
const done = (code) => {
  chrome.kill();
  server.close();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome 還沒放手 */ } process.exit(code); }, 300);
  return new Promise(() => {});
};

let ws = null;
for (let i = 0; i < 100 && !ws; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch { /* 還沒起來 */ }
  if (!ws) await sleep(200);
}
if (!ws) { console.error('Chrome 沒有起來'); await done(1); }
await new Promise((r) => ws.addEventListener('open', r));

let seq = 0;
const waiting = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') console.error('頁面出錯：', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    console.error('頁面出錯：', m.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});
const send = (method, params = {}) => new Promise((r) => {
  const id = ++seq;
  waiting.set(id, r);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate 失敗');
  return r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `${site}/studio/` });
let ids = null;
for (let i = 0; i < 600 && !ids; i++) {
  ids = await evaluate('window.comic ? window.comic.ids : null').catch(() => null);
  if (!ids) await sleep(200);
}
if (!Array.isArray(ids)) { console.error('攝影棚沒有準備好'); await done(1); }

const want = process.argv.slice(2);
const todo = want.length ? ids.filter((id) => want.includes(id)) : ids;
const unknown = want.filter((id) => !ids.includes(id));
if (unknown.length) console.error(`沒有這幾格：${unknown.join('、')}`);

fs.mkdirSync(OUT, { recursive: true });
for (const id of todo) {
  const url = await evaluate(`window.comic.render(${JSON.stringify(id)})`);
  const png = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  fs.writeFileSync(path.join(OUT, `${id}.png`), png);
  console.log(`${id}.png  ${(png.length / 1024).toFixed(0)} KB`);
}
ws.close();
await done(unknown.length ? 1 : 0);
