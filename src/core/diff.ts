import { normalizeId } from './preset';
import { compareCodeUnits } from './text';

export interface ExtensionDiff {
  /** Declared but not installed in the profile. */
  missing: string[];
  /** Installed in the profile but not declared (dependencies and extension packs land here too). */
  extra: string[];
  /** Declared and installed. */
  present: string[];
}

/**
 * Compare declared extension IDs with what `code --profile X --list-extensions` reported.
 * `ignoreExtra` (Profile Kit itself): never reported as extra, but still counted as present when declared.
 */
export function diffExtensions(
  wanted: readonly string[],
  installed: readonly string[],
  options: { ignoreExtra?: readonly string[] } = {},
): ExtensionDiff {
  const want = [...new Set(wanted.map(normalizeId))];
  const have = new Set(installed.map(normalizeId));
  const wantSet = new Set(want);
  const ignored = new Set((options.ignoreExtra ?? []).map(normalizeId));
  return {
    missing: want.filter((id) => !have.has(id)),
    extra: [...have].filter((id) => !wantSet.has(id) && !ignored.has(id)).sort(compareCodeUnits),
    present: want.filter((id) => have.has(id)),
  };
}
