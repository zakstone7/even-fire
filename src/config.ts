/**
 * Config persistence through the Even App bridge's local storage.
 *
 * The whole FireConfig is stored as one JSON string under STORAGE_KEY so a
 * read or write is atomic. `load()` is defensive: bad JSON, a missing blob,
 * or an unknown version all degrade to a valid empty config rather than throw.
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import {
  CONFIG_VERSION,
  STORAGE_KEY,
  MAX_TRIGGERS,
  emptyConfig,
  type FireConfig,
  type Trigger,
} from './types';
import { clampLabel } from './util';

export async function loadConfig(bridge: EvenAppBridge): Promise<FireConfig> {
  let raw = '';
  try {
    raw = await bridge.getLocalStorage(STORAGE_KEY);
  } catch {
    return emptyConfig();
  }
  return parseConfig(raw);
}

export async function saveConfig(
  bridge: EvenAppBridge,
  config: FireConfig,
): Promise<boolean> {
  const clean = normalize(config);
  try {
    return await bridge.setLocalStorage(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    return false;
  }
}

/** Parse + migrate a stored blob. Always returns a valid config. */
export function parseConfig(raw: string | null | undefined): FireConfig {
  if (!raw) return emptyConfig();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyConfig();
  }
  if (typeof data !== 'object' || data === null) return emptyConfig();
  const obj = data as Record<string, unknown>;

  // Branch on version. Only v1 exists today; unknown versions fall back safely.
  switch (obj.version) {
    case CONFIG_VERSION:
      return normalize({
        version: CONFIG_VERSION,
        key: typeof obj.key === 'string' ? obj.key : null,
        triggers: Array.isArray(obj.triggers) ? (obj.triggers as Trigger[]) : [],
      });
    default:
      return emptyConfig();
  }
}

/** Coerce a config into a sound shape: valid triggers, contiguous order, cap. */
export function normalize(config: FireConfig): FireConfig {
  const triggers = (config.triggers ?? [])
    .filter((t): t is Trigger => !!t && typeof t.id === 'string' && typeof t.event === 'string')
    .map((t) => ({
      id: t.id,
      label: clampLabel(String(t.label ?? '')) || t.event,
      event: String(t.event).trim(),
      values: sanitizeValues(t.values),
      confirm: Boolean(t.confirm),
      order: Number.isFinite(t.order) ? t.order : 0,
    }))
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_TRIGGERS)
    .map((t, i) => ({ ...t, order: i })); // re-index contiguously

  return {
    version: CONFIG_VERSION,
    key: config.key && config.key.trim() ? config.key.trim() : null,
    triggers,
  };
}

function sanitizeValues(values: Trigger['values']): Trigger['values'] | undefined {
  if (!values) return undefined;
  const out: Record<string, string> = {};
  for (const k of ['value1', 'value2', 'value3'] as const) {
    const v = values[k];
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
