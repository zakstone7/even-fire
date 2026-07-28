/**
 * Entry point + router.
 *
 * One bundle serves both surfaces. The Even App tells us how the page was
 * opened via the launch source:
 *   - 'glassesMenu' → drive the glasses UI (GlassesApp)
 *   - 'appMenu'     → show the phone settings page (SettingsApp)
 *
 * We subscribe to onLaunchSource before the host pushes it, load config in
 * parallel so the first glasses paint is immediate (matters for the locked-
 * phone review test), and route exactly once.
 */

import { waitForEvenAppBridge, type LaunchSource } from '@evenrealities/even_hub_sdk';
import { loadConfig } from './config';
import { GlassesApp } from './glasses';
import { SettingsApp } from './settings';

// If the host never delivers a launch source (shouldn't happen in the WebView),
// fall back to the phone settings so a visible page is never left blank.
const LAUNCH_FALLBACK_MS = 2000;

async function boot(): Promise<void> {
  const bridge = await waitForEvenAppBridge();
  const config = await loadConfig(bridge);

  let routed = false;
  const route = (source: LaunchSource | 'fallback') => {
    if (routed) return;
    routed = true;
    if (source === 'glassesMenu') {
      showGlassesStatus();
      void new GlassesApp(bridge, config).mount();
    } else {
      new SettingsApp(bridge, config).mount();
    }
  };

  bridge.onLaunchSource((source) => route(source));
  setTimeout(() => route('fallback'), LAUNCH_FALLBACK_MS);
}

/** Minimal DOM shown while the app is being driven on the glasses. */
function showGlassesStatus(): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.replaceChildren();
  const p = document.createElement('p');
  p.style.cssText = 'color:#8a9a8a;padding:32px 16px;font:15px sans-serif;';
  p.textContent = 'Fire is running on your glasses. Scroll to a trigger and tap to fire.';
  app.append(p);
}

function fail(message: string): void {
  const app = document.getElementById('app');
  if (app) app.textContent = message;
}

boot().catch((err) => {
  console.error(err);
  fail('Fire could not start. Open this from the Even App.');
});
