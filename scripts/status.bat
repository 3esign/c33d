@echo off
REM Quick read on where the repo stands - changes, branch, recent history.
setlocal
cd /d "%~dp0.."
echo.
echo === Branch and sync ===
git --no-pager status -sb
echo.
echo === Changed files ===
git --no-pager status --short
echo.
echo === Size of the change ===
git --no-pager diff --stat
echo.
echo === Last 8 commits ===
git --no-pager log --oneline -8 --date=short --pretty="%%h %%ad %%s"
echo.
pause
