// Loose Ends - comfort settings. Pure logic: every setting can be changed by a
// pinch on its button, a gaze dwell on it, or a spoken phrase, and all three
// land here (Accessibility Forward: "inclusive by default").

export const TEXT_SIZES = [1, 1.5, 2] as const;
export const DWELL_TIMES = [0.8, 1.2, 2] as const;
export const HANDS = ['both', 'left', 'right'] as const;
/** Scene brightness: dims every surface for a dark room (VRC.Quest.Accessibility.5). */
export const BRIGHTNESS = [0.5, 0.75, 1] as const;
/** Degrees the desk turns to the viewer's right (negative: left), so no neck turn is needed (VRC.Quest.Accessibility.7). */
export const TURNS = [-60, -30, 0, 30, 60] as const;

export type Hand = (typeof HANDS)[number];
export type PrefKey = 'text' | 'contrast' | 'hand' | 'dwell' | 'gaze' | 'sound' | 'bright' | 'turn';

/** A change from any input: step through a list, or set a value outright. */
export type PrefChange =
  | { key: StepKey; step: 1 | -1 }
  | { key: 'turn'; value: 0 }
  | { key: 'contrast' | 'gaze' | 'sound'; value: boolean }
  | { key: 'hand'; value: Hand }
  | { key: PrefKey; cycle: true };

type StepKey = 'text' | 'dwell' | 'bright' | 'turn';
const STEP_LISTS: Record<StepKey, readonly number[]> = { text: TEXT_SIZES, dwell: DWELL_TIMES, bright: BRIGHTNESS, turn: TURNS };

function stepIn<T>(list: readonly T[], current: T, step: number, wrap: boolean): T {
  const i = Math.max(0, list.indexOf(current));
  const j = wrap ? (i + step + list.length) % list.length : Math.min(list.length - 1, Math.max(0, i + step));
  return list[j];
}

export class Prefs {
  text: number = 1;
  contrast = false;
  hand: Hand = 'both';
  dwell: number = 1.2;
  gaze = true;
  /** Sound cues: a different tone per tray, so where a card went is heard as well as seen. */
  sound = true;
  bright: number = 1;
  turn: number = 0;
  /** The first-visit guide has been finished or skipped. */
  guided = false;

  /** Apply a change and return the caption that confirms it. */
  apply(c: PrefChange): string {
    if ('cycle' in c) {
      if (c.key in STEP_LISTS) {
        const k = c.key as StepKey;
        this[k] = stepIn(STEP_LISTS[k], this[k], 1, true);
      } else if (c.key === 'hand') this.hand = stepIn(HANDS, this.hand, 1, true);
      else this[c.key as 'contrast' | 'gaze' | 'sound'] = !this[c.key as 'contrast' | 'gaze' | 'sound'];
    } else if ('step' in c) {
      this[c.key] = stepIn(STEP_LISTS[c.key], this[c.key], c.step, false);
    } else if (c.key === 'hand') this.hand = c.value;
    else if (c.key === 'turn') this.turn = c.value;
    else this[c.key] = c.value;
    return this.label(c.key);
  }

  /** What a settings button shows, and what the caption says after a change. */
  label(key: PrefKey): string {
    switch (key) {
      case 'text':
        return `Text size ${this.text}x`;
      case 'contrast':
        return `High contrast ${this.contrast ? 'on' : 'off'}`;
      case 'hand':
        return this.hand === 'both' ? 'Trays: centred' : `Trays: ${this.hand} hand`;
      case 'dwell':
        return `Look time ${this.dwell} s`;
      case 'gaze':
        return `Look to choose ${this.gaze ? 'on' : 'off'}`;
      case 'sound':
        return `Sounds ${this.sound ? 'on' : 'off'}`;
      case 'bright':
        return `Brightness ${Math.round(this.bright * 100)}%`;
      case 'turn':
        return this.turn === 0 ? 'Desk: straight ahead' : `Desk turned ${Math.abs(this.turn)} degrees ${this.turn > 0 ? 'right' : 'left'}`;
    }
  }

  toJSON(): SavedPrefs {
    const { text, contrast, hand, dwell, gaze, sound, bright, turn, guided } = this;
    return { v: 1, text, contrast, hand, dwell, gaze, sound, bright, turn, guided };
  }

  /** Anything unknown or out of range falls back to its default, field by field. */
  static from(data: unknown): Prefs {
    const p = new Prefs();
    if (!data || typeof data !== 'object' || (data as { v?: unknown }).v !== 1) return p;
    const d = data as Partial<SavedPrefs>;
    if ((TEXT_SIZES as readonly unknown[]).includes(d.text)) p.text = d.text as number;
    if ((DWELL_TIMES as readonly unknown[]).includes(d.dwell)) p.dwell = d.dwell as number;
    if ((HANDS as readonly unknown[]).includes(d.hand)) p.hand = d.hand as Hand;
    if (typeof d.contrast === 'boolean') p.contrast = d.contrast;
    if (typeof d.gaze === 'boolean') p.gaze = d.gaze;
    if (typeof d.sound === 'boolean') p.sound = d.sound;
    if ((BRIGHTNESS as readonly unknown[]).includes(d.bright)) p.bright = d.bright as number;
    if ((TURNS as readonly unknown[]).includes(d.turn)) p.turn = d.turn as number;
    if (typeof d.guided === 'boolean') p.guided = d.guided;
    return p;
  }
}

export interface SavedPrefs {
  v: 1;
  text: number;
  contrast: boolean;
  hand: Hand;
  dwell: number;
  gaze: boolean;
  /** Absent in saves made before sound cues existed; those load with sound on. */
  sound?: boolean;
  /** Absent in older saves; those load at full brightness, facing ahead. */
  bright?: number;
  turn?: number;
  guided: boolean;
}

const STORE_KEY = 'loose-ends:prefs:v1';

export function loadPrefs(storage: Pick<Storage, 'getItem'> | undefined): Prefs {
  try {
    const raw = storage?.getItem(STORE_KEY);
    return Prefs.from(raw ? JSON.parse(raw) : null);
  } catch {
    return new Prefs();
  }
}

export function savePrefs(prefs: Prefs, storage: Pick<Storage, 'setItem'> | undefined): boolean {
  try {
    if (!storage) return false;
    storage.setItem(STORE_KEY, JSON.stringify(prefs.toJSON()));
    return true;
  } catch {
    return false;
  }
}

/** Cards per row at a text size, so a big-text desk stays within arm's reach. */
export function rowMax(text: number): number {
  return text >= 2 ? 2 : text >= 1.5 ? 3 : 4;
}

/** The layout is built for a seated head at this height (m). */
export const SEATED_HEAD_Y = 1.2;

/**
 * How far (m) to lift the whole scene so a standing viewer sees it as a seated one
 * does: head height above the seated design, clamped to 0..0.5. A reading under
 * 0.3 m is tracking that has not settled yet, so it lifts nothing.
 */
export function sceneLift(headY: number): number {
  if (!Number.isFinite(headY) || headY < 0.3) return 0;
  return Math.min(0.5, Math.max(0, headY - SEATED_HEAD_Y));
}

/**
 * Settles the scene lift. The first value comes `settle` s into XR (the first frames still
 * carry the flat-screen camera); after that it re-fits only when the head stays `step` m
 * off the current fit for `hold` s - the viewer stood up or sat down - and never mid-grab.
 */
export class HeightFit {
  lift: number | null = null;
  private t = 0;
  private off = 0;
  constructor(readonly settle = 0.5, readonly step = 0.15, readonly hold = 1.5) {}
  reset(): void {
    this.lift = null;
    this.t = this.off = 0;
  }
  /** The new lift when it changes, else null. */
  update(dt: number, headY: number, busy = false): number | null {
    this.t += dt;
    const want = sceneLift(headY);
    if (this.lift == null) {
      if (this.t < this.settle || !(headY >= 0.3)) return null;
      return (this.lift = want);
    }
    if (busy || Math.abs(want - this.lift) < this.step) {
      this.off = 0;
      return null;
    }
    this.off += dt;
    if (this.off < this.hold) return null;
    this.off = 0;
    return (this.lift = want);
  }
}

/** Sideways shift (m) and spacing of the trays for one-hand use. */
export function trayLayout(hand: Hand): { shift: number; gap: number } {
  if (hand === 'both') return { shift: 0, gap: 0.36 };
  return { shift: hand === 'left' ? -0.1 : 0.1, gap: 0.31 };
}
