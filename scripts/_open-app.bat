@echo off
REM Helper for dev.bat: wait for Vite to bind, then open the browser.
REM Kept in its own file so dev.bat needs no nested quoting.
timeout /t 5 >nul
start "" http://localhost:5173
exit /b 0
