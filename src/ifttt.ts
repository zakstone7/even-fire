/**
 * IFTTT Webhooks URL construction.
 *
 * The plugin talks to maker.ifttt.com directly (no backend), constrained by
 * CORS: a POST with no custom headers and no JSON body is a CORS "simple
 * request" that fires the applet fire-and-forget (`mode: 'no-cors'`), but the
 * response is opaque — 200 / 401 / 404 are indistinguishable. So only two
 * honest states exist ('sent' / 'no-connection'); see execute.ts, which does
 * the actual fetch. The JSON-payload endpoint is unused (it forces a preflight
 * IFTTT won't answer).
 */

import type { TriggerValues } from './types';

const IFTTT_BASE = 'https://maker.ifttt.com';

/** Build the trigger URL with any value1..3 as query params. */
export function buildTriggerUrl(event: string, key: string, values?: TriggerValues): string {
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
