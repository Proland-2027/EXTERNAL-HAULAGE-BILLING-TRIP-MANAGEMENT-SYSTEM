const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8081';
const SHOTS = './shots/';
const errors = [];
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('response', r => { if (r.status() >= 400 && r.url().includes('/wp-json/')) errors.push('http ' + r.status() + ' ' + r.url()); });
  const step = async (name, fn) => { try { await fn(); console.log('OK   ' + name); } catch (e) { console.log('FAIL ' + name + ': ' + e.message.split('\n')[0]); await page.screenshot({ path: SHOTS + 'fail-' + name.replace(/\W+/g, '_') + '.png' }); } };
  const shot = n => page.screenshot({ path: SHOTS + n + '.png', fullPage: true });
  const settle = async (ms = 600) => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(ms); };
  const login = async (u, p) => { await page.goto(BASE + '/wp-login.php?redirect_to=' + encodeURIComponent(BASE + '/production-planning/')); await page.fill('#user_login', u); await page.fill('#user_pass', p); await page.click('#wp-submit'); await page.waitForSelector('.pp-nav', { timeout: 20000 }); };

  await step('login admin', async () => { await login('admin', 'Admin#2026!'); await settle(); await shot('01-dashboard-empty'); });
  await step('sales new request 20 x SPGEY18', async () => {
    await page.goto(BASE + '/production-planning/#/sales/new'); await settle();
    await page.fill('input[name=customer]', 'Demo Customer Ltd'); await page.fill('input[name=sales_order_ref]', 'SO-2026-1001');
    await page.selectOption('#sr-prod', 'SPGEY18'); await page.fill('#sr-qty', '20'); await page.fill('input[name=delivery_date]', '2026-11-30'); await page.selectOption('select[name=priority]', 'Normal'); await page.fill('textarea[name=remarks]', 'Demo scenario: 20 units');
    await settle(1200); await shot('02-new-request-bom-preview');
    await page.click('#sr-new button[type=submit]'); await page.waitForSelector('text=Plan versions', { timeout: 15000 }); await settle(); await shot('03-request-detail');
  });
  let reqId;
  await step('generate plan', async () => {
    reqId = page.url().split('/sales/')[1]; await page.goto(BASE + '/production-planning/#/planning/' + reqId); await settle();
    await page.click('#pl-run'); await page.waitForSelector('#pl-confirm', { timeout: 30000 }); await settle(); await shot('04-proposed-plan');
  });
  await step('confirm plan', async () => { await page.click('#pl-confirm'); await page.click('#pp-confirm-ok'); await page.waitForSelector('#pl-refc', { timeout: 30000 }); await settle(); await shot('05-confirmed-plan'); });
  await step('second competing request 10 x SPGEY22 urgent', async () => {
    await page.goto(BASE + '/production-planning/#/sales/new'); await settle();
    await page.fill('input[name=customer]', 'Second Customer'); await page.selectOption('#sr-prod', 'SPGEY22'); await page.fill('#sr-qty', '10'); await page.fill('input[name=delivery_date]', '2026-11-10'); await page.selectOption('select[name=priority]', 'Urgent');
    await page.click('#sr-new button[type=submit]'); await page.waitForSelector('text=Plan versions', { timeout: 15000 });
    const id2 = page.url().split('/sales/')[1]; await page.goto(BASE + '/production-planning/#/planning/' + id2); await settle();
    await page.click('#pl-run'); await page.waitForSelector('#pl-confirm', { timeout: 30000 }); await settle(); await shot('06-second-plan-competing');
    await page.click('#pl-confirm'); await page.click('#pp-confirm-ok'); await page.waitForSelector('#pl-refc', { timeout: 30000 });
  });
  await step('gantt', async () => { await page.goto(BASE + '/production-planning/#/gantt'); await settle(1000); await page.waitForSelector('#gantt svg'); await shot('07-gantt'); });
  await step('work orders cutting + record output', async () => {
    await page.goto(BASE + '/production-planning/#/workorders?department=GB-CUT'); await settle(); await shot('08-work-orders-cutting');
    await page.click('tr:has-text("SF-SPF-EY18") a.btn'); await settle(); await page.click('#wo-start'); await settle();
    await page.click('#wo-entry'); await page.fill('input[name=good_qty]', '20'); await page.fill('input[name=manpower]', '2'); await page.click('#en-ok'); await page.waitForSelector('#wo-transfer', { timeout: 15000 }); await settle(); await shot('09-wo-detail-after-output');
  });
  await step('transfer to bending and receive', async () => {
    await page.click('#wo-transfer'); await page.fill('input[name=qty]', '12'); await page.click('#tr-ok'); await settle(); await shot('10-transfer-sent');
    await page.goto(BASE + '/production-planning/#/wip'); await settle(); await shot('11-wip-pending');
    await page.click('[data-receive]'); await page.click('#tr-ok'); await settle(); await shot('12-wip-received');
  });
  await step('record shortfall at bending', async () => {
    await page.goto(BASE + '/production-planning/#/workorders?department=GB-BEND'); await settle();
    await page.click('tr:has-text("SF-SPF-EY18") a.btn'); await settle(); await page.click('#wo-entry'); await page.fill('input[name=good_qty]', '2'); await page.fill('input[name=rejected_qty]', '1'); await page.fill('input[name=downtime_minutes]', '90'); await page.selectOption('select[name=delay_reason]', 'Machine breakdown'); await page.click('#en-ok'); await page.waitForTimeout(2500); await settle(); await shot('13-shortfall');
  });
  for (const v of ['dashboard', 'orders', 'wip', 'daily', 'costing?code=SPGEY18&qty=20', 'reports?month=2026-11', 'master/products/SPGEY18', 'master/departments', 'master/resources', 'master/capacities', 'master/prices?missing=1', 'master/calendar', 'master/users', 'master/import', 'master/quality', 'master/history', 'master/audit', 'sales', 'planning']) {
    await step('view ' + v, async () => { await page.goto(BASE + '/production-planning/#/' + v); await settle(1000); const t = await page.textContent('.pp-main'); if (/Loading…|Could not load|Internal error/.test(t)) throw new Error('page not rendered: ' + t.slice(0, 120)); await shot(('20-' + v).replace(/[^\w-]+/g, '_')); });
  }
  await step('export monthly excel', async () => { const r = await page.evaluate(async () => { const res = await fetch(window.PP_BOOT.rest + 'export/monthly?month=2026-11', { headers: { 'X-WP-Nonce': window.PP_BOOT.nonce } }); return { s: res.status, ct: res.headers.get('content-type'), len: (await res.arrayBuffer()).byteLength }; }); if (r.s !== 200 || !/spreadsheet/.test(r.ct) || r.len < 1000) throw new Error(JSON.stringify(r)); console.log('   export', JSON.stringify(r)); });
  await step('role: sales user cannot plan', async () => { await page.goto(BASE + '/wp-login.php?action=logout'); const link = await page.$('a[href*="action=logout"]'); if (link) await link.click(); await login('sales.demo', 'Demo#2026!'); await settle(); const nav = await page.textContent('.pp-nav'); await page.goto(BASE + '/production-planning/#/planning/' + reqId); await settle(); const t = await page.textContent('.pp-main'); if (!/Only a Production Planner/.test(t)) throw new Error('planner UI shown to sales'); await shot('30-sales-role'); });
  await step('role: cutting supervisor restricted', async () => { await page.goto(BASE + '/wp-login.php?action=logout'); const link = await page.$('a[href*="action=logout"]'); if (link) await link.click(); await login('cutting.demo', 'Demo#2026!'); await settle(); await page.goto(BASE + '/production-planning/#/workorders'); await settle(); await shot('31-supervisor-role'); const r = await page.evaluate(async () => { const res = await fetch(window.PP_BOOT.rest + 'requests/1/generate', { method: 'POST', headers: { 'X-WP-Nonce': window.PP_BOOT.nonce, 'Content-Type': 'application/json' }, body: '{}' }); return res.status; }); if (r !== 403) throw new Error('supervisor could generate plan: ' + r); });
  console.log('\nERRORS (' + errors.length + '):'); errors.slice(0, 40).forEach(e => console.log(' - ' + e));
  await browser.close();
})();
