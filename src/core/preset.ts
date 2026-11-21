/**
 * Declarative preset: core extensions + named groups + profiles built from them.
 * Pure logic only (no VS Code API, no child_process) so it is shared by the CLI and the extension.
 */
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';

export interface ShareFromDefault {
  settings?: boolean;
  keybindings?: boolean;
  snippets?: boolean;
  tasks?: boolean;
}

/** settings.json content: setting key → any JSON value. */
export type SettingsMap = Record<string, unknown>;

/** Signals that point to a profile: used to recommend it for an extension (`recommend.ts`) or a folder (`workspace.ts`). */
export interface ProfileMatch {
  /** VS Code language IDs (`python`, `typescriptreact`, ...). */
  languages?: string[];
  /** File or folder names at the top of a workspace folder: exact names or simple globs (`*.py`). */
  files?: string[];
  /** Words compared with an extension's keywords, categories and ID parts. */
  keywords?: string[];
}

export interface ProfileSpec {
  /** Group names from `groups`, applied in order after `core`. */
  groups?: string[];
  /** Extra extension IDs only for this profile. */
  extensions?: string[];
  /** Leave out `core` for this profile (default: false). */
  skipCore?: boolean;
  shareFromDefault?: ShareFromDefault;
  /** Settings for this profile only, written over the preset's common `settings`. */
  settings?: SettingsMap;
  match?: ProfileMatch;
}

export interface Preset {
  $schema?: string;
  core: string[];
  groups: Record<string, string[]>;
  /** Settings for every declared profile (except ones that share settings with Default). */
  settings: SettingsMap;
  profiles: Record<string, ProfileSpec>;
}

export class PresetError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid preset:\n- ${issues.join('\n- ')}`);
    this.name = 'PresetError';
  }
}

/** `publisher.name`, as VS Code shows it in `--list-extensions` (compared case-insensitively). */
const EXTENSION_ID = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i;
/**
 * Profile names are passed to the `code` CLI, so keep them to characters that need no shell quoting tricks.
 * VS Code itself allows more; widen this only together with the quoting in `codeCli.ts`.
 */
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;
/** The Default profile is never changed by default (PLAN.md); it is not something a preset declares. */
const RESERVED_PROFILE_NAMES = new Set(['default']);
const SHARE_KEYS: (keyof ShareFromDefault)[] = ['settings', 'keybindings', 'snippets', 'tasks'];
const MATCH_KEYS: (keyof ProfileMatch)[] = ['languages', 'files', 'keywords'];
/** Same keys as `properties` in schema/preset.schema.json (additionalProperties: false); a test keeps them in step. */
export const PRESET_KEYS: readonly string[] = ['$schema', 'core', 'groups', 'settings', 'profiles'];
export const PROFILE_KEYS: readonly string[] = [
  'groups',
  'extensions',
  'skipCore',
  'shareFromDefault',
  'settings',
  'match',
];

export function normalizeId(id: string): string {
  // `--show-versions` prints `publisher.name@1.2.3`
  return id.trim().split('@')[0].toLowerCase();
}

export function isExtensionId(id: unknown): id is string {
  return typeof id === 'string' && EXTENSION_ID.test(id);
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkIdList(value: unknown, where: string, issues: string[]): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${where} must be an array of extension IDs`);
    return [];
  }
  const out: string[] = [];
  value.forEach((id, i) => {
    if (!isExtensionId(id)) {
      issues.push(`${where}[${i}] is not an extension ID (publisher.name): ${JSON.stringify(id)}`);
    } else {
      out.push(id);
    }
  });
  return out;
}

function checkSettings(value: unknown, where: string, issues: string[]): SettingsMap {
  if (!isRecord(value)) {
    issues.push(`${where} must be an object of { "setting.key": value }`);
    return {};
  }
  for (const key of Object.keys(value)) if (key.trim() === '') issues.push(`${where}: setting key must not be empty`);
  return { ...value };
}

function checkStringList(value: unknown, where: string, issues: string[]): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.trim() === '')) {
    issues.push(`${where} must be an array of non-empty strings`);
    return [];
  }
  return value as string[];
}

function checkMatch(value: unknown, where: string, issues: string[]): ProfileMatch {
  const match: ProfileMatch = {};
  if (!isRecord(value)) {
    issues.push(`${where} must be an object of { languages, files, keywords }`);
    return match;
  }
  for (const [k, v] of Object.entries(value)) {
    if (!MATCH_KEYS.includes(k as keyof ProfileMatch)) {
      issues.push(`${where}: unknown key "${k}"`);
      continue;
    }
    const list = checkStringList(v, `${where}.${k}`, issues);
    if (k === 'files')
      list.forEach((p, i) => {
        if (/[\\/]/.test(p)) issues.push(`${where}.files[${i}] must be a name without / or \\: ${JSON.stringify(p)}`);
      });
    match[k as keyof ProfileMatch] = list;
  }
  return match;
}

/** Validate untyped JSON and return a typed preset, or throw PresetError listing every problem. */
export function parsePreset(json: unknown): Preset {
  const issues: string[] = [];
  if (!isRecord(json)) throw new PresetError(['preset must be a JSON object']);
  for (const key of Object.keys(json)) if (!PRESET_KEYS.includes(key)) issues.push(`unknown key "${key}"`);

  const core = json.core === undefined ? [] : checkIdList(json.core, 'core', issues);

  const groups: Record<string, string[]> = {};
  if (json.groups !== undefined) {
    if (!isRecord(json.groups)) issues.push('groups must be an object of { name: [extension IDs] }');
    else
      for (const [name, ids] of Object.entries(json.groups)) groups[name] = checkIdList(ids, `groups.${name}`, issues);
  }

  const settings = json.settings === undefined ? {} : checkSettings(json.settings, 'settings', issues);

  const profiles: Record<string, ProfileSpec> = {};
  if (!isRecord(json.profiles) || Object.keys(json.profiles).length === 0) {
    issues.push('profiles must be an object with at least one profile');
  } else {
    for (const [name, raw] of Object.entries(json.profiles)) {
      const where = `profiles.${name}`;
      if (!PROFILE_NAME.test(name)) issues.push(`${where}: profile name may only use letters, digits, space, . _ -`);
      if (RESERVED_PROFILE_NAMES.has(name.toLowerCase()))
        issues.push(`${where}: the Default profile cannot be declared`);
      if (!isRecord(raw)) {
        issues.push(`${where} must be an object`);
        continue;
      }
      for (const key of Object.keys(raw))
        if (!PROFILE_KEYS.includes(key)) issues.push(`${where}: unknown key "${key}"`);
      const spec: ProfileSpec = {};
      if (raw.groups !== undefined) {
        if (!Array.isArray(raw.groups) || raw.groups.some((g) => typeof g !== 'string')) {
          issues.push(`${where}.groups must be an array of group names`);
        } else {
          for (const g of raw.groups as string[])
            if (!(g in groups)) issues.push(`${where}.groups: unknown group "${g}"`);
          spec.groups = raw.groups as string[];
        }
      }
      if (raw.extensions !== undefined) spec.extensions = checkIdList(raw.extensions, `${where}.extensions`, issues);
      if (raw.skipCore !== undefined) {
        if (typeof raw.skipCore !== 'boolean') issues.push(`${where}.skipCore must be true or false`);
        else spec.skipCore = raw.skipCore;
      }
      if (raw.shareFromDefault !== undefined) {
        if (!isRecord(raw.shareFromDefault)) {
          issues.push(`${where}.shareFromDefault must be an object`);
        } else {
          const share: ShareFromDefault = {};
          for (const [k, v] of Object.entries(raw.shareFromDefault)) {
            if (!SHARE_KEYS.includes(k as keyof ShareFromDefault))
              issues.push(`${where}.shareFromDefault: unknown key "${k}"`);
            else if (typeof v !== 'boolean') issues.push(`${where}.shareFromDefault.${k} must be true or false`);
            else share[k as keyof ShareFromDefault] = v;
          }
          spec.shareFromDefault = share;
        }
      }
      if (raw.settings !== undefined) {
        spec.settings = checkSettings(raw.settings, `${where}.settings`, issues);
        // a profile that shares settings with Default has no settings.json of its own to write to
        if (spec.shareFromDefault?.settings === true)
          issues.push(`${where}: settings cannot be used together with shareFromDefault.settings: true`);
      }
      if (raw.match !== undefined) spec.match = checkMatch(raw.match, `${where}.match`, issues);
      profiles[name] = spec;
    }
  }

  if (issues.length) throw new PresetError(issues);
  return { ...(typeof json.$schema === 'string' ? { $schema: json.$schema } : {}), core, groups, settings, profiles };
}

/** Extension IDs a profile should have: core, then each group, then its own extras. Lower-case, de-duplicated, order kept. */
export function resolveProfile(preset: Preset, name: string): string[] {
  const spec = preset.profiles[name];
  if (!spec) throw new Error(`Unknown profile "${name}"`);
  const ordered = [
    ...(spec.skipCore ? [] : preset.core),
    ...(spec.groups ?? []).flatMap((g) => preset.groups[g] ?? []),
    ...(spec.extensions ?? []),
  ];
  return [...new Set(ordered.map(normalizeId))];
}

/** Extension IDs a profile adds on top of core (its groups and extras), lower-case, de-duplicated. */
export function ownExtensions(preset: Preset, name: string): string[] {
  const spec = preset.profiles[name];
  if (!spec) throw new Error(`Unknown profile "${name}"`);
  const core = new Set(preset.core.map(normalizeId));
  const ordered = [...(spec.groups ?? []).flatMap((g) => preset.groups[g] ?? []), ...(spec.extensions ?? [])];
  return [...new Set(ordered.map(normalizeId))].filter((id) => !core.has(id));
}

export function profileNames(preset: Preset): string[] {
  return Object.keys(preset.profiles);
}

/** Strip a UTF-8 BOM (Windows PowerShell 5.1 writes one). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export class JsoncSyntaxError extends Error {
  constructor(
    readonly what: string,
    readonly issues: string[],
  ) {
    super(`${what} is not valid JSON:\n- ${issues.join('\n- ')}`);
    this.name = 'JsoncSyntaxError';
  }
}

/**
 * Parse JSON with comments and trailing commas (like VS Code's own settings files).
 * Throws JsoncSyntaxError on a syntax error instead of guessing what was meant.
 */
export function parseJsonc(text: string, what = 'file'): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parse(stripBom(text), errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length)
    throw new JsoncSyntaxError(
      what,
      errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`),
    );
  return value;
}

/** Parse preset file text (JSON with comments allowed); a UTF-8 BOM is ignored. Syntax errors become PresetError. */
export function parsePresetText(text: string): Preset {
  let json: unknown;
  try {
    json = parseJsonc(text, 'preset');
  } catch (error) {
    if (error instanceof JsoncSyntaxError) throw new PresetError(error.issues.map((i) => `syntax: ${i}`));
    throw error;
  }
  return parsePreset(json);
}
