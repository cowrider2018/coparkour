import { PLAYER_W, PLAYER_H, WORLD, VIEW } from './constants.js';
import { COIN_R } from './level.js';
import { css, shade, mix3, skyBands, LOW_GLOW } from './gfx/daycycle.js';
import { makeCell, field, gust } from './gfx/field.js';

// ── 世界的 albedo ───────────────────────────────────────────
// 全部是 linear，經過 daycycle 的 shade() 打光、acesTone() 落地。
// 直接拿這些數字當 CSS 顏色會又亮又灰——見計畫書的地雷 01。
const NEON = [0.368, 0.949, 0.753];   // 平台上緣的霓虹燈條，自發光
const ALB = {
  platTop:  [0.130, 0.520, 0.360],
  platBody: [0.028, 0.062, 0.098],
  platEdge: [0.055, 0.150, 0.180],
  spike:    [0.620, 0.110, 0.150],
  coin:     [0.720, 0.480, 0.090],
  self:     [0.130, 0.520, 0.360],
  ghost:    [0.180, 0.290, 0.560],
};

export class Camera {
  constructor() {
    this.x = 0; this.y = 0; this.init = false;
    this.zoom = 1;
    this.zVel = 0;    // 視距的變化速度。等加速度控制器的狀態，不是每幀重算的
    this.refY = 0;    // 量落腳點高低差的基準面：最後一次踩到地面／貼到牆的高度
  }

  // ── 動態視距 ────────────────────────────────────────
  // 左右各取最近的 VIEW.count 個落腳點，每一個都要在自己的允許範圍內：最緊的那一檔
  // 要落在邊界內側 5% 處（門檻 95%），往後每退一檔放寬 5%。取最嚴的那一條。
  //
  // 量的是錨點到「乾淨區」邊界的距離（扣掉 ins 的操作列），不是到畫布邊界——
  // 不然辛苦框進來的板子會被手把蓋住，等於沒框。
  // 落腳點的搜尋半徑用 zoomBase 推出來的原始寬度無關，是固定的 VIEW.span：
  // 需求只跟地形長什麼樣有關，不跟當下的 zoom 有關，才不會自我回授。
  fitZoom(level, p, W, H, zoomBase, fx, fy, ins, dt) {
    // 死了就凍住：屍體會一路掉到 respawnY，再照規則算下去會把整個世界縮到最小。
    if (p.dead && this.init) return this.zoom;
    const fU = Math.max(0.05, fy - ins.t);        // 錨點到乾淨區上緣，佔畫面高的幾成
    const fD = Math.max(0.05, (1 - ins.b) - fy);  // 錨點到乾淨區下緣
    level.ensure(p.x + VIEW.span);

    // 參考高度只在「踩到地面或貼著牆」時更新。用即時的 p.y 會讓落差跟著每一次跳躍的
    // 拋物線上下擺，於是一路往同一個方向跑也會不停來回縮放。
    if (!this.init || p.grounded || p.wallDir) this.refY = p.y;

    // 量測的基準面不能只有地形。只用 refY 的話，貓原地跳起來時地形一動也沒動，
    // 需求就完全不變——那 boostUp 根本無事可做。把基準面往貓的實際高度拉 catWeight：
    // 貓離畫面中心越遠，下方（或上方）的落腳點在畫面上就被擠得越靠邊，
    // 需求本來就該跟著變。0.5 ＝ 地形與貓各半。
    const refEff = this.refY + (p.y - this.refY) * VIEW.catWeight;

    // 一個落腳點「有多難框」：落差除以那一側可用的畫面比例。
    // 除以 f 是必要的——上下可用的空間不一樣（fU / fD），純比落差會把往上 300
    // 跟往下 300 當成一樣難，實際上往下難得多。
    const hard = (dy) => (dy < 0 ? -dy / fU : dy / fD);

    // dy <= (base + i*slack) * f * (H / zoom)，解出 zoom 的上限。
    // i 不是「第幾近」而是「第幾難」——最近的 reorder 個先依 hard() 由難到易重排，
    // 難的拿緊的門檻。最近的那個若被排到後面，代表它落差本來就小，
    // 那條限制根本不會咬，所以重排不會讓它掉出畫面。
    let need = zoomBase;
    const fit = (list) => {
      const n = list.length;
      const k = Math.min(VIEW.reorder, n);
      const ord = [];
      for (let i = 0; i < k; i++) ord.push(i);
      ord.sort((a, b) => hard(list[b]) - hard(list[a]));
      for (let i = 0; i < n; i++) {
        const v = i < k ? list[ord[i]] : list[i];
        const dy = v < 0 ? -v : v;
        if (dy < 1) continue;
        const zi = (VIEW.base + i * VIEW.slack) * (v < 0 ? fU : fD) * H / dy;
        if (zi < need) need = zi;
      }
    };
    const fh = level.footholdsAround(p, refEff, VIEW.count, VIEW.span);
    fit(fh.left);
    fit(fh.right);
    need = Math.max(VIEW.minZoom, Math.min(zoomBase, need));

    if (!this.init) { this.zoom = need; this.zVel = 0; return need; }

    // 等加速度：加速度大小永遠是 VIEW.accel，只有方向會變。
    // 方向不能單看「當前比需求大還是小」——那是單擺，會永遠繞著需求來回盪。
    // 要看的是「以現在的速度還煞不煞得住」：煞車距離 v²/2a 夠不到就繼續加速，
    // 追過頭了就反向。這仍然是同一個等加速度，只是提前轉向，所以停得下來。
    // 加速度的「大小」隨貓的垂直速度放大——貓正在上升或墜落，就是視野需求變動最快的時候，
    // 這時候讓縮放跟著加速。放大的只有量值，方向仍然由下面的煞車距離決定，
    // 所以不會因為它而過衝。上升與下落各有自己的量，最高點與落地都自動歸零。
    const vy = p.vy < 0 ? -p.vy : p.vy;
    const a = VIEW.accel * (1 + (p.vy < 0 ? VIEW.boostUp : VIEW.boostDown)
      * Math.min(1, vy / VIEW.boostRef));
    const err = need - this.zoom;
    const v = this.zVel;
    const brake = v * v / (2 * a);
    const closing = (v > 0 && err > 0) || (v < 0 && err < 0);
    const dir = closing && brake >= (err < 0 ? -err : err) ? (v > 0 ? -1 : 1)
      : (err > 0 ? 1 : err < 0 ? -1 : 0);
    this.zVel = v + dir * a * dt;
    this.zoom += this.zVel * dt;

    // 到站就熄火：殘量小於這一幀走得動的距離時直接歸位，免得在需求值上抖。
    const step = a * dt * dt;
    if ((need - this.zoom) * err <= 0 && (this.zVel < 0 ? -this.zVel : this.zVel) <= a * dt + step) {
      this.zoom = need; this.zVel = 0;
    }
    if (this.zoom > zoomBase) { this.zoom = zoomBase; if (this.zVel > 0) this.zVel = 0; }
    if (this.zoom < VIEW.minZoom) { this.zoom = VIEW.minZoom; if (this.zVel < 0) this.zVel = 0; }
    return this.zoom;
  }

  // fx / fy 是「玩家該落在畫面的幾成」。開手把時操作列吃掉兩側（或上下），
  // main.js 就把這兩個值往乾淨區的中心推——所以玩家永遠在看得到的那片正中間。
  //
  // 鏡頭只跟位置，不加速度提前量。提前量是大幅晃動的來源：掉落時 vy 一路衝到
  // maxFall(1250)，乘上任何係數都會把取景往下甩一大段，落地 vy 歸零又整個彈回來。
  follow(p, W, H, dt, fx = 0.34, fy = 0.55) {
    const tx = p.x - W * fx;
    const ty = p.y - H * fy;
    if (!this.init) { this.x = tx; this.y = ty; this.init = true; return; }
    const k = 1 - Math.pow(0.0015, dt);
    this.x += (tx - this.x) * k;

    this.y += (ty - this.y) * k;
    this.y = Math.min(this.y, WORLD.yMax + 240 - H * 0.75);
    this.y = Math.max(this.y, WORLD.yMin - 320);
  }
}

export class Renderer {
  constructor(ctx) {
    this.ctx = ctx;
    this.decor = null;      // Decor
    this.trees = null;      // Trees
    this.cell = makeCell(0);
    this.seed = 0;
  }

  setSeed(seed) {
    this.seed = seed >>> 0;
    this.cell = makeCell(this.seed);
  }

  /**
   * @param {number} W 畫布 CSS 寬
   * @param {number} H 畫布 CSS 高
   * @param {object} s { cam, level, player, ghosts, time, zoom, sky, wind, glBackground }
   */
  draw(W, H, s) {
    const ctx = this.ctx;
    const { cam, level, player, ghosts, time, zoom, sky } = s;
    const VW = W / zoom, VH = H / zoom;

    // 有 WebGL 背景層的話這張畫布是透明的，疊在它上面
    if (s.glBackground) ctx.clearRect(0, 0, W, H);
    else this.fallbackBackground(W, H, cam, sky, zoom);

    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    const x0 = cam.x - 80, x1 = cam.x + VW + 80;

    this.markers(x0, x1, cam, VH, sky);
    // 樹畫在平台之前：板子擋住樹冠，樹就退到關卡後面去，
    // 一棵擋在路線上的樹會讓玩家看不見下一塊板子——那是遊戲性的問題，不是美術問題。
    if (this.trees) {
      this.trees.collect(level, x0, x1, time, s.wind);
      this.trees.draw(ctx, sky);
    }
    this.platforms(level, x0, x1, sky);
    if (this.decor) {
      this.decor.collect(level, x0, x1, time, sky.day);
      this.decor.draw(ctx, sky, s.wind);
    }
    this.spikes(level, x0, x1, sky);
    this.coins(level, x0, x1, time, sky);

    // 有 fx 層的話，貓在上面那張畫布上即時算 3D；這裡只補名牌。
    for (const g of ghosts) {
      if (!s.hasCats) this.block(g.x, g.y, g.facing, ALB.ghost, 0.58, 0, sky);
      this.label(g.x, g.y, g.name, s.hasCats ? 1 : 0.58);
    }
    if (!player.dead && !s.hasCats) {
      this.block(player.x, player.y, player.facing, ALB.self, 1, player.squash, sky);
    }

    ctx.restore();
  }

  // ── 沒有 WebGL 時的備援背景 ─────────────────────────────
  // 跟 gl/background.js 是同一套設計（同樣的天空色帶、同樣的四層非諧波
  // 山脈、同樣的空氣透視），只是用 Canvas 2D 畫，而且省掉星星與天氣。
  fallbackBackground(W, H, cam, sky, zoom) {
    const ctx = this.ctx;
    const B = skyBands(sky);
    const horizon = H * 0.62 - (cam.y - 150) * 0.05 * zoom;

    const g = ctx.createLinearGradient(0, 0, 0, Math.max(2, horizon));
    g.addColorStop(0, css(B.top));
    g.addColorStop(0.72, css(B.hor));
    g.addColorStop(1, css(mix3(B.hor, B.bot, 0.5)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, Math.max(2, horizon) + 2);
    ctx.fillStyle = css(B.bot);
    ctx.fillRect(0, horizon, W, H - horizon + 2);

    // 星
    const night = 1 - Math.min(1, sky.day / 0.62);
    if (night > 0.02) {
      const C = this.cell, SC = 26;
      ctx.fillStyle = "#dce6ff";
      for (let sx = 0; sx < W + SC; sx += SC) {
        for (let sy = 0; sy < horizon; sy += SC) {
          const ix = Math.floor((sx + cam.x * 0.04) / SC), iy = Math.floor(sy / SC);
          if (C(ix, iy, 7) > 0.085) continue;
          ctx.globalAlpha = night * (0.25 + C(ix, iy, 8) * 0.65);
          const px = ((sx + C(ix, iy, 9) * SC - cam.x * 0.04) % W + W) % W;
          ctx.fillRect(px, sy + C(ix, iy, 10) * SC, 1.5, 1.5);
        }
      }
      ctx.globalAlpha = 1;
    }

    // 地平線輝光，朝天體方位
    const bodyX = W * (0.5 + sky.dir[0] * 0.43);
    if (B.warm > 0.02) {
      const gg = ctx.createRadialGradient(bodyX, horizon, 0, bodyX, horizon, W * 0.5);
      const c = css(LOW_GLOW, 0.9 * B.warm).slice(4, -1);
      gg.addColorStop(0, `rgba(${c},${0.8 * B.warm})`);
      gg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gg;
      ctx.fillRect(0, 0, W, horizon + 2);
    }

    // 日月
    const bodyY = horizon - sky.dir[1] * horizon * 0.62;
    const halo = ctx.createRadialGradient(bodyX, bodyY, 0, bodyX, bodyY, 82);
    halo.addColorStop(0, css(sky.tint, 1.5));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.5; ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(bodyX, bodyY, 82, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = css(sky.tint, 4);
    ctx.beginPath(); ctx.arc(bodyX, bodyY, sky.up ? 11 : 9, 0, 6.2832); ctx.fill();

    // 四層非諧波山脈。近的比較暗、霾比較少——那個 lerp 就是深度感的全部。
    const RIDGE = [
      [0.05, 12, 40, -30, 0.86, 1.00],
      [0.11, 15, 62, 22, 0.62, 0.84],
      [0.22, 18, 98, 83, 0.37, 0.68],
      [0.40, 22, 150, 165, 0.15, 0.54],
    ];
    const hazeGate = Math.min(1, Math.max(0, (lum(B.hor) - 0.002) / 0.088));
    for (let i = 0; i < RIDGE.length; i++) {
      const [plx, sc, amp, off, haze, ab] = RIDGE[i];
      const lit = shade([0.075 * ab, 0.085 * ab, 0.115 * ab], sky, 0.10 + i * 0.09, 1.6);
      ctx.fillStyle = css(mix3(lit, B.hor, haze * hazeGate));
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W + 8; x += 8) {
        const wx = (x + cam.x * plx * zoom) / zoom;
        const y = horizon + off - (cam.y - 150) * plx * zoom + field(wx, sc, null) * amp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
  }

  markers(x0, x1, cam, VH, sky) {
    const ctx = this.ctx;
    ctx.font = '600 13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const step = 1000;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      if (x <= 0) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x - 1, cam.y - 100, 2, VH + 200);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillText(`${x / 10}m`, x, cam.y + Math.min(120, VH * 0.16));
    }
    ctx.textAlign = 'left';
  }

  platforms(level, x0, x1, sky) {
    const ctx = this.ctx;
    const body = css(shade(ALB.platBody, sky, 0.35, 1.7));
    const edge = css(shade(ALB.platEdge, sky, 0.55, 1.7));
    // 燈條是自發光的：亮度不隨日夜變，所以夜裡它相對更顯眼——正是霓虹該有的樣子。
    // 只往環境光的色偏挪一點點，免得它跟整個畫面脫節。
    const top = css(mix3(NEON, sky.ambient, 0.12), 0.62);
    level.forEachPlatform(x0, x1, (p) => {
      const skirt = Math.max(p.h, 34);
      ctx.fillStyle = body;
      roundRect(ctx, p.x, p.y, p.w, skirt, 6);
      ctx.fill();
      ctx.fillStyle = edge;
      ctx.fillRect(p.x, p.y + 6, p.w, 2);
      ctx.fillStyle = top;
      roundRect(ctx, p.x, p.y, p.w, 6, 3);
      ctx.fill();
    });
  }

  spikes(level, x0, x1, sky) {
    const ctx = this.ctx;
    ctx.fillStyle = css(shade(ALB.spike, sky, 0.9, 1.3));
    level.forEachSpike(x0, x1, (s) => {
      const n = Math.max(1, Math.round(s.w / 17));
      const w = s.w / n;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const bx = s.x + i * w;
        ctx.moveTo(bx, s.y + s.h);
        ctx.lineTo(bx + w / 2, s.y);
        ctx.lineTo(bx + w, s.y + s.h);
      }
      ctx.closePath();
      ctx.fill();
    });
  }

  coins(level, x0, x1, time, sky) {
    const ctx = this.ctx;
    const face = css(shade(ALB.coin, sky, 1.0, 1.6));
    const shine = css(shade([0.95, 0.92, 0.80], sky, 1.0, 1.5));
    level.forEachCoin(x0, x1, (c) => {
      if (c.taken) return;
      const bob = Math.sin(time * 3 + c.x * 0.02) * 4;
      const sq = Math.abs(Math.cos(time * 2.4 + c.x * 0.01));
      ctx.save();
      ctx.translate(c.x, c.y + bob);
      ctx.scale(0.35 + sq * 0.65, 1);
      ctx.fillStyle = face;
      ctx.beginPath(); ctx.arc(0, 0, COIN_R, 0, 6.2832); ctx.fill();
      ctx.fillStyle = shine;
      ctx.beginPath(); ctx.arc(-2.5, -2.5, COIN_R * 0.32, 0, 6.2832); ctx.fill();
      ctx.restore();
    });
  }

  /** 沒有 fx 層時的備援角色：一個方塊。 */
  block(x, y, facing, albedo, alpha, squash, sky) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    const sy = 1 + squash * 0.22, sx = 1 - squash * 0.16;
    const cx = x + PLAYER_W / 2, by = y + PLAYER_H;
    ctx.translate(cx, by); ctx.scale(sx, sy); ctx.translate(-cx, -by);
    ctx.fillStyle = css(shade(albedo, sky, 0.95, 1.4));
    roundRect(ctx, x, y, PLAYER_W, PLAYER_H, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(8,14,28,0.9)';
    const ex = cx + facing * 5;
    ctx.fillRect(ex - 2, y + 12, 4, 6);
    ctx.fillRect(ex - 2 + facing * 7, y + 12, 4, 6);
    ctx.restore();
  }

  /** 名牌畫在 2D 層。它在貓的頭上方，所以被上層蓋到也看不出來。 */
  label(x, y, name, alpha) {
    if (!name) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha + 0.34);
    ctx.font = '600 12px system-ui, -apple-system, "Noto Sans TC", sans-serif';
    ctx.textAlign = 'center';
    const cx = x + PLAYER_W / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    const w = ctx.measureText(name).width + 12;
    roundRect(ctx, cx - w / 2, y - 38, w, 17, 8);
    ctx.fill();
    ctx.fillStyle = '#dce9ff';
    ctx.fillText(name, cx, y - 25);
    ctx.textAlign = 'left';
    ctx.restore();
  }
}

/** 玩家狀態 → 貓的姿勢。 */
export function playerState(p) {
  if (p.dead) return 'dead';
  if (!p.grounded && p.wallDir !== 0) return 'wall';
  if (!p.grounded) return p.vy > 60 ? 'fall' : 'air';
  return Math.abs(p.vx) > 24 ? 'run' : 'idle';
}

function lum(c) { return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722; }

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { gust };
