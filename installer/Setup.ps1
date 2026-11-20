param([Parameter(Mandatory=$true)][string]$PackageRoot,[string]$ProgressFile)
$script:SetupProgressFile=$ProgressFile
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Setup.Helpers.ps1')
. (Join-Path $PSScriptRoot 'runtime/Download.Helpers.ps1')
Add-Type -AssemblyName System.Windows.Forms
Publish-SetupProgress 'Scelta delle opzioni' 'Conferma gli avvisi e scegli il modello nella finestra di configurazione.'
$Root='C:\AI\segretario-mmg-extension'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$admin=New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Avvia il setup come amministratore.' }
$interactive=(Get-CimInstance Win32_ComputerSystem).UserName
if ($interactive -and $interactive -ne $identity.Name) { throw 'Esegui il setup con lo stesso utente Windows che usa Chrome (elevazione con credenziali diverse non supportata).' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Occorre Windows a 64 bit.' }
$preflight=[Windows.Forms.MessageBox]::Show("Prima di iniziare:`r`n`r`n- Salva prima tutti i lavori aperti in Chrome. Premendo OK il programma chiudera automaticamente Chrome (anche le finestre in background) del tuo account. I dati non salvati potrebbero andare persi. Non riaprirlo fino al termine.`r`n- Chiudi i lavori IA in corso: il setup configura e riavvia Ollama.`r`n- Lascia il PC acceso e collegato a Internet.`r`n`r`nI download sono di diversi GB: con una connessione lenta l'installazione puo richiedere anche un'ora o piu. Il tempo non e fisso.`r`n`r`nContinuare?",'Segretario MMG - Prima di iniziare','OKCancel','Information')
if ($preflight -ne 'OK') { exit 3 }
Close-UserChrome -UserSid $identity.User.Value
Start-Sleep -Seconds 2
if (Get-Process chrome -ErrorAction SilentlyContinue) {
    [Windows.Forms.MessageBox]::Show('Chiudi completamente Chrome e rilancia il setup. Nessuna modifica eseguita.','Segretario MMG') | Out-Null
    exit 2
}
$ram=[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1)
$form=New-Object Windows.Forms.Form
$form.Text='Segretario MMG - Installazione';$form.Size=New-Object Drawing.Size(650,450);$form.StartPosition='CenterScreen'
$label=New-Object Windows.Forms.Label
$label.Location=New-Object Drawing.Point(20,15);$label.Size=New-Object Drawing.Size(600,130)
$label.Text="RAM rilevata: $ram GB.`r`nCartella: $Root`r`n`r`nDa 12 GB: consigliato Qwen 3.5 4B. Con meno RAM: Qwen3-VL 2B Instruct.`r`nLa RAM e' indicativa: Chrome, Eumed e altri programmi usano memoria.`r`nPuoi scegliere un modello oppure usare quelli gia installati."
$form.Controls.Add($label)
$small=New-Object Windows.Forms.RadioButton;$small.Text='Qwen3-VL 2B Instruct - piu leggero (circa 1,9 GB download)';$small.Location=New-Object Drawing.Point(20,150);$small.Size=New-Object Drawing.Size(600,30)
$medium=New-Object Windows.Forms.RadioButton;$medium.Text='Qwen 3.5 4B - consigliato da 12 GB RAM (circa 3,3 GB download)';$medium.Location=New-Object Drawing.Point(20,185);$medium.Size=New-Object Drawing.Size(600,30)
$medium.Checked=($ram -ge 11.5);$small.Checked=(-not $medium.Checked)
$form.Controls.Add($small);$form.Controls.Add($medium)
$skipModel=New-Object Windows.Forms.RadioButton;$skipModel.Text='Non scaricare un modello IA: ne ho gia uno installato';$skipModel.Location=New-Object Drawing.Point(20,220);$skipModel.Size=New-Object Drawing.Size(600,30);$form.Controls.Add($skipModel)
$updates=New-Object Windows.Forms.CheckBox;$updates.Text='Controlla automaticamente gli aggiornamenti GitHub all accesso Windows';$updates.Checked=$true;$updates.Location=New-Object Drawing.Point(20,260);$updates.Size=New-Object Drawing.Size(600,30);$form.Controls.Add($updates)
$note=New-Object Windows.Forms.Label;$note.Text='Ollama sara avviato con Windows. IA locale, ragionamento esteso disattivato. Il setup configura OLLAMA_ORIGINS e riavvia Ollama: chiudi altri lavori IA prima di continuare.';$note.Location=New-Object Drawing.Point(20,300);$note.Size=New-Object Drawing.Size(600,50);$form.Controls.Add($note)
$ok=New-Object Windows.Forms.Button;$ok.Text='Installa';$ok.Location=New-Object Drawing.Point(400,365);$ok.DialogResult='OK';$form.AcceptButton=$ok;$form.Controls.Add($ok)
$cancel=New-Object Windows.Forms.Button;$cancel.Text='Annulla';$cancel.Location=New-Object Drawing.Point(510,365);$cancel.DialogResult='Cancel';$form.CancelButton=$cancel;$form.Controls.Add($cancel)
if ($form.ShowDialog() -ne 'OK') { exit 3 }
$model=if($skipModel.Checked){$null}elseif($small.Checked){'qwen3-vl:2b-instruct-q4_K_M'}else{'qwen3.5:4b-q4_K_M'}
$State=Join-Path $env:LOCALAPPDATA 'SegretarioMMG'
New-Item -ItemType Directory -Force $State | Out-Null
Start-Transcript -Path (Join-Path $State 'setup.log') -Append | Out-Null
try {
    Publish-SetupProgress '1 / 7 - Preparazione' 'Verifica dei file, backup e installazione dei componenti.'
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $payload=Join-Path $PackageRoot 'payload'
    $inventory=Get-Content (Join-Path $payload 'inventory.json') -Raw | ConvertFrom-Json
    foreach($f in $inventory.files) {
        if((Get-FileHash (Join-Path $payload ('extension/'+$f.path)) -Algorithm SHA256).Hash.ToLower() -ne $f.sha256){throw ('File pacchetto corrotto: '+$f.path)}
    }
    if((Get-PSDrive C).Free -lt 12GB){throw 'Occorrono almeno 12 GB liberi su C: per completare installazione e download.'}
    $backup=Join-Path $State ('backups/pre-setup-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
    if(Test-Path $Root){New-Item -ItemType Directory -Force $backup | Out-Null;foreach($f in $inventory.files){$old=Join-Path $Root $f.path;if(Test-Path $old){$dest=Join-Path $backup $f.path;New-Item -ItemType Directory -Force (Split-Path $dest)|Out-Null;Copy-Item -LiteralPath $old -Destination $dest}}}
    New-Item -ItemType Directory -Force $Root | Out-Null
    foreach($f in $inventory.files){$dest=Join-Path $Root $f.path;New-Item -ItemType Directory -Force (Split-Path $dest)|Out-Null;Copy-Item -LiteralPath (Join-Path $payload ('extension/'+$f.path)) -Destination $dest -Force}
    $runtime=Join-Path $Root 'installer\runtime';New-Item -ItemType Directory -Force $runtime|Out-Null
    Copy-Item (Join-Path $PackageRoot 'runtime\*') $runtime -Force
    $config=@{repository=if($updates.Checked){'1702micky/segretariommg'}else{''}}
    $config | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $runtime 'settings.json')
    if($model){@{model=$model}|ConvertTo-Json|Set-Content -Encoding UTF8 (Join-Path $Root 'installation-defaults.json')}
    & icacls.exe $Root /grant ('*'+$identity.User.Value+':(OI)(CI)M') /T /Q | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Impossibile impostare permessi aggiornamento per questo utente.'}
    $exe=Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if(-not (Test-Path $exe)){
        $download=Join-Path $State 'OllamaSetup.exe'
        Write-Host 'Download di Ollama dal sito ufficiale...'
        Publish-SetupProgress '2 / 7 - Download Ollama' 'Connessione al sito ufficiale...'
        Receive-FileWithProgress -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile $download -Activity '2 / 7 - Download Ollama' -TimeoutSeconds 7200
        Publish-SetupProgress '3 / 7 - Installazione Ollama' 'Verifica della firma e installazione. Questa fase puo richiedere diversi minuti.'
        $signature=Get-AuthenticodeSignature $download
        if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Ollama'){throw 'Firma del programma Ollama non valida: installazione fermata.'}
        Write-Host 'Installazione Ollama. Attendere: Chrome deve restare chiuso.'
        Enable-HiddenOllamaInstall
        $process=Start-Process $download -ArgumentList '/VERYSILENT /NORESTART /SUPPRESSMSGBOXES' -PassThru -WindowStyle Hidden
        try { Wait-OllamaInstaller -Process $process } finally { $process.Dispose() }
        if(-not(Test-Path $exe)){throw 'Il programma di installazione e terminato ma ollama.exe non e presente. Controlla il log.'}
        Write-Host 'Installazione Ollama terminata. Configurazione del servizio locale...'
    }
    Publish-SetupProgress '4 / 7 - Configurazione IA locale' 'Autorizzazioni e avvio del servizio in background.'
    $manifest=Get-Content (Join-Path $Root 'manifest.json') -Raw|ConvertFrom-Json
    $sha=[Security.Cryptography.SHA256]::Create();$hash=$sha.ComputeHash([Convert]::FromBase64String($manifest.key));$sha.Dispose()
    $extensionId=-join ($hash[0..15]|ForEach-Object{[char](97+($_ -shr 4));[char](97+($_ -band 15))})
    $origin='chrome-extension://'+$extensionId
    $previous=[Environment]::GetEnvironmentVariable('OLLAMA_ORIGINS','User')
    $previousEnvironment=Join-Path $State 'previous-ollama-environment.json'
    if(-not (Test-Path -LiteralPath $previousEnvironment)){
        @{origins=$previous;host=[Environment]::GetEnvironmentVariable('OLLAMA_HOST','User')}|ConvertTo-Json|Set-Content -Encoding UTF8 $previousEnvironment
    }
    $origins=@($previous -split ','|Where-Object {$_ -and $_.Trim() -ne $origin})+@($origin)
    [Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS',($origins -join ','),'User');$env:OLLAMA_ORIGINS=$origins -join ','
    [Environment]::SetEnvironmentVariable('OLLAMA_HOST','127.0.0.1:11434','User');$env:OLLAMA_HOST='127.0.0.1:11434'
    Get-Process -Name 'ollama','ollama app' -ErrorAction SilentlyContinue|Stop-Process -Force
    Start-Process $exe -ArgumentList 'serve' -WindowStyle Hidden
    $ready=$false;for($i=0;$i -lt 30;$i++){try{Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2|Out-Null;$ready=$true;break}catch{Start-Sleep -Seconds 1}}
    if(-not $ready){throw 'Ollama non risponde dopo avvio.'}
    if($model){
    Write-Host ('Download modello '+$model+' (puo richiedere diversi minuti)...')
    Publish-SetupProgress '5 / 7 - Modello IA' ('Preparazione download: '+$model)
    Receive-OllamaModel -Model $model
    Publish-SetupProgress '6 / 7 - Verifica dei componenti' 'Prova IA senza ragionamento esteso, controllo OCR e lettore PDF.'
    $details=Invoke-RestMethod 'http://127.0.0.1:11434/api/show' -Method Post -ContentType 'application/json' -Body (@{model=$model}|ConvertTo-Json)
    if('vision' -notin $details.capabilities){throw 'Il modello non dichiara il supporto immagini.'}
    $testBody=@{model=$model;messages=@(@{role='user';content='Rispondi soltanto OK'});stream=$false;think=$false;options=@{num_predict=20;temperature=0}}|ConvertTo-Json -Depth 8
    $test=Invoke-RestMethod 'http://127.0.0.1:11434/api/chat' -Method Post -ContentType 'application/json' -Body $testBody -TimeoutSec 360
    if(-not $test.message.content){throw 'Il test IA non ha restituito testo.'}
    } else {
        Publish-SetupProgress '6 / 7 - Verifica dei componenti' 'Download e prova del modello saltati. Scegli un modello gia installato nella schermata iniziale di Segretario MMG.'
        Write-Host 'Nessun modello scaricato o avviato: selezionalo nella schermata iniziale di Segretario MMG.'
    }
    $originHeaders=@{Origin=$origin}
    Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -Headers $originHeaders -TimeoutSec 10|Out-Null
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'VERIFICA_PADDLEOCR_BROWSER.ps1')
    if($LASTEXITCODE -ne 0){throw 'Verifica PaddleOCR non superata.'}
    foreach($pdf in 'vendor\pdf.mjs','vendor\pdf.worker.mjs'){if((Get-Item (Join-Path $Root $pdf)).Length -lt 100000){throw 'PDF parser incompleto'}}
    Publish-SetupProgress '7 / 7 - Ultimi passaggi' 'Configurazione avvio, aggiornamenti e disinstallazione.'
    $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $runtime 'Startup.ps1')+'"')
    $trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
    $principal=New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName 'SegretarioMMG-Startup' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force|Out-Null
    if ($updates.Checked) {
        $updateAction=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $runtime 'Update.ps1')+'"')
        $updateTrigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(10) -RepetitionInterval (New-TimeSpan -Hours 1)
        Register-ScheduledTask -TaskName 'SegretarioMMG-Update' -Action $updateAction -Trigger $updateTrigger -Principal $principal -Settings $settings -Force|Out-Null
    } elseif (Get-ScheduledTask -TaskName 'SegretarioMMG-Update' -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName 'SegretarioMMG-Update' -Confirm:$false
    }
    $help=Join-Path $Root 'COME-INIZIARE.txt'
    @("Segretario MMG - installato in $Root", $(if($model){"Modello: $model"}else{"Modello: scegli un modello gia installato nella schermata iniziale di Segretario MMG."}), "ID Chrome: $extensionId",'', '1. Apri chrome://extensions', '2. Attiva Modalita sviluppatore.', '3. Carica estensione non pacchettizzata e seleziona C:\AI\segretario-mmg-extension.', '4. Apri Eumed e seleziona il modello nella schermata iniziale.', '', 'Non spostare la cartella. Non ricaricare durante inserimenti.', 'Aggiornamenti: automatici al logon soltanto con Chrome completamente chiuso.', 'Se Chrome era aperto, chiudilo e avvia Aggiorna-Segretario dal collegamento.', 'Se il repository e privato o senza release, il controllo non scarica nulla.', "Log: $State")|Set-Content -Encoding UTF8 $help
    $shell=New-Object -ComObject WScript.Shell
    $link=$shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Aggiorna-Segretario.lnk'))
    $link.TargetPath='powershell.exe';$link.Arguments='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $runtime 'Update.ps1')+'"';$link.Save()
    # Record only owned files: uninstall must preserve documents and development files.
    $owned=@($inventory.files|ForEach-Object path)+@('COME-INIZIARE.txt','installation-defaults.json')
    $owned+=@('Startup.ps1','Update.ps1','settings.json','Download.Helpers.ps1','Uninstall.Helpers.ps1','Uninstall.ps1')|ForEach-Object {'installer/runtime/'+$_}
    $recordFile=Join-Path $State 'installation.json'
    if(Test-Path -LiteralPath $recordFile){$owned+=@((Get-Content -LiteralPath $recordFile -Raw|ConvertFrom-Json).files)}
    . (Join-Path $runtime 'Uninstall.Helpers.ps1')
    $owned=@($owned|Sort-Object -Unique)
    Get-OwnedFilePaths -Root $Root -RelativePaths $owned|Out-Null
    @{root=$Root;userSid=$identity.User.Value;version=$manifest.version;files=$owned}|ConvertTo-Json -Depth 5|Set-Content -Encoding UTF8 $recordFile
    $powershellExe=Join-Path $PSHOME 'powershell.exe'
    $uninstallArguments='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $runtime 'Uninstall.ps1')+'"'
    $uninstallLink=$shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Disinstalla Segretario MMG.lnk'))
    $uninstallLink.TargetPath=$powershellExe;$uninstallLink.Arguments=$uninstallArguments;$uninstallLink.Save()
    $registry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SegretarioMMG'
    New-Item -Path $registry -Force|Out-Null
    $properties=@{DisplayName='Segretario MMG';DisplayVersion=$manifest.version;Publisher='Segretario MMG';InstallLocation=$Root;UninstallString=('"'+$powershellExe+'" '+$uninstallArguments);URLInfoAbout='https://github.com/1702micky/segretariommg'}
    foreach($property in $properties.Keys){New-ItemProperty -Path $registry -Name $property -Value $properties[$property] -PropertyType String -Force|Out-Null}
    foreach($property in 'NoModify','NoRepair'){New-ItemProperty -Path $registry -Name $property -Value 1 -PropertyType DWord -Force|Out-Null}
    $chrome=@("$env:ProgramFiles\Google\Chrome\Application\chrome.exe","${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe","$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")|Where-Object{Test-Path $_}|Select-Object -First 1
    Publish-SetupProgress 'Installazione verificata' 'Conferma il messaggio finale per aprire le istruzioni in Chrome.' 100
    # Le istruzioni restano leggibili anche se Chrome blocca la navigazione automatica.
    [Windows.Forms.MessageBox]::Show((Get-Content $help -Raw),'Installazione verificata')|Out-Null
    if($chrome){
        try {
            Start-Process $chrome -ArgumentList @('chrome://extensions','https://github.com/1702micky/segretariommg') -WindowStyle Normal
        } catch {
            Write-Warning 'Installazione verificata, ma Chrome non si e aperto. Digita chrome://extensions nella barra di Chrome e consulta https://github.com/1702micky/segretariommg.'
        }
    } else {
        Write-Warning 'Chrome non trovato. Apri la guida: https://github.com/1702micky/segretariommg'
    }
    Write-Host 'Installazione completata e verificata.'
} catch {
    [Windows.Forms.MessageBox]::Show(($_.Exception.Message+"`r`nLog: "+$State+'\setup.log'),'Installazione non completata')|Out-Null
    throw
} finally {Stop-Transcript|Out-Null}
