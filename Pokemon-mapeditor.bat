@echo off
chcp 65001 >nul
echo Generuji seznam assetů...

:: Smazání starého souboru, pokud existuje (zajistí 100% čistý import)
if exist assets-list.js del assets-list.js

:: Vytvoření JS souboru s polem všech obrázků
echo const ASSETS_LIST = [ > assets-list.js
for %%F in ("Pokemon\Assets\*.png" "Pokemon\Assets\*.jpg" "Pokemon\Assets\*.jpeg") do (
    echo     "Pokemon/Assets/%%~nxF", >> assets-list.js
)
echo ]; >> assets-list.js

echo Seznam assetu byl uspesne vygenerovan. HTML editor se nyni nespousti.
pause