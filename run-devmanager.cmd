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

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":5173 .*LISTENING"') do (
  echo [INFO] Releasing port 5173 (PID %%P)...
  taskkill /F /PID %%P >nul 2>&1
)

taskkill /F /IM electron.exe >nul 2>&1

echo [INFO] Starting DevManager...
call "%NPM_CMD%" run dev
if errorlevel 1 (
  echo [WARN] npm run dev failed. Fallback to build/start mode...
  call "%NPM_CMD%" run build
  if errorlevel 1 goto :fail
  call "%NPM_CMD%" run start
  if errorlevel 1 goto :fail
)
exit /b 0

:fail
echo [ERROR] Failed to start DevManager. Scroll up and check the first error line.
pause
exit /b 1
