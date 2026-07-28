# Fire

**Tap a name on your Even G2 glasses, fire a webhook.**

Fire shows a list of your triggers on the glasses. Scroll with the R1 ring or
temple touchpad, tap to select, and it sends an HTTP request to IFTTT's Webhooks
endpoint — firing that applet. No accounts, no backend, no telemetry.

- Target: Even Realities G2 (+ optional R1 ring)
- Distribution: Even Hub
- Built against `@evenrealities/even_hub_sdk@0.0.12`

> **Bring your own IFTTT Webhooks key.** The key is stored only on your phone
> (in the Even App). Anyone who has it can trigger *any* applet on your IFTTT
> account — see [Security](#security).

---

## How it works (and the one hard constraint)

There is **no server component**. The plugin, running in the Even App WebView,
calls `maker.ifttt.com` directly. That is possible but shaped by CORS.

### The CORS constraint

A `POST` with **no custom headers** and **no JSON body** is a CORS *simple
request*: no preflight is issued, the browser sends it, and IFTTT fires the
applet. Values ride along as query-string params (`value1..3`). With
`mode: 'no-cors'` the browser then refuses to expose the response.

```js
await fetch(
  `https://maker.ifttt.com/trigger/${event}/with/key/${key}?value1=hi`,
  { method: 'POST', mode: 'no-cors' }
);
```

Three consequences, which the UI is built around:

1. **No success confirmation.** The response is opaque (`status === 0`). A
   `200`, a `401` (bad key) and a `404` (wrong event) are indistinguishable.
2. **Network failure *is* detectable.** The fetch promise rejects on a genuine
   transport failure and resolves once any HTTP response arrives. That yields
   exactly two honest terminal states: **Sent** and **No connection**.
3. **The JSON payload endpoint is unusable.** `Content-Type: application/json`
   forces a preflight IFTTT won't answer. Fire uses the plain
   `Receive a web request` trigger with `value1/2/3` only.

The UI never says "Done" / "Success" / ✓ — only **Sent** (see `src/ifttt.ts`).

### ⚠️ M0 (verify the premise) — you must run this yourself

The plan's first task is to confirm, with `curl`, which encoding IFTTT accepts
and that CORS headers are still absent. **This could not be run in the build
environment**: outbound access to `maker.ifttt.com` is blocked by the sandbox
network policy (the proxy returns `403` to `CONNECT maker.ifttt.com:443`), so
the checks below are unverified. Run them on a normal network with your own key
and event before shipping:

```bash
# Bare POST with query-string values — expect HTTP 200 and the applet to fire.
curl -i -X POST "https://maker.ifttt.com/trigger/YOUR_EVENT/with/key/YOUR_KEY?value1=hello"

# Form-encoded body — does it also fire?
curl -i -X POST -H "Content-Type: application/x-www-form-urlencoded" \
  -d "value1=hello" "https://maker.ifttt.com/trigger/YOUR_EVENT/with/key/YOUR_KEY"

# Preflight — look for access-control-allow-origin. It should be ABSENT.
curl -i -X OPTIONS "https://maker.ifttt.com/trigger/YOUR_EVENT/with/key/YOUR_KEY"
```

If that last command now returns CORS headers, the premise has changed: real
status codes become available and the confirmation UX should be upgraded to
report actual outcomes (200 vs 401 vs 404) instead of just "Sent".

---

## Verified against the SDK (was "VERIFY" in the plan)

Reading the installed `@evenrealities/even_hub_sdk@0.0.12` type definitions
confirmed / corrected several assumptions:

- **Storage** is `bridge.setLocalStorage(key, value)` / `getLocalStorage(key)`,
  values are strings. ✓
- **Launch source** values are exactly `'appMenu' | 'glassesMenu'`, pushed once
  via `bridge.onLaunchSource(cb)`. ✓
- **Exit** is `bridge.shutDownPageContainer(mode)` — `0` = exit immediately,
  `1` = pop the system foreground layer and let the user decide. Root
  double-tap uses `1`. ✓
- **The glasses list is an OS-native widget.** You hand a `ListContainer` an
  `itemContainer.itemName[]` array and set `isEventCapture: 1`; the OS renders
  rows, moves the selection highlight on scroll, and reports the highlighted
  index on tap as a `CLICK_EVENT`. Fire does **not** render rows or track
  scrolling manually — this is simpler than the plan assumed.
- **Events** arrive through `bridge.onEvenHubEvent(cb)` as `listEvent` /
  `textEvent` / `sysEvent`, each carrying an `OsEventTypeList` (`CLICK_EVENT`,
  `DOUBLE_CLICK_EVENT`, `SCROLL_TOP/BOTTOM_EVENT`, `SYSTEM_EXIT_EVENT`, …).
- **`app.json` schema correction.** The CLI validates `app.json` with a strict
  schema. The plan's manifest was **missing three required fields** —
  `edition` (`"202601"`), `min_app_version`, and `supported_languages` — which
  would have failed `evenhub pack`. `author` is not a schema field. The
  manifest here is the corrected form.

Canvas is 576×288, 4-bit greyscale (16 shades, rendered green), top-left origin.

---

## Project layout

```
app.json              Even Hub manifest (validated by `evenhub pack`)
index.html → src/     Web entry (built to dist/index.html)
build.mjs             esbuild bundler → dist/ (index.html + app.js)
src/
  main.ts             Bridge init + route by launch source
  types.ts            FireConfig / Trigger data model + limits
  config.ts           Atomic load/save + migration through SDK storage
  ifttt.ts            fire() — the CORS-safe request, two honest results
  glasses.ts          Glasses UI state machine (OS list/text containers)
  settings.ts         Phone settings page (key entry, CRUD, reorder, test)
  util.ts             uuid, label clamp, key masking
assets/               Monochrome icon foreground + background (+ generator)
tools/genicons.py     Regenerates the greyscale icons (pure stdlib)
```

## Data model

Stored as one JSON blob under `fire.config.v1` (atomic reads/writes). Always
branch on `version`; never assume shape (see `src/config.ts`).

```ts
interface FireConfig {
  version: 1;
  key: string | null;                 // IFTTT Webhooks key
  triggers: Trigger[];                // capped at 12
}
interface Trigger {
  id: string;                         // uuid, stable across renames
  label: string;                      // shown on glasses, <= 20 chars
  event: string;                      // IFTTT event name
  values?: { value1?: string; value2?: string; value3?: string };
  confirm: boolean;                   // two-step tap before firing
  order: number;
}
```

## Glasses screens

| Screen | When | Input |
| --- | --- | --- |
| **List** (root) | key set + ≥1 trigger | scroll = highlight, tap = select, double-tap = exit dialog |
| **Confirm** | selected trigger has `confirm: true` | 2-item list `Cancel` (default) / `Fire …` |
| **Sending** | during the request | — |
| **Sent** | request reached IFTTT | tap or ~2s auto-dismiss → list |
| **No connection** | transport failure | tap = retry, double-tap = back |
| **Key missing** | `key === null` | points to the phone app |
| **Empty** | no triggers | points to the phone app |

Repeat taps on the same trigger are debounced (~1.5s) to survive a bouncy pad.

## Build & run

Requires Node 20 LTS or 22+.

```bash
npm install
npm run typecheck      # tsc --noEmit
npm run build          # → dist/ (index.html + bundled app.js)

# Preview in the simulator (a supplement to hardware, never a replacement):
npx @evenrealities/evenhub-simulator dist
```

### Sideload onto the glasses

`npm run dev` rebuilds on save **and** hosts `dist/` on your LAN (default port
8080), then prints the exact `qr` command to run. `evenhub qr` itself only
generates a QR for a URL — it does not host your files, which is why the dev
server does.

```bash
npm run dev
# → prints:  npx @evenrealities/evenhub-cli qr --ip <your-LAN-IP> --port 8080
```

Run that `qr` command in a second terminal and scan the QR in the Even App
(phone → EvenHub / developer → scan). Open the app from the glasses menu for the
on-glass trigger list, or the app menu for the phone settings page.

Requirements & gotchas:

- Phone and computer on the **same Wi-Fi**, no AP isolation / firewall — the #1
  "QR scans but never loads" cause. Sanity-check by opening
  `http://<your-LAN-IP>:8080/` in the phone browser (blank page is expected —
  the bridge only exists inside the Even App — but it proves reachability).
- A **desktop browser can't run the plugin**: there's no
  `window.flutter_inappwebview` bridge outside the Even App, so storage, `fire()`
  and the glasses containers only work via the app (or the simulator).
- `evenhub login` is **not** needed to sideload — that's for `pack`/portal.
- `npm run serve` hosts a prebuilt `dist/` without watching; `npm run dev` does
  both.

## Package & submit

```bash
npx @evenrealities/evenhub-cli login
npx @evenrealities/evenhub-cli pack app.json dist -o fire.ehpk
```

Then upload `fire.ehpk` on the dev portal with the assets in `assets/` and
simulator screenshots. See [`assets/README.md`](assets/README.md) and the
[submission checklist](#submission-checklist).

## Security

The IFTTT Webhooks key is the only credential and it identifies your whole IFTTT
account: **anyone holding it can trigger any applet on that account.** Fire
keeps it only in phone-side local storage (via the Even App), never renders it
on the glasses, and masks it in the settings UI (last 4 chars). This is stated
in the app description and on the settings screen. Get your key at
<https://ifttt.com/maker_webhooks/settings>.

## Milestone status

| | | |
| --- | --- | --- |
| M0 | Verify the premise | ⚠️ **You must run** — IFTTT blocked in this env (see above) |
| M1 | Toolchain | ✅ builds & typechecks against SDK 0.0.12 |
| M2 | Static list on glass | ✅ implemented (OS list container) |
| M3 | Fire + 4 states | ✅ implemented |
| M4 | Persistence + settings | ✅ implemented |
| M5 | Hardening | ✅ debounce, confirm gate, label clamp, exit, empty/error states |
| M6 | The lock test | ⛔ **requires hardware** — verify on real glasses, phone locked |
| M7 | Submit | ⛔ needs `evenhub login`, real assets/screenshots, portal upload |

## Submission checklist

- [ ] Icon legible; foreground **and** background both supplied, greyscale only
- [ ] Screenshots from the simulator, matching on-device render
- [ ] Display name identical in `app.json`, portal, and on-glasses
- [ ] `entrypoint` (`index.html`) resolves inside `dist/`
- [ ] The declared `network` permission is genuinely used (it is — `fire()`)
- [ ] Non-empty changelog on version updates
- [ ] Description discloses the key is stored on the phone and grants full
      account access

## Remaining VERIFY items

- Run **M0** on a real network (above).
- Confirm the dev portal's exact icon dimensions / screenshot requirements.
- Confirm `min_sdk_version` (`0.0.10`, chosen for the 0.0.10 WebView
  keep-alive that matters to the M6 lock test) against the current portal floor.
- Test the full flow on hardware with the phone locked (**M6**).

## License

MIT — see [LICENSE](LICENSE).
