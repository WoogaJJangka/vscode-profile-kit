# Make every profile share the Default profile's settings / keybindings / snippets / tasks / MCP / prompts,
# restore Default settings.json from a Local History snapshot, and make sure new windows open with "Core".
# Run ONLY with VS Code fully closed. ASCII only. Backups go to .\backup-<stamp>\
param([string]$RestoreFrom = '', [switch]$DryRun)

if (-not $DryRun -and (Get-Process Code -ErrorAction SilentlyContinue)) { Write-Host "ERROR: VS Code is running. Close every VS Code window first."; exit 1 }

$u = Join-Path $env:APPDATA 'Code\User'
$storagePath = Join-Path $u 'globalStorage\storage.json'
$settingsPath = Join-Path $u 'settings.json'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bk = Join-Path $PSScriptRoot "backup-$stamp"
$profileNames = 'Core','Python-Data','Java','C-Cpp','Web-JS','CSharp-Unity','Go','Docker-Infra'
$shared = [ordered]@{ settings = $true; keybindings = $true; snippets = $true; tasks = $true; mcp = $true; prompts = $true }

if (-not $DryRun) {
  New-Item -ItemType Directory -Path $bk -Force | Out-Null
  Copy-Item $storagePath (Join-Path $bk 'storage.json')
  Copy-Item $settingsPath (Join-Path $bk 'settings.json')
  Write-Host "Backup: $bk"
}

# 1) Restore Default settings.json from a snapshot (optional)
if ($RestoreFrom) {
  if (-not (Test-Path $RestoreFrom)) { Write-Host "ERROR: snapshot not found: $RestoreFrom"; exit 1 }
  if ($DryRun) { Write-Host "[dry-run] would restore settings.json from $RestoreFrom" }
  else { Copy-Item $RestoreFrom $settingsPath -Force; Write-Host "Restored Default settings.json from $RestoreFrom" }
}

# 2) window.newWindowProfile = Core (insert after the first '{' if missing)
$txt = [IO.File]::ReadAllText($settingsPath)
if ($txt -notmatch '"window\.newWindowProfile"') {
  $i = $txt.IndexOf('{')
  $txt = $txt.Substring(0, $i + 1) + "`r`n    `"window.newWindowProfile`": `"Core`"," + $txt.Substring($i + 1)
  if ($DryRun) { Write-Host "[dry-run] would add window.newWindowProfile = Core" }
  else { [IO.File]::WriteAllText($settingsPath, $txt, (New-Object Text.UTF8Encoding($false))); Write-Host "Added window.newWindowProfile = Core" }
} else { Write-Host "window.newWindowProfile already set: $([regex]::Match($txt, '"window\.newWindowProfile"\s*:\s*"[^"]*"').Value)" }

# 3) useDefaultFlags on each profile in storage.json
$storage = Get-Content $storagePath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($p in $storage.userDataProfiles) {
  if ($profileNames -notcontains $p.name) { continue }
  $flags = New-Object PSObject
  if ($p.useDefaultFlags) { $p.useDefaultFlags.PSObject.Properties | ForEach-Object { $flags | Add-Member -NotePropertyName $_.Name -NotePropertyValue $_.Value } }
  foreach ($k in $shared.Keys) { $flags | Add-Member -NotePropertyName $k -NotePropertyValue $true -Force }
  $p | Add-Member -NotePropertyName useDefaultFlags -NotePropertyValue $flags -Force
  Write-Host "  $($p.name): shares $((@($flags.PSObject.Properties.Name)) -join ', ')"
}
if ($DryRun) { Write-Host "[dry-run] storage.json not written" }
else {
  $json = $storage | ConvertTo-Json -Depth 100
  $null = $json | ConvertFrom-Json   # sanity check
  [IO.File]::WriteAllText($storagePath, $json, (New-Object Text.UTF8Encoding($false)))
  Write-Host "storage.json updated"
}
Write-Host "Done."
