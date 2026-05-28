@echo off
setlocal

cd /d "%~dp0"

set DEPLOY_MODE=cloud

echo [start-cloud] Checking Node.js and npm...
where node >nul 2>nul
if errorlevel 1 (
  echo [error] Node.js not found. Please install Node.js and add it to PATH.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [error] npm not found. Please install npm and add it to PATH.
  pause
  exit /b 1
)

echo [start-cloud] Releasing occupied ports 5173 and 4000 if needed...
for %%P in (5173 4000) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
    echo [start-cloud] Killing PID %%A on port %%P ...
    taskkill /PID %%A /F >nul 2>nul
  )
)

echo [start-cloud] Starting CLOUD deploy chain...
if not exist apps\backend\.env (
  echo [warn] apps\backend\.env not found. Please create it with CLOUD_MODEL_API_KEY for cloud mode.
)

set DEPLOY_MODE=cloud&& npm run dev
set EXITCODE=%ERRORLEVEL%

echo.
echo [done] Exit code: %EXITCODE%
echo Press any key to close...
pause >nul
exit /b %EXITCODE%
