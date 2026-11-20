/**
 * `apply`: collect the current state, build a plan (core/applyPlan.ts), and carry it out.
 * Shared by the CLI and the extension so both do exactly the same thing.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

import {
  type CodeRunner,
  diffSettings,
  desiredSettings,
  editSettingsText,
  type Preset,
  type ProfileApplyPlan,
  type ProfileState,
  parseStorageProfiles,
  planProfile,
  type StorageProfiles,
  type StoredProfile,
} from '../core';
import {
  ensureProfile,
  installExtensions,
  type InstallOptions,
  type InstallResult,
  installSucceeded,
  listInstalled,
} from './installer';
import type { UserDataPaths } from './paths';
import { readManagedState, readSettingsFile, writeManagedState, writeProfileSettings } from './settingsWriter';

export interface ApplyEnv {
  run: CodeRunner;
  paths: UserDataPaths;
}

export function readStorage(paths: UserDataPaths): StorageProfiles {
  if (!existsSync(paths.storageJson)) return { profiles: [], folders: [], emptyWindows: [], problems: [] };
  return parseStorageProfiles(readFileSync(paths.storageJson, 'utf8'));
}

export interface PlanResult {
  plans: ProfileApplyPlan[];
  /** Problems reading VS Code's or Profile Kit's files, shown with the plan. */
  problems: string[];
}

/** Read-only: storage.json, `--list-extensions` per profile, settings.json files, managed keys. */
export async function buildPlans(env: ApplyEnv, preset: Preset, names: readonly string[]): Promise<PlanResult> {
  const storage = readStorage(env.paths);
  const managed = readManagedState(env.paths.managedSettingsFile);
  const problems = [...storage.problems, ...(managed.problem ? [managed.problem] : [])];
  const plans: ProfileApplyPlan[] = [];
  for (const name of names) {
    const stored = storage.profiles.find((p) => p.name === name);
    const state: ProfileState = {};
    if (stored) {
      state.stored = stored;
      state.installed = (await listInstalled(env.run, name)) ?? [];
      try {
        state.settings = readSettingsFile(env.paths.profileSettings(stored.location)).settings;
      } catch (error) {
        problems.push(`${name}: settings.json is not valid JSON, its settings are skipped (${String(error)})`);
      }
      state.managed = managed.state.profiles[stored.location] ?? [];
    }
    const plan = planProfile(preset, name, state);
    if (stored && state.settings === undefined) delete plan.settings;
    plans.push(plan);
  }
  return { plans, problems };
}

export interface ProfileReport {
  name: string;
  created?: boolean;
  installs: InstallResult[];
  settingsChanged: number;
  backup?: string;
  problems: string[];
}

export interface ApplyOptions {
  /** Create missing profiles (opens a VS Code window each). Default true. */
  createProfiles?: boolean;
  /** Reported for each profile that is not created because `createProfiles` is false. */
  createBlockedReason?: string;
  install?: InstallOptions;
  ensure?: Parameters<typeof ensureProfile>[3];
  onEvent?: (message: string) => void;
}

export const reportOk = (r: ProfileReport) =>
  r.problems.length === 0 && r.installs.every((i) => installSucceeded(i.outcome));

/**
 * Carry out plans made by buildPlans. Settings are diffed again right before writing (the file may have changed
 * since the preview); only keys from the preset and keys Profile Kit wrote before are touched.
 */
export async function executePlans(
  env: ApplyEnv,
  preset: Preset,
  plans: readonly ProfileApplyPlan[],
  options: ApplyOptions = {},
): Promise<ProfileReport[]> {
  const say = options.onEvent ?? (() => undefined);
  const reports: ProfileReport[] = [];
  const backupDir = env.paths.backupDir();
  const managedRead = readManagedState(env.paths.managedSettingsFile);
  const managed = managedRead.state;
  if (managedRead.problem) {
    // keep the unreadable file next to this run's backups before it is replaced
    mkdirSync(backupDir, { recursive: true });
    copyFileSync(env.paths.managedSettingsFile, path.join(backupDir, 'managed-settings.json'));
    say(`${managedRead.problem} (copied to ${backupDir})`);
  }

  for (const plan of plans) {
    const report: ProfileReport = { name: plan.name, installs: [], settingsChanged: 0, problems: [] };
    reports.push(report);

    let profile: StoredProfile | undefined = readStorage(env.paths).profiles.find((p) => p.name === plan.name);
    if (!profile) {
      if (options.createProfiles === false) {
        report.problems.push(
          `profile does not exist and was not created: ${options.createBlockedReason ?? 'creating profiles is turned off'}`,
        );
        continue;
      }
      say(`${plan.name}: creating the profile (a VS Code window opens)`);
      const ensured = await ensureProfile(env.run, plan.name, () => readStorage(env.paths).profiles, options.ensure);
      if (ensured.status === 'timeout') {
        report.problems.push('profile was not created in time (is VS Code able to start?)');
        continue;
      }
      report.created = ensured.status === 'created';
      profile = ensured.profile;
    }

    if (plan.extensions.missing.length) {
      say(`${plan.name}: installing ${plan.extensions.missing.length} extension(s)`);
      report.installs = await installExtensions(env.run, plan.name, plan.extensions.missing, {
        ...options.install,
        onProgress: (id, i, n) => {
          say(`${plan.name}: [${i + 1}/${n}] ${id}`);
          options.install?.onProgress?.(id, i, n);
        },
      });
    }

    if (plan.settings && !profile.useDefaultFlags.settings) {
      const desired = desiredSettings(preset, plan.name);
      if (!desired) continue;
      const file = env.paths.profileSettings(profile.location);
      try {
        const current = readSettingsFile(file);
        const fresh = diffSettings(current.settings, desired, managed.profiles[profile.location] ?? []);
        if (fresh.changes.length) {
          report.backup = writeProfileSettings(
            file,
            editSettingsText(current.text, fresh.changes),
            backupDir,
            profile.location,
          );
          report.settingsChanged = fresh.changes.length;
          say(`${plan.name}: ${fresh.changes.length} setting(s) written`);
        }
        managed.profiles[profile.location] = fresh.managed;
        writeManagedState(env.paths.managedSettingsFile, managed);
      } catch (error) {
        report.problems.push(`settings not written: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return reports;
}
