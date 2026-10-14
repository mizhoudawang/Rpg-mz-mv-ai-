@echo off
chcp 65001 >nul
title AI NPC Config Panel
cd /d "%~dp0"

rem ================================================================
rem  Locate Node.js.
rem      found     -> start a local server on 127.0.0.1 (browser opens itself)
rem      not found -> open config-panel.html directly in the browser
rem
rem  THIS FILE IS INTENTIONALLY ASCII-ONLY.
rem  cmd.exe mis-parses multi-byte characters inside .bat files after
rem  chcp (it seeks by byte offset and cuts lines in half). All Chinese
rem  text lives in panel-help.txt and is printed with `type`.
rem ================================================================

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
if exist "%~dp0panel-help.txt" type "%~dp0panel-help.txt"
echo.
start "" "%~dp0config-panel.html"
timeout /t 12 >nul
exit /b 0

:serve
echo.
echo   ^> Node: %NODE%
echo   ^> starting local server on 127.0.0.1 ^(browser opens automatically^)...
echo      Close this window when done. Your config file is not affected.
echo.
"%NODE%" "%~dp0config-server.js"
echo.
echo   ^> server stopped.
echo.
if exist "%~dp0panel-help.txt" type "%~dp0panel-help.txt"
pause >nul
exit /b 0
