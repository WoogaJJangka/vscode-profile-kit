/**
 * Small text helpers shared by core, the extension and the webview (no Node or VS Code API).
 */

/**
 * Order strings by UTF-16 code units: the order `Array.prototype.sort()` uses without a compare function, written
 * out (SonarQube S2871). Not `localeCompare`: lists Profile Kit stores (e.g. `profileKit.managedKeys`) move between
 * PCs with Settings Sync, and their order must not depend on each PC's locale.
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** `s` without the `/` characters at its end. A loop, not `/\/+$/`, which backtracks on long runs of `/` (S8786). */
export function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === '/') end--;
  return s.slice(0, end);
}
