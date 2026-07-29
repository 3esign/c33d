@echo off
REM ===========================================================================
REM  Review, commit and push. Shows you the change first and asks before every
REM  irreversible step. Session exports (JSONs\) are a separate question from
REM  source, because they are large and you may not want them in every commit.
REM ===========================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0.."

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo   This folder is not a git repository.
  pause
  exit /b 1
)

if exist ".git\index.lock" (
  echo.
  echo   A git lock file is present - git will refuse to commit.
  echo   Run option [7] in the menu first, then come back.
  echo.
  pause
  exit /b 1
)

echo.
echo ===============================================================
echo   What changed
echo ===============================================================
git status --short
echo.
git diff --stat
echo.

set "src="
set /p src=Stage the source changes (src, tests, docs, scripts)? [Y/n]: 
if /i "!src!"=="n" (
  echo   Nothing staged. Stopping.
  pause
  exit /b 0
)
git add src tests docs scripts .agents C3D.bat package.json package-lock.json 2>nul

echo.
set "exports="
set /p exports=Also include the session exports in JSONs\ ? [y/N]: 
if /i "!exports!"=="y" git add JSONs

echo.
echo ===============================================================
echo   NOT staged - decide before committing
echo ===============================================================
git status --porcelain | findstr /b /c:" M" /c:"??" | findstr /v /c:"JSONs/"
echo   (blank above means nothing was left behind)
echo.
echo ===============================================================
echo   Staged for commit
echo ===============================================================
git diff --cached --stat
echo.

set "msg="
echo Commit message - press Enter to use the default below.
echo   fix: accept inline literals in reference args, N-ary compound/union,
echo        report all IR body errors per attempt, add run abort + Stop button
set /p msg=Message: 
if "!msg!"=="" set "msg=fix: accept inline literals in reference args, N-ary compound/union, report all IR body errors per attempt, add run abort + Stop button"

git commit -m "!msg!"
if errorlevel 1 (
  echo.
  echo   Commit failed - nothing was recorded. See the message above.
  pause
  exit /b 1
)

echo.
set "push="
set /p push=Push to origin/main now? [Y/n]: 
if /i "!push!"=="n" (
  echo   Committed locally. Push later with option [4] again, or: git push
  pause
  exit /b 0
)
git push
if errorlevel 1 (
  echo.
  echo   Push failed. The commit is safe locally - fix the remote and retry.
  pause
  exit /b 1
)

echo.
echo   Committed and pushed.
echo.
echo   REMINDER: pushing does NOT update c33d.vercel.app - that site is
echo   deployed from the CLI, not connected to GitHub. Use option [5].
echo.
pause
