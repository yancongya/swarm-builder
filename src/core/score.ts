import type { SoundEvent } from './sound';
import type { SoundSink, SoundSpot } from './action';

interface Graph {
  ctx: AudioContext;
  out: GainNode;
  master: GainNode;
  verb: ConvolverNode;
  noise: AudioBuffer;
}

// 参考版 swarm.js:3061 E 五声音阶 E F# G# B C#
const PENTA = [0, 2, 4, 7, 9] as const;
// 参考版 swarm.js:3062 根音 MIDI 40 = E2
const E2 = 40;
// 参考版 104 BPM，十六分音符格子
const BPM = 104;
// 参考版 3203 同时存活的钢琴声部上限
const MAX_VOICES = 28;
// 参考版 3335 栅格记忆上限（约 8 小节的 8 分槽）
const MAX_SLOTS = 64;
// 参考版 3209 泛音列 [倍频, 音量, 衰减比]；2.756 是玻璃感来源的不谐和泛音
const PARTIALS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 1],
  [2, 0.38, 0.55],
  [3, 0.12, 0.32],
  [2.756, 0.16, 0.42],
  [5.4, 0.05, 0.16],
];
// 参考版 3338 各类元素落定的击键力度，缺省 0.4
const PLACE_VEL: Record<string, number> = {
  rect: 0.55,
  image: 0.5,
  dup: 0.5,
  guide: 0.3,
  restyle: 0.34,
};

const degree = (i: number): number => PENTA[i] ?? 0;
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/**
 * Generative glass-piano score: every finished element plays one note of the
 * E pentatonic, quantised to the 104 BPM grid, so a busy swarm turns into a
 * melody instead of noise. The AudioContext is built on the first event, like
 * SoundBus does, because browsers count contexts against the autoplay policy.
 */
export class Score {
  private graph: Graph | null = null;
  private t0 = 0;
  private disposed = false;
  private enabled: boolean;
  private readonly slots = new Map<string, number[]>();
  private readonly lastKey = new Map<number, number>();
  private keyTimes: number[] = [];
  private pressTimes: number[] = [];
  /** 每个还在响的钢琴声部什么时候安静下来，用来限住复音数。 */
  private ends: number[] = [];

  constructor(on = true) {
    this.enabled = on;
  }

  get on(): boolean {
    return this.enabled;
  }

  /** 参考版 run() 里那句 sfx.init()：先把上下文建起来，blocked 才有东西可报。 */
  init(): void {
    this.open();
  }

  get blocked(): boolean {
    return this.graph !== null && this.graph.ctx.state !== 'running';
  }

  setOn(on: boolean): void {
    this.enabled = on;
    const g = this.graph;
    if (!g) {
      if (on) this.open();
      return;
    }
    const t = g.ctx.currentTime;
    g.out.gain.cancelScheduledValues(t);
    g.out.gain.setTargetAtTime(on ? 1 : 0, t, 0.05);
    if (on) this.resume();
  }

  resume(): void {
    const ctx = this.graph?.ctx;
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
  }

  /** 开场那团光标在聚：一段气声 swell 压在低五度上（参考版 3363）。 */
  intro(): void {
    const g = this.cue();
    if (!g) return;
    const t = g.ctx.currentTime + 0.02;
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    src.loop = true;
    const bp = g.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.9);
    bp.frequency.exponentialRampToValueAtTime(900, t + 1.8);
    const env = this.bus(g, t, 0, 0.6);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.16, t + 0.7);
    env.gain.exponentialRampToValueAtTime(0.0005, t + 2.2);
    src.connect(bp);
    bp.connect(env);
    src.start(t);
    src.stop(t + 2.3);
    src.onended = () => env.disconnect();
    for (const [midi, delay] of [[E2, 0], [E2 + 7, 0.08], [E2 + 12, 0.16]] as const) {
      this.pad(g, midi, t + 0.3 + delay, 0.07, 2.6);
    }
  }

  /** 群蜂散开：E G# B E 琶音（参考版 3407）。 */
  start(): void {
    const g = this.cue();
    if (!g) return;
    const { when } = this.grid(g, 4);
    // 参考版 3411 一个 16 分步长依次上行
    const step = 60 / BPM / 4;
    [E2 + 24, E2 + 28, E2 + 31, E2 + 36, E2 + 40].forEach((m, i) => {
      this.piano(g, m, when + i * step, 0.2, -0.5 + i * 0.25, 2);
    });
  }

  /** 一次机械按键：尖click 叠在短 thock 上（参考版 3280、3285）。 */
  key(x: number, viewportWidth: number, id = 0, n = 1, space = 0): void {
    const g = this.cue();
    if (!g) return;
    const t = g.ctx.currentTime;
    // 参考版 3289 同一只光标 24ms 内不重复
    if (t - (this.lastKey.get(id) ?? -1) < 0.024) return;
    this.keyTimes = this.keyTimes.filter((k) => t - k < 1);
    if (this.keyTimes.length > 80) return;
    this.lastKey.set(id, t);
    const pan = this.pan(x, viewportWidth);
    // 一帧里连打多个字符转成一小串快速键
    let at = t + 0.004;
    for (let k = 0; k < Math.min(n, 3) && this.keyTimes.length <= 80; k++) {
      this.keyTimes.push(t);
      this.clack(g, at, pan, space > 0, rand(0.75, 1));
      at += rand(0.018, 0.032);
    }
  }

  /** 鼠标按下：重 click 后跟一个更轻的松开（参考版 3304）。 */
  press(x: number, viewportWidth: number): void {
    const g = this.cue();
    if (!g) return;
    const t = g.ctx.currentTime;
    this.pressTimes = this.pressTimes.filter((k) => t - k < 1);
    // 参考版 3309 每秒最多 40 次点击
    if (this.pressTimes.length > 40) return;
    this.pressTimes.push(t);
    const pan = this.pan(x, viewportWidth);
    this.tick(g, t + 0.004, pan, rand(2100, 2700), 4, 0.32, 0.012);
    this.tick(g, t + 0.005, pan, rand(650, 850), 2, 0.16, 0.022);
    this.tick(g, t + rand(0.055, 0.075), pan, rand(2900, 3400), 4, 0.15, 0.008);
  }

  /** 一个元素落定：唯一的旋律事件（参考版 3318）。 */
  place(kind: string, x: number, y: number, w: number, h: number, vw: number, vh: number): void {
    const g = this.cue();
    if (!g) return;
    // 参考版 3322 只有盒子、图片、副本、参考线会唱，文字与线条保持打击乐
    if (kind === 'text' || kind === 'edit' || kind === 'line') return;
    const area = (w * h) / Math.max(1, vw * vh);
    // 面积越大音区越低；参考线固定唱最高那一组
    const oct = kind === 'guide' ? 5 : area > 0.08 ? 1 : area > 0.015 ? 2 : area > 0.002 ? 3 : 4;
    // 音高随横向位置升高
    const deg = Math.floor(clamp(x / Math.max(1, vw), 0, 0.999) * 5);
    const midi = E2 + oct * 12 + degree(deg);
    const { when, slot } = this.grid(g, 2);
    const seen = this.slots.get(slot) ?? [];
    // 同一个 8 分槽只允许一个音，否则密集重建会糊成和弦
    if (seen.length >= 1) return;
    seen.push(midi);
    this.slots.set(slot, seen);
    if (this.slots.size > MAX_SLOTS) {
      const oldest = this.slots.keys().next().value;
      if (oldest !== undefined) this.slots.delete(oldest);
    }
    // 视口外 40px 以外的元素响度打折
    const off = y < -40 || y > vh + 40 ? 0.45 : 1;
    const pan = this.pan(x, vw);
    const vel = (PLACE_VEL[kind] ?? 0.4) * 0.42;
    const ring = oct <= 1 ? 3.6 : oct >= 4 ? 1.6 : 2.4;
    this.piano(g, midi, when, vel * off, pan, ring);
    if (kind === 'image') {
      // 参考版 3341 图片再补一个三度内的上方音
      const second = midi + ((degree(deg + 2) - degree(deg) + 12) % 12);
      this.piano(g, second, when + 0.04, vel * 0.6 * off, pan, ring);
    }
    if (kind === 'dup') {
      this.piano(g, E2 + 12 + (deg % 2 ? 7 : 0), when, 0.15 * off, pan * 0.5, 2.8);
    }
  }

  /** 标题逐级放大：一小段上行（参考版 3346）。 */
  grow(x: number, y: number, vw: number, vh: number): void {
    const g = this.cue();
    if (!g) return;
    // 参考版由调用方传阶梯步号；这里按落点在页面里的纵向位置换算
    const step = Math.floor(clamp(y / Math.max(1, vh), 0, 1) * 8);
    this.tick(g, g.ctx.currentTime + 0.004, this.pan(x, vw), 2400 + step * 260, 5, 0.12, 0.01);
  }

  /** 拖拽吸附到参考线（参考版 3353，只用到横向声像）。 */
  snap(x: number, _y: number, vw: number, _vh: number): void {
    const g = this.cue();
    if (!g) return;
    const t = g.ctx.currentTime + 0.004;
    const pan = this.pan(x, vw);
    this.tick(g, t, pan, 4800, 3, 0.36, 0.012);
    this.tick(g, t + 0.002, pan, 1200, 2, 0.2, 0.03);
  }

  /** 最后一个和弦响起：E 大调 add9，扫弦（参考版 3416）。 */
  finale(): void {
    const g = this.cue();
    if (!g) return;
    const { when } = this.grid(g, 2);
    const chord = [E2, E2 + 7, E2 + 12, E2 + 16, E2 + 19, E2 + 26, E2 + 28, E2 + 31, E2 + 36, E2 + 43];
    chord.forEach((m, i) => {
      this.piano(g, m, when + i * 0.035, 0.34 - i * 0.015, -0.6 + (i / chord.length) * 1.2, 5.5);
    });
    this.pad(g, E2 + 12, when, 0.05, 5);
  }

  /** 回到真页面：下落扫频（参考版 3426）。 */
  release(): void {
    const g = this.cue();
    if (!g) return;
    const t = g.ctx.currentTime + 0.01;
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    src.loop = true;
    const bp = g.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1;
    bp.frequency.setValueAtTime(3000, t);
    bp.frequency.exponentialRampToValueAtTime(220, t + 1);
    const env = this.bus(g, t, 0, 0.5);
    env.gain.setValueAtTime(0.12, t);
    env.gain.exponentialRampToValueAtTime(0.0005, t + 1.1);
    src.connect(bp);
    bp.connect(env);
    src.start(t);
    src.stop(t + 1.2);
    this.piano(g, E2 + 12, t + 0.05, 0.3, 0, 2.5);
  }

  close(after = 0): void {
    if (this.disposed) return;
    const g = this.graph;
    this.graph = null;
    this.disposed = true;
    if (!g || g.ctx.state === 'closed') return;
    // 先淡出再关，硬关会在尾巴上爆一下
    const t = g.ctx.currentTime;
    g.out.gain.cancelScheduledValues(t);
    g.out.gain.setValueAtTime(g.out.gain.value, t);
    g.out.gain.linearRampToValueAtTime(0, t + Math.max(0.05, after));
    setTimeout(() => void g.ctx.close().catch(() => {}), (after + 0.2) * 1000);
  }

  private pan(x: number, vw: number): number {
    // 参考版 3180 光标位置映射到 -0.8..0.8
    return clamp((x / Math.max(1, vw)) * 1.6 - 0.8, -0.8, 0.8);
  }

  /** 一格栅格：when 是落在格子上的绝对时间，slot 用来去重。 */
  private grid(g: Graph, div: number): { when: number; slot: string } {
    const step = 60 / BPM / div;
    const now = g.ctx.currentTime + 0.015;
    const k = Math.ceil((now - this.t0) / step);
    return { when: this.t0 + k * step, slot: `${div}:${k}` };
  }

  /** 一路声部的出口：声像 -> 干信号进总线，send 分一路进混响。 */
  private bus(g: Graph, when: number, pan: number, send: number): GainNode {
    const gain = g.ctx.createGain();
    const p = g.ctx.createStereoPanner();
    p.pan.setValueAtTime(pan, when);
    gain.connect(p);
    p.connect(g.master);
    if (send) {
      const s = g.ctx.createGain();
      s.gain.value = send;
      p.connect(s);
      s.connect(g.verb);
    }
    return gain;
  }

  /** 玻璃钢琴：几支正弦泛音（含一支不谐和）叠一个毛毡锤击，长余响。 */
  private piano(g: Graph, midi: number, when: number, vel: number, pan: number, ring = 2.4): void {
    const now = g.ctx.currentTime;
    this.ends = this.ends.filter((e) => e > now);
    if (this.ends.length >= MAX_VOICES) return;
    const f = mtof(midi);
    const v = this.bus(g, when, pan, 0.85);
    v.gain.value = 0.3 * vel;
    // 高音区余响收得更紧
    const hi = f > 900;
    let last: OscillatorNode | null = null;
    for (const partial of PARTIALS) {
      const ratio = partial[0];
      const amp = partial[1];
      const decay = partial[2];
      if (f * ratio > 15000) continue;
      const osc = g.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * ratio * (1 + (Math.random() - 0.5) * 0.002);
      const env = g.ctx.createGain();
      const dur = ring * decay * (hi ? 0.65 : 1);
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(amp, when + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0006, when + dur);
      osc.connect(env);
      env.connect(v);
      osc.start(when);
      osc.stop(when + dur + 0.05);
      last = osc;
    }
    this.hammer(g, when, v, f, 0.5);
    this.ends.push(when + ring * (hi ? 0.65 : 1));
    if (last) last.onended = () => v.disconnect();
  }

  /** 琴锤击键的瞬态。 */
  private hammer(g: Graph, when: number, dest: GainNode, f: number, amt: number): void {
    const ctx = g.ctx;
    const src = ctx.createBufferSource();
    src.buffer = g.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(9000, f * 4 + 1200);
    bp.Q.value = 1.2;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(0.25 * amt, when + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0005, when + 0.03);
    src.connect(bp);
    bp.connect(env);
    env.connect(dest);
    src.start(when, Math.random());
    src.stop(when + 0.05);
  }

  /** 带通噪声短击：打字与点击都走它。 */
  private tick(
    g: Graph,
    when: number,
    pan: number,
    freq: number,
    q: number,
    vel: number,
    len: number,
  ): void {
    const ctx = g.ctx;
    const src = ctx.createBufferSource();
    src.buffer = g.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const env = this.bus(g, when, pan, 0.06);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(vel, when + 0.0008);
    env.gain.exponentialRampToValueAtTime(0.0004, when + len);
    src.connect(bp);
    bp.connect(env);
    src.start(when, Math.random() * 1.2);
    src.stop(when + len + 0.02);
    src.onended = () => env.disconnect();
  }

  private clack(g: Graph, when: number, pan: number, space: boolean, vel = 1): void {
    this.tick(g, when, pan, rand(3600, 5600), 2.2, rand(0.2, 0.3) * vel, rand(0.006, 0.011));
    const low = space ? rand(380, 560) : rand(850, 1500);
    const lowVel = space ? 0.26 : rand(0.13, 0.2);
    const lowLen = space ? 0.065 : rand(0.025, 0.042);
    this.tick(g, when + rand(0.001, 0.005), pan, low, 1.6, lowVel * vel, lowLen);
  }

  /** 弦乐垫：两支差音程三角波。 */
  private pad(g: Graph, midi: number, when: number, vel: number, len: number): void {
    const ctx = g.ctx;
    const env = this.bus(g, when, 0, 0.9);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(vel, when + len * 0.4);
    env.gain.exponentialRampToValueAtTime(0.0005, when + len);
    // 参考版 3395 detune 4 音分做合唱
    for (const det of [-4, 4]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = mtof(midi);
      osc.detune.value = det;
      osc.connect(env);
      osc.start(when);
      osc.stop(when + len + 0.05);
    }
  }

  /** 合成的房间脉冲：立体噪声，随时间低通收紧成暖尾。 */
  private impulse(ctx: AudioContext, secs: number, decay: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * secs);
    const buffer = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const k = i / n;
        const a = 0.55 - 0.4 * k;
        lp += a * (Math.random() * 2 - 1 - lp);
        // 前 12ms 淡入，免得冲激本身是个咔哒
        data[i] = lp * Math.pow(1 - k, decay) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
      }
    }
    return buffer;
  }

  private noise(ctx: AudioContext, secs: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, Math.floor(sr * secs), sr);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** 参考版 ready()：上下文在跑、而且没静音，才真的排一个音下去。 */
  private cue(): Graph | null {
    const g = this.open();
    return g && this.enabled && g.ctx.state === 'running' ? g : null;
  }

  private open(): Graph | null {
    if (this.disposed || !this.enabled) return null;
    if (!this.graph) {
      const Ctor = window.AudioContext;
      if (!Ctor) return null;
      let ctx: AudioContext;
      try {
        ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return null;
      }
      const out = ctx.createGain();
      out.gain.value = 1;
      // 参考版 3092 压限参数，密集重建时把总能量兜住
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 14;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.3;
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(comp);
      comp.connect(out);
      out.connect(ctx.destination);
      const verb = ctx.createConvolver();
      verb.buffer = this.impulse(ctx, 3.2, 2.4);
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      verb.connect(wet);
      wet.connect(master);
      this.graph = { ctx, out, master, verb, noise: this.noise(ctx, 1.5) };
      this.t0 = ctx.currentTime;
    }
    if (this.graph.ctx.state === 'suspended') void this.graph.ctx.resume();
    return this.graph;
  }
}

/** 配乐要知道当前那一屏：声像按横向位置算，音量按元素在不在屏内打折。 */
export interface ScoreStage {
  width: number;
  /** 视口上沿在蓝图坐标里的位置。 */
  top: number;
  height: number;
}

/**
 * SoundSink 的生成式实现：把动作层的四类事件翻译成参考版的四类发声。
 * 坐标换算（页面坐标 -> 视口坐标）和「这条元素该唱哪个声部」都收在这里，
 * 所以 Score 本身可以照原样只懂音乐。
 */
export class ScoreBus implements SoundSink {
  private readonly score: Score;

  constructor(private readonly stage: () => ScoreStage, on = true) {
    this.score = new Score(on);
    this.score.init();
  }

  get on(): boolean { return this.score.on; }
  get blocked(): boolean { return this.score.blocked; }
  setOn(on: boolean): void { this.score.setOn(on); }
  resume(): void { this.score.resume(); }

  play(event: SoundEvent, spot?: SoundSpot): void {
    const st = this.stage();
    const x = spot?.x ?? st.width / 2;
    const y = (spot?.y ?? 0) - st.top;
    const w = spot?.width ?? 0;
    const h = spot?.height ?? 0;
    const box = [x, y, w, h, st.width, st.height] as const;
    switch (event) {
      case 'type':
        this.score.key(x, st.width);
        break;
      case 'draw':
        // 参考版是元素落定那一下唱音；这里不改默认行为——SoundBus 仍然只有一声拉框，
        // 生成式配乐把同一个事件拆成敲击 + 唱音，量化到 16 分格后听不出差的那半拍。
        this.score.press(x, st.width);
        this.score.place(this.voice(spot), ...box);
        break;
      case 'stamp':
      case 'guide':
        this.score.place(this.voice(spot), ...box);
        break;
      case 'snap':
        this.score.snap(x, y, st.width, st.height);
        break;
      case 'grow':
        this.score.grow(x, y, st.width, st.height);
        break;
    }
  }

  /** 参考版按元素类型分声部：图片唱双音，副本补一个低音，其余走盒子。 */
  private voice(spot?: SoundSpot): string {
    if (!spot) return 'rect';
    return spot.kind === 'media' ? 'image' : spot.kind;
  }

  intro(): void { this.score.intro(); }
  start(): void { this.score.start(); }
  finale(): void { this.score.finale(); }
  release(): void { this.score.release(); }
  close(after = 0): void { this.score.close(after); }
}
