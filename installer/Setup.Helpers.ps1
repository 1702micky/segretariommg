function Publish-SetupProgress {
    param([string]$Stage,[string]$Detail='', [int]$Percent=-1)
    if(-not $script:SetupProgressFile){return}
    try {
        @{stage=$Stage;detail=$Detail;percent=$Percent}|ConvertTo-Json -Compress|Set-Content -Encoding UTF8 ($script:SetupProgressFile+'.tmp')
        Move-Item -LiteralPath ($script:SetupProgressFile+'.tmp') -Destination $script:SetupProgressFile -Force
    } catch {Write-Verbose 'Interfaccia temporaneamente occupata: avanzamento aggiornato al prossimo evento.'}
}
function Enable-HiddenOllamaInstall {
    param([string]$Directory=(Join-Path $env:LOCALAPPDATA 'Ollama'))
    # Official Ollama Windows installer uses this marker to suppress the first chat window.
    New-Item -ItemType Directory -Path $Directory -Force|Out-Null
    New-Item -ItemType File -Path (Join-Path $Directory 'upgraded') -Force|Out-Null
}
function Close-UserChrome {
    param([string]$UserSid)
    foreach($chromeProcess in @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'")){
        $owner=Invoke-CimMethod -InputObject $chromeProcess -MethodName GetOwnerSid
        if($owner.ReturnValue -eq 0 -and $owner.Sid -eq $UserSid){
            $running=Get-Process -Id $chromeProcess.ProcessId -ErrorAction SilentlyContinue
            if($running -and $running.ProcessName -eq 'chrome'){Stop-Process -InputObject $running -Force -ErrorAction Stop}
        }
    }
}
function Receive-OllamaModel {
    param([string]$Model,[string]$Endpoint='http://127.0.0.1:11434/api/pull')
    $request=[Net.HttpWebRequest]::Create($Endpoint)
    $request.Method='POST';$request.ContentType='application/json';$request.Timeout=30000;$request.ReadWriteTimeout=120000
    $body=[Text.Encoding]::UTF8.GetBytes((@{model=$Model;stream=$true}|ConvertTo-Json -Compress))
    $request.ContentLength=$body.Length
    $response=$null;$reader=$null;$success=$false;$timer=[Diagnostics.Stopwatch]::StartNew();$next=0
    try {
        $stream=$request.GetRequestStream();try{$stream.Write($body,0,$body.Length)}finally{$stream.Dispose()}
        $response=$request.GetResponse();$reader=New-Object IO.StreamReader($response.GetResponseStream())
        while($null -ne ($line=$reader.ReadLine())){
            if($timer.Elapsed.TotalSeconds -gt 7200){throw 'Download modello oltre il tempo massimo: riprova per riprendere.'}
            if(-not $line.Trim()){continue};$event=$line|ConvertFrom-Json
            if($event.error){throw ('Download modello: '+$event.error)}
            if($event.status -eq 'success'){$success=$true}
            if($timer.ElapsedMilliseconds -ge $next -or $success){
                $detail='Preparazione e verifica del modello. Attendere...';$percent=-1
                if($event.total -gt 0){$p=Get-DownloadProgress ([long]$event.completed) ([long]$event.total);$detail=$p.Status+' - componente del modello';$percent=$p.Percent}
                Publish-SetupProgress '5 / 7 - Modello IA' $detail $percent
                $next=$timer.ElapsedMilliseconds+250
            }
        }
        if(-not $success){throw 'Download modello interrotto: manca la conferma finale di Ollama.'}
    } finally {if($reader){$reader.Dispose()};if($response){$response.Dispose()};$request.Abort();$timer.Stop()}
}
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
