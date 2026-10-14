import { describe, expect, it } from 'vitest';
import { Garden, loadGarden, localDay, MAX_LEAVES, saveGarden } from '../src/garden.js';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    raw: m,
  };
}

describe('Garden', () => {
  it('grows once per evening and flowers past the last leaf', () => {
    const g = new Garden();
    expect(g.close('2026-10-14')).toBe(true);
    expect(g.close('2026-10-14')).toBe(false);
    expect(g.leaves).toBe(1);
    for (let i = 15; i < 15 + MAX_LEAVES; i++) g.close(`2026-10-${i}`);
    expect(g.leaves).toBe(MAX_LEAVES);
    expect(g.flowering).toBe(true);
  });

  it('round-trips through storage and starts fresh on junk or a blocked store', () => {
    const s = memoryStorage();
    const g = new Garden();
    g.close('2026-10-14');
    expect(saveGarden(g, s)).toBe(true);
    expect(loadGarden(s).toJSON()).toEqual({ v: 1, evenings: 1, lastDay: '2026-10-14' });
    s.raw.set('loose-ends:garden:v1', '{"v":1,"evenings":-3,"lastDay":null}');
    expect(loadGarden(s).evenings).toBe(0);
    s.raw.set('loose-ends:garden:v1', 'not json');
    expect(loadGarden(s).evenings).toBe(0);
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadGarden(blocked).evenings).toBe(0);
    expect(saveGarden(g, blocked)).toBe(false);
  });

  it('names the local calendar day', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
