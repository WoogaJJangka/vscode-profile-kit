/**
 * Starts a real VS Code on throwaway data folders with this repository as the extension under development, and lets
 * it run scripts/integration/suite.ts (the checks of the flows that need a window: dialogs, the tree, the manager).
 * All three data folders are below --data, so the VS Code you use, its profiles and its sign-ins are not involved
 * (CLAUDE.md, docs/PLAN.md section 8 #8). A window opens, and a second one when the suite creates a profile; VS Code
 * closes itself when the suite has finished.
 *
 *   npm run build && npm run build:integration
 *   node out/integration/run.js --exe <VS Code executable> --data <empty folder> [--timeout <seconds>]
 *
 * --exe is the program itself, not bin/code: Code.exe (Windows), code (Linux, in the unpacked folder),
 * "Visual Studio Code.app/Contents/MacOS/Electron" (macOS).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';

import { type IntegrationConfig, INTEGRATION_ENV, PRESET_FILE, PROFILE_HERE, startPreset } from './config';

const { values } = parseArgs({
  options: { exe: { type: 'string' }, data: { type: 'string' }, timeout: { type: 'string' } },
});
if (!values.exe || !values.data) {
  console.error('usage: run.js --exe <VS Code executable> --data <empty folder> [--timeout <seconds>]');
  process.exit(2);
}
const exe = path.resolve(values.exe);
const data = path.resolve(values.data);
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
// never reuse a folder: the checks start from a VS Code that has no profiles, extensions or settings yet
if (existsSync(data) && readdirSync(data).length) fail(`--data must be an empty folder: ${data}`);

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
  if (process.platform === 'win32' && child.pid !== undefined)
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => child.kill());
  else child.kill();
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
  process.exitCode = !timedOut && finished && code === 0 && /^all checks passed$/m.test(log) ? 0 : 1;
});
