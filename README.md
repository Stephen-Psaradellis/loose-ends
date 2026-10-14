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
sessions on the device.

Voice: tap (or look at) the orb, talk, tap it again. A ramble becomes one card
per thought ("I need to email the landlord, and also book the dentist" -> two
cards). Commands work the same way: "groceries to tomorrow", a card's name then
"let it go", "undo", "I'm done" (reads back tomorrow's cards). Everything the app
hears or says is shown as a caption. The Quest Browser has no built-in speech
recognition, so the clip goes to a small Cloudflare Worker (`worker/`) that runs
Whisper on Workers AI and returns text; the audio is not stored. Commands are
parsed on the device (`src/voice.ts`), so they never wait on a model.

Coming: settings (contrast, text size, one-hand mode), the plant shelf that
grows between sessions, the first-five-minutes guide.

Tests: `npm test` (vitest - the sort model, dwell timing, save/load, the voice parser).

## Run it

```
npm install
npm run dev:runtime   # plain Vite dev server
npm run build         # static build in dist/
```

Built with AI assistance (Anthropic's Claude) for code and copy. MIT licence.
