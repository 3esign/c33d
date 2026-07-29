@echo off
REM ===========================================================================
REM  Fold intelligence_log.<port>.json back into intelligence_log.json after a
REM  parallel test run. De-duplicates, sorts by time, backs up the original and
REM  never deletes anything - side files are renamed, not removed.
REM ===========================================================================
setlocal
call "%~dp0_common.bat" || exit /b 1
cd /d "%~dp0.."

echo.
call node scripts\merge-logs.mjs
if errorlevel 1 (
  echo.
  echo   Merge failed - your logs were not modified.
  pause
  exit /b 1
)
echo.
pause
