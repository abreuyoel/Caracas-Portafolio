# ============================================================
# deploy.ps1  -  Caracas Portafolio  |  Full deploy script
# Backend  -> Google Cloud Run
# Frontend -> Cloudflare Pages
# ============================================================

$PROJECT    = "caracas-portafolio"
$REGION     = "us-central1"
$SERVICE    = "caracas-portafolio-api"
$IMAGE      = "gcr.io/$PROJECT/backend-app"
$CF_PROJECT = "caracas-portafolio"

$ROOT = "c:/Users/Yoel Abreu/OneDrive/Desktop/CV-Yoel Abreu/Gestion Portafolio"

# -- Colores -------------------------------------------------------------------
function Info  { param($m) Write-Host "  $m" -ForegroundColor Cyan }
function Ok    { param($m) Write-Host "  OK  $m" -ForegroundColor Green }
function Err   { param($m) Write-Host "  ERR $m" -ForegroundColor Red }
function Title { param($m) Write-Host "`n== $m ==" -ForegroundColor Yellow }

# ==============================================================================
# 0. SECRETS -- crea/actualiza secrets en Secret Manager
# ==============================================================================
Title "0. Secret Manager - secrets"

$GOOGLE_CLIENT_ID = "17869169718-bph681ebmmm469oke72u9epf6u6bd8gh.apps.googleusercontent.com"
$RESEND_API_KEY   = "re_LGNZ5Uqg_B5qUQdFjfA17rCTaFEmBf1Tx"

# Función helper para crear o actualizar un secret
function UpsertSecret {
    param($Name, $Value)
    $exists = gcloud secrets describe $Name --project=$PROJECT 2>&1
    if ($LASTEXITCODE -ne 0) {
        Info "Creando secret $Name..."
        $Value | gcloud secrets create $Name `
            --project=$PROJECT `
            --replication-policy="automatic" `
            --data-file="-"
        Ok "Secret $Name creado"
    } else {
        Info "Actualizando secret $Name..."
        $Value | gcloud secrets versions add $Name `
            --project=$PROJECT `
            --data-file="-"
        Ok "Secret $Name actualizado"
    }
}

UpsertSecret "GOOGLE_CLIENT_ID" $GOOGLE_CLIENT_ID
UpsertSecret "RESEND_API_KEY"   $RESEND_API_KEY

# Dar acceso al service account de Cloud Run a todos los secrets
Info "Configurando permisos IAM..."
$PROJECT_NUMBER = (gcloud projects describe $PROJECT --format="value(projectNumber)" 2>$null)
$SECRETS_TO_BIND = @("GOOGLE_CLIENT_ID", "RESEND_API_KEY")

foreach ($secret in $SECRETS_TO_BIND) {
    if ($PROJECT_NUMBER) {
        gcloud secrets add-iam-policy-binding $secret `
            --project=$PROJECT `
            --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" `
            --role="roles/secretmanager.secretAccessor" 2>$null
    }
    gcloud secrets add-iam-policy-binding $secret `
        --project=$PROJECT `
        --member="serviceAccount:$PROJECT@appspot.gserviceaccount.com" `
        --role="roles/secretmanager.secretAccessor" 2>$null
}
Ok "Permisos IAM configurados"

# ==============================================================================
# 1. BACKEND -- Build & Deploy
# ==============================================================================
Title "1. Backend - Build Docker image"

Set-Location "$ROOT/backend"
Info "Enviando build a Cloud Build..."

gcloud builds submit `
    --tag $IMAGE `
    --timeout=10m `
    --project=$PROJECT

if ($LASTEXITCODE -ne 0) { Err "Build fallido. Abortando."; exit 1 }
Ok "Imagen construida: $IMAGE"

# -- Deploy Cloud Run ----------------------------------------------------------
Title "1b. Backend - Deploy a Cloud Run"
Info "Desplegando $SERVICE en $REGION..."

gcloud run deploy $SERVICE `
    --image $IMAGE `
    --region $REGION `
    --platform managed `
    --project $PROJECT `
    --allow-unauthenticated `
    --set-env-vars "ENVIRONMENT=production,FRONTEND_URL=https://caracasportafolio.com,GEMINI_MODEL=gemini-2.5-pro" `
    --update-secrets "DATABASE_URL=DATABASE_URL:latest,SUPABASE_KEY=SUPABASE_KEY:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest,JWT_SECRET=JWT_SECRET:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,RESEND_API_KEY=RESEND_API_KEY:latest" `
    --memory 1Gi `
    --cpu 1 `
    --concurrency 80 `
    --min-instances 0 `
    --max-instances 3

if ($LASTEXITCODE -ne 0) { Err "Deploy del backend fallido."; exit 1 }
Ok "Backend desplegado en Cloud Run"

# ==============================================================================
# 2. FRONTEND -- Build Angular
# ==============================================================================
Title "2. Frontend - Build Angular (cloudflare)"

Set-Location "$ROOT/frontend"
Info "Compilando Angular..."

npm run build -- --configuration=cloudflare

if ($LASTEXITCODE -ne 0) { Err "Build de Angular fallido."; exit 1 }
Ok "Build completado en dist/investment-app/browser"

# -- Deploy Cloudflare Pages ---------------------------------------------------
Title "2b. Frontend - Deploy a Cloudflare Pages"
Info "Subiendo a Cloudflare Pages..."

npx wrangler pages deploy dist/investment-app/browser `
    --project-name=$CF_PROJECT `
    --branch=main `
    --commit-dirty=true

if ($LASTEXITCODE -ne 0) { Err "Deploy de Cloudflare fallido."; exit 1 }
Ok "Frontend desplegado en Cloudflare Pages"

# ==============================================================================
# Resumen final
# ==============================================================================
Title "Deploy completado"
Write-Host ""
Write-Host "  Backend  -> https://api.caracasportafolio.com" -ForegroundColor Green
Write-Host "  Frontend -> https://caracasportafolio.com"     -ForegroundColor Green
Write-Host ""
