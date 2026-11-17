$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Vendor = Join-Path $Root "vendor\paddleocr"
$Bundle = Join-Path $Vendor "paddleocr.bundle.js"
$Models = Join-Path $Vendor "models"
$WasmDir = Join-Path $Vendor "wasm"
$Marker = Join-Path $Vendor "INSTALLAZIONE_OK.txt"

$Det = Join-Path $Models "PP-OCRv6_tiny_det_onnx_infer.tar"
$Rec = Join-Path $Models "PP-OCRv6_tiny_rec_onnx_infer.tar"

$errors = @()

Write-Host "Segretario MMG - verifica PaddleOCR integrato" -ForegroundColor Cyan
Write-Host "Cartella estensione:"
Write-Host "  $Root"
Write-Host ""

function CheckFile([string]$Label, [string]$Path, [long]$MinBytes) {
    if (-not (Test-Path $Path)) {
        Write-Host "[NO] $Label" -ForegroundColor Red
        Write-Host "     $Path"
        $script:errors += "$Label mancante"
        return
    }

    $size = (Get-Item $Path).Length
    if ($size -lt $MinBytes) {
        Write-Host "[NO] $Label - file troppo piccolo ($size bytes)" -ForegroundColor Red
        $script:errors += "$Label incompleto"
        return
    }

    Write-Host "[OK] $Label - $size bytes" -ForegroundColor Green
}

CheckFile "Bundle PaddleOCR" $Bundle 100000
CheckFile "Modello detection" $Det 100000
CheckFile "Modello recognition" $Rec 100000

$wasmFiles = @()
$mjsFiles = @()

if (
    -not [string]::IsNullOrWhiteSpace($WasmDir) -and
    (Test-Path -LiteralPath $WasmDir)
) {
    $wasmFiles = @(
        Get-ChildItem -LiteralPath $WasmDir -Filter "*.wasm" -File
    )
    $mjsFiles = @(
        Get-ChildItem -LiteralPath $WasmDir -Filter "*.mjs" -File
    )
}

if ($wasmFiles.Count -lt 1) {
    Write-Host "[NO] Runtime ONNX/WASM" -ForegroundColor Red
    Write-Host "     $WasmDir"
    $errors += "Runtime WASM mancante"
} else {
    Write-Host "[OK] Runtime ONNX/WASM - $($wasmFiles.Count) file" -ForegroundColor Green
}

if ($mjsFiles.Count -lt 1) {
    Write-Host "[NO] Moduli ONNX .mjs" -ForegroundColor Red
    Write-Host "     $WasmDir"
    $errors += "Moduli ONNX .mjs mancanti"
} else {
    Write-Host "[OK] Moduli ONNX .mjs - $($mjsFiles.Count) file" -ForegroundColor Green
}

$JsepMjs = Join-Path $WasmDir "ort-wasm-simd-threaded.jsep.mjs"
$JsepWasm = Join-Path $WasmDir "ort-wasm-simd-threaded.jsep.wasm"

if (Test-Path -LiteralPath $JsepMjs) {
    Write-Host "[OK] ort-wasm-simd-threaded.jsep.mjs" -ForegroundColor Green
} else {
    Write-Host "[NO] ort-wasm-simd-threaded.jsep.mjs" -ForegroundColor Red
    $errors += "JSEP MJS mancante"
}

if (Test-Path -LiteralPath $JsepWasm) {
    Write-Host "[OK] ort-wasm-simd-threaded.jsep.wasm" -ForegroundColor Green
} else {
    Write-Host "[NO] ort-wasm-simd-threaded.jsep.wasm" -ForegroundColor Red
    $errors += "JSEP WASM mancante"
}

if (Test-Path $Marker) {
    Write-Host "[OK] Marker INSTALLAZIONE_OK.txt" -ForegroundColor Green
} else {
    Write-Host "[NO] Marker INSTALLAZIONE_OK.txt" -ForegroundColor Red
    $errors += "Marker installazione mancante"
}

Write-Host ""

if ($errors.Count -gt 0) {
    Write-Host "PADDLEOCR NON PRONTO." -ForegroundColor Red
    Write-Host "Rilancia INSTALLA_PADDLEOCR_BROWSER.bat dalla cartella estratta dell'estensione." -ForegroundColor Yellow
    exit 1
}

Write-Host "PADDLEOCR PRONTO." -ForegroundColor Green
Write-Host ""
Write-Host "Ora puoi fare:"
Write-Host "1. chrome://extensions -> Ricarica"
Write-Host "2. Ctrl+Shift+R su Eumed"
Write-Host "3. prova OCR VELOCE"
exit 0
