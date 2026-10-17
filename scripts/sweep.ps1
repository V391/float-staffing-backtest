# Backtests simulated agencies of different sizes (offline, nothing is sent to Float).
#   powershell -File scripts/sweep.ps1                              all sizes, experience-driven staffing
#   powershell -File scripts/sweep.ps1 -Staffing title -Scales 1,4,9   the control: past work plays no part
param(
  [int[]]$Scales = @(1, 2, 4, 6, 9),
  [int[]]$Seeds = @(101, 202, 303),
  [ValidateSet('experience', 'title')][string]$Staffing = 'experience'
)
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')
$suffix = if ($Staffing -eq 'title') { '-title' } else { '' }
foreach ($scale in $Scales) {
  foreach ($seed in $Seeds) {
    $dir = "out/sim-$scale-s$seed$suffix"
    if (Test-Path "$dir/backtest.json") { continue }
    npx tsx src/world.ts --scale=$scale --seed=$seed --staffing=$Staffing --out=$dir | Out-Null
    npx tsx src/simexport.ts --in=$dir/world.json | Out-Null
    npx tsx src/backtest.ts --in=$dir/float-export.json --report=$dir/backtest.json --no-live | Out-Null
    Write-Output "done scale=$scale seed=$seed staffing=$Staffing"
  }
}
npx tsx src/sweep-summary.ts
