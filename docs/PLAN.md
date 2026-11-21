# VS Code 프로필 프리셋 프로젝트 - 작업 내용 정리 (2026-11-20 기준)

## 1. 배경과 목표
- 설치된 확장 79개 중 공통 기본만 남기고, 나머지는 용도별 프로필에서만 쓰고 싶다.
- 최종 목표: 이 과정을 "선언형 프리셋 하나로 프로필을 만들고 맞춰 주는 도구"로 만들어 Git에 올리고, 가능하면 VS Code 확장으로 배포한다.

## 2. 지금까지 결정한 구성
- 방식: VS Code 내장 Profiles 사용 (별도 전환 확장은 쓰지 않음)
- 프로필 8개: Core(공통만), Python-Data, Java, C-Cpp, Web-JS, CSharp-Unity, Go, Docker-Infra. 각 프로필 = Core 27개 + 용도별 확장
- Core 27개: Claude Code, ChatGPT/Codex(2), 한국어 언어팩, GitHub 테마, Cool Theme Kit(woogajjangka.cool-icon-vscode, 직접 만든 확장), GitLens, Git Graph, GitHub PR, gitignore, Git Bash, Prettier, ErrorLens, indent-rainbow, tabout, change-case, multi-cursor-case, Project Manager, PDF, Rainbow CSV, SonarLint, Remote SSH/SSH-Edit/Explorer/WSL, custom-css, animations
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
- [ ] 배포: publisher 생성과 계정 작업은 사용자가 직접

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
