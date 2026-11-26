/**
 * VS Code's lists of installed extensions, `extensions.json` (read only; Profile Kit never writes these files).
 *
 * The one in the extensions folder (`~/.vscode/extensions/extensions.json`, `--extensions-dir`) is the Default
 * profile's list, and it also holds the extensions marked "Apply Extension to all Profiles"
 * (`metadata.isApplicationScoped`). `code --list-extensions` shows those in every profile without saying why
 * (stage C-2, docs/PLAN.md section 8-2).
 *
 * Every other profile has its own list in `User/profiles/<location>/extensions.json`, unless it uses Default's
 * extensions. What `code --list-extensions --profile X` prints is put together from the two files
 * (profileInstalledIds), which is how Profile Kit knows what is installed without starting a `code` process per
 * profile (1.5.x, docs/PLAN.md section 15).
 */
import { APPLICATION_SCOPED_FLAG, BUILTIN_FLAG } from './compat';
import { isRecord, normalizeId, stripBom } from './preset';
import type { StoredProfile } from './profiles';
import { compareCodeUnits } from './text';

/** Lower-case IDs of extensions VS Code applies to all profiles. Throws when the text is not a JSON list. */
export function parseApplicationScoped(text: string): string[] {
  const json = JSON.parse(text) as unknown;
  if (!Array.isArray(json)) throw new Error('extensions.json is not a list');
  const ids = json.flatMap((e) => {
    if (!isRecord(e) || !isRecord(e.identifier) || typeof e.identifier.id !== 'string') return [];
    return isRecord(e.metadata) && e.metadata[APPLICATION_SCOPED_FLAG] === true ? [normalizeId(e.identifier.id)] : [];
  });
  return [...new Set(ids)].sort(compareCodeUnits);
}

/** One entry of an extensions.json, as far as Profile Kit reads it. */
export interface ListedExtension {
  /** Lower-case `publisher.name`. */
  id: string;
  /** "Apply Extension to all Profiles": Default's entry counts in every profile. */
  applicationScoped: boolean;
  /** A newer version of an extension that ships with VS Code: Default's entry counts in every profile. */
  builtin: boolean;
}

/**
 * The entries of an extensions.json. Throws when the text is not a list of entries that each name an extension, so
 * a format Profile Kit does not understand is never taken for a list (the caller then asks the `code` CLI).
 * As VS Code reads it: an empty file is an empty list, and an entry whose `location` is plain text is left out.
 */
export function parseExtensionsJson(text: string): ListedExtension[] {
  const json = JSON.parse(stripBom(text).trim() || '[]') as unknown;
  if (!Array.isArray(json)) throw new Error('extensions.json is not a list');
  const out: ListedExtension[] = [];
  for (const e of json) {
    if (!isRecord(e) || !isRecord(e.identifier) || typeof e.identifier.id !== 'string' || !e.identifier.id.trim())
      throw new Error('extensions.json has an entry without an extension ID');
    if (typeof e.location === 'string' && !(typeof e.relativeLocation === 'string' && e.relativeLocation)) continue;
    const metadata = isRecord(e.metadata) ? e.metadata : {};
    out.push({
      id: normalizeId(e.identifier.id),
      applicationScoped: metadata[APPLICATION_SCOPED_FLAG] === true,
      builtin: metadata[BUILTIN_FLAG] === true,
    });
  }
  return out;
}

const sortedIds = (ids: readonly string[]) => [...new Set(ids)].sort(compareCodeUnits);

/** What `code --list-extensions` prints for Default, and for a profile that uses Default's extensions. */
export function defaultInstalledIds(defaults: readonly ListedExtension[]): string[] {
  return sortedIds(defaults.map((e) => e.id));
}

/**
 * What `code --list-extensions --profile X` prints for a profile with extensions of its own: its entries except the
 * ones marked as applied to all profiles, plus Default's entries that are (or that update an extension shipped with
 * VS Code). The same rule as VS Code's own scan of a profile (read in 1.148: scanExtensionsFromProfile).
 */
export function profileInstalledIds(own: readonly ListedExtension[], defaults: readonly ListedExtension[]): string[] {
  return sortedIds([
    ...own.filter((e) => !e.applicationScoped).map((e) => e.id),
    ...defaults.filter((e) => e.applicationScoped || e.builtin).map((e) => e.id),
  ]);
}

// --- when VS Code writes these lists (ui/kit.ts watches them) ---

const sameLocation = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Which profiles to read again after VS Code wrote some lists. Each entry of `changed` is a profile's location for
 * its own list, or undefined for Default's list in the extensions folder.
 * 'all' when Default's list changed (what it applies to all profiles is in every profile's list), or when a list
 * belongs to no known profile (one VS Code made after storage.json was last read). Otherwise the profiles' names.
 */
export function profilesToReread(
  changed: Iterable<string | undefined>,
  profiles: readonly Pick<StoredProfile, 'name' | 'location'>[],
): 'all' | string[] {
  const names = new Set<string>();
  for (const location of changed) {
    if (location === undefined) return 'all';
    const owner = profiles.find((p) => sameLocation(p.location, location));
    if (!owner) return 'all';
    names.add(owner.name);
  }
  return [...names];
}

/**
 * Whether a list VS Code wrote is part of a profile's installed list: its own list, or Default's (every profile's
 * list has what Default applies to all profiles, and Default's is all there is for Default itself and for a profile
 * that uses Default's extensions). `changed` and `own` are locations; undefined stands for Default.
 */
export function listCountsFor(changed: string | undefined, own: string | undefined): boolean {
  return changed === undefined || (own !== undefined && sameLocation(changed, own));
}
