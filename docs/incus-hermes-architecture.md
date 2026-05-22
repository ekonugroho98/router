# Cortex AI — Incus Multi-Tenant Hermes Platform

## Architecture Plan

### Overview
Setiap customer yang beli layanan Hermes dapet isolated Linux container (Incus)
di dalam VPS. Container berjalan seperti mini-VPS dengan full systemd, SSH access,
dan Hermes agent pre-configured.

```
VPS Host (Ubuntu 24.04, 8 vCPU, 64GB RAM, 256GB SSD)
│
├── Incus daemon
│   ├── hermes-base (template image, not running)
│   │
│   ├── hermes-cust-001 (container, running)
│   │   ├── Hermes agent → connects to 9router via API key
│   │   ├── SSH server (port 22 inside, mapped to host :2201)
│   │   └── Telegram bot (customer's token)
│   │
│   ├── hermes-cust-002 (container, running)
│   │   ├── Hermes agent → connects to 9router via API key
│   │   ├── SSH server (port 22 inside, mapped to host :2202)
│   │   └── Telegram bot (customer's token)
│   │
│   └── ... (up to ~50 containers depending on plan mix)
│
├── cortex-orchestrator (Python/Node service)
│   ├── REST API for provisioning
│   ├── Integrates with 9router SaaS MT (customer signup → auto-provision)
│   └── Manages container lifecycle
│
└── Nginx reverse proxy
    ├── shell.cortex-ai.my.id → SSH port forwarding
    └── api.cortex-ai.my.id → 9router + orchestrator API
```

---

### Resource Planning

#### Per Container (Hermes Agent)
| Resource | Free Plan | Pro Plan | Enterprise |
|----------|-----------|----------|------------|
| CPU | 0.5 core | 1 core | 2 cores |
| RAM | 512MB | 1GB | 2GB |
| Disk | 2GB | 5GB | 10GB |
| SSH | No | Yes | Yes |
| Max turns | 30 | 90 | 90 |

#### Host Capacity (8 vCPU, 64GB RAM, 256GB SSD)
| Plan Mix | Max Containers | CPU Used | RAM Used | Disk Used |
|----------|---------------|----------|----------|-----------|
| All Free | ~80 | 40 cores (overcommit OK) | 40GB | 160GB |
| All Pro | ~40 | 40 cores | 40GB | 200GB |
| Mixed (60% Free, 40% Pro) | ~55 | ~40 cores | ~38GB | ~180GB |

Reserve 8GB RAM + 50GB disk for host OS + Incus + 9router.

---

### Container Template (hermes-base)

Pre-baked image with:
- Ubuntu 24.04 minimal
- Python 3.11+ with venv
- Node.js 22 LTS
- Hermes agent (latest release)
- SSH server (openssh-server)
- Systemd services pre-configured:
  - `hermes-gateway.service` (auto-start on boot)
- Config placeholder at `/home/hermes/.hermes/config.yaml`
- User `hermes` (non-root, owns all Hermes files)

#### Template Build Script
```bash
# Create base container
incus launch ubuntu:24.04 hermes-base

# Install dependencies
incus exec hermes-base -- bash -c '
  apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    nodejs npm \
    openssh-server \
    git curl wget

  # Create hermes user
  useradd -m -s /bin/bash hermes
  echo "hermes:changeme" | chpasswd

  # Install Hermes
  su - hermes -c "
    git clone https://github.com/ekonugroho98/hermes-agent.git ~/.hermes/hermes-agent
    cd ~/.hermes/hermes-agent
    python3 -m venv venv
    source venv/bin/activate
    pip install -e .
  "

  # Setup systemd service
  cat > /etc/systemd/system/hermes-gateway.service << EOF
[Unit]
Description=Hermes Agent Gateway
After=network.target

[Service]
User=hermes
WorkingDirectory=/home/hermes/.hermes/hermes-agent
ExecStart=/home/hermes/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main gateway run
Restart=on-failure
RestartSec=10
Environment=HOME=/home/hermes

[Install]
WantedBy=multi-user.target
EOF

  systemctl enable hermes-gateway.service
  systemctl enable ssh
'

# Stop and publish as image
incus stop hermes-base
incus publish hermes-base --alias hermes-base-v1
incus delete hermes-base
```

---

### Provisioning Flow

#### Customer Signup → Container Creation
```
Customer signs up on cortex-ai.my.id/customer/signup
        │
        ▼
SaaS MT creates customer + API key (sk-cortex-xxx)
        │
        ▼
Orchestrator API called: POST /api/orchestrator/provision
  {
    customerId: "uuid",
    email: "customer@email.com",
    apiKey: "sk-cortex-xxx",
    telegramBotToken: "123:abc",  // from onboarding form
    telegramOwnerId: "12345",
    plan: "pro"
  }
        │
        ▼
Orchestrator does:
  1. incus launch hermes-base-v1 hermes-cust-{id}
  2. Apply resource limits (CPU, RAM, disk per plan)
  3. Inject config.yaml with API key + Telegram token
  4. Set SSH password (random, returned to customer)
  5. Assign port mapping (host:220X → container:22)
  6. Start container + hermes-gateway service
  7. Health check (wait for Hermes to connect to 9router)
  8. Return SSH credentials + connection info to customer
        │
        ▼
Customer gets:
  - SSH: ssh hermes@shell.cortex-ai.my.id -p 2201
  - Password: (random, shown once)
  - Telegram bot active
  - Dashboard: cortex-ai.my.id/customer/dashboard
```

#### Container Config Injection
```yaml
# /home/hermes/.hermes/config.yaml (injected per customer)
model:
  default: gc/gemini-2.5-flash  # or customer's chosen model
  provider: custom
  base_url: http://HOST_IP:20128/v1  # 9router on host
  api_key: sk-cortex-CUSTOMER_KEY
agent:
  max_turns: 45  # per plan
  image_input_mode: native
  api_max_retries: 2
auxiliary:
  vision:
    provider: custom
    model: gc/gemini-2.5-flash
    base_url: http://HOST_IP:20128/v1
    api_key: sk-cortex-CUSTOMER_KEY
```

---

### Orchestrator API

REST API running on host, manages container lifecycle.

#### Endpoints
```
POST   /api/orchestrator/provision     — Create container for new customer
DELETE /api/orchestrator/provision/:id  — Destroy container
POST   /api/orchestrator/restart/:id   — Restart Hermes in container
GET    /api/orchestrator/status/:id    — Container status + Hermes health
PATCH  /api/orchestrator/config/:id    — Update config (model, tokens, limits)
GET    /api/orchestrator/list          — List all containers with status
POST   /api/orchestrator/suspend/:id   — Stop container (billing/abuse)
POST   /api/orchestrator/resume/:id    — Resume suspended container
GET    /api/orchestrator/logs/:id      — Tail Hermes logs from container
POST   /api/orchestrator/ssh-reset/:id — Reset SSH password
```

#### Auth
- Admin API key (same as 9router admin)
- Or called internally by SaaS MT signup flow

---

### Network Architecture

```
Internet
    │
    ▼
Nginx (host)
    ├── :443 → 9router dashboard + API (Docker, port 20128)
    ├── :2201-2299 → SSH to Incus containers (stream module)
    └── :8080 → Orchestrator API (internal + admin)

Incus bridge network: 10.10.10.0/24
    ├── hermes-cust-001: 10.10.10.101
    ├── hermes-cust-002: 10.10.10.102
    └── ...

Container → Host access:
    ├── 10.10.10.1:20128 → 9router (API calls)
    └── Internet via host NAT (for Telegram API)
```

#### Nginx SSH Proxy (stream module)
```nginx
# /etc/nginx/stream.d/hermes-ssh.conf
stream {
    # Customer 1
    server {
        listen 2201;
        proxy_pass 10.10.10.101:22;
    }
    # Customer 2
    server {
        listen 2202;
        proxy_pass 10.10.10.102:22;
    }
    # ... generated per container by orchestrator
}
```

---

### Integration with SaaS MT

#### Auto-Provision on Signup
In `src/app/api/customer/signup/route.js`, after customer creation:
```javascript
// After createCustomer + createCustomerApiKey:
// Call orchestrator to provision Incus container
if (body.telegramBotToken) {
  fetch("http://localhost:8080/api/orchestrator/provision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: customer.id,
      email,
      apiKey: apiKey.key,
      telegramBotToken: body.telegramBotToken,
      telegramOwnerId: body.telegramOwnerId,
      plan: "free",
    }),
  }).catch(() => {}); // fire-and-forget, container creation is async
}
```

#### Customer Dashboard Additions
- Container status (running/stopped/provisioning)
- SSH connection info (host, port, username)
- Hermes logs viewer (tail last 50 lines)
- Restart Hermes button
- Config editor (model selection, Telegram token)

#### Admin Dashboard Additions
- Container list with status, CPU, RAM usage
- Suspend/resume containers
- View customer Hermes logs
- Bulk operations (stop all, update template)

---

### Pricing Model Suggestion

| Plan | Price/mo | Quota | Container | SSH | Models |
|------|----------|-------|-----------|-----|--------|
| Free | $0 | 1K req/day | Shared (no container) | No | Gemini Flash only |
| Starter | $10 | 5K req/day | Incus 0.5 CPU, 512MB | No | Gemini + Sonnet |
| Pro | $25 | 20K req/day | Incus 1 CPU, 1GB | Yes | All models |
| Enterprise | $50 | Unlimited | Incus 2 CPU, 2GB | Yes | All + Opus 4.7 |

Free plan uses shared Hermes (no dedicated container).
Paid plans get isolated containers.

---

### Implementation Phases

#### Phase 1 — Foundation (Week 1)
- [ ] Buy + setup new VPS (Ubuntu 24.04)
- [ ] Install Incus
- [ ] Build hermes-base template image
- [ ] Manual test: create container, inject config, verify Hermes works

#### Phase 2 — Orchestrator (Week 2)
- [ ] Build orchestrator API (Node.js or Python)
- [ ] Provision/destroy/restart endpoints
- [ ] SSH port mapping automation
- [ ] Nginx stream config generation
- [ ] Health check + status monitoring

#### Phase 3 — SaaS Integration (Week 3)
- [ ] Connect signup flow → orchestrator
- [ ] Customer dashboard: container status, SSH info, logs
- [ ] Admin dashboard: container list, suspend/resume
- [ ] Onboarding form: Telegram bot token input

#### Phase 4 — Polish + Launch (Week 4)
- [ ] Auto-scaling: template updates, container migration
- [ ] Billing integration (Stripe/manual)
- [ ] Monitoring + alerting (container health, disk usage)
- [ ] Documentation for customers
- [ ] Beta launch with 5-10 customers

---

### Security Checklist
- [ ] Incus containers unprivileged (default)
- [ ] AppArmor profiles for containers
- [ ] SSH key auth option (besides password)
- [ ] Rate limit SSH login attempts (fail2ban per container)
- [ ] Container-to-container isolation (no cross-access)
- [ ] Host firewall: only exposed ports accessible
- [ ] 9router API key per customer (quota enforced)
- [ ] Disk quota per container (prevent abuse)
- [ ] Network egress limits (optional, anti-abuse)
- [ ] Regular template updates (security patches)
