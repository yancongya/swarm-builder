import type { Tickable } from './engine';
import { clamp } from './config';

/**
 * 复刻参考实现（浏览器扩展）那套「待时光标」的物理：速度积分绕着会呼吸的轨道圈转，
 * 邻域内对齐速度，指针既能当圆心也能把人推开。
 * 只在 `flight: 'live'` 时进引擎；默认关着，一帧都不算。
 */

/** 轨道环半径（px），会随时间 ±18% 呼吸。 */
const ORBIT_R = 135;
/** 每个光标自己的轨道偏心量，参考版按 orbit∈[70,170] 抽。 */
const ORBIT_BASE = 120;
const ORBIT_WOBBLE = 0.3;
/** 切向速度：300 px/s 乘每个光标的自转系数。 */
const TANGENTIAL = 300;
/** 径向弹簧：太近往外推（上限 1400），太远往里收（下限 -2600，收得比推慢）。 */
const RADIAL_GAIN = 4;
const RADIAL_MIN = -2600;
const RADIAL_MAX = 1400;
/** 绕远了以后加一点旋度，参考版 400 px/s，600px 外才满。 */
const CURL_GAIN = 400;
const CURL_REACH = 600;
/** 邻域对齐：90px 内的邻居速度按 0.3 权重合进来，自己占 0.7。 */
const ALIGN_RADIUS = 90;
const ALIGN_SELF = 0.7;
const ALIGN_NEIGHBOUR = 0.3;
/** 速度/加速度的上限随离圆心的距离放宽，参考版 180px 内不放宽。 */
const RELAX_FROM = 180;
const VRELAX_PER_PX = 1 / 90;
const VRELAX_MAX = 3.2;
const ACCEL_GAIN = 6;
const FRELAX_PER_PX = 1 / 50;
const FRELAX_MAX = 5;
/** 指针排斥环半径，以及撞进去时的冲量。 */
export const POINTER_RADIUS = 48;
const POINTER_IMPULSE = 260;
const POINTER_REL_GAIN = 1.6;
/** 指针速度平滑跟随的增益。 */
const POINTER_TRACK = 18;
/** 光标姿态角收敛与按下量衰减。 */
const ANGLE_CONVERGE = 8;
const PRESS_DECAY = 6;
/** 箭头这个图形自己的朝向：绕到速度方向上要补的角。 */
const GLYPH_OFFSET = 128;
/** 参考版 8~48 人，这里人数下限用宿主给的 agentCount。 */
const CREW_CEILING = 48;
/** 每 40px/s 滚动速度加一个人，每 2 件可领的活加一个人。 */
const CREW_PER_VELOCITY = 40;
const CREW_PER_WORK = 2;
/** 新光标到场的最小间隔，一次只放一个，不然像刷屏。 */
const SPAWN_COOLDOWN = 0.035;
/** 干过活又闲了 2.5 秒的临时光标自己走。 */
const IDLE_LEAVE = 2.5;

/** 一个会飞的光标：位置与速度由物理持有，任务系统只管施工时接管。 */
export interface Flyer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 箭头当前倾角（度）。 */
  angle: number;
  /** 0..1，按下时压扁的程度。 */
  press: number;
  /** 轨道偏心、自转方向、旋度、巡航速度、推力上限。 */
  orbit: number;
  spin: number;
  curl: number;
  pace: number;
  force: number;
  /** 正在施工：这时候位置归任务说了算，轨道场不插手。 */
  busy: boolean;
  /** 是否已经干过活：只有干过的临时光标才会自己离场。 */
  worked: boolean;
  /** 闲了多久（秒）。 */
  idleFor: number;
}

/** 施工区域在页面里的可见那一块，都是蓝图坐标（相对 root）。 */
export interface FlightStage {
  top: number;
  height: number;
  width: number;
  /** 指针在蓝图坐标里的位置；不在页面上时为 null。 */
  pointer: { x: number; y: number } | null;
}

/** 抽一套轨道参数。参考版 25% 概率是「快班」，快得多也猛得多。 */
export function makeFlyer(x: number, y: number, rng: () => number): Flyer {
  const fast = rng() < 0.25;
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    press: 0,
    orbit: 70 + rng() * 100,
    spin: fast ? 2.2 + rng() * 1.2 : 0.8 + rng() * 1.0,
    curl: rng() * 2 - 1,
    pace: fast ? 1000 + rng() * 500 : 300 + rng() * 450,
    force: fast ? 3500 + rng() * 2500 : 700 + rng() * 1100,
    busy: false,
    worked: false,
    idleFor: 0,
  };
}

/**
 * 绕着圆心的轨道场。圆心是三样东西之一：指针（`pointer:'follow'`）、
 * 页面上慢慢画 8 字的一个点（没人动鼠标时）、以及参考版那个 lissajous。
 */
export class Flight implements Tickable {
  private time = 0;
  private readonly pointerVel = { x: 0, y: 0 };
  private lastPointer: { x: number; y: number } | null = null;

  constructor(
    private readonly flyers: () => readonly Flyer[],
    private readonly stage: () => FlightStage,
    private readonly followPointer: boolean,
    private readonly repelPointer: boolean,
  ) {}

  tick(ms: number): void {
    const dt = Math.min(ms, 50) / 1000;
    if (dt <= 0) return;
    this.time += dt;
    // 施工中的光标归任务管：参考版也是只对「待时」的那批人跑轨道场。
    const list = this.flyers().filter((c) => !c.busy);
    if (list.length === 0) return;
    const stage = this.stage();
    const target = this.followPointer && stage.pointer
      ? stage.pointer
      : this.drift(stage);

    if (stage.pointer && this.lastPointer && dt > 0) {
      const k = Math.min(1, dt * POINTER_TRACK);
      this.pointerVel.x += ((stage.pointer.x - this.lastPointer.x) / dt - this.pointerVel.x) * k;
      this.pointerVel.y += ((stage.pointer.y - this.lastPointer.y) / dt - this.pointerVel.y) * k;
    }
    this.lastPointer = stage.pointer;

    const time = this.time;
    // 轨道环会呼吸，切向推力会反向：这两个慢周期让一群光标不会转成一条直线。
    const ring = ORBIT_R * (1 + 0.18 * Math.sin(time * 0.55));
    const swirl = Math.tanh(Math.cos(time * 0.11) * 3);
    const want: { x: number; y: number }[] = [];
    for (const c of list) {
      const vx = c.x - target.x;
      const vy = c.y - target.y;
      const d = Math.hypot(vx, vy) || 0.01;
      const nx = vx / d;
      const ny = vy / d;
      const ang = Math.atan2(vy, vx);
      const rr = ring * (1 + ORBIT_WOBBLE * Math.sin(3 * ang + time * 0.7)) + (c.orbit - ORBIT_BASE) * 0.55;
      const tang = TANGENTIAL * (0.7 + c.spin * 0.2) * swirl;
      const rad = clamp((rr - d) * RADIAL_GAIN, RADIAL_MIN, RADIAL_MAX);
      const far = clamp((d - rr) / CURL_REACH, 0, 1);
      want.push({
        x: -ny * tang + nx * rad - ny * c.curl * CURL_GAIN * far,
        y: nx * tang + ny * rad + nx * c.curl * CURL_GAIN * far,
      });
    }

    for (let i = 0; i < list.length; i++) {
      const c = list[i] as Flyer;
      let ax = 0;
      let ay = 0;
      let wsum = 0;
      for (let j = 0; j < list.length; j++) {
        if (j === i) continue;
        const q = list[j] as Flyer;
        const d = Math.hypot(q.x - c.x, q.y - c.y);
        if (d > ALIGN_RADIUS) continue;
        const w = 1 - d / ALIGN_RADIUS;
        ax += q.vx * w;
        ay += q.vy * w;
        wsum += w;
      }
      const goal = want[i] ?? { x: 0, y: 0 };
      let fx = goal.x;
      let fy = goal.y;
      if (wsum > 0) {
        fx = fx * ALIGN_SELF + (ax / wsum) * ALIGN_NEIGHBOUR;
        fy = fy * ALIGN_SELF + (ay / wsum) * ALIGN_NEIGHBOUR;
      }
      const dist = Math.max(0, Math.hypot(c.x - target.x, c.y - target.y) - RELAX_FROM);
      const maxV = c.pace * (1.3 + Math.min(VRELAX_MAX, dist * VRELAX_PER_PX));
      const length = Math.hypot(fx, fy);
      if (length > maxV) {
        fx *= maxV / length;
        fy *= maxV / length;
      }
      let gx = (fx - c.vx) * ACCEL_GAIN;
      let gy = (fy - c.vy) * ACCEL_GAIN;
      const maxF = c.force * (1.4 + Math.min(FRELAX_MAX, dist * FRELAX_PER_PX));
      const push = Math.hypot(gx, gy);
      if (push > maxF) {
        gx *= maxF / push;
        gy *= maxF / push;
      }
      c.vx += gx * dt;
      c.vy += gy * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
    }

    if (stage.pointer && this.repelPointer) this.dodge(list, stage.pointer);
    for (const c of list) {
      if (Math.hypot(c.vx, c.vy) >= 30) {
        // 朝速度方向偏过去，走最短的角差，不然会绕远路抽一下。
        const heading = (Math.atan2(c.vy, c.vx) * 180) / Math.PI + GLYPH_OFFSET;
        const delta = (((heading - c.angle + 540) % 360) + 360) % 360 - 180;
        c.angle += delta * Math.min(1, dt * ANGLE_CONVERGE);
      }
      c.press = Math.max(0, c.press - dt * PRESS_DECAY);
    }
  }

  /** 参考版的圆心：屏幕上画 8 字的那个点，落在可见区域正中偏上。 */
  private drift(stage: FlightStage): { x: number; y: number } {
    const t = this.time;
    return {
      x: stage.width * (0.5 + 0.28 * Math.sin(t * 0.37)),
      y: stage.top + stage.height * (0.5 + 0.25 * Math.sin(t * 0.53 + 1)),
    };
  }

  private dodge(list: readonly Flyer[], pointer: { x: number; y: number }): void {
    for (const c of list) {
      const vx = c.x - pointer.x;
      const vy = c.y - pointer.y;
      const d = Math.hypot(vx, vy) || 0.01;
      if (d >= POINTER_RADIUS) continue;
      const nx = vx / d;
      const ny = vy / d;
      c.x = pointer.x + nx * POINTER_RADIUS;
      c.y = pointer.y + ny * POINTER_RADIUS;
      const rel = (c.vx - this.pointerVel.x) * nx + (c.vy - this.pointerVel.y) * ny;
      if (rel < 0) {
        c.vx -= nx * rel * POINTER_REL_GAIN;
        c.vy -= ny * rel * POINTER_REL_GAIN;
      }
      c.vx += nx * POINTER_IMPULSE;
      c.vy += ny * POINTER_IMPULSE;
    }
  }
}

/**
 * 参考实现的动态班组：滚动越快、可领的活越多，人就越多；闲久的临时工自己走。
 * 人数下限是宿主给的 agentCount，上限 48。
 */
export interface CrewDeps {
  /** 在岗人数（含正在施工的）。 */
  active: () => number;
  /** 已解锁还没人领的活。 */
  available: () => number;
  /** 正在施工的。 */
  busy: () => number;
  /** 滚动位置（蓝图坐标），用来算滚动速度。 */
  scrollPos: () => number;
  /** 从某一条边进场一个新光标。 */
  spawn: (edge: 'left' | 'right', y: number) => void;
  /** 让一个临时光标退场。 */
  leave: (flyer: Flyer) => void;
  /** 原始班底：这些编号的光标不自己走。 */
  isHome: (flyer: Flyer) => boolean;
  floor: number;
  stage: () => FlightStage;
  rng: () => number;
}

export class Crew implements Tickable {
  private cooldown = 0;
  /** 平滑过的滚动速度（px/s），参考版按 exp(-1.2s) 衰减再混 30% 瞬时值。 */
  private vel = 0;
  private lastPos: number | null = null;

  constructor(
    private readonly deps: CrewDeps,
    private readonly flyers: () => readonly Flyer[],
  ) {}

  tick(ms: number): void {
    const dt = Math.min(ms, 50) / 1000;
    this.cooldown -= dt;
    const pos = this.deps.scrollPos();
    // 参考版第一帧没有上一样本，速度记 0：否则一开始就滚在页面中部的宿主会被当成「正在快速滚动」，凭空多招几个人。
    const instant = this.lastPos === null
      ? 0
      : Math.abs(pos - this.lastPos) / Math.max(dt, 0.001);
    this.lastPos = pos;
    this.vel = Math.max(this.vel * Math.exp(-dt * 1.2), this.vel * 0.7 + instant * 0.3);

    const active = this.deps.active();
    const avail = this.deps.available();
    const want = clamp(
      this.deps.floor + Math.floor(this.vel / CREW_PER_VELOCITY) + Math.floor(avail / CREW_PER_WORK),
      this.deps.floor,
      CREW_CEILING,
    );
    if (active < want && avail > active - this.deps.busy() && this.cooldown <= 0) {
      const stage = this.deps.stage();
      const edge: 'left' | 'right' = this.deps.rng() < 0.5 ? 'left' : 'right';
      this.deps.spawn(edge, stage.top + stage.height * (0.2 + this.deps.rng() * 0.6));
      this.cooldown = SPAWN_COOLDOWN;
    }

    for (const c of this.flyers()) {
      // 参考版的四条离场条件：干过活、正闲着、人数还在下限之上、不是原始班底。
      if (c.worked && !c.busy && c.idleFor > IDLE_LEAVE && active > this.deps.floor && !this.deps.isHome(c)) {
        this.deps.leave(c);
        break;
      }
    }
  }
}
