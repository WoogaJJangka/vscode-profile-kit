/**
 * Where VS Code keeps user data, and where Profile Kit keeps its own state inside it.
 * Node only (no VS Code API), shared by the CLI and the extension.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import { PROFILES_FOLDER, SYNC_FOLDER } from '../core/compat';
import { PROFILE_KIT_ID } from '../core/dependencies';

/** Folder under `User/globalStorage/` for Profile Kit's own files. One path for all profiles: the extension's
 * globalStorageUri is the same in every profile (PLAN.md section 8, #3), and the CLI must find the same files. */
export const STATE_DIR_NAME = PROFILE_KIT_ID;

/** VS Code's default user data folder (what `--user-data-dir` replaces). */
export function defaultUserDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
  product = 'Code',
): string {
  if (env.VSCODE_PORTABLE) return path.join(env.VSCODE_PORTABLE, 'user-data');
  if (platform === 'win32') return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), product);
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', product);
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), product);
}

/** VS Code's default extensions folder (what `--extensions-dir` replaces). */
export function defaultExtensionsDir(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  return path.join(env.VSCODE_PORTABLE ?? path.join(home, '.vscode'), 'extensions');
}

/**
 * The user data folder from an extension's `globalStorageUri.fsPath` (`<userData>/User/globalStorage/<ext>`):
 * this follows `--user-data-dir`, portable mode and Insiders without guessing.
 */
export function userDataDirFromGlobalStorage(globalStoragePath: string): string | undefined {
  let dir = path.resolve(globalStoragePath);
  for (;;) {
    if (path.basename(dir) === 'User') return path.dirname(dir);
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export interface UserDataPaths {
  userData: string;
  /** `<userData>/User`: Default profile's files and `profiles/`. */
  user: string;
  storageJson: string;
  /** Default profile's settings.json: read only (for `workbench.settings.applyToAllProfiles`), never written. */
  defaultSettings: string;
  /** Profile Kit's own folder. */
  stateDir: string;
  /** Settings Sync's last synced copies: there once Sync has run on this PC (read only, for a note). */
  syncDir: string;
  /** Old list of managed keys, from before it moved into each settings.json (review P3): read only. */
  managedSettingsFile: string;
  profileSettings(location: string): string;
  /** A new backup folder for one apply run. */
  backupDir(now?: Date): string;
}

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export function userDataPaths(userData: string): UserDataPaths {
  const user = path.join(userData, 'User');
  const stateDir = path.join(user, 'globalStorage', STATE_DIR_NAME);
  return {
    userData,
    user,
    storageJson: path.join(user, 'globalStorage', 'storage.json'),
    defaultSettings: path.join(user, 'settings.json'),
    stateDir,
    syncDir: path.join(user, SYNC_FOLDER),
    managedSettingsFile: path.join(stateDir, 'managed-settings.json'),
    profileSettings: (location) => {
      // location comes from storage.json; never let it point outside User/profiles
      if (!location || /[\\/]|^\.\.?$/.test(location)) throw new Error(`unexpected profile location "${location}"`);
      return path.join(user, PROFILES_FOLDER, location, 'settings.json');
    },
    backupDir: (now = new Date()) => path.join(stateDir, `backup-${stamp(now)}`),
  };
}
