const { chromium, devices } = require('playwright');
const fs = require('fs');

// Usage:
//   node yahoo_login_test.js someone@yahoo.com
//   node yahoo_login_test.js emails.txt       (one email per line)
//   EMAIL=foo@yahoo.com node yahoo_login_test.js

function loadEmails() {
  const arg = process.argv[2];
  if (process.env.EMAIL) return [process.env.EMAIL];
  if (arg && fs.existsSync(arg)) {
    return fs.readFileSync(arg, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  }
  return [arg || 'xadrbithethankmo@yahoo.com'];
}

async function checkEmail(context, email) {
  const page = await context.newPage();
  const t0 = Date.now();
  try {
    await page.goto('https://login.yahoo.com/', { waitUntil: 'commit', timeout: 60000 });
    const userSel = await page.waitForSelector(
      'input[name="username"], #login-username',
      { timeout: 20000 }
    );
    await userSel.fill(email);
    await page.click('#login-signin, button[name="signin"], button[type="submit"]').catch(() => page.keyboard.press('Enter'));

    // Race: error appears OR password field becomes visible
    const result = await Promise.race([
      page.waitForSelector('#username-error', { state: 'visible', timeout: 15000 }).then(() => 'error'),
      page.waitForSelector('#login-passwd, input[name="password"]', { state: 'visible', timeout: 15000 }).then(() => 'password'),
    ]).catch(() => 'unknown');

    const ms = Date.now() - t0;
    if (result === 'error') {
      const errEl = await page.$('#username-error');
      const txt = errEl ? (await errEl.innerText()).trim() : '';
      if (/don'?t recognize|not recognize|no account/i.test(txt)) {
        console.log(`[${ms}ms] ${email} => NOT FOUND: Sorry, we don't recognize this email.`);
      } else {
        console.log(`[${ms}ms] ${email} => ERROR: ${txt}`);
      }
    } else if (result === 'password') {
      console.log(`[${ms}ms] ${email} => EXISTS (password asked)`);
    } else {
      console.log(`[${ms}ms] ${email} => UNKNOWN (url=${page.url()})`);
    }
  } catch (e) {
    console.log(`[${Date.now() - t0}ms] ${email} => FAIL: ${e.message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
}

(async () => {
  const emails = loadEmails();
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    proxy: process.env.PROXY_SERVER
      ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER, password: process.env.PROXY_PASS }
      : undefined,
  });

  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    ignoreHTTPSErrors: true,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  // Block heavy assets to speed up loads
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(type)) return route.abort();
    route.continue();
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const startAll = Date.now();
  for (const email of emails) {
    await checkEmail(context, email);
  }
  console.log(`\nTotal: ${emails.length} checks in ${((Date.now() - startAll) / 1000).toFixed(1)}s (avg ${((Date.now() - startAll) / emails.length).toFixed(0)}ms)`);

  await browser.close();
})();
