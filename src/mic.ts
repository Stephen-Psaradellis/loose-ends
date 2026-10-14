// Loose Ends - the microphone. Quest Browser has no Web Speech API, so a thought is
// recorded as a short clip and sent to our Worker (Workers AI Whisper), which returns
// text and keeps nothing. Commands are then parsed locally (voice.ts).

export const VOICE_URL = 'https://loose-ends-voice.s-n-psaradellis.workers.dev/stt';
/** A thought is a few seconds; stop on our own so a forgotten mic does not run on. */
export const MAX_CLIP_MS = 20_000;

export type MicState = 'idle' | 'listening' | 'thinking' | 'error';

function pickMime(): string | undefined {
  const MR = globalThis.MediaRecorder;
  if (!MR) return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MR.isTypeSupported(m));
}

export async function transcribe(clip: Blob, url = VOICE_URL, fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher(url, { method: 'POST', body: clip, headers: { 'Content-Type': clip.type || 'audio/webm' } });
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(body.error || `speech service ${res.status}`);
  return (body.text ?? '').trim();
}

/** Tap to start, tap again to stop; the transcript (or an error) arrives through the callbacks. */
export class Mic {
  state: MicState = 'idle';
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Optional source for tests and the emulator (a MediaStream not from the microphone). */
  streamSource: (() => Promise<MediaStream>) | null = null;

  constructor(
    private onText: (text: string) => void,
    private onState: (state: MicState, detail?: string) => void,
  ) {}

  get supported(): boolean {
    return !!(globalThis.MediaRecorder && (this.streamSource || navigator.mediaDevices?.getUserMedia));
  }

  toggle(): void {
    if (this.state === 'listening') this.stop();
    else if (this.state !== 'thinking') void this.start();
  }

  private set(state: MicState, detail?: string): void {
    this.state = state;
    this.onState(state, detail);
  }

  async start(): Promise<void> {
    if (!this.supported) return this.set('error', 'No microphone here - pinch or look instead.');
    let stream: MediaStream;
    try {
      stream = this.streamSource ? await this.streamSource() : await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return this.set('error', 'Microphone blocked - pinch or look instead.');
    }
    const mimeType = pickMime();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.rec = rec;
    this.chunks = [];
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void this.finish(new Blob(this.chunks, { type: rec.mimeType || mimeType || 'audio/webm' }));
    };
    rec.start();
    this.timer = setTimeout(() => this.stop(), MAX_CLIP_MS);
    this.set('listening');
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.rec?.state === 'recording') {
      this.set('thinking');
      this.rec.stop();
    }
    this.rec = null;
  }

  private async finish(clip: Blob): Promise<void> {
    try {
      const text = await transcribe(clip);
      this.set('idle');
      if (text) this.onText(text);
      else this.set('error', "Didn't catch that - try again.");
    } catch {
      this.set('error', 'Voice is offline right now - pinch or look instead.');
    }
  }
}
