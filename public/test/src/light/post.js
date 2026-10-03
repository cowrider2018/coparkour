/* ── test/src/light/post.js ─────────────────────────────────────────
   後製：跟著玩家的暗角光罩，與只給發光物的泛光

   ── 畫面先畫進一張圖，再一筆貼回畫布 ───────────────────────────────
   場景照舊畫，只是畫進一張跟畫布一樣大的圖（rt），最後一個全螢幕的三角形
   把它貼回畫布，順手加上暗角與泛光。兩個效果都是 0 的地方，貼回去的那個
   像素必須跟沒有後製時一模一樣——這是這一支最容易壞、也最看不出來壞的地方：

     · 色彩空間。three 畫進一般的 rt 時輸出的是**線性**值，畫上畫布時才轉
       sRGB；而半透明的東西（黑霧、光暈、血）是在「存起來的那個值」上混色
       的。存線性就是在線性空間混色，霧的濃淡整個變了。所以這張圖掛上
       three 給 XR 用的那個旗標（isXRRenderTarget）：它讓 three 把這張圖當
       成畫布——照 texture.colorSpace（sRGB）輸出、照 renderer 的色調映射、
       純色 uniform 的換算也跟畫布同一套。內部格式釘成 RGBA8（不是
       SRGB8_ALPHA8），混色因此也在 sRGB 值上做，跟畫布完全同一條路。
       合成那一筆讀到的就是畫布上會出現的那個值，原封不動寫出去。
     · 反鋸齒。畫布本來有 MSAA，畫進一張沒有 samples 的圖就沒了，墨線全部
       變成鋸齒。所以 rt 帶 4 個 samples（WebGL2 的多重取樣 renderbuffer），
       畫完 three 自己解析到貼圖上。

   ── 多重取樣圖與「拷一份畫面」────────────────────────────────────
   grab.js 在畫到一半的時候用 copyTexSubImage2D 拷這一幀已經畫好的畫面（給
   國王劈砍的氣流、旋風斬的熱氣流讀）。從多重取樣的 framebuffer 拷是 GL 不
   准的（INVALID_OPERATION，拷到的是一片空）。所以這裡把 renderer 的
   copyFramebufferToTexture 包一層：正在畫進 rt 的時候，先把多重取樣那一份
   blit 到 rt 自己的解析 framebuffer，從那裡拷，再把綁定原樣放回去。畫完那一
   次正式的解析會蓋掉中途這一份，所以不留痕跡；畫布上的時候原封不動。

   ── 暗角跟著玩家，不是跟著螢幕中央 ─────────────────────────────────
   相機是跟拍的，玩家多半不在正中央（爬牆、相機被牆推近的時候差很多）。
   暗角的圓心放在玩家投影到螢幕上的那一點，於是「被照亮的是我這一圈」，而
   不是「螢幕四角比較暗」。顏色是調色盤那張深色卡片的底色 #1e1810——暖黑，
   跟黑牆、墨線同一家，不是相機鏡頭的那種中性黑。很淡：它是氣氛，不是框。

   強度是一個狀態，不是一個常數：附近有怪的時候收緊一點，血少的時候跟著
   心跳一縮一放；別的地方也可以叫 `pulse()` 讓它縮一下（受擊、BOSS 出場）。

   ── 泛光只給會發光的東西 ────────────────────────────────────────
   火焰、火芯、魂、火球都是 MeshBasicMaterial 的自發光，而它們跟被照亮的
   石頭最大的差別不是亮度（抹灰牆的亮面跟火焰差不多亮），是**有一個色版頂
   滿了**：火是 255 的紅，火芯是 255 的紅綠。被光照到的石頭再亮也到不了
   頂——五階的最亮那一階乘上石色仍然留著餘裕。所以門檻做在最大色版上，
   而且很窄、很高；那一窄條之外的像素對泛光的貢獻是 0，分階與墨線一點也
   不會被糊到。

   抽亮、模糊都在 1/4 解析度做：抽亮那一步四個雙線性取樣剛好蓋住 4×4 個
   原像素，模糊是橫直各一趟、五個雙線性取樣（等於九格的高斯）。手機上就
   是三個小貼圖、三趟，合成時加回去（在線性空間加：光是疊加的）。

   ?post=0 整個關掉（畫面直接畫上畫布）；?bloom=0、?vignette=0 各關一樣。
   ------------------------------------------------------------------ */

import * as THREE from '../../vendor/three.module.js';

/** 接進地形五階調著色器的那一段（見 ../light.js）。後製不碰地形的著色。 */
export const shade = null;

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const ON = Q.get('post') !== '0';
const BLOOM_ON = ON && Q.get('bloom') !== '0';
const VIG_ON = ON && Q.get('vignette') !== '0';

/** 暗角。半徑以畫面高為 1，從 r0 開始暗、到 r1 暗到 `max`。 */
const VIG = {
  color: 0x1e1810,
  r0: 0.42, r1: 1.25,
  max: 0.55,          // 最外圈混進暗色的比例（平時）
  foe: 0.22,          // 附近有怪：圈收緊多少（乘在半徑上，0.22 = 小兩成多）
  foeNear: 14,        // 多近算附近（公尺）
  low: 0.35,          // 血剩多少以下開始跟著心跳縮
  beat: 1.6,          // 心跳幾下一秒（血越少越快，最快再加 60%）
  ease: 2.5,          // 狀態跟上目標的速度（每秒）
};
/** 泛光。門檻在最大色版上（sRGB 值）：0.93 以下完全不發光。 */
const BLOOM = { lo: 0.93, hi: 0.995, gain: 0.9 };
/** 多重取樣數。 */
const SAMPLES = 4;

/* ── 能從外面推的那一份狀態 ───────────────────────────────────────── */

const state = { pulse: 0, scale: 1 };

/** 暗角縮一下（受擊、BOSS 出場）。k 是力道，0..1；幾個疊起來會被夾在 1。 */
export function pulse(k = 1) {
  state.pulse = Math.min(1, state.pulse + k);
}

/** 暗角整體的濃淡倍率（1 是預設，0 是沒有）。 */
export function setVignette(k) {
  state.scale = Math.max(0, k);
}

/* ── 著色器 ─────────────────────────────────────────────────────── */

const VERT = `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/* sRGB 值 ↔ 線性。只用在泛光要加回去的那一步——兩邊互為反函數，泛光是 0
   的像素轉過去再轉回來，就是原值。 */
const SRGB = `
vec3 cpPoLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 cpPoEnc(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;

/* 抽亮＋縮到 1/4：四個雙線性取樣各落在 2×2 的中心，合起來蓋住 4×4。
   每個取樣自己過門檻再平均——發光物旁邊的墨線把平均拉低，於是光暈從
   火焰本體長出去，而不是從「火焰＋墨線」那一團。 */
const PICK = `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
float cpPoHot(vec3 c) {
  return smoothstep(${BLOOM.lo.toFixed(3)}, ${BLOOM.hi.toFixed(3)}, max(c.r, max(c.g, c.b)));
}
vec3 cpPoTap(vec2 o) {
  vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb;
  return c * cpPoHot(c);
}
void main() {
  vec3 s = cpPoTap(vec2(-1.0, -1.0)) + cpPoTap(vec2(1.0, -1.0))
         + cpPoTap(vec2(-1.0, 1.0)) + cpPoTap(vec2(1.0, 1.0));
  gl_FragColor = vec4(s * 0.25, 1.0);
}
`;

/* 一個方向的模糊：五個雙線性取樣，權重是九格高斯（1 8 28 56 70…/256）兩兩
   併起來的結果。uDir 是一個貼圖像素的步長。 */
const BLUR = `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270;
  c += texture2D(tSrc, vUv + uDir * 1.3846154).rgb * 0.3162162;
  c += texture2D(tSrc, vUv - uDir * 1.3846154).rgb * 0.3162162;
  c += texture2D(tSrc, vUv + uDir * 3.2307692).rgb * 0.0702703;
  c += texture2D(tSrc, vUv - uDir * 3.2307692).rgb * 0.0702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

/* 合成：畫面＋泛光（線性空間），再朝玩家那一點蓋上暗角。輸出不經過 three 的
   色彩轉換（沒有 colorspace_fragment）：rt 裡存的已經是畫布要的值。 */
const COMP = `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform vec2 uCenter;
uniform float uAspect;
uniform vec3 uVigColor;
uniform vec3 uVig;
varying vec2 vUv;
${SRGB}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
#ifdef CP_BLOOM
  vec3 b = texture2D(tBloom, vUv).rgb;
  if (b.r + b.g + b.b > 0.0) c = cpPoEnc(cpPoLin(c) + cpPoLin(b) * uBloom);
#endif
#ifdef CP_VIG
  vec2 d = (vUv - uCenter) * vec2(uAspect, 1.0);
  float v = smoothstep(uVig.x, uVig.y, length(d)) * uVig.z;
  c = mix(c, uVigColor, v);
#endif
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

/* ── 每幀不配置：用到的暫存全部在這裡 ───────────────────────────── */

const _size = new THREE.Vector2();
const _p = new THREE.Vector3();

/** @param {object} ctx 見 ../light.js */
export function setup(ctx) {
  if (!ON || (!BLOOM_ON && !VIG_ON)) return null;
  const { renderer, camera } = ctx;
  const gl = renderer.getContext();

  /* 畫面那一張：當成畫布（見檔頭）。 */
  const rt = new THREE.WebGLRenderTarget(1, 1, {
    samples: SAMPLES, type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
  });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.internalFormat = 'RGBA8';
  rt.isXRRenderTarget = true;

  /* 泛光的兩張 1/4 圖：抽亮進 a、橫向進 b、直向回 a。 */
  const small = () => new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
  });
  const ba = BLOOM_ON ? small() : null, bb = BLOOM_ON ? small() : null;

  /* 一個蓋滿畫面的三角形，換材質重複用。 */
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(tri);
  quad.frustumCulled = false;
  const fsScene = new THREE.Scene();
  fsScene.add(quad);
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (frag, uniforms, defines = {}) => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: frag, uniforms, defines,
    depthTest: false, depthWrite: false, toneMapped: false,
  });

  const pick = BLOOM_ON ? pass(PICK, { tSrc: { value: rt.texture }, uTexel: { value: new THREE.Vector2() } }) : null;
  const blurH = BLOOM_ON ? pass(BLUR, { tSrc: { value: ba.texture }, uDir: { value: new THREE.Vector2() } }) : null;
  const blurV = BLOOM_ON ? pass(BLUR, { tSrc: { value: bb.texture }, uDir: { value: new THREE.Vector2() } }) : null;
  const vigColor = new THREE.Color(VIG.color);          // 不轉線性：合成在 sRGB 值上做
  const defines = {};
  if (BLOOM_ON) defines.CP_BLOOM = '';
  if (VIG_ON) defines.CP_VIG = '';
  const comp = pass(COMP, {
    tScene: { value: rt.texture },
    tBloom: { value: BLOOM_ON ? ba.texture : null },
    uBloom: { value: BLOOM.gain },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uVigColor: { value: new THREE.Vector3(vigColor.r, vigColor.g, vigColor.b) },
    uVig: { value: new THREE.Vector3(VIG.r0, VIG.r1, VIG.max) },
  }, defines);

  /* grab.js 的那一拷（見檔頭）。只有畫進 rt、而且 rt 真的是多重取樣
     renderbuffer 的時候才繞路；用 EXT_multisampled_render_to_texture 的機器
     沒有那一份 framebuffer，照原路拷就對了。 */
  const copy = renderer.copyFramebufferToTexture.bind(renderer);
  renderer.copyFramebufferToTexture = function (texture, ...rest) {
    const p = renderer.getRenderTarget() === rt ? renderer.properties.get(rt) : null;
    const ms = p && p.__webglMultisampledFramebuffer;
    if (!ms) return copy(texture, ...rest);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ms);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, p.__webglFramebuffer);
    gl.blitFramebuffer(0, 0, rt.width, rt.height, 0, 0, rt.width, rt.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, p.__webglFramebuffer);
    copy(texture, ...rest);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ms);             // 讀、寫都放回多重取樣那一份：three 以為的就是這樣
  };

  /** 圖跟著畫布的實際像素走（controls.js 的 fitView 改的是畫布）。 */
  const fit = () => {
    renderer.getDrawingBufferSize(_size);
    const w = Math.max(1, _size.x), h = Math.max(1, _size.y);
    if (rt.width === w && rt.height === h) return;
    rt.setSize(w, h);
    comp.uniforms.uAspect.value = w / h;
    if (!BLOOM_ON) return;
    const sw = Math.max(1, Math.ceil(w / 4)), sh = Math.max(1, Math.ceil(h / 4));
    ba.setSize(sw, sh);
    bb.setSize(sw, sh);
    pick.uniforms.uTexel.value.set(1 / w, 1 / h);
    blurH.uniforms.uDir.value.set(1 / sw, 0);
    blurV.uniforms.uDir.value.set(0, 1 / sh);
  };

  /* 暗角的狀態：收緊（怪）與心跳（血）各自平滑地跟上目標。 */
  let tight = 0, low = 0, phase = 0;

  return {
    update(f) {
      const { dt, player } = f;
      if (!VIG_ON || !player) return;
      const k = Math.min(1, dt * VIG.ease);

      let near = 0;
      for (const m of f.foes) {
        if (Math.hypot(m.x - player.x, m.z - player.z) < VIG.foeNear) { near = 1; break; }
      }
      tight += (near - tight) * k;

      const max = player.max || 0, hp = player.hp;
      const want = max > 0 && hp > 0 ? Math.max(0, 1 - hp / max / VIG.low) : 0;
      low += (want - low) * k;
      phase = (phase + dt * VIG.beat * (1 + 0.6 * low) * Math.PI * 2) % (Math.PI * 2);
      state.pulse = Math.max(0, state.pulse - dt * 2);

      /* 心跳：一下收（快）、一下放（慢）——sin 的正半拍再平方，聽起來像「咚」。 */
      const beat = Math.max(0, Math.sin(phase)) ** 2;
      const shrink = 1 - VIG.foe * tight - 0.18 * low * beat - 0.2 * state.pulse;
      const u = comp.uniforms.uVig.value;
      u.x = VIG.r0 * shrink;
      u.y = VIG.r1 * shrink;
      u.z = Math.min(0.85, (VIG.max + 0.12 * tight + 0.15 * low * beat + 0.1 * state.pulse) * state.scale);

      /* 圓心：玩家身體中段投到螢幕上。跑到相機後面（不該發生，但相機被牆推的
         時候可能有一兩幀）就留在上一個位置。 */
      _p.set(player.x, player.y + 0.45, player.z).project(camera);
      if (_p.z < 1) {
        comp.uniforms.uCenter.value.set(
          Math.min(1.2, Math.max(-0.2, _p.x * 0.5 + 0.5)),
          Math.min(1.2, Math.max(-0.2, _p.y * 0.5 + 0.5)));
      }
    },

    render(draw) {
      fit();
      renderer.setRenderTarget(rt);
      draw();
      if (BLOOM_ON) {
        quad.material = pick;
        renderer.setRenderTarget(ba);
        renderer.render(fsScene, fsCam);
        quad.material = blurH;
        renderer.setRenderTarget(bb);
        renderer.render(fsScene, fsCam);
        quad.material = blurV;
        renderer.setRenderTarget(ba);
        renderer.render(fsScene, fsCam);
      }
      quad.material = comp;
      renderer.setRenderTarget(null);
      renderer.render(fsScene, fsCam);
    },
  };
}
