@echo off
setlocal
title Segretario MMG - Installazione PaddleOCR Browser v0.12.2
echo.
echo ============================================================
echo   Segretario MMG - Installazione PaddleOCR integrato
echo ============================================================
echo.
echo IMPORTANTE:
echo questo file deve essere eseguito dalla CARTELLA ESTRATTA
echo dell'estensione, NON direttamente dentro il file ZIP.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALLA_PADDLEOCR_BROWSER.ps1"
set ERR=%ERRORLEVEL%

echo.
if "%ERR%"=="0" (
  echo INSTALLAZIONE COMPLETATA.
  echo Ora esegui VERIFICA_PADDLEOCR_BROWSER.bat.
) else (
  echo INSTALLAZIONE NON COMPLETATA. Codice errore: %ERR%
  echo Leggi il messaggio sopra e il file PADDLEOCR_INSTALLAZIONE.log
)
echo.
pause
exit /b %ERR%
