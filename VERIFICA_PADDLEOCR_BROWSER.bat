@echo off
setlocal
title Segretario MMG - Verifica PaddleOCR Browser
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0VERIFICA_PADDLEOCR_BROWSER.ps1"
set ERR=%ERRORLEVEL%
echo.
pause
exit /b %ERR%
