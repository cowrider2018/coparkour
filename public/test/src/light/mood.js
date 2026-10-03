/* ── test/src/light/mood.js ─────────────────────────────────────────
   每個區塊一組光：主光色、主光強度、環境光、陰影的色相、霧色。

   同一盞正午的光照六張圖，六張圖就是同一個下午——中庭、墓室、水窖分不
   出哪裡是地底下。這裡每個區塊各給一組（palette.js 的 Light），五階調由
   palette.js 的 bandTones 算，所以預設與各區塊走的是同一條式子。

   換區塊：把當下的五階、霧色、毛皮的色偏記下來，一秒內 smoothstep 走到新
   那一組。每一份目標在 setup 時就算好，換的時候只是內插，不配置任何東西。
   通常換區塊時畫面正在暗下去（transit.js），這一秒大半藏在黑裡；走路跨過
   去的那幾張（中庭與城牆步道是連著的）看得到它慢慢轉。

   狗也要跟著換，不然一隻正午的狗站在墓室裡像是貼上去的。毛皮的著色在
   critter.js（ACES 那一套，跟石頭不同），所以這裡不給它五階，只給一個
   每通道的乘數：這一組最亮那一階 ÷ 預設最亮那一階。critter.js 把它乘在
   主光上（FUR_TINT）。

   ── 為什麼這支檔案的頂層只碰 three ──────────────────────────────
   palette.js → light.js → 這裡，而 critter.js 從這裡拿 FUR_TINT。誰先被
   載入不一定（戰鬥模式先 import palette.js），所以頂層不讀 palette.js 的
   任何值；那些在 setup 裡才讀，那時候所有模組都跑完了。

   `?mood=0` 整個不動：還是原本那一盞正午的光。
   ------------------------------------------------------------------ */

import * as THREE from '../../vendor/three.module.js';
import { LIGHT_DEF, TONES, U_BAND, bandTones } from '../palette.js';

const ON = typeof location === 'undefined' || new URLSearchParams(location.search).get('mood') !== '0';

/** 狗的主光乘數（每通道）。critter.js 的毛皮著色讀這一個。 */
export const FUR_TINT = { value: new THREE.Vector3(1, 1, 1) };

/** 換區塊花多久（秒）。 */
const FADE = 1.0;

/**
 * 各區塊的光。沒列的欄位用 palette.js 的 LIGHT_DEF；fog 是場景霧的顏色。
 * cool 是陰影往 shade 那個色相拉多少（見 palette.js 的「一組光」）。
 */
const MOODS = {
  /* 崩塌中庭：午後，暖，影子偏藍。 */
  courtyard: { key: 0xffe4bc, keyGain: 2.05, shade: 0x5a6cb0, cool: 0.35, fog: 0xa28a6d },
  /* 王座廳：金色、莊重，環境光收一點讓影子沉。 */
  throne: {
    key: 0xffd596, keyGain: 1.95, sky: 0x8f8fb8, ground: 0x3d2a1a, ambGain: 0.72,
    shade: 0x54508f, cool: 0.45, fog: 0x8a6c4c,
  },
  /* 圓塔水窖：水氣，冷的青綠。 */
  cistern: {
    key: 0xd6f0e6, keyGain: 1.8, sky: 0x7fb8b0, ground: 0x1f302c, ambGain: 0.92,
    shade: 0x3f7a86, cool: 0.5, fog: 0x5c766e,
  },
  /* 城牆步道：黃昏，橘，影子拉向紫藍。 */
  wallwalk: {
    key: 0xffc488, keyGain: 2.15, sky: 0x8f9ad6, ground: 0x3a2618, ambGain: 0.8,
    shade: 0x6068a8, cool: 0.35, fog: 0xa87a5a,
  },
  /* 地下墓室：冷的藍灰，暗。暖的只留給火盆（flame.js）。 */
  crypt: {
    key: 0xc6d2ec, keyGain: 1.55, sky: 0x7f8cb0, ground: 0x1e1e26, ambGain: 0.8,
    shade: 0x4a5a9a, cool: 0.45, fog: 0x484c5a,
  },
  /* 城內窄巷：傍晚，偏紫。 */
  alley: {
    key: 0xf2d2c6, keyGain: 1.85, sky: 0x9a8ac8, ground: 0x2e2230, ambGain: 0.85,
    shade: 0x6a62a0, cool: 0.35, fog: 0x7a6476,
  },
  /* 戰鬥模式那一塊空地：跟中庭同一個下午。 */
  arena: { key: 0xffe4bc, keyGain: 2.05, shade: 0x5a6cb0, cool: 0.35, fog: 0xa28a6d },
};

/** @param {object} ctx 見 ../light.js */
export function setup(ctx) {
  if (!ON) return null;
  const fog = ctx.scene.fog;

  /* 每一組先算好：五階、霧色、毛皮乘數。 */
  const base = TONES;
  const sets = new Map();
  for (const [id, m] of Object.entries(MOODS)) {
    const tones = bandTones({ ...LIGHT_DEF, ...m });
    const tint = [0, 1, 2].map((k) => tones[k] / base[k]);
    sets.set(id, { tones, fog: new THREE.Color(m.fog ?? (fog ? fog.color.getHex() : 0)), tint });
  }

  const band = U_BAND.value;
  const from = { tones: new Float32Array(15), fog: new THREE.Color(), tint: [1, 1, 1] };
  let target = null, t = 1, block = null;

  /** 一步到位（第一幀）。 */
  function snap(s) {
    band.set(s.tones);
    if (fog) fog.color.copy(s.fog);
    FUR_TINT.value.set(...s.tint);
  }

  return {
    update(f) {
      if (f.block !== block) {
        block = f.block;
        const next = sets.get(block);
        if (!next) return;
        if (!target) { target = next; snap(next); return; }
        from.tones.set(band);
        if (fog) from.fog.copy(fog.color);
        FUR_TINT.value.toArray(from.tint);
        target = next;
        t = 0;
      }
      if (!target || t >= 1) return;
      t = Math.min(1, t + f.dt / FADE);
      const u = t * t * (3 - 2 * t);
      for (let i = 0; i < 15; i++) band[i] = from.tones[i] + (target.tones[i] - from.tones[i]) * u;
      if (fog) fog.color.copy(from.fog).lerp(target.fog, u);
      const a = from.tint, b = target.tint;
      FUR_TINT.value.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
    },
  };
}
