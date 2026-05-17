#!/usr/bin/env python3
"""
Automated Google OAuth login → create OpenRouter API key.

Adapted from addon-kiro-bulk/kiro_login.py — same Camoufox pattern, beda alurnya:

  1. Buka https://openrouter.ai/sign-in
  2. Klik "Sign in with Google"
  3. Fill Google email + password (sama dengan moclaw/kiro flow)
  4. Handle Google interstitials ("I understand", "Continue")
  5. Setelah login, navigate ke https://openrouter.ai/workspaces/default/keys
  6. Klik "New key" button
  7. Fill "Name" input (mis. pakai email)
  8. Klik "Create"
  9. Extract API key dari modal hasil ("sk-or-v1-...")
  10. Return key via DONE: JSON

Stdout protocol (same as kiro_login.py):
  PROGRESS:<msg>
  DONE:<json>      contains api_key, email, source
  ERROR:<msg>

Usage:
  python3 openrouter_login.py --email GMAIL --password PASS [--headless] [--proxy URL]

Note: ini POC 1 akun. Bulk service (HTTP wrapper + UI) menyusul kalau POC sukses.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

# ─── CLI args ─────────────────────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="OpenRouter Google-OAuth + create API key helper")
    p.add_argument("--email", required=True, help="Gmail address")
    p.add_argument("--password", required=True, help="Gmail password")
    p.add_argument("--key-name", default=None, help="Name untuk API key (default: pakai email)")
    p.add_argument("--headless", action="store_true", help="Run browser headless (default: headed)")
    p.add_argument("--proxy", default=None, help="HTTP/HTTPS/SOCKS5 proxy URL")
    p.add_argument("--retries", type=int, default=1, help="Max attempts (default 1)")
    p.add_argument("--geoip", action="store_true", help="Enable MaxMind GeoIP in Camoufox")
    p.add_argument(
        "--session-dir",
        default=str(Path.home() / ".openrouter-bulk" / "sessions"),
        help="Where to dump cookies + localStorage snapshot",
    )
    # Anti-Captcha integration (untuk auto-solve Turnstile)
    p.add_argument(
        "--anticaptcha-key",
        default=os.environ.get("ANTICAPTCHA_KEY", ""),
        help="API key dari anti-captcha.com (atau env ANTICAPTCHA_KEY). "
             "Kalau di-set, Turnstile bakal di-solve otomatis via API ($0.002/solve).",
    )
    return p.parse_args()

ARGS = parse_args()
EMAIL = ARGS.email
PASSWORD = ARGS.password
KEY_NAME = ARGS.key_name or EMAIL
HEADLESS = ARGS.headless
PROXY = ARGS.proxy

# Print konfigurasi penting di awal biar gampang debug
print(f"PROGRESS:Config — email={EMAIL[:20]}..., headless={HEADLESS}", flush=True)
if ARGS.anticaptcha_key:
    print(f"PROGRESS:Config — Anti-Captcha API ENABLED (key {ARGS.anticaptcha_key[:8]}...)", flush=True)
else:
    print(f"PROGRESS:Config — Anti-Captcha NOT configured (set --anticaptcha-key atau ANTICAPTCHA_KEY env)", flush=True)
if PROXY:
    print(f"PROGRESS:Config — Proxy: {PROXY[:40]}...", flush=True)

# ─── stdout protocol ──────────────────────────────────────────────────────
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


# ─── Google OAuth selectors ────────────────────────────────────────────────
# OpenRouter pakai Clerk auth → class spesifik "cl-socialButtonsIconButton__google"
# Prioritas: Clerk-specific dulu, fallback ke generic
_GOOGLE_SELECTORS = [
    # Clerk-specific (paling reliable buat OpenRouter)
    "button.cl-socialButtonsIconButton__google",
    ".cl-socialButtonsIconButton__google",
    "[class*='cl-socialButtonsIconButton__google']",
    "button:has(img[alt='Sign in with Google'])",
    "button:has(img[alt*='Google'])",
    # Generic Google sign-in fallback
    "text=Continue with Google",
    "text=Sign in with Google",
    "button:has-text('Google')",
    "a:has-text('Google')",
    "[data-provider='google']",
    "[data-connection='google']",
    "[data-action='google']",
    "[data-provider='google-oauth2']",
    "button:has-text('google')",
    "a[href*='google']",
    ".social-button.google",
    "[class*='google']",
]

_UNDERSTAND_TEXTS = [
    "I understand", "Saya mengerti", "Saya faham",
    "Je comprends", "Ich verstehe", "Entendido", "Ho capito",
]

_CONTINUE_TEXTS = [
    "Continue", "Lanjutkan", "Teruskan",
    "Continuer", "Weiter", "Continuar", "Continua",
]


async def fill_google_credentials(login_page) -> bool:
    """Fill Google email + password (reused from kiro_login.py logic)."""
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
        err(f"Password field not found (url={cur[:80]})")
        return False
    return True


# ─── Google interstitials (reused) ─────────────────────────────────────────
JS_CLICK_BY_TEXT = r"""
    (texts) => {
        const norm = s => (s || '').trim().toLowerCase();
        const targets = texts.map(norm);
        const sels = [
            'button', '[role="button"]', 'a',
            'input[type="submit"]', 'input[type="button"]',
            'div[jsaction]', 'span[role="button"]',
        ];
        const seen = new Set();
        for (const sel of sels) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                if (seen.has(el)) continue;
                seen.add(el);
                const txt = norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '');
                if (!txt) continue;
                for (const target of targets) {
                    if (txt === target || txt.includes(target)) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 5 && rect.height > 5) {
                            try { el.click(); return { clicked: true, matched: target, tag: el.tagName, txt: txt.slice(0, 60) }; }
                            catch (_) {}
                        }
                    }
                }
            }
        }
        return { clicked: false };
    }
"""


async def handle_google_interstitials(login_page) -> None:
    """Handle 'I understand' + 'Continue' screens (reused dari kiro_login.py)."""
    prog("Handling Google post-login screens...")
    deadline = asyncio.get_event_loop().time() + 90
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


# ─── OpenRouter-specific: create API key flow ─────────────────────────────
KEYS_PAGE_URL = "https://openrouter.ai/workspaces/default/keys"
SIGNIN_URL = "https://openrouter.ai/sign-in"

# Hardcoded OpenRouter Turnstile sitekey — fallback kalau Clerk API fetch fail.
# Public info (visible di iframe URL pas Turnstile render).
# Source: GET https://clerk.openrouter.ai/v1/environment → display_config.captcha_public_key
# Update kalau OpenRouter migrate/rotate sitekey (jarang banget).
OPENROUTER_TURNSTILE_SITEKEY = "0x4AAAAAAAWXJGBD7bONzLBd"


async def handle_legal_consent(page, max_wait: int = 30) -> bool:
    """
    Detect & handle "Legal consent" dialog (muncul buat akun baru).

    Flow:
      1. Detect dialog via "I agree to the Terms of Service" text
      2. Click checkbox "I agree"
      3. Click Continue button
      4. Wait dialog hilang

    Returns True kalau berhasil pass (atau gak ada dialog), False kalau timeout.
    """
    prog("Checking for Legal Consent dialog...")
    deadline = asyncio.get_event_loop().time() + max_wait
    dialog_detected = False

    while asyncio.get_event_loop().time() < deadline:
        try:
            # Tighten detection — cek SPECIFIC marker biar gak false-positive
            # dari footer Terms/Privacy links yang ada di hampir semua halaman.
            has_legal = await page.evaluate(r"""
                () => {
                    // Strategy 1: heading dengan text "Legal consent" (paling spesifik)
                    const headings = document.querySelectorAll('h1, h2, h3, [role="heading"]');
                    for (const h of headings) {
                        const t = (h.textContent || '').toLowerCase().trim();
                        if (t === 'legal consent' || t.startsWith('legal consent')) return true;
                    }
                    // Strategy 2: text "I agree to the Terms" DAN ada visible checkbox
                    // (kombinasi minimal yang reliable identify dialog)
                    const txt = (document.body.innerText || '').toLowerCase();
                    const hasAgreeText = txt.includes('i agree to the terms');
                    if (hasAgreeText) {
                        const checkboxes = document.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
                        for (const cb of checkboxes) {
                            const rect = cb.getBoundingClientRect();
                            if (rect.width > 5 && rect.height > 5) return true;
                        }
                    }
                    // Strategy 3: text "please read and accept" (dari subtitle screenshot user)
                    if (txt.includes('please read and accept the terms to continue')) return true;
                    return false;
                }
            """)
        except Exception:
            has_legal = False

        if not has_legal:
            if dialog_detected:
                prog("✓ Legal consent dialog closed")
            else:
                prog("No legal consent dialog (akun lama / udah accept sebelumnya)")
            return True

        if not dialog_detected:
            prog("⚠ Legal consent dialog detected (akun baru)")
            dialog_detected = True

        # Centang checkbox "I agree"
        prog("Clicking 'I agree' checkbox...")
        checkbox_clicked = False
        for sel in [
            "input[type='checkbox']",
            "[role='checkbox']",
            "label:has-text('I agree') input",
            "label:has-text('agree')",
        ]:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=2000):
                    # Cek dulu udah ke-check apa belum
                    is_checked = False
                    try:
                        is_checked = await el.is_checked()
                    except Exception:
                        pass
                    if not is_checked:
                        await el.click()
                        prog(f"  Clicked checkbox via: {sel}")
                    else:
                        prog(f"  Checkbox already checked")
                    checkbox_clicked = True
                    break
            except Exception:
                continue

        if not checkbox_clicked:
            # JS fallback — click any unchecked checkbox
            try:
                res = await page.evaluate(r"""
                    () => {
                        const cbs = document.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
                        for (const cb of cbs) {
                            if (!cb.checked) {
                                cb.click();
                                return { clicked: true };
                            }
                        }
                        // Cari label yg berhubungan dengan "I agree"
                        const labels = document.querySelectorAll('label');
                        for (const l of labels) {
                            if ((l.textContent || '').toLowerCase().includes('agree')) {
                                l.click();
                                return { clicked: true, via: 'label' };
                            }
                        }
                        return { clicked: false };
                    }
                """)
                if res.get("clicked"):
                    prog(f"  Clicked checkbox via JS fallback ({res.get('via', 'cb')})")
                    checkbox_clicked = True
            except Exception:
                pass

        await page.wait_for_timeout(800)

        # Click Continue button
        prog("Clicking 'Continue' button...")
        continue_clicked = False
        for sel in [
            "button:has-text('Continue')",
            "button[type='submit']:has-text('Continue')",
            "button:has-text('Continue ▶')",
            "button:has-text('Agree and continue')",
        ]:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=2000):
                    await btn.click()
                    prog(f"  Clicked Continue via: {sel}")
                    continue_clicked = True
                    break
            except Exception:
                continue

        if not continue_clicked:
            # JS fallback — click any visible Continue/Agree button
            try:
                res = await page.evaluate(r"""
                    () => {
                        const btns = document.querySelectorAll('button, [role="button"]');
                        for (const b of btns) {
                            const t = (b.textContent || '').trim().toLowerCase();
                            if (t === 'continue' || t.startsWith('continue') ||
                                t === 'agree' || t === 'accept' ||
                                t === 'agree and continue') {
                                const rect = b.getBoundingClientRect();
                                if (rect.width > 5) {
                                    b.click();
                                    return { clicked: true, t: t.slice(0, 40) };
                                }
                            }
                        }
                        return { clicked: false };
                    }
                """)
                if res.get("clicked"):
                    prog(f"  Clicked Continue via JS fallback ('{res.get('t')}')")
                    continue_clicked = True
            except Exception:
                pass

        if not continue_clicked:
            prog("  WARN: Continue button not found")

        # Wait dialog disappear
        await page.wait_for_timeout(3000)

    if dialog_detected:
        prog(f"⚠ Legal consent dialog masih ada setelah {max_wait}s")
        return False
    return True


async def solve_turnstile_via_anticaptcha(page, api_key: str) -> bool:
    """
    Solve Cloudflare Turnstile via anti-captcha.com API.

    Flow:
      1. Extract sitekey dari iframe URL atau data-sitekey attribute
      2. POST createTask ke api.anti-captcha.com
      3. Poll getTaskResult sampai status=ready (10-60 detik)
      4. Receive token
      5. Inject token ke page (set input value + invoke callback)
      6. Wait verification complete

    Returns True kalau berhasil pass, False kalau gagal/timeout.

    Cost: ~$0.002 per solve (anti-captcha.com pricing).
    """
    try:
        import urllib.request
        import urllib.error
    except ImportError:
        prog("  urllib not available")
        return False

    prog("  → Anti-Captcha: extracting sitekey...")

    # ── PRIMARY: Fetch sitekey langsung dari Clerk environment endpoint ──
    # OpenRouter pakai Clerk yang load Turnstile dynamically.
    # Endpoint /v1/environment expose captcha_public_key di display_config.
    # Reliable banget — gak perlu nunggu DOM render.
    clerk_sitekey = None
    try:
        prog("  → Trying Clerk environment endpoint (primary)...")
        clerk_resp = await page.evaluate(r"""
            async () => {
                try {
                    const r = await fetch('https://clerk.openrouter.ai/v1/environment?_clerk_js_version=5.43.6', {
                        method: 'GET',
                        credentials: 'include',
                        headers: { 'Accept': 'application/json' },
                    });
                    if (!r.ok) return { ok: false, status: r.status };
                    const j = await r.json();
                    const dc = j.display_config || {};
                    return {
                        ok: true,
                        sitekey: dc.captcha_public_key || null,
                        provider: dc.captcha_provider || null,
                        widget_type: dc.captcha_widget_type || null,
                    };
                } catch (e) {
                    return { ok: false, error: String(e) };
                }
            }
        """)
        if clerk_resp.get("ok") and clerk_resp.get("sitekey"):
            clerk_sitekey = clerk_resp["sitekey"]
            prog(f"  ✓ Got sitekey from Clerk API: {clerk_sitekey[:25]}...")
            prog(f"    provider={clerk_resp.get('provider')}, widget={clerk_resp.get('widget_type')}")
        else:
            prog(f"  → Clerk env fetch returned: {clerk_resp}")
    except Exception as e:
        prog(f"  → Clerk env fetch error: {e}")

    # Final fallback: hardcoded OpenRouter sitekey (public info, jarang berubah)
    if not clerk_sitekey:
        clerk_sitekey = OPENROUTER_TURNSTILE_SITEKEY
        prog(f"  → Using hardcoded OpenRouter sitekey fallback: {clerk_sitekey[:25]}...")

    if clerk_sitekey:
        sitekey = clerk_sitekey
        sitekey_info = {"sitekey": sitekey, "src": "clerk-api-or-hardcoded", "debug": {"tried": ["clerk-api", "hardcoded"]}}
        debug_info = sitekey_info["debug"]
        page_url = page.url
        prog(f"  → Sitekey: {sitekey[:25]}...")
        prog(f"  → URL: {page_url[:60]}")
    else:
      # Fallback: wait iframe + DOM extraction
      prog("  → Fallback: waiting for Turnstile iframe to inject (max 15s)...")
      iframe_appeared = False
      for wait_attempt in range(30):  # 30 * 0.5s = 15s
        await asyncio.sleep(0.5)
        try:
            iframe_check = await page.evaluate(r"""
                () => {
                    const iframes = document.querySelectorAll('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]');
                    if (iframes.length > 0) {
                        return { has: true, src: iframes[0].src };
                    }
                    return { has: false };
                }
            """)
            if iframe_check.get("has"):
                iframe_appeared = True
                prog(f"  → Iframe appeared after {(wait_attempt + 1) * 0.5:.1f}s")
                prog(f"    src: {iframe_check.get('src', '?')[:120]}")
                break
        except Exception:
            pass

      if not iframe_appeared:
        prog("  ⚠ Turnstile iframe gak muncul dalam 15s")

      # DOM extraction strategies
      try:
        sitekey_info = await page.evaluate(r"""
            () => {
                const debug = { tried: [], found: null };

                // Strategy 1: any element dengan data-sitekey attribute
                const els = document.querySelectorAll('[data-sitekey]');
                debug.tried.push(`data-sitekey elements: ${els.length}`);
                for (const e of els) {
                    const sk = e.getAttribute('data-sitekey');
                    if (sk && sk.length > 10) {
                        return { sitekey: sk, src: 'data-sitekey-attr', debug };
                    }
                }

                // Strategy 2: iframe parsing — multiple URL patterns
                const iframes = document.querySelectorAll('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]');
                debug.tried.push(`iframes: ${iframes.length}`);
                for (const iframe of iframes) {
                    const src = iframe.src || '';
                    debug.tried.push(`iframe src: ${src.slice(0, 120)}`);

                    // Pattern A: sitekey sebagai query param
                    try {
                        const url = new URL(src);
                        for (const param of ['sitekey', 'k', 'cb', 'siteKey']) {
                            const sk = url.searchParams.get(param);
                            if (sk && sk.length > 10) {
                                return { sitekey: sk, src: `iframe-param-${param}`, debug };
                            }
                        }
                    } catch (_) {}

                    // Pattern B: path segment yang dimulai dengan 0x (Cloudflare sitekey format)
                    const m1 = src.match(/0x[A-Za-z0-9]{20,}/);
                    if (m1) {
                        return { sitekey: m1[0], src: 'iframe-path-0x', debug };
                    }

                    // Pattern C: cdn-cgi/challenge-platform/*/SITEKEY/*
                    const m2 = src.match(/challenge-platform\/[^/]+\/(?:[^/]+\/)?([A-Za-z0-9_-]{15,})\/(?:turnstile|managed|chl_api)/);
                    if (m2) {
                        return { sitekey: m2[1], src: 'iframe-path-cdn', debug };
                    }
                }

                // Strategy 3: window.turnstile internal state
                if (window.turnstile) {
                    if (window.turnstile._sitekey) {
                        return { sitekey: window.turnstile._sitekey, src: 'window.turnstile', debug };
                    }
                    // Try registered widgets
                    try {
                        const widgets = window.turnstile._widgets || {};
                        for (const id of Object.keys(widgets)) {
                            const w = widgets[id];
                            if (w && w.sitekey) {
                                return { sitekey: w.sitekey, src: `window.widget.${id}`, debug };
                            }
                        }
                    } catch (_) {}
                }

                // Strategy 4: scan script tags
                const scripts = document.querySelectorAll('script');
                debug.tried.push(`scripts: ${scripts.length}`);
                for (const s of scripts) {
                    const c = s.textContent || '';
                    const patterns = [
                        /sitekey['"]\s*:\s*['"]([^'"]+)['"]/,
                        /["']?sitekey["']?\s*[=:]\s*["']([^'"]+)/i,
                        /(0x[A-Za-z0-9]{20,})/,
                    ];
                    for (const p of patterns) {
                        const m = c.match(p);
                        if (m && m[1] && m[1].length > 10) {
                            return { sitekey: m[1], src: 'script-content', debug };
                        }
                    }
                }

                // Strategy 5: cek hidden input
                const inputs = document.querySelectorAll('input[name*="turnstile"], input[name*="cf-"]');
                for (const i of inputs) {
                    const sk = i.getAttribute('data-sitekey') || i.dataset?.sitekey;
                    if (sk) return { sitekey: sk, src: 'hidden-input', debug };
                }

                // Strategy 6: cek __NEXT_DATA__ (Next.js apps)
                try {
                    const next = document.querySelector('#__NEXT_DATA__');
                    if (next) {
                        const data = next.textContent;
                        const m = data.match(/sitekey['"]?\s*:\s*['"]([^'"]+)/);
                        if (m && m[1]) return { sitekey: m[1], src: 'next-data', debug };
                    }
                } catch (_) {}

                return { sitekey: null, debug };
            }
        """)
      except Exception as e:
        prog(f"  → DOM Sitekey extraction failed (JS error): {e}")
        return False

      sitekey = sitekey_info.get("sitekey")
      debug_info = sitekey_info.get("debug", {})

      # ALWAYS print debug info — krusial buat diagnose
      prog(f"  → DEBUG extraction attempts: {debug_info.get('tried', [])}")

      if not sitekey:
        prog("  → Sitekey NOT FOUND in DOM either")
        prog("  → Try: open DevTools → cari element <div data-sitekey=...> atau iframe[src*='cloudflare']")
        return False

      page_url = page.url
      prog(f"  → Sitekey: {sitekey[:20]}... (from {sitekey_info.get('src')})")
      prog(f"  → URL: {page_url[:60]}")

    # Step 2: Create task via API
    api_base = "https://api.anti-captcha.com"

    def api_post(endpoint: str, payload: dict, timeout: int = 30):
        """Synchronous urllib POST (jalan di event loop via run_in_executor)."""
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{api_base}/{endpoint}",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    create_payload = {
        "clientKey": api_key,
        "task": {
            "type": "TurnstileTaskProxyless",
            "websiteURL": page_url,
            "websiteKey": sitekey,
        }
    }

    prog("  → POST createTask...")
    try:
        loop = asyncio.get_event_loop()
        create_resp = await loop.run_in_executor(None, lambda: api_post("createTask", create_payload))
    except urllib.error.HTTPError as e:
        prog(f"  → Anti-Captcha HTTP error: {e.code} {e.reason}")
        return False
    except Exception as e:
        prog(f"  → Anti-Captcha createTask error: {e}")
        return False

    if create_resp.get("errorId") != 0:
        err_code = create_resp.get("errorCode", "?")
        err_desc = create_resp.get("errorDescription", "unknown")
        prog(f"  → Anti-Captcha API error: {err_code} — {err_desc}")
        return False

    task_id = create_resp.get("taskId")
    prog(f"  → Task created: {task_id}. Polling result...")

    # Step 3: Poll for solution
    solution_token = None
    for attempt in range(60):  # max 60 * 5s = 5 menit
        await asyncio.sleep(5)
        result_payload = {"clientKey": api_key, "taskId": task_id}
        try:
            result_resp = await loop.run_in_executor(None, lambda: api_post("getTaskResult", result_payload))
        except Exception as e:
            prog(f"  → getTaskResult error (attempt {attempt + 1}): {e}")
            continue

        if result_resp.get("errorId") != 0:
            prog(f"  → Task error: {result_resp.get('errorDescription', '?')}")
            return False

        status = result_resp.get("status")
        if status == "ready":
            solution = result_resp.get("solution", {})
            solution_token = solution.get("token") or solution.get("gRecaptchaResponse")
            cost = result_resp.get("cost", "?")
            prog(f"  ✓ Task solved (attempt {attempt + 1}, cost: ${cost})")
            break
        elif status == "processing":
            if attempt % 3 == 0:
                prog(f"  → Still processing... ({(attempt + 1) * 5}s)")
        else:
            prog(f"  → Unexpected status: {status}")

    if not solution_token:
        prog("  → Anti-Captcha timeout (5 menit)")
        return False

    # Step 4: Inject token via MULTIPLE Clerk-specific strategies
    prog(f"  → Injecting token (len={len(solution_token)})...")
    try:
        inject_result = await page.evaluate(r"""
            (token) => {
                const log = [];

                // ── Strategy 1: Set cf-turnstile-response input value + native events ──
                const inputs = document.querySelectorAll(
                    'input[name="cf-turnstile-response"], ' +
                    'input[name*="turnstile"], ' +
                    'input[id*="turnstile-response"], ' +
                    'input[id*="cf-chl-widget"]'
                );
                log.push(`response inputs: ${inputs.length}`);
                for (const i of inputs) {
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype, 'value'
                    ).set;
                    nativeInputValueSetter.call(i, token);
                    i.dispatchEvent(new Event('input', { bubbles: true }));
                    i.dispatchEvent(new Event('change', { bubbles: true }));
                    log.push(`set value on ${i.id || i.name}`);
                }

                // ── Strategy 2: Intercept turnstile internal state — deep scan ──
                let callbackInvoked = false;
                if (window.turnstile) {
                    log.push(`window.turnstile exists, keys: ${Object.keys(window.turnstile).join(',')}`);
                    // 2a. Try all possible widget storage locations
                    const widgetSources = [
                        window.turnstile._widgets,
                        window.turnstile.widgets,
                        window.turnstile._state,
                    ];
                    for (const src of widgetSources) {
                        if (!src || typeof src !== 'object') continue;
                        const keys = Object.keys(src);
                        log.push(`widget source keys: ${keys.join(',')}`);
                        for (const id of keys) {
                            const w = src[id];
                            if (!w || typeof w !== 'object') continue;
                            // Deep scan for callback function in widget object
                            for (const prop of Object.keys(w)) {
                                if (typeof w[prop] === 'function' &&
                                    (prop === 'callback' || prop === 'onSuccess' || prop === 'cb' ||
                                     prop.toLowerCase().includes('callback'))) {
                                    try {
                                        w[prop](token);
                                        log.push(`called widget[${id}].${prop}()`);
                                        callbackInvoked = true;
                                    } catch (e) { log.push(`widget cb error: ${e.message}`); }
                                }
                            }
                            // Also set response properties
                            if (w) {
                                w.token = token;
                                w.response = token;
                            }
                        }
                    }
                    // 2b: turnstile.getResponse / turnstile.execute
                    try {
                        if (window.turnstile.execute) {
                            window.turnstile.execute();
                            log.push("called turnstile.execute()");
                        }
                    } catch (_) {}
                }

                // ── Strategy 3: Scan ALL window properties for turnstile callbacks ──
                // Clerk registers callbacks on window with dynamic names
                try {
                    const fnPattern = /captcha|turnstile|cf_|clerk.*cb|__clerk/i;
                    for (const key of Object.getOwnPropertyNames(window)) {
                        try {
                            if (fnPattern.test(key) && typeof window[key] === 'function') {
                                window[key](token);
                                log.push(`called window.${key}()`);
                                callbackInvoked = true;
                            }
                        } catch (_) {}
                    }
                } catch (e) { log.push(`window scan error: ${e.message}`); }

                // ── Strategy 4: Find callback from Turnstile render() interception ──
                // Clerk passes callback to turnstile.render(). If we can find the
                // container element, Turnstile stores widget ID as data attribute.
                try {
                    const containers = document.querySelectorAll(
                        '#clerk-captcha [data-turnstile-id], ' +
                        '#clerk-captcha [id^="cf-chl-widget"],' +
                        '.cf-turnstile[data-sitekey]'
                    );
                    log.push(`turnstile containers: ${containers.length}`);
                    for (const c of containers) {
                        const widgetId = c.getAttribute('data-turnstile-id') || c.id;
                        if (widgetId && window.turnstile) {
                            // Try getResponse-style API
                            try {
                                // Clerk uses turnstile.render() which returns a widgetId
                                // The callback is stored internally — try calling reset + providing token
                                window.turnstile.remove(widgetId);
                                log.push(`removed widget ${widgetId}, will re-render`);
                            } catch (_) {}
                        }
                    }
                } catch (e) { log.push(`container scan error: ${e.message}`); }

                // ── Strategy 5: Form submission — if token is in input, submit form ──
                try {
                    const form = document.querySelector('form');
                    if (form && inputs.length > 0) {
                        log.push("found form with turnstile input — dispatching submit");
                        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                    }
                } catch (_) {}

                // ── Strategy 6: Clerk's internal __unstable__onCaptchaResponse ──
                // Clerk v5 stores callbacks in __clerk_internal or similar
                try {
                    const clerkEl = document.querySelector('[data-clerk-id], [class*="cl-rootBox"]');
                    if (clerkEl) {
                        // React fiber — walk _reactFiber to find captcha callback
                        const fiberKey = Object.keys(clerkEl).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
                        if (fiberKey) {
                            let fiber = clerkEl[fiberKey];
                            let maxDepth = 30;
                            while (fiber && maxDepth-- > 0) {
                                const mp = fiber.memoizedProps || {};
                                if (typeof mp.onCaptchaResponse === 'function') {
                                    mp.onCaptchaResponse(token);
                                    log.push('called React fiber onCaptchaResponse');
                                    callbackInvoked = true;
                                    break;
                                }
                                if (typeof mp.onToken === 'function') {
                                    mp.onToken(token);
                                    log.push('called React fiber onToken');
                                    callbackInvoked = true;
                                    break;
                                }
                                fiber = fiber.return;
                            }
                        }
                    }
                } catch (e) { log.push(`react fiber scan: ${e.message}`); }

                // ── Strategy 7: postMessage to any iframe ──
                try {
                    const iframes = document.querySelectorAll('iframe');
                    log.push(`total iframes: ${iframes.length}`);
                    for (const iframe of iframes) {
                        if (iframe.contentWindow) {
                            iframe.contentWindow.postMessage({
                                token: token,
                                source: 'cf-turnstile-response',
                                event: 'completion',
                            }, '*');
                            // Also try Turnstile-specific message format
                            iframe.contentWindow.postMessage(JSON.stringify({
                                event: 'turnstile:complete',
                                token: token,
                            }), '*');
                        }
                    }
                } catch (e) {
                    log.push(`postMessage error: ${e.message}`);
                }

                log.push(`callbackInvoked: ${callbackInvoked}`);
                return { ok: true, callbackInvoked, log };
            }
        """, solution_token)

        prog(f"  → Injection log: {inject_result.get('log', [])}")
        callback_invoked = inject_result.get('callbackInvoked', False)
        prog(f"  → Token injected (callbackInvoked={callback_invoked}). Waiting page transition...")

        # Poll URL change — longer if callback was invoked
        wait_secs = 25 if callback_invoked else 15
        for poll in range(wait_secs):
            await asyncio.sleep(1)
            try:
                cur_url = page.url
                if "/sign-in" not in cur_url and "/sso-callback" not in cur_url:
                    prog(f"  ✓ URL changed to: {cur_url[:60]}")
                    return True
            except Exception:
                pass

        prog(f"  ⚠ Token injected but URL gak berubah dalam {wait_secs}s")

        # Last resort: try clicking submit/continue button that may have appeared
        try:
            clicked_continue = await page.evaluate(r"""
                () => {
                    const btns = document.querySelectorAll('button, [role="button"]');
                    for (const b of btns) {
                        const t = (b.textContent || '').trim().toLowerCase();
                        if (t === 'continue' || t === 'verify' || t === 'submit') {
                            b.click();
                            return t;
                        }
                    }
                    return null;
                }
            """)
            if clicked_continue:
                prog(f"  → Clicked '{clicked_continue}' button after injection, waiting 10s...")
                await asyncio.sleep(10)
                cur_url = page.url
                if "/sign-in" not in cur_url and "/sso-callback" not in cur_url:
                    prog(f"  ✓ URL changed to: {cur_url[:60]}")
                    return True
        except Exception:
            pass

        prog("  ⚠ Clerk gak recognize injected token")
        return False
    except Exception as e:
        prog(f"  → Token injection failed: {e}")
        return False


async def _real_mouse_click_turnstile(page) -> bool:
    """
    Real mouse click pakai Playwright page.mouse (bukan JS dispatch).
    Cari posisi Turnstile widget (iframe ATAU div container) lalu klik checkbox area.
    """
    try:
        # Get bounding box — try iframe first, then container div, then text-based
        bbox = await page.evaluate(r"""
            () => {
                // Strategy 1: iframe Cloudflare
                const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]');
                if (iframe) {
                    const r = iframe.getBoundingClientRect();
                    if (r.width > 10 && r.height > 10) return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'iframe' };
                }
                // Strategy 2: cf-turnstile div container
                const cfDiv = document.querySelector('.cf-turnstile, [class*="cf-turnstile"]');
                if (cfDiv) {
                    const r = cfDiv.getBoundingClientRect();
                    if (r.width > 10 && r.height > 10) return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'cf-div' };
                }
                // Strategy 3: clerk-captcha container — find any visible child with size
                const clerk = document.querySelector('#clerk-captcha, [class*="cl-captcha"]');
                if (clerk) {
                    // Try iframe inside clerk container
                    const ci = clerk.querySelector('iframe');
                    if (ci) {
                        const r = ci.getBoundingClientRect();
                        if (r.width > 10 && r.height > 10) return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'clerk-iframe' };
                    }
                    // Try the container itself
                    const r = clerk.getBoundingClientRect();
                    if (r.width > 10 && r.height > 10) return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'clerk-div' };
                }
                // Strategy 4: any element containing "Verify you are human"
                const allEls = document.querySelectorAll('*');
                for (const el of allEls) {
                    if (el.children.length > 3) continue; // skip containers
                    const txt = (el.textContent || '').trim();
                    if (txt.includes('Verify you are human')) {
                        // Get parent container which likely wraps the whole widget
                        const parent = el.closest('[class*="turnstile"], [class*="captcha"], [id*="captcha"]') || el.parentElement;
                        if (parent) {
                            const r = parent.getBoundingClientRect();
                            if (r.width > 10 && r.height > 10) return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'text-parent' };
                        }
                    }
                }
                // Strategy 5: any iframe at all on the page (might be Turnstile in disguise)
                const anyIframe = document.querySelectorAll('iframe');
                for (const f of anyIframe) {
                    const r = f.getBoundingClientRect();
                    if (r.width > 200 && r.height > 50) return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'any-iframe' };
                }
                return null;
            }
        """)
        if not bbox:
            prog("  Real mouse click: no clickable widget found")
            return False

        prog(f"  Found widget bbox via '{bbox.get('via')}': {bbox['w']:.0f}x{bbox['h']:.0f} at ({bbox['x']:.0f},{bbox['y']:.0f})")

        # Checkbox biasanya di pojok kiri widget — offset ~30px dari left + center vertical
        click_x = bbox["x"] + 30
        click_y = bbox["y"] + bbox["h"] / 2

        import random
        # Human-like: move to random nearby first
        await page.mouse.move(click_x + random.randint(-100, 100), click_y + random.randint(-50, 50))
        await asyncio.sleep(0.3 + random.random() * 0.3)
        # Move to near checkbox position
        await page.mouse.move(click_x + random.randint(-3, 3), click_y + random.randint(-3, 3))
        await asyncio.sleep(0.2 + random.random() * 0.2)
        # Click
        await page.mouse.click(click_x, click_y)
        prog(f"  → Clicked at ({click_x:.0f}, {click_y:.0f})")
        return True
    except Exception as e:
        prog(f"  Real mouse click failed: {e}")
        return False


async def handle_cloudflare_turnstile(page, max_wait: int = 300) -> bool:
    """
    Detect & handle Cloudflare Turnstile CAPTCHA.

    Reality: Turnstile pretty hard buat full-auto bypass. Practical strategy:
      1. Wait auto-resolve (0-10s) — kadang Camoufox passes
      2. Real mouse click (10s+) — humanized via page.mouse
      3. Manual intervention notice (15s+) — user click sendiri
      4. Reload page (60s+) — kadang reset challenge state
      5. Total timeout 5 menit (lo punya waktu buat klik manual)

    Returns True kalau pass, False kalau total timeout.
    """
    prog("Checking for Cloudflare Turnstile challenge...")

    start_time = asyncio.get_event_loop().time()
    deadline = start_time + max_wait
    last_url = ""
    turnstile_detected = False
    real_click_done = False
    anticaptcha_attempted = False
    manual_notice_shown = False
    reload_attempted = False
    last_countdown = 0

    while asyncio.get_event_loop().time() < deadline:
        try:
            current_url = page.url
        except Exception:
            break

        if current_url != last_url:
            prog(f"Current URL: {current_url[:80]}")
            last_url = current_url

        # Exit kalau udah di luar sign-in path
        if "openrouter.ai" in current_url and \
           "/sign-in" not in current_url and \
           "/sso-callback" not in current_url:
            prog("✓ Passed sign-in flow — Turnstile bypassed")
            return True

        # Detect Turnstile — multiple strategies termasuk stuck-on-sso-callback
        try:
            has_turnstile = await page.evaluate(r"""
                () => {
                    // Strategy 1: iframe-based Turnstile
                    const iframes = document.querySelectorAll('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]');
                    if (iframes.length > 0) return { has: true, type: 'iframe' };
                    // Strategy 2: text-based detection
                    const txt = (document.body.innerText || '').toLowerCase();
                    if (txt.includes('verify you are human') || txt.includes('verifying you are human')) {
                        return { has: true, type: 'text' };
                    }
                    // Strategy 3: Turnstile div widget (embedded mode, no iframe yet)
                    const widgets = document.querySelectorAll('[class*="turnstile"], [id*="turnstile"], [class*="cf-turnstile"], .cf-turnstile, [data-sitekey]');
                    if (widgets.length > 0) return { has: true, type: 'widget-div' };
                    // Strategy 4: Clerk captcha container
                    const clerkCaptcha = document.querySelector('#clerk-captcha, [class*="cl-captcha"], [id*="clerk-captcha"]');
                    if (clerkCaptcha) return { has: true, type: 'clerk-captcha' };
                    // Strategy 5: window.turnstile object exists
                    if (window.turnstile) return { has: true, type: 'window.turnstile' };
                    return { has: false };
                }
            """)
            if has_turnstile.get("has") and not turnstile_detected:
                turnstile_detected = True
                prog(f"⚠ Cloudflare Turnstile detected ({has_turnstile.get('type')})")
        except Exception:
            pass

        # Strategy 6: stuck on /sso-callback for >5s means Turnstile is blocking
        if not turnstile_detected and "/sso-callback" in current_url and elapsed >= 5:
            turnstile_detected = True
            prog("⚠ Stuck on /sso-callback >5s — treating as Turnstile block (widget may be invisible/loading)")
            # Debug dump — apa sih yang ada di page
            try:
                debug_dump = await page.evaluate(r"""
                    () => ({
                        url: location.href,
                        iframes: Array.from(document.querySelectorAll('iframe')).map(f => ({src: (f.src||'').slice(0,120), w: f.offsetWidth, h: f.offsetHeight})),
                        turnstile_divs: Array.from(document.querySelectorAll('[class*="turnstile"], [id*="turnstile"], .cf-turnstile, [data-sitekey]')).map(d => d.outerHTML.slice(0,150)),
                        clerk_captcha: document.querySelector('#clerk-captcha, [class*="cl-captcha"]')?.outerHTML?.slice(0,150) || null,
                        has_window_turnstile: !!window.turnstile,
                        body_text_snippet: (document.body.innerText||'').slice(0,300),
                    })
                """)
                prog(f"  DEBUG page dump: {json.dumps(debug_dump, indent=None)[:500]}")
            except Exception as e:
                prog(f"  DEBUG dump error: {e}")

        elapsed = int(asyncio.get_event_loop().time() - start_time)

        # PHASE 0 (immediately after detect): Try real mouse click first (free, fast)
        if turnstile_detected and not real_click_done and elapsed >= 3:
            prog("  → Trying real mouse click (humanized)...")
            real_click_done = await _real_mouse_click_turnstile(page)
            if real_click_done:
                prog("  → Click sent. Waiting Cloudflare response (5s)...")
                await asyncio.sleep(5)
                continue

        # PHASE 1 (after 8s): Anti-Captcha API solve (kalau API key di-set)
        if turnstile_detected and ARGS.anticaptcha_key and not anticaptcha_attempted and elapsed >= 8:
            anticaptcha_attempted = True
            prog("  → Anti-Captcha API key tersedia, solve via API...")
            anticaptcha_ok = await solve_turnstile_via_anticaptcha(page, ARGS.anticaptcha_key)
            if anticaptcha_ok:
                prog("  ✓ Anti-Captcha success — waiting page transition...")
                await asyncio.sleep(10)
                continue
            else:
                prog("  → Anti-Captcha gagal, falling back to manual/wait...")

        # Phase 2 (after 15s): MANUAL INTERVENTION NOTICE — kalau gak ada anti-captcha key
        if turnstile_detected and not manual_notice_shown and elapsed >= 15 and not ARGS.anticaptcha_key:
            manual_notice_shown = True
            print("", flush=True)
            print("┌" + "─" * 60 + "┐", flush=True)
            print("│  🚨 MANUAL ACTION DIBUTUHKAN                              │", flush=True)
            print("│                                                            │", flush=True)
            print("│  Klik checkbox 'Verify you are human' di browser window    │", flush=True)
            print("│  Script otomatis lanjut pas Cloudflare pass                │", flush=True)
            print("│                                                            │", flush=True)
            print(f"│  Timeout: {max_wait}s total (sisanya: ~{max_wait - elapsed}s)            │", flush=True)
            print("└" + "─" * 60 + "┘", flush=True)
            print("", flush=True)

        # Phase 3 (after 60s): reload page sebagai recovery
        if turnstile_detected and not reload_attempted and elapsed >= 60:
            prog("  → Reload page (reset challenge)...")
            try:
                await page.reload(timeout=20000, wait_until="domcontentloaded")
                await page.wait_for_timeout(3000)
                reload_attempted = True
                real_click_done = False  # retry click after reload
                anticaptcha_attempted = False  # retry anti-captcha after reload
                # Re-show notice
                manual_notice_shown = False
            except Exception as e:
                prog(f"  Reload failed: {e}")
                reload_attempted = True

        # Countdown setiap 30 detik biar user tau script masih jalan
        if elapsed > 0 and elapsed % 30 == 0 and elapsed != last_countdown:
            last_countdown = elapsed
            remaining = int(deadline - asyncio.get_event_loop().time())
            prog(f"  ⏱  Waiting Turnstile pass... ({elapsed}s elapsed, {remaining}s remaining)")

        await asyncio.sleep(2)

    if turnstile_detected:
        prog(f"⚠ Turnstile timeout setelah {max_wait}s — gagal pass")
    else:
        prog(f"No Turnstile detected, but URL gak berubah dalam {max_wait}s")
    return False

# Selectors untuk OpenRouter UI
NEW_KEY_BUTTON_SELECTORS = [
    "button:has-text('New key')",
    "button:has-text('Create key')",
    "button:has-text('New API key')",
    "[data-testid*='create-key']",
    "button:has(svg + span:has-text('New'))",
    "a:has-text('New key')",
]

KEY_NAME_INPUT_SELECTORS = [
    "input[placeholder*='Chatbot Key']",
    "input[placeholder*='Key']",
    "input[name='name']",
    "input[id*='name']",
    "form input[type='text']",
]

CREATE_BUTTON_SELECTORS = [
    "button:has-text('Create')",
    "button[type='submit']:has-text('Create')",
    "form button:has-text('Create')",
]

API_KEY_REGEX = re.compile(r"sk-or-v1-[a-zA-Z0-9]{32,}")


async def create_api_key_on_openrouter(page) -> dict | None:
    """Setelah login, navigate ke keys page → klik New → fill name → Create → extract key."""
    prog(f"Navigating to {KEYS_PAGE_URL}...")
    await page.goto(KEYS_PAGE_URL, timeout=30000, wait_until="domcontentloaded")
    await page.wait_for_timeout(3000)

    cur = page.url
    if "sign-in" in cur or "login" in cur.lower():
        prog(f"WARN: Bounced to {cur[:80]} — login may not have completed")

    # Klik "New key" button
    prog("Clicking 'New key' button...")
    clicked = False
    for sel in NEW_KEY_BUTTON_SELECTORS:
        try:
            btn = page.locator(sel).first
            if await btn.is_visible(timeout=4000):
                await btn.click()
                clicked = True
                prog(f"Clicked: {sel}")
                break
        except Exception:
            continue

    if not clicked:
        # JS fallback — cari elemen yang text-nya match
        try:
            res = await page.evaluate(r"""
                () => {
                    const els = document.querySelectorAll('button, a, [role="button"]');
                    for (const el of els) {
                        const t = (el.textContent || '').trim().toLowerCase();
                        if (t === 'new key' || t === 'create key' || t === 'new api key' ||
                            t.includes('+ new') || (t.includes('new') && t.length < 30)) {
                            const rect = el.getBoundingClientRect();
                            if (rect.width > 5 && rect.height > 5) {
                                el.click();
                                return { clicked: true, txt: t };
                            }
                        }
                    }
                    return { clicked: false };
                }
            """)
            if res and res.get("clicked"):
                prog(f"Clicked 'New key' via JS fallback (txt='{res.get('txt')}')")
                clicked = True
        except Exception as e:
            prog(f"JS fallback error: {e}")

    if not clicked:
        err("Could not find 'New key' button")
        return None

    await page.wait_for_timeout(2000)

    # Fill name field
    prog(f"Filling key name: '{KEY_NAME}'...")
    name_filled = False
    for sel in KEY_NAME_INPUT_SELECTORS:
        try:
            input_el = page.locator(sel).first
            if await input_el.is_visible(timeout=4000):
                await input_el.click()
                await input_el.fill(KEY_NAME)
                name_filled = True
                prog(f"Filled via selector: {sel}")
                break
        except Exception:
            continue

    if not name_filled:
        err("Could not find Name input field")
        return None

    await page.wait_for_timeout(500)

    # Klik Create button
    prog("Clicking 'Create' button...")
    submit_clicked = False
    for sel in CREATE_BUTTON_SELECTORS:
        try:
            btn = page.locator(sel).first
            if await btn.is_visible(timeout=4000):
                await btn.click()
                submit_clicked = True
                prog(f"Clicked Create via: {sel}")
                break
        except Exception:
            continue

    if not submit_clicked:
        # JS fallback
        try:
            res = await page.evaluate(r"""
                () => {
                    const btns = document.querySelectorAll('button');
                    for (const b of btns) {
                        const t = (b.textContent || '').trim().toLowerCase();
                        if (t === 'create' || t === 'submit' || t === 'save') {
                            b.click();
                            return { clicked: true, txt: t };
                        }
                    }
                    return { clicked: false };
                }
            """)
            if res.get("clicked"):
                submit_clicked = True
                prog(f"Clicked Create via JS fallback ('{res.get('txt')}')")
        except Exception:
            pass

    if not submit_clicked:
        err("Could not find Create button")
        return None

    await page.wait_for_timeout(3000)

    # Extract key dari modal
    prog("Extracting API key from modal...")
    # Strategy 1: poll body innerText for "sk-or-v1-..." pattern
    api_key = None
    for attempt in range(15):  # 15 seconds total
        try:
            body_text = await page.evaluate("() => document.body.innerText || document.body.textContent || ''")
            match = API_KEY_REGEX.search(body_text)
            if match:
                api_key = match.group(0)
                prog(f"Found key in body text (attempt {attempt+1})")
                break
        except Exception:
            pass
        # Try input/textarea values too
        try:
            res = await page.evaluate(r"""
                () => {
                    const inputs = document.querySelectorAll('input, textarea, code, pre');
                    for (const el of inputs) {
                        const v = (el.value || el.textContent || '').trim();
                        const m = v.match(/sk-or-v1-[a-zA-Z0-9]{32,}/);
                        if (m) return m[0];
                    }
                    return null;
                }
            """)
            if res:
                api_key = res
                prog(f"Found key in input/code element (attempt {attempt+1})")
                break
        except Exception:
            pass
        await asyncio.sleep(1)

    if not api_key:
        # Dump DOM untuk debug
        try:
            dom_dump = await page.evaluate(r"""
                () => {
                    const out = [];
                    document.querySelectorAll('input, textarea, code, pre').forEach((el, i) => {
                        const v = (el.value || el.textContent || '').slice(0, 100);
                        out.push(`${el.tagName}[${i}]: ${v}`);
                    });
                    return out.slice(0, 20);
                }
            """)
            prog(f"DEBUG inputs found: {dom_dump}")
        except Exception:
            pass
        err("API key tidak ke-extract setelah Create — UI mungkin berubah")
        return None

    return {
        "api_key": api_key,
        "key_name": KEY_NAME,
        "email": EMAIL,
        "provider": "openrouter",
        "source": "openrouter.ai/workspaces/default/keys",
    }


# ─── Main login flow ───────────────────────────────────────────────────────
async def do_login(page) -> None:
    await page.context.clear_cookies()
    try:
        await page.context.clear_permissions()
    except Exception:
        pass

    prog(f"Navigating to {SIGNIN_URL}...")
    await page.goto(SIGNIN_URL, timeout=60000, wait_until="domcontentloaded")
    # OpenRouter pakai Clerk (third-party auth) — JS-heavy, butuh waktu render.
    # Wait for Clerk component fully loaded sebelum klik Google.
    prog("Waiting for Clerk sign-in form to render...")
    try:
        # Tunggu sampai social buttons muncul (60 detik max — Clerk kadang lambat)
        await page.wait_for_selector(
            "button.cl-socialButtonsIconButton__google, [class*='cl-socialButton'], button:has(img[alt*='Google'])",
            state="visible",
            timeout=60000,
        )
        prog("Clerk form ready — Google button visible")
    except Exception as e:
        prog(f"WARN: Clerk button gak muncul dalam 60s ({e}). Lanjut anyway...")
        await page.wait_for_timeout(3000)

    # Wait sebentar buat networkidle (Clerk masih load resources tambahan)
    try:
        await page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    await page.wait_for_timeout(1500)

    # Klik Google sign-in (try Playwright selectors first — Clerk-aware)
    prog("Clicking 'Sign in with Google'...")
    google_clicked = False
    for selector in _GOOGLE_SELECTORS:
        try:
            el = page.locator(selector).first
            if await el.is_visible(timeout=3000):
                await el.click(timeout=4000)
                google_clicked = True
                prog(f"Clicked Google button via: {selector}")
                break
        except Exception:
            continue

    if not google_clicked:
        # JS fallback — aggressive scan termasuk Clerk class names
        try:
            res = await page.evaluate(r"""
                () => {
                    // Strategy 1: Cari button dengan class Clerk Google
                    const clerk = document.querySelector(
                        'button[class*="cl-socialButtonsIconButton__google"], ' +
                        '[class*="cl-button__google"]'
                    );
                    if (clerk) {
                        clerk.click();
                        return { clicked: true, via: 'clerk-class', tag: clerk.tagName };
                    }
                    // Strategy 2: button yg punya img dengan alt mention Google
                    const imgs = document.querySelectorAll('img[alt*="Google"], img[src*="google.svg"]');
                    for (const img of imgs) {
                        let parent = img.closest('button, a, [role="button"]');
                        if (parent) {
                            parent.click();
                            return { clicked: true, via: 'image-parent', tag: parent.tagName };
                        }
                    }
                    // Strategy 3: button mana saja yang text-nya mention google
                    const els = document.querySelectorAll('button, a, [role="button"]');
                    for (const el of els) {
                        const t = (el.textContent || '').toLowerCase();
                        const c = (el.className || '').toLowerCase();
                        const a = (el.getAttribute('aria-label') || '').toLowerCase();
                        if (t.includes('google') || c.includes('google') || a.includes('google')) {
                            el.click();
                            return { clicked: true, via: 'text/class', tag: el.tagName, t: t.slice(0, 40) };
                        }
                    }
                    return { clicked: false };
                }
            """)
            if res and res.get("clicked"):
                google_clicked = True
                prog(f"Clicked Google via JS fallback ({res.get('via')}, tag={res.get('tag')})")
            else:
                # Last resort: dump page state buat debug
                try:
                    debug = await page.evaluate(r"""
                        () => ({
                            url: location.href,
                            buttons_count: document.querySelectorAll('button').length,
                            has_clerk: !!document.querySelector('[class*="cl-"]'),
                            clerk_buttons: Array.from(document.querySelectorAll('button[class*="cl-"]')).slice(0, 5).map(b => b.className.split(' ').filter(c => c.startsWith('cl-')).join(' ')),
                        })
                    """)
                    prog(f"DEBUG page state: {debug}")
                except Exception:
                    pass
                err("Could not find Google login button (Clerk component possibly not loaded)")
                return
        except Exception as e:
            err(f"JS fallback for Google button failed: {e}")
            return

    await page.wait_for_timeout(3000)

    # Detect Google login page (popup atau same tab)
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

    # Fill credentials
    if not await fill_google_credentials(login_page):
        return

    # Handle interstitials
    await handle_google_interstitials(login_page)

    # Wait redirect back to openrouter (initial redirect)
    prog("Waiting for openrouter.ai redirect...")
    try:
        await page.wait_for_url("*openrouter.ai*", timeout=30000)
    except Exception:
        cur = page.url
        prog(f"WARN: Still at {cur[:80]}")

    await page.wait_for_timeout(3000)

    # Handle Cloudflare Turnstile (kalau muncul di sso-callback)
    # Camoufox biasanya auto-pass, tapi kadang stuck — kasih 90s timeout
    turnstile_ok = await handle_cloudflare_turnstile(page, max_wait=90)
    if not turnstile_ok:
        # Coba force navigate ke keys page — kadang Turnstile clear setelah refresh
        prog("Trying force navigation past Turnstile...")
        try:
            await page.goto("https://openrouter.ai/", timeout=20000, wait_until="domcontentloaded")
            await page.wait_for_timeout(5000)
            cur = page.url
            if "/sign-in" in cur or "/sso-callback" in cur:
                err("Stuck di Cloudflare Turnstile. Try: --headless OFF + manual klik checkbox")
                return
        except Exception as e:
            err(f"Force navigation failed: {e}")
            return

    await page.wait_for_timeout(2000)

    # Handle Legal Consent dialog (muncul buat akun baru pertama kali login)
    consent_ok = await handle_legal_consent(page, max_wait=30)
    if not consent_ok:
        err("Stuck di Legal Consent dialog. Try: --headless OFF + manual centang & klik Continue")
        return

    await page.wait_for_timeout(2000)

    # Create API key
    key_result = await create_api_key_on_openrouter(page)
    if not key_result:
        return

    # Save session (cookies + localStorage)
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
        prog(f"Session saved: {session_path}")
    except Exception as e:
        prog(f"Session export skipped: {e}")

    done(json.dumps(key_result))


# ─── Entry point ───────────────────────────────────────────────────────────
async def main() -> None:
    try:
        from camoufox.async_api import AsyncCamoufox
    except ImportError:
        emit_final_error(
            "camoufox not installed. "
            "Install: pip install 'camoufox[geoip]' && python -m camoufox fetch"
        )
        return

    max_attempts = max(1, ARGS.retries)
    last_error = "unknown"

    memory_efficient_prefs = {
        "browser.cache.memory.capacity": 65536,
        "browser.cache.disk.enable": False,
        "browser.sessionhistory.max_total_viewers": 1,
        "image.mem.decode_bytes_at_a_time": 4096,
        "media.cache_size": 0,
    }

    for attempt in range(1, max_attempts + 1):
        _RESULT_STATE["done"] = False
        _RESULT_STATE["last_error"] = ""

        if attempt > 1:
            backoff = 3 * (attempt - 1)
            prog(f"Retry {attempt}/{max_attempts} after {backoff}s...")
            await asyncio.sleep(backoff)
        else:
            prog(f"Attempt {attempt}/{max_attempts}: launching Camoufox...")

        proxy_arg = {"server": PROXY} if PROXY else None
        if PROXY:
            prog(f"Using proxy: {PROXY[:30]}...")

        try:
            # Camoufox optimasi anti-detection:
            # - humanize: random mouse movement & typing delays (helps Turnstile)
            # - geoip: real GeoIP-based fingerprint (kalau aktif)
            # - block_images: skip download gambar (faster, less detection surface)
            camoufox_kwargs = {
                "headless": HEADLESS,
                "geoip": ARGS.geoip,
                "proxy": proxy_arg,
                "firefox_user_prefs": memory_efficient_prefs,
            }
            # Try add humanize if Camoufox version supports it
            try:
                async with AsyncCamoufox(
                    **camoufox_kwargs,
                    humanize=True,  # 0.4+ supports this
                ) as browser:
                    page = await browser.new_page()
                    await do_login(page)
            except TypeError:
                # Older Camoufox tanpa humanize param
                async with AsyncCamoufox(**camoufox_kwargs) as browser:
                    page = await browser.new_page()
                    await do_login(page)
        except Exception as e:
            _RESULT_STATE["last_error"] = f"Camoufox error: {e}"
            prog(f"attempt {attempt} crashed: {e}")

        if _RESULT_STATE["done"]:
            return

        last_error = _RESULT_STATE["last_error"] or "no api key"
        if attempt < max_attempts:
            prog(f"Attempt {attempt} failed ({last_error}); retrying...")

    emit_final_error(f"All {max_attempts} attempts failed. Last error: {last_error}")


if __name__ == "__main__":
    asyncio.run(main())
