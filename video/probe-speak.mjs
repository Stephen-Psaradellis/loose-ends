// Read-back voice probe: which route speaks (browser voice or our Worker), in real Chromium.
// NO_VOICES=1 empties speechSynthesis.getVoices() - Quest Browser documents no voices - so the
// Worker route must speak: the trace shows 'speak worker' and a buffer source starts.
//   LE_URL=http://localhost:8765/ NO_VOICES=1 node probe-speak.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "C:/Users/snpsa/node_modules/playwright");
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
if (process.env.NO_VOICES) await page.addInitScript(() => { speechSynthesis.getVoices = () => []; });
await page.addInitScript(() => {
  globalThis.__started = [];
  const orig = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { globalThis.__started.push(+(this.buffer?.duration ?? 0).toFixed(2)); return orig.apply(this, a); };
});
await page.goto(process.env.LE_URL || "https://stephen-psaradellis.github.io/loose-ends/");
await page.waitForFunction(() => globalThis.looseEnds && [...globalThis.looseEnds.systems].some((x) => x.sort && x.trace), null, { timeout: 60000 });
const voices = await page.evaluate(() => globalThis.speechSynthesis?.getVoices().length ?? null);
const t0 = Date.now();
await page.evaluate(() => [...globalThis.looseEnds.systems].find((x) => x.sort && x.trace).say("Tomorrow: email Priya about the budget. Rest well.", true));
await page.waitForFunction(() => [...globalThis.looseEnds.systems].find((x) => x.sort && x.trace).trace.some((t) => t.startsWith("speak")), null, { timeout: 20000 }).catch(() => {});
const out = await page.evaluate(() => ({ trace: [...globalThis.looseEnds.systems].find((x) => x.sort && x.trace).trace.filter((t) => t.startsWith("speak")), started: globalThis.__started }));
console.log(JSON.stringify({ voices, ms: Date.now() - t0, ...out }));
await browser.close();
