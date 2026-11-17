function Assert-NoReparsePoint {
    param([Parameter(Mandatory=$true)][string]$Path)
    $current=[IO.Path]::GetFullPath($Path)
    while($current){
        if(Test-Path -LiteralPath $current){
            if((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw ('Percorso collegato non ammesso: '+$current)}
        }
        $parent=[IO.Path]::GetDirectoryName($current.TrimEnd('\'))
        if($parent -eq $current){break};$current=$parent
    }
}

function Get-OwnedFilePaths {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string[]]$RelativePaths)
    $base=[IO.Path]::GetFullPath($Root).TrimEnd('\')
    Assert-NoReparsePoint $base
    $fixed=@('manifest.json','segretario.js','background.js','lab_catalog.json','paddle_sandbox.html','paddle_sandbox.js','README.txt','VERIFICA_PADDLEOCR_BROWSER.ps1','COME-INIZIARE.txt','installation-defaults.json',
        'installer/runtime/Startup.ps1','installer/runtime/Update.ps1','installer/runtime/settings.json','installer/runtime/Download.Helpers.ps1','installer/runtime/Uninstall.Helpers.ps1','installer/runtime/Uninstall.ps1')
    $seen=@{}
    foreach($relative in $RelativePaths){
        if($relative -notmatch '^[A-Za-z0-9_./-]+$' -or $relative -match '(^/|(^|/)\.\.(/|$))'){throw 'Percorso di disinstallazione non valido'}
        if($relative -notin $fixed -and $relative -notmatch '^(vendor|PaddleOCR_Browser)/[A-Za-z0-9_./-]+$'){throw ('File non riconosciuto: '+$relative)}
        $full=[IO.Path]::GetFullPath((Join-Path $base $relative))
        if(-not $full.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Percorso esterno alla cartella del programma'}
        Assert-NoReparsePoint $full
        if((Test-Path -LiteralPath $full) -and (Get-Item -LiteralPath $full -Force).PSIsContainer){throw ('Era atteso un file: '+$full)}
        if(-not $seen.ContainsKey($full)){$seen[$full]=$true;Write-Output $full}
    }
}

function Get-OriginsWithoutMMG {
    param([AllowNull()][string]$Origins,[string]$ExtensionOrigin)
    $remaining=@($Origins -split ','|Where-Object {$_.Trim() -and $_.Trim() -ne $ExtensionOrigin})
    if($remaining.Count){return $remaining -join ','}
    return $null
}

function Remove-OwnedFiles {
    param([string]$Root,[string[]]$RelativePaths)
    # Validate the complete plan before deleting any file. No recursive removal.
    $files=@(Get-OwnedFilePaths -Root $Root -RelativePaths $RelativePaths)
    # Keep the entry point available for retry if another installed file is locked.
    $recoveryPattern='\\installer\\runtime\\Uninstall(\.Helpers)?\.ps1$'
    $files=@($files|Where-Object {$_ -notmatch $recoveryPattern})+@($files|Where-Object {$_ -match $recoveryPattern})
    $directories=@{}
    $base=[IO.Path]::GetFullPath($Root).TrimEnd('\')
    foreach($file in $files){
        Assert-NoReparsePoint $file
        if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force -ErrorAction Stop}
        $dir=Split-Path $file
        while($dir -and ($dir -eq $base -or $dir.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase))){
            $directories[$dir]=$true
            if($dir -eq $base){break};$dir=Split-Path $dir
        }
    }
    foreach($dir in ($directories.Keys|Sort-Object Length -Descending)){
        Assert-NoReparsePoint $dir
        if((Test-Path -LiteralPath $dir) -and -not @(Get-ChildItem -LiteralPath $dir -Force).Count){
            Remove-Item -LiteralPath $dir -Force -ErrorAction Stop
        }
    }
}
