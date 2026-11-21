/**
 * VS Code's list of installed extensions, `extensions.json` (read only, stage C-2). The one in the extensions folder
 * (`~/.vscode/extensions/extensions.json`, `--extensions-dir`) is the Default profile's list, and it also holds the
 * extensions marked "Apply Extension to all Profiles" (`metadata.isApplicationScoped`). `code --list-extensions`
 * shows those in every profile without saying why. docs/PLAN.md section 8-2. Profile Kit never writes this file.
 */
import { APPLICATION_SCOPED_FLAG } from './compat';
import { isRecord, normalizeId } from './preset';
import { compareCodeUnits } from './text';

/** Lower-case IDs of extensions VS Code applies to all profiles. Throws when the text is not a JSON list. */
export function parseApplicationScoped(text: string): string[] {
  const json = JSON.parse(text) as unknown;
  if (!Array.isArray(json)) throw new Error('extensions.json is not a list');
  const ids = json.flatMap((e) => {
    if (!isRecord(e) || !isRecord(e.identifier) || typeof e.identifier.id !== 'string') return [];
    return isRecord(e.metadata) && e.metadata[APPLICATION_SCOPED_FLAG] === true ? [normalizeId(e.identifier.id)] : [];
  });
  return [...new Set(ids)].sort(compareCodeUnits);
}
