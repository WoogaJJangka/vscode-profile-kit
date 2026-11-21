/**
 * Translations stay in step with the code: every UI string passed to vscode.l10n.t (and the webview's list) has a
 * Korean entry, no entry is stale, and placeholders ({0}, {1}, ...) match. Same for package.nls(.ko).json.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/;
const CALL = new RegExp(String.raw`\b(?:t|vscode\.l10n\.t)\(\s*(` + LITERAL.source + ')', 'g');

function unquote(literal: string): string {
  if (literal.startsWith('"')) return JSON.parse(literal) as string;
  // single-quoted TS string: turn it into a JSON string
  const inner = literal.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"');
  return JSON.parse(`"${inner}"`) as string;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

function uiStrings(): Set<string> {
  const out = new Set<string>();
  for (const file of [...sources(path.join(root, 'src', 'ui')), path.join(root, 'src', 'extension.ts')]) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(CALL)) out.add(unquote(m[1]));
    const list = /WEBVIEW_STRINGS = \[([\s\S]*?)\] as const/.exec(text);
    if (list) for (const lit of list[1].match(new RegExp(LITERAL.source, 'g')) ?? []) out.add(unquote(lit));
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
const readJson = (file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8')) as Record<string, string>;

describe('l10n', () => {
  it('bundle.l10n.ko.json covers exactly the UI strings, with the same placeholders', () => {
    const wanted = uiStrings();
    const ko = readJson('l10n/bundle.l10n.ko.json');
    expect([...wanted].filter((k) => !(k in ko))).toEqual([]);
    expect(Object.keys(ko).filter((k) => !wanted.has(k))).toEqual([]);
    for (const [en, tr] of Object.entries(ko)) expect(placeholders(tr), en).toEqual(placeholders(en));
  });

  it('package.nls.ko.json has every key of package.nls.json, and package.json uses only known keys', () => {
    const en = readJson('package.nls.json');
    const ko = readJson('package.nls.ko.json');
    expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
    const used = [...readFileSync(path.join(root, 'package.json'), 'utf8').matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]);
    expect(used.filter((k) => !(k in en))).toEqual([]);
  });
});
