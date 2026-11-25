/** What run.ts (Node) hands to suite.ts (inside VS Code), and the preset the checks start from. */

/** Environment variable with the IntegrationConfig as JSON. */
export const INTEGRATION_ENV = 'PROFILE_KIT_INTEGRATION';

export interface IntegrationConfig {
  /** The throwaway folder everything is in. */
  data: string;
  userData: string;
  extensionsDir: string;
  /** The folder the window opens. */
  workspace: string;
  /** The preset file `profileKit.presetPath` names. */
  preset: string;
  /** Text file the suite appends its PASS/FAIL lines to; run.ts prints it. */
  results: string;
}

export const PRESET_FILE = 'extensions.profile-kit.json';
/** The profile the window runs in (VS Code creates it on start: `--profile`). */
export const PROFILE_HERE = 'Alpha';
/** A declared profile that does not exist yet: applying creates it. */
export const PROFILE_OTHER = 'Beta';

/** Small Marketplace extensions (the first two are the ones scripts/compat/check.ts installs). */
export const IN_CORE = 'editorconfig.editorconfig';
/** Installed "by the user" into this window's profile: the install prompt. */
export const USER_INSTALLED = 'ms-vscode.wordcount';
/** Installed while another window has claimed the prompt, then added with "Install to Profiles...". */
export const SECOND_INSTALL = 'oderwat.indent-rainbow';
/** An extension pack, declared for this window's profile only: VS Code installs its members along with it. */
export const PACK = 'ms-vscode-remote.remote-ssh';
export const PACK_MEMBERS = ['ms-vscode-remote.remote-ssh-edit', 'ms-vscode.remote-explorer'];
/** A pack installed "by the user"; its members also depend on it (Marketplace data, 2026-11-25). */
export const USER_PACK = 'ms-vscode.remote-repositories';
export const USER_PACK_MEMBERS = ['github.remotehub', 'ms-vscode.azure-repos'];
/** Installed while two windows of the profile are open. */
export const TWIN_INSTALL = 'codezombiech.gitignore';

/** One line a window that only watches writes to `<data>/windows/<session>.jsonl` (suite.ts). */
export interface WindowLine {
  /** Profile Kit runs in the window; the profile its marker names ('' before a preset was applied to it). */
  ready?: string;
  /** A message the window showed. */
  dialog?: string;
  /** The extensions of the window's profile after a change. */
  installed?: string[];
}

export const COMMON_SETTING = { key: 'editor.rulers', value: [100] };

export function startPreset(): string {
  return `${JSON.stringify(
    {
      core: [IN_CORE],
      groups: {},
      settings: { [COMMON_SETTING.key]: COMMON_SETTING.value },
      profiles: { [PROFILE_HERE]: { extensions: [PACK] }, [PROFILE_OTHER]: {} },
    },
    null,
    2,
  )}\n`;
}
