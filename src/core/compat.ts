/**
 * VS Code behavior Profile Kit relies on that is not public API (review P9). Each piece that could change with a
 * VS Code update, and then quietly give wrong results, is named here once, with the version it was last checked on.
 * The CLI parts are run against real VS Code builds every week by `.github/workflows/compat.yml`.
 * When VS Code changes one of them: fix it here, update COMPAT_CHECKED_VERSION and `docs/PLAN.md` section 10.
 */

/** VS Code version these were last checked on by hand (docs/PLAN.md section 8, Windows). */
export const COMPAT_CHECKED_VERSION = '1.147.0';

export interface PrivateDependency {
  what: string;
  usedIn: string;
  /** What breaks, and how Profile Kit notices. */
  ifChanged: string;
}

export const PRIVATE_DEPENDENCIES: readonly PrivateDependency[] = [
  {
    what: 'storage.json: userDataProfiles, profileAssociations, useDefaultFlags',
    usedIn: 'core/profiles.ts',
    ifChanged: 'profiles and folder links are not read; reported as storage problems in the tree',
  },
  {
    what: 'profile folder User/profiles/<location>/settings.json',
    usedIn: 'host/paths.ts',
    ifChanged: 'writing profile settings fails',
  },
  {
    what: 'command workbench.profiles.actions.profileEntry.<location>',
    usedIn: 'ui/switch.ts',
    ifChanged: 'switching falls back to VS Code profile picker',
  },
  {
    what: "code CLI output: 'successfully installed', 'already installed', \"Profile 'X' not found\"",
    usedIn: 'core/codeCli.ts, host/installer.ts',
    ifChanged: 'unclear results are checked with --list-extensions (review P10)',
  },
  {
    what: 'code --profile X --new-window creates profile X',
    usedIn: 'host/installer.ts',
    ifChanged: 'creating a profile times out',
  },
  {
    what: 'code CLI at bin/code(.cmd) 0, 2 or 3 folders above appRoot',
    usedIn: 'host/codeLocator.ts',
    ifChanged: '"code" from PATH is used, and the tree says so',
  },
];

// --- storage.json (`<userData>/User/globalStorage/storage.json`, read only) ---

export const STORAGE_PROFILES_KEY = 'userDataProfiles';
export const STORAGE_ASSOCIATIONS_KEY = 'profileAssociations';
/** Profile ID VS Code uses for Default in `profileAssociations`. */
export const DEFAULT_PROFILE_ID = '__default__profile__';

// --- profile folders ---

/** Folder under `<userData>/User/` that holds one folder per profile, named by its location. */
export const PROFILES_FOLDER = 'profiles';

// --- commands ---

/** Switches this window to the profile in place; one command per profile (docs/PLAN.md section 8, #4). */
export const PROFILE_ENTRY_COMMAND_PREFIX = 'workbench.profiles.actions.profileEntry.';
/** VS Code's own profile picker (fallback when the per-profile command is not there). */
export const SWITCH_PROFILE_COMMAND = 'workbench.profiles.actions.switchProfile';

export const profileEntryCommand = (location: string) => `${PROFILE_ENTRY_COMMAND_PREFIX}${location}`;

// --- code CLI output (English; VS Code prints the CLI in English whatever the display language) ---

export const CLI_PROFILE_NOT_FOUND = /profile '.*' not found/i;
export const CLI_ALREADY_INSTALLED = /already installed/i;
export const CLI_INSTALLED = /successfully installed/i;
// `(Error: aborted)`: the VSIX download was cut off while being written to CachedExtensionVSIXs
// ("Unable to write file ... (Error: aborted)", install-log 2026-11-20). A retry succeeded every time.
export const CLI_NETWORK_ERROR =
  /getaddrinfo|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|network|\(Error: aborted\)/i;

/** The CLI said the profile does not exist. */
export const cliProfileNotFound = (output: string) => CLI_PROFILE_NOT_FOUND.test(output);

// --- where the code CLI is ---

/** `bin/` is this many folders above `vscode.env.appRoot` (see host/codeLocator.ts for the layouts). */
export const CODE_CLI_LEVELS_ABOVE_APP_ROOT: readonly number[] = [0, 2, 3];
