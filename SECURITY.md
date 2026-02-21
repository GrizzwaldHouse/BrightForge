# Security Policy

## Supported Versions

| Version | Supported          | Notes |
| ------- | ------------------ | ----- |
| 4.2.x   | :white_check_mark: | Current stable release |
| 4.1.x   | :x:                | Alpha, upgrade to 4.2.0 |
| < 4.0   | :x:                | Legacy, not maintained |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, email: **marcusldaley@gmail.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive a response within 48 hours. If accepted, we'll work on a fix and credit you in the release notes (unless you prefer to remain anonymous).

---

## Security Considerations

### Production Dependencies (Secure)

BrightForge has **zero known vulnerabilities** in production dependencies:

| Dependency | Version | Purpose | Security Status |
|------------|---------|---------|-----------------|
| `dotenv` | 16.6.1 | Environment variables | ✅ Secure |
| `yaml` | 2.3.4 | Config parsing | ✅ Secure |
| `express` | 4.x | HTTP server | ✅ Secure |
| `better-sqlite3` | Latest | Database driver | ✅ Secure |

All production dependencies are actively maintained and pass `npm audit`.

### Development Dependencies (Acceptable Risk)

`npm audit` reports 30 vulnerabilities in **development-only** dependencies:

| Package | Severity | Impact | Mitigation |
|---------|----------|--------|------------|
| `electron` | Moderate | ASAR integrity bypass | Dev-only, not in production bundle |
| `electron-builder` | High (transitive) | minimatch ReDoS, tar path traversal | Build-time only |
| `eslint` | High (transitive) | minimatch ReDoS | Linting tool, dev-time only |

**Risk Assessment:** ✅ **ACCEPTABLE**

- These packages are **never deployed** to production
- They're used only during development and desktop app building
- Production server runs on `express` + native Node.js modules only
- Docker containers exclude `devDependencies` entirely

### Python Dependencies (Forge3D)

Python inference server uses:

| Dependency | Version | Security Notes |
|------------|---------|----------------|
| PyTorch | 2.10.0+cu124 | Official CUDA build, actively maintained |
| Diffusers | Latest | Hugging Face library, regular updates |
| FastAPI | Latest | Modern, security-focused framework |
| Trimesh | Latest | 3D processing, minimal attack surface |

**Auto-updates:** Python dependencies are pinned in `python/requirements.txt`. Run `pip install --upgrade -r requirements.txt` quarterly.

---

## Security Features

### 1. Environment Variable Protection

**All API keys are environment-based:**

```bash
# ❌ Never in code
const apiKey = 'sk-1234567890';

# ✅ Always from env
const apiKey = process.env.GROQ_API_KEY;
```

**Ignored by git:**
- `.env.local`
- `.env.docker`
- `.claude/.credentials.json`

### 2. Input Validation & Sanitization

**Path Traversal Protection:**

```javascript
// src/forge3d/project-manager.js
_sanitizePath(relativePath) {
  const normalized = path.normalize(relativePath);
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error('Invalid path: path traversal attempt detected');
  }
  return normalized;
}
```

**SQL Injection Protection:**

All database queries use parameterized statements via `better-sqlite3`:

```javascript
// ✅ Safe - parameterized
const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?');
stmt.get(projectId);

// ❌ Never used - vulnerable to SQL injection
this.db.exec(`SELECT * FROM projects WHERE id = '${projectId}'`);
```

### 3. Rate Limiting

**API Endpoints** (optional, see Installation):

```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per 15 min
});

app.use('/api/', limiter);
```

**Budget Limits:**

LLM usage is capped at **$1.00/day** (configurable in `config/llm-providers.yaml`). When exceeded, only free providers are used.

### 4. HTTP Security Headers

**Helmet.js** (optional, see Installation):

```javascript
import helmet from 'helmet';
app.use(helmet());
```

Adds:
- `X-Frame-Options: DENY` (clickjacking protection)
- `X-Content-Type-Options: nosniff` (MIME sniffing protection)
- `Strict-Transport-Security` (HTTPS enforcement)
- `Content-Security-Policy` (XSS protection)

### 5. HTTPS/TLS

**Production deployments should use HTTPS:**

**Option 1: Nginx Reverse Proxy + Let's Encrypt**

```bash
apt-get install -y nginx certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

**Option 2: Cloudflare** (Free SSL + DDoS protection)

1. Add domain to Cloudflare
2. Enable "Full (strict)" SSL mode
3. Automatic certificate management

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed setup.

### 6. File Upload Restrictions

**Forge3D image uploads** have size and type restrictions:

```javascript
// src/api/routes/forge3d.js
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];
```

**No executable uploads allowed.**

### 7. Session Security

Sessions use:
- **In-memory storage** (default) - clears on server restart
- **File-based storage** (optional) - `sessions/` directory
- **No cookies** - stateless API design

### 8. Error Handling

**Production mode** (`NODE_ENV=production`):
- Stack traces hidden from clients
- Generic error messages
- Detailed logs in `sessions/errors.jsonl`

**Development mode** (`NODE_ENV=development`):
- Stack traces visible
- Verbose logging

### 9. Dependency Updates

**Automated scanning:**

```bash
# Check for vulnerabilities
npm audit

# Fix non-breaking issues
npm audit fix

# Update dependencies quarterly
npm update
```

**Renovate Bot** or **Dependabot** recommended for GitHub repos.

---

## Deployment Security Checklist

### ✅ Pre-Deployment

- [ ] Set `NODE_ENV=production`
- [ ] Configure firewall (ports 22, 80, 443, 3847 only)
- [ ] Create `.env.docker` with production API keys
- [ ] Review `config/llm-providers.yaml` budget limits
- [ ] Update system packages: `apt-get update && apt-get upgrade -y`
- [ ] Install fail2ban (SSH brute-force protection)

### ✅ Post-Deployment

- [ ] Enable HTTPS (Let's Encrypt or Cloudflare)
- [ ] Install Helmet.js: `npm install helmet`
- [ ] Install rate limiting: `npm install express-rate-limit`
- [ ] Set up monitoring (Prometheus, CloudWatch, Datadog)
- [ ] Configure log rotation (logrotate or platform-specific)
- [ ] Test all health endpoints (`/api/health`, `/api/ready`, `/api/metrics`)
- [ ] Enable automatic security updates (unattended-upgrades on Ubuntu)

### ✅ Ongoing

- [ ] Review `sessions/errors.jsonl` weekly
- [ ] Check `npm audit` monthly
- [ ] Update Python dependencies quarterly: `pip install --upgrade -r python/requirements.txt`
- [ ] Monitor GPU VRAM usage (prevent memory exhaustion)
- [ ] Review firewall rules monthly

---

## Common Attack Vectors & Mitigations

### 1. Path Traversal

**Attack:** `GET /api/forge3d/projects/../../etc/passwd`

**Mitigation:**
- ✅ `_sanitizePath()` rejects `..` and absolute paths
- ✅ All file operations use `path.join(BASE_DIR, sanitizedPath)`

### 2. SQL Injection

**Attack:** `POST /api/forge3d/generate {"projectId": "1' OR '1'='1"}`

**Mitigation:**
- ✅ Parameterized queries only (no string concatenation)
- ✅ `better-sqlite3` library escapes parameters automatically

### 3. XSS (Cross-Site Scripting)

**Attack:** Inject `<script>` tags in design descriptions

**Mitigation:**
- ✅ Frontend sanitizes all HTML before rendering
- ✅ Helmet.js sets CSP headers
- ✅ Express auto-escapes JSON responses

### 4. CSRF (Cross-Site Request Forgery)

**Attack:** Malicious site sends requests to BrightForge API

**Mitigation:**
- ✅ Stateless API (no cookies, no CSRF tokens needed)
- ✅ CORS configured for same-origin only (default)

### 5. DoS (Denial of Service)

**Attack:** Flood API with requests to exhaust resources

**Mitigation:**
- ✅ Rate limiting (100 requests/15 min per IP)
- ✅ Cloudflare DDoS protection (recommended for production)
- ✅ Nginx connection limits (optional)

### 6. LLM Prompt Injection

**Attack:** User sends malicious prompt to extract system prompts or bypass restrictions

**Mitigation:**
- ✅ System prompts not accessible to user
- ✅ Budget limits prevent cost-based attacks
- ✅ Prompt length limits (8000 chars default)

### 7. GPU Memory Exhaustion

**Attack:** Generate 100 concurrent 3D meshes to crash Python server

**Mitigation:**
- ✅ Queue enforces max 1 concurrent generation
- ✅ VRAM monitoring with auto-warning at 90% usage
- ✅ Graceful degradation (queue pauses on high VRAM)

### 8. Unauthorized File Access

**Attack:** Read arbitrary files via `GET /api/design/download?file=../../../../etc/passwd`

**Mitigation:**
- ✅ All file reads limited to `data/output/` directory
- ✅ Path sanitization rejects `..` and absolute paths
- ✅ File existence checks before serving

---

## Security Hardening (Optional)

### 1. Install Helmet.js

```bash
npm install helmet
```

```javascript
// src/api/server.js
import helmet from 'helmet';
app.use(helmet());
```

### 2. Install Rate Limiting

```bash
npm install express-rate-limit
```

```javascript
// src/api/server.js
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

app.use('/api/', limiter);
```

### 3. Enable Fail2Ban (SSH Protection)

```bash
# Ubuntu/Debian
apt-get install -y fail2ban

# Configure
cat > /etc/fail2ban/jail.local <<EOF
[sshd]
enabled = true
port = 22
maxretry = 3
bantime = 3600
EOF

systemctl restart fail2ban
```

### 4. Firewall Rules

```bash
# ufw (Ubuntu)
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS
ufw allow 3847/tcp # BrightForge
ufw enable

# iptables (RHEL/CentOS)
iptables -A INPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
iptables -A INPUT -p tcp --dport 3847 -j ACCEPT
iptables -P INPUT DROP
iptables-save
```

### 5. Nginx Hardening

```nginx
# /etc/nginx/nginx.conf
http {
    # Hide version
    server_tokens off;

    # Connection limits
    limit_conn_zone $binary_remote_addr zone=addr:10m;
    limit_conn addr 10;

    # Request rate limits
    limit_req_zone $binary_remote_addr zone=req:10m rate=10r/s;
    limit_req zone=req burst=20 nodelay;

    # Buffer overflow protection
    client_body_buffer_size 1K;
    client_header_buffer_size 1k;
    client_max_body_size 10M;
    large_client_header_buffers 2 1k;

    # Timeouts
    client_body_timeout 10;
    client_header_timeout 10;
    keepalive_timeout 5 5;
    send_timeout 10;

    # SSL hardening
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
}
```

---

## Compliance

### Data Privacy

BrightForge **does not collect or store user data** beyond:
- Session logs (file I/O, LLM requests) - stored locally in `sessions/`
- Generated 3D assets - stored locally in `data/output/`
- Error logs - stored locally in `sessions/errors.jsonl`

**No telemetry, analytics, or third-party tracking.**

### API Key Security

User-provided API keys (Groq, Cerebras, Claude, etc.) are:
- ✅ Stored in `.env.local` or `.env.docker` (never in git)
- ✅ Never logged or transmitted (except to respective providers)
- ✅ Used directly with provider APIs (no proxy or storage)

### GDPR Compliance

Since no user data is collected or transmitted, **GDPR does not apply**. BrightForge operates entirely locally or within your infrastructure.

---

## Contact

For security concerns, contact:
- **Email:** marcusldaley@gmail.com
- **GitHub Issues:** [BrightForge Issues](https://github.com/GrizzwaldHouse/BrightForge/issues) (non-sensitive only)

---

## License

MIT License - see [LICENSE](LICENSE) for details.
