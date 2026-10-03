const { chromium, devices } = require('playwright');
const fs = require('fs');

// Usage:
//   node yahoo_login_test.js someone@yahoo.com
//   node yahoo_login_test.js emails.txt
//   CONCURRENCY=10 node yahoo_login_test.js emails.txt
//   EMAIL=foo@yahoo.com node yahoo_login_test.js

const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5', 10);

function loadEmails() {
  const arg = process.argv[2];
  if (process.env.EMAIL) return [process.env.EMAIL];
  if (arg && fs.existsSync(arg)) {
    return fs.readFileSync(arg, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  }
  return [arg || 'xadrbithethankmo@yahoo.com'];
}

async function checkEmail(browser, email) {
  const t0 = Date.now();
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

  const page = await context.newPage();
  let result = 'UNKNOWN';
  let detail = '';
  try {
    await page.goto('https://login.yahoo.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('input[name="username"], #login-username', { timeout: 20000 });
    await page.fill('input[name="username"], #login-username', email);

    // Click submit AND wait for either: URL change to password page, or error element visible
    await Promise.all([
      Promise.race([
        page.waitForURL(/challenge\/password|\/account\/challenge/, { timeout: 15000 }).then(() => (result = 'EXISTS')),
        page.waitForSelector('#username-error', { state: 'visible', timeout: 15000 }).then(async (el) => {
          detail = (await el.innerText()).trim();
          if (/don'?t recognize|not recognize|no account|invalid/i.test(detail)) result = 'NOT_FOUND';
          else result = 'ERROR';
        }),
      ]).catch(() => {}),
      page.click('#login-signin, button[name="signin"], button[type="submit"]').catch(() => page.keyboard.press('Enter')),
    ]);

    // Fallback: look at URL after a short settle
    if (result === 'UNKNOWN') {
      await page.waitForTimeout(1000);
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
  } finally {
    await context.close();
  }
  const ms = Date.now() - t0;
  const line = result === 'NOT_FOUND'
    ? `[${ms}ms] ${email} => NOT FOUND: Sorry, we don't recognize this email.`
    : result === 'EXISTS'
    ? `[${ms}ms] ${email} => EXISTS (password asked)`
    : `[${ms}ms] ${email} => ${result}${detail ? ': ' + detail : ''}`;
  console.log(line);
  return { email, result, ms, detail };
}

async function runPool(browser, emails, concurrency) {
  const queue = emails.slice();
  const results = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const email = queue.shift();
      if (!email) break;
      results.push(await checkEmail(browser, email));
    }
  });
  await Promise.all(workers);
  return results;
}

(async () => {
  const emails = loadEmails();
  console.log(`[*] ${emails.length} emails, concurrency=${CONCURRENCY}`);
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--disable-gpu'],
    proxy: process.env.PROXY_SERVER
      ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER, password: process.env.PROXY_PASS }
      : undefined,
  });

  const startAll = Date.now();
  const results = await runPool(browser, emails, CONCURRENCY);
  const totalMs = Date.now() - startAll;

  const exists = results.filter(r => r.result === 'EXISTS').length;
  const notFound = results.filter(r => r.result === 'NOT_FOUND').length;
  const failed = results.filter(r => r.result === 'FAIL' || r.result === 'UNKNOWN' || r.result === 'ERROR').length;

  console.log(`\n--- SUMMARY ---`);
  console.log(`Total: ${emails.length} in ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`Avg: ${(totalMs / emails.length).toFixed(0)}ms per check`);
  console.log(`EXISTS: ${exists}  |  NOT_FOUND: ${notFound}  |  FAILED: ${failed}`);

  await browser.close();
})();
