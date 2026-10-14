// Coming-back loop check: seed last evening's sort (closed with Done yesterday), load the app,
// and confirm yesterday's Tomorrow returns to check off, Let it go dissolved, This week stayed.
//   LE_URL=http://localhost:8765/ node probe-review.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "C:/Users/snpsa/node_modules/playwright");
const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await page.addInitScript(() => {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  const d = new Date(Date.now() - 86400000), p = (n) => String(n).padStart(2, "0");
  const yesterday = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  localStorage.setItem("loose-ends:prefs:v1", JSON.stringify({ v: 1, guided: true }));
  localStorage.setItem("loose-ends:v1", JSON.stringify({
    v: 1, nextId: 5, closedDay: yesterday, cards: [
      { id: 1, text: "Buy groceries", tray: "tomorrow", hint: null },
      { id: 2, text: "Call mum about Sunday", tray: "tomorrow", hint: null },
      { id: 3, text: "That awkward meeting", tray: "letgo", hint: null },
      { id: 4, text: "Renew car insurance", tray: "week", hint: null },
    ],
  }));
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
await page.waitForTimeout(1500);
const read = () => page.evaluate(() => {
  const w = globalThis.looseEnds;
  const le = [...(w.systems.values ? w.systems.values() : w.systems)].find((x) => x.sort && x.trace);
  globalThis.__le = le;
  const visible = [...le.cardEntities].filter(([, e]) => e.object3D.visible).map(([id]) => id);
  return {
    caption: le.captionText, button: le.buttonLabel("accept"),
    cards: le.sort.cards.map((c) => `${c.id}:${c.tray ?? "loose"}${c.review ? "*" : ""}`).join(" "),
    visible: visible.join(","), trace: le.trace.filter((t) => /rollover|hear|speak/.test(t)).slice(-3),
  };
});
const out = { opened: await read() };
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
const step = async (name, js) => {
  await page.evaluate(`globalThis.__tones.length = 0; ${js}`);
  await page.waitForTimeout(300);
  out[name] = { ...(await read()), tones: await page.evaluate(() => globalThis.__tones.slice()) };
};
await step("press_nothing_selected", "__le.press('accept')");
await step("select_then_press", "__le.select(1); __le.press('accept')");
await step("undo", "__le.act('undo')");
await step("voice_did_groceries", "__le.hear('I did the groceries')");
await step("voice_call_mum_happened", "__le.hear('call mum happened')");
await step("done", "__le.act('done')");
await page.reload();
await page.waitForFunction(() => globalThis.looseEnds, null, { timeout: 30000 });
await page.waitForTimeout(2500);
out.reload_same_day = await read();
console.log(JSON.stringify(out, null, 1));
await browser.close();
