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
parsed on the device (`src/voice.ts`), so they never wait on a model. For a
ramble, the same Worker asks Llama 3.3 (Workers AI, JSON schema output) to split
it into short cards ("um, the leaky kitchen tap, let it go" -> "Fix the leaky
kitchen tap"). The app keeps the model's cards only if every one is built from
words you said; one invented card and it uses its own rules split instead.

The assistant also suggests where each new card might go ("call the plumber
tomorrow" -> a card marked *suggest: Tomorrow*), but it never sorts on its own.
"Sort them for me", the Sort as suggested button, or a look at it takes every
suggestion at once, and one Undo puts them all back.

Undo and "Done for tonight" are also buttons, so every spoken command has a
pinch and a look-at-it twin. Done reads back tomorrow's cards and grows the
plant on the shelf by one leaf - once per evening, kept on the device - until it
flowers after twelve evenings.

Settings (the button above Undo, or say "settings") cover text size 1x / 1.5x / 2x,
a high-contrast theme, one-hand mode (trays slide toward that hand), how long a
look takes to count (0.8 / 1.2 / 2 s) and turning look-to-choose off. Each one
is a button you can pinch or look at, and a phrase you can say ("bigger text",
"high contrast", "left handed", "slower gaze", "gaze off"). The look-to-choose
switch itself ignores looks, so nobody can switch off the only input they have
by accident. Settings are kept on the device.

The first visit starts a guide, one line at a time on the caption strip:
pick a card, give it a tray, say something, press Done. Each line waits for you
to do the thing, so it is never a wall of text. Doing a later step early skips
ahead. Say "skip" to leave it or "help" for the list of phrases.

Tests: `npm test` (vitest - the sort model, dwell timing, save/load, the voice parser, the plant, settings, the guide).

## Run it

```
npm install
npm run dev:runtime   # plain Vite dev server
npm run build         # static build in dist/
```

Built with AI assistance (Anthropic's Claude) for code and copy. MIT licence.

## Demo video

`video/` records the demo in Meta's IWER emulator (hands mode) with Playwright: `narrate.py`
writes the narration and the user's spoken lines (synthetic voices), `record.mjs` drives the
real input paths - head-gaze dwell, a hand ray with pinch, and the microphone (each user line
is played into the mic and goes through Whisper and Llama on the Worker) - and `mux.py` lays
the audio over the recording.
