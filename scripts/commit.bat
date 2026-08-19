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
  echo   Run option [L] in the menu first, then come back.
  echo.
  pause
  exit /b 1
)

echo.
echo ===============================================================
echo   What changed
echo ===============================================================
git --no-pager status --short
echo.
git --no-pager diff --stat
echo.

set "src="
set /p src=Stage all changes (everything except ignored files)? [Y/n]: 
if /i "!src!"=="n" (
  echo   Nothing staged. Stopping.
  pause
  exit /b 2
)
REM Stage everything: .gitignore already protects data/, logs and scratch.
REM (The old hardcoded whitelist silently left top-level files - vite.config.ts,
REM  .gitignore, .gitattributes - uncommitted for weeks.)
git add -A -- . ":(exclude)JSONs"

echo.
set "exports="
set /p exports=Also include the session exports in JSONs\ ? [y/N]: 
if /i "!exports!"=="y" git add JSONs

echo.
echo ===============================================================
echo   NOT staged - decide before committing
echo ===============================================================
git --no-pager status --porcelain | findstr /b /c:" M" /c:"??" | findstr /v /c:"JSONs/"
echo   (blank above means nothing was left behind)
echo.
echo ===============================================================
echo   Staged for commit
echo ===============================================================
git --no-pager diff --cached --stat --compact-summary -- . ":(exclude)JSONs"
echo   (JSONs excluded from this list - they are staged, just not shown)
echo.

set "msg="
echo Commit message - describe THIS change. Empty input aborts.
set /p msg=Message: 
if "!msg!"=="" (
  echo.
  echo   A commit message is required. Nothing was committed.
  pause
  exit /b 1
)

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
  echo   Committed locally. Push later with option [7] again, or: git push
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
echo   deployed from the CLI, not connected to GitHub. Use option [8].
echo.
pause
