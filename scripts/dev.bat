@echo off
REM ===========================================================================
REM  Start the app locally and open it. Keep this window open while you use
REM  the app; press Ctrl+C (then Y) to stop the server.
REM
REM  What to try in the Jul-25 build:
REM    - send any prompt, then click the red square where Send used to be.
REM      The run should stop within a second or two and the graph is left
REM      exactly as it was.
REM    - ask for something with many parts ("a temple with 20 columns").
REM      compound() and union() no longer stop at 4.
REM ===========================================================================
setlocal
call "%~dp0_common.bat" || exit /b 1
cd /d "%~dp0.."

echo.
echo   Starting the dev server on http://localhost:5173
echo   The browser opens in a few seconds. Ctrl+C here stops the server.
echo   (If Vite reports a different port, use the one it prints below.)
echo.
start "" "%~dp0_open-app.bat"
call npm run dev
echo.
echo   Dev server stopped.
pause
