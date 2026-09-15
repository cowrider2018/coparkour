/* ── test-area/src/veil.js ───────────────────────────────────────────
   黑牆與黑霧。

   ── 它是什麼 ────────────────────────────────────────────────────
   每個場地外圈一道黑牆，把隔壁的廢墟與無邊的地面擋掉，畫面因此聚焦在
   這一座裡面。黑牆同時**就是移動的上限**：那一筆在 blocks.js 登記成一個
   'bound' 碰撞體，跟柱子和牆進同一張清單、由同一支 `solveXZ` 解。障礙物
   與場地邊界在遊戲裡是同一件事（擋住），差別只在它被什麼外觀包裹——這一
   支就是那個外觀。

   形狀與尺寸完全來自那一筆碰撞資料（方的房間就是方的牆，圓的就是圓的），
   而「邊界在哪」只有一個定義：`walk.js` 的 arenaGap。方的四段就是精確的；
   圓用 96 段去逼近，最大的那個場地（半徑 22）弓高 1.2 公分——「畫面上的
   牆」與「走得到的地方」差一公分，感覺得到的只有一個東西。（56 段的話是
   3.5 公分，那是走到牆邊會覺得「還沒貼到就停了」的量級。）

   高度逐場地給（`arena.veil`），因為貼著牆面的房間跟留了一圈牆外的城牆
   需要的高度不一樣：只要比砌體高一點就夠，再高就把天空吃掉，而遺跡的
   剪影是打在天空上的。

   ── 黑霧是這道牆自己帶的，不是世界的霧 ──────────────────────────
   把場景的霧調黑、遠端收到黑牆上，是最省事的做法，但那會把整個世界弄黑
   ——場地中央、遠處的柱列、連狗都會偏黑，而要糊的只有牆那一圈。所以世界
   的霧留著原本那層暖霧，黑霧做在牆上，三件事全部是頂點透明度，零 runtime：

     · 往上淡出。SOLID 以下是實心的（比最高的廢墟 10.4 還高一點，所以
       隔壁那幾座看不到），SOLID 到 TOP 之間淡到全透明——天空還在，遺跡的
       剪影仍然是打在天空上的。整片黑到頂的話，「這裡曾經有多高」這件事
       就沒有了，而那是這種造型唯一真正被看見的東西。
     · 內側一層薄霧殼。牆往內縮 1.2 公尺再來一圈半透明的黑，於是牆邊的
       東西是「隔著一層霧」而不是「貼在一塊黑布上」。薄——它的工作是糊掉
       牆那一條邊，不是把房間弄暗。
     · 牆腳一圈地面漸層。牆往上有得淡、往下沒有，地面是走到牆邊才突然
       變黑——那一條就是「一面黑板子插在地上」的來源。

   ── 為什麼是資料而不是一個 mesh ────────────────────────────────
   跟 blocks.js 同一個理由：這裡只吐頂點與透明度，材質與 mesh 是 main.js
   的事。而且它有一個看不出來的失敗模式——三角形的繞向。法線必須朝內
   （場地的軸），因為材質是單面的：繞向反了就整片被剔掉，畫面上是「黑牆
   沒有出現」，而那跟「還沒做」長得一模一樣。繞向算得對不對，node 驗得出來。
   ------------------------------------------------------------------ */

export const VEIL = {
  base: -1.5,          // 牆腳埋進地面以下
  seg: 96,             // 圓切幾段（弓高 = 弦長² / 8r，22 公尺半徑下 1.2 cm）
  bands: 5,            // 淡出切幾段（頂點內插是線性的，一段會看得到折線）
  /* 黑霧：[往內縮多少, 透明度]。第一層就是黑牆本身，第二層是糊在它內側
     的那一層薄霧。要更厚就在這裡加一層，不必動別的地方。 */
  haze: [[0, 1.0], [1.2, 0.34]],
  skirt: 2.5,          // 牆腳那圈地面漸層的寬度
  skirtY: 0.03,        // 躺在地面上方這麼高（蓋得住鋪面與壓進地板的碎石）
  steps: 3,            // 那圈漸層切幾段
};

/** 線性淡出的上緣會看得到一條直線，所以用 smoothstep 的補數。 */
const fade = (u) => 1 - u * u * (3 - 2 * u);

/**
 * 一個場地的外框：一圈點，繞向讓 quad 算出來的法線朝內。
 *
 * 方的四個點、圓的 56 個點，之後的擠出與漸層都不必再管形狀。`inset` 是
 * 往內縮多少（方的四邊各縮、圓的減半徑），所以霧殼與牆腳那圈漸層可以
 * 用同一支拿到自己的那一圈。
 */
export function outline(a, inset = 0) {
  if (a.shape === 'circle') {
    const rad = Math.max(0.2, a.r - inset);
    const pts = [];
    for (let i = 0; i < VEIL.seg; i++) {
      const t = (i / VEIL.seg) * Math.PI * 2;
      pts.push([a.x + Math.cos(t) * rad, a.z + Math.sin(t) * rad]);
    }
    return pts;
  }
  const x0 = a.x0 + inset, x1 = a.x1 - inset;
  const z0 = a.z0 + inset, z1 = a.z1 - inset;
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

/**
 * @param {object[]} arenas blocks.js 的 `arenas`
 * @returns {{pos: Float32Array, alpha: Float32Array, tris: number}}
 *   pos 三個一組、alpha 一個一組（顏色由 main.js 給，它才知道色彩空間）
 */
export function buildVeil(arenas) {
  const pos = [], alpha = [];
  const put = (x, y, z, a) => { pos.push(x, y, z); alpha.push(a); };
  /* 一片四邊形，繞向讓法線朝內。順序是 (p0,y0) → (p1,y0) → (p1,y1)：
     u = p1 − p0 是切向（角度遞增），w 往上，u × w 指向軸——換兩個頂點
     就會朝外，而朝外的話單面材質會把整片剔掉。 */
  const quad = (p0, p1, y0, y1, a0, a1) => {
    put(p0[0], y0, p0[1], a0); put(p1[0], y0, p1[1], a0); put(p1[0], y1, p1[1], a1);
    put(p0[0], y0, p0[1], a0); put(p1[0], y1, p1[1], a1); put(p0[0], y1, p0[1], a1);
  };
  for (const a of arenas) {
    const [solid, top] = a.veil;
    for (const [inset, al] of VEIL.haze) {
      const P = outline(a, inset);
      for (let i = 0; i < P.length; i++) {
        const p0 = P[i], p1 = P[(i + 1) % P.length];
        quad(p0, p1, VEIL.base, solid, al, al);
        for (let k = 0; k < VEIL.bands; k++) {
          const u0 = k / VEIL.bands, u1 = (k + 1) / VEIL.bands;
          quad(p0, p1,
            solid + (top - solid) * u0,
            solid + (top - solid) * u1,
            fade(u0) * al, fade(u1) * al);
        }
      }
    }

    /* 牆腳那一圈。由內而外從透明到不透明，接上牆腳。法線朝上（同樣是
       繞向算出來的），所以從上面看得到、從底下不會擋住。 */
    const y = VEIL.skirtY;
    for (let k = 0; k < VEIL.steps; k++) {
      const u0 = k / VEIL.steps, u1 = (k + 1) / VEIL.steps;
      const inner = outline(a, VEIL.skirt * (1 - u0));
      const outer = outline(a, VEIL.skirt * (1 - u1));
      const a0 = 1 - fade(u0), a1 = 1 - fade(u1);
      for (let i = 0; i < inner.length; i++) {
        const j = (i + 1) % inner.length;
        const q0 = inner[i], q1 = inner[j], q2 = outer[j], q3 = outer[i];
        put(q0[0], y, q0[1], a0); put(q1[0], y, q1[1], a0); put(q2[0], y, q2[1], a1);
        put(q0[0], y, q0[1], a0); put(q2[0], y, q2[1], a1); put(q3[0], y, q3[1], a1);
      }
    }
  }

  return {
    pos: new Float32Array(pos),
    alpha: new Float32Array(alpha),
    tris: pos.length / 9,
  };
}
