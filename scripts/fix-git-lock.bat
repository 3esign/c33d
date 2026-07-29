@echo off
REM ===========================================================================
REM  OneDrive sometimes leaves .git\index.lock behind after an interrupted git
REM  command, and every later git operation then fails with
REM      "Unable to create '...index.lock': File exists"
REM  Deleting the file is safe ONLY when no git command is actually running.
REM ===========================================================================
setlocal
cd /d "%~dp0.."

if not exist ".git\index.lock" (
  echo.
  echo   No lock file present - git is fine.
  echo.
  pause
  exit /b 0
)

echo.
echo   Found: .git\index.lock
echo.
tasklist /fi "imagename eq git.exe" 2>nul | find /i "git.exe" >nul
if not errorlevel 1 (
  echo   A git.exe process is RUNNING right now. Do not delete the lock -
  echo   wait for it to finish, then run this again.
  echo.
  pause
  exit /b 1
)
echo   No git process is running, so this lock is stale.
echo.
set "yn="
set /p yn=Delete it? [y/N]: 
if /i not "%yn%"=="y" (
  echo   Left alone.
  pause
  exit /b 0
)
del /f /q ".git\index.lock"
if exist ".git\index.lock" (
  echo   Could not delete it. If OneDrive is syncing, pause OneDrive and retry.
) else (
  echo   Removed. Git commands should work again.
)
echo.
pause
