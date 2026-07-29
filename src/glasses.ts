/**
 * Glasses-side UI.
 *
 * The Even OS provides native List and Text containers. We do NOT render rows
 * ourselves: a List container is handed an `itemName[]` array and the OS draws
 * it, moves the selection highlight on ring-scroll / temple-swipe (emitting
 * SCROLL_TOP/BOTTOM, which we ignore), and reports the highlighted index back
 * on a tap via a CLICK_EVENT. That collapses "scroll + select" into a single
 * event we handle.
 *
 * Screen flow (see README §"Glasses screens"):
 *   list ──tap──▶ (confirm?) ──▶ sending ──▶ sent (auto-dismiss ~2s) ──▶ list
 *                                     └──────▶ no-connection ──tap──▶ retry
 *   key-missing / empty are shown instead of the list when appropriate.
 *
 * Honesty rule: a resolved fetch shows "Sent", never "Success"/"Done"/✓ — CORS
 * makes the real applet outcome invisible (see ifttt.ts).
 */

import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import type { FireConfig, Trigger } from './types';
import { send } from './execute';
import { diag } from './diag';

// --- Canvas + layout (top-left origin). Canvas is 576 x 288, 4-bit greyscale.
const CANVAS_W = 576;
const CANVAS_H = 288;
const MARGIN = 28;
const CONTENT_W = CANVAS_W - MARGIN * 2;

// Stable container IDs. The capturing container is the list (or the text on
// message screens); the title is a non-capturing label.
const LIST_ID = 1;
const TEXT_ID = 2;
const TITLE_ID = 3;

/** Title shown at the top of the trigger list. */
const TITLE = 'Fire';

// Debounce window for repeat taps on the same trigger (bouncy touchpad guard).
const DEBOUNCE_MS = 1500;
// How long "Sent" stays before auto-returning to the list.
const SENT_DISMISS_MS = 2000;
// Upper bound on a single fire attempt before we call it "no connection".
const FIRE_TIMEOUT_MS = 8000;

type Screen = 'list' | 'confirm' | 'sending' | 'sent' | 'no-connection' | 'key-missing' | 'empty';

/** A page payload accepted by both create + rebuild (shared field shape). */
interface Page {
  containerTotalNum: number;
  listObject?: ListContainerProperty[];
  textObject?: TextContainerProperty[];
}

export class GlassesApp {
  private mounted = false;
  private screen: Screen = 'list';
  private unsub: (() => void) | null = null;

  /** Trigger awaiting confirmation (confirm screen). */
  private pending: Trigger | null = null;
  /** Last trigger we tried to fire (for retry from the no-connection screen). */
  private lastAttempt: Trigger | null = null;
  /** Debounce bookkeeping: last fired trigger id + timestamp. */
  private lastFire: { id: string; ts: number } | null = null;

  private sentTimer: ReturnType<typeof setTimeout> | null = null;
  private fireAbort: AbortController | null = null;

  constructor(
    private readonly bridge: EvenAppBridge,
    private config: FireConfig,
  ) {}

  /** Called if the phone edits config while the glasses page is open. */
  updateConfig(config: FireConfig): void {
    this.config = config;
    if (this.screen === 'list' || this.screen === 'empty' || this.screen === 'key-missing') {
      void this.renderRoot();
    }
  }

  async mount(): Promise<void> {
    this.unsub = this.bridge.onEvenHubEvent((e) => this.handleEvent(e));
    await this.renderRoot();
  }

  dispose(): void {
    if (this.unsub) this.unsub();
    this.unsub = null;
    this.clearSentTimer();
    this.abortFire();
  }

  // --- Rendering -----------------------------------------------------------

  /** Root screen: empty when there are no triggers, otherwise the list.
   * (The IFTTT key is only needed to fire an IFTTT trigger, checked at fire
   * time — a raw-only setup never needs a key.) */
  private async renderRoot(): Promise<void> {
    if (this.config.triggers.length === 0) return this.setScreen('empty');
    return this.setScreen('list');
  }

  private async setScreen(screen: Screen, trigger?: Trigger): Promise<void> {
    this.screen = screen;
    this.pending = screen === 'confirm' ? (trigger ?? null) : this.pending;
    await this.render(this.pageFor(screen, trigger));
  }

  private pageFor(screen: Screen, trigger?: Trigger): Page {
    switch (screen) {
      case 'list':
        return listPage(this.orderedLabels());
      case 'confirm':
        return listPage([cancelLabel(), `Fire ${trigger?.label ?? ''}`.trim()]);
      case 'sending':
        return textPage('Sending…');
      case 'sent':
        return textPage('Sent');
      case 'no-connection':
        return textPage('No connection\nTap to retry');
      case 'key-missing':
        return textPage('Set your Webhooks key\nin the phone app');
      case 'empty':
        return textPage('No triggers yet\nAdd them in the phone app');
    }
  }

  /** First paint uses createStartUpPageContainer; later paints rebuild. */
  private async render(page: Page): Promise<void> {
    if (!this.mounted) {
      let result: StartUpPageCreateResult | undefined;
      try {
        result = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page));
      } catch (err) {
        diag({ createError: String(err), screen: this.screen });
        console.error('[fire] createStartUpPageContainer threw:', err);
        return;
      }
      console.log('[fire] createStartUpPageContainer →', result, 'screen:', this.screen);
      this.mounted = result === StartUpPageCreateResult.success;
      diag({ createResult: result, mounted: this.mounted, screen: this.screen, items: this.orderedLabels().length });
      if (!this.mounted) {
        // Nothing more we can do on-glass; surface for debugging.
        console.error('[fire] createStartUpPageContainer failed:', result);
      }
      return;
    }
    await this.bridge.rebuildPageContainer(new RebuildPageContainer(page));
  }

  private orderedLabels(): string[] {
    return [...this.config.triggers].sort((a, b) => a.order - b.order).map((t) => t.label);
  }

  private triggerAt(index: number): Trigger | undefined {
    return [...this.config.triggers].sort((a, b) => a.order - b.order)[index];
  }

  // --- Event handling ------------------------------------------------------

  private handleEvent(event: EvenHubEvent): void {
    diag({
      evt: event.sysEvent
        ? `sys:${event.sysEvent.eventType}`
        : event.listEvent
          ? `list:${event.listEvent.eventType}@${event.listEvent.currentSelectItemIndex}`
          : event.textEvent
            ? `text:${event.textEvent.eventType}`
            : 'unknown',
      onScreen: this.screen,
      // Raw host payload — the parsed eventType/index are coming through
      // undefined, so capture the real keys/values the host sends.
      raw: event.jsonData ?? null,
    });
    // System events fire regardless of the active container.
    const sys = event.sysEvent;
    if (sys) {
      switch (sys.eventType) {
        case OsEventTypeList.SYSTEM_EXIT_EVENT:
        case OsEventTypeList.ABNORMAL_EXIT_EVENT:
          this.dispose();
          return;
        default:
          return; // foreground enter/exit, IMU, etc. — nothing to do
      }
    }

    // The active capturing container reports taps as list or text events.
    const listEvt = event.listEvent;
    const textEvt = event.textEvent;
    if (!listEvt && !textEvt) return;

    // CLICK_EVENT is enum value 0 and the transport strips zero-valued fields,
    // so a tap arrives with eventType === undefined. Treat a missing eventType
    // on a list/text event as a click. A selected index of 0 is likewise
    // stripped to undefined, so default it to 0. (Non-zero eventTypes — scroll
    // (1/2), double-click (3) — arrive intact.)
    const rawType = listEvt?.eventType ?? textEvt?.eventType;
    const type = rawType == null ? OsEventTypeList.CLICK_EVENT : rawType;
    const index = listEvt?.currentSelectItemIndex ?? 0;

    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      this.handleDoubleClick();
      return;
    }
    if (type === OsEventTypeList.CLICK_EVENT) {
      this.handleClick(index);
      return;
    }
    // SCROLL_TOP/BOTTOM: OS moves the highlight itself — ignore.
  }

  private handleDoubleClick(): void {
    if (this.screen === 'list' || this.screen === 'empty' || this.screen === 'key-missing') {
      // Root double-tap → system exit dialog (mode 1 = let user decide).
      void this.bridge.shutDownPageContainer(1);
    } else {
      // Any transient screen: back out to root.
      void this.renderRoot();
    }
  }

  private handleClick(index: number): void {
    switch (this.screen) {
      case 'list': {
        const trigger = this.triggerAt(index);
        if (!trigger) return;
        if (trigger.confirm) void this.setScreen('confirm', trigger);
        else void this.attemptFire(trigger);
        return;
      }
      case 'confirm': {
        // Item 0 = Cancel (safe default), item 1 = Fire.
        if (index === 1 && this.pending) void this.attemptFire(this.pending);
        else void this.renderRoot();
        return;
      }
      case 'no-connection': {
        if (this.lastAttempt) void this.attemptFire(this.lastAttempt);
        else void this.renderRoot();
        return;
      }
      case 'sent':
        this.clearSentTimer();
        void this.renderRoot();
        return;
      default:
        return;
    }
  }

  // --- Firing --------------------------------------------------------------

  private async attemptFire(trigger: Trigger): Promise<void> {
    // Debounce repeat taps on the same trigger.
    const now = Date.now();
    if (this.lastFire && this.lastFire.id === trigger.id && now - this.lastFire.ts < DEBOUNCE_MS) {
      return;
    }
    if (trigger.kind === 'ifttt' && !this.config.key) {
      void this.setScreen('key-missing');
      return;
    }
    this.lastFire = { id: trigger.id, ts: now };
    this.lastAttempt = trigger;
    this.pending = null;

    await this.setScreen('sending');

    this.abortFire();
    const ctrl = new AbortController();
    this.fireAbort = ctrl;
    const timer = setTimeout(() => ctrl.abort(), FIRE_TIMEOUT_MS);

    const result = await send(trigger, this.config.key, ctrl.signal);
    clearTimeout(timer);
    if (this.fireAbort === ctrl) this.fireAbort = null;

    if (result === 'sent') {
      await this.setScreen('sent');
      this.scheduleSentDismiss();
    } else {
      await this.setScreen('no-connection');
    }
  }

  private scheduleSentDismiss(): void {
    this.clearSentTimer();
    this.sentTimer = setTimeout(() => {
      this.sentTimer = null;
      if (this.screen === 'sent') void this.renderRoot();
    }, SENT_DISMISS_MS);
  }

  private clearSentTimer(): void {
    if (this.sentTimer) clearTimeout(this.sentTimer);
    this.sentTimer = null;
  }

  private abortFire(): void {
    if (this.fireAbort) this.fireAbort.abort();
    this.fireAbort = null;
  }
}

// --- Page builders ---------------------------------------------------------

function cancelLabel(): string {
  return 'Cancel';
}

function listPage(items: string[]): Page {
  const TITLE_H = 40;
  const LIST_TOP = TITLE_H + 12;
  const title = new TextContainerProperty({
    xPosition: MARGIN,
    yPosition: 8,
    width: CONTENT_W,
    height: TITLE_H,
    containerID: TITLE_ID,
    containerName: 'fire-title',
    isEventCapture: 0, // label only; the list captures input
    content: TITLE,
  });
  const list = new ListContainerProperty({
    xPosition: MARGIN,
    yPosition: LIST_TOP,
    width: CONTENT_W,
    height: CANVAS_H - LIST_TOP - MARGIN,
    containerID: LIST_ID,
    containerName: 'fire-list',
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length,
      itemWidth: CONTENT_W,
      isItemSelectBorderEn: 1,
      itemName: items,
    }),
  });
  return { containerTotalNum: 2, listObject: [list], textObject: [title] };
}

function textPage(content: string): Page {
  const title = new TextContainerProperty({
    xPosition: MARGIN,
    yPosition: 8,
    width: CONTENT_W,
    height: 40,
    containerID: TITLE_ID,
    containerName: 'fire-title',
    isEventCapture: 0, // label only; the message text captures input
    content: TITLE,
  });
  const text = new TextContainerProperty({
    xPosition: MARGIN,
    yPosition: Math.round(CANVAS_H / 2) - 20,
    width: CONTENT_W,
    height: 80,
    containerID: TEXT_ID,
    containerName: 'fire-text',
    isEventCapture: 1,
    content,
  });
  return { containerTotalNum: 2, textObject: [title, text] };
}
