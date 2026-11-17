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
if($setup -notmatch "@\('chrome://extensions','https://github.com/1702micky/segretariommg'\)" -or $setup -match 'Apri estensioni Chrome.lnk') {throw 'Guida finale errata o collegamento desktop indesiderato'}
Write-Output 'Verifica guida finale: homepage GitHub e pagina estensioni, senza collegamento desktop.'
$ast=[System.Management.Automation.Language.Parser]::ParseInput($setup,[ref]$null,[ref]$null)
$modelBranch=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text -eq '$model' -and $node.Clauses[0].Item2.Extent.Text.Contains('Receive-OllamaModel')},$true)
if($modelBranch.Count -ne 1 -or -not $modelBranch[0].Clauses[0].Item2.Extent.Text.Contains('/api/chat') -or -not $modelBranch[0].ElseClause -or $modelBranch[0].ElseClause.Extent.Text -match 'Receive-OllamaModel|Invoke-RestMethod'){throw 'Download/prova del modello non saltati correttamente'}
if($setup -notmatch 'if\(\$skipModel.Checked\)\{\$null\}'){throw 'Scelta senza modello assente'}
Write-Output 'Verifica scelta senza modello: download e inferenza protetti dalla scelta utente.'
