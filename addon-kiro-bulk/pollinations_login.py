#!/usr/bin/env python3
"""
Automated Pollinations API key creation via GitHub OAuth (Google login).

Flow:
  1. Buka https://enter.pollinations.ai/sign-in
  2. Klik "Sign in with GitHub"
  3. GitHub redirects ke Google OAuth → input email:password
  4. Handle Google interstitials (Continue/Allow)
  5. Klik "Create account" di GitHub (kalau akun baru)
  6. Klik "Authorize" (GitHub OAuth ke Pollinations)
  7. Navigate ke https://enter.pollinations.ai/#keys
  8. Klik "API Key" section
  9. Klik "Create" button
  10. Copy API key (sk_...)

Output (stdout, line-based):
  PROGRESS:<msg>  status update
  DONE:<json>     contains api_key, email, source
  ERROR:<msg>     fatal error
"""

import argparse
import asyncio
import json
import os
import sys
import time

def parse_args():
    p = argparse.ArgumentParser(description="Pollinations GitHub+Google OAuth → create API key")
    p.add_argument("--email", required=True, help="Google email")
    p.add_argument("--password", required=True, help="Google password")
    p.add_argument("--headless", action="store_true", default=False, help="Run headless")
    p.add_argument("--no-headless", action="store_true", help="Show browser")
    p.add_argument("--proxy", default=None, help="HTTP/SOCKS proxy URL")
    p.add_argument("--timeout", type=int, default=300, help="Max seconds")
    p.add_argument("--retries", type=int, default=3, help="Max retries")
    p.add_argument("--anticaptcha-key", default=os.environ.get("ANTICAPTCHA_KEY", ""), help="Anticaptcha API key (or set ANTICAPTCHA_KEY env var)")
    return p.parse_args()

def prog(msg):
    print(f"PROGRESS:{msg}", flush=True)

def done(payload_json):
    print(f"DONE:{payload_json}", flush=True)

def err(msg):
    print(f"ERROR:{msg}", flush=True)

def emit_final_error(msg):
    err(msg)
    sys.exit(1)


SIGN_IN_URL = "https://enter.pollinations.ai/sign-in"
KEYS_URL = "https://enter.pollinations.ai/#keys"


async def solve_github_funcaptcha(page, anticaptcha_key):
    """Solve GitHub FunCaptcha (Arkose Labs) via anti-captcha.com API.

    GitHub signup uses FunCaptcha. anti-captcha solves it via their workers.
    Cost: ~$0.002 per solve.
    """
    if not anticaptcha_key:
        prog("No anticaptcha key — solve puzzle manually in browser")
        return False

    import urllib.request
    import urllib.error

    def api_post(endpoint, payload, timeout=30):
        url = f"https://api.anti-captcha.com/{endpoint}"
        data = json.dumps(payload).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())

    prog("Anti-Captcha: extracting FunCaptcha sitekey from GitHub...")

    # Extract public key from GitHub page
    public_key = await page.evaluate("""() => {
        // GitHub FunCaptcha embeds public key in script or data attribute
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
            const text = s.textContent || s.innerHTML || '';
            const match = text.match(/public_key["']?\\s*[:=]\\s*["']([A-F0-9-]{36})["']/i);
            if (match) return match[1];
        }
        // Check iframe src
        const iframes = document.querySelectorAll('iframe[src*="funcaptcha"], iframe[src*="arkoselabs"]');
        for (const f of iframes) {
            const src = f.src || '';
            const match = src.match(/pk=([A-F0-9-]{36})/i);
            if (match) return match[1];
        }
        // Check data attributes
        const el = document.querySelector('[data-public-key], [data-pkey]');
        if (el) return el.getAttribute('data-public-key') || el.getAttribute('data-pkey');
        // GitHub known public key
        return null;
    }""")

    # GitHub's known FunCaptcha public key
    if not public_key:
        public_key = "69A21A01-CC7B-B9C6-0F9A-B945B1153EC0"  # GitHub signup
        prog(f"Using known GitHub FunCaptcha key: {public_key}")
    else:
        prog(f"Extracted FunCaptcha key: {public_key}")

    page_url = page.url
    prog(f"Anti-Captcha: creating FunCaptcha task...")

    try:
        loop = asyncio.get_event_loop()
        create_payload = {
            "clientKey": anticaptcha_key,
            "task": {
                "type": "FunCaptchaTaskProxyless",
                "websiteURL": page_url,
                "websitePublicKey": public_key,
            }
        }

        create_resp = await loop.run_in_executor(None, lambda: api_post("createTask", create_payload))

        if create_resp.get("errorId", 0) != 0:
            prog(f"Anti-Captcha error: {create_resp.get('errorDescription', 'unknown')}")
            return False

        task_id = create_resp.get("taskId")
        prog(f"Anti-Captcha task created: {task_id} — waiting for solution...")

        # Poll for result (up to 120s)
        for attempt in range(40):
            await asyncio.sleep(3)
            result = await loop.run_in_executor(None, lambda: api_post("getTaskResult", {
                "clientKey": anticaptcha_key,
                "taskId": task_id,
            }))

            status = result.get("status", "")
            if status == "ready":
                token = result.get("solution", {}).get("token", "")
                if token:
                    prog(f"Anti-Captcha solved! Token: {token[:30]}...")

                    # Inject token into GitHub page
                    injected = await page.evaluate(f"""(token) => {{
                        // Try setting the FunCaptcha token
                        const inputs = document.querySelectorAll('input[name*="captcha"], input[name*="arkose"], input[type="hidden"]');
                        for (const inp of inputs) {{
                            if (inp.name.includes('captcha') || inp.name.includes('arkose') || inp.name.includes('fc-token')) {{
                                inp.value = token;
                                return 'input_set';
                            }}
                        }}
                        // Try callback
                        if (window.FC && window.FC.setToken) {{
                            window.FC.setToken(token);
                            return 'FC_callback';
                        }}
                        // Try ArkoseEnforcement
                        if (window.ArkoseEnforcement) {{
                            try {{ window.ArkoseEnforcement.setConfig({{data: {{token: token}}}}); return 'arkose_set'; }} catch {{}}
                        }}
                        // Fallback: set any hidden input
                        const hiddens = document.querySelectorAll('input[type="hidden"]');
                        for (const h of hiddens) {{
                            if (!h.value || h.value.length < 10) {{
                                h.value = token;
                                return 'hidden_set';
                            }}
                        }}
                        return 'no_target';
                    }}""", token)

                    prog(f"Token injection result: {injected}")
                    await asyncio.sleep(2)

                    # Try clicking submit/continue after solving
                    await click_by_text(page, ["Create account", "Continue", "Submit", "Verify"], timeout=3000)
                    await asyncio.sleep(3)
                    return True

            elif status == "processing":
                if attempt % 5 == 0:
                    prog(f"Anti-Captcha still processing... ({attempt * 3}s)")
            else:
                prog(f"Anti-Captcha unexpected status: {status}")

        prog("Anti-Captcha timeout (120s)")
        return False

    except Exception as e:
        prog(f"Anti-Captcha error: {e}")
        return False


async def click_by_text(page, keywords, timeout=5000):
    """Try clicking a button/link matching keywords."""
    for kw in keywords:
        try:
            btn = await page.wait_for_selector(f'button:has-text("{kw}"), a:has-text("{kw}"), [role="button"]:has-text("{kw}")', timeout=timeout)
            if btn:
                await btn.click()
                return kw
        except:
            continue
    # Fallback: JS click
    result = await page.evaluate("""(keywords) => {
        const btns = [...document.querySelectorAll('button, a, [role="button"], input[type="submit"]')];
        for (const kw of keywords) {
            const btn = btns.find(b => (b.textContent || '').toLowerCase().includes(kw.toLowerCase()) && b.offsetParent !== null);
            if (btn) { btn.click(); return btn.textContent.trim().substring(0, 30); }
        }
        return null;
    }""", keywords)
    return result


async def handle_google_oauth(google_page, email, password):
    """Fill Google email + password + handle interstitials."""
    # Email
    prog("Filling Google email...")
    try:
        email_input = await google_page.wait_for_selector('input[type="email"]', timeout=15000)
        await email_input.fill(email)
        await asyncio.sleep(0.5)
        await google_page.keyboard.press("Enter")
        await asyncio.sleep(3)
    except Exception as e:
        emit_final_error(f"Email input error: {e}")
        return False

    # Password
    try:
        prog("Filling Google password...")
        password_input = await google_page.wait_for_selector('input[type="password"]', timeout=15000)
        await password_input.fill(password)
        await asyncio.sleep(0.5)
        await google_page.keyboard.press("Enter")
        await asyncio.sleep(5)
    except Exception as e:
        emit_final_error(f"Password input error: {e}")
        return False

    # Handle interstitials
    prog("Handling Google interstitials...")
    for _ in range(15):
        try:
            clicked = await google_page.evaluate("""() => {
                const btns = [...document.querySelectorAll('button, [role="button"], a, input[type="submit"]')];
                const keywords = ['continue', 'allow', 'confirm', 'next', 'accept', 'yes', 'submit', 'i agree'];
                for (const btn of btns) {
                    const text = (btn.textContent || btn.value || '').toLowerCase().trim();
                    if (keywords.some(k => text.includes(k)) && btn.offsetParent !== null) {
                        btn.click();
                        return text.substring(0, 30);
                    }
                }
                return null;
            }""")
            if clicked:
                prog(f"Clicked: {clicked}")
                await asyncio.sleep(3)
        except:
            pass

        # Check if we left Google
        if "accounts.google.com" not in google_page.url:
            break
        await asyncio.sleep(1)

    return True


async def find_page_with_url(context, substring, main_page, timeout=15):
    """Find page containing substring in URL, checking popups and main page."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        for p in context.pages:
            if substring in p.url:
                return p
        if substring in main_page.url:
            return main_page
        try:
            new_page = await context.wait_for_event("page", timeout=3000)
            if substring in new_page.url:
                return new_page
        except:
            pass
        await asyncio.sleep(0.5)
    return None


async def _do_login_and_generate(page, args):
    """Main flow."""
    context = page.context

    # Step 1: Go to Pollinations sign-in
    prog("Opening Pollinations sign-in...")
    await page.goto(SIGN_IN_URL, timeout=30000, wait_until="domcontentloaded")
    await asyncio.sleep(3)

    # Step 2: Click "Sign in with GitHub"
    prog("Looking for 'Sign in with GitHub'...")
    clicked = await click_by_text(page, ["Sign in with GitHub", "GitHub", "Sign in with Github", "Continue with GitHub"])
    if clicked:
        prog(f"Clicked: {clicked}")
    else:
        emit_final_error("Could not find 'Sign in with GitHub' button")
        return
    await asyncio.sleep(3)

    # Step 3: GitHub page — might show "Sign in" or redirect to Google
    # Check if we're on GitHub
    prog("Checking GitHub page...")
    github_page = await find_page_with_url(context, "github.com", page, timeout=10)

    if github_page:
        prog(f"On GitHub: {github_page.url}")

        # If GitHub login page, click "Continue with Google"
        if "login" in github_page.url or "signin" in github_page.url:
            prog("GitHub login page — looking for 'Continue with Google'...")
            await asyncio.sleep(2)
            clicked = await click_by_text(github_page, ["Continue with Google", "Google", "Sign in with Google"])
            if clicked:
                prog(f"Clicked GitHub Google: {clicked}")
            await asyncio.sleep(3)

    # Step 4: Google OAuth
    prog("Looking for Google OAuth page...")
    google_page = await find_page_with_url(context, "accounts.google.com", page, timeout=15)

    if google_page:
        prog("Found Google OAuth page")
        ok = await handle_google_oauth(google_page, args.email, args.password)
        if not ok:
            return
        await asyncio.sleep(5)
    else:
        prog("No Google OAuth page found — might already be logged in")

    # Step 5: Handle GitHub "Create account" (for new GitHub accounts)
    # GitHub signup has a puzzle/captcha that takes time — wait up to 180s
    prog("Checking for GitHub account creation...")
    await asyncio.sleep(3)

    github_signup = False
    for p in context.pages:
        if "github.com" in p.url and ("signup" in p.url or "join" in p.url):
            github_signup = True
            prog("GitHub signup page detected — clicking Create account...")
            clicked = await click_by_text(p, ["Create account", "Join GitHub", "Sign up", "Create", "Continue"])
            if clicked:
                prog(f"GitHub: {clicked}")
            break

    if github_signup:
        # Try auto-solve with anticaptcha if key provided
        anticaptcha_key = args.anticaptcha_key or os.environ.get("ANTICAPTCHA_KEY", "")
        if anticaptcha_key:
            for p in context.pages:
                if "github.com" in p.url:
                    solved = await solve_github_funcaptcha(p, anticaptcha_key)
                    if solved:
                        prog("FunCaptcha solved via anti-captcha!")
                        await asyncio.sleep(5)
                    break

        prog("Waiting for GitHub signup puzzle (up to 180s — solve manually if anti-captcha fails)...")
        deadline_signup = time.time() + 180
        while time.time() < deadline_signup:
            signup_done = False
            for p in context.pages:
                url = p.url
                # Signup done if redirected to authorize page or pollinations
                if "authorize" in url or "oauth/authorize" in url:
                    signup_done = True
                    break
                if "pollinations.ai" in url and "sign-in" not in url:
                    signup_done = True
                    break
                # Still on GitHub but not signup anymore
                if "github.com" in url and "signup" not in url and "join" not in url:
                    signup_done = True
                    break

            if signup_done:
                prog("GitHub signup completed!")
                break

            # Try clicking any continue/verify/submit buttons periodically
            for p in context.pages:
                if "github.com" in p.url:
                    try:
                        await click_by_text(p, ["Continue", "Verify", "Submit", "Next", "Create account"], timeout=2000)
                    except:
                        pass
                    break

            await asyncio.sleep(3)

    # Step 6: Handle GitHub "Authorize" (OAuth to Pollinations)
    prog("Checking for GitHub Authorize...")
    await asyncio.sleep(3)

    # Try multiple times — authorize page might take a moment to load
    for attempt in range(10):
        authorized = False
        for p in context.pages:
            if "github.com" in p.url and ("authorize" in p.url or "oauth" in p.url):
                prog(f"Found GitHub authorize page (attempt {attempt+1})")
                clicked = await click_by_text(p, ["Authorize", "Allow", "Approve", "Grant access", "Authorize pollinations"])
                if clicked:
                    prog(f"GitHub authorize: {clicked}")
                    authorized = True
                    await asyncio.sleep(5)
                break

        # Also check main page
        if not authorized and "github.com" in page.url:
            clicked = await click_by_text(page, ["Authorize", "Allow", "Approve"])
            if clicked:
                prog(f"Authorized: {clicked}")
                authorized = True
                await asyncio.sleep(5)

        if authorized:
            break

        # Check if already redirected
        for p in context.pages:
            if "pollinations.ai" in p.url and "sign-in" not in p.url:
                authorized = True
                break
        if authorized:
            break

        await asyncio.sleep(2)

    # Wait for redirect back to Pollinations
    prog("Waiting for redirect to Pollinations...")
    deadline = time.time() + 30
    while time.time() < deadline:
        for p in context.pages:
            if "pollinations.ai" in p.url and "sign-in" not in p.url:
                page = p
                break
        if "pollinations.ai" in page.url and "sign-in" not in page.url:
            break
        await asyncio.sleep(1)

    if "pollinations.ai" not in page.url:
        emit_final_error(f"Login failed, stuck at: {page.url}")
        return

    prog("Logged in to Pollinations!")
    await asyncio.sleep(2)

    # Step 7: Navigate to keys page
    prog(f"Navigating to {KEYS_URL}...")
    await page.goto(KEYS_URL, timeout=30000, wait_until="domcontentloaded")
    await asyncio.sleep(3)

    # Step 8: Click "API Key" section if needed
    clicked = await click_by_text(page, ["API Key", "API Keys", "Keys"])
    if clicked:
        prog(f"Clicked: {clicked}")
        await asyncio.sleep(2)

    # Step 9: Click "Create" button
    prog("Looking for Create button...")
    clicked = await click_by_text(page, ["Create", "New", "Generate", "Add", "Create API Key", "New Key"])
    if clicked:
        prog(f"Clicked: {clicked}")
        await asyncio.sleep(3)

    # Step 10: Extract API key (sk_...)
    prog("Extracting API key...")
    api_key = None

    for attempt in range(5):
        api_key = await page.evaluate("""() => {
            const allText = document.body.innerText;
            const match = allText.match(/(sk_[A-Za-z0-9]{20,})/);
            if (match) return match[1];

            // Check inputs
            const inputs = document.querySelectorAll('input, code, pre, [data-testid*="key"]');
            for (const el of inputs) {
                const text = (el.value || el.textContent || '').trim();
                if (text.startsWith('sk_') && text.length > 20) return text;
            }
            return null;
        }""")

        if api_key:
            break
        prog(f"Key extraction attempt {attempt + 1}/5...")
        await asyncio.sleep(2)

    if api_key:
        prog(f"API key: {api_key[:15]}...")
        done(json.dumps({
            "api_key": api_key,
            "email": args.email,
            "source": "pollinations",
            "name": args.email,
        }))
    else:
        emit_final_error("Failed to extract API key")


async def main():
    args = parse_args()
    headless = args.headless and not args.no_headless

    prog("Starting Pollinations login...")

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


if __name__ == "__main__":
    asyncio.run(main())
