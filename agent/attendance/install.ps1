# ============================================================
# Falcon AI OS -- Face ID davomat agenti uchun BITTA o'rnatuvchi
# (Windows, klinika kirish eshigi kompyuteri).
#
# Bu skript faqat DASTURIY qismni tayyorlaydi (venv, kutubxonalar,
# config.json nusxasi). Kamera joylashuvi, xodim suratlari va
# kiosk tokeni -- SIZ to'ldirasiz, skript oxirida aniq ko'rsatiladi.
#
# Ishlatish (PowerShell, oddiy foydalanuvchi huquqi yetarli):
#   cd C:\falcon\agent\attendance
#   powershell -ExecutionPolicy Bypass -File install.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "XATO: $msg" -ForegroundColor Red; exit 1 }

Step "Python tekshirilmoqda..."
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Fail "Python topilmadi. https://python.org dan o'rnating (o'rnatishda 'Add to PATH'ni belgilang), so'ng qayta ishga tushiring."
}
$verOutput = & python --version
Write-Host "  $verOutput"

Step "Virtual muhit yaratilmoqda (venv)..."
if (-not (Test-Path "venv")) {
    python -m venv venv
} else {
    Write-Host "  venv allaqachon bor -- o'tkazib yuborildi"
}

Step "Kutubxonalar o'rnatilmoqda (bir marta internet kerak)..."
& .\venv\Scripts\python.exe -m pip install --upgrade pip -q
& .\venv\Scripts\pip.exe install -r requirements.txt -q

Step "Konfiguratsiya fayli..."
if (-not (Test-Path "config.json")) {
    Copy-Item "config.example.json" "config.json"
    Write-Host "  config.json yaratildi (config.example.json dan nusxa)"
} else {
    Write-Host "  config.json allaqachon bor -- o'zgartirilmadi"
}

New-Item -ItemType Directory -Force -Path "faces" | Out-Null
New-Item -ItemType Directory -Force -Path "data" | Out-Null

Step "Modellar (~10 MB) tekshirilmoqda..."
& .\venv\Scripts\python.exe -c "import faces; faces.ensure_models()"

Write-Host @"

============================================================
 O'RNATISH TUGADI -- QOLGAN QO'LDA BAJARILADIGAN QADAMLAR
============================================================

1) KAMERANI O'LCHANG (eng muhim qadam):
     .\venv\Scripts\python.exe measure-camera.py --device 0 --show
   Yuz 80px+ chiqishi shart -- kam bo'lsa kamerani ko'chiring.

2) XODIMLAR SURATLARI -- faces/ papkaga (har biriga 2-3 surat):
     faces\Familiya Ism.jpg
     faces\bemor_Familiya Ism\1.jpg   (bemorlar uchun "bemor_" prefiksi)
   Keyin: .\venv\Scripts\python.exe enroll.py

3) KIOSK TOKENI:
   falconmedai.uz -> Kiosk qurilmalari -> Yangi qurilma -> Turi: Davomat
   Tokenni nusxalang, config.json faylida "device_token" ga yozing.

4) SINOV:
     .\venv\Scripts\python.exe agent.py --preview
   Yashil quti + ism = tanildi.

5) DOIMIY ISHGA TUSHIRISH:
   Win+R -> shell:startup -> shu yerga yorliq (shortcut) qo'ying:
     Nishon: $here\venv\Scripts\pythonw.exe $here\agent.py

Batafsil: agent\attendance\README.md
============================================================
"@ -ForegroundColor Green
