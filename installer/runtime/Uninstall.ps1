$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$Root='C:\AI\segretario-mmg-extension'
$State=Join-Path $env:LOCALAPPDATA 'SegretarioMMG'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$interactive=(Get-CimInstance Win32_ComputerSystem).UserName
if($interactive -and $interactive -ne $identity.Name){
    [Windows.Forms.MessageBox]::Show('Usa lo stesso account Windows con cui hai installato Segretario MMG.','Disinstalla Segretario MMG')|Out-Null;exit 2
}
$admin=New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    try {
        $p=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "'+$PSCommandPath+'"') -Verb RunAs -PassThru -WindowStyle Normal
        $p.WaitForExit();exit $p.ExitCode
    } catch {exit 2}
}
. (Join-Path $PSScriptRoot 'Uninstall.Helpers.ps1')
$mutex=New-Object Threading.Mutex($false,'Local\SegretarioMMGUpdate')
$locked=$false
try {
    Assert-NoReparsePoint $State
    $record=Get-Content (Join-Path $State 'installation.json') -Raw|ConvertFrom-Json
    if($record.root -ne $Root -or $record.userSid -ne $identity.User.Value){throw 'Installazione non riconosciuta per questo utente.'}
    if(Get-Process chrome -ErrorAction SilentlyContinue){throw 'Rimuovi Segretario MMG da chrome://extensions, poi chiudi completamente Chrome e riprova. Nessuna modifica eseguita.'}
    $files=@(Get-OwnedFilePaths -Root $Root -RelativePaths @($record.files))
    $tasks=@()
    foreach($taskName in 'SegretarioMMG-Startup','SegretarioMMG-Update'){
        $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
        if($task){
            $scriptName=if($taskName -eq 'SegretarioMMG-Startup'){'Startup.ps1'}else{'Update.ps1'}
            $expected=Join-Path $Root ('installer\runtime\'+$scriptName)
            if(@($task.Actions).Count -ne 1 -or $task.Actions[0].Arguments -notlike ('*"'+$expected+'"*')){throw ('Attivita non riconosciuta: '+$taskName)}
            $tasks+=$task
        }
    }
    $answer=[Windows.Forms.MessageBox]::Show("Disinstallare Segretario MMG?`r`n`r`nVerranno rimossi i file installati, l'avvio automatico e il controllo aggiornamenti.`r`n`r`nOllama e i modelli IA restano installati. Log, backup e file aggiunti manualmente vengono conservati.`r`n`r`nL'estensione va rimossa manualmente da chrome://extensions. I dati di Eumed non vengono modificati.",'Disinstalla Segretario MMG','YesNo','Question')
    if($answer -ne 'Yes'){exit 0}
    $locked=$mutex.WaitOne(0)
    if(-not $locked){throw 'Aggiornamento in corso: attendi che termini e riprova.'}
    if(Get-Process chrome -ErrorAction SilentlyContinue){throw 'Chrome e stato aperto: chiudilo e riprova.'}
    foreach($task in $tasks){
        Disable-ScheduledTask -InputObject $task|Out-Null
        Stop-ScheduledTask -InputObject $task -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -InputObject $task -Confirm:$false
    }
    $origin='chrome-extension://nmhikenlhbfgbohbfbjamjmhcfmeclfa'
    $origins=[Environment]::GetEnvironmentVariable('OLLAMA_ORIGINS','User')
    [Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS',(Get-OriginsWithoutMMG $origins $origin),'User')
    $previousFile=Join-Path $State 'previous-ollama-environment.json'
    if(Test-Path -LiteralPath $previousFile){
        $previous=Get-Content -LiteralPath $previousFile -Raw|ConvertFrom-Json
        if([Environment]::GetEnvironmentVariable('OLLAMA_HOST','User') -eq '127.0.0.1:11434'){
            [Environment]::SetEnvironmentVariable('OLLAMA_HOST',$previous.host,'User')
        }
    }
    $shell=New-Object -ComObject WScript.Shell
    $shortcuts=@(
        @{path=(Join-Path ([Environment]::GetFolderPath('Desktop')) 'Aggiorna-Segretario.lnk');script=(Join-Path $Root 'installer\runtime\Update.ps1')},
        @{path=(Join-Path ([Environment]::GetFolderPath('Programs')) 'Disinstalla Segretario MMG.lnk');script=(Join-Path $Root 'installer\runtime\Uninstall.ps1')}
    )
    foreach($shortcut in $shortcuts){
        Assert-NoReparsePoint $shortcut.path
        if(Test-Path -LiteralPath $shortcut.path){
            $link=$shell.CreateShortcut($shortcut.path)
            if($link.Arguments -like ('*"'+$shortcut.script+'"*')){Remove-Item -LiteralPath $shortcut.path -Force}
        }
    }
    $cachedInstaller=Join-Path $State 'OllamaSetup.exe'
    Assert-NoReparsePoint $cachedInstaller
    if((Test-Path -LiteralPath $cachedInstaller) -and -not (Get-Item -LiteralPath $cachedInstaller).PSIsContainer){
        Remove-Item -LiteralPath $cachedInstaller -Force
    }
    Remove-OwnedFiles -Root $Root -RelativePaths @($record.files)
    $registry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SegretarioMMG'
    if(Test-Path $registry){Remove-Item -LiteralPath $registry -Force}
    Remove-Item -LiteralPath (Join-Path $State 'installation.json') -Force
    Remove-Item -LiteralPath $previousFile -Force -ErrorAction SilentlyContinue
    [Windows.Forms.MessageBox]::Show(("Disinstallazione completata.`r`n`r`nOllama e i modelli IA sono stati conservati. Riavvia Ollama o Windows per applicare la modifica delle impostazioni.`r`nLog e backup conservati in: "+$State+"`r`nEventuali file aggiunti manualmente restano nella cartella del programma.`r`n`r`nSe non lo hai gia fatto, rimuovi l'estensione da chrome://extensions."),'Segretario MMG')|Out-Null
} catch {
    [Windows.Forms.MessageBox]::Show(($_.Exception.Message+"`r`nSe necessario, rilancia la disinstallazione."),'Disinstallazione non completata')|Out-Null
    exit 1
} finally {
    if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()
}
