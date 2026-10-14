// Loose Ends - sound cues. Every act already has a caption; these give it a sound
// too, so a user who cannot read the trays (low vision, eyes closed at the end of
// the day) still knows where a card went (Accessibility Forward). Each tray has its
// own contour: Tomorrow rises, This week holds, Let it go falls away. Synthesised
// with Web Audio, so there are no files to load and nothing leaves the device.

import type { TrayId } from './sort.js';

export type Cue = 'select' | TrayId | 'loose' | 'undo' | 'done' | 'check' | 'leaf' | 'listen' | 'heard' | 'nothing';

/** One tone: frequency (Hz), start offset and length (s), optional glide target (Hz) and level. */
export interface Tone {
  f: number;
  at: number;
  len: number;
  to?: number;
  gain?: number;
}

const C4 = 261.63;
const E4 = 329.63;
const G4 = 392;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const C6 = 1046.5;

export const CUES: Readonly<Record<Cue, readonly Tone[]>> = {
  select: [{ f: A5, at: 0, len: 0.05, gain: 0.5 }],
  tomorrow: [
    { f: C5, at: 0, len: 0.12 },
    { f: G5, at: 0.09, len: 0.2 },
  ],
  week: [{ f: E5, at: 0, len: 0.22 }],
  letgo: [{ f: G4, at: 0, len: 0.45, to: C4, gain: 0.7 }],
  loose: [{ f: E5, at: 0, len: 0.1, to: C5, gain: 0.5 }],
  undo: [
    { f: G5, at: 0, len: 0.1 },
    { f: C5, at: 0.08, len: 0.16 },
  ],
  done: [
    { f: C5, at: 0, len: 0.5 },
    { f: E5, at: 0.12, len: 0.45 },
    { f: G5, at: 0.24, len: 0.6 },
  ],
  // A plan card that happened: a quick bright step up, lighter than the evening's Done chord.
  check: [
    { f: E5, at: 0, len: 0.08, gain: 0.6 },
    { f: C6, at: 0.07, len: 0.18, gain: 0.6 },
  ],
  leaf: [
    { f: G5, at: 0, len: 0.12, gain: 0.5 },
    { f: C6, at: 0.1, len: 0.3, gain: 0.5 },
  ],
  listen: [{ f: C5, at: 0, len: 0.12, to: G5, gain: 0.6 }],
  heard: [{ f: G5, at: 0, len: 0.12, to: C5, gain: 0.6 }],
  nothing: [{ f: E4, at: 0, len: 0.18, gain: 0.5 }],
};

/** Overall loudness: an evening app, so cues sit well under the read-back voice. */
export const VOLUME = 0.08;

type Ctx = Pick<AudioContext, 'currentTime' | 'state' | 'resume' | 'createOscillator' | 'createGain' | 'destination'>;

function defaultContext(): Ctx | null {
  const C = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return C ? new C() : null;
}

export class Sounds {
  enabled = true;
  private ctx: Ctx | null = null;
  private failed = false;

  constructor(private readonly make: () => Ctx | null = defaultContext) {}

  /** Play a cue (after `delay` seconds); false when muted or the browser has no Web Audio. Never throws. */
  play(cue: Cue, delay = 0): boolean {
    if (!this.enabled || this.failed) return false;
    try {
      this.ctx ??= this.make();
      const ctx = this.ctx;
      if (!ctx) {
        this.failed = true;
        return false;
      }
      // Browsers start a context suspended until a user gesture; every cue follows one.
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      const t0 = ctx.currentTime + 0.01 + delay;
      for (const tone of CUES[cue]) {
        const t = t0 + tone.at;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(tone.f, t);
        if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, t + tone.len);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(VOLUME * (tone.gain ?? 1), t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.len);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + tone.len + 0.02);
      }
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }
}
