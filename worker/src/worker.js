// loose-ends-voice: speech to text for Loose Ends. Quest Browser has no Web Speech API, so the
// app records a short clip (MediaRecorder) and posts it here; Workers AI Whisper returns the text.
// The audio is never stored or logged: it lives for the length of this request.
// With ?split=1 an LLM also splits the transcript into short to-do cards. The app checks every
// card against the transcript and falls back to its own rules parser, so a slow or wrong model
// costs nothing but the upgrade.

export const MODEL = '@cf/openai/whisper-large-v3-turbo';
export const MAX_BYTES = 2_000_000; // ~60 s of opus; a thought is 2-15 s
export const SPLIT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const SPLIT_MS = 4000;
// Read-back voice for browsers with no speechSynthesis voices (Quest Browser is not documented
// to have any). Text in, audio out (melotts answers WAV); the text is not stored or logged.
export const TTS_MODEL = '@cf/myshell-ai/melotts';
export const TTS_MAX = 400;
const TRAYS = ['tomorrow', 'week', 'letgo'];
const CARD_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, tray: { type: ['string', 'null'], enum: ['tomorrow', 'week', 'letgo', null] } },
        required: ['text', 'tray'],
      },
    },
  },
  required: ['cards'],
};
const SPLIT_PROMPT =
  'You turn an evening brain-dump into to-do cards. Return JSON {"cards":[{"text":string,"tray":string|null}]}. ' +
  'One card per separate task, in the order spoken. text: 2-8 words, starts with a verb, built from the words the ' +
  'speaker used. Keep every name, place and deadline they said (Priya, Friday); add nothing they did not say. ' +
  'Sentence case: capitalise only the first word and names, no full stop. Example: "email Priya about the budget ' +
  'before Friday" -> "Email Priya about the budget by Friday". ' +
  'tray: "tomorrow" if they said tomorrow or in the morning, "week" if this week, later or a weekday, "letgo" if ' +
  'let it go or forget it (that task still gets its card), else null. Leave out filler, feelings with no task, and commands to the app. ' +
  'At most 8 cards. If there is no task, return {"cards":[]}.';
const ORIGINS = [/^https:\/\/stephen-psaradellis\.github\.io$/, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

export function allowOrigin(origin) {
  return typeof origin === 'string' && ORIGINS.some((re) => re.test(origin)) ? origin : null;
}

function cors(origin) {
  const h = { 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  const ok = allowOrigin(origin);
  if (ok) h['Access-Control-Allow-Origin'] = ok;
  return h;
}

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Keep only well-formed cards; anything else means the model said nothing usable. */
export function cleanCards(raw) {
  const list = Array.isArray(raw?.cards) ? raw.cards : Array.isArray(raw) ? raw : null;
  if (!list) return null;
  const out = [];
  for (const c of list.slice(0, 8)) {
    const text = String(c?.text ?? '').replace(/\s+/g, ' ').trim().replace(/[.]+$/, '');
    if (!text || text.length > 60) continue;
    out.push({ text, tray: TRAYS.includes(c?.tray) ? c.tray : null });
  }
  return out;
}

/** Workers AI answers either natively ({response}) or OpenAI-style ({choices:[{message}]}). */
export function modelText(out) {
  if (out?.response !== undefined) return out.response;
  return out?.choices?.[0]?.message?.content ?? null;
}

export function parseJson(resp) {
  if (resp && typeof resp === 'object') return resp;
  const m = String(resp ?? '').match(/\{[\s\S]*\}/);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

export async function splitCards(env, text, ms = SPLIT_MS) {
  if (!text) return [];
  const run = env.AI.run(SPLIT_MODEL, {
    messages: [
      { role: 'system', content: SPLIT_PROMPT },
      { role: 'user', content: text.slice(0, 1500) },
    ],
    max_tokens: 400,
    temperature: 0.1,
    response_format: { type: 'json_schema', json_schema: CARD_SCHEMA },
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), ms));
  try {
    const out = await Promise.race([run, timeout]);
    if (!out) console.log('split: timeout');
    return out ? cleanCards(parseJson(modelText(out))) : null;
  } catch (e) {
    console.log('split: error', String(e?.message || e).slice(0, 200));
    return null;
  }
}

/** Workers AI TTS answers base64 in {audio}, or raw bytes / a stream; normalise to bytes. */
export async function ttsBytes(out) {
  if (!out) return null;
  if (typeof out.audio === 'string') return Uint8Array.from(atob(out.audio), (c) => c.charCodeAt(0));
  if (out instanceof Uint8Array) return out;
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (typeof out.getReader === 'function') return new Uint8Array(await new Response(out).arrayBuffer());
  return null;
}

/** RIFF....WAVE is WAV; anything else from the model is MP3. */
export const audioType = (b) => (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 ? 'audio/wav' : 'audio/mpeg');

export async function handle(request, env) {
  const origin = request.headers.get('Origin');
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method === 'GET' && (path === '' || path === '/health')) return json({ ok: true, model: MODEL }, 200, origin);
  if (path === '/split' && request.method === 'POST') {
    if (origin && !allowOrigin(origin)) return json({ error: 'origin not allowed' }, 403, origin);
    const body = await request.json().catch(() => ({}));
    const text = String(body?.text ?? '').trim().slice(0, 1500);
    const t0 = Date.now();
    const cards = await splitCards(env, text, Math.min(Number(body?.ms) || SPLIT_MS, 15000));
    return json({ cards, ms: Date.now() - t0 }, 200, origin);
  }
  if (path === '/tts' && request.method === 'POST') {
    if (origin && !allowOrigin(origin)) return json({ error: 'origin not allowed' }, 403, origin);
    const body = await request.json().catch(() => ({}));
    const text = String(body?.text ?? '').trim().slice(0, TTS_MAX);
    if (!text) return json({ error: 'no text' }, 400, origin);
    try {
      const bytes = await ttsBytes(await env.AI.run(TTS_MODEL, { prompt: text, lang: 'en' }));
      if (!bytes || bytes.length < 100) return json({ error: 'no audio' }, 502, origin);
      return new Response(bytes, { status: 200, headers: { 'Content-Type': audioType(bytes), ...cors(origin) } });
    } catch (e) {
      return json({ error: 'speech service busy', detail: String(e?.message || e).slice(0, 200) }, 502, origin);
    }
  }
  if (path !== '/stt') return json({ error: 'not found' }, 404, origin);
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin);
  if (origin && !allowOrigin(origin)) return json({ error: 'origin not allowed' }, 403, origin);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length < 200) return json({ error: 'no audio' }, 400, origin);
  if (bytes.length > MAX_BYTES) return json({ error: 'clip too long' }, 413, origin);
  try {
    const out = await env.AI.run(MODEL, { audio: toBase64(bytes), language: 'en', vad_filter: true });
    const text = String(out?.text ?? '').trim();
    if (new URL(request.url).searchParams.get('split') !== '1') return json({ text }, 200, origin);
    const cards = await splitCards(env, text);
    return json(cards ? { text, cards } : { text }, 200, origin);
  } catch (e) {
    return json({ error: 'speech service busy', detail: String(e?.message || e).slice(0, 200) }, 502, origin);
  }
}

export default { fetch: handle };
