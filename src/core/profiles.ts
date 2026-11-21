/**
 * Read VS Code's profile list and folder → profile links from `<userData>/User/globalStorage/storage.json`.
 * Read only: Profile Kit never writes storage.json (PLAN.md). The format is VS Code-internal, so every field
 * is optional here and entries that do not look right are skipped and reported instead of failing.
 *
 * Shape seen in VS Code 1.9x:
 *   "userDataProfiles": [{ "location": "-6a5b1c2d", "name": "Python-Data", "icon"?: "...",
 *                          "useDefaultFlags"?: { "settings": true, ... } }]
 *   "profileAssociations": { "workspaces": { "file:///d%3A/dev/foo": "-6a5b1c2d" }, "emptyWindows": { ... } }
 * `location` is the folder name under `User/profiles/`; older versions stored a URI object instead.
 */
import { parse, type ParseError } from 'jsonc-parser';

import { isRecord, stripBom } from './preset';
import { trimTrailingSlashes } from './text';

/** Profile ID VS Code uses for Default in `profileAssociations`. */
export const DEFAULT_PROFILE_ID = '__default__profile__';

export interface StoredProfile {
  name: string;
  /** Folder name under `<userData>/User/profiles/`; also the profile ID used in `profileAssociations`. */
  location: string;
  /** Which resources come from Default (`settings`, `keybindings`, `snippets`, `tasks`, `extensions`, ...). */
  useDefaultFlags: Record<string, boolean>;
  icon?: string;
}

export interface FolderAssociation {
  /** Workspace or folder URI as VS Code stores it, e.g. `file:///d%3A/dev/foo`. */
  uri: string;
  /** Profile location/ID, or DEFAULT_PROFILE_ID. */
  location: string;
  /** Profile name when the location is a known profile, `Default` for Default, otherwise undefined. */
  profile?: string;
}

export interface StorageProfiles {
  profiles: StoredProfile[];
  folders: FolderAssociation[];
  emptyWindows: FolderAssociation[];
  /** What was skipped and why; empty when everything was understood. */
  problems: string[];
}

function locationOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  // older versions: a serialized URI { $mid, scheme, path, fsPath? }
  if (isRecord(v)) {
    const path = typeof v.path === 'string' ? v.path : typeof v.fsPath === 'string' ? v.fsPath : undefined;
    const name = path?.split(/[\\/]/).filter(Boolean).pop();
    return name || undefined;
  }
  return undefined;
}

function flagsOf(v: unknown): Record<string, boolean> {
  if (!isRecord(v)) return {};
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'));
}

function readAssociations(
  v: unknown,
  where: string,
  byLocation: ReadonlyMap<string, string>,
  problems: string[],
): FolderAssociation[] {
  if (v === undefined) return [];
  if (!isRecord(v)) {
    problems.push(`${where} is not an object`);
    return [];
  }
  const out: FolderAssociation[] = [];
  for (const [uri, raw] of Object.entries(v)) {
    const location = locationOf(raw);
    if (!location) {
      problems.push(`${where}["${uri}"] has no profile ID`);
      continue;
    }
    const profile = location === DEFAULT_PROFILE_ID ? 'Default' : byLocation.get(location);
    out.push({ uri, location, ...(profile !== undefined ? { profile } : {}) });
  }
  return out;
}

/** Parse storage.json text. Never throws: broken input gives empty lists and a problem entry. */
export function parseStorageProfiles(text: string): StorageProfiles {
  const result: StorageProfiles = { profiles: [], folders: [], emptyWindows: [], problems: [] };
  const errors: ParseError[] = [];
  const json: unknown = parse(stripBom(text), errors, { allowTrailingComma: true });
  if (errors.length) result.problems.push(`storage.json has ${errors.length} syntax error(s); read what could be read`);
  if (!isRecord(json)) {
    result.problems.push('storage.json is not a JSON object');
    return result;
  }

  const raw = json.userDataProfiles;
  if (raw !== undefined && !Array.isArray(raw)) result.problems.push('userDataProfiles is not a list');
  const seen = new Set<string>();
  const entries: unknown[] = Array.isArray(raw) ? raw : [];
  for (const [i, entry] of entries.entries()) {
    const where = `userDataProfiles[${i}]`;
    const problem = (p: string) => result.problems.push(`${where} ${p}`);
    if (!isRecord(entry)) {
      problem('is not an object');
      continue;
    }
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name : undefined;
    const location = locationOf(entry.location);
    if (!name) {
      problem('has no name');
      continue;
    }
    if (!location || seen.has(location)) {
      problem(location ? `("${name}") repeats location ${location}` : `("${name}") has no location`);
      continue;
    }
    seen.add(location);
    result.profiles.push({
      name,
      location,
      useDefaultFlags: flagsOf(entry.useDefaultFlags),
      ...(typeof entry.icon === 'string' ? { icon: entry.icon } : {}),
    });
  }

  const byLocation = new Map(result.profiles.map((p) => [p.location, p.name]));
  const assoc = json.profileAssociations;
  if (assoc !== undefined && !isRecord(assoc)) result.problems.push('profileAssociations is not an object');
  else if (isRecord(assoc)) {
    result.folders = readAssociations(assoc.workspaces, 'profileAssociations.workspaces', byLocation, result.problems);
    result.emptyWindows = readAssociations(
      assoc.emptyWindows,
      'profileAssociations.emptyWindows',
      byLocation,
      result.problems,
    );
  }
  return result;
}

/**
 * Comparable form of a folder URI or path: decoded, forward slashes, no trailing slash,
 * Windows drive paths lower-cased (`file:///d%3A/Dev` and `D:\dev` are the same folder).
 */
export function folderKey(uriOrPath: string): string {
  let s = uriOrPath.trim();
  if (/^file:\/\//i.test(s)) {
    s = s.replace(/^file:\/\/[^/]*/i, '');
    try {
      s = decodeURIComponent(s);
    } catch {
      // keep the raw text if it has a broken % escape
    }
  }
  s = trimTrailingSlashes(s.replace(/\\/g, '/'));
  if (/^[A-Za-z]:/.test(s)) s = `/${s}`;
  if (/^\/[A-Za-z]:/.test(s)) s = s.toLowerCase();
  return s;
}

/** The profile a folder is linked to, if any. */
export function folderProfile(info: StorageProfiles, uriOrPath: string): FolderAssociation | undefined {
  const key = folderKey(uriOrPath);
  return info.folders.find((f) => folderKey(f.uri) === key);
}
