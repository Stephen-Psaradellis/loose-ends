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
