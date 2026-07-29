@echo off
REM Quick read on where the repo stands - changes, branch, recent history.
setlocal
cd /d "%~dp0.."
echo.
echo === Branch and sync ===
git status -sb
echo.
echo === Changed files ===
git status --short
echo.
echo === Size of the change ===
git diff --stat
echo.
echo === Last 8 commits ===
git log --oneline -8 --date=short --pretty="%%h %%ad %%s"
echo.
pause
