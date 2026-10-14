/** The plant on the shelf: one leaf for each evening that ended with "Done" (Reason to Come Back). */
export const MAX_LEAVES = 12;

export class Garden {
  constructor(
    public evenings = 0,
    public lastDay: string | null = null,
  ) {}

  /** Leaves showing; the plant stops growing at MAX_LEAVES and then flowers. */
  get leaves(): number {
    return Math.min(this.evenings, MAX_LEAVES);
  }

  get flowering(): boolean {
    return this.evenings > MAX_LEAVES;
  }

  /** Close an evening. A second "Done" the same day does not grow it again. */
  close(day: string): boolean {
    if (day === this.lastDay) return false;
    this.evenings += 1;
    this.lastDay = day;
    return true;
  }

  toJSON(): SavedGarden {
    return { v: 1, evenings: this.evenings, lastDay: this.lastDay };
  }

  static from(data: unknown): Garden | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Partial<SavedGarden>;
    if (d.v !== 1 || typeof d.evenings !== 'number' || !Number.isInteger(d.evenings) || d.evenings < 0) return null;
    if (d.lastDay !== null && typeof d.lastDay !== 'string') return null;
    return new Garden(d.evenings, d.lastDay ?? null);
  }
}

export interface SavedGarden {
  v: 1;
  evenings: number;
  lastDay: string | null;
}

const STORE_KEY = 'loose-ends:garden:v1';

/** The viewer's own calendar day, so an evening is theirs and not UTC's. */
export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function loadGarden(storage: Pick<Storage, 'getItem'> | undefined): Garden {
  try {
    const raw = storage?.getItem(STORE_KEY);
    return (raw && Garden.from(JSON.parse(raw))) || new Garden();
  } catch {
    return new Garden();
  }
}

export function saveGarden(garden: Garden, storage: Pick<Storage, 'setItem'> | undefined): boolean {
  try {
    if (!storage) return false;
    storage.setItem(STORE_KEY, JSON.stringify(garden.toJSON()));
    return true;
  } catch {
    return false;
  }
}
