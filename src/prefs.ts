// Loose Ends - comfort settings. Pure logic: every setting can be changed by a
// pinch on its button, a gaze dwell on it, or a spoken phrase, and all three
// land here (Accessibility Forward: "inclusive by default").

export const TEXT_SIZES = [1, 1.5, 2] as const;
export const DWELL_TIMES = [0.8, 1.2, 2] as const;
export const HANDS = ['both', 'left', 'right'] as const;

export type Hand = (typeof HANDS)[number];
export type PrefKey = 'text' | 'contrast' | 'hand' | 'dwell' | 'gaze';

/** A change from any input: step through a list, or set a value outright. */
export type PrefChange =
  | { key: 'text' | 'dwell'; step: 1 | -1 }
  | { key: 'contrast' | 'gaze'; value: boolean }
  | { key: 'hand'; value: Hand }
  | { key: PrefKey; cycle: true };

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
  /** The first-visit guide has been finished or skipped. */
  guided = false;

  /** Apply a change and return the caption that confirms it. */
  apply(c: PrefChange): string {
    if ('cycle' in c) {
      if (c.key === 'text' || c.key === 'dwell') {
        const list = c.key === 'text' ? TEXT_SIZES : DWELL_TIMES;
        this[c.key] = stepIn(list, this[c.key] as (typeof list)[number], 1, true);
      } else if (c.key === 'hand') this.hand = stepIn(HANDS, this.hand, 1, true);
      else this[c.key] = !this[c.key];
    } else if ('step' in c) {
      const list = c.key === 'text' ? TEXT_SIZES : DWELL_TIMES;
      this[c.key] = stepIn(list, this[c.key] as (typeof list)[number], c.step, false);
    } else if (c.key === 'hand') this.hand = c.value;
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
    }
  }

  toJSON(): SavedPrefs {
    const { text, contrast, hand, dwell, gaze, guided } = this;
    return { v: 1, text, contrast, hand, dwell, gaze, guided };
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

/** Sideways shift (m) and spacing of the trays for one-hand use. */
export function trayLayout(hand: Hand): { shift: number; gap: number } {
  if (hand === 'both') return { shift: 0, gap: 0.36 };
  return { shift: hand === 'left' ? -0.1 : 0.1, gap: 0.31 };
}
