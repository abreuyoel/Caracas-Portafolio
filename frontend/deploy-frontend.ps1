#!/usr/bin/env pwsh
# ============================================================
# deploy-frontend.ps1
# Deploy del frontend Angular en Cloudflare Pages
# Ejecutar: .\deploy-frontend.ps1
# ============================================================

$APP_NAME = "caracas-portafolio"

Write-Host "🚀 Iniciando deploy del Frontend en Cloudflare Pages..." -ForegroundColor Cyan
Write-Host ""

# ----------------------------------------------------------
# 1. Verificar Node y npm
# ----------------------------------------------------------
Write-Host "📋 Verificando herramientas..." -ForegroundColor Yellow
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Node.js no esta instalado. Descargalo desde https://nodejs.org" -ForegroundColor Red
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "❌ npm no encontrado." -ForegroundColor Red
    exit 1
}
Write-Host "   ✅ Node $(node --version) | npm $(npm --version)" -ForegroundColor Green

# ----------------------------------------------------------
# 2. Verificar Wrangler (CLI de Cloudflare)
# ----------------------------------------------------------
Write-Host ""
Write-Host "🔧 Verificando Wrangler CLI..." -ForegroundColor Yellow
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Host "❌ npx no encontrado." -ForegroundColor Red
    exit 1
}
Write-Host "   ✅ Wrangler disponible via npx" -ForegroundColor Green

# ----------------------------------------------------------
# 3. Instalar dependencias
# ----------------------------------------------------------
Write-Host ""
Write-Host "📦 Instalando dependencias..." -ForegroundColor Yellow
Set-Location -Path "$PSScriptRoot"
npm ci --prefer-offline
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  npm ci fallo, intentando npm install..." -ForegroundColor Yellow
    npm install
}
Write-Host "   ✅ Dependencias instaladas" -ForegroundColor Green

# ----------------------------------------------------------
# 4. Build de producción
# ----------------------------------------------------------
Write-Host ""
Write-Host "🏗️  Construyendo build de produccion..." -ForegroundColor Yellow
npx ng build --configuration=cloudflare
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error en el build. Revisa los errores arriba." -ForegroundColor Red
    exit 1
}
Write-Host "   ✅ Build completado" -ForegroundColor Green

# Detectar directorio de salida del build
$DIST_DIR = "dist/investment-app/browser"
if (-not (Test-Path $DIST_DIR)) {
    $DIST_DIR = "dist/investment-app"
}
if (-not (Test-Path $DIST_DIR)) {
    Write-Host "❌ No se encontro el directorio dist. Revisa tu angular.json" -ForegroundColor Red
    exit 1
}
Write-Host "   📁 Output: $DIST_DIR" -ForegroundColor Gray

# ----------------------------------------------------------
# 5. Deploy a Cloudflare Pages
# ----------------------------------------------------------
Write-Host ""
Write-Host "☁️  Desplegando en Cloudflare Pages..." -ForegroundColor Cyan
Write-Host "   Si es la primera vez, te pedira que hagas login con tu cuenta Cloudflare." -ForegroundColor Gray
Write-Host ""

# Ejecutar wrangler pages deploy
npx wrangler pages deploy $DIST_DIR --project-name=$APP_NAME --branch=main

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ Error en el deploy." -ForegroundColor Red
    Write-Host "   Si es el primer deploy, crea primero el proyecto en:" -ForegroundColor Yellow
    Write-Host "   https://dash.cloudflare.com/pages" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "✅ Frontend desplegado exitosamente en Cloudflare Pages!" -ForegroundColor Green
Write-Host ""
Write-Host "   🌐 URL preview: https://$APP_NAME.pages.dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "📌 Próximos pasos en Cloudflare Dashboard:" -ForegroundColor Yellow
# ✅ DESPUÉS (seguro):
Write-Host "   1. Ve a Pages > $APP_NAME > Custom Domains" -ForegroundColor Gray
Write-Host "   2. Agrega: caracasportafolio.com" -ForegroundColor Gray
Write-Host "   3. Agrega: www.caracasportafolio.com" -ForegroundColor Gray
Write-Host "   Cloudflare configurara el DNS automaticamente." -ForegroundColor Gray