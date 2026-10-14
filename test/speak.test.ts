import { describe, expect, it } from 'vitest';
import { Speaker, type SpeakCtx } from '../src/speak.js';

function synth(voices: number) {
  const said: unknown[] = [];
  return { said, cancel: () => {}, getVoices: () => new Array(voices), speak: (u: unknown) => said.push(u) };
}
function ctx() {
  const started: unknown[] = [];
  const c: SpeakCtx & { started: unknown[] } = {
    started,
    state: 'suspended',
    destination: {},
    resume: async () => {
      c.state = 'running';
    },
    decodeAudioData: async (b) => ({ decoded: b.byteLength }),
    createBufferSource: () => {
      const src = { buffer: null as unknown, connect: () => src, start: () => started.push(src.buffer), stop: () => {} };
      return src;
    },
  };
  return c;
}
const okFetch = (calls: string[]) => async (_url: string, init: { body: string }) => {
  calls.push(JSON.parse(init.body).text);
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
};

describe('Speaker', () => {
  it('uses the browser voice when there is one, and never calls the Worker', async () => {
    const s = synth(3), calls: string[] = [];
    const sp = new Speaker({ synth: s, utter: (t) => t, fetch: okFetch(calls), make: ctx });
    expect(await sp.speak('Rest well.')).toBe('browser');
    expect(s.said).toEqual(['Rest well.']);
    expect(calls).toEqual([]);
  });

  it('falls back to the Worker when the browser has no voices (Quest)', async () => {
    const c = ctx(), calls: string[] = [];
    const sp = new Speaker({ synth: synth(0), utter: (t) => t, fetch: okFetch(calls), make: () => c });
    expect(await sp.speak('Tomorrow: fix the tap.')).toBe('worker');
    expect(calls).toEqual(['Tomorrow: fix the tap.']);
    expect(c.state).toBe('running');
    expect(c.started).toEqual([{ decoded: 8 }]);
    expect(sp.last).toBe('worker');
  });

  it('falls back to the Worker when there is no speechSynthesis at all', async () => {
    const calls: string[] = [];
    const sp = new Speaker({ synth: null, fetch: okFetch(calls), make: ctx });
    expect(await sp.speak('x')).toBe('worker');
  });

  it('a newer line supersedes one still in flight; only the newer plays', async () => {
    const c = ctx();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let n = 0;
    const fetch = async () => {
      if (n++ === 0) await gate;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(n) };
    };
    const sp = new Speaker({ synth: null, fetch, make: () => c });
    const first = sp.speak('first');
    expect(await sp.speak('second')).toBe('worker');
    release();
    expect(await first).toBe('superseded');
    expect(c.started).toHaveLength(1);
  });

  it('a failed or missing service is "failed", never a throw', async () => {
    const bad = new Speaker({ synth: null, fetch: async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }), make: ctx });
    expect(await bad.speak('x')).toBe('failed');
    const thrown = new Speaker({ synth: null, fetch: async () => { throw new Error('offline'); }, make: ctx });
    expect(await thrown.speak('x')).toBe('failed');
    expect(await new Speaker({ synth: null, fetch: null, make: ctx }).speak('x')).toBe('failed');
  });
});
