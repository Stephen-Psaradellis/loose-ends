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
The read-back uses the browser's own voice when it has one; when it has none
(the Quest Browser documents none), the same Worker speaks the line with Workers
AI text-to-speech (`/tts`, nothing stored) and the app plays it through Web Audio
(`src/speak.ts`; `video/probe-speak.mjs NO_VOICES=1` proves that route).

The assistant also suggests where each new card might go ("call the plumber
tomorrow" -> a card marked *suggest: Tomorrow*), but it never sorts on its own.
"Sort them for me", the Sort as suggested button, or a look at it takes every
suggestion at once, and one Undo puts them all back.

Undo and "Done for tonight" are also buttons, so every spoken command has a
pinch and a look-at-it twin. Done reads back tomorrow's cards and grows the
plant on the shelf by one leaf - once per evening, kept on the device - until it
flowers after twelve evenings.

The next evening opens with yesterday's plan: the Tomorrow cards come back to the
desk marked "yesterday's plan - happened?", Let it go cards are gone, This week
stays put. Pick a card (pinch, look, or its name) and press "It happened", or just
say "I did the groceries" / "call mum happened"; it leaves the desk with a bright
two-note cue. A card that did not happen can go straight back into a tray, and
whatever is left when you say "I'm done" stays on the desk. Undo covers check-offs.

Settings (the button above Undo, or say "settings") cover text size 1x / 1.5x / 2x,
a high-contrast theme, one-hand mode (trays slide toward that hand), how long a
look takes to count (0.8 / 1.2 / 2 s), turning look-to-choose off, sound cues
on or off, brightness (100 / 75 / 50 %, for a dark room) and turning the whole desk
30 or 60 degrees left or right so it comes to you without a neck turn. Each one is a
button you can pinch or look at, and a phrase you can say ("bigger text", "high
contrast", "left handed", "slower gaze", "gaze off", "mute", "dimmer", "turn right",
"face me"). The look-to-choose
switch itself ignores looks, so nobody can switch off the only input they have
by accident. Settings are kept on the device.

Checked against Meta's accessibility VRCs (VRC.Quest.Accessibility.1-9): sound
optional and captioned (.1, .3), text to 2x (.2), one hand and no controller (.4),
brightness and contrast (.5), trays named, not colour-coded alone (.6), desk turn
(.7), no locomotion needed (.8), seated or standing (.9). `video/probe-a11y.mjs`
checks .5 and .7 in Chromium under IWER.

Sound cues: every act also plays a short tone, made on the device with Web Audio
(no files, nothing sent). Each tray has its own: Tomorrow rises, This week holds
one note, Let it go falls away - so where a card went can be heard, not only seen.
Select, Undo, Done, the plant's new leaf and the voice orb have cues too, all
under the read-back voice. `video/probe-sound.mjs` lists the tones each act
schedules in a real browser.

The first visit starts a guide, one line at a time on the caption strip:
pick a card, give it a tray, say something, press Done. Each line waits for you
to do the thing, so it is never a wall of text. Doing a later step early skips
ahead. Say "skip" to leave it or "help" for the list of phrases.

Tests: `npm test` (vitest - the sort model, dwell timing, save/load, the voice parser, the plant, yesterday's-plan review, settings, the guide).

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
