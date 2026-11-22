# Changelog

## [1.1.0] - pre-release

Easier to use from inside VS Code: one menu for everything, the next step at the top of the Profiles view, and a Get Started guide.

### Added

- **Get Started guide** on VS Code's Welcome page (**Profile Kit: Get Started**): four steps with buttons, from picking a preset to creating, switching and filling profiles. VS Code opens it when the extension is installed; the welcome text, the view's "..." menu and the menu link to it.
- **Menu** (click the status bar, or **Profile Kit: Show Menu**): the profiles to switch this window to, then the actions that fit now: apply (with how many profiles need changes), install to profiles, the manager, the preset file, import and export. Without a preset it starts with the ways to get one, the recommended built-in preset first.
- Profiles view: a top row with the next step ("2 profile(s) need changes", click to preview and apply; "All 8 profile(s) have their extensions", click to check settings too) (its tooltip names the preset file), and a badge on the Activity Bar icon with the number of profiles that need changes (of the profiles listed so far).

### Changed

- Clicking the status bar opens the menu instead of the switch list. The profiles are still at the top, so switching takes the same clicks.
- Adding an extension to profiles no longer asks where the preset records it. It goes to core or a group when that gives it to exactly the chosen profiles, otherwise to each chosen profile's own list. The result message says where; to use a broader group instead, edit the preset.
- The view toolbar has three Profile Kit buttons (apply, manager, refresh) besides VS Code's Collapse All; everything else is in its "..." menu, in groups. Commands that need a preset are hidden from the Command Palette until one is set, and **Switch to This Profile** (a tree button) is not listed there.
- New preset files (built-in preset, from this profile, import) are offered in the open folder, or in the home folder when no folder is open.
- Example preset: Material Icon Theme (`pkief.material-icon-theme`) is in core. Cool Theme Kit uses it for its icon layers.

### Fixed

- With profiles in VS Code but no preset set, the Profiles view listed those profiles and so never showed the welcome view with the ways to start. With no preset the view is now empty and the welcome view shows.
- Example preset: Cool Theme Kit is now `woogajjangka.cool-theme-kit`. The old ID `woogajjangka.cool-icon-vscode` is no longer on the Marketplace, so installing it failed on a new PC.

## [1.0.0]

First release (not a pre-release). The features are those of 0.5.0.

### Security

- Windows: an argument for `code` that cmd.exe would change even inside quotes (`"`, `%`, a line break) is refused with an error instead of being passed on altered; a trailing backslash (a drive root such as `D:\`) no longer escapes the closing quote.
- The manager panel checks extension IDs before they reach the preset or `code`.
- Development only: `@vscode/vsce` now uses minimatch 11.0.9 (GHSA-g3hv-75wg-m249). Nothing from it is in the VSIX.

### Changed

- The Marketplace listing no longer says Preview.

## [0.5.0] - pre-release

### Added

- **Start from a Built-in Preset...** (Profiles view welcome, view menu): nine general-purpose starter presets (Python · Data, Web · JavaScript, Java, C · C++, C# · .NET, Go, Rust, Docker · Infra, All Languages), each a small core, a `Core` profile and language profiles with `match`. The one that fits is recommended from the open folder's top-level files, the open files' languages and the extensions of this window's profile; All Languages only when two languages each have a strong signal. The chosen one is written to a `*.profile-kit.json` file and used as the preset.

## [0.3.0] - pre-release

### Added

- **Export Profiles as .code-profile...** (tree, view menu, CLI `profile-kit export`): one VS Code profile file per preset profile, with its extensions and the settings `apply` would write, then VS Code's Profiles editor to import it. Checked by importing an exported file in VS Code 1.147.
- **Import Profiles into Preset...**: `.code-profile` files or VS Code's built-in profile templates become profiles in the current preset or a new one (extensions and settings).
- **Create Preset from This Profile** offers VS Code's built-in templates as extra profiles.
- Extensions VS Code applies to all profiles ("Apply Extension to all Profiles") are marked "all profiles (VS Code)" in the tree, the manager and CLI `verify`, instead of a plain "extra".
- Apply previews (extension, manager, CLI) say the changes may also reach other PCs when Settings Sync has run on this PC.
- The compatibility check also covers the extensions.json flag for extensions applied to all profiles and VS Code's template list.

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
