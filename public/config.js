// ── 前端設定 ────────────────────────────────────────────
// 前端和 WebSocket 伺服器是「同一個 Cloudflare Worker」，所以
// 這裡通常什麼都不用改 —— 連線會自動指向目前這個網域的 /ws。
//
// 只有在你想把前端另外放（例如本機 file:// 開啟、或另一個網域）時，
// 才需要填 WS_URL，或在網址加參數：
//   index.html?server=wss://coparkour.你的帳號.workers.dev
//   index.html?solo=1     ← 強制單機，不連線
window.GAME_CONFIG = {
  WS_URL: '', // 留空 = 用目前的網域
  DEFAULT_ROOM: 'lobby',
};
