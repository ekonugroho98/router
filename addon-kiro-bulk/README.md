# addon-kiro-bulk

Bulk-add Kiro accounts ke 9router melalui browser automation (Camoufox + Google OAuth login).

**Status:** Phase 1 — POC 1 akun. Sidecar service + UI integration menyusul setelah POC verified.

**Design principle:** Folder ini **terpisah total** dari `src/` 9router. Tidak ada modifikasi ke source 9router upstream — gampang sync fork kapan saja.

---

## Quick Test (1 akun)

```bash
cd addon-kiro-bulk
bash install.sh                                      # install camoufox + deps (sekali aja)
source .venv/bin/activate
python kiro_login.py --email YOUR@gmail.com --password YOUR_PASS
```

Output:

```
PROGRESS:Attempt 1/3: launching Camoufox...
PROGRESS:Navigating to app.kiro.dev...
PROGRESS:Looking for sign-in entry point...
PROGRESS:Clicking 'Continue with Google'...
PROGRESS:Entering Google email...
PROGRESS:Entering Google password...
PROGRESS:Handling Google post-login screens...
PROGRESS:Clicking 'I understand'...
PROGRESS:Waiting for kiro.dev to load tokens...
PROGRESS:Scanning storage for refresh token (prefix aorAAAAAG...)...
PROGRESS:Session exported: ~/.kiro-bulk/sessions/user_at_gmail.json (15 cookies, 12 ls items)
DONE:{"refresh_token":"aorAAAAAG...","access_token":"...","expires_in":43200,"email":"...","source":"localStorage:aws.sso..."}
```

Field `refresh_token` itulah yang nanti di-POST ke `9router /api/oauth/kiro/import` buat add account.

---

## CLI options

| Flag | Default | Catatan |
|---|---|---|
| `--email <gmail>` | required | Email Google |
| `--password <pwd>` | required | Password Google |
| `--headless` | OFF (headed) | Lebih cepet tapi lebih mudah ke-detect Google. Recommended OFF untuk anti-bot. |
| `--proxy <url>` | none | HTTP/HTTPS/SOCKS5 proxy. Format: `http://user:pass@host:port` |
| `--retries <n>` | 3 | Max retry per akun |
| `--geoip` | OFF | Enable MaxMind GeoIP (kadang bikin hang di macOS, default OFF) |
| `--session-dir <path>` | `~/.kiro-bulk/sessions` | Lokasi simpan cookies + localStorage |

---

## Test scenarios

### 1. Mac local (paling gampang)
```bash
python kiro_login.py --email test@gmail.com --password 'xxx'
```
Browser muncul di layar (headed) → bisa lihat flow-nya, kalau ada CAPTCHA tinggal manual klik.

### 2. Mac headless
```bash
python kiro_login.py --email test@gmail.com --password 'xxx' --headless
```
Lebih cepet, tapi kalau ada CAPTCHA otomatis fail.

### 3. VPS headless
```bash
python kiro_login.py --email test@gmail.com --password 'xxx' --headless
```
VPS biasanya gak ada display, jadi WAJIB `--headless`.

### 4. VPS headed (anti-detect lebih kuat, via Xvfb)
```bash
sudo apt install -y xvfb
xvfb-run -a python kiro_login.py --email test@gmail.com --password 'xxx'
```
Virtual display, browser anggap dirinya jalan di GUI.

### 5. Dengan proxy
```bash
python kiro_login.py --email x@y.com --password z --proxy http://user:pass@1.2.3.4:8080
```

---

## Stdout protocol

Compatible dengan moclaw pattern (gampang di-wrap jadi HTTP service nanti):

| Line prefix | Arti |
|---|---|
| `PROGRESS:<msg>` | Status update (non-terminal) |
| `DONE:<json>` | Sukses. JSON berisi `refresh_token`, `access_token`, `expires_in`, `email`, `profile_arn`, `source` |
| `ERROR:<msg>` | Terminal error (sudah retry sampai habis) |

---

## Troubleshooting

**"camoufox not installed"**
- Re-run `bash install.sh`, atau manual: `pip install 'camoufox[geoip]' && python -m camoufox fetch`

**"Password field not found"**
- Possible: 2FA / device verification / wrong credentials.
- Kalau Google nampilin "Verify it's you" screen, butuh manual handling. Skip dulu akun ini, atau gunakan akun lain yang gak ada 2FA.

**"Login completed but refresh token not found in storage"**
- Kiro mungkin store token di tempat yang gak ke-scan (mis. IndexedDB).
- Cek `PROGRESS:DEBUG storage keys` di output buat lihat key apa saja yang ada.
- Update `EXTRACT_JS` di `kiro_login.py` dengan key spesifik tersebut.

**Browser stuck di Google "Couldn't sign you in"**
- Google detect bot. Solusi:
  - Pake `--proxy` dengan IP berbeda
  - Tunggu 24 jam sebelum coba lagi
  - Login manual sekali dulu di browser biasa pake email ini, baru retry script

**VPS error "missing library libgtk-3"**
- Run installer ulang dengan sudo, atau install manual:
  ```
  sudo apt install -y libgtk-3-0 libdbus-glib-1-2 libxt6 libnss3 libasound2
  ```

---

## Phase 2: HTTP service (`server.py`)

Service ini bungkus `kiro_login.py` jadi REST endpoint. Bisa dipanggil dari 9router UI nantinya.

### Run service

```bash
source .venv/bin/activate
python server.py                                    # default: http://127.0.0.1:9100
python server.py --port 9100 --router-url http://localhost:20128
```

### Env vars (opsional)

| Var | Default | Catatan |
|---|---|---|
| `KIRO_BULK_PORT` | `9100` | Port service ini |
| `KIRO_BULK_ROUTER_URL` | `http://localhost:20128` | 9router target (auto-save connection) |
| `KIRO_BULK_DEFAULT_DELAY` | `60` | Delay antar akun di bulk (detik) |
| `KIRO_BULK_MAX_RETRIES` | `3` | Max retry per akun |
| `KIRO_BULK_CLI_TOKEN` | _(empty)_ | CLI token bypass auth. WAJIB kalau 9router `requireLogin=ON` |

### Auth: bypass requireLogin pakai CLI token

Kalau 9router-mu set `requireLogin=ON` (default di production), sidecar gak bisa save ke `/api/oauth/kiro/import` tanpa auth → response 401 → bulk akan `saved=FAIL`.

**Solusi 1 — Disable requireLogin** (dev only):
```bash
# Login dulu, dapetin JWT cookie
curl -c /tmp/cookie.txt -X POST http://localhost:20128/api/auth/login \
  -H "Content-Type: application/json" -d '{"password":"YOUR_PASS"}'
# Disable
curl -b /tmp/cookie.txt -X POST http://localhost:20128/api/settings \
  -H "Content-Type: application/json" -d '{"requireLogin": false}'
```

**Solusi 2 — Pakai CLI token** (production):
```bash
# Dari root project router (where node_modules installed)
cd ..  # ke folder router/
TOKEN=$(node addon-kiro-bulk/get-cli-token.js)
echo "CLI Token: $TOKEN"

# Start sidecar dengan token
cd addon-kiro-bulk
source .venv/bin/activate
KIRO_BULK_CLI_TOKEN="$TOKEN" python server.py
```

Sekarang sidecar auto-tambah header `x-9r-cli-token: <token>` ke setiap request → bypass requireLogin auth dari 9router.

### Endpoints

**`GET /health`** — health check
```bash
curl http://localhost:9100/health
# {"status":"ok","service":"kiro-bulk",...}
```

**`POST /login`** — login 1 akun (sync, return JSON)
```bash
curl -X POST http://localhost:9100/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "x@gmail.com",
    "password": "xxx",
    "headless": false,
    "save_to_router": true
  }'
# {"ok":true, "email":"...", "login_result":{...}, "router_save":{...}}
```

**`POST /bulk-login`** — login banyak akun, **SSE streaming**
```bash
curl -N -X POST http://localhost:9100/bulk-login \
  -H "Content-Type: application/json" \
  -d '{
    "accounts": [
      {"email":"a@gmail.com","password":"pa"},
      {"email":"b@gmail.com","password":"pb"}
    ],
    "headless": false,
    "delay_seconds": 60,
    "save_to_router": true
  }'
```
Response stream (SSE events):
```
event: start
data: {"total":2,"delay_seconds":60,...}

event: account_start
data: {"index":1,"total":2,"email":"a@gmail.com"}

event: progress
data: {"index":1,"email":"a@gmail.com","status":"progress","message":"Navigating to app.kiro.dev..."}

event: account_done
data: {"index":1,"email":"a@gmail.com","saved_ok":true,...}

event: delay
data: {"seconds":60,"message":"Waiting 60s before next account..."}

event: account_start
data: {"index":2,...}
...

event: done
data: {"success":2,"failed":0,"details":[...]}
```

### Body parameters (bulk-login)

| Field | Default | Catatan |
|---|---|---|
| `accounts` | required | Array `[{email, password, proxy?}]` |
| `headless` | `false` | Headless mode buat semua akun |
| `proxy` | `null` | Global proxy (atau set per-akun di `accounts[].proxy`) |
| `delay_seconds` | `60` | Delay antar akun (anti-bot detection) |
| `save_to_router` | `true` | Auto POST refresh_token ke 9router |
| `router_url` | env default | Override URL 9router |
| `max_retries` | `3` | Per-akun retry |
| `stop_on_error` | `false` | Kalau true: stop semua bulk pas 1 akun fail |

### Concurrency

Service ini pakai **lock global** — Camoufox cuma jalan **1 instance** sekali (browser heavy + anti-detect lebih konsisten). Bulk mode = sequential dengan delay konfigurable.

---

## Roadmap

- **Phase 1** ✅ — `kiro_login.py` (POC, 1 akun) — tested & working
- **Phase 2** ✅ — HTTP service (`server.py`) dengan SSE bulk streaming
- **Phase 3** ⏳ — 9router UI integration:
  - Tombol "Bulk Add Kiro" di `/dashboard/providers`
  - Modal dengan textarea email:password per baris
  - Checkbox headless/headed
  - Dropdown proxy pool (pakai existing `proxyPools` table)
  - Progress bar real-time via SSE

**Integration ke 9router** (Phase 4) hanya butuh:
- 1 file baru: `src/app/api/addon/kiro-bulk/route.js` (folder baru `/addon/`)
- 1 file baru: `BulkKiroLoginModal.js` di `components/`
- 1 edit kecil: tambah tombol di `providers/page.js` (5-10 baris)

**Total modif ke source upstream: minimal.** Pas sync fork dari decolua/9router, conflict cuma di `providers/page.js` (kalau ada).
