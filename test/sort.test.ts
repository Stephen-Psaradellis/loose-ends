import { describe, expect, it } from 'vitest';
import { Dwell } from '../src/dwell.js';
import { loadSort, saveSort, Sort, trayAt, TRAYS } from '../src/sort.js';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    raw: m,
  };
}

describe('Sort', () => {
  it('sends, reports no-op moves, and undoes in order', () => {
    const s = new Sort();
    const a = s.add('  Call the dentist ');
    const b = s.add('Fix the bike light');
    expect(a.text).toBe('Call the dentist');
    expect(s.send(a.id, 'tomorrow')).toBe(true);
    expect(s.send(a.id, 'tomorrow')).toBe(false);
    s.send(b.id, 'letgo');
    s.send(a.id, 'week');
    expect(s.inTray('week').map((c) => c.id)).toEqual([a.id]);
    expect(s.undo()?.id).toBe(a.id);
    expect(a.tray).toBe('tomorrow');
    s.undo();
    s.undo();
    expect(s.loose.length).toBe(2);
    expect(s.undo()).toBeUndefined();
  });

  it('finds the tray a card was dropped over', () => {
    const trays = TRAYS.map((t, i) => ({ id: t.id, x: (i - 1) * 0.36, z: -0.5 }));
    expect(trayAt(0.36, -0.5, trays, 0.18, 0.19)).toBe('letgo');
    expect(trayAt(-0.3, -0.45, trays, 0.18, 0.19)).toBe('tomorrow');
    expect(trayAt(0.18, -0.5, trays, 0.17, 0.19)).toBeNull(); // the gap between trays
  });
});

describe('save and load', () => {
  it('round-trips cards and keeps ids unique after reload', () => {
    const st = memoryStorage();
    const s = new Sort();
    const a = s.add('Call the dentist');
    s.add('Fix the bike light');
    s.send(a.id, 'tomorrow');
    expect(saveSort(s, st)).toBe(true);
    const back = loadSort(st)!;
    expect(back.cards).toEqual(s.cards);
    expect(back.inTray('tomorrow')[0].text).toBe('Call the dentist');
    expect(back.undo()).toBeUndefined();
    const c = back.add('New thought');
    expect(back.cards.filter((x) => x.id === c.id).length).toBe(1);
  });

  it('starts fresh on missing, corrupt or foreign data, and survives blocked storage', () => {
    const st = memoryStorage();
    expect(loadSort(st)).toBeNull();
    st.raw.set('loose-ends:v1', '{not json');
    expect(loadSort(st)).toBeNull();
    st.raw.set('loose-ends:v1', JSON.stringify({ v: 1, nextId: 2, cards: [{ id: 1, text: 'x', tray: 'someday' }] }));
    expect(loadSort(st)).toBeNull();
    expect(loadSort(undefined)).toBeNull();
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
    expect(loadSort(throwing)).toBeNull();
    expect(saveSort(new Sort(), throwing)).toBe(false);
  });
});

describe('Dwell', () => {
  it('fires once after the dwell time and not again until gaze leaves', () => {
    const d = new Dwell(1);
    expect(d.update('card:1', 0.5)).toBeNull();
    expect(d.progress).toBeCloseTo(0.5);
    expect(d.update('card:1', 0.5)).toBe('card:1');
    expect(d.update('card:1', 5)).toBeNull();
    expect(d.progress).toBe(0);
    d.update(null, 0.1);
    expect(d.update('card:1', 1)).toBe('card:1');
  });

  it('restarts the count when gaze moves to another target', () => {
    const d = new Dwell(1);
    d.update('card:1', 0.9);
    expect(d.update('tray:week', 0.2)).toBeNull();
    expect(d.progress).toBeCloseTo(0.2);
    d.reset();
    expect(d.target).toBeNull();
    expect(d.progress).toBe(0);
  });
});

describe('assistant suggestions', () => {
  it('sorts every hinted loose card as one act, and one undo puts them all back', () => {
    const s = new Sort();
    const a = s.add('Call the dentist', 'tomorrow');
    const b = s.add('Clear the garage', 'week');
    const c = s.add('No hint here');
    const d = s.add('Already sorted', 'letgo');
    s.send(d.id, 'tomorrow');
    expect(s.hinted.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(s.acceptHints().map((x) => x.id)).toEqual([a.id, b.id]);
    expect([a.tray, b.tray, c.tray, d.tray]).toEqual(['tomorrow', 'week', null, 'tomorrow']);
    expect(s.acceptHints()).toEqual([]);
    expect(s.undoAll().map((x) => x.id).sort()).toEqual([a.id, b.id]);
    expect([a.tray, b.tray, d.tray]).toEqual([null, null, 'tomorrow']);
    expect(s.undo()?.id).toBe(d.id);
  });

  it('keeps hints across a save and drops unknown ones from older saves', () => {
    const s = new Sort();
    s.add('Water the plants', 'week');
    expect(Sort.from(JSON.parse(JSON.stringify(s.toJSON())))!.cards[0].hint).toBe('week');
    const old = Sort.from({ v: 1, nextId: 3, cards: [{ id: 1, text: 'x', tray: null }, { id: 2, text: 'y', tray: null, hint: 'someday' }] });
    expect(old!.cards.map((x) => x.hint)).toEqual([null, null]);
  });
});
