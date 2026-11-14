$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'data') | Out-Null
$running = $false
try { $response = Invoke-RestMethod 'http://127.0.0.1:4317/api/state' -TimeoutSec 2; $running = $response.state.schema -eq 1 } catch {}
if (-not $running) {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    Start-Process -FilePath $nodePath -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'data/server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'data/server-error.log') | Out-Null
    for ($i = 0; $i -lt 30; $i++) {
        try { $response = Invoke-RestMethod 'http://127.0.0.1:4317/api/state' -TimeoutSec 1; $running = $response.state.schema -eq 1; if ($running) { break } } catch {}
        Start-Sleep -Milliseconds 300
    }
}
if (-not $running) { throw 'The workbench did not start. Check data/server-error.log.' }
Start-Process 'http://127.0.0.1:4317'
