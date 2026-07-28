# Changelog

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
