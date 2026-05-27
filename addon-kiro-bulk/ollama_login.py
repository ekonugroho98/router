#!/usr/bin/env python3
"""
Automated Google OAuth login → create Ollama Cloud API key.

Flow:
  1. Buka https://ollama.com/ → Sign in → Continue with Google
  2. Input email:password → complete Google OAuth
  3. Navigate ke https://ollama.com/settings/keys
  4. Klik "Add API Key" → fill name → "Generate API Key"
  5. Copy API key

Output (stdout, line-based):
  PROGRESS:<msg>  status update
  DONE:<json>     contains api_key, email, source
  ERROR:<msg>     fatal error
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import time
import random
import string

log = logging.getLogger("ollama_login")

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Ollama Cloud Google-OAuth + create API key helper")
    p.add_argument("--email", required=True, help="Google email")
    p.add_argument("--password", required=True, help="Google password")
    p.add_argument("--headless", action="store_true", default=True, help="Run headless (default)")
    p.add_argument("--no-headless", action="store_true", help="Show browser")
    p.add_argument("--proxy", default=None, help="HTTP/SOCKS proxy URL")
    p.add_argument("--timeout", type=int, default=120, help="Max seconds before giving up")
    p.add_argument("--retries", type=int, default=3, help="Max retries")
    p.add_argument("--anticaptcha-key", default=None, help="Anticaptcha API key")
    return p.parse_args()


def prog(msg: str) -> None:
    print(f"PROGRESS:{msg}", flush=True)

def done(payload_json: str) -> None:
    print(f"DONE:{payload_json}", flush=True)

def err(msg: str) -> None:
    print(f"ERROR:{msg}", flush=True)

def emit_final_error(msg: str) -> None:
    err(msg)
    sys.exit(1)


OLLAMA_SIGN_IN_URL = "https://ollama.com/"
OLLAMA_KEYS_URL = "https://ollama.com/settings/keys"


async def fill_google_credentials(login_page) -> bool:
    """Fill Google OAuth email + password on the Google sign-in page."""
    args = parse_args.__wrapped_args__ if hasattr(parse_args, '__wrapped_args__') else None
    email = os.environ.get("OLLAMA_EMAIL", "")
    password = os.environ.get("OLLAMA_PASSWORD", "")

    try:
        # Wait for email input
        prog("Waiting for Google email input...")
        email_input = await login_page.wait_for_selector(
            'input[type="email"]', timeout=15000
        )
        if not email_input:
            return False

        await email_input.fill(email)
        await asyncio.sleep(0.5)

        # Click Next
        next_btn = await login_page.query_selector('button:has-text("Next"), #identifierNext')
        if next_btn:
            await next_btn.click()
        else:
            await login_page.keyboard.press("Enter")

        await asyncio.sleep(2)

        # Wait for password input
        prog("Filling password...")
        password_input = await login_page.wait_for_selector(
            'input[type="password"]', timeout=15000
        )
        if not password_input:
            return False

        await password_input.fill(password)
        await asyncio.sleep(0.5)

        # Click Next
        next_btn = await login_page.query_selector('button:has-text("Next"), #passwordNext')
        if next_btn:
            await next_btn.click()
        else:
            await login_page.keyboard.press("Enter")

        await asyncio.sleep(3)
        return True

    except Exception as e:
        prog(f"Google credentials fill error: {e}")
        return False


async def create_api_key_on_ollama(page) -> dict | None:
    """Navigate to keys page → Add API Key → Generate → extract key."""
    prog(f"Navigating to {OLLAMA_KEYS_URL}...")
    await page.goto(OLLAMA_KEYS_URL, timeout=30000, wait_until="domcontentloaded")
    await asyncio.sleep(3)

    # Check if we're on the keys page
    current_url = page.url
    if "settings/keys" not in current_url:
        prog(f"Not on keys page, current URL: {current_url}")
        # Maybe need to login first
        if "sign" in current_url.lower() or "login" in current_url.lower():
            return None

    # Click "Add API Key" button
    prog("Looking for 'Add API Key' button...")
    add_btn = None

    selectors = [
        'button:has-text("Add API Key")',
        'button:has-text("Add API key")',
        'button:has-text("add api key")',
        'a:has-text("Add API Key")',
        '[data-testid*="add-key"]',
    ]

    for sel in selectors:
        try:
            add_btn = await page.wait_for_selector(sel, timeout=5000)
            if add_btn:
                prog(f"Found Add API Key button: {sel}")
                break
        except:
            continue

    if not add_btn:
        # Try finding by text content
        add_btn = await page.evaluate("""() => {
            const buttons = [...document.querySelectorAll('button, a')];
            const btn = buttons.find(b => b.textContent.toLowerCase().includes('add api key'));
            if (btn) { btn.click(); return true; }
            return false;
        }""")
        if not add_btn:
            prog("Could not find 'Add API Key' button")
            return None
        await asyncio.sleep(1)
    else:
        await add_btn.click()
        await asyncio.sleep(1)

    # Fill API Key Name (optional)
    prog("Filling API key name...")
    name_input = None
    name_selectors = [
        'input[placeholder*="API Key Name"]',
        'input[placeholder*="api key name"]',
        'input[placeholder*="Name"]',
        'input[type="text"]',
    ]

    for sel in name_selectors:
        try:
            name_input = await page.wait_for_selector(sel, timeout=5000)
            if name_input:
                break
        except:
            continue

    if name_input:
        random_name = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
        key_name = f"9router-{random_name}"
        await name_input.fill(key_name)
        await asyncio.sleep(0.5)

    # Click "Generate API Key"
    prog("Clicking 'Generate API Key'...")
    gen_btn = None
    gen_selectors = [
        'button:has-text("Generate API Key")',
        'button:has-text("Generate")',
        'button:has-text("Create")',
        '[data-testid*="generate"]',
    ]

    for sel in gen_selectors:
        try:
            gen_btn = await page.wait_for_selector(sel, timeout=5000)
            if gen_btn:
                break
        except:
            continue

    if not gen_btn:
        await page.evaluate("""() => {
            const buttons = [...document.querySelectorAll('button')];
            const btn = buttons.find(b => b.textContent.toLowerCase().includes('generate'));
            if (btn) btn.click();
        }""")
        await asyncio.sleep(2)
    else:
        await gen_btn.click()
        await asyncio.sleep(2)

    # Extract the API key
    prog("Extracting API key...")
    api_key = None

    # Try multiple extraction methods
    # Method 1: Look for code/pre element with key pattern
    api_key = await page.evaluate("""() => {
        // Look for elements that contain API key pattern (hash.xxx)
        const allText = document.body.innerText;
        const match = allText.match(/([a-f0-9]{30,}\\.[A-Za-z0-9_-]{20,})/);
        if (match) return match[1];

        // Look for input/code elements
        const inputs = document.querySelectorAll('input[readonly], input[disabled], code, pre, .api-key, [data-testid*="key"]');
        for (const el of inputs) {
            const text = el.value || el.textContent || '';
            if (text.length > 30 && text.includes('.')) return text.trim();
        }

        // Look for copy button nearby
        const copyBtns = document.querySelectorAll('[data-testid*="copy"], button[aria-label*="copy"]');
        for (const btn of copyBtns) {
            const parent = btn.closest('div');
            if (parent) {
                const text = parent.textContent;
                const m = text.match(/([a-f0-9]{30,}\\.[A-Za-z0-9_-]{20,})/);
                if (m) return m[1];
            }
        }

        return null;
    }""")

    if not api_key:
        # Wait a bit more and retry
        await asyncio.sleep(3)
        api_key = await page.evaluate("""() => {
            const allText = document.body.innerText;
            const match = allText.match(/([a-f0-9]{30,}\\.[A-Za-z0-9_-]{20,})/);
            return match ? match[1] : null;
        }""")

    if api_key:
        prog(f"API key extracted: {api_key[:15]}...")
        return {"api_key": api_key, "name": key_name if name_input else "unnamed"}
    else:
        prog("Failed to extract API key")
        return None


async def main():
    args = parse_args()
    headless = args.headless and not args.no_headless

    os.environ["OLLAMA_EMAIL"] = args.email
    os.environ["OLLAMA_PASSWORD"] = args.password

    prog("Starting Ollama Cloud login...")

    try:
        from camoufox.async_api import AsyncCamoufox
    except ImportError:
        try:
            from playwright.async_api import async_playwright
            USE_PLAYWRIGHT = True
        except ImportError:
            emit_final_error("Neither camoufox nor playwright installed")
            return

    browser = None
    try:
        # Try Camoufox first
        try:
            from camoufox.async_api import AsyncCamoufox
            prog("Using Camoufox browser...")
            async with AsyncCamoufox(headless=headless, proxy=args.proxy) as brow:
                context = await brow.new_context()
                page = await context.new_page()
                await _do_login_and_generate(page, args)
            return
        except ImportError:
            pass

        # Fallback to Playwright
        from playwright.async_api import async_playwright
        prog("Using Playwright browser...")
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=headless)
            context = await browser.new_context()
            page = await context.new_page()
            await _do_login_and_generate(page, args)

    except Exception as e:
        emit_final_error(f"Browser error: {e}")
    finally:
        if browser:
            await browser.close()


async def _do_login_and_generate(page, args):
    """Main flow: login → generate key."""
    timeout = args.timeout
    start = time.time()

    # Step 1: Go to Ollama sign in
    prog("Opening Ollama.com...")
    await page.goto(OLLAMA_SIGN_IN_URL, timeout=30000, wait_until="domcontentloaded")
    await asyncio.sleep(2)

    # Step 2: Click Sign in
    prog("Looking for Sign in button...")
    sign_in = None
    for sel in ['a:has-text("Sign in")', 'button:has-text("Sign in")', '[href*="signin"]', '[href*="login"]']:
        try:
            sign_in = await page.wait_for_selector(sel, timeout=5000)
            if sign_in:
                break
        except:
            continue

    if sign_in:
        await sign_in.click()
        await asyncio.sleep(2)

    # Step 3: Click "Continue with Google"
    prog("Looking for 'Continue with Google'...")
    google_btn = None
    for sel in [
        'button:has-text("Continue with Google")',
        'button:has-text("Google")',
        '[data-provider="google"]',
        '.cl-socialButtonsIconButton__google',
        'button[aria-label*="Google"]',
    ]:
        try:
            google_btn = await page.wait_for_selector(sel, timeout=5000)
            if google_btn:
                break
        except:
            continue

    if not google_btn:
        # Try JS click
        found = await page.evaluate("""() => {
            const btns = [...document.querySelectorAll('button, a')];
            const g = btns.find(b => b.textContent.toLowerCase().includes('google'));
            if (g) { g.click(); return true; }
            return false;
        }""")
        if not found:
            emit_final_error("Could not find 'Continue with Google' button")
            return
    else:
        await google_btn.click()

    await asyncio.sleep(3)

    # Step 4: Handle Google OAuth in popup or same page
    prog("Handling Google OAuth...")

    # Check if popup opened
    pages = page.context.pages
    google_page = None
    for p in pages:
        if "accounts.google.com" in p.url:
            google_page = p
            break

    if not google_page:
        # Maybe same page redirect
        if "accounts.google.com" in page.url:
            google_page = page
        else:
            # Wait for popup
            try:
                google_page = await page.context.wait_for_event("page", timeout=10000)
            except:
                if "accounts.google.com" in page.url:
                    google_page = page
                else:
                    emit_final_error("Google OAuth page not found")
                    return

    # Fill Google credentials
    os.environ["OLLAMA_EMAIL"] = args.email
    os.environ["OLLAMA_PASSWORD"] = args.password

    prog("Filling Google credentials...")

    # Email
    try:
        email_input = await google_page.wait_for_selector('input[type="email"]', timeout=15000)
        await email_input.fill(args.email)
        await asyncio.sleep(0.5)
        await google_page.keyboard.press("Enter")
        await asyncio.sleep(3)
    except Exception as e:
        emit_final_error(f"Email input error: {e}")
        return

    # Password
    try:
        prog("Filling password...")
        password_input = await google_page.wait_for_selector('input[type="password"]', timeout=15000)
        await password_input.fill(args.password)
        await asyncio.sleep(0.5)
        await google_page.keyboard.press("Enter")
        await asyncio.sleep(5)
    except Exception as e:
        emit_final_error(f"Password input error: {e}")
        return

    # Wait for redirect back to ollama.com
    prog("Waiting for redirect to Ollama...")
    deadline = time.time() + 30
    while time.time() < deadline:
        if "ollama.com" in page.url and "accounts.google" not in page.url:
            break
        await asyncio.sleep(1)

    if "ollama.com" not in page.url:
        emit_final_error(f"Login failed, stuck at: {page.url}")
        return

    prog("Logged in to Ollama Cloud!")

    # Step 5: Generate API key
    result = await create_api_key_on_ollama(page)

    if result and result.get("api_key"):
        done(json.dumps({
            "api_key": result["api_key"],
            "email": args.email,
            "source": "ollama-cloud",
            "name": result.get("name", ""),
        }))
    else:
        emit_final_error("Failed to generate API key")


if __name__ == "__main__":
    asyncio.run(main())
