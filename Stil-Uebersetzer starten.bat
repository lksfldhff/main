@echo off
chcp 65001 >nul
cd /d "%~dp0"
python bernie.py %*
if errorlevel 1 pause
