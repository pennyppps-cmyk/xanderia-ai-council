import { readLines } from './ndjson.js';
import {
  ProviderError,
  type CallOptions,
  type ChatProvider,
  type ChatRequest,
  type ChatResult,
} from '../types.js';

/**
 * Generic OpenAI-compatible chat provider (a cloud API, or self-hosted vLLM etc).
 * Stubbed for Phase 1: the seed creates no enabled row of this kind.
 * When a row is marked is_cloud, the gateway redacts PII before calling it.
 */
export class OpenAICompatibleProvider implements ChatProvider {
  constructor(
    readonly id: string,
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly isCloud: boolean,
    readonly maxParallel = 8,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async chat(req: ChatRequest, opts: CallOptions = {}): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature,
      max_tokens: req.numPredict,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'output', schema: req.jsonSchema },
      };
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (err) {
      throw new ProviderError(`${this.id} unreachable: ${(err as Error).message}`);
    }
    if (!res.ok || !res.body) {
      throw new ProviderError(`${this.id} failed (${res.status})`, res.status);
    }
    let content = '';
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    for await (const line of readLines(res.body)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') break;
      const chunk = JSON.parse(data);
      const piece: string = chunk.choices?.[0]?.delta?.content ?? '';
      if (piece) {
        content += piece;
        opts.onToken?.(piece);
      }
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens;
        completionTokens = chunk.usage.completion_tokens;
      }
    }
    return { content, promptTokens, completionTokens };
  }
}
