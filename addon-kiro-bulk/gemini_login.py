#!/usr/bin/env python3
"""
Automated Gemini CLI (Google Cloud Code Assist) OAuth login.

Flow:
  1. Pre-flight: GET /api/oauth/gemini-cli/authorize  → get authUrl + state + codeVerifier
  2. Launch Camoufox → navigate to authUrl
  3. Auto-fill Google credentials (email + password)
  4. Handle consent screens (Sign in / Continue / Allow / etc.)
  5. Capture callback URL: http://localhost:20128/callback?code=XYZ&state=...
  6. Output DONE with { code, state, code_verifier, redirect_uri, email }

Sidecar (server.py) then POSTs the DONE payload to /api/oauth/gemini-cli/exchange
to actually save the connection (with auto projectId provision).

Usage:
    python3 gemini_login.py --email <gmail> --password <pwd> \\
        --router-url http://localhost:20128 --cli-token <token> \\
        [--headless] [--proxy URL] [--retries N]

Stdout protocol (same as kiro_login.py):
    PROGRESS:<msg>    status updates
    DONE:<json>       success — payload: { code, state, code_verifier, redirect_uri, email }
    ERROR:<msg>       terminal error after retries exhausted
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, parse_qs, urlencode


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Gemini CLI Google-OAuth bulk login helper")
    p.add_argument("--email", required=True, help="Gmail address")
    p.add_argument("--password", required=True, help="Gmail password")
    p.add_argument("--headless", action="store_true", help="Run browser headless (default: headed)")
    p.add_argument("--proxy", default=None, help="HTTP/HTTPS/SOCKS5 proxy URL (optional)")
    p.add_argument("--retries", type=int, default=3, help="Max attempts (default 3)")
    p.add_argument("--geoip", action="store_true", help="Enable MaxMind GeoIP in Camoufox")
    p.add_argument(
        "--router-url",
        default=os.environ.get("ROUTER_URL", "http://localhost:20128"),
        help="9router base URL (default localhost:20128 / $ROUTER_URL)",
    )
    p.add_argument(
        "--cli-token",
        default=os.environ.get("KIRO_BULK_CLI_TOKEN", ""),
        help="x-9r-cli-token header value (default $KIRO_BULK_CLI_TOKEN)",
    )
    p.add_argument(
        "--redirect-port",
        type=int,
        default=20128,
        help="OAuth callback port (default 20128 — matches 9router UI)",
    )
    return p.parse_args()


ARGS = parse_args()
EMAIL = ARGS.email
PASSWORD = ARGS.password
HEADLESS = ARGS.headless
PROXY = ARGS.proxy

# ─── stdout protocol ────────────────────────────────────────────────────────
_RESULT_STATE = {"done": False, "last_error": ""}


def prog(msg: str) -> None:
    print(f"PROGRESS:{msg}", flush=True)


def done(payload_json: str) -> None:
    _RESULT_STATE["done"] = True
    print(f"DONE:{payload_json}", flush=True)


def err(msg: str) -> None:
    _RESULT_STATE["last_error"] = msg
    print(f"PROGRESS:attempt failed: {msg}", flush=True)


def emit_final_error(msg: str) -> None:
    print(f"ERROR:{msg}", flush=True)


# ─── 9router /authorize ─────────────────────────────────────────────────────
async def get_auth_data(redirect_uri: str) -> Optional[dict]:
    """Call 9router /api/oauth/gemini-cli/authorize to get authUrl + state + codeVerifier."""
    try:
        import aiohttp  # type: ignore
    except ImportError:
        return None

    headers = {"Accept": "application/json"}
    if ARGS.cli_token:
        headers["x-9r-cli-token"] = ARGS.cli_token

    url = f"{ARGS.router_url.rstrip('/')}/api/oauth/gemini-cli/authorize"
    params = {"redirect_uri": redirect_uri}

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url, params=params, headers=headers, timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                text = await resp.text()
                if resp.status != 200:
                    prog(f"/authorize {resp.status}: {text[:200]}")
                    return None
                return json.loads(text)
    except Exception as e:
        prog(f"/authorize call failed: {e}")
        return None


def build_auth_url_manual(redirect_uri: str, state: str) -> str:
    """Fallback: build authorize URL using hardcoded GEMINI_CONFIG."""
    client_id = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
    scopes = " ".join([
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
    ])
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": scopes,
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"


# ─── Google login helpers (copied from kiro_login.py) ───────────────────────
async def fill_google_credentials(page) -> bool:
    prog("Entering Google email...")
    try:
        await page.wait_for_selector('input[type="email"]', timeout=45000)
        await page.fill('input[type="email"]', EMAIL)
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(3000)
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=10000)
        except Exception:
            pass
    except Exception as e:
        err(f"Email input not found: {e}")
        return False

    prog("Entering Google password...")
    pwd_filled = False
    for pwd_sel in [
        'input[type="password"]:not([aria-hidden="true"])',
        'input[type="password"][aria-hidden="false"]',
        'input[name="Passwd"]',
        'input[name="password"]',
        'input[type="password"]',
    ]:
        try:
            await page.wait_for_selector(pwd_sel, state="visible", timeout=12000)
            await page.fill(pwd_sel, PASSWORD)
            await page.keyboard.press("Enter")
            pwd_filled = True
            break
        except Exception:
            continue
    if not pwd_filled:
        try:
            cur = page.url
        except Exception:
            cur = "unknown"
        err(f"Password field not found (url={cur[:80]})")
        return False
    return True


# Consent screen button texts — ordered by priority (exact match wins first)
_CONSENT_TEXTS = [
    # English — standard consent flow
    "Continue",
    "Allow",
    "Allow access",
    "Accept",
    "Agree and continue",
    "I agree",
    "I understand",
    "Got it",
    # Google "trust this app" warning (returning users)
    "Sign in",  # "Make sure that you downloaded this app from Google" page
    "Trust",
    "I trust this app",
    # Indonesian
    "Lanjutkan",
    "Lanjut",
    "Saya mengerti",
    "Izinkan",
    "Izinkan akses",
    "Terima",
    "Setuju dan lanjutkan",
    "Masuk",
    # Misc
    "Next",
    "Confirm",
    "Yes",
    "OK",
]

# Negative match — text that should NEVER be clicked (Cancel sits next to Sign in etc.)
_CONSENT_NEGATIVE_TEXTS = [
    "Cancel",
    "Batal",
    "Annuler",
    "Abbrechen",
    "Cancelar",
    "Annulla",
    "No",
    "Tidak",
    "Don't allow",
    "Deny",
    "Decline",
    "Block",
    "Sign in with another account",
    "Use another account",
    "Try another way",
]

JS_CLICK_BY_TEXT = r"""
    (args) => {
        const { texts, negativeTexts } = args;
        const norm = s => (s || '').trim().toLowerCase();
        const targets = texts.map(norm);
        const negatives = (negativeTexts || []).map(norm);
        const sels = [
            'button',
            '[role="button"]',
            'a',
            'input[type="submit"]',
            'input[type="button"]',
            'div[jsaction]',
            'span[role="button"]',
        ];

        // Pass 1: exact match
        const seen = new Set();
        for (const sel of sels) {
            for (const el of document.querySelectorAll(sel)) {
                if (seen.has(el)) continue;
                seen.add(el);
                const txt = norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '');
                if (!txt) continue;
                if (negatives.some(n => txt === n || txt === n + ' ' || txt.startsWith(n + ' '))) continue;
                for (const target of targets) {
                    if (txt === target) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 5 && rect.height > 5) {
                            try {
                                el.click();
                                return { clicked: true, matched: target, tag: el.tagName, txt: txt.slice(0, 80), pass: 'exact' };
                            } catch (_) {}
                        }
                    }
                }
            }
        }

        // Pass 2: substring match
        const seen2 = new Set();
        for (const sel of sels) {
            for (const el of document.querySelectorAll(sel)) {
                if (seen2.has(el)) continue;
                seen2.add(el);
                const txt = norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '');
                if (!txt) continue;
                if (negatives.some(n => txt === n || txt.includes(n))) continue;
                for (const target of targets) {
                    if (txt.includes(target)) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 5 && rect.height > 5) {
                            try {
                                el.click();
                                return { clicked: true, matched: target, tag: el.tagName, txt: txt.slice(0, 80), pass: 'substring' };
                            } catch (_) {}
                        }
                    }
                }
            }
        }
        return { clicked: false };
    }
"""


async def handle_consent_until_callback(page, redirect_port: int) -> Optional[str]:
    """Loop through consent screens until URL contains localhost:{port}/callback.

    Returns the full callback URL on success, None on timeout.
    """
    prog("Watching for consent screens + redirect...")
    deadline = asyncio.get_event_loop().time() + 120  # 2 min for slow networks
    last_url = ""

    while asyncio.get_event_loop().time() < deadline:
        try:
            current_url = page.url
        except Exception:
            prog("Page closed unexpectedly")
            return None

        # Detect callback URL hit (port won't respond but URL is set in browser)
        if (
            f"localhost:{redirect_port}" in current_url
            or "127.0.0.1:" in current_url
        ) and "/callback" in current_url:
            prog(f"Callback URL: {current_url[:140]}")
            return current_url

        # Log URL transitions
        if current_url != last_url:
            prog(f"URL: {current_url[:100]}")
            last_url = current_url

        clicked_any = False

        # 1. Playwright selector (per-target with negative validation)
        for target_text in _CONSENT_TEXTS:
            try:
                btn = page.locator(f"button:has-text('{target_text}')").first
                if not await btn.is_visible(timeout=600):
                    continue
                txt_value = (await btn.inner_text()).strip()
                txt_lower = txt_value.lower()
                if any(
                    neg.lower() == txt_lower or txt_lower.startswith(neg.lower() + " ")
                    for neg in _CONSENT_NEGATIVE_TEXTS
                ):
                    continue
                prog(f"Click button: '{txt_value[:60]}' (target='{target_text}')")
                await btn.click()
                await page.wait_for_timeout(1500)
                clicked_any = True
                break
            except Exception:
                continue

        # 2. JS fallback (aggressive scan)
        if not clicked_any:
            try:
                res = await page.evaluate(
                    JS_CLICK_BY_TEXT,
                    {"texts": _CONSENT_TEXTS, "negativeTexts": _CONSENT_NEGATIVE_TEXTS},
                )
                if res and res.get("clicked"):
                    prog(
                        f"Click JS: '{res.get('txt')}' "
                        f"(matched='{res.get('matched')}' pass={res.get('pass')})"
                    )
                    await page.wait_for_timeout(1500)
                    clicked_any = True
            except Exception as e:
                prog(f"JS click error: {e}")

        if not clicked_any:
            await asyncio.sleep(1.5)

    prog("Timeout waiting for callback URL")
    return None


# ─── Main login flow ────────────────────────────────────────────────────────
async def do_login(page, state: str, code_verifier: str, auth_url: str, redirect_uri: str) -> None:
    # Fresh session — Google sometimes shows different consent based on session state
    await page.context.clear_cookies()
    try:
        await page.context.clear_permissions()
    except Exception:
        pass

    prog("Navigating to Google OAuth URL...")
    await page.goto(auth_url, timeout=45000, wait_until="domcontentloaded")
    await page.wait_for_timeout(2000)

    # Fill Google credentials
    if not await fill_google_credentials(page):
        return

    # Handle consent + capture callback URL
    callback_url = await handle_consent_until_callback(page, ARGS.redirect_port)
    if not callback_url:
        err("Did not reach callback URL within 120s")
        return

    # Parse callback URL
    parsed = urlparse(callback_url)
    qs = parse_qs(parsed.query)
    code = qs.get("code", [None])[0]
    received_state = qs.get("state", [None])[0]
    error_param = qs.get("error", [None])[0]
    error_desc = qs.get("error_description", [None])[0]

    if error_param:
        err(f"OAuth error: {error_param} — {error_desc}")
        return

    if not code:
        err(f"No 'code' parameter in callback URL: {callback_url[:200]}")
        return

    if received_state != state:
        # Warning but don't fail — sidecar will re-validate
        prog(f"WARN state mismatch: sent={state[:12]} received={(received_state or '')[:12]}")

    payload = {
        "email": EMAIL,
        "code": code,
        "state": received_state or state,
        "code_verifier": code_verifier,
        "redirect_uri": redirect_uri,
        "callback_url": callback_url,
    }
    done(json.dumps(payload))


async def main() -> None:
    try:
        from camoufox.async_api import AsyncCamoufox  # type: ignore
    except ImportError:
        emit_final_error(
            "camoufox not installed. "
            "Install with: pip install 'camoufox[geoip]' && python -m camoufox fetch"
        )
        return

    redirect_uri = f"http://localhost:{ARGS.redirect_port}/callback"

    # Memory-efficient prefs for slim VPS
    memory_prefs = {
        "browser.cache.memory.capacity": 65536,
        "browser.cache.disk.enable": False,
        "browser.sessionhistory.max_total_viewers": 1,
        "image.mem.decode_bytes_at_a_time": 4096,
        "media.cache_size": 0,
        "browser.tabs.remote.warmup.enabled": False,
    }

    max_attempts = max(1, ARGS.retries)
    last_error = "unknown"

    for attempt in range(1, max_attempts + 1):
        _RESULT_STATE["done"] = False
        _RESULT_STATE["last_error"] = ""

        if attempt > 1:
            backoff = 3 * (attempt - 1)
            prog(f"Retry {attempt}/{max_attempts} after {backoff}s...")
            await asyncio.sleep(backoff)
        else:
            prog(f"Attempt {attempt}/{max_attempts}: fetching /authorize...")

        # Step 1: Get auth data from router (per-attempt because state may need refresh)
        auth_data = await get_auth_data(redirect_uri)
        if auth_data and auth_data.get("authUrl"):
            auth_url = auth_data["authUrl"]
            state = auth_data.get("state", "")
            code_verifier = auth_data.get("codeVerifier", "")
            prog(f"authData OK: state={state[:12]}... codeVerifier={'yes' if code_verifier else 'no'}")
        else:
            # Manual fallback — exchange may fail without server-side state validation
            import secrets

            state = secrets.token_urlsafe(32)
            code_verifier = ""
            auth_url = build_auth_url_manual(redirect_uri, state)
            prog(f"Manual auth URL fallback (state={state[:12]}...) — /exchange may fail")

        prog(f"Launching Camoufox (headless={HEADLESS})...")
        proxy_arg = {"server": PROXY} if PROXY else None

        try:
            async with AsyncCamoufox(
                headless=HEADLESS,
                geoip=ARGS.geoip,
                proxy=proxy_arg,
                firefox_user_prefs=memory_prefs,
            ) as browser:
                page = await browser.new_page()
                await do_login(page, state, code_verifier, auth_url, redirect_uri)
        except Exception as e:
            _RESULT_STATE["last_error"] = f"Camoufox error: {e}"
            prog(f"attempt {attempt} crashed: {e}")

        if _RESULT_STATE["done"]:
            return

        last_error = _RESULT_STATE["last_error"] or "no callback"
        if attempt < max_attempts:
            prog(f"Attempt {attempt} failed ({last_error}); retrying...")

    emit_final_error(f"All {max_attempts} attempts failed. Last error: {last_error}")


if __name__ == "__main__":
    asyncio.run(main())
