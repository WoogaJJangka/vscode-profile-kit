/**
 * Why an installed extension the preset does not declare is there anyway: another extension installed in the same
 * profile needs it (`extensionDependencies`) or bundles it (`extensionPack`), and VS Code installs those along with
 * the extension that names them. They are shown with that reason instead of a bare "not in the preset".
 * The relations come from the installed extensions' package.json files (host/builtins.ts, read only).
 */
import { isRecord, normalizeId } from './preset';
import { compareCodeUnits } from './text';

/** What an installed extension brings along, as lower-case IDs. */
export interface ExtensionRelations {
  /** `extensionDependencies`: VS Code installs these with it and it does not run without them. */
  dependencies: string[];
  /** `extensionPack`: VS Code installs these with it. */
  pack: string[];
}

/** Why one extension that is not in the preset is installed. Both lists hold extensions installed in the profile. */
export interface ExtraReason {
  /** Extensions that depend on it. */
  neededBy: string[];
  /** Extension packs that include it. */
  inPack: string[];
}

/** This extension. Every profile that shows Profile Kit lists it; it is not an extra the user added to a profile. */
export const PROFILE_KIT_ID = 'woogajjangka.vscode-profile-kit';

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((v): v is string => typeof v === 'string' && v.includes('.')).map(normalizeId);
  return [...new Set(ids)];
}

/** `publisher.name` and its relations from an extension's package.json, or undefined when it is not one. */
export function parseExtensionManifest(json: unknown): { id: string; relations: ExtensionRelations } | undefined {
  if (!isRecord(json) || typeof json.publisher !== 'string' || typeof json.name !== 'string') return undefined;
  if (!json.publisher || !json.name) return undefined;
  return {
    id: normalizeId(`${json.publisher}.${json.name}`),
    relations: { dependencies: idList(json.extensionDependencies), pack: idList(json.extensionPack) },
  };
}

/** Relations by extension ID, lists sorted. Several installed versions of one extension are merged. */
export function relationsById(
  manifests: Iterable<{ id: string; relations: ExtensionRelations }>,
): Map<string, ExtensionRelations> {
  const out = new Map<string, ExtensionRelations>();
  const merge = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])].sort(compareCodeUnits);
  for (const { id, relations } of manifests) {
    const known = out.get(id) ?? { dependencies: [], pack: [] };
    out.set(id, {
      dependencies: merge(known.dependencies, relations.dependencies),
      pack: merge(known.pack, relations.pack),
    });
  }
  return out;
}

/**
 * For each extra of a profile, the other extensions installed in that profile that need or bundle it.
 * Extras that no installed extension names are left out (the user, or something else, added them).
 */
export function explainExtras(
  extra: readonly string[],
  installed: readonly string[],
  relations: ReadonlyMap<string, ExtensionRelations>,
): Map<string, ExtraReason> {
  const extras = new Set(extra.map(normalizeId));
  const out = new Map<string, ExtraReason>();
  const note = (id: string, owner: string, key: keyof ExtraReason) => {
    if (id === owner || !extras.has(id)) return;
    const reason = out.get(id) ?? { neededBy: [], inPack: [] };
    if (!reason[key].includes(owner)) reason[key].push(owner);
    out.set(id, reason);
  };
  for (const owner of [...new Set(installed.map(normalizeId))].sort(compareCodeUnits)) {
    const r = relations.get(owner);
    if (!r) continue;
    for (const id of r.dependencies) note(id, owner, 'neededBy');
    for (const id of r.pack) note(id, owner, 'inPack');
  }
  return out;
}

/** The CLI's note after an extra (English), or '' when nothing explains it. */
export function extraNote(reason: ExtraReason | undefined, appliedToAll: boolean): string {
  const parts = [
    ...(appliedToAll ? ['VS Code applies it to all profiles'] : []),
    ...(reason?.neededBy.length ? [`needed by ${reason.neededBy.join(', ')}`] : []),
    ...(reason?.inPack.length ? [`in extension pack ${reason.inPack.join(', ')}`] : []),
  ];
  return parts.length ? ` (${parts.join('; ')})` : '';
}
