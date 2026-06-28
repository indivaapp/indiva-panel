# İNDİVA Panel — APK derleme scripti
# Tek komutla: web build + Capacitor sync + Android debug APK
#
# ÖNEMLİ: Kullanıcı klasöründe ASCII olmayan karakter ("Barış" içindeki "ş") var.
# JDK 17 NIO selector'ı AF_UNIX socket'i temp klasöründe oluşturur ve bu karakter
# "Invalid argument: connect" hatasına yol açar. Bu yüzden TEMP'i ASCII bir yola
# (C:\Temp) zorluyoruz. Bu olmadan gradle "Unable to establish loopback connection" verir.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

New-Item -ItemType Directory -Force -Path "C:\Temp" | Out-Null
$env:TMP  = "C:\Temp"
$env:TEMP = "C:\Temp"

Write-Host "[1/3] Web build (Vite)..." -ForegroundColor Cyan
Set-Location $root
npm run build

Write-Host "[2/3] Capacitor sync..." -ForegroundColor Cyan
npx cap sync android

Write-Host "[3/3] Android debug APK (gradle)..." -ForegroundColor Cyan
Set-Location "$root\android"
.\gradlew.bat assembleDebug

$apk = "$root\android\app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apk) {
    $mb = [math]::Round((Get-Item $apk).Length / 1MB, 1)
    Write-Host "`nTAMAMLANDI -> $apk ($mb MB)" -ForegroundColor Green
} else {
    Write-Host "`nAPK bulunamadi, build basarisiz." -ForegroundColor Red
}
