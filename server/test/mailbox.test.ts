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

describe('email threads', () => {
  it('builds Outlook conversation indexes: 22 bytes for the first email, +5 per reply', async () => {
    const { childThreadIndex, replySubject, rootThreadIndex } = await import('../src/crew/thread.js');
    const at = new Date('2026-10-01T03:00:00Z');
    const root = rootThreadIndex('plan:1:ain@x.my', at);
    expect(Buffer.from(root, 'base64')).toHaveLength(22);
    expect(Buffer.from(root, 'base64')[0]).toBe(1);
    expect(rootThreadIndex('plan:1:ain@x.my', at)).toBe(root);
    const r1 = childThreadIndex(root, new Date(at.getTime() + 3600_000));
    const r2 = childThreadIndex(r1, new Date(at.getTime() + 86400_000));
    expect(Buffer.from(r1, 'base64')).toHaveLength(27);
    expect(Buffer.from(r2, 'base64')).toHaveLength(32);
    expect(Buffer.from(r2, 'base64').subarray(0, 27).equals(Buffer.from(r1, 'base64'))).toBe(true);
    expect(replySubject('Re: RE: Tasks from Andrew: Policy')).toBe('Re: Tasks from Andrew: Policy');
  });

  it('puts the thread headers in the MIME sent through Microsoft Graph', async () => {
    const { mimeFor } = await import('../src/crew/mailbox.js');
    const mime = Buffer.from(
      await mimeFor(
        {
          to: 'ain@xanderia.com.my',
          subject: 'Re: Tasks from Andrew: Policy',
          text: 'hello',
          html: '<p>hello</p>',
          threading: { messageId: '<b@xanderia.com.my>', inReplyTo: '<a@xanderia.com.my>', references: ['<a@xanderia.com.my>'], threadTopic: 'Tasks from Andrew: Policy', threadIndex: 'AQHZ' },
        },
        { address: 'andrew@xanderia.com.my', name: 'Andrew' },
      ),
      'base64',
    ).toString('utf8');
    expect(mime).toMatch(/^Message-ID: <b@xanderia\.com\.my>$/im);
    expect(mime).toMatch(/^In-Reply-To: <a@xanderia\.com\.my>$/im);
    expect(mime).toMatch(/^References: <a@xanderia\.com\.my>$/im);
    expect(mime).toMatch(/^Thread-Index: AQHZ$/im);
    expect(mime).toMatch(/^Thread-Topic: Tasks from Andrew: Policy$/im);
    expect(mime).toMatch(/^From: Andrew <andrew@xanderia\.com\.my>$/m);
  });
});
