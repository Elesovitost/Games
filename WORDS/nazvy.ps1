$files = Get-ChildItem -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg)$' }
$names = $files | Select-Object -ExpandProperty BaseName
Set-Content -Path "words.txt" -Value $names -Encoding UTF8