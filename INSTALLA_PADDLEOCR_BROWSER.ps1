$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Manifest = Join-Path $Root "manifest.json"
$Bridge = Join-Path $Root "PaddleOCR_Browser\paddleocr_bridge.mjs"
$Vendor = Join-Path $Root "vendor\paddleocr"
$Models = Join-Path $Vendor "models"
$Wasm = Join-Path $Vendor "wasm"
$Bundle = Join-Path $Vendor "paddleocr.bundle.js"
$Marker = Join-Path $Vendor "INSTALLAZIONE_OK.txt"
$Log = Join-Path $Root "PADDLEOCR_INSTALLAZIONE.log"
$Temp = Join-Path $env:TEMP "SegretarioMMG-PaddleOCR-Browser"

function Log([string]$Text) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$stamp  $Text" | Tee-Object -FilePath $Log -Append
}

function Show-NativeOutput($Output) {
    foreach ($line in @($Output)) {
        if ($null -eq $line) { continue }
        $text = $line.ToString()
        if ([string]::IsNullOrWhiteSpace($text)) { continue }
        Write-Host $text
        Add-Content -Path $Log -Value $text
    }
}

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [Parameter(Mandatory=$true)][string]$Label
    )

    Log "$Label :: $FilePath $($Arguments -join ' ')"

    # Windows PowerShell può trasformare lo stderr di programmi nativi in
    # ErrorRecord. Con ErrorActionPreference=Stop un semplice warning npm
    # può quindi interrompere lo script. Per i soli processi nativi usiamo
    # temporaneamente Continue e decidiamo l'esito ESCLUSIVAMENTE dal vero
    # codice di uscita.
    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = & $FilePath @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldPreference
    }

    Show-NativeOutput $output
    Log "$Label exit code: $exitCode"

    if ($exitCode -ne 0) {
        throw "$Label non riuscito (codice $exitCode)."
    }

    return $exitCode
}

try {
    Set-Content -Path $Log -Value "Segretario MMG - log installazione PaddleOCR Browser v0.12.2"

    Write-Host "Cartella rilevata:" -ForegroundColor Cyan
    Write-Host "  $Root"
    Log "Root: $Root"

    if (-not (Test-Path $Manifest)) {
        throw "manifest.json non trovato accanto all'installer. Estrai TUTTO lo ZIP nella cartella dell'estensione e riprova."
    }

    if (-not (Test-Path $Bridge)) {
        throw "PaddleOCR_Browser\paddleocr_bridge.mjs non trovato. Estrai TUTTO lo ZIP nella stessa cartella prima di eseguire l'installer."
    }

    $manifestJson = Get-Content $Manifest -Raw | ConvertFrom-Json
    Write-Host "Estensione trovata: $($manifestJson.name) v$($manifestJson.version)" -ForegroundColor Green
    Log "Manifest trovato: $($manifestJson.name) v$($manifestJson.version)"

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "Node.js non trovato. Installa Node.js LTS da https://nodejs.org/ e rilancia questo installer."
    }

    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        $npm = Get-Command npm -ErrorAction SilentlyContinue
    }
    if (-not $npm) {
        throw "npm non trovato. Reinstalla Node.js LTS includendo npm."
    }

    $nodeVersion = (& node --version).Trim()
    $npmVersion = (& $npm.Source --version).Trim()

    Log "Node: $nodeVersion"
    Log "npm: $npmVersion"

    $npmMajor = 0
    try {
        $npmMajor = [int](($npmVersion -split '\.')[0])
    } catch {
        $npmMajor = 0
    }

    Remove-Item $Marker -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $Vendor "paddleocr.bundle.mjs") -Force -ErrorAction SilentlyContinue
    Remove-Item $Temp -Recurse -Force -ErrorAction SilentlyContinue

    New-Item -ItemType Directory -Force -Path $Temp | Out-Null
    New-Item -ItemType Directory -Force -Path $Vendor | Out-Null
    New-Item -ItemType Directory -Force -Path $Models | Out-Null
    New-Item -ItemType Directory -Force -Path $Wasm | Out-Null

    Push-Location $Temp
    try {
        Write-Host ""
        Write-Host "[1/5] Preparazione progetto npm..." -ForegroundColor Cyan
        Invoke-NativeChecked `
            -FilePath $npm.Source `
            -Arguments @("init","-y") `
            -Label "npm init"

        Write-Host ""
        Write-Host "[2/5] Installazione librerie npm..." -ForegroundColor Cyan

        Invoke-NativeChecked `
            -FilePath $npm.Source `
            -Arguments @(
                "install",
                "--no-audit",
                "--no-fund",
                "@paddleocr/paddleocr-js@0.4.2",
                "esbuild"
            ) `
            -Label "npm install"

        # npm 11 blocca per default gli install-script non ancora approvati e
        # mostra un warning. Nel nostro progetto TEMPORANEO e isolato
        # approviamo esplicitamente solo le dipendenze appena installate.
        if ($npmMajor -ge 11) {
            Write-Host ""
            Write-Host "npm 11 rilevato: approvazione install-script del progetto temporaneo..." -ForegroundColor Cyan

            try {
                Invoke-NativeChecked `
                    -FilePath $npm.Source `
                    -Arguments @("install-scripts","ls") `
                    -Label "npm install-scripts ls"
            } catch {
                Log "install-scripts ls non disponibile/necessario: $($_.Exception.Message)"
            }

            Invoke-NativeChecked `
                -FilePath $npm.Source `
                -Arguments @("install-scripts","approve","--all") `
                -Label "npm install-scripts approve --all"

            Invoke-NativeChecked `
                -FilePath $npm.Source `
                -Arguments @("rebuild") `
                -Label "npm rebuild"
        }

        Write-Host ""
        Write-Host "[3/5] Creazione bundle browser..." -ForegroundColor Cyan
        Copy-Item $Bridge (Join-Path $Temp "paddleocr_bridge.mjs") -Force

        $Esbuild = Join-Path $Temp "node_modules\.bin\esbuild.cmd"
        if (-not (Test-Path $Esbuild)) {
            throw "esbuild.cmd non trovato dopo npm install/rebuild."
        }

        # @techstark/opencv-js contiene sia il ramo browser sia il ramo Node.
        # Il ramo Node fa require('fs'), require('path') e talvolta 'crypto'.
        # Nel browser quei moduli non devono esistere: la documentazione del
        # pacchetto raccomanda fallback=false. Con esbuild realizziamo lo
        # stesso comportamento tramite piccoli moduli shim locali.
        $ShimDir = Join-Path $Temp "browser-shims"
        New-Item -ItemType Directory -Force -Path $ShimDir | Out-Null

        $FsShim = Join-Path $ShimDir "fs.mjs"
        $PathShim = Join-Path $ShimDir "path.mjs"
        $CryptoShim = Join-Path $ShimDir "crypto.mjs"

        @"
const empty = {};
export default empty;
export const promises = empty;
"@ | Set-Content -Path $FsShim -Encoding UTF8

        @"
const empty = {};
export default empty;
export const sep = "/";
export const delimiter = ";";
export function normalize(value) { return String(value ?? ""); }
export function resolve(...parts) { return parts.filter(Boolean).join("/"); }
export function join(...parts) { return parts.filter(Boolean).join("/"); }
export function dirname() { return ""; }
export function basename(value) { return String(value ?? ""); }
"@ | Set-Content -Path $PathShim -Encoding UTF8

        @"
const empty = {};
export default empty;
export function randomBytes() {
  throw new Error("crypto.randomBytes non disponibile nel browser");
}
"@ | Set-Content -Path $CryptoShim -Encoding UTF8

        Log "Browser shim creati: fs/path/crypto"

        Invoke-NativeChecked `
            -FilePath $Esbuild `
            -Arguments @(
                (Join-Path $Temp "paddleocr_bridge.mjs"),
                "--bundle",
                "--format=iife",
                "--global-name=SegretarioPaddleOCRBundle",
                "--platform=browser",
                "--target=chrome114",
                "--alias:fs=$FsShim",
                "--alias:path=$PathShim",
                "--alias:crypto=$CryptoShim",
                "--outfile=$Bundle",
                "--log-level=info"
            ) `
            -Label "esbuild browser bundle"

        if (-not (Test-Path $Bundle)) {
            throw "esbuild non ha creato paddleocr.bundle.js."
        }

        $bundleSize = (Get-Item $Bundle).Length
        Log "Bundle creato: $Bundle ($bundleSize bytes)"

        $bundleHead = Get-Content $Bundle -Raw
        if ($bundleHead -match 'Could not resolve "fs"' -or $bundleHead -match 'Could not resolve "path"') {
            throw "Il bundle contiene ancora riferimenti Node non risolti."
        }

        if ($bundleSize -lt 100000) {
            throw "paddleocr.bundle.js è troppo piccolo ($bundleSize bytes): bundle probabilmente incompleto."
        }

        Write-Host ""
        Write-Host "[4/5] Copia runtime ONNX/WASM..." -ForegroundColor Cyan
        $OrtDist = Join-Path $Temp "node_modules\onnxruntime-web\dist"

        if (-not (Test-Path $OrtDist)) {
            throw "Cartella onnxruntime-web\dist non trovata."
        }

        # ONNX Runtime Web recente usa sia i binari .wasm sia moduli ES .mjs
        # della STESSA build. Il backend può richiedere, ad esempio:
        #   ort-wasm-simd-threaded.jsep.mjs
        #   ort-wasm-simd-threaded.jsep.wasm
        # Copiamo quindi entrambe le famiglie, non solo i .wasm.
        $wasmFiles = @(
            Get-ChildItem $OrtDist -Filter "*.wasm" -File
        )
        $mjsFiles = @(
            Get-ChildItem $OrtDist -Filter "*.mjs" -File
        )

        if ($wasmFiles.Count -lt 1) {
            throw "Nessun file ONNX Runtime .wasm trovato."
        }

        if ($mjsFiles.Count -lt 1) {
            throw "Nessun file ONNX Runtime .mjs trovato."
        }

        # Pulisce solo i vecchi artifact ONNX per evitare residui di versioni diverse.
        Get-ChildItem $Wasm -Filter "ort-*.wasm" -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
        Get-ChildItem $Wasm -Filter "ort-*.mjs" -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue

        $wasmFiles | Copy-Item -Destination $Wasm -Force
        $mjsFiles | Copy-Item -Destination $Wasm -Force

        Log "WASM copiati: $($wasmFiles.Count)"
        Log "MJS ONNX copiati: $($mjsFiles.Count)"

        $requiredJsepMjs = Join-Path $Wasm "ort-wasm-simd-threaded.jsep.mjs"
        $requiredJsepWasm = Join-Path $Wasm "ort-wasm-simd-threaded.jsep.wasm"

        if (-not (Test-Path $requiredJsepMjs)) {
            throw "Runtime ONNX incompleto: manca ort-wasm-simd-threaded.jsep.mjs."
        }

        if (-not (Test-Path $requiredJsepWasm)) {
            throw "Runtime ONNX incompleto: manca ort-wasm-simd-threaded.jsep.wasm."
        }

        Write-Host ""
        Write-Host "[5/5] Download modelli PaddleOCR..." -ForegroundColor Cyan

        $DetFile = Join-Path $Models "PP-OCRv6_tiny_det_onnx_infer.tar"
        $RecFile = Join-Path $Models "PP-OCRv6_tiny_rec_onnx_infer.tar"

        $DetUrl = "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_det_onnx_infer.tar"
        $RecUrl = "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_rec_onnx_infer.tar"

        if (-not (Test-Path $DetFile) -or (Get-Item $DetFile).Length -lt 100000) {
            Write-Host "Download modello detection..."
            Invoke-WebRequest -Uri $DetUrl -OutFile $DetFile
        } else {
            Write-Host "Modello detection gia' presente."
        }

        if (-not (Test-Path $RecFile) -or (Get-Item $RecFile).Length -lt 100000) {
            Write-Host "Download modello recognition..."
            Invoke-WebRequest -Uri $RecUrl -OutFile $RecFile
        } else {
            Write-Host "Modello recognition gia' presente."
        }

        if ((Get-Item $DetFile).Length -lt 100000) {
            throw "Modello detection incompleto."
        }

        if ((Get-Item $RecFile).Length -lt 100000) {
            throw "Modello recognition incompleto."
        }

        $required = @(
            $Bundle,
            $DetFile,
            $RecFile
        )

        foreach ($file in $required) {
            if (-not (Test-Path $file)) {
                throw "File richiesto mancante al controllo finale: $file"
            }
        }

        $installedWasm = @(
            Get-ChildItem $Wasm -Filter "*.wasm" -File
        )
        $installedMjs = @(
            Get-ChildItem $Wasm -Filter "*.mjs" -File
        )

        if ($installedWasm.Count -lt 1) {
            throw "Runtime WASM mancante al controllo finale."
        }

        if ($installedMjs.Count -lt 1) {
            throw "Moduli MJS ONNX mancanti al controllo finale."
        }

        $requiredJsepMjs = Join-Path $Wasm "ort-wasm-simd-threaded.jsep.mjs"
        $requiredJsepWasm = Join-Path $Wasm "ort-wasm-simd-threaded.jsep.wasm"

        if (-not (Test-Path $requiredJsepMjs)) {
            throw "Runtime ONNX incompleto al controllo finale: manca ort-wasm-simd-threaded.jsep.mjs."
        }

        if (-not (Test-Path $requiredJsepWasm)) {
            throw "Runtime ONNX incompleto al controllo finale: manca ort-wasm-simd-threaded.jsep.wasm."
        }

        @"
INSTALLAZIONE OK
Data: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Root estensione: $Root
Node: $nodeVersion
npm: $npmVersion
Bundle: $Bundle
Bundle bytes: $bundleSize
WASM: $($installedWasm.Count)
MJS ONNX: $($installedMjs.Count)
JSEP MJS: $requiredJsepMjs
JSEP WASM: $requiredJsepWasm
Detection bytes: $((Get-Item $DetFile).Length)
Recognition bytes: $((Get-Item $RecFile).Length)
"@ | Set-Content -Path $Marker -Encoding UTF8

        Log "INSTALLAZIONE OK"
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  INSTALLAZIONE OK" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Bundle creato in:"
    Write-Host "  $Bundle" -ForegroundColor White
    Write-Host ""
    Write-Host "Adesso esegui VERIFICA_PADDLEOCR_BROWSER.bat." -ForegroundColor Yellow
    Write-Host "Poi: chrome://extensions -> Ricarica -> Ctrl+Shift+R su Eumed." -ForegroundColor Yellow

    exit 0
}
catch {
    $message = $_.Exception.Message
    try { Log "ERRORE: $message" } catch {}

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host "  INSTALLAZIONE NON COMPLETATA" -ForegroundColor Red
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host $message -ForegroundColor Red
    Write-Host ""
    Write-Host "Log:"
    Write-Host "  $Log"
    Write-Host ""
    Write-Host "Non ricaricare ancora l'estensione: correggi l'errore e rilancia il BAT." -ForegroundColor Yellow

    exit 1
}
finally {
    Remove-Item $Temp -Recurse -Force -ErrorAction SilentlyContinue
}
