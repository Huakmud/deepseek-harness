@echo off
rem Build the Windows desktop app as an unpacked directory from a source
rem snapshot without Git history. A directory build skips the Visual Studio
rem toolchain probe and produces no installer, only win-unpacked.
rem Close DeepSeek Harness before running: packaging replaces win-unpacked.
setlocal
cd /d "%~dp0"

set DSH_CLIENT_COMMIT_HASH=0000000
set DSH_DESKTOP_BUILD_COMMIT=0000000000000000000000000000000000000000
set DSH_DESKTOP_BUILD_DIRTY=0

call pnpm --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-target.ts win-x64 --dir --unsigned
set RESULT=%ERRORLEVEL%

echo.
if "%RESULT%"=="0" (
  echo Build finished. Launch: %~dp0apps\desktop\.desktop-build\targets\win-x64\unsigned-artifacts\win-unpacked
) else (
  echo Build failed with exit code %RESULT%. See the latest folder under apps\desktop\.desktop-build\packaging-runs
)
pause
endlocal
exit /b %RESULT%
