/**
 * Read and write profile settings.json files and the list of keys Profile Kit manages in each.
 * Every write is preceded by a backup copy, and files are replaced atomically (write temp file, rename).
 * Default's settings.json (`User/settings.json`) is never a target: paths come from `profileSettings(location)`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { isRecord, parseSettingsText, type SettingsMap } from '../core';

export interface ManagedState {
  version: 1;
  /** Profile location (folder under User/profiles, stable across renames) → keys Profile Kit wrote. */
  profiles: Record<string, string[]>;
}

export interface ManagedStateRead {
  state: ManagedState;
  /** Set when the file existed but could not be used; the state is then empty, so nothing gets removed. */
  problem?: string;
}

const emptyState = (): ManagedState => ({ version: 1, profiles: {} });

export function readManagedState(file: string): ManagedStateRead {
  if (!existsSync(file)) return { state: emptyState() };
  try {
    const json: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isRecord(json) || json.version !== 1 || !isRecord(json.profiles)) throw new Error('unexpected shape');
    const profiles: Record<string, string[]> = {};
    for (const [loc, keys] of Object.entries(json.profiles))
      if (Array.isArray(keys)) profiles[loc] = keys.filter((k): k is string => typeof k === 'string');
    return { state: { version: 1, profiles } };
  } catch (error) {
    return {
      state: emptyState(),
      problem: `${file} could not be read (${error instanceof Error ? error.message : String(error)}); keys from earlier runs will not be removed`,
    };
  }
}

/** Write a text file atomically, creating its folder. */
export function writeFileAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.profile-kit-${process.pid}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

export function writeManagedState(file: string, state: ManagedState): void {
  writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`);
}

export interface SettingsFile {
  exists: boolean;
  text: string;
  settings: SettingsMap;
}

/** Read a settings.json. A missing file is empty; a syntax error throws (a broken file is never overwritten). */
export function readSettingsFile(file: string): SettingsFile {
  if (!existsSync(file)) return { exists: false, text: '', settings: {} };
  const text = readFileSync(file, 'utf8');
  return { exists: true, text, settings: parseSettingsText(text) };
}

/**
 * Replace a profile's settings.json with `text`, copying the old file to `<backupDir>/<location>/settings.json` first.
 * Returns the backup path, or undefined when there was no file to back up.
 */
export function writeProfileSettings(
  file: string,
  text: string,
  backupDir: string,
  location: string,
): string | undefined {
  let backup: string | undefined;
  if (existsSync(file)) {
    backup = path.join(backupDir, location, 'settings.json');
    mkdirSync(path.dirname(backup), { recursive: true });
    copyFileSync(file, backup);
  }
  writeFileAtomic(file, text);
  return backup;
}
