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
- Cool Theme Kit(woogajjangka.cool-icon-vscode, 내가 만든 확장) 테마가 각 프로필에서 보이게 한다: workbench.colorTheme="Cool Islands Dark", workbench.iconTheme="a-file-icon-vscode", workbench.productIconTheme="cool-islands-product-icons".

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
