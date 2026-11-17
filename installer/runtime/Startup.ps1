param([switch]$CheckOnly)
$ErrorActionPreference='Stop'
$Root='C:\AI\segretario-mmg-extension'
function Test-Ollama { try { Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 | Out-Null; return $true } catch { return $false } }
if (-not (Test-Ollama)) {
    $exe=Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if (Test-Path $exe) { Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden }
}
& (Join-Path $PSScriptRoot 'Update.ps1')
