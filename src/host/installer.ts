/**
 * Create profiles and install extensions through the `code` CLI.
 * Success comes from the printed output (classifyInstallOutput), not the exit code; only network errors are retried.
 * Extensions go in batches, one call each (review P8); afterwards `--list-extensions` says which really went in,
 * and the rest are tried one by one. A single call whose output is unclear is also checked with the list (P10).
 */
import {
  classifyInstallOutput,
  cliProfileNotFound,
  type CodeRunner,
  type InstallOutcome,
  installExtensionArgs,
  installExtensionsArgs,
  isTransient,
  listExtensionsArgs,
  newWindowArgs,
  parseListExtensions,
  retry,
  saysAlreadyInstalled,
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
  /** Called for each extension just before the call that installs it. */
  onProgress?: (id: string, index: number, total: number) => void;
  /** Checked before each call; true stops the run (what was installed so far stays). */
  shouldStop?: () => boolean;
  /** Extensions per `code` call (default 10; 1 = one call per extension). */
  batchSize?: number;
}

class TransientInstallError extends Error {
  constructor(readonly output: string) {
    super('network error while installing');
  }
}

const tail = (s: string) => s.trim().split(/\r?\n/).slice(-3).join('\n');

/** `--list-extensions` of a profile; undefined when VS Code says the profile does not exist. */
export async function listInstalled(run: CodeRunner, profile: string): Promise<string[] | undefined> {
  const r = await run(listExtensionsArgs(profile));
  if (cliProfileNotFound(`${r.stdout}\n${r.stderr}`)) return undefined;
  return parseListExtensions(r.stdout);
}

/** Lower-case IDs installed in `profile`, or undefined when that cannot be told. */
async function installedSet(run: CodeRunner, profile: string): Promise<Set<string> | undefined> {
  const list = await listInstalled(run, profile).catch(() => undefined);
  return list && new Set(list);
}

/** One extension, one call at a time: network errors are retried, an unclear result is checked with the list. */
async function installOne(
  run: CodeRunner,
  profile: string,
  id: string,
  options: InstallOptions,
  triedBefore = 0,
): Promise<InstallResult> {
  let attempts = triedBefore;
  let result: InstallResult;
  try {
    result = await retry(
      async () => {
        attempts++;
        const r = await run(installExtensionArgs(profile, id));
        const output = `${r.stdout}\n${r.stderr}`;
        const outcome = classifyInstallOutput(output, [id]);
        if (isTransient(outcome)) throw new TransientInstallError(output);
        return { id, outcome, attempts, ...(installSucceeded(outcome) ? {} : { detail: tail(output) }) };
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
  // the output did not say (other wording, other language): what is installed decides (review P10)
  if (result.outcome === 'unknown' && (await installedSet(run, profile))?.has(id.toLowerCase()))
    return { id, outcome: 'installed', attempts };
  return result;
}

/** One batch: a single call for all of it, then the list decides; what is not there is tried on its own. */
async function installBatch(
  run: CodeRunner,
  profile: string,
  batch: readonly string[],
  options: InstallOptions,
): Promise<InstallResult[]> {
  if (batch.length === 1) return [await installOne(run, profile, batch[0], options)];
  const r = await run(installExtensionsArgs(profile, batch));
  const output = `${r.stdout}
${r.stderr}`;
  if (cliProfileNotFound(output)) return [{ id: batch[0], outcome: 'profile-not-found', attempts: 1 }];
  const installed = await installedSet(run, profile);
  const results: InstallResult[] = [];
  for (const id of batch) {
    if (installed?.has(id.toLowerCase())) {
      results.push({ id, outcome: saysAlreadyInstalled(output, id) ? 'already-installed' : 'installed', attempts: 1 });
      continue;
    }
    if (options.shouldStop?.()) break;
    const result = await installOne(run, profile, id, options, 1);
    results.push(result);
    if (result.outcome === 'profile-not-found') break;
  }
  return results;
}

/** Install `ids` into `profile`. Stops early when the profile turns out not to exist. */
export async function installExtensions(
  run: CodeRunner,
  profile: string,
  ids: readonly string[],
  options: InstallOptions = {},
): Promise<InstallResult[]> {
  const size = Math.max(1, options.batchSize ?? 10);
  const results: InstallResult[] = [];
  for (let start = 0; start < ids.length; start += size) {
    if (options.shouldStop?.()) break;
    const batch = ids.slice(start, start + size);
    batch.forEach((id, i) => options.onProgress?.(id, start + i, ids.length));
    const done = await installBatch(run, profile, batch, options);
    results.push(...done);
    if (done[done.length - 1]?.outcome === 'profile-not-found') {
      for (const id of ids.slice(results.length)) results.push({ id, outcome: 'profile-not-found', attempts: 0 });
      break;
    }
    if (done.length < batch.length) break; // stopped in the middle of the batch
  }
  return results;
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
