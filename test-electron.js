const { _electron: electron } = require('playwright');
const path = require('path');

const PROJECT = __dirname;
const pass = [], fail = [];

function ok(name)         { pass.push(name); console.log(`  ✓ ${name}`); }
function bad(name, why='') { fail.push(name); console.log(`  ✗ ${name}${why ? ': ' + why : ''}`); }
function section(name)    { console.log(`\n── ${name}`); }

(async () => {
  console.log('Launching Electron app...');
  const app = await electron.launch({
    args: [PROJECT],
    cwd: PROJECT,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await new Promise(r => setTimeout(r, 3000));

  const jsErrors = [];
  window.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); });
  window.on('pageerror', err => jsErrors.push(String(err)));

  // ── 1. App loads ──
  section('1. App loads');
  const appName = await app.evaluate(({ app }) => app.getName());
  appName ? ok(`Electron app name: ${appName}`) : bad('Electron app name');

  const pageTitle = await window.title();
  (pageTitle.includes('Horatio') || pageTitle.includes('HoRatio'))
    ? ok(`Window title: ${pageTitle}`)
    : bad('Window title', pageTitle);

  (await window.locator('nav').count()) > 0 ? ok('Nav bar rendered') : bad('Nav bar rendered');

  // ── 2. Screenshots ──
  section('2. Screenshots');
  await window.screenshot({ path: path.join(PROJECT, 'test-electron-dark.png') });
  ok('Dark mode screenshot saved');

  await window.evaluate(() => document.body.classList.add('light-mode'));
  await new Promise(r => setTimeout(r, 300));
  await window.screenshot({ path: path.join(PROJECT, 'test-electron-light.png') });
  ok('Light mode screenshot saved');
  await window.evaluate(() => document.body.classList.remove('light-mode'));

  // ── 3. Onboarding ──
  section('3. Onboarding modal');
  const ob = window.locator('#onboarding-overlay').first();
  if (await ob.isVisible()) {
    ok('Onboarding modal appears');
    for (const prov of ['groq', 'gemini', 'claude', 'openai', 'perplexity', 'ollama']) {
      (await window.locator(`[data-prov="${prov}"]`).count()) > 0
        ? ok(`Provider button: ${prov}`) : bad(`Provider button: ${prov}`);
    }
    await window.evaluate(() => closeOnboarding());
    await new Promise(r => setTimeout(r, 500));
    !(await ob.isVisible()) ? ok('Onboarding dismisses') : bad('Onboarding dismisses');
  } else {
    ok('Onboarding already dismissed (returning user)');
  }

  // ── 4. Navigation ──
  section('4. Navigation tabs');
  const tabs = [
    ['Chat',       'nav-chat',    'chat'],
    ['Library',    'nav-vault',   'vault'],
    ['References', 'nav-refs',    'refs'],
    ['Viva',       'nav-viva',    'viva'],
    ['Tools',      'nav-tools',   'tools'],
    ['Journal',    'nav-journal', 'journal'],
  ];
  for (const [label, btnId, tabKey] of tabs) {
    if ((await window.locator(`#${btnId}`).count()) > 0) {
      await window.evaluate(k => setTab(k), tabKey);
      await new Promise(r => setTimeout(r, 150));
      ok(`Tab: ${label}`);
    } else {
      bad(`Tab: ${label}`, `#${btnId} not found`);
    }
  }

  await window.evaluate(() => setTab('chat'));
  await new Promise(r => setTimeout(r, 500));

  // ── 5. Chat interface ──
  section('5. Chat interface');
  const chatInput = window.locator('#query-input').first();
  try {
    await chatInput.waitFor({ state: 'visible', timeout: 4000 });
    ok('Chat input visible');
  } catch { bad('Chat input visible'); }

  (await window.locator('#send-btn, button:has-text("Send")').count()) > 0
    ? ok('Send button present') : bad('Send button present');
  (await window.locator('#mode-btn').count()) > 0
    ? ok('Mode selector present') : bad('Mode selector present');

  // ── 6. Key globals ──
  section('6. Key globals from Vite modules');
  for (const g of ['callBrain','getProviderForMode','getModelForMode',
                    'getSettings','saveSettings','isPro','setTab']) {
    const exists = await window.evaluate(name => typeof window[name] === 'function', g);
    exists ? ok(`window.${g}`) : bad(`window.${g} not a function`);
  }

  // ── 7. Config tab ──
  section('7. Config tab');
  await window.evaluate(() => setTab('config'));
  await new Promise(r => setTimeout(r, 400));
  for (const prov of ['gemini','claude','groq','openai','perplexity','ollama']) {
    (await window.locator(`#btn-provider-${prov}`).count()) > 0
      ? ok(`Config: ${prov} accordion`) : bad(`Config: ${prov} accordion`);
  }

  // ── 8. JS errors ──
  section('8. JS errors');
  const benign = ['favicon','ResizeObserver','Non-Error','AudioContext','Cannot read properties of null'];
  const realErrors = jsErrors.filter(e => !benign.some(b => e.toLowerCase().includes(b.toLowerCase())));
  realErrors.length === 0
    ? ok(`No JS errors (${jsErrors.length - realErrors.length} benign ignored)`)
    : realErrors.slice(0, 5).forEach(e => bad('JS error', e.slice(0, 120)));

  await app.close();

  // ── Summary ──
  console.log(`\n${'='.repeat(50)}`);
  console.log(`RESULTS: ${pass.length} passed, ${fail.length} failed`);
  if (fail.length) { console.log('\nFailed:'); fail.forEach(f => console.log(`  ✗ ${f}`)); }
  console.log('='.repeat(50));
  process.exit(fail.length ? 1 : 0);
})();
