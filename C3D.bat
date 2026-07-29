@echo off
REM ===========================================================================
REM  C33D - double-click launcher for the routine project tasks.
REM  Everything it runs lives in scripts\ so each step can also be run alone.
REM ===========================================================================
setlocal
cd /d "%~dp0"
title C33D

:menu
cls
echo ===============================================================
echo    C33D
echo    %CD%
echo ===============================================================
echo.
echo    TEST
echo      [1]  Start the app        one instance, opens the browser
echo      [2]  Start N instances    parallel model testing, one database
echo      [3]  Add a note           your comment on the last session
echo      [4]  Session data         what has been recorded
echo.
echo    BUILD
echo      [5]  Run all checks       typecheck + build + full test suite
echo      [6]  Quick tests          the fast contract tests only
echo.
echo    SAVE AND SHIP
echo      [7]  Commit and push
echo      [8]  Deploy to Vercel     the live site
echo      [9]  Full release         checks -^> commit -^> deploy
echo.
echo    SETUP AND REPAIR
echo      [S]  Import old exports   one-time: JSONs into the database
echo      [L]  Fix a stuck git lock
echo      [W]  Where things stand
echo.
echo      [0]  Exit
echo.
set "pick="
set /p pick=Type a number or letter and press Enter: 

if "%pick%"=="1" ( call "%~dp0scripts\dev.bat" & goto menu )
if "%pick%"=="2" ( call "%~dp0scripts\dev-multi.bat" & goto menu )
if "%pick%"=="3" ( call "%~dp0scripts\note.bat" & goto menu )
if "%pick%"=="4" ( call "%~dp0scripts\db.bat" & goto menu )
if "%pick%"=="5" ( call "%~dp0scripts\check.bat" & goto menu )
if "%pick%"=="6" ( call "%~dp0scripts\test-new.bat" & goto menu )
if "%pick%"=="7" ( call "%~dp0scripts\commit.bat" & goto menu )
if "%pick%"=="8" ( call "%~dp0scripts\deploy.bat" & goto menu )
if "%pick%"=="9" ( call "%~dp0scripts\release.bat" & goto menu )
if /i "%pick%"=="S" ( call "%~dp0scripts\db-setup.bat" & goto menu )
if /i "%pick%"=="L" ( call "%~dp0scripts\fix-git-lock.bat" & goto menu )
if /i "%pick%"=="W" ( call "%~dp0scripts\status.bat" & goto menu )
if "%pick%"=="0" ( exit /b 0 )

echo.
echo    "%pick%" is not one of the options.
timeout /t 2 >nul
goto menu
