/**
 * PII detection & redaction for Malaysian content. Runs before any call to a
 * cloud provider; local (on-prem) calls see the original text.
 */

interface Rule {
  type: string;
  pattern: RegExp;
  /** Optional capture-group replacement: keep a prefix (e.g. "Encik ") and redact the rest. */
  keepGroup?: number;
}

const RULES: Rule[] = [
  // MyKad / IC: YYMMDD-PB-###G, with or without dashes/spaces.
  { type: 'IC', pattern: /\b\d{6}[\s-]?\d{2}[\s-]?\d{4}\b/g },
  // Email addresses.
  { type: 'EMAIL', pattern: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  // Malaysian phone numbers: +60 / 60 / 0 prefix, mobile (01x) and landline (0[3-9]).
  {
    type: 'PHONE',
    pattern: /(?:\+?6?0)(?:1\d|[3-9])[\s-]?\d{3,4}[\s-]?\d{4}\b/g,
  },
  // Bank / loan account numbers: 8–20 digit runs, optionally grouped.
  { type: 'ACCOUNT', pattern: /\b\d(?:[\s-]?\d){7,19}\b/g },
  // Names introduced by a label or honorific (best-effort).
  {
    type: 'NAME',
    pattern:
      /\b((?:Nama|Name|Customer|Pelanggan|Borrower|Peminjam)\s*[:\-]\s*|(?:Encik|En\.|Puan|Pn\.|Cik|Tuan|Dato'?|Datin|Mr\.?|Mrs\.?|Ms\.?|Madam)\s+)([A-Z][\p{L}'@.]*(?:\s+(?:bin|binti|bt\.?|bte|a\/l|a\/p|[A-Z][\p{L}'@.]*)){0,5})/gu,
    keepGroup: 1,
  },
];

export interface RedactionResult {
  text: string;
  counts: Record<string, number>;
}

export function redact(text: string): RedactionResult {
  const counts: Record<string, number> = {};
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match, ...groups) => {
      counts[rule.type] = (counts[rule.type] ?? 0) + 1;
      if (rule.keepGroup) return `${groups[rule.keepGroup - 1]}[${rule.type}]`;
      return `[${rule.type}]`;
    });
  }
  return { text: out, counts };
}

export function containsPII(text: string): boolean {
  return Object.keys(redact(text).counts).length > 0;
}

/** High-sensitivity identifiers force local-only processing regardless of routing config. */
export function containsHighSensitivityPII(text: string): boolean {
  const { counts } = redact(text);
  return Boolean(counts.IC || counts.ACCOUNT);
}
