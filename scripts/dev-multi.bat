@echo off
REM ===========================================================================
REM  Start N independent app instances for side-by-side model testing.
REM
REM  Each instance gets its own PORT, and the port matters more than it looks:
REM  the browser keeps localStorage per origin, so every port is a SEPARATE app
REM  with its own agent slots, model choice and history. That is what makes N
REM  parallel tests independent rather than N views of the same state.
REM  You therefore pick the model in each window.
REM
REM  There is NO merge step. Every instance writes to the same data\c33d.db,
REM  and SQLite in WAL mode serialises them properly.
REM ===========================================================================
setlocal enabledelayedexpansion
call "%~dp0_common.bat" || exit /b 1
cd /d "%~dp0.."

echo.
echo   How many parallel sessions? 1-8, Enter for 5.
echo   (roughly 300-400 MB and one file watcher each)
echo.
set "n="
set /p n=Sessions: 
if "!n!"=="" set "n=5"
echo !n!| findstr /r "^[1-8]$" >nul
if errorlevel 1 (
  echo.
  echo   "!n!" is not a number from 1 to 8.
  pause
  exit /b 1
)

set /a last=5172+!n!
echo.
echo   Starting !n! servers on ports 5173-!last! ...
echo.

set /a i=0
:loop
set /a i+=1
set /a p=5172+!i!
echo   port !p! ...
start "C33D :!p!" cmd /k npm run dev -- --port !p! --strictPort
timeout /t 3 >nul
if !i! lss !n! goto loop

echo.
echo   Waiting for the servers to bind, then opening the tabs...
timeout /t 8 >nul
set /a i=0
:openloop
set /a i+=1
set /a p=5172+!i!
start "" http://localhost:!p!
if !i! lss !n! goto openloop

echo.
echo ===============================================================
echo   !n! instances are up on ports 5173-!last!.
echo.
echo   Everything is recorded automatically into data\c33d.db -
echo   every turn, every message, every run, from all !n! windows.
echo   Nothing to export, nothing to merge.
echo.
echo   Set a different model in each window, give them the same
echo   prompt, then use [4] Session data to see what happened.
echo   To leave a note on a run, use [3] Add a note.
echo.
echo   To stop: close the "C33D :port" windows.
echo ===============================================================
echo.
pause
