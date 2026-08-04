@echo off
rem Baut dist\Newsletter-Tool.exe. Einmalig auf einem Windows-Rechner ausfuehren.
cd /d "%~dp0"
python -m pip install --upgrade pyinstaller || goto :fehler
python build_exe.py || goto :fehler
echo.
echo Fertig. Die Datei liegt in: dist\Newsletter-Tool.exe
pause
exit /b 0

:fehler
echo.
echo Der Build ist fehlgeschlagen. Ist Python installiert?
pause
exit /b 1
