/**
 * Persisted data model.
 *
 * Everything lives under a single storage key as one JSON blob so reads and
 * writes are atomic (see config.ts). Always branch on `version` when reading;
 * never assume the shape.
 *
 * v2 adds a trigger `kind`: 'ifttt' (fire an IFTTT webhook via value1..3) or
 * 'raw' (an arbitrary HTTP request — method, url, headers, body). v1 triggers
 * are migrated to kind 'ifttt'.
 */

export const CONFIG_VERSION = 2 as const;

/** Storage key for the whole config blob. Bump the suffix on a breaking change. */
export const STORAGE_KEY = 'fire.config.v1';

/** Hard ceiling on triggers — keeps the glasses list navigable and the blob small. */
export const MAX_TRIGGERS = 12;

/** Max label length shown on the glasses. Enforced in the settings UI. */
export const LABEL_MAX = 20;

/** Max response-body characters shown after a Raw test fire. */
export const RESPONSE_PREVIEW_MAX = 500;

export type TriggerKind = 'ifttt' | 'raw';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface TriggerValues {
  value1?: string;
  value2?: string;
  value3?: string;
}

export interface RawHeader {
  name: string;
  value: string;
}

export interface RawConfig {
  method: HttpMethod;
  url: string;
  headers: RawHeader[];
  body: string;
}

export interface Trigger {
  /** Stable uuid; survives renames and reordering. */
  id: string;
  /** Shown on the glasses; enforced <= LABEL_MAX chars. */
  label: string;
  /** Which kind of request this trigger fires. */
  kind: TriggerKind;
  /** Require a two-step confirm on the glasses before firing. */
  confirm: boolean;
  /** Sort order in the list. */
  order: number;

  // --- kind === 'ifttt' ---
  /** IFTTT Webhooks event name (the `{event}` in the trigger URL). */
  event?: string;
  /** Optional value1..3, all sent as query params. */
  values?: TriggerValues;

  // --- kind === 'raw' ---
  raw?: RawConfig;
}

export interface FireConfig {
  version: typeof CONFIG_VERSION;
  /** IFTTT Webhooks key. `null` until the user sets it on the phone. */
  key: string | null;
  triggers: Trigger[];
}

export function emptyConfig(): FireConfig {
  return { version: CONFIG_VERSION, key: null, triggers: [] };
}

export function emptyRawConfig(): RawConfig {
  return { method: 'POST', url: '', headers: [], body: '' };
}
