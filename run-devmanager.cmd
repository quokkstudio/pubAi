@echo off
setlocal

cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="

where npm.cmd >nul 2>&1
set "NPM_CMD="
if exist "C:\Program Files\nodejs\npm.cmd" set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
if not defined NPM_CMD if exist "C:\Program Files (x86)\nodejs\npm.cmd" set "NPM_CMD=C:\Program Files (x86)\nodejs\npm.cmd"
if not defined NPM_CMD (
  for /f "delims=" %%I in ('where npm.cmd 2^>nul') do (
    set "NPM_CMD=%%I"
    goto :npm_found
  )
)

:npm_found
if not defined NPM_CMD (
  echo [ERROR] npm.cmd not found. Install Node.js first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] Installing dependencies...
  call "%NPM_CMD%" install
  if errorlevel 1 goto :fail
)

taskkill /F /IM electron.exe >nul 2>&1

echo [INFO] Building DevManager...
call "%NPM_CMD%" run build
if errorlevel 1 goto :fail

echo [INFO] Starting DevManager...
call "%NPM_CMD%" run start
if errorlevel 1 goto :fail

exit /b 0

:fail
echo [ERROR] Failed to start DevManager. Scroll up and check the first error line.
pause
exit /b 1
