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

/**
 * Why reading a file failed, without the file's content. `JSON.parse` errors quote part of the text they failed on
 * (Node 20+: `Unexpected token 'x', "...text..." is not valid JSON`), and that text must not reach logs or messages.
 * File system errors give their code (`ENOENT`, `EACCES`); other errors are Profile Kit's own and keep their message.
 */
export function readErrorSummary(error: unknown): string {
  if (error instanceof SyntaxError) return 'not valid JSON';
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.message : 'unknown error';
}

/** `s` without the `/` characters at its end. A loop, not `/\/+$/`, which backtracks on long runs of `/` (S8786). */
export function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === '/') end--;
  return s.slice(0, end);
}
