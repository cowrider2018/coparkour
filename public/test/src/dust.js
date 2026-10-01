/* ── test/src/dust.js ───────────────────────────────────────────────
   落地的粉塵：一個身體落地，腳下揚起一圈塵，往外推開、捲一下、散掉。

   這一支只算數字——這一下落地揚起多少塵、推多遠、留多久。畫出來是 fight.js
   的事（流體場的一格，fluid.js）；而這一支 node 驗得動（tools/verify-combat.mjs
   的「落地粉塵」那一節）。

   ── 多濃 ────────────────────────────────────────────────────────
   力道 power = 體型² ×（落地速度 − min）/（ref − min）：

     體型   身體畫多高，狗是 1（monster.js：BOSS 是 2）。平方是因為揚起的塵跟
            踩下去的那一片面積走——兩倍大的腳印是四倍的地面。
     速度   落地那一刻往下掉多快。ref 是一次普通的跳落回原地的速度
            （walk.js 的 PHYS.jump），所以狗普通地跳一下是 power 1；比 min 慢
            （走下一級台階、小跳）不起塵。

   power 越大：注入的塵越濃、起塵的那一圈越大、往外推得越快越遠、留得越久。
   塵是輕的：推得快、散得快（半秒上下），濃度不高，一下就被吃掉。
   每一項都跟著體型或 power 往上走，不會有「更重的落地反而比較淡」的時候。

   ── 地震 ────────────────────────────────────────────────────────
   BOSS 的範圍攻擊打下去的那一刻——扇形（skills.js 的 cone）踩下去、跳砸（leap）
   落地——一道震波從牠腳下往外走（扇形沿著扇形、跳砸是一整圈），走到哪一圈就在
   那一圈揚起一道塵、往外推。跳砸落地不另外揚落地的那一團塵：那一下就是地震。一道比一道濃，而煙鼓多高是跟著
   濃度走的（fluid.js 的 Sheet），所以越遠的塵越高——看得出震波越走越猛。
   外圈的塵也比較晚揚起，被流體消散吃掉的比較少，又再高一點。

   煙鼓多高跟濃度走，但會飽和（fluid.js：1 − e^(−2x²)，x 是超過切的門檻多少），
   所以最外面那一道不能太濃：太濃的話外面幾道都頂到同一個高度，「越遠越高」只剩
   前兩道看得出來。濃度壓在每一道都還會長高的範圍裡，高度用 thick 撐——四道大約
   是 0.2、0.7、1.5、2.0 公尺，最外面那一道跟 BOSS 差不多高。

   每一道要看得出是分開的一道：道與道隔得夠開、每一道窄、往外推得慢。推得快
   或隔得近的話一道追上下一道，幾道塵連成一整團，看不出哪裡高哪裡低。所以分幾道
   是照範圍的半徑與間隔（gap）算的，不是固定的：扇形（半徑 3.7 公尺）是 4 道、
   跳砸的圓（2.3 公尺）是 3 道。
   ── 犁地 ────────────────────────────────────────────────────────
   國王劈砍推出去的氣流（skills.js 的 gusts）落在地上的那一頭整條貼著地板往前走，像犁
   一樣把地上的塵往兩邊推開：前緣每走過一段新的地面，那一段的左右兩緣各揚一道塵，往
   外側推、也被帶著往前一點。一道是一小團一小團（每 clump 公尺一團）潑出去的：每一團推多快、
   多濃各自抽（照它在那一條上的位置算，每一幀都一樣）——整條一樣的話是兩道土堤，不像飛濺。劈下去的那一刻，劍光落地的那一整截（離刀根 inner～top）
   一次揚起來。

   劍氣走過的那一條（中線左右各半個劍氣寬）裡的塵不畫（fluid.js 的 Sheet 的 gap）：劍氣細的時候
   兩緣推出去的塵會往中間流、黏成一道，挖掉這一條才看得出是往兩邊分開的。

   一道氣流可能飛三十幾公尺，一片煙蓋不住（一片越大、流體的格子越粗）：沿那一條每 PLOW.seg
   公尺一段，一段借一片煙、一格流體，前緣走進下一段就換下一片。前一片照樣留著散完。
   ------------------------------------------------------------------ */

import { PHYS } from './walk.js';

export const DUST = {
  /** 落地速度低於這個（公尺 / 秒）不起塵。 */
  min: 2.5,
  /** 一次普通的跳落回原地的速度：power 1 的那一下。 */
  ref: PHYS.jump,
  /** power 的上限：從很高的地方掉下來也不會把整個畫面蓋掉。 */
  max: 4,
};

/**
 * 一次落地揚起的塵。落得太輕是 null。
 *
 * @param {number} size 體型（狗是 1）
 * @param {number} speed 落地那一刻往下掉多快（公尺 / 秒）
 * @returns {null | {power:number, amount:number, foot:number, push:number, life:number, half:number, thick:number}}
 *   amount 注入多少濃度（倍數）
 *   foot   起塵的那一圈多大（公尺，半徑）：腳印那麼大
 *   push   往外推多快（公尺 / 秒）
 *   life   留多久（秒）
 *   half   那一片煙的半邊長（公尺）：推得到的地方都要在裡面
 *   thick  最濃的地方鼓多高（公尺）：塵是揚起來的，鼓得比劍氣高很多
 */
export function dustOf(size, speed) {
  if (!(speed > DUST.min)) return null;
  const power = Math.min(DUST.max, (size * size * (speed - DUST.min)) / (DUST.ref - DUST.min));
  const k = Math.sqrt(power);
  const foot = 0.3 * size;
  const push = 1.5 * (1.4 + 1.6 * k) * Math.sqrt(size);
  const life = 0.35 + 0.15 * k;
  return {
    power,
    amount: 0.3 + 0.35 * power,
    foot,
    push,
    life,
    half: foot + 0.45 * push * life + 0.4,
    thick: 0.2 * size * (0.7 + 0.3 * Math.min(1, power)),
  };
}

/** 塵長什麼樣（fluid.js 的 Sheet.place）：土黃，背光那一階深一點；抹得比劍氣開（soft），推開時拉出的
    細長指狀會融回一團一團的圓塊，才像塵不像潑出去的水。thick 每一團各自給。 */
export const DUST_LOOK = { thick: 0.1, lit: [0.88, 0.81, 0.69], shade: [0.67, 0.58, 0.47], soft: 9, ground: true };

/** 注入那幾幀：落地之後這麼久之內一直往外推（秒）。 */
export const PUSH_TIME = 0.06;

/** 那團塵這一刻還剩幾成（1 → 0）：頭 15% 的時間全在，之後一路散到 life 收掉。 */
export function dustFade(d, tau) {
  const u = Math.min(1, Math.max(0, (tau - 0.15 * d.life) / (0.85 * d.life)));
  return 1 - u * u * (3 - 2 * u);
}

/**
 * 地震的塵。扇形與跳砸的圓共用的：
 *
 *   gap     道與道大約隔多遠（公尺）：半徑除以它、四捨五入是幾道（至少 2 道）。
 *   wave    震波從腳下走到範圍最遠處要多久（秒）。
 *   inject  每一道注入多久（秒）：震波走到之後這幾幀一直往外推。
 *   life    整片塵從打下去算起留多久（秒）。
 *   rise    煙多快鼓到 thick（fluid.js 的 Sheet）：比落地的塵（2）慢很多，濃度差才一路
 *           看得出高度差，不會外面幾道都頂到 thick。
 *
 * 每一種範圍各自的（cone、circle）：
 *
 *   near／far  最裡面、最外面那一道注入多少濃度（中間照距離內插）。最裡面那一道最早揚、
 *           被消散吃掉最多，near 太淡的話它等不到最外面那一道揚起來就切不出來了。
 *   width   每一道注入的寬度（公尺，注入的半徑）。
 *   push    往外推多快（公尺 / 秒）：慢，道與道之間才留得住空隙。
 *   soft    硬切之前抹平的半徑（fluid.js 的 Sheet）：一道越窄，抹太開越會被抹淡、變矮。
 *   thick   鼓的高度的上限（公尺）。
 *   top     震波打得到的高度：[最裡面、最外面]（公尺，從那一層地板往上量），中間照距離內插。
 *           就是上面那幾道塵鼓多高（扇形四道 0.2～2.0、圓 0.2～1.5）——看得到塵的地方才打得到，
 *           skills.js 的 strikeHits 照它判；跳起來躲得過矮的裡圈，躲不過高的外圈。
 *
 * 圓比扇形小（2.3 對 3.7 公尺），道與道隔得近，所以每一道更窄、推得更慢、抹得更少。
 */
export const QUAKE = {
  gap: 0.9, wave: 0.4, inject: 0.06, life: 1.2, rise: 0.45,
  cone: { near: 0.9, far: 1.8, width: 0.25, push: 0.6, soft: 9, thick: 3, top: [0.2, 2.0] },
  circle: { near: 0.9, far: 1.8, width: 0.2, push: 0.35, soft: 6, thick: 1.5, top: [0.2, 1.5] },
};

/** 震波走到半徑的 u 成（0～1）那一道，塵鼓多高（公尺）：QUAKE 的 top 照距離內插。 */
export function quakeTop(shape, u) {
  const [lo, hi] = QUAKE[shape].top;
  return lo + (hi - lo) * Math.min(1, Math.max(0, u));
}

/**
 * 一種範圍（'cone'、'circle'）、半徑 r，揚幾道塵，每一道（由裡到外）：在半徑的幾成（u）、打下去之後幾秒震波
 * 走到（at）、注入多少濃度（amount）。越外面越晚、越濃。
 */
export function quakeBands(shape, r) {
  const { near, far } = QUAKE[shape];
  const n = Math.max(2, Math.round(r / QUAKE.gap));
  return Array.from({ length: n }, (_, i) => {
    const u = (i + 0.5) / n;
    return { u, at: QUAKE.wave * u, amount: near + (far - near) * u };
  });
}

/** 一片地震的塵這一刻還剩幾成（1 → 0）：最外面那一道揚完之前全在，之後散到 life 收掉。 */
export function quakeFade(tau) {
  const t0 = QUAKE.wave + QUAKE.inject;
  const u = Math.min(1, Math.max(0, (tau - t0) / (QUAKE.life - t0)));
  return 1 - u * u * (3 - 2 * u);
}

/**
 * 氣流犁地揚起的塵：
 *
 *   seg     一片煙管沿那一條多長的一段（公尺）。
 *   margin  煙片往前後、往兩側多留多少（公尺）：推出去的塵要落在片裡。
 *   push    往外側推多快（公尺 / 秒）。
 *   ahead   往前帶的速度是往外推的幾成。
 *   amount  注入多少濃度：走過的地方每一點都只蓋到一次，跟走多快、幀率無關。
 *   width   注入多粗（公尺，注入的半徑）。
 *   life    一片最後一次注入之後留多久（秒）。
 *   thick   鼓多高（公尺）。
 */
export const PLOW = { seg: 6, margin: 1.6, push: 1.2, ahead: 0.35, amount: 0.4, width: 0.16, life: 0.9, thick: 0.15, clump: 0.35 };

/**
 * 犁地的第 i 團（離起點 i·clump～(i+1)·clump、e 那一側）推多快、多濃（PLOW.push、amount 的幾倍）：
 * 推 0.5～1.5 倍、濃 0.4～1.4 倍，固定的亂數。
 */
export function plowClump(i, e) {
  const h = (k) => { const x = Math.sin(i * 127.1 + e * 57.3 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
  return { push: 0.5 + h(1), amount: 0.4 + h(2) };
}

/**
 * 沿那一條從 a 犁到 b（離氣流起點量，公尺）：照 PLOW.seg 切成落在哪一段的幾截，再照 clump
 * 切成一團一團（i 是第幾團）。
 *
 * @returns {{k: number, i: number, a: number, b: number}[]} 第 k 段（涵蓋 k·seg～(k+1)·seg）裡、第 i 團的那一截
 */
export function plowPieces(a, b) {
  const out = [];
  for (let x = a; x < b - 1e-9;) {
    const k = Math.floor(x / PLOW.seg + 1e-9), i = Math.floor(x / PLOW.clump + 1e-9);
    const y = Math.min(b, (k + 1) * PLOW.seg, (i + 1) * PLOW.clump);
    out.push({ k, i, a: x, b: y });
    x = y;
  }
  return out;
}
