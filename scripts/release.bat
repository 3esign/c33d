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
  echo   Commit step was skipped or did not complete. Stopping before deploy -
  echo   the live site must never run code that exists in no commit.
  pause
  exit /b 1
)

echo.
echo   STEP 3 of 3 - deploy
call "%~dp0deploy.bat"
if errorlevel 1 (
  echo.
  echo   Deploy failed. The release did NOT reach the live site.
  pause
  exit /b 1
)

echo.
echo   Release chain finished.
echo.
pause
