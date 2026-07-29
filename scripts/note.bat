@echo off
REM ===========================================================================
REM  Attach a note to the most recent session.
REM
REM  This is for YOUR observations - "columns scattered again", "best result so
REM  far", "this is the same failure as the temple". It is stored next to the
REM  data and NEVER enters the conversation, so it cannot influence a model or
REM  pollute a transcript.
REM ===========================================================================
setlocal enabledelayedexpansion
call "%~dp0_common.bat" || exit /b 1
cd /d "%~dp0.."

echo.
echo   Note for the most recent session (Enter on an empty line to cancel):
echo.
set "body="
set /p body=Note: 
if "!body!"=="" (
  echo   Cancelled - nothing written.
  pause
  exit /b 0
)
echo.
echo   Verdict for this session - Enter to skip:
echo     [1] OK    did what I asked
echo     [2] WEAK  partly there
echo     [3] FAIL  no usable result
set "v="
set /p v=Choice: 
set "verdict="
if "!v!"=="1" set "verdict=--verdict OK"
if "!v!"=="2" set "verdict=--verdict WEAK"
if "!v!"=="3" set "verdict=--verdict FAIL"
call node --no-warnings scripts\note.mjs !verdict! "!body!"
echo.
pause
