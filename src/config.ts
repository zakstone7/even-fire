/**
 * Config persistence through the Even App bridge's local storage.
 *
 * The whole FireConfig is stored as one JSON string under STORAGE_KEY so a
 * read or write is atomic. `load()` is defensive: bad JSON, a missing blob,
 * or an unknown version all degrade to a valid empty config rather than throw.
 *
 * Migration: v1 triggers (IFTTT-only, no `kind`) are upgraded to kind 'ifttt'.
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import {
  CONFIG_VERSION,
  STORAGE_KEY,
  MAX_TRIGGERS,
  HTTP_METHODS,
  HISTORY_DEFAULT,
  HISTORY_MAX,
  emptyConfig,
  emptyRawConfig,
  type FireConfig,
  type HttpMethod,
  type RawConfig,
  type RawHeader,
  type RelayConfig,
  type Trigger,
  type TriggerKind,
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

export async function saveConfig(bridge: EvenAppBridge, config: FireConfig): Promise<boolean> {
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

  // v1 (no kind), v2 (kind), v3 (relay/useRelay/history) all parse into the
  // current shape via normalize(), which fills in defaults for missing fields.
  if (obj.version === 1 || obj.version === 2 || obj.version === CONFIG_VERSION) {
    return normalize({
      version: CONFIG_VERSION,
      key: typeof obj.key === 'string' ? obj.key : null,
      triggers: Array.isArray(obj.triggers) ? (obj.triggers as Trigger[]) : [],
      relay: obj.relay as RelayConfig | undefined,
      historyLimit: typeof obj.historyLimit === 'number' ? obj.historyLimit : undefined,
    });
  }
  return emptyConfig();
}

/** Coerce a config into a sound shape: valid triggers, contiguous order, cap. */
export function normalize(config: FireConfig): FireConfig {
  const triggers = (config.triggers ?? [])
    .filter((t): t is Trigger => !!t && typeof t.id === 'string')
    .map(normalizeTrigger)
    .filter((t): t is Trigger => t !== null)
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_TRIGGERS)
    .map((t, i) => ({ ...t, order: i })); // re-index contiguously

  return {
    version: CONFIG_VERSION,
    key: config.key && config.key.trim() ? config.key.trim() : null,
    triggers,
    relay: normalizeRelay(config.relay),
    historyLimit: clampHistoryLimit(config.historyLimit),
  };
}

function normalizeRelay(relay: RelayConfig | undefined): RelayConfig | undefined {
  if (!relay) return undefined;
  const url = String(relay.url ?? '').trim();
  const secret = String(relay.secret ?? '').trim();
  if (!url && !secret) return undefined;
  return { url, secret };
}

function clampHistoryLimit(n: number | undefined): number {
  if (!Number.isFinite(n)) return HISTORY_DEFAULT;
  return Math.max(0, Math.min(HISTORY_MAX, Math.round(n as number)));
}

function normalizeTrigger(t: Trigger): Trigger | null {
  // Legacy (v1) triggers have no `kind` but do have `event` → treat as IFTTT.
  const kind: TriggerKind = t.kind === 'raw' ? 'raw' : 'ifttt';
  const base = {
    id: t.id,
    kind,
    confirm: Boolean(t.confirm),
    order: Number.isFinite(t.order) ? t.order : 0,
    useRelay: Boolean(t.useRelay),
  };

  if (kind === 'raw') {
    const raw = normalizeRaw(t.raw);
    if (!raw.url) return null; // a raw trigger needs a URL
    return { ...base, label: clampLabel(String(t.label ?? '')) || 'Request', raw };
  }

  const event = String(t.event ?? '').trim();
  const label = clampLabel(String(t.label ?? '')) || event;
  if (!label) return null;
  return { ...base, label, event, values: sanitizeValues(t.values) };
}

function normalizeRaw(raw: RawConfig | undefined): RawConfig {
  if (!raw) return emptyRawConfig();
  const method = (HTTP_METHODS as readonly string[]).includes(String(raw.method).toUpperCase())
    ? (String(raw.method).toUpperCase() as HttpMethod)
    : 'GET';
  const headers: RawHeader[] = Array.isArray(raw.headers)
    ? raw.headers
        .filter((h) => h && typeof h.name === 'string')
        .map((h) => ({ name: String(h.name).trim(), value: String(h.value ?? '') }))
        .filter((h) => h.name.length > 0)
    : [];
  return {
    method,
    url: String(raw.url ?? '').trim(),
    headers,
    body: typeof raw.body === 'string' ? raw.body : '',
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
