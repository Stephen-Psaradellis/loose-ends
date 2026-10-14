# Loose Ends

A five-minute, seated evening wind-down for Meta Quest, built on the web
(WebXR, Meta's Immersive Web SDK). Say what is still on your mind; each thing
becomes a card; sort the cards into **Tomorrow**, **This week** or **Let it go**
with your hands, your voice, or just by looking.

**Try it:** https://stephen-psaradellis.github.io/loose-ends/ - in the Quest
Browser, or in any desktop browser (the IWER emulator loads automatically
outside a headset).

Status: early build for the Meta Horizon Start Developer Competition 2026.
Working now: the three trays, pinch-drag (or ray-drag) a card into a tray, and
select-a-card-then-a-tray, head-gaze dwell (look at a card for 1.2 s to pick it,
then at a tray to drop it - no hands needed), and your sort is kept between
sessions on the device. Coming: voice capture and commands, settings (contrast,
text size, one-hand mode), the plant shelf that grows between sessions.

Tests: `npm test` (vitest - the sort model, dwell timing, save/load).

## Run it

```
npm install
npm run dev:runtime   # plain Vite dev server
npm run build         # static build in dist/
```

Built with AI assistance (Anthropic's Claude) for code and copy. MIT licence.
