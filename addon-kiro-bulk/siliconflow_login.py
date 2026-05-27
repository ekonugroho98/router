#!/usr/bin/env python3
"""
Automated Google OAuth login → create SiliconFlow API key.

Flow:
  1. Buka https://cloud.siliconflow.com/login → Sign in with Google
  2. Input email:password → complete Google OAuth
  3. Navigate ke https://cloud.siliconflow.com/account/ak
  4. Create new API key → copy

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

log = logging.getLogger("siliconflow_login")

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="SiliconFlow Google-OAuth + create API key helper")
    p.add_argument("--email", required=True, help="Google email")
    p.add_argument("--password", required=True, help="Google password")
    p.add_argument("--headless", action="store_true", default=False, help="Run headless")
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


SILICONFLOW_LOGIN_URL = "https://cloud.siliconflow.com/login"
SILICONFLOW_KEYS_URL = "https://cloud.siliconflow.com/account/ak"


async def create_api_key_on_siliconflow(page) -> dict | None:
    """Navigate to keys page → Create API key → extract key."""
    prog(f"Navigating to {SILICONFLOW_KEYS_URL}...")
    await page.goto(SILICONFLOW_KEYS_URL, timeout=30000, wait_until="domcontentloaded")
    await asyncio.sleep(3)

    current_url = page.url
    if "account/ak" not in current_url and "login" in current_url.lower():
        prog("Not logged in, still on login page")
        return None

    # Click "Create API Key" / "New" button
    prog("Looking for 'Create API Key' button...")
    create_btn = None

    selectors = [
        'button:has-text("Create")',
        'button:has-text("New")',
        'button:has-text("Add")',
        'button:has-text("Generate")',
        'button:has-text("新建")',
        'button:has-text("创建")',
        '[data-testid*="create"]',
        '[data-testid*="new-key"]',
    ]

    for sel in selectors:
        try:
            create_btn = await page.wait_for_selector(sel, timeout=3000)
            if create_btn:
                prog(f"Found create button: {sel}")
                break
        except:
            continue

    if not create_btn:
        # Try JS click
        clicked = await page.evaluate("""() => {
            const btns = [...document.querySelectorAll('button, a')];
            const keywords = ['create', 'new', 'add', 'generate', '新建', '创建'];
            for (const btn of btns) {
                const text = (btn.textContent || '').toLowerCase().trim();
                if (keywords.some(k => text.includes(k)) && btn.offsetParent !== null) {
                    btn.click();
                    return text;
                }
            }
            return null;
        }""")
        if clicked:
            prog(f"Clicked button: {clicked}")
        else:
            prog("Could not find create button")
            return None
    else:
        await create_btn.click()

    await asyncio.sleep(2)

    # Fill key name if there's an input
    name_input = None
    for sel in ['input[placeholder*="name"]', 'input[placeholder*="Name"]', 'input[type="text"]']:
        try:
            name_input = await page.wait_for_selector(sel, timeout=3000)
            if name_input:
                break
        except:
            continue

    random_name = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
    key_name = f"9router-{random_name}"

    if name_input:
        await name_input.fill(key_name)
        await asyncio.sleep(0.5)

    # Click confirm/submit/create
    prog("Confirming key creation...")
    confirm_selectors = [
        'button:has-text("OK")',
        'button:has-text("Confirm")',
        'button:has-text("Submit")',
        'button:has-text("Create")',
        'button:has-text("确定")',
        'button:has-text("确认")',
        'button[type="submit"]',
    ]

    for sel in confirm_selectors:
        try:
            btn = await page.wait_for_selector(sel, timeout=3000)
            if btn:
                await btn.click()
                prog(f"Clicked confirm: {sel}")
                break
        except:
            continue

    await asyncio.sleep(3)

    # Extract the API key
    prog("Extracting API key...")
    api_key = await page.evaluate("""() => {
        // SiliconFlow keys start with 'sk-'
        const allText = document.body.innerText;
        const match = allText.match(/(sk-[a-zA-Z0-9]{30,})/);
        if (match) return match[1];

        // Look for input/code elements
        const inputs = document.querySelectorAll('input[readonly], input[disabled], code, pre, .api-key, [data-testid*="key"]');
        for (const el of inputs) {
            const text = (el.value || el.textContent || '').trim();
            if (text.startsWith('sk-') && text.length > 30) return text;
        }

        // Look for copy-able elements
        const allEls = document.querySelectorAll('*');
        for (const el of allEls) {
            const text = (el.textContent || '').trim();
            if (text.startsWith('sk-') && text.length > 30 && text.length < 100) return text;
        }

        return null;
    }""")

    if not api_key:
        await asyncio.sleep(3)
        api_key = await page.evaluate("""() => {
            const allText = document.body.innerText;
            const match = allText.match(/(sk-[a-zA-Z0-9]{30,})/);
            return match ? match[1] : null;
        }""")

    if api_key:
        prog(f"API key extracted: {api_key[:15]}...")
        return {"api_key": api_key, "name": key_name}
    else:
        prog("Failed to extract API key")
        return None


async def main():
    args = parse_args()
    headless = args.headless and not args.no_headless

    prog("Starting SiliconFlow login...")

    browser = None
    try:
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

    # Step 1: Go to SiliconFlow login
    prog("Opening SiliconFlow login...")
    await page.goto(SILICONFLOW_LOGIN_URL, timeout=30000, wait_until="domcontentloaded")
    await asyncio.sleep(2)

    # Step 2: Click "Sign in with Google" / Google button
    prog("Looking for Google sign-in button...")
    google_btn = None
    for sel in [
        'button:has-text("Google")',
        'button:has-text("Continue with Google")',
        'button:has-text("Sign in with Google")',
        '[data-provider="google"]',
        'button[aria-label*="Google"]',
        '.social-login-google',
        'a:has-text("Google")',
    ]:
        try:
            google_btn = await page.wait_for_selector(sel, timeout=5000)
            if google_btn:
                break
        except:
            continue

    if not google_btn:
        found = await page.evaluate("""() => {
            const btns = [...document.querySelectorAll('button, a, div[role="button"]')];
            const g = btns.find(b => {
                const text = (b.textContent || '').toLowerCase();
                const hasGoogleIcon = b.querySelector('svg, img[src*="google"]');
                return text.includes('google') || hasGoogleIcon;
            });
            if (g) { g.click(); return true; }
            return false;
        }""")
        if not found:
            emit_final_error("Could not find Google sign-in button")
            return
    else:
        await google_btn.click()

    await asyncio.sleep(3)

    # Step 3: Handle Google OAuth
    prog("Handling Google OAuth...")

    google_page = None
    pages = page.context.pages
    for p in pages:
        if "accounts.google.com" in p.url:
            google_page = p
            break

    if not google_page:
        if "accounts.google.com" in page.url:
            google_page = page
        else:
            try:
                google_page = await page.context.wait_for_event("page", timeout=10000)
            except:
                if "accounts.google.com" in page.url:
                    google_page = page
                else:
                    emit_final_error("Google OAuth page not found")
                    return

    # Fill email
    prog("Filling Google credentials...")
    try:
        email_input = await google_page.wait_for_selector('input[type="email"]', timeout=15000)
        await email_input.fill(args.email)
        await asyncio.sleep(0.5)
        await google_page.keyboard.press("Enter")
        await asyncio.sleep(3)
    except Exception as e:
        emit_final_error(f"Email input error: {e}")
        return

    # Fill password
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

    # Handle Google interstitials
    prog("Handling Google interstitials...")
    deadline = time.time() + 45
    while time.time() < deadline:
        if "siliconflow.com" in page.url and "accounts.google" not in page.url:
            break

        try:
            clicked = await google_page.evaluate("""() => {
                const btns = [...document.querySelectorAll('button, [role="button"], a')];
                const keywords = ['continue', 'allow', 'confirm', 'next', 'accept', 'yes', 'submit'];
                for (const btn of btns) {
                    const text = (btn.textContent || '').toLowerCase().trim();
                    if (keywords.some(k => text.includes(k)) && btn.offsetParent !== null) {
                        btn.click();
                        return text;
                    }
                }
                const submits = document.querySelectorAll('input[type="submit"], button[type="submit"]');
                for (const s of submits) {
                    if (s.offsetParent !== null) { s.click(); return 'submit'; }
                }
                return null;
            }""")
            if clicked:
                prog(f"Clicked Google button: {clicked}")
                await asyncio.sleep(3)
                continue
        except:
            pass

        await asyncio.sleep(1)

    if "siliconflow.com" not in page.url:
        emit_final_error(f"Login failed, stuck at: {page.url}")
        return

    prog("Logged in to SiliconFlow!")

    # Step 4: Generate API key
    result = await create_api_key_on_siliconflow(page)

    if result and result.get("api_key"):
        done(json.dumps({
            "api_key": result["api_key"],
            "email": args.email,
            "source": "siliconflow",
            "name": result.get("name", ""),
        }))
    else:
        emit_final_error("Failed to generate API key")


if __name__ == "__main__":
    asyncio.run(main())
