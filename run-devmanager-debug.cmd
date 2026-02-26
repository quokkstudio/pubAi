@echo off
setlocal

cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "LOG_FILE=%~dp0run-devmanager-debug.log"

echo ================================================ > "%LOG_FILE%"
echo [%date% %time%] DevManager debug start >> "%LOG_FILE%"
echo ================================================ >> "%LOG_FILE%"

where npm.cmd >nul 2>&1
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\npm.cmd" (
    set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
  ) else (
    echo [ERROR] npm.cmd not found. Install Node.js first.
    echo [ERROR] npm.cmd not found. Install Node.js first. >> "%LOG_FILE%"
    pause
    exit /b 1
  )
) else (
  set "NPM_CMD=npm.cmd"
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":5173 .*LISTENING"') do (
  echo [INFO] Releasing port 5173 (PID %%P)...
  echo [INFO] Releasing port 5173 (PID %%P)... >> "%LOG_FILE%"
  taskkill /F /PID %%P >> "%LOG_FILE%" 2>&1
)

taskkill /F /IM electron.exe >> "%LOG_FILE%" 2>&1

echo [INFO] npm run dev
call "%NPM_CMD%" run dev >> "%LOG_FILE%" 2>&1
set "DEV_EXIT=%ERRORLEVEL%"
echo [INFO] npm run dev exit code: %DEV_EXIT%
echo [INFO] npm run dev exit code: %DEV_EXIT% >> "%LOG_FILE%"

if not "%DEV_EXIT%"=="0" (
  echo [WARN] Fallback to build/start
  echo [WARN] Fallback to build/start >> "%LOG_FILE%"
  call "%NPM_CMD%" run build >> "%LOG_FILE%" 2>&1
  if errorlevel 1 goto :fail
  call "%NPM_CMD%" run start >> "%LOG_FILE%" 2>&1
  if errorlevel 1 goto :fail
)

echo [OK] finished. Log: %LOG_FILE%
pause
exit /b 0

:fail
echo [ERROR] Failed to start DevManager. Log: %LOG_FILE%
echo [ERROR] Failed to start DevManager. >> "%LOG_FILE%"
pause
exit /b 1
