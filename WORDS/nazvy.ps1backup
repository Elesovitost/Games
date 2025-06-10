$files = Get-ChildItem -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg)$' }
$names = $files | Select-Object -ExpandProperty BaseName | ForEach-Object { "'$_'" }
$jsArray = "const words = [" + ($names -join ", ") + "];"
Set-Content -Path "nazvy.txt" -Value $jsArray
