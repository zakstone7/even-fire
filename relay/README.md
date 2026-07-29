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

## Cost

This runs on **Cloudflare Workers' free tier**: 100,000 requests/day, no credit
card, and **no egress charges**. A personal relay never comes close to the
limit, so in practice it is free.

## Deploy — upload the file (no CLI, works from your phone)

You don't need Node, `wrangler`, or a terminal — just the one Worker file and
Cloudflare's dashboard. ~5 minutes.

### 1. Download the Worker

**Easiest — from the app:** open Fire on your phone → settings → **Relay** →
**⬇ Download `_worker.js`**. One tap saves the file (it's bundled into the app,
so this works offline). This is the recommended way.

Alternatives if you'd rather grab it from GitHub:

- **Direct link:** <https://github.com/zakstone7/even-fire/raw/claude/self-hosted-relay/relay/_worker.js>
  — tap, then save with your browser's **Save / Download** (share sheet →
  *Save to Files*, or ⋮ → *Download*).
- Or open [`_worker.js`](_worker.js) in the repo and use GitHub's **Download raw
  file** button (the ⤓ icon at the top-right).

Keep the name exactly **`_worker.js`** — Cloudflare only runs an uploaded file as
a Worker when it's named that.

### 2. Create the Worker from it

1. **Make a free Cloudflare account** at <https://dash.cloudflare.com/sign-up>
   (no card needed).
2. In the sidebar open **Build → Compute (Workers)** (older accounts show it as
   **Workers & Pages**). Click **Create application → Upload Static Files**
   (this deploys a Worker whose `_worker.js` handles every request).
3. Give it a name (e.g. `fire-relay` — this becomes your URL), **upload the
   `_worker.js`** you saved (drag it in, or pick it from Files/Downloads on your
   phone), and **Deploy**.

### 3. Set your secret

On the Worker's page go to **Settings → Variables and Secrets → Add**, name it
**`RELAY_SECRET`**, pick a long random value (30+ characters — use a password
manager's "suggest strong password"), choose **Encrypt** (a "Secret", not
plaintext), and **Deploy**. Save this value; you'll paste it into the app.

### 4. Check it's live

Your URL is on the Worker's page:
`https://fire-relay.<your-subdomain>.workers.dev`. Open it with `/health`
appended — you should see `{"ok":true}`.

### 5. Point the app at it

In the Fire app → phone settings → **Relay**:

- **Relay URL** = your Worker URL (e.g. `https://fire-relay.you.workers.dev`)
- **Relay secret** = the `RELAY_SECRET` you chose in step 3

Then set **use relay = on** per Raw trigger you want routed through it. Done.

> **If uploading the single file doesn't stick** (some dashboards want a folder,
> or serve the file instead of running it): fall back to **Create application →
> Hello World**, click **Edit code**, delete the starter, paste the contents of
> [`_worker.js`](_worker.js), and **Deploy**. Same result. Steps 3–5 are
> identical.
>
> Updating later: re-upload (or re-paste) the newest `_worker.js` and Deploy.
> Your secret and URL stay put.

## Deploy — with the CLI (if you already have Node)

```bash
cd relay
npm install
npx wrangler login
# set a long random secret (e.g. `openssl rand -base64 32`):
npx wrangler secret put RELAY_SECRET
npm run deploy
```

Wrangler prints your Worker URL, then configure the app exactly as above.

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

## Config (all optional)

Everything below has a sane default — you never need to set any of these to get
going. To change one, add it as a plaintext **Variable** in the dashboard
(**Settings → Variables and Secrets**, same place as the secret), or as a `[vars]`
entry in `wrangler.toml` if you use the CLI.

| var | default | meaning |
| --- | --- | --- |
| `ALLOWED_ORIGIN` | `*` | CORS allow-origin |
| `MAX_REQUEST_BYTES` | `131072` | max request body |
| `MAX_RESPONSE_BYTES` | `262144` | max response bytes returned |
| `TIMEOUT_MS` | `10000` | upstream timeout |
| `ALLOW_PRIVATE` | `false` | allow private/reserved hosts (leave off) |

`RELAY_SECRET` is the one thing you *must* set, and it's a **Secret** (encrypted),
not a plaintext Variable.

## Files

- `_worker.js` — the entire relay (Module Worker; this is what you upload/deploy).
- `.assetsignore` — keeps `_worker.js` from being served as a public file when
  deployed via "Upload Static Files".
- `wrangler.toml` — CLI deploy config (`main = "_worker.js"`).
- `test/worker.test.mjs` — the test suite.

## Test

```bash
cd relay
npm test        # node --test, no Cloudflare account needed
```
