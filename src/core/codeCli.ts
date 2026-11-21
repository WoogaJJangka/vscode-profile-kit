/**
 * Talking to the `code` CLI. Success is decided from the printed output, not the exit code
 * (decided after the PowerShell runs, see docs/PLAN.md section 4 and CLAUDE_CODE_PROMPT Phase 3).
 */

export type InstallOutcome = 'installed' | 'already-installed' | 'profile-not-found' | 'network' | 'unknown';

// `(Error: aborted)`: the VSIX download was cut off while being written to CachedExtensionVSIXs
// ("Unable to write file ... (Error: aborted)", install-log 2026-11-20). A retry succeeded every time.
const NETWORK_ERROR =
  /getaddrinfo|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|network|\(Error: aborted\)/i;

export function classifyInstallOutput(output: string): InstallOutcome {
  if (/profile '.*' not found/i.test(output)) return 'profile-not-found';
  if (/already installed/i.test(output)) return 'already-installed';
  if (/successfully installed/i.test(output)) return 'installed';
  if (NETWORK_ERROR.test(output)) return 'network';
  return 'unknown';
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

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type CodeRunner = (args: string[]) => Promise<RunResult>;

/** Opens a window in the profile; VS Code creates the profile if it does not exist (PLAN.md section 8, #2). */
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
 * Default runner. On Windows `code` is `code.cmd`, which Node only starts through a shell, so arguments are
 * quoted here. Callers pass only validated profile names and extension IDs (see preset.ts) and paths.
 * Calling `code.cmd` from the extension host works as is (PLAN.md section 8, #1).
 */
export function createCodeRunner(command = 'code', options: CodeRunnerOptions = {}): CodeRunner {
  const baseArgs = options.baseArgs ?? [];
  return async (callArgs) => {
    const args = [...baseArgs, ...callArgs];
    const { spawn } = await import('node:child_process');
    const isWindows = process.platform === 'win32';
    return new Promise<RunResult>((resolve, reject) => {
      // One command string, not args + shell: Node 24 warns (DEP0190) because it would only concatenate them.
      // Quote the command only when it has spaces: a quoted `"code"` makes code.cmd's %~dp0 point at the
      // current folder instead of VS Code's bin folder ("..\Code.exe is not recognized").
      const quote = (a: string) => `"${a.replace(/"/g, '')}"`;
      const child = isWindows
        ? spawn([/\s/.test(command) ? quote(command) : command, ...args.map(quote)].join(' '), {
            shell: true,
            windowsHide: true,
          })
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
