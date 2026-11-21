import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type CodeRunner, parsePreset, parseSettingsText, PROFILE_MARKER_KEY, type RunResult } from '../src/core';
import { buildPlans, executePlans } from '../src/host/apply';
import { codeCliCandidates, findCodeCli } from '../src/host/codeLocator';
import { ensureProfile, installExtensions } from '../src/host/installer';
import { defaultUserDataDir, userDataDirFromGlobalStorage, userDataPaths } from '../src/host/paths';
import { readManagedState } from '../src/host/settingsWriter';

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
    const results = await installExtensions(run, 'P', ['a.net', 'b.unknown', 'c.gone', 'd.never'], { sleep: noSleep });
    expect(results.map((r) => [r.id, r.outcome, r.attempts])).toEqual([
      ['a.net', 'installed', 2],
      ['b.unknown', 'unknown', 1],
      ['c.gone', 'profile-not-found', 1],
      ['d.never', 'profile-not-found', 0],
    ]);
    expect(calls).toEqual(['a.net', 'a.net', 'b.unknown', 'c.gone']);
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
    expect(parseSettingsText(text)).toEqual({
      'user.key': 1,
      'editor.formatOnSave': true,
      'old.key': 'x',
      [PROFILE_MARKER_KEY]: 'Py',
    });
    expect(readManagedState(paths.managedSettingsFile).state.profiles.p1).toEqual([
      'editor.formatOnSave',
      'old.key',
      PROFILE_MARKER_KEY,
    ]);

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
    });
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
    const results = await installExtensions(run, 'P', ['a.b', 'c.d'], { shouldStop: () => stop });
    expect(results.map((r) => r.id)).toEqual(['a.b']);
  });
});
