import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Email threading: every email from one plan to one person continues the same conversation.
 * Gmail threads on References + the same subject; Outlook/Exchange on Thread-Index (the
 * conversation index) and In-Reply-To. We set all of them.
 */

export interface Threading {
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  threadTopic: string;
  threadIndex: string;
}

export const threadKey = (planId: string, to: string) => `plan:${planId}:${to.trim().toLowerCase()}`;

export function newMessageId(domain: string) {
  return `<${randomUUID()}@${domain.replace(/[^a-z0-9.-]/gi, '') || 'xanderia-council'}>`;
}

/** "Re: Tasks from Andrew: ..." stays one subject however many replies; strip any existing prefix. */
export const replySubject = (rootSubject: string) => `Re: ${rootSubject.replace(/^(re:\s*)+/i, '')}`;

const FILETIME_EPOCH_MS = 11644473600000n;
const filetime = (d: Date) => (BigInt(d.getTime()) + FILETIME_EPOCH_MS) * 10000n;

/** Outlook conversation index of the first email: 0x01, 5 bytes of time, a 16-byte GUID (from the thread key). */
export function rootThreadIndex(key: string, at: Date) {
  const buf = Buffer.alloc(22);
  buf[0] = 1;
  const top = filetime(at) >> 24n;
  for (let i = 0; i < 5; i++) buf[1 + i] = Number((top >> BigInt(8 * (4 - i))) & 0xffn);
  createHash('md5').update(key).digest().copy(buf, 6);
  return buf.toString('base64');
}

/** A reply's conversation index: the parent's plus one 5-byte block with the time since the root. */
export function childThreadIndex(parentIndex: string, at: Date) {
  const parent = Buffer.from(parentIndex, 'base64');
  let top = 0n;
  for (let i = 0; i < 5; i++) top = (top << 8n) | BigInt(parent[1 + i]);
  const delta = filetime(at) - (top << 24n);
  const small = (delta & 0xfffe000000000000n) === 0n;
  const word = small ? (delta >> 18n) & 0x7fffffffn : ((delta >> 23n) & 0x7fffffffn) | 0x80000000n;
  const block = Buffer.alloc(5);
  block.writeUInt32BE(Number(word < 0n ? 0n : word), 0);
  block[4] = (randomBytes(1)[0] & 0xf0) | ((parent.length - 22) / 5 + 1) % 16;
  return Buffer.concat([parent, block]).toString('base64');
}
