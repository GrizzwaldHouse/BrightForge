# BrightForge - Multi-stage Dockerfile
# Stage 1: Node.js server
# Stage 2: Python inference server with CUDA

# ==============================================================================
# Stage 1: Node.js Server
# ==============================================================================
FROM node:18-alpine AS node-server

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies (production only)
RUN npm ci --omit=dev

# Copy application code
COPY bin ./bin
COPY src ./src
COPY public ./public
COPY config ./config

# Create data directory
RUN mkdir -p /app/data

# Expose server port
EXPOSE 3847

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3847/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Start server
CMD ["node", "bin/brightforge-server.js"]

# ==============================================================================
# Stage 2: Python Inference Server (GPU-enabled)
# ==============================================================================
FROM nvidia/cuda:12.4.0-runtime-ubuntu22.04 AS python-server

# Install Python 3.10
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Python requirements
COPY python/requirements.txt ./requirements.txt
COPY python/config.yaml ./config.yaml

# Install Python dependencies
# Use PyTorch CUDA 12.4 index
RUN pip3 install --no-cache-dir -r requirements.txt \
    --extra-index-url https://download.pytorch.org/whl/cu124

# Copy Python server code
COPY python/*.py ./

# Create output directory
RUN mkdir -p /app/output

# Expose Python server port
EXPOSE 8765

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD python3 -c "import requests; requests.get('http://localhost:8765/health', timeout=5)" || exit 1

# Start Python inference server
CMD ["python3", "inference_server.py", "--port", "8765", "--host", "0.0.0.0"]
