/**
 * Adding one extension to some profiles from the GUI: where to write it in the preset so that exactly (or at least)
 * the chosen profiles get it. The preset stays the source of truth; installs follow from what it then declares.
 */
import { normalizeId, profileNames, type Preset, resolveProfile } from './preset';
import type { ExtensionTarget } from './presetEdit';
import { CORE_TARGET } from './recommend';

export interface RecordOption {
  kind: 'core' | 'group' | 'profiles';
  /** Lists to add the ID to (one for core or a group, one per profile otherwise). */
  targets: ExtensionTarget[];
  group?: string;
  /** Declared profiles that end up with the extension through this option. */
  profiles: string[];
  /** True when `profiles` is exactly the chosen set (no profile gets it unasked). */
  exact: boolean;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Ways to record `chosen` (profile names, or CORE_TARGET for every profile) in the preset, best first:
 * a group used by exactly those profiles, then each profile's own `extensions`, then broader groups, then core.
 */
export function recordOptions(preset: Preset, chosen: readonly string[]): RecordOption[] {
  const all = profileNames(preset);
  const withCore = all.filter((p) => !preset.profiles[p].skipCore);
  const coreOption: RecordOption = {
    kind: 'core',
    targets: [{ kind: 'core' }],
    profiles: withCore,
    exact: false,
  };
  if (chosen.includes(CORE_TARGET)) return [{ ...coreOption, exact: true }];

  const picked = [...new Set(chosen)].filter((p) => all.includes(p));
  if (!picked.length) return [];
  coreOption.exact = sameSet(withCore, picked);

  const groups: RecordOption[] = Object.keys(preset.groups).flatMap((group) => {
    const users = all.filter((p) => preset.profiles[p].groups?.includes(group));
    if (!users.length || !picked.every((p) => users.includes(p))) return [];
    return [
      {
        kind: 'group' as const,
        targets: [{ kind: 'group' as const, name: group }],
        group,
        profiles: users,
        exact: sameSet(users, picked),
      },
    ];
  });
  const own: RecordOption = {
    kind: 'profiles',
    targets: picked.map((name) => ({ kind: 'profile' as const, name })),
    profiles: picked,
    exact: true,
  };
  const exactGroups = groups.filter((g) => g.exact);
  const broader = groups.filter((g) => !g.exact).sort((a, b) => a.profiles.length - b.profiles.length);
  // every profile chosen: core is the natural place
  return coreOption.exact
    ? [coreOption, ...exactGroups, own, ...broader]
    : [...exactGroups, own, ...broader, coreOption];
}

/** Declared profiles whose resolved list contains `id`. */
export function profilesWithExtension(preset: Preset, id: string): string[] {
  const want = normalizeId(id);
  return profileNames(preset).filter((p) => resolveProfile(preset, p).includes(want));
}

export interface MembershipEdits {
  /** Lists to remove the ID from. */
  remove: ExtensionTarget[];
  /** Lists to add the ID to. */
  add: ExtensionTarget[];
}

const targetKey = (t: ExtensionTarget) => (t.kind === 'core' ? 'core' : `${t.kind}:${t.name}`);

/**
 * Preset edits that make exactly `desired` (declared profile names) resolve to `id`, for the manager's matrix.
 * Keeps core or a group when every profile it covers is still wanted; drops it from core or a group that would
 * give it to an unwanted profile; adds it to the own `extensions` of wanted profiles not covered otherwise;
 * removes it from the own `extensions` of unwanted profiles. When the wanted set is exactly the profiles that
 * take core, core is used.
 */
export function membershipEdits(preset: Preset, id: string, desired: readonly string[]): MembershipEdits {
  const want = normalizeId(id);
  const all = profileNames(preset);
  const wanted = all.filter((p) => desired.includes(p));
  const withCore = all.filter((p) => !preset.profiles[p].skipCore);
  const inList = (ids: readonly string[] | undefined) => (ids ?? []).some((x) => normalizeId(x) === want);

  interface Container {
    target: ExtensionTarget;
    coverage: string[];
    has: boolean;
  }
  const containers: Container[] = [
    { target: { kind: 'core' }, coverage: withCore, has: inList(preset.core) },
    ...Object.keys(preset.groups).map((g) => ({
      target: { kind: 'group' as const, name: g },
      coverage: all.filter((p) => preset.profiles[p].groups?.includes(g)),
      has: inList(preset.groups[g]),
    })),
  ];
  const own = (p: string) => inList(preset.profiles[p].extensions);
  const remove: ExtensionTarget[] = [];
  const add: ExtensionTarget[] = [];

  if (withCore.length && sameSet(wanted, withCore)) {
    if (!containers[0].has) add.push({ kind: 'core' });
    for (const c of containers.slice(1)) if (c.has) remove.push(c.target);
    for (const p of all) if (own(p)) remove.push({ kind: 'profile', name: p });
    return { remove, add };
  }

  const covered = new Set<string>();
  for (const c of containers) {
    if (!c.has) continue;
    if (c.coverage.every((p) => wanted.includes(p))) c.coverage.forEach((p) => covered.add(p));
    else remove.push(c.target);
  }
  for (const p of wanted) if (!covered.has(p) && !own(p)) add.push({ kind: 'profile', name: p });
  for (const p of all) if (!wanted.includes(p) && own(p)) remove.push({ kind: 'profile', name: p });
  const seen = new Set<string>();
  return { remove: remove.filter((t) => !seen.has(targetKey(t)) && seen.add(targetKey(t))), add };
}
