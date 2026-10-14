// Drive the app's own calls and list the tones each one schedules (sound cues check).
//   LE_URL=http://localhost:8765/ node probe-sound.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "C:/Users/snpsa/node_modules/playwright");
const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await page.addInitScript(() => {
  globalThis.__tones = [];
  const make = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () {
    const o = make.call(this), set = o.frequency.setValueAtTime.bind(o.frequency);
    o.frequency.setValueAtTime = (f, t) => (globalThis.__tones.push(Math.round(f)), set(f, t));
    return o;
  };
});
await page.goto(process.env.LE_URL || "https://stephen-psaradellis.github.io/loose-ends/");
await page.waitForFunction(() => globalThis.looseEnds, null, { timeout: 30000 });
await page.waitForTimeout(2500);
await page.mouse.click(640, 28);
await page.waitForTimeout(2500);
console.log(JSON.stringify(await page.evaluate(async () => {
  const w = globalThis.looseEnds;
  const le = [...(w.systems.values ? w.systems.values() : w.systems)].find(x => x.sort && x.trace);
  const out = {};
  const step = async (name, fn) => { globalThis.__tones.length = 0; fn(); await new Promise(r => setTimeout(r, 300)); out[name] = globalThis.__tones.slice(); };
  const id = le.sort.cards.find(c => !c.tray)?.id ?? le.sort.cards[0].id;
  await step("select", () => le.select(id));
  await step("tomorrow", () => le.send(id, "tomorrow"));
  await step("week", () => le.send(id, "week"));
  await step("letgo", () => le.send(id, "letgo"));
  await step("undo", () => le.act("undo"));
  await step("mute", () => le.changePref({ key: "sound", value: false }));
  await step("muted_send", () => le.send(id, "tomorrow"));
  await step("unmute", () => le.changePref({ key: "sound", value: true }));
  out.label = le.prefs.label("sound");
  out.panelButton = le.buttonMeshes.has("pref:sound");
  out.ctxState = globalThis.__tones && (le.sounds.ctx?.state ?? null);
  return out;
})));
await browser.close();
