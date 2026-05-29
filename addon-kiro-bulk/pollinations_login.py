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


async def extract_arkose_blob(page, timeout=15):
    """Extract the data[blob] parameter for Arkose Labs FunCaptcha.

    Uses multiple strategies:
    1. Network interception — catch POST to arkoselabs.com with data[blob]
    2. DOM extraction — read blob from page script tags / JS variables
    3. Context-level request interception — catches iframe requests too

    Returns the blob string or None if not captured.
    """
    blob_holder = {"blob": None}

    # --- Strategy 1: Page-level route interception ---
    async def intercept_arkose(route, request):
        try:
            post_data = request.post_data
            if post_data:
                import urllib.parse
                prog(f"Arkose request intercepted: {request.url[:80]}")
                # Log first 200 chars of post data for debugging
                prog(f"POST data preview: {post_data[:200]}")
                if "data%5Bblob%5D=" in post_data or "data[blob]=" in post_data:
                    params = urllib.parse.parse_qs(post_data)
                    blob_val = params.get("data[blob]", params.get("data%5Bblob%5D", [None]))[0]
                    if blob_val:
                        blob_holder["blob"] = blob_val
                        prog(f"Blob captured (network): {blob_val[:60]}...")
                elif "blob" in post_data.lower():
                    # Try JSON body
                    try:
                        body = json.loads(post_data)
                        blob_val = body.get("data", {}).get("blob") or body.get("blob")
                        if blob_val:
                            blob_holder["blob"] = blob_val
                            prog(f"Blob captured (JSON): {blob_val[:60]}...")
                    except:
                        pass
        except Exception as e:
            prog(f"Blob intercept error: {e}")
        await route.continue_()

    try:
        await page.route("**/arkoselabs.com/**", intercept_arkose)
        prog("Arkose request interceptor installed (page-level)")
    except Exception as e:
        prog(f"Page-level route failed: {e}")

    # --- Strategy 1b: Context-level interception (catches iframe requests) ---
    context = page.context
    async def intercept_context(route, request):
        try:
            post_data = request.post_data
            if post_data and "arkoselabs.com" in request.url:
                import urllib.parse
                prog(f"Arkose request (context): {request.url[:80]}")
                prog(f"POST data (context): {post_data[:200]}")
                if "data%5Bblob%5D=" in post_data or "data[blob]=" in post_data:
                    params = urllib.parse.parse_qs(post_data)
                    blob_val = params.get("data[blob]", params.get("data%5Bblob%5D", [None]))[0]
                    if blob_val:
                        blob_holder["blob"] = blob_val
                        prog(f"Blob captured (context): {blob_val[:60]}...")
                elif "blob" in post_data.lower():
                    try:
                        body = json.loads(post_data)
                        blob_val = body.get("data", {}).get("blob") or body.get("blob")
                        if blob_val:
                            blob_holder["blob"] = blob_val
                            prog(f"Blob captured (context JSON): {blob_val[:60]}...")
                    except:
                        pass
        except Exception as e:
            prog(f"Context intercept error: {e}")
        await route.continue_()

    try:
        await context.route("**/arkoselabs.com/**", intercept_context)
        prog("Arkose request interceptor installed (context-level)")
    except Exception as e:
        prog(f"Context-level route failed: {e}")

    # Wait for blob capture from network interception
    deadline = time.time() + timeout
    while time.time() < deadline and blob_holder["blob"] is None:
        await asyncio.sleep(0.5)

        # --- Strategy 2: DOM/JS extraction (fallback) ---
        if blob_holder["blob"] is None:
            try:
                blob_from_js = await page.evaluate("""() => {
                    // Method A: Check script tags for blob in Arkose enforcement config
                    const scripts = document.querySelectorAll('script');
                    for (const s of scripts) {
                        const text = s.textContent || '';
                        // Look for blob in enforcement setup: data: { blob: "..." }
                        const blobMatch = text.match(/["\']blob["\']\s*:\s*["\']([^"\']+)["\']/);
                        if (blobMatch) return { method: 'script_tag', blob: blobMatch[1] };
                        // Look for data-blob attribute setup
                        const dataMatch = text.match(/data-blob=["']([^"']+)["']/);
                        if (dataMatch) return { method: 'data_attr_script', blob: dataMatch[1] };
                    }

                    // Method B: Check data attributes on captcha elements
                    const captchaEls = document.querySelectorAll('[data-blob], [data-callback-data]');
                    for (const el of captchaEls) {
                        const blob = el.getAttribute('data-blob') || el.getAttribute('data-callback-data');
                        if (blob) return { method: 'data_attr', blob };
                    }

                    // Method C: Check iframe src for blob parameter
                    const iframes = document.querySelectorAll('iframe[src*="arkoselabs"], iframe[src*="funcaptcha"]');
                    for (const iframe of iframes) {
                        const src = iframe.src || '';
                        const blobParam = new URL(src).searchParams.get('data[blob]') ||
                                          new URL(src).searchParams.get('blob');
                        if (blobParam) return { method: 'iframe_src', blob: blobParam };
                    }

                    // Method D: Check window.__arkose or similar globals
                    if (window.__arkose_blob) return { method: 'global', blob: window.__arkose_blob };
                    if (window.enforcement && window.enforcement.config && window.enforcement.config.data) {
                        const blob = window.enforcement.config.data.blob;
                        if (blob) return { method: 'enforcement_config', blob };
                    }

                    return null;
                }""")

                if blob_from_js and blob_from_js.get("blob"):
                    blob_holder["blob"] = blob_from_js["blob"]
                    prog(f"Blob captured ({blob_from_js['method']}): {blob_from_js['blob'][:60]}...")
            except Exception as e:
                pass  # Page might not be ready yet, keep polling

    # Clean up interceptors
    try:
        await page.unroute("**/arkoselabs.com/**", intercept_arkose)
    except:
        pass
    try:
        await context.unroute("**/arkoselabs.com/**", intercept_context)
    except:
        pass

    return blob_holder["blob"]


async def solve_github_funcaptcha(page, anticaptcha_key, blob=None):
    """Solve GitHub OctoCaptcha (Arkose Labs FunCaptcha) via anti-captcha.com API.

    GitHub signup uses OctoCaptcha which wraps Arkose FunCaptcha.
    Public key: 747B83EC-2CA3-43AD-A7DF-701F286FBABA
    Subdomain: github-api.arkoselabs.com
    Token target: input[name="octocaptcha-token"]

    Args:
        blob: The data[blob] value extracted from Arkose Labs init request.
              Greatly improves solve success rate.

    Cost: ~$0.002 per solve.
    """
    if not anticaptcha_key:
        prog("No anticaptcha key — solve puzzle manually in browser")
        return False

    import urllib.request
    import urllib.error

    GITHUB_FUNCAPTCHA_KEY = "747B83EC-2CA3-43AD-A7DF-701F286FBABA"
    GITHUB_ARKOSE_SUBDOMAIN = "github-api.arkoselabs.com"

    def api_post(endpoint, payload, timeout=60):
        url = f"https://api.anti-captcha.com/{endpoint}"
        data = json.dumps(payload).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())

    prog(f"Anti-Captcha: solving GitHub FunCaptcha (key: {GITHUB_FUNCAPTCHA_KEY[:8]}...)")
    if blob:
        prog(f"Using extracted blob: {blob[:60]}...")
    else:
        prog("WARNING: No blob extracted — solve may fail without it")

    try:
        loop = asyncio.get_event_loop()

        task_def = {
            "type": "FunCaptchaTaskProxyless",
            "websiteURL": "https://octocaptcha.com",
            "websitePublicKey": GITHUB_FUNCAPTCHA_KEY,
            "funcaptchaApiJSSubdomain": GITHUB_ARKOSE_SUBDOMAIN,
        }

        if blob:
            task_def["data"] = json.dumps({"blob": blob})

        create_payload = {
            "clientKey": anticaptcha_key,
            "task": task_def,
        }

        prog("Anti-Captcha: creating task...")
        create_resp = await loop.run_in_executor(None, lambda: api_post("createTask", create_payload))

        if create_resp.get("errorId", 0) != 0:
            prog(f"Anti-Captcha createTask error: {create_resp.get('errorDescription', 'unknown')}")
            return False

        task_id = create_resp.get("taskId")
        prog(f"Anti-Captcha task {task_id} created — workers solving puzzle...")

        # Poll for result (up to 180s — FunCaptcha can take a while)
        for attempt in range(60):
            await asyncio.sleep(3)

            try:
                result = await loop.run_in_executor(None, lambda: api_post("getTaskResult", {
                    "clientKey": anticaptcha_key,
                    "taskId": task_id,
                }))
            except Exception as e:
                prog(f"Poll error: {e}")
                continue

            status = result.get("status", "")

            if status == "ready":
                token = result.get("solution", {}).get("token", "")
                if not token:
                    prog("Anti-Captcha returned ready but no token")
                    return False

                prog(f"FunCaptcha SOLVED! Token: {token[:40]}...")

                # Inject token into octocaptcha-token hidden input
                injected = await page.evaluate("""(token) => {
                    // Primary: set octocaptcha-token input (GitHub's expected field)
                    const octoInput = document.querySelector('input[name="octocaptcha-token"]');
                    if (octoInput) {
                        octoInput.value = token;

                        // Trigger change event so GitHub JS picks it up
                        octoInput.dispatchEvent(new Event('change', { bubbles: true }));
                        octoInput.dispatchEvent(new Event('input', { bubbles: true }));

                        // Also try to show success state
                        const spinner = document.querySelector('.js-octocaptcha-spinner');
                        if (spinner) spinner.classList.add('d-none');
                        const success = document.querySelector('.js-octocaptcha-success');
                        if (success) { success.classList.remove('d-none'); success.classList.add('d-flex'); }
                        // Hide captcha iframe
                        const frame = document.querySelector('.js-octocaptcha-frame');
                        if (frame) frame.style.display = 'none';

                        return 'octocaptcha_token_set';
                    }

                    // Fallback: try any captcha-related hidden input
                    const inputs = document.querySelectorAll('input[type="hidden"]');
                    for (const inp of inputs) {
                        if (inp.name.includes('captcha') || inp.name.includes('token')) {
                            inp.value = token;
                            return 'fallback_input_set: ' + inp.name;
                        }
                    }

                    return 'no_target_found';
                }""", token)

                prog(f"Token injection: {injected}")

                if 'no_target' in str(injected):
                    prog("WARNING: Could not find target input for token")
                    return False

                await asyncio.sleep(2)

                # Try to submit the form / click continue
                submitted = await page.evaluate("""() => {
                    // Try clicking the hidden submit button
                    const submitBtn = document.querySelector('.js-octocaptcha-form-submit');
                    if (submitBtn) {
                        submitBtn.hidden = false;
                        submitBtn.disabled = false;
                        submitBtn.click();
                        return 'submit_clicked';
                    }
                    // Try form submit
                    const form = document.querySelector('form.js-octocaptcha-parent');
                    if (form) {
                        form.submit();
                        return 'form_submitted';
                    }
                    return 'no_submit';
                }""")

                prog(f"Form submit: {submitted}")
                await asyncio.sleep(5)
                return True

            elif status == "processing" or status == "":
                if attempt % 5 == 0:
                    prog(f"Anti-Captcha solving... ({attempt * 3}s elapsed)")
            else:
                prog(f"Unexpected status: '{status}' — full response: {json.dumps(result)[:200]}")

        prog("Anti-Captcha timeout (180s)")
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


async def _click_reload_challenge(page, context):
    """Click 'Reload Challenge' button if FunCaptcha timed out.

    This button appears inside the Arkose iframe when the challenge expires
    ("That was not quite fast enough" / "Reload Challenge").
    Returns True if button was found and clicked.
    """
    # Check all pages and their iframes
    for p in context.pages:
        # Check main frame
        try:
            result = await p.evaluate("""() => {
                const all = [...document.querySelectorAll('button, a, [role="button"]')];
                for (const el of all) {
                    const text = (el.textContent || '').trim().toLowerCase();
                    if (text.includes('reload challenge') || text.includes('reload') || text.includes('try again')) {
                        if (el.offsetParent !== null) {
                            el.click();
                            return el.textContent.trim();
                        }
                    }
                }
                return null;
            }""")
            if result:
                prog(f"Clicked '{result}' on main page")
                return True
        except:
            pass

        # Check iframes (FunCaptcha runs inside an iframe)
        try:
            for frame in p.frames:
                if frame == p.main_frame:
                    continue
                try:
                    result = await frame.evaluate("""() => {
                        const all = [...document.querySelectorAll('button, a, [role="button"], div')];
                        for (const el of all) {
                            const text = (el.textContent || '').trim().toLowerCase();
                            if ((text.includes('reload challenge') || text.includes('reload') || text.includes('try again'))
                                && el.offsetParent !== null) {
                                el.click();
                                el.dispatchEvent(new MouseEvent('click', {bubbles: true}));
                                return el.textContent.trim();
                            }
                        }
                        return null;
                    }""")
                    if result:
                        prog(f"Clicked '{result}' in iframe: {frame.url[:60]}")
                        return True
                except:
                    continue
        except:
            pass

    return False


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
        # Wait for captcha page to load
        prog("Waiting for captcha page to load...")
        await asyncio.sleep(5)

        # Install blob interceptor BEFORE clicking Visual puzzle
        captcha_page = None
        for p in context.pages:
            if "github.com" in p.url:
                captcha_page = p
                break

        blob = None
        anticaptcha_key = args.anticaptcha_key or os.environ.get("ANTICAPTCHA_KEY", "")

        if captcha_page and anticaptcha_key:
            # Set up interception first — clicking Visual puzzle triggers the Arkose request
            prog("Installing Arkose blob interceptor...")
            blob_task = asyncio.create_task(extract_arkose_blob(captcha_page, timeout=15))

        # Click "Visual puzzle" button to activate the FunCaptcha
        if captcha_page:
            prog(f"Captcha page URL: {captcha_page.url}")
            prog("Clicking 'Visual puzzle' to activate captcha...")
            vp_clicked = False

            # Try 1: Direct Playwright selector on ALL pages (captcha might be on different page)
            target_page = captcha_page
            for p in context.pages:
                try:
                    btn = await p.wait_for_selector(
                        'button:has-text("Visual puzzle"), [data-action="visual"]',
                        timeout=3000
                    )
                    if btn:
                        target_page = p
                        await btn.scroll_into_view_if_needed()
                        await asyncio.sleep(0.5)
                        await btn.click(force=True)
                        vp_clicked = True
                        prog(f"Clicked 'Visual puzzle' (selector) on page: {p.url[:60]}")
                        break
                except:
                    continue

            # Try 2: JS click with very broad matching on all pages
            if not vp_clicked:
                for p in context.pages:
                    result = await p.evaluate("""() => {
                        // Match ANY clickable element containing "visual" or "puzzle"
                        const all = [...document.querySelectorAll('*')];
                        for (const el of all) {
                            // Only check direct text content (not children) to avoid false matches
                            const directText = [...el.childNodes]
                                .filter(n => n.nodeType === 3)
                                .map(n => n.textContent.trim())
                                .join(' ').toLowerCase();
                            const fullText = (el.textContent || '').trim().toLowerCase();
                            if ((directText.includes('visual puzzle') || fullText === 'visual puzzle')
                                && el.offsetParent !== null) {
                                el.scrollIntoView();
                                el.click();
                                // Also dispatch pointer events in case click() doesn't work
                                el.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
                                el.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
                                el.dispatchEvent(new MouseEvent('click', {bubbles: true}));
                                return { tag: el.tagName, text: el.textContent.trim().substring(0, 50), page: location.href };
                            }
                        }
                        return null;
                    }""")
                    if result:
                        vp_clicked = True
                        target_page = p
                        prog(f"Clicked via JS: {result}")
                        break

            # Try 3: Inside iframes on all pages
            if not vp_clicked:
                for p in context.pages:
                    try:
                        for frame in p.frames:
                            if frame == p.main_frame:
                                continue
                            prog(f"Checking iframe: {frame.url[:80]}")
                            result = await frame.evaluate("""() => {
                                const all = [...document.querySelectorAll('*')];
                                for (const el of all) {
                                    const text = (el.textContent || '').trim().toLowerCase();
                                    if (text.includes('visual puzzle') && text.length < 50 && el.offsetParent !== null) {
                                        el.click();
                                        el.dispatchEvent(new MouseEvent('click', {bubbles: true}));
                                        return el.textContent.trim();
                                    }
                                }
                                return null;
                            }""")
                            if result:
                                vp_clicked = True
                                prog(f"Clicked in iframe: {result}")
                                break
                    except Exception as e:
                        pass
                    if vp_clicked:
                        break

            if vp_clicked:
                captcha_page = target_page  # Update reference to the correct page
                await asyncio.sleep(5)  # Give time for FunCaptcha to load
            else:
                prog("WARNING: Could not click 'Visual puzzle' — captcha may not activate")

        # Wait for blob extraction to complete
        if captcha_page and anticaptcha_key:
            blob = await blob_task
            if blob:
                prog(f"Blob ready for anti-captcha submission")
            else:
                prog("Blob not captured — will attempt solve without it")

        # Try auto-solve with anticaptcha if key provided (with retry on challenge timeout)
        MAX_CAPTCHA_RETRIES = 3
        if anticaptcha_key and captcha_page:
            for captcha_attempt in range(MAX_CAPTCHA_RETRIES):
                prog(f"FunCaptcha solve attempt {captcha_attempt + 1}/{MAX_CAPTCHA_RETRIES}...")
                solved = await solve_github_funcaptcha(captcha_page, anticaptcha_key, blob=blob)
                if solved:
                    prog("FunCaptcha solved via anti-captcha!")
                    await asyncio.sleep(5)
                    break

                # Check if challenge timed out ("Reload Challenge" button visible)
                reloaded = await _click_reload_challenge(captcha_page, context)
                if reloaded:
                    prog(f"Challenge timed out — reloaded, retrying solve...")
                    await asyncio.sleep(3)
                    # Re-extract blob after reload (new session)
                    blob = await extract_arkose_blob(captcha_page, timeout=10)
                    if blob:
                        prog(f"New blob captured after reload: {blob[:40]}...")
                    continue
                else:
                    # No reload button — either solved or different state
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

    # Step 8: Click "API Key" section/tab if needed
    prog("Looking for API Key section...")
    await page.evaluate("""() => {
        const links = [...document.querySelectorAll('a, button, [role="tab"], div')];
        const apiKeyLink = links.find(l => {
            const text = (l.textContent || '').trim();
            return text === 'API Key' || text === 'API Keys' || text === 'Keys';
        });
        if (apiKeyLink) apiKeyLink.click();
    }""")
    await asyncio.sleep(2)

    # Step 9: Click the "Create" button specifically for API key creation
    prog("Looking for Create API Key button...")

    # Be more specific — look for Create button near "API Key" context
    clicked = await page.evaluate("""() => {
        const btns = [...document.querySelectorAll('button')];
        // First try exact matches
        for (const btn of btns) {
            const text = (btn.textContent || '').trim().toLowerCase();
            if ((text === 'create' || text === 'create api key' || text === 'new key' || text === 'generate')
                && btn.offsetParent !== null) {
                btn.click();
                return btn.textContent.trim();
            }
        }
        // Try buttons with + icon near key section
        for (const btn of btns) {
            const text = (btn.textContent || '').trim();
            if (text.includes('+') || btn.querySelector('[class*="plus"], [class*="add"]')) {
                btn.click();
                return text || 'plus-button';
            }
        }
        return null;
    }""")

    if clicked:
        prog(f"Clicked: {clicked}")
    else:
        prog("Trying click_by_text fallback...")
        clicked = await click_by_text(page, ["Create", "Create API Key", "New Key", "Generate"])
        if clicked:
            prog(f"Fallback clicked: {clicked}")

    await asyncio.sleep(3)

    # Step 9b: Handle confirmation popup/dialog if any
    prog("Checking for confirmation popup...")
    for _ in range(3):
        popup_clicked = await page.evaluate("""() => {
            // Look for modal/dialog buttons
            const modals = document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="popup"], [class*="overlay"]');
            for (const modal of modals) {
                const btns = modal.querySelectorAll('button');
                for (const btn of btns) {
                    const text = (btn.textContent || '').trim().toLowerCase();
                    if (['create', 'confirm', 'ok', 'yes', 'generate', 'submit'].includes(text) && btn.offsetParent !== null) {
                        btn.click();
                        return btn.textContent.trim();
                    }
                }
            }
            // Also try any visible dialog button
            const allBtns = document.querySelectorAll('button');
            for (const btn of allBtns) {
                const text = (btn.textContent || '').trim().toLowerCase();
                if (text === 'create' && btn.offsetParent !== null) {
                    btn.click();
                    return 'create-btn';
                }
            }
            return null;
        }""")
        if popup_clicked:
            prog(f"Popup confirmed: {popup_clicked}")
            await asyncio.sleep(2)
            break
        await asyncio.sleep(1)

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
