import { describe, expect, it } from 'vitest';
import type { Card } from '../src/sort.js';
import { findCard, parseUtterance, splitThoughts, splitTray } from '../src/voice.js';

const desk: Card[] = [
  { id: 1, text: 'Buy groceries', tray: null },
  { id: 2, text: 'Call mum about Sunday', tray: null },
  { id: 3, text: 'Renew car insurance', tray: 'week' },
];

describe('voice rules parser', () => {
  it('reads commands', () => {
    expect(parseUtterance('Undo', desk)).toEqual({ kind: 'undo' });
    expect(parseUtterance("I'm done.", desk)).toEqual({ kind: 'done' });
    expect(parseUtterance('that’s all', desk)).toEqual({ kind: 'done' });
    expect(parseUtterance('   ', desk)).toEqual({ kind: 'empty' });
    expect(parseUtterance('Let it go.', desk)).toEqual({ kind: 'tray', tray: 'letgo' });
    expect(parseUtterance('tomorrow', desk)).toEqual({ kind: 'tray', tray: 'tomorrow' });
  });

  it('moves a named card to a tray', () => {
    expect(parseUtterance('groceries to tomorrow', desk)).toEqual({ kind: 'move', cardId: 1, tray: 'tomorrow' });
    expect(parseUtterance('put call mum in this week', desk)).toEqual({ kind: 'move', cardId: 2, tray: 'week' });
    expect(parseUtterance('insurance, let it go', desk)).toEqual({ kind: 'move', cardId: 3, tray: 'letgo' });
    expect(parseUtterance('the mum one, this week', desk)).toEqual({ kind: 'move', cardId: 2, tray: 'week' });
  });

  it('selects a loose card by a short name', () => {
    expect(parseUtterance('groceries', desk)).toEqual({ kind: 'select', cardId: 1 });
  });

  it('captures new thoughts, one card each, lead-ins stripped', () => {
    const u = parseUtterance(
      'Um, I need to email the landlord about the boiler, and also book a dentist appointment. Oh and pick up the dry cleaning tomorrow',
      desk,
    );
    expect(u).toEqual({
      kind: 'capture',
      cards: [
        { text: 'Email the landlord about the boiler', trayHint: null },
        { text: 'Book a dentist appointment', trayHint: null },
        { text: 'Pick up the dry cleaning', trayHint: 'tomorrow' },
      ],
    });
  });

  it('does not split a noun pair on and', () => {
    expect(splitThoughts('buy salt and pepper')).toEqual(['buy salt and pepper']);
    expect(splitThoughts('finish the report and call the bank')).toEqual(['finish the report', 'call the bank']);
  });

  it('an unknown card with a tray phrase is a new card with a hint, not a move', () => {
    expect(parseUtterance('water the plants tomorrow', desk)).toEqual({
      kind: 'capture',
      cards: [{ text: 'Water the plants', trayHint: 'tomorrow' }],
    });
  });

  it('splits the tray phrase and matches fuzzily', () => {
    expect(splitTray('the groceries go to later this week')).toEqual(['the groceries', 'week']);
    expect(findCard('mum', desk)?.id).toBe(2);
    expect(findCard('the boiler', desk)).toBeNull();
  });
});
