# Fire relay (self-hosted)

A tiny, stateless HTTP fetch-proxy for the [Fire](../README.md) Even G2 plugin.

Fire runs in a WebView, so it can't read cross-origin responses (CORS) or use
arbitrary methods/headers against non-CORS hosts. This relay makes the request
**server-side** (no CORS there) and returns the real result to the app. Deploy
it to **your own Cloudflare account** and it's yours — nobody else can see your
requests or secrets.

## What it does / doesn't

- ✅ Proxies one HTTP request per call and returns `{ status, statusText, headers, body }`.
- ✅ Auth by a single shared secret you set (`RELAY_SECRET`).
- ✅ CORS-correct (the app can read the response), size + timeout caps, SSRF guard.
- ❌ No accounts, no billing, no request logging, no persistence.
- ❌ Can't reach your LAN (`192.168.x`, `localhost`, …) — those are blocked and
  should be fired **directly from the phone** in the app (per-trigger "use relay = off").

## Deploy (about 2 minutes)

```bash
cd relay
npm install
npx wrangler login
# set a long random secret (e.g. `openssl rand -base64 32`):
npx wrangler secret put RELAY_SECRET
npm run deploy
```

Wrangler prints your Worker URL, e.g. `https://fire-relay.you.workers.dev`.

In the Fire app → phone settings → **Relay**:

- **Relay URL** = that Worker URL
- **Relay secret** = the `RELAY_SECRET` you set

Then set **use relay = on** per Raw trigger you want routed through it.

## API

```
POST /fire        Authorization: Bearer <RELAY_SECRET>
                  { "method": "POST", "url": "https://…", "headers": { … }, "body": "…" }
  200  { ok, status, statusText, headers, body, truncated }
  401  unauthorized      403  blocked host (private/reserved)
  400  bad request       413  request too large
  502  upstream failed   504  upstream timeout

OPTIONS /fire     CORS preflight
GET /health       { ok: true }
```

The incoming `Authorization` (your relay secret) is **never** forwarded upstream —
the upstream request's headers come only from the `headers` you send.

## Config (optional `wrangler.toml` vars)

| var | default | meaning |
| --- | --- | --- |
| `ALLOWED_ORIGIN` | `*` | CORS allow-origin |
| `MAX_REQUEST_BYTES` | `131072` | max request body |
| `MAX_RESPONSE_BYTES` | `262144` | max response bytes returned |
| `TIMEOUT_MS` | `10000` | upstream timeout |
| `ALLOW_PRIVATE` | `false` | allow private/reserved hosts (leave off) |

## Test

```bash
npm test        # node --test, no Cloudflare account needed
```

## Cost

Cloudflare Workers bill per request with **no egress charges**; a personal relay
sits comfortably in the free tier.
