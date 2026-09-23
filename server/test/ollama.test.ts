import { describe, expect, it } from 'vitest';
import { OllamaProvider, parseKeepAlive } from '../src/llm/providers/ollama.js';

function ndjsonResponse(lines: object[], status = 200) {
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  // Split mid-line to exercise buffering across chunks.
  const bytes = new TextEncoder().encode(body);
  const mid = Math.floor(bytes.length / 2);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes.slice(0, mid));
      c.enqueue(bytes.slice(mid));
      c.close();
    },
  });
  return new Response(stream, { status });
}

describe('OllamaProvider', () => {
  it('sends ChatML-agnostic /api/chat requests with per-role options and streams tokens', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const provider = new OllamaProvider({
      id: 'ollama',
      baseUrl: 'http://aixan:11434/',
      apiKey: 'secret',
      fetchImpl: async (url, init) => {
        captured = { url: String(url), init: init! };
        return ndjsonResponse([
          { message: { content: 'Hel' }, done: false },
          { message: { content: 'lo' }, done: false },
          { message: { content: '' }, done: true, prompt_eval_count: 42, eval_count: 7 },
        ]);
      },
    });
    const tokens: string[] = [];
    const res = await provider.chat(
      {
        model: 'hermes3:8b',
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
        temperature: 0.7,
        numCtx: 16384,
        numPredict: 600,
        keepAlive: '-1',
        jsonSchema: { type: 'object' },
      },
      { onToken: (t) => tokens.push(t) },
    );

    expect(captured!.url).toBe('http://aixan:11434/api/chat');
    expect((captured!.init.headers as any)['X-Hermes-Key']).toBe('secret');
    const body = JSON.parse(captured!.init.body as string);
    expect(body).toEqual({
      model: 'hermes3:8b',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      stream: true,
      keep_alive: -1,
      options: { temperature: 0.7, num_ctx: 16384, num_predict: 600 },
      format: { type: 'object' },
    });
    expect(tokens).toEqual(['Hel', 'lo']);
    expect(res).toEqual({ content: 'Hello', promptTokens: 42, completionTokens: 7 });
  });

  it('omits the key header when no key is configured', async () => {
    let headers: any;
    const provider = new OllamaProvider({
      id: 'ollama',
      baseUrl: 'http://localhost:11434',
      fetchImpl: async (_u, init) => {
        headers = init!.headers;
        return ndjsonResponse([{ message: { content: 'x' }, done: true }]);
      },
    });
    await provider.chat({ model: 'm', messages: [], temperature: 0, numCtx: 1, numPredict: 1, keepAlive: '30m' });
    expect(Object.keys(headers)).toEqual(['content-type']);
  });

  it('surfaces HTTP and in-stream errors', async () => {
    const http = new OllamaProvider({
      id: 'o',
      baseUrl: 'http://x',
      fetchImpl: async () => new Response('model "nope" not found', { status: 404 }),
    });
    await expect(
      http.chat({ model: 'nope', messages: [], temperature: 0, numCtx: 1, numPredict: 1, keepAlive: '30m' }),
    ).rejects.toThrow(/404.*not found/);

    const inStream = new OllamaProvider({
      id: 'o',
      baseUrl: 'http://x',
      fetchImpl: async () => ndjsonResponse([{ error: 'out of memory' }]),
    });
    await expect(
      inStream.chat({ model: 'm', messages: [], temperature: 0, numCtx: 1, numPredict: 1, keepAlive: '30m' }),
    ).rejects.toThrow('out of memory');
  });

  it('reports unreachable hosts clearly', async () => {
    const p = new OllamaProvider({
      id: 'o',
      baseUrl: 'http://192.168.88.100:11434',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(p.embed('nomic-embed-text', ['a'])).rejects.toThrow(/unreachable at http:\/\/192.168.88.100/);
  });

  it('parses keep_alive values', () => {
    expect(parseKeepAlive('-1')).toBe(-1);
    expect(parseKeepAlive('0')).toBe(0);
    expect(parseKeepAlive('30m')).toBe('30m');
  });
});
