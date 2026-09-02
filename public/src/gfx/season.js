// ── 季節：一條 x 軸上的地理，不是一個狀態 ────────────────────
// 每 1000 m 換一季。分界只看被問到的那個東西自己的 x，所以跟這份程式裡
// 其他所有外觀一樣是無狀態的：不必記「現在是第幾季」，也不會因為鏡頭往回拉
// 就換一批草。玩家跑過 1000 m 會看到整片地貌換掉。
//
// 過渡帶的做法是這份模組唯一真正的想法：**不混色，混密度**。
//
//   兩種顏色 lerp 出來的中間值是第三種顏色——一段泥巴綠、一段泥巴橘，
//   那個顏色在兩側都不存在，於是過渡帶看起來像沒調好的濾鏡。
//   真實的季節交界不是這樣運作的：那裡是「還綠著的草」和「已經黃了的草」
//   並排長在一起，只是往前走一步黃的多一點。所以這裡讓每一叢草各自抽籤
//   選邊站（seasonPick），機率隨 x 從 0 走到 1。任何一叢草永遠是純色，
//   而一整片的平均才是漸變。
//
//   代價是抽籤要穩定——同一叢草每一幀都要抽到同一邊，不然整片會閃。
//   所以 r 一律由座標雜湊給，不是 Math.random()。
import { mix3 } from './daycycle.js';

export const SEASON_SPAN = 10000;   // 標記是 x/10 m，所以 1000 m = 10000 世界單位
export const SEASON_N = 3;
const BLEND = 2600;                 // 過渡帶總寬（分界左右各一半）
const HALF = BLEND / 2;

/**
 * 五個物種、三種土、三種遠山，全部按季節排好。
 *
 * ramp 是草的四階，由「背向 / 陰影裡」到「朝光 / 最前排」。分階不是分高度：
 * 一根草整根同一個顏色，階由它的朝向與它在草皮裡的前後決定——這是草有體積的
 * 全部原因。四階都是手挑的，不是從兩端內插出來的，因為卡通的色階本來就該
 * 有人決定它往哪偏（夏天的中階偏黃綠、冬天的中階偏灰藍）。
 *
 * 全部是 linear albedo，要經過 daycycle 的 shade() 才落地。
 */
export const SEASON = [
  { // 0 綠：盛夏，草最密最厚
    label: '綠',
    ramp: [
      [0.018, 0.058, 0.020],
      [0.052, 0.165, 0.046],
      [0.120, 0.330, 0.086],
      [0.245, 0.505, 0.132],
    ],
    dry:  [0.300, 0.262, 0.070],
    cap:  [0.082, 0.225, 0.062],   // 草皮那一整條的底色
    lit:  [0.235, 0.480, 0.128],   // 草皮頂緣的受光邊
    soil: [0.100, 0.066, 0.040],
    deep: [0.046, 0.030, 0.020],
    ridge:[0.062, 0.098, 0.070],
    bloom: 1.00,
    thick: 1.00,                   // 草皮厚度與草的密度倍率
  },
  { // 1 秋：整片轉成琥珀，草開始稀
    label: '秋',
    ramp: [
      [0.068, 0.040, 0.014],
      [0.180, 0.100, 0.026],
      [0.370, 0.212, 0.045],
      [0.620, 0.400, 0.092],
    ],
    dry:  [0.470, 0.150, 0.045],
    cap:  [0.245, 0.135, 0.030],
    lit:  [0.600, 0.385, 0.088],
    soil: [0.096, 0.058, 0.032],
    deep: [0.044, 0.026, 0.016],
    ridge:[0.105, 0.082, 0.055],
    bloom: 0.62,
    thick: 0.86,
  },
  { // 2 冬：積雪壓在草皮上，露出來的是枯梗
    label: '冬',
    ramp: [
      [0.038, 0.050, 0.068],
      [0.125, 0.150, 0.186],
      [0.380, 0.432, 0.492],
      [0.680, 0.742, 0.822],
    ],
    dry:  [0.258, 0.238, 0.202],
    cap:  [0.105, 0.135, 0.172],
    lit:  [0.660, 0.720, 0.800],
    soil: [0.115, 0.112, 0.126],
    deep: [0.058, 0.057, 0.068],
    ridge:[0.098, 0.104, 0.120],
    bloom: 0.14,
    thick: 0.78,
  },
];

const wrap = (k) => { const i = k % SEASON_N; return i < 0 ? i + SEASON_N : i; };

/** 這個 x 站在第幾季裡（不管過渡帶）。 */
export function seasonIndex(x) {
  return wrap(Math.floor(x / SEASON_SPAN));
}

const TMP = [0, 0, 0];

/**
 * 離最近的那道分界有多近，以及兩側各是誰。
 * @param {number} x
 * @param {number[]} [o] 長度 3 的暫存，回寫 [左邊那季, 右邊那季, 抽到右邊的機率]
 */
export function seasonMix(x, o) {
  const out = o || TMP;
  const b = Math.round(x / SEASON_SPAN);       // 最近的分界是第幾道
  const d = x - b * SEASON_SPAN;               // 到它的有號距離
  if (d <= -HALF || d >= HALF) {
    const i = seasonIndex(x);
    out[0] = i; out[1] = i; out[2] = 0;
    return out;
  }
  const t = 0.5 + d / BLEND;
  out[0] = wrap(b - 1);
  out[1] = wrap(b);
  out[2] = t * t * (3 - 2 * t);                // smoothstep：帶的兩端各自收斂得乾淨
  return out;
}

/**
 * 密度偏向的抽籤。r 必須是這個東西自己的座標雜湊——同一叢草每幀要抽到同一邊。
 * @returns {number} 季節索引
 */
export function seasonPick(x, r) {
  const o = seasonMix(x, TMP);
  return r < o[2] ? o[1] : o[0];
}

/**
 * 需要連續值的東西（土、遠山）走這條。
 * 一整塊土或一整座山是一個面，不是一群個體，沒有東西可以拿來抽籤——
 * 對一個面來說 lerp 才是對的，跟草剛好相反。
 */
export function seasonBlend(x, key) {
  const o = seasonMix(x, TMP);
  if (o[0] === o[1]) return SEASON[o[0]][key];
  return mix3(SEASON[o[0]][key], SEASON[o[1]][key], o[2]);
}

/** 純量版的 seasonBlend（bloom / thick）。 */
export function seasonScalar(x, key) {
  const o = seasonMix(x, TMP);
  const a = SEASON[o[0]][key];
  if (o[0] === o[1]) return a;
  return a + (SEASON[o[1]][key] - a) * o[2];
}
