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
import { diag, initDiag } from './diag';

// If the host never delivers a launch source (shouldn't happen in the WebView),
// fall back to the phone settings so a visible page is never left blank.
const LAUNCH_FALLBACK_MS = 2000;

async function boot(): Promise<void> {
  const bridge = await waitForEvenAppBridge();
  await initDiag(bridge); // load prior log so this launch appends, not overwrites
  diag({ boot: true });

  // Subscribe to the launch source SYNCHRONOUSLY, before awaiting anything else.
  // The host pushes it exactly once shortly after load and never replays it, so
  // if we await storage first we can miss it — which on a glasses launch leaves
  // the display blank (the phone launch survives because it's the fallback too).
  // Loading config runs in parallel so the first glasses paint stays prompt.
  const sourcePromise = new Promise<LaunchSource | 'fallback'>((resolve) => {
    bridge.onLaunchSource((s) => resolve(s));
    setTimeout(() => resolve('fallback'), LAUNCH_FALLBACK_MS);
  });
  const configPromise = loadConfig(bridge);

  const [source, config] = await Promise.all([sourcePromise, configPromise]);
  console.log('[fire] launch source:', source);
  diag({ source, keySet: !!config.key, triggers: config.triggers.length });

  if (source === 'glassesMenu') {
    diag({ route: 'glasses' });
    showGlassesStatus();
    await new GlassesApp(bridge, config).mount();
  } else {
    diag({ route: 'settings' });
    new SettingsApp(bridge, config).mount();
  }
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
  diag({ bootError: String(err && (err.stack || err.message || err)) });
  fail('Fire could not start. Open this from the Even App.');
});
