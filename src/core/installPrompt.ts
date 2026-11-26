/**
 * Which new extensions of a window's profile the user picked themselves: those are the ones Profile Kit asks about
 * ("add it to other profiles too?", ui/installFlow.ts). Pure, so the window's state comes in as plain lists.
 *
 * A window is told about new extensions of its profile one change at a time, and it can miss one that was installed
 * from outside it (the `code` CLI, another window of the profile). Seen 2026-11-25: an extension pack never showed up
 * in a window that did get its two members, so the members were asked about and the pack was not (docs/PLAN.md
 * section 14, #5). So what is new comes from the profile's installed list where that is known, not only from what
 * the window loaded, and what came along with another extension comes from the manifests on disk as well.
 */
import { type ExtensionRelations, installedAlongWith, relationsById } from './dependencies';
import { normalizeId } from './preset';
import { compareCodeUnits } from './text';

/** A profile's extensions at one moment, as one window knows them. */
export interface ProfileExtensions {
  /** The profile's installed list (it also has the disabled extensions); undefined while it is not known. */
  listed?: readonly string[] | undefined;
  /** The user extensions the window has loaded (the enabled ones it knows of). */
  loaded: readonly string[];
}

/** One run of changes to a window's extensions: from the first change until nothing has changed for a while. */
export interface InstallRun {
  /** While nothing was changing, before the run. */
  before: ProfileExtensions;
  /** When the run was over. */
  after: ProfileExtensions;
  /** Extensions the window saw arrive during the run while Profile Kit was not changing anything. */
  arrived: readonly string[];
  /** Profile Kit was changing something (installing) at some point of the run. */
  kitChanged: boolean;
  /**
   * package.json relations of installed extensions: the ones on disk (every profile's) and the ones the window
   * loaded. Only those of extensions in `after` count.
   */
  manifests: Iterable<{ id: string; relations: ExtensionRelations }>;
}

const ids = (p: ProfileExtensions) => new Set([...(p.listed ?? []), ...p.loaded].map(normalizeId));

/**
 * The extensions of a run that are new in the profile and that no other installed extension brought along, sorted.
 *
 * New, for a run Profile Kit had no part in and with the list known before and after: on the list (or loaded) now
 * and not before. That also finds an extension the window never loaded, and leaves out one that was only enabled
 * again (the list has disabled extensions too).
 * Otherwise, as before 1.5: what the window saw arrive while Profile Kit was not changing anything. During its own
 * change everything that turns up came with that change, also the dependencies and pack members VS Code adds by
 * itself; and without a list from before, the list cannot tell new from disabled.
 *
 * Brought along: named as a dependency or pack member by an extension that is installed in the profile now, whether
 * or not the window loaded that one (installedAlongWith).
 */
export function installsToAskAbout(run: InstallRun): string[] {
  const installed = ids(run.after);
  const before = ids(run.before);
  const byList = !!run.before.listed && !!run.after.listed && !run.kitChanged;
  const candidates = byList ? [...installed] : [...new Set(run.arrived.map(normalizeId))];
  const added = candidates.filter((id) => installed.has(id) && !before.has(id));
  if (!added.length) return [];
  const relations = relationsById([...run.manifests].filter((m) => installed.has(m.id)));
  const along = installedAlongWith([...relations].map(([id, r]) => ({ id, relations: r })));
  return added.filter((id) => !along.has(id)).sort(compareCodeUnits);
}
