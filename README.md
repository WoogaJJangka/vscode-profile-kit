# Profile Kit

> Preview. Not published yet.

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

### 안전 규칙

- 확장을 **제거하지 않습니다.** 프리셋에서 빼도 설치된 확장은 남고, 트리에 "추가"로 보입니다.
- **Default 프로필은 바꾸지 않습니다.** VS Code 내부 파일(storage.json, state.vscdb)은 읽기만 합니다.
- 바꾸는 작업은 모두 미리보기 → 확인 순서로 합니다.
- 프로필은 VS Code가 창을 열어야만 만들어지므로, 새 프로필을 만들 때는 새 창이 열립니다.

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
2. **프리셋 파일 열기** 또는 **이 프로필로 프리셋 만들기**를 누릅니다.
3. 툴바의 **모든 프로필에 프리셋 적용**으로 미리보기를 확인하고 적용합니다.

### CLI

```sh
profile-kit plan   presets/example.json [--profile <이름>]          # 프로필마다 들어갈 확장 (VS Code 호출 없음)
profile-kit verify presets/example.json [--profile <이름>]          # 선언 vs 실제 설치 (읽기 전용, 빠지면 종료 코드 1)
profile-kit apply  presets/example.json [--profile <이름>] [--yes]  # 미리보기, --yes로 실행
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
- **Safety**: nothing is uninstalled, the Default profile is never changed, and VS Code's internal files are only read. Creating a profile opens a window, because VS Code has no other way to create one.

CLI: `profile-kit plan | verify | apply <preset.json> [--profile <name>] [--yes]` (`apply` previews unless `--yes`).

The UI is in English and Korean.

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
