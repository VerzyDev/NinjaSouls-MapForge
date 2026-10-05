@echo off
setlocal
set NoDefaultCurrentDirectoryInExePath=
cd /d "%~dp0"

if not exist node_modules (
	call bun install || goto :fail
)

call bun run tauri build --no-bundle || goto :fail

copy /y "src-tauri\target\release\map-forge.exe" "%~dp0Map Forge.exe" >nul || goto :fail

echo.
echo Build concluido: "%~dp0Map Forge.exe"
pause
exit /b 0

:fail
echo.
echo Falha na compilacao.
pause
exit /b 1
