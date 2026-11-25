/**
 * Checks of the flows that need a real VS Code window, run inside it (run.ts starts VS Code with
 * --extensionTestsPath pointing at this file's bundle). They drive Profile Kit through its commands and the `code`
 * CLI, answer its dialogs, and read what VS Code and the files then say. docs/PLAN.md section 14 lists what each
 * check stands for and what it cannot see (how the tree and the manager are drawn).
 *
 * The dialogs are answered by replacing vscode.window's message, pick and save functions. That works because this
 * file is loaded from the extension's own folder, so it gets the same `vscode` API object as the extension.
 *
 * Every window of a VS Code started for extension tests loads the extension under development and this file, also
 * the windows Profile Kit opens (a new profile, a second window of the profile). Only the first one runs the checks.
 * The others watch: they write the messages their window shows to a file, which is how the checks see what a second
 * window of the same profile does.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { PROFILE_KIT_ID } from '../../src/core/dependencies';
import { isRecord, parseJsonc, parsePresetText } from '../../src/core/preset';
import type { TestApi } from '../../src/extension';
import type { ManagerState, ToWebview } from '../../src/ui/panel/protocol';
import {
  COMMON_SETTING,
  IN_CORE,
  type IntegrationConfig,
  INTEGRATION_ENV,
  PACK,
  PACK_MEMBERS,
  PROFILE_HERE as HERE,
  PROFILE_OTHER as OTHER,
  SECOND_INSTALL,
  TWIN_INSTALL,
  USER_INSTALLED,
  USER_PACK,
  USER_PACK_MEMBERS,
  type WindowLine,
} from './config';

// ---- results ----

let results = '';
let failed = 0;

function say(line: string): void {
  appendFileSync(results, `${line}\n`);
}

function check(name: string, ok: boolean, detail?: unknown): void {
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/**
 * How long to wait before saying "nothing was asked": Profile Kit looks at new extensions 3 s after the last change
 * (ui/installFlow.ts SETTLE_MS) and then takes 1.5 s to settle which window asks.
 */
const NO_QUESTION_MS = 8000;

/** Poll until `get` gives something truthy; undefined when it never does (the check after it then fails). */
async function waitFor<T>(
  get: () => T | undefined | false | null | 0 | '',
  timeoutMs = 60_000,
): Promise<T | undefined> {
  for (let waited = 0; waited <= timeoutMs; waited += 250) {
    const value = get();
    if (value) return value;
    await sleep(250);
  }
  return undefined;
}

// ---- dialogs: recorded, and answered by the rules of the step that is running ----

interface Shown {
  kind: 'info' | 'warning' | 'error' | 'pick' | 'save';
  text: string;
  /** Buttons of a message, labels of a pick list. */
  items: string[];
  modal: boolean;
  detail: string;
  /** A pick list with checkboxes. */
  many: boolean;
}

const shown: Shown[] = [];
const since = (index: number) => shown.slice(index);
/** Called for every dialog (a watching window writes them to its file). */
let onShown: ((dialog: Shown) => void) | undefined;
/** Messages whose text matches get this button pressed; every other message is dismissed. */
let press: { match: RegExp; button: string }[] = [];
/** Answers pick lists; undefined dismisses them. */
let pick: ((items: readonly vscode.QuickPickItem[], list: Shown) => unknown) | undefined;
let saveAs: vscode.Uri | undefined;
/** When new extensions reached the window that runs the checks. */
const arrivals: string[] = [];
/** What the manager panel was sent. */
const posted: ToWebview[] = [];
const panels: vscode.WebviewPanel[] = [];

function record(dialog: Shown): Shown {
  shown.push(dialog);
  onShown?.(dialog);
  return dialog;
}

function replaceDialogs(): void {
  const win = vscode.window as unknown as Record<string, unknown>;
  const message =
    (kind: 'info' | 'warning' | 'error') =>
    (text: string, ...rest: unknown[]): Promise<unknown> => {
      const first = rest[0];
      const options = isRecord(first) && !('title' in first) ? first : undefined;
      const buttons = options ? rest.slice(1) : rest;
      const items = buttons.map((b) => (typeof b === 'string' ? b : String((b as { title?: unknown }).title)));
      record({
        kind,
        text,
        items,
        modal: options?.modal === true,
        detail: typeof options?.detail === 'string' ? options.detail : '',
        many: false,
      });
      const rule = press.find((r) => r.match.test(text));
      const at = rule ? items.indexOf(rule.button) : -1;
      return Promise.resolve(at < 0 ? undefined : buttons[at]);
    };
  win.showInformationMessage = message('info');
  win.showWarningMessage = message('warning');
  win.showErrorMessage = message('error');
  win.showQuickPick = async (items: unknown, options?: vscode.QuickPickOptions): Promise<unknown> => {
    const all = ((await items) as (string | vscode.QuickPickItem)[]).map((i) =>
      typeof i === 'string' ? { label: i } : i,
    );
    const list = record({
      kind: 'pick',
      text: options?.title ?? options?.placeHolder ?? '',
      items: all.map((i) => i.label),
      modal: false,
      detail: '',
      many: options?.canPickMany === true,
    });
    return pick?.(all, list);
  };
  win.showSaveDialog = (options?: vscode.SaveDialogOptions): Promise<vscode.Uri | undefined> => {
    record({ kind: 'save', text: options?.defaultUri?.fsPath ?? '', items: [], modal: true, detail: '', many: false });
    return Promise.resolve(saveAs);
  };
  const createPanel = vscode.window.createWebviewPanel.bind(vscode.window);
  win.createWebviewPanel = (...args: Parameters<typeof vscode.window.createWebviewPanel>): vscode.WebviewPanel => {
    const panel = createPanel(...args);
    const post = panel.webview.postMessage.bind(panel.webview);
    (panel.webview as unknown as Record<string, unknown>).postMessage = (m: ToWebview) => {
      posted.push(m);
      return post(m);
    };
    panels.push(panel);
    return panel;
  };
}

const marker = () => vscode.workspace.getConfiguration('profileKit').get<string>('profile') ?? '';
const asksAboutInstall = (text: string) => /Add it to other profiles too\?/.test(text);
/** The name Profile Kit's messages use for an extension: its display name, or the ID when that is a placeholder. */
function shownName(id: string): string {
  const pkg = vscode.extensions.getExtension(id)?.packageJSON as { displayName?: unknown } | undefined;
  return typeof pkg?.displayName === 'string' && !pkg.displayName.startsWith('%') ? pkg.displayName : id;
}

// ---- a window that only watches ----

const windowsDir = (config: IntegrationConfig) => path.join(config.data, 'windows');

/** Never returns: VS Code ends every window when the window that runs the checks has finished. */
async function watch(config: IntegrationConfig): Promise<never> {
  mkdirSync(windowsDir(config), { recursive: true });
  const file = path.join(windowsDir(config), `${vscode.env.sessionId}.jsonl`);
  const write = (line: WindowLine) => appendFileSync(file, `${JSON.stringify(line)}\n`);
  replaceDialogs();
  onShown = (dialog) => write({ dialog: dialog.text });
  const builtin = vscode.env.appRoot.toLowerCase();
  vscode.extensions.onDidChange(() =>
    write({
      installed: vscode.extensions.all
        .filter((e) => !e.extensionPath.toLowerCase().startsWith(builtin))
        .map((e) => e.id.toLowerCase()),
    }),
  );
  await vscode.extensions.getExtension(PROFILE_KIT_ID)?.activate();
  write({ ready: marker() });
  return new Promise<never>(() => undefined);
}

function otherWindows(config: IntegrationConfig): WindowLine[][] {
  const dir = windowsDir(config);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((f) =>
    readFileSync(path.join(dir, f), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as WindowLine),
  );
}

// ---- the checks ----

async function main(config: IntegrationConfig): Promise<void> {
  const extension = vscode.extensions.getExtension<TestApi | undefined>(PROFILE_KIT_ID);
  if (!extension) throw new Error('Profile Kit is not loaded as the extension under development');
  const api = await extension.activate();
  if (!api) throw new Error('Profile Kit did not hand out its test API (is VS Code running extension tests?)');
  const { kit, tree } = api;
  say(`VS Code ${vscode.version}, ${process.platform}, language ${vscode.env.language}`);

  replaceDialogs();
  // a real notification would stay until somebody closes it
  const replaced = await Promise.race([
    vscode.window.showInformationMessage('probe').then(() => shown.pop()?.text === 'probe'),
    sleep(3000).then(() => false),
  ]);
  check('the checks can answer the dialogs of the extension', replaced);
  if (!replaced) return;
  // when each new extension reached this window (printed when a check fails: one install can come in several steps)
  const started = Date.now();
  const known = new Set(vscode.extensions.all.map((e) => e.id.toLowerCase()));
  vscode.extensions.onDidChange(() => {
    const fresh = vscode.extensions.all.map((e) => e.id.toLowerCase()).filter((id) => !known.has(id));
    for (const id of fresh) known.add(id);
    arrivals.push(`${((Date.now() - started) / 1000).toFixed(1)} s: ${fresh.join(', ') || '(nothing new)'}`);
  });

  const defaultSettings = (): Record<string, unknown> => {
    const json = parseJsonc(readFileSync(path.join(config.userData, 'User', 'settings.json'), 'utf8'));
    return isRecord(json) ? json : {};
  };
  const profileSettings = (name: string): Record<string, unknown> => {
    const stored = kit.refreshStorage().find((p) => p.name === name);
    const file = stored && kit.paths.profileSettings(stored.location);
    const json = file && existsSync(file) ? parseJsonc(readFileSync(file, 'utf8')) : {};
    return isRecord(json) ? json : {};
  };
  const presetNow = () => parsePresetText(readFileSync(config.preset, 'utf8'));
  const exists = (name: string) => kit.refreshStorage().some((p) => p.name === name);
  const asked = (from: number) => since(from).filter((d) => asksAboutInstall(d.text));
  /** Install into this window's profile the way a user does: not through Profile Kit, and not while it works. */
  const userInstalls = async (id: string) => {
    await waitFor(() => !kit.changeRunning());
    await kit.run(['--profile', HERE, '--install-extension', id]);
    return waitFor(() => vscode.extensions.getExtension(id), 120_000);
  };

  // -- start --
  await waitFor(() => kit.preset ?? kit.presetError);
  check(
    'the preset file named in Settings is loaded',
    !!kit.preset && kit.declaredNames().join() === [HERE, OTHER].join(),
    { error: kit.presetError, declared: kit.declaredNames() },
  );
  await waitFor(() => exists(HERE));
  check(
    'the profile of this window exists and the other declared one does not yet',
    exists(HERE) && !exists(OTHER),
    kit.refreshStorage().map((p) => p.name),
  );
  // the Profiles view: once it is shown, every profile is listed (review P5)
  await vscode.commands.executeCommand('profileKit.profiles.focus');

  // -- apply, pressed twice (1.3.2) --
  press = [{ match: /^Apply the preset\?$/, button: 'Apply' }];
  let from = shown.length;
  const first = vscode.commands.executeCommand('profileKit.applyAll');
  const second = vscode.commands.executeCommand('profileKit.applyAll');
  await second;
  check(
    'a second apply while the first still reads the profiles is refused with a message',
    since(from).some((d) => /^Profile Kit is still busy: applying the preset\./.test(d.text)),
    since(from).map((d) => d.text),
  );
  await first;
  const confirms = since(from).filter((d) => d.text === 'Apply the preset?');
  check('pressing apply twice asks for one confirmation only', confirms.length === 1 && confirms[0].modal, confirms);
  check(
    'the confirmation names the profile that will be created and says a window opens',
    !!confirms[0] && new RegExp(`New profiles \\(each opens a window.*\\): ${OTHER}`).test(confirms[0].detail),
    confirms[0]?.detail,
  );
  check(
    'the result says both profiles were applied and one window was opened',
    since(from).some((d) => /^Preset applied to 2 profile\(s\)\. 1 window\(s\) were opened/.test(d.text)),
    since(from).map((d) => d.text),
  );
  await waitFor(() => kit.installedIn(OTHER));
  const rows = () => kit.rows().filter((r) => r.declared);
  check(
    'after applying, both profiles exist and have every declared extension',
    rows().length === 2 && rows().every((r) => !!r.stored && !!r.diff && r.diff.missing.length === 0),
    rows().map((r) => ({ name: r.name, exists: !!r.stored, missing: r.diff?.missing ?? 'not listed' })),
  );
  check(
    'the Profiles view lists the other profile too once it has been shown',
    !!kit.installedIn(OTHER)?.includes(IN_CORE),
    kit.installedIn(OTHER) ?? 'not listed',
  );
  await waitFor(() => marker() === HERE, 30_000);
  check(
    "this window reads its profile from the marker Profile Kit wrote into the profile's settings",
    marker() === HERE && kit.currentProfile()?.name === HERE && kit.currentProfile()?.how === 'marker',
    { marker: marker(), current: kit.currentProfile() },
  );
  const inEffect = () => vscode.workspace.getConfiguration().get<unknown>(COMMON_SETTING.key);
  check(
    'a common setting of the preset is in effect in this window',
    JSON.stringify(inEffect()) === JSON.stringify(COMMON_SETTING.value),
    inEffect(),
  );
  const other = profileSettings(OTHER);
  check(
    'the other profile has its own marker, the common setting and the list of managed keys',
    other['profileKit.profile'] === OTHER &&
      JSON.stringify(other[COMMON_SETTING.key]) === JSON.stringify(COMMON_SETTING.value) &&
      Array.isArray(other['profileKit.managedKeys']) &&
      other['profileKit.managedKeys'].includes(COMMON_SETTING.key),
    other,
  );

  // -- extras VS Code installed along with a declared extension (section 13) --
  press = [];
  await sleep(NO_QUESTION_MS);
  check(
    'applying asks nothing about the members of a declared extension pack',
    asked(from).length === 0,
    asked(from).map((d) => d.text),
  );
  await kit.refresh();
  const here = kit.rows().find((r) => r.name === HERE);
  check(
    'the members of the declared pack are installed and are extras of the profile',
    PACK_MEMBERS.every((id) => here?.diff?.extra.includes(id)),
    here?.diff,
  );
  const profileNode = tree.getChildren().find((n) => n.kind === 'profile' && n.row.name === HERE);
  const memberItems = (profileNode ? tree.getChildren(profileNode) : [])
    .filter((n) => n.kind === 'extension' && PACK_MEMBERS.includes(n.id))
    .map((n) => tree.getTreeItem(n));
  check(
    'the tree shows such an extra with the pack that brought it in, not as "not in the preset"',
    memberItems.length === PACK_MEMBERS.length &&
      memberItems.every(
        (item) =>
          item.description === `in pack ${PACK}` &&
          item.contextValue === 'extension:extra' &&
          String(item.tooltip).includes('VS Code installed it together with that extension'),
      ),
    memberItems.map((item) => ({ label: item.label, description: item.description })),
  );
  await vscode.commands.executeCommand('profileKit.openManager');
  const state = await waitFor(
    () => posted.find((m): m is { type: 'state'; state: ManagerState } => m.type === 'state')?.state,
    30_000,
  );
  const members = (state?.extensions ?? []).filter((e) => PACK_MEMBERS.includes(e.id));
  check(
    'the manager opens, its page starts, and it is sent the same reason for those extras',
    members.length === PACK_MEMBERS.length &&
      members.every((e) => e.section === 'undeclared' && e.via?.join() === PACK),
    state ? members : 'the manager page did not ask for its state',
  );
  for (const panel of panels) panel.dispose();

  // -- installing an extension the usual way, then picking profiles (section 11) --
  press = [{ match: /Add it to other profiles too\?/, button: 'Choose Profiles...' }];
  pick = (items, list) =>
    list.many ? items.filter((i) => [HERE, OTHER].includes((i as { profile?: string }).profile ?? '')) : undefined;
  from = shown.length;
  await userInstalls(USER_INSTALLED);
  const prompt = await waitFor(() => asked(from)[0], 60_000);
  const added = await waitFor(() => since(from).find((d) => /is now in the preset for: /.test(d.text)), 180_000);
  check(
    "an extension installed in this window's profile is asked about once, with the three answers",
    !!prompt &&
      prompt.text.startsWith(`${shownName(USER_INSTALLED)} was installed in ${HERE}.`) &&
      prompt.items.join('|') === `Choose Profiles...|Only ${HERE}|Don't Ask for This One` &&
      asked(from).length === 1,
    since(from).map((d) => ({ text: d.text, items: d.items })),
  );
  const lists = since(from).filter((d) => d.kind === 'pick');
  check(
    'the profiles are picked in one list with checkboxes, and nothing asks where the preset records it',
    lists.length === 1 && lists[0].many && /^Add .+ to profiles$/.test(lists[0].text),
    lists,
  );
  check(
    'the result says which profiles, where it was recorded and where it was installed',
    !!added &&
      added.text.includes(`is now in the preset for: ${HERE}, ${OTHER}.`) &&
      added.text.includes('Recorded under core (every profile).') &&
      added.text.includes('Installed in 1 profile(s).'),
    added?.text,
  );
  check('the preset file has the extension in core', presetNow().core.includes(USER_INSTALLED), presetNow().core);
  await waitFor(() => kit.installedIn(OTHER)?.includes(USER_INSTALLED));
  check(
    'the other profile got the extension',
    !!kit.installedIn(OTHER)?.includes(USER_INSTALLED),
    kit.installedIn(OTHER),
  );

  // -- the user installs an extension pack: one question, about the pack --
  press = [];
  pick = undefined;
  from = shown.length;
  await userInstalls(USER_PACK);
  await waitFor(() => USER_PACK_MEMBERS.every((id) => vscode.extensions.getExtension(id)), 120_000);
  await waitFor(() => asked(from).length, 30_000);
  await sleep(NO_QUESTION_MS);
  check(
    'a pack the user installs is asked about once, and its members are not',
    asked(from).length === 1 && asked(from)[0].text.startsWith(`${shownName(USER_PACK)} was installed in ${HERE}.`),
    {
      asked: asked(from).map((d) => d.text),
      installed: [USER_PACK, ...USER_PACK_MEMBERS].filter((id) => vscode.extensions.getExtension(id)),
    },
  );

  // -- several windows of one profile: only the window that claimed the question asks (review P6) --
  // First with a claim that is already there, as if another window had been quicker.
  const claims = 'profileKit.installPrompts';
  await kit.context.globalState.update(claims, { [SECOND_INSTALL]: { by: 'another-window', at: Date.now() } });
  from = shown.length;
  const seen = await userInstalls(SECOND_INSTALL);
  await sleep(NO_QUESTION_MS);
  check(
    'an install that another window of the profile already asks about is not asked about here',
    !!seen && asked(from).length === 0,
    { seenByThisWindow: !!seen, asked: asked(from).map((d) => d.text) },
  );
  await kit.context.globalState.update(claims, undefined);

  // -- "Install to Profiles..." for one profile --
  pick = (items, list) => (list.many ? items.filter((i) => (i as { profile?: string }).profile === OTHER) : undefined);
  from = shown.length;
  await vscode.commands.executeCommand('profileKit.installToProfiles', SECOND_INSTALL);
  const one = since(from).find((d) => /is now in the preset for: /.test(d.text));
  check(
    '"Install to Profiles..." for one profile records it in that profile\'s own list and installs it there',
    !!one &&
      one.text.includes(`is now in the preset for: ${OTHER}.`) &&
      one.text.includes("Recorded under each profile's own extensions.") &&
      one.text.includes('Installed in 1 profile(s).') &&
      !!presetNow().profiles[OTHER].extensions?.includes(SECOND_INSTALL) &&
      !presetNow().core.includes(SECOND_INSTALL),
    { message: one?.text, preset: presetNow() },
  );
  pick = undefined;

  // -- two real windows of this profile: an install is asked about once between them (review P6) --
  const twin = () => otherWindows(config).find((lines) => lines.some((l) => l.ready === HERE));
  await kit.run(['--profile', HERE, '--new-window']);
  const opened = await waitFor(twin, 120_000);
  check(
    'a second window of this profile opens with Profile Kit running in it',
    !!opened,
    otherWindows(config).map((lines) => lines.find((l) => l.ready !== undefined)),
  );
  if (opened) {
    const twinAsked = () => (twin() ?? []).filter((l) => l.dialog !== undefined && asksAboutInstall(l.dialog)).length;
    const before = twinAsked();
    from = shown.length;
    const seenHere = await userInstalls(TWIN_INSTALL);
    const seenThere = await waitFor(() => twin()?.some((l) => l.installed?.includes(TWIN_INSTALL)), 60_000);
    await sleep(NO_QUESTION_MS);
    const counts = { thisWindow: asked(from).length, otherWindow: twinAsked() - before };
    check(
      'both windows see the new extension, and it is asked about in exactly one of them',
      !!seenHere && !!seenThere && counts.thisWindow + counts.otherWindow === 1,
      { seenHere: !!seenHere, seenThere: !!seenThere, ...counts },
    );
  }

  // -- the preset in Settings and back to a file: the two confirmations (section 12) --
  const setting = 'profileKit.preset';
  const fileBefore = readFileSync(config.preset, 'utf8');
  from = shown.length;
  await vscode.commands.executeCommand('profileKit.storePresetInSettings');
  const store = since(from).find((d) => /^Store the preset in Settings/.test(d.text));
  check(
    'storing the preset in Settings asks first, naming the file, and does nothing when dismissed',
    !!store &&
      store.modal &&
      store.items.join() === 'Store in Settings' &&
      store.detail.includes(config.preset) &&
      !kit.presetInSettings() &&
      !(setting in defaultSettings()),
    { asked: store, inSettings: kit.presetInSettings() },
  );
  press = [{ match: /^Store the preset in Settings/, button: 'Store in Settings' }];
  from = shown.length;
  await vscode.commands.executeCommand('profileKit.storePresetInSettings');
  await waitFor(() => setting in defaultSettings(), 15_000);
  const stored = defaultSettings()[setting];
  check(
    "accepted: the preset is in Default's settings.json only, the file is untouched, and Profile Kit reads the setting",
    isRecord(stored) &&
      Array.isArray(stored.core) &&
      stored.core.includes(USER_INSTALLED) &&
      !(setting in profileSettings(HERE)) &&
      readFileSync(config.preset, 'utf8') === fileBefore &&
      kit.presetInSettings() &&
      kit.declaredNames().join() === [HERE, OTHER].join(),
    { stored, inProfile: setting in profileSettings(HERE), inSettings: kit.presetInSettings() },
  );
  check(
    'it then says to turn on Settings in Settings Sync',
    since(from).some((d) => /^The preset is stored in Settings\. Turn on Settings in Settings Sync/.test(d.text)),
    since(from).map((d) => d.text),
  );

  const moved = vscode.Uri.file(path.join(config.workspace, 'moved.profile-kit.json'));
  saveAs = moved;
  press = [];
  from = shown.length;
  await vscode.commands.executeCommand('profileKit.movePresetToFile');
  const use = since(from).find((d) => /instead of the preset stored in Settings\?$/.test(d.text));
  check(
    'moving the preset to a file asks before the synced preset is removed, and keeps it when dismissed',
    !!use &&
      use.kind === 'warning' &&
      use.modal &&
      use.items.join() === 'Use the File' &&
      use.detail.includes('Settings Sync removes it on your other PCs too') &&
      kit.presetInSettings() &&
      setting in defaultSettings(),
    { asked: use, inSettings: kit.presetInSettings() },
  );
  press = [{ match: /instead of the preset stored in Settings\?$/, button: 'Use the File' }];
  await vscode.commands.executeCommand('profileKit.movePresetToFile');
  await waitFor(() => !(setting in defaultSettings()), 15_000);
  const backups = path.join(kit.context.globalStorageUri.fsPath, 'synced-preset-backups');
  const copies = existsSync(backups) ? readdirSync(backups) : [];
  check(
    'accepted: a copy is kept, the setting is removed, and the new file is the preset in use',
    copies.some((f) => f.endsWith('.profile-kit.json')) &&
      !(setting in defaultSettings()) &&
      defaultSettings()['profileKit.presetPath'] === moved.fsPath &&
      !kit.presetInSettings() &&
      kit.preset?.uri.fsPath === moved.fsPath &&
      parsePresetText(readFileSync(moved.fsPath, 'utf8')).core.includes(USER_INSTALLED),
    {
      copies,
      presetPath: defaultSettings()['profileKit.presetPath'],
      inSettings: kit.presetInSettings(),
      inUse: kit.preset?.uri.fsPath,
    },
  );
}

/** Called by VS Code in every window (--extensionTestsPath); a rejection makes VS Code exit with code 1. */
export async function run(): Promise<void> {
  const config = JSON.parse(process.env[INTEGRATION_ENV] ?? 'null') as IntegrationConfig | null;
  if (!config) throw new Error(`${INTEGRATION_ENV} is not set: start the checks with out/integration/run.js`);
  try {
    // the first window takes this; it fails for the windows opened later
    writeFileSync(path.join(config.data, 'checks.lock'), vscode.env.sessionId, { flag: 'wx' });
  } catch {
    return watch(config);
  }
  results = config.results;
  try {
    await main(config);
  } catch (error) {
    failed++;
    say(
      `FAIL  the checks ran to the end\n      ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }
  if (failed) {
    say('-- dialogs shown in the window that ran the checks, in order --');
    for (const d of shown)
      say(`   ${d.kind}${d.modal ? ' (modal)' : ''}: ${d.text}${d.items.length ? `  [${d.items.join(' | ')}]` : ''}`);
  }
  if (failed) {
    say('-- extensions arriving in that window --');
    for (const line of arrivals) say(`   ${line}`);
  }
  say(failed ? `${failed} check(s) failed` : 'all checks passed');
  if (failed) throw new Error(`${failed} check(s) failed`);
}
