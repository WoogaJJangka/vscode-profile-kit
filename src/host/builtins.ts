/**
 * Reading what VS Code's own profile features left on disk, and exporting to VS Code's profile file (stage C).
 * Read only for VS Code's files: Default's extensions.json, installed extensions' package.json, product.json, the
 * Settings Sync folder.
 * Shared by the CLI and the extension. docs/PLAN.md section 8-2.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';

import {
  codeProfileFileName,
  compareCodeUnits,
  EXTENSIONS_MANIFEST,
  type ExtensionInfo,
  type ExtensionRelations,
  type ImportedProfile,
  parseApplicationScoped,
  parseCodeProfile,
  parseExtensionManifest,
  parseTemplateList,
  type Preset,
  readErrorSummary,
  relationsById,
  type ProfileTemplate,
  resolveProfile,
  serializeCodeProfile,
  templatesUrlFromProduct,
  toCodeProfile,
} from '../core';
import { queryGallery } from './marketplace';
import type { UserDataPaths } from './paths';
import { writeFileAtomic } from './settingsWriter';

/**
 * Extensions VS Code applies to all profiles, from `<extensionsDir>/extensions.json`.
 * A missing file means none; a broken one, or one that links outside the folder, is reported and treated as none.
 * The file is read by its real path and only when that is inside the folder (canonical path, then containment
 * check, then use: the order SonarQube S8707 asks for).
 */
export function readApplicationScoped(extensionsDir: string): { ids: string[]; problem?: string } {
  let base: string;
  let file: string;
  try {
    base = realpathSync(extensionsDir);
    file = realpathSync(path.join(base, EXTENSIONS_MANIFEST));
  } catch {
    return { ids: [] }; // no such folder or file
  }
  if (!file.startsWith(base + path.sep))
    return {
      ids: [],
      problem: `${EXTENSIONS_MANIFEST} in ${extensionsDir} points outside that folder, so it is not read`,
    };
  try {
    return { ids: parseApplicationScoped(readFileSync(file, 'utf8')) };
  } catch (error) {
    return {
      ids: [],
      problem: `${file} could not be read, so extensions applied to all profiles are not known (${readErrorSummary(error)})`,
    };
  }
}

/** One installed extension's package.json, as far as dependencies go. */
export interface InstalledManifest {
  id: string;
  relations: ExtensionRelations;
}

/**
 * What each installed extension needs or bundles, from the package.json in each folder of the extensions folder
 * (every profile installs into that one folder). Only the folder that holds VS Code's own extensions.json is listed,
 * so an extensions folder VS Code never used gives nothing. Folders that cannot be read are skipped: the result only
 * adds reasons to "not in the preset". A folder name carries the version, so its package.json does not change:
 * `cache` (folder name → manifest, null for "not an extension") lets a window read only new folders; gone names are
 * dropped from it.
 * Every path is used by its real path and only when that is inside the folder checked before it (canonical path,
 * then containment check, then use, in the function that uses it: the order SonarQube S8707 asks for). A folder or
 * file linked from elsewhere is skipped. Reads are synchronous, like readApplicationScoped; after the first refresh
 * only new folders are read.
 */
export async function readExtensionRelations(
  extensionsDir: string,
  cache: Map<string, InstalledManifest | null> = new Map(),
): Promise<Map<string, ExtensionRelations>> {
  let base: string;
  let list: string;
  try {
    base = realpathSync(extensionsDir);
    list = realpathSync(path.join(base, EXTENSIONS_MANIFEST));
  } catch {
    return new Map(); // no such folder, or VS Code has not installed anything there
  }
  if (!list.startsWith(base + path.sep)) return new Map();
  // the folder that holds extensions.json, by real path, and only when that is the given folder or inside it
  let dir: string;
  try {
    dir = realpathSync(path.dirname(list));
  } catch {
    return new Map();
  }
  if (dir !== base && !dir.startsWith(base + path.sep)) return new Map();
  let names: Set<string>;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    // VS Code unpacks into a dot folder first; extensions.json and .obsolete are files
    names = new Set(entries.filter((d) => !d.isFile() && !d.name.startsWith('.')).map((d) => d.name));
  } catch {
    return new Map();
  }
  for (const name of [...cache.keys()]) if (!names.has(name)) cache.delete(name);
  for (const name of names) if (!cache.has(name)) cache.set(name, readInstalledManifest(dir, name));
  const manifests = [...cache.values()].filter((m): m is InstalledManifest => m !== null);
  return relationsById(manifests.sort((a, b) => compareCodeUnits(a.id, b.id)));
}

/**
 * `<extensionsDir>/<folder>/package.json`, or null when it is missing, broken or not an extension's. Read by its real
 * path and only when that is inside the folder (same steps, in the same order, as readApplicationScoped).
 */
function readInstalledManifest(extensionsDir: string, folder: string): InstalledManifest | null {
  let base: string;
  let file: string;
  try {
    base = realpathSync(extensionsDir);
    file = realpathSync(path.join(base, folder, 'package.json'));
  } catch {
    return null; // not an extension folder
  }
  if (!file.startsWith(base + path.sep)) return null; // linked from elsewhere
  try {
    return parseExtensionManifest(JSON.parse(readFileSync(file, 'utf8'))) ?? null;
  } catch {
    return null; // unreadable or broken package.json: no reasons from it
  }
}

/**
 * Settings Sync has run on this PC (`User/sync/` exists). It stays after Sync is turned off, so this only means
 * "may be synced": the on/off switch is in VS Code's SQLite state, which Profile Kit does not read.
 */
export function syncedBefore(paths: UserDataPaths): boolean {
  return existsSync(paths.syncDir);
}

/** The note for previews when Settings Sync may copy the changes to other PCs (review stage C-3). */
export const SYNC_NOTE =
  'Settings Sync has run on this PC: if it is on, these profile changes also reach your other PCs';

/** The template list URL from `<appRoot>/product.json`, or undefined (no such key, or the file cannot be read). */
export function readTemplatesUrl(appRoot: string): string | undefined {
  try {
    return templatesUrlFromProduct(JSON.parse(readFileSync(path.join(appRoot, 'product.json'), 'utf8')));
  } catch {
    return undefined;
  }
}

type GetFetch = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface FetchedTemplate extends ProfileTemplate {
  profile?: ImportedProfile;
  error?: string;
}

async function getText(doFetch: GetFetch, url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * VS Code's template list and each template's `.code-profile`. Throws when the list itself cannot be read;
 * a template that cannot be read is returned with `error`.
 */
export async function fetchTemplates(
  url: string,
  options: { fetch?: GetFetch; timeoutMs?: number } = {},
): Promise<FetchedTemplate[]> {
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as GetFetch);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const text = await getText(doFetch, url, timeoutMs);
  // the parse error itself is not kept (not even as `cause`): it quotes the text it failed on
  let json: unknown;
  let failure: string | undefined;
  try {
    json = JSON.parse(text) as unknown;
  } catch (error) {
    failure = readErrorSummary(error);
  }
  if (failure !== undefined) throw new Error(`${url}: ${failure}`);
  const list = parseTemplateList(json);
  return Promise.all(
    list.map(async (t): Promise<FetchedTemplate> => {
      try {
        return { ...t, profile: parseCodeProfile(await getText(doFetch, t.url, timeoutMs)) };
      } catch (error) {
        return { ...t, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}

export interface ExportResult {
  files: string[];
  /** The Marketplace could not be asked, so files have no extension `uuid` (VS Code then matches by ID). */
  withoutUuids: boolean;
}

/**
 * Write one `<profile>.code-profile` per profile into `dir`. Extension GUIDs and display names come from the
 * Marketplace when it answers (`lookup: false` skips it); VS Code matches extensions by ID when they are absent.
 */
export async function exportCodeProfiles(
  preset: Preset,
  names: readonly string[],
  dir: string,
  options: { lookup?: boolean; query?: typeof queryGallery } = {},
): Promise<ExportResult> {
  const ids = [...new Set(names.flatMap((n) => resolveProfile(preset, n)))];
  let info = new Map<string, ExtensionInfo>();
  let withoutUuids = options.lookup === false;
  if (!withoutUuids && ids.length)
    try {
      info = await (options.query ?? queryGallery)(ids);
    } catch {
      withoutUuids = true;
    }
  mkdirSync(dir, { recursive: true });
  const files = names.map((name) => {
    const file = path.join(dir, codeProfileFileName(name));
    writeFileAtomic(file, serializeCodeProfile(toCodeProfile(preset, name, info)));
    return file;
  });
  return { files, withoutUuids };
}
