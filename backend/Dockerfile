# ================================
# Stage 1: Builder (instalar deps)
# ================================
FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias en un virtualenv propio
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# ================================
# Stage 2: Production runner
# ================================
FROM python:3.11-slim AS runner

# Solo runtime libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar packages instalados desde builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copiar solo el código de la app
COPY app/ ./app/

# Usuario no-root por seguridad
RUN useradd -m -u 1001 appuser && chown -R appuser:appuser /app
USER appuser

# Cloud Run usa PORT=8080 por defecto
EXPOSE 8080

# Health check con start-period más generoso (20s para inicialización)
HEALTHCHECK --interval=30s --timeout=15s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# ✅ CMD que lee $PORT de Cloud Run (usando shell para expansión de variables)
CMD ["/bin/sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --log-level info --proxy-headers --forwarded-allow-ips='*'"]