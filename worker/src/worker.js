// loose-ends-voice: speech to text for Loose Ends. Quest Browser has no Web Speech API, so the
// app records a short clip (MediaRecorder) and posts it here; Workers AI Whisper returns the text.
// The audio is never stored or logged: it lives for the length of this request.

export const MODEL = '@cf/openai/whisper-large-v3-turbo';
export const MAX_BYTES = 2_000_000; // ~60 s of opus; a thought is 2-15 s
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

export async function handle(request, env) {
  const origin = request.headers.get('Origin');
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method === 'GET' && (path === '' || path === '/health')) return json({ ok: true, model: MODEL }, 200, origin);
  if (path !== '/stt') return json({ error: 'not found' }, 404, origin);
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin);
  if (origin && !allowOrigin(origin)) return json({ error: 'origin not allowed' }, 403, origin);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length < 200) return json({ error: 'no audio' }, 400, origin);
  if (bytes.length > MAX_BYTES) return json({ error: 'clip too long' }, 413, origin);
  try {
    const out = await env.AI.run(MODEL, { audio: toBase64(bytes), language: 'en', vad_filter: true });
    const text = String(out?.text ?? '').trim();
    return json({ text }, 200, origin);
  } catch (e) {
    return json({ error: 'speech service busy', detail: String(e?.message || e).slice(0, 200) }, 502, origin);
  }
}

export default { fetch: handle };
