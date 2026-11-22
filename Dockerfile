FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RR_DATA_DIR=/data RR_STATIC_DIR=/app/frontend/dist
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt \
    && groupadd --gid 10001 runner \
    && useradd --uid 10001 --gid runner --no-create-home runner \
    && install -d -o runner -g runner /data
COPY backend/ backend/
COPY --from=web /web/dist /app/frontend/dist
USER runner
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=3)"]
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8080"]
