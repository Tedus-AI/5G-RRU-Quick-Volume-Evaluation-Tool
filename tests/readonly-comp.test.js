/*
 * 元件表唯讀：5G-RRU 不改 AI-Thermal 的值 —— headless 驗證
 * 使用者決定（2026-11）：5G-RRU 的元件清單就是讀 AI-Thermal 的資料，只有「元件相對高度」能在這裡改。
 *   [A] 元件表：只有「元件相對高度」是輸入框；其他欄位是唯讀文字；沒有新增／刪除／複製／快選；操作欄只剩 👁
 *   [B] 缺值：紅框「未填」＋tooltip 指路到 AI-Thermal 的哪一頁；缺值橫幅點欄位名稱 → 聚焦那一格
 *   [C] 存檔：改高度照常寫入；AI-Thermal 的欄位一律用資料庫的值（就算記憶體裡被改過也不寫回）
 *   [D] aiOwnedFromDb：沒有 key 的刪 key、用名稱對舊資料、新專案（資料庫沒有）不動
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
  Board_Type: 'Thermal Via', 'Limit(C)': 125, R_jc: 0.5, TIM_Type: 'None' }, extra || {});
const PROJ = {
  project_name: 'X 案', global_params: { T_amb: 50 }, thermal_specs: { PA: { heatDirection: 'IC top' } },
  rf_data: [FULL('PA', { 'Power(W)': 30, R_jc: 0.4 }), FULL('Driver', { 'Power(W)': 5 })],
  digital_data: [FULL('FPGA', { 'Power(W)': 20 })],
  pwr_data: [FULL('PSU', { Board_Type: 'None', Pad_L: 0, Pad_W: 0 })],
};

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.route('**', r => r.request().url().startsWith(BASE.replace(/index\.html$/, '')) ? r.continue() : r.abort());
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return []} } };
    window.__alerts = []; window.alert = m => window.__alerts.push(String(m));
    window.confirm = () => true;
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof cloudLoadOne === 'function' && calcResults && calcResults.rows.length > 0);

  // 模擬共用 DB（行為比照 graphDb）：getDoc 回複本；updateDoc 的 fields 可以是函式，在最新內容上計算；
  // window.__interfere 可在「第一次計算之後、寫入之前」插入別人的寫入（模擬 412 → 重讀重算）。
  const seed = (proj) => page.evaluate((proj) => {
    window.__db = { projects: { X: JSON.parse(JSON.stringify(proj)), OTHER: { project_name: '別的專案', rf_data: [] } } };
    window.__writes = []; window.__interfere = null;
    fbOk = true;
    dbAdapter.isReady = () => true;
    dbAdapter.refresh = async () => { window.__refreshes = (window.__refreshes || 0) + 1; };
    dbAdapter.getDoc = async (c, id) => { const d = (window.__db[c] || {})[id]; return d ? JSON.parse(JSON.stringify(d)) : null; };
    dbAdapter.getCollection = async (c) => JSON.parse(JSON.stringify(window.__db[c] || {}));
    dbAdapter.getProjectsSorted = async () => Object.entries(window.__db.projects).map(([id, d]) => Object.assign({ id }, d));
    dbAdapter.updateDoc = async (c, id, f) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const cur = window.__db[c][id];
        const ff = typeof f === 'function' ? f(cur ? JSON.parse(JSON.stringify(cur)) : null) : f;
        if (window.__interfere) { const fn = window.__interfere; window.__interfere = null; fn(window.__db); continue; }
        window.__writes.push({ id, f: JSON.parse(JSON.stringify(ff)) });
        window.__db[c][id] = Object.assign({}, cur || {}, JSON.parse(JSON.stringify(ff)));
        return;
      }
      throw new Error('too many retries');
    };
    _ensureLockBeforeWrite = async () => true;
    window.__alerts = [];
  }, proj);
  const load = () => page.evaluate(async () => { await cloudLoadOne('X'); window.__alerts = []; });
  const other = (fn) => page.evaluate(fn);           // 模擬 AI-Thermal 在我們載入之後存檔（直接改 DB）
  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__db.projects.X)));
  const by = (list, n) => (list || []).find(c => c.Component === n);

  const tableInfo = () => page.evaluate(() => {
    switchTab(0); switchSubTab(0);
    const tb = document.querySelector('#subtab0 table.comp-table');
    const inputs = [...tb.querySelectorAll('tbody input, tbody select')].map(e => e.closest('td').dataset.col);
    const ops = [...tb.querySelectorAll('tbody td.col-ops button')].map(b => b.textContent.trim());
    return { inputs: [...new Set(inputs)], ops: [...new Set(ops)], addRow: !!document.querySelector('#subtab0 .add-row, #subtab0 .btn-add-direct, #lib_sel_rf'),
      ro: [...tb.querySelectorAll('tbody tr:first-child .ro-val')].map(e => e.closest('td').dataset.col), note: (document.querySelector('#subtab0 .ro-legend') || {}).textContent || '', bottomNote: !!document.querySelector('#subtab0 .ro-note'),
      marks: tb.querySelectorAll('.derived-src, .rjc-lock').length, lockTxt: /🔒/.test(tb.textContent) };
  });

  console.log('\n[A] 元件表唯讀');
  await seed(PROJ); await load();
  const a = await tableInfo();
  ok('只有「元件相對高度」是輸入框', a.inputs.length === 1 && a.inputs[0] === 'Height(mm)', a.inputs);
  ok('名稱、數量、功耗、E-Pad、導熱方式、限溫、Rjc、介面材料是唯讀文字',
     ['Component', 'Qty', 'Power(W)', 'Pad_L', 'Pad_W', 'Board_Type', 'Limit(C)', 'R_jc', 'TIM_Type'].every(c => a.ro.includes(c)), a.ro);
  ok('沒有新增／快選元件的入口；表格上方一句話：數值取自 AI-Thermal、只需填元件相對高度、修改請回 AI-Thermal（下方不重複）',
     !a.addRow && /取自 AI-Thermal/.test(a.note) && /只需填寫「元件相對高度」/.test(a.note) && /回 AI-Thermal 修改/.test(a.note) && !a.bottomNote, a);
  ok('儲存格不再加藍邊／🔒 標記', a.marks === 0 && !a.lockTxt, a);
  ok('操作欄只剩 👁（沒有刪除、複製）', a.ops.length === 1 && /👁/.test(a.ops[0]), a.ops);

  console.log('\n[B] 缺值：紅框「未填」＋指路');
  const P2 = JSON.parse(JSON.stringify(PROJ)); delete P2.rf_data[0]['Power(W)']; delete P2.rf_data[1].Board_Type;
  await seed(P2); await load();
  const b = await page.evaluate(() => {
    switchTab(0); switchSubTab(0);
    const tr = document.querySelectorAll('#subtab0 table.comp-table tbody tr');
    const p = tr[0].querySelector('td[data-col="Power(W)"] .ro-val'), bt = tr[1].querySelector('td[data-col="Board_Type"] .ro-val');
    return { p: p.textContent, pc: p.className, pt: p.title, bt: bt.textContent, btt: bt.title };
  });
  ok('功耗沒填 → 「未填」紅框，tooltip 指路 AI-Thermal「EE/RF/PWR-專案元件清單」', b.p === '未填' && /ro-missing/.test(b.pc) && /AI-Thermal「EE\/RF\/PWR-專案元件清單」/.test(b.pt), b);
  ok('導熱方式沒填 → 指路 AI-Thermal「TH/ME-專案元件清單的「主散熱路徑」」', b.bt === '未填' && /TH\/ME-專案元件清單的「主散熱路徑」/.test(b.btt), b);
  await page.evaluate(() => { const a = document.querySelector('#comp-missing-banner a[onclick*="jumpToMissing(\'rf\',0,\'Power(W)\'"]'); a.click(); });
  await page.waitForTimeout(200);
  const f = await page.evaluate(() => { const e = document.activeElement; return { cls: e && e.className, col: e && e.closest('td') && e.closest('td').dataset.col }; });
  ok('缺值橫幅點「單顆功耗」→ 聚焦那一格', /ro-val/.test(f.cls) && f.col === 'Power(W)', f);

  console.log('\n[C] 存檔：只寫高度，AI-Thermal 的欄位用資料庫的值');
  await seed(PROJ); await load();
  await other(() => { const d = window.__db.projects.X.rf_data.find(c => c.Component === 'PA'); d.R_jc = 0.33; d['Power(W)'] = 31; });  // AI-Thermal 在載入後改了
  await page.evaluate(async () => {
    const pa = components.rf.find(c => c.Component === 'PA');
    updateCompNum('rf', components.rf.indexOf(pa), 'Height(mm)', '280');       // 本工具唯一能改的
    pa.Qty = 9; pa['Limit(C)'] = 999; pa.TIM_Type = 'Pad';                    // 模擬任何程式路徑偷改 AI-Thermal 的欄位
    await cloudSaveProject();
  });
  const c = await db();
  const pa = by(c.rf_data, 'PA');
  ok('高度寫入', pa['Height(mm)'] === 280, pa['Height(mm)']);
  ok('AI-Thermal 在載入後改的 Rjc／功耗保留', pa.R_jc === 0.33 && pa['Power(W)'] === 31, pa);
  ok('記憶體裡被改過的數量／限溫／介面材料沒有寫回（用資料庫的值）', pa.Qty === 1 && pa['Limit(C)'] === 125 && pa.TIM_Type === 'None', pa);

  console.log('\n[D] aiOwnedFromDb');
  const d = await page.evaluate(() => {
    const fields = { rf_data: [{ _cid: 'a', Component: 'A', Qty: 5, TIM_Model: 'X', 'Height(mm)': 1 }, { Component: 'B', Qty: 7 }, { Component: 'NEW', Qty: 3 }] };
    const cur = { rf_data: [{ _cid: 'a', Component: 'A', Qty: 2 }, { Component: 'B', Qty: 4 }] };
    const n = aiOwnedFromDb(fields, cur);
    return { n, a: fields.rf_data[0], b: fields.rf_data[1], nw: fields.rf_data[2] };
  });
  ok('用 _cid 對：數量換成資料庫的、資料庫沒有的 TIM_Model 刪掉、高度不動', d.a.Qty === 2 && !('TIM_Model' in d.a) && d.a['Height(mm)'] === 1, d.a);
  ok('沒有 _cid 用名稱對', d.b.Qty === 4, d.b);
  ok('資料庫沒有的元件不動', d.nw.Qty === 3 && d.n === 3, d);

  console.log('\n[E] 介面材料：24 吋類型＋型號並排、k／t 在下一行；17 吋上下疊');
  const tim = async (w) => { await page.setViewportSize({ width: w, height: 950 }); return page.evaluate(() => {
    const f = components.rf[0]; f.TIM_Type = 'Grease'; f.TIM_Model = 'Tgrease 2500'; switchTab(0); switchSubTab(0); recalc();
    const td = document.querySelector('#subtab0 .comp-table tbody tr td[data-col="TIM_Type"]');
    const a = td.querySelector(':scope > .ro-val').getBoundingClientRect(), m = td.querySelector('.tim-sub').getBoundingClientRect(), n = td.querySelector('.tim-note').getBoundingClientRect();
    return { sameLine: Math.abs(m.top + m.height / 2 - (a.top + a.height / 2)) < 4 && m.left > a.right, noteBelow: n.top >= Math.max(a.bottom, m.bottom) - 1, below: m.top >= a.bottom - 1 }; }); };
  const t24 = await tim(1920), t17 = await tim(1536);
  ok('1920：類型與型號同一行、k／t 在下一行', t24.sameLine && t24.noteBelow, t24);
  ok('1536：型號在類型下面', t17.below && !t17.sameLine, t17);

  ok('沒有 JS 錯誤', errors.length === 0, errors);
  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
