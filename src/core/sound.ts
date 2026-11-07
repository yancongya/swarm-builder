export type SoundEvent = 'type' | 'draw' | 'stamp' | 'guide';

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
};

/**
 * Synthesised clicks, so there is nothing to preload. The AudioContext is
 * created on the first event rather than in the constructor: browsers count
 * contexts against the autoplay policy, and most hosts never turn sound on.
 */
export class SoundBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly lastPlayed = new Map<SoundEvent, number>();

  play(event: SoundEvent): void {
    const ctx = this.open();
    const master = this.master;
    if (!ctx || !master) return;

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

  dispose(): void {
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    this.ctx = null;
    this.master = null;
  }

  private open(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      const master = this.ctx.createGain();
      master.gain.value = 0.7;
      master.connect(this.ctx.destination);
      this.master = master;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }
}
