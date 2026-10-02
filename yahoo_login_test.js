const { chromium } = require('playwright');

const EMAIL = 'xadrbithethankmo@yahoo.com';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--incognito', '--no-sandbox', '--disable-blink-features=AutomationControlled'],
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  try {
    console.log('[*] Opening login.yahoo.com ...');
    let lastErr;
    for (let i = 0; i < 4; i++) {
      try {
        await page.goto('https://login.yahoo.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        lastErr = null; break;
      } catch (e) { lastErr = e; console.log('[*] retry', i + 1, e.message.split('\n')[0]); await page.waitForTimeout(2000); }
    }
    if (lastErr) throw lastErr;
    await page.waitForTimeout(3000);
    console.log('[*] Page title:', await page.title());
    console.log('[*] URL:', page.url());

    const html = await page.content();
    console.log('[*] HTML length:', html.length);
    console.log('[*] HTML snippet:', html.slice(0, 800));
    console.log('[*] Entering email:', EMAIL);
    const userSel = await page.waitForSelector('input[name="username"], #login-username, input[type="email"]', { timeout: 30000 });
    await userSel.fill(EMAIL);
    const submitSel = await page.$('#login-signin, button[name="signin"], button[type="submit"]');
    if (submitSel) await submitSel.click(); else await page.keyboard.press('Enter');

    // Wait for either password page, error, or redirect
    await page.waitForTimeout(5000);

    // Check for "not recognized" error
    const errorEl = await page.$('#username-error, .error-msg, [data-error]');
    let errorText = '';
    if (errorEl) {
      errorText = (await errorEl.innerText()).trim();
    }

    const url = page.url();
    const passwordVisible = await page.$('#login-passwd');

    if (errorText && /don'?t recognize|not recognize|no account|invalid/i.test(errorText)) {
      console.log('[LOG] Mail not login:', errorText);
      console.log("[LOG] Sorry, we don't recognize this email.");
    } else if (passwordVisible) {
      console.log('[LOG] Password page shown. Asking for password.');
      console.log('[LOG] Password: <enter password here>');
    } else {
      console.log('[LOG] Current URL:', url);
      console.log('[LOG] Error text (if any):', errorText || '(none)');
      const bodyText = (await page.locator('body').innerText()).slice(0, 500);
      console.log('[LOG] Page snippet:', bodyText);
    }
  } catch (e) {
    console.log('[ERROR]', e.message);
  } finally {
    await browser.close();
  }
})();
