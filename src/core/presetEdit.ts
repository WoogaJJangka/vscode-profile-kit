/**
 * Edit preset text in place (the preset file is the source of truth, so the UI writes its changes back).
 * Uses jsonc-parser edits, so comments, key order and the file's own formatting are kept.
 * Every function returns new text and never throws away content it does not understand.
 */
import {
  applyEdits,
  findNodeAtLocation,
  getNodeValue,
  modify,
  parseTree,
  type FormattingOptions,
  type JSONPath,
  type Node,
} from 'jsonc-parser';

import { isExtensionId, normalizeId, stripBom } from './preset';

export type ExtensionTarget = { kind: 'core' } | { kind: 'group'; name: string } | { kind: 'profile'; name: string };
export type SettingsTarget = { kind: 'common' } | { kind: 'profile'; name: string };

export class PresetEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresetEditError';
  }
}

/** Indentation and line ending of the existing text, so inserted lines look like their neighbours. */
export function detectFormatting(text: string): FormattingOptions {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = /^([ \t]+)\S/m.exec(text)?.[1];
  if (indent?.startsWith('\t')) return { insertSpaces: false, tabSize: 4, eol };
  return { insertSpaces: true, tabSize: indent ? indent.length : 2, eol };
}

function rootOf(text: string): Node {
  const root = parseTree(stripBom(text));
  if (!root || root.type !== 'object') throw new PresetEditError('preset must be a JSON object');
  return root;
}

function edit(text: string, path: JSONPath, value: unknown, isArrayInsertion = false): string {
  // edit without the BOM (jsonc-parser does not expect one), then put it back
  const body = stripBom(text);
  const bom = text.slice(0, text.length - body.length);
  const edits = modify(body, path, value, { formattingOptions: detectFormatting(body), isArrayInsertion });
  return bom + applyEdits(body, edits);
}

function requireObject(root: Node, path: JSONPath, what: string): void {
  const node = findNodeAtLocation(root, path);
  if (!node || node.type !== 'object') throw new PresetEditError(`${what} does not exist in the preset`);
}

function listPath(root: Node, target: ExtensionTarget): JSONPath {
  switch (target.kind) {
    case 'core':
      return ['core'];
    case 'group': {
      const node = findNodeAtLocation(root, ['groups', target.name]);
      if (!node || node.type !== 'array')
        throw new PresetEditError(`group "${target.name}" does not exist in the preset`);
      return ['groups', target.name];
    }
    case 'profile':
      requireObject(root, ['profiles', target.name], `profile "${target.name}"`);
      return ['profiles', target.name, 'extensions'];
  }
}

/** Indexes of `id` (case-insensitive) in the list at `path`; [] when the list does not exist yet. */
function indexesOf(root: Node, path: JSONPath, id: string): number[] {
  const node = findNodeAtLocation(root, path);
  if (!node) return [];
  if (node.type !== 'array') throw new PresetEditError(`${path.join('.')} is not a list`);
  const want = normalizeId(id);
  return (node.children ?? []).flatMap((child, i) => {
    const value: unknown = getNodeValue(child);
    return typeof value === 'string' && normalizeId(value) === want ? [i] : [];
  });
}

/** Append an extension ID to core, a group, or a profile's `extensions`. No change if it is already there. */
export function addExtension(text: string, target: ExtensionTarget, id: string): string {
  if (!isExtensionId(id)) throw new PresetEditError(`not an extension ID (publisher.name): ${JSON.stringify(id)}`);
  const root = rootOf(text);
  const path = listPath(root, target);
  if (indexesOf(root, path, id).length) return text;
  return edit(text, [...path, -1], id, true);
}

/** Remove every occurrence of an extension ID (case-insensitive). No change if it is not there. */
export function removeExtension(text: string, target: ExtensionTarget, id: string): string {
  let out = text;
  for (;;) {
    const root = rootOf(out);
    const path = listPath(root, target);
    const found = indexesOf(root, path, id);
    if (!found.length) return out;
    out = edit(out, [...path, found[found.length - 1]], undefined);
  }
}

/**
 * Set (or with `value === undefined`, remove) one settings key in the common `settings` or a profile's `settings`.
 * A profile that shares settings with Default cannot have its own settings (same rule as parsePreset).
 */
export function setSetting(text: string, target: SettingsTarget, key: string, value: unknown): string {
  if (key.trim() === '') throw new PresetEditError('setting key must not be empty');
  const root = rootOf(text);
  let path: JSONPath;
  if (target.kind === 'common') {
    path = ['settings', key];
  } else {
    requireObject(root, ['profiles', target.name], `profile "${target.name}"`);
    const shared = findNodeAtLocation(root, ['profiles', target.name, 'shareFromDefault', 'settings']);
    if (value !== undefined && shared && getNodeValue(shared) === true)
      throw new PresetEditError(
        `profile "${target.name}" shares settings with Default (shareFromDefault.settings: true); it cannot have its own settings`,
      );
    path = ['profiles', target.name, 'settings', key];
  }
  if (value === undefined && !findNodeAtLocation(root, path)) return text;
  return edit(text, path, value);
}
