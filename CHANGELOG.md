# Changelog

## [Unreleased]

### Extension

- Activity Bar **Profiles** tree: declared and existing profiles with ok / missing / extra counts, extensions with where they come from, inline install-missing and switch buttons.
- Status bar with this window's profile (from the `profileKit.profile` marker Profile Kit writes into each profile's settings); click to switch in place.
- After installing an extension the preset does not declare: a prompt to add it to other profiles, with suggested profiles. **Install to Profiles...** for any extension ID, using Marketplace data for suggestions.
- **Manager** panel: extensions × profiles matrix and a settings table (common and per-profile), each with preview and apply.
- Folder suggestion from `match.files`, once per folder; the switch list puts the suggested profile first.
- Apply the preset to one or all profiles: create profiles, install missing extensions, write settings (backups first), with a preview and a confirmation.
- Open or create a preset (draft from this profile's extensions); `*.profile-kit.json` files get the preset schema.
- English and Korean UI.

### CLI

- `profile-kit plan`, `verify` and `apply` (preview by default, `--yes` to run). `--user-data-dir`, `--extensions-dir` and `--shared-data-dir` for an isolated VS Code.

### Preset

- `core`, `groups`, `profiles`, plus common `settings`, `profiles.X.settings` and `profiles.X.match` (`languages`, `files`, `keywords`). JSON with comments is allowed.

### Safety

- Nothing is uninstalled. The Default profile and VS Code's internal files (storage.json, state.vscdb) are never written.
- Window-opening `code` calls are only made when they reach the running VS Code (same data folders). Otherwise a second VS Code could start on the default shared data and sign you out.
