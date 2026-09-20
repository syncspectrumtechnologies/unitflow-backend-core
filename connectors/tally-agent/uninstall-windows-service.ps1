param(
  [string]$TaskName = "UnitFlow Tally Agent",
  [switch]$RemoveFiles,
  [string]$InstallDir = "$env:ProgramData\UnitFlow\TallyAgent"
)

$ErrorActionPreference = "Stop"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

if ($RemoveFiles -and (Test-Path -LiteralPath $InstallDir)) {
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
}

Write-Host "Removed $TaskName."
