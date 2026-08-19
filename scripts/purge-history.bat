@echo off
setlocal enabledelayedexpansion
REM ===============================================================
REM  purge-history.bat - remove leaked files from git HISTORY.
REM  Companion to docs\maintenance\history_purge.md (read it first).
REM
REM  What it does:
REM    1. asks for explicit confirmation (type YES)
REM    2. checks git-filter-repo is installed
REM    3. makes a mirror backup in %USERPROFILE%
REM    4. rewrites history removing the two leaked paths
REM    5. restores the scrubbed session export as a fresh commit
REM    6. PRINTS the force-push commands - it does NOT push for you
REM
REM  Run this from a machine-local clone, NOT the OneDrive folder.
REM ===============================================================

cd /d "%~dp0.."

echo.
echo ===============================================================
echo   GIT HISTORY REWRITE - this is destructive and permanent.
echo ===============================================================
echo   It removes from ALL history:
echo     - "JSONs/Magistarski rad - Dorotea Abaz.docx"
echo     - "JSONs/c33d-graph-2026-07-22T08-20-17.json" (pre-scrub versions)
echo   A mirror backup is made first. All old clones must be re-cloned.
echo.
set "confirm="
set /p confirm=Type YES (uppercase) to continue:
if not "!confirm!"=="YES" (
  echo   Aborted. Nothing was changed.
  exit /b 1
)

git filter-repo --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo   git-filter-repo is not installed. Install it with:
  echo     pip install git-filter-repo
  echo   then run this script again.
  exit /b 1
)

for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set dt=%%I
set "stamp=!dt:~0,8!-!dt:~8,6!"
if "!stamp!"=="-" set "stamp=backup"
set "backup=%USERPROFILE%\c33d-backup-!stamp!"

echo.
echo   [1/4] Mirror backup to "!backup!" ...
git clone --mirror . "!backup!"
if errorlevel 1 (
  echo   Backup failed - stopping. Nothing was rewritten.
  exit /b 1
)
echo   Backup OK.

echo.
echo   [2/4] Keeping the scrubbed export aside...
copy /y "JSONs\c33d-graph-2026-07-22T08-20-17.json" "%TEMP%\c33d-scrubbed-export.json" >nul
if errorlevel 1 (
  echo   Could not copy the scrubbed export - stopping.
  exit /b 1
)

echo.
echo   [3/4] Rewriting history (git filter-repo)...
git filter-repo --force --invert-paths --path "JSONs/Magistarski rad - Dorotea Abaz.docx" --path "JSONs/c33d-graph-2026-07-22T08-20-17.json"
if errorlevel 1 (
  echo   filter-repo failed. Your backup is at "!backup!".
  exit /b 1
)

echo.
echo   [4/4] Restoring the scrubbed export as a fresh commit...
copy /y "%TEMP%\c33d-scrubbed-export.json" "JSONs\c33d-graph-2026-07-22T08-20-17.json" >nul
git add "JSONs/c33d-graph-2026-07-22T08-20-17.json"
git commit -m "restore scrubbed session export (history purged)"
if errorlevel 1 (
  echo   Commit failed - check git status. Backup: "!backup!".
  exit /b 1
)

echo.
echo ===============================================================
echo   Done locally. filter-repo removed the 'origin' remote
echo   (that is expected). To publish the rewrite, run BY HAND:
echo.
echo     git remote add origin https://github.com/3esign/c33d.git
echo     git push --force --all origin
echo     git push --force --tags origin
echo.
echo   Then ask GitHub Support to purge cached commits:
echo   https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
echo.
echo   Verify blobs are gone:  git rev-list --objects --all ^| findstr /i magistarski
echo   Backup mirror (contains the old blobs - keep private, delete
echo   after verifying): "!backup!"
echo ===============================================================
pause
exit /b 0
