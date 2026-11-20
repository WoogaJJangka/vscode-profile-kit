/**
 * The `code` CLI that belongs to the running VS Code, found from `vscode.env.appRoot`.
 * Seen layouts (appRoot → CLI):
 *   Windows 1.9x+   <install>/<commit>/resources/app → <install>/bin/code.cmd   (3 up)
 *   Windows older   <install>/resources/app          → <install>/bin/code.cmd   (2 up)
 *   Linux           /usr/share/code/resources/app    → /usr/share/code/bin/code (2 up)
 *   macOS           .../Contents/Resources/app       → .../Contents/Resources/app/bin/code
 * Only Windows 1.147 was checked (PLAN.md section 8, #1); the others come from the install layouts.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';

export function codeCliNames(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? ['code.cmd', 'code-insiders.cmd'] : ['code', 'code-insiders'];
}

export function codeCliCandidates(appRoot: string, platform: NodeJS.Platform = process.platform): string[] {
  const up = (n: number) => {
    let dir = appRoot;
    for (let i = 0; i < n; i++) dir = path.dirname(dir);
    return dir;
  };
  const binDirs = [path.join(appRoot, 'bin'), path.join(up(2), 'bin'), path.join(up(3), 'bin')];
  return binDirs.flatMap((dir) => codeCliNames(platform).map((name) => path.join(dir, name)));
}

export function findCodeCli(
  appRoot: string,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  return codeCliCandidates(appRoot, platform).find(exists);
}
