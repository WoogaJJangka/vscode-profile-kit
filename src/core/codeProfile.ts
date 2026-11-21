/**
 * VS Code's own profile file (`.code-profile`, Profiles editor Export / Import) ↔ Profile Kit presets (stage C-1).
 * The format is not documented. It was read from VS Code's built-in templates and its import code
 * (docs/PLAN.md section 8-2): a JSON object whose values are JSON again, stored as strings.
 *   settings   → `{"settings": "<settings.json text>"}`
 *   extensions → `[{"identifier": {"id", "uuid"?}, "displayName"?, "preRelease"?, "applicationScoped"?, "disabled"?}]`
 * VS Code itself only checks that `name` is a string and icon / settings / globalState / extensions are strings.
 * Pure logic: the host writes and reads the files, VS Code's Profiles editor does the import.
 */
import { desiredSettings, MANAGED_KEYS_KEY, PROFILE_MARKER_KEY } from './applyPlan';
import {
  isExtensionId,
  isProfileName,
  isRecord,
  normalizeId,
  type Preset,
  type ProfileSpec,
  resolveProfile,
  type SettingsMap,
  stripBom,
} from './preset';
import { addProfile, profileNamesIn, setCore } from './presetEdit';
import { parseSettingsText } from './settings';
import { compareCodeUnits } from './text';

export const CODE_PROFILE_EXTENSION = 'code-profile';

/** Profile parts VS Code's `useDefaultFlags` and Profile Kit's `shareFromDefault` have in common. */
const SHARED_FLAGS = ['settings', 'keybindings', 'snippets', 'tasks'] as const;

/** Parts of a `.code-profile` Profile Kit does not carry into a preset (it declares extensions and settings). */
const NOT_IMPORTED = ['keybindings', 'snippets', 'tasks', 'globalState', 'mcp'] as const;

export interface CodeProfileExtension {
  identifier: { id: string; uuid?: string };
  displayName?: string;
}

export interface CodeProfile {
  name: string;
  icon?: string;
  settings?: string;
  extensions?: string;
  useDefaultFlags?: Partial<Record<(typeof SHARED_FLAGS)[number], boolean>>;
}

/** What the Marketplace told about an extension, to fill `uuid` and `displayName` (both optional for VS Code). */
export interface ExtensionInfo {
  uuid?: string;
  displayName?: string;
}

export class CodeProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodeProfileError';
  }
}

/**
 * One declared profile as a `.code-profile`: its extensions, and its settings the way `apply` would write them
 * (preset common + profile settings, the `profileKit.profile` marker and the managed-key list), so a profile
 * imported in VS Code is recognized by Profile Kit and a later `apply` sees nothing new to do.
 * A profile that shares settings with Default gets VS Code's `useDefaultFlags.settings` instead.
 */
export function toCodeProfile(
  preset: Preset,
  name: string,
  info: ReadonlyMap<string, ExtensionInfo> = new Map(),
): CodeProfile {
  const spec = preset.profiles[name];
  if (!spec) throw new Error(`Unknown profile "${name}"`);
  const extensions: CodeProfileExtension[] = resolveProfile(preset, name).map((id) => {
    const i = info.get(id);
    return {
      identifier: { id, ...(i?.uuid ? { uuid: i.uuid } : {}) },
      ...(i?.displayName ? { displayName: i.displayName } : {}),
    };
  });
  const out: CodeProfile = { name };
  const desired = desiredSettings(preset, name);
  if (desired) {
    const settings = { ...desired, [MANAGED_KEYS_KEY]: Object.keys(desired).sort(compareCodeUnits) };
    out.settings = JSON.stringify({ settings: `${JSON.stringify(settings, null, 4)}\n` });
  }
  out.extensions = JSON.stringify(extensions);
  const flags = Object.fromEntries(
    SHARED_FLAGS.filter((k) => spec.shareFromDefault?.[k] === true).map((k) => [k, true]),
  );
  if (Object.keys(flags).length) out.useDefaultFlags = flags;
  return out;
}

/** File text for a `.code-profile`. */
export function serializeCodeProfile(profile: CodeProfile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

/** A file name for a profile's `.code-profile` (profile names are already file-safe, see isProfileName). */
export function codeProfileFileName(name: string): string {
  return `${name}.${CODE_PROFILE_EXTENSION}`;
}

/** A `.code-profile` read back: what Profile Kit can put into a preset. */
export interface ImportedProfile {
  name: string;
  /** Lower-case IDs in file order, disabled ones included (they are installed in that profile). */
  extensions: string[];
  /** Extensions marked "Apply Extension to all Profiles" in that profile. */
  applicationScoped: string[];
  disabled: string[];
  /** Its settings.json, without Profile Kit's own marker and managed-key list; undefined when it has none. */
  settings?: SettingsMap;
  /** `useDefaultFlags.settings`: the profile used Default settings. */
  sharesSettings: boolean;
  /** Parts present in the file that a preset does not hold (keybindings, snippets, ...). */
  notImported: string[];
  /** Entries that could not be read; the rest is still imported. */
  problems: string[];
}

function innerJson(value: unknown, what: string): unknown {
  if (typeof value !== 'string') throw new CodeProfileError(`${what} must be a string`);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new CodeProfileError(`${what} is not valid JSON`);
  }
}

/** Read `.code-profile` text. Throws CodeProfileError when it is not a profile file at all. */
export function parseCodeProfile(text: string): ImportedProfile {
  let json: unknown;
  try {
    json = JSON.parse(stripBom(text)) as unknown;
  } catch {
    throw new CodeProfileError('not valid JSON');
  }
  if (!isRecord(json) || typeof json.name !== 'string' || json.name.trim() === '')
    throw new CodeProfileError('not a VS Code profile file (no "name")');
  for (const key of ['icon', 'settings', 'globalState', 'extensions'] as const)
    if (json[key] !== undefined && typeof json[key] !== 'string')
      throw new CodeProfileError(`"${key}" must be a string`);

  const out: ImportedProfile = {
    name: json.name.trim(),
    extensions: [],
    applicationScoped: [],
    disabled: [],
    sharesSettings: isRecord(json.useDefaultFlags) && json.useDefaultFlags.settings === true,
    notImported: NOT_IMPORTED.filter((k) => json[k] !== undefined),
    problems: [],
  };

  if (json.extensions !== undefined) {
    const list = innerJson(json.extensions, 'extensions');
    if (!Array.isArray(list)) throw new CodeProfileError('extensions must be a list');
    list.forEach((entry, i) => {
      const id = isRecord(entry) && isRecord(entry.identifier) ? entry.identifier.id : undefined;
      if (!isExtensionId(id)) {
        out.problems.push(`extensions[${i}] has no extension ID`);
        return;
      }
      const key = normalizeId(id);
      if (out.extensions.includes(key)) return;
      out.extensions.push(key);
      if (isRecord(entry) && entry.applicationScoped === true) out.applicationScoped.push(key);
      if (isRecord(entry) && entry.disabled === true) out.disabled.push(key);
    });
  }

  if (json.settings !== undefined) {
    try {
      const wrapper = innerJson(json.settings, 'settings');
      const raw = isRecord(wrapper) ? wrapper.settings : undefined;
      if (typeof raw !== 'string') throw new CodeProfileError('settings has no settings.json text');
      // Profile Kit's own marker and managed-key list belong to the profile it was exported from, not to the preset
      const rest = Object.fromEntries(
        Object.entries(parseSettingsText(raw)).filter(([k]) => k !== PROFILE_MARKER_KEY && k !== MANAGED_KEYS_KEY),
      );
      if (Object.keys(rest).length) out.settings = rest;
    } catch (error) {
      out.problems.push(`settings were not imported: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}

/**
 * A profile name for `wanted` that a preset may declare and that is not in `taken` (case-insensitive):
 * characters outside `[A-Za-z0-9 ._-]` become `-`, `Default` becomes `Default-imported`, and `Name 2`, `Name 3`, ...
 * when the name is already used.
 */
export function uniqueProfileName(wanted: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  let base = wanted
    .replace(/[^A-Za-z0-9 ._-]/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .trim();
  if (!base) base = 'Imported';
  if (!isProfileName(base)) base = `${base}-imported`;
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}

/** The preset entry for an imported profile: its extensions that core does not already have, and its settings. */
export function importedSpec(profile: ImportedProfile, core: readonly string[]): ProfileSpec {
  const inCore = new Set(core.map(normalizeId));
  const extensions = profile.extensions.filter((id) => !inCore.has(id));
  return {
    ...(extensions.length ? { extensions } : {}),
    ...(profile.sharesSettings ? { shareFromDefault: { settings: true } } : {}),
    ...(!profile.sharesSettings && profile.settings ? { settings: profile.settings } : {}),
  };
}

export interface ImportResult {
  text: string;
  /** Profile name used for each imported profile, in the same order (renamed when taken or not allowed). */
  names: string[];
}

/** Add imported profiles to preset text (comments and formatting kept). Core is not changed. */
export function addImportedProfiles(text: string, profiles: readonly ImportedProfile[], core: readonly string[]) {
  const taken = profileNamesIn(text);
  const names: string[] = [];
  let out = text;
  for (const p of profiles) {
    const name = uniqueProfileName(p.name, taken);
    taken.push(name);
    names.push(name);
    out = addProfile(out, name, importedSpec(p, core) as Record<string, unknown>);
  }
  return { text: out, names } satisfies ImportResult;
}

/**
 * A new preset from imported profiles. With two or more, extensions every one of them has become `core`
 * (the part they share); with one, everything stays in that profile.
 */
export function presetFromImported(profiles: readonly ImportedProfile[]): ImportResult {
  if (!profiles.length) throw new Error('no profile to import');
  const core =
    profiles.length < 2
      ? []
      : profiles[0].extensions.filter((id) => profiles.every((p) => p.extensions.includes(id))).sort(compareCodeUnits);
  const draft = `${JSON.stringify({ core: [], groups: {}, settings: {}, profiles: {} }, null, 2)}\n`;
  return addImportedProfiles(setCore(draft, core), profiles, core);
}
