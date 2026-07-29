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
echo    [1]  Run all checks        typecheck + build + full test suite
echo    [2]  Run the Jul-25 tests  ref coercion + stop button only (fast)
echo    [3]  Start the app         dev server + opens the browser
echo.
echo    [4]  Commit and push       review, commit, push to GitHub
echo    [5]  Deploy to Vercel      npx vercel --prod  (the live site)
echo    [6]  Full release          checks -^> commit -^> deploy
echo.
echo    [7]  Fix a stuck git lock  when OneDrive leaves .git\index.lock behind
echo    [8]  Where things stand    branch, changes, last commits
echo.
echo    [0]  Exit
echo.
set "pick="
set /p pick=Type a number and press Enter: 

if "%pick%"=="1" ( call "%~dp0scripts\check.bat" & goto menu )
if "%pick%"=="2" ( call "%~dp0scripts\test-new.bat" & goto menu )
if "%pick%"=="3" ( call "%~dp0scripts\dev.bat" & goto menu )
if "%pick%"=="4" ( call "%~dp0scripts\commit.bat" & goto menu )
if "%pick%"=="5" ( call "%~dp0scripts\deploy.bat" & goto menu )
if "%pick%"=="6" ( call "%~dp0scripts\release.bat" & goto menu )
if "%pick%"=="7" ( call "%~dp0scripts\fix-git-lock.bat" & goto menu )
if "%pick%"=="8" ( call "%~dp0scripts\status.bat" & goto menu )
if "%pick%"=="0" ( exit /b 0 )

echo.
echo    "%pick%" is not one of the options.
timeout /t 2 >nul
goto menu
