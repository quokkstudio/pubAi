@echo off
setlocal

cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="

where npm.cmd >nul 2>&1
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\npm.cmd" (
    set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
  ) else (
    echo [ERROR] npm.cmd not found. Install Node.js first.
    pause
    exit /b 1
  )
) else (
  set "NPM_CMD=npm.cmd"
)

if not exist "node_modules" (
  echo [INFO] Installing dependencies...
  call "%NPM_CMD%" install
  if errorlevel 1 goto :fail
)

echo [INFO] Starting DevManager...
call "%NPM_CMD%" run dev
if errorlevel 1 goto :fail
exit /b 0

:fail
echo [ERROR] Failed to start DevManager.
pause
exit /b 1
