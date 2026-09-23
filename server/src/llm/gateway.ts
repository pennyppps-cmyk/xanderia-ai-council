import { containsHighSensitivityPII, redact } from '../privacy/pii.js';
import { PriorityGate } from './gate.js';
import type { ChatMessage, ChatProvider, ChatResult, RoleConfig } from './types.js';

export type Sensitivity = 'low' | 'high';

export interface AuditEntry {
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail: Record<string, unknown>;
}

export interface GatewayDeps {
  getRoleConfig(role: string): Promise<RoleConfig>;
  getProvider(id: string): Promise<ChatProvider>;
  /** Local model used when a cloud-routed role must stay on-prem. */
  getLocalFallback(): Promise<{ provider: ChatProvider; model: string }>;
  audit(entry: AuditEntry): Promise<void>;
}

export interface CallContext {
  userId?: string;
  messageId?: string;
  sensitivity?: Sensitivity;
  priority: number;
  signal?: AbortSignal;
  jsonSchema?: Record<string, unknown>;
  onToken?: (text: string) => void;
  /** Called when the call has to wait for a free model slot. */
  onQueued?: (position: number) => void;
  /** Label for the audit log, e.g. 'advisor:contrarian'. */
  purpose?: string;
}

export interface CallOutcome extends ChatResult {
  providerId: string;
  model: string;
  isCloud: boolean;
  forcedLocal: boolean;
  redactions: Record<string, number>;
  latencyMs: number;
}

export type LlmGateway = ReturnType<typeof createGateway>;

export function createGateway(deps: GatewayDeps) {
  const gates = new Map<string, PriorityGate>();

  function gateFor(provider: ChatProvider) {
    let gate = gates.get(provider.id);
    if (!gate) {
      gate = new PriorityGate(provider.maxParallel);
      gates.set(provider.id, gate);
    } else {
      gate.setSlots(provider.maxParallel);
    }
    return gate;
  }

  async function call(role: string, messages: ChatMessage[], ctx: CallContext): Promise<CallOutcome> {
    const cfg = await deps.getRoleConfig(role);
    let provider = await deps.getProvider(cfg.provider_id);
    let model = cfg.model;
    let forcedLocal = false;
    const redactions: Record<string, number> = {};
    let outgoing = messages;

    if (provider.isCloud) {
      const allText = messages.map((m) => m.content).join('\n');
      if (ctx.sensitivity === 'high' || containsHighSensitivityPII(allText)) {
        // PDPA: sensitive content never leaves the premises.
        const local = await deps.getLocalFallback();
        provider = local.provider;
        model = local.model;
        forcedLocal = true;
      } else {
        outgoing = messages.map((m) => {
          const r = redact(m.content);
          for (const [k, v] of Object.entries(r.counts)) redactions[k] = (redactions[k] ?? 0) + v;
          return { ...m, content: r.text };
        });
      }
    }

    const gate = gateFor(provider);
    if (gate.busy) ctx.onQueued?.(gate.positionFor(ctx.priority) + 1);
    const release = await gate.acquire(ctx.priority, ctx.signal);
    const started = Date.now();
    let result: ChatResult | undefined;
    let error: Error | undefined;
    try {
      result = await provider.chat(
        {
          model,
          messages: outgoing,
          temperature: cfg.temperature,
          numCtx: cfg.num_ctx,
          numPredict: cfg.num_predict,
          keepAlive: cfg.keep_alive,
          jsonSchema: ctx.jsonSchema,
        },
        { signal: ctx.signal, onToken: ctx.onToken },
      );
    } catch (err) {
      error = err as Error;
    } finally {
      release();
    }
    const latencyMs = Date.now() - started;

    // Not swallowed: if the audit row cannot be written, the call is treated as failed.
    await deps.audit({
        actorUserId: ctx.userId,
        action: 'model_call',
        targetType: 'message',
        targetId: ctx.messageId,
        detail: {
          role,
          purpose: ctx.purpose ?? role,
          provider: provider.id,
          model,
          is_cloud: provider.isCloud,
          forced_local: forcedLocal,
          redactions,
          prompt_tokens: result?.promptTokens,
          completion_tokens: result?.completionTokens,
          latency_ms: latencyMs,
          ok: !error,
          error: error?.message,
        },
      });

    if (error) throw error;
    return {
      ...result!,
      providerId: provider.id,
      model,
      isCloud: provider.isCloud,
      forcedLocal,
      redactions,
      latencyMs,
    };
  }

  return { call, gateFor };
}
