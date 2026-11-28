function Get-DownloadProgress {
    param([long]$Received, [long]$Total)
    $mb=$Received/1000000.0
    if($Total -gt 0){
        return @{Status=('{0:N1} MB / {1:N1} MB' -f $mb,($Total/1000000.0));Percent=[math]::Min(100,[math]::Floor(100.0*$Received/$Total))}
    }
    return @{Status=('{0:N1} MB scaricati - dimensione totale non comunicata dal server' -f $mb);Percent=-1}
}

function Receive-FileWithProgress {
    param([Parameter(Mandatory=$true)][uri]$Uri,
          [Parameter(Mandatory=$true)][string]$OutFile,
          [string]$Activity='Download', [int]$TimeoutSeconds=7200, [switch]$ConsoleProgress)
    $request=[Net.HttpWebRequest]::Create($Uri)
    $request.UserAgent='SegretarioMMG-Downloader'
    $request.Timeout=30000
    $request.ReadWriteTimeout=30000
    $response=$null;$inputStream=$null;$outputStream=$null;$success=$false
    $timer=[Diagnostics.Stopwatch]::StartNew()
    try {
        $response=$request.GetResponse()
        $total=$response.ContentLength
        $inputStream=$response.GetResponseStream()
        $outputStream=[IO.File]::Create($OutFile)
        $buffer=New-Object byte[] 131072
        [long]$received=0;$lastUpdate=-1000;$lastConsoleUpdate=-2000
        while(($count=$inputStream.Read($buffer,0,$buffer.Length)) -gt 0){
            if($timer.Elapsed.TotalSeconds -ge $TimeoutSeconds){throw 'Tempo massimo di download superato.'}
            $outputStream.Write($buffer,0,$count);$received+=$count
            if($timer.ElapsedMilliseconds-$lastUpdate -ge 250){
                $progress=Get-DownloadProgress $received $total
                if($ConsoleProgress -and (Get-Command Get-UpdateTransferLine -ErrorAction SilentlyContinue)){
                    $line=Get-UpdateTransferLine $received $total $timer.Elapsed.TotalSeconds
                    if([Console]::IsOutputRedirected){if($timer.ElapsedMilliseconds-$lastConsoleUpdate -ge 2000){Write-Host $line;$lastConsoleUpdate=$timer.ElapsedMilliseconds}}
                    else{$width=[math]::Max(40,[Console]::WindowWidth-1);$shown=if($line.Length -gt $width){$line.Substring(0,$width)}else{$line};Write-Host ("`r"+$shown.PadRight($width)) -NoNewline}
                } else { Write-Progress -Id 1 -Activity $Activity -Status $progress.Status -PercentComplete $progress.Percent }
                if(Get-Command Publish-SetupProgress -ErrorAction SilentlyContinue){Publish-SetupProgress $Activity $progress.Status $progress.Percent}
                $lastUpdate=$timer.ElapsedMilliseconds
            }
        }
        if($total -ge 0 -and $received -ne $total){throw 'Download incompleto: dimensione diversa da quella dichiarata dal server.'}
        $success=$true
        if($ConsoleProgress){Write-Host ""}
        Write-Host ($Activity+': '+(Get-DownloadProgress $received $total).Status+' - completato')
    } finally {
        if($outputStream){$outputStream.Dispose()}
        if($inputStream){$inputStream.Dispose()}
        if($response){$response.Dispose()}
        $request.Abort();$timer.Stop()
        Write-Progress -Id 1 -Activity $Activity -Completed
        if(-not $success -and (Test-Path -LiteralPath $OutFile)){Remove-Item -LiteralPath $OutFile -Force}
    }
}
