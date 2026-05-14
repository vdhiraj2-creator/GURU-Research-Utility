"""
Functional smoke tests for HoRatio after Vite migration.
Tests the live deployed app at jarvisphd-80ecb.web.app.
"""
from playwright.sync_api import sync_playwright
import time

URL = "https://jarvisphd-80ecb.web.app"
PASS = []
FAIL = []

def ok(name):
    PASS.append(name)
    print(f"  ✓ {name}")

def fail(name, reason=""):
    FAIL.append(name)
    print(f"  ✗ {name}" + (f": {reason}" if reason else ""))

def section(name):
    print(f"\n── {name}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})

    # Collect console errors (ignore known benign ones)
    js_errors = []
    page.on("console", lambda msg: js_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: js_errors.append(str(err)))

    # ── 1. Page load ──
    section("1. Page load")
    page.goto(URL, wait_until="networkidle", timeout=30000)
    time.sleep(2)

    title = page.title()
    if "HoRatio" in title or "Horatio" in title:
        ok("Page title contains HoRatio")
    else:
        fail("Page title", f"got: {title}")

    if page.locator("nav").count() > 0:
        ok("Nav bar rendered")
    else:
        fail("Nav bar rendered")

    # ── 2. Onboarding modal ──
    section("2. Onboarding modal")
    ob = page.locator("#onboarding-overlay, .ob-overlay, [id*=onboard]").first
    if ob.is_visible():
        ok("Onboarding modal visible on first load")
    else:
        fail("Onboarding modal visible")

    # Check provider buttons exist
    providers = ["groq", "gemini", "claude", "openai", "perplexity", "ollama"]
    for prov in providers:
        btn = page.locator(f'[data-prov="{prov}"], [onclick*="selectObProvider(\'{prov}\')"]').first
        if btn.count() > 0:
            ok(f"Onboarding: {prov} provider button")
        else:
            fail(f"Onboarding: {prov} provider button")

    # Select Groq and check key input appears
    page.evaluate("selectObProvider('groq')")
    time.sleep(0.3)
    key_input = page.locator("#ob-key-input")
    if key_input.is_visible() and key_input.get_attribute("placeholder", timeout=1000) in ("gsk_...", "gsk_"):
        ok("Onboarding: Groq key input placeholder correct")
    else:
        fail("Onboarding: Groq key input placeholder", key_input.get_attribute("placeholder") if key_input.count() else "not found")

    # Check OpenAI placeholder
    page.evaluate("selectObProvider('openai')")
    time.sleep(0.2)
    ph = key_input.get_attribute("placeholder")
    if ph and "sk-" in ph:
        ok("Onboarding: OpenAI key input placeholder correct")
    else:
        fail("Onboarding: OpenAI key input placeholder", ph)

    # Check Perplexity placeholder
    page.evaluate("selectObProvider('perplexity')")
    time.sleep(0.2)
    ph = key_input.get_attribute("placeholder")
    if ph and "pplx-" in ph:
        ok("Onboarding: Perplexity key input placeholder correct")
    else:
        fail("Onboarding: Perplexity key input placeholder", ph)

    # Dismiss onboarding
    page.evaluate("closeOnboarding()")
    time.sleep(0.5)
    if not page.locator("#onboarding-overlay").is_visible():
        ok("Onboarding: dismisses correctly")
    else:
        fail("Onboarding: dismiss failed")

    # ── 3. Navigation tabs ──
    section("3. Navigation tabs")
    # Check buttons exist in DOM
    tabs = [
        ("Chat",       "nav-chat",    "chat"),
        ("Library",    "nav-vault",   "vault"),
        ("References", "nav-refs",    "refs"),
        ("Viva",       "nav-viva",    "viva"),
        ("Present",    "nav-present", "present"),
        ("Archive",    "nav-horizon", "horizon"),
        ("Tools",      "nav-tools",   "tools"),
        ("Journal",    "nav-journal", "journal"),
        ("Data",       "nav-data",    "data"),
    ]
    for label, btn_id, tab_key in tabs:
        btn = page.locator(f"#{btn_id}")
        if btn.count() > 0:
            ok(f"Tab: {label} button exists")
        else:
            fail(f"Tab: {label} button exists", f"#{btn_id} not found")

    # Test navigation via setTab() global (tests the function works)
    for label, btn_id, tab_key in tabs:
        try:
            page.evaluate(f"setTab('{tab_key}')")
            time.sleep(0.15)
            ok(f"Tab: {label} navigates")
        except Exception as e:
            fail(f"Tab: {label} navigates", str(e)[:60])

    page.evaluate("setTab('chat')")

    # Go back to Chat
    page.evaluate("setTab('chat')")
    time.sleep(0.6)

    # ── 4. Chat interface ──
    section("4. Chat interface")
    chat_input = page.locator("#query-input").first
    try:
        chat_input.wait_for(state="visible", timeout=4000)
        visible = True
    except Exception:
        visible = False
    if visible:
        ok("Chat input visible")
    else:
        fail("Chat input visible")

    mode_btn = page.locator("#mode-btn, [id*=mode-btn]").first
    if mode_btn.count() > 0:
        ok("Mode selector button present")
    else:
        fail("Mode selector button present")

    send_btn = page.locator("#send-btn, button:has-text('Send')").first
    if send_btn.count() > 0:
        ok("Send button present")
    else:
        fail("Send button present")

    # ── 5. Mode selector ──
    section("5. Supervision mode selector")
    try:
        page.evaluate("toggleModePopover(new Event('click'))")
        time.sleep(0.3)
        popover = page.locator("#mode-popover")
        if popover.is_visible():
            ok("Mode popover opens")
            modes = ["supervise", "critique", "sources", "consistency", "expand", "examiner"]
            for mode in modes:
                item = page.locator(f'[data-mode="{mode}"], [onclick*="selectMode(\'{mode}\')"]').first
                if item.count() > 0:
                    ok(f"Mode: {mode}")
                else:
                    fail(f"Mode: {mode}")
            # Close it
            page.keyboard.press("Escape")
        else:
            fail("Mode popover opens")
    except Exception as e:
        fail("Mode popover", str(e)[:60])

    # ── 6. Settings / Config ──
    section("6. Config tab")
    try:
        page.evaluate("setTab('config')")
        time.sleep(0.5)

        # Check provider accordions
        for prov in ["gemini", "claude", "groq", "openai", "perplexity", "ollama"]:
            btn = page.locator(f"#btn-provider-{prov}")
            if btn.count() > 0:
                ok(f"Config: {prov} accordion")
            else:
                fail(f"Config: {prov} accordion")

        # Check per-mode provider dropdowns
        for mode in ["chat", "viva", "tools", "report"]:
            sel = page.locator(f"#cfg-prov-{mode}")
            if sel.count() > 0:
                options = sel.locator("option").all_text_contents()
                expected = {"Gemini", "Claude", "Groq", "OpenAI", "Perplexity", "Ollama"}
                found = set(options)
                missing = expected - found
                if not missing:
                    ok(f"Config: {mode} provider dropdown has all 6 options")
                else:
                    fail(f"Config: {mode} provider dropdown missing", str(missing))
            else:
                fail(f"Config: {mode} provider dropdown not found")
    except Exception as e:
        fail("Config tab", str(e)[:80])

    # ── 7. Theme toggle ──
    section("7. Theme toggle")
    try:
        has_light = page.evaluate("document.body.classList.contains('light-mode')")
        page.evaluate("document.getElementById('theme-toggle')?.click()")
        time.sleep(0.3)
        now_light = page.evaluate("document.body.classList.contains('light-mode')")
        if now_light != has_light:
            ok("Theme toggle switches mode")
        else:
            fail("Theme toggle switches mode")
        # Toggle back
        page.evaluate("document.getElementById('theme-toggle')?.click()")
    except Exception as e:
        fail("Theme toggle", str(e)[:60])

    # ── 8. Key JS globals present ──
    section("8. Key globals (Vite module exports)")
    globals_to_check = [
        "callBrain", "getProviderForMode", "getModelForMode", "_modelKey",
        "fetchOllamaModels", "isPro", "getSettings", "saveSettings",
        "_refreshProviderUI", "onModeProviderChange", "loadSettingsUI",
    ]
    for g in globals_to_check:
        exists = page.evaluate(f"typeof window.{g} === 'function'")
        if exists:
            ok(f"Global: {g}")
        else:
            fail(f"Global: {g} not a function")

    # ── 9. JS console errors ──
    section("9. JS errors")
    # Filter out known benign errors
    benign = ["favicon", "sw.js", "firebase", "ResizeObserver", "Non-Error"]
    real_errors = [e for e in js_errors if not any(b.lower() in e.lower() for b in benign)]
    if not real_errors:
        ok(f"No JS errors (ignored {len(js_errors) - len(real_errors)} benign)")
    else:
        for e in real_errors[:5]:
            fail("JS error", e[:120])

    # ── 10. Landing page ──
    section("10. Landing page (about.html)")
    page.goto(f"{URL}/about.html", wait_until="networkidle", timeout=20000)
    time.sleep(1)
    if "HoRatio" in page.title():
        ok("Landing page loads")
    else:
        fail("Landing page loads", page.title())
    if page.locator(".hero-title").count() > 0:
        ok("Landing page: hero title rendered")
    else:
        fail("Landing page: hero title rendered")
    if page.locator(".screenshots-grid img").count() >= 2:
        ok("Landing page: screenshots present")
    else:
        fail("Landing page: screenshots present")

    browser.close()

# ── Summary ──
print(f"\n{'='*50}")
print(f"RESULTS: {len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    print(f"\nFailed:")
    for f in FAIL:
        print(f"  ✗ {f}")
print('='*50)
exit(1 if FAIL else 0)
