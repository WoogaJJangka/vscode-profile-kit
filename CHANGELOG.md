# Changelog

## [Unreleased]

### Fixed

- Windows: a `code` call that times out now ends the whole process tree; before, only the shell was killed and the call did not return until VS Code's CLI ended on its own.
- Settings Sync: the list of keys Profile Kit manages is kept in each profile's settings.json (`profileKit.managedKeys`), so it moves with the file. Before, it stayed in this PC's globalStorage, and on another PC Profile Kit's keys looked like yours and dropped keys were not removed. The old list is still read for profiles that do not have the new one yet.
- `profileKit.presetPath` is no longer synced (it is a path on this PC). When the file is not on this PC, the tree says so and offers to open the preset.

- The install-after prompt asks in one window only when several windows use the same profile, and not at all for an extension that was only enabled again.
- An install whose output is unclear (other wording) counts as installed when `--list-extensions` has the extension; an extension ID with "network" in it no longer makes a failure look like a network error.

### Changed

- Marketplace listing: extension icon, keywords, README status line.
- Extensions are installed up to 10 per `code` call, then checked with `--list-extensions`; only the ones not there are tried again one by one.
- Opening a window lists only that window's profile; every profile is listed once the Profiles view or the manager is shown, at most 3 `code` calls at a time.
- Creating profiles: the confirmation, the result and the CLI say the windows opened for new profiles can be closed.
- The output channel starts with the VS Code version and the version Profile Kit's use of VS Code internals was checked on. README has a support section, and there is a bug report template.

## [0.1.0] - pre-release

### Extension

- Activity Bar **Profiles** tree: declared and existing profiles with ok / missing / extra counts, extensions with where they come from, inline install-missing and switch buttons.
- Status bar with this window's profile (from the `profileKit.profile` marker Profile Kit writes into each profile's settings); click to switch in place.
- After installing an extension the preset does not declare: a prompt to add it to other profiles, with suggested profiles. **Install to Profiles...** for any extension ID, using Marketplace data for suggestions.
- **Manager** panel: extensions × profiles matrix and a settings table (common and per-profile), each with preview and apply.
- Folder suggestion from `match.files`, once per folder; the switch list puts the suggested profile first.
- Apply the preset to one or all profiles: create profiles, install missing extensions, write settings (backups first), with a preview and a confirmation.
- Settings listed in VS Code's **Apply Setting to all Profiles** (`workbench.settings.applyToAllProfiles`) are left to Default: not written to profiles, marked in the settings table, noted in the preview when the preset differs, and a reload prompt when the list changes.
- Open or create a preset (draft from this profile's extensions); `*.profile-kit.json` files get the preset schema.
- English and Korean UI.

### CLI

- `profile-kit plan`, `verify` and `apply` (preview by default, `--yes` to run). `--user-data-dir`, `--extensions-dir` and `--shared-data-dir` for an isolated VS Code.

### Preset

- `core`, `groups`, `profiles`, plus common `settings`, `profiles.X.settings` and `profiles.X.match` (`languages`, `files`, `keywords`). JSON with comments is allowed.

### Safety

- Nothing is uninstalled. The Default profile and VS Code's internal files (storage.json, state.vscdb) are never written.
- Window-opening `code` calls are only made when they reach the running VS Code (same data folders). Otherwise a second VS Code could start on the default shared data and sign you out.
