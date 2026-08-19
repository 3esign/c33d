@echo off
REM ===========================================================================
REM  Full verification: typecheck, production build, whole test suite.
REM  Run this before committing. Nothing here writes to git.
REM ===========================================================================
setlocal
call "%~dp0_common.bat" || exit /b 1
cd /d "%~dp0.."

echo.
echo ===============================================================
echo   [1/3]  Typecheck  (tsc -b)
echo ===============================================================
call npx tsc -b
if errorlevel 1 goto fail
echo   PASS

echo.
echo ===============================================================
echo   [2/3]  Production build  (vite build)
echo ===============================================================
call npx vite build
if errorlevel 1 goto fail
echo   PASS

echo.
echo ===============================================================
echo   [3/3]  Test suite  (npm test)
echo ===============================================================
call npm test
if errorlevel 1 goto fail
echo   PASS

echo.
echo ===============================================================
echo   Typecheck, build and test suite all passed.
echo.
echo   If any test fails, fix it before deploying.
echo ===============================================================
echo.
pause
exit /b 0

:fail
echo.
echo   *** FAILED - see the output above. Fix this before committing. ***
echo.
pause
exit /b 1
