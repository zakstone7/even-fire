/**
 * Firing triggers — direct or via a self-hosted relay.
 *
 * `execute()` is the single entry point for both the glasses (fire-and-forget)
 * and the phone "Test fire" (which reads status/body). Routing:
 *
 *   - trigger.useRelay + a configured relay  → POST the request spec to the
 *     relay's /fire; it makes the call server-side (no CORS) and returns the
 *     real { status, body }. Works for any host and any method/headers.
 *   - otherwise                              → fire directly from the WebView:
 *       · IFTTT: fire-and-forget no-cors POST (opaque result under CORS)
 *       · Raw:   cors fetch (status/body readable only if the endpoint allows)
 *
 * Local endpoints must NOT use the relay (a cloud relay can't reach a LAN) —
 * they stay direct-from-device. The settings UI enforces that default.
 */

import { RESPONSE_PREVIEW_MAX, relayConfigured, type RelayConfig, type Trigger } from './types';
import { buildTriggerUrl } from './ifttt';

export interface FireResult {
  /** Terminal transport state. 'sent' = a response came back (or reached IFTTT). */
  result: 'sent' | 'no-connection';
  via: 'direct' | 'relay';
  /** Upstream HTTP status when known (relay always; direct-Raw when CORS allows). */
  status?: number;
  statusText?: string;
  ok?: boolean;
  /** Truncated response body (phone display). */
  body?: string;
  /** Set when the request couldn't be made or the relay refused it. */
  error?: string;
  /** Informational note (e.g. IFTTT opacity on a direct fire). */
  note?: string;
}

export interface ExecuteCtx {
  key: string | null;
  relay?: RelayConfig;
  /** true for the phone Test fire (read + return the response body). */
  readBody?: boolean;
  signal?: AbortSignal;
}

export async function execute(trigger: Trigger, ctx: ExecuteCtx): Promise<FireResult> {
  if (trigger.useRelay && relayConfigured(ctx.relay)) return viaRelay(trigger, ctx, ctx.relay);
  return direct(trigger, ctx);
}

// --- Relay path ------------------------------------------------------------

interface RequestSpec {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

function specFor(trigger: Trigger, key: string | null): RequestSpec | { error: string } {
  if (trigger.kind === 'raw') {
    const raw = trigger.raw;
    if (!raw?.url.trim()) return { error: 'URL required' };
    const headers: Record<string, string> = {};
    for (const h of raw.headers) if (h.name.trim()) headers[h.name.trim()] = h.value;
    return { method: raw.method, url: raw.url.trim(), headers, body: raw.body };
  }
  if (!key) return { error: 'Set your Webhooks key first' };
  if (!trigger.event?.trim()) return { error: 'Event name required' };
  return { method: 'POST', url: buildTriggerUrl(trigger.event, key, trigger.values), headers: {}, body: '' };
}

async function viaRelay(trigger: Trigger, ctx: ExecuteCtx, relay: RelayConfig): Promise<FireResult> {
  const spec = specFor(trigger, ctx.key);
  if ('error' in spec) return { result: 'no-connection', via: 'relay', error: spec.error };

  const endpoint = `${relay.url.replace(/\/+$/, '')}/fire`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${relay.secret}` },
      body: JSON.stringify(spec),
      signal: ctx.signal,
    });
  } catch {
    return { result: 'no-connection', via: 'relay', error: 'Relay unreachable' };
  }

  if (!res.ok) {
    const error =
      res.status === 401
        ? 'Relay rejected the secret (check the relay secret)'
        : res.status === 403
          ? 'Relay blocked this host (private/reserved — fire local endpoints directly)'
          : `Relay error ${res.status}`;
    return { result: 'no-connection', via: 'relay', error };
  }

  let env: { ok?: boolean; status?: number; statusText?: string; body?: string; error?: string };
  try {
    env = await res.json();
  } catch {
    return { result: 'no-connection', via: 'relay', error: 'Bad relay response' };
  }
  if (env.error) return { result: 'no-connection', via: 'relay', error: env.error };

  return {
    result: 'sent',
    via: 'relay',
    status: env.status,
    statusText: env.statusText,
    ok: env.ok,
    body: ctx.readBody ? truncate(env.body ?? '') : undefined,
  };
}

// --- Direct path -----------------------------------------------------------

async function direct(trigger: Trigger, ctx: ExecuteCtx): Promise<FireResult> {
  if (trigger.kind === 'raw') return directRaw(trigger, ctx);

  // IFTTT: fire-and-forget; CORS hides the real outcome.
  if (!ctx.key) return { result: 'no-connection', via: 'direct', error: 'Set your Webhooks key first' };
  if (!trigger.event?.trim()) return { result: 'no-connection', via: 'direct', error: 'Event name required' };
  try {
    const url = buildTriggerUrl(trigger.event, ctx.key, trigger.values);
    await fetch(url, { method: 'POST', mode: 'no-cors', cache: 'no-store', signal: ctx.signal });
    return { result: 'sent', via: 'direct', note: 'Sent to IFTTT. CORS hides the real result — turn on the relay to see it.' };
  } catch {
    return { result: 'no-connection', via: 'direct' };
  }
}

async function directRaw(trigger: Trigger, ctx: ExecuteCtx): Promise<FireResult> {
  const raw = trigger.raw;
  if (!raw?.url.trim()) return { result: 'no-connection', via: 'direct', error: 'URL required' };
  const headers: Record<string, string> = {};
  for (const h of raw.headers) if (h.name.trim()) headers[h.name.trim()] = h.value;
  const method = raw.method.toUpperCase();
  const bodyless = method === 'GET' || method === 'HEAD';

  let res: Response;
  try {
    res = await fetch(raw.url.trim(), {
      method,
      headers,
      body: bodyless || raw.body === '' ? undefined : raw.body,
      mode: 'cors',
      cache: 'no-store',
      redirect: 'follow',
      signal: ctx.signal,
    });
  } catch (err) {
    return { result: 'no-connection', via: 'direct', error: corsHint(err) };
  }

  let body: string | undefined;
  if (ctx.readBody) {
    try {
      body = truncate(await res.text());
    } catch {
      /* body not readable */
    }
  }
  return { result: 'sent', via: 'direct', status: res.status, statusText: res.statusText, ok: res.ok, body };
}

// --- helpers ---------------------------------------------------------------

function truncate(body: string): string {
  if (body.length <= RESPONSE_PREVIEW_MAX) return body;
  return `${body.slice(0, RESPONSE_PREVIEW_MAX)}\n…(${body.length} chars total, truncated)`;
}

function corsHint(err: unknown): string {
  const msg = String((err as { message?: string })?.message ?? err) || 'Request failed';
  return (
    `${msg}. If this is a CORS/network error, the endpoint must send ` +
    `Access-Control-Allow-Origin — or turn on the relay for this trigger.`
  );
}
