@echo off
rem Build the Windows installer (.exe) plus the unpacked app.
rem The installer helper needs the Visual Studio C++ build tools; the probe
rem passed on this machine (VS 18 Community, VC.Tools.x86.x64).
rem Close DeepSeek Harness first: packaging replaces win-unpacked.
setlocal
cd /d "%~dp0"

set DSH_CLIENT_COMMIT_HASH=0000000
set DSH_DESKTOP_BUILD_COMMIT=0000000000000000000000000000000000000000
set DSH_DESKTOP_BUILD_DIRTY=0

call pnpm --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-target.ts win-x64 --unsigned
set RESULT=%ERRORLEVEL%

echo.
if "%RESULT%"=="0" (
  echo Installer:
  for %%f in ("%~dp0apps\desktop\.desktop-build\targets\win-x64\unsigned-artifacts\*-unsigned.exe") do echo   %%f
  echo Unpacked app:
  echo   %~dp0apps\desktop\.desktop-build\targets\win-x64\unsigned-artifacts\win-unpacked
) else (
  echo Build failed with exit code %RESULT%. See the newest folder under:
  echo   %~dp0apps\desktop\.desktop-build\packaging-runs
)
pause
exit /b %RESULT%
