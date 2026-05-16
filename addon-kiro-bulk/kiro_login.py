#!/usr/bin/env python3
"""
Automated Google OAuth login for app.kiro.dev.

Adapted from moclaw_login.py (exoai) — same Camoufox-based flow, but:
  * Targets https://app.kiro.dev/ (AWS Builder ID / Identity Center).
  * Refresh tokens start with "aorAAAAAG" — extracted from localStorage,
    Cookies, or IndexedDB via a generic scan.
  * Optional proxy support (--proxy http://user:pass@host:port).
  * Optional headless toggle (--headless).

Usage:
    python3 kiro_login.py --email <gmail> --password <pwd> [--headless] [--proxy URL]

Stdout protocol (same as moclaw — biar gampang di-wrap jadi HTTP service nanti):
    PROGRESS:<msg>         status update
    DONE:<json>            success — json has access_token, refresh_token, expires_in, email, profile_arn
    ERROR:<msg>            terminal error after retries exhausted
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

# --------- CLI args ---------------------------------------------------------
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Kiro Google-OAuth bulk login helper")
    p.add_argument("--email", required=True, help="Gmail address")
    p.add_argument("--password", required=True, help="Gmail password")
    p.add_argument("--headless", action="store_true", help="Run browser headless (default: headed)")
    p.add_argument("--proxy", default=None, help="HTTP/HTTPS/SOCKS5 proxy URL (optional)")
    p.add_argument("--retries", type=int, default=3, help="Max attempts (default 3)")
    p.add_argument("--geoip", action="store_true", help="Enable MaxMind GeoIP in Camoufox")
    p.add_argument(
        "--session-dir",
        default=str(Path.home() / ".kiro-bulk" / "sessions"),
        help="Where to dump cookies + localStorage snapshot",
    )
    return p.parse_args()


ARGS = parse_args()
EMAIL    = ARGS.email
PASSWORD = ARGS.password
HEADLESS = ARGS.headless
PROXY    = ARGS.proxy

# --------- stdout protocol --------------------------------------------------
_RESULT_STATE = {"done": False, "last_error": ""}

def prog(msg: str) -> None:
    print(f"PROGRESS:{msg}", flush=True)

def done(payload_json: str) -> None:
    _RESULT_STATE["done"] = True
    print(f"DONE:{payload_json}", flush=True)

def err(msg: str) -> None:
    # Don't terminate yet — main() may retry. Final ERROR: printed in main().
    _RESULT_STATE["last_error"] = msg
    print(f"PROGRESS:attempt failed: {msg}", flush=True)

def emit_final_error(msg: str) -> None:
    print(f"ERROR:{msg}", flush=True)


# --------- token extraction --------------------------------------------------
# Kiro refresh tokens issued by AWS Builder ID start with "aorAAAAAG".
# We scan localStorage, sessionStorage, and cookies — no single fixed key
# because AWS SDK stores under varying namespaces (depends on SDK version).
KIRO_TOKEN_PREFIX = "aorAAAAAG"

EXTRACT_JS = r"""
() => {
    const out = {
        refresh_token: null,
        access_token: null,
        id_token: null,
        expires_in: null,
        email: null,
        profile_arn: null,
        source: null,
        raw_keys: []
    };

    const TOKEN_PREFIX = "aorAAAAAG";

    function scanString(s, source, key) {
        if (!s || typeof s !== 'string') return false;
        // Direct match — value itself is the refresh token
        if (s.startsWith(TOKEN_PREFIX)) {
            if (!out.refresh_token) {
                out.refresh_token = s;
                out.source = `${source}:${key}`;
                return true;
            }
        }
        // Embedded inside a longer string (e.g., JSON)
        const m = s.match(/aorAAAAAG[A-Za-z0-9_-]+/);
        if (m && !out.refresh_token) {
            out.refresh_token = m[0];
            out.source = `${source}:${key}:embedded`;
            return true;
        }
        return false;
    }

    function scanObject(obj, source, parentKey) {
        if (!obj || typeof obj !== 'object') return;
        for (const k of Object.keys(obj)) {
            const v = obj[k];
            const keyPath = parentKey ? `${parentKey}.${k}` : k;
            if (typeof v === 'string') {
                // Likely fields
                if (/refresh/i.test(k) && v.startsWith(TOKEN_PREFIX)) {
                    out.refresh_token = v;
                    out.source = `${source}:${keyPath}`;
                }
                if (/access/i.test(k) && v.length > 30 && !out.access_token) {
                    out.access_token = v;
                }
                if (/^id_?token$/i.test(k) && !out.id_token) {
                    out.id_token = v;
                }
                if (/expires_?in/i.test(k) && !out.expires_in) {
                    const n = parseInt(v, 10);
                    if (!isNaN(n)) out.expires_in = n;
                }
                if (/email/i.test(k) && /@/.test(v) && !out.email) {
                    out.email = v;
                }
                if (/profile_?arn|profileArn/i.test(k) && !out.profile_arn) {
                    out.profile_arn = v;
                }
                scanString(v, source, keyPath);
            } else if (typeof v === 'number' && /expires_?in/i.test(k) && !out.expires_in) {
                out.expires_in = v;
            } else if (v && typeof v === 'object') {
                scanObject(v, source, keyPath);
            }
        }
    }

    // ── localStorage ────────────────────────────────────────────────────────
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            const v = localStorage.getItem(k);
            out.raw_keys.push(`ls:${k}`);
            if (v) {
                try {
                    const parsed = JSON.parse(v);
                    scanObject(parsed, "localStorage", k);
                } catch (_e) {
                    scanString(v, "localStorage", k);
                }
            }
        }
    } catch (_e) {}

    // ── sessionStorage ──────────────────────────────────────────────────────
    try {
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            const v = sessionStorage.getItem(k);
            out.raw_keys.push(`ss:${k}`);
            if (v) {
                try {
                    const parsed = JSON.parse(v);
                    scanObject(parsed, "sessionStorage", k);
                } catch (_e) {
                    scanString(v, "sessionStorage", k);
                }
            }
        }
    } catch (_e) {}

    // ── document.cookie (limited — non-HttpOnly only) ───────────────────────
    try {
        const cookies = document.cookie.split(';');
        for (const c of cookies) {
            const [k, ...rest] = c.split('=');
            const v = decodeURIComponent(rest.join('='));
            out.raw_keys.push(`cookie:${k.trim()}`);
            scanString(v, "cookie", k.trim());
        }
    } catch (_e) {}

    return out.refresh_token ? JSON.stringify(out) : null;
}
"""


async def extract_from_cookies(page) -> dict | None:
    """Scan Playwright cookies (sees HttpOnly!) for Kiro refresh token.

    Kiro store RefreshToken di cookie dengan HttpOnly=true → JS gak bisa baca,
    HARUS via Playwright API.

    Returns dict with refresh_token (+ optional user_id, idp, email) atau None.
    """
    try:
        cookies = await page.context.cookies()
    except Exception:
        return None

    payload: dict = {}
    for c in cookies:
        name = c.get("name", "") or ""
        value = c.get("value", "") or ""

        # Primary target: RefreshToken cookie dengan prefix aorAAAAAG
        if name == "RefreshToken" and value.startswith(KIRO_TOKEN_PREFIX):
            payload["refresh_token"] = value
            payload["source"] = f"cookie:{name}"
            payload["cookie_domain"] = c.get("domain", "")
        # Fallback: any cookie value yg dimulai dengan prefix Kiro
        elif value.startswith(KIRO_TOKEN_PREFIX) and "refresh_token" not in payload:
            payload["refresh_token"] = value
            payload["source"] = f"cookie:{name}"

        # Enrich dengan metadata kalau ketemu
        if name == "UserId":
            payload["user_id"] = value
        elif name == "Idp":
            payload["idp"] = value  # mis. "Google"

    return payload if "refresh_token" in payload else None


async def poll_tokens(page, tries: int = 60) -> str | None:
    """Poll cookies + storage every second sampai refresh token muncul.

    Priority order:
      1. Playwright cookies API (bisa lihat HttpOnly cookies) ← Kiro nyimpen di sini
      2. JS localStorage/sessionStorage/document.cookie (fallback)
    """
    for i in range(tries):
        # 1. Cek cookies via Playwright API dulu (HttpOnly aware)
        cookie_result = await extract_from_cookies(page)
        if cookie_result:
            return json.dumps(cookie_result)

        # 2. Fallback: scan storage via JS
        result = await page.evaluate(EXTRACT_JS)
        if result and result != "null":
            return result

        if i == 10:
            prog("Still waiting for token to appear in cookies/storage...")
        if i == 30:
            prog("Token taking longer than expected — Kiro might still be issuing it")
        await asyncio.sleep(1)
    return None


# --------- Google login helpers (copied from moclaw_login.py) ---------------
_GOOGLE_SELECTORS = [
    "text=Continue with Google",
    "text=Sign in with Google",
    "button:has-text('Google')",
    "a:has-text('Google')",
    "[data-provider='google']",
    "[data-connection='google']",
    "[data-action='google']",
    "[data-provider='google-oauth2']",
    "[data-connection='google-oauth2']",
    "button:has-text('google')",
    "a[href*='google']",
    ".social-button.google",
    "[class*='google']",
    "form[data-provider='google-oauth2'] button",
]

_UNDERSTAND_TEXTS = [
    "I understand",
    "Saya mengerti",
    "Saya faham",
    "Je comprends",
    "Ich verstehe",
    "Entendido",
    "Ho capito",
]

_CONTINUE_TEXTS = [
    "Continue",
    "Lanjutkan",
    "Teruskan",
    "Continuer",
    "Weiter",
    "Continuar",
    "Continua",
]


async def fill_google_credentials(login_page) -> bool:
    prog("Entering Google email...")
    try:
        await login_page.wait_for_selector('input[type="email"]', timeout=45000)
        await login_page.fill('input[type="email"]', EMAIL)
        await login_page.keyboard.press("Enter")
        await login_page.wait_for_timeout(3000)
        try:
            await login_page.wait_for_load_state("domcontentloaded", timeout=10000)
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
            await login_page.wait_for_selector(pwd_sel, state="visible", timeout=12000)
            await login_page.fill(pwd_sel, PASSWORD)
            await login_page.keyboard.press("Enter")
            pwd_filled = True
            break
        except Exception:
            continue
    if not pwd_filled:
        try:
            cur = login_page.url
        except Exception:
            cur = "unknown"
        err(f"Password field not found (url={cur[:80]}) — verify screen or wrong credentials?")
        return False
    return True


# --------- main login flow --------------------------------------------------
async def do_login(page) -> None:
    # Fresh session every attempt → ensures a new refresh_token is issued.
    await page.context.clear_cookies()
    try:
        await page.context.clear_permissions()
    except Exception:
        pass

    prog("Navigating to app.kiro.dev...")
    await page.goto("https://app.kiro.dev/", timeout=30000, wait_until="domcontentloaded")
    await page.wait_for_timeout(2500)

    # Klik tombol "Sign in" / "Get Started" kalau ada di landing page Kiro.
    prog("Looking for sign-in entry point...")
    clicked = False
    for selector in [
        "a:has-text('Sign in')",
        "button:has-text('Sign in')",
        "a:has-text('Sign In')",
        "button:has-text('Sign In')",
        "a:has-text('Get Started')",
        "button:has-text('Get Started')",
        "a:has-text('Log in')",
        "button:has-text('Log in')",
        "text=Sign in",
    ]:
        try:
            await page.locator(selector).first.click(timeout=4000)
            clicked = True
            break
        except Exception:
            continue
    if not clicked:
        prog("No sign-in button found on landing — assuming auth page is direct")
    await page.wait_for_timeout(1500)

    # Klik tombol Google (di AWS Builder ID page)
    prog("Clicking 'Continue with Google'...")

    # Kalau udah di Builder ID page, kasih waktu render
    try:
        cur_url = page.url
    except Exception:
        cur_url = ""
    if "amazonaws.com" in cur_url or "kiro.dev" not in cur_url or "auth" in cur_url.lower():
        prog(f"On auth page ({cur_url[:60]}...) — waiting for social buttons...")
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await page.wait_for_timeout(2000)

    google_clicked = False
    for selector in _GOOGLE_SELECTORS:
        try:
            await page.locator(selector).first.click(timeout=4000)
            google_clicked = True
            break
        except Exception:
            continue

    if not google_clicked:
        # JS fallback — klik elemen apapun yang mention "google"
        try:
            await page.evaluate(r"""
                () => {
                    const els = document.querySelectorAll('button, a, [role="button"]');
                    for (const el of els) {
                        if ((el.textContent || '').toLowerCase().includes('google') ||
                            (el.className  || '').toLowerCase().includes('google') ||
                            (el.getAttribute('data-provider') || '').includes('google')) {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                }
            """)
            prog("Clicked Google button via JS fallback")
        except Exception:
            prog("WARNING: Could not find Google login button")

    await page.wait_for_timeout(3000)
    login_page = page
    for p in page.context.pages:
        try:
            if "accounts.google" in p.url or "google.com/o/oauth2" in p.url:
                await p.wait_for_load_state("domcontentloaded", timeout=5000)
                login_page = p
                prog(f"Google login page: {p.url[:60]}")
                break
        except Exception:
            continue
    if login_page is page:
        prog("Google login flow in same tab")

    if not await fill_google_credentials(login_page):
        return

    # Handle interstitials: "I understand" + "Continue" consent
    # Google bisa pake <button>, <div role="button">, atau <input type="submit">.
    # Plus button-nya mungkin di-wrap dalam container yg bikin :has-text() susah match.
    # Strategy: coba Playwright selector → JS fallback aggressive scan.
    prog("Handling Google post-login screens...")
    deadline = asyncio.get_event_loop().time() + 90  # bumped 40→90s untuk slow networks

    # Helper: aggressive JS click — scan SEMUA elemen interactive
    JS_CLICK_BY_TEXT = r"""
        (texts) => {
            const norm = s => (s || '').trim().toLowerCase();
            const targets = texts.map(norm);
            const sels = [
                'button',
                '[role="button"]',
                'a',
                'input[type="submit"]',
                'input[type="button"]',
                'div[jsaction]',  // Google often uses div with jsaction
                'span[role="button"]',
            ];
            const seen = new Set();
            for (const sel of sels) {
                const els = document.querySelectorAll(sel);
                for (const el of els) {
                    if (seen.has(el)) continue;
                    seen.add(el);
                    // Get text from element or its value attr
                    const txt = norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '');
                    if (!txt) continue;
                    for (const target of targets) {
                        if (txt === target || txt.includes(target)) {
                            const rect = el.getBoundingClientRect();
                            if (rect.width > 5 && rect.height > 5) {
                                try {
                                    el.click();
                                    return { clicked: true, matched: target, tag: el.tagName, txt: txt.slice(0, 60) };
                                } catch (_) {}
                            }
                        }
                    }
                }
            }
            return { clicked: false };
        }
    """

    last_url = ""
    while asyncio.get_event_loop().time() < deadline:
        try:
            current_url = login_page.url
        except Exception:
            break
        if current_url != last_url:
            prog(f"Interstitial URL: {current_url[:80]}")
            last_url = current_url

        if "accounts.google" not in current_url and "google.com" not in current_url:
            prog("Left Google domain — interstitials done")
            break

        clicked_any = False

        # 1. Try Playwright selectors (button-only) for both "I understand" and "Continue"
        for texts, label in [(_UNDERSTAND_TEXTS, "I understand"), (_CONTINUE_TEXTS, "Continue")]:
            sel = ", ".join(f"button:has-text('{t}')" for t in texts)
            try:
                btn = login_page.locator(sel).first
                if await btn.is_visible(timeout=1500):
                    prog(f"Clicking '{label}' (button selector)...")
                    await btn.click()
                    await login_page.wait_for_timeout(1500)
                    clicked_any = True
                    break
            except Exception:
                pass

        # 2. JS fallback — scan SEMUA element interactive, klik yang text-nya match
        if not clicked_any:
            for texts, label in [(_UNDERSTAND_TEXTS, "I understand"), (_CONTINUE_TEXTS, "Continue")]:
                try:
                    res = await login_page.evaluate(JS_CLICK_BY_TEXT, texts)
                    if res and res.get("clicked"):
                        prog(f"Clicking '{label}' via JS fallback (matched='{res.get('matched')}' tag={res.get('tag')})")
                        await login_page.wait_for_timeout(1500)
                        clicked_any = True
                        break
                except Exception:
                    pass

        if not clicked_any:
            await asyncio.sleep(1.5)

    # Wait for redirect back to kiro
    prog("Waiting for kiro.dev to load tokens...")
    try:
        await page.wait_for_url("*kiro.dev*", timeout=30000)
    except Exception:
        pass
    await page.wait_for_timeout(3000)

    # Extract tokens
    prog("Scanning storage for refresh token (prefix aorAAAAAG...)...")
    tokens = await poll_tokens(page)
    if not tokens:
        hint = " (try without --headless to handle 2FA / device verification)" if HEADLESS else ""
        # Dump cookies + storage keys for debugging — kalau ini muncul, kita
        # tau persis di mana Kiro nyimpen token-nya
        try:
            cookies = await page.context.cookies()
            cookie_info = []
            for c in cookies[:30]:
                nm = c.get("name", "?")
                val = (c.get("value", "") or "")[:50]
                dom = c.get("domain", "?")
                http_only = "H" if c.get("httpOnly") else "-"
                cookie_info.append(f"{dom}/{nm}({http_only})={val}")
            prog(f"DEBUG cookies: {cookie_info}")
        except Exception as e:
            prog(f"DEBUG cookies dump failed: {e}")
        try:
            keys = await page.evaluate(r"""
                () => {
                    const out = [];
                    for (let i=0; i<localStorage.length; i++) out.push('ls:' + localStorage.key(i));
                    for (let i=0; i<sessionStorage.length; i++) out.push('ss:' + sessionStorage.key(i));
                    return out;
                }
            """)
            prog(f"DEBUG storage keys: {keys[:20]}")
        except Exception:
            pass
        err(f"Login completed but refresh token not found in cookies/storage{hint}")
        return

    # Export session for later restore (cookies + localStorage)
    try:
        session_dir = Path(ARGS.session_dir)
        session_dir.mkdir(parents=True, exist_ok=True)
        safe_email = re.sub(r"[^\w.@-]", "_", EMAIL)
        cookies = await page.context.cookies()
        local_storage = await page.evaluate(r"""
            () => {
                const data = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    data[key] = localStorage.getItem(key);
                }
                return data;
            }
        """)
        session_data = {
            "email": EMAIL,
            "cookies": cookies,
            "localStorage": local_storage,
        }
        session_path = session_dir / f"{safe_email}.json"
        session_path.write_text(json.dumps(session_data, indent=2))
        prog(f"Session exported: {session_path} ({len(cookies)} cookies, {len(local_storage)} ls items)")
    except Exception as e:
        prog(f"Session export skipped: {e}")

    # Pastiin payload include email yang kita coba login (kalau gak ke-extract dari storage)
    try:
        payload = json.loads(tokens)
        if not payload.get("email"):
            payload["email"] = EMAIL
        # Default expires_in (AWS Builder ID default 12 jam access token)
        if not payload.get("expires_in"):
            payload["expires_in"] = 43200
        done(json.dumps(payload))
    except Exception:
        done(tokens)


async def main() -> None:
    try:
        from camoufox.async_api import AsyncCamoufox  # type: ignore
    except ImportError:
        emit_final_error(
            "camoufox not installed. "
            "Install with: pip install 'camoufox[geoip]' && python -m camoufox fetch"
        )
        return

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
            prog(f"Attempt {attempt}/{max_attempts}: launching Camoufox...")

        # Camoufox proxy spec: dict atau string. Untuk simpel pakai dict.
        proxy_arg = None
        if PROXY:
            proxy_arg = {"server": PROXY}
            prog(f"Using proxy: {PROXY[:30]}...")

        try:
            async with AsyncCamoufox(
                headless=HEADLESS,
                geoip=ARGS.geoip,
                proxy=proxy_arg,
            ) as browser:
                page = await browser.new_page()
                await do_login(page)
        except Exception as e:
            _RESULT_STATE["last_error"] = f"Camoufox error: {e}"
            prog(f"attempt {attempt} crashed: {e}")

        if _RESULT_STATE["done"]:
            return

        last_error = _RESULT_STATE["last_error"] or "no tokens"
        if attempt < max_attempts:
            prog(f"Attempt {attempt} failed ({last_error}); retrying...")

    emit_final_error(f"All {max_attempts} attempts failed. Last error: {last_error}")


if __name__ == "__main__":
    asyncio.run(main())
