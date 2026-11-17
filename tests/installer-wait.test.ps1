$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../installer/Setup.Helpers.ps1')
function New-FakeProcess([int]$ExitCode,[int]$FalsePolls) {
    $p=[pscustomobject]@{ExitCode=$ExitCode;Remaining=$FalsePolls;Polls=0}
    $p|Add-Member ScriptMethod WaitForExit {param($milliseconds) $this.Polls++; if($this.Remaining -gt 0){$this.Remaining--;return $false};return $true}
    return $p
}
$p=New-FakeProcess 0 2
Wait-OllamaInstaller $p
if($p.Polls -ne 3){throw 'Non ha atteso la conclusione del processo installer'}
$failed=$false
try { Wait-OllamaInstaller (New-FakeProcess 7 0) } catch { $failed=$_.Exception.Message -match 'errore 7' }
if(-not $failed){throw 'Exit code di errore ignorato'}
$timedOut=$false
try { Wait-OllamaInstaller (New-FakeProcess 0 2) -TimeoutSeconds 0 } catch { $timedOut=$_.Exception.Message -match 'Nessun processo' }
if(-not $timedOut){throw 'Timeout non gestito'}
$setup=Get-Content (Join-Path $PSScriptRoot '../installer/Setup.ps1') -Raw
if($setup -match 'Start-Process \$download[^\r\n]* -Wait\b'){throw 'Attesa di tutti i discendenti reintrodotta'}
Write-Output '4 controlli installer superati: attesa processo, errore, timeout, nessuna attesa dei discendenti.'
