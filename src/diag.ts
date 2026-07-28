/**
 * Lightweight diagnostics channel.
 *
 * The glasses run in a WebView with no visible console, so a glasses-launch
 * failure is opaque. We record a small trace to storage; the phone settings
 * page reads it back (storage is shared across launches).
 *
 * Crucially the log is **append-only across launches**: each launch loads the
 * existing log and appends to it (capped to the last MAX lines). Otherwise the
 * phone launch you use to *read* the log would overwrite the glasses launch you
 * are trying to inspect.
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';

export const DIAG_KEY = 'fire.diag.v1';
const MAX = 40;

let bridgeRef: EvenAppBridge | null = null;
let log: string[] = [];

/** Load any existing log so this launch appends rather than overwrites. */
export async function initDiag(bridge: EvenAppBridge): Promise<void> {
  bridgeRef = bridge;
  try {
    const raw = await bridge.getLocalStorage(DIAG_KEY);
    if (raw) {
      const prev = JSON.parse(raw);
      if (Array.isArray(prev?.log)) log = prev.log.slice(-MAX);
    }
  } catch {
    /* ignore */
  }
}

/** Append one timestamped entry and persist (fire-and-forget). */
export function diag(patch: Record<string, unknown>): void {
  let stamp = '';
  try {
    stamp = new Date().toISOString().slice(11, 19);
  } catch {
    /* ignore */
  }
  log.push(`${stamp} ${JSON.stringify(patch)}`);
  if (log.length > MAX) log = log.slice(-MAX);
  void flush();
}

async function flush(): Promise<void> {
  if (!bridgeRef) return;
  try {
    await bridgeRef.setLocalStorage(DIAG_KEY, JSON.stringify({ log }));
  } catch {
    /* ignore */
  }
}

export async function readDiag(bridge: EvenAppBridge): Promise<string> {
  try {
    return await bridge.getLocalStorage(DIAG_KEY);
  } catch {
    return '';
  }
}

export async function clearDiag(bridge: EvenAppBridge): Promise<void> {
  log = [];
  try {
    await bridge.setLocalStorage(DIAG_KEY, '');
  } catch {
    /* ignore */
  }
}
