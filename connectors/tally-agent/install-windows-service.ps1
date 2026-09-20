param(
  [Parameter(Mandatory = $true)][string]$CoreApiBaseUrl,
  [Parameter(Mandatory = $true)][string]$ConnectorToken,
  [string]$TallyHttpUrl = "http://localhost:9000",
  [int]$IntervalMinutes = 15,
  [string]$InstallDir = "$env:ProgramData\UnitFlow\TallyAgent",
  [string]$TaskName = "UnitFlow Tally Agent",
  [string]$NodePath = "node",
  [bool]$PullInbound = $true,
  [bool]$SyncVouchers = $true
)

$ErrorActionPreference = "Stop"

if ($IntervalMinutes -lt 5) {
  throw "IntervalMinutes must be 5 or higher."
}

if (-not (Get-Command $NodePath -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found. Install Node 22 LTS, or pass -NodePath with the full node.exe path."
}

$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logsDir = Join-Path $InstallDir "logs"
$envPath = Join-Path $InstallDir "unitflow-tally-agent.env"
$runnerPath = Join-Path $InstallDir "run-unitflow-tally-agent.ps1"

New-Item -ItemType Directory -Force $InstallDir, $logsDir | Out-Null
Copy-Item -Force (Join-Path $sourceDir "tally-agent.mjs") (Join-Path $InstallDir "tally-agent.mjs")
Copy-Item -Force (Join-Path $sourceDir "package.json") (Join-Path $InstallDir "package.json")
if (Test-Path (Join-Path $sourceDir "package-lock.json")) {
  Copy-Item -Force (Join-Path $sourceDir "package-lock.json") (Join-Path $InstallDir "package-lock.json")
}

@"
UNITFLOW_CORE_API_BASE_URL=$CoreApiBaseUrl
UNITFLOW_TALLY_CONNECTOR_TOKEN=$ConnectorToken
TALLY_HTTP_URL=$TallyHttpUrl
TALLY_SYNC_LIMIT=500
TALLY_SYNC_VOUCHERS=$SyncVouchers
TALLY_PULL_INBOUND=$PullInbound
"@ | Set-Content -LiteralPath $envPath -Encoding UTF8

icacls $envPath /inheritance:r | Out-Null
icacls $envPath /grant:r "Administrators:F" "SYSTEM:F" "$env:USERNAME:R" | Out-Null

@'
$ErrorActionPreference = "Stop"
$installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $installDir "unitflow-tally-agent.env"
$logDir = Join-Path $installDir "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null

Get-Content -LiteralPath $envPath | ForEach-Object {
  if ($_ -match "^\s*#" -or $_ -notmatch "=") { return }
  $parts = $_.Split("=", 2)
  [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
}

$logFile = Join-Path $logDir ("sync-" + (Get-Date -Format "yyyyMMdd") + ".log")
Set-Location $installDir
npm install --omit=dev --no-audit --no-fund | Out-File -FilePath $logFile -Append -Encoding UTF8
node .\tally-agent.mjs *>> $logFile
'@ | Set-Content -LiteralPath $runnerPath -Encoding UTF8

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1)
$trigger.Repetition.Interval = "PT$IntervalMinutes`M"
$trigger.Repetition.Duration = "P3650D"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`""
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 2)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed $TaskName. Logs: $logsDir"
