@echo off
cd /d "%~dp0"
echo Spoustim MP relay na portu 2567...
start "Populous MP" /MIN py -3 server\server.py
timeout /t 1 /nobreak >nul
start "" "http://localhost:5500/"
echo.
echo Pokud se hra neotevre, spusť Live Server a otevři index.html.
echo Relay bezi na ws://localhost:2567
pause
