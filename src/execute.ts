/**
 * Firing triggers — both kinds.
 *
 * Two entry points:
 *   - send(): fire-and-forget, used by the glasses. Resolves to 'sent' or
 *     'no-connection'; never rejects. Honest terminal states only.
 *   - test(): the phone "Test fire". For a Raw trigger it reads the status code
 *     and a truncated response body when CORS allows; for IFTTT it stays
 *     fire-and-forget (the response is opaque under CORS — see ifttt.ts).
 *
 * CORS reality for Raw: the request honors the chosen method/headers/body via
 * `mode: 'cors'`, so the response is only readable if the endpoint returns
 * Access-Control-Allow-Origin, and non-simple requests are preflighted (and
 * blocked entirely if the endpoint doesn't support CORS).
 */

import { RESPONSE_PREVIEW_MAX, type Trigger } from './types';
import { buildTriggerUrl } from './ifttt';

export type SendResult = 'sent' | 'no-connection';

/** Fire-and-forget (glasses). Never rejects. */
export async function send(
  trigger: Trigger,
  key: string | null,
  signal?: AbortSignal,
): Promise<SendResult> {
  try {
    if (trigger.kind === 'raw') {
      await rawFetch(trigger, signal);
    } else {
      if (!key) return 'no-connection';
      const url = buildTriggerUrl(trigger.event ?? '', key, trigger.values);
      await fetch(url, { method: 'POST', mode: 'no-cors', cache: 'no-store', signal });
    }
    return 'sent';
  } catch {
    return 'no-connection';
  }
}

export interface TestResult {
  ok: boolean;
  /** HTTP status when readable (Raw + CORS-enabled endpoint). */
  status?: number;
  statusText?: string;
  /** Truncated response body (Raw). */
  body?: string;
  /** Informational note (e.g. IFTTT opacity). */
  note?: string;
  /** Error message when the request could not be made/read. */
  error?: string;
}

/** Detailed test used by the phone settings page. */
export async function test(
  trigger: Trigger,
  key: string | null,
  signal?: AbortSignal,
): Promise<TestResult> {
  if (trigger.kind === 'raw') return testRaw(trigger, signal);

  // IFTTT: fire-and-forget; CORS hides the real outcome.
  if (!key) return { ok: false, error: 'Set your Webhooks key first' };
  if (!trigger.event?.trim()) return { ok: false, error: 'Event name required' };
  try {
    const url = buildTriggerUrl(trigger.event, key, trigger.values);
    await fetch(url, { method: 'POST', mode: 'no-cors', cache: 'no-store', signal });
    return { ok: true, note: 'Sent to IFTTT. CORS hides the real result (200 vs 401 vs 404).' };
  } catch {
    return { ok: false, error: 'No connection' };
  }
}

async function testRaw(trigger: Trigger, signal?: AbortSignal): Promise<TestResult> {
  const raw = trigger.raw;
  if (!raw?.url?.trim()) return { ok: false, error: 'URL required' };
  let res: Response;
  try {
    res = await rawFetch(trigger, signal);
  } catch (err) {
    return { ok: false, error: corsHint(err) };
  }
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* body not readable */
  }
  if (body.length > RESPONSE_PREVIEW_MAX) {
    body = `${body.slice(0, RESPONSE_PREVIEW_MAX)}\n…(${body.length} chars total, truncated)`;
  }
  return { ok: res.ok, status: res.status, statusText: res.statusText, body };
}

function rawFetch(trigger: Trigger, signal?: AbortSignal): Promise<Response> {
  const raw = trigger.raw;
  if (!raw || !raw.url.trim()) throw new Error('URL required');
  const headers: Record<string, string> = {};
  for (const h of raw.headers) {
    if (h.name.trim()) headers[h.name.trim()] = h.value;
  }
  const method = raw.method.toUpperCase();
  const bodyless = method === 'GET' || method === 'HEAD';
  return fetch(raw.url.trim(), {
    method,
    headers,
    body: bodyless || raw.body === '' ? undefined : raw.body,
    // 'cors' so the chosen method/headers are honored; the response is readable
    // only if the endpoint returns permissive CORS headers.
    mode: 'cors',
    cache: 'no-store',
    redirect: 'follow',
    signal,
  });
}

function corsHint(err: unknown): string {
  const msg = String((err as { message?: string })?.message ?? err) || 'Request failed';
  return (
    `${msg}. If this is a CORS/network error, the endpoint must send ` +
    `Access-Control-Allow-Origin (and answer preflight for custom headers/methods) ` +
    `for the app to read the response.`
  );
}
