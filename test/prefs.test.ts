import { describe, expect, it } from 'vitest';
import { Guide, GUIDE_STEPS } from '../src/guide.js';
import { loadPrefs, Prefs, rowMax, savePrefs, trayLayout } from '../src/prefs.js';
import { parseUtterance } from '../src/voice.js';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    raw: m,
  };
}

describe('Prefs', () => {
  it('steps text size and look time within their lists, and cycles from a button', () => {
    const p = new Prefs();
    expect(p.apply({ key: 'text', step: 1 })).toBe('Text size 1.5x');
    p.apply({ key: 'text', step: 1 });
    p.apply({ key: 'text', step: 1 });
    expect(p.text).toBe(2);
    p.apply({ key: 'text', cycle: true });
    expect(p.text).toBe(1);
    p.apply({ key: 'dwell', step: -1 });
    p.apply({ key: 'dwell', step: -1 });
    expect(p.dwell).toBe(0.8);
    p.apply({ key: 'hand', cycle: true });
    expect(p.hand).toBe('left');
    expect(p.apply({ key: 'contrast', cycle: true })).toBe('High contrast on');
    expect(p.apply({ key: 'gaze', value: false })).toBe('Look to choose off');
  });

  it('survives a reload and ignores bad fields one by one', () => {
    const s = memoryStorage();
    const p = new Prefs();
    p.apply({ key: 'text', step: 1 });
    p.apply({ key: 'contrast', value: true });
    p.guided = true;
    expect(savePrefs(p, s)).toBe(true);
    const back = loadPrefs(s);
    expect(back.toJSON()).toEqual(p.toJSON());
    s.setItem('loose-ends:prefs:v1', JSON.stringify({ v: 1, text: 7, contrast: true, hand: 'up', gaze: 'no' }));
    const odd = loadPrefs(s);
    expect([odd.text, odd.contrast, odd.hand, odd.gaze]).toEqual([1, true, 'both', true]);
    s.setItem('loose-ends:prefs:v1', '{not json');
    expect(loadPrefs(s).toJSON()).toEqual(new Prefs().toJSON());
    expect(loadPrefs(undefined).text).toBe(1);
    expect(savePrefs(p, { setItem: () => { throw new Error('quota'); } })).toBe(false);
  });

  it('keeps big text within reach and moves trays for one hand', () => {
    expect([1, 1.5, 2].map(rowMax)).toEqual([4, 3, 2]);
    expect(trayLayout('both').shift).toBe(0);
    expect(trayLayout('left').shift).toBeLessThan(0);
    expect(trayLayout('right').shift).toBeGreaterThan(0);
  });
});

describe('Guide', () => {
  it('walks select, send, capture, done and then gets out of the way', () => {
    const g = new Guide();
    expect(g.text).toBe(GUIDE_STEPS[0].text);
    expect(g.on('capture')).toBe(true); // talking first skips ahead
    expect(g.text).toBe(GUIDE_STEPS[3].text);
    expect(g.on('select')).toBe(false);
    expect(g.on('done')).toBe(true);
    expect(g.active).toBe(false);
    expect(g.text).toBeNull();
    g.restart();
    expect(g.on('send')).toBe(true); // a drag straight into a tray covers select too
    expect(g.text).toBe(GUIDE_STEPS[2].text);
    g.skip();
    expect(g.active).toBe(false);
  });
});

describe('settings by voice', () => {
  const cards = [{ id: 1, text: 'Call the dentist', tray: null }];
  it.each([
    ['bigger text', { kind: 'pref', change: { key: 'text', step: 1 } }],
    ['make it smaller', { kind: 'pref', change: { key: 'text', step: -1 } }],
    ['High contrast.', { kind: 'pref', change: { key: 'contrast', value: true } }],
    ['contrast off', { kind: 'pref', change: { key: 'contrast', value: false } }],
    ['left handed mode', { kind: 'pref', change: { key: 'hand', value: 'left' } }],
    ['both hands', { kind: 'pref', change: { key: 'hand', value: 'both' } }],
    ['slower gaze', { kind: 'pref', change: { key: 'dwell', step: 1 } }],
    ['turn off looking', { kind: 'pref', change: { key: 'gaze', value: false } }],
    ['open settings', { kind: 'settings', open: true }],
    ['Close settings', { kind: 'settings', open: false }],
    ['What can I say?', { kind: 'help' }],
    ['skip the tutorial', { kind: 'skip' }],
  ])('%s', (said, want) => {
    expect(parseUtterance(said, cards as never)).toEqual(want);
  });

  it('does not swallow ordinary thoughts', () => {
    expect(parseUtterance('buy a bigger suitcase', cards as never).kind).toBe('capture');
    expect(parseUtterance('dentist to tomorrow', cards as never)).toEqual({ kind: 'move', cardId: 1, tray: 'tomorrow' });
  });
});
