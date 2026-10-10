@echo off
setlocal
cd /d "%~dp0"
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 LTS, reopen this folder, and try again.
  pause
  exit /b 1
)
call npm.cmd ci
if errorlevel 1 goto failed
call npm.cmd run setup:dev
if errorlevel 1 goto failed
echo.
echo Peris tools are prepared. Open this folder in VS Code and restart Codex.
echo In Blender: press N, open MCP for Blender, and Start MCP Server.
pause
exit /b 0
:failed
echo.
echo Setup stopped. Read the error above before retrying.
pause
exit /b 1
