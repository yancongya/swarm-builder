export type SoundEvent = 'type' | 'draw' | 'stamp' | 'guide' | 'snap' | 'grow';

interface Voice {
  wave: OscillatorType;
  from: number;
  to: number;
  /** Seconds of envelope. */
  dur: number;
  gain: number;
  /** Seconds of silence forced after the same kind of event. */
  gap: number;
}

const VOICES: Record<SoundEvent, Voice> = {
  type: { wave: 'square', from: 1500, to: 950, dur: 0.035, gain: 0.045, gap: 0.03 },
  draw: { wave: 'triangle', from: 300, to: 760, dur: 0.12, gain: 0.08, gap: 0.07 },
  stamp: { wave: 'sine', from: 680, to: 230, dur: 0.16, gain: 0.12, gap: 0.06 },
  guide: { wave: 'sine', from: 1180, to: 1120, dur: 0.09, gain: 0.06, gap: 0.06 },
  snap: { wave: 'triangle', from: 2300, to: 1300, dur: 0.05, gain: 0.05, gap: 0.05 },
  grow: { wave: 'sine', from: 520, to: 940, dur: 0.09, gain: 0.05, gap: 0.04 },
};

/**
 * Synthesised clicks, so there is nothing to preload. The AudioContext is
 * created on the first event rather than in the constructor: browsers count
 * contexts against the autoplay policy, and a muted run never opens one.
 */
export class SoundBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private out: GainNode | null = null;
  private enabled: boolean;
  private closed = false;
  private readonly lastPlayed = new Map<SoundEvent, number>();

  constructor(on = true) {
    this.enabled = on;
  }

  get on(): boolean {
    return this.enabled;
  }

  get blocked(): boolean {
    return this.ctx !== null && this.ctx.state !== 'running';
  }

  setOn(on: boolean): void {
    this.enabled = on;
    const ctx = this.ctx;
    const out = this.out;
    if (!ctx || !out) {
      if (on) this.open();
      return;
    }
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setTargetAtTime(on ? 1 : 0, t, 0.05);
    if (on) this.resume();
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  play(event: SoundEvent): void {
    const ctx = this.open();
    const master = this.master;
    // 挂起的上下文不走时：照排下去会在解锁那一刻一起炸出来，所以等到它真在跑再发声。
    if (!ctx || !master || !this.enabled || ctx.state !== 'running') return;

    const voice = VOICES[event];
    // Wall clock, not ctx.currentTime: a suspended context does not advance,
    // which would otherwise suppress every event after the first.
    const at = performance.now();
    if (at - (this.lastPlayed.get(event) ?? -1000) < voice.gap * 1000) return;
    this.lastPlayed.set(event, at);

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = voice.wave;
    osc.frequency.setValueAtTime(voice.from, now);
    osc.frequency.exponentialRampToValueAtTime(voice.to, now + voice.dur);
    // Six cursors typing at once would otherwise sound like one flat tone.
    osc.detune.setValueAtTime((Math.random() - 0.5) * 140, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(voice.gain, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + voice.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + voice.dur + 0.02);
  }

  close(after = 0): void {
    if (this.closed) return;
    this.closed = true;
    const ctx = this.ctx;
    const out = this.out;
    this.ctx = null;
    this.master = null;
    this.out = null;
    if (!ctx || ctx.state === 'closed') return;
    // 硬关会在尾巴上爆一下，所以先淡出再关。
    if (out) {
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + Math.max(0.05, after));
    }
    setTimeout(() => void ctx.close().catch(() => {}), (after + 0.2) * 1000);
  }

  private open(): AudioContext | null {
    if (this.closed || !this.enabled) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      const master = this.ctx.createGain();
      master.gain.value = 0.7;
      const out = this.ctx.createGain();
      out.gain.value = 1;
      master.connect(out);
      out.connect(this.ctx.destination);
      this.master = master;
      this.out = out;
    }
    this.resume();
    return this.ctx;
  }
}
