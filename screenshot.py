from playwright.sync_api import sync_playwright
import time

URL = "https://jarvisphd-80ecb.web.app"

CHAT_HTML = """
(function() {
  var container = null;
  var ids = ['thread','chat','messages','conversation','chat-body','main-content'];
  for (var id of ids) {
    var el = document.getElementById(id);
    if (el) { container = el; break; }
  }
  if (!container) {
    // broader search
    var all = document.querySelectorAll('div[id]');
    for (var el of all) {
      if (/thread|chat|message|convers/i.test(el.id)) { container = el; break; }
    }
  }
  if (!container) { console.log('no container'); return 'not found'; }
  console.log('found:', container.id);
  container.innerHTML = '';

  var msgs = [
    {
      role: 'user',
      text: 'Does proportionality under Art 36 TFEU constrain Member States differently to proportionality under the Charter of Fundamental Rights?'
    },
    {
      role: 'horatio',
      html: `<p>That framing conflates two analytically distinct operations of proportionality.</p>
<p>Under <strong>Art 36 TFEU</strong>, the Court applies a means–ends rationality test: the measure must be <em>suitable</em> and <em>necessary</em> to achieve a legitimate public interest. Member States retain meaningful latitude — see <em>Pharmaceutical Society</em> [1989] ECR 1235.</p>
<p>Under the <strong>Charter</strong> (Art 52(1)), proportionality is a stricter, rights-calibrated standard. Necessity must be established against the fundamental right as such, not merely the policy objective. Charter review admits no equivalent deference — see <em>Åkerberg Fransson</em> (C-617/10) [2013].</p>
<p><strong>Supervision note —</strong> Your thesis would benefit from addressing whether post-<em>Lisbon</em> case law has narrowed this gap in practice. Can you identify a judgment where the Court applied both standards to the same measure?</p>`
    }
  ];

  msgs.forEach(function(m) {
    var div = document.createElement('div');
    div.style.cssText = 'padding: 1.1rem 1.4rem;';

    var role = document.createElement('div');
    role.style.cssText = 'font-family:"Space Mono",monospace;font-size:0.55rem;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:0.5rem;opacity:0.45;';
    role.textContent = m.role === 'user' ? 'You' : 'HoRatio';

    var bubble = document.createElement('div');
    if (m.role === 'user') {
      bubble.style.cssText = 'background:var(--surface2);padding:0.75rem 1rem;border-radius:8px;font-size:0.93rem;line-height:1.65;max-width:72%;margin-left:auto;';
      bubble.textContent = m.text;
    } else {
      bubble.style.cssText = 'font-size:0.93rem;line-height:1.75;max-width:100%;';
      bubble.innerHTML = m.html;
    }

    div.appendChild(role);
    div.appendChild(bubble);
    container.appendChild(div);
  });
  return 'done:' + container.id;
})();
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    def shoot(theme, suffix):
        page = browser.new_page(viewport={"width": 900, "height": 680})
        page.goto(URL, wait_until="networkidle", timeout=30000)
        time.sleep(2)

        # Dismiss onboarding modal - click Skip
        try:
            page.click('button:has-text("Skip")', timeout=3000)
            time.sleep(1)
        except Exception:
            pass

        # Click the Chat nav tab
        try:
            page.click('nav button:has-text("Chat")', timeout=3000)
            time.sleep(0.5)
        except Exception:
            # try tab/link with Chat text
            try:
                page.click('text=Chat', timeout=2000)
                time.sleep(0.5)
            except Exception:
                pass

        # Set theme
        page.evaluate("document.body.classList.remove('light-mode')")
        if theme == 'light':
            page.evaluate("document.body.classList.add('light-mode')")

        # Inject chat
        result = page.evaluate(CHAT_HTML)
        print(f"  inject result: {result}")
        time.sleep(0.6)

        page.screenshot(path=f"public/screenshot-{suffix}.png", full_page=False)
        print(f"  {suffix} screenshot saved")
        page.close()

    shoot('dark', 'dark')
    shoot('light', 'light')
    browser.close()

print("done")
