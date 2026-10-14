import { describe, expect, it } from 'vitest';
import { CUES, Sounds, VOLUME } from '../src/sound.js';
import { TRAYS } from '../src/sort.js';
import { loadPrefs, Prefs, savePrefs } from '../src/prefs.js';
import { parseUtterance } from '../src/voice.js';

/** A fake AudioContext that records every tone scheduled on it. */
function fakeContext(state: 'running' | 'suspended' = 'running') {
  const tones: { start: number; stop: number; freq: number[]; peak: number }[] = [];
  let resumed = 0;
  const ctx = {
    currentTime: 10,
    state,
    destination: {},
    resume: () => {
      resumed++;
      return Promise.resolve();
    },
    createGain: () => {
      const g = { peak: 0, gain: { setValueAtTime() {}, exponentialRampToValueAtTime: (v: number) => (g.peak = Math.max(g.peak, v)) } };
      return g;
    },
    createOscillator: () => {
      const tone = { start: 0, stop: 0, freq: [] as number[], peak: 0 };
      tones.push(tone);
      return {
        type: '',
        frequency: {
          setValueAtTime: (f: number) => tone.freq.push(f),
          exponentialRampToValueAtTime: (f: number) => tone.freq.push(f),
        },
        connect: (g: { peak: number }) => ({ connect: () => setTimeout(() => (tone.peak = g.peak)) }),
        start: (t: number) => (tone.start = t),
        stop: (t: number) => (tone.stop = t),
      };
    },
  };
  return { ctx, tones, resumed: () => resumed };
}

describe('Sounds', () => {
  it('gives every tray its own contour, so the destination is heard, not only seen', () => {
    const shape = (id: string) => JSON.stringify(CUES[id as keyof typeof CUES].map((t) => [t.f, t.to ?? t.f]));
    const shapes = TRAYS.map((t) => shape(t.id));
    expect(new Set(shapes).size).toBe(TRAYS.length);
    const [first, last] = [CUES.tomorrow[0].f, CUES.tomorrow[CUES.tomorrow.length - 1].f];
    expect(last).toBeGreaterThan(first); // Tomorrow rises
    expect(CUES.letgo[0].to!).toBeLessThan(CUES.letgo[0].f); // Let it go falls away
  });

  it('schedules each tone of a cue, quiet, and resumes a suspended context', () => {
    const f = fakeContext('suspended');
    const s = new Sounds(() => f.ctx as never);
    expect(s.play('tomorrow')).toBe(true);
    expect(f.tones).toHaveLength(CUES.tomorrow.length);
    expect(f.tones[1].start).toBeGreaterThan(f.tones[0].start);
    expect(f.tones.every((t) => t.stop > t.start)).toBe(true);
    expect(f.resumed()).toBe(1);
    s.play('leaf', 0.7);
    expect(f.tones[2].start).toBeCloseTo(10.71, 5);
    expect(VOLUME).toBeLessThanOrEqual(0.1);
  });

  it('is silent when muted, and never throws without Web Audio', () => {
    const f = fakeContext();
    const s = new Sounds(() => f.ctx as never);
    s.enabled = false;
    expect(s.play('done')).toBe(false);
    expect(f.tones).toHaveLength(0);
    const none = new Sounds(() => null);
    expect(none.play('select')).toBe(false);
    const broken = new Sounds(() => {
      throw new Error('no audio');
    });
    expect(broken.play('select')).toBe(false);
    expect(broken.play('select')).toBe(false);
  });
});

describe('Sound setting', () => {
  it('defaults on, toggles by button and voice, and survives a save', () => {
    const p = new Prefs();
    expect(p.sound).toBe(true);
    expect(p.apply({ key: 'sound', cycle: true })).toBe('Sounds off');
    const m = new Map<string, string>();
    savePrefs(p, { setItem: (k, v) => void m.set(k, v) });
    expect(loadPrefs({ getItem: (k) => m.get(k) ?? null }).sound).toBe(false);
    // A save from before sound cues existed loads with sound on.
    expect(Prefs.from({ v: 1, text: 1.5 }).sound).toBe(true);
    for (const said of ['mute', 'sounds off', 'turn off the sounds']) {
      expect(parseUtterance(said, [])).toEqual({ kind: 'pref', change: { key: 'sound', value: false } });
    }
    for (const said of ['unmute', 'sounds on', 'sound']) {
      expect(parseUtterance(said, [])).toEqual({ kind: 'pref', change: { key: 'sound', value: true } });
    }
  });
});
