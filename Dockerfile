# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Production Python Backend
FROM python:3.12-slim
WORKDIR /app

# Install system dependencies for audio streaming
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libasound2 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and pre-built frontend dist
COPY . .
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
