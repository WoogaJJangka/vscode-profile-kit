/**
 * Talking to the `code` CLI. Success is decided from the printed output, not the exit code
 * (decided after the PowerShell runs, see docs/PLAN.md section 4 and CLAUDE_CODE_PROMPT Phase 3).
 */

export type InstallOutcome = 'installed' | 'already-installed' | 'profile-not-found' | 'network' | 'unknown';

const NETWORK_ERROR = /getaddrinfo|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|network/i;

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

/**
 * Default runner. On Windows `code` is `code.cmd`, which Node only starts through a shell, so arguments are
 * quoted here. Callers pass only validated profile names and extension IDs (see preset.ts).
 * Phase 2 checks whether calling Code.exe + cli.js directly is more robust (docs/PLAN.md, gate 3).
 */
export function createCodeRunner(command = 'code'): CodeRunner {
  return async (args) => {
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
      child.on('error', reject);
      child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode }));
    });
  };
}
