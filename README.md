# Profile Kit

> Pre-release (0.x). Marketplace: `woogajjangka.vscode-profile-kit`.

[한국어](#한국어) · [English](#english)

## 한국어

VS Code 확장을 **공통(core) + 용도별 그룹**으로 한 파일(프리셋)에 선언하고, 그 선언대로 프로필을 만들고, 맞추고, 바꿔 쓰는 확장입니다.
모든 작업은 VS Code 안의 화면에서 합니다. 명령줄 도구(CLI)는 새 PC에서 한 번에 맞추거나 CI에서 점검할 때 씁니다.

### 할 수 있는 것

- **프로필 한눈에 보기**: Activity Bar의 Profile Kit 트리에 프로필마다 `정상 · 빠짐 · 추가` 개수가 나오고, 펼치면 확장마다 어디서 왔는지(core, 그룹, 프로필)가 보입니다. 상태 표시줄에는 이 창의 프로필이 나옵니다.
- **설치할 때 프로필 고르기**: 평소처럼 확장을 설치하면 "다른 프로필에도 넣을까요? 추천: …" 알림이 뜹니다. 추천 프로필이 미리 체크된 목록에서 고르면 프리셋에 기록하고 그 프로필들에도 설치합니다. **프로필에 설치...** 명령으로 아직 설치하지 않은 확장도 같은 방식으로 넣을 수 있습니다.
- **추천**: 확장의 언어, 키워드, 의존성과 프리셋의 `match`를 비교해 프로필을 추천합니다. 테마, 키맵, 언어 팩은 core(모든 프로필)를 추천합니다.
- **관리 화면**: 확장 × 프로필 표에서 체크로 선언을 바꾸고, 설정 표에서 공통 값과 프로필별 값을 고칩니다. 바뀔 내용을 미리 본 뒤 적용합니다.
- **전환**: 상태 표시줄을 누르면 같은 창에서 바로 프로필이 바뀝니다. 폴더를 열면 `match.files`로 맞는 프로필을 한 번 추천하고, 전환하면 그 폴더는 다음부터 그 프로필로 열립니다.
- **설정 호환**: 프리셋의 공통 `settings`와 `profiles.X.settings`를 합쳐 각 프로필의 settings.json에 씁니다. Profile Kit가 쓴 키만 관리하고, 직접 넣은 키와 주석은 그대로 둡니다. 쓰기 전에 백업합니다. Default 설정을 그대로 쓰고 싶은 프로필은 `shareFromDefault.settings: true`로 둡니다.
  모든 프로필에 같은 값을 쓰려면 VS Code의 **모든 프로필에 설정 적용**(`workbench.settings.applyToAllProfiles`)을 쓰세요. 이 목록에 있는 키는 Default 값을 쓰므로 Profile Kit가 프로필 settings.json에 쓰지 않고, 프리셋 값과 다르면 미리보기에서 알려 줍니다. 목록을 바꾼 뒤에는 열린 창을 다시 로드해야 합니다.
- **VS Code 프로필 파일(`.code-profile`)과 오가기**: **.code-profile로 프로필 내보내기...**는 프리셋의 프로필마다 파일을 만들고 VS Code의 프로필 편집기를 엽니다. 거기에 파일을 끌어다 놓거나 새 프로필 > 프로필 가져오기로 만듭니다. 꼭 **새 프로필로** 가져오세요. 이미 있는 프로필에 가져오면 VS Code가 파일에 없는 확장을 제거합니다. 반대로 **프리셋으로 프로필 가져오기...**는 `.code-profile` 파일이나 VS Code 내장 템플릿(Python, Data Science 등)을 프리셋의 프로필로 넣습니다. 확장과 설정만 가져오고 단축키·스니펫은 가져오지 않습니다.
- **내장 프리셋으로 시작**: 프리셋이 없을 때 Python · 데이터, 웹 · JavaScript, Java, C · C++, C# · .NET, Go, Rust, Docker · 인프라, 모든 언어 중 하나로 시작합니다. 열린 폴더의 파일, 열린 파일의 언어, 이 프로필에 설치된 확장을 보고 맞는 것을 Profiles 화면과 목록 맨 위에 추천합니다. 고른 프리셋은 파일로 저장되어 그대로 고쳐 쓸 수 있습니다.
- **VS Code 템플릿에서 시작**: **이 프로필로 프리셋 만들기**에서 VS Code 내장 템플릿을 골라 용도별 프로필로 같이 넣을 수 있습니다.
- **"모든 프로필에 확장 적용" 표시**: VS Code에서 모든 프로필에 적용한 확장은 모든 프로필 목록에 나오므로, 트리·관리 화면·CLI `verify`에 "모든 프로필 (VS Code)"로 표시합니다. 프리셋에 없어도 직접 넣은 "추가"가 아닙니다.
- **Settings Sync 안내**: 이 PC에서 Sync가 동기화한 적이 있으면 적용 미리보기에 "켜져 있다면 다른 PC로도 동기화됩니다"를 보여 줍니다. Sync가 켜져 있는지는 VS Code 내부 DB에만 있어 읽지 않습니다.

### 안전 규칙

- 확장을 **제거하지 않습니다.** 프리셋에서 빼도 설치된 확장은 남고, 트리에 "추가"로 보입니다.
- **Default 프로필은 바꾸지 않습니다.** VS Code 내부 파일(storage.json, state.vscdb)은 읽기만 합니다.
- 바꾸는 작업은 모두 미리보기 → 확인 순서로 합니다.
- 프로필은 VS Code가 창을 열어야만 만들어지므로, 새 프로필을 만들 때는 새 창이 열립니다.

### VS Code 내장 기능과 다른 점

내장 기능이 있는 일은 다시 만들지 않습니다. 프로필 만들기·전환은 VS Code를 호출하고, **모든 프로필에 설정 적용** 목록은 읽어서 따르고, 동기화는 Settings Sync에 맡깁니다. 내장 기능에 없는 일이 Profile Kit의 몫입니다.

| 일                                | VS Code 내장                              | Profile Kit                                                                           |
| --------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| 프로필 만들기·전환                | 있음 (Profiles 편집기)                    | 프리셋대로 한 번에 만들고, 상태 표시줄·트리·폴더 추천에서 전환. VS Code를 호출해서 함 |
| 확장 하나를 모든 프로필에         | 있음 (Apply Extension to all Profiles)    | `core`로 선언. VS Code에서 적용한 확장은 "모든 프로필 (VS Code)"로 표시               |
| 설정 하나를 모든 프로필에         | 있음 (`applyToAllProfiles`)               | 그 목록을 읽어 프로필에 쓰지 않고, 프리셋 값과 다르면 알려 줌                         |
| 프로필 파일 공유                  | 있음 (`.code-profile` 내보내기/가져오기)  | 프리셋 파일을 Git으로 공유. 프리셋 ↔ `.code-profile` 변환, 내장 템플릿 가져오기       |
| 기기 간 동기화                    | 있음 (Settings Sync)                      | Sync에 맡기고, Sync와 어긋나지 않게 함 (아래 "새 PC")                                 |
| 구성 전체를 한 파일로 선언 + 이력 | 없음                                      | 핵심                                                                                  |
| 선언과 실제의 차이 점검 (CI 포함) | 없음                                      | 트리의 `정상 · 빠짐 · 추가`, CLI `verify`                                             |
| 설치할 때 넣을 프로필 고르기·추천 | 없음                                      | 설치 후 알림, **프로필에 설치...**                                                    |
| 공통 변경을 모든 프로필에 반영    | 없음 (복사한 프로필은 원본과 연결이 끊김) | `core`·공통 `settings`를 고치고 적용                                                  |
| 폴더 → 프로필 추천                | 없음 (연결만 기억)                        | `match.files`                                                                         |

### 비슷한 도구

| 도구                                                                                | 방식                                                                | Profile Kit과 다른 점                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [VPEM](https://pypi.org/project/vscode-profile-extension-manager/)                  | Python CLI. 프로필의 확장 목록을 파일로 내보내고 적용               | 명령줄 전용. 설치 시 프로필 고르기, 누락 점검 화면이 없음         |
| [code-profiler](https://github.com/joaopalmeiro/code-profiler)                      | CLI. `.vscode` 폴더에서 프로필 파일을 만듦                          | 프로젝트 하나에서 시작. 여러 프로필을 같이 맞추거나 점검하지 않음 |
| artagon-vscode-profiles                                                             | dotfiles 저장소. 공유 기본 + 프로필별 덮어쓰기 + 내보내기 스크립트  | 구조는 비슷. 설치 시 프로필 고르기, 누락 점검, GUI가 없음         |
| [Profile Switcher](https://github.com/aaronpowell/vscode-profile-switcher) (보관됨) | 내장 프로필 이전의 확장. 설정 묶음을 바꾸고 확장을 설치·제거해 맞춤 | Profile Kit은 VS Code 내장 프로필을 쓰고, 확장을 제거하지 않음    |

### 프리셋

```jsonc
{
  "core": ["esbenp.prettier-vscode", "eamodio.gitlens"],
  "groups": { "python": ["ms-python.python", "charliermarsh.ruff"] },
  "settings": { "editor.formatOnSave": true },
  "profiles": {
    "Core": {},
    "Python": {
      "groups": ["python"],
      "settings": { "editor.tabSize": 4 },
      "match": { "languages": ["python"], "files": ["pyproject.toml", "*.ipynb"] },
    },
  },
}
```

- 각 프로필 = `core` + 고른 `groups` + `extensions`(그 프로필에만). `skipCore: true`로 core를 뺄 수 있습니다.
- `settings`는 모든 프로필 공통, `profiles.X.settings`가 그 위에 덮어씁니다.
- `match`는 추천에 씁니다. `languages`, `keywords`는 확장 추천, `files`는 폴더 추천에 씁니다.
- Default 프로필은 선언할 수 없습니다. 파일 이름을 `*.profile-kit.json`으로 하면 스키마 검사가 붙습니다. 전체 예: [`presets/example.json`](presets/example.json).

### 시작하기

1. Activity Bar의 Profile Kit을 엽니다.
2. **내장 프리셋으로 시작하기**(추천 프리셋이 맨 위), **프리셋 파일 열기**, **이 프로필로 프리셋 만들기** 중 하나를 누릅니다.
3. 툴바의 **모든 프로필에 프리셋 적용**으로 미리보기를 확인하고 적용합니다.

### 새 PC에서 같은 구성 만들기

1. 프리셋이 든 저장소를 clone합니다.
2. Profile Kit을 설치하고 **프리셋 파일 열기**로 clone한 프리셋을 고릅니다. 프리셋 경로는 PC마다 달라서 Settings Sync로 옮기지 않습니다.
3. **모든 프로필에 프리셋 적용**(또는 CLI `profile-kit apply <프리셋> --yes`)으로 프로필을 만들고 맞춥니다.

Settings Sync를 같이 쓰면 프로필 settings.json은 Sync가 옮깁니다. Profile Kit이 관리하는 키 목록(`profileKit.managedKeys`)도 같은 파일에 있어서 다른 PC에서도 Profile Kit이 쓴 키와 직접 넣은 키를 구분합니다.

Settings Sync와 같이 쓸 때:

- 프로필이 다른 PC로 가려면 Sync 설정에서 **Profiles**를 켜야 합니다(VS Code 기준 최대 20개).
- 두 번째 PC에서는 Sync가 끝난 뒤에 적용하세요. 미리보기에서 할 일이 없거나 빠진 확장만 나오면 정상입니다. Sync 도중에 적용하면 같은 파일을 Sync와 Profile Kit이 번갈아 고칠 수 있습니다.
- 한 PC에서 적용한 설정 변경은 Sync로 다른 PC에도 갑니다. 다른 PC에서 다시 적용할 필요는 없습니다.
- 이 PC에만 남는 것: 프리셋 경로(`profileKit.presetPath`), settings.json 백업, `machine` 범위 설정.
- 폴더 → 프로필 연결이 Sync로 옮겨지는지는 VS Code 문서에 없습니다. 다른 PC에서는 폴더를 열 때 나오는 추천으로 다시 연결하세요.

### 지원 범위

- 최신 stable VS Code를 기준으로 만들고 확인합니다. 최소 버전은 1.95입니다. Windows에서 직접 확인했고, Linux는 매주 도는 호환성 점검(CLI 동작만)으로 봅니다.
- VS Code에는 프로필을 만들거나 바꾸는 공개 API가 없어서, Profile Kit은 공개되지 않은 VS Code 동작 몇 가지(storage.json 형식, 프로필 폴더 위치, 프로필 전환 명령, `code` CLI 출력 문구 등)에 기댑니다. VS Code가 이것을 바꾸면 업데이트 뒤 일부 기능이 깨질 수 있습니다. 목록은 `src/core/compat.ts`에 있습니다.
- 문제를 알릴 때는 출력 창 **Profile Kit**의 첫 줄(VS Code 버전과 확인한 버전)을 같이 붙여 주세요.

### CLI

```sh
profile-kit plan   presets/example.json [--profile <이름>]          # 프로필마다 들어갈 확장 (VS Code 호출 없음)
profile-kit verify presets/example.json [--profile <이름>]          # 선언 vs 실제 설치 (읽기 전용, 빠지면 종료 코드 1)
profile-kit apply  presets/example.json [--profile <이름>] [--yes]  # 미리보기, --yes로 실행
profile-kit export presets/example.json [--profile <이름>] --out <폴더> [--offline]  # 프로필마다 .code-profile
```

## English

Profile Kit declares VS Code extensions once, as **core + per-purpose groups**, in one preset file. It then creates profiles from that preset, keeps them in line with it, and lets you switch between them.
Everything happens in VS Code's UI. The CLI is for setting up a new machine in one go, or for checks in CI.

- **Profiles tree** (Activity Bar): ok / missing / extra counts per profile, and where each extension comes from. The status bar shows this window's profile.
- **Pick profiles when installing**: after you install an extension the usual way, a notification offers to add it to other profiles, with suggested ones pre-checked. **Install to Profiles...** does the same for any extension ID. The preset file is updated, then the extension is installed.
- **Suggestions**: from the extension's languages, keywords and dependencies matched against each profile's `match`. Themes, keymaps and language packs go to core.
- **Manager**: an extensions × profiles matrix and a settings table (common and per-profile values). Preview, then apply.
- **Switching**: from the status bar, in place. When a folder's files match a profile's `match.files`, it is suggested once per folder.
- **Settings**: common `settings` plus `profiles.X.settings` are written to each profile's settings.json. Only keys Profile Kit wrote are managed; your own keys and comments stay, and files are backed up first.
  Keys in VS Code's **Apply Setting to all Profiles** list (`workbench.settings.applyToAllProfiles`) come from Default in every profile, so Profile Kit does not write them to profiles and says so in the preview when the preset wants a different value. Reload open windows after changing that list.
- **VS Code profile files (`.code-profile`)**: **Export Profiles as .code-profile...** writes one file per preset profile and opens VS Code's Profiles editor; drop a file on it or use New Profile > Import Profile. Import each as a **new** profile: importing into an existing profile makes VS Code uninstall the extensions the file does not list. **Import Profiles into Preset...** takes `.code-profile` files or VS Code's built-in templates (Python, Data Science, ...) into the preset as profiles (extensions and settings; not keybindings or snippets). **Create Preset from This Profile** can also add profiles from those templates.
- **Built-in starter presets**: with no preset yet, start from Python · Data, Web · JavaScript, Java, C · C++, C# · .NET, Go, Rust, Docker · Infra or All Languages. The one that fits the open folder's files, the open files' languages and this profile's extensions is recommended in the Profiles view and at the top of the list. It is saved as a file you edit from there.
- **Extensions applied to all profiles** in VS Code show up in every profile's list; the tree, the manager and CLI `verify` mark them "all profiles (VS Code)" instead of a plain "extra".
- **Settings Sync note**: when Sync has run on this PC, apply previews say the changes may also reach your other PCs (whether Sync is on is only in VS Code's internal database, which Profile Kit does not read).
- **Safety**: nothing is uninstalled, the Default profile is never changed, and VS Code's internal files are only read. Creating a profile opens a window, because VS Code has no other way to create one.

- **New PC**: clone the repository with your preset, open it with **Open Preset File...**, then apply. The preset path is per PC and is not synced; with Settings Sync on, the list of keys Profile Kit manages (`profileKit.managedKeys`) travels inside each profile's settings.json.
- **With Settings Sync**: turn on **Profiles** in Sync so profiles reach the other PC. On the second PC, apply after Sync has finished; the preview should then show nothing to do, or only missing extensions. Settings applied on one PC reach the others through Sync. What stays on each PC: the preset path, settings backups and `machine`-scoped settings.

**Compared with VS Code's built-in profiles**: Profile Kit does not rebuild what VS Code already has. It creates and switches profiles by calling VS Code, follows the **Apply Setting to all Profiles** list, and leaves syncing to Settings Sync. What VS Code does not have is Profile Kit's part: one file that declares the whole setup with history in Git, a check of declared vs installed (also in CI), picking profiles when installing, carrying a common change into every profile, and folder → profile suggestions.

**Similar tools**: [VPEM](https://pypi.org/project/vscode-profile-extension-manager/) (Python CLI that exports and applies a profile's extension list), [code-profiler](https://github.com/joaopalmeiro/code-profiler) (CLI that builds a profile file from a `.vscode` folder), artagon-vscode-profiles (dotfiles repository: shared base + per-profile overrides + export scripts) and [Profile Switcher](https://github.com/aaronpowell/vscode-profile-switcher) (archived; predates built-in profiles and installs/uninstalls extensions to switch). Profile Kit is an extension with a GUI, uses VS Code's own profiles, picks profiles when you install, checks for missing extensions, and never uninstalls.

CLI: `profile-kit plan | verify | apply <preset.json> [--profile <name>] [--yes]` (`apply` previews unless `--yes`), and `profile-kit export <preset.json> --out <dir>` for `.code-profile` files.

The UI is in English and Korean.

**Support**: built and checked against the latest stable VS Code (minimum 1.95). Checked by hand on Windows; a weekly compatibility run covers the CLI behavior on Linux. VS Code has no public API for creating or switching profiles, so Profile Kit relies on a few VS Code internals (the storage.json format, the profile folder, the profile switch command, the `code` CLI's output, the `.code-profile` format, the template list). A VS Code update that changes them can break parts of Profile Kit; the list is in `src/core/compat.ts`. When reporting a problem, include the first line of the **Profile Kit** output channel (VS Code version and the version the internals were checked on).

## Development

Node comes from the conda env in `environment.yml` (no system Node needed).

```sh
conda env create -f environment.yml
conda activate vscode-profile-kit
npm ci
npm run check     # typecheck + lint + format check + unit tests
npm run build     # dist/extension.js, dist/cli.js, dist/webview.js
npm run package   # VSIX
```

- `src/core/`: pure logic (preset, recommendations, settings, plans), unit-tested. `src/host/`: Node side (code CLI, files), shared by the CLI and the extension. `src/ui/`: the extension's GUI. `src/cli/`: the CLI.
- Try the extension against throwaway profiles with the launch config **Run Extension (isolated profiles)** (all data folders under `.vscode-test/`). Switching profiles in place does not work in an Extension Development Host; install the VSIX into an isolated VS Code for that (`docs/PLAN.md` section 8).
- UI strings go through `vscode.l10n.t`; Korean is in `l10n/bundle.l10n.ko.json` and `package.nls.ko.json`, and `test/l10n.test.ts` keeps them in step with the code.
- `scripts/legacy/` holds the original PowerShell scripts this project grew from (`docs/PLAN.md`).

## License

[MIT](LICENSE)
