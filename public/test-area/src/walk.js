/* ── test-area/src/walk.js ───────────────────────────────────────────
   走路的規則。

   單獨一支檔案，是因為它有兩個使用者：/test-area/ 這一頁，以及
   tools/verify-test-area.mjs——那支腳本在 node 底下把四個區塊砌一遍，
   然後用「中心那片空地上每一格的支撐高度都一樣」來驗證「中心夠空曠」
   這條規則。兩邊必須是同一份規則，不是「看起來很像」的兩份：中心是不是
   真的走得動，只有踩過才知道，而踩的那個動作要能離線做。

   狗當成一個圓柱（半徑 0.30、高 0.92）。碰撞盒是軸對齊的（blocks.js
   砌的時候登記），一張清單四百多個，每次全掃——四百次比較比建索引便宜，
   而且地圖是靜態的，沒有「盒子搬家要重建索引」的問題。

   清單裡有兩種東西，但只有一套「擋住」的邏輯：

     盒子（'floor'／'block'／'step'／'shell'）  不准進來。
     場地（'bound'）                          不准出去——黑牆。方的或圓的。

   而「盒子」有兩種形狀。軸對齊的方盒是預設；`shape: 'circle'` 的是一根
   直立的圓柱（軸 x, z 加半徑 r）。場上有一半的東西是圓的——柱、井、樹、
   火盆、大石——而一個方盒的角比它所代表的圓遠 41%：繞著一根柱子走，身體
   會在四個角上各被頂開一次，那個頓挫在畫面上找不到對應的東西，因為畫面上
   是圓的。圓的東西因此就是一個圓，推出的方向是半徑。

   欄位跟場地邊界同一組（`shape`／`x`／`z`／`r`），因為它們是同一個形狀，
   差別只在「不准進來」還是「不准出去」。圓柱一樣帶著它的外接 AABB
   （`min`／`max`），所以吃盒子的那些檢查不必先認得圓。

   圓的東西垂直方向分兩段，界線在**最大 XZ 截面**的高度 `cap`：

     cap 以下   直立的柱面。牆，照常擋住。
     cap 以上   圓頂（半軸 r 與 dome 的橢球冠）。`dome = 0` 就是平頂的
                純圓柱——柱頂、井口、台座：站得住，沒有第二條規則。

   圓頂上站不住，怎麼滑由 `slip` 決定，見 SLIDE。

   場地邊界之所以不是「另一支夾限函式」，是因為障礙物與邊界在遊戲裡是
   同一件事：擋住。差別只在它被什麼外觀包裹（砌體，或是黑牆與黑霧）。
   兩套邏輯的話，「牆擋得住我但邊界把我吸過去」這種 bug 就有地方住。
   ------------------------------------------------------------------ */

/* 走 4、衝 8，重力 22。加速與煞車跟著衝刺速度一起放大，所以從靜止到
   全速花的時間不變，只是更快。跳躍不是直接給初速，而是先定「跳多高」
   （1.5 個狗高），再用 v = √(2gh) 反推。
   STEP 0.36 比階梯的級高（0.27～0.32）大一點，所以樓梯不必跳。 */
const DOG_H = 0.92;
const JUMP_H = 1.5 * DOG_H;
export const PHYS = {
  walk: 4, run: 8, accel: 34, brake: 23,
  gravity: 22, jump: Math.sqrt(2 * 22 * JUMP_H),
  radius: 0.30, height: DOG_H, step: 0.36,
};

/* ── 從 PHYS 推出來的三個造形規則 ────────────────────────────────
   房間要「視覺上凹凸、腳下平坦」，靠的不是小心擺東西，是這三個數字：

     APEX      跳躍頂點 = jump² / 2g = 1.5 × 0.92 = 1.38。
     MOUNT     踩得上去的最高頂面 = APEX + step = 1.74。所以頂面 1.74
               以下的東西，玩家跳一下就站得上去。
     BLOCK_TOP 障礙物的頂面至少要這麼高（1.0）。這是照舊的跳高（頂點
               0.48、MOUNT 0.84）定的，那時候障礙物一律跳不上去；跳高
               改成 1.5 個狗高之後，頂面在 1.0～MOUNT 的障礙物變成跳得上去
               的平台，地圖沒有跟著墊高。
     TRIP      會絆腳的那一段：頂面在 0.08 到 step 之間的東西會把身體
               抬起來、頓一下。純視覺的碎石一律壓進地板、只露 0.08 以下，
               就是為了避開這一段。

   `walk.js` 自己不用這幾個數（它只吃盒子），但零件與驗證都要用，而它們
   是從 PHYS 算出來的——放在別的地方就會有兩份物理。 */
export const APEX = (PHYS.jump * PHYS.jump) / (2 * PHYS.gravity);
export const MOUNT = APEX + PHYS.step;
export const BLOCK_TOP = 1.0;
export const TRIP = [0.08, PHYS.step];

/* ── 圓頂上會滑 ──────────────────────────────────────────────────
   踩在圓頂上待不住。分兩種，差別不在形狀而在「這個東西本來就給不給
   站」——所以它是砌的時候標上去的一個字，不是從幾何猜出來的：

     'slide'  屋頂、斜坡、大石。站得住、操作得動，但不跳就會一路緩滑
              下去。2D 跑酷的抓牆就是這個手感：牆留得住你，重力不會停，
              而跳鍵隨時把你帶走。速度是**終端速度**而不是加速度
              （SLIDE.max × sinθ），所以 45° 大約 1.4 m/s：明顯在滑、
              追得上、跳得掉。積分加速度的話，一片大一點的屋頂會把人
              加速到超過衝刺速，那是摔下去，不是抓牆。

     'fall'   危險、不可踩的東西：複雜到做不出一個踩得住的面的頂（枝椏、
              一叢尖刺），或者設定上本來就不給站的地方。這一類存在的理由
              不是「擋住」，是**防止意外踩上非預期的位置**——落點失準、
              被推上去、從高處掉下來剛好落在上面，這些都會發生。
              踩上去就**失去操作**，沿著面加速 g·sinθ 直到被甩出去。
              45° 是 15.6 m/s²，所以在一個小圓頂上待不到半秒就被丟下來。
              控制權在離開那個面的瞬間回來（那時候人在空中，還救得回來）。

   `stick` 是頂端那一小塊站得穩的區域：半球頂上 sinθ 就等於離軸的比例，
   所以 18° 等於「離軸 31% 以內站得住」。沒有它的話柱頂一個都站不住，
   而跳上柱頂是這一頁少數幾件好玩的事之一。'fall' 沒有那塊區域——它的
   頂點是不穩定的，`kick` 是落在正頂上時給的最小斜度。
   ------------------------------------------------------------------ */
export const SLIDE = {
  stick: Math.sin((18 * Math.PI) / 180),
  max: 2.0,
  kick: 0.30,
};

/**
 * 緩滑（'slide'）：每秒被帶著走多遠。
 *
 * 終端速度而不是加速度——理由見 SLIDE。回傳的是**位移速度**，呼叫端
 * 要把它加在位移上而不是加進速度裡。
 *
 * @param {object} sup supportInfo 的結果
 * @returns {[number, number]} x／z 方向的速度
 */
export function slideDrift(sup) {
  if (sup.slip !== 'slide') return [0, 0];
  const v = SLIDE.max * sup.sin;
  return [sup.dx * v, sup.dz * v];
}

/**
 * 滑落（'fall'）：每秒被加速多少。
 *
 * 重力沿著斜面的分量，g·sinθ，沒有上限。這一支與上一支是同一條規則的
 * 兩半，擺在一起是為了讓「兩種滑法差在哪」一眼看得完——而且頁面與離線
 * 驗證讀的是同一份數字，不是兩份長得很像的。
 *
 * @returns {[number, number]} x／z 方向的加速度
 */
export function slideAccel(sup) {
  if (sup.slip !== 'fall') return [0, 0];
  const a = PHYS.gravity * sup.sin;
  return [sup.dx * a, sup.dz * a];
}

/* ── 圓頂的三條式子 ──────────────────────────────────────────────
   半軸 r（水平）與 dome（垂直）的橢球冠，坐在 cap 這個高度上。平頂的
   圓柱是 dome = 0 的退化情形，三支都走得通，所以呼叫端不必分兩種。 */

/** 離軸 d 的地方，表面在多高。 */
export function roundTop(b, d) {
  if (!b.dome) return b.cap;
  const u = Math.min(1, Math.max(0, d) / b.r);
  return b.cap + b.dome * Math.sqrt(1 - u * u);
}

/** 離軸 d 的地方，表面的 sin θ（θ = 表面與水平的夾角）。平頂是 0。 */
export function roundSin(b, d) {
  if (!b.dome || d <= 0) return 0;
  const u = Math.min(1, d / b.r);
  if (u >= 1) return 1;                       // 裙邊是垂直的
  const s = (b.dome / b.r) * (u / Math.sqrt(1 - u * u));
  return s / Math.sqrt(1 + s * s);
}

/** 表面降到高度 h 的那一圈半徑。柱身（h ≤ cap）就是整個半徑。 */
export function roundReach(b, h) {
  if (!b.dome || h <= b.cap) return b.r;
  const t = (h - b.cap) / b.dome;
  return t >= 1 ? 0 : b.r * Math.sqrt(1 - t * t);
}

/**
 * 點到場地邊界的距離：在裡面是正的，出去了是負的。
 *
 * 方的與圓的共用這一支，因為「邊界在哪」只該有一個定義——阻擋（solveXZ）、
 * 夾住碎石（blocks.js）、畫黑牆（veil.js）三邊都問它。三份各自算的話，
 * 遲早會出現「畫面上的牆在這裡、走得到的地方在那裡」。
 *
 * @param {object} a  {shape:'circle', x, z, r} 或 {shape:'rect', x0, x1, z0, z1}
 */
export function arenaGap(a, x, z) {
  if (a.shape === 'circle') return a.r - Math.hypot(x - a.x, z - a.z);
  return Math.min(x - a.x0, a.x1 - x, z - a.z0, a.z1 - z);
}

/**
 * 把一個點夾進場地裡（離邊界至少 margin）。
 *
 * `solveXZ` 與相機都用這一支：身體的 margin 是它的半徑（所以走到底的
 * 時候身體表面剛好貼在牆面上），相機的是 0.35（鏡頭不出牆，不然會從
 * 外面看到牆的背面）。兩份各自算的話，其中一份遲早會跟畫面差半公尺。
 */
export function clampArena(a, x, z, margin) {
  if (a.shape === 'circle') {
    const dx = x - a.x, dz = z - a.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    const lim = Math.max(0, a.r - margin);
    return d <= lim ? [x, z] : [a.x + (dx / d) * lim, a.z + (dz / d) * lim];
  }
  return [
    Math.min(Math.max(x, a.x0 + margin), a.x1 - margin),
    Math.min(Math.max(z, a.z0 + margin), a.z1 - margin),
  ];
}

/**
 * 吊臂能伸多長：從 `pivot` 沿著 `dir` 走，撞到黑牆、天花板或地板為止。
 *
 * 第三人稱的鏡頭掛在一條從角色伸出去的線上（吊臂）。撞到東西的時候要沿著
 * 那條線收短，而不是往旁邊滑開——滑開的話鏡頭會離開那條線，視線跟著甩，
 * 而玩家並沒有下任何指令。這是 Unreal 的 SpringArm 與 Unity 的 Cinemachine
 * 都在做的同一件事。
 *
 * 放在這裡而不是 main.js，是因為它問的是同一個問題：「這個東西可以到
 * 哪裡」。牆在哪由 `arenaGap` 定義，鏡頭與身體因此不會各自認得一道牆。
 *
 * 擋住鏡頭的東西跟擋住身體的是同一批：場地的黑牆、天花板、地板，**以及
 * 那張碰撞盒清單**（牆、柱、王座、大石）。少了後者的話鏡頭會穿進石牆裡，
 * 畫面從牆的內部往外看——而那在畫面上不是「相機穿牆」，只是「突然看到
 * 一片奇怪的東西」。
 *
 * @param {object} a      場地
 * @param {object[]} cols 碰撞盒清單（可以給空陣列：那就只擋黑牆）
 * @param {number[]} pivot 樞紐 [x,y,z]
 * @param {number[]} dir   單位方向 [x,y,z]（樞紐指向鏡頭）
 * @param {number} want   想要多長
 * @param {number} margin 離牆面留多少（鏡頭的近裁面不能穿出去）
 * @param {number} floorY 鏡頭不低於這個高度
 */
export function boomLimit(a, cols, pivot, dir, want, margin = 0.35, floorY = 0.45) {
  let t = want;
  if (dir[1] > 1e-6) t = Math.min(t, (a.lid - margin - pivot[1]) / dir[1]);
  if (dir[1] < -1e-6) t = Math.min(t, (floorY - pivot[1]) / dir[1]);
  if (a.shape === 'circle') {
    /* 射線與圓的交點。A 是水平分量的長度平方——鏡頭正上方或正下方看的
       時候它是 0，那時候只有天花板與地板管得著。 */
    const px = pivot[0] - a.x, pz = pivot[2] - a.z;
    const R = a.r - margin;
    const A = dir[0] * dir[0] + dir[2] * dir[2];
    if (A > 1e-9) {
      const B = 2 * (px * dir[0] + pz * dir[2]);
      const C = px * px + pz * pz - R * R;
      const disc = B * B - 4 * A * C;
      t = disc > 0 ? Math.min(t, (-B + Math.sqrt(disc)) / (2 * A)) : 0;
    }
  } else {
    if (dir[0] > 1e-6) t = Math.min(t, (a.x1 - margin - pivot[0]) / dir[0]);
    if (dir[0] < -1e-6) t = Math.min(t, (a.x0 + margin - pivot[0]) / dir[0]);
    if (dir[2] > 1e-6) t = Math.min(t, (a.z1 - margin - pivot[2]) / dir[2]);
    if (dir[2] < -1e-6) t = Math.min(t, (a.z0 + margin - pivot[2]) / dir[2]);
  }
  /* 砌體。射線打在**盒子本身**上，命中距離再扣掉 margin——不是把盒子
     放大再打。兩種做法在正面撞牆的時候一樣，差別在擦邊：貼著一面牆走
     （離牆 20 公分、鏡頭方向平行於牆）的時候，放大過的盒子會被判成「已經
     撞上」，吊臂當場收到零，鏡頭縮進角色的頭裡——而畫面上牆明明在旁邊。

     樞紐已經在盒子裡面的時候跳過那個盒子：那時候吊臂沒有答案，硬給一個
     只會讓鏡頭黏在角色身上。所有 spring arm 都要處理這個退化情況。 */
  for (const b of cols) {
    /* 空氣牆（`air`）只擋身體。它立在女牆上、一路到頂，擋鏡頭的話吊臂
       永遠伸不出走道——而站在城牆上往外看，正是那個場地存在的理由。 */
    if (b.kind === 'bound' || b.kind === 'pit' || b.air) continue;
    if (b.shape === 'circle') { t = cylLimit(b, pivot, dir, t, margin); continue; }
    let lo = 0, hi = t + margin, inside = true;
    for (let k = 0; k < 3; k++) {
      if (pivot[k] < b.min[k] || pivot[k] > b.max[k]) inside = false;
      if (Math.abs(dir[k]) < 1e-9) {
        if (pivot[k] < b.min[k] || pivot[k] > b.max[k]) { lo = Infinity; break; }
        continue;
      }
      let ta = (b.min[k] - pivot[k]) / dir[k], tb = (b.max[k] - pivot[k]) / dir[k];
      if (ta > tb) { const sw = ta; ta = tb; tb = sw; }
      if (ta > lo) lo = ta;
      if (tb < hi) hi = tb;
      if (lo > hi) { lo = Infinity; break; }
    }
    if (inside || !Number.isFinite(lo)) continue;
    if (lo - margin < t) t = Math.max(0, lo - margin);
  }

  return Math.max(0, t);
}

/**
 * boomLimit 的圓柱那一段：射線打在柱面上，命中距離扣掉 margin。
 *
 * 分出來是因為它跟盒子那一段長得完全不一樣（二次式 vs. 三對平面），
 * 混在同一個迴圈裡只會讓兩邊都讀不懂。規則本身是一樣的：打在**柱子
 * 本身**上，不是打在放大過的柱子上；樞紐已經在裡面就跳過。
 */
function cylLimit(b, pivot, dir, t, margin) {
  const px = pivot[0] - b.x, pz = pivot[2] - b.z;
  const A = dir[0] * dir[0] + dir[2] * dir[2];
  const Bq = 2 * (px * dir[0] + pz * dir[2]);
  const Cq = px * px + pz * pz - b.r * b.r;
  let lo = 0, hi = t + margin;
  if (A > 1e-9) {
    const disc = Bq * Bq - 4 * A * Cq;
    if (disc <= 0) return t;                       // 擦不到
    const sq = Math.sqrt(disc);
    lo = Math.max(lo, (-Bq - sq) / (2 * A));
    hi = Math.min(hi, (-Bq + sq) / (2 * A));
  } else if (Cq > 0) return t;                     // 正上下看，而且在柱外
  if (Math.abs(dir[1]) < 1e-9) {
    if (pivot[1] < b.min[1] || pivot[1] > b.max[1]) return t;
  } else {
    let ta = (b.min[1] - pivot[1]) / dir[1], tb = (b.max[1] - pivot[1]) / dir[1];
    if (ta > tb) { const sw = ta; ta = tb; tb = sw; }
    lo = Math.max(lo, ta);
    hi = Math.min(hi, tb);
  }
  if (lo > hi) return t;
  if (Cq < 0 && pivot[1] > b.min[1] && pivot[1] < b.max[1]) return t;   // 已經在裡面
  return lo - margin < t ? Math.max(0, lo - margin) : t;
}

/** 身體（用外接方框近似）與一個方盒在水平面上有沒有重疊。 */
export function overlapXZ(x, z, b, pad) {
  return x + pad > b.min[0] && x - pad < b.max[0] && z + pad > b.min[2] && z - pad < b.max[2];
}

/**
 * 身體（半徑 pad 的圓）在水平面上碰得到這個碰撞體嗎。
 *
 * 形狀的分派只有這一支。solveXZ 與 supportAt 因此不必各自記得「圓的要
 * 用另一條式子」——那是兩份會分家的規則。
 */
export function nearXZ(b, x, z, pad) {
  if (b.shape === 'circle') return Math.hypot(x - b.x, z - b.z) < b.r + pad;
  return overlapXZ(x, z, b, pad);
}

/**
 * 水平推出。
 *
 * 高度差在 STEP 以內的盒子在這一步不算牆——所以身體會先走進台階裡，
 * 再由 `supportAt` 把牠抬上來。「踏得上去」因此不是另外一條規則，
 * 而是這兩步的順序造成的結果。
 *
 * @returns {[number, number]} 推出後的 x, z
 */
export function solveXZ(cols, x0, z0, feetY) {
  const R = PHYS.radius;
  const headY = feetY + PHYS.height;
  let x = x0, z = z0;
  /* 已經掉進坑裡的身體：坑口那一層（頂面不高於坑口的盒子，例如鋪面的碰撞板）
     對它來說是被挖掉的，跟 supportInfo 同一條規則。不挖的話，一塊 −0.4～0 的
     鋪面板在腳低於 −0.4 之後就是一道牆，會把人從井底橫著推回廣場上。 */
  let pit = null;
  for (const b of cols) {
    if (b.kind === 'pit' && feetY < b.top - 0.05 && Math.hypot(x0 - b.x, z0 - b.z) < b.r + R) { pit = b; break; }
  }
  for (const b of cols) {
    if (pit && b.kind !== 'pit' && b.kind !== 'bound' && b.max[1] <= pit.top + 0.01) continue;
    if (b.kind === 'pit') {
      /* 坑（井口）：掉進去的身體被井壁圍住。坑是一個圓，由內往外擋——
         跟場地的黑牆同一個方向，只是只對「腳已經在坑口以下」的身體作用。
         地面上的人走過坑口旁邊不受影響，擋他的是井圈那一圈石頭。 */
      if (feetY >= b.top - 0.05) continue;
      const dx = x - b.x, dz = z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > b.r + 3) continue;
      const lim = Math.max(0, b.r - R);
      if (d > lim) { x = b.x + (dx / d) * lim; z = b.z + (dz / d) * lim; }
      continue;
    }
    if (b.kind === 'bound') {
      /* 場地的邊界。由內往外擋，所以它只能對「已經在裡面的東西」作用
         ——這張清單裡有四個場地，而站在一個場地裡的時候，另外三個在
         四十公尺外；不加下界的話，那三個會各自把身體往自己的邊界上拉。
         三公尺的餘裕是給「已經貼在邊上」的身體用的。 */
      const gap = arenaGap(b, x, z);
      if (gap >= R || gap <= -3) continue;
      [x, z] = clampArena(b, x, z, R);
      continue;
    }
    if (b.min[1] >= headY) continue;              // 從底下鑽得過去
    if (b.shape === 'circle') {
      /* 圓柱：推出的方向是半徑，所以繞著柱子走是滑順的一圈，而不是四段
         各被一個角頂開的直線。 */
      const dx = x - b.x, dz = z - b.z;
      const d = Math.hypot(dx, dz);
      if (d >= b.r + R) continue;
      /* 「踏得上去」這一項圓頂不能用頂點去判：圓頂是中間高、外圈低，
         照頂點判的話人會在裙邊上就被擋住，而畫面上那裡只有腳踝高。
         身體涵蓋到的表面裡最高的一點在離軸 d − R 的地方。 */
      const reach = feetY + PHYS.step;
      if (roundTop(b, Math.max(0, d - R)) <= reach) continue;
      /* 推到「最高的那一點剛好踏得上去」的那一圈。平頂就是 r + 身體
         半徑，身體表面因此剛好貼在柱面上；圓頂則是停在它踩得到的地方。 */
      const lim = R + roundReach(b, reach);
      if (d >= lim) continue;
      // 正好站在軸上（身體被別的東西擠進來）：往哪邊推都一樣遠，挑 +x。
      if (d > 1e-6) { x = b.x + (dx / d) * lim; z = b.z + (dz / d) * lim; }
      else x = b.x + lim;
      continue;
    }
    if (b.max[1] <= feetY + PHYS.step) continue;   // 踏得上去 → 不是牆
    if (!overlapXZ(x, z, b, R)) continue;
    const dxL = x + R - b.min[0], dxR = b.max[0] - (x - R);
    const dzL = z + R - b.min[2], dzR = b.max[2] - (z - R);
    const mx = Math.min(dxL, dxR), mz = Math.min(dzL, dzR);
    if (mx < mz) x += dxL < dxR ? -mx : mx;
    else z += dzL < dzR ? -mz : mz;
  }
  return [x, z];
}

/**
 * 站在 (x, z)、腳原本在 fromY 的話，會踩在多高的地方。
 *
 * 只認「不高於 fromY + STEP」的東西：跳上去之前，屋頂不是地板。
 * 什麼都沒有的話就是地面（y = 0）。
 */
export function supportAt(cols, x, z, fromY) {
  return supportInfo(cols, x, z, fromY).y;
}

/**
 * 同一件事，外加「踩到的是什麼」。
 *
 * 分出這一支是因為圓頂上站不住，而「站得住嗎」只有腳底下那個東西答得
 * 出來——高度算出來的時候順手就知道了，分開再問一次等於把同一個搜尋
 * 做兩遍，而且兩遍會不同意（中間差了半公尺的位移）。
 *
 * @returns {{y:number, on:object|null, slip:string|null, sin:number,
 *            dx:number, dz:number}}
 *   y 支撐高度／on 踩到的碰撞體／slip 滑法（null = 站得住）／
 *   sin 斜面的 sin θ／dx,dz 下坡方向（水平的單位向量）
 */
export function supportInfo(cols, x, z, fromY) {
  const pad = PHYS.radius * 0.85;
  const reach = fromY + PHYS.step;
  /* 腳底下是不是一個坑口。是的話，地面（y = 0）與鋪在坑口那一層的東西
     （頂面不高於坑口的盒子——鋪面的碰撞就是一塊 −0.4～0 的板）都不算，
     支撐從坑底算起。判斷用身體中心：中心在坑口裡面就掉，在外面就是井圈
     那一圈石頭接得住。 */
  let pit = null;
  for (const b of cols) {
    if (b.kind === 'pit' && Math.hypot(x - b.x, z - b.z) < b.r) { pit = b; break; }
  }
  let y = pit ? pit.bottom : 0, on = null;
  for (const b of cols) {
    if (b.kind === 'bound' || b.kind === 'pit') continue;   // 邊界與坑不是地板
    if (pit && b.max[1] <= pit.top + 0.01) continue;         // 坑口那一層被挖掉了
    if (b.max[1] > reach) continue;                // 連頂點都構不到
    if (!nearXZ(b, x, z, pad)) continue;
    /* 圓頂踩到的是曲面上的那一點，不是它的頂點。站在裙邊上的人腳底下
       是裙邊的高度——這正是「圓頂」與「一個跟它一樣高的方盒」的差別。 */
    const t = b.shape === 'circle'
      ? roundTop(b, Math.min(Math.hypot(x - b.x, z - b.z), b.r))
      : b.max[1];
    if (t > reach || t <= y) continue;
    y = t; on = b;
  }

  const out = { y, on, slip: null, sin: 0, dx: 0, dz: 0 };
  if (!on || !on.slip || !on.dome) return out;
  const ax = x - on.x, az = z - on.z;
  const d = Math.hypot(ax, az);
  let s = roundSin(on, Math.min(d, on.r));
  if (on.slip === 'fall') s = Math.max(s, SLIDE.kick);   // 正頂上也站不住
  else if (s <= SLIDE.stick) return out;                 // 頂端那一小塊平的
  out.slip = on.slip;
  out.sin = s;
  /* 正頂上沒有下坡方向可言。給一個固定的方向而不是隨機的：離線驗證要
     走得出同一條路，而「每次都滑向不同邊」也不是任何人想要的手感。 */
  out.dx = d > 1e-6 ? ax / d : 1;
  out.dz = d > 1e-6 ? az / d : 0;
  return out;
}
