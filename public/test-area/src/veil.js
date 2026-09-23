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

   高度逐場地給（`arena.lid`）：牆從牆腳一路實心到那個高度，然後封頂。
   封閉之後場地是一個完全封死的黑盒子——看得到的只有房裡的結構，連天空
   都沒有，而那正是「人在房間裡面」這件事的全部。

   ── 黑霧是這道牆自己帶的，不是世界的霧 ──────────────────────────
   把場景的霧調黑、遠端收到黑牆上，是最省事的做法，但那會把整個世界弄黑
   ——場地中央、遠處的柱列、連狗都會偏黑，而要糊的只有牆那一圈。所以世界
   的霧留著原本那層暖霧，黑霧做在牆上，三件事全部是頂點透明度，零 runtime：

     · 牆與頂都是實心的純黑，而且是同一個顏色——所以牆與頂之間沒有邊。
       黑跟黑之間看不到交界，畫面上唯一的邊是「被照到的石頭」與「黑」的
       交界，也就是房裡結構自己的剪影。頂的高度要蓋過最高的砌體（王座廳
       那幾根斜插的穹稜是 10.4 公尺），不然它會把屋頂切掉。
     · 內側一層薄霧殼。牆往內縮 1.2 公尺再來一圈半透明的黑，於是牆邊的
       東西是「隔著一層霧」而不是「貼在一塊黑布上」。薄——它的工作是糊掉
       牆那一條邊，不是把房間弄暗。
     · 牆腳一圈地面漸層。地面是走到牆邊才突然變黑的，而那一條就是「一面
       黑板子插在地上」的來源。

   ── 為什麼是資料而不是一個 mesh ────────────────────────────────
   跟 blocks.js 同一個理由：這裡只吐頂點與透明度，材質與 mesh 是 main.js
   的事。而且它有一個看不出來的失敗模式——三角形的繞向。法線必須朝內
   （場地的軸），因為材質是單面的：繞向反了就整片被剔掉，畫面上是「黑牆
   沒有出現」，而那跟「還沒做」長得一模一樣。繞向算得對不對，node 驗得出來。
   ------------------------------------------------------------------ */

export const VEIL = {
  base: -1.5,          // 牆腳埋進地面以下
  seg: 96,             // 圓切幾段（弓高 = 弦長² / 8r，22 公尺半徑下 1.2 cm）
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
    const lid = a.lid;
    // 場地可以帶自己的霧（城牆步道要厚一點，走道才是慢慢淡進黑暗裡）。
    for (const [inset, al] of a.haze || VEIL.haze) {
      const P = outline(a, inset);
      for (let i = 0; i < P.length; i++) {
        quad(P[i], P[(i + 1) % P.length], VEIL.base, lid, al, al);
      }
    }

    /* 頂。從中心拉出去的一圈扇形，繞向讓法線朝下（站在下面才看得到）。
       只有最外面那一層（不透明的那一層）封頂：內側那層薄霧的工作是糊掉
       牆那一條邊，封起來只會讓抬頭看的時候整片再暗一次。 */
    {
      const P = outline(a, 0);
      const cx = a.shape === 'circle' ? a.x : (a.x0 + a.x1) / 2;
      const cz = a.shape === 'circle' ? a.z : (a.z0 + a.z1) / 2;
      for (let i = 0; i < P.length; i++) {
        const q0 = P[i], q1 = P[(i + 1) % P.length];
        put(cx, lid, cz, 1); put(q0[0], lid, q0[1], 1); put(q1[0], lid, q1[1], 1);
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
