/**
 * Manager panel UI (runs in the webview, bundled to dist/webview.js). Plain DOM, VS Code theme variables.
 * It only keeps the user's pending wishes; the extension computes previews and does the work.
 */
import { compareCodeUnits } from '../../core/text';
import type {
  ExtensionChange,
  FromWebview,
  ManagerState,
  PanelExtension,
  Preview,
  SettingChange,
  ToWebview,
} from './protocol';

declare function acquireVsCodeApi(): {
  postMessage(message: FromWebview): void;
  getState(): unknown;
  setState(state: unknown): void;
};
const vscode = acquireVsCodeApi();

type Tab = 'extensions' | 'settings';
interface Saved {
  tab: Tab;
  filter: string;
  showUndeclared: boolean;
}

let state: ManagerState | undefined;
const saved = (vscode.getState() as Saved | undefined) ?? { tab: 'extensions', filter: '', showUndeclared: false };
let tab: Tab = saved.tab;
let filter = saved.filter;
let showUndeclared = saved.showUndeclared;
/** extension id → wanted declared profiles */
const pendingExt = new Map<string, Set<string>>();
/** `${scope}\u0000${key}` → JSON text, or null to remove */
const pendingSettings = new Map<string, string | null>();
const extraKeys = new Set<string>();
let preview: { kind: Tab; preview: Preview } | undefined;
let busy: string | undefined;
let flash: { text: string; error: boolean } | undefined;

const app = document.getElementById('app') as HTMLElement;
const s = (key: string) => state?.strings[key] ?? key;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: (Node | string | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) node.setAttribute(k, v);
  for (const c of children) if (c !== undefined) node.append(c);
  return node;
}

function button(label: string, onClick: () => void, cls = 'secondary', disabled = false): HTMLButtonElement {
  const b = el('button', { class: cls, type: 'button' }, label);
  b.disabled = disabled || !!busy;
  b.addEventListener('click', onClick);
  return b;
}

function persist(): void {
  vscode.setState({ tab, filter, showUndeclared } satisfies Saved);
}

// ---- extensions tab -----------------------------------------------------------------------------------------

function wanted(ext: PanelExtension): Set<string> {
  return pendingExt.get(ext.id) ?? new Set(ext.declaredIn);
}

function toggle(ext: PanelExtension, profile: string, on: boolean): void {
  const next = new Set(wanted(ext));
  if (on) next.add(profile);
  else next.delete(profile);
  const same = next.size === ext.declaredIn.length && ext.declaredIn.every((p) => next.has(p));
  if (same) pendingExt.delete(ext.id);
  else pendingExt.set(ext.id, next);
  render();
}

function sectionLabel(section: string): string {
  if (section === 'core') return s('core');
  if (section === 'profile') return s('profile only');
  if (section === 'undeclared') return s('not in the preset');
  return `${s('group')} ${section.slice('group '.length)}`;
}

function extensionsTab(st: ManagerState): HTMLElement {
  const wrap = el('div');
  const search = el('input', { type: 'search', placeholder: s('Filter extensions'), value: filter });
  search.addEventListener('input', () => {
    filter = search.value;
    persist();
    renderBody();
  });
  const undeclared = el('input', { type: 'checkbox', id: 'undeclared' });
  undeclared.checked = showUndeclared;
  undeclared.addEventListener('change', () => {
    showUndeclared = undeclared.checked;
    persist();
    renderBody();
  });
  wrap.append(
    el(
      'div',
      { class: 'toolbar' },
      search,
      el('label', { for: 'undeclared', class: 'check' }, undeclared, s('Show extensions not in the preset')),
      el('span', { class: 'grow' }),
      button(s('Add Extension...'), () => vscode.postMessage({ type: 'installToProfiles' })),
    ),
    el(
      'p',
      { class: 'hint' },
      s(
        'Checked = declared in the preset for that profile. Unchecking only removes it from the preset; nothing is uninstalled.',
      ),
    ),
  );
  const body = el('div', { class: 'scroll' });
  wrap.append(body);

  function renderBody(): void {
    body.replaceChildren(matrix(st));
  }
  renderBody();
  return wrap;
}

function profileHeader(st: ManagerState): HTMLTableRowElement {
  return el(
    'tr',
    {},
    el('th', { class: 'name' }, ''),
    ...st.profiles.map((p) =>
      el(
        'th',
        {
          class: `profile${p.current ? ' current' : ''}`,
          title: p.exists ? p.name : `${p.name} — ${s('not created yet')}`,
        },
        el('span', {}, p.name),
        p.current
          ? el('small', {}, s('this window'))
          : !p.exists
            ? el('small', { class: 'warn' }, s('not created yet'))
            : undefined,
      ),
    ),
  );
}

function matrix(st: ManagerState): HTMLElement {
  const q = filter.trim().toLowerCase();
  const rows = st.extensions.filter(
    (e) =>
      (showUndeclared || e.section !== 'undeclared' || pendingExt.has(e.id)) &&
      (!q || e.id.includes(q) || (e.displayName ?? '').toLowerCase().includes(q)),
  );
  const table = el('table', { class: 'matrix' });
  table.append(el('thead', {}, profileHeader(st)));
  const tbody = el('tbody');
  let section = '';
  for (const ext of rows) {
    if (ext.section !== section) {
      section = ext.section;
      tbody.append(
        el('tr', { class: 'section' }, el('td', { colspan: String(st.profiles.length + 1) }, sectionLabel(section))),
      );
    }
    const want = wanted(ext);
    const name = el(
      'td',
      { class: 'name' },
      el('a', { href: '#', title: ext.id }, ext.displayName ?? ext.id),
      ext.displayName ? el('small', {}, ext.id) : undefined,
      ext.allProfiles
        ? el(
            'small',
            {
              class: 'scope',
              title: s('VS Code applies this extension to all profiles (Apply Extension to all Profiles).'),
            },
            s('all profiles (VS Code)'),
          )
        : undefined,
      ext.via?.length
        ? el(
            'small',
            {
              class: 'scope',
              title: `${s('VS Code installed it together with these extensions (they need it, or it is in their extension pack):')} ${ext.via.join(', ')}`,
            },
            `${s('dependency')}: ${ext.via.join(', ')}`,
          )
        : undefined,
    );
    name.querySelector('a')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      vscode.postMessage({ type: 'openExtension', id: ext.id });
    });
    const cells = st.profiles.map((p) => {
      const declared = ext.declaredIn.includes(p.name);
      const installed = ext.installedIn.includes(p.name);
      const on = want.has(p.name);
      const box = el('input', { type: 'checkbox', 'aria-label': `${ext.id} — ${p.name}` });
      box.checked = on;
      box.disabled = !!busy;
      box.addEventListener('change', () => toggle(ext, p.name, box.checked));
      const mark = installed
        ? el(
            'span',
            {
              class: declared ? 'dot ok' : 'dot extra',
              title: declared ? s('installed') : s('installed, not declared'),
            },
            '●',
          )
        : declared && p.exists
          ? el('span', { class: 'dot missing', title: s('declared, not installed') }, '○')
          : undefined;
      return el('td', { class: `cell${on !== declared ? ' changed' : ''}` }, box, mark);
    });
    tbody.append(el('tr', {}, name, ...cells));
  }
  table.append(tbody);
  return table;
}

function extensionChanges(): ExtensionChange[] {
  return [...pendingExt].map(([id, set]) => ({ id, profiles: [...set] }));
}

// ---- settings tab -------------------------------------------------------------------------------------------

const skey = (scope: string, key: string) => `${scope}\u0000${key}`;

function currentValue(st: ManagerState, scope: string, key: string): unknown {
  const map = scope ? st.settings.profiles[scope] : st.settings.common;
  return map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function settingsTab(st: ManagerState): HTMLElement {
  const keys = new Set<string>([
    ...Object.keys(st.settings.common),
    ...Object.values(st.settings.profiles).flatMap((m) => Object.keys(m)),
    ...extraKeys,
  ]);
  const wrap = el('div');
  const newKey = el('input', { type: 'text', placeholder: s('setting.key'), class: 'key' });
  const add = button(s('Add Setting'), () => {
    const k = newKey.value.trim();
    if (!k) return;
    extraKeys.add(k);
    render();
  });
  wrap.append(
    el('div', { class: 'toolbar' }, newKey, add),
    el(
      'p',
      { class: 'hint' },
      s(
        'Values are JSON. A profile value replaces the common one. Apply writes the preset, then each profile settings.json (backed up first).',
      ),
    ),
  );

  const scopes = [{ scope: '', label: s('Common (all profiles)'), disabled: false, current: false }].concat(
    st.profiles.map((p) => ({ scope: p.name, label: p.name, disabled: p.sharesSettings, current: p.current })),
  );
  const table = el('table', { class: 'settings' });
  table.append(
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { class: 'name' }, s('Setting')),
        ...scopes.map((c) =>
          el(
            'th',
            { class: `profile${c.current ? ' current' : ''}` },
            el('span', {}, c.label),
            c.disabled
              ? el('small', {}, s('uses Default settings'))
              : c.current
                ? el('small', {}, s('this window'))
                : undefined,
          ),
        ),
      ),
    ),
  );
  const tbody = el('tbody');
  for (const key of [...keys].sort(compareCodeUnits)) {
    const shared = st.settings.allProfiles.includes(key);
    const cells = scopes.map((c) => {
      const cur = currentValue(st, c.scope, key);
      const pending = pendingSettings.get(skey(c.scope, key));
      const text = pending !== undefined ? (pending ?? '') : cur === undefined ? '' : JSON.stringify(cur);
      const common = currentValue(st, '', key);
      const input = el('input', {
        type: 'text',
        value: text,
        placeholder: c.scope && common !== undefined ? `= ${JSON.stringify(common)}` : s('empty = not set'),
        title: s('JSON value, e.g. true, 4, "text"'),
      });
      const locked = shared && !!c.scope;
      input.disabled = c.disabled || locked || !!busy;
      if (locked)
        input.title = s(
          'Default applies this setting to all profiles (Apply Setting to all Profiles), so a profile cannot have its own value.',
        );
      const mark = () => {
        const v = input.value.trim();
        const original = cur === undefined ? '' : JSON.stringify(cur);
        if (v === original) pendingSettings.delete(skey(c.scope, key));
        else pendingSettings.set(skey(c.scope, key), v === '' ? null : v);
        input.classList.toggle('changed', v !== original);
        input.classList.toggle('invalid', v !== '' && !isValidJson(v));
        input.title = v !== '' && !isValidJson(v) ? s('Not valid JSON') : s('JSON value, e.g. true, 4, "text"');
        renderFooter();
      };
      input.addEventListener('input', mark);
      if (pending !== undefined) {
        input.classList.add('changed');
        if (pending && !isValidJson(pending)) input.classList.add('invalid');
      }
      return el('td', { class: 'cell' }, input);
    });
    const name = el('td', { class: 'name mono' }, key);
    if (shared) name.append(el('small', {}, s('all profiles (from Default)')));
    tbody.append(el('tr', {}, name, ...cells));
  }
  table.append(tbody);
  wrap.append(el('div', { class: 'scroll' }, table));
  return wrap;
}

function settingChanges(): SettingChange[] {
  return [...pendingSettings].map(([k, v]) => {
    const [scope, key] = k.split('\u0000');
    return v === null ? { scope, key } : { scope, key, value: v };
  });
}

// ---- frame --------------------------------------------------------------------------------------------------

function pendingCount(): number {
  return tab === 'extensions' ? pendingExt.size : pendingSettings.size;
}

const footer = el('div', { class: 'footer' });

function renderFooter(): void {
  const n = pendingCount();
  const invalid = tab === 'settings' && [...pendingSettings.values()].some((v) => v !== null && !isValidJson(v));
  footer.replaceChildren(
    busy ? el('span', { class: 'busy' }, busy) : el('span', {}, n ? `${n} ${s('change(s)')}` : ''),
    el('span', { class: 'grow' }),
    button(
      s('Discard'),
      () => {
        if (tab === 'extensions') pendingExt.clear();
        else {
          pendingSettings.clear();
          extraKeys.clear();
        }
        render();
      },
      'secondary',
      n === 0,
    ),
    button(
      s('Preview'),
      () =>
        vscode.postMessage(
          tab === 'extensions'
            ? { type: 'previewExtensions', changes: extensionChanges() }
            : { type: 'previewSettings', changes: settingChanges() },
        ),
      'primary',
      n === 0 || invalid,
    ),
  );
}

function previewBox(p: { kind: Tab; preview: Preview }): HTMLElement {
  const icons: Record<string, string> = { preset: '✎', install: '⬇', settings: '⚙', note: 'ℹ' };
  const list = el('ul', { class: 'preview' });
  if (p.preview.empty) list.append(el('li', { class: 'note' }, s('Nothing to change.')));
  for (const line of p.preview.lines)
    list.append(el('li', { class: line.kind }, el('span', { class: 'icon' }, icons[line.kind] ?? '•'), line.text));
  return el(
    'div',
    { class: 'overlay' },
    el(
      'div',
      { class: 'dialog' },
      el('h2', {}, s('Preview')),
      list,
      el(
        'div',
        { class: 'actions' },
        button(s('Back'), () => {
          preview = undefined;
          render();
        }),
        button(
          s('Apply'),
          () => {
            const token = p.preview.token;
            vscode.postMessage(
              p.kind === 'extensions'
                ? { type: 'applyExtensions', changes: extensionChanges(), token }
                : { type: 'applySettings', changes: settingChanges(), token },
            );
          },
          'primary',
          p.preview.empty,
        ),
      ),
    ),
  );
}

function render(): void {
  if (!state) {
    app.replaceChildren(el('p', { class: 'hint' }, '…'));
    return;
  }
  const st = state;
  const tabs = el(
    'div',
    { class: 'tabs', role: 'tablist' },
    ...(['extensions', 'settings'] as Tab[]).map((name) => {
      const b = el(
        'button',
        { role: 'tab', class: name === tab ? 'tab active' : 'tab', type: 'button' },
        s(name === 'extensions' ? 'Extensions' : 'Settings'),
      );
      b.addEventListener('click', () => {
        tab = name;
        persist();
        render();
      });
      return b;
    }),
    el('span', { class: 'grow' }),
    el('span', { class: 'path', title: st.presetPath }, st.presetPath),
    button(s('Edit Preset'), () => vscode.postMessage({ type: 'editPreset' })),
    button(s('Refresh'), () => vscode.postMessage({ type: 'refresh' })),
  );
  const children: HTMLElement[] = [tabs];
  if (flash) children.push(el('div', { class: flash.error ? 'flash error' : 'flash' }, flash.text));
  if (st.presetError || !st.presetPath)
    children.push(el('div', { class: 'flash error' }, st.presetError ?? s('No preset file is set.')));
  else children.push(tab === 'extensions' ? extensionsTab(st) : settingsTab(st));
  renderFooter();
  children.push(footer);
  if (preview && preview.kind === tab) children.push(previewBox(preview));
  app.replaceChildren(...children);
}

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  // VS Code hands the extension's messages over from a host frame of the same origin as this page
  // (postMessage(..., window.origin)); anything else is not from Profile Kit (SonarQube S2819)
  if (event.origin !== window.origin) return;
  const m = event.data;
  switch (m.type) {
    case 'state':
      state = m.state;
      // drop wishes that are now what the preset says
      for (const ext of state.extensions) {
        const want = pendingExt.get(ext.id);
        if (want && want.size === ext.declaredIn.length && ext.declaredIn.every((p) => want.has(p)))
          pendingExt.delete(ext.id);
      }
      break;
    case 'preview':
      preview = { kind: m.kind, preview: m.preview };
      flash = undefined;
      break;
    case 'busy':
      busy = m.busy ? (m.message ?? '…') : undefined;
      break;
    case 'done':
      preview = undefined;
      if (tab === 'extensions') pendingExt.clear();
      else {
        pendingSettings.clear();
        extraKeys.clear();
      }
      flash = { text: m.message, error: false };
      break;
    case 'error':
      flash = { text: m.message, error: true };
      break;
  }
  render();
});

render();
vscode.postMessage({ type: 'ready' });
