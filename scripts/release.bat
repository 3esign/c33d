@echo off
REM ===========================================================================
REM  The whole chain in order: verify, then commit, then deploy.
REM  Stops at the first failure - a broken build never reaches the live site.
REM ===========================================================================
setlocal
cd /d "%~dp0.."

echo.
echo   STEP 1 of 3 - checks
call "%~dp0check.bat"
if errorlevel 1 (
  echo.
  echo   Checks failed. Stopping before commit.
  pause
  exit /b 1
)

echo.
echo   STEP 2 of 3 - commit and push
call "%~dp0commit.bat"
if errorlevel 1 (
  echo.
  echo   Commit step did not complete. Stopping before deploy.
  pause
  exit /b 1
)

echo.
echo   STEP 3 of 3 - deploy
call "%~dp0deploy.bat"

echo.
echo   Release chain finished.
echo.
pause
