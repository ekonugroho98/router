# Lynk.id Product Setup — Cortex AI

---

## PRODUK 1: Free Trial

### Judul
```
Cortex AI — Free Trial 3 Hari (GRATIS)
```

### Harga
```
Rp 0
```

### Deskripsi (copy-paste ke lynk.id)
```
AI Assistant pribadi di Telegram — bisa chat, coding, baca gambar, dan browse web. Gratis 3 hari!

Yang kamu dapat:
- AI chat (Gemini Flash) langsung di Telegram
- Bisa kirim gambar, bot analisis otomatis
- 100 request/hari
- Akses dashboard usage

Cara aktivasi:
1. Setelah order, kode aktivasi dikirim via WhatsApp/Telegram dalam 5 menit
2. Buka: https://9router.cortex-ai.my.id/customer/activate
3. Masukkan kode → buat akun → setup bot Telegram
4. Selesai! Bot AI kamu langsung aktif

Panduan lengkap: https://docs.cortex-ai.my.id

Hubungi admin untuk terima kode: @ekonugroho98 (Telegram)

⚠️ Terbatas untuk 5 orang pertama!
```

### Platform / File yang dikirim ke customer
```
Upload → customer-guide-free.pdf
```
Convert dari `docs/customer-guide-free.md`:
- Buka file .md di browser (atau VS Code preview)
- Print → Save as PDF
- Upload PDF ke lynk.id

---

## PRODUK 2: Pro Plan 30 Hari

### Judul
```
Cortex AI — Pro Plan 30 Hari
```

### Harga
```
Rp 99.000
```

### Deskripsi (copy-paste ke lynk.id)
```
AI Agent lengkap di Telegram — chat, coding, web automation, baca gambar. Akses semua model AI (Claude, Gemini, GPT).

Yang kamu dapat:
- Semua model AI: Gemini Flash, Claude Sonnet, Opus, GPT-5.5
- 5.000 request/hari (sehari penuh pun cukup!)
- Baca & analisis gambar/screenshot
- Web automation (CloakBrowser stealth)
- SSH access ke server dedicated
- Customer dashboard (usage, API key, config)
- Support via Telegram

Cara aktivasi:
1. Setelah pembayaran dikonfirmasi, kode aktivasi dikirim via WhatsApp/Telegram
2. Buka: https://9router.cortex-ai.my.id/customer/activate
3. Masukkan kode → buat akun → setup bot Telegram
4. Selesai! Bot AI kamu langsung aktif selama 30 hari

Panduan lengkap: https://docs.cortex-ai.my.id
Contoh penggunaan: https://docs.cortex-ai.my.id/guide/

Butuh bantuan? Hubungi: @ekonugroho98 (Telegram)
```

### Platform / File yang dikirim ke customer
```
Upload → customer-guide-pro.pdf
```
Convert dari `docs/customer-guide-pro.md` → Print → Save as PDF → Upload

---

## TEMPLATE PESAN KIRIM KODE

### Free Trial — kirim ke customer via DM
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

Kalau ada kendala, chat aja di sini ya.
```

### Pro Plan — kirim ke customer via DM
```
Halo! 👋

Pembayaran Cortex AI Pro Plan sudah dikonfirmasi. Terima kasih!

Ini kode aktivasi kamu:
🔑 CORTEX-XXXX-XXXX

Cara pakai:
1. Buka: https://9router.cortex-ai.my.id/customer/activate
2. Masukkan kode di atas
3. Buat akun (email + password)
4. Setup bot Telegram (ikuti panduan di halaman)

Yang kamu dapat:
- Semua model AI (Claude, Gemini, GPT)
- 5.000 request/hari
- Web automation + SSH access
- Aktif 30 hari

Panduan lengkap: https://docs.cortex-ai.my.id
Dashboard: https://9router.cortex-ai.my.id/customer/dashboard

Enjoy! 🚀 Kalau ada pertanyaan, chat aja di sini.
```

---

## TEMPLATE GENERATE KODE (untuk admin)

### Generate Free Trial (5 kode sekaligus)
```bash
curl -s -b /tmp/admin-cookie.txt -X POST \
  https://9router.cortex-ai.my.id/api/admin/redeem-codes \
  -H "Content-Type: application/json" \
  -d '{
    "count": 5,
    "plan": "free",
    "durationDays": 3,
    "quotaDailyLimit": 100,
    "quotaMonthlyLimit": 3000,
    "label": "lynk.id free trial batch"
  }'
```

### Generate Pro Plan (per order)
```bash
curl -s -b /tmp/admin-cookie.txt -X POST \
  https://9router.cortex-ai.my.id/api/admin/redeem-codes \
  -H "Content-Type: application/json" \
  -d '{
    "count": 1,
    "plan": "pro",
    "durationDays": 30,
    "quotaDailyLimit": 5000,
    "quotaMonthlyLimit": 100000,
    "label": "lynk.id pro - [NAMA CUSTOMER]"
  }'
```

### List semua kode
```bash
curl -s -b /tmp/admin-cookie.txt \
  https://9router.cortex-ai.my.id/api/admin/redeem-codes | python3 -m json.tool
```

---

## CATATAN

- Kode format: CORTEX-XXXX-XXXX (otomatis di-generate)
- Satu kode = satu kali pakai (default)
- Kode bisa di-deactivate dari admin API kalau perlu
- Customer bisa login ulang di: /customer/login
- Admin dashboard: /dashboard/customers (lihat semua customer)
