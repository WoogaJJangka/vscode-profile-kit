# 로드맵 (Phase 0~5와 게이트)

원래 `Documents/vscode-profiles-setup/CLAUDE_CODE_PROMPT.md` 로 쓴 작업 지시. 진행 상태는 CLAUDE.md "진행 상태"에 적는다.

```
너는 이 폴더(vscode-profiles-setup)에서 이어서 일하는 시니어 엔지니어야. 한국어로 답해줘.

## 먼저 읽을 것
PLAN.md (최신 작업 정리, 4-2의 Default 변화는 의도된 것), HANDOFF.md, vscode-profiles-setup.ps1, repair-extensions.ps1, share-settings.ps1, sync-core-extensions.ps1, extensions-backup-20261120-150004.txt (원본 백업, 롤백 기준), 그리고 최근 로그(run-output2.txt, repair-log-*.txt).
읽고 나서 현재 상태를 5줄 이내로 요약하고 시작해줘.

## 목표
VS Code 프로필 프리셋 도구를 제대로 된 프로젝트로 만든다: 선언형 프리셋 하나로 "공통(core) + 용도별 그룹"을 정의하면, 프로필 생성, 확장 설치, 설정 공유, 누락 점검까지 해주는 도구. Git/GitHub에 올리고, 타당하면 VS Code 확장으로 배포한다.

## 진행 순서 (각 단계 끝에 결과를 보고하고, 표시한 게이트에서는 내 확인을 받고 진행)

### Phase 0. 현재 상태 확인
- 내 PC의 Default 프로필 현재 상태를 확인해 보고한다: `code --list-extensions` 개수와 목록, settings.json 상태. Default가 원본 백업(79개)과 다른 것은 내가 다른 PC에서 정리한 결과라서 의도된 변경이다. 원인을 조사하거나 되돌리려 하지 마.
- repair-extensions.ps1은 Default를 원본 백업 기준으로 되돌리게 되어 있어 내 의도와 충돌할 수 있고, Settings Sync가 켜져 있으면 되돌린 상태가 다른 PC로 전파될 수 있다. Default 단계는 실행하지 말고, 쓸지 말지 나에게 먼저 묻는다. [게이트 1]

### Phase 1. 현재 PC 마무리
- repair-extensions.ps1 실행 결과를 검증하고, 프로필별 확장 개수가 PLAN.md의 목표(Core 27, Python-Data 42, Java 34, C-Cpp 34, Web-JS 33, CSharp-Unity 31, Go 28, Docker-Infra 31, 의존성 때문에 약간 더 많을 수 있음)와 맞는지 확인한다.
- 실패 항목은 로그로 원인을 분류한다(네트워크/DNS, 이미 설치됨, 기타).
- share-settings.ps1은 반드시 -DryRun부터 보여주고, storage.json 직접 편집(useDefaultFlags)의 위험을 설명한 뒤 내 승인 후 실행한다. 실행 전 VS Code가 완전히 종료돼 있어야 한다. [게이트 2]
- Cool Theme Kit(woogajjangka.cool-theme-kit, 내가 만든 확장) 테마가 각 프로필에서 보이게 한다: workbench.colorTheme="Cool Islands Dark", workbench.iconTheme="a-file-icon-vscode", workbench.productIconTheme="cool-islands-product-icons".

### Phase 2. 타당성 검증 (결정 게이트)
조사 결과: VS Code 확장 API는 프로필 관련 기능을 노출하지 않고, 다른 확장을 비활성화하는 API도 없다. 따라서 아래를 실제로 실험해서 확인하고 표로 보고해줘.
1. 확장에서 child_process로 `code --profile <이름> --install-extension` / `--list-extensions` 호출이 되는가 (Windows 우선, mac/Linux 경로도 고려)
2. 프로필이 없을 때 `code --profile <이름> --new-window`로 생성되는가, 생성 확인에 쓸 수 있는 안정적 방법은 무엇인가
3. 현재 창의 프로필 이름을 알 수 있는가 (storage.json 읽기 등 우회 방법의 안정성)
4. 프로필 전환을 확장에서 트리거할 수 있는가 (내부 커맨드 ID 존재 여부와 불안정성)
5. 폴더와 프로필 연결을 확장이 만들거나 읽을 수 있는가
결과로 구조를 추천해줘. 후보: A) Node CLI + 얇은 확장 UI, B) 순수 확장, C) 저장소만(스크립트 + .code-profile 템플릿 + 문서). 내가 고르기 전에는 구현하지 않는다. [게이트 3]

### Phase 3. 설계 (선택된 구조 기준)
- 프리셋 스키마(JSON, JSON Schema 제공): core[], groups{이름:[확장ID]}, profiles{이름:{groups:[...], shareFromDefault:{settings,keybindings,snippets,tasks}}}
- 동작: apply(--dry-run 지원), verify(선언 vs 실제 diff), retry(백오프, 네트워크 오류 분류), export(현재 구성에서 프리셋 초안 생성), open(폴더를 프로필로 열기)
- 이번에 겪은 문제를 설계에 반영: 프로필은 `--install-extension` 전에 존재해야 함, `$LASTEXITCODE`가 아닌 출력 파싱으로 성공 판정, `getaddrinfo ENOTFOUND marketplace.visualstudio.com` 같은 일시 오류는 재시도, 실패 목록 리포트, Default 프로필은 절대 기본 동작으로 수정하지 않음(명시적 플래그와 백업 필수), 모든 변경 전 백업.
- 크로스 플랫폼(Windows/mac/Linux)과 PowerShell 5.1 호환(ASCII only) 고려.

### Phase 4. 저장소와 구현
- 새 하위 폴더(또는 새 폴더)에 프로젝트를 만들고 git init. TypeScript, esbuild, 단위 테스트(프리셋 파싱, diff, 재시도 로직), lint, GitHub Actions CI(lint/test/package).
- LICENSE는 MIT로 하되 확정 전에 나에게 확인. README는 한국어/영어, CHANGELOG, .vscodeignore, 아이콘은 자리표시자.
- .gitignore: extensions-backup-*, install-log-*, repair-log-*, run-output*, backup-*, 개인 경로/계정 정보가 담긴 파일은 커밋하지 않는다. 커밋 전에 git status와 diff로 개인정보가 없는지 점검한다.
- 작은 단위로 커밋(conventional commits). GitHub 저장소 생성은 gh CLI로 하되 이름과 공개 여부(처음엔 private 권장)를 먼저 나에게 물어본다. push는 내 승인 후에만. [게이트 4]

### Phase 5. 배포 준비
- `@vscode/vsce`로 `vsce package` 까지 만들어 로컬 설치 테스트(`code --install-extension <vsix>`).
- 배포 인증은 전역 PAT 방식이 권장되지 않고 2026-12-01에 폐기될 예정이므로, GitHub Actions Trusted Publishing(OIDC, `vsce publish --oidc`) 기준으로 워크플로를 설계한다. Open VSX 게시는 별도로 공식 문서를 확인해서 필요 여부를 알려줘.
- publisher 생성, 토큰/정책 설정, 계정 로그인, 최종 `publish`는 내가 직접 한다. 너는 필요한 절차를 순서대로 안내만 하고 자격 증명은 절대 요청하거나 입력하지 않는다. 첫 게시는 pre-release(0.1.0)로. [게이트 5]

## 규칙
- 내 확장은 절대 uninstall하지 않는다. Default 프로필 변경, storage.json/state.vscdb 직접 편집, git push, 게시는 반드시 사전 확인을 받는다.
- 되돌릴 수 있도록 항상 백업을 먼저 만든다(원본 롤백 기준: extensions-backup-20261120-150004.txt).
- 모르는 것은 추측하지 말고 실험이나 공식 문서로 확인한다. 문서에 없으면 "문서에 없음"이라고 말해줘.
- 각 Phase 끝에 한 문단 요약 + 다음 단계 제안. 긴 로그는 파일로 저장하고 요약만 보여줘.
- TodoWrite로 진행 상황을 관리해줘.
```

## 참고 링크 (Claude Code가 필요하면 참고)
- 프로필: https://code.visualstudio.com/docs/configure/profiles
- Settings Sync: https://code.visualstudio.com/docs/configure/settings-sync
- 확장 게시: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- 선행 사례: https://github.com/aaronpowell/vscode-profile-switcher , https://github.com/robole/vscode-profile-status , https://github.com/zokugun/vscode-vsix-manager

## 2026-11-21 계획 변경: GUI 중심 (M0~M7)

사용자가 새 목표를 줬다: 확장을 설치할 때 넣을 프로필을 고르고 추천받기, 프로필 사이 쉬운 전환, VS Code 전역 설정과 프로필별 추가 설정 같이 쓰기. 모든 기능은 GUI로 보여야 한다.
구조는 "확장이 주 화면, `src/core`·`src/host`는 CLI와 공유"로 바꿨다. 위 Phase 0~5의 규칙과 게이트(Default 변경, push, 게시는 사전 확인)는 그대로다.

| 단계 | 내용 | 상태 |
|------|------|------|
| M0 | Phase 2 실험 (격리 VS Code). 결과는 `docs/PLAN.md` 8절 | 완료 |
| M1 | core: 프리셋 `settings`·`match`, 추천, 설정 합치기, 프리셋 편집, storage.json 읽기, 폴더 추천 | 완료 |
| M2 | host + CLI `apply` (미리보기, `--yes`) | 완료 |
| M3 | GUI: 프로필 트리, 상태 표시줄, 전환, 누락 설치, 적용 | 완료 |
| M4 | 설치 후 알림, Install to Profiles, 프리셋 갱신 | 완료 |
| M5 | 관리 화면 (확장 매트릭스, 설정 표) | 완료 |
| M6 | 폴더 추천 | 완료 |
| M7 | 문서, 한국어 UI | 완료 |

게이트는 모두 지났다(2026-11-27 기준): Phase 0/1 확인과 실제 VS Code에 `apply --yes`(2026-11-21), Phase 5 게시(0.1.0 pre-release와 정식 1.0.0 2026-11-21, 최신 정식은 1.4.0 2026-11-25, 최신 pre-release는 1.5.0 2026-11-27).
그 뒤의 계획과 남은 일은 `docs/REVIEW-2026-11-21.md`와 CLAUDE.md "진행 상태"에 있다.

## 2026-11-25 다음 방향: 1.4.0 ~ 1.6.0

출발점(main `7e3eb2c`): `src` 7,390줄, 단위 테스트 300개, 열린 이슈·PR 0. 정식은 1.0.0이고 1.1.0~1.3.2의 내용(메뉴, 설정에 저장하는 프리셋, extra의 이유, 변경 작업 하나씩)은 pre-release에만 있다.
사용자 결정(2026-11-25): 아래 방향으로 가고 1.4.0 준비부터 시작한다. 규칙과 게이트(Default 변경, push, 게시는 사전 확인)는 그대로다. minor 홀수 = pre-release, 짝수 = 정식.

| 버전 | 내용 | 상태 |
|------|------|------|
| 1.4.0 정식 | 새 기능 없음. pre-release에만 있던 것을 정식으로 올린다. 그 전에 화면으로 보지 않은 흐름 5개를 확인하고, 호환성 점검에 macOS를 넣는다 | 게시(2026-11-25) |
| 1.5.x pre-release | 빠르고 가볍게(설치 목록을 파일에서 읽기, 새 프리셋 기본 위치를 설정으로) + extra를 실제로 처리(트리에서 프리셋에 추가, 프리셋 점검, `.vscode/extensions.json` 연동) | 진행 중: 1.5.0 게시(2026-11-27): 설치 목록을 파일에서 읽기와 목록 파일 감시(PR #53·#54). 나머지 후보는 아래 |
| 1.6.0 정식 | 1.5.x 안정화 | 계획 |
| 그 뒤 | 버전 고정·pre-release 선언(`id@1.2.3`), 단축키·스니펫 선언, 팀용 프리셋 상속 | 후보 |

### 1.4.0 할 일

1. 통합 테스트(`scripts/integration/`): 격리 VS Code(데이터 폴더 3개 모두 임시)에서 확장을 띄우고 실제 명령을 돌린다. 8·12절에서 임시 탐침으로 하던 확인을 저장소에 고정한다. 대상은 `docs/PLAN.md`에 "화면으로 보지 않았다"로 남은 다섯 가지:
   설치 후 프로필 고르기(기록 위치를 묻지 않는 흐름, 11절), 프리셋을 설정에 저장·파일로 옮기기의 확인 창(12절), 트리·관리 화면의 extra 이유 표시(13절), 여러 창에서 설치 알림이 한 번만(P6), 두 번 누르기 막기(1.3.2).
   → 2026-11-25 이 PC(Windows, VS Code 1.147)에서 검사 31개 통과. 그 과정에서 설치 알림 버그 둘을 찾아 고쳤다(`docs/PLAN.md` 14절). CI(`integration.yml`) 첫 실행(PR #50)에서 Linux·Windows 모두 31개 통과.
2. `compat.yml`에 macOS 최신 stable 추가. 지금은 실제 VS Code로 Linux·Windows만 돈다. → 워크플로에 넣었다. 첫 실행(PR #50)에서 14개 모두 통과.
3. 확인이 끝나면 version 1.4.0 + CHANGELOG(`[Unreleased]` 포함) PR → 태그 `v1.4.0`(게시, 사용자 승인). → PR #50·#51 머지, 태그 `v1.4.0` push, Release 성공(2026-11-25). Open VSX는 넣지 않았다.
   그 전에 볼 것: Open VSX를 할지(아래 "정하지 않은 것"). CI의 통합 테스트와 macOS 호환성 점검 첫 결과는 위에 적었다.

### 1.5.x 후보와 근거

- **설치 목록을 파일에서 읽기**: 프로필 폴더의 `extensions.json` + Default의 "모든 프로필에 적용" 항목이 `code --list-extensions --profile X`와 같다. 이 PC(VS Code 1.147, Windows)에서 Core 30 = 30, CTF 49 = 49, 차이 0(2026-11-25, 읽기만). CLI는 프로필당 약 0.8초에 프로세스 하나.
  되면 `Kit.listAll`·동시 3개 제한이 필요 없고, 창을 열자마자 배지가 전체 프로필 기준으로 맞고, 파일 watcher로 다른 프로필의 설치도 바로 보인다. 같은 형식을 Default 쪽에서 이미 읽는다(`compat.ts`의 `isApplicationScoped`).
  설치 후 알림(`InstallWatcher`)도 이 목록으로 판정하면, 창이 밖에서 설치한 확장을 놓쳤을 때 팩의 멤버를 묻는 일이 없어진다(`docs/PLAN.md` 14절 "찾은 것" 5, 통합 테스트가 가끔 실패하는 원인). 사용자 결정(2026-11-25): 1.4.0에서는 두고 여기서 고친다.
  확인할 것: VS Code 1.95와 Linux에서도 같은지(호환성 점검에 검사 추가). 확장을 Default와 공유하는 프로필(`useDefaultFlags.extensions`, 이 PC의 `Agents`)은 프로필 폴더에 파일이 없으니 Default 목록을 쓴다. CLI는 대체 경로와 설치 후 확인용으로 남긴다.
  → 2026-11-26 구현(브랜치 `feat/installed-lists-from-files`, `docs/PLAN.md` 15절): 이 PC의 프로필 11개 모두 파일 목록 = CLI 목록(VS Code 1.148.0), `Kit.listAll`·동시 3개 제한 삭제, 호환성 점검에 비교 3개, 설치 알림은 프로필 목록과 확장 폴더의 package.json으로 판정(14절 "찾은 것" 5 고침), 통합 테스트 33개 8번 중 8번 통과.
  PR #53의 CI(2026-11-26): 호환성 점검의 비교 3개가 VS Code 1.95.0·Linux·macOS에서도 통과했고, 통합 테스트 33개가 Linux·Windows에서 통과했다. 남은 것: 파일 watcher(다른 프로필의 설치를 바로 보기, 창이 설치를 전부 놓쳤을 때의 알림)는 넣지 않았다.
  PR #53은 같은 날 머지했다(main `789a128`).
  → 파일 watcher는 같은 날 PR #54로 넣었다(`docs/PLAN.md` 15-1절): 목록 파일 두 곳을 감시해 쓰인 프로필만 다시 읽고, 목록이 쓰인 것도 설치 알림을 볼 계기로 쓴다. 이 PC에서 통합 테스트 35개 6번 중 6번 통과(#53이 머지된 뒤 main 위로 옮기기 전 3번, 옮긴 뒤 3번).
  PR #54의 CI(2026-11-26): 통합 테스트 35개가 Linux·Windows에서 통과했다(Linux에서도 워크스페이스 밖 폴더의 감시가 동작한다). 같은 날 머지했다(main `5958b10`). 남은 것: VS Code 1.95.0과 macOS에서의 감시는 확인하지 않았다(통합 테스트가 거기서는 돌지 않는다).
- **새 프리셋의 기본 위치를 설정(`profileKit.preset`)으로**: 내장 프리셋을 고르면 파일 저장 창이 먼저 뜬다. 설정에 바로 넣으면 첫 단계의 질문이 하나 줄고 Sync도 된다. 파일은 "프리셋을 파일로 옮기기"를 고른 사람만 쓴다.
- **트리의 extra 항목에 "프리셋에 추가"**: 지금은 관리 화면의 표에서만 할 수 있고 트리의 extra에는 동작이 없다.
- **프리셋 점검**: Marketplace에 없는 ID(옛 `cool-icon-vscode`가 새 PC에서 설치 실패한 일), 그룹 사이 중복, 쓰지 않는 그룹, Sync의 프로필 20개 한도. 없는 ID는 지금의 Marketplace 조회로 알 수 있다(`docs/PLAN.md` 8절 #7). deprecated 표시(이슈 #25의 남은 항목)는 어디서 읽을지 확인하지 않았다.
- **`.vscode/extensions.json` 연동**: 폴더의 `recommendations`와 프로필의 확장이 겹치는 정도로 프로필을 추천하고(`match.files` 없이도), 이 프로필에 없는 추천 확장은 "프로필에 설치..."로 넘긴다. 공개 형식이라 비공개 의존이 늘지 않는다.
- **쓰이지 않는 프리셋 키**: `shareFromDefault`의 `keybindings`·`snippets`·`tasks`는 검사와 `.code-profile` 내보내기에만 쓰이고 `apply`는 `settings`만 본다. 미리보기에 "VS Code 설정과 다름"을 알리거나 문서에 적는다.

### 정하지 않은 것 (사용자 결정)

- **uninstall 규칙**: "확장 교체 선언(옛 ID → 새 ID) + 사용자가 항목마다 누를 때만 제거"를 넣으려면 "확장을 제거하지 않는다"를 바꿔야 한다. Cool Theme Kit ID 변경, MDX 교체, Default 정리 세 번 모두 예외로 손으로 했다. 자동으로 맞춰 지우는 방식은 넣지 않는다(`docs/REVIEW-2026-11-21.md` 6절).
- **Open VSX**: `docs/REVIEW-2026-11-21.md` 단계 E에서 "다음 정식을 낼 때 같이 정한다"로 미뤘다. 1.4.0에는 넣지 않았다(2026-11-25). 할지는 아직 정하지 않았다. Cursor·VSCodium은 CLI 이름과 데이터 폴더가 달라 `compat.ts`의 비공개 의존 11개를 fork마다 다시 확인해야 한다.
