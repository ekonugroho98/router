#!/usr/bin/env python3
"""
HTTP wrapper untuk kiro_login.py.

Endpoints:
  GET  /health                — health check
  POST /login                 — login 1 akun, return JSON dengan refresh_token
  POST /bulk-login            — login banyak akun, stream SSE progress, auto-save ke 9router

Env vars (atau pakai --flag):
  KIRO_BULK_PORT          (default: 9100)
  KIRO_BULK_ROUTER_URL    (default: http://localhost:20128)
  KIRO_BULK_DEFAULT_DELAY (default: 60 seconds antar akun)
  KIRO_BULK_MAX_RETRIES   (default: 3 per akun)

Usage:
  source .venv/bin/activate
  python server.py
  # Service jalan di http://localhost:9100
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

try:
    from aiohttp import web, ClientSession, ClientTimeout
except ImportError:
    sys.stderr.write("FATAL: aiohttp belum keinstall. Run: pip install aiohttp\n")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).resolve().parent
KIRO_LOGIN_SCRIPT = SCRIPT_DIR / "kiro_login.py"
OPENROUTER_LOGIN_SCRIPT = SCRIPT_DIR / "openrouter_login.py"
GEMINI_CLI_LOGIN_SCRIPT = SCRIPT_DIR / "gemini_login.py"
OLLAMA_LOGIN_SCRIPT = SCRIPT_DIR / "ollama_login.py"
SILICONFLOW_LOGIN_SCRIPT = SCRIPT_DIR / "siliconflow_login.py"
POLLINATIONS_LOGIN_SCRIPT = SCRIPT_DIR / "pollinations_login.py"
PYTHON_BIN = sys.executable  # gunakan python yang sama (dari venv)

# Map provider name → login script
PROVIDER_SCRIPTS = {
    "kiro": KIRO_LOGIN_SCRIPT,
    "openrouter": OPENROUTER_LOGIN_SCRIPT,
    "gemini-cli": GEMINI_CLI_LOGIN_SCRIPT,
    "ollama": OLLAMA_LOGIN_SCRIPT,
    "siliconflow": SILICONFLOW_LOGIN_SCRIPT,
    "pollinations": POLLINATIONS_LOGIN_SCRIPT,
}

# ─── Config ────────────────────────────────────────────────────────────────
def cfg(key: str, default):
    """Read env var with fallback default."""
    return os.environ.get(f"KIRO_BULK_{key}", default)

CONFIG = {
    "port": int(cfg("PORT", 9100)),
    "router_url": cfg("ROUTER_URL", "http://localhost:20128").rstrip("/"),
    "default_delay": int(cfg("DEFAULT_DELAY", 60)),
    "max_retries": int(cfg("MAX_RETRIES", 3)),
    "log_dir": Path(cfg("LOG_DIR", str(SCRIPT_DIR / "logs"))),
    # CLI token bypass auth waktu 9router pake requireLogin=true.
    # Get pake: node addon-kiro-bulk/get-cli-token.js (dari root router project)
    "cli_token": cfg("CLI_TOKEN", ""),
}
CONFIG["log_dir"].mkdir(parents=True, exist_ok=True)

# Lock biar Camoufox cuma jalan 1 instance sekali (browser berat)
_BROWSER_LOCK = asyncio.Lock()


# ─── login script runner (multi-provider) ────────────────────────────────
async def run_login_script(
    provider: str,
    email: str,
    password: str,
    headless: bool = False,
    proxy: Optional[str] = None,
    retries: int = 3,
    geoip: bool = False,
    progress_callback=None,
    anticaptcha_key: Optional[str] = None,
) -> dict:
    """Spawn login script (kiro_login.py atau openrouter_login.py) sebagai subprocess.

    Parse stdout protocol (PROGRESS/DONE/ERROR) dan return result dict.

    progress_callback(msg) dipanggil tiap PROGRESS: line (buat SSE streaming).
    """
    script = PROVIDER_SCRIPTS.get(provider)
    if not script:
        return {"ok": False, "error": f"Unknown provider: {provider}. Supported: {list(PROVIDER_SCRIPTS.keys())}"}
    if not script.exists():
        return {"ok": False, "error": f"Script not found: {script}"}

    args = [
        PYTHON_BIN,
        str(script),
        "--email", email,
        "--password", password,
        "--retries", str(retries),
    ]
    if headless:
        args.append("--headless")
    if proxy:
        args.extend(["--proxy", proxy])
    if geoip:
        args.append("--geoip")
    # OpenRouter support anti-captcha flag
    if provider == "openrouter" and anticaptcha_key:
        args.extend(["--anticaptcha-key", anticaptcha_key])
    # Gemini CLI needs router-url + cli-token to call /authorize
    if provider == "gemini-cli":
        args.extend(["--router-url", CONFIG["router_url"]])
        if CONFIG.get("cli_token"):
            args.extend(["--cli-token", CONFIG["cli_token"]])

    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=str(SCRIPT_DIR),
    )

    result_payload: Optional[dict] = None
    error_message: Optional[str] = None

    assert proc.stdout is not None
    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        text = line.decode("utf-8", errors="replace").rstrip()
        if not text:
            continue

        if text.startswith("PROGRESS:"):
            msg = text[len("PROGRESS:"):]
            if progress_callback:
                await progress_callback({"status": "progress", "message": msg})
        elif text.startswith("DONE:"):
            try:
                result_payload = json.loads(text[len("DONE:"):])
            except json.JSONDecodeError as e:
                error_message = f"Invalid DONE payload: {e}"
        elif text.startswith("ERROR:"):
            error_message = text[len("ERROR:"):]
        else:
            # Stray output (warnings, debug, etc.)
            if progress_callback:
                await progress_callback({"status": "debug", "message": text[:200]})

    await proc.wait()

    if result_payload:
        return {"ok": True, "data": result_payload}
    return {"ok": False, "error": error_message or "Unknown error (no DONE/ERROR line)"}


# Backward-compat alias — caller lama yang pakai run_kiro_login() tetep work
async def run_kiro_login(email, password, **kwargs) -> dict:
    """DEPRECATED: pakai run_login_script(provider='kiro', ...) langsung."""
    return await run_login_script("kiro", email, password, **kwargs)


# ─── 9router integration ───────────────────────────────────────────────────
async def save_to_router(refresh_token: str, router_url: str = None, name: str = None) -> dict:
    """Call 9router /api/oauth/kiro/import buat save connection, lalu rename.

    Flow:
      1. POST /api/oauth/kiro/import  → bikin connection (name default "Account N")
      2. PUT  /api/providers/{id}     → rename connection ke `name` (kalau di-pass)

    Auto-add x-9r-cli-token kalau CONFIG["cli_token"] di-set (bypass requireLogin).
    """
    base = router_url or CONFIG["router_url"]
    import_url = base + "/api/oauth/kiro/import"
    timeout = ClientTimeout(total=30)
    headers = {"Content-Type": "application/json"}
    if CONFIG.get("cli_token"):
        headers["x-9r-cli-token"] = CONFIG["cli_token"]

    try:
        async with ClientSession(timeout=timeout) as session:
            # ── Step 1: Import refresh token ─────────────────────────
            async with session.post(
                import_url,
                json={"refreshToken": refresh_token},
                headers=headers,
            ) as resp:
                body = await resp.text()
                try:
                    parsed = json.loads(body)
                except Exception:
                    parsed = {"raw": body}

                import_ok = 200 <= resp.status < 300 and parsed.get("success") is True
                result = {
                    "status_code": resp.status,
                    "body": parsed,
                    "ok": import_ok,
                }

            # ── Step 2: Rename connection (opsional, kalau import sukses + name di-pass) ──
            if import_ok and name:
                connection_id = parsed.get("connection", {}).get("id")
                if connection_id:
                    put_url = f"{base}/api/providers/{connection_id}"
                    try:
                        async with session.put(
                            put_url,
                            json={"name": name},
                            headers=headers,
                        ) as resp2:
                            put_body = await resp2.text()
                            try:
                                put_parsed = json.loads(put_body)
                            except Exception:
                                put_parsed = {"raw": put_body}
                            result["rename"] = {
                                "status_code": resp2.status,
                                "ok": 200 <= resp2.status < 300,
                                "name": name,
                                "body": put_parsed,
                            }
                    except Exception as e:
                        result["rename"] = {
                            "ok": False,
                            "error": f"rename request failed: {e}",
                            "name": name,
                        }

            return result
    except Exception as e:
        return {"status_code": 0, "ok": False, "body": {"error": str(e)}}


async def save_openrouter_to_router(
    api_key: str,
    router_url: str = None,
    name: str = None,
) -> dict:
    """Save OpenRouter API key sebagai provider connection di 9router.

    Pakai endpoint /api/providers (existing) dengan provider="openrouter" + apiKey.
    Beda dari Kiro yang pakai /api/oauth/kiro/import (refresh token flow).
    """
    base = router_url or CONFIG["router_url"]
    url = base + "/api/providers"
    timeout = ClientTimeout(total=30)
    headers = {"Content-Type": "application/json"}
    if CONFIG.get("cli_token"):
        headers["x-9r-cli-token"] = CONFIG["cli_token"]

    payload = {
        "provider": "openrouter",
        "apiKey": api_key,
        "name": name or "OpenRouter",
        # Set testStatus="active" upfront — key baru di-create via UI OpenRouter,
        # guaranteed work. Skip default "unknown" status.
        "testStatus": "active",
    }

    try:
        async with ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                body = await resp.text()
                try:
                    parsed = json.loads(body)
                except Exception:
                    parsed = {"raw": body}
                ok = 200 <= resp.status < 300
                return {
                    "status_code": resp.status,
                    "body": parsed,
                    "ok": ok,
                }
    except Exception as e:
        return {"status_code": 0, "ok": False, "body": {"error": str(e)}}


async def save_gemini_cli_to_router(
    code: str,
    state: str,
    code_verifier: str,
    redirect_uri: str,
    router_url: str = None,
    name: str = None,
) -> dict:
    """Save Gemini CLI connection via OAuth exchange endpoint.

    Flow:
      1. POST /api/oauth/gemini-cli/exchange { code, state, codeVerifier, redirectUri }
         → server exchanges code → Google tokens → fetches projectId via loadCodeAssist
         → saves connection ke DB
      2. PUT /api/providers/{id} → rename ke email (opsional)

    Different from Kiro: no extra import step — exchange directly creates connection.
    """
    base = router_url or CONFIG["router_url"]
    exchange_url = base + "/api/oauth/gemini-cli/exchange"
    timeout = ClientTimeout(total=30)
    headers = {"Content-Type": "application/json"}
    if CONFIG.get("cli_token"):
        headers["x-9r-cli-token"] = CONFIG["cli_token"]

    try:
        async with ClientSession(timeout=timeout) as session:
            # ── Step 1: Exchange code → tokens (server-side projectId fetch) ──
            async with session.post(
                exchange_url,
                json={
                    "code": code,
                    "state": state,
                    "codeVerifier": code_verifier or "",
                    "redirectUri": redirect_uri,
                },
                headers=headers,
            ) as resp:
                body = await resp.text()
                try:
                    parsed = json.loads(body)
                except Exception:
                    parsed = {"raw": body}

                exchange_ok = 200 <= resp.status < 300 and parsed.get("success") is True
                result = {
                    "status_code": resp.status,
                    "body": parsed,
                    "ok": exchange_ok,
                }

            # ── Step 2: Rename connection (opsional, kalau exchange sukses + name di-pass) ──
            if exchange_ok and name:
                connection_id = parsed.get("connection", {}).get("id")
                if connection_id:
                    put_url = f"{base}/api/providers/{connection_id}"
                    try:
                        async with session.put(
                            put_url,
                            json={"name": name},
                            headers=headers,
                        ) as resp2:
                            put_body = await resp2.text()
                            try:
                                put_parsed = json.loads(put_body)
                            except Exception:
                                put_parsed = {"raw": put_body}
                            result["rename"] = {
                                "status_code": resp2.status,
                                "ok": 200 <= resp2.status < 300,
                                "name": name,
                                "body": put_parsed,
                            }
                    except Exception as e:
                        result["rename"] = {
                            "ok": False,
                            "error": f"rename request failed: {e}",
                            "name": name,
                        }

            return result
    except Exception as e:
        return {"status_code": 0, "ok": False, "body": {"error": str(e)}}


async def save_ollama_to_router(
    api_key: str,
    router_url: str = None,
    name: str = None,
) -> dict:
    """Save Ollama Cloud API key sebagai provider connection di 9router."""
    base = router_url or CONFIG["router_url"]
    url = base + "/api/providers"
    timeout = ClientTimeout(total=30)
    headers = {"Content-Type": "application/json"}
    if CONFIG.get("cli_token"):
        headers["x-9r-cli-token"] = CONFIG["cli_token"]

    payload = {
        "provider": "ollama",
        "apiKey": api_key,
        "name": name or "Ollama Cloud",
        "testStatus": "active",
    }

    try:
        async with ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                body = await resp.text()
                try:
                    parsed = json.loads(body)
                except Exception:
                    parsed = {"raw": body}
                ok = 200 <= resp.status < 300
                return {
                    "status_code": resp.status,
                    "body": parsed,
                    "ok": ok,
                }
    except Exception as e:
        return {"status_code": 0, "ok": False, "body": {"error": str(e)}}


async def save_pollinations_to_router(
    api_key: str, router_url: str = None, name: str = None,
) -> dict:
    """Save Pollinations API key sebagai provider connection di 9router."""
    base = router_url or CONFIG["router_url"]
    url = base + "/api/providers"
    timeout = ClientTimeout(total=30)
    headers = {"Content-Type": "application/json"}
    if CONFIG.get("cli_token"):
        headers["x-9r-cli-token"] = CONFIG["cli_token"]
    payload = {"provider": "pollinations", "apiKey": api_key, "name": name or "Pollinations", "testStatus": "active"}
    try:
        async with ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                body = await resp.text()
                try:
                    parsed = json.loads(body)
                except:
                    parsed = {"raw": body}
                return {"status_code": resp.status, "body": parsed, "ok": 200 <= resp.status < 300}
    except Exception as e:
        return {"status_code": 0, "ok": False, "body": {"error": str(e)}}


async def save_siliconflow_to_router(
    api_key: str,
    router_url: str = None,
    name: str = None,
) -> dict:
    """Save SiliconFlow API key sebagai provider connection di 9router."""
    base = router_url or CONFIG["router_url"]
    url = base + "/api/providers"
    timeout = ClientTimeout(total=30)
    headers = {"Content-Type": "application/json"}
    if CONFIG.get("cli_token"):
        headers["x-9r-cli-token"] = CONFIG["cli_token"]

    payload = {
        "provider": "siliconflow",
        "apiKey": api_key,
        "name": name or "SiliconFlow",
        "testStatus": "active",
    }

    try:
        async with ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                body = await resp.text()
                try:
                    parsed = json.loads(body)
                except Exception:
                    parsed = {"raw": body}
                ok = 200 <= resp.status < 300
                return {"status_code": resp.status, "body": parsed, "ok": ok}
    except Exception as e:
        return {"status_code": 0, "ok": False, "body": {"error": str(e)}}


# Dispatch table — per-provider save logic
PROVIDER_SAVE_HANDLERS = {
    "kiro": lambda data, router_url, name: save_to_router(
        data.get("refresh_token"), router_url=router_url, name=name,
    ),
    "openrouter": lambda data, router_url, name: save_openrouter_to_router(
        data.get("api_key"), router_url=router_url, name=name,
    ),
    "gemini-cli": lambda data, router_url, name: save_gemini_cli_to_router(
        code=data.get("code"),
        state=data.get("state"),
        code_verifier=data.get("code_verifier"),
        redirect_uri=data.get("redirect_uri"),
        router_url=router_url,
        name=name,
    ),
    "ollama": lambda data, router_url, name: save_ollama_to_router(
        data.get("api_key"), router_url=router_url, name=name,
    ),
    "siliconflow": lambda data, router_url, name: save_siliconflow_to_router(
        data.get("api_key"), router_url=router_url, name=name,
    ),
    "pollinations": lambda data, router_url, name: save_pollinations_to_router(
        data.get("api_key"), router_url=router_url, name=name,
    ),
}


async def save_login_result_to_router(
    provider: str, data: dict, router_url: str = None, name: str = None,
) -> dict:
    """Generic save — pilih handler sesuai provider."""
    handler = PROVIDER_SAVE_HANDLERS.get(provider)
    if not handler:
        return {"ok": False, "error": f"No save handler for provider: {provider}"}
    return await handler(data, router_url, name)


# ─── Endpoints ──────────────────────────────────────────────────────────────
async def health(request: web.Request) -> web.Response:
    return web.json_response({
        "status": "ok",
        "service": "kiro-bulk",
        "config": {
            "router_url": CONFIG["router_url"],
            "default_delay_seconds": CONFIG["default_delay"],
            "max_retries": CONFIG["max_retries"],
        },
        "browser_locked": _BROWSER_LOCK.locked(),
    })


async def login_one(request: web.Request) -> web.Response:
    """POST /login — login 1 akun, return JSON.

    Body: {
      "email": "x@gmail.com",
      "password": "xxx",
      "headless": false,
      "proxy": null,
      "save_to_router": true  // default true: langsung save ke 9router
    }
    """
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    # Provider routing — default "kiro" buat backward compat
    provider = (body.get("provider") or "kiro").lower()
    if provider not in PROVIDER_SCRIPTS:
        return web.json_response({
            "error": f"Unknown provider: {provider}. Supported: {list(PROVIDER_SCRIPTS.keys())}"
        }, status=400)

    email = body.get("email", "").strip()
    password = body.get("password", "")
    if not email or not password:
        return web.json_response({"error": "email and password required"}, status=400)

    headless = bool(body.get("headless", False))
    proxy = body.get("proxy") or None
    save_flag = body.get("save_to_router", True)
    retries = int(body.get("retries", CONFIG["max_retries"]))
    anticaptcha_key = body.get("anticaptcha_key") or os.environ.get("ANTICAPTCHA_KEY", "")

    progress_log = []
    async def collect_progress(evt):
        progress_log.append(evt)
        if len(progress_log) > 200:
            progress_log.pop(0)

    async with _BROWSER_LOCK:
        result = await run_login_script(
            provider=provider,
            email=email,
            password=password,
            headless=headless,
            proxy=proxy,
            retries=retries,
            progress_callback=collect_progress,
            anticaptcha_key=anticaptcha_key if provider == "openrouter" else None,
        )

    if not result["ok"]:
        return web.json_response({
            "ok": False,
            "error": result["error"],
            "progress": progress_log[-20:],
        }, status=500)

    data = result["data"]
    if not data.get("email"):
        data["email"] = email

    # Save ke 9router via per-provider handler
    router_result = None
    if save_flag:
        # Validate ada credential berdasarkan provider type
        if provider == "kiro" and not data.get("refresh_token"):
            return web.json_response({
                "ok": False,
                "error": "Login sukses tapi refresh_token kosong (Kiro)",
                "data": data,
            }, status=500)
        if provider == "openrouter" and not data.get("api_key"):
            return web.json_response({
                "ok": False,
                "error": "Login sukses tapi api_key kosong (OpenRouter)",
                "data": data,
            }, status=500)
        if provider == "gemini-cli" and not data.get("code"):
            return web.json_response({
                "ok": False,
                "error": "Login sukses tapi OAuth code kosong (Gemini CLI)",
                "data": data,
            }, status=500)

        connection_name = data.get("email") or email
        router_result = await save_login_result_to_router(
            provider=provider,
            data=data,
            router_url=body.get("router_url"),
            name=connection_name,
        )

    return web.json_response({
        "ok": True,
        "provider": provider,
        "email": email,
        "login_result": data,
        "router_save": router_result,
        "progress": progress_log[-20:],
    })


async def bulk_login(request: web.Request) -> web.StreamResponse:
    """POST /bulk-login — login banyak akun, stream SSE per akun.

    Body: {
      "accounts": [{"email": "...", "password": "..."}, ...],
      "headless": false,
      "proxy": null,                   // proxy buat semua akun (atau per-akun di accounts[])
      "delay_seconds": 60,             // delay (stagger) antar task launch
      "max_concurrent": 1,             // max browser jalan barengan (1-5)
      "save_to_router": true,
      "router_url": null,              // override default
      "max_retries": 3,
      "stop_on_error": false           // kalau true, stop semua bulk pas ada 1 fail
    }
    """
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    accounts = body.get("accounts", [])
    if not isinstance(accounts, list) or not accounts:
        return web.json_response({"error": "accounts array required"}, status=400)

    # Provider routing — default "kiro" buat backward compat
    provider = (body.get("provider") or "kiro").lower()
    if provider not in PROVIDER_SCRIPTS:
        return web.json_response({
            "error": f"Unknown provider: {provider}. Supported: {list(PROVIDER_SCRIPTS.keys())}"
        }, status=400)

    headless = bool(body.get("headless", False))
    proxy = body.get("proxy")
    delay = int(body.get("delay_seconds", CONFIG["default_delay"]))
    save_flag = body.get("save_to_router", True)
    router_url = body.get("router_url")
    retries = int(body.get("max_retries", CONFIG["max_retries"]))
    stop_on_error = bool(body.get("stop_on_error", False))
    anticaptcha_key = body.get("anticaptcha_key") or os.environ.get("ANTICAPTCHA_KEY", "")

    # ── Parallel concurrency ────────────────────────────────────────────
    # Cap di 5 biar gak overkill (browser instances heavy + Google rate-limit).
    # Default 1 (sequential) — preserve safest behavior.
    max_concurrent = max(1, min(5, int(body.get("max_concurrent", 1))))

    # SSE response
    response = web.StreamResponse(
        status=200,
        reason="OK",
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
    await response.prepare(request)

    # Flag — kalau client disconnect, kita stop nyoba write tapi LANJUT proses akun
    # (biar gak hilang token yg udah ke-extract dari browser).
    client_alive = {"v": True}

    async def send_event(event_type: str, data: dict):
        if not client_alive["v"]:
            return  # client udah disconnect, skip write
        payload = json.dumps(data, ensure_ascii=False)
        try:
            await response.write(f"event: {event_type}\ndata: {payload}\n\n".encode("utf-8"))
        except (ConnectionResetError, ConnectionError, RuntimeError) as e:
            # Browser tutup tab / Next.js proxy timeout / dll
            # Set flag biar gak retry write — tapi background process tetap jalan
            client_alive["v"] = False
            print(f"[bulk-login] Client disconnected mid-stream ({type(e).__name__}). "
                  f"Continuing bulk in background...", flush=True)
        except Exception as e:
            # Catch-all buat aiohttp ClientConnectionResetError dll
            cls = type(e).__name__
            if "Connection" in cls or "ClientConnection" in cls:
                client_alive["v"] = False
                print(f"[bulk-login] Client disconnected ({cls}). Continuing bulk in background...",
                      flush=True)
            else:
                raise

    await send_event("start", {
        "total": len(accounts),
        "provider": provider,
        "delay_seconds": delay,
        "max_concurrent": max_concurrent,
        "headless": headless,
        "save_to_router": save_flag,
    })

    # Shared state untuk parallel mode
    summary = {"success": 0, "failed": 0, "details": []}
    summary_lock = asyncio.Lock()
    stop_flag = {"v": False}
    sem = asyncio.Semaphore(max_concurrent)

    async def process_account(idx: int, acc: dict):
        """Proses 1 akun. Dipake di-spawn parallel dgn semaphore."""
        email = (acc.get("email") or "").strip()
        password = acc.get("password") or ""
        per_proxy = acc.get("proxy") or proxy

        # Kalau stop_on_error udah triggered, skip akun berikutnya
        if stop_flag["v"]:
            await send_event("account_skipped", {
                "index": idx,
                "email": email,
                "reason": "stopped due to previous error",
            })
            return

        await send_event("account_start", {
            "index": idx,
            "total": len(accounts),
            "email": email,
        })

        if not email or not password:
            await send_event("account_error", {
                "index": idx,
                "email": email,
                "error": "email or password missing",
            })
            async with summary_lock:
                summary["failed"] += 1
                summary["details"].append({"email": email, "ok": False, "error": "missing creds"})
                if stop_on_error:
                    stop_flag["v"] = True
            return

        async def per_account_progress(evt):
            await send_event("progress", {
                "index": idx,
                "email": email,
                **evt,
            })

        # Acquire semaphore — cuma max_concurrent task yang bisa run kiro_login barengan
        async with sem:
            # Re-check stop flag setelah dapet semaphore
            if stop_flag["v"]:
                await send_event("account_skipped", {
                    "index": idx,
                    "email": email,
                    "reason": "stopped due to previous error (after semaphore)",
                })
                return

            result = await run_login_script(
                provider=provider,
                email=email,
                password=password,
                headless=headless,
                proxy=per_proxy,
                retries=retries,
                progress_callback=per_account_progress,
                anticaptcha_key=anticaptcha_key if provider == "openrouter" else None,
            )

        if not result["ok"]:
            await send_event("account_error", {
                "index": idx,
                "email": email,
                "error": result["error"],
            })
            async with summary_lock:
                summary["failed"] += 1
                summary["details"].append({"email": email, "ok": False, "error": result["error"]})
                if stop_on_error:
                    stop_flag["v"] = True
            return

        data = result["data"]
        if not data.get("email"):
            data["email"] = email

        router_result = None
        if save_flag:
            connection_name = data.get("email") or email
            router_result = await save_login_result_to_router(
                provider=provider,
                data=data,
                router_url=router_url,
                name=connection_name,
            )

        ok_router = (not save_flag) or (router_result and router_result.get("ok"))

        # Build credential preview based on provider type
        if provider == "kiro":
            cred_preview = {"refresh_token_preview": (data.get("refresh_token") or "")[:30] + "..."}
        elif provider == "openrouter":
            cred_preview = {"api_key_preview": (data.get("api_key") or "")[:20] + "..."}
        elif provider == "gemini-cli":
            cred_preview = {"code_preview": (data.get("code") or "")[:30] + "..."}
        else:
            cred_preview = {}

        await send_event("account_done", {
            "index": idx,
            "email": email,
            **cred_preview,
            "router_save": router_result,
            "saved_ok": ok_router,
        })

        async with summary_lock:
            summary["success"] += 1
            summary["details"].append({
                "email": email,
                "ok": True,
                "router_save": router_result,
            })

    # ── Launch tasks ────────────────────────────────────────────────────
    if max_concurrent == 1:
        # Sequential mode (preserve old behavior) — delay applies BETWEEN accounts
        for idx, acc in enumerate(accounts, 1):
            await process_account(idx, acc)
            if idx < len(accounts) and not stop_flag["v"]:
                await send_event("delay", {
                    "seconds": delay,
                    "message": f"Waiting {delay}s before next account...",
                })
                await asyncio.sleep(delay)
    else:
        # Parallel mode — stagger task launch by delay/max_concurrent (anti burst)
        stagger = max(0.5, delay / max_concurrent)
        await send_event("debug", {
            "message": f"Parallel mode: max_concurrent={max_concurrent}, stagger={stagger:.1f}s between task launches",
        })
        tasks = []
        for idx, acc in enumerate(accounts, 1):
            if idx > 1:
                await asyncio.sleep(stagger)
            tasks.append(asyncio.create_task(process_account(idx, acc)))
        # Wait semua selesai
        await asyncio.gather(*tasks, return_exceptions=True)

    await send_event("done", summary)
    # write_eof bisa fail kalau client udah disconnect — handle gracefully
    try:
        await response.write_eof()
    except (ConnectionResetError, ConnectionError, RuntimeError):
        pass
    except Exception as e:
        cls = type(e).__name__
        if "Connection" not in cls and "ClientConnection" not in cls:
            raise
    return response


# ─── App setup ──────────────────────────────────────────────────────────────
def make_app() -> web.Application:
    app = web.Application(client_max_size=10 * 1024 * 1024)  # 10MB
    app.router.add_get("/health", health)
    app.router.add_post("/login", login_one)
    app.router.add_post("/bulk-login", bulk_login)
    return app


def main():
    parser = argparse.ArgumentParser(description="Kiro bulk-login HTTP service")
    parser.add_argument("--port", type=int, default=CONFIG["port"])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--router-url", default=CONFIG["router_url"])
    args = parser.parse_args()

    CONFIG["router_url"] = args.router_url.rstrip("/")
    CONFIG["port"] = args.port

    app = make_app()
    auth_status = (
        f"x-9r-cli-token configured ({CONFIG['cli_token'][:8]}...)"
        if CONFIG.get("cli_token")
        else "NO auth header (works only if 9router requireLogin=OFF)"
    )
    print("=" * 60)
    print(f"  Bulk Login Service (Kiro + OpenRouter + Gemini CLI)")
    print(f"  Host:        http://{args.host}:{args.port}")
    print(f"  Router URL:  {CONFIG['router_url']}")
    print(f"  Auth:        {auth_status}")
    print(f"  Delay:       {CONFIG['default_delay']}s default antar akun")
    print(f"  Retries:     {CONFIG['max_retries']} per akun")
    print(f"  Providers:   {', '.join(PROVIDER_SCRIPTS.keys())}")
    print(f"  Endpoints:")
    print(f"    GET  /health")
    print(f"    POST /login           {{provider, email, password, ...}}")
    print(f"    POST /bulk-login      {{provider, accounts:[...], ...}}")
    print("=" * 60)
    web.run_app(app, host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
