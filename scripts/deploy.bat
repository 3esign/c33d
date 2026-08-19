@echo off
REM ===========================================================================
REM  Publish to c33d.vercel.app.
REM
REM  IMPORTANT: this project is deployed from the Vercel CLI and is NOT
REM  connected to the GitHub repo. Pushing to origin/main does nothing to the
REM  live site - this script is the only thing that updates it.
REM ===========================================================================
setlocal
call "%~dp0_common.bat" || exit /b 1
cd /d "%~dp0.."

echo.
echo   About to deploy the CURRENT WORKING FOLDER to production.
echo   If you have not run the checks yet, cancel and run option [5] first.
echo.
set "yn="
set /p yn=Deploy to production now? [y/N]: 
if /i not "%yn%"=="y" (
  echo   Cancelled.
  pause
  exit /b 0
)

call npx vercel --prod
if errorlevel 1 (
  echo.
  echo   Deploy failed. If it asked you to log in, run  npx vercel login  once
  echo   and then try again.
  pause
  exit /b 1
)
echo.
echo   Deployed.
echo.
pause
