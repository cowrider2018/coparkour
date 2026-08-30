import { PHYS, PLAYER_W, PLAYER_H, WORLD } from './constants.js';
import { COIN_R, clamp } from './level.js';

export class Player {
  constructor(level) {
    this.level = level;
    this.reset();
  }

  reset() {
    this.x = 80;
    this.y = WORLD.startY - PLAYER_H;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
    this.wallDir = 0;
    this.coyoteT = 0;
    this.bufferT = 0;
    this.wallStickT = 0;
    this.heldJump = false;
    this.airJumps = PHYS.airJumps;
    this.facing = 1;
    this.dead = false;
    this.deadReason = '';
    this.coins = 0;
    this.maxX = this.x;
    this.time = 0;
    this.anim = 0;
    this.squash = 0;
  }

  queueJump() {
    this.bufferT = PHYS.jumpBuffer;
  }

  get dist() {
    return Math.max(0, Math.round(this.maxX / 10)); // 10px = 1 公尺
  }

  // dt 固定為 1/120 秒，確保物理在任何裝置上表現一致
  update(dt, input) {
    if (this.dead) return;
    this.time += dt;
    const lvl = this.level;

    // 鍵盤給 ±1，水球給 −1..1；類比時最高速跟著推的深度走
    const dir = input.axis;
    if (dir !== 0) this.facing = Math.sign(dir);

    // ── 水平加速／摩擦 ──
    if (this.wallStickT > 0) {
      this.wallStickT -= dt;
    } else if (dir !== 0) {
      const accel = this.grounded ? PHYS.accelGround : PHYS.accelAir;
      this.vx += dir * accel * dt;
      // 推得淺就慢下來——但用摩擦力收，不要瞬間砍速，不然放鬆手指像撞牆
      const cap = PHYS.runSpeed * Math.abs(dir);
      if (Math.abs(this.vx) > cap) {
        const f = (this.grounded ? PHYS.frictionGround : PHYS.accelAir) * dt;
        this.vx = Math.sign(this.vx) * Math.max(cap, Math.abs(this.vx) - f);
      }
      this.vx = clamp(this.vx, -PHYS.runSpeed, PHYS.runSpeed);
    } else if (this.grounded) {
      const f = PHYS.frictionGround * dt;
      this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f;
    }

    // ── 重力／滑牆 ──
    this.vy += PHYS.gravity * dt;
    const slidingWall = !this.grounded && this.wallDir !== 0 && dir === this.wallDir;
    if (slidingWall && this.vy > PHYS.wallSlideSpeed) this.vy = PHYS.wallSlideSpeed;
    if (this.vy > PHYS.maxFall) this.vy = PHYS.maxFall;

    // ── 跳躍 ──
    this.coyoteT -= dt;
    this.bufferT -= dt;
    if (this.bufferT > 0) {
      if (this.grounded || this.coyoteT > 0) {
        this.vy = -PHYS.jumpVel;
        this.bufferT = 0;
        this.coyoteT = 0;
        this.grounded = false;
        this.squash = 1;
      } else if (this.wallDir !== 0) {
        this.vy = -PHYS.wallJumpVY;
        this.vx = -this.wallDir * PHYS.wallJumpVX;
        this.facing = -this.wallDir;
        this.wallStickT = PHYS.wallStick;
        this.bufferT = 0;
        this.airJumps = PHYS.airJumps;
        this.squash = 1;
      } else if (this.airJumps > 0) {
        this.airJumps--;
        this.vy = -PHYS.jumpVel * 0.92;
        // 二段跳只重設「方向」，速率原封不動搬過去。
        // 變向要即時（accelAir 只有 2300，抵消滿速得花 0.33 秒，佔掉滯空四成），
        // 但速率不能憑空生出來——那會變成沒踩到的加速，手感很怪。
        // 用 facing 而不是 axis：鬆手重新點按時新水球的手指在正中心，那一刻 axis 是 0，
        // 拿它當方向會變成原地垂直跳。facing 是上一次推過的方向，重新點按也還記得。
        this.vx = this.facing * Math.abs(this.vx);
        this.bufferT = 0;
        this.squash = 1;
      }
    }
    // 可變跳躍高度：放開按鍵的那一瞬間把上升速度砍掉一截
    const held = input.jumpHeld;
    if (this.heldJump && !held && this.vy < 0) this.vy *= PHYS.jumpCut;
    this.heldJump = held;

    // ── 移動 + 碰撞（先 X 後 Y）──
    const wasGrounded = this.grounded;
    this.moveX(this.vx * dt);
    this.moveY(this.vy * dt);

    if (wasGrounded && !this.grounded) this.coyoteT = PHYS.coyoteTime;
    if (this.grounded) this.airJumps = PHYS.airJumps;

    this.squash = Math.max(0, this.squash - dt * 5);
    this.anim += Math.abs(this.vx) * dt * 0.05;

    if (this.x > this.maxX) this.maxX = this.x;

    // ── 危險物 ──
    lvl.ensure(this.x + WORLD.chunkAhead);
    this.checkSpikes();
    this.collectCoins();
    if (this.y > PHYS.respawnY) this.kill('掉下去了');
  }

  moveX(dx) {
    this.x += dx;
    const y0 = this.y, y1 = this.y + PLAYER_H;
    this.level.forEachPlatform(this.x - 8, this.x + PLAYER_W + 8, (p) => {
      if (y1 <= p.y + 0.001 || y0 >= p.y + p.h - 0.001) return;
      if (this.x + PLAYER_W <= p.x || this.x >= p.x + p.w) return;
      if (dx > 0) this.x = p.x - PLAYER_W;
      else if (dx < 0) this.x = p.x + p.w;
      this.vx = 0;
    });
    this.wallDir = this.probeWall();
  }

  // 用左右各探 3px 判斷貼牆，這樣就算 vx 已經被撞成 0 也還能滑牆／蹬牆
  probeWall() {
    const y0 = this.y + 4, y1 = this.y + PLAYER_H - 4;
    let dirFound = 0;
    this.level.forEachPlatform(this.x - 8, this.x + PLAYER_W + 8, (p) => {
      if (dirFound !== 0) return;
      if (y1 <= p.y || y0 >= p.y + p.h) return;
      if (p.h < 60) return; // 太薄的板子不算牆，只有高牆能蹬
      if (this.x + PLAYER_W >= p.x - 3 && this.x + PLAYER_W <= p.x + 3) dirFound = 1;
      else if (this.x <= p.x + p.w + 3 && this.x >= p.x + p.w - 3) dirFound = -1;
    });
    return dirFound;
  }

  moveY(dy) {
    this.y += dy;
    this.grounded = false;
    const x0 = this.x, x1 = this.x + PLAYER_W;
    this.level.forEachPlatform(this.x - 8, this.x + PLAYER_W + 8, (p) => {
      if (x1 <= p.x + 0.001 || x0 >= p.x + p.w - 0.001) return;
      if (this.y + PLAYER_H <= p.y || this.y >= p.y + p.h) return;
      if (dy > 0) {
        this.y = p.y - PLAYER_H;
        this.grounded = true;
      } else if (dy < 0) {
        this.y = p.y + p.h;
      }
      this.vy = 0;
    });
  }

  checkSpikes() {
    const px = this.x + 5, pw = PLAYER_W - 10;
    const py = this.y + 5, ph = PLAYER_H - 6;
    this.level.forEachSpike(this.x - 80, this.x + PLAYER_W + 8, (s) => {
      if (px < s.x + s.w && px + pw > s.x && py < s.y + s.h && py + ph > s.y) {
        this.kill('踩到地刺');
      }
    });
  }

  collectCoins() {
    const cx = this.x + PLAYER_W / 2, cy = this.y + PLAYER_H / 2;
    this.level.forEachCoin(this.x - 120, this.x + PLAYER_W + 60, (c) => {
      if (c.taken) return;
      const dx = c.x - cx, dy = c.y - cy;
      if (dx * dx + dy * dy < (COIN_R + 22) * (COIN_R + 22)) {
        c.taken = true;
        this.coins++;
      }
    });
  }

  kill(reason) {
    if (this.dead) return;
    this.dead = true;
    this.deadReason = reason;
  }
}
