# Repair: restore Default profile from the original backup, then fill missing extensions in each profile.
# ASCII only. Nothing is uninstalled. Retries up to 3 passes, verifying with --list-extensions.
param([switch]$DryRun)

$dir = $PSScriptRoot
$backupFile = Join-Path $dir 'extensions-backup-20261120-150004.txt'
$log = Join-Path $dir ("repair-log-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".txt")

# Load $core / $sets from the setup script (top part only)
$src = Get-Content (Join-Path $dir 'vscode-profiles-setup.ps1') -Raw
$block = ($src -split '# Left disabled everywhere')[0]
$block = $block.Substring($block.IndexOf('$core = @('))
Invoke-Expression $block

function Get-Installed($profileName) {
  if ($profileName) { $l = & code --profile $profileName --list-extensions 2>$null } else { $l = & code --list-extensions 2>$null }
  return @($l | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ -match '\.' })
}

function Install-Missing($profileName, $wanted) {
  # $wanted: array of 'id' or 'id@version'
  for ($pass = 1; $pass -le 3; $pass++) {
    $have = Get-Installed $profileName
    $missing = @($wanted | Where-Object { $have -notcontains (($_ -split '@')[0].ToLower()) })
    $label = if ($profileName) { $profileName } else { 'Default' }
    Write-Host "[$label] pass $pass : missing $($missing.Count)"
    if ($missing.Count -eq 0) { return }
    foreach ($id in $missing) {
      if ($DryRun) { Write-Host "  [dry-run] install $id"; continue }
      if ($profileName) { $out = (& code --profile $profileName --install-extension $id 2>&1 | Out-String) }
      else { $out = (& code --install-extension $id 2>&1 | Out-String) }
      Add-Content -Path $log -Value ("[$label] $id`r`n$out") -Encoding utf8
    }
    if ($DryRun) { return }
    Start-Sleep -Seconds 5
  }
  $have = Get-Installed $profileName
  $left = @($wanted | Where-Object { $have -notcontains (($_ -split '@')[0].ToLower()) })
  if ($left.Count) { Write-Host "  STILL MISSING: $($left -join ', ')" }
}

# 1) Default profile: everything from the original backup (pinned versions -> reuses files already on disk)
$orig = @(Get-Content $backupFile | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '\.' })
Install-Missing $null $orig

# 2) Each profile: Core + its set
foreach ($name in $sets.Keys) { Install-Missing $name (@($core + $sets[$name]) | Select-Object -Unique) }

# 3) Regenerate the Default disable list from the ORIGINAL backup (not the live list)
$keep = $core | ForEach-Object { $_.ToLower() }
$toDisable = $orig | ForEach-Object { ($_ -split '@')[0] } | Where-Object { $keep -notcontains $_.ToLower() }
if (-not $DryRun) { $toDisable | Out-File -FilePath (Join-Path $dir 'default-profile-disable-list.txt') -Encoding utf8 }
Write-Host "Disable list: $(@($toDisable).Count) extensions"
Write-Host "Done."
