@echo off
chcp 65001 >nul
title RM_AI_NPC - one click install
cd /d "%~dp0"

rem  ================================================================
rem   RM_AI_NPC one-click installer (Windows only, no Node.js needed).
rem   Double-click this file. Or drag your game folder onto it.
rem   All the real work is in _oneclick.ps1 (kept ASCII here on purpose,
rem   so the .bat never breaks on a non-Chinese code page).
rem  ================================================================

set "PS1=%~dp0_oneclick.ps1"
if not exist "%PS1%" (
    echo.
    echo   [X] _oneclick.ps1 is missing next to this .bat file.
    echo       Please unzip the whole package again and keep its files together.
    echo.
    pause
    exit /b 1
)

where powershell >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [X] Windows PowerShell was not found on this machine.
    echo       Try route A in the readme: install Node.js and run
    echo         node tools/install.js "your game folder"
    echo.
    pause
    exit /b 1
)

rem  Drag a game folder onto this .bat -> %* is that folder, and _oneclick.ps1
rem  takes it as its first parameter (=-Game). No argument (plain double-click)
rem  -> nothing is passed, and _oneclick.ps1 looks around the package instead.
rem  Why not an "if %~1" block here: an unzip folder named "... (1)" contains a
rem  ")" which would break cmd's parenthesised blocks. Passing %* through is safe.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
