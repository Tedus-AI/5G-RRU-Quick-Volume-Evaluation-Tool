/*
 * 系統管理員面板（header「🛡 管理」）與登入紀錄 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 與 AI-Thermal 的管理面板同一套：查看／請離佔用編輯鎖的人員、強制清除鎖、查詢使用者登入紀錄。
 * 用真的 graphDb（SharePoint 後端），把 Graph API 換成頁面裡的假檔案（含 eTag／If-Match／412）。
 *   [A] header 有「🛡 管理」，在「♻️ 還原資料庫」後面
 *   [B] 密碼：錯了就地提示、不關視窗；Esc／取消關閉；對了才看到面板；重開要重新輸入
 *   [C] 沒人持鎖 → 寫「無人佔用」、不給請離／清除鈕
 *   [D] 別人持鎖 → 列出佔用者／信箱／時間；強制請離 → 旗標寫在對方的鎖上（不搶鎖）、面板與置頂橫幅都寫「已送出請離」
 *   [E] 強制清除鎖：取消確認 → 不動；確認 → 鎖清掉、面板改寫「無人佔用」、結果訊息留著
 *   [F] 持鎖的就是目前登入的帳號 → 標出來
 *   [G] 登入紀錄：新→舊、標出工具（舊紀錄沒有 tool＝AI-Thermal）、人數、逸出
 *   [H] 登入時記一筆（tool: '5G-RRU'）；本工具 60 分鐘內不重複記；AI-Thermal 的紀錄不擋本工具；超過 500 筆刪最舊
 *   [I] 離線資料庫 → 面板寫「沒有共用編輯鎖」、登入紀錄寫「沒有共用的登入紀錄」
 *   [J] 登入後的 header 頂排（右側按鈕最長的狀態）在 1280～1920 都放得下：沒有按鈕被裁掉、「🛡 管理」看得到、
 *       名稱區留得下、寬的螢幕用完整標籤、窄的才逐級收合；只剩圖示時 aria-label／title 寫全名、email 在 tooltip
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/admin-panel.test.js        # SHOT=／SHOT2=<路徑>.png 另存面板截圖（鎖資訊／登入紀錄）
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

const SEED = {
  version: 1, rf_library: {}, digital_library: {}, pwr_library: {},
  projects: { B: { project_name: 'B 案', rf_data: [], digital_data: [], pwr_data: [] } },
  login_history: {
    old1: { name: '韓新昭', email: 'xin@x.com', at: '2026-10-15T08:32:48.000Z' },                  // 舊紀錄沒有 tool → AI-Thermal
    old2: { name: '<b>陳</b>', email: 'tedus@x.com', at: '2026-10-16T06:22:10.000Z', tool: 'AI-Thermal' },
  },
};

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**', r => r.request().url().startsWith(BASE.replace(/index\.html$/, '')) ? r.continue() : r.abort());
  await page.addInitScript((seed) => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null}
      getAllAccounts(){return [{ name: 'Me 管理員', username: 'me@x.com' }]}
      async acquireTokenSilent(){return { accessToken: 'tok' }} } };
    window.__alerts = []; window.alert = m => window.__alerts.push(String(m));
    window.__confirm = true; window.confirm = () => window.__confirm;
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
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
    };
  }, SEED);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof adminOpen === 'function' && fbOk === true && dbAdapter.isSharePointMode());
  await page.waitForFunction(() => Object.values(JSON.parse(window.__disk).login_history || {}).some(r => r.tool === '5G-RRU'), null, { timeout: 5000 }).catch(() => {});

  const disk = () => page.evaluate(() => JSON.parse(window.__disk));
  const modal = () => page.evaluate(() => {
    const m = document.getElementById('admin-modal');
    return { open: m.style.display !== 'none', auth: !document.getElementById('admin-auth').hidden,
      panel: !document.getElementById('admin-panel').hidden, err: document.getElementById('admin-pwd-err').textContent,
      info: document.getElementById('admin-lock-info').textContent, status: document.getElementById('admin-status').textContent,
      btns: [...document.querySelectorAll('#admin-actions button')].map(b => b.textContent),
      focus: document.activeElement && document.activeElement.id };
  });
  const login = async () => {
    await page.evaluate(() => adminOpen());
    await page.fill('#admin-pwd', '0420');
    await page.press('#admin-pwd', 'Enter');
    await page.waitForFunction(() => !/讀取編輯鎖狀態中/.test(document.getElementById('admin-lock-info').textContent));
  };
  const otherLock = (extra) => page.evaluate((extra) => window.__ext(d => {
    d.lock = Object.assign({ lockedBy: 'TEDUS.CHEN 陳慶峰', lockedByEmail: 'tedus@x.com', lockedAt: '2026-10-20T07:24:26.000Z',
      expiresAt: new Date(Date.now() + 600000).toISOString() }, extra || {});
  }), extra);

  console.log('\n[A] header 按鈕');
  ok('「🛡 管理」在「♻️ 還原資料庫」後面', await page.evaluate(() => {
    const b = document.getElementById('btn-admin'); let p = b && b.previousElementSibling;
    while (p && p.tagName === 'INPUT') p = p.previousElementSibling;
    return !!b && /管理/.test(b.textContent) && !!p && p.id === 'btn-db-restore' && getComputedStyle(b).display !== 'none';
  }));

  console.log('\n[B] 密碼');
  await page.click('#btn-admin');
  let m = await modal();
  ok('打開 → 先問密碼、焦點在密碼框', m.open && m.auth && !m.panel && m.focus === 'admin-pwd', m);
  await page.fill('#admin-pwd', '1234');
  await page.press('#admin-pwd', 'Enter');
  m = await modal();
  ok('密碼錯 → 就地提示、視窗不關、沒有 alert', m.open && m.auth && !m.panel && /密碼錯誤/.test(m.err) && (await page.evaluate(() => window.__alerts.length)) === 0, m);
  await page.press('#admin-pwd', 'Escape');
  ok('Esc 關閉', !(await modal()).open);
  await page.evaluate(() => adminOpen());
  m = await modal();
  ok('重開：錯誤訊息清掉、密碼框是空的', m.auth && !m.err && (await page.inputValue('#admin-pwd')) === '', m);
  await page.click('#admin-auth button[type=button]');
  ok('取消關閉', !(await modal()).open);

  console.log('\n[C] 沒人持鎖');
  await login();
  m = await modal();
  ok('通過密碼 → 面板', m.panel && !m.auth, m);
  ok('寫「無人佔用」、沒有請離／清除鈕', /無人/.test(m.info) && m.btns.length === 0, m);
  await page.evaluate(() => adminClose());
  await page.evaluate(() => adminOpen());
  ok('關掉再開要重新輸入密碼', (await modal()).auth);
  await page.evaluate(() => adminClose());

  console.log('\n[D] 別人持鎖 → 強制請離');
  await otherLock();
  await login();
  m = await modal();
  ok('列出佔用者、信箱、鎖定時間、預計解鎖', /TEDUS\.CHEN 陳慶峰/.test(m.info) && /tedus@x\.com/.test(m.info) && /鎖定於/.test(m.info) && /預計自動解鎖/.test(m.info), m.info);
  ok('兩顆按鈕：強制請離、強制清除鎖', m.btns.length === 2 && /強制請離/.test(m.btns[0]) && /強制清除鎖/.test(m.btns[1]), m.btns);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, clip: await page.evaluate(() => {
    const r = document.querySelector('#admin-modal .admin-box').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
  const puts0 = await page.evaluate(() => window.__puts);
  await page.click('#admin-actions button:nth-child(1)');
  await page.waitForFunction(() => /已送出請離/.test(document.getElementById('admin-status').textContent));
  let d = await disk();
  ok('旗標寫在對方的鎖上、鎖還是對方的（不搶鎖）', d.lock.lockedByEmail === 'tedus@x.com' && d.lock.evictRequested === true && d.lock.evictBy === 'Me 管理員', d.lock);
  ok('只寫了一次', (await page.evaluate(() => window.__puts)) === puts0 + 1);
  m = await modal();
  ok('面板的鎖資訊多一行「已送出請離要求」、結果訊息留著', /已送出請離要求/.test(m.info) && /✅ 已送出請離/.test(m.status), m);
  ok('置頂佔用橫幅也寫「已要求對方釋放」', await page.evaluate(() => !document.getElementById('lock-status-evict').hidden &&
    /已要求對方釋放/.test(document.getElementById('lock-status-evict').textContent)));

  console.log('\n[E] 強制清除鎖');
  await page.evaluate(() => { window.__confirm = false; });
  const puts1 = await page.evaluate(() => window.__puts);
  await page.click('#admin-actions button:nth-child(2)');
  ok('取消確認 → 不動', (await page.evaluate(() => window.__puts)) === puts1 && !!(await disk()).lock);
  await page.evaluate(() => { window.__confirm = true; });
  await page.click('#admin-actions button:nth-child(2)');
  await page.waitForFunction(() => /已強制清除/.test(document.getElementById('admin-status').textContent));
  d = await disk(); m = await modal();
  ok('鎖清掉了、其他資料還在', d.lock === undefined && !!d.projects.B, d.lock);
  ok('面板改寫「無人佔用」、按鈕收起、結果訊息留著', /無人/.test(m.info) && m.btns.length === 0 && /✅ 已強制清除/.test(m.status), m);
  ok('置頂佔用橫幅收起', await page.evaluate(() => getComputedStyle(document.getElementById('lock-status-bar')).display === 'none'));
  await page.evaluate(() => adminClose());

  console.log('\n[F] 持鎖的就是目前登入的帳號');
  await page.evaluate(() => toggleCloudLock('0000'));
  await login();
  m = await modal();
  ok('標出「目前登入的帳號」', /Me 管理員/.test(m.info) && /目前登入的帳號/.test(m.info), m.info);
  await page.evaluate(() => adminClose());
  await page.evaluate(() => toggleCloudLock());

  console.log('\n[G] 使用者登入紀錄');
  await login();
  await page.click('text=使用者登入紀錄');
  await page.waitForSelector('#admin-loginhist .admin-lh-row');
  if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2, clip: await page.evaluate(() => {
    const r = document.querySelector('#admin-modal .admin-box').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
  const lh = await page.evaluate(() => ({
    head: document.querySelector('.admin-lh-head').textContent,
    rows: [...document.querySelectorAll('.admin-lh-row')].map(r => ({ t: r.querySelector('.admin-lh-time').textContent,
      name: r.querySelector('.admin-lh-name').textContent, tool: r.querySelector('.admin-lh-tool').textContent,
      cls: r.querySelector('.admin-lh-tool').className, email: r.querySelector('.admin-lh-email').textContent })),
    injected: !!document.querySelector('#admin-loginhist b'),
  }));
  ok('最新的在上面（本次登入的 5G-RRU 紀錄是第一筆）', lh.rows[0] && lh.rows[0].email === 'me@x.com' && lh.rows[0].tool === '5G-RRU' && /t-rru/.test(lh.rows[0].cls), lh.rows);
  ok('舊紀錄沒有 tool → 標 AI-Thermal', lh.rows.some(r => r.email === 'xin@x.com' && r.tool === 'AI-Thermal' && /t-ait/.test(r.cls)), lh.rows);
  ok('依時間新→舊', lh.rows.map(r => r.email).join() === 'me@x.com,tedus@x.com,xin@x.com', lh.rows.map(r => r.email));
  ok('標頭寫筆數與人數', /最近 3 筆登入/.test(lh.head) && /3 位使用者/.test(lh.head), lh.head);
  ok('名稱逸出（不會變成 HTML）', !lh.injected && lh.rows.some(r => r.name === '<b>陳</b>'), lh.rows);
  await page.evaluate(() => adminClose());

  console.log('\n[H] 登入時記一筆（tool: 5G-RRU）');
  d = await disk();
  const mine = Object.values(d.login_history).filter(r => r.email === 'me@x.com');
  ok('啟動時已登入 → 記一筆 5G-RRU 的登入', mine.length === 1 && mine[0].tool === '5G-RRU' && mine[0].name === 'Me 管理員' && !!mine[0].at, mine);
  let n = Object.keys(d.login_history).length;
  await page.evaluate(() => recordLoginHistory());
  ok('60 分鐘內再登入 → 不重複記', Object.keys((await disk()).login_history).length === n);
  await page.evaluate(() => window.__ext(d => {
    Object.keys(d.login_history).forEach(k => { if (d.login_history[k].email === 'me@x.com') delete d.login_history[k]; });
    d.login_history.ait = { name: 'Me 管理員', email: 'me@x.com', at: new Date().toISOString(), tool: 'AI-Thermal' };
  }));
  await page.evaluate(() => graphDb._readFile({ force: true }));
  await page.evaluate(() => recordLoginHistory());
  d = await disk();
  ok('剛在 AI-Thermal 登入過 → 本工具照樣記（節流只看本工具）',
     Object.values(d.login_history).filter(r => r.email === 'me@x.com' && r.tool === '5G-RRU').length === 1);
  await page.evaluate(() => window.__ext(d => {
    d.login_history = {};
    for (let i = 0; i < 500; i++) d.login_history['h' + i] = { name: 'u', email: 'u' + i + '@x.com', at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), tool: 'AI-Thermal' };
  }));
  await page.evaluate(() => graphDb._readFile({ force: true }));
  await page.evaluate(() => recordLoginHistory());
  d = await disk();
  ok('超過 500 筆 → 刪最舊的、留 500 筆（含剛記的那筆）', Object.keys(d.login_history).length === 500 && !d.login_history.h0 && !!d.login_history.h1 &&
     Object.values(d.login_history).some(r => r.email === 'me@x.com'), Object.keys(d.login_history).length);

  console.log('\n[I] 離線資料庫');
  await page.evaluate(() => dbAdapter.setOffline(true));
  await login();
  m = await modal();
  ok('寫「沒有共用編輯鎖」、沒有按鈕', /離線資料庫模式沒有共用編輯鎖/.test(m.info) && m.btns.length === 0, m);
  await page.click('text=使用者登入紀錄');
  ok('登入紀錄寫「沒有共用的登入紀錄」', /沒有共用的登入紀錄/.test(await page.textContent('#admin-loginhist')));
  await page.evaluate(() => { adminClose(); dbAdapter.setOffline(false); });

  console.log('\n[J] 登入後的 header 頂排');
  await page.evaluate(() => { const v = document.getElementById('version-badge'); if (v) v.textContent = 'v2026.10.20.1530-847c22a ✓ 最新'; });
  const hdr = [];
  for (const w of [1280, 1366, 1440, 1600, 1920]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(120);   // ResizeObserver → 下一格畫面 hdrFit
    hdr.push(await page.evaluate((w) => {
      const h = document.querySelector('.header'), bar = h.querySelector('.hdr-topbar'), right = h.querySelector('.hdr-right');
      const hr = h.getBoundingClientRect(), btns = [...right.querySelectorAll('button')].filter(b => getComputedStyle(b).display !== 'none');
      const adm = document.getElementById('btn-admin').getBoundingClientRect();
      const iconOnly = btns.filter(b => b.querySelector('.hb-f') && getComputedStyle(b.querySelector('.hb-f')).display === 'none' &&
        getComputedStyle(b.querySelector('.hb-s')).display === 'none');
      return { w, lv: h.classList.contains('hdr-c2') ? 2 : h.classList.contains('hdr-c1') ? 1 : 0,
        clipped: btns.filter(b => b.getBoundingClientRect().right > hr.right - 10).map(b => b.id || b.textContent),
        admVisible: adm.width > 0 && adm.right <= hr.right - 10,
        nameW: Math.round(bar.querySelector('.hdr-name-slot').getBoundingClientRect().width),
        noLabel: iconOnly.filter(b => !b.getAttribute('aria-label')).map(b => b.id || b.textContent),
        email: getComputedStyle(document.getElementById('sp-user-info')).display !== 'none',
        tip: document.getElementById('db-banner-text').title };
    }, w));
  }
  ok('五種寬度都沒有按鈕被裁掉、「🛡 管理」看得到', hdr.every(x => !x.clipped.length && x.admVisible), hdr);
  ok('名稱區至少留 180px', hdr.every(x => x.nameW >= 180), hdr.map(x => [x.w, x.nameW]));
  ok('寬的螢幕（1920）用完整標籤＋顯示 email；越窄收得越多', hdr[4].lv === 0 && hdr[4].email &&
     hdr.every((x, i) => i === 0 || x.lv <= hdr[i - 1].lv), hdr.map(x => [x.w, x.lv]));
  ok('只剩圖示的按鈕都有 aria-label', hdr.every(x => !x.noLabel.length), hdr.map(x => x.noLabel));
  ok('email 收起來時寫在 SharePoint 文字的 tooltip', hdr.filter(x => !x.email).every(x => /me@x\.com/.test(x.tip)), hdr.map(x => x.tip));
  await page.setViewportSize({ width: 1440, height: 900 });

  ok('沒有頁面錯誤', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
