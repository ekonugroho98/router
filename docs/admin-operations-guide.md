# Admin Operations Guide — Cortex AI

Panduan lengkap untuk admin mengelola customer, dari order masuk sampai container jalan.

---

## Flow Lengkap (Manual)

```
1. Customer beli di lynk.id
2. Kamu terima notif order
3. Generate kode aktivasi
4. Kirim kode ke customer via DM
5. Customer redeem kode di web → akun + API key dibuat
6. Customer input Telegram bot token + chat ID
7. Kamu provision Incus container di VPS
8. Bot aktif!
```

---

## Step 1: Generate Kode Aktivasi

### Login admin dulu (sekali aja, cookie valid beberapa jam)
```bash
ssh karaya@20.24.192.82

curl -s -c /tmp/adm.txt -X POST http://127.0.0.1:20128/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"lFoGDkEVyQiBdhPJ"}'
```

### Generate kode Free Trial (3 hari)
```bash
curl -s -b /tmp/adm.txt -X POST http://127.0.0.1:20128/api/admin/redeem-codes \
  -H "Content-Type: application/json" \
  -d '{
    "count": 1,
    "plan": "free",
    "durationDays": 3,
    "quotaDailyLimit": 100,
    "quotaMonthlyLimit": 3000,
    "label": "free trial - [NAMA CUSTOMER]"
  }'
```

### Generate kode Pro Plan (30 hari)
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

### Generate kode custom durasi
```bash
# 7 hari
-d '{"plan": "pro", "durationDays": 7, ...}'

# 14 hari
-d '{"plan": "pro", "durationDays": 14, ...}'

# 1 tahun
-d '{"plan": "enterprise", "durationDays": 365, ...}'
```

### Lihat semua kode
```bash
curl -s -b /tmp/adm.txt http://127.0.0.1:20128/api/admin/redeem-codes | python3 -m json.tool
```

---

## Step 2: Kirim Kode ke Customer

Copy template DM dari docs/lynk-id-products.md, ganti CORTEX-XXXX-XXXX dengan kode yang di-generate.

---

## Step 3: Tunggu Customer Redeem

Customer buka: https://9router.cortex-ai.my.id/customer/activate
- Masukkan kode → buat akun → (optional) setup Telegram

Setelah customer selesai redeem, kamu bisa cek di admin:
```bash
curl -s -b /tmp/adm.txt http://127.0.0.1:20128/api/admin/customers | python3 -c "
import sys,json
d = json.load(sys.stdin)
for c in d['customers']:
    meta = c.get('metadata') or {}
    print(f\"{c['email']:30} plan={c['plan']:8} expires={meta.get('expiresAt','N/A')[:10]}\")
"
```

---

## Step 4: Provision Incus Container

Setelah customer redeem dan kamu lihat datanya di admin, provision container:

### Cari customer ID dan API key
```bash
# Dari admin customers list, cari customer yang baru redeem
curl -s -b /tmp/adm.txt http://127.0.0.1:20128/api/admin/customers | python3 -c "
import sys,json
d = json.load(sys.stdin)
for c in d['customers']:
    meta = c.get('metadata') or {}
    tg = meta.get('telegram', {})
    print(f\"ID:    {c['id']}\")
    print(f\"Email: {c['email']}\")
    print(f\"Plan:  {c['plan']}\")
    print(f\"Bot:   {tg.get('botToken','N/A')[:15]}...\")
    print(f\"Owner: {tg.get('ownerId','N/A')}\")
    print()
"
```

### Cari API key customer
```bash
CUST_ID="paste-customer-id-di-sini"

curl -s -b /tmp/adm.txt "http://127.0.0.1:20128/api/admin/customers/$CUST_ID" | python3 -c "
import sys,json
d = json.load(sys.stdin)
for k in d.get('apiKeys',[]):
    print(f\"Key: {k['keyMasked']}  Active: {k['isActive']}\")
meta = d['customer'].get('metadata') or {}
tg = meta.get('telegram', {})
print(f\"Bot Token: {tg.get('botToken','N/A')}\")
print(f\"Owner ID: {tg.get('ownerId','N/A')}\")
"
```

Note: API key di admin cuma masked. Kalau perlu full key, ambil dari DB:
```bash
sudo sqlite3 /var/lib/9router-data/db/data.sqlite \
  "SELECT key FROM customerApiKeys WHERE customerId='$CUST_ID' AND isActive=1"
```

### Provision container
```bash
# Ambil data customer
CUST_ID="paste-id"
API_KEY="sk-cortex-paste-full-key"
BOT_TOKEN="7123456789:AAA..."  # dari customer metadata.telegram.botToken
OWNER_ID="1433257992"           # dari customer metadata.telegram.ownerId

# Jalankan provisioning
sudo bash /opt/9router/provision-hermes.sh \
  --customer-id "$CUST_ID" \
  --api-key "$API_KEY" \
  --bot-token "$BOT_TOKEN" \
  --owner-id "$OWNER_ID"
```

### Output yang muncul
```
[+] Provisioning container: hermes-87d2f06b
[+] Launching from template: hermes-template-v1
[+] Setting up network...
[+] Setting SSH password...
[+] Injecting config...
[+] Configuring Telegram bot...
[+] Starting Hermes gateway...
[+] Health check...

============================================================
[+] DONE! Container provisioned.
============================================================

  Container:    hermes-87d2f06b
  SSH Password: aB3xK9mPq2wZ
  Status:       active
```

### Simpan SSH password — kirim ke customer kalau Pro plan.

---

## Step 5: Verifikasi

```bash
# Cek container jalan
sudo incus list

# Cek Hermes status di container
sudo incus exec hermes-XXXXXXXX -- systemctl status hermes-gateway

# Lihat logs
sudo incus exec hermes-XXXXXXXX -- tail -20 /home/hermes/.hermes/logs/agent.log

# Test bot respond (minta customer kirim /start ke bot-nya)
```

---

## Operasi Sehari-hari

### Lihat semua containers
```bash
sudo incus list
```

### Restart Hermes di container customer
```bash
sudo incus exec hermes-XXXXXXXX -- systemctl restart hermes-gateway
```

### Lihat logs customer
```bash
sudo incus exec hermes-XXXXXXXX -- tail -50 /home/hermes/.hermes/logs/agent.log
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
sudo incus exec hermes-XXXXXXXX -- su - hermes -c "
  sed -i 's/default: .*/default: kr\/claude-sonnet-4.5/' ~/.hermes/config.yaml
"
sudo incus exec hermes-XXXXXXXX -- systemctl restart hermes-gateway
```

### Reset SSH password customer
```bash
NEW_PASS=$(head -c 12 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 12)
sudo incus exec hermes-XXXXXXXX -- bash -c "echo 'hermes:$NEW_PASS' | chpasswd"
echo "New password: $NEW_PASS"
```

---

## Monitoring

### CPU & RAM usage semua containers
```bash
sudo incus list -c n,s,4,m
```

### Disk usage
```bash
df -h /
sudo du -sh /var/lib/incus/storage-pools/default/containers/*/
```

### Cek expired customers (manual, cron juga jalan tiap jam)
```bash
sudo bash /opt/9router/check-expiry.sh
```

### Lihat expiry log
```bash
tail -20 /var/log/hermes-expiry.log
```

---

## Troubleshooting

### Container gak bisa internet
```bash
sudo incus exec hermes-XXXXXXXX -- bash -c '
  echo nameserver 8.8.8.8 > /etc/resolv.conf
  ip addr add 10.10.10.XXX/24 dev eth0 2>/dev/null
  ip route add default via 10.10.10.1 2>/dev/null
  ping -c1 google.com
'
```

### Hermes gak start
```bash
sudo incus exec hermes-XXXXXXXX -- journalctl -u hermes-gateway --no-pager | tail -20
```

### Container gak bisa reach 9router
```bash
sudo incus exec hermes-XXXXXXXX -- curl -s https://9router.cortex-ai.my.id/api/health
```
Kalau gagal, cek iptables di host:
```bash
sudo iptables -L FORWARD -n | head -10
# Harus ada ACCEPT untuk incusbr0
```

### Disk penuh
```bash
# Cek
df -h /

# Hapus container yang sudah expired
sudo incus list
sudo incus delete hermes-expired-xxx --force

# Hapus old images
sudo incus image list
sudo incus image delete FINGERPRINT
```

---

## TODO: Full Otomatis (Belum Diimplementasi)

Nanti kalau mau full otomatis, yang perlu dibangun:

1. API activation (PUT /api/customer/activate) auto-call provisioning script
2. Webhook dari lynk.id → auto-generate kode → auto-email ke customer
3. Customer dashboard show container status (running/stopped/provisioning)
4. Admin dashboard: container list, 1-click suspend/resume/delete
5. Auto-renewal: customer bayar lagi → extend expiresAt + restart container
6. Usage dashboard per container (CPU, RAM, disk)

---

## Quick Reference

| Task | Command |
|------|---------|
| Login admin | `curl -c /tmp/adm.txt -X POST .../api/auth/login -d '{"password":"..."}'` |
| Generate kode | `curl -b /tmp/adm.txt -X POST .../api/admin/redeem-codes -d '{...}'` |
| List customers | `curl -b /tmp/adm.txt .../api/admin/customers` |
| Provision | `sudo bash /opt/9router/provision-hermes.sh --customer-id X --api-key X` |
| List containers | `sudo incus list` |
| Restart hermes | `sudo incus exec hermes-XXX -- systemctl restart hermes-gateway` |
| View logs | `sudo incus exec hermes-XXX -- tail -f /home/hermes/.hermes/logs/agent.log` |
| Suspend | `sudo incus stop hermes-XXX` |
| Resume | `sudo incus start hermes-XXX` |
| Delete | `sudo incus delete hermes-XXX --force` |
| Check expiry | `sudo bash /opt/9router/check-expiry.sh` |
