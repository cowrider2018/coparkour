import { PLAYER_W, PLAYER_H, WORLD, VIEW } from './constants.js';
import { COIN_R } from './level.js';
import { css, shade, mix3, skyBands, LOW_GLOW } from './gfx/daycycle.js';
import { makeCell, field, gust } from './gfx/field.js';
import { SEASON, seasonPick, seasonBlend } from './gfx/season.js';

// ── 世界的 albedo ───────────────────────────────────────────
// 全部是 linear，經過 daycycle 的 shade() 打光、acesTone() 落地。
// 直接拿這些數字當 CSS 顏色會又亮又灰——見計畫書的地雷 01。
//
// 地形本身的顏色不在這裡，在 gfx/season.js：土跟草皮是跟著 x 走的地理，
// 不是一組全域常數。
const ALB = {
  spike:    [0.620, 0.110, 0.150],
  coin:     [0.720, 0.480, 0.090],
  self:     [0.130, 0.520, 0.360],
  ghost:    [0.180, 0.290, 0.560],
};

// ── 卡通地形的尺寸 ──────────────────────────────────────────
const CAP_H = 10;        // 草皮那一條有多厚
const DRIP = 8;          // 草皮往土裡垂下多深（那些一綹一綹的舌頭）
const DRIP_SCALE = 0.62; // 舌頭的波長縮放，越小越碎（最短的一項約 8 單位）
const CAP_SEG = 14;      // 過渡帶上多寬抽一次籤（細一點才像密度，粗了像磚）
const INK = 2;           // 卡通描邊有多粗

// ── 木柱 ────────────────────────────────────────────────────
// 「細而高」＝一根柱子。蹬牆井的細柱、閘門的高柱、路邊那道矮牆走的是三個
// 生成器，但玩家看到的是同一件事：一根只能蹬、不能站的直立物。地形板子最窄
// 也有 52 寬、26 高，跟柱子（≤30 寬）差得夠遠，所以形狀本身就足以分類——
// 生成器不必知道自己會被畫成什麼，關卡那邊一行都不用改。
const TRUNK_MAX_W = 46;   // 再寬就當地形，照土＋草皮畫
const TRUNK_RATIO = 1.6;  // 高至少要是寬的這麼多倍

// 樹幹的色階。跟 gfx/tree.js 的樹皮是同一家的顏色（那邊的 BARK_LIT 是
// 這裡的 lit），所以柱子看起來像那些樹的同一種木頭，不是另一種材質。
const WOOD = {
  bark: [0.072, 0.052, 0.036],   // 中間調
  lit:  [0.155, 0.120, 0.082],   // 朝光的那一側
  dim:  [0.034, 0.025, 0.018],   // 背光的那一側——比中間調暗一階，不是黑的
  dark: [0.016, 0.011, 0.008],   // 溝與描邊
  ring: [0.180, 0.110, 0.055],   // 節的心
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
      this.decor.collect(level, x0, x1, time, sky);
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

    // 地平線輝光，朝太陽的方位——不是朝「現在天上那一顆」的方位
    const glowX = W * (0.5 + sky.glowX * 0.43);
    if (B.warm > 0.02) {
      const gg = ctx.createRadialGradient(glowX, horizon, 0, glowX, horizon, W * 0.5);
      const c = css(LOW_GLOW, 0.9 * B.warm).slice(4, -1);
      gg.addColorStop(0, `rgba(${c},${0.8 * B.warm})`);
      gg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gg;
      ctx.fillRect(0, 0, W, horizon + 2);
    }

    // 日月。盤面與光暈用 sky.body（天上那一顆自己的顏色），不用
    // sky.tint——後者在交接時是兩盞燈的疊加，會畫出藍色的落日。
    const bodyX = W * (0.5 + sky.dir[0] * 0.43);
    const bodyY = horizon - sky.dir[1] * horizon * 0.62;
    // 夜裡多一層很寬的暈。夜空被調暗了，靠它把月亮附近的天空撐起來——
    // 那是月光在空氣裡的散射，也是「月亮是一個光源」唯一看得見的證據。
    const dark = 1 - sky.day;
    if (dark > 0.02) {
      const R = H * 0.30;
      const bg = ctx.createRadialGradient(bodyX, bodyY, 0, bodyX, bodyY, R);
      bg.addColorStop(0, `rgba(${css(sky.body, 0.9).slice(4, -1)},${0.22 * dark})`);
      bg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, horizon + 2);
    }
    const halo = ctx.createRadialGradient(bodyX, bodyY, 0, bodyX, bodyY, 82);
    halo.addColorStop(0, css(sky.body, 1.5));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.5; ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(bodyX, bodyY, 82, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = css(sky.body, 4);
    ctx.beginPath(); ctx.arc(bodyX, bodyY, sky.up ? 11 : 9, 0, 6.2832); ctx.fill();

    // 四層非諧波山脈。近的比較暗、霾比較少——那個 lerp 就是深度感的全部。
    const RIDGE = [
      [0.05, 12, 40, -30, 0.86, 1.00],
      [0.11, 15, 62, 22, 0.62, 0.84],
      [0.22, 18, 98, 83, 0.37, 0.68],
      [0.40, 22, 150, 165, 0.15, 0.54],
    ];
    const hazeGate = Math.min(1, Math.max(0, (lum(B.hor) - 0.002) / 0.053));
    // 跟 shader 的 skyBounce 同一件事：一道遠山的斜坡只看得到半邊天，
    // 而白天地面彼此反射的太陽光把這件事補回來大半，夜裡沒有那道反射。
    // 沒有這一折，夜裡最近那層山會比它背後的天空還亮。
    // veil 歸零：山脊與相機之間的空氣是下面那句 mix 往 B.hor 混的東西，
    // 加兩次會把四層山抬平回同一片藍。
    const bounce = {
      ...sky,
      ambient: sky.ambient.map((c) => c * (0.42 + 0.58 * sky.day)),
      veil: [0, 0, 0],
    };
    for (let i = 0; i < RIDGE.length; i++) {
      const [plx, sc, amp, off, haze, ab] = RIDGE[i];
      // 遠山也吃季節。用鏡頭中心一個點去查就夠了：整條山脈是一個面，
      // 玩家不會同時看到兩季的山，而過渡帶上它會隨著鏡頭平順地換過去。
      const rt = seasonBlend(cam.x + W / (zoom * 2), 'ridge');
      const lit = shade([rt[0] * ab, rt[1] * ab, rt[2] * ab], bounce, 0.10 + i * 0.09, 1.6);
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

  /**
   * 一塊地：描邊、土、草皮、受光的頂緣。四層，全部是實色——
   * 卡通的體積感來自「幾個乾淨的色塊 + 一圈暗描邊」，不是來自漸層。
   *
   * 描邊的做法是先填一個大一圈的深色 roundRect，再把土疊在裡面。
   * 用 stroke() 的話線寬會跟著 zoom 走（動態視距一縮，描邊就變成粗黑框），
   * 而「大一圈的實心塊」是世界座標裡的量，縮放時跟其他東西一起縮。
   *
   * 草皮的下緣是 field()——那條非諧波正弦不會重複，所以一路跑下去
   * 不會看到同一組草舌週期性出現。它同時也是連續函數，所以過渡帶上
   * 相鄰兩段抽到不同季節時，兩段的邊界完全對得起來，不會有縫。
   */
  platforms(level, x0, x1, sky) {
    const ctx = this.ctx;
    const C = this.cell;
    level.forEachPlatform(x0, x1, (p) => {
      // 細而高的一律走木頭那一套：土跟草皮長不到牆面上，
      // 一根裹著草皮的土柱看起來像地形被拔起來，不像可以蹬的東西。
      if (p.w <= TRUNK_MAX_W && p.h >= p.w * TRUNK_RATIO) { this.trunk(p, sky); return; }
      const skirt = Math.max(p.h, 34);
      const iz = Math.round(p.y / 17);

      // 土是一個面，不是一群個體，所以季節在這裡用 lerp 而不是抽籤——
      // 沒有東西可以拿來抽。草才抽（見 season.js 的開頭）。
      const soil = seasonBlend(p.x + p.w * 0.5, 'soil');
      const deep = seasonBlend(p.x + p.w * 0.5, 'deep');
      ctx.fillStyle = css(shade(mix3(deep, [0, 0, 0], 0.30), sky, 0.34, 1.3));
      roundRect(ctx, p.x, p.y, p.w, skirt, 7);
      ctx.fill();
      ctx.fillStyle = css(shade(soil, sky, 0.42, 1.5));
      roundRect(ctx, p.x + INK, p.y + INK, p.w - INK * 2, skirt - INK * 2, 5);
      ctx.fill();
      // 土的下半段壓暗一階。兩個實色階＝一個圓柱面，這是最便宜的體積
      ctx.fillStyle = css(shade(deep, sky, 0.30, 1.4));
      roundRect(ctx, p.x + INK, p.y + skirt * 0.58, p.w - INK * 2, skirt * 0.42 - INK, 5);
      ctx.fill();

      // ── 草皮 ──
      // 一段一段抽籤（過渡帶上兩季交錯），同一季的段落收進同一個 path，
      // 一季一次 fill。一個畫面通常只跨到兩季，所以實際上是兩次。
      //
      // 段的寬度與兩側的彎法都不是固定值，而是「這道接縫的序號」的雜湊：
      // 等寬的直立分段會排成一列看得見的磚，那是最假的過渡。關鍵在於同一道接縫
      // 被左右兩段問到時算出同一組數字，所以抖歸抖，縫仍然嚴絲合縫。
      //
      // 外層是季節、內層才是分段，所以整段掃描要重跑幾次（每季一次）。
      // 那比留一份 Path2D 便宜：一格分段只是四次雜湊，而 Path2D 是每幀每塊板子
      // 都要新配置的物件——這份程式從頭到尾不在畫面迴圈裡配記憶體。
      const xa = p.x + INK, xb = p.x + p.w - INK;
      if (xb - xa < 2) return;
      const i0 = Math.floor(xa / CAP_SEG), i1 = Math.ceil(xb / CAP_SEG);
      const edgeX = (i) => {
        const v = i * CAP_SEG + (C(i, iz, 32) - 0.5) * CAP_SEG * 0.7;
        return v < xa ? xa : v > xb ? xb : v;
      };
      // 每道接縫是一條有弧度的曲線，不是一刀直下。板子的兩端不准彎出去。
      const seamB = (i, x) => (x <= xa || x >= xb ? 0 : (C(i, iz, 33) - 0.5) * 9);
      const seamM = (i, x) => (x <= xa || x >= xb ? 0 : (C(i, iz, 34) - 0.5) * 11);
      for (let si = 0; si < SEASON.length; si++) {
        ctx.beginPath();
        let drawn = false;
        let sx = xa, b0 = 0, m0 = 0;
        for (let i = i0; i <= i1; i++) {
          const ex = i === i1 ? xb : edgeX(i + 1);
          if (ex - sx >= 0.5) {
            const b1 = seamB(i + 1, ex), m1 = seamM(i + 1, ex);
            if (seasonPick(sx, C(i, iz, 31)) === si) {
              capSeg(ctx, sx, ex, p.y, b0, m0, b1, m1);
              drawn = true;
            }
            sx = ex; b0 = b1; m0 = m1;
          }
          if (sx >= xb) break;
        }
        if (drawn) {
          ctx.fillStyle = css(shade(SEASON[si].cap, sky, 0.62, 1.25));
          ctx.fill();
        }
      }

      // 頂緣的受光邊。這一條同時是遊戲性的東西：它就是「這裡踩得到」的那條線，
      // 所以它比草皮亮一階，而且永遠貼齊 p.y——碰撞面在哪，看起來就在哪。
      ctx.fillStyle = css(shade(seasonBlend(p.x + p.w * 0.5, 'lit'), sky, 0.95, 1.35));
      roundRect(ctx, xa, p.y, xb - xa, 3, 1.5);
      ctx.fill();
    });
  }

  /**
   * 一根柱子：一截樹幹。由外往內四件事——描邊、樹皮的三個明暗階、
   * 樹皮的溝與節、頂端的斷面。
   *
   * 一樣全部是實色階。圓柱的體積感來自「亮面／中間調／暗面」三塊，
   * 跟土的兩階是同一個把戲，只是柱子要分左右而不是分上下。
   *
   * 亮面在哪一側跟著 sky.glowX 走，所以一天之內亮面會自己從一側掃到另一側，
   * 夜裡則跟著月亮——glowX 已經幫忙翻過邊了，這裡直接讀就對。
   */
  trunk(p, sky) {
    const ctx = this.ctx;
    const C = this.cell;
    const iz = Math.round(p.y / 17);
    const xa = p.x + INK, xb = p.x + p.w - INK, w = xb - xa;
    const ya = p.y + INK, yb = p.y + p.h - INK, h = yb - ya;
    if (w < 2 || h < 2) return;

    // 描邊跟土用同一招：先填一個大一圈的深色塊，不是 stroke()——
    // 線寬要跟著動態視距一起縮，不然一縮小整根柱子就變成一條粗黑線。
    ctx.fillStyle = css(shade(WOOD.dark, sky, 0.28, 1.2));
    roundRect(ctx, p.x, p.y, p.w, p.h, 6);
    ctx.fill();
    ctx.fillStyle = css(shade(WOOD.bark, sky, 0.44, 1.35));
    roundRect(ctx, xa, ya, w, h, 4);
    ctx.fill();

    // 兩側各壓一條：亮面貼著光那一側，暗面貼另一側，中間留一條中間調。
    const lx = sky.glowX === undefined ? 0.4 : sky.glowX;
    const lw = Math.max(1.5, w * 0.30), dw = Math.max(1.2, w * 0.24);
    ctx.fillStyle = css(shade(WOOD.dim, sky, 0.34, 1.3));
    roundRect(ctx, lx >= 0 ? xa : xb - dw, ya, dw, h, 3);
    ctx.fill();
    ctx.fillStyle = css(shade(WOOD.lit, sky, 0.70, 1.4));
    roundRect(ctx, lx >= 0 ? xb - lw : xa, ya, lw, h, 3);
    ctx.fill();

    // ── 樹皮的溝 ──
    // 一道溝不是一路到底的直線，是一截一截斷開的，長度與間斷都由雜湊給——
    // 通到底的直線會讓柱子看起來像鐵皮壓出來的。橫向的抖動讀 field()，
    // 跟草舌是同一條非諧波正弦，所以柱子疊多高都不會看到同一段紋路重複。
    // 全部收進一個 path 一次 fill：一根柱子最多四道溝，但只有一次 fill。
    const ng = Math.max(2, Math.min(5, Math.round(w / 6)));
    const gw = Math.max(0.9, w * 0.065);
    const amp = Math.min(1.5, w * 0.075);
    const lo = xa + gw / 2 + amp, hi = xb - gw / 2 - amp;
    ctx.fillStyle = css(shade(WOOD.dark, sky, 0.30, 1.2));
    ctx.beginPath();
    for (let k = 0; k < ng; k++) {
      const t = (k + 0.5 + (C(k, iz, 41) - 0.5) * 0.5) / ng;
      const cx = Math.min(hi, Math.max(lo, xa + t * w));
      let y = ya + 2 + C(k, iz, 42) * 70;
      for (let s = 0; s < 40 && y < yb - 4; s++) {
        const y1 = Math.min(yb - 3, y + 22 + C(k, iz + s, 43) * 54);
        if (y1 - y > 9) furrow(ctx, cx, y, y1, gw, amp, k * 53.7);
        y = y1 + 9 + C(k, iz + s, 44) * 26;
      }
    }
    ctx.fill();

    // ── 節 ──
    // 側枝斷掉留下的疤：一圈深色套一顆亮心。兩個實色就讀得出來，
    // 而且它是唯一一個「橫的」特徵——柱子上其他每一筆都是直的，
    // 少了它整根會像一段有紋路的柱體，不像一段木頭。
    const kn = Math.floor(h / 130);
    const kr = Math.min(w * 0.26, 4.2);
    if (kr >= 1.6) {
      for (let k = 0; k < kn; k++) {
        if (C(k, iz, 45) > 0.42) continue;
        const ky = ya + ((k + 0.2 + C(k, iz, 46) * 0.6) / kn) * h;
        ctx.save();
        ctx.translate(xa + w * (0.3 + C(k, iz, 47) * 0.4), ky);
        ctx.scale(1, 0.62 + C(k, iz, 48) * 0.3);
        ctx.fillStyle = css(shade(WOOD.dark, sky, 0.30, 1.2));
        ctx.beginPath(); ctx.arc(0, 0, kr, 0, 6.2832); ctx.fill();
        ctx.fillStyle = css(shade(WOOD.ring, sky, 0.55, 1.3));
        ctx.beginPath(); ctx.arc(0, 0, kr * 0.5, 0, 6.2832); ctx.fill();
        ctx.restore();
      }
    }

    // 頂緣的受光邊。跟草皮那一條是同一個角色，也是遊戲性的東西：
    // 它就是「這裡踩得到／抓得到」的那條線，所以永遠貼齊 p.y。
    // 只有這一條線，沒有斷面——鏡頭是水平的，柱子的頂面看不到。
    ctx.fillStyle = css(shade(WOOD.lit, sky, 0.95, 1.35));
    roundRect(ctx, xa, p.y, w, 2.5, 1.2);
    ctx.fill();
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

/**
 * 草皮的一段：上緣是直的（那是碰撞面，不能亂動），兩側是彎的，
 * 下緣是垂進土裡的草舌。
 *
 * 下緣只讀 x，所以相鄰兩段共用的那個底點算出來完全相同；兩側的曲線由共用的
 * 那道接縫決定，而一條二次曲線倒著走還是同一條曲線。三條邊都對得起來，
 * 分段抽籤才不會露縫。
 */
function capSeg(ctx, xa, xb, y, sa, ca, sb, cb) {
  const bl = xa + sa, br = xb + sb;
  const yb = y + CAP_H, ym = y + CAP_H * 0.55;
  ctx.moveTo(xa, y);
  ctx.lineTo(xb, y);
  ctx.quadraticCurveTo(xb + cb, ym, br, yb + dripAt(br));
  for (let x = br - 3; x > bl; x -= 3) ctx.lineTo(x, yb + dripAt(x));
  ctx.lineTo(bl, yb + dripAt(bl));
  ctx.quadraticCurveTo(xa + ca, ym, xa, y);
  ctx.closePath();
}

/**
 * 樹皮上的一道溝：一條沿著 y 走的窄帶，左右緣由 field() 抖出來。
 * 抖動只讀 y，所以同一根柱子上下相接的兩截溝天生對得起來；
 * 相位由呼叫端給，不同的溝才不會抖成一模一樣的兩條。
 */
function furrow(ctx, cx, y0, y1, w, amp, ph) {
  const hw = w / 2;
  ctx.moveTo(cx + field(y0 + ph, 0.55, null) * amp - hw, y0);
  for (let y = y0 + 6; y < y1; y += 6) ctx.lineTo(cx + field(y + ph, 0.55, null) * amp - hw, y);
  ctx.lineTo(cx + field(y1 + ph, 0.55, null) * amp - hw, y1);
  ctx.lineTo(cx + field(y1 + ph, 0.55, null) * amp + hw, y1);
  for (let y = y1 - 6; y > y0; y -= 6) ctx.lineTo(cx + field(y + ph, 0.55, null) * amp + hw, y);
  ctx.lineTo(cx + field(y0 + ph, 0.55, null) * amp + hw, y0);
  ctx.closePath();
}

function dripAt(x) {
  return (0.5 + 0.5 * field(x, DRIP_SCALE, null)) * DRIP;
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
