/**
 * Phone-side settings page (plain DOM — this is where there's real screen
 * space). Reached when the app is launched from the Even App menu.
 *
 * Does: paste/replace the Webhooks key (masked after entry), add / edit /
 * reorder / delete triggers, per-trigger confirm toggle, optional value1..3
 * presets, and a per-trigger "Test fire". Persists after every mutation.
 *
 * Security disclosure is shown inline and unmissable: the Webhooks key grants
 * access to every applet on the account and lives in phone-side storage.
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { MAX_TRIGGERS, type FireConfig, type Trigger } from './types';
import { saveConfig } from './config';
import { fire } from './ifttt';
import { clampLabel, maskKey, uuid } from './util';
import { clearDiag, readDiag } from './diag';

export class SettingsApp {
  private root: HTMLElement;
  private editingKey = false;

  constructor(
    private readonly bridge: EvenAppBridge,
    private config: FireConfig,
  ) {
    const el = document.getElementById('app');
    if (!el) throw new Error('#app root missing');
    this.root = el;
    this.editingKey = !config.key;
  }

  mount(): void {
    this.render();
  }

  private async persist(): Promise<void> {
    await saveConfig(this.bridge, this.config);
  }

  private ordered(): Trigger[] {
    return [...this.config.triggers].sort((a, b) => a.order - b.order);
  }

  // --- Mutations -----------------------------------------------------------

  private async saveKey(value: string): Promise<void> {
    const key = value.trim();
    this.config.key = key || null;
    this.editingKey = !this.config.key;
    await this.persist();
    this.render();
  }

  private async clearKey(): Promise<void> {
    this.config.key = null;
    this.editingKey = true;
    await this.persist();
    this.render();
  }

  private async addTrigger(): Promise<void> {
    if (this.config.triggers.length >= MAX_TRIGGERS) return;
    const order = this.config.triggers.length;
    this.config.triggers.push({
      id: uuid(),
      label: `Trigger ${order + 1}`,
      event: '',
      confirm: false,
      order,
    });
    await this.persist();
    this.render();
  }

  private async updateTrigger(id: string, patch: Partial<Trigger>): Promise<void> {
    const t = this.config.triggers.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    if (patch.label !== undefined) t.label = clampLabel(patch.label) || t.event || 'Trigger';
    await this.persist();
    // No re-render on field edits — keeps input focus.
  }

  private async setValue(id: string, key: 'value1' | 'value2' | 'value3', v: string): Promise<void> {
    const t = this.config.triggers.find((x) => x.id === id);
    if (!t) return;
    const values = { ...(t.values ?? {}) };
    if (v.trim()) values[key] = v;
    else delete values[key];
    t.values = Object.keys(values).length ? values : undefined;
    await this.persist();
  }

  private async deleteTrigger(id: string): Promise<void> {
    this.config.triggers = this.config.triggers.filter((x) => x.id !== id);
    this.reindex();
    await this.persist();
    this.render();
  }

  private async move(id: string, dir: -1 | 1): Promise<void> {
    const list = this.ordered();
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i].order, list[j].order] = [list[j].order, list[i].order];
    this.reindex();
    await this.persist();
    this.render();
  }

  private reindex(): void {
    this.ordered().forEach((t, i) => (t.order = i));
  }

  private async testFire(id: string, statusEl: HTMLElement): Promise<void> {
    const t = this.config.triggers.find((x) => x.id === id);
    if (!t) return;
    if (!this.config.key) {
      statusEl.textContent = 'Set a key first';
      return;
    }
    if (!t.event.trim()) {
      statusEl.textContent = 'Event name required';
      return;
    }
    statusEl.textContent = 'Sending…';
    const result = await fire(t, this.config.key);
    // Honest wording: "Sent" ≠ "the applet ran" (CORS hides the real outcome).
    statusEl.textContent = result === 'sent' ? 'Sent (reached IFTTT)' : 'No connection';
  }

  // --- Rendering (small DOM helpers, no framework) -------------------------

  private render(): void {
    this.root.replaceChildren();
    this.root.append(
      this.header(),
      this.disclosure(),
      this.keySection(),
      this.triggerSection(),
      this.diagSection(),
    );
  }

  /** Shows what the last glasses launch recorded (see diag.ts). */
  private diagSection(): HTMLElement {
    const s = section('Glasses diagnostics');
    s.append(
      el(
        'p',
        'fire-help',
        'Open the app from the glasses menu, then come back here and tap Refresh ' +
          'to see what the glasses launch recorded.',
      ),
    );
    const pre = el('pre', 'fire-diag');
    const row = el('div', 'fire-row');
    row.append(
      button('Refresh', () => void this.loadDiag(pre)),
      button('Clear', () => void this.clearDiagnostics(pre), 'danger'),
    );
    s.append(row, pre);
    void this.loadDiag(pre);
    return s;
  }

  private async loadDiag(pre: HTMLElement): Promise<void> {
    const raw = await readDiag(this.bridge);
    if (!raw) {
      pre.textContent = 'No diagnostics recorded yet.';
      return;
    }
    try {
      pre.textContent = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      pre.textContent = raw;
    }
  }

  private async clearDiagnostics(pre: HTMLElement): Promise<void> {
    await clearDiag(this.bridge);
    pre.textContent = 'Cleared.';
  }

  private header(): HTMLElement {
    const h = el('header', 'fire-header');
    h.append(el('h1', 'fire-title', 'Fire'), el('p', 'fire-tagline', 'Fire your webhooks from your glasses.'));
    injectStyleOnce();
    return h;
  }

  private disclosure(): HTMLElement {
    const box = el('div', 'fire-disclosure');
    box.append(
      el('strong', '', 'Before you add your key'),
      el(
        'p',
        '',
        'Your IFTTT Webhooks key identifies your IFTTT account. Anyone who has it ' +
          'can trigger any applet on that account. Fire stores it only on this phone ' +
          '(in the Even App), never on the glasses and never on any server.',
      ),
    );
    return box;
  }

  private keySection(): HTMLElement {
    const s = section('Webhooks key');
    if (this.config.key && !this.editingKey) {
      const row = el('div', 'fire-row');
      row.append(el('code', 'fire-mask', maskKey(this.config.key)));
      const replace = button('Replace', () => {
        this.editingKey = true;
        this.render();
      });
      const clear = button('Clear', () => void this.clearKey(), 'danger');
      row.append(replace, clear);
      s.append(row);
    } else {
      const input = document.createElement('input');
      input.type = 'password';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = 'Paste your Webhooks key';
      input.className = 'fire-input';
      const row = el('div', 'fire-row');
      const save = button('Save', () => void this.saveKey(input.value), 'primary');
      row.append(input, save);
      s.append(row);
      const help = el('p', 'fire-help');
      const a = document.createElement('a');
      a.href = 'https://ifttt.com/maker_webhooks/settings';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'ifttt.com/maker_webhooks/settings';
      help.append(document.createTextNode('Get your key at '), a);
      s.append(help);
    }
    return s;
  }

  private triggerSection(): HTMLElement {
    const s = section('Triggers');
    const list = this.ordered();
    if (list.length === 0) {
      s.append(el('p', 'fire-help', 'No triggers yet. Add one below.'));
    }
    list.forEach((t, i) => s.append(this.triggerCard(t, i, list.length)));

    const add = button(
      this.config.triggers.length >= MAX_TRIGGERS ? `Max ${MAX_TRIGGERS} reached` : '+ Add trigger',
      () => void this.addTrigger(),
      'primary',
    );
    if (this.config.triggers.length >= MAX_TRIGGERS) add.setAttribute('disabled', 'true');
    s.append(add);
    return s;
  }

  private triggerCard(t: Trigger, index: number, count: number): HTMLElement {
    const card = el('div', 'fire-card');

    const labelIn = field('Label (shown on glasses)', t.label, (v) => this.updateTrigger(t.id, { label: v }));
    labelIn.querySelector('input')?.setAttribute('maxlength', '20');
    const eventIn = field('IFTTT event name', t.event, (v) => this.updateTrigger(t.id, { event: v.trim() }));

    card.append(labelIn, eventIn);

    // Optional value1..3 presets.
    const vals = el('div', 'fire-values');
    (['value1', 'value2', 'value3'] as const).forEach((k) => {
      vals.append(field(k, t.values?.[k] ?? '', (v) => this.setValue(t.id, k, v)));
    });
    card.append(details('Values (optional)', vals));

    // Confirm toggle.
    const confirmRow = el('label', 'fire-toggle');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.confirm;
    cb.onchange = () => void this.updateTrigger(t.id, { confirm: cb.checked });
    confirmRow.append(cb, document.createTextNode(' Require confirm on glasses (for destructive triggers)'));
    card.append(confirmRow);

    // Actions: test + reorder + delete.
    const actions = el('div', 'fire-row');
    const status = el('span', 'fire-status');
    actions.append(
      button('Test fire', () => void this.testFire(t.id, status), 'primary'),
      button('↑', () => void this.move(t.id, -1), index === 0 ? 'disabled' : ''),
      button('↓', () => void this.move(t.id, 1), index === count - 1 ? 'disabled' : ''),
      button('Delete', () => void this.deleteTrigger(t.id), 'danger'),
    );
    card.append(actions, status);
    return card;
  }
}

// --- Tiny DOM helpers ------------------------------------------------------

function el(tag: string, className = '', text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function section(title: string): HTMLElement {
  const s = el('section', 'fire-section');
  s.append(el('h2', 'fire-h2', title));
  return s;
}

function button(label: string, onClick: (e: MouseEvent) => void, variant = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = `fire-btn ${variant}`.trim();
  if (variant === 'disabled') b.disabled = true;
  b.onclick = onClick;
  return b;
}

function field(label: string, value: string, onCommit: (v: string) => void): HTMLElement {
  const wrap = el('label', 'fire-field');
  wrap.append(el('span', 'fire-label', label));
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'fire-input';
  input.value = value;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.onchange = () => onCommit(input.value);
  wrap.append(input);
  return wrap;
}

function details(summary: string, body: HTMLElement): HTMLElement {
  const d = document.createElement('details');
  d.className = 'fire-details';
  const s = document.createElement('summary');
  s.textContent = summary;
  d.append(s, body);
  return d;
}

let styleInjected = false;
function injectStyleOnce(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = `
  .fire-header { margin-bottom: 8px; }
  .fire-title { font-size: 28px; margin: 0; letter-spacing: 0.5px; }
  .fire-tagline { color: var(--muted); margin: 2px 0 0; }
  .fire-disclosure { background: #1a1207; border: 1px solid #3a2a10; border-radius: 10px; padding: 12px 14px; margin: 16px 0; }
  .fire-disclosure strong { color: #ffcf7a; }
  .fire-disclosure p { margin: 6px 0 0; color: #d9c9a8; font-size: 13px; }
  .fire-section { margin: 22px 0; }
  .fire-h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin: 0 0 10px; }
  .fire-card { border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin-bottom: 12px; background: #10130f; }
  .fire-field { display: block; margin-bottom: 10px; }
  .fire-label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .fire-input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--field); color: var(--fg); font-size: 15px; }
  .fire-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
  .fire-row .fire-input { flex: 1 1 180px; }
  .fire-btn { padding: 9px 14px; border-radius: 8px; border: 1px solid var(--line); background: #1a201b; color: var(--fg); font-size: 14px; cursor: pointer; }
  .fire-btn.primary { background: var(--accent); color: #04210a; border-color: var(--accent); font-weight: 600; }
  .fire-btn.danger { color: var(--danger); border-color: #3a1f1f; }
  .fire-btn:disabled, .fire-btn.disabled { opacity: 0.4; cursor: default; }
  .fire-mask { flex: 1 1 auto; font-family: ui-monospace, monospace; letter-spacing: 1px; color: var(--muted); }
  .fire-toggle { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--fg); margin-top: 6px; }
  .fire-values .fire-field { margin-bottom: 6px; }
  .fire-details { margin: 8px 0; }
  .fire-details summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  .fire-help { color: var(--muted); font-size: 13px; }
  .fire-help a { color: var(--accent); }
  .fire-status { font-size: 13px; color: var(--muted); min-height: 18px; }
  .fire-diag { background: #0b0e0c; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin-top: 8px; font: 12px/1.4 ui-monospace, monospace; color: #b9d9b9; white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
}
