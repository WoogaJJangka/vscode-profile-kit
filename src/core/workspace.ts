/**
 * Recommend a profile for a folder from the names at its top level and the preset's `match.files`.
 * The host lists the names (files and folders); this module only compares strings.
 */
import { profileNames, type Preset } from './preset';

export interface WorkspaceRecommendation {
  profile: string;
  score: number;
  /** `match.files` patterns that matched, in preset order. */
  matched: string[];
}

/** An exact name (`pyproject.toml`) says more about a folder than a wildcard (`*.py`). */
const EXACT_POINTS = 2;
const GLOB_POINTS = 1;

function isGlob(pattern: string): boolean {
  return /[*?]/.test(pattern);
}

function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${body}$`, 'i');
}

function baseName(name: string): string {
  const parts = name.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** Case-insensitive match of one name: exact, or `*` / `?` wildcards inside the name (`*.ext`, `docker-compose.*`). */
export function matchFilePattern(pattern: string, name: string): boolean {
  const n = baseName(name);
  if (!isGlob(pattern)) return pattern.toLowerCase() === n.toLowerCase();
  return globToRegExp(pattern).test(n);
}

/**
 * Profiles whose `match.files` match any of `names`, best first (preset order on a tie).
 * Profiles with no match are left out, so an empty list means "no recommendation".
 */
export function recommendForFolder(preset: Preset, names: readonly string[]): WorkspaceRecommendation[] {
  const out: WorkspaceRecommendation[] = [];
  for (const profile of profileNames(preset)) {
    const patterns = preset.profiles[profile].match?.files ?? [];
    const matched = patterns.filter((p) => names.some((n) => matchFilePattern(p, n)));
    if (!matched.length) continue;
    const score = matched.reduce((sum, p) => sum + (isGlob(p) ? GLOB_POINTS : EXACT_POINTS), 0);
    out.push({ profile, score, matched });
  }
  // Array.prototype.sort is stable, so ties keep preset order
  return out.sort((a, b) => b.score - a.score);
}
