// Loose Ends - the voice rules parser. Pure logic, no network: it turns one
// transcript into either a command on the sort or new cards. It is the whole
// voice path when the Worker is unreachable, and the command path always
// (commands never wait on a model).

import type { Card, TrayId } from './sort.js';

export type Utterance =
  | { kind: 'undo' }
  | { kind: 'done' }
  | { kind: 'select'; cardId: number }
  | { kind: 'move'; cardId: number; tray: TrayId }
  /** Just a tray ("let it go"): goes to the selected card. */
  | { kind: 'tray'; tray: TrayId }
  | { kind: 'capture'; cards: { text: string; trayHint: TrayId | null }[] }
  | { kind: 'empty' };

// Longest phrases first, so "let it go" wins over "go".
const TRAY_WORDS: readonly [RegExp, TrayId][] = [
  [/\b(?:let (?:it|that|them) go|let go|forget (?:it|about it)|drop it|bin it|the bin)$/, 'letgo'],
  [/\b(?:later )?this week$|\b(?:the )?week$|\blater$/, 'week'],
  [/\b(?:tomorrow|tmrw|in the morning)$/, 'tomorrow'],
];

const UNDO = /^(?:undo|undo that|take (?:that|it) back|go back|oops)$/;
const DONE = /^(?:(?:i'?m|i am|we'?re) (?:all )?done|that'?s (?:it|all)|done|finish(?:ed)?|all done)$/;
const FILLER = /^(?:um+|uh+|er+|so|okay|ok|well|and|also|plus|oh)\b[\s,]*/;
const LEAD_IN =
  /^(?:i (?:really )?(?:need|have|want|ought|got) to|i'?ve got to|i gotta|i should(?: probably)?|i must|remember to|don'?t forget to|i have to remember to|need to|have to|gotta|should)\s+/;

// Words that point at a card without naming it ("the dentist one").
const STOP = new Set(['the', 'a', 'an', 'to', 'my', 'of', 'for', 'and', 'in', 'on', 'with', 'that', 'it', 'this', 'one', 'thing', 'card', 'about']);

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  return norm(text)
    .split(' ')
    .filter((w) => w && !STOP.has(w));
}

/** How well a spoken reference names a card: 0..1, share of the card's words heard (prefix-tolerant). */
export function matchScore(ref: string, cardText: string): number {
  const said = words(ref);
  const card = words(cardText);
  if (!said.length || !card.length) return 0;
  const hit = (w: string) => said.some((s) => s === w || (s.length >= 4 && (w.startsWith(s) || s.startsWith(w))));
  const covered = card.filter(hit).length / card.length;
  const precise = said.filter((s) => card.some((w) => s === w || (s.length >= 4 && (w.startsWith(s) || s.startsWith(w))))).length / said.length;
  return Math.min(covered + 0.25, 1) * precise;
}

/** Best card for a spoken reference, loose cards preferred on ties; null under the threshold. */
export function findCard(ref: string, cards: readonly Card[], threshold = 0.5): Card | null {
  let best: Card | null = null;
  let bestScore = threshold;
  for (const c of cards) {
    const s = matchScore(ref, c.text) + (c.tray === null ? 0.01 : 0);
    if (s >= bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

/** Split the trailing tray phrase off: "groceries to tomorrow" -> ["groceries", 'tomorrow']. */
export function splitTray(text: string): [string, TrayId | null] {
  const t = norm(text);
  for (const [re, tray] of TRAY_WORDS) {
    const m = t.match(re);
    if (m && m.index !== undefined) {
      const rest = t
        .slice(0, m.index)
        .replace(/\s*\b(?:to|into|in|for|onto|on|goes|go|put|move)\s*$/, '')
        .replace(/\s*\b(?:to|into|in|for|onto|on|goes|go)\s*$/, '')
        .trim();
      return [rest, tray];
    }
  }
  return [t, null];
}

function cleanCard(text: string): string {
  let t = norm(text);
  for (let i = 0; i < 3; i++) t = t.replace(FILLER, '').replace(LEAD_IN, '');
  t = t.replace(/^(?:put|move)\s+/, '').trim();
  if (!t) return '';
  const capped = t.length > 60 ? t.slice(0, 60).replace(/\s+\S*$/, '') : t;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

/** Break a ramble into separate thoughts. Plain "and" splits only between two clauses of 2+ words. */
export function splitThoughts(text: string): string[] {
  const parts = text
    .replace(/[’]/g, "'")
    .split(/[.;!?\n]+|,\s*(?:and\s+)?|\s+(?:and then|and also|also|plus|then|oh and)\s+/i)
    .flatMap((p) => {
      const halves = p.split(/\s+and\s+(?=(?:i\s+)?(?:need|have|should|call|email|text|buy|book|pay|fix|send|finish|clean|pick|ask|write|check|make|get|cancel|renew|return|order|sort|tell|remember)\b)/i);
      return halves.every((h) => h.trim().split(/\s+/).length >= 2) ? halves : [p];
    });
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Parse one transcript against the cards on the desk. */
export function parseUtterance(transcript: string, cards: readonly Card[]): Utterance {
  const t = norm(transcript).replace(/^(?:hey|ok|okay|um+|uh+)\s+/, '');
  if (!t) return { kind: 'empty' };
  if (UNDO.test(t)) return { kind: 'undo' };
  if (DONE.test(t)) return { kind: 'done' };
  const [bare, onlyTray] = splitTray(t);
  if (onlyTray && !bare) return { kind: 'tray', tray: onlyTray };

  // "<card> to <tray>" / "put <card> in <tray>" - only when the card exists already.
  // A bare tray phrase ("..., let it go") belongs to the thought before it.
  const single: string[] = [];
  for (const part of splitThoughts(transcript)) {
    const [rest, tray] = splitTray(part);
    if (tray && !rest && single.length) single[single.length - 1] += ` to ${part}`;
    else single.push(part);
  }
  if (single.length === 1) {
    const [ref, tray] = splitTray(norm(single[0]).replace(/^(?:hey|ok|okay|um+|uh+)\s+/, '').replace(/^(?:put|move|send)\s+/, ''));
    if (tray && ref) {
      const card = findCard(ref, cards);
      if (card) return { kind: 'move', cardId: card.id, tray };
    }
    // A short phrase that names a loose card selects it ("groceries").
    if (!tray && t.split(' ').length <= 4) {
      const card = findCard(t, cards.filter((c) => c.tray === null), 0.75);
      if (card) return { kind: 'select', cardId: card.id };
    }
  }

  const out: { text: string; trayHint: TrayId | null }[] = [];
  for (const part of single) {
    const [rest, tray] = splitTray(part);
    const text = cleanCard(tray ? rest : part);
    if (text && text.split(' ').length <= 12) out.push({ text, trayHint: tray });
    else if (text) out.push({ text: cleanCard(text), trayHint: tray });
  }
  return out.length ? { kind: 'capture', cards: out } : { kind: 'empty' };
}
