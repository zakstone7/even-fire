/**
 * Entry point.
 *
 * Every Even Hub app creates its glasses page on boot, unconditionally — the
 * official templates all call createStartUpPageContainer at startup and none of
 * them branch on the launch source. Registering that startup page is what puts
 * the app on the glasses and marks it as a glasses app.
 *
 * So Fire ALWAYS drives the glasses (the trigger list), and ALSO renders the
 * phone settings page — which is only visible when the app is opened on the
 * phone. The launch source is recorded for diagnostics but never gates render.
 */

import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';
import { loadConfig } from './config';
import { GlassesApp } from './glasses';
import { SettingsApp } from './settings';
import { diag, initDiag } from './diag';

async function boot(): Promise<void> {
  const bridge = await waitForEvenAppBridge();
  await initDiag(bridge); // load prior log so this launch appends, not overwrites
  const config = await loadConfig(bridge);
  diag({ boot: true, keySet: !!config.key, triggers: config.triggers.length });

  // Record the launch source for diagnostics only — render is NOT gated on it.
  bridge.onLaunchSource((s) => diag({ source: s }));

  // Always drive the glasses. This creates the startup page (rendering the
  // trigger list) and registers Fire as a glasses app.
  const glasses = new GlassesApp(bridge, config);
  void glasses.mount();

  // Always render the phone settings UI too; it's only seen when Fire is opened
  // on the phone. When config changes there, refresh the glasses list live.
  new SettingsApp(bridge, config, () => glasses.updateConfig(config)).mount();
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
