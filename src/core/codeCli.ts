/**
 * Talking to the `code` CLI. Success is decided from the printed output, not the exit code
 * (decided after the PowerShell runs, see docs/PLAN.md section 4 and CLAUDE_CODE_PROMPT Phase 3).
 */

import { CLI_ALREADY_INSTALLED, CLI_INSTALLED, CLI_NETWORK_ERROR, cliProfileNotFound } from './compat';

export type InstallOutcome = 'installed' | 'already-installed' | 'profile-not-found' | 'network' | 'unknown';

/** `text` without the extension IDs in it, so an ID such as `x.foo-network` is not read as an error (review P10). */
function withoutIds(text: string, ids: readonly string[]): string {
  let out = text;
  for (const id of ids) out = out.split(id).join('').split(id.toLowerCase()).join('');
  return out;
}

/** Outcome of one `--install-extension` call. `ids`: the IDs in the call, left out when looking for errors. */
export function classifyInstallOutput(output: string, ids: readonly string[] = []): InstallOutcome {
  if (cliProfileNotFound(output)) return 'profile-not-found';
  if (CLI_ALREADY_INSTALLED.test(output)) return 'already-installed';
  if (CLI_INSTALLED.test(output)) return 'installed';
  if (CLI_NETWORK_ERROR.test(withoutIds(output, ids))) return 'network';
  return 'unknown';
}

/** In the output of a call that installed several extensions: did it say `id` was already installed? */
export function saysAlreadyInstalled(output: string, id: string): boolean {
  const quoted = `'${id.toLowerCase()}'`;
  return output.split(/\r?\n/).some((line) => line.toLowerCase().includes(quoted) && CLI_ALREADY_INSTALLED.test(line));
}

/** Only network errors are worth retrying; `unknown` is reported so it can be looked at. */
export function isTransient(outcome: InstallOutcome): boolean {
  return outcome === 'network';
}

/** Parse `code --list-extensions [--show-versions]` output into lower-case IDs. */
export function parseListExtensions(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*(@\S+)?$/i.test(line))
    .map((line) => line.split('@')[0].toLowerCase());
}

export function listExtensionsArgs(profile?: string): string[] {
  return [...(profile ? ['--profile', profile] : []), '--list-extensions'];
}

export function installExtensionArgs(profile: string, id: string): string[] {
  return ['--profile', profile, '--install-extension', id];
}

/** One call for several extensions (review P8); the CLI installs them one after another. */
export function installExtensionsArgs(profile: string, ids: readonly string[]): string[] {
  return ['--profile', profile, ...ids.flatMap((id) => ['--install-extension', id])];
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type CodeRunner = (args: string[]) => Promise<RunResult>;

/** Opens a window in the profile; VS Code creates the profile if it does not exist (PLAN.md section 8, #2; compat.ts). */
export function newWindowArgs(profile: string): string[] {
  return ['--profile', profile, '--new-window'];
}

export interface CodeRunnerOptions {
  /** Put before every call, e.g. `--user-data-dir <dir>` for an isolated VS Code. */
  baseArgs?: string[];
  /** Kill the call after this long (a hung install must not hang apply). Default: no limit. */
  timeoutMs?: number;
}

/**
 * The cmd.exe command line for `command args` on Windows. Every argument is put in double quotes, where cmd.exe
 * treats `&`, `|`, `<`, `>`, `^` and spaces as text. What quotes do not protect is refused instead of changed:
 * `"` (would end the quotes), `%` (cmd.exe expands `%NAME%` even inside quotes), line breaks and NUL.
 * Trailing backslashes are doubled so `"D:\"` does not become an escaped quote for Code.exe.
 * The command is quoted only when it has spaces: a quoted `"code"` makes code.cmd's %~dp0 point at the
 * current folder instead of VS Code's bin folder ("..\Code.exe is not recognized").
 */
export function windowsCommandLine(command: string, args: readonly string[]): string {
  const quote = (a: string) => {
    if (/["%\r\n\0]/.test(a)) throw new Error(`argument not passed to code: it contains " % or a line break (${a})`);
    return `"${a.replace(/(\\+)$/, '$1$1')}"`;
  };
  return [/\s/.test(command) ? quote(command) : command, ...args.map(quote)].join(' ');
}

/**
 * Default runner. On Windows `code` is `code.cmd`, which Node only starts through a shell, so the command line is
 * built by `windowsCommandLine`. Callers pass validated profile names and extension IDs (see preset.ts) and paths.
 * Calling `code.cmd` from the extension host works as is (PLAN.md section 8, #1).
 */
export function createCodeRunner(command = 'code', options: CodeRunnerOptions = {}): CodeRunner {
  const baseArgs = options.baseArgs ?? [];
  return async (callArgs) => {
    const args = [...baseArgs, ...callArgs];
    const { spawn } = await import('node:child_process');
    const isWindows = process.platform === 'win32';
    // built before the promise so a refused argument rejects the call instead of throwing out of the executor
    const line = isWindows ? windowsCommandLine(command, args) : undefined;
    return new Promise<RunResult>((resolve, reject) => {
      // One command string, not args + shell: Node 24 warns (DEP0190) because it would only concatenate them.
      const child =
        line !== undefined
          ? spawn(line, { shell: true, windowsHide: true })
          : spawn(command, args, { windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
      // On Windows the child is cmd.exe; killing it leaves code.cmd's Code.exe running, and that process keeps
      // stdout open, so 'close' would not come until it ends. taskkill /T ends the whole tree.
      const killTree = () => {
        if (isWindows && child.pid !== undefined)
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () =>
            child.kill(),
          );
        else child.kill();
      };
      const timer = options.timeoutMs
        ? setTimeout(() => {
            stderr += `\n[profile-kit] killed after ${options.timeoutMs} ms`;
            killTree();
          }, options.timeoutMs)
        : undefined;
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode });
      });
    });
  };
}
