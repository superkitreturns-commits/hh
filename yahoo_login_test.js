const { chromium, devices } = require('playwright');

const EMAIL = process.env.EMAIL || process.argv[2] || 'xadrbithethankmo@yahoo.com';
const URLS = [
  'https://login.yahoo.com/',
  'https://login.yahoo.com/?.src=ym&done=https%3A%2F%2Fmail.yahoo.com',
  'https://mail.yahoo.com/',
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium',
    args: [
      '--incognito',
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-dev-shm-usage',
    ],
    proxy: process.env.PROXY_SERVER
      ? {
          server: process.env.PROXY_SERVER,
          username: process.env.PROXY_USER,
          password: process.env.PROXY_PASS,
        }
      : process.env.HTTPS_PROXY
      ? { server: process.env.HTTPS_PROXY }
      : undefined,
  });

  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    ignoreHTTPSErrors: true,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
      'sec-ch-ua': '"Chromium";v="127", "Not;A=Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  async function tryGoto() {
    for (const url of URLS) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[*] GET ${url} (try ${attempt})`);
          const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
          const status = resp && resp.status();
          const html = await page.content();
          const edgeBlock = /Edge: Too Many Requests|Access Denied/i.test(html);
          console.log(`    status=${status} len=${html.length} edgeBlock=${edgeBlock}`);
          if (!edgeBlock && html.length > 500) return true;
          await page.waitForTimeout(3000 * attempt);
        } catch (e) {
          console.log('    err:', e.message.split('\n')[0]);
          await page.waitForTimeout(2000 * attempt);
        }
      }
    }
    return false;
  }

  try {
    const ok = await tryGoto();
    if (!ok) {
      console.log('[LOG] Yahoo edge is blocking this network. Final page body:');
      console.log((await page.content()).slice(0, 300));
      return;
    }

    console.log('[*] Page title:', await page.title());
    console.log('[*] URL:', page.url());

    console.log('[*] Entering email:', EMAIL);
    const userSel = await page.waitForSelector(
      'input[name="username"], #login-username, input[type="email"]',
      { timeout: 30000 }
    );
    await userSel.fill(EMAIL);
    const submit = await page.$('#login-signin, button[name="signin"], button[type="submit"]');
    if (submit) await submit.click();
    else await page.keyboard.press('Enter');

    await page.waitForTimeout(5000);

    const errorEl = await page.$('#username-error, .error-msg, [data-error]');
    const errorText = errorEl ? (await errorEl.innerText()).trim() : '';
    const passwordVisible = await page.$('#login-passwd, input[name="password"]');

    if (errorText && /don'?t recognize|not recognize|no account|invalid/i.test(errorText)) {
      console.log('[LOG] Mail not login:', errorText);
      console.log("[LOG] Sorry, we don't recognize this email.");
    } else if (passwordVisible) {
      console.log('[LOG] Password page shown. Asking for password.');
      console.log('[LOG] Password: <enter password here>');
    } else {
      console.log('[LOG] URL:', page.url(), '| error:', errorText || '(none)');
      console.log('[LOG] snippet:', (await page.locator('body').innerText()).slice(0, 400));
    }
  } catch (e) {
    console.log('[ERROR]', e.message.split('\n')[0]);
  } finally {
    await browser.close();
  }
})();
