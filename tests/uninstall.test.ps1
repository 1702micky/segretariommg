$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../installer/runtime/Uninstall.Helpers.ps1')
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('SegretarioMMG-UninstallTest-'+[guid]::NewGuid().ToString('N'))
$base=[IO.Path]::GetFullPath($fixture)
New-Item -ItemType Directory -Path $base|Out-Null
$junction=$null
function Expect-Rejection {
    param([scriptblock]$Action)
    $rejected=$false
    try {& $Action|Out-Null}catch{$rejected=$true}
    if(-not $rejected){throw 'Piano di rimozione non sicuro accettato'}
}
try {
    $root=Join-Path $base 'extension'
    New-Item -ItemType Directory -Path (Join-Path $root 'vendor') -Force|Out-Null
    Set-Content -LiteralPath (Join-Path $root 'manifest.json') -Value '{}'
    Set-Content -LiteralPath (Join-Path $root 'vendor/owned.js') -Value 'synthetic'
    Set-Content -LiteralPath (Join-Path $root 'documento-aggiunto.txt') -Value 'synthetic user file'
    foreach($bad in '../outside.txt','vendor/../../outside.txt','C:/outside.txt','/outside.txt','installer/Setup.ps1','documento-aggiunto.txt'){
        Expect-Rejection {Get-OwnedFilePaths -Root $root -RelativePaths @($bad)}
    }
    # Complete validation must precede the first deletion.
    Expect-Rejection {Remove-OwnedFiles -Root $root -RelativePaths @('manifest.json','../outside.txt')}
    if(-not (Test-Path (Join-Path $root 'manifest.json'))){throw 'Rimozione parziale prima della validazione'}
    New-Item -ItemType Directory -Path (Join-Path $root 'vendor/folder.js')|Out-Null
    Expect-Rejection {Get-OwnedFilePaths -Root $root -RelativePaths @('vendor/folder.js')}
    Remove-Item -LiteralPath (Join-Path $root 'vendor/folder.js')
    $outside=Join-Path $base 'outside'
    New-Item -ItemType Directory -Path $outside|Out-Null
    Set-Content -LiteralPath (Join-Path $outside 'keep.js') -Value 'synthetic outside file'
    $junction=Join-Path $root 'vendor/link'
    New-Item -ItemType Junction -Path $junction -Target $outside|Out-Null
    Expect-Rejection {Remove-OwnedFiles -Root $root -RelativePaths @('vendor/link/keep.js')}
    if(-not (Test-Path (Join-Path $outside 'keep.js'))){throw 'File esterno modificato'}
    [IO.Directory]::Delete($junction);$junction=$null
    $origin='chrome-extension://nmhikenlhbfgbohbfbjamjmhcfmeclfa'
    if((Get-OriginsWithoutMMG ('https://example.test,'+$origin+',http://localhost:3000') $origin) -ne 'https://example.test,http://localhost:3000'){throw 'Altre origini modificate'}
    if($null -ne (Get-OriginsWithoutMMG $origin $origin)){throw 'Origine esclusiva non rimossa'}
    Remove-OwnedFiles -Root $root -RelativePaths @('manifest.json','vendor/owned.js','vendor/already-missing.js')
    if((Test-Path (Join-Path $root 'manifest.json')) -or (Test-Path (Join-Path $root 'vendor'))){throw 'File o cartelle vuote non rimossi'}
    if(-not (Test-Path (Join-Path $root 'documento-aggiunto.txt'))){throw 'File aggiunto manualmente rimosso'}
    $runtime=Join-Path $root 'installer/runtime'
    New-Item -ItemType Directory -Path $runtime -Force|Out-Null
    New-Item -ItemType Directory -Path (Join-Path $root 'vendor') -Force|Out-Null
    Set-Content -LiteralPath (Join-Path $runtime 'Uninstall.ps1') -Value 'synthetic recovery script'
    Set-Content -LiteralPath (Join-Path $runtime 'Uninstall.Helpers.ps1') -Value 'synthetic recovery helper'
    $lockedFile=Join-Path $root 'vendor/locked.js'
    Set-Content -LiteralPath $lockedFile -Value 'synthetic locked file'
    $lock=[IO.File]::Open($lockedFile,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $retryFiles=@('installer/runtime/Uninstall.ps1','installer/runtime/Uninstall.Helpers.ps1','vendor/locked.js')
    try {Expect-Rejection {Remove-OwnedFiles -Root $root -RelativePaths $retryFiles}}finally{$lock.Dispose()}
    if(-not (Test-Path (Join-Path $runtime 'Uninstall.ps1')) -or -not (Test-Path (Join-Path $runtime 'Uninstall.Helpers.ps1'))){throw 'Disinstallazione non ripetibile dopo errore'}
    Remove-OwnedFiles -Root $root -RelativePaths $retryFiles
    # The live entry point must retain confirmation and concurrency/Chrome guards.
    $entry=Get-Content (Join-Path $PSScriptRoot '../installer/runtime/Uninstall.ps1') -Raw
    foreach($required in 'Get-Process chrome','YesNo','SegretarioMMGUpdate','Get-OwnedFilePaths','userSid','Get-OriginsWithoutMMG'){
        if(-not $entry.Contains($required)){throw ('Protezione mancante: '+$required)}
    }
    if($entry -match 'Remove-Item[^\r\n]*-Recurse|Stop-Process|ollama\s+rm'){throw 'Rimozione ricorsiva o arresto/rimozione di Ollama introdotti'}
    Write-Output 'Disinstallazione: percorsi, file estranei, junction, origini condivise, rimozione limitata e protezioni verificati su dati sintetici.'
} finally {
    if($junction -and (Test-Path -LiteralPath $junction)){[IO.Directory]::Delete($junction)}
    $resolved=[IO.Path]::GetFullPath($base)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if(-not $resolved.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notmatch '^SegretarioMMG-UninstallTest-[a-f0-9]{32}$'){throw 'Pulizia fixture fuori dalla cartella temporanea'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
