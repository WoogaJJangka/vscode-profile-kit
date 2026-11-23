# vscode-profile-kit — Claude Code 작업 메모

선언형 프리셋(core + groups + profiles) 하나로 VS Code 프로필을 만들고 점검하는 도구. 한국어로 답한다.
배경·결정·겪은 문제는 `docs/PLAN.md`, 단계와 게이트는 `docs/ROADMAP.md`(Phase 0~5).

## 진행 상태 (2026-11-23)

- 구조(2026-11-21 사용자 결정): **모든 기능은 GUI로 보인다.** 확장이 주 화면, `src/core`는 공유, CLI는 새 PC 일괄 적용·CI 점검용 보조.
  단계 M0~M7(승인된 계획): M0 실험(`docs/PLAN.md` 8절), M1 core, M2 host + CLI `apply`, M3 GUI(트리·상태 표시줄·전환·누락 설치·적용), M4(설치 후 알림·Install to Profiles·프리셋 갱신), M5(Webview 관리 화면: 확장 매트릭스·설정 표), M6(폴더 추천·전환 목록 추천), M7(문서·한국어 UI) 완료.
  Phase 5 준비(2026-11-21): 버전 0.1.0(pre-release), `.github/workflows/release.yml`(태그 `vX.Y.Z` push → 점검 → VSIX → `vsce publish --oidc`, environment `marketplace`), 절차 `docs/RELEASE.md`.
  시험 게시 끝(2026-11-21): 태그 `v0.1.0` → Marketplace `woogajjangka.vscode-profile-kit` 0.1.0 pre-release, public·validated.
  단계 E 게시(2026-11-21): PR #19(version 0.3.0, CHANGELOG) → 태그 `v0.3.0` → Release 성공, Marketplace 0.3.0 pre-release. minor 홀수 = pre-release, 짝수 = 정식(0.2.0은 건너뜀, 사용자 결정).
  내장 프리셋과 추천 머지(PR #21): 내장 프리셋 9개(`src/core/starters.ts`), 환영 화면 추천, "Start from a Built-in Preset...". 격리 VS Code에서 확인.
  0.5.0 게시(2026-11-21): PR #22(version 0.5.0, CHANGELOG) → 태그 `v0.5.0` → Release 성공("Published ... v0.5.0"), Marketplace 0.5.0 pre-release(0.4.0은 건너뜀).
  다음 계획(피드백 검토, 게시 목록 문제 R1~R6, SonarQube Cloud 도입, 단계 A~E)은 `docs/REVIEW-2026-11-21.md`. 범위는 좁히지 않는다(사용자 결정).
  단계 A(코드)·B·D 머지됨(PR #14·#16·#17). 단계 C(`.code-profile` 내보내기·가져오기, 내장 템플릿, "모든 프로필에 적용" 표시, Sync 문구) 머지됨(PR #18), `docs/PLAN.md` 8-2절.
  1.0.0 정식(2026-11-21, 사용자 결정): 보안 점검(Windows `code.cmd` 인자 `"`·`%`·줄바꿈 거부, 끝 `\` 이중화, 관리 화면 ID 검사,
  vsce의 minimatch를 overrides로 11.0.9) + version 1.0.0, `preview` 제거. Sonar S8707(settingsWriter, CLI 인자 경로) 3건은
  `paths.ts`가 location을 이미 검사하고 CLI 인자는 사용자 본인 입력이라 코드 수정 없음.
  1.0.0 게시(2026-11-21): PR #24(위 내용 + Sonar S8786 백트래킹 정규식 수정) → 태그 `v1.0.0` → Release 성공("Published ... v1.0.0"),
  `--pre-release` 없이 정식. Marketplace 1.0.0 validated·public, pre-release 아님, Preview 표시 없음(게시 약 6분 뒤 반영, 11:37 UTC).
  1.1.0 게시(2026-11-22, 목표 "VS Code 안에서 쉽게"): PR #35 → 태그 `v1.1.0` → Release 성공("Published ... v1.1.0", `--pre-release`),
  Marketplace 1.1.0 validated·pre-release(게시 약 5분 뒤 반영, 01:18 UTC). 정식 1.0.0을 쓰는 설치는 "Switch to Pre-Release Version"을 눌러야 1.1.0을 받는다.
  내용: 상태 표시줄 → 메뉴(프로필 전환 + 지금 할 수 있는 작업), 트리 맨 위 "다음 할 일" 줄 + Activity Bar 배지,
  Get Started 안내(walkthrough 4단계, `media/walkthrough/*.svg`), 설치 시 "어디에 기록" 질문 없앰, 툴바 버튼 3개, 팔레트 정리, 새 프리셋 기본 위치(열린 폴더 또는 홈). 결정과 이유는 `docs/PLAN.md` 11절.
  `npm run check` 통과(테스트 274개). 격리 VS Code 1.147에서 화면 확인 끝(`docs/PLAN.md` 11절). 설치 후 프로필 고르기 흐름만 화면으로 보지 않았다.
  1.3.0 게시(2026-11-22, 사용자 결정 pre-release, 1.2.0은 건너뜀): PR #37(설정에 저장하는 프리셋 `profileKit.preset`, Sync됨, `docs/PLAN.md` 12절) + PR #38(version, CHANGELOG)
  → 태그 `v1.3.0` → Release 성공("Published ... v1.3.0", `--pre-release`). 테스트 286개. Sonar S8707(`presetLoader.ts`, CLI 인자 경로) 1건은 같은 이유로 accept.
  1.3.1 게시(2026-11-23, 사용자 결정 pre-release): PR #40(extra에 이유 표시 `src/core/dependencies.ts`, Profile Kit 자기 자신은 extra 아님, 예제 web-js에서 `xyc.vscode-mdx-preview` 제거, `docs/PLAN.md` 13절) +
  PR #41(apply 계획도 Profile Kit 제외) + PR #42(version, CHANGELOG) → 태그 `v1.3.1`(Claude가 push, 사용자 결정) → Release 성공("Published ... v1.3.1", `--pre-release`)
  → Marketplace 1.3.1 validated·pre-release(게시 약 4분 뒤 반영, 01:11 UTC). 테스트 298개. Sonar S8707(`builtins.ts` 확장 폴더 목록, CLI 인자 경로) 1건 accept. 이슈 #25 닫음(남은 선택 항목: deprecated 경고, VS Code 내장 Java 템플릿 2개에 설치 금지 IntelliCode 확장).
  첫 번째 PC 개인 프리셋(같은 날, 사용자 승인): web-js에서 `xyc.vscode-mdx-preview`를 빼고 `ggfincke.vsc-mdx-preview`(Modern MDX Preview, 후속작, 의존성 `unifiedjs.vscode-mdx`뿐)를 넣음.
  Web-JS에서 옛 것 uninstall(팩 멤버 `silvenon.mdx`도 CLI가 같이 지움) → `apply --profile Web-JS --yes`로 새 것 설치. 백업 `Documents/vscode-profiles-setup/*-20261123-*`. 두 번째 PC는 아직.
  첫 번째 PC: 개인 프리셋 `~/vscode-profiles.json`(example 8개 + CTF 42개)을 Default settings.json `profileKit.preset`에도 넣었다
  (백업 `Documents/vscode-profiles-setup/settings-backup-20261122-131725-before-synced-preset.json`). `presetPath`는 1.1.0용으로 남김. 두 PC 사이 실제 Sync는 아직 확인하지 않았다.
  walkthrough SVG는 `<style>`·class 없이 `fill="var(--vscode-…, #기본값)"` 속성으로만 색을 쓴다(Welcome 화면 CSP가 인라인 스타일을 막아 전부 검게 나옴, `manifest.test.ts`가 지킴).
  두 번째 PC 확인 끝(2026-11-22): Sync 뒤 `apply` 미리보기에 설정 변경·"[overrides your value]" 없음(확장 설치 예정 1개만). `docs/REVIEW-2026-11-21.md` 단계 A.
  주의: 새 PC 첫 Sync에서 Default 설정 충돌이 나면 그 PC 내용이 원격을 덮어 `applyToAllProfiles`가 빠질 수 있다. Default에 목록이 있는지 먼저 보고 확인한다.
  실제로 11-21 23:12 충돌 뒤 첫 번째 PC의 Default도 두 번째 PC 내용으로 바뀌었다. 2026-11-22에 Sync가 남긴 로컬 백업 `User/sync/settings/20261121T231302.json`(충돌 직전)으로
  되돌리고(백업 `Documents/vscode-profiles-setup/backup-20261122-080613-before-sync-restore`), 그 뒤 생긴 gitlens 키 3개는 남김, 사용자 승인.
  PC마다 다른 `python.defaultInterpreterPath`·`python.condaPath`·`snyk.trustedFolders`는 `settingsSync.ignoredSettings`로 Sync에서 뺐다. 되돌릴 때는 Sync의 로컬 백업을 먼저 본다.
  Cool Theme Kit 확장 ID는 `woogajjangka.cool-theme-kit`(PR #32, 옛 `cool-icon-vscode`는 Marketplace에 없음). 첫 번째 PC는 2026-11-22에 바꿈(사용자 요청, uninstall 금지 규칙의 예외):
  `apply --yes`로 8개 프로필에 새 것 설치 → Default·8개 프로필에서 옛 것 uninstall. 테마·아이콘 ID가 같아 설정은 그대로, `verify` 8개 모두 빠진 것 없음.
  되돌리기 기준 `Documents/vscode-profiles-setup/extensions-backup-20261122-082400-before-cool-theme-kit.txt`. 두 번째 PC는 아직(옛 것이 남은 프로필에 새 것만 넣으면 같은 테마 ID가 둘).
  Material Icon Theme(`pkief.material-icon-theme`)은 Cool Theme Kit의 아이콘 섞기 층(`a-file-icon-vscode.iconThemeLayers`)이라 Core에 넣었다(2026-11-22, Core 28개).
  첫 번째 PC는 같은 날 Default·8개 프로필에 `code --install-extension`으로 설치함. 두 번째 PC는 아직(`apply --yes`로 설치).
  저장소 public 전환(R2)은 당분간 하지 않는다(2026-11-21 사용자 결정, 아래 "git"). 실제 창 상태 표시줄은 8개 프로필 모두 마커로 맞게 나옴(2026-11-21, 사용자 확인).
- 실제 PC 설정 공유 끄기 끝(2026-11-21): 백업 `Documents/vscode-profiles-setup/backup-20261121-211455-before-unshare`(Default·8개 프로필 settings.json, storage.json)
  → Default settings.json에 `workbench.settings.applyToAllProfiles` = Default 키 55개 전부(언어 블록 제외, 사용자 승인) → 사용자가 Profiles 편집기에서 8개 프로필의 Settings 공유를 끔
  (VS Code는 프로필 settings.json을 그대로 둠, 11-20 옛 사본) → `apply --yes`로 8개 프로필에 마커, Web-JS에 `[html]`. 다시 돌린 미리보기 "Nothing to do".
  `[html]`은 목록으로 묶을 수 없어 프리셋 공통 `settings`에 넣었다. 프로필 창에서 목록에 없는 새 설정을 바꾸면 그 프로필에만 저장된다.
- 프리셋 출처(2026-11-22, `docs/PLAN.md` 12절): 설정 `profileKit.preset`(application 범위, Sync됨)이 있으면 그것, 없으면 `profileKit.presetPath` 파일(Sync 안 됨).
  확장은 `profile-kit:/synced.profile-kit.json` 가상 파일(`src/ui/syncedPreset.ts`)로 읽고 쓴다. CLI는 프리셋 인자를 빼면 Default settings.json에서 같은 순서로 읽는다.
- 설정은 프리셋 공통 `settings` + `profiles.X.settings`를 각 프로필 settings.json에 쓴다(도구가 쓴 키만 관리, 백업). 관리 키 목록은 각 settings.json의 `profileKit.managedKeys`(Sync로 같이 이동). 옛 `globalStorage/.../managed-settings.json`은 읽기만. UI에서 추가하면 프리셋도 고친다.
  Default의 `workbench.settings.applyToAllProfiles`에 있는 키는 프로필에 쓰지 않는다(VS Code가 Default 값을 쓰고 프로필 값은 무시, `docs/PLAN.md` 8-1절). 도구는 Default settings.json을 읽기만 한다.
  공유 문제의 결정(2026-11-21): 설정 공유를 끄고 공통 키는 이 목록으로 묶는다(추천안 C). 도구 수정은 PR #11로 main에 머지됨(2026-11-21), 실제 PC 전환도 끝(위).
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

| 목적                                         | 명령                                                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 전부 점검 (typecheck + lint + format + test) | `npm run check`                                                                                                                                           |
| 빌드 (`dist/extension.js`, `dist/cli.js`)    | `npm run build` (`watch`, `build:prod`)                                                                                                                   |
| 단위 테스트                                  | `npm test`                                                                                                                                                |
| 단위 테스트 + 커버리지 (Sonar CI용)          | `npm run test:coverage`                                                                                                                                   |
| CLI                                          | `node dist/cli.js plan presets/example.json` / `verify ... [--profile X]`                                                                                 |
| CLI apply (격리 VS Code로 시험)              | `node dist/cli.js apply <preset> --user-data-dir <tmp>/u --extensions-dir <tmp>/x --shared-data-dir <tmp>/s [--yes]`                                      |
| 호환성 점검 (실제 VS Code, 격리 폴더)        | `npm run build:compat` → `node out/compat.js --code <bin/code> --app-root <resources/app> --data <빈 폴더>` (창이 하나 열림, 끝나면 그 프로세스만 닫는다) |
| VSIX                                         | `npm run package`                                                                                                                                         |

## 구조

- `src/core/` 순수 로직(VS Code API·fs 없음): `preset.ts`(검증·해석), `diff.ts`, `retry.ts`, `codeCli.ts`(출력 분류·인자·실행기),
  `recommend.ts`, `settings.ts`, `presetEdit.ts`, `profiles.ts`(storage.json 읽기), `workspace.ts`, `applyPlan.ts`(apply 계획·마커 `profileKit.profile`),
  `codeProfile.ts`(`.code-profile` ↔ 프리셋), `templates.ts`, `starters.ts`(내장 프리셋 9개와 추천: 설치된 확장·폴더 파일·열린 파일 언어), `status.ts`(선언한 프로필의 상태 요약: 트리 맨 위 줄·배지·메뉴), `extensionsJson.ts`(모든 프로필에 적용된 확장, 읽기만),
  `presetSource.ts`(프리셋 출처: 설정 → 파일, 설정 값 ↔ 텍스트), `dependencies.ts`(extra의 이유: 같은 프로필의 다른 확장이 의존·팩으로 끌어온 것, 자기 ID `PROFILE_KIT_ID`는 extra 아님, `docs/PLAN.md` 13절),
  `compat.ts`(공개 API가 아닌 VS Code 동작 11가지와 확인한 버전. 저장소 키·전환 명령·CLI 문구는 여기 상수만 쓴다, `docs/PLAN.md` 10절).
- `src/host/` Node 전용(fs, child_process): `paths.ts`, `codeLocator.ts`, `installer.ts`, `settingsWriter.ts`, `apply.ts`(계획 수집·실행), `builtins.ts`(extensions.json·설치된 확장 폴더의 package.json·product.json·Sync 폴더 읽기, 템플릿 받기, `.code-profile` 쓰기).
  CLI(`src/cli/`)와 확장(`src/extension.ts`)이 같이 쓴다. 테스트는 `test/*.test.ts`(vitest), host는 임시 폴더 + 가짜 code 실행기로 시험한다.
- 현재 프로필은 각 프로필 settings.json의 마커 `profileKit.profile`로 안다(`globalStorageUri`는 프로필마다 같다, PLAN.md 8절).
- UI 문구는 `vscode.l10n.t`(웹뷰는 `WEBVIEW_STRINGS`)로 쓰고, 한국어는 `l10n/bundle.l10n.ko.json`·`package.nls.ko.json`에 넣는다. `test/l10n.test.ts`가 빠지거나 남은 문구, 자리표시자(`{0}`) 불일치를 잡는다.
- 프리셋 검사 규칙을 바꾸면 `schema/preset.schema.json`도 같이 고친다. `presets/example.json`은 `scripts/legacy/vscode-profiles-setup.ps1`의
  `$core`/`$sets`와 같고, `preset.test.ts`가 프로필별 개수(Core 28 … Docker-Infra 32)를 지킨다.
- 성공 판정은 종료 코드가 아니라 출력 파싱(`classifyInstallOutput`), 판단이 안 되면 `--list-extensions`로 확인. 설치는 10개씩 한 호출로 묶고 목록에 없는 것만 하나씩 재시도. 재시도는 네트워크 오류(`getaddrinfo ENOTFOUND`, VSIX 다운로드 중단 `(Error: aborted)` 등)만.
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
- GitHub 저장소 설정(2026-11-21): ruleset `main: CI must pass`가 main에 CI 체크 `ubuntu-latest`·`windows-latest`·`macos-latest`와 SonarQube `Analysis + quality gate`(2026-11-21 추가)를 필수로 한다(예외 없음).
  그래서 main에 직접 push할 수 없고 브랜치 + PR로만 머지한다. auto-merge 허용, 머지된 PR 브랜치는 원격에서 자동 삭제(로컬은 `git branch -d`), 로컬 `fetch.prune=true`.
  `ci.yml`의 job 이름(matrix `os`)이나 `sonar.yml`의 job 이름을 바꾸면 ruleset의 체크 이름도 같이 바꾼다. 안 바꾸면 PR이 머지되지 않는다.
- environment `marketplace`는 태그 `v*`에서만 배포할 수 있다(deployment policy, 2026-11-21). release.yml의 태그 형식을 바꾸면 이것도 바꾼다.
- 커밋 작성자는 저장소 로컬 설정으로 GitHub noreply 메일을 쓴다(2026-11-21). 그 전 커밋 51개는 개인 메일이고, PR 28개의 읽기 전용 참조
  `refs/pull/N/head`에도 남아 있어 force-push로 지울 수 없다. 그래서 public 전환(R2)은 보류했다. 다시 정할 때 방법은 새 public 저장소로
  옮기기(작성자 고친 기록, ruleset·secret·environment·SonarQube·Trusted Publishing 다시 연결) 또는 기록을 다시 쓰고 GitHub Support에 PR 참조 삭제 요청.
- SonarQube Cloud(조직 `woogajjangka`, 프로젝트 `WoogaJJangka_vscode-profile-kit`): `sonar.yml` CI 분석 + 커버리지(`npm run test:coverage` → `coverage/lcov.info`) + 품질 게이트.
  secret `SONAR_TOKEN`이 있을 때만 돈다. Automatic Analysis는 꺼 둔다(켜면 CI 스캔 실패). 설정은 `.sonarcloud.properties`(CI가 `sonar-project.properties`로 복사).
  프로젝트 생성·토큰 등록은 사용자가 직접. 결과는 SonarQube MCP로 읽는다.
