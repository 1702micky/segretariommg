$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Vendor = Join-Path $Root "vendor"
New-Item -ItemType Directory -Force -Path $Vendor | Out-Null

$Version = "6.5.438"

function Download-WithFallback {
    param(
        [string[]]$Urls,
        [string]$OutFile,
        [int]$MinBytes
    )

    $lastError = $null

    foreach ($Url in $Urls) {
        try {
            Write-Host "Download: $Url"
            Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile

            $size = (Get-Item $OutFile).Length
            if ($size -lt $MinBytes) {
                throw "File troppo piccolo ($size byte)"
            }

            Write-Host "OK: $OutFile ($size byte)" -ForegroundColor Green
            return
        }
        catch {
            $lastError = $_
            Write-Host "Tentativo fallito: $($_.Exception.Message)" -ForegroundColor Yellow
            Remove-Item -Force -ErrorAction SilentlyContinue $OutFile
        }
    }

    throw "Impossibile scaricare la dipendenza. Ultimo errore: $lastError"
}

$pdf = Join-Path $Vendor "pdf.mjs"
$worker = Join-Path $Vendor "pdf.worker.mjs"

Download-WithFallback -Urls @(
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@$Version/build/pdf.mjs",
    "https://unpkg.com/pdfjs-dist@$Version/build/pdf.mjs"
) -OutFile $pdf -MinBytes 300000

Download-WithFallback -Urls @(
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@$Version/build/pdf.worker.mjs",
    "https://unpkg.com/pdfjs-dist@$Version/build/pdf.worker.mjs"
) -OutFile $worker -MinBytes 500000

Write-Host ""
Write-Host "PDF.js installato localmente." -ForegroundColor Green
Write-Host "Ora apri chrome://extensions, premi Ricarica su Segretario MMG e ricarica il gestionale."
Write-Host ""
Read-Host "Premi INVIO per chiudere"
