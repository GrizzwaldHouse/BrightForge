# syntax=docker/dockerfile:1
# BrightForge - Multi-stage Dockerfile
#
# Targets:
#   node-server   Node.js web server (production)
#   test          Deterministic Node test suite (no GPU, no API keys)
#   python-test   CPU-only Python mesh tests (no torch)
#   python-server Python inference server with CUDA (GPU hosts only)
#
# Base images are pinned by digest. To update, pull the tag, read its
# RepoDigests (docker image inspect) and replace the digest here.
#
# Behind a TLS-intercepting proxy, pass its CA as an optional build secret
# (never stored in a layer):
#   docker build --secret id=extra_ca,src=/path/to/ca.pem ...
# Every npm ci is followed by a check that the native sqlite module loads,
# because npm can exit 0 after an install script dies.

ARG NODE_IMAGE=node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
# Full Debian Node image for the test stage: ships git (needed by the
# checkpoint/revert security tests) so no apt step is required at build time
ARG NODE_TEST_IMAGE=node:20-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5
ARG PYTHON_IMAGE=python:3.11-slim@sha256:673719e071ecf27434fd2635bbd8d00f49f4fdd81f243143438a42ced8bedf60

# ==============================================================================
# Stage 1: Node.js Server
# ==============================================================================
FROM ${NODE_IMAGE} AS node-server

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    NODE_ENV=production

WORKDIR /app

# Install from the lockfile only (production dependencies)
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --omit=dev --no-audit --no-fund \
    && node -e "require('better-sqlite3')(':memory:').prepare('select 1').get()" \
    && npm cache clean --force

# Copy application code
COPY bin ./bin
COPY src ./src
COPY public ./public
COPY config ./config

# Writable runtime directories owned by the unprivileged user
RUN mkdir -p /app/data /app/sessions /app/logs && chown -R node:node /app/data /app/sessions /app/logs

USER node

# Expose server port
EXPOSE 3847

# Health check (public endpoint, loopback inside the container)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3847/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Start server
CMD ["node", "bin/brightforge-server.js"]

# ==============================================================================
# Stage 2: Deterministic Node test suite (CPU only, offline at run time)
# ==============================================================================
FROM ${NODE_TEST_IMAGE} AS test

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    NODE_ENV=test \
    QA_REPORT_DIR=/app/qa-reports \
    npm_config_cache=/tmp/.npm \
    npm_config_update_notifier=false

WORKDIR /app

# Dependencies (including dev: eslint) strictly from the lockfile
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund \
    && node -e "require('better-sqlite3')(':memory:').prepare('select 1').get()" \
    && npm ls --omit=optional >/dev/null \
    && npm cache clean --force

# Source (the .dockerignore keeps env files, local state and docs out)
COPY . .

# Writable paths are provided as tmpfs by docker-compose; create them so the
# image also works without compose
RUN mkdir -p /app/data /app/sessions /app/logs /app/qa-reports /app/output /app/.claude \
  && chown -R node:node /app/data /app/sessions /app/logs /app/qa-reports /app/output /app/.claude

USER node

CMD ["node", "src/tests/run-deterministic-suite.js"]

# ==============================================================================
# Stage 3: CPU-only Python mesh tests (no torch, no GPU)
# ==============================================================================
FROM ${PYTHON_IMAGE} AS python-test

ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY python/requirements-test.txt ./python/requirements-test.txt
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export PIP_CERT=/run/secrets/extra_ca; fi; \
    pip install --root-user-action=ignore -r python/requirements-test.txt

COPY python ./python
COPY test/fixtures ./test/fixtures

RUN useradd --create-home --uid 1000 tester
USER tester

CMD ["python", "-m", "unittest", "discover", "-s", "python/tests", "-v"]

# ==============================================================================
# Stage 4: Python Inference Server (GPU-enabled)
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
