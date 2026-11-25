/**
 * Starts a real VS Code on throwaway data folders with this repository as the extension under development, and lets
 * it run scripts/integration/suite.ts (the checks of the flows that need a window: dialogs, the tree, the manager).
 * All three data folders are in a new folder below the system's temporary folder, so the VS Code you use, its
 * profiles and its sign-ins are not involved (CLAUDE.md, docs/PLAN.md section 8 #8). A window opens, and more when the
 * suite creates a profile; VS Code closes itself when the suite has finished. The folder is removed when every check
 * passed; otherwise it is kept and its path is printed.
 *
 *   npm run build && npm run build:integration
 *   node out/integration/run.js [--timeout <seconds>]
 *
 * The VS Code that is started is the one unpacked into .vscode-test/vscode of this repository (to check another
 * version, or in CI), otherwise the VS Code installed on this PC. Only its program is used; the data is separate.
 *
 * Neither the program nor the data folder is an argument. CI and coding agents run this too, and a wrong argument
 * must not start another program or write into another folder (SonarQube S8701, S8705, S8707).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import * as path from 'node:path';
import { parseArgs } from 'node:util';

import { type IntegrationConfig, INTEGRATION_ENV, PRESET_FILE, PROFILE_HERE, startPreset } from './config';

const { values } = parseArgs({ options: { timeout: { type: 'string' } } });
const timeoutMs = Number(values.timeout ?? 600) * 1000;
// out/integration/run.js → the repository
const repo = path.resolve(__dirname, '..', '..');
const suite = path.join(repo, 'out', 'integration', 'suite.js');

/**
 * Where VS Code's own program is looked for, the unpacked one first. The program itself, not bin/code.
 * macOS is not checked (the integration checks have not run there).
 */
function programCandidates(): string[] {
  const unpacked = path.join(repo, '.vscode-test', 'vscode');
  if (process.platform === 'win32') {
    const { LOCALAPPDATA, ProgramFiles } = process.env;
    const installed = [LOCALAPPDATA ? path.join(LOCALAPPDATA, 'Programs') : undefined, ProgramFiles];
    return [
      path.join(unpacked, 'Code.exe'),
      ...installed.flatMap((dir) => (dir ? [path.join(dir, 'Microsoft VS Code', 'Code.exe')] : [])),
    ];
  }
  if (process.platform === 'darwin')
    return [unpacked, '/Applications', path.join(homedir(), 'Applications')].map((dir) =>
      path.join(dir, 'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron'),
    );
  return [path.join(unpacked, 'code'), '/usr/share/code/code', '/snap/code/current/usr/share/code/code'];
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}
const candidates = programCandidates();
const exe = candidates.find((p) => existsSync(p));
if (!exe) fail(['VS Code was not found. Looked for:', ...candidates].join('\n  '));
if (!existsSync(path.join(repo, 'dist', 'extension.js'))) fail('dist/extension.js is missing: run "npm run build"');
if (!existsSync(suite)) fail('out/integration/suite.js is missing: run "npm run build:integration"');

// A new folder each time: the checks start from a VS Code that has no profiles, extensions or settings yet.
// realpath, because Windows may name the temporary folder in its short form (RUNNER~1) and VS Code uses the long one.
const data = mkdtempSync(path.join(realpathSync.native(tmpdir()), 'profile-kit-it-'));
const [userData, extensionsDir, sharedData, workspace] = ['u', 'x', 's', 'ws'].map((d) => path.join(data, d));
for (const d of [path.join(userData, 'User'), extensionsDir, sharedData, workspace]) mkdirSync(d, { recursive: true });

const preset = path.join(workspace, PRESET_FILE);
writeFileSync(preset, startPreset());
// Default's settings.json of the throwaway VS Code: the preset to use, and nothing that asks or downloads by itself
writeFileSync(
  path.join(userData, 'User', 'settings.json'),
  `${JSON.stringify(
    {
      'profileKit.presetPath': preset,
      'update.mode': 'none',
      'extensions.autoUpdate': false,
      'extensions.autoCheckUpdates': false,
      'extensions.ignoreRecommendations': true,
      'telemetry.telemetryLevel': 'off',
      'workbench.startupEditor': 'none',
    },
    null,
    2,
  )}\n`,
);

const results = path.join(data, 'results.log');
const config: IntegrationConfig = { data, userData, extensionsDir, workspace, preset, results };
const dataArgs = ['--user-data-dir', userData, '--extensions-dir', extensionsDir, '--shared-data-dir', sharedData];
const env: NodeJS.ProcessEnv = {
  ...process.env,
  // the extension's own `code` calls must reach this VS Code, windows included (Kit.codeBaseArgs)
  PROFILE_KIT_CODE_ARGS: JSON.stringify(dataArgs),
  [INTEGRATION_ENV]: JSON.stringify(config),
};
// set in a shell that VS Code itself started: the executable would then run as plain Node instead of opening a window
delete env.ELECTRON_RUN_AS_NODE;

const args = [
  workspace,
  ...dataArgs,
  '--profile',
  PROFILE_HERE,
  `--extensionDevelopmentPath=${repo}`,
  `--extensionTestsPath=${suite}`,
  // the checks read the English texts, whatever the display language of this PC
  '--locale=en',
  '--disable-workspace-trust',
  '--disable-updates',
  '--skip-welcome',
  '--skip-release-notes',
  // CI containers have no user namespaces for Chromium's sandbox (same as @vscode/test-electron)
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu-sandbox'] : []),
];

console.log(`VS Code: ${exe}\ndata:    ${data}`);
const child = spawn(exe, args, { env, stdio: 'ignore' });
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  // only this VS Code: the process started here and what it started
  if (process.platform === 'win32' && child.pid !== undefined) {
    // by its full path, not whatever "taskkill" is found first through PATH (SonarQube S4036)
    const taskkill = path.join(process.env.SystemRoot ?? String.raw`C:\Windows`, 'System32', 'taskkill.exe');
    spawn(taskkill, ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => child.kill());
  } else child.kill();
}, timeoutMs);

child.on('error', (error) => {
  clearTimeout(timer);
  fail(`VS Code did not start: ${error.message}`);
});
child.on('exit', (code) => {
  clearTimeout(timer);
  const log = existsSync(results) ? readFileSync(results, 'utf8') : '';
  if (log) console.log(log.trimEnd());
  const finished = /^(all checks passed|\d+ check\(s\) failed)$/m.test(log);
  if (timedOut) console.error(`VS Code was ended after ${timeoutMs / 1000} s without finishing the checks`);
  else if (!finished) console.error(`VS Code ended (exit code ${code}) before the checks finished`);
  const passed = !timedOut && finished && code === 0 && /^all checks passed$/m.test(log);
  process.exitCode = passed ? 0 : 1;
  if (!passed) {
    console.error(`data kept: ${data}`);
    return;
  }
  try {
    // VS Code's last processes may still hold files for a moment after its main process has ended
    rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch {
    console.error(`could not remove ${data}`);
  }
});
