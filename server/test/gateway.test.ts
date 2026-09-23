import { describe, expect, it } from 'vitest';
import { PRIORITY } from '../src/llm/gate.js';
import { FakeProvider, makeGateway } from './helpers.js';

const IC = '880212-10-5566';

describe('gateway PII guard (acceptance: an IC number never reaches a cloud provider)', () => {
  it('forces a cloud-routed role onto the local model when the message contains an IC', async () => {
    const cloud = new FakeProvider('cloud', true);
    const local = new FakeProvider('local', false);
    const { gateway, audit } = makeGateway({ providers: [cloud, local], roles: { chairman: 'cloud' } });

    const out = await gateway.call(
      'chairman',
      [{ role: 'user', content: `Customer ${IC} missed 3 payments. What now?` }],
      { priority: PRIORITY.council, sensitivity: 'low' },
    );

    expect(cloud.requests).toHaveLength(0);
    expect(local.seenText).toContain(IC);
    expect(out.forcedLocal).toBe(true);
    expect(out.isCloud).toBe(false);
    expect(audit[0].detail).toMatchObject({ provider: 'local', forced_local: true, is_cloud: false });
  });

  it('never sends an IC to the cloud even inside system prompts or history', async () => {
    const cloud = new FakeProvider('cloud', true);
    const local = new FakeProvider('local', false);
    const { gateway } = makeGateway({ providers: [cloud, local], roles: { '*': 'cloud' } });
    for (const variant of [IC, IC.replace(/-/g, ''), IC.replace(/-/g, ' ')]) {
      await gateway.call(
        'quick',
        [
          { role: 'system', content: 'You are an advisor.' },
          { role: 'assistant', content: `Earlier you mentioned ${variant}.` },
          { role: 'user', content: 'Summarise.' },
        ],
        { priority: PRIORITY.quick },
      );
    }
    expect(cloud.seenText).not.toMatch(/\d{6}[\s-]?\d{2}[\s-]?\d{4}/);
  });

  it('keeps router-flagged high-sensitivity content local', async () => {
    const cloud = new FakeProvider('cloud', true);
    const local = new FakeProvider('local', false);
    const { gateway } = makeGateway({ providers: [cloud, local], roles: { chairman: 'cloud' } });
    await gateway.call('chairman', [{ role: 'user', content: 'Disciplinary case for a named staff member' }], {
      priority: PRIORITY.council,
      sensitivity: 'high',
    });
    expect(cloud.requests).toHaveLength(0);
    expect(local.requests).toHaveLength(1);
  });

  it('redacts lower-risk PII before a permitted cloud call and records it in the audit', async () => {
    const cloud = new FakeProvider('cloud', true);
    const local = new FakeProvider('local', false);
    const { gateway, audit } = makeGateway({ providers: [cloud, local], roles: { chairman: 'cloud' } });
    await gateway.call('chairman', [{ role: 'user', content: 'Call Encik Razak on 012-3456789 about the plan' }], {
      priority: PRIORITY.council,
      sensitivity: 'low',
    });
    expect(cloud.requests).toHaveLength(1);
    expect(cloud.seenText).not.toContain('012-3456789');
    expect(cloud.seenText).not.toContain('Razak');
    expect(audit[0].detail).toMatchObject({ is_cloud: true, redactions: { PHONE: 1, NAME: 1 } });
  });

  it('sends local calls unmodified (data stays on-prem)', async () => {
    const local = new FakeProvider('local', false);
    const { gateway } = makeGateway({ providers: [local], roles: { '*': 'local' } });
    await gateway.call('quick', [{ role: 'user', content: `IC ${IC}` }], { priority: PRIORITY.quick });
    expect(local.seenText).toContain(IC);
  });
});

describe('gateway config & audit', () => {
  it('passes per-role model settings to the provider', async () => {
    const local = new FakeProvider('local', false);
    const { gateway } = makeGateway({ providers: [local], roles: { '*': 'local' } });
    await gateway.call('quick', [{ role: 'user', content: 'hi' }], { priority: PRIORITY.quick });
    expect(local.requests[0]).toMatchObject({ model: 'hermes3:8b', numCtx: 16384, numPredict: 600, keepAlive: '30m' });
  });

  it('audits failed calls too, then rethrows', async () => {
    const broken = new FakeProvider('local', false, () => {
      throw new Error('boom');
    });
    const { gateway, audit } = makeGateway({ providers: [broken], roles: { '*': 'local' } });
    await expect(gateway.call('quick', [{ role: 'user', content: 'x' }], { priority: 1, messageId: 'm1' })).rejects.toThrow('boom');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'model_call', targetId: 'm1', detail: { ok: false, error: 'boom' } });
  });
});
