/**
 * Starts a real VS Code on throwaway data folders with this repository as the extension under development, and lets
 * it run scripts/integration/suite.ts (the checks of the flows that need a window: dialogs, the tree, the manager).
 * All three data folders are in a new folder below the system's temporary folder, so the VS Code you use, its
 * profiles and its sign-ins are not involved (CLAUDE.md, docs/PLAN.md section 8 #8). A window opens, and more when the
 * suite creates a profile; VS Code closes itself when the suite has finished. The folder is removed when every check
 * passed; otherwise it is kept and its path is printed.
 *
 *   npm run build && npm run build:integration
 *   node out/integration/run.js --exe <VS Code executable> [--timeout <seconds>]
 *
 * --exe is the program itself, not bin/code: Code.exe (Windows), code (Linux, in the unpacked folder),
 * "Visual Studio Code.app/Contents/MacOS/Electron" (macOS).
 *
 * The command line decides as little as possible, because CI and coding agents run this too: only a file with one of
 * those names is started, and where the data goes is not an argument (SonarQube S8701, S8705, S8707).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { parseArgs } from 'node:util';

import { type IntegrationConfig, INTEGRATION_ENV, PRESET_FILE, PROFILE_HERE, startPreset } from './config';

const { values } = parseArgs({ options: { exe: { type: 'string' }, timeout: { type: 'string' } } });
if (!values.exe) {
  console.error('usage: run.js --exe <VS Code executable> [--timeout <seconds>]');
  process.exit(2);
}
const exe = path.resolve(values.exe);
// The whole path has to match: folders, then one of the names VS Code's own program has (stable and Insiders;
// Windows, Linux, macOS). Nothing else is started.
const VSCODE_PROGRAM = /^(?:[a-z]:)?(?:[\\/][^\\/]+)*[\\/](?:code(?: - insiders)?\.exe|code(?:-insiders)?|electron)$/i;
if (!VSCODE_PROGRAM.test(exe)) {
  console.error(`--exe is not a VS Code program (Code.exe, code, Electron): ${exe}`);
  process.exit(2);
}
const timeoutMs = Number(values.timeout ?? 600) * 1000;
// out/integration/run.js → the repository
const repo = path.resolve(__dirname, '..', '..');
const suite = path.join(repo, 'out', 'integration', 'suite.js');

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}
if (!existsSync(exe)) fail(`not found: ${exe}`);
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
