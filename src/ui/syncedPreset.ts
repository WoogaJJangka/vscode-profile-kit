/**
 * The synced preset (`profileKit.preset` in Default's settings.json) as a file, `profile-kit:/synced.profile-kit.json`.
 * Every place that reads, edits or opens the preset works on a URI and text, so with this provider they work the
 * same for a file on this PC and for the preset that Settings Sync carries: reading gives the setting as JSON text,
 * writing stores the parsed text back in the setting. The name matches `*.profile-kit.json`, so the editor checks
 * it with the preset schema (contributes.jsonValidation).
 */
import * as vscode from 'vscode';

import { PRESET_SETTING, syncedPresetText, syncedPresetValue } from '../core';

const t = vscode.l10n.t;
export const SYNCED_PRESET_SCHEME = 'profile-kit';
export const SYNCED_PRESET_URI = vscode.Uri.from({ scheme: SYNCED_PRESET_SCHEME, path: '/synced.profile-kit.json' });

const SECTION = 'profileKit';
const KEY = PRESET_SETTING.slice(SECTION.length + 1);

/** The synced preset, or undefined when none is stored. Application scope: the same value in every profile. */
export function readSyncedPreset(): Record<string, unknown> | undefined {
  const value = vscode.workspace.getConfiguration(SECTION).inspect<unknown>(KEY)?.globalValue;
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Store (or with undefined, remove) the synced preset. VS Code writes it to Default's settings.json. */
export function writeSyncedPreset(value: Record<string, unknown> | undefined): Thenable<void> {
  return vscode.workspace.getConfiguration(SECTION).update(KEY, value, vscode.ConfigurationTarget.Global);
}

export class SyncedPresetFileSystem implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;
  private mtime = Date.now();
  private readonly listener: vscode.Disposable;

  constructor() {
    // a change from Settings Sync, the Settings editor or another window: editors showing the file reload
    this.listener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(PRESET_SETTING)) return;
      this.mtime = Date.now();
      this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri: SYNCED_PRESET_URI }]);
    });
  }

  dispose(): void {
    this.listener.dispose();
    this.emitter.dispose();
  }

  private text(uri: vscode.Uri): string {
    const value = uri.path === SYNCED_PRESET_URI.path ? readSyncedPreset() : undefined;
    if (!value) throw vscode.FileSystemError.FileNotFound(uri);
    return syncedPresetText(value);
  }

  watch(): vscode.Disposable {
    // changes are reported from onDidChangeConfiguration
    return new vscode.Disposable(() => undefined);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const size = new TextEncoder().encode(this.text(uri)).byteLength;
    return { type: vscode.FileType.File, ctime: 0, mtime: this.mtime, size };
  }

  readFile(uri: vscode.Uri): Uint8Array {
    return new TextEncoder().encode(this.text(uri));
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    if (uri.path !== SYNCED_PRESET_URI.path) throw vscode.FileSystemError.NoPermissions(uri);
    let value: Record<string, unknown>;
    try {
      value = syncedPresetValue(new TextDecoder().decode(content));
    } catch (error) {
      // a setting holds plain JSON: text that does not parse cannot be stored
      throw vscode.FileSystemError.Unavailable(
        t('The synced preset was not saved: {0}', error instanceof Error ? error.message : String(error)),
      );
    }
    await writeSyncedPreset(value);
    this.mtime = Date.now();
  }

  readDirectory(): [string, vscode.FileType][] {
    return [[SYNCED_PRESET_URI.path.slice(1), vscode.FileType.File]];
  }

  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }
}
