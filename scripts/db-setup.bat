@echo off
REM ===========================================================================
REM  One-time: import every existing session export into data\c33d.db, tag the
REM  corpus as a version, and move the JSON files into archive\.
REM
REM  Safe to run twice - sessions already imported are skipped, and --archive
REM  MOVES files rather than deleting them.
REM ===========================================================================
setlocal enabledelayedexpansion
call "%~dp0_common.bat" || exit /b 1
cd /d "%~dp0.."

echo.
echo   This imports JSONs\*.json into data\c33d.db and tags them as a version,
echo   so every future result can be compared against this baseline.
echo.
set "tag="
set /p tag=Version tag [v1]: 
if "!tag!"=="" set "tag=v1"

echo.
set "arch="
set /p arch=Also move JSONs\ into archive\!tag!\ afterwards? [y/N]: 
echo.
if /i "!arch!"=="y" (
  call node --no-warnings scripts\db-import.mjs --tag "!tag!" --archive
) else (
  call node --no-warnings scripts\db-import.mjs --tag "!tag!"
)
echo.
pause
