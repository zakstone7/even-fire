/**
 * Recent-calls history — stored on-device only (never sent anywhere), so it
 * keeps the relay stateless and preserves privacy. It's an append-capped ring
 * under HISTORY_KEY; the cap comes from config.historyLimit.
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { HISTORY_KEY, HISTORY_DEFAULT, type HistoryEntry } from './types';

export async function readHistory(bridge: EvenAppBridge): Promise<HistoryEntry[]> {
  try {
    const raw = await bridge.getLocalStorage(HISTORY_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Prepend an entry (newest first) and cap to `limit`. Fire-and-forget-safe. */
export async function recordHistory(
  bridge: EvenAppBridge,
  entry: HistoryEntry,
  limit = HISTORY_DEFAULT,
): Promise<void> {
  if (limit <= 0) return;
  try {
    const list = await readHistory(bridge);
    list.unshift(entry);
    const capped = list.slice(0, limit);
    await bridge.setLocalStorage(HISTORY_KEY, JSON.stringify(capped));
  } catch {
    /* ignore — history is best-effort */
  }
}

export async function clearHistory(bridge: EvenAppBridge): Promise<void> {
  try {
    await bridge.setLocalStorage(HISTORY_KEY, '');
  } catch {
    /* ignore */
  }
}
