import { readLines } from './ndjson.js';
import {
  ProviderError,
  type CallOptions,
  type ChatProvider,
  type ChatRequest,
  type ChatResult,
} from '../types.js';

export interface OllamaOptions {
  id: string;
  baseUrl: string;
  apiKey?: string;
  /** Header carrying apiKey. `X-Hermes-Key` matches the hermes-proxy used in front of a remote GPU box. */
  apiKeyHeader?: string;
  maxParallel?: number;
  fetchImpl?: typeof fetch;
}

/** keep_alive: '-1' / '0' must be sent as numbers, durations ('30m') as strings. */
export function parseKeepAlive(v: string): string | number {
  return /^-?\d+$/.test(v.trim()) ? Number(v) : v;
}

export class OllamaProvider implements ChatProvider {
  readonly id: string;
  readonly isCloud = false;
  readonly maxParallel: number;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OllamaOptions) {
    this.id = opts.id;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.maxParallel = opts.maxParallel ?? 2;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.headers = { 'content-type': 'application/json' };
    if (opts.apiKey) this.headers[opts.apiKeyHeader ?? 'X-Hermes-Key'] = opts.apiKey;
  }

  async chat(req: ChatRequest, opts: CallOptions = {}): Promise<ChatResult> {
    // Messages go through /api/chat so Ollama applies Hermes 3's ChatML template itself.
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      keep_alive: parseKeepAlive(req.keepAlive),
      options: {
        temperature: req.temperature,
        num_ctx: req.numCtx,
        num_predict: req.numPredict,
      },
    };
    if (req.jsonSchema) body.format = req.jsonSchema;

    const res = await this.post('/api/chat', body, opts.signal);
    let content = '';
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    for await (const line of readLines(res.body!)) {
      let chunk: any;
      try {
        chunk = JSON.parse(line);
      } catch {
        continue;
      }
      if (chunk.error) throw new ProviderError(`Ollama: ${chunk.error}`);
      const piece: string = chunk.message?.content ?? '';
      if (piece) {
        content += piece;
        opts.onToken?.(piece);
      }
      if (chunk.done) {
        promptTokens = chunk.prompt_eval_count;
        completionTokens = chunk.eval_count;
      }
    }
    return { content, promptTokens, completionTokens };
  }

  async embed(model: string, input: string[]): Promise<number[][]> {
    const res = await this.post('/api/embed', { model, input });
    const json: any = await res.json();
    if (!Array.isArray(json.embeddings)) throw new ProviderError('Ollama: embed returned no embeddings');
    return json.embeddings;
  }

  private async post(path: string, body: unknown, signal?: AbortSignal) {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw new ProviderError(`Ollama unreachable at ${this.baseUrl}: ${(err as Error).message}`);
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(`Ollama ${path} failed (${res.status}): ${text.slice(0, 300)}`, res.status);
    }
    return res;
  }
}
