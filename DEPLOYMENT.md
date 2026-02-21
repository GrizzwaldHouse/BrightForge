# BrightForge Cloud Deployment Guide

Deploy BrightForge to popular cloud platforms with GPU support for Forge3D 3D generation.

---

## Table of Contents

- [Quick Comparison](#quick-comparison)
- [DigitalOcean](#digitalocean-gpu-droplets)
- [Render](#render-docker-deployment)
- [Railway](#railway-docker-deployment)
- [AWS](#aws-ec2--ecs)
- [Azure](#azure-virtual-machines)
- [Google Cloud Platform](#google-cloud-platform)
- [Environment Variables](#environment-variables)
- [Security Best Practices](#security-best-practices)
- [Monitoring & Scaling](#monitoring--scaling)

---

## Quick Comparison

| Platform | GPU Support | Ease of Setup | Cost (Est.) | Best For |
|----------|-------------|---------------|-------------|----------|
| **DigitalOcean** | ✅ GPU Droplets | ⭐⭐⭐ Moderate | $216+/mo | Simple GPU instances |
| **Render** | ❌ CPU only | ⭐⭐⭐⭐⭐ Easy | $7-25/mo | Coding + Design only (no 3D) |
| **Railway** | ❌ CPU only | ⭐⭐⭐⭐⭐ Easy | $5-20/mo | Hobby projects (no 3D) |
| **AWS EC2** | ✅ GPU (g4dn) | ⭐⭐ Complex | $0.526/hr | Full-featured with autoscaling |
| **Azure** | ✅ GPU (NC-series) | ⭐⭐ Complex | $0.90/hr | Enterprise deployments |
| **GCP** | ✅ GPU (T4, V100) | ⭐⭐ Complex | $0.35/hr | Advanced ML workloads |

**Note:** Forge3D 3D generation requires NVIDIA GPU. For coding + design only, CPU-based platforms (Render, Railway) work fine.

---

## DigitalOcean GPU Droplets

### Overview

DigitalOcean GPU Droplets provide simple GPU-backed VMs. Good balance of simplicity and power.

**Cost:** Starting at $216/month (GPU droplet with NVIDIA GPU + 8GB VRAM)

### Prerequisites

- DigitalOcean account ([signup](https://www.digitalocean.com/))
- SSH key configured
- Domain name (optional, for HTTPS)

### Step 1: Create GPU Droplet

```bash
# Via DigitalOcean CLI (doctl)
doctl compute droplet create brightforge \
  --size gpu-h100x1-80gb \
  --image ubuntu-22-04-x64 \
  --region nyc3 \
  --ssh-keys YOUR_SSH_KEY_ID

# Or use the web console:
# 1. Click "Create" → "Droplets"
# 2. Choose "GPU Optimized" plan
# 3. Select Ubuntu 22.04 LTS
# 4. Choose region with GPU availability
# 5. Add SSH key
# 6. Create Droplet
```

### Step 2: SSH into Droplet

```bash
ssh root@YOUR_DROPLET_IP
```

### Step 3: Install Docker & NVIDIA Container Runtime

```bash
# Update system
apt-get update && apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install NVIDIA Container Toolkit
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | tee /etc/apt/sources.list.d/nvidia-docker.list
apt-get update && apt-get install -y nvidia-docker2
systemctl restart docker

# Verify GPU access
docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi
```

### Step 4: Deploy BrightForge

```bash
# Clone repository
git clone https://github.com/GrizzwaldHouse/BrightForge.git
cd BrightForge

# Configure environment
cp .env.docker.example .env.docker
nano .env.docker  # Add API keys

# Start containers
docker-compose up -d

# Check logs
docker-compose logs -f
```

### Step 5: Configure Firewall

```bash
# Allow HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3847/tcp  # BrightForge web server
ufw enable

# Or via DigitalOcean Firewall (recommended)
# Web console → Networking → Firewalls → Create Firewall
```

### Step 6: (Optional) Set Up HTTPS with Nginx

```bash
# Install Nginx and Certbot
apt-get install -y nginx certbot python3-certbot-nginx

# Configure reverse proxy
cat > /etc/nginx/sites-available/brightforge <<EOF
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3847;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Enable site
ln -s /etc/nginx/sites-available/brightforge /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Get SSL certificate
certbot --nginx -d your-domain.com
```

---

## Render (Docker Deployment)

### Overview

Render is a Platform-as-a-Service with simple Docker deployment. **CPU only** - no GPU support.

**Best for:** Coding + Design features only (no Forge3D 3D generation)

**Cost:** $7-25/month (Starter to Standard plans)

### Prerequisites

- Render account ([signup](https://render.com))
- GitHub repository (fork BrightForge)

### Step 1: Create Web Service

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name:** brightforge
   - **Environment:** Docker
   - **Region:** Oregon (US West) or nearest
   - **Branch:** main
   - **Dockerfile Path:** ./Dockerfile
   - **Docker Build Context:** .
   - **Instance Type:** Standard ($25/mo for 2GB RAM)

### Step 2: Add Environment Variables

In Render dashboard, add environment variables:

```
NODE_ENV=production
PORT=3847
GROQ_API_KEY=your_groq_key
GEMINI_API_KEY=your_gemini_key
# Add other API keys as needed
```

### Step 3: Deploy

Click **"Create Web Service"**. Render will:
1. Clone your repository
2. Build Docker image
3. Deploy to cloud
4. Assign a URL: `https://brightforge-xxxx.onrender.com`

### Limitations

- **No GPU** - Forge3D 3D generation will not work
- **500MB slug size limit** - Remove Python dependencies in Dockerfile if needed
- **Auto-sleep on free tier** - Use paid plan for always-on service

---

## Railway (Docker Deployment)

### Overview

Railway provides simple Docker deployments with GitHub integration. **CPU only**.

**Best for:** Hobby projects, coding + design only

**Cost:** $5-20/month (usage-based)

### Prerequisites

- Railway account ([signup](https://railway.app))
- GitHub repository

### Step 1: Create Project

1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your BrightForge fork

### Step 2: Configure Service

Railway auto-detects Dockerfile. Configure:

```bash
# Build settings (auto-detected)
Builder: Docker
Dockerfile Path: ./Dockerfile

# Environment variables
NODE_ENV=production
PORT=3847
GROQ_API_KEY=xxx
GEMINI_API_KEY=xxx
```

### Step 3: Deploy

Railway deploys automatically on push to `main`. Access at:
```
https://brightforge-production.up.railway.app
```

### Limitations

- **No GPU** - Forge3D won't work
- **Usage-based pricing** - Can get expensive with heavy usage
- **2GB RAM limit** on Hobby plan

---

## AWS (EC2 / ECS)

### Overview

AWS provides full-featured cloud infrastructure with GPU support via **EC2 g4dn instances**.

**Cost:** $0.526/hour (~$380/month for g4dn.xlarge)

### Option 1: EC2 with GPU (Recommended)

#### Prerequisites

- AWS account with GPU quota ([request increase](https://console.aws.amazon.com/support/home))
- AWS CLI installed ([guide](https://aws.amazon.com/cli/))

#### Step 1: Launch EC2 Instance

```bash
# Create security group
aws ec2 create-security-group \
  --group-name brightforge-sg \
  --description "BrightForge security group"

# Allow HTTP and SSH
aws ec2 authorize-security-group-ingress \
  --group-name brightforge-sg \
  --protocol tcp --port 22 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress \
  --group-name brightforge-sg \
  --protocol tcp --port 3847 --cidr 0.0.0.0/0

# Launch g4dn.xlarge instance (NVIDIA T4 GPU)
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \  # Deep Learning AMI (Ubuntu)
  --instance-type g4dn.xlarge \
  --key-name YOUR_KEY_PAIR \
  --security-groups brightforge-sg \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":50}}]'
```

#### Step 2: SSH and Deploy

```bash
# SSH into instance
ssh -i YOUR_KEY.pem ubuntu@INSTANCE_PUBLIC_IP

# Docker is pre-installed on Deep Learning AMI
# Clone and deploy
git clone https://github.com/GrizzwaldHouse/BrightForge.git
cd BrightForge
cp .env.docker.example .env.docker
# Edit .env.docker with API keys

docker-compose up -d
```

#### Step 3: (Optional) Auto-Scaling with ECS

For production with auto-scaling, use **ECS Fargate** (CPU only) or **ECS EC2** (with GPU).

See [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/) for detailed setup.

### Cost Optimization

- **Spot Instances** - Save up to 70% (may be interrupted)
- **Reserved Instances** - Save 40-60% with 1-3 year commitment
- **Auto-shutdown** - Stop instance when not in use

---

## Azure (Virtual Machines)

### Overview

Azure provides GPU-enabled VMs via **NC-series** (NVIDIA Tesla).

**Cost:** $0.90/hour for NC6 (1x K80 GPU)

### Prerequisites

- Azure account ([signup](https://azure.microsoft.com/free/))
- Azure CLI installed

### Step 1: Create VM

```bash
# Login
az login

# Create resource group
az group create --name BrightForgeRG --location eastus

# Create NC-series VM (GPU)
az vm create \
  --resource-group BrightForgeRG \
  --name brightforge-vm \
  --image UbuntuLTS \
  --size Standard_NC6 \
  --admin-username azureuser \
  --generate-ssh-keys

# Open port 3847
az vm open-port \
  --resource-group BrightForgeRG \
  --name brightforge-vm \
  --port 3847
```

### Step 2: Install NVIDIA Drivers

```bash
# SSH into VM
ssh azureuser@VM_PUBLIC_IP

# Install NVIDIA drivers
sudo apt-get update
sudo apt-get install -y nvidia-driver-525

# Reboot
sudo reboot
```

### Step 3: Deploy BrightForge

```bash
# After reboot, SSH back in
# Install Docker + NVIDIA runtime (same as DigitalOcean steps)
curl -fsSL https://get.docker.com | sh

# Install NVIDIA Docker
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
sudo apt-get update && sudo apt-get install -y nvidia-docker2
sudo systemctl restart docker

# Deploy BrightForge
git clone https://github.com/GrizzwaldHouse/BrightForge.git
cd BrightForge
cp .env.docker.example .env.docker
# Edit .env.docker

docker-compose up -d
```

---

## Google Cloud Platform

### Overview

GCP provides GPU instances via **Compute Engine** with NVIDIA T4/V100/A100 GPUs.

**Cost:** $0.35/hour for n1-standard-4 + T4 GPU (~$250/month)

### Prerequisites

- GCP account ([signup](https://cloud.google.com/free))
- gcloud CLI installed

### Step 1: Create GPU Instance

```bash
# Login
gcloud auth login

# Set project
gcloud config set project YOUR_PROJECT_ID

# Request GPU quota (if needed)
# Go to: https://console.cloud.google.com/iam-admin/quotas

# Create instance with T4 GPU
gcloud compute instances create brightforge-vm \
  --zone=us-central1-a \
  --machine-type=n1-standard-4 \
  --accelerator=type=nvidia-tesla-t4,count=1 \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB \
  --maintenance-policy=TERMINATE

# Allow HTTP traffic
gcloud compute firewall-rules create allow-brightforge \
  --allow tcp:3847
```

### Step 2: SSH and Install Drivers

```bash
# SSH
gcloud compute ssh brightforge-vm --zone=us-central1-a

# Install NVIDIA drivers
curl https://raw.githubusercontent.com/GoogleCloudPlatform/compute-gpu-installation/main/linux/install_gpu_driver.py --output install_gpu_driver.py
sudo python3 install_gpu_driver.py

# Verify
nvidia-smi
```

### Step 3: Deploy BrightForge

Same as DigitalOcean/Azure - install Docker, NVIDIA runtime, clone repo, configure `.env.docker`, run `docker-compose up -d`.

---

## Environment Variables

All platforms need these environment variables configured (via `.env.docker` or platform settings):

```env
# Required
NODE_ENV=production
PORT=3847
PYTHON_PORT=8765

# LLM Providers (at least one recommended)
GROQ_API_KEY=your_groq_api_key
CEREBRAS_API_KEY=your_cerebras_key
TOGETHER_API_KEY=your_together_key
MISTRAL_API_KEY=your_mistral_key
GEMINI_API_KEY=your_gemini_key
CLAUDE_API_KEY=your_claude_key
OPENAI_API_KEY=your_openai_key

# Optional
OLLAMA_HOST=http://127.0.0.1:11434
```

See [INSTALL.md](INSTALL.md) for API key signup links.

---

## Security Best Practices

### 1. Use Environment Variables (Never hardcode keys)

```bash
# ❌ Bad
const apiKey = 'sk-1234567890';

# ✅ Good
const apiKey = process.env.GROQ_API_KEY;
```

### 2. Enable Firewall Rules

Only allow necessary ports:
- **22** (SSH) - Restrict to your IP if possible
- **80/443** (HTTP/HTTPS) - For web access
- **3847** (BrightForge) - Or use reverse proxy (Nginx) instead

### 3. Use HTTPS (SSL/TLS)

**Option 1: Nginx Reverse Proxy + Let's Encrypt**

```bash
# Install Certbot
apt-get install -y certbot python3-certbot-nginx

# Get certificate
certbot --nginx -d your-domain.com
```

**Option 2: Cloudflare** (Free SSL + DDoS protection)

1. Add your domain to Cloudflare
2. Point DNS to your server IP
3. Enable "Full (strict)" SSL mode
4. Cloudflare handles certificates automatically

### 4. Rate Limiting (Prevent Abuse)

Add rate limiting to Express routes:

```bash
npm install express-rate-limit
```

```javascript
// src/api/server.js
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

### 5. Helmet.js (Security Headers)

```bash
npm install helmet
```

```javascript
// src/api/server.js
import helmet from 'helmet';
app.use(helmet());
```

### 6. Regular Updates

```bash
# Update system packages
apt-get update && apt-get upgrade -y

# Update npm dependencies
npm audit fix

# Rebuild Docker images
docker-compose build --no-cache
docker-compose up -d
```

---

## Monitoring & Scaling

### Health Checks

BrightForge provides three health endpoints:

- `GET /api/health` - Provider status, budget, timestamp
- `GET /api/ready` - Kubernetes readiness probe (server, DB, Python)
- `GET /api/metrics` - Prometheus-compatible metrics

### Prometheus + Grafana

```yaml
# docker-compose.monitoring.yml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
```

**prometheus.yml:**

```yaml
scrape_configs:
  - job_name: 'brightforge'
    static_configs:
      - targets: ['web:3847']
    metrics_path: '/api/metrics'
```

### Auto-Scaling (AWS Example)

Use AWS Auto Scaling Groups with ECS:

1. Create ECS Task Definition with BrightForge
2. Create ECS Service with Auto Scaling
3. Set scaling policies based on CPU/Memory

See [AWS Auto Scaling Guide](https://docs.aws.amazon.com/autoscaling/ec2/userguide/what-is-amazon-ec2-auto-scaling.html).

### Log Aggregation

**Option 1: CloudWatch (AWS)**

```bash
# Install CloudWatch agent
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
dpkg -i amazon-cloudwatch-agent.deb
```

**Option 2: Papertrail (All platforms)**

```bash
# Install remote_syslog2
wget https://github.com/papertrail/remote_syslog2/releases/download/v0.20/remote_syslog_linux_amd64.tar.gz
tar xzf remote_syslog_linux_amd64.tar.gz
```

---

## Troubleshooting

### "Cannot connect to Python server"

**Cause:** Python inference server not starting (GPU issues, missing drivers)

**Fix:**
```bash
# Check GPU
nvidia-smi

# Check Python logs
docker-compose logs python

# Restart Python container
docker-compose restart python
```

### "Out of memory" errors

**Cause:** Insufficient VRAM for SDXL + InstantMesh

**Fix:** Reduce image resolution in `python/config.yaml`:
```yaml
generation:
  default_width: 512  # Lower from 1024
  default_height: 512
```

### "Port 3847 already in use"

**Cause:** Another service using the port

**Fix:** Change port in `.env.docker`:
```env
PORT=8080
```

Or find and kill the process:
```bash
lsof -ti:3847 | xargs kill -9
```

### SSL certificate errors (HTTPS)

**Cause:** Certbot failed or certificate expired

**Fix:**
```bash
# Renew certificate
certbot renew

# Reload Nginx
systemctl reload nginx
```

---

## Cost Summary

| Platform | Instance Type | GPU | RAM | Monthly Cost |
|----------|---------------|-----|-----|--------------|
| DigitalOcean | GPU Droplet | H100 | 80GB | $216+ |
| Render | Standard | None | 2GB | $25 |
| Railway | Hobby | None | 2GB | $5-20 |
| AWS EC2 | g4dn.xlarge | T4 | 16GB | ~$380 |
| Azure | NC6 | K80 | 56GB | ~$650 |
| GCP | n1-std-4 + T4 | T4 | 15GB | ~$250 |

**Cheapest GPU option:** GCP ($0.35/hr)
**Simplest setup:** Render or Railway (no GPU)
**Best value:** AWS Spot Instances (up to 70% off)

---

## Next Steps

1. **Choose a platform** based on your needs (GPU vs CPU only)
2. **Follow the deployment guide** for your chosen platform
3. **Configure environment variables** with API keys
4. **Test all features** via web dashboard
5. **Set up monitoring** (health checks, logs)
6. **Enable HTTPS** for production

For local development, see [INSTALL.md](INSTALL.md).
For Docker deployment, see [DOCKER.md](DOCKER.md).

---

## Support

- **Issues:** [GitHub Issues](https://github.com/GrizzwaldHouse/BrightForge/issues)
- **Documentation:** [README.md](README.md)

---

## License

MIT License - see [LICENSE](LICENSE) for details.
