#!/usr/bin/env pwsh
# ============================================================
# deploy-backend.ps1
# Deploy del backend de Caracas Portafolio en Google Cloud Run
# Ejecutar: .\deploy-backend.ps1
# ============================================================

$PROJECT_ID     = "caracas-portafolio"
$SERVICE_NAME   = "caracas-portafolio-api"
$REGION         = "us-central1"
$IMAGE_NAME     = "gcr.io/$PROJECT_ID/$SERVICE_NAME"

Write-Host "=== Caracas Portafolio - Deploy Backend ===" -ForegroundColor Cyan
Write-Host "   Proyecto : $PROJECT_ID" -ForegroundColor Gray
Write-Host "   Servicio : $SERVICE_NAME" -ForegroundColor Gray
Write-Host "   Region   : $REGION" -ForegroundColor Gray
Write-Host ""

# ----------------------------------------------------------
# 1. Verificar que gcloud esta instalado
# ----------------------------------------------------------
Write-Host "[1/5] Verificando Google Cloud SDK..." -ForegroundColor Yellow
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: gcloud no esta instalado. Descargalo desde: https://cloud.google.com/sdk/docs/install" -ForegroundColor Red
    exit 1
}
Write-Host "      OK - gcloud encontrado" -ForegroundColor Green

# ----------------------------------------------------------
# 2. Configurar proyecto
# ----------------------------------------------------------
Write-Host ""
Write-Host "[2/5] Configurando proyecto GCP..." -ForegroundColor Yellow
gcloud config set project $PROJECT_ID
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: No se pudo configurar el proyecto '$PROJECT_ID'." -ForegroundColor Red
    exit 1
}

# Habilitar APIs necesarias
Write-Host "      Habilitando APIs (Cloud Run, Cloud Build, Container Registry)..." -ForegroundColor Gray
gcloud services enable run.googleapis.com containerregistry.googleapis.com cloudbuild.googleapis.com --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: No se pudieron habilitar las APIs. Verifica que el billing este activado." -ForegroundColor Red
    Write-Host "       Activa billing en: https://console.cloud.google.com/billing" -ForegroundColor Yellow
    exit 1
}
Write-Host "      OK - APIs habilitadas" -ForegroundColor Green

# ----------------------------------------------------------
# 3. Build con Cloud Build (sin necesitar Docker local)
# ----------------------------------------------------------
Write-Host ""
Write-Host "[3/5] Construyendo imagen Docker con Cloud Build..." -ForegroundColor Yellow
Write-Host "      Imagen: $IMAGE_NAME" -ForegroundColor Gray

Set-Location -Path "$PSScriptRoot"
gcloud builds submit --tag $IMAGE_NAME --timeout=15m .
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Fallo el build. Revisa los logs." -ForegroundColor Red
    exit 1
}
Write-Host "      OK - Imagen construida y subida" -ForegroundColor Green

# ----------------------------------------------------------
# 4. Deploy en Cloud Run
# ----------------------------------------------------------
Write-Host ""
Write-Host "[4/5] Desplegando en Cloud Run..." -ForegroundColor Yellow

# Cargar variables del .env local para pasarlas a Cloud Run
$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: No se encontro el archivo .env en $PSScriptRoot" -ForegroundColor Red
    Write-Host "       Crea un archivo .env con todas las variables necesarias." -ForegroundColor Yellow
    exit 1
}

# Leer y parsear el .env (ignorar comentarios y líneas vacías)
$envVars = @{}
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#")) {
        $parts = $line -split "=", 2
        if ($parts.Length -eq 2) {
            $key = $parts[0].Trim()
            $val = $parts[1].Trim()
            $envVars[$key] = $val
        }
    }
}

# Construir el string de env-vars para Cloud Run (escapar comas en valores)
$requiredVars = @(
    "DATABASE_URL",
    "SECRET_KEY",
    "ALGORITHM",
    "ACCESS_TOKEN_EXPIRE_MINUTES",
    "REFRESH_TOKEN_EXPIRE_DAYS",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "EMAIL_FROM",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_CONTACT_EMAIL",
    "APP_NAME",
    "APP_VERSION",
    "DEBUG",
    "FRONTEND_URL",
    "GEMINI_API_KEY",
    "GEMINI_MODEL"
)

$envPairs = @()
foreach ($var in $requiredVars) {
    if ($envVars.ContainsKey($var)) {
        # Escapar comas dentro del valor con \,
        $safeVal = $envVars[$var] -replace ",", "\,"
        $envPairs += "${var}=${safeVal}"
    } else {
        Write-Host "AVISO: Variable '$var' no encontrada en .env, se omitira." -ForegroundColor Yellow
    }
}
$envVarsString = $envPairs -join ","

Write-Host "      Variables de entorno configuradas: $($envPairs.Count)" -ForegroundColor Gray

gcloud run deploy $SERVICE_NAME `
    --image $IMAGE_NAME `
    --platform managed `
    --region $REGION `
    --allow-unauthenticated `
    --port 8080 `
    --memory 512Mi `
    --cpu 1 `
    --min-instances 0 `
    --max-instances 3 `
    --timeout 300 `
    --concurrency 80 `
    --set-env-vars $envVarsString `
    --quiet

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Fallo el deploy en Cloud Run." -ForegroundColor Red
    exit 1
}

# ----------------------------------------------------------
# 5. Resultado
# ----------------------------------------------------------
Write-Host ""
Write-Host "[5/5] Obteniendo URL del servicio..." -ForegroundColor Yellow
$SERVICE_URL = gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)"

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " DEPLOY EXITOSO!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host " URL     : $SERVICE_URL" -ForegroundColor Cyan
Write-Host " API Doc : $SERVICE_URL/docs" -ForegroundColor Cyan
Write-Host " Health  : $SERVICE_URL/health" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "SIGUIENTE PASO - Configurar variables de entorno secretas:" -ForegroundColor Yellow
Write-Host " https://console.cloud.google.com/run/detail/$REGION/$SERVICE_NAME/variables" -ForegroundColor Gray
Write-Host ""
Write-Host " Variables requeridas:" -ForegroundColor Yellow
Write-Host "   DATABASE_URL" -ForegroundColor Gray
Write-Host "   SECRET_KEY" -ForegroundColor Gray
Write-Host "   SMTP_PASSWORD (Resend API key)" -ForegroundColor Gray
Write-Host "   VAPID_PUBLIC_KEY" -ForegroundColor Gray
Write-Host "   VAPID_PRIVATE_KEY" -ForegroundColor Gray
Write-Host "   GEMINI_API_KEY" -ForegroundColor Gray
Write-Host ""
Write-Host "Mapear dominio custom (ejecutar luego):" -ForegroundColor Yellow
Write-Host " gcloud run domain-mappings create --service $SERVICE_NAME --domain api.caracasportafolio.com --region $REGION" -ForegroundColor Gray
