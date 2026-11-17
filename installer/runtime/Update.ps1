param([switch]$CheckOnly)
$ErrorActionPreference='Stop'
$Root='C:\AI\segretario-mmg-extension'
$State=Join-Path $env:LOCALAPPDATA 'SegretarioMMG'
New-Item -ItemType Directory -Force $State | Out-Null
$mutex=New-Object Threading.Mutex($false,'Local\SegretarioMMGUpdate')
if (-not $mutex.WaitOne(0)) { exit 0 }
try {
    $config=Get-Content (Join-Path $PSScriptRoot 'settings.json') -Raw | ConvertFrom-Json
    if (-not $config.repository) { return }
    if ($config.repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Repository non valido' }
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    $headers=@{'User-Agent'='SegretarioMMG-Updater';'Accept'='application/vnd.github+json'}
    $release=Invoke-RestMethod ('https://api.github.com/repos/'+$config.repository+'/releases/latest') -Headers $headers -TimeoutSec 30
    $current=[version](Get-Content (Join-Path $Root 'manifest.json') -Raw | ConvertFrom-Json).version
    $next=[version]($release.tag_name -replace '^v','')
    if ($next -le $current -or $release.prerelease -or $release.draft) { return }
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
    Invoke-WebRequest $url.AbsoluteUri -UseBasicParsing -OutFile $zip -TimeoutSec 600
    if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne ($asset[0].digest -replace '^sha256:','')) { throw 'Digest archivio errato' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z=[IO.Compression.ZipFile]::OpenRead($zip)
    try {
        foreach($entry in $z.Entries) {
            if ($entry.FullName -match '(^/|\\|(^|/)\.\.(/|$)|:)' ) { throw 'Percorso archivio non valido' }
        }
    } finally { $z.Dispose() }
    $unpack=Join-Path $stage 'unpack'
    [IO.Compression.ZipFile]::ExtractToDirectory($zip,$unpack)
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
        if ((Get-FileHash $source -Algorithm SHA256).Hash.ToLower() -ne $f.sha256) { throw 'Hash file errato' }
    }
    $newManifest=Get-Content (Join-Path $unpack 'extension/manifest.json') -Raw | ConvertFrom-Json
    $oldManifest=Get-Content (Join-Path $Root 'manifest.json') -Raw | ConvertFrom-Json
    if ($newManifest.key -ne $oldManifest.key -or [version]$newManifest.version -ne $next) { throw 'Identita estensione o versione errata' }
    if (Get-Process chrome -ErrorAction SilentlyContinue) { throw 'Chrome aperto durante download: nessuna modifica eseguita' }
    $backup=Join-Path $State ('backups/'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force $backup | Out-Null
    $changed=@()
    try {
        foreach($f in $inventory.files) {
            if (Get-Process chrome -ErrorAction SilentlyContinue) { throw 'Chrome avviato: aggiornamento annullato e ripristinato' }
            $dest=Join-Path $Root $f.path
            $old=Join-Path $backup $f.path
            if (Test-Path $dest) { New-Item -ItemType Directory -Force (Split-Path $old) | Out-Null; Copy-Item -LiteralPath $dest -Destination $old }
            $changed += @{dest=$dest;old=$old;existed=(Test-Path $dest)}
            New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
            Copy-Item -LiteralPath (Join-Path $unpack ('extension/'+$f.path)) -Destination $dest -Force
        }
    } catch {
        foreach($c in $changed) { if($c.existed) { Copy-Item -LiteralPath $c.old -Destination $c.dest -Force } else { Remove-Item -LiteralPath $c.dest -ErrorAction SilentlyContinue } }
        throw
    }
    Write-Output ('Aggiornato a '+$next+'. Backup: '+$backup)
} catch { $_ | Out-String | Add-Content (Join-Path $State 'update.log') } finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
