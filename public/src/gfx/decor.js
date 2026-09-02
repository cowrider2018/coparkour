// ── 鋪在土上的草皮，以及長在裡面的花與蟲 ────────────────────
// 完全由座標雜湊決定，所以：
//   · 無狀態——只算看得見的視窗，離開畫面就丟掉，記憶體不隨距離成長
//   · 多人一致——同一個 room seed + 同一個格子 = 同一叢草，網路零成本
//   · 可往回看——鏡頭往左拉，草還在原地
//
// 草的目標是「一張鋪在土地上的地毯」，不是「一排立正的牙籤」。三件事撐起那個厚重感：
//
//   扇形       一叢草是從同一個根往四面張開的一蓬（FAN 給到 ±70°），
//              最外圈幾乎是躺著往外鋪的。全部朝上的草只有輪廓沒有面積。
//   有前後排   每根草在草皮裡有一個深度 d：後排的根部比地面高一點（從草皮後面探出來），
//              前排的低一點（垂到板子的前緣外，把那條硬邊蓋掉）。厚度就是這樣來的。
//   分階不分高 一根草整根同一個顏色，階由「它朝哪邊 + 它在第幾排」決定，
//              而且畫的順序就是由深到淺＝由後到前。所以四階同時是明暗、是深度、
//              也是畫家演算法的排序鍵——一次分組買到三件事。
//
// 其他兩個從 AETHER 搬來的做法照舊：
//   clump-and-thin  花叢半徑用 u 不是 sqrt(u)，再用 u²·0.92 淘汰 → 花叢沒有邊界
//   縮小而非淡出    進出視野靠改高度，不靠 alpha，所以不用排序也不會 pop
import { makeCell, gust, leafWidth } from './field.js';
import { css, shade } from './daycycle.js';
import { SEASON, seasonPick } from './season.js';

const TUFT_CELL = 20;        // 一格出一叢草（比舊版密：地毯要密才叫地毯）
const CLUMP_CELL = 132;      // 一格出一叢花
const BLADE_H = 14;
const MAT_DEPTH = 10;        // 草皮的厚度：最後排與最前排的根部差多少
const FAN = 2.45;            // 一叢草張開的總角度（弧度）
const BANDS = 4;             // 明暗／深度的階數，第 5 階（＝BANDS）留給枯掉的
const MAX_BLADES = 1300;     // Canvas 2D 是 O(數量)，一定要有硬上限
const MAX_FLOWERS = 130;
const MAX_CREATURES = 44;

// 蝴蝶／螢火蟲的飛行：脈衝響應的和，不是正弦。
// 正弦沒有蝴蝶的兩個特徵——沒有轉角，而且在時間上是對稱的。
// 每個「踢」在 s(0)=0、s'(0)=1 起步（那個速度不連續就是轉角），
// 在 s(L)=s'(L)=0 結束，所以離開視窗時已經淡完，迴圈可以硬性截在 4 次。
const KICK_LIFE = 3.0;   // 一個脈衝活幾個踢的間隔
const KICKS = 4;         // 同時疊加幾個（≥ KICK_LIFE + 1 才不會跳）

const BUTTERFLY = [
  [0.880, 0.700, 0.130],   // 黃
  [0.820, 0.400, 0.520],   // 粉
  [0.360, 0.520, 0.860],   // 藍
  [0.900, 0.880, 0.840],   // 白
];
const FIREFLY = [0.780, 0.920, 0.360];

// 每叢一色。五種「物種」，整叢共用同一個 index。
const PETALS = [
  [0.780, 0.760, 0.700],
  [0.880, 0.480, 0.020],
  [0.820, 0.175, 0.290],
  [0.330, 0.170, 0.700],
  [0.880, 0.105, 0.025],
];

export class Decor {
  constructor(roomSeed) {
    this.cell = makeCell(roomSeed);
    this.blades = [];   // 重複使用，不在迴圈裡配置記憶體
    this.flowers = [];
    this.bugs = [];
    this.density = 1;
    this.mask = 0;      // 這一幀出現了哪些（季節 × 階），draw() 用它跳過空的組
  }

  /**
   * 掃過可見範圍內的平台，收集這一幀要畫的東西。
   * @param {object} level
   * @param {number} x0 視窗左緣（世界座標）
   * @param {number} x1 視窗右緣
   * @param {number} t  秒
   * @param {object} sky daycycle 的 skyAt()——這裡要它的 day 與光的水平方位
   */
  collect(level, x0, x1, t, sky) {
    const C = this.cell;
    const blades = this.blades, flowers = this.flowers, bugs = this.bugs;
    let nb = 0, nf = 0, ng = 0, mask = 0;
    const day = sky && sky.day !== undefined ? sky.day : 1;
    const night = 1 - day;
    // 光打在草皮上的水平方位。朝著光的那一面亮、背光的暗——
    // 這是「不同面向」唯一需要的一個數字，日出到日落它會自己把亮面掃過去。
    const L = sky && sky.dir ? Math.max(-1, Math.min(1, sky.dir[0])) : 0;
    const cap = Math.round(MAX_BLADES * this.density);

    level.forEachPlatform(x0 - 40, x1 + 40, (p) => {
      if (p.h >= 60) return;                 // 牆不長草
      const top = p.y;
      const iz = Math.round(top / 17);        // 高度也進雜湊，不同層長得不一樣
      const from = Math.floor((Math.max(p.x + 4, x0 - 30)) / TUFT_CELL);
      const to = Math.floor((Math.min(p.x + p.w - 4, x1 + 30)) / TUFT_CELL);

      for (let ix = from; ix <= to; ix++) {
        if (nb >= cap) return;
        const bx = ix * TUFT_CELL;
        if (bx < p.x + 3 || bx > p.x + p.w - 3) continue;

        // 這一叢站哪一季。抽籤在「叢」這一層，不在「根」這一層：
        // 一致性讀起來像物種，逐根抖色讀起來像雜訊。
        const si = seasonPick(bx, C(ix, iz, 7));
        const P = SEASON[si];
        if (C(ix, iz, 1) > 0.93 * this.density * P.thick) continue;

        const tilt = (C(ix, iz, 2) - 0.5) * 0.5;        // 整叢往哪邊倒
        const n = 5 + Math.floor(C(ix, iz, 3) * 4);     // 一叢 5–8 片
        const open = 0.66 + C(ix, iz, 4) * 0.48;        // 這叢張多開
        for (let k = 0; k < n && nb < cap; k++) {
          const s = k * 7 + 16;
          // u ∈ 0..1 是這根草在扇形上的位置，兩端是最外圈那兩片
          const u = (k + 0.5) / n + (C(ix, iz, s) - 0.5) * 0.20;
          const spread = (u - 0.5) * 2;                 // -1..1
          const flat = spread < 0 ? -spread : spread;
          // 根部散開的幅度只有葉尖的一小半，一叢草才像從一處長出來的；
          // 但也不能太小，不然叢與叢之間會露出底下那條平的草皮
          const x = bx + spread * TUFT_CELL * 0.40;
          if (x < p.x + 2 || x > p.x + p.w - 2) continue;
          const rim = edgeFade(x, x0, x1);
          if (rim <= 0.02) continue;

          const d = C(ix, iz, s + 4);                   // 在草皮裡的前後排
          const a = tilt + spread * FAN * 0.5 * open;
          const b = blades[nb] || (blades[nb] = {});
          b.x = x;
          // 後排的根比地面高、前排的低到板子的前緣外：草皮因此有厚度，
          // 而且板子頂端那條硬邊被最前排壓掉了
          b.y = top + (d - 0.45) * MAT_DEPTH * P.thick;
          b.a = a;
          // 越往外越短：外圈是趴著往外鋪的那一層，不是站著的那一層
          b.h = BLADE_H * (0.68 + C(ix, iz, s + 1) * 0.58) * (1 - flat * 0.32) * rim * P.thick;
          b.w = (2.2 + C(ix, iz, s + 2) * 1.5) * (1 - flat * 0.18) * rim;  // 有寬度才有體積
          b.curl = (0.30 + C(ix, iz, s + 3) * 0.70) * (spread < 0 ? -1 : 1) * (0.35 + flat);
          b.susc = 0.75 + C(ix, iz, s + 5) * 0.55;      // 受風程度

          // 階＝六成看前後排、四成看朝向對不對著光。
          // 畫的順序就是這個階，所以它同時是排序鍵——不需要真的排序。
          const key = 0.60 * d + 0.40 * (0.5 + 0.5 * Math.sin(a) * L);
          let band = key <= 0 ? 0 : key >= 1 ? BANDS - 1 : (key * BANDS) | 0;
          if (C(ix, iz, s + 6) > 0.93) band = BANDS;    // 枯掉的那幾根，畫在最上面
          b.key = si * (BANDS + 1) + band;
          mask |= 1 << b.key;
          nb++;
        }
      }

      // ── 花：clump-and-thin ──
      const cf = Math.floor(Math.max(p.x, x0) / CLUMP_CELL);
      const ct = Math.floor(Math.min(p.x + p.w, x1) / CLUMP_CELL);
      for (let ix = cf; ix <= ct && nf < MAX_FLOWERS; ix++) {
        const cx0 = ix * CLUMP_CELL;
        const fs = SEASON[seasonPick(cx0, C(ix, iz, 90))];
        if (C(ix, iz, 91) > 0.42 * this.density * fs.bloom) continue;   // 冬天幾乎不開
        const cx = cx0 + (0.14 + C(ix, iz, 92) * 0.72) * CLUMP_CELL;
        if (cx < p.x + 14 || cx > p.x + p.w - 14) continue;
        const R = 16 + C(ix, iz, 93) * 34;
        const tint = PETALS[Math.min(4, (C(ix, iz, 94) * 5) | 0)];   // 每叢一色
        for (let k = 0; k < 9 && nf < MAX_FLOWERS; k++) {
          const s = k * 8 + 120;
          const u = C(ix, iz, s);
          if (C(ix, iz, s + 1) < u * u * 0.92) continue;   // 往外圍淘汰 → 沒有邊界
          const x = cx + (C(ix, iz, s + 2) - 0.5) * 2 * R * u;
          if (x < p.x + 6 || x > p.x + p.w - 6) continue;
          const rim = edgeFade(x, x0, x1);
          if (rim <= 0.02) continue;
          const f = flowers[nf] || (flowers[nf] = {});
          f.x = x;
          f.y = top;
          f.h = BLADE_H * (1.30 + C(ix, iz, s + 3) * 0.9) * rim;   // 要高過草皮才看得到
          f.r = (1.8 + C(ix, iz, s + 4) * 1.6) * rim;
          f.lean = (C(ix, iz, s + 5) - 0.5) * 0.5;
          f.susc = 0.8 + C(ix, iz, s + 6) * 0.5;
          f.tint = tint;
          f.stem = fs.ramp[1];                            // 莖跟著這一季的草走
          nf++;
        }

        // ── 這叢花上面有沒有蟲 ──
        // 一半的機率有；有的話 1~3 隻機率均等。
        // 白天是蝴蝶、晚上是螢火蟲，交界處交叉淡入（兩種都畫，各自帶權重）。
        if (ng >= MAX_CREATURES) continue;
        if (C(ix, iz, 200) >= 0.5) continue;
        const n = Math.min(3, 1 + Math.floor(C(ix, iz, 201) * 3));
        for (let k = 0; k < n && ng < MAX_CREATURES; k++) {
          const s = k * 5 + 210;
          const rim = edgeFade(cx, x0, x1);
          if (rim <= 0.02) continue;
          const g = bugs[ng] || (bugs[ng] = {});
          g.cx = cx;                                    // 繞著花叢飛，不是繞著空地
          g.cy = top - 26 - C(ix, iz, s) * 26;
          g.R = 12 + C(ix, iz, s + 1) * 16;
          g.seed = ((ix * 73856093) ^ (iz * 19349663) ^ (s * 83492791)) | 0;
          g.rate = 0.42 + C(ix, iz, s + 2) * 0.34;      // 每秒踢幾次
          g.phase = C(ix, iz, s + 3);                   // 拍翅／閃爍的相位
          g.tint = BUTTERFLY[Math.min(3, (C(ix, iz, s + 4) * 4) | 0)];
          g.rim = rim;
          ng++;
        }
      }
    });

    this.nb = nb;
    this.nf = nf;
    this.ng = ng;
    this.mask = mask;
    this.t = t;
    this.night = night;
  }

  /** 脈衝響應的和。回傳位移，順便給出解析導數當朝向——不需要前一幀的狀態。 */
  kick(g, t, out) {
    const tau = t * g.rate;
    const kNow = Math.floor(tau);
    let ox = 0, oy = 0, dx = 0, dy = 0;
    for (let i = 0; i < KICKS; i++) {
      const kIdx = kNow - i;
      const age = tau - kIdx;
      if (age >= KICK_LIFE || age < 0) continue;
      const h1 = hash2(g.seed, kIdx * 2 + 1);
      const h2 = hash2(g.seed, kIdx * 2 + 2);
      const a = h1 * Math.PI * 2;
      const amp = g.R * (0.45 + h2 * 0.75);
      const x = age / KICK_LIFE;
      const sp = age * (1 - x) * (1 - x);          // 位移
      const ds = (1 - x) * (1 - 3 * x);            // 解析導數
      ox += Math.cos(a) * amp * sp;
      oy += Math.sin(a) * amp * sp * 0.62;         // 上下擺幅小一點，才像在花上盤旋
      dx += Math.cos(a) * amp * ds;
      dy += Math.sin(a) * amp * ds * 0.62;
    }
    out[0] = ox; out[1] = oy; out[2] = dx; out[3] = dy;
  }

  /**
   * 一次畫完。批次成少數幾個 path —— Canvas 2D 每個 fill 都是一次提交，
   * 所以一千根草分成幾個色階幾次 fill，而不是一千次。
   *
   * 迴圈的順序（階在外、季節在內）是有意的：同一畫面通常只有一到兩季，
   * 但**階一定要由小到大**——那就是由後排到前排、由暗到亮，
   * 也就是這片草皮的畫家演算法。過渡帶上兩季的草交錯生長，
   * 它們的前後排必須一起排序，不然會出現「秋草整片蓋在綠草前面」那種假分層。
   */
  draw(ctx, sky, wind) {
    const t = this.t;
    const W = wind === undefined ? 0.55 : wind;

    for (let band = 0; band <= BANDS; band++) {
      for (let si = 0; si < SEASON.length; si++) {
        const key = si * (BANDS + 1) + band;
        if (!(this.mask & (1 << key))) continue;   // 這一幀沒有這一組，連掃都不用掃
        const P = SEASON[si];
        const col = band === BANDS ? P.dry : P.ramp[band];
        // ndl 跟著階走：最前排／朝光的那一階本來就收到最多直接光
        ctx.fillStyle = css(shade(col, sky, 0.36 + band * 0.21, 1.15));
        ctx.beginPath();
        for (let i = 0; i < this.nb; i++) {
          const b = this.blades[i];
          if (b.key !== key) continue;
          blade(ctx, b, t, W);
        }
        ctx.fill();
      }
    }

    // 花莖
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < this.nf; i++) {
      const f = this.flowers[i];
      const bend = (gust(f.x, t) - 0.5) * 2 * W * f.susc * 7 + f.lean * 5;
      ctx.moveTo(f.x, f.y);
      ctx.quadraticCurveTo(f.x + bend * 0.4, f.y - f.h * 0.6, f.x + bend, f.y - f.h);
    }
    if (this.nf) {
      ctx.strokeStyle = css(shade(this.flowers[0].stem, sky, 0.6, 1.5));
      ctx.stroke();
    }

    // 花瓣：同一叢同一色，所以按 tint 分組
    for (let pi = 0; pi < PETALS.length; pi++) {
      ctx.fillStyle = css(shade(PETALS[pi], sky, 0.72, 0.9));
      ctx.beginPath();
      let drawn = false;
      for (let i = 0; i < this.nf; i++) {
        const f = this.flowers[i];
        if (f.tint !== PETALS[pi]) continue;
        const bend = (gust(f.x, t) - 0.5) * 2 * W * f.susc * 7 + f.lean * 5;
        ctx.moveTo(f.x + bend + f.r, f.y - f.h);
        ctx.arc(f.x + bend, f.y - f.h, f.r, 0, 6.2832);
        drawn = true;
      }
      if (drawn) ctx.fill();
    }

    this.drawBugs(ctx, sky);
  }

  /**
   * 蝴蝶與螢火蟲。兩種都畫，用 night 當權重交叉淡入，
   * 所以黃昏那幾分鐘會同時看到幾隻還沒睡的蝴蝶和剛亮起來的螢火蟲。
   */
  drawBugs(ctx, sky) {
    if (!this.ng) return;
    const t = this.t, night = this.night;
    const o = this._k || (this._k = [0, 0, 0, 0]);

    // ── 蝴蝶（白天）──
    if (night < 0.98) {
      const dayW = 1 - night;
      for (let pi = 0; pi < BUTTERFLY.length; pi++) {
        ctx.fillStyle = css(shade(BUTTERFLY[pi], sky, 0.9, 1.15));
        ctx.beginPath();
        let drawn = false;
        for (let i = 0; i < this.ng; i++) {
          const g = this.bugs[i];
          if (g.tint !== BUTTERFLY[pi]) continue;
          this.kick(g, t, o);
          const x = g.cx + o[0], y = g.cy + o[1];
          // 拍翅：一邊的寬度隨時間收放，另一邊反相——側看就是一開一闔
          const flap = Math.abs(Math.cos((t * 9.5 + g.phase * 6.28)));
          const w = (2.4 + 3.2 * flap) * g.rim * dayW;
          const h = 3.6 * g.rim * dayW;
          const lean = Math.atan2(o[3], o[2] || 1e-6) * 0.18;
          ellipse(ctx, x - w * 0.55, y - h * 0.25 + lean, w, h);
          ellipse(ctx, x + w * 0.55, y - h * 0.25 - lean, w, h);
          drawn = true;
        }
        if (drawn) ctx.fill();
      }
    }

    // ── 螢火蟲（晚上）──
    // 加色混合，而且是「亮度的責任週期」而不是位置：pow(sin, 6) 大部分時間接近 0，
    // 只有短短一下衝到 1——那個不對稱才是螢火蟲，不是均勻的一閃一閃。
    if (night > 0.02) {
      const prev = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass === 0
          ? css(FIREFLY, 0.40)      // 外圈的暈
          : css(FIREFLY, 1.9);      // 核心
        ctx.beginPath();
        let drawn = false;
        for (let i = 0; i < this.ng; i++) {
          const g = this.bugs[i];
          this.kick(g, t, o);
          const s0 = Math.sin(t * 1.9 + g.phase * 6.28);
          const duty = s0 > 0 ? Math.pow(s0, 4.5) : 0;
          if (duty < 0.02) continue;
          const a = duty * night * g.rim;
          const r = (pass === 0 ? 7.5 : 2.1) * (0.55 + a * 0.85);
          // 慢慢往上飄一點，離開草面才像在空中
          const y0 = g.cy + o[1] - 5 - Math.sin(t * 0.8 + g.phase * 4.1) * 3;
          const x = g.cx + o[0], y = y0;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, 6.2832);
          drawn = true;
        }
        if (drawn) { ctx.globalAlpha = pass === 0 ? 0.70 * night : 1.0 * night; ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = prev;
    }
  }
}

/** 給脈衝用的無狀態雜湊：踢的序號 → 方向與幅度。 */
function hash2(a, b) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function ellipse(ctx, cx, cy, rx, ry) {
  ctx.moveTo(cx + rx, cy);
  ctx.ellipse(cx, cy, Math.max(0.2, rx), Math.max(0.2, ry), 0, 0, 6.2832);
}

/**
 * 一片葉子：脊線加上沿法線的錐形偏移。
 *
 * 為什麼不是隨手兩條曲線：那樣「寬度」不是一個量，只是兩條線碰巧離多遠，
 * 於是葉子傾斜時會自己變胖變瘦。這裡寬度是沿著法線量的，傾斜多少都一樣厚——
 * 草有沒有體積就是這個量說了算。
 *
 * 兩側的控制點不對稱（0.86 對 1.25）：外側鼓、內側瘦，這就是卡通葉子的側影。
 * 捲度 curl 把葉尖往外推，外圈的葉子因此是往外趴的一道弧，不是一根斜的針。
 *
 * 而且整片葉子繞根部旋轉，不是剪切——剪切過的草會愈倒愈長，
 * 一整片同時變長的草是最明顯的假風。
 */
function blade(ctx, b, t, W) {
  // 躺平的葉子受風小：|cos(a)| 就是它還剩多少「立著」的成分
  const up = Math.cos(b.a);
  const bend = (gust(b.x, t) - 0.5) * 2 * W * b.susc * (up < 0 ? -up : up);
  const a = b.a + bend;
  const h = b.h;
  const ux = Math.sin(a), uy = -Math.cos(a);     // 沿著葉子往尖端
  const vx = -uy, vy = ux;                       // 法線（a=0 時指向右）
  const c = b.curl * h;
  const mx = b.x + ux * h * 0.52 + vx * c * 0.20;
  const my = b.y + uy * h * 0.52 + vy * c * 0.20;
  const tx = b.x + ux * h + vx * c * 0.62;
  const ty = b.y + uy * h + vy * c * 0.62;
  const hw = b.w * 0.5;
  ctx.moveTo(b.x - vx * hw, b.y - vy * hw);
  ctx.quadraticCurveTo(mx - vx * hw * 0.86, my - vy * hw * 0.86, tx, ty);
  ctx.quadraticCurveTo(mx + vx * hw * 1.25, my + vy * hw * 1.25, b.x + vx * hw, b.y + vy * hw);
  ctx.closePath();
}

// 進出視野時縮小，而不是淡出：最後消失的永遠是本來就最不顯眼的那個
function edgeFade(x, x0, x1) {
  const m = 46;
  return Math.min(1, Math.min((x - x0) / m, (x1 - x) / m));
}

export { leafWidth };
