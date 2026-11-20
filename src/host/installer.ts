/**
 * Create profiles and install extensions through the `code` CLI.
 * Success comes from the printed output (classifyInstallOutput), not the exit code; only network errors are retried.
 */
import {
  classifyInstallOutput,
  type CodeRunner,
  type InstallOutcome,
  installExtensionArgs,
  isTransient,
  listExtensionsArgs,
  newWindowArgs,
  parseListExtensions,
  retry,
  type StoredProfile,
} from '../core';

export interface InstallResult {
  id: string;
  outcome: InstallOutcome;
  attempts: number;
  /** Last lines of the CLI output, for the report when it did not work. */
  detail?: string;
}

export const installSucceeded = (outcome: InstallOutcome) => outcome === 'installed' || outcome === 'already-installed';

export interface InstallOptions {
  /** Tries per extension, including the first (default 3). */
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (id: string, index: number, total: number) => void;
  /** Checked before each extension; true stops the run (what was installed so far stays). */
  shouldStop?: () => boolean;
}

class TransientInstallError extends Error {
  constructor(readonly output: string) {
    super('network error while installing');
  }
}

const tail = (s: string) => s.trim().split(/\r?\n/).slice(-3).join('\n');

/** Install `ids` into `profile` one by one. Stops early when the profile turns out not to exist. */
export async function installExtensions(
  run: CodeRunner,
  profile: string,
  ids: readonly string[],
  options: InstallOptions = {},
): Promise<InstallResult[]> {
  const results: InstallResult[] = [];
  for (const [index, id] of ids.entries()) {
    if (options.shouldStop?.()) break;
    options.onProgress?.(id, index, ids.length);
    let attempts = 0;
    let result: InstallResult;
    try {
      result = await retry(
        async (attempt) => {
          attempts = attempt;
          const r = await run(installExtensionArgs(profile, id));
          const output = `${r.stdout}\n${r.stderr}`;
          const outcome = classifyInstallOutput(output);
          if (isTransient(outcome)) throw new TransientInstallError(output);
          return { id, outcome, attempts: attempt, ...(installSucceeded(outcome) ? {} : { detail: tail(output) }) };
        },
        {
          attempts: options.attempts ?? 3,
          baseDelayMs: options.baseDelayMs ?? 2000,
          shouldRetry: (error) => error instanceof TransientInstallError,
          ...(options.sleep ? { sleep: options.sleep } : {}),
        },
      );
    } catch (error) {
      if (!(error instanceof TransientInstallError)) throw error;
      result = { id, outcome: 'network', attempts, detail: tail(error.output) };
    }
    results.push(result);
    if (result.outcome === 'profile-not-found') {
      for (const rest of ids.slice(index + 1)) results.push({ id: rest, outcome: 'profile-not-found', attempts: 0 });
      break;
    }
  }
  return results;
}

/** `--list-extensions` of a profile; undefined when VS Code says the profile does not exist. */
export async function listInstalled(run: CodeRunner, profile: string): Promise<string[] | undefined> {
  const r = await run(listExtensionsArgs(profile));
  if (/profile '.*' not found/i.test(`${r.stdout}\n${r.stderr}`)) return undefined;
  return parseListExtensions(r.stdout);
}

export interface EnsureProfileOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type EnsureProfileResult =
  { status: 'exists' | 'created'; profile: StoredProfile } | { status: 'timeout'; profile?: undefined };

/**
 * Make sure a profile exists. VS Code has no way to create one without a window (PLAN.md section 8, #2), so a
 * missing profile is created with `code --profile <name> --new-window` and storage.json is polled until it shows up.
 */
export async function ensureProfile(
  run: CodeRunner,
  name: string,
  readProfiles: () => StoredProfile[] | Promise<StoredProfile[]>,
  options: EnsureProfileOptions = {},
): Promise<EnsureProfileResult> {
  const find = async () => (await readProfiles()).find((p) => p.name === name);
  const existing = await find();
  if (existing) return { status: 'exists', profile: existing };
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  await run(newWindowArgs(name));
  const deadline = options.timeoutMs ?? 30_000;
  const step = options.intervalMs ?? 1000;
  for (let waited = 0; waited < deadline; waited += step) {
    await sleep(step);
    const created = await find();
    if (created) return { status: 'created', profile: created };
  }
  return { status: 'timeout' };
}
