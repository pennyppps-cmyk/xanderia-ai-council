import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/redis.js', () => ({ redis: {} }));

const { seal, unseal } = await import('../src/crew/mailbox.js');
const { buildWelcomeEmail, generateTempPassword } = await import('../src/account.js');

describe('mailbox token encryption', () => {
  it('round-trips, uses a fresh IV each time, and rejects tampering', () => {
    const a = seal('refresh-token-123');
    const b = seal('refresh-token-123');
    expect(a).not.toBe(b);
    expect(a).not.toContain('refresh-token');
    expect(unseal(a)).toBe('refresh-token-123');
    const [iv, tag, enc] = a.split('.');
    const flipped = enc.slice(0, -2) + (enc.endsWith('A') ? 'BB' : 'AA');
    expect(() => unseal([iv, tag, flipped].join('.'))).toThrow();
  });
});

describe('temporary password', () => {
  it('is three groups of four unambiguous characters, different every time', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = generateTempPassword();
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
      expect(p).not.toMatch(/[0O1lI]/);
      seen.add(p);
    }
    expect(seen.size).toBe(50);
  });

  it('welcome email has the link, login and password in English and BM, and escapes HTML', () => {
    const m = buildWelcomeEmail({ name: 'Aina <b>', email: 'aina@xanderia.com.my', password: 'Hk7m-Pq4r-Tz9w', link: 'https://192.168.88.179/', invitedBy: 'Andrew', microsoft: true });
    for (const s of ['https://192.168.88.179/', 'aina@xanderia.com.my', 'Hk7m-Pq4r-Tz9w', 'Temporary password', 'Kata laluan sementara', 'by Andrew', 'Microsoft work email']) {
      expect(m.text).toContain(s);
    }
    expect(m.html).toContain('Hk7m-Pq4r-Tz9w');
    expect(m.html).toContain('Aina &lt;b&gt;');
    expect(m.html).not.toContain('Aina <b>');
    expect(buildWelcomeEmail({ name: 'A', email: 'a@x.my', password: 'p', link: 'l' }).text).not.toContain('Microsoft');
  });
});
