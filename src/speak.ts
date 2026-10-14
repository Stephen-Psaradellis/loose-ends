// Loose Ends - the read-back voice. The browser's own speechSynthesis is used when it has
// voices; Quest Browser documents none, so otherwise the line is fetched from our Worker
// (Workers AI text-to-speech, nothing stored) and played through Web Audio. A read-back that
// stays silent on the headset judges actually use would cost the whole "reads back
// tomorrow's plan" feature, so the fallback is the point of this file.

export const TTS_URL = 'https://loose-ends-voice.s-n-psaradellis.workers.dev/tts';

export type Route = 'browser' | 'worker' | 'failed' | 'superseded';

interface Synth {
  getVoices(): ArrayLike<unknown>;
  speak(u: unknown): void;
  cancel(): void;
}
interface Src {
  buffer: unknown;
  connect(d: unknown): unknown;
  start(): void;
  stop(): void;
}
export interface SpeakCtx {
  state: string;
  destination: unknown;
  resume(): Promise<void>;
  decodeAudioData(b: ArrayBuffer): Promise<unknown>;
  createBufferSource(): Src;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface SpeakDeps {
  synth?: Synth | null;
  utter?: (text: string) => unknown;
  fetch?: Fetch | null;
  make?: () => SpeakCtx | null;
  url?: string;
}

function browserSynth(): Synth | null {
  return (globalThis.speechSynthesis as unknown as Synth | undefined) ?? null;
}

function defaultContext(): SpeakCtx | null {
  const C = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return C ? (new C() as unknown as SpeakCtx) : null;
}

export class Speaker {
  /** How the last line was spoken - shown in the trace, so a probe can tell the routes apart. */
  last: Route | null = null;
  private ctx: SpeakCtx | null = null;
  private src: Src | null = null;
  private seq = 0;
  private readonly synth: Synth | null;
  private readonly utter: (text: string) => unknown;
  private readonly fetchFn: Fetch | null;
  private readonly make: () => SpeakCtx | null;
  private readonly url: string;

  constructor(deps: SpeakDeps = {}) {
    this.synth = deps.synth === undefined ? browserSynth() : deps.synth;
    this.utter = deps.utter ?? ((t) => new SpeechSynthesisUtterance(t));
    this.fetchFn = deps.fetch === undefined ? ((globalThis.fetch?.bind(globalThis) as unknown as Fetch) ?? null) : deps.fetch;
    this.make = deps.make ?? defaultContext;
    this.url = deps.url ?? TTS_URL;
    // Chrome fills the voice list lazily; asking once at start means it is ready by the first read-back.
    this.voices();
  }

  private voices(): number {
    try {
      return this.synth?.getVoices().length ?? 0;
    } catch {
      return 0;
    }
  }

  /** Cut off whatever is being said (a new line, or the user moved on). Never throws. */
  stop(): void {
    this.seq++;
    try {
      this.synth?.cancel();
    } catch {
      /* nothing playing */
    }
    try {
      this.src?.stop();
    } catch {
      /* already ended */
    }
    this.src = null;
  }

  /** Say a line; resolves with the route taken. Never throws. */
  async speak(text: string): Promise<Route> {
    this.stop();
    const id = this.seq;
    const done = (r: Route): Route => {
      if (id === this.seq) this.last = r;
      return r;
    };
    if (this.synth && this.voices() > 0) {
      try {
        this.synth.speak(this.utter(text));
        return done('browser');
      } catch {
        /* fall through to the Worker */
      }
    }
    if (!this.fetchFn) return done('failed');
    try {
      const res = await this.fetchFn(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return done('failed');
      const bytes = await res.arrayBuffer();
      if (id !== this.seq) return 'superseded';
      this.ctx ??= this.make();
      const ctx = this.ctx;
      if (!ctx) return done('failed');
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      const audio = await ctx.decodeAudioData(bytes);
      if (id !== this.seq) return 'superseded';
      const src = ctx.createBufferSource();
      src.buffer = audio;
      src.connect(ctx.destination);
      src.start();
      this.src = src;
      return done('worker');
    } catch {
      return done('failed');
    }
  }
}
