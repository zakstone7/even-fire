/**
 * Firing IFTTT webhooks from inside the WebView.
 *
 * The plugin talks to maker.ifttt.com directly — there is no backend. That is
 * possible but constrained by CORS (see README §"The CORS constraint"):
 *
 *   - A POST with no custom headers and no JSON body is a CORS "simple
 *     request": no preflight is sent, the browser delivers it, IFTTT fires the
 *     applet. Values ride along as query-string params (value1..3).
 *   - `mode: 'no-cors'` means the browser refuses to expose the response. We
 *     get an opaque response with `status === 0`. A 200, a 401 (bad key) and a
 *     404 (wrong event) are indistinguishable.
 *   - The fetch promise REJECTS only on a genuine transport failure and
 *     RESOLVES once any HTTP response arrives.
 *
 * So there are exactly two honest terminal states, and the UI must reflect
 * only these — never "Success"/"Done"/✓, which would imply the applet ran:
 *
 *   - 'sent'          — the request reached IFTTT (an HTTP response came back)
 *   - 'no-connection' — the request never left / no response (transport error)
 *
 * The Content-Type: application/json endpoint is deliberately unused: it forces
 * a preflight that IFTTT does not answer.
 */

import type { Trigger } from './types';

export type FireResult = 'sent' | 'no-connection';

const IFTTT_BASE = 'https://maker.ifttt.com';

/** Build the trigger URL with any value1..3 as query params. */
export function buildTriggerUrl(event: string, key: string, values?: Trigger['values']): string {
  const params = new URLSearchParams();
  if (values?.value1) params.set('value1', values.value1);
  if (values?.value2) params.set('value2', values.value2);
  if (values?.value3) params.set('value3', values.value3);
  const qs = params.toString();
  return (
    `${IFTTT_BASE}/trigger/${encodeURIComponent(event)}` +
    `/with/key/${encodeURIComponent(key)}` +
    (qs ? `?${qs}` : '')
  );
}

/**
 * Fire one trigger. Resolves to 'sent' or 'no-connection'; never rejects.
 *
 * @param signal optional AbortSignal (used to bound a hang, e.g. airplane mode)
 */
export async function fire(
  trigger: Trigger,
  key: string,
  signal?: AbortSignal,
): Promise<FireResult> {
  const url = buildTriggerUrl(trigger.event, key, trigger.values);
  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      // No custom headers, no body → stays a CORS "simple request".
      cache: 'no-store',
      redirect: 'follow',
      signal,
    });
    return 'sent';
  } catch {
    return 'no-connection';
  }
}
