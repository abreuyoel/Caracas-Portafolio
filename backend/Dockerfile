FROM python:3.11-slim

# Dependencias del sistema para psycopg2 y lxml
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias primero (capa cacheable)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código fuente
COPY app/ ./app/

# Usuario no-root por seguridad
RUN useradd -m appuser && chown -R appuser /app
USER appuser

# Cloud Run usa PORT=8080 por defecto
EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
