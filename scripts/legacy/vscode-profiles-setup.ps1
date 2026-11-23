# VS Code profile setup (ASCII only so it runs on Windows PowerShell 5.1 and 7+)
# Usage:  .\vscode-profiles-setup.ps1 -DryRun   (print what would happen)
#         .\vscode-profiles-setup.ps1           (create profiles + install extensions)
# Notes:
# - Extensions are shared on disk, so profiles only link to what is already downloaded.
# - Nothing is uninstalled. Default profile is NOT modified by this script.
# - Each profile = Core + its own set. A profile named "Core" (Core only) is also created.

param([switch]$DryRun)

$code = Get-Command code -ErrorAction SilentlyContinue
if (-not $code) { Write-Host "ERROR: 'code' CLI not found in PATH. Open VS Code > Ctrl+Shift+P > 'Shell Command' or reinstall with PATH option."; exit 1 }

$core = @(
 'anthropic.claude-code','openai.chatgpt','openai.codex-audio',
 'ms-ceintl.vscode-language-pack-ko','github.github-vscode-theme','woogajjangka.cool-theme-kit',
 'eamodio.gitlens','mhutchie.git-graph','github.vscode-pull-request-github','codezombiech.gitignore','mccarter.start-git-bash',
 'esbenp.prettier-vscode','usernamehw.errorlens','oderwat.indent-rainbow','albert.tabout','wmaurer.change-case',
 'cardinal90.multi-cursor-case-preserve','alefragnani.project-manager','tomoki1207.pdf','mechatroner.rainbow-csv',
 'sonarsource.sonarlint-vscode',
 'ms-vscode-remote.remote-ssh','ms-vscode-remote.remote-ssh-edit','ms-vscode.remote-explorer','ms-vscode-remote.remote-wsl',
 'be5invis.vscode-custom-css','brandonkirbyson.vscode-animations','pkief.material-icon-theme'
)

$sets = [ordered]@{
 'Core'        = @()
 'Python-Data' = @('ms-python.python','ms-python.debugpy','ms-python.vscode-pylance','ms-python.vscode-python-envs','charliermarsh.ruff','ms-python.mypy-type-checker','njpwerner.autodocstring','ms-toolsai.jupyter','ms-toolsai.jupyter-keymap','ms-toolsai.jupyter-renderers','ms-toolsai.vscode-jupyter-cell-tags','ms-toolsai.vscode-jupyter-slideshow','ms-toolsai.datawrangler','janisdd.vscode-edit-csv','qwtel.sqlite-viewer')
 'Java'        = @('redhat.java','vscjava.vscode-java-pack','vscjava.vscode-java-debug','vscjava.vscode-java-dependency','vscjava.vscode-java-test','vscjava.vscode-maven','vscjava.migrate-java-to-azure')
 'C-Cpp'       = @('ms-vscode.cpptools','ms-vscode.cpptools-extension-pack','ms-vscode.cpptools-themes','ms-vscode.cmake-tools','ms-vscode.cpp-devtools','franneck94.c-cpp-runner','vadimcn.vscode-lldb')
 'Web-JS'      = @('dbaeumer.vscode-eslint','christian-kohler.npm-intellisense','ecmel.vscode-html-css','ritwickdey.liveserver','unifiedjs.vscode-mdx')
 'CSharp-Unity'= @('ms-dotnettools.csdevkit','ms-dotnettools.csharp','ms-dotnettools.vscode-dotnet-runtime','visualstudiotoolsforunity.vstuc')
 'Go'          = @('golang.go')
 'Docker-Infra'= @('ms-azuretools.vscode-docker','ms-azuretools.vscode-containers','ms-vscode-remote.remote-containers','confluentinc.vscode-confluent')
}
# Left disabled everywhere (not put in any profile):
# tonybaloney.vscode-pets, huibizhang.codesnap-plus, emilast.logfilehighlighter, github.vscode-github-actions,
# github.codespaces, ms-vscode.remote-repositories, snyk-security.snyk-vulnerability-scanner, ms-vscode.powershell

# 1) Backup of the current extension list
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $PSScriptRoot "extensions-backup-$stamp.txt"
$log = Join-Path $PSScriptRoot "install-log-$stamp.txt"
if ($DryRun) { Write-Host "[dry-run] would write backup: $backup" }
else { & code --list-extensions --show-versions | Out-File -FilePath $backup -Encoding utf8; Write-Host "Backup written: $backup" }

# Helpers: "code --install-extension" does not create profiles, so create them by opening a window with --profile
function Test-Profile($n) {
  $o = (& code --profile $n --list-extensions 2>&1 | Out-String)
  return ($o -notmatch 'not found')
}
function Ensure-Profile($n) {
  if (Test-Profile $n) { return $true }
  Write-Host "  creating profile '$n' (a VS Code window will open; close it later)"
  & code --profile $n --new-window | Out-Null
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if (Test-Profile $n) { return $true }
  }
  return $false
}

# 2) Create profiles and install extensions into each
foreach ($name in $sets.Keys) {
  $ids = @($core + $sets[$name]) | Select-Object -Unique
  Write-Host ""
  Write-Host "== Profile '$name' ($($ids.Count) extensions) =="
  if (-not $DryRun) { if (-not (Ensure-Profile $name)) { Write-Host "  could not create profile '$name', skipping"; continue } }
  foreach ($id in $ids) {
    if ($DryRun) { Write-Host "[dry-run] code --profile $name --install-extension $id"; continue }
    $out = (& code --profile $name --install-extension $id 2>&1 | Out-String)
    Add-Content -Path $log -Value ("[$name] $id`r`n$out") -Encoding utf8
    if ($out -match 'successfully installed|already installed') { Write-Host "  ok: $id" }
    else { Write-Host "  FAILED: $id -> $(($out -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1))" }
  }
}

# 3) Copy settings / keybindings / snippets from Default into each new profile (only when missing)
if (-not $DryRun) {
  $userDir = Join-Path $env:APPDATA 'Code\User'
  $storagePath = Join-Path $userDir 'globalStorage\storage.json'
  $deadline = (Get-Date).AddSeconds(30)
  $profilesInfo = $null
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $storagePath) {
      $storage = Get-Content $storagePath -Raw | ConvertFrom-Json
      if ($storage.userDataProfiles -and (@($storage.userDataProfiles | Where-Object { $sets.Contains($_.name) }).Count -ge $sets.Count)) { $profilesInfo = $storage.userDataProfiles; break }
    }
    Start-Sleep -Seconds 2
  }
  if ($profilesInfo) {
    foreach ($p in ($profilesInfo | Where-Object { $sets.Contains($_.name) })) {
      $dst = Join-Path $userDir "profiles\$($p.location)"
      if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }
      foreach ($f in 'settings.json','keybindings.json') {
        $s = Join-Path $userDir $f; $d = Join-Path $dst $f
        if ((Test-Path $s) -and -not (Test-Path $d)) { Copy-Item $s $d; Write-Host "Copied $f -> $($p.name)" }
      }
      $sn = Join-Path $userDir 'snippets'; $dn = Join-Path $dst 'snippets'
      if ((Test-Path $sn) -and -not (Test-Path $dn)) { Copy-Item $sn $dn -Recurse; Write-Host "Copied snippets -> $($p.name)" }
    }
  } else { Write-Host "WARN: could not read profile locations from storage.json; copy settings via the Profiles UI instead." }
}

# 4) List of extensions to disable in the Default profile
$keep = $core | ForEach-Object { $_.ToLower() }
$toDisable = (& code --list-extensions) | Where-Object { $keep -notcontains $_.ToLower() }
$listPath = Join-Path $PSScriptRoot 'default-profile-disable-list.txt'
if ($DryRun) { Write-Host ""; Write-Host "[dry-run] Default profile would disable $(@($toDisable).Count) extensions" }
else { $toDisable | Out-File -FilePath $listPath -Encoding utf8; Write-Host ""; Write-Host "Default-profile disable list written: $listPath ($(@($toDisable).Count) extensions)" }
Write-Host "Done."
