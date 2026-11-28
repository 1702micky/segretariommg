function Write-UpdatePhase {
    param([int]$Step,[string]$Title,[string]$Detail='')
    Write-Host ''
    Write-Host ('[{0}/6] {1}' -f $Step,$Title) -ForegroundColor Cyan
    if($Detail){Write-Host $Detail}
}

function Get-UpdateTransferLine {
    param([long]$Received,[long]$Total,[double]$Seconds)
    $progress=Get-DownloadProgress $Received $Total
    $rate=if($Seconds -gt 0){$Received/1000000.0/$Seconds}else{0}
    if($Total -gt 0){
        $filled=[math]::Min(24,[math]::Floor(24*$Received/$Total))
        $bar=('='*$filled)+(' '*(24-$filled))
        $remaining=[math]::Max(0,($Total-$Received)/1000000.0)
        $eta=if($rate -gt 0){[TimeSpan]::FromSeconds([math]::Min(864000,($Total-$Received)/1000000.0/$rate)).ToString('hh\:mm\:ss')}else{'--:--:--'}
        return ('[{0}] {1}% | {2} | restano {3:N1} MB | {4:N1} MB/s | circa {5}' -f $bar,$progress.Percent,$progress.Status,$remaining,$rate,$eta)
    }
    return ('{0} | {1:N1} MB/s | download in corso...' -f $progress.Status,$rate)
}

function Get-UpdateSha256 {
    param([Parameter(Mandatory=$true)][string]$Path)
    $stream=[IO.File]::OpenRead($Path)
    $sha=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}
