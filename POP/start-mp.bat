@echo off
cd /d "%~dp0"
echo Spoustim MP relay na portu 2567 (0.0.0.0 — LAN)...
where node >nul 2>&1
if %ERRORLEVEL%==0 (
  start "Populous MP" /MIN cmd /c "npm run server"
) else (
  start "Populous MP" /MIN py -3 server\server.py
)
timeout /t 1 /nobreak >nul
echo.
echo Server bezi na ws://TVA_IP:2567
echo Otevri POP/index.html (Live Server) a v MP zaloz hru.
echo Ostatni: vypln tvou IP, pripadne kod mistnosti, a Pripojit.
echo.
pause
