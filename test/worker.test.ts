import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS Worker module, no types
import { audioType, cleanCards, modelText, parseJson, ttsBytes } from '../worker/src/worker.js';

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

describe('tts', () => {
  it('normalises every answer shape Workers AI TTS gives to bytes', async () => {
    expect(Array.from((await ttsBytes({ audio: btoa('RIFF') }))!)).toEqual([82, 73, 70, 70]);
    expect(Array.from((await ttsBytes(new Uint8Array([1, 2])))!)).toEqual([1, 2]);
    expect(Array.from((await ttsBytes(new Uint8Array([3]).buffer))!)).toEqual([3]);
    expect(Array.from((await ttsBytes(new Response(new Uint8Array([4, 5])).body))!)).toEqual([4, 5]);
    expect(await ttsBytes(null)).toBeNull();
    expect(await ttsBytes({ nope: 1 })).toBeNull();
  });
  it('labels WAV as WAV and anything else as MP3', () => {
    expect(audioType(new Uint8Array([82, 73, 70, 70, 0]))).toBe('audio/wav');
    expect(audioType(new Uint8Array([0xff, 0xfb, 0, 0]))).toBe('audio/mpeg');
  });
});
