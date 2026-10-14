@echo off
chcp 65001 >nul
title AI NPC Config Panel
cd /d "%~dp0"

rem ================================================================
rem  AI NPC config panel - lives next to Game.exe so it is easy to find.
rem  Same logic as the copy inside www\ai_npc, but ASCII-only content,
rem  because cmd.exe breaks on multi-byte chars inside .bat files.
rem ================================================================

set "PANEL=%~dp0www\ai_npc"
if not exist "%PANEL%\config-panel.html" (
  echo.
  echo   [X] "%PANEL%\config-panel.html" not found.
  echo       Run the installer first:  node tools\install.js "<game folder>"
  echo.
  pause >nul
  exit /b 1
)

set "NODE="
for %%P in (
  "%ProgramFiles%\nodejs\node.exe"
  "%ProgramFiles(x86)%\nodejs\node.exe"
  "%LOCALAPPDATA%\Programs\nodejs\node.exe"
  "%APPDATA%\npm\node.exe"
) do if not defined NODE if exist %%P set "NODE=%%~P"

if not defined NODE (
  for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
)

if defined NODE goto serve

echo.
echo   ^> Node.js not found - opening the panel directly in your browser.
echo.
if exist "%PANEL%\panel-help.txt" type "%PANEL%\panel-help.txt"
echo.
start "" "%PANEL%\config-panel.html"
timeout /t 12 >nul
exit /b 0

:serve
echo.
echo   ^> Node: %NODE%
echo   ^> starting local server on 127.0.0.1 ^(browser opens automatically^)...
echo      Close this window when done. Your config file is not affected.
echo.
"%NODE%" "%PANEL%\config-server.js"
echo.
echo   ^> server stopped.
echo.
if exist "%PANEL%\panel-help.txt" type "%PANEL%\panel-help.txt"
pause >nul
exit /b 0
