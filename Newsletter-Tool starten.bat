@echo off
rem Startet das Newsletter-Tool ohne vorher eine .exe zu bauen.
rem Voraussetzung: Python 3.9 oder neuer ist installiert.
cd /d "%~dp0"
python start.py %*
if errorlevel 1 (
    echo.
    echo Konnte nicht gestartet werden. Ist Python installiert?
    echo Download: https://www.python.org/downloads/windows/
    pause
)
