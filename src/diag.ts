/**
 * Lightweight diagnostics channel.
 *
 * The glasses run in a WebView with no visible console, so a glasses-launch
 * failure is opaque. We record a small trace to storage as the app boots; the
 * phone settings page reads it back (storage is shared across launches). This
 * turns "the glasses do nothing" into something inspectable on the phone.
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';

export const DIAG_KEY = 'fire.diag.v1';

let bridgeRef: EvenAppBridge | null = null;
const state: Record<string, unknown> = { log: [] as string[] };

export function initDiag(bridge: EvenAppBridge): void {
  bridgeRef = bridge;
}

/** Merge fields into the diagnostic record + append a log line; persist async. */
export function diag(patch: Record<string, unknown>): void {
  Object.assign(state, patch);
  const log = state.log as string[];
  let stamp = '';
  try {
    stamp = new Date().toISOString().slice(11, 19);
  } catch {
    /* ignore */
  }
  log.push(`${stamp} ${JSON.stringify(patch)}`);
  if (log.length > 30) log.shift();
  void flush();
}

async function flush(): Promise<void> {
  if (!bridgeRef) return;
  try {
    await bridgeRef.setLocalStorage(DIAG_KEY, JSON.stringify(state));
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
  state.log = [];
  try {
    await bridge.setLocalStorage(DIAG_KEY, '');
  } catch {
    /* ignore */
  }
}
