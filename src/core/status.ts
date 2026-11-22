/**
 * The state of the declared profiles in a few words, for the Profiles view's top row, the Activity Bar badge and
 * the menu: which profiles do not exist yet, which lack declared extensions, which are not listed yet.
 * Settings are not counted: knowing whether they differ needs a full apply plan (host/apply.ts).
 */

export interface ProfileStatusRow {
  name: string;
  declared: boolean;
  /** VS Code has the profile (storage.json). */
  exists: boolean;
  /** Declared extensions that are not installed; undefined while the profile is not listed yet. */
  missing?: number;
}

export interface PresetStatus {
  /** Declared profiles VS Code does not have yet. */
  notCreated: string[];
  /** Declared profiles that exist but lack declared extensions. */
  missing: string[];
  /** Declared profiles that exist and are not listed yet. */
  checking: string[];
  /** Declared profiles that exist and have every declared extension. */
  ok: string[];
}

export function presetStatus(rows: readonly ProfileStatusRow[]): PresetStatus {
  const status: PresetStatus = { notCreated: [], missing: [], checking: [], ok: [] };
  for (const row of rows) {
    if (!row.declared) continue;
    if (!row.exists) status.notCreated.push(row.name);
    else if (row.missing === undefined) status.checking.push(row.name);
    else if (row.missing > 0) status.missing.push(row.name);
    else status.ok.push(row.name);
  }
  return status;
}

/** Declared profiles that applying the preset would create or install into, as far as is known. */
export function needsChanges(status: PresetStatus): string[] {
  return [...status.notCreated, ...status.missing];
}

/** Number of declared profiles. */
export function declaredCount(status: PresetStatus): number {
  return status.notCreated.length + status.missing.length + status.checking.length + status.ok.length;
}
