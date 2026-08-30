// 鍵盤是數位的（±1），水球和手把搖桿是類比的（−1..1）。
// Player 只看 axis / jumpHeld 這兩個介面，三種操作就不用各寫一套物理。
export class Input {
  constructor(onJump, onRestart) {
    this.left = false;
    this.right = false;
    this.jump = false;
    this.onJump = onJump;
    this.onRestart = onRestart;
    this._keys = new Set();

    this.touch = false;     // 水球正在操作
    this.touchAxis = 0;
    this.holdT = 0;         // 觸控跳的殘留「按住」時間 → 可變跳躍高度

    this.pad = false;       // 手把搖桿正在推
    this.padAxis = 0;
    this.padJump = false;   // 手把跳躍鍵按著 → 直接就是 jumpHeld，比甩速換算還準

    addEventListener('keydown', (e) => this.key(e, true), { passive: false });
    addEventListener('keyup', (e) => this.key(e, false), { passive: false });
    addEventListener('blur', () => {
      this.left = this.right = this.jump = this.padJump = false;
      this._keys.clear();
    });
  }

  // 手把 > 水球 > 鍵盤。三者不會同時活著（開手把就把水球關掉），順序只是保險。
  get axis() {
    if (this.pad) return this.padAxis;
    if (this.touch) return this.touchAxis;
    return (this.right ? 1 : 0) - (this.left ? 1 : 0);
  }

  get jumpHeld() {
    return this.jump || this.padJump || this.holdT > 0;
  }

  // 跟物理同步呼叫（固定步長），讓觸控跳的按住時間在任何裝置上一致
  tick(dt) {
    if (this.holdT > 0) this.holdT -= dt;
  }

  setTouch(active, axis) {
    this.touch = active;
    this.touchAxis = active ? axis : 0;
  }

  setPad(active, axis) {
    this.pad = active;
    this.padAxis = active ? axis : 0;
  }

  // 手把跳躍鍵：按下排跳、按著就是 jumpHeld（可變跳躍高度直接沿用鍵盤那條路）
  setPadJump(down) {
    if (this.padJump === down) return;
    this.padJump = down;
    if (down) this.onJump();
  }

  // 甩出水球體積：hold 越長 = 甩得越快 = 跳得越高
  touchJump(hold) {
    this.holdT = hold;
    this.onJump();
  }

  key(e, down) {
    const c = e.code;
    const isJump = c === 'Space' || c === 'ArrowUp' || c === 'KeyW' || c === 'KeyJ' || c === 'KeyZ';
    const isLeft = c === 'ArrowLeft' || c === 'KeyA';
    const isRight = c === 'ArrowRight' || c === 'KeyD';
    if (isJump || isLeft || isRight || c === 'KeyR') e.preventDefault();
    if (down && this._keys.has(c)) return; // 忽略自動重複
    down ? this._keys.add(c) : this._keys.delete(c);

    if (isLeft) this.left = down;
    if (isRight) this.right = down;
    if (isJump) {
      this.jump = down;
      if (down) this.onJump();
    }
    if (c === 'KeyR' && down) this.onRestart();
  }
}
