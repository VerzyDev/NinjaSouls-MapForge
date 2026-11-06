@echo off
setlocal
set NoDefaultCurrentDirectoryInExePath=
cd /d "%~dp0"
set "PKG=build\Map Forge"

if not exist node_modules (
	call bun install || goto :fail
)

call bun run tauri build --no-bundle || goto :fail

copy /y "src-tauri\target\release\map-forge.exe" "%~dp0Map Forge.exe" >nul || goto :fail

if not exist "%PKG%" mkdir "%PKG%" || goto :fail
copy /y "src-tauri\target\release\map-forge.exe" "%PKG%\Map Forge.exe" >nul || goto :fail
copy /y "LICENSE" "%PKG%\LICENSE" >nul || goto :fail

rem robocopy exit codes below 8 mean success
robocopy "data" "%PKG%\data" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :fail

powershell -NoProfile -Command "$ErrorActionPreference='Stop'; Compress-Archive -Path '%PKG%' -DestinationPath 'build\MapForge.zip' -Force" || goto :fail

echo.
echo Build concluido: "%~dp0Map Forge.exe"
echo Pacote: "%~dp0%PKG%"
echo Zip: "%~dp0build\MapForge.zip"
pause
exit /b 0

:fail
echo.
echo Falha na compilacao.
pause
exit /b 1
