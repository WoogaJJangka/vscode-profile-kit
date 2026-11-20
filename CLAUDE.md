# vscode-profile-kit — Claude Code 작업 메모

선언형 프리셋(core + groups + profiles) 하나로 VS Code 프로필을 만들고 점검하는 도구. 한국어로 답한다.
배경·결정·겪은 문제는 `docs/PLAN.md`, 단계와 게이트는 `docs/ROADMAP.md`(Phase 0~5).

## 진행 상태 (2026-11-21)

- 구조(2026-11-21 사용자 결정): **모든 기능은 GUI로 보인다.** 확장이 주 화면, `src/core`는 공유, CLI는 새 PC 일괄 적용·CI 점검용 보조.
  단계 M0~M7(승인된 계획): M0 실험(`docs/PLAN.md` 8절), M1 core, M2 host + CLI `apply`, M3 GUI(트리·상태 표시줄·전환·누락 설치·적용) 완료.
  다음은 M4(설치 후 알림·Install to Profiles), M5(Webview 관리 화면), M6(폴더 추천), M7(문서·한국어 l10n).
- 설정은 프리셋 공통 `settings` + `profiles.X.settings`를 각 프로필 settings.json에 쓴다(도구가 쓴 키만 관리, 백업). UI에서 추가하면 프리셋도 고친다.
- 라이선스 MIT 확정. GitHub `WoogaJJangka/vscode-profile-kit`(private). push·게시는 매번 사용자 승인.
- 있는 것: CLI `plan`, `verify`, `apply`(미리보기, `--yes`로 실행). GUI: Activity Bar 트리, 상태 표시줄, 전환, 누락 설치, 적용, 프리셋 열기/초안 만들기.
- **창을 여는 `code` 호출 주의**: 세 데이터 폴더가 실행 중인 VS Code와 모두 같아야 한다. 아니면 두 번째 VS Code가 기본 공유 데이터(로그인)로 뜬다.
  GUI 시험은 VSIX를 격리 VS Code에 설치하거나 launch.json "Run Extension (isolated profiles)"로 한다(PLAN.md 8절 #8).
- 아직 안 한 게이트: Phase 0/1(Default 상태 확인, `repair-extensions.ps1` Default 단계 여부, `share-settings.ps1` DryRun). 실제 사용자 VS Code에 `apply --yes`는 사용자 확인 후.
- 2026-11-21 `verify` 결과(이 PC): Core·Python-Data·Web-JS·CSharp-Unity 완료, Java 5·C-Cpp 4·Go 1·Docker-Infra 29개 빠짐.

## 환경 (Node는 conda env)

- conda env `vscode-profile-kit` = Node 24 (`environment.yml`). 이 PC에는 시스템 Node가 없다.
  새 PC: `conda env create -f environment.yml`, 바뀌면 `conda env update -f environment.yml --prune`.
- 프로필 없이 도는 셸(Claude Code)에서는 env를 PATH 앞에 붙인다:
  - Git Bash: `E=~/miniconda3/envs/vscode-profile-kit; export PATH="$E:$PATH"`
  - PowerShell: `conda run -n vscode-profile-kit --no-capture-output npm test`
- 패키지 매니저는 npm(`package-lock.json`, CI는 `npm ci`).

## 명령

| 목적                                         | 명령                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 전부 점검 (typecheck + lint + format + test) | `npm run check`                                                                                                      |
| 빌드 (`dist/extension.js`, `dist/cli.js`)    | `npm run build` (`watch`, `build:prod`)                                                                              |
| 단위 테스트                                  | `npm test`                                                                                                           |
| CLI                                          | `node dist/cli.js plan presets/example.json` / `verify ... [--profile X]`                                            |
| CLI apply (격리 VS Code로 시험)              | `node dist/cli.js apply <preset> --user-data-dir <tmp>/u --extensions-dir <tmp>/x --shared-data-dir <tmp>/s [--yes]` |
| VSIX                                         | `npm run package`                                                                                                    |

## 구조

- `src/core/` 순수 로직(VS Code API·fs 없음): `preset.ts`(검증·해석), `diff.ts`, `retry.ts`, `codeCli.ts`(출력 분류·인자·실행기),
  `recommend.ts`, `settings.ts`, `presetEdit.ts`, `profiles.ts`(storage.json 읽기), `workspace.ts`, `applyPlan.ts`(apply 계획·마커 `profileKit.profile`).
- `src/host/` Node 전용(fs, child_process): `paths.ts`, `codeLocator.ts`, `installer.ts`, `settingsWriter.ts`, `apply.ts`(계획 수집·실행).
  CLI(`src/cli/`)와 확장(`src/extension.ts`)이 같이 쓴다. 테스트는 `test/*.test.ts`(vitest), host는 임시 폴더 + 가짜 code 실행기로 시험한다.
- 현재 프로필은 각 프로필 settings.json의 마커 `profileKit.profile`로 안다(`globalStorageUri`는 프로필마다 같다, PLAN.md 8절).
- 프리셋 검사 규칙을 바꾸면 `schema/preset.schema.json`도 같이 고친다. `presets/example.json`은 `scripts/legacy/vscode-profiles-setup.ps1`의
  `$core`/`$sets`와 같고, `preset.test.ts`가 프로필별 개수(Core 27 … Docker-Infra 31)를 지킨다.
- 성공 판정은 종료 코드가 아니라 출력 파싱(`classifyInstallOutput`). 재시도는 네트워크 오류(`getaddrinfo ENOTFOUND` 등)만.
  분류 예시는 실제 로그(`Documents/vscode-profiles-setup/install-log-*.txt`)에서 가져왔다.
- Windows에서 `code`는 `code.cmd`라 셸로 띄운다. 명령 이름 `code`를 따옴표로 감싸면 `%~dp0`가 현재 폴더가 되어 실패한다(`codeCli.ts` 주석).
  프로필 이름은 따옴표만으로 안전하도록 `[A-Za-z0-9 ._-]`로 제한.
- 엔진 하한 `^1.95.0`(VS Code 1.95의 Node는 20 → esbuild `target: node20`, Node 22 전용 API 쓰지 않음).
  `@types/node`는 vitest 5의 peer 때문에 22.
- `scripts/legacy/`는 원본 PowerShell 스크립트(lint·format 제외). 로그·백업 출력은 `.gitignore`로 막는다.

## 규칙 (ROADMAP "규칙"에서)

- 사용자 확장은 uninstall하지 않는다. Default 프로필 변경, `storage.json`/`state.vscdb` 직접 편집, push, 게시는 사전 확인.
- 실제 VS Code를 건드리는 실험은 격리 프로필로: `code --user-data-dir <tmp>/u --extensions-dir <tmp>/x --shared-data-dir <tmp>/s ...`
  (`--shared-data-dir`를 빼면 사용자 GitHub 로그인이 풀린다 — a-file-icon-vscode CLAUDE.md "확인 방법").
- 커밋 전 `git status`/`git diff`로 개인 경로·계정 정보가 없는지 본다. conventional commits.
- 게시 인증은 PAT가 아니라 GitHub Actions Trusted Publishing(OIDC). publisher·토큰·로그인·`publish`는 사용자가 직접.

## git

- remote `origin` = `WoogaJJangka/vscode-profile-kit`. 작업 브랜치는 같은 이름의 origin 브랜치를 추적(`git push -u origin <branch>`).
- `.vscode/{launch,tasks,extensions}.json`은 확장 실행에 쓰여 예외로 커밋. `.idea/`·`.vscode/settings.json`은 추적하지 않는다.
- Actions `uses:`는 커밋 SHA + 버전 주석, 기본 `permissions: contents: read`.
