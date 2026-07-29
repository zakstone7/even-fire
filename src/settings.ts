/**
 * Phone-side settings page.
 *
 * Two views:
 *   - list view: the IFTTT key, a table of triggers (reorder / edit / delete),
 *     and an "Add trigger" button.
 *   - editor view: add/edit one trigger. A kind radio (IFTTT / Raw) switches
 *     the form. "Test fire" runs the request; for Raw it shows the status code
 *     and a truncated response body (subject to CORS — see execute.ts).
 *
 * The editor works on a clone of the trigger so Cancel discards cleanly.
 */

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import {
  HTTP_METHODS,
  HISTORY_MAX,
  MAX_TRIGGERS,
  emptyRawConfig,
  relayConfigured,
  type FireConfig,
  type HistoryEntry,
  type HttpMethod,
  type RelayConfig,
  type Trigger,
  type TriggerKind,
} from './types';
import { saveConfig } from './config';
import { execute, type FireResult } from './execute';
import { clearHistory, readHistory, recordHistory } from './history';
import { clampLabel, maskKey, uuid } from './util';
import { clearDiag, readDiag } from './diag';

/** Support contact — a mailto with diagnostics prefilled. */
const SUPPORT_EMAIL = 'zakstone7@gmail.com';

/** Optional "Buy me a coffee" tip link. Replace with your own page URL. */
const COFFEE_URL = 'https://www.buymeacoffee.com/zakstone7';

/** Private/reserved URL → must fire direct (relay can't reach a LAN). */
function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\./);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      return (
        a === 10 ||
        a === 127 ||
        (a === 192 && b === 168) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 169 && b === 254)
      );
    }
  } catch {
    /* not a URL yet */
  }
  return false;
}

interface EditState {
  draft: Trigger;
  isNew: boolean;
}

export class SettingsApp {
  private root: HTMLElement;
  private editingKey: boolean;
  private editing: EditState | null = null;

  constructor(
    private readonly bridge: EvenAppBridge,
    private config: FireConfig,
    private readonly onChange?: () => void,
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
    this.onChange?.();
  }

  private ordered(): Trigger[] {
    return [...this.config.triggers].sort((a, b) => a.order - b.order);
  }

  // --- Rendering -----------------------------------------------------------

  private render(): void {
    injectStyleOnce();
    this.root.replaceChildren();
    this.root.append(this.header());
    if (this.editing) {
      this.root.append(this.editorView(this.editing));
      return;
    }
    this.root.append(
      this.disclosure(),
      this.keySection(),
      this.triggerSection(),
      this.relaySection(),
      this.historySection(),
      this.supportSection(),
      this.coffeeSection(),
      this.diagSection(),
    );
  }

  private header(): HTMLElement {
    const h = el('header', 'fire-header');
    h.append(el('h1', 'fire-title', 'Fire'), el('p', 'fire-tagline', 'Fire your webhooks from your glasses.'));
    return h;
  }

  private disclosure(): HTMLElement {
    const box = el('div', 'fire-disclosure');
    box.append(
      el('strong', '', 'About your IFTTT key'),
      el(
        'p',
        '',
        'The IFTTT Webhooks key can trigger any applet on your account. Fire stores ' +
          'it only on this phone, never on the glasses or a server. Raw triggers do ' +
          'not use it.',
      ),
    );
    return box;
  }

  // --- Key ----------------------------------------------------------------

  private keySection(): HTMLElement {
    const s = section('IFTTT Webhooks key');
    if (this.config.key && !this.editingKey) {
      const row = el('div', 'fire-row');
      row.append(el('code', 'fire-mask', maskKey(this.config.key)));
      row.append(
        button('Replace', () => {
          this.editingKey = true;
          this.render();
        }),
        button('Clear', () => void this.setKey(''), 'danger'),
      );
      s.append(row);
    } else {
      const input = document.createElement('input');
      input.type = 'password';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = 'Paste your Webhooks key';
      input.className = 'fire-input';
      const row = el('div', 'fire-row');
      row.append(input, button('Save', () => void this.setKey(input.value), 'primary'));
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

  private async setKey(value: string): Promise<void> {
    const key = value.trim();
    this.config.key = key || null;
    this.editingKey = !this.config.key;
    await this.persist();
    this.render();
  }

  // --- Triggers table ------------------------------------------------------

  private triggerSection(): HTMLElement {
    const s = section('Triggers');
    const list = this.ordered();
    if (list.length === 0) {
      s.append(el('p', 'fire-help', 'No triggers yet. Add one below.'));
    } else {
      s.append(this.triggerTable(list));
    }
    const atCap = this.config.triggers.length >= MAX_TRIGGERS;
    const add = button(atCap ? `Max ${MAX_TRIGGERS} reached` : '+ Add trigger', () => this.startAdd(), 'primary');
    if (atCap) add.disabled = true;
    s.append(add);
    return s;
  }

  private triggerTable(list: Trigger[]): HTMLElement {
    const table = document.createElement('table');
    table.className = 'fire-table';
    const head = document.createElement('tr');
    for (const label of ['#', 'Trigger', 'Type', '']) head.append(el('th', '', label));
    table.append(head);

    list.forEach((t, i) => {
      const tr = document.createElement('tr');
      tr.append(el('td', 'fire-idx', String(i + 1)));
      const name = el('td', 'fire-name', t.label);
      tr.append(name);
      tr.append(cell(badge(t.kind)));

      const actions = el('div', 'fire-rowactions');
      const up = button('↑', () => void this.move(t.id, -1));
      const down = button('↓', () => void this.move(t.id, 1));
      if (i === 0) up.disabled = true;
      if (i === list.length - 1) down.disabled = true;
      actions.append(up, down, button('Edit', () => this.startEdit(t)), button('✕', () => void this.remove(t.id), 'danger'));
      tr.append(cell(actions));
      table.append(tr);
    });
    return table;
  }

  private async move(id: string, dir: -1 | 1): Promise<void> {
    const list = this.ordered();
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i].order, list[j].order] = [list[j].order, list[i].order];
    this.ordered().forEach((t, k) => (t.order = k));
    await this.persist();
    this.render();
  }

  private async remove(id: string): Promise<void> {
    this.config.triggers = this.config.triggers.filter((x) => x.id !== id);
    this.ordered().forEach((t, i) => (t.order = i));
    await this.persist();
    this.render();
  }

  // --- Editor --------------------------------------------------------------

  private startAdd(): void {
    this.editing = {
      isNew: true,
      draft: {
        id: uuid(),
        label: '',
        kind: 'ifttt',
        confirm: false,
        order: this.config.triggers.length,
        event: '',
      },
    };
    this.render();
  }

  private startEdit(t: Trigger): void {
    this.editing = { isNew: false, draft: JSON.parse(JSON.stringify(t)) as Trigger };
    this.render();
  }

  private editorView(state: EditState): HTMLElement {
    const d = state.draft;
    const s = section(state.isNew ? 'Add trigger' : 'Edit trigger');

    // Kind radio.
    s.append(
      kindRadio(d.kind, (k) => {
        d.kind = k;
        if (k === 'raw' && !d.raw) d.raw = emptyRawConfig();
        this.render();
      }),
    );

    // Common fields.
    const labelField = field('Label (shown on glasses)', d.label, (v) => (d.label = v));
    labelField.querySelector('input')?.setAttribute('maxlength', '20');
    s.append(labelField);

    const confirmRow = el('label', 'fire-toggle');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = d.confirm;
    cb.onchange = () => (d.confirm = cb.checked);
    confirmRow.append(cb, document.createTextNode(' Require confirm on glasses (for destructive triggers)'));
    s.append(confirmRow);

    s.append(this.relayToggle(d));

    // Kind-specific fields.
    if (d.kind === 'ifttt') s.append(this.iftttFields(d));
    else s.append(this.rawFields(d));

    // Actions + test result.
    const result = el('div', 'fire-testresult');
    const err = el('p', 'fire-error');
    const actions = el('div', 'fire-row');
    actions.append(
      button('Test fire', () => void this.runTest(d, result), 'primary'),
      button('Save', () => void this.save(state, err), 'primary'),
      button('Cancel', () => this.cancel()),
    );
    s.append(actions, err, result);
    return s;
  }

  private iftttFields(d: Trigger): HTMLElement {
    const wrap = el('div', 'fire-fields');
    wrap.append(field('IFTTT event name', d.event ?? '', (v) => (d.event = v.trim())));
    const vals = el('div', 'fire-values');
    (['value1', 'value2', 'value3'] as const).forEach((k) => {
      vals.append(
        field(k, d.values?.[k] ?? '', (v) => {
          const values = { ...(d.values ?? {}) };
          if (v.trim()) values[k] = v;
          else delete values[k];
          d.values = Object.keys(values).length ? values : undefined;
        }),
      );
    });
    wrap.append(details('Values (optional)', vals));
    return wrap;
  }

  private rawFields(d: Trigger): HTMLElement {
    const raw = (d.raw ??= emptyRawConfig());
    const wrap = el('div', 'fire-fields');

    // Method + URL on one row.
    const methodWrap = el('label', 'fire-field fire-method');
    methodWrap.append(el('span', 'fire-label', 'Method'));
    const sel = document.createElement('select');
    sel.className = 'fire-input';
    for (const m of HTTP_METHODS) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      if (m === raw.method) opt.selected = true;
      sel.append(opt);
    }
    sel.onchange = () => (raw.method = sel.value as HttpMethod);
    methodWrap.append(sel);

    const urlField = field('URL', raw.url, (v) => (raw.url = v.trim()));
    urlField.querySelector('input')?.setAttribute('inputmode', 'url');

    const row = el('div', 'fire-row fire-method-row');
    row.append(methodWrap, urlField);
    wrap.append(row);

    // Headers.
    wrap.append(this.headerEditor(raw));

    // Body.
    const bodyWrap = el('label', 'fire-field');
    bodyWrap.append(el('span', 'fire-label', 'Body'));
    const ta = document.createElement('textarea');
    ta.className = 'fire-input fire-textarea';
    ta.rows = 4;
    ta.value = raw.body;
    ta.placeholder = '{ "example": true }';
    ta.spellcheck = false;
    ta.onchange = () => (raw.body = ta.value);
    bodyWrap.append(ta);
    wrap.append(bodyWrap);

    wrap.append(
      el(
        'p',
        'fire-help',
        'Runs in the phone WebView, so CORS applies: the status/body are readable ' +
          'only if the endpoint sends Access-Control-Allow-Origin, and custom ' +
          'headers/methods are preflighted.',
      ),
    );
    return wrap;
  }

  private headerEditor(raw: NonNullable<Trigger['raw']>): HTMLElement {
    const wrap = el('div', 'fire-headers');
    wrap.append(el('span', 'fire-label', 'Headers'));
    const rebuild = () => {
      this.render(); // simplest: re-render editor to reflect add/remove
    };
    raw.headers.forEach((h, i) => {
      const row = el('div', 'fire-row fire-header-row');
      const nameIn = textInput(h.name, 'Header', (v) => (raw.headers[i].name = v));
      const valIn = textInput(h.value, 'Value', (v) => (raw.headers[i].value = v));
      const del = button('✕', () => {
        raw.headers.splice(i, 1);
        rebuild();
      }, 'danger');
      row.append(nameIn, valIn, del);
      wrap.append(row);
    });
    wrap.append(
      button('+ Add header', () => {
        raw.headers.push({ name: '', value: '' });
        rebuild();
      }),
    );
    return wrap;
  }

  private async runTest(d: Trigger, resultEl: HTMLElement): Promise<void> {
    resultEl.replaceChildren(el('p', 'fire-help', 'Sending…'));
    const r = await execute(d, { key: this.config.key, relay: this.config.relay, readBody: true });
    resultEl.replaceChildren(renderTestResult(r));
    void recordHistory(
      this.bridge,
      { ts: Date.now(), label: d.label || d.event || 'Test', kind: d.kind, via: r.via, result: r.result, status: r.status, ok: r.ok, error: r.error },
      this.config.historyLimit,
    );
  }

  private async save(state: EditState, errEl: HTMLElement): Promise<void> {
    const d = state.draft;
    d.label = clampLabel(d.label);
    const error = validate(d);
    if (error) {
      errEl.textContent = error;
      return;
    }
    // Drop the fields that don't belong to the chosen kind.
    if (d.kind === 'ifttt') delete d.raw;
    else {
      delete d.event;
      delete d.values;
      // A local endpoint can't go through a cloud relay — keep it direct.
      if (isLocalUrl(d.raw?.url ?? '')) d.useRelay = false;
    }
    const existing = this.config.triggers.findIndex((t) => t.id === d.id);
    if (existing >= 0) this.config.triggers[existing] = d;
    else this.config.triggers.push(d);
    await this.persist();
    this.editing = null;
    this.render();
  }

  private cancel(): void {
    this.editing = null;
    this.render();
  }

  // --- Relay (self-hosted) -------------------------------------------------

  private relayToggle(d: Trigger): HTMLElement {
    const wrap = el('div', 'fire-relaytoggle');
    const configured = relayConfigured(this.config.relay);
    const localUrl = d.kind === 'raw' && isLocalUrl(d.raw?.url ?? '');
    if (localUrl) d.useRelay = false;

    const row = el('label', 'fire-toggle');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = Boolean(d.useRelay) && configured && !localUrl;
    cb.disabled = !configured || localUrl;
    cb.onchange = () => (d.useRelay = cb.checked);
    row.append(cb, document.createTextNode(' Route through relay (real status/body for any host)'));
    wrap.append(row);

    if (!configured) {
      wrap.append(el('p', 'fire-help', 'Set up a relay in the Relay section below to enable this.'));
    } else if (localUrl) {
      wrap.append(el('p', 'fire-help', 'Local address — fired directly from your phone (relays can’t reach a LAN).'));
    }
    return wrap;
  }

  private relaySection(): HTMLElement {
    const s = section('Relay (self-hosted)');
    s.append(
      el(
        'p',
        'fire-help',
        'Optional. A relay you host on Cloudflare makes triggers show real responses ' +
          '(status + body) for any host, bypassing CORS. Deploy it from relay/README.md, ' +
          'then enable it per trigger. Leave blank to fire everything directly.',
      ),
    );
    const relay = this.config.relay ?? { url: '', secret: '' };

    const urlField = field('Relay URL', relay.url, (v) => void this.setRelayField('url', v));
    urlField.querySelector('input')?.setAttribute('inputmode', 'url');

    const secretWrap = el('label', 'fire-field');
    secretWrap.append(el('span', 'fire-label', 'Relay secret'));
    const secret = document.createElement('input');
    secret.type = 'password';
    secret.className = 'fire-input';
    secret.value = relay.secret;
    secret.placeholder = 'RELAY_SECRET';
    secret.autocomplete = 'off';
    secret.spellcheck = false;
    secret.onchange = () => void this.setRelayField('secret', secret.value);
    secretWrap.append(secret);

    s.append(urlField, secretWrap);
    if (relayConfigured(this.config.relay)) {
      s.append(el('p', 'fire-help', 'Relay configured ✓ — turn it on per trigger in the editor.'));
    }
    return s;
  }

  private async setRelayField(part: 'url' | 'secret', value: string): Promise<void> {
    const cur = this.config.relay ?? { url: '', secret: '' };
    const next: RelayConfig = { ...cur, [part]: value.trim() };
    this.config.relay = next.url || next.secret ? next : undefined;
    await this.persist();
  }

  // --- Recent calls (on-device history) ------------------------------------

  private historySection(): HTMLElement {
    const s = section('Recent calls');
    const limitWrap = el('label', 'fire-field fire-inline');
    limitWrap.append(el('span', 'fire-label', 'Keep last'));
    const limitInput = document.createElement('input');
    limitInput.type = 'number';
    limitInput.min = '0';
    limitInput.max = String(HISTORY_MAX);
    limitInput.className = 'fire-input fire-num';
    limitInput.value = String(this.config.historyLimit ?? 25);
    limitInput.onchange = () => void this.setHistoryLimit(Number(limitInput.value));
    limitWrap.append(limitInput);

    const pre = el('pre', 'fire-diag');
    const row = el('div', 'fire-row');
    row.append(
      button('Refresh', () => void this.loadHistory(pre)),
      button('Clear', () => void this.clearHistoryUi(pre), 'danger'),
    );
    s.append(limitWrap, row, pre);
    void this.loadHistory(pre);
    return s;
  }

  private async setHistoryLimit(n: number): Promise<void> {
    this.config.historyLimit = Math.max(0, Math.min(HISTORY_MAX, Math.round(n || 0)));
    await this.persist();
  }

  private async loadHistory(pre: HTMLElement): Promise<void> {
    const list = await readHistory(this.bridge);
    pre.textContent = list.length ? list.map(fmtHistory).join('\n') : 'No calls yet.';
  }

  private async clearHistoryUi(pre: HTMLElement): Promise<void> {
    await clearHistory(this.bridge);
    pre.textContent = 'Cleared.';
  }

  // --- Support -------------------------------------------------------------

  private supportSection(): HTMLElement {
    const s = section('Support');
    s.append(
      el('p', 'fire-help', 'Bug or question? Send a ticket — it prefills recent diagnostics to help debug.'),
    );
    s.append(button('Contact support', () => void this.contactSupport(), 'primary'));
    return s;
  }

  // --- Buy me a coffee -----------------------------------------------------

  private coffeeSection(): HTMLElement {
    const s = section('Enjoying Fire?');
    s.append(
      el('p', 'fire-help', 'Fire is free with no accounts or backend. If it saves you a tap, you can leave a tip.'),
    );
    // Open on the user gesture, no window features (avoids iOS popup-block).
    s.append(button('☕ Buy me a coffee', () => void window.open(COFFEE_URL, '_blank'), 'primary'));
    return s;
  }

  private async contactSupport(): Promise<void> {
    let diag = '';
    try {
      diag = await readDiag(this.bridge);
    } catch {
      /* ignore */
    }
    const body = [
      'Describe the issue:',
      '',
      '',
      '--- diagnostics (please keep) ---',
      `triggers: ${this.config.triggers.length}`,
      `relay: ${relayConfigured(this.config.relay) ? 'configured' : 'none'}`,
      `diag: ${diag ? diag.slice(0, 1500) : 'none'}`,
    ].join('\n');
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Fire support')}&body=${encodeURIComponent(body)}`;
    // Open on the user gesture, no window features (avoids iOS popup-block).
    window.open(url, '_blank');
  }

  // --- Diagnostics ---------------------------------------------------------

  private diagSection(): HTMLElement {
    const s = section('Glasses diagnostics');
    s.append(
      el('p', 'fire-help', 'Open Fire on the glasses, then Refresh to see what it recorded.'),
    );
    const pre = el('pre', 'fire-diag');
    const row = el('div', 'fire-row');
    row.append(
      button('Refresh', () => void this.loadDiag(pre)),
      button('Copy', (e) => void this.copyDiag(pre, e.currentTarget as HTMLButtonElement), 'primary'),
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

  private async copyDiag(pre: HTMLElement, btn: HTMLButtonElement): Promise<void> {
    const ok = await copyText(pre.textContent ?? '');
    const prev = btn.textContent;
    btn.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => {
      btn.textContent = prev;
    }, 1200);
  }

  private async clearDiagnostics(pre: HTMLElement): Promise<void> {
    await clearDiag(this.bridge);
    pre.textContent = 'Cleared.';
  }
}

// --- Pure helpers ----------------------------------------------------------

function validate(d: Trigger): string | null {
  if (!d.label.trim()) return 'Label is required.';
  if (d.kind === 'ifttt') {
    if (!d.event?.trim()) return 'IFTTT event name is required.';
  } else {
    if (!d.raw?.url.trim()) return 'URL is required.';
    try {
      // eslint-disable-next-line no-new
      new URL(d.raw.url.trim());
    } catch {
      return 'URL is not valid (include https://).';
    }
  }
  return null;
}

function renderTestResult(r: FireResult): HTMLElement {
  const box = el('div', 'fire-result');
  const via = r.via === 'relay' ? ' · via relay' : '';
  if (r.error) {
    box.append(el('div', 'fire-result-status bad', `Failed${via}`), el('pre', 'fire-diag', r.error));
    return box;
  }
  if (r.status != null) {
    box.append(
      el('div', `fire-result-status ${r.ok ? 'good' : 'bad'}`, `${r.status} ${r.statusText ?? ''}${via}`.trim()),
    );
    box.append(el('pre', 'fire-diag', r.body && r.body.length ? r.body : '(empty response body)'));
  } else {
    box.append(el('div', 'fire-result-status good', `Sent${via}`));
    if (r.note) box.append(el('p', 'fire-help', r.note));
  }
  return box;
}

function fmtHistory(e: HistoryEntry): string {
  let t = '';
  try {
    t = new Date(e.ts).toLocaleTimeString();
  } catch {
    /* ignore */
  }
  const outcome = e.error
    ? `ERR ${e.error}`.slice(0, 60)
    : e.status != null
      ? `${e.status}${e.ok ? '' : ' !'}`
      : e.result === 'sent'
        ? 'sent'
        : 'no-conn';
  return `${t}  ${e.label}  [${e.via}]  ${outcome}`;
}

function kindRadio(current: TriggerKind, onChange: (k: TriggerKind) => void): HTMLElement {
  const wrap = el('div', 'fire-radios');
  const opts: Array<[TriggerKind, string]> = [
    ['ifttt', 'IFTTT'],
    ['raw', 'Raw HTTP'],
  ];
  for (const [value, label] of opts) {
    const l = el('label', `fire-radio ${current === value ? 'sel' : ''}`);
    const r = document.createElement('input');
    r.type = 'radio';
    r.name = 'fire-kind';
    r.checked = current === value;
    r.onchange = () => onChange(value);
    l.append(r, document.createTextNode(' ' + label));
    wrap.append(l);
  }
  return wrap;
}

function badge(kind: TriggerKind): HTMLElement {
  return el('span', `fire-badge ${kind}`, kind === 'raw' ? 'Raw' : 'IFTTT');
}

function el(tag: string, className = '', text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function cell(child: HTMLElement): HTMLElement {
  const td = document.createElement('td');
  td.append(child);
  return td;
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
  b.onclick = onClick;
  return b;
}

function textInput(value: string, placeholder: string, onCommit: (v: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'fire-input';
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.onchange = () => onCommit(input.value);
  return input;
}

function field(label: string, value: string, onCommit: (v: string) => void): HTMLElement {
  const wrap = el('label', 'fire-field');
  wrap.append(el('span', 'fire-label', label));
  wrap.append(textInput(value, '', onCommit));
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

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
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
  .fire-field { display: block; margin-bottom: 10px; }
  .fire-label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .fire-input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--field); color: var(--fg); font-size: 15px; }
  .fire-textarea { font-family: ui-monospace, monospace; resize: vertical; }
  .fire-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
  .fire-row .fire-input { flex: 1 1 180px; }
  .fire-btn { padding: 9px 14px; border-radius: 8px; border: 1px solid var(--line); background: #1a201b; color: var(--fg); font-size: 14px; cursor: pointer; }
  .fire-btn.primary { background: var(--accent); color: #04210a; border-color: var(--accent); font-weight: 600; }
  .fire-btn.danger { color: var(--danger); border-color: #3a1f1f; }
  .fire-btn:disabled { opacity: 0.4; cursor: default; }
  .fire-mask { flex: 1 1 auto; font-family: ui-monospace, monospace; letter-spacing: 1px; color: var(--muted); }
  .fire-toggle { display: flex; gap: 8px; align-items: center; font-size: 13px; margin: 8px 0; }
  .fire-values .fire-field { margin-bottom: 6px; }
  .fire-details { margin: 8px 0; }
  .fire-details summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  .fire-help { color: var(--muted); font-size: 13px; }
  .fire-help a { color: var(--accent); }
  .fire-error { color: var(--danger); font-size: 13px; min-height: 16px; margin: 4px 0 0; }
  /* Table */
  .fire-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  .fire-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); padding: 4px 6px; border-bottom: 1px solid var(--line); }
  .fire-table td { padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .fire-idx { color: var(--muted); width: 1.5em; }
  .fire-name { font-weight: 600; word-break: break-word; }
  .fire-rowactions { display: flex; gap: 4px; justify-content: flex-end; }
  .fire-rowactions .fire-btn { padding: 6px 10px; font-size: 13px; }
  .fire-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
  .fire-badge.raw { color: #7cc0fc; border-color: #23405a; }
  .fire-badge.ifttt { color: var(--accent); border-color: #26402a; }
  /* Radios */
  .fire-radios { display: flex; gap: 8px; margin-bottom: 12px; }
  .fire-radio { flex: 1 1 0; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; font-size: 14px; }
  .fire-radio.sel { border-color: var(--accent); background: #10160f; color: var(--accent); }
  .fire-method { flex: 0 0 34%; margin-bottom: 0; }
  .fire-method-row { align-items: flex-end; }
  .fire-method-row .fire-field { flex: 1 1 60%; margin-bottom: 0; }
  .fire-header-row .fire-input { flex: 1 1 40%; }
  .fire-headers { margin: 10px 0; }
  /* Test result */
  .fire-result-status { font-weight: 700; padding: 6px 0; }
  .fire-result-status.good { color: var(--accent); }
  .fire-result-status.bad { color: var(--danger); }
  .fire-diag { background: #0b0e0c; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin-top: 8px; font: 12px/1.4 ui-monospace, monospace; color: #b9d9b9; white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; }
  .fire-relaytoggle { margin: 10px 0; }
  .fire-inline { display: flex; align-items: center; gap: 10px; }
  .fire-inline .fire-label { margin: 0; }
  .fire-num { width: 80px; flex: 0 0 auto; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
}
