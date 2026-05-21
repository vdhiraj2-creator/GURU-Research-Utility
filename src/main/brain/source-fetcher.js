// brain/source-fetcher.js
// Fetches source content from URLs and local PDF files.
// Strategy: fast built-in fetch first; Playwright fallback for JS-heavy pages.

const { parse: parseHtml } = require('node-html-parser');
const fs                   = require('fs');
const path                 = require('path');

// Domains known to require JS rendering — Playwright used automatically.
const JS_HEAVY_DOMAINS = [
  'jstor.org', 'heinonline.org', 'westlaw.com', 'lexisnexis.com',
  'tandfonline.com', 'springer.com', 'wiley.com',
];

class SourceFetcher {
  // Fetch a URL and return { title, text, metadata }.
  async fetchUrl(url) {
    const requiresJS = JS_HEAVY_DOMAINS.some(d => url.includes(d));
    return requiresJS
      ? this._fetchWithPlaywright(url)
      : this._fetchWithBuiltIn(url);
  }

  // Parse a local PDF file and return { title, text, metadata }.
  async fetchPdf(filePath) {
    const pdfParse = require('pdf-parse');
    const buffer   = fs.readFileSync(filePath);
    const data     = await pdfParse(buffer);

    return {
      title:    path.basename(filePath, '.pdf'),
      text:     this._cleanText(data.text),
      metadata: {
        pages:    data.numpages,
        info:     data.info,
        source:   'pdf',
        filePath,
      },
    };
  }

  // ── Private ────────────────────────────────────────────────────────────

  async _fetchWithBuiltIn(url) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HoRatioBrain/1.0; research bot)',
        'Accept':     'text/html,application/xhtml+xml,application/pdf',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

    const contentType = res.headers.get('content-type') || '';

    // PDF served over HTTP — write to temp file and parse
    if (contentType.includes('pdf')) {
      const buf      = Buffer.from(await res.arrayBuffer());
      const tmp      = path.join(require('os').tmpdir(), `horatio_${Date.now()}.pdf`);
      fs.writeFileSync(tmp, buf);
      try {
        const result = await this.fetchPdf(tmp);
        result.metadata.source = 'url-pdf';
        result.metadata.url    = url;
        return result;
      } finally {
        fs.unlinkSync(tmp);
      }
    }

    const html  = await res.text();
    const root  = parseHtml(html);

    // Remove noise nodes before extracting text
    root.querySelectorAll('script, style, nav, footer, header, aside, iframe, noscript')
        .forEach(el => el.remove());

    const title = root.querySelector('title')?.text?.trim()
               || root.querySelector('h1')?.text?.trim()
               || url;

    // Prefer <article> or <main>; fall back to <body>
    const bodyEl = root.querySelector('article')
                || root.querySelector('main')
                || root.querySelector('body');

    const text = this._cleanText(bodyEl?.text || root.text);

    return { title, text, metadata: { source: 'url', url, contentType } };
  }

  async _fetchWithPlaywright(url) {
    // Lazy-load Playwright only when needed — avoids startup cost for simple pages.
    const { chromium } = require('playwright');
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const title = await page.title();
      const html  = await page.content();
      const root  = parseHtml(html);
      root.querySelectorAll('script, style, nav, footer, header, aside')
          .forEach(el => el.remove());

      const bodyEl = root.querySelector('article')
                  || root.querySelector('main')
                  || root.querySelector('body');

      const text = this._cleanText(bodyEl?.text || root.text);
      return { title, text, metadata: { source: 'playwright', url } };
    } finally {
      await browser?.close();
    }
  }

  // Collapse whitespace and trim to a sensible max length (~50k chars).
  _cleanText(raw = '') {
    return raw
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50000);
  }
}

module.exports = new SourceFetcher();
