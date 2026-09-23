import { createGateway, type AuditEntry } from '../src/llm/gateway.js';
import type { CallOptions, ChatProvider, ChatRequest, ChatResult, RoleConfig } from '../src/llm/types.js';

/** A provider that records every request and answers from a script. */
export class FakeProvider implements ChatProvider {
  readonly requests: ChatRequest[] = [];
  constructor(
    readonly id: string,
    readonly isCloud: boolean,
    private readonly respond: (req: ChatRequest) => string | Promise<string> = () => 'ok',
    readonly maxParallel = 2,
  ) {}

  async chat(req: ChatRequest, opts: CallOptions = {}): Promise<ChatResult> {
    this.requests.push(req);
    const content = await this.respond(req);
    opts.onToken?.(content);
    return { content, promptTokens: 10, completionTokens: 5 };
  }

  /** Everything this provider was ever sent, as one string. */
  get seenText() {
    return this.requests.flatMap((r) => r.messages.map((m) => m.content)).join('\n');
  }
}

export function roleConfig(role: string, provider_id: string, extra: Partial<RoleConfig> = {}): RoleConfig {
  return {
    role,
    provider_id,
    model: provider_id === 'cloud' ? 'cloud-model' : 'hermes3:8b',
    temperature: 0.2,
    num_ctx: 16384,
    num_predict: 600,
    keep_alive: '30m',
    ...extra,
  };
}

export function makeGateway(opts: {
  providers: ChatProvider[];
  roles: Record<string, string>; // role -> provider id
  local?: ChatProvider;
}) {
  const audit: AuditEntry[] = [];
  const byId = new Map(opts.providers.map((p) => [p.id, p]));
  const gateway = createGateway({
    getRoleConfig: async (role) => roleConfig(role, opts.roles[role] ?? opts.roles['*'] ?? 'local'),
    getProvider: async (id) => {
      const p = byId.get(id);
      if (!p) throw new Error(`no provider ${id}`);
      return p;
    },
    getLocalFallback: async () => ({ provider: opts.local ?? byId.get('local')!, model: 'hermes3:8b' }),
    audit: async (e) => {
      audit.push(e);
    },
  });
  return { gateway, audit };
}
