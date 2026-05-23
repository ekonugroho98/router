# Admin Operations Guide — Cortex AI

Panduan lengkap untuk admin mengelola customer, dari order masuk sampai container jalan.

---

## Flow Overview

### Automated Flow (Default)
```
1. Admin generate kode aktivasi (free/pro)
2. Customer beli di lynk.id → admin kirim kode via DM
3. Customer buka /customer/activate → input kode + buat akun + setup Telegram
4. System otomatis:
   a. Buat akun + API key di DB
   b. Set provisionStatus = "pending"
   c. Cron (tiap 1 menit) detect pending
   d. Auto-create Incus container dari template v2
   e. Inject config (API key, Telegram token, model, streaming)
   f. Start Hermes gateway
   g. Update provisionStatus = "active" + simpan SSH password
   h. Kirim notif ke admin Telegram
5. Customer buka bot Telegram → /sethome → chat!
```
Max delay dari redeem sampai bot aktif: **~1-2 menit**.

### Manual Flow (Fallback)
Kalau auto-provision gagal, admin bisa provision manual:
```bash
sudo bash /opt/9router/provision-hermes.sh \
  --customer-id "UUID" \
  --api-key "sk-cortex-xxx" \
  --bot-token "7123:AAA..." \
  --owner-id "123456"
```

---

## Step 1: Generate Kode Aktivasi

### Login admin (sekali aja, cookie valid beberapa jam)
```bash
ssh karaya@20.24.192.82

curl -s -c /tmp/adm.txt -X POST http://127.0.0.1:20128/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"lFoGDkEVyQiBdhPJ"}'
```

### Generate kode Free Trial (3 hari, 100 req/hari)
```bash
curl -s -b /tmp/adm.txt -X POST http://127.0.0.1:20128/api/admin/redeem-codes \
  -H "Content-Type: application/json" \
  -d '{
    "count": 5,
    "plan": "free",
    "durationDays": 3,
    "quotaDailyLimit": 100,
    "quotaMonthlyLimit": 3000,
    "label": "free trial batch"
  }'
```

### Generate kode Pro Plan (30 hari, 1000 req/hari)
```bash
curl -s -b /tmp/adm.txt -X POST http://127.0.0.1:20128/api/admin/redeem-codes \
  -H "Content-Type: application/json" \
  -d '{
    "count": 1,
    "plan": "pro",
    "durationDays": 30,
    "quotaDailyLimit": 1000,
    "quotaMonthlyLimit": 30000,
    "label": "pro plan - [NAMA CUSTOMER]"
  }'
```

### Durasi custom
```bash
# 7 hari
"durationDays": 7

# 14 hari
"durationDays": 14

# 1 tahun
"durationDays": 365
```

### Lihat semua kode
```bash
curl -s -b /tmp/adm.txt http://127.0.0.1:20128/api/admin/redeem-codes | python3 -m json.tool
```

---

## Step 2: Kirim Kode ke Customer

Setelah customer beli di lynk.id, kirim kode via DM (WhatsApp/Telegram):

### Template pesan Free Trial
```
Halo! 👋

Terima kasih sudah order Cortex AI Free Trial.

Ini kode aktivasi kamu:
🔑 CORTEX-XXXX-XXXX

Cara pakai:
1. Buka: https://9router.cortex-ai.my.id/customer/activate
2. Masukkan kode di atas
3. Buat akun (email + password)
4. Setup bot Telegram (ikuti panduan di halaman)

Panduan lengkap: https://docs.cortex-ai.my.id

Aktif selama 3 hari sejak aktivasi. Enjoy! 🚀
```

### Template pesan Pro Plan
```
Halo! 👋

Pembayaran Cortex AI Pro Plan sudah dikonfirmasi. Terima kasih!

Ini kode aktivasi kamu:
🔑 CORTEX-XXXX-XXXX

Cara pakai:
1. Buka: https://9router.cortex-ai.my.id/customer/activate
2. Masukkan kode → buat akun → setup Telegram bot
3. Tunggu ~1 menit, bot otomatis aktif!

Yang kamu dapat:
- Semua model AI (Claude, Gemini, GPT)
- 1.000 request/hari
- Web automation + SSH access
- Aktif 30 hari

Panduan: https://docs.cortex-ai.my.id

Enjoy! 🚀
```

---

## Step 3: Customer Redeem (Otomatis)

Customer buka https://9router.cortex-ai.my.id/customer/activate

Dia akan:
1. Input kode → system validasi
2. Buat akun (email + password)
3. Input Telegram Bot Token + Chat ID (optional, bisa nanti)
4. Klik "Buat Akun & Aktifkan"

Setelah ini terjadi otomatis:
- Akun + API key dibuat di database
- provisionStatus = "pending" di customer metadata
- Cron `/opt/9router/auto-provision.sh` jalan tiap menit
- Detect customer pending → launch Incus container
- Container start + Hermes gateway aktif
- provisionStatus = "active"
- Admin terima notif Telegram

**Admin gak perlu ngapa-ngapain.** Tinggal tunggu notif.

---

## Step 4: Verifikasi (Optional)

### Cek auto-provision log
```bash
tail -20 /var/log/hermes-provision.log
```

### Cek semua containers
```bash
sudo incus list
```

### Cek customer di database
```bash
curl -s -b /tmp/adm.txt http://127.0.0.1:20128/api/admin/customers | python3 -c "
import sys,json
d = json.load(sys.stdin)
for c in d['customers']:
    meta = c.get('metadata') or {}
    print(f\"{c['email']:30} plan={c['plan']:5} status={meta.get('provisionStatus','N/A'):12} container={meta.get('container','N/A')}\")"
```

### Cek Hermes status di container customer
```bash
sudo incus exec hermes-XXXXXXXX -- tail -5 /home/hermes/.hermes/logs/gateway.log
```

---

## Operasi Sehari-hari

### Lihat semua containers
```bash
sudo incus list
```

### Restart Hermes di container customer
```bash
sudo incus exec hermes-XXXXXXXX -- bash -c 'pkill -9 -f hermes_cli; sleep 2; systemctl start hermes-gateway'
```

### Lihat logs customer
```bash
sudo incus exec hermes-XXXXXXXX -- tail -50 /home/hermes/.hermes/logs/gateway.log
```

### Suspend customer (billing/abuse)
```bash
sudo incus stop hermes-XXXXXXXX
```

### Resume customer
```bash
sudo incus start hermes-XXXXXXXX
```

### Delete customer container (permanent)
```bash
sudo incus stop hermes-XXXXXXXX --force
sudo incus delete hermes-XXXXXXXX
```

### Ganti model customer
```bash
sudo incus exec hermes-XXXXXXXX -- bash -c "
  sed -i 's/default: .*/default: kr\/claude-sonnet-4.5/' /home/hermes/.hermes/config.yaml
  pkill -9 -f hermes_cli; sleep 2; systemctl start hermes-gateway
"
```

### Reset SSH password customer
```bash
NEW_PASS=$(head -c 12 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 12)
sudo incus exec hermes-XXXXXXXX -- bash -c "echo 'hermes:$NEW_PASS' | chpasswd"
echo "New password: $NEW_PASS"
```

---

## Monitoring

### CPU & RAM semua containers
```bash
sudo incus list -c n,s,4,m
```

### Disk usage
```bash
df -h /
```

### Cek expired customers
```bash
# Manual check (cron juga jalan tiap jam)
sudo bash /opt/9router/check-expiry.sh
```

### Lihat expiry log
```bash
tail -20 /var/log/hermes-expiry.log
```

### Lihat provision log
```bash
tail -20 /var/log/hermes-provision.log
```

---

## Troubleshooting

### Auto-provision gak jalan
```bash
# Cek cron running
sudo crontab -l | grep provision

# Cek log
tail -20 /var/log/hermes-provision.log

# Cek pending customers di DB
sudo sqlite3 /var/lib/9router-data/db/data.sqlite \
  "SELECT email, json_extract(metadata, '$.provisionStatus') FROM customers WHERE json_extract(metadata, '$.provisionStatus') = 'pending'"

# Manual trigger
sudo bash /opt/9router/auto-provision.sh
```

### Container gak bisa internet
```bash
# Cek iptables
sudo iptables -L FORWARD -n | head -5
# Harus ada ACCEPT untuk incusbr0

# Re-add rules
sudo iptables -A FORWARD -i incusbr0 -j ACCEPT
sudo iptables -A FORWARD -o incusbr0 -j ACCEPT
sudo iptables -t nat -A POSTROUTING -s 10.10.10.0/24 ! -d 10.10.10.0/24 -j MASQUERADE

# Fix DNS di container
sudo incus exec hermes-XXXXXXXX -- bash -c '
  echo nameserver 8.8.8.8 > /etc/resolv.conf
  echo nameserver 1.1.1.1 >> /etc/resolv.conf
'
```

### Hermes gak start di container
```bash
# Cek logs
sudo incus exec hermes-XXXXXXXX -- journalctl -u hermes-gateway --no-pager | tail -20

# Cek env vars loaded
sudo incus exec hermes-XXXXXXXX -- cat /etc/systemd/system/hermes-gateway.service

# Manual restart
sudo incus exec hermes-XXXXXXXX -- bash -c 'pkill -9 -f hermes_cli; sleep 2; systemctl daemon-reload; systemctl start hermes-gateway'
```

### Telegram bot gak reply
```bash
# Cek gateway connected
sudo incus exec hermes-XXXXXXXX -- grep "telegram connected" /home/hermes/.hermes/logs/gateway.log

# Cek .env ada
sudo incus exec hermes-XXXXXXXX -- cat /home/hermes/.hermes/.env

# Test bot token valid
TOKEN=$(sudo incus exec hermes-XXXXXXXX -- grep TELEGRAM_BOT_TOKEN /home/hermes/.hermes/.env | cut -d= -f2)
curl -s "https://api.telegram.org/bot${TOKEN}/getMe"
```

### Customer minta home channel
Suruh customer kirim `/sethome` ke bot mereka. Ini one-time setup.

### Disk penuh
```bash
# Cek
df -h /

# Hapus container expired
sudo incus list
sudo incus delete hermes-expired-xxx --force

# Hapus old images
sudo incus image list
sudo incus image delete FINGERPRINT
```

---

## Cron Jobs Active

| Cron | Script | Interval | Fungsi |
|------|--------|----------|--------|
| auto-provision | `/opt/9router/auto-provision.sh` | Tiap 1 menit | Provision container baru |
| check-expiry | `/opt/9router/check-expiry.sh` | Tiap 1 jam | Stop container expired |

Cek cron:
```bash
sudo crontab -l
```

---

## Architecture

```
VPS Host (karaya@20.24.192.82)
├── Docker
│   └── 9router (port 20128)
│       ├── Dashboard: /dashboard
│       ├── Customer pages: /customer/*
│       ├── API: /api/v1/*
│       └── Admin: /api/admin/*
│
├── Incus
│   ├── hermes-XXXXXXXX (customer 1)
│   │   └── Hermes + Telegram bot + CloakBrowser
│   ├── hermes-YYYYYYYY (customer 2)
│   └── ...
│
├── Cron
│   ├── auto-provision.sh (tiap menit)
│   └── check-expiry.sh (tiap jam)
│
└── Sidecar
    └── kiro-bulk (port 9100) — admin bulk add accounts
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Generate kode | `curl -b /tmp/adm.txt -X POST .../api/admin/redeem-codes -d '{...}'` |
| List customers | `curl -b /tmp/adm.txt .../api/admin/customers` |
| List containers | `sudo incus list` |
| Provision log | `tail -f /var/log/hermes-provision.log` |
| Expiry log | `tail -f /var/log/hermes-expiry.log` |
| Restart hermes | `sudo incus exec hermes-XXX -- bash -c 'pkill -9 -f hermes_cli; sleep 2; systemctl start hermes-gateway'` |
| View logs | `sudo incus exec hermes-XXX -- tail -f /home/hermes/.hermes/logs/gateway.log` |
| Suspend | `sudo incus stop hermes-XXX` |
| Resume | `sudo incus start hermes-XXX` |
| Delete | `sudo incus delete hermes-XXX --force` |
| Manual provision | `sudo bash /opt/9router/provision-hermes.sh --customer-id X --api-key X --bot-token X --owner-id X` |
| Check expiry | `sudo bash /opt/9router/check-expiry.sh` |
| Force auto-provision | `sudo bash /opt/9router/auto-provision.sh` |
