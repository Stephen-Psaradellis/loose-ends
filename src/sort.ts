// Loose Ends - the sort model. Pure logic, no three.js, so every input path
// (pinch-drag, voice, head-gaze dwell) drives the same state and tests can pin it.

export type TrayId = 'tomorrow' | 'week' | 'letgo';

export const TRAYS: readonly { id: TrayId; label: string }[] = [
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'week', label: 'This week' },
  { id: 'letgo', label: 'Let it go' },
];

export interface Card {
  id: number;
  text: string;
  tray: TrayId | null;
  /** The assistant's suggested tray, shown on a loose card until the user sorts it. */
  hint: TrayId | null;
  /** On yesterday's plan, waiting for "did it happen?" (Reason to Come Back). */
  review: boolean;
}

/** One card's change. A checked-off card leaves the sort; undo puts it back where it was. */
type Move = { cardId: number; from: TrayId | null; review: boolean; removed?: { card: Card; at: number } };

/** What a new evening found: yesterday's plan to review, and let-go cards that dissolved overnight. */
export interface Rollover {
  review: number;
  released: number;
}

export class Sort {
  readonly cards: Card[] = [];
  /** One entry per user act: a single move, or every card a 'sort as suggested' moved. */
  private undoStack: Move[][] = [];
  private nextId = 1;
  /** The day the last evening ended with Done; the next day opens with its plan. */
  closedDay: string | null = null;

  add(text: string, hint: TrayId | null = null): Card {
    const card: Card = { id: this.nextId++, text: text.trim(), tray: null, hint, review: false };
    this.cards.push(card);
    return card;
  }

  get(id: number): Card | undefined {
    return this.cards.find((c) => c.id === id);
  }

  /** Put a card in a tray (or back to loose with null). Returns false if nothing changed. */
  send(id: number, tray: TrayId | null): boolean {
    const card = this.get(id);
    if (!card || card.tray === tray) return false;
    this.undoStack.push([{ cardId: id, from: card.tray, review: card.review }]);
    card.tray = tray;
    // Sorting a plan card again is an answer too: it did not happen, and now has a new home.
    card.review = false;
    return true;
  }

  /** Loose cards that carry a suggestion. */
  get hinted(): Card[] {
    return this.cards.filter((c) => c.tray === null && c.hint !== null);
  }

  /** Sort every hinted loose card into its suggested tray, as ONE undoable act. */
  acceptHints(): Card[] {
    const moved = this.hinted;
    if (!moved.length) return [];
    this.undoStack.push(moved.map((c) => ({ cardId: c.id, from: c.tray, review: c.review })));
    moved.forEach((c) => {
      c.tray = c.hint;
      c.review = false;
    });
    return moved;
  }

  /** Cards from yesterday's plan still waiting for an answer. */
  get reviewing(): Card[] {
    return this.cards.filter((c) => c.review);
  }

  /** Mark the evening closed (Done). */
  close(day: string): void {
    this.closedDay = day;
  }

  /**
   * Open a new evening. Only after a Done on an earlier day: let-go cards dissolve, and
   * yesterday's Tomorrow tray comes back loose as the plan to review ("which happened?"),
   * each suggesting Tomorrow again in case it did not. This week stays where it is.
   */
  rollover(today: string): Rollover {
    if (!this.closedDay || this.closedDay >= today) return { review: 0, released: 0 };
    const released = this.inTray('letgo').length;
    this.cards.splice(0, this.cards.length, ...this.cards.filter((c) => c.tray !== 'letgo'));
    const plan = this.inTray('tomorrow');
    plan.forEach((c) => {
      c.tray = null;
      c.hint = 'tomorrow';
      c.review = true;
    });
    this.closedDay = null;
    this.undoStack = [];
    return { review: plan.length, released };
  }

  /** "It happened": a plan card leaves the desk. Undo brings it back. */
  checkOff(id: number): Card | undefined {
    const at = this.cards.findIndex((c) => c.id === id && c.review);
    if (at < 0) return undefined;
    const [card] = this.cards.splice(at, 1);
    this.undoStack.push([{ cardId: id, from: card.tray, review: true, removed: { card, at } }]);
    return card;
  }

  /** Stop reviewing: what was not checked off stays on the desk as ordinary loose cards. */
  endReview(): Card[] {
    const left = this.reviewing;
    left.forEach((c) => (c.review = false));
    return left;
  }

  /** Reverse the last act; every card it moved goes back. */
  undoAll(): Card[] {
    const act = this.undoStack.pop() ?? [];
    const back: Card[] = [];
    for (const move of [...act].reverse()) {
      if (move.removed) this.cards.splice(Math.min(move.removed.at, this.cards.length), 0, move.removed.card);
      const card = this.get(move.cardId);
      if (card) {
        card.tray = move.from;
        card.review = move.review;
        back.push(card);
      }
    }
    return back;
  }

  undo(): Card | undefined {
    return this.undoAll()[0];
  }

  inTray(tray: TrayId | null): Card[] {
    return this.cards.filter((c) => c.tray === tray);
  }

  get loose(): Card[] {
    return this.inTray(null);
  }

  /** What survives a session. The undo stack does not: undo is for this evening only. */
  toJSON(): SavedSort {
    return { v: 1, nextId: this.nextId, closedDay: this.closedDay, cards: this.cards.map((c) => ({ ...c })) };
  }

  /** Rebuild from saved data; anything malformed yields null so the caller starts fresh. */
  static from(data: unknown): Sort | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Partial<SavedSort>;
    if (d.v !== 1 || !Array.isArray(d.cards) || typeof d.nextId !== 'number') return null;
    const ids = new Set(TRAYS.map((t) => t.id));
    const sort = new Sort();
    for (const c of d.cards) {
      if (!c || typeof c.id !== 'number' || typeof c.text !== 'string') return null;
      if (c.tray !== null && !ids.has(c.tray)) return null;
      // Saves from before hints existed have none; an unknown hint is dropped, not fatal.
      const hint = ids.has(c.hint as TrayId) ? (c.hint as TrayId) : null;
      sort.cards.push({ id: c.id, text: c.text, tray: c.tray, hint, review: c.review === true && c.tray === null });
    }
    // Saves from before the review loop have no closed day: they open as they were.
    sort.closedDay = typeof d.closedDay === 'string' ? d.closedDay : null;
    sort.nextId = Math.max(d.nextId, ...sort.cards.map((c) => c.id + 1), 1);
    return sort;
  }
}

export interface SavedSort {
  v: 1;
  nextId: number;
  closedDay?: string | null;
  cards: Card[];
}

const STORE_KEY = 'loose-ends:v1';

/** Load the saved sort; null when there is none, it is unreadable, or storage is blocked. */
export function loadSort(storage: Pick<Storage, 'getItem'> | undefined): Sort | null {
  try {
    const raw = storage?.getItem(STORE_KEY);
    return raw ? Sort.from(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Save the sort; returns false when storage is unavailable (private mode, quota). */
export function saveSort(sort: Sort, storage: Pick<Storage, 'setItem'> | undefined): boolean {
  try {
    if (!storage) return false;
    storage.setItem(STORE_KEY, JSON.stringify(sort.toJSON()));
    return true;
  } catch {
    return false;
  }
}

/** Which tray a released card landed over, given tray centres on the x axis. */
export function trayAt(
  x: number,
  z: number,
  trays: readonly { id: TrayId; x: number; z: number }[],
  halfWidth: number,
  halfDepth: number,
): TrayId | null {
  for (const t of trays) {
    if (Math.abs(x - t.x) <= halfWidth && Math.abs(z - t.z) <= halfDepth) {
      return t.id;
    }
  }
  return null;
}
