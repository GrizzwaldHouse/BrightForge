# BrightForge Docker Deployment

Quick start guide for running BrightForge in Docker containers with GPU acceleration.

## Prerequisites

- **Docker** 20.10+ ([install](https://docs.docker.com/get-docker/))
- **Docker Compose** 2.0+ (included with Docker Desktop)
- **NVIDIA Docker Runtime** (for GPU support)
  - Linux: Install [nvidia-docker2](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
  - Windows: Enable WSL2 + CUDA support in Docker Desktop settings

## Quick Start

### 1. Clone and Configure

```bash
git clone https://github.com/GrizzwaldHouse/BrightForge.git
cd BrightForge

# Copy environment template
cp .env.docker.example .env.docker

# (Optional) Add API keys to .env.docker if using cloud LLM providers
nano .env.docker
```

### 2. Build and Start

```bash
# Build images (first time: ~5-10 minutes for model downloads)
docker-compose build

# Start all services
docker-compose up -d

# Follow logs
docker-compose logs -f
```

### 3. Access BrightForge

- **Web Dashboard:** http://localhost:3847
- **API Docs:** http://localhost:3847/api/health
- **Python Health:** http://localhost:8765/health

## Service Architecture

```
┌─────────────────────────────────────────┐
│  BrightForge Web (Node.js)              │
│  Port: 3847                             │
│  - Coding Agent                         │
│  - Design Engine                        │
│  - Web Dashboard                        │
└─────────────┬───────────────────────────┘
              │
              │ HTTP
              │
┌─────────────▼───────────────────────────┐
│  Python Inference Server (FastAPI)      │
│  Port: 8765                             │
│  - SDXL Image Generation                │
│  - InstantMesh 3D Generation            │
│  - GPU-accelerated (CUDA 12.4)          │
└─────────────────────────────────────────┘
```

## GPU Support

### Verify GPU Access

```bash
# Check if GPU is available in Python container
docker-compose exec python python3 -c "import torch; print(torch.cuda.is_available())"

# Check VRAM
docker-compose exec python nvidia-smi
```

### CPU-Only Mode (No GPU)

If you don't have an NVIDIA GPU, comment out the GPU deployment section in `docker-compose.yml`:

```yaml
# deploy:
#   resources:
#     reservations:
#       devices:
#         - driver: nvidia
#           count: 1
#           capabilities: [gpu]
```

**Note:** 3D generation will fail without GPU. Image generation and coding features will still work.

## Volume Persistence

Data is persisted across container restarts:

| Volume | Purpose | Location |
|--------|---------|----------|
| `brightforge-data` | SQLite DB, generated 3D assets | `/app/data` |
| `brightforge-sessions` | Session logs, plan history | `/app/sessions` |
| `huggingface-cache` | Downloaded AI models (SDXL, InstantMesh) | `/root/.cache/huggingface` |

### Backup Data

```bash
# Backup database and assets
docker cp brightforge-web:/app/data ./backup-data

# Backup model cache (large, ~20GB)
docker cp brightforge-python:/root/.cache/huggingface ./backup-models
```

### Reset Data

```bash
# Stop and remove volumes (DELETES ALL DATA)
docker-compose down -v

# Rebuild from scratch
docker-compose up --build -d
```

## Common Commands

```bash
# View logs (real-time)
docker-compose logs -f

# View logs for specific service
docker-compose logs -f web
docker-compose logs -f python

# Restart services
docker-compose restart

# Stop all services
docker-compose down

# Stop and remove volumes
docker-compose down -v

# Rebuild after code changes
docker-compose up --build -d

# Shell into container
docker-compose exec web sh
docker-compose exec python bash
```

## Troubleshooting

### "Port already in use"

Change ports in `docker-compose.yml`:

```yaml
ports:
  - "8080:3847"  # Change 8080 to any free port
```

### "CUDA driver version mismatch"

Your host CUDA driver is older than the container's CUDA runtime. Update NVIDIA drivers or downgrade the Dockerfile's base image:

```dockerfile
FROM nvidia/cuda:11.8.0-runtime-ubuntu22.04 AS python-server
```

### "Model download stuck"

First run downloads SDXL (~10GB) and InstantMesh (~5GB). This can take 10-30 minutes depending on internet speed. Watch Python logs:

```bash
docker-compose logs -f python
```

### "Python server not responding"

Check if GPU is accessible:

```bash
docker-compose exec python nvidia-smi
```

If `nvidia-smi` fails, install nvidia-docker2 or enable WSL2 CUDA support.

### "Out of memory" errors

Reduce batch size or image resolution in `python/config.yaml` (requires rebuild):

```yaml
generation:
  default_width: 512  # Lower from 1024
  default_height: 512
```

## Production Deployment

For production use (cloud deployment, public access):

1. **Add reverse proxy (nginx)** for SSL/TLS
2. **Set up authentication** (not included in v4.2.0)
3. **Configure rate limiting** (see DEPLOYMENT.md)
4. **Monitor with Prometheus** via `/metrics` endpoint
5. **Use managed GPU instances** (AWS g4dn, GCP T4, Azure NC-series)

See `DEPLOYMENT.md` for detailed cloud deployment guides.

## Development Mode

To develop with live code reloading:

```bash
# Mount source as volume
docker-compose -f docker-compose.dev.yml up
```

Create `docker-compose.dev.yml`:

```yaml
version: '3.8'
services:
  web:
    extends:
      file: docker-compose.yml
      service: web
    volumes:
      - ./src:/app/src
      - ./bin:/app/bin
      - ./public:/app/public
    command: ["node", "--watch", "bin/brightforge-server.js"]
```

## License

MIT License - see LICENSE file for details.

## Support

- GitHub Issues: https://github.com/GrizzwaldHouse/BrightForge/issues
- Documentation: https://github.com/GrizzwaldHouse/BrightForge/blob/main/README.md
