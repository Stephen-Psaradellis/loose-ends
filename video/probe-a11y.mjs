// Check the two settings added for Meta's accessibility VRCs in real Chromium under IWER:
// Brightness (VRC.Quest.Accessibility.5) dims every surface, Turn (VRC.Quest.Accessibility.7)
// swings the desk round the viewer, both reachable from the settings panel, both survive a reload.
//   LE_URL=... node probe-a11y.mjs   (writes out/probe-a11y-panel.png)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "C:/Users/snpsa/node_modules/playwright");
const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const url = process.env.LE_URL || "https://stephen-psaradellis.github.io/loose-ends/";
const boot = async () => {
  await page.goto(url);
  await page.waitForFunction(() => globalThis.looseEnds, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(640, 28);
  await page.waitForTimeout(4000);
};
const sys = `const w = globalThis.looseEnds; const le = [...(w.systems.values ? w.systems.values() : w.systems)].find(x => x.sort && x.trace);
  const V = (o) => { const v = o.getWorldPosition(new o.position.constructor()); return [+v.x.toFixed(2), +v.z.toFixed(2)]; };`;
await boot();
const first = await page.evaluate(new Function(`${sys}
  const out = { xr: w.renderer.xr.isPresenting, buttons: le.buttonMeshes.size };
  out.trayBefore = V(le.trayBoxes[1]);
  le.press('settings');
  out.panelHas = ['pref:bright', 'pref:turn'].map(a => le.buttonMeshes.get(a).visible);
  le.press('pref:bright'); out.afterBrightBtn = le.captionText;
  le.changePref({ key: 'bright', step: -1 }); out.bright = le.prefs.bright;
  const c = le.trayBoxes[1].material.color; out.trayRed = +c.r.toFixed(3); out.trayBaseRed = +le.trayBoxes[1].material.userData.base.r.toFixed(3);
  le.press('pref:turn'); out.afterTurnBtn = le.captionText;
  out.trayAfter = V(le.trayBoxes[1]);
  return out;`));
await page.waitForTimeout(800);
await page.screenshot({ path: new URL("./out/probe-a11y-panel.png", import.meta.url).pathname.slice(1) });
await boot();
const reload = await page.evaluate(new Function(`${sys}
  const out = { bright: le.prefs.bright, turn: le.prefs.turn, rotY: +le.root.object3D.rotation.y.toFixed(3), trayRed: +le.trayBoxes[1].material.color.r.toFixed(3) };
  le.changePref({ key: 'turn', value: 0 }); le.changePref({ key: 'bright', step: 1 }); le.changePref({ key: 'bright', step: 1 });
  out.reset = [le.prefs.turn, le.prefs.bright, le.root.object3D.rotation.y];
  return out;`));
console.log(JSON.stringify({ first, reload }));
await browser.close();
