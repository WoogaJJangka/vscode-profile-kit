import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type CodeRunner,
  MANAGED_KEYS_KEY,
  parsePreset,
  parseSettingsText,
  PROFILE_MARKER_KEY,
  type RunResult,
} from '../src/core';
import { buildPlans, executePlans } from '../src/host/apply';
import { codeCliCandidates, findCodeCli } from '../src/host/codeLocator';
import { ensureProfile, installExtensions } from '../src/host/installer';
import { defaultUserDataDir, userDataDirFromGlobalStorage, userDataPaths } from '../src/host/paths';

const ok = (stdout: string): RunResult => ({ stdout, stderr: '', exitCode: 0 });
const noSleep = () => Promise.resolve();

describe('paths', () => {
  it('default user data folder per platform, portable mode first', () => {
    expect(defaultUserDataDir('win32', { APPDATA: path.join('C:', 'R') }, 'H')).toBe(path.join('C:', 'R', 'Code'));
    expect(defaultUserDataDir('darwin', {}, 'H')).toBe(path.join('H', 'Library', 'Application Support', 'Code'));
    expect(defaultUserDataDir('linux', {}, 'H')).toBe(path.join('H', '.config', 'Code'));
    expect(defaultUserDataDir('linux', { XDG_CONFIG_HOME: 'X' }, 'H')).toBe(path.join('X', 'Code'));
    expect(defaultUserDataDir('win32', { VSCODE_PORTABLE: 'P' }, 'H')).toBe(path.join('P', 'user-data'));
  });

  it('user data folder from globalStorageUri', () => {
    const ud = path.resolve('some', 'ud');
    expect(userDataDirFromGlobalStorage(path.join(ud, 'User', 'globalStorage', 'a.b'))).toBe(ud);
    expect(userDataDirFromGlobalStorage(path.resolve('no-user-here'))).toBeUndefined();
  });

  it('profile locations cannot escape User/profiles', () => {
    const p = userDataPaths(path.resolve('ud'));
    expect(p.profileSettings('-529380a5')).toBe(path.join(p.user, 'profiles', '-529380a5', 'settings.json'));
    for (const bad of ['', '..', '.', 'a/b', 'a\\b']) expect(() => p.profileSettings(bad)).toThrow();
  });
});

describe('codeLocator', () => {
  it('finds bin/code.cmd three levels above appRoot (Windows, commit folder layout)', () => {
    const install = path.join('C:', 'VSCode');
    const appRoot = path.join(install, '8a14f0cc1b', 'resources', 'app');
    const want = path.join(install, 'bin', 'code.cmd');
    expect(codeCliCandidates(appRoot, 'win32')).toContain(want);
    expect(findCodeCli(appRoot, 'win32', (p) => p === want)).toBe(want);
    expect(findCodeCli(appRoot, 'win32', () => false)).toBeUndefined();
  });
});

describe('installExtensions', () => {
  it('retries network errors only and stops when the profile is missing', async () => {
    const calls: string[] = [];
    const answers: Record<string, RunResult[]> = {
      'a.net': [
        ok('getaddrinfo ENOTFOUND marketplace.visualstudio.com'),
        ok("Extension 'a.net' v1 was successfully installed."),
      ],
      'b.unknown': [ok('Failed Installing Extensions: b.unknown')],
      'c.gone': [ok("Profile 'P' not found.")],
    };
    const run: CodeRunner = async (args) => {
      const id = args[args.length - 1];
      calls.push(id);
      return answers[id]?.shift() ?? ok('?');
    };
    const results = await installExtensions(run, 'P', ['a.net', 'b.unknown', 'c.gone', 'd.never'], {
      sleep: noSleep,
      batchSize: 1,
    });
    expect(results.map((r) => [r.id, r.outcome, r.attempts])).toEqual([
      ['a.net', 'installed', 2],
      ['b.unknown', 'unknown', 1],
      ['c.gone', 'profile-not-found', 1],
      ['d.never', 'profile-not-found', 0],
    ]);
    // the unclear result of b.unknown is checked with the list (review P10)
    expect(calls).toEqual(['a.net', 'a.net', 'b.unknown', '--list-extensions', 'c.gone']);
  });

  it('takes an unclear result as installed when the list has the extension (review P10)', async () => {
    const run: CodeRunner = async (args) =>
      args.includes('--list-extensions') ? ok('x.y\n') : ok('Installation abgeschlossen.');
    const [r] = await installExtensions(run, 'P', ['x.y'], { sleep: noSleep });
    expect(r).toMatchObject({ id: 'x.y', outcome: 'installed', attempts: 1 });
  });

  it('installs a batch in one call, then tries what the list does not have on its own (review P8)', async () => {
    const calls: string[][] = [];
    const installed = new Set(['old.one']);
    const run: CodeRunner = async (args) => {
      calls.push(args);
      if (args.includes('--list-extensions')) return ok([...installed].join('\n'));
      const ids = args.filter((_, i) => args[i - 1] === '--install-extension');
      if (ids.length > 1) {
        installed.add('a.b');
        return ok(
          "Installing extensions...\nExtension 'old.one' v1 is already installed.\nExtension 'a.b' v1 was successfully installed.\nFailed Installing Extensions: c.d",
        );
      }
      installed.add(ids[0]);
      return ok(`Extension '${ids[0]}' v1 was successfully installed.`);
    };
    const progress: string[] = [];
    const results = await installExtensions(run, 'P', ['old.one', 'a.b', 'c.d'], {
      sleep: noSleep,
      onProgress: (id) => progress.push(id),
    });
    expect(results.map((r) => [r.id, r.outcome, r.attempts])).toEqual([
      ['old.one', 'already-installed', 1],
      ['a.b', 'installed', 1],
      ['c.d', 'installed', 2],
    ]);
    expect(progress).toEqual(['old.one', 'a.b', 'c.d']);
    expect(calls).toEqual([
      ['--profile', 'P', '--install-extension', 'old.one', '--install-extension', 'a.b', '--install-extension', 'c.d'],
      ['--profile', 'P', '--list-extensions'],
      ['--profile', 'P', '--install-extension', 'c.d'],
    ]);
  });

  it('splits into batches and stops when the profile is missing', async () => {
    let calls = 0;
    const run: CodeRunner = async () => {
      calls++;
      return ok("Profile 'P' not found.");
    };
    const results = await installExtensions(run, 'P', ['a.a', 'b.b', 'c.c'], { batchSize: 2 });
    expect(results.map((r) => [r.id, r.outcome, r.attempts])).toEqual([
      ['a.a', 'profile-not-found', 1],
      ['b.b', 'profile-not-found', 0],
      ['c.c', 'profile-not-found', 0],
    ]);
    expect(calls).toBe(1);
  });

  it('gives up after the attempts and reports network', async () => {
    const run: CodeRunner = async () => ok('ETIMEDOUT');
    const [r] = await installExtensions(run, 'P', ['x.y'], { attempts: 2, sleep: noSleep });
    expect(r).toMatchObject({ outcome: 'network', attempts: 2 });
  });
});

describe('ensureProfile', () => {
  it('opens a window for a missing profile and waits for it in storage.json', async () => {
    let profiles: { name: string; location: string; useDefaultFlags: Record<string, boolean> }[] = [];
    const calls: string[][] = [];
    const run: CodeRunner = async (args) => {
      calls.push(args);
      profiles = [{ name: 'New', location: 'n1', useDefaultFlags: {} }];
      return ok('');
    };
    const r = await ensureProfile(run, 'New', () => profiles, { sleep: noSleep });
    expect(r.status).toBe('created');
    expect(calls).toEqual([['--profile', 'New', '--new-window']]);
    expect((await ensureProfile(run, 'New', () => profiles)).status).toBe('exists');
  });

  it('times out when the profile never shows up', async () => {
    const r = await ensureProfile(
      async () => ok(''),
      'X',
      () => [],
      { sleep: noSleep, timeoutMs: 3, intervalMs: 1 },
    );
    expect(r.status).toBe('timeout');
  });
});

describe('apply (fake code CLI, temp user data folder)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pk-apply-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('installs missing extensions, writes settings with a backup, then removes dropped keys on the next run', async () => {
    const paths = userDataPaths(dir);
    mkdirSync(path.dirname(paths.storageJson), { recursive: true });
    writeFileSync(paths.storageJson, JSON.stringify({ userDataProfiles: [{ name: 'Py', location: 'p1' }] }));
    const settingsFile = paths.profileSettings('p1');
    mkdirSync(path.dirname(settingsFile), { recursive: true });
    writeFileSync(settingsFile, '{\n    // keep me\n    "user.key": 1\n}\n');

    const installed = new Set(['esbenp.prettier-vscode']);
    const run: CodeRunner = async (args) => {
      if (args.includes('--list-extensions')) return ok([...installed].join('\n'));
      const id = args[args.indexOf('--install-extension') + 1];
      installed.add(id);
      return ok(`Extension '${id}' v1 was successfully installed.`);
    };
    const env = { run, paths };

    const first = parsePreset({
      core: ['esbenp.prettier-vscode'],
      settings: { 'editor.formatOnSave': true, 'old.key': 'x' },
      profiles: { Py: { extensions: ['ms-python.python'] } },
    });
    const { plans } = await buildPlans(env, first, ['Py']);
    expect(plans[0].extensions.missing).toEqual(['ms-python.python']);
    const [report] = await executePlans(env, first, plans, { install: { sleep: noSleep } });
    expect(report.installs.map((i) => i.outcome)).toEqual(['installed']);
    expect(report.settingsChanged).toBe(3);
    expect(report.backup && readFileSync(report.backup, 'utf8')).toContain('"user.key": 1');
    const text = readFileSync(settingsFile, 'utf8');
    expect(text).toContain('// keep me');
    // the managed-key list sits in the same settings.json, so Settings Sync carries it along (review P3)
    expect(parseSettingsText(text)).toEqual({
      'user.key': 1,
      'editor.formatOnSave': true,
      'old.key': 'x',
      [PROFILE_MARKER_KEY]: 'Py',
      [MANAGED_KEYS_KEY]: ['editor.formatOnSave', 'old.key', PROFILE_MARKER_KEY],
    });
    expect(existsSync(paths.managedSettingsFile)).toBe(false);

    const second = parsePreset({
      core: ['esbenp.prettier-vscode'],
      settings: { 'editor.formatOnSave': true },
      profiles: { Py: { extensions: ['ms-python.python'] } },
    });
    const again = await buildPlans(env, second, ['Py']);
    expect(again.plans[0].settings?.changes).toEqual([{ key: 'old.key', kind: 'remove', before: 'x' }]);
    await executePlans(env, second, again.plans);
    expect(parseSettingsText(readFileSync(settingsFile, 'utf8'))).toEqual({
      'user.key': 1,
      'editor.formatOnSave': true,
      [PROFILE_MARKER_KEY]: 'Py',
      [MANAGED_KEYS_KEY]: ['editor.formatOnSave', PROFILE_MARKER_KEY],
    });
  });

  it('uses the list in a settings.json synced from another PC, and the old globalStorage list until then', async () => {
    const paths = userDataPaths(dir);
    mkdirSync(path.dirname(paths.storageJson), { recursive: true });
    writeFileSync(
      paths.storageJson,
      JSON.stringify({
        userDataProfiles: [
          { name: 'A', location: 'a1' },
          { name: 'B', location: 'b1' },
        ],
      }),
    );
    // A: written on another PC; this PC has no globalStorage list for it
    mkdirSync(path.dirname(paths.profileSettings('a1')), { recursive: true });
    writeFileSync(
      paths.profileSettings('a1'),
      JSON.stringify({ x: 1, old: 2, [PROFILE_MARKER_KEY]: 'A', [MANAGED_KEYS_KEY]: ['old', PROFILE_MARKER_KEY, 'x'] }),
    );
    // B: written by an older Profile Kit, whose list is in globalStorage
    mkdirSync(path.dirname(paths.profileSettings('b1')), { recursive: true });
    writeFileSync(paths.profileSettings('b1'), JSON.stringify({ x: 1, old: 2, [PROFILE_MARKER_KEY]: 'B' }));
    mkdirSync(path.dirname(paths.managedSettingsFile), { recursive: true });
    const legacy = JSON.stringify({ version: 1, profiles: { b1: ['old', PROFILE_MARKER_KEY, 'x'] } });
    writeFileSync(paths.managedSettingsFile, legacy);

    const env = { run: async () => ok(''), paths };
    const preset = parsePreset({ settings: { x: 3 }, profiles: { A: {}, B: {} } });
    const { plans } = await buildPlans(env, preset, ['A', 'B']);
    for (const plan of plans)
      expect(plan.settings?.changes).toEqual([
        { key: 'old', kind: 'remove', before: 2 },
        { key: 'x', kind: 'change', before: 1, after: 3 },
      ]);
    await executePlans(env, preset, plans);
    for (const [loc, name] of [
      ['a1', 'A'],
      ['b1', 'B'],
    ])
      expect(parseSettingsText(readFileSync(paths.profileSettings(loc), 'utf8'))).toEqual({
        x: 3,
        [PROFILE_MARKER_KEY]: name,
        [MANAGED_KEYS_KEY]: [PROFILE_MARKER_KEY, 'x'],
      });
    // the old file is only read, never rewritten
    expect(readFileSync(paths.managedSettingsFile, 'utf8')).toBe(legacy);
  });

  it('never writes a settings.json that does not parse', async () => {
    const paths = userDataPaths(dir);
    mkdirSync(path.dirname(paths.storageJson), { recursive: true });
    writeFileSync(paths.storageJson, JSON.stringify({ userDataProfiles: [{ name: 'Py', location: 'p1' }] }));
    const settingsFile = paths.profileSettings('p1');
    mkdirSync(path.dirname(settingsFile), { recursive: true });
    writeFileSync(settingsFile, '{ "broken": ');
    const env = { run: async () => ok(''), paths };
    const preset = parsePreset({ settings: { a: 1 }, profiles: { Py: {} } });
    const { plans, problems } = await buildPlans(env, preset, ['Py']);
    expect(problems.join('\n')).toContain('not valid JSON');
    expect(plans[0].settings).toBeUndefined();
    await executePlans(env, preset, plans);
    expect(readFileSync(settingsFile, 'utf8')).toBe('{ "broken": ');
  });

  it("leaves keys Default applies to all profiles out of profile settings.json and never writes Default's", async () => {
    const paths = userDataPaths(dir);
    mkdirSync(path.dirname(paths.storageJson), { recursive: true });
    writeFileSync(paths.storageJson, JSON.stringify({ userDataProfiles: [{ name: 'Py', location: 'p1' }] }));
    const defaultText =
      '{\n  "workbench.settings.applyToAllProfiles": ["editor.fontSize"],\n  "editor.fontSize": 20\n}\n';
    writeFileSync(paths.defaultSettings, defaultText);
    const env = { run: async () => ok(''), paths };
    const preset = parsePreset({
      settings: { 'editor.fontSize': 14 },
      profiles: { Py: { settings: { 'editor.tabSize': 4 } } },
    });
    const { plans, problems } = await buildPlans(env, preset, ['Py']);
    expect(problems.join('\n')).toContain('editor.fontSize: every profile takes it from Default');
    expect(plans[0].settings?.changes.map((c) => c.key)).toEqual(['editor.tabSize', PROFILE_MARKER_KEY]);
    await executePlans(env, preset, plans);
    expect(parseSettingsText(readFileSync(paths.profileSettings('p1'), 'utf8'))).toEqual({
      'editor.tabSize': 4,
      [PROFILE_MARKER_KEY]: 'Py',
      [MANAGED_KEYS_KEY]: ['editor.tabSize', PROFILE_MARKER_KEY],
    });
    expect(readFileSync(paths.defaultSettings, 'utf8')).toBe(defaultText);
  });
});

describe('installExtensions shouldStop', () => {
  it('stops before the next extension and keeps what was done', async () => {
    let stop = false;
    const run: CodeRunner = async (args) => {
      stop = true;
      return ok(`Extension '${args[args.length - 1]}' v1 was successfully installed.`);
    };
    const results = await installExtensions(run, 'P', ['a.b', 'c.d'], { shouldStop: () => stop, batchSize: 1 });
    expect(results.map((r) => r.id)).toEqual(['a.b']);
  });
});

describe('executePlans creating profiles', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'pk-create-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const setup = () => {
    const paths = userDataPaths(tmp);
    mkdirSync(path.dirname(paths.storageJson), { recursive: true });
    writeFileSync(paths.storageJson, JSON.stringify({ userDataProfiles: [] }));
    const calls: string[][] = [];
    const installed = new Set<string>();
    const run: CodeRunner = async (args) => {
      calls.push(args);
      // `--new-window` creates the profile: VS Code adds it to storage.json
      if (args.includes('--new-window'))
        writeFileSync(paths.storageJson, JSON.stringify({ userDataProfiles: [{ name: 'New', location: 'n1' }] }));
      if (args.includes('--list-extensions')) return ok([...installed].join('\n'));
      const id = args[args.indexOf('--install-extension') + 1];
      installed.add(id);
      return ok(`Extension '${id}' v1 was successfully installed.`);
    };
    const preset = parsePreset({ profiles: { New: { extensions: ['a.b'] } } });
    return { env: { run, paths }, calls, preset };
  };

  it('creates a missing profile, then installs into it', async () => {
    const { env, calls, preset } = setup();
    const { plans } = await buildPlans(env, preset, ['New']);
    const events: string[] = [];
    const [report] = await executePlans(env, preset, plans, {
      ensure: { sleep: noSleep },
      onEvent: (m) => events.push(m),
    });
    expect(report.created).toBe(true);
    expect(report.installs.map((i) => i.outcome)).toEqual(['installed']);
    expect(calls[0]).toEqual(['--profile', 'New', '--new-window']);
    expect(events.some((m) => m.includes('close it once the profile exists'))).toBe(true);
  });

  it('reports a missing profile without opening a window when creating is turned off', async () => {
    const { env, calls, preset } = setup();
    const { plans } = await buildPlans(env, preset, ['New']);
    const [report] = await executePlans(env, preset, plans, { createProfiles: false, createBlockedReason: 'blocked' });
    expect(report.problems).toEqual(['profile does not exist and was not created: blocked']);
    expect(calls.some((a) => a.includes('--new-window'))).toBe(false);
  });

  it('reports a profile that does not show up in time', async () => {
    const { env, preset } = setup();
    const { plans } = await buildPlans(env, preset, ['New']);
    const quiet: CodeRunner = async () => ok('');
    const [report] = await executePlans({ ...env, run: quiet }, preset, plans, {
      ensure: { sleep: noSleep, timeoutMs: 3, intervalMs: 1 },
    });
    expect(report.problems).toEqual(['profile was not created in time (is VS Code able to start?)']);
  });
});
