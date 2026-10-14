// First Five Minutes probe: a fresh profile on the LIVE URL, following only the
// guide's captions. Prints the time to each milestone, the caption shown at each
// step, and which of caption / cards / trays / orb / buttons sit inside the
// starting view. Screenshots go to SHOTS (default: out/first5-*.png).
//   LE_URL=... SHOTS=dir node probe-first5.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/snpsa/node_modules/playwright");
const URL_ = process.env.LE_URL || "https://stephen-psaradellis.github.io/loose-ends/";
const SHOTS = process.env.SHOTS || new URL("./out/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const T0 = Date.now(), ms = () => Date.now() - T0, log = [];
const mark = (what, extra = {}) => { log.push({ t: ms(), what, ...extra }); };
await page.goto(URL_);
mark("dom", { title: await page.title() });
await page.waitForFunction(() => globalThis.looseEnds, null, { timeout: 60000 });
mark("world");
await page.waitForFunction(() => { const w = globalThis.looseEnds; return [...w.systems].some(x => x.guide); }, null, { timeout: 30000 });
mark("scene");
await page.screenshot({ path: SHOTS + "first5-0-flat.png" });
const flatText = await page.evaluate(() => document.body.innerText.slice(0, 300));
await page.mouse.click(640, 28);
await page.waitForFunction(() => globalThis.IWER_DEVICE?.activeSession, null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
mark("xr", { session: await page.evaluate(() => !!globalThis.IWER_DEVICE?.activeSession) });
await page.screenshot({ path: SHOTS + "first5-1-xr.png" });

// What the visitor can see before moving their head, and what the guide says.
const view = await page.evaluate(() => {
  const w = globalThis.looseEnds, le = [...w.systems].find(x => x.sort && x.trace);
  const cam = w.camera ?? w.player?.head ?? le.world?.camera;
  const inView = o => { const v = o.getWorldPosition(o.position.clone()); v.project(cam); return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1; };
  const seen = {};
  for (const [o, k] of le.gazeKeys) seen[k] = inView(o);
  seen.caption = le.caption ? inView(le.caption) : null;
  return { caption: le.captionText, guideStep: le.guide.step, seen };
});
mark("view", view);

// Follow the captions with the emulated right hand: pinch card 1, pinch a tray.
const pinch = async key => page.evaluate(async ([KEY]) => {
  const w = globalThis.looseEnds, d = globalThis.IWER_DEVICE, le = [...w.systems].find(x => x.sort && x.trace);
  d.primaryInputMode = "hand"; await new Promise(r => setTimeout(r, 300));
  const R = (m, p) => d.remote.dispatch(m, p);
  await R("set_transform", { device: "hand-right", position: { x: 0.16, y: 1.12, z: -0.2 } });
  const o = [...le.gazeKeys].find(([, k]) => k === KEY)[0], c = o.getWorldPosition(o.position.clone());
  await R("look_at", { device: "hand-right", target: { x: c.x, y: c.y, z: c.z } });
  await new Promise(r => setTimeout(r, 400));
  await R("select", { device: "hand-right", duration: 0.25 }); await new Promise(r => setTimeout(r, 700));
  return { caption: le.captionText, guideStep: le.guide.step, trace: le.trace.slice(-2) };
}, [key]);
const human = 3000; // reading a one-line caption and reaching: a generous human pace
await page.waitForTimeout(human);
mark("select card:1", await pinch("card:1"));
await page.waitForTimeout(human);
const trays = await page.evaluate(() => [...[...globalThis.looseEnds.systems].find(x => x.sort && x.trace).gazeKeys.values()].filter(k => k.startsWith("tray:")));
mark("send " + trays[0], await pinch(trays[0]));
await page.screenshot({ path: SHOTS + "first5-2-sorted.png" });
console.log(JSON.stringify({ url: URL_, flatText, log }, null, 1));
await browser.close();
