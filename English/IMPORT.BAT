@echo off
cls
echo ===================================
echo    VYBER AKCI (STISKNI 1 NEBO 2)
echo ===================================
echo 1 - Import slov (importall.py)
echo 2 - Import vet (importsentences.py)
echo ===================================

choice /c 12 /n /m "Vase volba: "

if %errorlevel% equ 1 goto :import_slov
if %errorlevel% equ 2 goto :import_vet

:import_slov
echo Spoustim import slov...
python importall.py
pause
goto :eof

:import_vet
echo Spoustim import vet...
python importsentences.py
pause
goto :eof