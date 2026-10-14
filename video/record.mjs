// Drive Loose Ends in the IWER emulator scene by scene, timed to the narration, and record it.
//   node record.mjs [out/]        (LE_URL defaults to the live gh-pages build)
// Needs out/lengths.json + out/user_*.wav from narrate.py. Writes out/<hash>.webm (Playwright)
// and out/timeline.json ({scene: start s, user_<scene>: start s, readback: text}).
// Every interaction goes through the app's real input paths: head-gaze dwell (the emulated
// headset turns), a hand ray + pinch (the emulated right hand), and the microphone (the user
// lines are played into Mic.streamSource, recorded by MediaRecorder and sent to the Worker).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "C:/Users/snpsa/node_modules/playwright");

const OUT = process.argv[2] || "out";
const URL = process.env.LE_URL || "https://stephen-psaradellis.github.io/loose-ends/";
const SHOTS = process.env.SHOTS === "1"; // also save a PNG at the end of every scene
const lengths = JSON.parse(readFileSync(join(OUT, "lengths.json"), "utf8"));
const PAD = 0.7;

const browser = await chromium.launch({
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const t0 = Date.now();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
const page = await ctx.newPage();
page.on("console", m => { if (m.type() === "error") console.error("page:", m.text().slice(0, 160)); });
const now = () => (Date.now() - t0) / 1000;
const wait = s => page.waitForTimeout(Math.max(0, s * 1000));
const timeline = {};

await page.goto(URL);
await page.waitForFunction(() => globalThis.looseEnds, null, { timeout: 30000 });
await wait(2.5);
// Fresh visitor: no saved sort, prefs, garden or guide progress.
await page.evaluate(() => { try { Object.keys(localStorage).filter(k => k.startsWith("loose-ends")).forEach(k => localStorage.removeItem(k)); } catch {} });
await page.reload();
await page.waitForFunction(() => globalThis.looseEnds, null, { timeout: 30000 });
await wait(2.5);
await page.mouse.click(640, 28); // IWER's "Enter XR"
await page.waitForFunction(() => globalThis.looseEnds.renderer.xr.isPresenting, null, { timeout: 15000 });

// Rig: hide the emulator's developer panels, hands mode, seated head pose, and helpers.
const clips = {};
for (const f of readdirSync(OUT).filter(f => /^user_.*\.wav$/.test(f))) clips[f.slice(5, -4)] = readFileSync(join(OUT, f)).toString("base64");
await page.evaluate(async (clips) => {
  const d = globalThis.IWER_DEVICE, w = globalThis.looseEnds;
  const le = [...w.systems.values ? w.systems.values() : w.systems].find(x => x.sort && x.trace);
  const app = d.appCanvas;
  for (const el of document.body.children) if (!el.contains(app)) el.style.display = "none";
  for (const el of document.querySelectorAll("*")) if (el.shadowRoot && !el.contains(app)) el.style.display = "none"; // "Remote Control Active" badge
  d.primaryInputMode = "hand";
  const ac = new AudioContext();
  const buffers = {};
  for (const [k, b64] of Object.entries(clips)) {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    buffers[k] = await ac.decodeAudioData(bytes.buffer);
  }
  let next = null;
  le.mic.streamSource = async () => {
    await ac.resume();
    const dest = ac.createMediaStreamDestination();
    if (next) { const src = ac.createBufferSource(); src.buffer = buffers[next]; src.connect(dest); src.start(); next = null; }
    return dest.stream;
  };
  const R = (m, p) => d.remote.dispatch(m, p);
  const quat = (yaw, pitch) => { // YXZ: yaw about Y, then pitch about X, no roll
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
  };
  const anglesTo = (from, p) => {
    const dx = p.x - from.x, dy = p.y - from.y, dz = p.z - from.z;
    return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
  };
  const target = key => {
    for (const [o, k] of le.gazeKeys) if (k === key) return o.getWorldPosition(o.position.clone());
    return null;
  };
  const HEAD = { x: 0, y: 1.42, z: 0.05 }, REST = -0.42;
  await R("set_transform", { device: "headset", position: HEAD, orientation: quat(0, REST) });
  globalThis.__rig = {
    le, d, R,
    say(clip) { next = clip; },
    async look(key, ms = 700) {
      const p = target(key);
      if (!p) throw new Error("no gaze target " + key);
      const [yaw, pitch] = anglesTo(HEAD, p);
      await R("animate_to", { device: "headset", orientation: quat(yaw, pitch), duration: ms / 1000 });
    },
    async lookAngles(yaw, pitch, ms = 700) { await R("animate_to", { device: "headset", orientation: quat(yaw, pitch), duration: ms / 1000 }); },
    async hand(side, x, y, z, ms = 0) {
      const device = `hand-${side}`;
      if (ms) await R("animate_to", { device, position: { x, y, z }, duration: ms / 1000 });
      else await R("set_transform", { device, position: { x, y, z } });
    },
    async point(key, ms = 500) { // aim the right hand at a target, then hold
      const p = target(key);
      if (!p) throw new Error("no hand target " + key);
      await R("look_at", { device: "hand-right", target: { x: p.x, y: p.y, z: p.z } });
      await new Promise(r => setTimeout(r, ms));
    },
    async grab(cardKey, trayKey) { // point at the card, pinch and hold, sweep the ray to the tray, let go
      const c = target(cardKey), t = target(trayKey);
      if (!c || !t) throw new Error("no grab target " + cardKey + " " + trayKey);
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      await R("animate_to", { device: "hand-right", position: { x: 0.16, y: 1.12, z: -0.2 }, duration: 0.5 });
      await R("look_at", { device: "hand-right", target: c });
      await sleep(500);
      await R("set_select_value", { device: "hand-right", value: 1 });
      await sleep(300);
      const to = { x: t.x, y: t.y + 0.03, z: t.z };
      for (let i = 1; i <= 30; i++) {
        const k = i / 30, e = k * k * (3 - 2 * k);
        await R("look_at", { device: "hand-right", target: { x: c.x + (to.x - c.x) * e, y: c.y + (to.y - c.y) * e, z: c.z + (to.z - c.z) * e } });
        await sleep(33);
      }
      await sleep(250);
      await R("set_select_value", { device: "hand-right", value: 0 });
      await sleep(400);
      await R("animate_to", { device: "hand-right", position: { x: 0.2, y: 1.05, z: -0.22 }, duration: 0.6 });
    },
    async pinch() { await R("select", { device: "hand-right", duration: 0.25 }); await new Promise(r => setTimeout(r, 250)); },
    keys: () => [...le.gazeKeys.values()],
    cardKey: text => { const c = le.sort.toJSON().cards.find(c => !c.tray && c.text.toLowerCase().includes(text.toLowerCase())); return c ? `card:${c.id}` : null; },
    caption: () => le.captionText,
    trace: () => le.trace.slice(-6),
    pose: () => { const t = d.quaternion; return [t.x, t.y, t.z, t.w].map(n => +n.toFixed(2)); },
  };
  await globalThis.__rig.hand("left", -0.2, 1.05, -0.22);
  await globalThis.__rig.hand("right", 0.2, 1.05, -0.22);
}, clips);
await wait(1.5);

async function scene(id, body) {
  timeline[id] = now();
  const len = lengths[id];
  const s = Date.now();
  await body?.();
  await wait(len + PAD - (Date.now() - s) / 1000);
  if (SHOTS) await page.screenshot({ path: join(OUT, `shot_${id}.png`) });
  console.error(id, "at", timeline[id].toFixed(1), JSON.stringify(await page.evaluate(() => __rig.trace())).slice(0, 200));
}
async function speak(id, after) { // the user talks: start the mic by gaze, play the line, stop by gaze
  await page.evaluate(id => __rig.say(id), id);
  await page.evaluate(() => __rig.look("mic", 600));
  await page.waitForFunction(() => __rig.le.mic.state === "listening", null, { timeout: 5000 }).catch(async e => {
    await page.screenshot({ path: join(OUT, "fail.png") });
    console.error(JSON.stringify(await page.evaluate(() => { const r = __rig, c = r.le.world?.camera || globalThis.looseEnds.camera;
      const v = c.getWorldDirection(c.position.clone()), p = c.getWorldPosition(c.position.clone());
      return { mic: r.le.mic.state, trace: r.trace(), dir: [v.x, v.y, v.z].map(n => n.toFixed(2)), pos: [p.x, p.y, p.z].map(n => n.toFixed(2)),
        dq: [r.d.quaternion.x, r.d.quaternion.y, r.d.quaternion.z, r.d.quaternion.w].map(n => n.toFixed(2)), keys: r.keys().join(" ") }; })));
    throw e; });
  timeline[`user_${id}`] = now();
  await wait(lengths[`user_${id}`] + 0.3);
  await page.evaluate(() => __rig.lookAngles(0, -0.42, 400));
  await wait(0.3);
  await page.evaluate(() => __rig.look("mic", 400));
  await page.waitForFunction(() => __rig.le.mic.state !== "listening", null, { timeout: 5000 });
  await page.evaluate(() => __rig.lookAngles(0, -0.42, 500));
  await page.waitForFunction(() => __rig.le.mic.state === "idle" || __rig.le.mic.state === "error", null, { timeout: 15000 });
  await after?.();
}

await scene("intro", async () => {
  await page.evaluate(() => __rig.lookAngles(0.15, -0.45, 2500));
  await page.evaluate(() => __rig.lookAngles(-0.15, -0.55, 3000));
  await page.evaluate(() => __rig.lookAngles(0, -0.42, 2000));
});
await scene("voice");
await speak("voice");
await scene("cards");
await scene("pinch", async () => {
  const card = await page.evaluate(() => __rig.cardKey("sam") || __rig.keys().find(k => k.startsWith("card:")));
  await page.evaluate(k => __rig.grab(k, "tray:week"), card);
});
await scene("gaze", async () => {
  const card = await page.evaluate(() => __rig.cardKey("priya") || __rig.keys().find(k => k.startsWith("card:")));
  await page.evaluate(k => __rig.look(k, 600), card);
  await wait(1.6);
  await page.evaluate(() => __rig.look("tray:tomorrow", 600));
  await wait(1.6);
  await page.evaluate(() => __rig.lookAngles(0, -0.42, 500));
});
await scene("command");
await speak("command");
await scene("settings");
await speak("settings");
await wait(1.2);
await scene("done");
await speak("done", async () => { await wait(0.5); timeline.readback = await page.evaluate(() => __rig.caption()); timeline.readback_at = now(); });
await wait(4);
await page.evaluate(() => __rig.look("tray:tomorrow", 900));
await wait(1);
await scene("outro", async () => { await page.evaluate(() => __rig.lookAngles(0.35, -0.4, 2500)); });
await wait(1);
timeline._end = now();

const video = page.video();
await ctx.close();
await browser.close();
const path = await video.path();
writeFileSync(join(OUT, "timeline.json"), JSON.stringify({ ...timeline, video: path.split(/[\\/]/).pop() }, null, 1));
console.log(JSON.stringify({ video: path, seconds: timeline._end.toFixed(1), readback: timeline.readback }));
