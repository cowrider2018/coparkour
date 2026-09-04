// 一台會記帳的假 gl，跟一張插得上去的假畫布。
//
// 這台機器沒有 GPU，也沒有 headless WebGL，但 CatLayer 需要驗的東西幾乎
// 都不在 GPU 上——它們在「呼叫了什麼、照什麼順序呼叫、每支 program 有沒有
// 拿到自己那份 uniform」。所以給它這一台，跑真的 begin/cat/end，再檢查帳。
//
// 兩個驗證器用同一台（verify-layer、verify-showcase），所以它在這裡而不是
// 在其中一支裡面。

/* ── 會記帳的假 gl ─────────────────────────────────────────────── */

export function fakeGL() {
  let nextId = 1;
  const obj = (kind) => ({ kind, id: nextId++ });
  const log = [];
  const uniforms = new Map();   // program → Set<uniform 名>
  let current = null;

  const gl = {
    log,
    uniforms,
    // 常數：只要是唯一值就好，程式碼只拿它們當旗標傳
    ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2, STATIC_DRAW: 3,
    FLOAT: 4, SHORT: 5, UNSIGNED_BYTE: 6, UNSIGNED_SHORT: 7, UNSIGNED_INT: 8,
    TRIANGLES: 9, DEPTH_TEST: 10, CULL_FACE: 11, BLEND: 12, LESS: 13,
    BACK: 14, FRONT: 15, COLOR_BUFFER_BIT: 16, DEPTH_BUFFER_BIT: 32,
    VERTEX_SHADER: 17, FRAGMENT_SHADER: 18, COMPILE_STATUS: 19, LINK_STATUS: 20,

    createShader: () => obj('shader'),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => obj('program'),
    attachShader: () => {},
    linkProgram: () => {},
    deleteShader: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    useProgram: (p) => { current = p; log.push(['useProgram', p && p.id]); },
    getUniformLocation: (p, name) => ({ kind: 'uniform', prog: p.id, name }),

    createBuffer: () => obj('buffer'),
    bindBuffer: () => {},
    bufferData: () => {},
    createVertexArray: () => obj('vao'),
    bindVertexArray: (v) => log.push(['bindVertexArray', v && v.id]),
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    deleteBuffer: () => {}, deleteVertexArray: () => {}, deleteProgram: () => {},

    viewport: () => {}, clearColor: () => {}, clearDepth: () => {}, clear: () => {},
    depthMask: () => {}, depthFunc: () => {}, depthRange: () => {},
    enable: () => {}, disable: () => {}, cullFace: () => {},
    isContextLost: () => false,
    drawElements: (mode, count) => log.push(['drawElements', current && current.id, count]),
  };
  // uniform*：全部記在「現在這支 program」名下
  const note = (loc) => {
    if (!loc) return;
    if (!uniforms.has(current && current.id)) uniforms.set(current && current.id, new Set());
    uniforms.get(current && current.id).add(loc.name);
    if (loc.prog !== (current && current.id)) {
      log.push(['WRONG_PROGRAM', loc.name, loc.prog, current && current.id]);
    }
  };
  for (const n of ['uniform1f', 'uniform1i', 'uniform2f', 'uniform3f', 'uniform4f',
    'uniform1fv', 'uniform1iv', 'uniform2fv', 'uniform3fv', 'uniform4fv']) {
    gl[n] = (loc) => note(loc);
  }
  gl.uniformMatrix4fv = (loc) => note(loc);
  return gl;
}

export function fakeCanvas(gl) {
  return {
    width: 800, height: 400,
    getContext: () => gl,
    addEventListener: () => {},
  };
}
