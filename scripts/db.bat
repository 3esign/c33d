@echo off
REM ===========================================================================
REM  Look at what has been recorded. Read-only - nothing here changes data.
REM ===========================================================================
setlocal
call "%~dp0_common.bat" || exit /b 1
cd /d "%~dp0.."

:menu
cls
echo ===============================================================
echo    Session data  -  data\c33d.db
echo ===============================================================
echo.
echo    [1]  Overview          versions, models, your verdicts
echo    [2]  Models            outcomes per model
echo    [3]  Errors            what the compiler said, ranked
echo    [4]  Regressions       sessions that ended worse than they peaked
echo    [5]  Recent sessions
echo    [6]  My notes
echo    [7]  Compare two versions
echo    [8]  Run your own SQL
echo    [9]  Rebuild the index   from the event log (safe, non-destructive)
echo.
echo    [0]  Back
echo.
set "pick="
set /p pick=Choose: 
if "%pick%"=="1" ( call node --no-warnings scripts\db-query.mjs overview & pause & goto menu )
if "%pick%"=="2" ( call node --no-warnings scripts\db-query.mjs models & pause & goto menu )
if "%pick%"=="3" ( call node --no-warnings scripts\db-query.mjs errors & pause & goto menu )
if "%pick%"=="4" ( call node --no-warnings scripts\db-query.mjs regressions & pause & goto menu )
if "%pick%"=="5" ( call node --no-warnings scripts\db-query.mjs sessions 25 & pause & goto menu )
if "%pick%"=="6" ( call node --no-warnings scripts\db-query.mjs comments & pause & goto menu )
if "%pick%"=="7" goto compare
if "%pick%"=="8" goto sql
if "%pick%"=="9" ( call node --no-warnings scripts\db-rebuild.mjs & pause & goto menu )
if "%pick%"=="0" exit /b 0
goto menu

:compare
setlocal enabledelayedexpansion
set "a="
set "b="
set /p a=First version tag (e.g. v0.1): 
set /p b=Second version tag (e.g. v0.2): 
call node --no-warnings scripts\db-query.mjs compare "!a!" "!b!"
endlocal
pause
goto menu

:sql
setlocal enabledelayedexpansion
echo.
echo   Tables: sessions, turns, messages, runs, comments, versions
echo   (the index is derived - data\events\*.jsonl is the source of truth)
echo   Example: SELECT model, COUNT(*) FROM sessions GROUP BY model
echo.
set "q="
set /p q=SQL: 
if not "!q!"=="" call node --no-warnings scripts\db-query.mjs sql "!q!"
endlocal
pause
goto menu
