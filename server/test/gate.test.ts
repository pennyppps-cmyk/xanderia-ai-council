import { describe, expect, it } from 'vitest';
import { PRIORITY, PriorityGate } from '../src/llm/gate.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('PriorityGate', () => {
  it('limits concurrency to the slot count', async () => {
    const gate = new PriorityGate(2);
    const a = await gate.acquire(10);
    const b = await gate.acquire(10);
    let cGot = false;
    const c = gate.acquire(10).then((r) => ((cGot = true), r));
    await tick();
    expect(cGot).toBe(false);
    expect(gate.stats).toEqual({ active: 2, waiting: 1, slots: 2 });
    a();
    (await c)();
    b();
    expect(gate.stats.active).toBe(0);
  });

  it('serves Quick-mode waiters before earlier Council waiters', async () => {
    const gate = new PriorityGate(1);
    const release = await gate.acquire(PRIORITY.council);
    const order: string[] = [];
    const c1 = gate.acquire(PRIORITY.council).then((r) => (order.push('council-1'), r));
    const c2 = gate.acquire(PRIORITY.council).then((r) => (order.push('council-2'), r));
    const q = gate.acquire(PRIORITY.quick).then((r) => (order.push('quick'), r));
    expect(gate.positionFor(PRIORITY.quick)).toBe(1);
    release();
    (await q)();
    (await c1)();
    (await c2)();
    expect(order).toEqual(['quick', 'council-1', 'council-2']);
  });

  it('releases are idempotent and abort removes a waiter', async () => {
    const gate = new PriorityGate(1);
    const r = await gate.acquire(1);
    const ac = new AbortController();
    const waiting = gate.acquire(1, ac.signal);
    ac.abort();
    await expect(waiting).rejects.toThrow('aborted');
    r();
    r();
    expect(gate.stats).toEqual({ active: 0, waiting: 0, slots: 1 });
  });
});
