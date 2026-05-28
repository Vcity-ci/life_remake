@echo off
setlocal

cd /d "%~dp0"

set DEPLOY_MODE=local

echo [start-local] Checking Node.js and npm...
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

set NEED_INSTALL=0
if not exist node_modules set NEED_INSTALL=1
if not exist apps\backend\node_modules set NEED_INSTALL=1
if not exist apps\frontend\node_modules set NEED_INSTALL=1
if not exist packages\shared\node_modules set NEED_INSTALL=1
if not exist package-lock.json set NEED_INSTALL=1

if "%NEED_INSTALL%"=="1" (
  echo [start-local] Dependencies are missing. Running npm install...
  call npm install
  if errorlevel 1 (
    echo [error] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo [start-local] Dependencies look ready. Skipping install.
)

if not exist apps\backend\.env (
  echo [start-local] apps\backend\.env not found. Creating from template...
  copy /y "apps\backend\.env.example" "apps\backend\.env" >nul
)

echo [start-local] Releasing occupied ports 5173 and 4000 if needed...
for %%P in (5173 4000) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
    echo [start-local] Killing PID %%A on port %%P ...
    taskkill /PID %%A /F >nul 2>nul
  )
)

echo [start-local] Starting LOCAL deploy chain...
start "" cmd /c "timeout /t 6 >nul && start "" "http://localhost:5173""
set DEPLOY_MODE=local&& npm run dev
set EXITCODE=%ERRORLEVEL%

echo.
echo [done] Exit code: %EXITCODE%
echo Press any key to close...
pause >nul
exit /b %EXITCODE%
