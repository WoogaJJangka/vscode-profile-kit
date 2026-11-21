/**
 * Reading what VS Code's own profile features left on disk, and exporting to VS Code's profile file (stage C).
 * Read only for VS Code's files: Default's extensions.json, product.json, the Settings Sync folder.
 * Shared by the CLI and the extension. docs/PLAN.md section 8-2.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

import {
  codeProfileFileName,
  EXTENSIONS_MANIFEST,
  type ExtensionInfo,
  type ImportedProfile,
  parseApplicationScoped,
  parseCodeProfile,
  parseTemplateList,
  type Preset,
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
 * A missing file means none; a broken one is reported and treated as none.
 */
export function readApplicationScoped(extensionsDir: string): { ids: string[]; problem?: string } {
  const file = path.join(extensionsDir, EXTENSIONS_MANIFEST);
  if (!existsSync(file)) return { ids: [] };
  try {
    return { ids: parseApplicationScoped(readFileSync(file, 'utf8')) };
  } catch (error) {
    return {
      ids: [],
      problem: `${file} could not be read, so extensions applied to all profiles are not known (${String(error)})`,
    };
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
  const list = parseTemplateList(JSON.parse(await getText(doFetch, url, timeoutMs)) as unknown);
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
