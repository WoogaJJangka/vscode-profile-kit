/**
 * package.json and the code stay in step: every command the manifest names (menus, walkthrough, welcome links) is
 * declared and registered, the walkthrough's media files exist, and its ID is the one the code opens.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

interface Manifest {
  contributes: {
    commands: { command: string }[];
    menus: Record<string, { command: string }[]>;
    walkthroughs: {
      id: string;
      steps: { id: string; media: { svg?: string; image?: string; markdown?: string }; completionEvents?: string[] }[];
    }[];
  };
}

const pkg = JSON.parse(read('package.json')) as Manifest;
const declared = new Set(pkg.contributes.commands.map((c) => c.command));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('package.json', () => {
  it('menus name only declared commands', () => {
    const used = Object.values(pkg.contributes.menus).flatMap((items) => items.map((i) => i.command));
    expect(used.filter((id) => !declared.has(id))).toEqual([]);
  });

  it('every declared command is registered in the code, and the other way round', () => {
    const code = sources(path.join(root, 'src'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const registered = new Set([...code.matchAll(/\breg\('(profileKit\.[A-Za-z]+)'/g)].map((m) => m[1]));
    expect([...declared].filter((id) => !registered.has(id))).toEqual([]);
    expect([...registered].filter((id) => !declared.has(id))).toEqual([]);
  });

  it('command links in the welcome view and the walkthrough point to declared commands', () => {
    for (const file of ['package.nls.json', 'package.nls.ko.json']) {
      const links = [...read(file).matchAll(/\(command:(profileKit\.[A-Za-z]+)/g)].map((m) => m[1]);
      expect(links.length, file).toBeGreaterThan(0);
      expect(
        links.filter((id) => !declared.has(id)),
        file,
      ).toEqual([]);
    }
  });

  it('the walkthrough: media files exist, completion commands are declared, the ID matches the code', () => {
    const [walkthrough] = pkg.contributes.walkthroughs;
    for (const step of walkthrough.steps) {
      const media = step.media.svg ?? step.media.image ?? step.media.markdown ?? '';
      expect(existsSync(path.join(root, media)), `${step.id}: ${media}`).toBe(true);
      for (const event of step.completionEvents ?? [])
        if (event.startsWith('onCommand:')) expect(declared.has(event.slice('onCommand:'.length)), event).toBe(true);
    }
    const id = /WALKTHROUGH_ID = '([^']+)'/.exec(read('src/ui/commands.ts'))?.[1];
    expect(id).toBe(walkthrough.id);
  });

  // the Welcome page shows SVG media under a content security policy without inline styles: a <style> block or a
  // style attribute is dropped and everything turns black (seen in VS Code 1.147). Colors go in presentation
  // attributes, fill="var(--vscode-..., #fallback)", like VS Code's own walkthrough images.
  it('walkthrough SVGs use presentation attributes only (no <style>, class or style attributes)', () => {
    for (const step of pkg.contributes.walkthroughs[0].steps) {
      if (!step.media.svg) continue;
      const svg = read(step.media.svg);
      expect(svg, step.media.svg).not.toMatch(/<style|\sclass=|\sstyle=/);
    }
  });
});
