param([switch]$CheckOnly,[switch]$Interactive)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Download.Helpers.ps1')
. (Join-Path $PSScriptRoot 'Update.Console.Helpers.ps1')
$exitCode=0
$started=[Diagnostics.Stopwatch]::StartNew()
if($Interactive){Write-Host 'SEGRETARIO MMG - AGGIORNAMENTO' -ForegroundColor Cyan;Write-Host 'Lascia Chrome chiuso fino al termine. Nessuna chiusura automatica.'}
$Root='C:\AI\segretario-mmg-extension'
$State=Join-Path $env:LOCALAPPDATA 'SegretarioMMG'
New-Item -ItemType Directory -Force $State | Out-Null
$mutex=New-Object Threading.Mutex($false,'Local\SegretarioMMGUpdate')
if (-not $mutex.WaitOne(0)) { Write-Host 'Un altro aggiornamento e gia in corso.'; $mutex.Dispose(); if($Interactive){[void](Read-Host 'Premi INVIO per chiudere')}; exit 0 }
try {
 & {
    Write-UpdatePhase 1 'Controllo versione installata e GitHub'
    $current=[version](Get-Content (Join-Path $Root 'manifest.json') -Raw | ConvertFrom-Json).version
    Write-Host ('Versione installata: '+$current)
    $config=Get-Content (Join-Path $PSScriptRoot 'settings.json') -Raw | ConvertFrom-Json
    if (-not $config.repository) { Write-Host 'Aggiornamenti non configurati.'; return }
    if ($config.repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Repository non valido' }
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    $headers=@{'User-Agent'='SegretarioMMG-Updater';'Accept'='application/vnd.github+json'}
    $oldProgressPreference=$ProgressPreference
    $ProgressPreference='SilentlyContinue'
    try { $release=Invoke-RestMethod ('https://api.github.com/repos/'+$config.repository+'/releases/latest') -Headers $headers -TimeoutSec 30 } finally { $ProgressPreference=$oldProgressPreference }
    $next=[version]($release.tag_name -replace '^v','')
    if ($release.prerelease -or $release.draft) { Write-Host 'Nessuna release stabile disponibile.'; return }
    if ($next -le $current) { Write-Host ('Sei gia aggiornato: versione '+$current+'. Nessun download necessario.') -ForegroundColor Green; return }
    Write-Host ('Aggiornamento: '+$current+' -> '+$next) -ForegroundColor Yellow
    $asset=@($release.assets | Where-Object name -eq 'segretario-mmg-update.zip')
    if ($asset.Count -ne 1 -or $asset[0].digest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Asset o digest GitHub assente: aggiornamento sospeso' }
    $url=[uri]$asset[0].browser_download_url
    if ($url.Scheme -ne 'https' -or $url.Host -ne 'github.com' -or -not $url.AbsolutePath.StartsWith('/'+$config.repository+'/releases/download/')) { throw 'Origine aggiornamento non valida' }
    if ($CheckOnly) { Write-Output ('Disponibile '+$next); return }
    # Mai modificare i file quando Chrome potrebbe avere un lavoro in corso.
    if (Get-Process chrome -ErrorAction SilentlyContinue) { Write-Output 'Aggiornamento rinviato: chiudere completamente Chrome.'; return }
    $stage=Join-Path $State ([guid]::NewGuid().ToString())
    New-Item -ItemType Directory $stage | Out-Null
    $zip=Join-Path $stage 'update.zip'
    Write-UpdatePhase 2 'Download aggiornamento' ('Da '+$current+' a '+$next+' - dimensioni in MB (1 MB = 1.000.000 byte)')
    Receive-FileWithProgress -Uri $url -OutFile $zip -Activity ('Aggiornamento '+$next) -TimeoutSeconds 600 -ConsoleProgress:$Interactive
    Write-UpdatePhase 3 'Verifica integrita ed estrazione del pacchetto' 'Controllo SHA256: attesa normalmente breve.'
    if ((Get-UpdateSha256 $zip) -ne ($asset[0].digest -replace '^sha256:','')) { throw 'Digest archivio errato' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z=[IO.Compression.ZipFile]::OpenRead($zip)
    try {
        foreach($entry in $z.Entries) {
            if ($entry.FullName -match '(^/|\\|(^|/)\.\.(/|$)|:)' ) { throw 'Percorso archivio non valido' }
        }
    } finally { $z.Dispose() }
    $unpack=Join-Path $stage 'unpack'
    [IO.Compression.ZipFile]::ExtractToDirectory($zip,$unpack)
    Write-UpdatePhase 4 'Controllo versione e file ricevuti'
    $inventory=Get-Content (Join-Path $unpack 'inventory.json') -Raw | ConvertFrom-Json
    if ([version]$inventory.version -ne $next) { throw 'Versione non coerente' }
    $paths=@($inventory.files | ForEach-Object path)
    if (@($paths | Sort-Object -Unique).Count -ne $paths.Count) { throw 'Percorsi duplicati' }
    foreach($required in 'manifest.json','segretario.js','background.js','lab_catalog.json','paddle_sandbox.html','paddle_sandbox.js') {
        if($required -notin $paths){throw ('Aggiornamento incompleto: '+$required)}
    }
    $allowed=@('manifest.json','segretario.js','background.js','lab_catalog.json','paddle_sandbox.html','paddle_sandbox.js','README.txt','VERIFICA_PADDLEOCR_BROWSER.ps1')
    foreach($f in $inventory.files) {
        if ($f.path -notin $allowed -and $f.path -notmatch '^(vendor|PaddleOCR_Browser)/[A-Za-z0-9_./-]+$') { throw 'File non ammesso nel pacchetto' }
        if ($f.path -match '(^|/)\.\.(/|$)') { throw 'Percorso non valido' }
        $source=Join-Path $unpack ('extension/'+$f.path)
        if ((Get-UpdateSha256 $source) -ne $f.sha256) { throw 'Hash file errato' }
    }
    $newManifest=Get-Content (Join-Path $unpack 'extension/manifest.json') -Raw | ConvertFrom-Json
    $oldManifest=Get-Content (Join-Path $Root 'manifest.json') -Raw | ConvertFrom-Json
    if ($newManifest.key -ne $oldManifest.key -or [version]$newManifest.version -ne $next) { throw 'Identita estensione o versione errata' }
    if (Get-Process chrome -ErrorAction SilentlyContinue) { throw 'Chrome aperto durante download: nessuna modifica eseguita' }
    Write-UpdatePhase 5 'Backup e installazione dei file verificati'
    $backup=Join-Path $State ('backups/'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force $backup | Out-Null
    $changed=@()
    try {
        $fileIndex=0
        foreach($f in $inventory.files) {
            $fileIndex++
            if($Interactive){Write-Host ('Installazione file {0}/{1}: {2}' -f $fileIndex,$inventory.files.Count,$f.path)}
            if (Get-Process chrome -ErrorAction SilentlyContinue) { throw 'Chrome avviato: aggiornamento annullato e ripristinato' }
            $dest=Join-Path $Root $f.path
            $old=Join-Path $backup $f.path
            if (Test-Path $dest) { New-Item -ItemType Directory -Force (Split-Path $old) | Out-Null; Copy-Item -LiteralPath $dest -Destination $old }
            $changed += @{dest=$dest;old=$old;existed=(Test-Path $dest)}
            New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
            Copy-Item -LiteralPath (Join-Path $unpack ('extension/'+$f.path)) -Destination $dest -Force
            if((Get-UpdateSha256 $dest) -ne $f.sha256){throw 'Verifica file installato non riuscita'}
        }
        $recordFile=Join-Path $State 'installation.json'
        if(Test-Path -LiteralPath $recordFile){
            $record=Get-Content -LiteralPath $recordFile -Raw|ConvertFrom-Json
            $record.files=@(@($record.files)+@($inventory.files|ForEach-Object path)|Sort-Object -Unique)
            $record.version=$next.ToString()
            $record|ConvertTo-Json -Depth 5|Set-Content -Encoding UTF8 ($recordFile+'.tmp')
            Move-Item -LiteralPath ($recordFile+'.tmp') -Destination $recordFile -Force
        }
    } catch {
        Write-Host 'Ripristino dei file precedenti...' -ForegroundColor Yellow
        foreach($c in $changed) { if($c.existed) { Copy-Item -LiteralPath $c.old -Destination $c.dest -Force } else { Remove-Item -LiteralPath $c.dest -ErrorAction SilentlyContinue } }
        Write-Host 'File precedenti ripristinati.'
        throw
    }
    Write-UpdatePhase 6 'Aggiornamento completato'
    Write-Host ('Versione: '+$current+' -> '+$next) -ForegroundColor Green
    Write-Host ('Backup: '+$backup)
    Write-Host 'Puoi riaprire Chrome. Se la versione visualizzata non cambia, ricarica l estensione e la pagina Eumed.'
 }
} catch {
    $exitCode=1
    $_ | Out-String | Add-Content (Join-Path $State 'update.log')
    Write-Host ('Aggiornamento non completato: '+$_.Exception.Message) -ForegroundColor Red
    Write-Host ('Dettagli: '+(Join-Path $State 'update.log'))
} finally {
    $mutex.ReleaseMutex(); $mutex.Dispose(); $started.Stop()
    Write-Host ('Tempo totale: '+$started.Elapsed.ToString('hh\:mm\:ss'))
    if($Interactive){[void](Read-Host 'Premi INVIO per chiudere')}
}
exit $exitCode
