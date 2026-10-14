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
}

type Move = { cardId: number; from: TrayId | null };

export class Sort {
  readonly cards: Card[] = [];
  private undoStack: Move[] = [];
  private nextId = 1;

  add(text: string): Card {
    const card: Card = { id: this.nextId++, text: text.trim(), tray: null };
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
    this.undoStack.push({ cardId: id, from: card.tray });
    card.tray = tray;
    return true;
  }

  undo(): Card | undefined {
    const move = this.undoStack.pop();
    if (!move) return undefined;
    const card = this.get(move.cardId);
    if (card) card.tray = move.from;
    return card;
  }

  inTray(tray: TrayId | null): Card[] {
    return this.cards.filter((c) => c.tray === tray);
  }

  get loose(): Card[] {
    return this.inTray(null);
  }

  /** What survives a session. The undo stack does not: undo is for this evening only. */
  toJSON(): SavedSort {
    return { v: 1, nextId: this.nextId, cards: this.cards.map((c) => ({ ...c })) };
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
      sort.cards.push({ id: c.id, text: c.text, tray: c.tray });
    }
    sort.nextId = Math.max(d.nextId, ...sort.cards.map((c) => c.id + 1), 1);
    return sort;
  }
}

export interface SavedSort {
  v: 1;
  nextId: number;
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
