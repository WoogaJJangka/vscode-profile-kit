# Copy the Core profile's extensions into every other purpose profile (add only, never removes).
# Usage: install a new extension in the Core profile, then run  .\sync-core-extensions.ps1
# ASCII only. Works while VS Code is open.
param([switch]$DryRun)

$targets = 'Python-Data','Java','C-Cpp','Web-JS','CSharp-Unity','Go','Docker-Infra'
function Get-Installed($n) { @(& code --profile $n --list-extensions 2>$null | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ -match '\.' }) }

$core = Get-Installed 'Core'
Write-Host "Core has $($core.Count) extensions"
foreach ($t in $targets) {
  $have = Get-Installed $t
  $missing = @($core | Where-Object { $have -notcontains $_ })
  Write-Host "[$t] missing $($missing.Count)"
  foreach ($id in $missing) {
    if ($DryRun) { Write-Host "  [dry-run] $id"; continue }
    $out = (& code --profile $t --install-extension $id 2>&1 | Out-String)
    if ((Get-Installed $t) -contains $id) { Write-Host "  ok: $id" } else { Write-Host "  FAILED: $id" }
  }
}
Write-Host "Done."
