@echo off
REM Shared preflight: run from the repo root, make sure node and deps exist.
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this machine.
  echo   Install the LTS build from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo   First run here - installing dependencies. This takes a few minutes.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   npm install failed. Nothing else was run.
    pause
    exit /b 1
  )
)
exit /b 0
