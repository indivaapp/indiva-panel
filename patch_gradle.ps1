$path = "node_modules/@capacitor/android/capacitor/build.gradle"
$content = Get-Content $path -Raw
$content = $content -replace "JavaVersion.VERSION_21", "JavaVersion.VERSION_17"
Set-Content $path $content
Write-Host "Patched $path"
