function Wait-OllamaInstaller {
    param([Parameter(Mandatory=$true)]$Process, [int]$TimeoutSeconds=1800)
    # WaitForExit riguarda solo il processo installer, non l'app tray avviata
    # come discendente. Start-Process -Wait aspetterebbe anche quest'ultima.
    $clock=[Diagnostics.Stopwatch]::StartNew()
    $nextNotice=15
    while (-not $Process.WaitForExit(1000)) {
        if ($clock.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
            throw 'Installazione Ollama ancora in corso dopo 30 minuti. Nessun processo e stato terminato: controlla la finestra Ollama e il log prima di rilanciare.'
        }
        if ($clock.Elapsed.TotalSeconds -ge $nextNotice) {
            Write-Host ('Installazione Ollama in corso... '+[int]$clock.Elapsed.TotalSeconds+' secondi. Non avviare Chrome.')
            $nextNotice += 15
        }
    }
    if ($Process.ExitCode -ne 0) { throw ('Installazione Ollama terminata con errore '+$Process.ExitCode) }
}
