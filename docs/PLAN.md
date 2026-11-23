# VS Code 프로필 프리셋 프로젝트 - 작업 내용 정리 (2026-11-20 기준)

## 1. 배경과 목표
- 설치된 확장 79개 중 공통 기본만 남기고, 나머지는 용도별 프로필에서만 쓰고 싶다.
- 최종 목표: 이 과정을 "선언형 프리셋 하나로 프로필을 만들고 맞춰 주는 도구"로 만들어 Git에 올리고, 가능하면 VS Code 확장으로 배포한다.

## 2. 지금까지 결정한 구성
- 방식: VS Code 내장 Profiles 사용 (별도 전환 확장은 쓰지 않음)
- 프로필 8개: Core(공통만), Python-Data, Java, C-Cpp, Web-JS, CSharp-Unity, Go, Docker-Infra. 각 프로필 = Core 28개 + 용도별 확장
- Core 28개: Claude Code, ChatGPT/Codex(2), 한국어 언어팩, GitHub 테마, Cool Theme Kit(woogajjangka.cool-theme-kit, 직접 만든 확장), GitLens, Git Graph, GitHub PR, gitignore, Git Bash, Prettier, ErrorLens, indent-rainbow, tabout, change-case, multi-cursor-case, Project Manager, PDF, Rainbow CSV, SonarLint, Remote SSH/SSH-Edit/Explorer/WSL, custom-css, animations, Material Icon Theme(Cool Theme Kit 의 아이콘 섞기 층, 2026-11-22)
- 어느 프로필에도 안 넣음(평소 꺼둠): vscode-pets, CodeSnap, Log File Highlighter, GitHub Actions, Codespaces, Remote Repositories, Snyk, PowerShell
- 분류의 원본(single source of truth)은 vscode-profiles-setup.ps1 의 $core / $sets

## 3. 산출물 (이 폴더)
- vscode-profiles-setup.ps1 : 프로필 생성 + 확장 설치 + Default 설정 복사 + Default disable 목록 생성 (-DryRun 지원, ASCII 전용)
- extensions-backup-*.txt : 변경 전 확장 목록 (롤백 기준, 지우지 말 것)
- default-profile-disable-list.txt : Default에서 끌 52개
- install-log-*.txt, run-output.txt : 실행 로그
- repair-extensions.ps1 : Default를 원본 백업(150004) 기준으로 복구 + 각 프로필 누락 확장 재설치(최대 3회 패스), disable 목록을 원본 백업 기준으로 재생성
- share-settings.ps1 : 프로필들이 Default의 settings/keybindings/snippets/tasks/mcp/prompts를 공유하도록 storage.json의 useDefaultFlags 수정, Default settings.json을 Local History 스냅샷에서 복원(옵션), window.newWindowProfile=Core 추가. VS Code 완전 종료 후 실행, 백업은 backup-<시각>\ 로 저장
- sync-core-extensions.ps1 : Core 프로필의 확장을 다른 프로필에 추가만 하는 동기화 (삭제 없음)
- run-output2.txt, install-log-*172647.txt, repair-log-*.txt, repair-output.txt : 2차 실행/복구 로그
- HANDOFF.md : 이전 인수인계 문서 (이 PLAN.md가 최신)

## 4. 겪은 문제와 원인
1. 첫 실행 전부 실패: `code --profile X --install-extension`은 프로필이 이미 있어야 함 ("Profile 'Core' not found."). 해결: 프로필이 없으면 `code --profile X --new-window`로 창을 열어 만든 뒤 설치(Ensure-Profile).
2. 재실행 109건 성공 / 48건 실패: 대부분 `getaddrinfo ENOTFOUND marketplace.visualstudio.com` (일시적 DNS/네트워크 오류). 재시도 필요. 일부는 `Installing extensions...` 한 줄만 남고 실패(원인 미확인).
3. 스크립트의 설정 복사 단계(settings/keybindings/snippets)가 동작했는지 확인 못 함 (실행 기록에 Copied 로그 없음). AppData\Roaming\Code\User 폴더는 Claude 쪽에서 접근 불가.
4. Cool Theme Kit 테마가 안 보임: 확장 설치와 테마 적용은 별개. 이 확장은 색 테마(Cool Islands Dark/Light), 파일 아이콘(Cool Icons), 제품 아이콘(Cool Islands Icons / Cool Material Icons)을 제공하며 설정으로 골라야 함.
   - workbench.colorTheme = "Cool Islands Dark"
   - workbench.iconTheme = "a-file-icon-vscode"
   - workbench.productIconTheme = "cool-islands-product-icons"
5. 자동화 한계: Claude 채팅 쪽에서는 터미널/VS Code에 타이핑할 수 없어 스크립트 실행은 사용자가 직접 했다.

## 4-2. 이후 진행 (폴더 파일 기준, 실행 결과는 미확인)
- 2차 실행(run-output2.txt): 성공 219 / 실패 41. 실패는 `Installing extensions...` 한 줄만 남는 유형이 많아 원인 재확인 필요(네트워크 오류 + 그 외).
- Default 프로필 변화: 사용자 설명에 따르면 다른 PC에서 정리한 결과이며 의도된 변경이다. Default의 확장 누락(21개), disable 목록 52 -> 35개, Default settings.json 변경은 이 때문으로 본다. 다른 PC의 변경이 이 PC로 넘어온 경로(Settings Sync 등)는 확인하지 않았다.
- 충돌 주의: repair-extensions.ps1은 Default를 원본 백업(79개) 기준으로 되돌리도록 만들어져 있어, 다른 PC에서 한 정리와 반대로 동작한다. Settings Sync가 켜져 있으면 되돌린 상태가 다른 PC로 전파될 수 있다. Default 단계는 사용자 확인 후에만 실행한다. (프로필별 확장 채우기 단계는 Default와 무관)
- share-settings.ps1: 프로필들이 Default의 settings/keybindings/snippets/tasks/mcp/prompts를 공유하도록 storage.json의 useDefaultFlags 수정 + window.newWindowProfile=Core. Default settings.json을 Local History에서 복원하는 옵션이 있으나, 다른 PC에서 정리된 현재 settings.json이 맞는 상태일 수 있으므로 복원 전 확인한다. backup-* 폴더가 없어 아직 실행 전으로 보인다.
- 설계 변화: 프로필별 복사 대신 useDefaultFlags로 Default 설정을 공유. 단, useDefaultFlags 직접 편집은 문서화된 방법이 아니므로 버전 호환성 위험이 있다.

## 5. 조사 결과 (제품화에 중요)
- 프로필은 설정/단축키/스니펫/작업/확장 중 일부만 포함할 수 있고 빠진 항목은 Default에서 온다. 복사해 만든 프로필은 원본과 연결이 유지되지 않는다. 개별 항목은 "Apply Setting to all Profiles", "Apply Extension to all Profiles"로 공유 가능.
- 다른 PC: Settings Sync에서 Profiles 항목을 체크해야 프로필이 따라온다(최대 20개, Microsoft/GitHub 계정). machine 범위 설정은 동기화 안 됨, 단축키는 OS별로 따로 동기화. 폴더-프로필 연결 동기화 여부는 문서에 없음. 파일 이동은 프로필 Export(.code-profile, gist) / Import.
- 확장 API 한계(가장 중요): 확장 API는 프로필 관련 기능을 노출하지 않으며 Microsoft도 바꿀 계획이 없다고 알려져 있음. 다른 확장을 비활성화하는 API도 없음. 기존 사례들은 CLI 호출이나 globalStorage/storage.json 읽기 같은 우회에 의존.
  2026-11-21 재확인: 프로필 생성·전환·목록의 공개 API도 제안(proposed) API도 아직 없다. 그래서 지금 방식(`code --profile X --new-window`, 내부 명령 `workbench.profiles.actions.profileEntry.<location>`, storage.json 읽기)을 유지하고, 의존하는 비공개 동작 6가지는 `docs/REVIEW-2026-11-21.md` 2절 P9 표로 관리한다.
- 선행 사례: aaronpowell/vscode-profile-switcher(내장 프로필 도입으로 보관됨), robole/vscode-profile-status(storage.json 읽기), vsix-manager(그룹 정의), better-extension-manager(설치/삭제 방식), vs-code-preset, vscode-profile-extension-manager(PyPI, CLI).
- 배포: `npm i -g @vscode/vsce` -> publisher 생성 -> `vsce package` / `vsce publish`. 전역 PAT 방식은 권장되지 않고 2026-12-01 폐기 예정이라, GitHub Actions의 Trusted Publishing(OIDC, `vsce publish --oidc`)을 권장. Open VSX는 해당 문서에 언급이 없으므로 별도 확인 필요.

## 6. 제품 아이디어 (가칭 Profile Kit)
- 선언형 프리셋(core + groups + profiles)을 한 파일로 관리
- 적용: 프로필 생성(창 열기 방식) -> 확장 설치(재시도/백오프) -> 설정 복사 -> 결과 리포트
- 점검: 선언 vs 실제 설치 차이(diff), 누락 재시도
- 편의: 폴더를 프로필로 열기, 현재 구성에서 프리셋 초안 내보내기, 드라이런
- 구조 후보: A) Node CLI + 얇은 확장 UI, B) 순수 확장, C) 저장소만(스크립트 + .code-profile 템플릿 + 문서)
- 확장 API 한계 때문에 B는 불안정할 수 있어, 타당성 검증 후 결정한다.
- **결정 (2026-11-21)**: 사용자가 "모든 기능은 GUI로 보여야 한다"고 정했다. 확장이 주 화면이고, `src/core`(순수 로직)와 `src/host`(code CLI, 파일)를 CLI와 공유한다.
  더한 목표: 설치할 때 넣을 프로필 고르기와 추천, 쉬운 전환, 공통 설정과 프로필별 설정. 진행 단계 M0~M7은 `docs/ROADMAP.md` 끝에 있다.

## 7. 남은 일
- [x] Default 프로필 현재 상태 확인 → 80개(원본 백업 79개 + `vscjava.vscode-gradle`), Settings Sync 켜짐. Default 복구 단계는 쓰지 않기로 결정(2026-11-21)
- [x] 현재 PC: repair 완료(2026-11-21 06:02), `verify` 8개 프로필 모두 빠진 것 없음. 실패 원인: DNS(`getaddrinfo ENOTFOUND`), VSIX 캐시 쓰기 중단(`Unable to write file ...CachedExtensionVSIXs (Error: aborted)`), 둘 다 재시도로 해결. `DEP0169` 경고는 PowerShell 5.1이 NativeCommandError로 감싼 것이라 실패가 아님
- [x] 현재 PC: share-settings.ps1은 2026-11-21 05:58에 이미 실행됨(`backup-20261121-055822`). DryRun 결과 바꿀 것 없음
- [x] 현재 PC: Default 정리 → Core에 없는 53개를 Default에서만 `code --uninstall-extension`으로 제거(2026-11-21, 사용자 요청, uninstall 금지 규칙의 1회 예외). Default = Core 27개, 다른 8개 프로필은 `verify`로 그대로인 것 확인. 의존 관계 때문에 한 번에 안 지워지는 것(.NET Install Tool, C# Dev Kit, Container Tools, Java 디버거·언어 지원)은 두 번째 패스에서 지워짐. 백업 `extensions-backup-20261121-104351-before-core-match.txt`(80개). Settings Sync로 다른 PC의 Default에도 전파될 수 있음
- [x] 타당성 검증 후 구조 결정 → 8절 (확장 중심 GUI + 공유 core + 보조 CLI)
- [x] 저장소 초기화, CI, 문서, 테스트
- [x] 배포: publisher 생성과 계정 작업은 사용자가 직접 했다. 0.1.0 pre-release(2026-11-21)부터 1.3.1 pre-release(2026-11-23)까지 Release workflow(Trusted Publishing)로 게시. 절차는 `docs/RELEASE.md`

## 8. Phase 2 실험 결과 (2026-11-21, VS Code 1.147.0, Windows)

격리 폴더(`--user-data-dir`, `--extensions-dir`, `--shared-data-dir` 모두 임시 폴더)에서 실험용 확장을 띄워 확인했다. 실제 사용자 VS Code는 건드리지 않았다.
mac/Linux와 VS Code 1.95(엔진 하한)는 확인하지 않았다.

| # | 질문 | 결과 | 설계에 반영 |
|---|------|------|-------------|
| 1 | 확장 호스트에서 `code --profile X --install-extension / --list-extensions` | 된다. CLI 위치는 `vscode.env.appRoot`(`<설치>/<commit>/resources/app`)에서 세 단계 위의 `bin/code.cmd`다. 확장 호스트 환경(`ELECTRON_RUN_AS_NODE` 등)을 그대로 넘겨도 동작한다. | `host/codeLocator.ts`: appRoot 기준 2·3단계 위 `bin`을 차례로 찾는다 |
| 2 | 프로필 생성 | 프로필이 없으면 CLI에서 `Profile 'X' not found.`가 나온다(창 없이는 못 만든다). VS Code가 실행 중일 때 `code --profile X --new-window`를 보내면 1초 안에 storage.json `userDataProfiles`에 `{location, name}`이 생긴다(새 창이 열린다). | 프로필 생성은 "새 창이 열립니다" 확인 후 실행하고, 만들어졌는지는 storage.json을 읽어 확인한다 |
| 3 | 현재 창의 프로필 식별 | `globalStorageUri`는 프로필과 상관없이 `User/globalStorage/<ext>`라서 쓸 수 없다. `profileAssociations`는 `--profile`로 연 확장 개발 창에서 실제 프로필과 달랐다. **각 프로필 settings.json에 넣은 마커 설정**은 정확히 읽혔다. | 관리하는 프로필의 settings.json에 `profileKit.profile: "<이름>"`을 쓰고 `getConfiguration`으로 읽는다. 마커가 없으면(Default 설정 공유 등) "알 수 없음"으로 표시한다 |
| 4 | 현재 창 전환 | 내부 명령 `workbench.profiles.actions.profileEntry.<location>`을 일반 창에서 실행하면 같은 창이 약 3초 안에 그 프로필로 바뀐다(확장 호스트 재시작). 그 폴더의 `profileAssociations`도 새 프로필로 바뀐다. 확장 개발 창(F5)에서는 명령이 오류 없이 끝나지만 전환되지 않는다. `workbench.action.openProfile.<이름>`, `workbench.profiles.actions.switchProfile`(VS Code 자체 선택창)도 있다. | 문서화되지 않은 ID라서 `getCommands`로 있는지 먼저 본다. 없으면 `switchProfile` 선택창, 그것도 없으면 `code --profile X <폴더>` 순서로 대신한다 |
| 5 | 다른 프로필 settings.json 직접 수정 | `User/profiles/<location>/settings.json`을 고치면 열린 창에 약 2초 뒤 반영된다. 파일이 없으면 새로 만들어도 된다. | `host/settingsWriter.ts` 방식 그대로 |
| 6 | 설치 감지 | 현재 프로필에 CLI로 설치하면 `extensions.onDidChange`가 발생하고 `getExtension`으로 바로 보인다. 다른 프로필에 설치할 때는 발생하지 않는다. 마켓플레이스 Install도 같은 이벤트를 쓴다(API 문서: 설치·제거·활성화 변경 시 발생). `workbench.extensions.installExtension` 명령은 이 환경에서 `Canceled`로 끝나 확인하지 못했다. | 설치 후 알림은 `onDidChange` + 직전 목록 스냅샷 비교로 하고, 도구가 직접 설치한 ID는 알림에서 뺀다 |
| 7 | 마켓플레이스 메타데이터 | `POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery`, `filterType: 7`(ID), `flags: 0x1\|0x4\|0x10\|0x200`로 categories, tags(`__ext_<확장자>` 포함), 버전 속성(`ExtensionDependencies`, `ExtensionPack`)을 받는다. 없는 ID는 결과에서 빠질 뿐 오류가 나지 않는다. | `Install to Profiles…`의 추천 입력으로 쓴다. 실패하면 ID만으로 진행한다 |

| 8 | 확장에서 창을 여는 `code` 호출 (M3 GUI 시험 중 발견) | 창을 여는 호출(`--new-window`, 폴더 열기)은 실행 중인 VS Code와 `--user-data-dir`, `--extensions-dir`, `--shared-data-dir`가 **모두 같을 때만** 그 VS Code에 붙는다. 하나라도 다르면 VS Code가 하나 더 뜬다. 격리 VS Code 안의 확장이 `--shared-data-dir` 없이 호출했더니, 기본 공유 데이터(로그인 정보가 있는 곳)를 쓰는 두 번째 VS Code가 떴다. 바로 닫았고, 실제 프로필 목록은 바뀌지 않았다. `--shared-data-dir`는 확장 API로 알 수 없다. 창을 열지 않는 호출(list, install)은 문제없다. | 기본 폴더로 실행한 VS Code에서는 폴더 인자 없이 `code`를 부른다. 폴더를 바꿔 실행한 VS Code에서는 창을 여는 호출을 막고(`Kit.windowsBlocked`), 프로필은 VS Code에서 먼저 만들라고 안내한다. 시험용은 `PROFILE_KIT_CODE_ARGS`로 세 폴더를 모두 넘긴다(`.vscode/launch.json`). CLI도 `--user-data-dir`만 주고 `--shared-data-dir`를 주지 않으면 프로필을 만들지 않는다 |

결론: 계획(`확장 = GUI 주 화면, core 공유, CLI 보조`)과 어긋나는 결과는 없다. 3번만 바뀌었다(globalStorageUri 대신 마커 설정).

### 8-1. 설정 공유 끄기 + "모든 프로필에 적용" (2026-11-21, VS Code 1.147.0, Windows)

목적: 프로필 8개가 Default 설정을 통째로 공유(`useDefaultFlags.settings`)하는 대신, 공통 키만 VS Code의
"Apply Setting to all Profiles"(설정 `workbench.settings.applyToAllProfiles`, Default settings.json에 둔다)로 묶고
프로필 settings.json에는 프로필별 키와 마커만 두는 방식이 되는지 본다. 격리 폴더 3개 + 탐침 확장으로 했고, 실제 VS Code는 건드리지 않았다.
이 기능은 1.81(2023-07)에 들어왔으니 엔진 하한 1.95에도 있다([1.81 릴리스 노트](https://code.visualstudio.com/updates/v1_81)). 1.95에서 직접 돌려 보지는 않았다.

| # | 확인한 것 | 결과 |
|---|-----------|------|
| 9-1 | 공유를 끈 프로필에서 목록에 있는 키 | Default 값이 보인다. 프로필 settings.json에 같은 키가 있어도(9) 무시되고 Default 값(21)이 나온다 |
| 9-2 | 목록에 없는 키 | 프로필 파일 값만 쓴다. Default에만 있는 키(`editor.tabSize: 7`)는 보이지 않는다(기본값 4) |
| 9-3 | 그 프로필에서 `update(..., Global)` | 목록에 있는 키(이미 있던 것, 새로 넣은 것 모두)는 **Default** settings.json에 써진다. 프로필 파일의 옛 값은 그대로 남지만 무시된다. 목록에 없는 키는 프로필 파일에 써진다 |
| 9-4 | 목록에 있는데 Default에 값이 없는 키 | 프로필 값(33)이 아니라 기본값(0)이 된다. 즉 목록에 넣은 키는 프로필이 덮어쓸 수 없다 |
| 9-5 | 창이 열린 채 Default 파일을 밖에서 고침 | 값 변경은 바로 반영된다. 목록 자체를 바꾸면 반영이 어긋난다(키를 넣어도 프로필 값이 남고, 키를 빼면 프로필 값이 아니라 기본값이 나옴). **창을 다시 열면** 9-1~9-4대로 맞는다 |
| 9-6 | 언어별 블록 `"[html]"`을 목록에 넣음 | 적용되지 않는다(`html`의 `tabSize` 4). 언어별 설정은 프로필마다 따로 써야 한다 |
| 9-7 | 마커 | 프로필 파일의 `probe.name`이 프로필마다 맞게 읽혔다(3번 결과와 같음) |

확인하지 않은 것: 프로필 편집 화면에서 "Settings: Default 사용"을 끌 때 VS Code가 프로필 settings.json을 어떻게 다루는지(그대로 두는지, Default를 복사하는지),
Settings Sync가 목록과 프로필 파일을 다른 PC로 어떻게 옮기는지.

설계에 반영할 것:
- 공통 키 = Default settings.json + `applyToAllProfiles` 목록. 프로필 파일에는 프로필별 키, 언어별 블록, 마커만 쓴다.
- 한 키는 공통이거나 프로필별, 둘 중 하나다. 프리셋의 `profiles.X.settings` 키가 목록에 있으면 무시되니 경고한다.
- 목록을 바꾼 뒤에는 열린 창을 다시 열라고 안내한다.
- 공유를 끄는 순서: 백업 → 화면에서 공유 끄기 → 그다음 프로필 파일 쓰기(끌 때 VS Code가 파일을 어떻게 하든 결과가 같도록).

### 8-2. 단계 C 조사: 내장 기능 불러 쓰기 (2026-11-21, VS Code 1.147.0, Windows)

방법: VS Code 내장 프로필 템플릿 7개(VS Code가 내보낸 `.code-profile` 파일)와 설치된 VS Code의 workbench 코드(가져오기 검사·적용, URL 처리, 끌어다 놓기)를 읽었다.
실제 PC는 읽기만 했다(`extensions.json`, `User/sync/`, `code --list-extensions`). 격리 VS Code에서 손으로 내보내기·가져오기는 하지 않았다.

| # | 질문 | 결과 | 설계에 반영 |
|---|------|------|-------------|
| C-1 | `.code-profile` 형식 | JSON 객체. `name`(문자열)만 필수이고 `icon`(codicon 이름), `settings`, `keybindings`, `tasks`, `snippets`, `globalState`, `extensions`, `useDefaultFlags`는 선택. 값은 모두 **JSON을 문자열로 한 번 더 감싼 것**이다. `settings` = `{"settings": "<settings.json 원문>"}`(주석·CRLF·언어별 블록 그대로), `extensions` = `[{identifier: {id, uuid}, displayName, preRelease?, applicationScoped?, disabled?}]`, `snippets` = `{"snippets": {"python.json": "<원문>"}}`, `globalState` = `{"storage": {...}}`(보기 배치). VS Code의 검사는 "name이 문자열이고 icon·settings·globalState·extensions가 없거나 문자열"뿐이다. 가져올 때 템플릿은 `resourceTypeFlags`로 항목을 뺄 수 있다 | 내보내기는 `name`, `icon`(있으면), `settings`, `extensions`만 쓴다. `uuid`는 Marketplace 조회로 채우고 실패하면 뺀다. **`uuid` 없이 가져와지는지는 확인하지 않았다** → 구현할 때 격리 VS Code에서 확인 |
| C-1b | VS Code로 가져오는 방법 | 공개 명령이 없다. ① 파일을 창에 끌어다 놓으면 Profiles 편집기의 "새 프로필"이 그 파일 내용으로 열린다 ② Profiles 편집기의 Import(내부 action `importProfile`) ③ URL `vscode://profile/<handler>/<id>`는 확장이 제안 API로 등록한 content handler만 처리한다(Marketplace 확장은 못 씀) | Profile Kit은 파일만 만들고, Profiles 편집기(`workbench.profiles.actions.manageProfiles`)를 열어 "이 파일을 끌어다 놓거나 Import"라고 안내한다. 만들기 확인은 VS Code 화면에서 사용자가 한다. 반대 방향(`.code-profile` → 프리셋 초안)은 파일만 읽으면 되어 VS Code에 기대지 않는다(core 순수 로직) |
| C-2 | "Apply Extension to all Profiles" 표시 | Default 프로필의 `<extensions-dir>/extensions.json` 항목에 `metadata.isApplicationScoped: true`로 들어간다. 프로필의 `User/profiles/<location>/extensions.json`에는 없다. `code --list-extensions --profile X`는 이 확장을 표시 없이 섞어 보여 준다(실제 PC Core: 파일 26개 + 한국어 팩 = 목록 27개). 확장 API로는 알 수 없다. 이 PC에서는 `ms-ceintl.vscode-language-pack-ko` 하나 | 읽기만 한다(쓰기는 `extensions.json` 편집뿐이라 하지 않음, 규칙). 트리·관리 화면에 "모든 프로필" 표시, `verify`의 "추가"가 이것 때문이면 이유를 붙이고, `core`와 겹치면 알려 준다. `compat.ts` 비공개 의존에 하나 추가 |
| C-3 | Settings Sync가 켜져 있는지 | application 저장소 `User/globalStorage/state.vscdb`(SQLite)의 키 `sync.enable`(이 PC `true`). 확장 API·설정·일반 파일로는 알 수 없다. `User/sync/<항목>/lastSync*.json`은 한 번이라도 동기화하면 생기고 동기화할 때마다 바뀌지만, 끈 뒤에도 남는다. VS Code 1.95의 Node 20에는 내장 SQLite가 없다 | SQLite는 읽지 않는다(의존성이 늘고 `state.vscdb`는 다루지 않는 파일). `User/sync/`가 있으면 미리보기에 "Settings Sync를 쓰고 있다면 이 변경은 다른 PC로도 동기화됩니다"를 조건 문구로 보여 준다 |
| C-4 | 내장 템플릿 목록 | `<appRoot>/product.json`의 `profileTemplatesUrl` = `https://main.vscode-cdn.net/core/profile-templates.json`. VS Code가 "새 프로필 → 템플릿"에 쓰는 주소와 같다. `[{name, url}]` 7개(Python, Angular, Doc Writer, Data Science, Java General, Java Spring, Node.js)이고 각 `url`이 C-1 형식의 `.code-profile`(확장 8~22개, 일부는 설정·스니펫 포함) | 프리셋 초안 만들기에서 이 목록을 받아 그룹 후보로 제안한다(확장 ID만, 설정은 보여 주고 고르게). 못 받으면(오프라인, 키 없음) 제안 없이 진행. `compat.ts` 비공개 의존에 하나 추가 |

결론: 네 가지 모두 공개 API는 없지만, 읽기와 파일 만들기만으로 할 수 있다. 쓰기가 필요한 일(가져오기, "모든 프로필에 적용" 켜기)은 VS Code 화면에 맡긴다.
구현하면 비공개 의존이 6개에서 8개(Default `extensions.json`의 `isApplicationScoped`, `product.json`의 `profileTemplatesUrl` + 템플릿 형식)가 되므로 호환성 점검(10절)에 같이 넣는다.

구현(2026-11-21, 사용자 결정: C-1·C-2·C-4 + C-3 문구): `core/codeProfile.ts`·`templates.ts`·`extensionsJson.ts`, `host/builtins.ts`, `ui/codeProfiles.ts`, CLI `export`.
비공개 의존은 결국 10개다(위 둘 + `.code-profile` 형식과 Profiles 편집기 명령 + `User/sync/`). 템플릿은 그룹이 아니라 프로필 후보로 넣는다(가져오기와 같은 경로, 설정도 같이 옴).

가져오기 확인(2026-11-21, VS Code 1.147.0, 격리 폴더 3개): CLI `export --offline`으로 `uuid` 없는 파일을 만들고, 시험용 탐침 확장(제안 API `profileContentHandlers`, `--enable-proposed-api`, 시험 창에서만)이
그 파일을 `vscode://profile/probe/x`로 VS Code의 가져오기 화면에 넘겼다. 화면에서 Create를 누르니:
- 확장 2개가 설치됐다(`uuid` 없이 ID로 찾음. 코드상 `areSameExtensions`도 둘 다 `uuid`가 있을 때만 `uuid`로 비교).
- 프로필 settings.json에 파일의 settings.json 원문이 그대로 들어갔다(마커·`profileKit.managedKeys` 포함). 그 뒤 Profile Kit `apply` 미리보기 = "up to date", `verify` = 2 ok.
- 설치 중 VS Code가 처음 보는 게시자마다 "Do you trust the publisher?" 확인을 띄웠다(가져오기의 일부, 사용자가 누름).
- VS Code 코드상, **이미 있는 프로필에 가져오면 파일에 없는 확장(모든 프로필에 적용된 것 제외)을 제거한다.** 그래서 안내·CLI 출력에 "새 프로필로 가져오기"를 적었다.

## 9. SonarQube Cloud (2026-11-21~)

CI 분석(`sonar.yml`, secret `SONAR_TOKEN`, Automatic Analysis 끔). 수동 실행: `gh workflow run sonar.yml --ref main`.
Automatic Analysis가 켜져 있으면 CI 스캔이 "You are running CI analysis while Automatic Analysis is enabled"로 실패한다(첫 실행에서 겪음).
첫 분석(main `000f7ff`, 4,317줄): 품질 게이트 통과(새 코드), 커버리지 82.5%, 중복 0%, 핫스팟 0, 이슈 17개(버그 5, 취약점 11, 냄새 1).

자주 나오는 지적과 이 저장소의 답 (`a-file-icon-vscode`와 같은 답):
- 비교 함수 없는 `sort()`(S2871): `core/text.ts` `compareCodeUnits`. `localeCompare`를 쓰지 않는다: `profileKit.managedKeys`처럼 Sync로 PC 사이를 오가는 목록의 순서가 PC 로캘에 따라 달라지면 안 된다.
- 끝의 `/` 지우는 정규식 백트래킹(S8786): `trimTrailingSlashes`(반복문).
- 웹뷰 `message`의 출처(S2819): `event.origin !== window.origin`이면 버린다. VS Code는 확장 메시지를 웹뷰와 같은 출처의 호스트 프레임에서 `postMessage(…, window.origin)`로 넘긴다(`a-file-icon-vscode`에서 1.95·1.147로 확인).
- CSP nonce에 `Math.random`(S2245): `crypto.randomBytes`.
- Actions의 `npm ci`·`npx`(S6505, S8543): `npm ci --ignore-scripts`, vsce는 `./node_modules/.bin/vsce`(설치된 고정 버전). esbuild는 설치 스크립트 없이도 플랫폼 패키지로 동작한다(로컬 `npm ci --ignore-scripts` → check·build·package 확인).
- "LLM이 준 CLI 인자로 경로 조작"(tssecurity S8707, `cli/index.ts`, `host/apply.ts`, `host/settingsWriter.ts`): CLI는 사용자가 직접 넘긴 `--user-data-dir` 등과 그 아래 VS Code 파일을 읽고 쓰는 것이 목적이다. 프로필 폴더는 `paths.profileSettings`가 `User/profiles` 밖으로 못 나가게 막는다. 고치지 않고 SonarQube에서 "Accept"(이유 남김)로 닫았다(2026-11-21, 4개).
- workflow의 `curl` 다운로드(S6506): `--proto '=https' --proto-redir '=https' --tlsv1.2`로 리다이렉트도 HTTPS만.
- 커버리지: `scripts/**`(호환성 점검은 실제 VS Code로 `compat.yml`에서 돈다)와 `esbuild.mjs`는 커버리지에서 뺀다. PR 분석에서 S8707이 다시 열리면 같은 이유로 Accept.
- PR #18(단계 C): S8707 4개(`host/builtins.ts`). product.json 읽기·내보내기 폴더 쓰기 2개는 같은 이유로 Accept. extensions.json 읽기 2개는 규칙이 권하는 대로 고쳤다: `readApplicationScoped`가 실제 경로(`realpathSync`)를 구하고, 그 폴더 안(`폴더 + 구분자`로 시작)이 아니면 돌아간 뒤 읽는다(규칙 예시와 같은 순서, 같은 함수 안. 다른 함수의 삼항식으로 검사했을 때는 흐름 하나만 닫혔다). 다른 곳을 가리키는 심볼릭 링크는 읽지 않고 알린다. "로그에 민감 정보"(S8689, `scripts/compat/check.ts`): 실패 내용에 내려받은 템플릿·CLI 출력을 통째로 찍던 것을 ID·개수 요약으로 바꿨다.
- 호환성 점검: 1.95.0의 product.json에 있는 템플릿 목록 주소는 응답하지 않는다(`fetch failed`). VS Code 자체의 템플릿 목록도 비게 되고 Profile Kit은 제안 없이 진행하므로, 목록을 못 받으면 FAIL이 아니라 SKIP으로 둔다.
- PR #15 머지 뒤(2026-11-21) 열린 이슈 0, 품질 게이트 통과. `Analysis + quality gate`는 main ruleset 필수 검사다.

## 10. VS Code 내부 의존과 호환성 점검 (2026-11-21~, 단계 D)

공개 API가 아닌 VS Code 동작 11가지(6가지 + 단계 C의 4가지, 8-2절 + 확장 폴더의 package.json, 13절)는 `src/core/compat.ts`의 `PRIVATE_DEPENDENCIES`에 모았다(쓰는 곳, 바뀌면 생기는 일). 저장소 키, 프로필 폴더 이름, 전환 명령, CLI 출력 문구, `bin/` 위치는 여기 상수로만 쓴다.
손으로 확인한 버전은 `COMPAT_CHECKED_VERSION`(1.147.0). 확장은 시작할 때 출력 창 첫 줄에 VS Code 버전과 이 버전을 적는다(버그 보고용, `.github/ISSUE_TEMPLATE/bug_report.yml`).

호환성 점검 `.github/workflows/compat.yml`: 매주 월요일, 수동, 그리고 CLI·host 코드를 고친 PR에서. VS Code를 공식 다운로드 주소(`update.code.visualstudio.com`, `@vscode/test-electron`과 같은 주소)에서 받아,
세 데이터 폴더를 모두 임시 폴더로 준 채 `scripts/compat/check.ts`(빌드: `npm run build:compat` → `out/compat.js`)가 Profile Kit의 host 함수를 그대로 돌린다.
대상: Linux 1.95.0(엔진 하한)·최신 stable·insiders, Windows 최신 stable. 필수 검사는 아니다(다운로드·Marketplace 네트워크에 기대므로).
확인하는 것: appRoot에서 CLI 찾기, "profile not found", `--profile X --new-window`로 만들기 + storage.json 읽기, 묶음 설치와 출력, `--list-extensions`. 창이 있어야 하는 것(전환 명령, 프로필 settings.json 반영)은 못 본다.

2026-11-21 이 PC(Windows, VS Code 1.147.0, 격리 폴더)에서 `out/compat.js` 9개 모두 통과(단계 C 뒤 13개: 언어 팩을 Default에 설치하면 `extensions.json`에 `isApplicationScoped`가 붙고 다른 프로필 목록에도 나옴, `profileTemplatesUrl`과 템플릿 7개 읽기). 묶음 설치 출력은 확장마다 한 줄씩 나온다:
`Extension 'a' v1 was successfully installed.` / `... is already installed. Use '--force' ... for example: 'a@1.2.3'.` / 없는 ID는 `Extension 'x' not found.` + 끝에 `Failed Installing Extensions: x`. 프로필이 없으면 `Profile 'Nope' not found.` 한 줄.

단계 D에서 같이 고친 것 (`docs/REVIEW-2026-11-21.md` 2절):
- P5: 창을 열 때는 이 창의 프로필만 `--list-extensions` 한다. 트리가 보이거나 관리 화면을 열면 그때부터 전체를 한 번에 최대 3개씩.
- P6: 설치 후 알림은 같은 프로필의 창들 중 한 창에서만 묻는다(globalState에 "이 창이 묻는다"를 쓰고 1.5초 뒤 다시 읽어 자기 것이 남은 창만). 직전 `--list-extensions`에 있던 확장(사용 안 함 → 사용)은 묻지 않는다. 여러 창에서의 동작은 아직 실제로 확인하지 않았다.
- P7: 프로필을 만들려고 연 창은 닫아도 된다고 확인 창·결과 알림·CLI 출력에 적는다. 자동으로 닫는 공식 방법은 없다.
- P8: 설치는 10개씩 한 번에(`--install-extension a --install-extension b ...`), 끝나면 목록으로 확인하고 없는 것만 하나씩 재시도.
- P10: 출력으로 판단이 안 되면(`unknown`) 목록에 있으면 설치됨으로 본다. 네트워크 오류 정규식은 확장 ID를 뺀 출력에만 적용한다.

## 11. 1.1.0: VS Code 안에서 쉽게 쓰기 (2026-11-22)

목표(사용자 요청): 처음 쓰는 사람도 VS Code 안에서 헤매지 않게. 기능은 줄이지 않고, 들어가는 곳과 질문을 줄인다.

| 바꾼 것 | 이유 |
| --- | --- |
| 상태 표시줄을 누르면 메뉴(`profileKit.menu`): 맨 위 전환할 프로필, 그 아래 지금 맞는 작업. 프리셋이 없으면 시작 방법(추천 내장 프리셋 먼저) | 명령이 15개라 어디서 시작할지 몰랐다. 전환은 전과 같은 클릭 수 |
| 트리 맨 위 "다음 할 일" 줄(프로필 N개를 맞춰야 함 → 누르면 미리보기 후 적용), Activity Bar 배지. 프리셋 파일 이름은 그 줄의 툴팁과 메뉴에(뷰가 컨테이너에 혼자 있으면 VS Code가 머리글을 컨테이너 제목에 합치면서 `TreeView.description`을 보여 주지 않는다, 1.147 확인) | "모든 프로필에 적용"과 "빠진 확장 설치" 중 무엇을 누를지 몰랐다. 배지·요약은 목록을 읽은 프로필만 센다(P5: 창을 열 때 전체 목록을 읽지 않음). 설정 차이는 계획을 세워야 알 수 있어 세지 않는다 |
| Get Started 안내(`contributes.walkthroughs`, 4단계, 단계마다 버튼). 그림은 테마 색(`var(--vscode-*)`)만 쓰고 글자는 파일 이름·ID·프로필 이름뿐 | VS Code 자체 온보딩 방식. 설치하면 VS Code가 연다(`workbench.welcomePage.walkthroughs.openOnInstall`). 그림을 언어마다 만들지 않으려고 UI 문구를 넣지 않았다 |
| 설치 후 "프리셋의 어디에 기록할까요?" 질문 없앰. `recordOptions`의 첫 항목(정확히 고른 프로필만 받는 core·그룹, 아니면 각 프로필 목록)을 쓰고 결과 알림에 적는다 | 첫 항목은 항상 정확히 고른 프로필만 받는다(`addExtension.test.ts`가 모든 조합으로 확인). 더 넓은 그룹에 넣고 싶으면 프리셋을 고친다 |
| 툴바 버튼 5개 → 3개(적용, 관리 화면, 새로 고침), 나머지는 "..." 메뉴에 묶음. 프리셋이 필요한 명령은 프리셋이 없으면 팔레트에서 숨김, 트리 전용 `switchTo`는 팔레트에서 뺌 | 같은 일을 하는 곳이 너무 많았다 |
| 새 프리셋 저장 창의 기본 위치: 열린 폴더, 없으면 홈 폴더(`src/ui/presetFile.ts`) | 폴더가 없으면 저장 창이 마지막으로 쓴 곳에서 열려 파일을 다시 찾기 어려웠다 |
| 고친 버그: 프리셋이 없을 때 트리를 비운다 | 환영 화면(시작 버튼)은 트리가 비었을 때만 나온다. VS Code에 프로필이 이미 있으면 트리가 그 프로필을 보여 줘서 시작 버튼이 안 보였다 |

확인: `npm run check` 통과(테스트 274개, 새 `status.test.ts`·`manifest.test.ts` 포함), VSIX에 `media/walkthrough/*.svg` 포함.

격리 VS Code 1.147(Windows, Dark Modern)에서 화면으로 확인(2026-11-22):

- 안내 화면은 확장을 설치하면 VS Code가 연다. 단계 4개, 버튼, 완료 표시(프리셋을 만들면 1단계, 메뉴를 열면 3단계)가 맞게 나온다.
- 처음 만든 SVG는 그림 칸이 전부 검었다. Welcome 화면의 CSP가 인라인 스타일을 막아 SVG 안의 `<style>`이 버려지기 때문이다. VS Code 자체 그림처럼 표시 속성(`fill="var(--vscode-…, #기본값)"`)으로 바꾸니 테마 색으로 나온다. 앞 공백도 SVG에서 접히므로 들여쓰기는 `x` 좌표로 한다. `manifest.test.ts`가 `<style>`·class·style 속성을 막는다.
- 프로필(Core)이 있고 프리셋이 없을 때 환영 화면이 나오고, 열린 폴더(`pyproject.toml`)로 Python · 데이터를 추천한다.
- 상태 표시줄 메뉴: 프리셋이 없으면 시작 방법(추천 먼저) → 전환할 프로필, 있으면 프로필 → 작업(적용에 "프로필 2개를 맞춰야 합니다", 프리셋 편집에 파일 이름) → 더 보기.
- 내장 프리셋으로 시작: 저장 창이 열린 폴더와 `extensions.profile-kit.json`으로 열린다. 만든 뒤 트리 맨 위 줄, 배지 2, 상태 표시줄 `Core ⚠ 4`. 배지는 트리를 열기 전에도 아는 만큼 나온다.
- 맨 위 줄과 메뉴의 적용은 같은 미리보기 창을 연다(취소함). 툴바 "..." 메뉴는 설치 / 프리셋 파일 / 가져오기·내보내기 / 시작하기 안내로 묶여 있다.
- `TreeView.description`(프리셋 파일 이름)은 보이지 않았다. 컨테이너에 뷰가 하나면 VS Code가 머리글을 컨테이너 제목에 합치면서 설명을 버린다. 그래서 파일 경로는 맨 위 줄 툴팁에 넣었다.

아직: 설치 후 프로필 고르기(기록 위치를 묻지 않는 흐름)는 화면으로 보지 않았다(격리 VS Code에서 확장을 새로 받아야 함). 기록 위치는 `addExtension.test.ts`가 모든 조합으로 확인한다.

## 12. 설정에 저장하는 프리셋(Sync) (2026-11-22)

문제(사용자): 저장소에 넣지 않는 개인 프리셋(예: CTF 프로필을 더한 것)은 파일로만 둘 수 있었고, `profileKit.presetPath`는 PC마다 다른 경로라 Sync하지 않으니(`ignoreSync`) 다른 PC로 옮길 방법이 없었다.

| 결정 | 이유 |
| --- | --- |
| 새 설정 `profileKit.preset`(객체, `scope: application`, Sync함)에 프리셋 내용을 그대로 넣는다. 값이 있으면 `presetPath`보다 먼저 쓴다 | Settings Sync가 옮기는 것은 설정·키 바인딩·스니펫 등 정해진 것뿐이고 임의의 파일은 안 옮긴다. application 범위 설정은 Default settings.json에만 저장되고 모든 프로필에서 같은 값으로 읽혀서, 프로필 설정 공유를 끈 이 PC 구성에서도 한 곳에 있다 |
| 확장은 이 설정을 가상 파일 `profile-kit:/synced.profile-kit.json`(FileSystemProvider, `src/ui/syncedPreset.ts`)으로 보여 준다. 읽으면 설정을 2칸 JSON 텍스트로, 저장하면 텍스트를 파싱해 설정에 넣는다 | 설치 후 기록, 관리 화면, 가져오기, 직접 편집이 모두 "URI + 텍스트"로 프리셋을 고친다. 출처만 바꾸면 이 흐름을 그대로 쓴다. 이름이 `*.profile-kit.json`이라 편집기에서 스키마 검사도 붙는다 |
| 문법이 틀린 텍스트는 저장을 거부한다(설정은 JSON 값만 담는다). 프리셋 규칙 위반은 저장하고 파일처럼 "프리셋에 문제" 표시 | 고치는 중간 상태를 저장할 수 있어야 한다. 파일 프리셋과 같은 동작 |
| 저장할 때 주석과 `$schema`는 버린다 | 설정 값에는 주석이 없고 `$schema`는 파일에서만 뜻이 있다 |
| 명령 "프리셋을 설정에 저장(Sync)", "프리셋을 파일로 옮기기...". 다른 파일을 쓰게 되는 모든 흐름(파일 열기, 새 프리셋, 내장 프리셋, 가져오기)은 `Kit.usePreset`에서 확인을 받고 설정의 프리셋을 지운다. 지우기 전에 확장 저장소(`globalStorage/.../synced-preset-backups`)에 사본 | 설정 값이 파일보다 먼저라서 지우지 않으면 새 파일이 안 쓰인다. 지우면 Sync가 다른 PC에서도 지우므로 묻고 사본을 남긴다 |
| CLI: 프리셋 인자를 빼면 Default settings.json의 `profileKit.preset`, 없으면 `presetPath` 파일 | 확장과 같은 프리셋을 새 PC에서 바로 적용(`profile-kit apply --yes`) |

확인(2026-11-22): `npm run check` 통과(테스트 281개, `presetSource.test.ts`). 격리 VS Code 1.147(데이터 폴더 3개 모두 임시)을 `--profile Probe --extensionDevelopmentPath --extensionTestsPath`로 띄운 탐침에서 9개 모두 통과: 프로필 창에서 가상 파일 읽기, JSON으로 열림, 편집·저장이 Default settings.json에 들어가고 프로필 settings.json에는 안 들어감, 문법이 틀린 저장 거부, 바깥에서 settings.json을 고치면(Sync와 같음) 가상 파일과 Kit이 다시 읽음.
아직: 두 PC 사이 실제 Sync, 두 명령의 확인 창은 화면으로 보지 않았다.

## 13. extra의 이유: 의존성·확장 팩, 자기 자신 (2026-11-23)

문제: 실제 PC `verify`에서 Profile Kit 자신이 9개 프로필 모두 extra로 나왔고(CLI만. 트리·관리 화면은 이미 뺐다), VS Code가 다른 확장과 함께 설치한 것
(CTF의 jupyter 팩 4개와 `ms-python.vscode-python-envs`, Java의 `vscjava.vscode-gradle`, Web-JS의 `silvenon.mdx`)이 이유 없이 "프리셋에 없음"이었다.

| 결정 | 이유 |
| --- | --- |
| extra마다 "같은 프로필에 설치된 어떤 확장이 `extensionDependencies`·`extensionPack`으로 이것을 부르는지"를 붙인다(`core/dependencies.ts`). 숨기지 않고 이유만 단다 | 모든 프로필에 적용된 확장(C-2)과 같은 방식. 사용자가 직접 넣은 것과 구분되면 충분하다 |
| 관계는 확장 폴더(`--extensions-dir`, 모든 프로필이 같이 씀)의 폴더마다 `package.json`을 읽어 얻는다(`host/builtins.ts` `readExtensionRelations`). 버전이 여러 개면 합친다. 폴더 이름에 버전이 있어 확장은 폴더별로 캐시한다. 목록을 읽는 폴더는 VS Code의 `extensions.json`이 있는 폴더(실제 경로, 준 폴더 안인지 확인)뿐이고, 각 `package.json`도 실제 경로가 그 안일 때만 같은 함수 안에서 읽는다 | Marketplace 조회는 네트워크가 필요하고 설치된 버전과 다를 수 있다. 이 PC 81개 폴더, package.json 합계 3.8MB. 비공개 의존 11번째로 `compat.ts`에 넣고 호환성 점검에 검사 하나 추가. 경로 확인 순서는 SonarQube S8707이 요구하는 것과 같다. PR #40에서 세 번 분석했다: 파일 읽기는 `readApplicationScoped`와 같은 모양(한 함수 안에서 폴더·파일 실제 경로 → 안쪽 확인 → `readFileSync`)으로 고치니 닫혔고, 사용자가 지정한 폴더의 목록을 읽는 `readdir` 1건은 비교할 신뢰 폴더가 없어 Accept(2026-11-23, 사용자 승인, 9절과 같은 이유) |
| 자기 자신은 extra로 세지 않되, 프리셋에 있으면 present로 센다(`diffExtensions`의 `ignoreExtra`) | 트리는 설치 목록에서 자기 ID를 지워서, 프리셋에 Profile Kit을 넣으면 늘 "빠짐"이 되고 적용할 때마다 설치하려 했다 |
| 예제 프리셋 `web-js`에서 `xyc.vscode-mdx-preview`를 뺐다(Web-JS 34 → 33, 레거시 스크립트도) | 격리 VS Code에서 설치하면 경고 없이 `silvenon.mdx` v0.1.1이 같이 설치된다. Marketplace에서 deprecated이고, 같은 그룹의 `unifiedjs.vscode-mdx`와 `.mdx`를 겹쳐 등록한다 (이슈 #25) |

확인: `npm run check` 통과(테스트 297개). 실제 PC `verify`(읽기만): Profile Kit extra 사라짐, CTF 5개·Java gradle·Web-JS `silvenon.mdx`에 이유가 붙음.
이유가 없는 extra는 Python-Data의 `vscjava.vscode-gradle` 하나(이 프로필에서는 아무 확장도 부르지 않음).
아직: 트리·관리 화면의 새 표시는 화면으로 보지 않았다. 개인 프리셋(`profileKit.preset`, `~/vscode-profiles.json`)의 `web-js`와 실제 Web-JS 프로필의 두 확장은 그대로다.
