import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePreset, parsePresetText } from '../src/core/preset';
import { matchFilePattern, recommendForFolder } from '../src/core/workspace';

describe('matchFilePattern', () => {
  it.each([
    ['pyproject.toml', 'pyproject.toml', true],
    ['Dockerfile', 'dockerfile', true],
    ['pyproject.toml', 'pyproject.toml.bak', false],
    ['*.py', 'main.py', true],
    ['*.py', 'MAIN.PY', true],
    ['*.py', 'main.pyc', false],
    ['*.py', '.py', true],
    ['docker-compose.*', 'docker-compose.yml', true],
    ['go.?od', 'go.mod', true],
    ['*.c', 'a.cc', false],
    ['*.c', 'src/a.c', true],
    ['a+b.txt', 'a+b.txt', true],
    ['(x).*', '(x).md', true],
  ])('%s vs %s → %s', (pattern, name, expected) => {
    expect(matchFilePattern(pattern, name)).toBe(expected);
  });
});

describe('recommendForFolder', () => {
  const example = parsePresetText(readFileSync(join(__dirname, '..', 'presets', 'example.json'), 'utf8'));

  it.each([
    ['a Python project', ['pyproject.toml', 'src', 'README.md', 'notebook.ipynb'], ['Python-Data']],
    [
      'a Node project with a Dockerfile',
      ['package.json', 'tsconfig.json', 'Dockerfile', 'src'],
      ['Web-JS', 'Docker-Infra'],
    ],
    ['a Go module', ['go.mod', 'go.sum', 'main.go'], ['Go']],
    ['a Unity project', ['Assets', 'ProjectSettings', 'Game.sln', 'Packages'], ['CSharp-Unity']],
    ['nothing known', ['README.md', 'LICENSE'], []],
    ['an empty folder', [], []],
  ])('%s', (_, names, expected) => {
    expect(recommendForFolder(example, names).map((r) => r.profile)).toEqual(expected);
  });

  it('scores exact names above wildcards and keeps preset order on a tie', () => {
    const preset = parsePreset({
      profiles: {
        A: { match: { files: ['*.txt'] } },
        B: { match: { files: ['marker.txt'] } },
        C: { match: { files: ['*.md'] } },
        D: {},
      },
    });
    expect(recommendForFolder(preset, ['marker.txt', 'notes.md'])).toEqual([
      { profile: 'B', score: 2, matched: ['marker.txt'] },
      { profile: 'A', score: 1, matched: ['*.txt'] },
      { profile: 'C', score: 1, matched: ['*.md'] },
    ]);
  });
});
