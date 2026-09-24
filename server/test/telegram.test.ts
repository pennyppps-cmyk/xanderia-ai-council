import { describe, expect, it, vi } from 'vitest';
import { splitMessage, toPlainText } from '../src/telegram/bot.js';

describe('telegram formatting', () => {
  it('turns model markdown into readable plain text', () => {
    expect(toPlainText('## Verdict\n\n**Go** with *care*.\n\n\n\n- one\n* two')).toBe('VERDICT\n\nGo with care.\n\n• one\n• two');
  });

  it('splits long answers on paragraph boundaries under the limit', () => {
    const para = 'x'.repeat(1500);
    const parts = splitMessage([para, para, para].join('\n\n'), 4000);
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.length <= 4000)).toBe(true);
    expect(parts.join('\n\n')).toBe([para, para, para].join('\n\n'));
  });

  it('hard-splits a single overlong word', () => {
    expect(splitMessage('y'.repeat(9000), 4000).map((p) => p.length)).toEqual([4000, 4000, 1000]);
  });
});

describe('voice transcription', () => {
  it('posts the audio to the on-prem Whisper server and returns the text', async () => {
    process.env.WHISPER_URL = 'http://whisper:8000/';
    vi.resetModules(); // config is parsed once per module graph
    const { transcribe } = await import('../src/voice/transcribe.js');
    let seen: { url: string; model: unknown; language: unknown } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      const form = init.body as FormData;
      seen = { url, model: form.get('model'), language: form.get('language') };
      return new Response(JSON.stringify({ text: ' Berapa kadar tunggakan bulan ini? ' }), { status: 200 });
    }) as unknown as typeof fetch;
    const text = await transcribe(Buffer.from('audio'), 'v.webm', { language: 'ms', fetchImpl: fake });
    expect(text).toBe('Berapa kadar tunggakan bulan ini?');
    expect(seen).toEqual({ url: 'http://whisper:8000/v1/audio/transcriptions', model: 'Systran/faster-whisper-small', language: 'ms' });
  });
});
