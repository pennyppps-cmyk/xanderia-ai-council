export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  numCtx: number;
  numPredict: number;
  keepAlive: string;
  /** JSON schema to constrain output (Ollama `format`, OpenAI `response_format`). */
  jsonSchema?: Record<string, unknown>;
}

export interface ChatResult {
  content: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface CallOptions {
  signal?: AbortSignal;
  onToken?: (text: string) => void;
}

/** Every model backend implements this. Adding a provider = one class + one row in `providers`. */
export interface ChatProvider {
  readonly id: string;
  readonly isCloud: boolean;
  readonly maxParallel: number;
  chat(req: ChatRequest, opts?: CallOptions): Promise<ChatResult>;
  embed?(model: string, input: string[]): Promise<number[][]>;
}

export interface ProviderRow {
  id: string;
  kind: 'ollama' | 'openai_compatible';
  base_url: string;
  api_key_env: string | null;
  is_cloud: boolean;
  enabled: boolean;
  max_parallel: number;
}

export interface RoleConfig {
  role: string;
  provider_id: string;
  model: string;
  temperature: number;
  num_ctx: number;
  num_predict: number;
  keep_alive: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
