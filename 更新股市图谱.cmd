@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\market_atlas\run.ps1" -Mode Update
pause
