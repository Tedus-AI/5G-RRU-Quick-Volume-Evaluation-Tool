/*
 * 疑似舊版罐頭預設值 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 2026-09-18 以前，AI-Thermal 建立元件時會自動塞一組分類預設值（它的 SG_DEFAULTS）：
 *   RF 250／10×10／Copper Coin／200／1.5／Grease、Digital 50／10×10／Thermal Via／100／0.5／Putty、
 *   PWR 30／20×20／None／95／0／Grease。
 * 那些元件「有值」，必填檢查擋不下來，但值幾乎可以確定不是實際值（備份實測：Cygnus 40 顆全中）。
 * 使用者選擇的處理：視同未填、一樣擋計算；改成實際值或按「確認是實際值」後解除。
 *
 * 驗證情境：
 *   [A] 7 欄全等於舊預設 → 擋計算；告警分成「必填還沒填」與「疑似舊預設值」兩段，後者有確認鈕。
 *   [B] 元件表：7 格虛線紅框、名稱下方有「確認是實際值」；值照常顯示（不是空白）。
 *   [C] 按確認 → 寫 _defaults_ok、不再列出；全部處理完 → 恢復計算。
 *   [D] 改掉其中一格 → 不再是舊預設組合 → 不需要確認。
 *   [E] 不發熱（0 W）、排除（👁）、只有部分欄位相同 → 不列出。
 *   [F] 存檔寫出 _defaults_ok；重新載入仍是確認過的。
 *   [G] 備份真實資料：Cygnus 39 顆 Digital 被標、電源模組（瓦數空白）歸在「必填」；其他 7 個專案 0 顆。
 *   [H] PDF 報告拒絕產生，並列出疑似舊預設值的元件。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/stamped-defaults.test.js
 */
const fs = require('fs');
const path = require('path');
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

const DIG_OLD = { 'Height(mm)': 50, Pad_L: 10, Pad_W: 10, Board_Type: 'Thermal Via', 'Limit(C)': 100, R_jc: 0.5, TIM_Type: 'Putty' };
const RF_OLD = { 'Height(mm)': 250, Pad_L: 10, Pad_W: 10, Board_Type: 'Copper Coin', 'Limit(C)': 200, R_jc: 1.5, TIM_Type: 'Grease' };
const PROJ = {
  project_name: 'S 案',
  rf_data: [Object.assign({ Component: 'PA', Qty: 1, 'Power(W)': 30 }, RF_OLD),
            Object.assign({ Component: 'PA 已量測', Qty: 1, 'Power(W)': 30 }, RF_OLD, { 'Height(mm)': 180 })],   // 6/7 → 不算
  digital_data: [Object.assign({ Component: 'SoC', Qty: 1, 'Power(W)': 23 }, DIG_OLD),
                 Object.assign({ Component: 'DDR', Qty: 2, 'Power(W)': 2.7 }, DIG_OLD),
                 Object.assign({ Component: 'NC 腳位', Qty: 1, 'Power(W)': 0 }, DIG_OLD),         // 0 W → 不算
                 Object.assign({ Component: '暫不計', Qty: 1, 'Power(W)': 1, _excluded: true }, DIG_OLD)],
  pwr_data: [{ Component: 'Power module', Qty: 1, 'Power(W)': '', 'Height(mm)': 30, Pad_L: 20, Pad_W: 20,
               Board_Type: 'None', 'Limit(C)': 95, R_jc: 0, TIM_Type: 'Grease' }],
};

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.route('**', r => r.request().url().startsWith(BASE.replace(/index\.html$/, '')) ? r.continue() : r.abort());
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return []} } };
    window.__alerts = []; window.alert = m => window.__alerts.push(String(m));
    window.__confirms = []; window.confirm = m => { window.__confirms.push(String(m)); return true; };
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof cloudLoadOne === 'function' && calcResults && calcResults.rows.length > 0);

  const seed = (projects) => page.evaluate((projects) => {
    window.__db = { projects: JSON.parse(JSON.stringify(projects)) };
    fbOk = true;
    dbAdapter.isReady = () => true;
    dbAdapter.refresh = async () => {};
    dbAdapter.getDoc = async (c, id) => { const d = (window.__db[c] || {})[id]; return d ? JSON.parse(JSON.stringify(d)) : null; };
    dbAdapter.getCollection = async (c) => JSON.parse(JSON.stringify(window.__db[c] || {}));
    dbAdapter.getProjectsSorted = async () => Object.entries(window.__db.projects).map(([id, d]) => Object.assign({ id }, d));
    dbAdapter.updateDoc = async (c, id, f) => {
      const cur = window.__db[c][id];
      const ff = typeof f === 'function' ? f(cur ? JSON.parse(JSON.stringify(cur)) : null) : f;
      window.__db[c][id] = Object.assign({}, cur || {}, JSON.parse(JSON.stringify(ff)));
    };
    _ensureLockBeforeWrite = async () => true;
  }, projects);

  console.log('\n[A] 7 欄全等於舊預設 → 擋計算，告警分兩段');
  await seed({ S: PROJ });
  const a = await page.evaluate(async () => {
    window.__alerts = [];
    await cloudLoadOne('S');
    const m = listMissing(components);
    const gate = document.getElementById('comp-missing-banner');
    return {
      blocked: !!calcResults.blocked,
      stamped: m.filter(x => x.kind === 'stamped').map(x => x.name),
      missing: m.filter(x => x.kind === 'missing').map(x => x.name + ':' + x.fields.join('/')),
      title: gate.querySelector('.cg-title').textContent,
      heads: [...gate.querySelectorAll('.cg-h')].map(e => e.textContent),
      okBtns: gate.querySelectorAll('.cg-ok').length,
      loadAlert: window.__alerts.join('|'),
    };
  });
  ok('計算被擋下', a.blocked, a);
  ok('疑似舊預設值：PA、SoC、DDR（0 W、排除、6/7 相同的不列）', JSON.stringify(a.stamped) === JSON.stringify(['PA', 'SoC', 'DDR']), a.stamped);
  ok('電源模組瓦數空白 → 歸在「必填還沒填」（不是舊預設值那一段）', JSON.stringify(a.missing) === JSON.stringify(['Power module:Power(W)']), a.missing);
  ok('告警標題與兩段小標', /4 顆元件需要處理/.test(a.title) && a.heads.length === 2 && /必填欄位還沒填（1 顆）/.test(a.heads[0]) && /疑似舊版自動帶入的預設值（3 顆）/.test(a.heads[1]), a);
  ok('每顆疑似舊預設值都有「確認是實際值」按鈕', a.okBtns === 3, a.okBtns);
  ok('載入提示也寫出兩種狀況', /必填欄位還沒填/.test(a.loadAlert) && /疑似舊版自動帶入的預設值/.test(a.loadAlert), a.loadAlert);

  console.log('\n[B] 元件表的標示');
  const b = await page.evaluate(() => {
    switchTab(0); switchSubTab(1);
    const tr = document.querySelectorAll('#subtab1 table.comp-table tbody tr')[0];   // SoC
    const cells = STAMPED_FIELDS.map(k => tr.querySelector('td[data-col="' + k + '"] input, td[data-col="' + k + '"] select'));
    const h = tr.querySelector('td[data-col="Height(mm)"] input');
    const cs = getComputedStyle(h);
    const note = tr.querySelector('td[data-col="Component"] .stamped-note');
    return { marked: cells.map(c => !!(c && c.classList.contains('cell-stamped'))), value: h.value,
             border: cs.borderTopStyle + ' ' + cs.borderTopColor, note: note ? note.textContent : '',
             tip: h.getAttribute('title') || '' };
  });
  ok('7 格都有虛線紅框（值照常顯示 50，不是空白）', b.marked.every(Boolean) && b.value === '50' && /dashed/.test(b.border) && /220, 38, 38/.test(b.border), b);
  ok('名稱下方寫「疑似舊預設值」並有確認鈕；滑鼠停留有說明', /疑似舊預設值/.test(b.note) && /確認是實際值/.test(b.note) && /確認前無法計算/.test(b.tip), b);

  console.log('\n[C] 確認 → 解除；全部處理完 → 恢復計算');
  const c = await page.evaluate(() => {
    window.__confirms = [];
    document.querySelector('#comp-missing-banner .cg-ok').click();                   // 第一顆（PA）
    const after = listMissing(components).filter(x => x.kind === 'stamped').map(x => x.name);
    const pa = components.rf.find(x => x.Component === 'PA');
    return { after, flag: pa._defaults_ok, confirmText: window.__confirms[0] || '', blocked: !!calcResults.blocked };
  });
  ok('按確認前先問一次，列出 7 個欄位的值', /確認「PA」的這 7 個欄位都是實際值/.test(c.confirmText) && /Rjc|熱阻/.test(c.confirmText), c.confirmText);
  ok('確認後寫 _defaults_ok、PA 不再列出', c.flag === true && JSON.stringify(c.after) === JSON.stringify(['SoC', 'DDR']), c);

  console.log('\n[D] 改掉其中一格 → 不需要確認');
  const d = await page.evaluate(() => {
    updateCompNum('digital', 0, 'Height(mm)', '12');         // SoC 高度改成實際值
    return listMissing(components).filter(x => x.kind === 'stamped').map(x => x.name);
  });
  ok('SoC 改了高度 → 不再是舊預設組合', JSON.stringify(d) === JSON.stringify(['DDR']), d);

  const c2 = await page.evaluate(() => {
    confirmStampedDefaults('digital', 1);
    updateCompNum('pwr', 0, 'Power(W)', '35');                // 補上電源模組瓦數 → 7 欄全等於 PWR 舊預設
    const st = listMissing(components).filter(x => x.kind === 'stamped').map(x => x.name);
    confirmStampedDefaults('pwr', 0);
    return { st, blocked: !!calcResults.blocked, rows: calcResults.rows.length };
  });
  ok('補上瓦數後，電源模組改列為疑似舊預設值（PWR 30／20×20／None／95／0／Grease）', JSON.stringify(c2.st) === JSON.stringify(['Power module']), c2.st);
  ok('全部處理完 → 恢復計算', !c2.blocked && c2.rows > 0, c2);

  console.log('\n[E] 不列出的情況');
  const e = await page.evaluate(() => ({
    zeroW: compStamped(components.digital.find(x => x.Component === 'NC 腳位'), 'digital'),
    excluded: compStamped(components.digital.find(x => x.Component === '暫不計'), 'digital'),
    partial: compStamped(components.rf.find(x => x.Component === 'PA 已量測'), 'rf'),
    wrongCat: compStamped(Object.assign({ Qty: 1, 'Power(W)': 5 }, { 'Height(mm)': 50, Pad_L: 10, Pad_W: 10, Board_Type: 'Thermal Via', 'Limit(C)': 100, R_jc: 0.5, TIM_Type: 'Putty' }), 'rf'),
  }));
  ok('0 W、排除計算、只有 6/7 相同、別的分類的預設 → 都不列', !e.zeroW && !e.excluded && !e.partial && !e.wrongCat, e);

  console.log('\n[F] 存檔寫出 _defaults_ok，重新載入仍是確認過的');
  const f = await page.evaluate(async () => {
    await cloudSaveProject();
    const saved = window.__db.projects.S;
    await cloudLoadOne('S');
    return { savedFlag: saved.rf_data.find(x => x.Component === 'PA')._defaults_ok,
             stamped: listMissing(components).filter(x => x.kind === 'stamped').length, blocked: !!calcResults.blocked };
  });
  ok('資料庫裡 PA 帶著 _defaults_ok: true', f.savedFlag === true, f);
  ok('重新載入後仍是確認過的，計算照常', f.stamped === 0 && !f.blocked, f);

  console.log('\n[G] 備份真實資料');
  const backup = path.join(__dirname, '..', 'thermal_db_backup_2026-09-21.json');
  if (fs.existsSync(backup)) {
    const real = JSON.parse(fs.readFileSync(backup, 'utf8')).projects;
    await seed(real);
    const g = await page.evaluate(async (ids) => {
      const out = {};
      for (const id of ids) {
        await cloudLoadOne(id);
        const m = listMissing(components);
        out[id] = { stamped: m.filter(x => x.kind === 'stamped').length, missing: m.filter(x => x.kind === 'missing').map(x => x.name) };
      }
      return out;
    }, Object.keys(real));
    const cyg = g['CB-GN-HB-2X2M-2B'];
    ok('Cygnus：39 顆 Digital 標成疑似舊預設值', cyg && cyg.stamped === 39, cyg);
    ok('Cygnus：電源模組（瓦數空白）列在必填', cyg && cyg.missing.length === 1 && /Power module/.test(cyg.missing[0]), cyg);
    const others = Object.entries(g).filter(([id]) => id !== 'CB-GN-HB-2X2M-2B');
    ok('其他 7 個專案都沒有被標成疑似舊預設值', others.length === 7 && others.every(([, v]) => v.stamped === 0), others.map(([id, v]) => id + ':' + v.stamped));
  } else {
    console.log('  （找不到備份檔，略過）');
  }

  console.log('\n[H] PDF 報告拒絕產生');
  await seed({ S: PROJ });
  const h = await page.evaluate(async () => {
    await cloudLoadOne('S');
    window.__alerts = [];
    await generatePDFReport();
    return window.__alerts.join('|');
  });
  ok('PDF：列出疑似舊預設值的元件，不產生報告', /無法產生報告/.test(h) && /疑似舊預設值/.test(h) && /SoC/.test(h), h);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
