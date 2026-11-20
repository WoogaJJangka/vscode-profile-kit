/**
 * Which profiles an extension belongs in, from its manifest (package.json or marketplace data) and the preset.
 *
 * Signals (PLAN: twinkling-doodling-aho "추천"):
 * 1. strong: the profile's `match.languages` / `match.keywords` overlap the extension's languages / keywords
 * 2. strong: the extension depends on, bundles, is needed by, or is in an extension pack of one of the profile's extensions
 * 3. medium: the profile's extensions support the same languages
 * 4. Themes / Keymaps / Language Packs, or no language signal and nothing else matched → core (every profile)
 * When only the ID is known, the ID's words are compared with `match` (weak).
 */
import { isRecord, normalizeId, ownExtensions, profileNames, type Preset } from './preset';

export interface ExtensionMeta {
  /** `publisher.name` */
  id: string;
  categories?: string[];
  keywords?: string[];
  /** `contributes.languages[].id` */
  languages?: string[];
  activationEvents?: string[];
  extensionDependencies?: string[];
  extensionPack?: string[];
}

export interface Recommendation {
  /** A profile name from the preset, or CORE_TARGET. */
  profile: string;
  score: number;
  /** Short English reasons, most important first (shown on the QuickPick detail line). */
  reasons: string[];
}

/**
 * "Put it in `core`": every profile. Profile names cannot contain `@` (preset.ts PROFILE_NAME),
 * so this never collides with a real profile such as `Core`.
 */
export const CORE_TARGET = '@core';

export const SCORE = { strong: 3, medium: 2, weak: 1 } as const;

const CORE_CATEGORIES = new Set(['themes', 'keymaps', 'language packs']);

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [];
}

/** Tolerant read of an extension manifest (`package.json` shape); unknown or broken fields are dropped. */
export function extensionMetaFromManifest(id: string, manifest: unknown): ExtensionMeta {
  const m = isRecord(manifest) ? manifest : {};
  const contributes = isRecord(m.contributes) ? m.contributes : {};
  const languages = Array.isArray(contributes.languages)
    ? contributes.languages.flatMap((l) => (isRecord(l) && typeof l.id === 'string' ? [l.id] : []))
    : [];
  return {
    id,
    categories: strings(m.categories),
    keywords: strings(m.keywords),
    languages,
    activationEvents: strings(m.activationEvents),
    extensionDependencies: strings(m.extensionDependencies),
    extensionPack: strings(m.extensionPack),
  };
}

/** Language IDs an extension contributes or activates on (`onLanguage:python`), lower-case. */
export function extensionLanguages(meta: ExtensionMeta): string[] {
  const fromEvents = (meta.activationEvents ?? []).flatMap((e) =>
    e.startsWith('onLanguage:') ? [e.slice('onLanguage:'.length)] : [],
  );
  return unique([...(meta.languages ?? []), ...fromEvents].map((l) => l.trim().toLowerCase()).filter(Boolean));
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

function lower(list: readonly string[] | undefined): string[] {
  return unique((list ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** `ms-python.vscode-pylance` → ms, python, vscode, pylance */
function idWords(id: string): string[] {
  return unique(normalizeId(id).split(/[.-]/).filter(Boolean));
}

function intersect(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(b);
  return a.filter((x) => set.has(x));
}

interface Scored {
  score: number;
  reasons: string[];
}

function add(s: Scored, points: number, reason: string): void {
  s.score += points;
  s.reasons.push(reason);
}

/** Signals 2 and 3: relations to a set of declared extensions. */
function scoreAgainstExtensions(
  s: Scored,
  targetId: string,
  target: ExtensionMeta,
  targetLangs: string[],
  declared: readonly string[],
  known: ReadonlyMap<string, ExtensionMeta>,
): void {
  const deps = intersect(lower(target.extensionDependencies), declared);
  if (deps.length) add(s, SCORE.strong, `depends on ${deps.join(', ')}`);
  const bundles = intersect(lower(target.extensionPack), declared);
  if (bundles.length) add(s, SCORE.strong, `extension pack with ${bundles.join(', ')}`);

  const neededBy: string[] = [];
  const packs: string[] = [];
  const sameLanguage = new Map<string, string[]>();
  for (const id of declared) {
    if (id === targetId) continue;
    const meta = known.get(id);
    if (!meta) continue;
    if (lower(meta.extensionDependencies).includes(targetId)) neededBy.push(id);
    if (lower(meta.extensionPack).includes(targetId)) packs.push(id);
    const langs = intersect(targetLangs, extensionLanguages(meta));
    if (langs.length) sameLanguage.set(id, langs);
  }
  if (neededBy.length) add(s, SCORE.strong, `needed by ${neededBy.join(', ')}`);
  if (packs.length) add(s, SCORE.strong, `in extension pack ${packs.join(', ')}`);
  if (sameLanguage.size) {
    const langs = unique([...sameLanguage.values()].flat());
    const ids = [...sameLanguage.keys()];
    const shown = ids.length > 2 ? `${ids.slice(0, 2).join(', ')} and ${ids.length - 2} more` : ids.join(', ');
    add(s, SCORE.medium, `same languages (${langs.join(', ')}) as ${shown}`);
  }
}

/**
 * Rank every preset profile, plus CORE_TARGET, for one extension. Sorted by score (high first);
 * on a tie, profiles keep preset order and core comes last. A score above 0 means "recommended".
 *
 * @param known metadata of extensions the preset declares, as much as is known (installed ones, cached marketplace data)
 */
export function recommendProfiles(
  target: ExtensionMeta,
  preset: Preset,
  known: readonly ExtensionMeta[] = [],
): Recommendation[] {
  const targetId = normalizeId(target.id);
  const knownMap = new Map(known.map((m) => [normalizeId(m.id), m]));
  const langs = extensionLanguages(target);
  const words = unique([...lower(target.keywords), ...lower(target.categories)]);
  const fromId = idWords(target.id);

  const results: Recommendation[] = profileNames(preset).map((profile) => {
    const s: Scored = { score: 0, reasons: [] };
    const match = preset.profiles[profile].match ?? {};
    const matchLangs = lower(match.languages);
    const matchWords = lower(match.keywords);

    const langHit = intersect(langs, matchLangs);
    if (langHit.length) add(s, SCORE.strong, `language ${langHit.join(', ')}`);
    const wordHit = intersect(words, matchWords);
    if (wordHit.length) add(s, SCORE.strong, `keyword ${wordHit.join(', ')}`);

    scoreAgainstExtensions(s, targetId, target, langs, ownExtensions(preset, profile), knownMap);

    // ID words only help when nothing else did (e.g. the marketplace lookup failed)
    if (s.score === 0) {
      const idHit = intersect(fromId, unique([...matchLangs, ...matchWords]));
      if (idHit.length) add(s, SCORE.weak, `ID mentions ${idHit.join(', ')}`);
    }
    return { profile, ...s };
  });

  const core: Scored = { score: 0, reasons: [] };
  const coreCategories = (target.categories ?? []).filter((c) => CORE_CATEGORIES.has(c.trim().toLowerCase()));
  if (coreCategories.length) add(core, SCORE.strong, `category ${coreCategories.join(', ')}`);
  scoreAgainstExtensions(core, targetId, target, langs, unique(preset.core.map(normalizeId)), knownMap);
  if (core.score === 0 && langs.length === 0 && results.every((r) => r.score === 0))
    add(core, SCORE.medium, 'no language-specific signal');
  results.push({ profile: CORE_TARGET, ...core });

  const order = new Map(results.map((r, i) => [r.profile, i]));
  return results.sort((a, b) => b.score - a.score || (order.get(a.profile) ?? 0) - (order.get(b.profile) ?? 0));
}

/** The recommended entries only (score above 0). */
export function recommended(list: readonly Recommendation[]): Recommendation[] {
  return list.filter((r) => r.score > 0);
}
