/*
 * 系統管理員請離（共用編輯鎖上的 evictRequested 旗標）—— headless 驗證本工具「被請離時」的那一半
 * ---------------------------------------------------------------------------
 * 請離的操作介面在 AI-Thermal 的「🛡 管理」，兩個工具共用 thermal_db.json 上同一把編輯鎖：
 * 管理員對持鎖者下旗標 → 持鎖者的 60 秒輪詢（_maintainLock）偵測到 → 自動儲存 → 釋放鎖 → 退回上鎖並通知。
 * 用真的 graphDb（SharePoint 後端），把 Graph API 換成頁面裡的假檔案（含 eTag／If-Match／412），
 * 編輯鎖走真的 toggleCloudLock → acquireLock。
 *   [A] 有未存修改的已載入專案 → 自動儲存、鎖放掉、資料庫保護重新啟用、通知寫「已自動儲存」
 *   [B] 沒有未存修改 → 不寫專案、鎖放掉、通知寫「沒有未儲存的修改」
 *   [C] 自動儲存遇到兩邊改到同一格 → 不開衝突視窗、不寫入；鎖照樣放掉、畫面上的修改留著、通知寫原因
 *   [D] 還沒存進資料庫的新專案 → 不替使用者建立新專案；鎖放掉、通知寫原因
 *   [E] 正在存檔（_saveBusy）→ 這一輪先不處理，存完下一輪才請離
 *   [F] 別人持鎖且已被請離 → 置頂佔用橫幅寫「已要求對方釋放」
 *   [G] 管理員直接清掉鎖（forceReleaseLock）→ 退出編輯狀態（原本就有的「鎖遺失」流程）
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/lock-evict.test.js
 */
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const BASE = process.env.TEST_URL || 'http://127.0.0.1:8123/index.html';
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const FULL = (name, extra) => Object.assign({ Component: name, Qty: 1, 'Power(W)': 10, 'Height(mm)': 300, Pad_L: 8, Pad_W: 8,
  Board_Type: 'Thermal Via', 'Limit(C)': 125, R_jc: 0.5, TIM_Type: 'None', _cid: 'c-' + name }, extra || {});
const SEED = {
  version: 1, rf_library: {}, digital_library: {}, pwr_library: {},
  projects: {
    B: { meta: { timestamp: '2026-10-01T00:00:00Z' }, project_name: 'B 案', global_params: { T_amb: 50 },
         rf_data: [FULL('PA', { 'Power(W)': 30 })], digital_data: [], pwr_data: [] },
  },
};

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**', r => {
    const u = r.request().url();
    if (u.startsWith(BASE.replace(/index\.html$/, ''))) return r.continue();
    return r.abort();
  });
  await page.addInitScript((seed) => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null}
      getAllAccounts(){return [{ name: 'Me', username: 'me@x.com' }]}
      async acquireTokenSilent(){return { accessToken: 'tok' }} } };
    window.__alerts = []; window.alert = m => window.__alerts.push(String(m));
    window.confirm = () => true;
    // 假 SharePoint：一個檔案＋eTag；PUT 帶 If-Match 不符 → 412
    window.__disk = JSON.stringify(seed); window.__etag = 'e1'; window.__puts = 0; window.__n = 1;
    window.__ext = (fn) => { const d = JSON.parse(window.__disk); fn(d); window.__disk = JSON.stringify(d); window.__etag = 'x' + (++window.__n); };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opt) => {
      url = String(url);
      if (!url.includes('graph.microsoft.com')) return realFetch(url, opt);
      if (opt && opt.method === 'PUT') {
        if (opt.headers['If-Match'] && opt.headers['If-Match'] !== window.__etag) return new Response('conflict', { status: 412 });
        window.__puts++; window.__disk = opt.body; window.__etag = 'p' + (++window.__n);
        return new Response(JSON.stringify({ eTag: window.__etag }), { status: 200 });
      }
      if (/\/content$/.test(url)) return new Response(window.__disk, { status: 200 });
      if (/\$select=/.test(url)) return new Response(JSON.stringify({ id: 'item', eTag: window.__etag, size: window.__disk.length }), { status: 200 });
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 });   // site／drive item 解析
    };
  }, SEED);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof cloudLoadOne === 'function' && fbOk === true && dbAdapter.isSharePointMode());

  const disk = () => page.evaluate(() => JSON.parse(window.__disk));
  // 解鎖（真的取鎖）＋載入專案 B
  const start = () => page.evaluate(async () => {
    window.__alerts = [];
    if (!cloudLocked) await toggleCloudLock();
    await toggleCloudLock('0000');
    await cloudLoadOne('B', { silent: true });
    window.__alerts = [];
    return { locked: cloudLocked, mine: dbAdapter.hasLock() };
  });
  const evict = (by) => page.evaluate((by) => window.__ext(d => {
    d.lock.evictRequested = true; d.lock.evictBy = by; d.lock.evictAt = new Date().toISOString();
  }), by);
  const poll = () => page.evaluate(async () => { await dbAdapter.peekLock(); updateLockStatusBar(); await _maintainLock(); });
  const editPower = (w) => page.evaluate((w) => { components.rf[0]['Power(W)'] = w; recalc(); return projectIsDirty(); }, w);
  const state = () => page.evaluate(() => ({ locked: cloudLocked, hasLock: dbAdapter.hasLock(), alerts: window.__alerts.slice(),
    w: components.rf[0] && components.rf[0]['Power(W)'], cm: !!document.querySelector('.cm-mask'),
    btn: (document.getElementById('cloudLockBtn') || {}).textContent }));

  console.log('\n[A] 有未存修改的已載入專案 → 自動儲存後釋放');
  let s0 = await start();
  ok('取得編輯鎖', s0.locked === false && s0.mine === true && (await disk()).lock.lockedByEmail === 'me@x.com', s0);
  ok('改了瓦數 → 有未存修改', await editPower(42));
  await evict('管理員王');
  await poll();
  let d = await disk(), st = await state();
  ok('專案已自動儲存（42 W 寫進資料庫）', d.projects.B.rf_data[0]['Power(W)'] === 42, d.projects.B.rf_data[0]);
  ok('伺服器上的鎖已放掉', d.lock === undefined, d.lock);
  ok('資料庫保護重新啟用、本地不再持鎖', st.locked === true && st.hasLock === false && /啟用/.test(st.btn || ''), st);
  ok('通知：被誰請離、已自動儲存', st.alerts.length === 1 && /系統管理員已將你請離/.test(st.alerts[0]) && /管理員王/.test(st.alerts[0]) && /已自動儲存/.test(st.alerts[0]), st.alerts);
  ok('沒有另外跳「已儲存」的訊息', !st.alerts.some(a => /^✅/.test(a)), st.alerts);

  console.log('\n[B] 沒有未存修改 → 只釋放鎖');
  await start();
  let puts0 = await page.evaluate(() => window.__puts);
  await evict('管理員王');
  await poll();
  d = await disk(); st = await state();
  ok('只寫了一次（放掉鎖），沒有寫專案', (await page.evaluate(() => window.__puts)) === puts0 + 1 && d.projects.B.rf_data[0]['Power(W)'] === 42);
  ok('鎖放掉、資料庫保護啟用', d.lock === undefined && st.locked === true, { lock: d.lock, st });
  ok('通知寫「沒有未儲存的修改」', st.alerts.length === 1 && /沒有未儲存的修改/.test(st.alerts[0]), st.alerts);

  console.log('\n[C] 兩邊改到同一格 → 不開衝突視窗、不寫入，修改留在畫面上');
  await start();
  await editPower(50);
  await page.evaluate(() => window.__ext(d => { d.projects.B.rf_data[0]['Power(W)'] = 60; }));   // 別人（AI-Thermal）改了同一格
  await evict('管理員王');
  await poll();
  d = await disk(); st = await state();
  ok('沒有開衝突視窗（自動儲存不等使用者）', st.cm === false);
  ok('資料庫維持對方的 60 W（沒有被蓋掉）', d.projects.B.rf_data[0]['Power(W)'] === 60, d.projects.B.rf_data[0]);
  ok('畫面上的 50 W 還在', st.w === 50, st.w);
  ok('鎖照樣放掉', d.lock === undefined && st.locked === true && st.hasLock === false, { lock: d.lock, st });
  ok('通知寫出沒有自動儲存的原因', st.alerts.length === 1 && /沒有自動儲存/.test(st.alerts[0]) && /兩邊都改了/.test(st.alerts[0]) && /修改都還在/.test(st.alerts[0]), st.alerts);
  await page.evaluate(() => cloudLoadOne('B', { silent: true }));   // 清場：放棄畫面上的修改

  console.log('\n[D] 還沒存進資料庫的新專案 → 不替使用者建立');
  await start();
  await page.evaluate(() => { projectIdentitySet(null, '新案 X'); projBase = null; });
  await editPower(77);
  const nProj = Object.keys((await disk()).projects).length;
  await evict('管理員王');
  await poll();
  d = await disk(); st = await state();
  ok('沒有建立新專案', Object.keys(d.projects).length === nProj, Object.keys(d.projects));
  ok('鎖放掉', d.lock === undefined && st.locked === true);
  ok('通知寫原因（新專案）', st.alerts.length === 1 && /新專案/.test(st.alerts[0]), st.alerts);
  await page.evaluate(() => cloudLoadOne('B', { silent: true }));

  console.log('\n[E] 正在存檔 → 這一輪先不處理，下一輪才請離');
  await start();
  await evict('管理員王');
  await page.evaluate(() => { _saveBusy = true; });
  await poll();
  d = await disk(); st = await state();
  ok('存檔中：鎖還在、沒有通知', d.lock && d.lock.lockedByEmail === 'me@x.com' && st.locked === false && st.alerts.length === 0, { lock: d.lock, st });
  await page.evaluate(() => { _saveBusy = false; });
  await poll();
  d = await disk(); st = await state();
  ok('存完的下一輪 → 請離', d.lock === undefined && st.locked === true && st.alerts.length === 1, { lock: d.lock, st });

  console.log('\n[F] 別人持鎖且已被請離 → 置頂佔用橫幅寫「已要求對方釋放」');
  await page.evaluate(() => window.__ext(d => { d.lock = { lockedBy: 'Other', lockedByEmail: 'other@x.com',
    lockedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() }; }));
  await poll();
  let bar = await page.evaluate(() => ({ show: getComputedStyle(document.getElementById('lock-status-bar')).display !== 'none',
    ev: document.getElementById('lock-status-evict').hidden }));
  ok('別人持鎖 → 橫幅顯示、還沒請離時不寫', bar.show && bar.ev === true, bar);
  await evict('管理員王');
  await poll();
  bar = await page.evaluate(() => { const e = document.getElementById('lock-status-evict');
    return { show: getComputedStyle(document.getElementById('lock-status-bar')).display !== 'none', hidden: e.hidden, txt: e.textContent,
      vis: e.getBoundingClientRect().height > 0 }; });
  ok('請離後 → 橫幅多一行「已要求對方釋放」並寫出是誰', bar.show && !bar.hidden && bar.vis && /已要求對方釋放/.test(bar.txt) && /管理員王/.test(bar.txt), bar);
  await page.evaluate(() => window.__ext(d => { delete d.lock; }));
  await poll();

  console.log('\n[G] 管理員直接清掉鎖 → 退出編輯狀態');
  await start();
  await page.evaluate(() => dbAdapter.forceReleaseLock());   // 同一個 API（AI-Thermal 管理面板的「強制清除」）
  await poll();
  st = await state();
  ok('退回上鎖、通知鎖已遺失', st.locked === true && st.hasLock === false && st.alerts.length === 1 && /被釋放或被他人接手/.test(st.alerts[0]), st);

  ok('沒有頁面錯誤', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
