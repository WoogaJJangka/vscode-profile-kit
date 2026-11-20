# Profile Kit

> Preview. Not published yet.

[한국어](#한국어) · [English](#english)

## 한국어

VS Code 확장을 **공통(core) + 용도별 그룹**으로 한 파일에 선언하고, 그 선언으로 프로필을 만들고 점검하는 도구입니다.
VS Code 확장 API는 프로필 기능을 열어 주지 않아서, 실제 작업은 `code` CLI를 부르는 Node CLI가 하고 확장은 그 위의 얇은 UI입니다.

### 프리셋

```json
{
  "$schema": "./schema/preset.schema.json",
  "core": ["esbenp.prettier-vscode", "eamodio.gitlens"],
  "groups": { "python": ["ms-python.python", "charliermarsh.ruff"] },
  "profiles": {
    "Core": {},
    "Python": { "groups": ["python"], "shareFromDefault": { "settings": true } }
  }
}
```

- 각 프로필 = `core` + 고른 `groups` + `extensions`(그 프로필에만). `skipCore: true`로 core를 뺄 수 있습니다.
- Default 프로필은 선언할 수 없습니다. 도구는 기본 동작으로 Default를 바꾸지 않습니다.
- 전체 예: [`presets/example.json`](presets/example.json). 파일 이름을 `*.profile-kit.json`으로 하면 확장이 스키마 검사를 붙입니다.

### CLI

```sh
profile-kit plan   presets/example.json [--profile <이름>]   # 프로필마다 들어갈 확장 (VS Code 호출 없음)
profile-kit verify presets/example.json [--profile <이름>]   # 선언 vs 실제 설치 (code --list-extensions, 읽기 전용)
```

`verify`는 빠진 확장이 있으면 종료 코드 1입니다. `apply`(프로필 생성 + 설치), `export`, `open`은 개발 중입니다.

## English

Declare VS Code extensions once as **core + per-purpose groups**, then create and check profiles from that preset.
The VS Code extension API exposes no profile features, so the work is done by a Node CLI that calls the `code` CLI;
the extension is a thin UI on top.

- `profile-kit plan <preset.json>`: the extensions each profile should have (no VS Code calls).
- `profile-kit verify <preset.json>`: declared vs installed per profile, read-only; exit code 1 when something is missing.
- The Default profile cannot be declared and is never changed by default.

## Development

Node comes from the conda env in `environment.yml` (no system Node needed).

```sh
conda env create -f environment.yml
conda activate vscode-profile-kit
npm ci
npm run check     # typecheck + lint + format check + unit tests
npm run build     # dist/extension.js + dist/cli.js
npm run package   # VSIX
```

`scripts/legacy/` holds the original PowerShell scripts this project grew from (`docs/PLAN.md`).

## License

[MIT](LICENSE)
