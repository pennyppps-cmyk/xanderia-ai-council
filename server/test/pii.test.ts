import { describe, expect, it } from 'vitest';
import { containsHighSensitivityPII, containsPII, redact } from '../src/privacy/pii.js';

describe('redact', () => {
  it.each([
    ['900101-14-5678', 'IC'],
    ['900101145678', 'IC'],
    ['900101 14 5678', 'IC'],
  ])('removes Malaysian IC %s', (ic, type) => {
    const r = redact(`Customer IC is ${ic}, please check.`);
    expect(r.text).not.toContain(ic);
    expect(r.text).toContain(`[${type}]`);
    expect(r.counts.IC).toBe(1);
  });

  it('removes phone numbers in common formats', () => {
    for (const phone of ['012-345 6789', '+6012-3456789', '0123456789', '03-2345 6789', '60198765432']) {
      const r = redact(`Call ${phone} today`);
      expect(r.text, phone).not.toMatch(/\d{4}/);
    }
  });

  it('removes account numbers and emails', () => {
    const r = redact('Account 1234 5678 9012 belongs to ali.baba@example.com.my');
    expect(r.text).not.toMatch(/\d{4}/);
    expect(r.text).not.toContain('ali.baba');
    expect(r.counts.EMAIL).toBe(1);
  });

  it('removes names introduced by honorifics or labels', () => {
    const r = redact('Encik Ahmad bin Ismail and Puan Siti Nurhaliza are late. Nama: Tan Ah Kow');
    expect(r.text).not.toContain('Ahmad');
    expect(r.text).not.toContain('Siti');
    expect(r.text).not.toContain('Tan Ah Kow');
    expect(r.text).toContain('Encik [NAME]');
  });

  it('leaves ordinary business text alone', () => {
    const text = 'Should we move 30 DPD reminders from day 5 to day 3 for RM 2,000 loans in 2026?';
    expect(redact(text).text).toBe(text);
    expect(containsPII(text)).toBe(false);
  });

  it('flags IC and account numbers as high sensitivity', () => {
    expect(containsHighSensitivityPII('IC 850505-10-1234')).toBe(true);
    expect(containsHighSensitivityPII('call 012-3456789')).toBe(false);
  });
});
