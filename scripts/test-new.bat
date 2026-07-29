@echo off
REM ===========================================================================
REM  Just the two Jul-25 contract tests. Seconds, not minutes - use this while
REM  editing the compiler or the abort layer.
REM
REM  Both drive the REAL modules (a small module.register resolve hook lets
REM  plain node import the app's .ts files), so they cannot drift from source.
REM ===========================================================================
setlocal
call "%~dp0_common.bat" || exit /b 1
cd /d "%~dp0.."

echo.
echo === IR reference-argument coercion / N-ary assembly / multi-error ===
call node tests\test_ir_ref_coercion.mjs
if errorlevel 1 goto fail

echo.
echo === Run cancellation (Stop button) ===
call node tests\test_run_abort.mjs
if errorlevel 1 goto fail

echo.
echo   Both contract sets pass.
echo.
pause
exit /b 0

:fail
echo.
echo   *** A contract failed - the message above names which one. ***
echo.
pause
exit /b 1
