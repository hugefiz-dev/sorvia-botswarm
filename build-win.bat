@echo off
REM ============================================================
REM  Sorvia MC LoadTester - Windows portable exe builder
REM  Sorvia Development Solutions by HugeFiz
REM  Requires: Node.js (https://nodejs.org)
REM ============================================================
cd /d "%~dp0"
echo Working folder: %cd%
echo.
if not exist package.json (
  echo ERROR: package.json bu klasorde yok / not found here.
  echo Zip'i tam olarak cikardigindan ve bu .bat'in package.json ile ayni klasorde
  echo oldugundan emin ol. / Extract the zip fully; keep this .bat next to package.json.
  echo.
  pause
  exit /b 1
)
echo [1/2] Installing dependencies...
call npm install || (echo. & echo npm install FAILED. Node.js kurulu mu? & pause & exit /b 1)
echo.
echo [2/2] Building installer (setup.exe)...
call npm run dist:win || (echo. & echo BUILD FAILED. & pause & exit /b 1)
echo.
echo ============================================================
echo  DONE. Installer:  dist\Sorvia-BotSwarm-1.2.0-setup.exe
echo  (Portable instead:  npm run dist:win-portable)
echo ============================================================
pause
exit /b 0
