# Changelog

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
