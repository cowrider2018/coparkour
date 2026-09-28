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
export const DUST_LOOK = { thick: 0.1, lit: [0.88, 0.81, 0.69], shade: [0.67, 0.58, 0.47], soft: 9 };

/** 注入那幾幀：落地之後這麼久之內一直往外推（秒）。 */
export const PUSH_TIME = 0.06;

/** 那團塵這一刻還剩幾成（1 → 0）：頭 15% 的時間全在，之後一路散到 life 收掉。 */
export function dustFade(d, tau) {
  const u = Math.min(1, Math.max(0, (tau - 0.15 * d.life) / (0.85 * d.life)));
  return 1 - u * u * (3 - 2 * u);
}
