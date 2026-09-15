/* ── test-area/src/camera.js ─────────────────────────────────────────
   第三人稱鏡頭的規則。

   跟 walk.js 一樣是「規則」而不是「畫面」：這裡只算數字（鏡頭在哪、看向
   哪裡），套到 three 的相機上是 main.js 的事。分出來是因為它有一條用眼睛
   很難查的行為——「被牆逼到最近的時候，角色會不會離開畫面中心」——而那
   條可以在 node 底下模擬出來（見 tools/verify-test-area.mjs）。

   ── 吊臂 ────────────────────────────────────────────────────────
   鏡頭掛在一條從樞紐沿著視角方向伸出去的線上。撞到黑牆、天花板、地板或
   砌體就**沿著那條線收短**，不是往旁邊滑開——滑開的話鏡頭會離開那條線，
   視線跟著甩，而玩家沒有下任何指令。伸多長由 walk.js 的 boomLimit 算，
   跟身體問的是同一批東西。這就是 Unreal 的 SpringArm 與 Unity 的
   Cinemachine Deoccluder 在做的事。

   收短快、放長慢：貼著牆走的時候牆一下遠一下近，兩邊同速的話鏡頭會前後
   抽動。

   ── 收到最短還是不夠的時候 ──────────────────────────────────────
   轉開角度是最糟的做法，它會跟玩家的輸入打架。改成**釘住樞紐**：鏡頭不再
   跟著人往牆裡擠，人因此離開畫面中心——那就是拿「人不在正中央」換來的
   視野寬度。偏移的上限用**角度**給（畫面上的比例固定、不隨距離變），業界
   叫它 dead zone。

   釘住的時候只允許兩種移動：
     · 橫向超過 dead zone → 拖著樞紐走（不然沿著牆走會把人留在畫面外）。
     · 往「鏡頭空間變大」的方向追人 → 不然人走開了樞紐還留在牆邊，鏡頭
       永遠鬆不開。
   縱向（人往鏡頭走過來）不拖：那是「變近」，由吊臂處理。把縱向也拖住的
   話，倒退撞牆的時候樞紐會被人推著往牆裡走，鏡頭跟著被擠扁。
   ------------------------------------------------------------------ */

import { boomLimit } from './walk.js';

export const CAM = {
  near: 1.2,           // 玩家能拉多近
  far: 16,             // 玩家能拉多遠
  hold: 8.6,           // 牆把吊臂逼到這麼短以下就釘住樞紐
  holdOut: 1.25,       // 釘住之後要等空間回到這麼多倍才鬆開（遲滯）
  deadTan: Math.tan(0.32),   // dead zone：人最多離開視線軸 18°
  boomMin: 0.35,       // 吊臂最短——再短鏡頭就在角色的頭裡面了
  follow: 14,          // 樞紐追人的速度（每秒）
  followPinned: 10,    // 釘住時「往空間變大的方向」追人的速度
  inRate: 26,          // 收短的速度
  outRate: 5,          // 放長的速度
};

/** 一組鏡頭的狀態。px/pz 是樞紐——正常時黏在人身上，被牆頂住時留在原地。 */
export function makeCam(x, z) {
  return {
    yaw: Math.PI, pitch: 0.30, dist: 7.0, curDist: 7.0,
    boom: 7.0, px: x, pz: z, pinned: false,
  };
}

/** 換場地／重生：樞紐直接跟過去，不然鏡頭會從六十公尺外飛過來。 */
export function snapCam(cam, x, z) {
  cam.px = x; cam.pz = z; cam.pinned = false;
}

/**
 * 算這一幀的鏡頭。
 *
 * @returns {{pos: number[], look: number[], boom: number, pinned: boolean,
 *   offAngle: number}} offAngle 是角色偏離視線軸的角度（0 = 在正中央）。
 */
export function updateCam(cam, dt, player, arena, cols) {
  cam.curDist += (cam.dist - cam.curDist) * Math.min(1, dt * 6);
  /* 眼高跟著距離收：拉近看動物的時候鏡頭要降下來平視牠，不然近距離
     只會看到一顆帽子頂。 */
  const near = 1 - Math.min(1, (cam.boom - CAM.near) / 3.5);
  const eyeH = 0.95 - 0.42 * near;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const bx = -Math.sin(cam.yaw) * cp, by = sp, bz = -Math.cos(cam.yaw) * cp;
  const pivotY = player.y + eyeH;

  /* 吊臂**能**伸多長（不受玩家縮放的上限影響）——要用它才分得出「牆把
     鏡頭逼近了」與「玩家自己把鏡頭拉近了」。混在一起的話，玩家在空地上
     拉到最近，人也會被判成該離開畫面中心。 */
  const room = boomLimit(arena, cols, [cam.px, pivotY, cam.pz], [bx, by, bz], 1e4);
  const blocked = room < cam.curDist - 0.05;
  cam.pinned = blocked && room < CAM.hold * (cam.pinned ? CAM.holdOut : 1);

  // 樞紐：沒釘住就黏著人；釘住了只往「空間變大」的方向追。
  {
    const k = Math.min(1, dt * (cam.pinned ? CAM.followPinned : CAM.follow));
    const nx = cam.px + (player.x - cam.px) * k;
    const nz = cam.pz + (player.z - cam.pz) * k;
    if (!cam.pinned
      || boomLimit(arena, cols, [nx, pivotY, nz], [bx, by, bz], 1e4) > room + 1e-3) {
      cam.px = nx; cam.pz = nz;
    }
  }
  // dead zone：只夾橫向（垂直於視線的那一份），縱向不夾。
  {
    const fl = Math.hypot(bx, bz) || 1e-6;
    const fx = -bx / fl, fz = -bz / fl;
    const ox = player.x - cam.px, oz = player.z - cam.pz;
    const lon = ox * fx + oz * fz;
    const latx = ox - lon * fx, latz = oz - lon * fz;
    const lat = Math.hypot(latx, latz);
    const leash = Math.max(0.12, cam.boom * CAM.deadTan);
    if (lat > leash) {
      const f = 1 - leash / lat;
      cam.px += latx * f; cam.pz += latz * f;
    }
  }

  const want = Math.max(CAM.boomMin, Math.min(cam.curDist, room));
  cam.boom += (want - cam.boom) * Math.min(1, dt * (want < cam.boom ? CAM.inRate : CAM.outRate));

  const pos = [cam.px + bx * cam.boom, pivotY + by * cam.boom, cam.pz + bz * cam.boom];
  const look = [cam.px, player.y + eyeH * (0.75 + 0.25 * near), cam.pz];

  /* 角色偏離視線軸多少角度。畫面上看到的就是這個——0 是正中央，
     18° 是 dead zone 的邊。 */
  const ax = pos[0] - look[0], az = pos[2] - look[2];
  const al = Math.hypot(ax, az) || 1e-6;
  const dx = player.x - pos[0], dz = player.z - pos[2];
  const dl = Math.hypot(dx, dz) || 1e-6;
  const cosA = Math.min(1, Math.max(-1, -(ax / al) * (dx / dl) - (az / al) * (dz / dl)));

  return { pos, look, boom: cam.boom, pinned: cam.pinned, offAngle: Math.acos(cosA) };
}
