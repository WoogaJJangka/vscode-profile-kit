/**
 * Declarative preset: core extensions + named groups + profiles built from them.
 * Pure logic only (no VS Code API, no child_process) so it is shared by the CLI and the extension.
 */

export interface ShareFromDefault {
  settings?: boolean;
  keybindings?: boolean;
  snippets?: boolean;
  tasks?: boolean;
}

export interface ProfileSpec {
  /** Group names from `groups`, applied in order after `core`. */
  groups?: string[];
  /** Extra extension IDs only for this profile. */
  extensions?: string[];
  /** Leave out `core` for this profile (default: false). */
  skipCore?: boolean;
  shareFromDefault?: ShareFromDefault;
}

export interface Preset {
  $schema?: string;
  core: string[];
  groups: Record<string, string[]>;
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
// same keys as schema/preset.schema.json (additionalProperties: false)
const TOP_LEVEL_KEYS = new Set(['$schema', 'core', 'groups', 'profiles']);
const PROFILE_KEYS = new Set(['groups', 'extensions', 'skipCore', 'shareFromDefault']);

export function normalizeId(id: string): string {
  // `--show-versions` prints `publisher.name@1.2.3`
  return id.trim().split('@')[0].toLowerCase();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkIdList(value: unknown, where: string, issues: string[]): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${where} must be an array of extension IDs`);
    return [];
  }
  const out: string[] = [];
  value.forEach((id, i) => {
    if (typeof id !== 'string' || !EXTENSION_ID.test(id)) {
      issues.push(`${where}[${i}] is not an extension ID (publisher.name): ${JSON.stringify(id)}`);
    } else {
      out.push(id);
    }
  });
  return out;
}

/** Validate untyped JSON and return a typed preset, or throw PresetError listing every problem. */
export function parsePreset(json: unknown): Preset {
  const issues: string[] = [];
  if (!isRecord(json)) throw new PresetError(['preset must be a JSON object']);
  for (const key of Object.keys(json)) if (!TOP_LEVEL_KEYS.has(key)) issues.push(`unknown key "${key}"`);

  const core = json.core === undefined ? [] : checkIdList(json.core, 'core', issues);

  const groups: Record<string, string[]> = {};
  if (json.groups !== undefined) {
    if (!isRecord(json.groups)) issues.push('groups must be an object of { name: [extension IDs] }');
    else
      for (const [name, ids] of Object.entries(json.groups)) groups[name] = checkIdList(ids, `groups.${name}`, issues);
  }

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
      for (const key of Object.keys(raw)) if (!PROFILE_KEYS.has(key)) issues.push(`${where}: unknown key "${key}"`);
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
      profiles[name] = spec;
    }
  }

  if (issues.length) throw new PresetError(issues);
  return { ...(typeof json.$schema === 'string' ? { $schema: json.$schema } : {}), core, groups, profiles };
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

export function profileNames(preset: Preset): string[] {
  return Object.keys(preset.profiles);
}

/** Parse preset file text; a UTF-8 BOM (Windows PowerShell 5.1 writes one) is ignored. */
export function parsePresetText(text: string): Preset {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return parsePreset(JSON.parse(body));
}
