#!/usr/bin/env python3
"""
POC: Automated Gemini CLI (Google Cloud Code Assist) OAuth login.

Goal: verify these risk points BEFORE building full bulk system:
  R1. Google consent screen for cloud-platform scope (button labels & flow)
  R2. loadCodeAssist API auto-provisions projectId (or returns 403)
  R3. Callback URL interception at localhost:20128 (port not listening)
  R4. Exchange API end-to-end save into 9router DB

Usage:
    python3 poc_gemini.py --email <gmail> --password <pwd> [--router-url ...] [--cli-token ...]

Output (verbose for debugging):
    PROGRESS:<msg>                Each step + URL transitions
    SCREENSHOT:<path>             Saved after each consent screen
    CALLBACK_URL:<full_url>       Captured callback URL with ?code=...
    EXCHANGE_RESPONSE:<json>      Response from POST /exchange
    DONE:<json>                   Full success payload (connection_id, projectId, etc.)
    ERROR:<msg>                   Failure with context
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
from urllib.parse import urlparse, parse_qs


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="POC Gemini CLI Google OAuth login")
    p.add_argument("--email", required=True, help="Gmail address")
    p.add_argument("--password", required=True, help="Gmail password")
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
        help="Callback redirect port (default 20128 — matches 9router UI)",
    )
    p.add_argument("--headless", action="store_true", help="Run browser headless (NOT recommended for POC)")
    p.add_argument("--proxy", default=None, help="Optional proxy URL")
    p.add_argument(
        "--screenshot-dir",
        default=str(Path.home() / ".kiro-bulk" / "poc-gemini-screenshots"),
        help="Directory to save consent screen screenshots",
    )
    p.add_argument(
        "--save-to-router",
        action="store_true",
        help="Actually call /exchange endpoint to save connection (default: dry-run, only print code)",
    )
    return p.parse_args()


ARGS = parse_args()


def prog(msg: str) -> None:
    print(f"PROGRESS:{msg}", flush=True)


def emit(tag: str, payload: str) -> None:
    print(f"{tag}:{payload}", flush=True)


def err(msg: str) -> None:
    print(f"ERROR:{msg}", flush=True)
    sys.exit(1)


# ──────────────────────────────────────────────────────────────────────────────
# Step 1: Get auth URL from 9router (or fallback to building manually)
# ──────────────────────────────────────────────────────────────────────────────
async def get_auth_data(redirect_uri: str) -> dict:
    """Call 9router /api/oauth/gemini-cli/authorize to get authUrl + state + codeVerifier."""
    try:
        import aiohttp  # type: ignore
    except ImportError:
        err("aiohttp not installed. Run: pip install aiohttp")
        return {}

    headers = {"Accept": "application/json"}
    if ARGS.cli_token:
        headers["x-9r-cli-token"] = ARGS.cli_token

    url = f"{ARGS.router_url.rstrip('/')}/api/oauth/gemini-cli/authorize"
    params = {"redirect_uri": redirect_uri}

    prog(f"GET {url}?redirect_uri={redirect_uri}")
    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            text = await resp.text()
            if resp.status != 200:
                prog(f"router responded {resp.status}: {text[:200]}")
                # Fallback to manual build
                return None
            data = json.loads(text)
            prog(
                f"authData: state={data.get('state','')[:12]}... "
                f"codeVerifier={'(yes)' if data.get('codeVerifier') else '(no)'} "
                f"flowType={data.get('flowType')}"
            )
            return data


def build_auth_url_manual(redirect_uri: str, state: str) -> str:
    """Fallback: build authorize URL using hardcoded GEMINI_CONFIG."""
    from urllib.parse import urlencode

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


# ──────────────────────────────────────────────────────────────────────────────
# Step 2: Google login + consent screen handling
# ──────────────────────────────────────────────────────────────────────────────
async def fill_google_credentials(page) -> bool:
    prog("Filling Google email...")
    try:
        await page.wait_for_selector('input[type="email"]', timeout=45000)
        await page.fill('input[type="email"]', ARGS.email)
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(3000)
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=10000)
        except Exception:
            pass
    except Exception as e:
        prog(f"Email input not found: {e}")
        return False

    prog("Filling Google password...")
    for sel in [
        'input[type="password"]:not([aria-hidden="true"])',
        'input[type="password"][aria-hidden="false"]',
        'input[name="Passwd"]',
        'input[name="password"]',
        'input[type="password"]',
    ]:
        try:
            await page.wait_for_selector(sel, state="visible", timeout=12000)
            await page.fill(sel, ARGS.password)
            await page.keyboard.press("Enter")
            return True
        except Exception:
            continue
    prog(f"Password field not found (url={page.url[:80]})")
    return False


# Consent screen button texts (Indonesian + English + common variants)
# IMPORTANT: order matters for fallback chain. "Sign in" added for the
# "Make sure that you downloaded this app from Google" security warning
# that appears for returning users.
_CONSENT_TEXTS = [
    # English — common consent flow
    "Continue",
    "Allow",
    "Allow access",
    "Accept",
    "Agree and continue",
    "I agree",
    "I understand",
    "Got it",
    # Google "trust this app" warning (returning users)
    "Sign in",  # ← "Make sure that you downloaded this app from Google" page
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
    "Masuk",  # Indonesian for "Sign in"
    # Misc
    "Next",
    "Confirm",
    "Yes",
    "OK",
]

# Negative match list — text that should NEVER be clicked (e.g. Cancel button
# is next to "Sign in" on the trust warning page). We filter these out.
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

        // PASS 1: exact match (priority)
        const seen = new Set();
        for (const sel of sels) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                if (seen.has(el)) continue;
                seen.add(el);
                const txt = norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '');
                if (!txt) continue;
                // SKIP if matches any negative text (Cancel, etc.)
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

        // PASS 2: substring match (fallback, still skip negatives)
        const seen2 = new Set();
        for (const sel of sels) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
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


async def take_screenshot(page, name: str, screenshot_dir: Path) -> None:
    """Save screenshot to screenshot_dir with timestamp prefix for ordering."""
    try:
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%H%M%S")
        safe_email = re.sub(r"[^\w.@-]", "_", ARGS.email)
        path = screenshot_dir / f"{ts}_{safe_email}_{name}.png"
        await page.screenshot(path=str(path), full_page=False)
        emit("SCREENSHOT", str(path))
    except Exception as e:
        prog(f"Screenshot failed ({name}): {e}")


async def handle_consent_screens(page, redirect_port: int, screenshot_dir: Path) -> Optional[str]:
    """Loop through consent screens until URL contains localhost:{port}/callback.

    Returns the full callback URL on success, None on timeout.
    """
    prog("Watching for consent screens + redirect...")
    deadline = asyncio.get_event_loop().time() + 120  # 2 min for slow networks
    last_url = ""
    screenshot_count = 0

    while asyncio.get_event_loop().time() < deadline:
        try:
            current_url = page.url
        except Exception:
            prog("Page closed unexpectedly")
            return None

        # Check for callback URL hit (might error because port not listening, but URL is set)
        if f"localhost:{redirect_port}" in current_url or "127.0.0.1:" in current_url:
            prog(f"CALLBACK URL HIT: {current_url[:120]}")
            return current_url

        # Log URL transitions
        if current_url != last_url:
            prog(f"URL: {current_url[:100]}")
            last_url = current_url

            # Screenshot whenever URL changes (capture each consent step)
            if "accounts.google" in current_url or "google.com/oauth" in current_url or "gsi" in current_url:
                screenshot_count += 1
                await take_screenshot(page, f"step{screenshot_count}_consent", screenshot_dir)

        # If we left Google domain entirely, but didn't see callback yet, something happened
        if (
            current_url
            and "accounts.google" not in current_url
            and "google.com/o/oauth" not in current_url
            and f"localhost:{redirect_port}" not in current_url
            and "127.0.0.1" not in current_url
            and current_url != "about:blank"
        ):
            prog(f"Unexpected URL (not Google, not callback): {current_url[:120]}")

        # Try clicking consent buttons
        clicked_any = False

        # 1. Playwright selector approach — check candidates one-by-one,
        # validate they're NOT a negative text (Cancel etc.) before clicking.
        for target_text in _CONSENT_TEXTS:
            try:
                # Build selector that excludes negatives via :not()
                btn = page.locator(f"button:has-text('{target_text}')").first
                if not await btn.is_visible(timeout=600):
                    continue
                txt_value = (await btn.inner_text()).strip()
                txt_lower = txt_value.lower()
                # Skip if matches any negative
                if any(neg.lower() == txt_lower or txt_lower.startswith(neg.lower() + " ")
                       for neg in _CONSENT_NEGATIVE_TEXTS):
                    continue
                prog(f"Clicking button via selector: '{txt_value[:60]}' (target='{target_text}')")
                await btn.click()
                await page.wait_for_timeout(1500)
                clicked_any = True
                break
            except Exception:
                continue

        # 2. JS fallback — aggressive scan with negative filtering
        if not clicked_any:
            try:
                res = await page.evaluate(
                    JS_CLICK_BY_TEXT,
                    {"texts": _CONSENT_TEXTS, "negativeTexts": _CONSENT_NEGATIVE_TEXTS},
                )
                if res and res.get("clicked"):
                    prog(
                        f"Clicked via JS: '{res.get('txt')}' "
                        f"(matched='{res.get('matched')}' pass={res.get('pass')})"
                    )
                    await page.wait_for_timeout(1500)
                    clicked_any = True
            except Exception as e:
                prog(f"JS click error: {e}")

        if not clicked_any:
            await asyncio.sleep(1.5)

    prog("Timeout waiting for callback URL")
    await take_screenshot(page, "timeout_final", screenshot_dir)
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Step 3: Exchange code → tokens via 9router API
# ──────────────────────────────────────────────────────────────────────────────
async def exchange_code(
    code: str, state: str, code_verifier: str, redirect_uri: str
) -> dict:
    """Call POST /api/oauth/gemini-cli/exchange to save connection in 9router."""
    try:
        import aiohttp  # type: ignore
    except ImportError:
        err("aiohttp not installed")
        return {}

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if ARGS.cli_token:
        headers["x-9r-cli-token"] = ARGS.cli_token

    url = f"{ARGS.router_url.rstrip('/')}/api/oauth/gemini-cli/exchange"
    body = {
        "code": code,
        "redirectUri": redirect_uri,
        "codeVerifier": code_verifier or "",
        "state": state,
    }
    prog(f"POST {url}")
    prog(f"body keys: {list(body.keys())}, code length: {len(code)}")

    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            text = await resp.text()
            try:
                data = json.loads(text)
            except Exception:
                data = {"raw": text}
            prog(f"exchange response: HTTP {resp.status}")
            return {"status": resp.status, "body": data}


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────
async def main() -> None:
    try:
        from camoufox.async_api import AsyncCamoufox  # type: ignore
    except ImportError:
        err("camoufox not installed. Run: pip install 'camoufox[geoip]' && python -m camoufox fetch")
        return

    screenshot_dir = Path(ARGS.screenshot_dir)
    redirect_uri = f"http://localhost:{ARGS.redirect_port}/callback"

    # Step 1: Get auth URL (try router first, fallback to manual)
    auth_data = None
    try:
        auth_data = await get_auth_data(redirect_uri)
    except Exception as e:
        prog(f"router authorize call failed: {e}")

    if auth_data and auth_data.get("authUrl"):
        auth_url = auth_data["authUrl"]
        state = auth_data.get("state", "")
        code_verifier = auth_data.get("codeVerifier", "")
        prog("Using auth URL from 9router (will reuse state for /exchange)")
    else:
        # Manual fallback — won't be able to /exchange unless --save-to-router=false
        import secrets

        state = secrets.token_urlsafe(32)
        code_verifier = ""
        auth_url = build_auth_url_manual(redirect_uri, state)
        prog(f"Built auth URL manually (state={state[:12]}...) — /exchange may fail without server state")

    prog(f"authUrl: {auth_url[:140]}...")

    # Memory-efficient prefs for slim VPS
    memory_prefs = {
        "browser.cache.memory.capacity": 65536,
        "browser.cache.disk.enable": False,
        "browser.sessionhistory.max_total_viewers": 1,
        "image.mem.decode_bytes_at_a_time": 4096,
        "media.cache_size": 0,
    }

    proxy_arg = {"server": ARGS.proxy} if ARGS.proxy else None

    callback_url = None
    async with AsyncCamoufox(
        headless=ARGS.headless,
        proxy=proxy_arg,
        firefox_user_prefs=memory_prefs,
    ) as browser:
        page = await browser.new_page()

        # Navigate to Google OAuth directly (no intermediate provider page)
        prog("Navigating to Google OAuth authorize URL...")
        await page.goto(auth_url, timeout=45000, wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)

        await take_screenshot(page, "00_landed", screenshot_dir)

        # Fill credentials
        if not await fill_google_credentials(page):
            err("Failed to fill Google credentials — check screenshots & verify email/pwd")
            return

        await take_screenshot(page, "01_after_login", screenshot_dir)

        # Handle consent screens + capture callback URL
        callback_url = await handle_consent_screens(page, ARGS.redirect_port, screenshot_dir)

        if not callback_url:
            err("Did not reach callback URL — check screenshots & logs above")
            return

    # Step 2: Parse callback URL for code
    parsed = urlparse(callback_url)
    qs = parse_qs(parsed.query)
    code = qs.get("code", [None])[0]
    received_state = qs.get("state", [None])[0]
    error = qs.get("error", [None])[0]
    error_description = qs.get("error_description", [None])[0]

    emit("CALLBACK_URL", callback_url)

    if error:
        err(f"OAuth error: {error} — {error_description}")
        return

    if not code:
        err(f"No 'code' parameter in callback URL: {callback_url}")
        return

    prog(f"code received (length={len(code)}, prefix={code[:8]}...)")
    if received_state != state:
        prog(f"WARNING: state mismatch! sent={state[:12]} received={(received_state or '')[:12]}")

    # Step 3: Exchange code → tokens (optional)
    if ARGS.save_to_router:
        prog("Exchanging code for tokens (will save to 9router DB)...")
        result = await exchange_code(code, received_state or state, code_verifier, redirect_uri)
        emit("EXCHANGE_RESPONSE", json.dumps(result))

        if result["status"] == 200 and result["body"].get("success"):
            conn = result["body"].get("connection", {})
            payload = {
                "email": ARGS.email,
                "connection_id": conn.get("id"),
                "provider": conn.get("provider"),
                "connection_email": conn.get("email"),
                "display_name": conn.get("displayName"),
            }
            emit("DONE", json.dumps(payload))
        else:
            err(f"Exchange failed: HTTP {result['status']} — {json.dumps(result['body'])[:300]}")
    else:
        # Dry-run: just report we got the code
        prog("DRY-RUN mode — pass --save-to-router to actually create connection")
        emit("DONE", json.dumps({
            "email": ARGS.email,
            "code_received": True,
            "code_length": len(code),
            "state_match": received_state == state,
            "callback_url": callback_url,
        }))


if __name__ == "__main__":
    asyncio.run(main())
