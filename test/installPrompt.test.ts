import { describe, expect, it } from 'vitest';

import { type InstallRun, installsToAskAbout } from '../src/core/installPrompt';

const ext = (id: string, dependencies: string[] = [], pack: string[] = []) => ({
  id,
  relations: { dependencies, pack },
});

// the pack of the integration checks: its members also depend on it (docs/PLAN.md section 14)
const PACK = 'ms-vscode.remote-repositories';
const MEMBERS = ['github.remotehub', 'ms-vscode.azure-repos'];
const packManifests = [ext(PACK, [], MEMBERS), ...MEMBERS.map((id) => ext(id, [PACK]))];

const HAD = ['editorconfig.editorconfig', 'disabled.one'];
const LOADED = ['editorconfig.editorconfig'];

function run(part: Partial<InstallRun> & { installed?: string[]; arrived?: string[] }): InstallRun {
  const { installed = [], arrived = installed, ...rest } = part;
  return {
    before: { listed: HAD, loaded: LOADED },
    after: { listed: [...HAD, ...installed], loaded: [...LOADED, ...arrived] },
    arrived,
    kitChanged: false,
    manifests: [],
    ...rest,
  };
}

describe('installsToAskAbout', () => {
  it('asks about an extension that is new on the list', () => {
    expect(installsToAskAbout(run({ installed: ['ms-vscode.wordcount'] }))).toEqual(['ms-vscode.wordcount']);
    expect(installsToAskAbout(run({}))).toEqual([]);
  });

  it('asks about a pack once and not about its members', () => {
    expect(installsToAskAbout(run({ installed: [PACK, ...MEMBERS], manifests: packManifests }))).toEqual([PACK]);
  });

  it('still asks about the pack, and not its members, when the window never loaded the pack', () => {
    // seen 2026-11-25: the profile's list and the extensions folder had all three, the window only the members
    const missed = run({ installed: [PACK, ...MEMBERS], arrived: MEMBERS, manifests: packManifests });
    expect(missed.after.loaded).not.toContain(PACK);
    expect(installsToAskAbout(missed)).toEqual([PACK]);
  });

  it('needs the list and the manifests on disk for that: what the window loaded says the opposite', () => {
    // before 1.5: no list, and only the manifests of the two members the window loaded (each depends on the pack)
    const loadedOnly = MEMBERS.map((id) => ext(id, [PACK]));
    const windowOnly = run({
      before: { loaded: LOADED },
      after: { loaded: [...LOADED, ...MEMBERS] },
      arrived: MEMBERS,
      manifests: loadedOnly,
    });
    expect(installsToAskAbout(windowOnly)).toEqual(MEMBERS);
    // the list finds the pack, but without the pack's own manifest it looks like something its members brought in
    expect(installsToAskAbout(run({ installed: [PACK, ...MEMBERS], arrived: MEMBERS, manifests: loadedOnly }))).toEqual(
      MEMBERS,
    );
  });

  it('does not ask about what a dependency brought in, whichever arrived in the window', () => {
    const manifests = [ext('ms-python.debugpy', ['ms-python.python']), ext('ms-python.python')];
    const installed = ['ms-python.debugpy', 'ms-python.python'];
    expect(installsToAskAbout(run({ installed, manifests }))).toEqual(['ms-python.debugpy']);
    expect(installsToAskAbout(run({ installed, arrived: ['ms-python.python'], manifests }))).toEqual([
      'ms-python.debugpy',
    ]);
  });

  it('only counts manifests of extensions installed in this profile', () => {
    // the extensions folder holds every profile's extensions: a pack of another profile explains nothing here
    const manifests = [ext('other.pack', [], ['a.member']), ext('a.member')];
    expect(installsToAskAbout(run({ installed: ['a.member'], manifests }))).toEqual(['a.member']);
    expect(installsToAskAbout(run({ installed: ['a.member', 'other.pack'], manifests }))).toEqual(['other.pack']);
  });

  it('does not ask about an extension that was only enabled again', () => {
    // disabled extensions stay on the list, so it is not new there; the window sees it arrive
    const enabled = run({ arrived: ['disabled.one'] });
    expect(installsToAskAbout(enabled)).toEqual([]);
    // also when Profile Kit changed something meanwhile and only the window's arrivals count
    expect(installsToAskAbout({ ...enabled, kitChanged: true })).toEqual([]);
  });

  it('asks about nothing that arrived while Profile Kit was changing things', () => {
    // applying a preset with a declared pack: the window reports the members, markInstalling only knows the pack
    const applied = run({ installed: [PACK, ...MEMBERS, 'x.dependency'], arrived: [], kitChanged: true });
    expect(installsToAskAbout(applied)).toEqual([]);
    // what the window saw arrive outside the change is still the user's
    const both = run({
      installed: [PACK, ...MEMBERS, 'ms-vscode.wordcount'],
      arrived: ['ms-vscode.wordcount'],
      kitChanged: true,
      manifests: packManifests,
    });
    expect(installsToAskAbout(both)).toEqual(['ms-vscode.wordcount']);
  });

  it('without a list from before, only what the window saw arrive counts', () => {
    // the first change came before the profile was read: the list cannot tell new from disabled
    const early = run({
      before: { loaded: LOADED },
      after: { listed: [...HAD, 'ms-vscode.wordcount'], loaded: [...LOADED, 'ms-vscode.wordcount'] },
      arrived: ['ms-vscode.wordcount'],
    });
    expect(installsToAskAbout(early)).toEqual(['ms-vscode.wordcount']);
    // a window whose profile is not known has no list at all
    const unknown = run({
      before: { loaded: LOADED },
      after: { loaded: [...LOADED, 'ms-vscode.wordcount'] },
      arrived: ['ms-vscode.wordcount'],
    });
    expect(installsToAskAbout(unknown)).toEqual(['ms-vscode.wordcount']);
  });

  it('leaves out what is gone again by the end of the run, and reads IDs in any case', () => {
    expect(
      installsToAskAbout(run({ after: { listed: HAD, loaded: LOADED }, arrived: ['ms-vscode.wordcount'] })),
    ).toEqual([]);
    expect(
      installsToAskAbout(
        run({
          before: { listed: ['A.B'], loaded: [] },
          after: { listed: ['a.b', 'C.D', 'e.f'], loaded: ['E.F'] },
          arrived: [],
        }),
      ),
    ).toEqual(['c.d', 'e.f']);
  });
});
