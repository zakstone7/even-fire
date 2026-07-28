/** Small dependency-free helpers. */

import { LABEL_MAX } from './types';

/** RFC4122 uuid with a fallback for engines lacking crypto.randomUUID. */
export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback: RFC4122 v4 from getRandomValues, or Math.random as last resort.
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`.replace(
    /(.{8})(.{4})(.{4})(.{4})(.{12})/,
    '$1-$2-$3-$4-$5',
  );
}

/** Trim and clamp a label to the on-glass length budget. */
export function clampLabel(raw: string): string {
  return raw.trim().slice(0, LABEL_MAX);
}

/** Show only the last 4 characters of a secret, e.g. "••••••cD3f". */
export function maskKey(key: string): string {
  if (!key) return '';
  const tail = key.slice(-4);
  return `${'•'.repeat(Math.max(4, key.length - 4))}${tail}`;
}
