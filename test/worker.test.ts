import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS Worker module, no types
import { cleanCards, modelText, parseJson } from '../worker/src/worker.js';

describe('voice Worker card split', () => {
  it('reads both Workers AI answer shapes', () => {
    expect(modelText({ response: { cards: [] } })).toEqual({ cards: [] });
    expect(modelText({ choices: [{ message: { content: '{"cards":[]}' } }] })).toBe('{"cards":[]}');
    expect(modelText({})).toBeNull();
  });

  it('parses JSON text or objects, and garbage to null', () => {
    expect(parseJson('here: {"cards":[{"text":"Call Sam","tray":null}]}')).toEqual({ cards: [{ text: 'Call Sam', tray: null }] });
    expect(parseJson('{not json}')).toBeNull();
    expect(parseJson(null)).toBeNull();
  });

  it('keeps well-formed cards only', () => {
    expect(cleanCards({ cards: [{ text: ' Call  the dentist. ', tray: 'tomorrow' }, { text: '', tray: null }, { text: 'x'.repeat(61) }, { text: 'Text Sam', tray: 'someday' }] })).toEqual([
      { text: 'Call the dentist', tray: 'tomorrow' },
      { text: 'Text Sam', tray: null },
    ]);
    expect(cleanCards({ nope: 1 })).toBeNull();
    expect(cleanCards({ cards: Array(10).fill({ text: 'A' }) })).toHaveLength(8);
  });
});
