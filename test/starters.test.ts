import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isExtensionId, isProfileName, parsePresetText, profileNames, resolveProfile } from '../src/core/preset';
import {
  bestStarter,
  findStarter,
  recommendStarters,
  STARTERS,
  starterPresetText,
  type StarterSignals,
} from '../src/core/starters';

const none: StarterSignals = { extensions: [], files: [], languages: [] };
const signals = (s: Partial<StarterSignals>): StarterSignals => ({ ...none, ...s });
const best = (s: Partial<StarterSignals>) => bestStarter(recommendStarters(signals(s)));

describe('STARTERS', () => {
  it('have unique IDs and each is a valid preset that survives being written to a file', () => {
    expect(new Set(STARTERS.map((s) => s.id)).size).toBe(STARTERS.length);
    for (const s of STARTERS) {
      expect(parsePresetText(starterPresetText(s)), s.id).toEqual(s.preset);
      expect(findStarter(s.id)).toBe(s);
    }
  });

  it('declare a Core profile, valid names and IDs, and match signals for every other profile', () => {
    for (const s of STARTERS) {
      const names = profileNames(s.preset);
      expect(names[0], s.id).toBe('Core');
      expect(names.length, s.id).toBeGreaterThan(1);
      for (const name of names) {
        expect(isProfileName(name), name).toBe(true);
        for (const id of resolveProfile(s.preset, name)) expect(isExtensionId(id), id).toBe(true);
        if (name !== 'Core') expect(s.preset.profiles[name].match?.files?.length, name).toBeGreaterThan(0);
      }
    }
  });

  it('All Languages has every language profile of the single starters', () => {
    const all = findStarter('all-languages')!;
    const singles = STARTERS.filter((s) => s !== all).flatMap((s) => profileNames(s.preset).slice(1));
    expect(profileNames(all.preset).slice(1)).toEqual(singles);
  });

  it('each starter has a welcome view entry for its recommendation in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
      contributes: { viewsWelcome: { when: string; contents: string }[] };
    };
    for (const s of STARTERS) {
      const entry = pkg.contributes.viewsWelcome.find((w) =>
        w.when.includes(`profileKit.recommendedStarter == ${s.id}`),
      );
      expect(entry, s.id).toBeDefined();
      expect(entry!.when).toContain('!profileKit.hasPreset');
    }
  });
});

describe('recommendStarters', () => {
  it('recommends nothing without signals, and keeps STARTERS order', () => {
    const list = recommendStarters(none);
    expect(bestStarter(list)).toBeUndefined();
    expect(list.map((r) => r.id)).toEqual(STARTERS.map((s) => s.id));
  });

  it('uses the files at the top of the folder (exact names count more than wildcards)', () => {
    const r = best({ files: ['pyproject.toml', 'main.py', 'README.md'] });
    expect(r?.id).toBe('python-data');
    expect(r?.matched.files).toEqual(['pyproject.toml', '*.py']);
    expect(r?.score).toBe(3);
  });

  it('uses the installed extensions (case-insensitive, core extensions do not count)', () => {
    const r = best({ extensions: ['MS-Python.Python', 'charliermarsh.ruff', 'eamodio.gitlens'] });
    expect(r?.id).toBe('python-data');
    expect(r?.matched.extensions).toEqual(['ms-python.python', 'charliermarsh.ruff']);
  });

  it('uses the languages of the open files', () => {
    const r = best({ languages: ['typescript', 'plaintext'] });
    expect(r?.id).toBe('web-js');
    expect(r?.matched.languages).toEqual(['typescript']);
  });

  it('a stray file of another language does not make it All Languages', () => {
    expect(best({ files: ['pyproject.toml', 'main.py', 'build.js'] })?.id).toBe('python-data');
  });

  it('two strong languages make it All Languages, with the reasons of both', () => {
    const r = best({
      files: ['pyproject.toml', 'package.json', 'tsconfig.json'],
      extensions: ['ms-python.python'],
    });
    expect(r?.id).toBe('all-languages');
    expect(r?.matched.files).toEqual(['pyproject.toml', 'package.json', 'tsconfig.json']);
    expect(r?.matched.extensions).toEqual(['ms-python.python']);
  });

  it('on a tie the more specific starter comes first, then STARTERS order', () => {
    // vadimcn.vscode-lldb is in both C-Cpp and Rust
    const list = recommendStarters(signals({ extensions: ['vadimcn.vscode-lldb'] }));
    expect(list.slice(0, 2).map((r) => r.id)).toEqual(['c-cpp', 'rust']);
    expect(list.find((r) => r.id === 'all-languages')?.score).toBe(0);
  });
});
