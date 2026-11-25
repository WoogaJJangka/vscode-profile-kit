# 게시 절차 (VS Code Marketplace, Trusted Publishing)

게시 인증은 PAT 없이 GitHub Actions OIDC(`vsce publish --oidc`)로 한다. Azure DevOps 전역 PAT는 2026-12-01에 폐기된다.
워크플로는 `.github/workflows/release.yml`이다. 계정·publisher·정책 작업과 태그 push는 사용자가 직접 한다.

출처: [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), [vsce README](https://github.com/microsoft/vscode-vsce).

## 한 번만 하는 준비

1. publisher 만들기: <https://marketplace.visualstudio.com/manage>에서 Microsoft 계정으로 로그인하고 publisher를 만든다.
   ID는 `package.json`의 `publisher`와 같아야 한다(지금 `woogajjangka`). 다르게 만들었으면 `package.json`을 고친다.
2. Trusted Publishing 정책: 같은 페이지에서 publisher → **Trusted Publishing** → **Create**.
   | 칸               | 값                   |
   | ---------------- | -------------------- |
   | Policy name      | `Release workflow`   |
   | Repository owner | `WoogaJJangka`       |
   | Repository       | `vscode-profile-kit` |
   | Workflow         | `release.yml`        |
   | Environment      | `marketplace`        |
   - 저장소가 private이면 정책을 만든 뒤 **48시간 안에** 워크플로를 한 번 성공시켜야 정책이 활성화된다(첫 토큰 교환 때 고정).
     그러니 정책은 첫 게시 직전에 만든다.
3. GitHub environment(권장): 저장소 Settings → Environments → `marketplace`를 만들고 Required reviewers에 본인을 넣는다.
   그러면 태그를 push해도 승인하기 전에는 게시되지 않는다. 만들지 않으면 첫 실행 때 보호 규칙 없는 environment가 자동으로 생긴다.
   - private 저장소에서 environment 보호 규칙은 GitHub Pro 이상에서만 쓸 수 있다. 무료 계정이면 승인 단계 없이 태그 push가 곧 게시다.
   - 이 저장소는 Deployment branches and tags를 "Selected branches and tags" + 태그 `v*`로 두었다(2026-11-21). 다른 브랜치·태그에서 도는 job은 이 environment를 쓸 수 없다.

## 매번 하는 게시

1. `package.json`의 `version`과 `CHANGELOG.md`를 고치고 PR로 main에 머지한다.
   - minor가 홀수(0.1.x, 0.3.x)면 pre-release, 짝수면 정식으로 게시된다(Marketplace 권장 방식). Marketplace는 `1.0.0-beta` 같은 semver pre-release 표기를 받지 않는다.
2. 로컬에서 미리 확인: `npm run check`, `npx vsce package --no-dependencies --pre-release -o <tmp>/x.vsix`,
   격리 VS Code에 설치 `code --user-data-dir <tmp>/u --extensions-dir <tmp>/x --shared-data-dir <tmp>/s --install-extension <tmp>/x.vsix`.
   창이 있어야 하는 흐름은 통합 테스트로 본다: `npm run build`, `npm run build:integration`,
   `node out/integration/run.js` (`docs/PLAN.md` 14절, 약 2분, 창이 열렸다가 스스로 닫힌다).
3. main의 머지 커밋에 태그를 달고 push한다(태그 = `v` + version).
   ```powershell
   git switch main; git pull --ff-only; git tag v0.1.0; git push origin v0.1.0
   ```
4. Actions의 Release 실행을 environment 승인 화면에서 승인한다. 워크플로는 점검 → 태그·버전 비교 → VSIX 만들기(artifact로도 올림) → `vsce publish --oidc` 순서로 돈다.
5. 실패하면: 태그와 version이 다르면 태그를 지우고(`git push origin :refs/tags/v0.1.0`) 다시 단다.
   OIDC 교환 실패는 PAT로 대신 게시하지 않는다(vsce도 대신하지 않는다). 정책의 owner·repository·workflow·environment 철자를 먼저 본다.

## Open VSX

- VSCodium, Cursor 같은 VS Code 호환 편집기는 Microsoft Marketplace 대신 Open VSX를 쓴다. 이 확장을 그쪽에서도 쓰려면 따로 게시해야 한다.
- Open VSX도 Trusted Publishing을 지원한다(`npx ovsx publish --trusted-publishing`, 서버 쪽 [eclipse-openvsx/openvsx#1980](https://github.com/eclipse-openvsx/openvsx/pull/1980)).
  다만 Eclipse 계정과 Publisher Agreement 서명, namespace 만들기가 먼저 필요하다([Publishing Extensions](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions)).
- 지금은 필요하지 않다고 본다. 이 PC에서는 VS Code만 쓰고, 첫 게시는 pre-release다. 필요해지면 `release.yml`에 job을 하나 더 넣는다.
