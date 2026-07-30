# Changelog

## 0.3.3

- Fix: when a fire failed, the glasses "No connection" screen only let you tap to
  retry — the only way back to the list was an undiscoverable double-tap. It's
  now a 2-item list, **Retry** / **Back**, so returning to the menu is always a
  visible choice.

## 0.3.2

- Support is now via GitHub Issues, not email: the settings have a **Report an
  issue on GitHub** button (opens the repo's issue tracker) in place of the old
  mailto "Contact support" flow.
- New **📖 Setup instructions** button in the Relay settings that opens the
  step-by-step relay guide, next to the Download `_worker.js` button.

- The self-hosted relay lives in [`relay/`](relay/) again (a separate repo
  bought nothing — Cloudflare can't import a repo). The Worker is a single
  `_worker.js` you download and upload straight to the Cloudflare dashboard
  ("Upload Static Files"), no CLI needed; the relay README has a download link
  and step-by-step guide. The in-app Relay help links to that guide.
- One-click **Download `_worker.js`** button in the phone Relay settings — the
  Worker source is bundled at build time (from `relay/_worker.js`, single source
  of truth), so it saves offline with a single tap. No GitHub round-trip needed.

## 0.3.1

- Add an optional "Buy me a coffee" tip button to the phone settings. Fire stays
  free with no accounts or backend; there is no paid tier. Set `COFFEE_URL` in
  `src/settings.ts` to your own page.

## 0.3.0

- Self-hosted relay support. Configure a relay (URL + secret) you host yourself
  (see relay/) and enable it per trigger to get real responses (status + body)
  for any host, bypassing the WebView's CORS limits. Local endpoints stay direct
  (relays can't reach a LAN) and the toggle is gated off for them.
- Glasses now show the real relayed status (e.g. "Fired 200" / "Failed 401")
  instead of just "Sent" when a trigger uses the relay.
- Recent-calls history, stored on-device only, with a configurable cap.
- Contact-support button that prefills recent diagnostics.
- Config migrated to v3 (adds relay, per-trigger useRelay, history limit).

## 0.2.2

- Diagnostics: stop logging the raw host event payload now that tap handling is
  fixed; keep the lightweight event trace.
- Docs: README documents Raw triggers, the v2 data model, and the CORS limits.

## 0.2.1

- Fix: allow Raw triggers to reach arbitrary hosts. The network permission
  whitelist only listed maker.ifttt.com, which restricts the app to that host;
  a non-empty whitelist is an allowlist. Set it to [] (no host restriction, as
  used by other apps with user-configured endpoints) and update the disclosure
  to cover IFTTT + user-entered Raw endpoints.

## 0.2.0

- Triggers are now shown in a reorderable table (up/down), with Edit and Delete.
- Adding a trigger starts with an IFTTT / Raw choice:
  - IFTTT: the existing event + value1..3 behavior.
  - Raw: an arbitrary HTTP request (method, URL, headers, body). "Test fire"
    shows the status code and a truncated (<=500 char) response body — subject
    to CORS: the response is readable only when the endpoint sends
    Access-Control-Allow-Origin, and custom headers/methods are preflighted.
- Config migrated to v2 (adds trigger `kind`); v1 triggers become IFTTT.
- Raw triggers need no IFTTT key; the glasses key-missing screen now only
  appears when firing an IFTTT trigger without a key.

## 0.1.9

- Show the "Fire" title on the message screens too (Sending / Sent / No
  connection / Key missing / Empty), for consistency with the trigger list.

## 0.1.8

- Add a "Fire" title above the trigger list on the glasses.

## 0.1.7

- Fix: tapping a trigger on the glasses did nothing. CLICK_EVENT is enum value
  0 and the transport strips zero-valued fields, so a tap arrives with
  eventType (and a 0 index) undefined. Fire now treats a list/text event with a
  missing eventType as a click and a missing index as 0 — so taps fire the
  selected trigger.

## 0.1.6

- Diagnostics: capture the raw host event payload, to fix glasses taps not
  firing (the parsed eventType/index were coming through undefined).

## 0.1.5

- Fix: the glasses never rendered. Fire only created the glasses page when it
  detected a `glassesMenu` launch, but a beta/test build only ever launches as
  `appMenu`, so the glasses page was never created — which also stopped the app
  being recognized as a glasses app. Matching the official templates, Fire now
  creates the glasses page on every launch (unconditionally) and renders the
  phone settings as an additional surface. Editing triggers on the phone now
  refreshes the glasses list live.

## 0.1.4

- Fix: the diagnostics log was overwritten on every launch, so opening the phone
  app to read it erased the glasses-launch trace. The log is now append-only
  across launches (last 40 entries), so a glasses launch survives being read on
  the phone.

## 0.1.3

- Add a Copy button to the Glasses diagnostics panel to copy the full log to the
  clipboard (with a WebView-safe fallback).

## 0.1.2

- Add a "Glasses diagnostics" panel to the phone settings: the glasses launch
  records its launch source, whether it sees a key/triggers, the container
  result, and incoming input events to storage, viewable on the phone. Helps
  diagnose why the glasses view isn't appearing.

## 0.1.1

- Fix: the glasses view could stay blank when the app was opened from the
  glasses menu. The launch-source event was sometimes missed while loading
  saved config, routing the glasses launch to the phone-only settings view.
  The app now subscribes to the launch source before loading config.

## 0.1.0

- Initial release. Trigger list on the glasses; tap to fire an IFTTT webhook
  (Sent / No connection). Phone settings for the Webhooks key and trigger
  CRUD, reorder, per-trigger confirm, and test fire.
