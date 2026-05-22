# Cortex AI — Hermes Platform Roadmap & Customer Guide

---

## PART 1: PRODUCT ROADMAP

### Phase 1 — Foundation (Week 1-2)
> Goal: Customer bisa signup, dapet container, Hermes jalan + Telegram bot aktif.

- [ ] Incus setup di VPS existing (4 vCPU, 54GB RAM, ~25 customers max)
- [ ] Base template image (Ubuntu 24.04 minimal)
- [ ] One-liner install script (`curl | bash`)
  - Hermes agent (AI assistant)
  - CloakBrowser (stealth Chromium, web automation)
  - SSH server
  - Systemd services (auto-start on boot)
- [ ] Config injection (API key, Telegram token, model)
- [ ] Customer signup flow → auto-provision container
- [ ] Customer dashboard: status, SSH info, logs

> Note: Tailscale NOT included by default. Available as optional
> advanced setup for customers who need to connect their own servers.
> Documented in "Advanced Setup" section.

### Phase 2 — Core Features (Week 3-4)
> Goal: Hermes berguna untuk sehari-hari.

- [ ] Scheduled tasks (cron) — "tiap jam 9 kirim laporan"
- [ ] Persistent memory — Hermes inget context across sessions
- [ ] File upload/download via Telegram
- [ ] Custom system prompt per customer (persona)
- [ ] Multi-model selection dari dashboard (Gemini, Claude, GPT)
- [ ] Usage analytics di customer dashboard

### Phase 3 — Power Features (Week 5-6)
> Goal: Hermes jadi automation powerhouse.

- [ ] MCP Servers — connect GitHub, Jira, Slack, Google Drive, Notion
- [ ] RAG / Knowledge Base — upload docs, Hermes jawab dari knowledge
- [ ] Webhook triggers — GitHub push → auto-review, Stripe → auto-invoice
- [ ] Skills marketplace — `/install skill web-scraper`
- [ ] CloakBrowser integration — Hermes automate browser via Playwright API

### Phase 4 — Scale & Monetize (Week 7-8)
> Goal: Production-ready SaaS.

- [ ] Multi-platform — 1 Hermes → Telegram + WhatsApp + Discord + Web
- [ ] Admin dashboard — manage all customer containers
- [ ] Billing integration (Stripe)
- [ ] Auto-scaling — spin up containers on demand
- [ ] Monitoring + alerting (container health, disk, RAM)
- [ ] Customer onboarding wizard (guided setup)
- [ ] Documentation site

### Phase 5 — Differentiators (Month 2+)
> Goal: Moat — fitur yang susah ditiru competitor.

- [ ] Multi-agent — delegate tasks ke sub-agents paralel
- [ ] Database access — customer connect DB, Hermes query langsung
- [ ] API builder — Hermes bikin + deploy endpoint di container
- [ ] Telegram mini-app — rich UI dashboard di dalam Telegram
- [ ] Fine-tuned personas marketplace
- [ ] Team collaboration — multiple users per Hermes instance

---

## PART 2: ONE-LINER INSTALL SCRIPT

### Apa yang di-install
Satu command, semua ke-setup:

```
curl -fsSL https://9router.cortex-ai.my.id/install-hermes.sh | sudo bash
```

Script ini install:
1. **Hermes Agent** — AI assistant (chat, coding, terminal, file management)
2. **CloakBrowser** — stealth Chromium browser (web automation, scraping, bypass captcha)
3. **SSH server** — remote access ke container
4. **Systemd services** — auto-start on boot

Disk: ~1.5GB total (Hermes 1GB + CloakBrowser 250MB + deps 250MB)
RAM: ~105MB idle, ~300-600MB saat aktif

Setelah install, user cuma perlu masukin:
- Telegram Bot Token
- Telegram Owner ID (chat ID)

API key ke Cortex AI sudah pre-configured.

### Optional: Tailscale (advanced users)
Untuk customer yang butuh connect Hermes ke server pribadi mereka:
```bash
# Customer install sendiri via SSH
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --authkey=tskey-auth-xxxxx
```
Ini bikin Hermes bisa akses server private customer via VPN.
Butuh Tailscale account (gratis untuk personal, 3 devices).

---

## PART 3: TUTORIAL — SETUP TELEGRAM BOT

### Step 1: Buat Bot di Telegram

1. Buka Telegram, cari **@BotFather**
2. Kirim `/newbot`
3. Kasih nama bot (contoh: `Kara AI Assistant`)
4. Kasih username bot (contoh: `kara_ai_bot`) — harus diakhiri `bot`
5. BotFather kasih **Bot Token** seperti ini:
   ```
   7123456789:AAF8_xxx-xxxxxxxxxxxxxxxxxxxxxxxx
   ```
6. **Simpan token ini** — jangan share ke siapapun

### Step 2: Dapatkan Chat ID Telegram Kamu

Chat ID diperlukan supaya cuma KAMU yang bisa chat dengan bot.

**Cara 1 — Pakai @userinfobot:**
1. Buka Telegram, cari **@userinfobot**
2. Kirim `/start`
3. Bot reply dengan info kamu, termasuk:
   ```
   Id: 1433257992
   ```
4. Angka itu adalah **Chat ID** kamu

**Cara 2 — Pakai @RawDataBot:**
1. Cari **@RawDataBot** di Telegram
2. Kirim pesan apa aja
3. Bot reply JSON, cari bagian:
   ```json
   "from": {
     "id": 1433257992
   }
   ```

**Cara 3 — Via API (advanced):**
```bash
# Ganti TOKEN dengan bot token kamu
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | python3 -m json.tool
```
Kirim pesan ke bot dulu, lalu run command di atas. Cari `"chat": {"id": XXXXXXX}`.

### Step 3: Install Hermes di Server

SSH ke server kamu:
```bash
ssh hermes@shell.cortex-ai.my.id -p 2201
# atau kalau dapat IP langsung:
ssh hermes@<IP> -p <PORT>
```

Jalankan installer:
```bash
curl -fsSL https://9router.cortex-ai.my.id/install-hermes.sh | sudo bash
```

Installer akan tanya:
```
=== Cortex AI — Hermes Setup ===

Telegram Bot Token: 7123456789:AAF8_xxx-xxxxxxxxxxxxxxxxxxxxxxxx
Telegram Owner ID:  1433257992

Setting up Hermes...
[+] Installing system dependencies...
[+] Installing Hermes Agent v0.12.0...
[+] Installing CloakBrowser (stealth Chromium)...
[+] Downloading Chromium binary (~200MB, one-time)...
[+] Configuring Telegram gateway...
[+] Starting services...

============================================================
  Hermes is LIVE!
============================================================

  Telegram: Open your bot and send /start
  SSH:      ssh hermes@shell.cortex-ai.my.id -p 2201
  API:      https://9router.cortex-ai.my.id/v1

  Tools installed:
    - Hermes Agent   (AI assistant)
    - CloakBrowser   (stealth browser automation)

  Commands:
    hermes status     — check if Hermes is running
    hermes restart    — restart Hermes
    hermes logs       — view live logs
    hermes config     — edit configuration

  Optional add-ons (install via SSH):
    - Tailscale: curl -fsSL https://tailscale.com/install.sh | sh

============================================================
```

### Step 4: Test Bot

1. Buka bot kamu di Telegram
2. Kirim `/start`
3. Bot harusnya reply dengan greeting
4. Coba kirim: `Halo, siapa kamu?`
5. Bot reply sebagai AI assistant

Kalau bot gak reply, cek:
```bash
hermes status    # cek apakah running
hermes logs      # lihat error
hermes restart   # restart kalau perlu
```

---

## PART 4: PANDUAN PENGGUNAAN HERMES

### Apa itu Hermes?

Hermes adalah AI agent yang bisa:
- Chat via Telegram (atau platform lain)
- Jalankan perintah terminal di server kamu
- Browse web dan scrape informasi
- Baca dan analisis gambar
- Buat dan edit file
- Jalankan kode Python/Node.js
- Automasi task berulang

### Perintah Dasar

| Perintah | Fungsi |
|----------|--------|
| `/start` | Mulai session baru |
| `/reset` | Reset conversation (hapus context) |
| `/model` | Ganti AI model |
| `/fast` | Toggle fast mode (response lebih cepat) |
| `/status` | Cek status Hermes |
| `/help` | Tampilkan semua perintah |

### Contoh Penggunaan

**Chat biasa:**
```
User: Jelaskan cara kerja Docker dalam bahasa Indonesia
Kara: Docker adalah platform containerization yang...
```

**Kirim gambar:**
```
User: [kirim foto] Jelaskan gambar ini
Kara: Gambar ini menunjukkan arsitektur microservices dengan...
```

**Terminal command:**
```
User: Cek disk space di server
Kara: Saya jalankan `df -h`...
     /dev/sda1  50G  20G  30G  40% /
```

**Coding:**
```
User: Buatkan script Python untuk scrape harga Bitcoin
Kara: Saya buatkan script-nya...
     [membuat file, menjalankan, menampilkan hasil]
```

**Web browsing:**
```
User: Buka https://example.com dan rangkum isinya
Kara: Saya buka halaman tersebut...
     [browse, extract content, summarize]
```

**File management:**
```
User: Buat file config.yaml dengan isi berikut...
Kara: File sudah dibuat di /home/hermes/config.yaml
```

### Tips Untuk Hasil Terbaik

1. **Jelas dan spesifik** — "Buat REST API dengan Express.js yang punya endpoint GET /users dan POST /users" lebih baik daripada "Buat API"

2. **Berikan context** — "Saya punya project Next.js di ~/myapp, tolong fix error di halaman login" lebih baik daripada "Fix error"

3. **Satu task per pesan** — Jangan gabung 5 task dalam 1 pesan. Pecah jadi step-by-step.

4. **Pakai /reset kalau stuck** — Kalau Hermes mulai bingung atau repeat, reset conversation.

5. **Kirim screenshot untuk bug** — Daripada copy-paste error panjang, kirim screenshot. Hermes bisa baca gambar.

### Model AI yang Tersedia

| Model | Kecepatan | Kualitas | Best For |
|-------|-----------|----------|----------|
| `gc/gemini-2.5-flash` | Sangat cepat | Bagus | Chat harian, quick tasks |
| `gc/gemini-3-flash-preview` | Cepat | Sangat bagus | Coding, analysis |
| `gc/gemini-3-pro-preview` | Sedang | Excellent | Complex reasoning |
| `kr/claude-sonnet-4.5` | Sedang | Excellent | Coding, writing |
| `kr/claude-opus-4.6` | Lambat | Best | Complex tasks, research |

Ganti model:
```
/model gc/gemini-2.5-flash
```

### Limitasi & Yang Perlu Diketahui

**Bisa:**
- Chat, coding, analysis, web browse, file management
- Jalankan command di terminal (dalam container kamu)
- Baca dan analisis gambar (kirim foto ke Telegram)
- Buat dan edit file
- Install packages (npm, pip, apt)
- Web automation via CloakBrowser (scrape, fill form, bypass captcha)
- Screenshot dan analisis halaman web

**Tidak bisa:**
- Akses ke server/komputer lain di luar container (kecuali install Tailscale)
- Mengirim email langsung (tapi bisa via API)
- Akses ke database production kamu (kecuali di-setup koneksi)
- Real-time streaming (Telegram limitation — response dikirim setelah selesai)
- Menyimpan data setelah container di-delete (backup penting ke GitHub/cloud)

**Limitasi:**
- Setiap pesan punya batas token (context window)
- Rate limit per plan (Free: 1K/day, Pro: 20K/day)
- Terminal timeout: 180 detik per command
- Max conversation turns: 45 per session (lalu auto-compress)
- Disk space terbatas sesuai plan

**Keamanan:**
- Container kamu terisolasi dari customer lain
- SSH password hanya kamu yang tahu
- Bot token jangan di-share
- Data di container hilang kalau container di-delete
- Backup penting: simpan di luar container (GitHub, Google Drive, dll)

### Troubleshooting

| Problem | Solusi |
|---------|--------|
| Bot gak reply | `hermes restart` di SSH |
| Bot reply lambat | Coba `/model gc/gemini-2.5-flash` (model lebih cepat) |
| Bot error "rate limit" | Tunggu 1-2 menit, atau upgrade plan |
| Bot gak bisa baca gambar | Pastikan kirim sebagai foto, bukan file |
| Terminal command timeout | Command terlalu lama (>180s). Pecah jadi steps. |
| "Context too long" | Pakai `/reset` untuk mulai fresh |
| SSH connection refused | Container mungkin di-stop. Hubungi admin. |
| Lupa password SSH | Reset dari customer dashboard |

### Manage Hermes via SSH

```bash
# SSH ke container
ssh hermes@shell.cortex-ai.my.id -p 2201

# Cek status
hermes status

# Lihat logs (real-time)
hermes logs

# Restart Hermes
hermes restart

# Edit config
hermes config
# atau manual:
nano ~/.hermes/config.yaml

# Ganti model default
hermes model gc/gemini-2.5-flash

# Update Hermes ke versi terbaru
hermes update

# Lihat versi
hermes --version
```

### Config File Explained

File: `~/.hermes/config.yaml`

```yaml
# Model AI yang dipakai
model:
  default: gc/gemini-2.5-flash    # model utama
  provider: custom
  base_url: https://9router.cortex-ai.my.id/v1  # JANGAN diubah
  api_key: sk-cortex-xxxxx        # API key kamu (JANGAN di-share)

# Agent settings
agent:
  max_turns: 45                   # max percakapan per session
  image_input_mode: native        # bisa baca gambar langsung
  api_max_retries: 2              # retry kalau gagal
  gateway_timeout: 1800           # timeout 30 menit

# Terminal settings
terminal:
  backend: local
  timeout: 180                    # timeout command 3 menit
  cwd: .                          # working directory

# Toolsets yang aktif
toolsets:
  - hermes-cli                    # default tools
  # Tambahkan sesuai kebutuhan:
  # - web                         # web browsing
  # - vision                      # image analysis
  # - terminal                    # terminal access
```

### Support

- Dashboard: https://9router.cortex-ai.my.id/customer/dashboard
- Admin: hubungi @ekonugroho98 di Telegram
- Issue: report di dashboard atau via Hermes bot

---

## PART 5: ADMIN OPERATIONS

### Provision New Customer
```bash
# Via orchestrator API
curl -X POST https://api.cortex-ai.my.id/orchestrator/provision \
  -H "Authorization: Bearer ADMIN_KEY" \
  -d '{
    "email": "customer@email.com",
    "plan": "pro",
    "telegramBotToken": "xxx",
    "telegramOwnerId": "123"
  }'
```

### Monitor All Containers
```bash
# List all containers
incus list -c n,s,4,m

# Check resource usage
incus info hermes-cust-001 --resources

# View customer Hermes logs
incus exec hermes-cust-001 -- tail -f /home/hermes/.hermes/logs/agent.log
```

### Suspend/Resume Customer
```bash
# Suspend (billing issue / abuse)
incus stop hermes-cust-001

# Resume
incus start hermes-cust-001
```

### Update Template (push updates to all)
```bash
# Update base image
incus publish hermes-base --alias hermes-base-v2

# Rolling update existing containers
for c in $(incus list -f csv -c n | grep hermes-cust); do
  incus exec $c -- su - hermes -c "cd ~/.hermes/hermes-agent && git pull && hermes restart"
done
```

### Backup Customer Data
```bash
# Snapshot
incus snapshot create hermes-cust-001 backup-$(date +%Y%m%d)

# Export
incus export hermes-cust-001 /backups/hermes-cust-001.tar.gz
```
