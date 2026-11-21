/** Messages between the manager panel (webview) and the extension. Types only: bundled into both sides. */

export interface PanelProfile {
  name: string;
  exists: boolean;
  current: boolean;
  /** Uses Default settings (preset shareFromDefault.settings or VS Code's own flag): no own settings column. */
  sharesSettings: boolean;
}

export interface PanelExtension {
  id: string;
  displayName?: string;
  /** Row group: `core`, `group <name>`, `profile`, or `undeclared`. */
  section: string;
  declaredIn: string[];
  installedIn: string[];
}

export interface ManagerState {
  presetPath: string;
  presetError?: string;
  profiles: PanelProfile[];
  extensions: PanelExtension[];
  settings: {
    common: Record<string, unknown>;
    profiles: Record<string, Record<string, unknown>>;
    /** Keys Default applies to all profiles (`workbench.settings.applyToAllProfiles`): no per-profile value. */
    allProfiles: string[];
  };
  /** Labels in the user's language (vscode.l10n), keyed by the English text. */
  strings: Record<string, string>;
}

export interface PreviewLine {
  kind: 'preset' | 'install' | 'settings' | 'note';
  text: string;
}

export interface Preview {
  /** Fingerprint of the preset text the preview was made from; apply refuses if the file changed since. */
  token: string;
  lines: PreviewLine[];
  empty: boolean;
}

/** Desired set of declared profiles for one extension. */
export interface ExtensionChange {
  id: string;
  profiles: string[];
}

/** `scope` '' is the common settings; otherwise a profile name. `value` is JSON text; undefined removes the key. */
export interface SettingChange {
  scope: string;
  key: string;
  value?: string;
}

export type ToWebview =
  | { type: 'state'; state: ManagerState }
  | { type: 'preview'; kind: 'extensions' | 'settings'; preview: Preview }
  | { type: 'busy'; busy: boolean; message?: string }
  | { type: 'done'; message: string }
  | { type: 'error'; message: string };

export type FromWebview =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'previewExtensions'; changes: ExtensionChange[] }
  | { type: 'applyExtensions'; changes: ExtensionChange[]; token: string }
  | { type: 'previewSettings'; changes: SettingChange[] }
  | { type: 'applySettings'; changes: SettingChange[]; token: string }
  | { type: 'installToProfiles' }
  | { type: 'editPreset' }
  | { type: 'openExtension'; id: string };
