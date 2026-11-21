# vscode-profile-kit — Claude Code 작업 메모

선언형 프리셋(core + groups + profiles) 하나로 VS Code 프로필을 만들고 점검하는 도구. 한국어로 답한다.
배경·결정·겪은 문제는 `docs/PLAN.md`, 단계와 게이트는 `docs/ROADMAP.md`(Phase 0~5).

## 진행 상태 (2026-11-21)

- 구조(2026-11-21 사용자 결정): **모든 기능은 GUI로 보인다.** 확장이 주 화면, `src/core`는 공유, CLI는 새 PC 일괄 적용·CI 점검용 보조.
  단계 M0~M7(승인된 계획): M0 실험(`docs/PLAN.md` 8절), M1 core, M2 host + CLI `apply`, M3 GUI(트리·상태 표시줄·전환·누락 설치·적용), M4(설치 후 알림·Install to Profiles·프리셋 갱신), M5(Webview 관리 화면: 확장 매트릭스·설정 표), M6(폴더 추천·전환 목록 추천), M7(문서·한국어 UI) 완료.
  Phase 5 준비(2026-11-21): 버전 0.1.0(pre-release), `.github/workflows/release.yml`(태그 `vX.Y.Z` push → 점검 → VSIX → `vsce publish --oidc`, environment `marketplace`), 절차 `docs/RELEASE.md`.
  시험 게시 끝(2026-11-21): 태그 `v0.1.0` → Marketplace `woogajjangka.vscode-profile-kit` 0.1.0 pre-release, public·validated.
  다음 계획(피드백 검토, 게시 목록 문제 R1~R6, SonarQube Cloud 도입, 단계 A~E)은 `docs/REVIEW-2026-11-21.md`. 범위는 좁히지 않는다(사용자 결정).
  남은 것: 프로필 설정 공유 문제(아래).
- 2026-11-21 실제 VS Code `apply` 미리보기: 할 일 없음. 다만 8개 프로필 모두 Default 설정을 공유해서(`useDefaultFlags.settings`)
  프리셋 설정과 마커 `profileKit.profile`을 쓸 수 없다. 그래서 현재 프로필은 폴더 연결로만 알 수 있다. 공유를 끌지는 사용자 결정.
- 설정은 프리셋 공통 `settings` + `profiles.X.settings`를 각 프로필 settings.json에 쓴다(도구가 쓴 키만 관리, 백업). 관리 키 목록은 각 settings.json의 `profileKit.managedKeys`(Sync로 같이 이동). 옛 `globalStorage/.../managed-settings.json`은 읽기만. UI에서 추가하면 프리셋도 고친다.
  Default의 `workbench.settings.applyToAllProfiles`에 있는 키는 프로필에 쓰지 않는다(VS Code가 Default 값을 쓰고 프로필 값은 무시, `docs/PLAN.md` 8-1절). 도구는 Default settings.json을 읽기만 한다.
  공유 문제의 결정(2026-11-21): 설정 공유를 끄고 공통 키는 이 목록으로 묶는다(추천안 C). 도구 수정은 PR #11로 main에 머지됨(2026-11-21), 실제 PC 전환은 아직.
- 라이선스 MIT 확정. GitHub `WoogaJJangka/vscode-profile-kit`(private). push·게시는 매번 사용자 승인.
- 있는 것: CLI `plan`, `verify`, `apply`(미리보기, `--yes`로 실행). GUI: Activity Bar 트리, 상태 표시줄, 전환, 누락 설치, 적용, 프리셋 열기/초안 만들기.
- **창을 여는 `code` 호출 주의**: 세 데이터 폴더가 실행 중인 VS Code와 모두 같아야 한다. 아니면 두 번째 VS Code가 기본 공유 데이터(로그인)로 뜬다.
  GUI 시험은 VSIX를 격리 VS Code에 설치하거나 launch.json "Run Extension (isolated profiles)"로 한다(PLAN.md 8절 #8).
- Phase 0/1 확인 끝(2026-11-21): Default 80개(원본 백업 79개 + gradle), Settings Sync 켜짐. `repair-extensions.ps1` Default 단계는 앞으로 쓰지 않는다(사용자 결정).
  `share-settings.ps1`은 05:58에 이미 실행됨(`backup-20261121-055822`), 8개 프로필 모두 Default 설정 공유 + `window.newWindowProfile=Core`.
  Default 정리: 사용자 요청으로 Core에 없는 53개를 Default에서만 uninstall(2026-11-21, uninstall 금지 규칙의 1회 예외). 지금 Default = Core 27개.
  되돌리기 기준은 `Documents/vscode-profiles-setup/extensions-backup-20261121-104351-before-core-match.txt`(80개).
  실제 사용자 VS Code에 `apply --yes`는 사용자 확인 후.
- 2026-11-21 `verify` 결과(이 PC, 06:02 repair 이후): 8개 프로필 모두 빠진 것 없음. 추가분은 의존성(Java `vscjava.vscode-gradle`, Web-JS `silvenon.mdx`).

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
| 단위 테스트 + 커버리지 (Sonar CI용)          | `npm run test:coverage`                                                                                              |
| CLI                                          | `node dist/cli.js plan presets/example.json` / `verify ... [--profile X]`                                            |
| CLI apply (격리 VS Code로 시험)              | `node dist/cli.js apply <preset> --user-data-dir <tmp>/u --extensions-dir <tmp>/x --shared-data-dir <tmp>/s [--yes]` |
| VSIX                                         | `npm run package`                                                                                                    |

## 구조

- `src/core/` 순수 로직(VS Code API·fs 없음): `preset.ts`(검증·해석), `diff.ts`, `retry.ts`, `codeCli.ts`(출력 분류·인자·실행기),
  `recommend.ts`, `settings.ts`, `presetEdit.ts`, `profiles.ts`(storage.json 읽기), `workspace.ts`, `applyPlan.ts`(apply 계획·마커 `profileKit.profile`).
- `src/host/` Node 전용(fs, child_process): `paths.ts`, `codeLocator.ts`, `installer.ts`, `settingsWriter.ts`, `apply.ts`(계획 수집·실행).
  CLI(`src/cli/`)와 확장(`src/extension.ts`)이 같이 쓴다. 테스트는 `test/*.test.ts`(vitest), host는 임시 폴더 + 가짜 code 실행기로 시험한다.
- 현재 프로필은 각 프로필 settings.json의 마커 `profileKit.profile`로 안다(`globalStorageUri`는 프로필마다 같다, PLAN.md 8절).
- UI 문구는 `vscode.l10n.t`(웹뷰는 `WEBVIEW_STRINGS`)로 쓰고, 한국어는 `l10n/bundle.l10n.ko.json`·`package.nls.ko.json`에 넣는다. `test/l10n.test.ts`가 빠지거나 남은 문구, 자리표시자(`{0}`) 불일치를 잡는다.
- 프리셋 검사 규칙을 바꾸면 `schema/preset.schema.json`도 같이 고친다. `presets/example.json`은 `scripts/legacy/vscode-profiles-setup.ps1`의
  `$core`/`$sets`와 같고, `preset.test.ts`가 프로필별 개수(Core 27 … Docker-Infra 31)를 지킨다.
- 성공 판정은 종료 코드가 아니라 출력 파싱(`classifyInstallOutput`). 재시도는 네트워크 오류(`getaddrinfo ENOTFOUND`, VSIX 다운로드 중단 `(Error: aborted)` 등)만.
  분류 예시는 실제 로그(`Documents/vscode-profiles-setup/install-log-*.txt`)에서 가져왔다.
- Windows에서 `code`는 `code.cmd`라 셸로 띄운다. 명령 이름 `code`를 따옴표로 감싸면 `%~dp0`가 현재 폴더가 되어 실패한다(`codeCli.ts` 주석). 시간 초과 시 셸만 죽이면 `Code.exe`가 남아 호출이 안 끝나므로 `taskkill /T /F`로 트리째 끝낸다.
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
- GitHub 저장소 설정(2026-11-21): ruleset `main: CI must pass`가 main에 CI 체크 `ubuntu-latest`·`windows-latest`·`macos-latest`를 필수로 한다(예외 없음).
  그래서 main에 직접 push할 수 없고 브랜치 + PR로만 머지한다. auto-merge 허용, 머지된 PR 브랜치는 원격에서 자동 삭제(로컬은 `git branch -d`), 로컬 `fetch.prune=true`.
  `ci.yml`의 job 이름(matrix `os`)을 바꾸면 ruleset의 체크 이름도 같이 바꾼다. 안 바꾸면 PR이 머지되지 않는다.
- SonarQube Cloud(조직 `woogajjangka`, 프로젝트 `WoogaJJangka_vscode-profile-kit`): `sonar.yml` CI 분석 + 커버리지(`npm run test:coverage` → `coverage/lcov.info`) + 품질 게이트.
  secret `SONAR_TOKEN`이 있을 때만 돈다. Automatic Analysis는 꺼 둔다(켜면 CI 스캔 실패). 설정은 `.sonarcloud.properties`(CI가 `sonar-project.properties`로 복사).
  프로젝트 생성·토큰 등록은 사용자가 직접. 결과는 SonarQube MCP로 읽는다.
