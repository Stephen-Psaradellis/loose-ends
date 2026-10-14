import { describe, expect, it } from 'vitest';
import type { Card } from '../src/sort.js';
import { findCard, groundedCards, parseUtterance, splitThoughts, splitTray } from '../src/voice.js';

const desk: Card[] = [
  { id: 1, text: 'Buy groceries', tray: null, hint: null },
  { id: 2, text: 'Call mum about Sunday', tray: null, hint: null },
  { id: 3, text: 'Renew car insurance', tray: 'week', hint: null },
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

describe('grounded LLM card split', () => {
  const said = "um I need to call the dentist and renew the car insurance, oh and pick up dry cleaning tomorrow";

  it('takes the model cards when every card was said', () => {
    const ai = [
      { text: 'Call the dentist', tray: null },
      { text: 'Renew car insurance', tray: null },
      { text: 'Pick up dry cleaning', tray: 'tomorrow' },
    ];
    expect(parseUtterance(said, [], ai)).toEqual({
      kind: 'capture',
      cards: [
        { text: 'Call the dentist', trayHint: null },
        { text: 'Renew car insurance', trayHint: null },
        { text: 'Pick up dry cleaning', trayHint: 'tomorrow' },
      ],
    });
  });

  it('rejects the whole set when one card is invented', () => {
    const ai = [{ text: 'Call the dentist', tray: null }, { text: 'Book flights to Rome', tray: null }];
    expect(groundedCards(ai, said)).toBeNull();
    const u = parseUtterance(said, [], ai);
    expect(u.kind).toBe('capture');
    expect(u.kind === 'capture' && u.cards.map((c) => c.text)).not.toContain('Book flights to Rome');
  });

  it('ignores junk, empty and oversize answers', () => {
    expect(groundedCards(null, said)).toBeNull();
    expect(groundedCards([], said)).toBeNull();
    expect(groundedCards([{ text: 42 }], said)).toBeNull();
    expect(groundedCards(Array(9).fill({ text: 'Call the dentist' }), said)).toBeNull();
    expect(groundedCards([{ text: 'Call the dentist', tray: 'someday' }], said)).toEqual([{ text: 'Call the dentist', trayHint: null }]);
  });

  it('never lets the model override a command', () => {
    expect(parseUtterance('undo', [], [{ text: 'Undo', tray: null }])).toEqual({ kind: 'undo' });
    expect(parseUtterance('groceries to tomorrow', desk, [{ text: 'Groceries', tray: 'tomorrow' }])).toEqual({
      kind: 'move',
      cardId: 1,
      tray: 'tomorrow',
    });
  });
});

describe('accepting suggestions by voice', () => {
  it('hears the accept phrases as one command, not as new cards', () => {
    for (const said of ['Sort them for me.', 'yes, sort them', 'use the suggestions', 'go with your suggestion', 'sort as suggested', 'do what you suggested please', 'okay sort everything for me']) {
      expect(parseUtterance(said, desk)).toEqual({ kind: 'accept' });
    }
  });

  it('leaves real thoughts that mention sorting alone', () => {
    expect(parseUtterance('sort the recycling', desk).kind).toBe('capture');
    expect(parseUtterance('sort out the tax letters this week', desk).kind).toBe('capture');
  });
});
