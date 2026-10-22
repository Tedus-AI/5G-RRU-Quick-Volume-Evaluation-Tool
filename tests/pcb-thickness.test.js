/*
 * PCB 板厚以 AI-Thermal 為主（projects[id].pcb_thickness）—— headless 驗證
 * ---------------------------------------------------------------------------
 * 規則：AI-Thermal EE/RF/PWR 頁三個分類標題列的 PCB 板厚（pcb_thickness = { RF, Digital, PWR }，本工具唯讀）
 *       → 該分類「導熱方式 = Thermal Via」元件的 Thick(mm)；那個分類沒設定才用參數控制台的 t_PCB。
 *       Copper Coin（銅塊厚度）、IC top／None（不穿板 → 0）不受影響。
 *
 * 驗證情境：
 *   [A] 回歸：沒有 pcb_thickness → 板厚與 R_int 與原本相同；參數控制台沒有說明、元件表沒有「AI-Thermal」標記
 *   [B] 有 pcb_thickness → 該分類的 Thermal Via 元件吃它（R_int、R_TIM 跟著變，與獨立算的公式相同）；
 *       別的分類、銅塊、不穿板的元件不變；改 t_PCB 只影響沒設定的分類
 *   [C] 畫面：元件表板厚標「AI-Thermal」＋藍邊＋tooltip；參數控制台 t_PCB 底下寫出哪些分類用 AI-Thermal 的值
 *   [D] 專案生命週期：換專案不沿用；切回分頁 pcb_thickness 有變 → 重算、提示、不變成未存修改；
 *       有未存修改時一樣換、修改保留；存檔不寫 pcb_thickness（資料庫的值一個字都沒變）、元件 Thick(mm) 寫 AI-Thermal 的值；
 *       複製專案 → 複本沒有 pcb_thickness → 改用 t_PCB 並提示
 *   [E] 本機檔匯入完整的專案 document（含 pcb_thickness）→ 照用
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/pcb-thickness.test.js
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

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.route('**', r => r.request().url().startsWith(BASE.replace(/index\.html$/, '')) ? r.continue() : r.abort());
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
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
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows && calcResults.rows.length > 0 && window.ViaCalc);

  const snap = () => page.evaluate(() => calcResults.rows.map(r => ({ n: r.Component, bt: r.Board_Type, ri: r.R_int, rt: r.R_TIM, t: r['Thick(mm)'] })));
  const row = (S, n) => S.find(r => r.n === n);
  // 通用值（沒有 via 設計）的 R_int 與 R_TIM（獨立算，不呼叫 index.html 的函式）
  const generic = (g, c, t, timK, timT) => {
    const pa = c.Pad_L * c.Pad_W / 1e6, ba = (c.Pad_L + t) * (c.Pad_W + t) / 1e6;
    return { ri: (t / 1000) / (g.K_Via * Math.sqrt(pa * ba)) / g.Via_Eff, rt: (timT / 1000) / (timK * ba) };
  };
  const near = (a, b) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));

  console.log('\n[A] 回歸：沒有 pcb_thickness');
  const A = await snap();
  const g0 = await page.evaluate(() => ({ t: G.t_PCB, coin: G.Coin_T_Setting }));
  ok('Thermal Via 元件的板厚＝參數控制台 t_PCB、銅塊＝Coin_T_Setting、不穿板＝0',
     ['Driver PA', 'Pre Driver', 'Circulator', 'Si5518'].every(n => row(A, n).t === g0.t) && row(A, 'Final PA').t === g0.coin && row(A, 'Cavity Filter').t === 0, A);
  const A0 = await page.evaluate(() => ({ note: getComputedStyle(document.getElementById('t_PCB_src')).display, tag: document.querySelectorAll('.thick-from').length }));
  ok('參數控制台沒有 AI-Thermal 板厚的說明、元件表沒有「AI-Thermal」標記', A0.note === 'none' && A0.tag === 0, A0);

  console.log('\n[B] 有 pcb_thickness → 分類板厚');
  await page.evaluate(() => {
    const comps = JSON.parse(JSON.stringify({ rf: components.rf, digital: components.digital, pwr: components.pwr }));
    window.__db = { projects: {
      X: { project_name: '板厚案', global_params: Object.assign({}, G), pcb_thickness: { RF: 2.4, PWR: 1.6 },
           rf_data: comps.rf, digital_data: comps.digital, pwr_data: comps.pwr, validation_data: { rf: [] } },
      Y: { project_name: '沒有板厚的案子', global_params: Object.assign({}, G), rf_data: comps.rf, digital_data: comps.digital, pwr_data: comps.pwr },
    } };
    window.__writes = [];
    fbOk = true;
    dbAdapter.isReady = () => true;
    dbAdapter.isSharePointMode = () => false;
    dbAdapter.refresh = async () => {};
    dbAdapter.getDoc = async (c, id) => { const d = (window.__db[c] || {})[id]; return d ? JSON.parse(JSON.stringify(d)) : null; };
    dbAdapter.getCollection = async (c) => JSON.parse(JSON.stringify(window.__db[c] || {}));
    dbAdapter.getProjectsSorted = async () => Object.entries(window.__db.projects).map(([id, d]) => Object.assign({ id }, d));
    dbAdapter.updateDoc = async (c, id, f) => {
      const cur = window.__db[c][id];
      const ff = typeof f === 'function' ? f(cur ? JSON.parse(JSON.stringify(cur)) : null) : f;
      window.__writes.push({ id, keys: Object.keys(ff), rf: ff.rf_data ? ff.rf_data.map(x => [x.Component, x['Thick(mm)']]) : null });
      window.__db[c][id] = Object.assign({}, cur || {}, JSON.parse(JSON.stringify(ff)));
    };
    _ensureLockBeforeWrite = async () => true;
  });
  await page.evaluate(async () => { await cloudLoadOne('X'); });
  const B = await snap();
  const gp = await page.evaluate(() => ({ K_Via: G.K_Via, Via_Eff: G.Via_Eff, t: G.t_PCB, coin: G.Coin_T_Setting,
    dp: components.rf.find(c => c.Component === 'Driver PA'), si: components.digital.find(c => c.Component === 'Si5518'),
    tim: (() => { const r = calcResults.rows.find(x => x.Component === 'Driver PA'); return resolveTim(r, G); })(),
    timSi: (() => { const r = calcResults.rows.find(x => x.Component === 'Si5518'); return resolveTim(r, G); })() }));
  ok('RF 的 Thermal Via 元件（Driver PA、Pre Driver、Circulator）板厚＝AI-Thermal RF 2.4', ['Driver PA', 'Pre Driver', 'Circulator'].every(n => row(B, n).t === 2.4), B);
  ok('Digital 沒設定 → Si5518 照用 t_PCB；銅塊（Final PA）、不穿板的元件不變',
     row(B, 'Si5518').t === gp.t && row(B, 'Final PA').t === gp.coin && row(B, 'Cavity Filter').t === 0 && row(B, 'CPU (FPGA)').t === 0, B);
  const eDp = generic(gp, gp.dp, 2.4, gp.tim.k, gp.tim.t), eSi = generic(gp, gp.si, gp.t, gp.timSi.k, gp.timSi.t);
  ok('Driver PA 的 R_int、R_TIM 用 2.4 mm 算（與獨立算的公式相同）', near(row(B, 'Driver PA').ri, eDp.ri) && near(row(B, 'Driver PA').rt, eDp.rt), { got: row(B, 'Driver PA'), want: eDp });
  ok('Si5518 的 R_int、R_TIM 與沒有 pcb_thickness 時相同', near(row(B, 'Si5518').ri, row(A, 'Si5518').ri) && near(row(B, 'Si5518').rt, row(A, 'Si5518').rt) && near(row(B, 'Si5518').ri, eSi.ri));
  ok('銅塊元件（Final PA）R_int 不變', near(row(B, 'Final PA').ri, row(A, 'Final PA').ri));
  await page.evaluate(() => { document.getElementById('t_PCB').value = 3.2; recalc(); });
  const B2 = await snap();
  ok('改參數控制台 t_PCB → 只有沒設定的分類（Si5518）跟著變，RF 照用 AI-Thermal 的 2.4',
     row(B2, 'Si5518').t === 3.2 && ['Driver PA', 'Pre Driver', 'Circulator'].every(n => row(B2, n).t === 2.4), B2);
  await page.evaluate(() => { document.getElementById('t_PCB').value = window.__db.projects.X.global_params.t_PCB; recalc(); markProjectClean(); });

  console.log('\n[C] 畫面');
  const C = await page.evaluate(() => {
    switchTab(0);
    const cell = n => { const tr = [...document.querySelectorAll('#rf-table tr, #digital-table tr, table tr')].find(t => t.querySelector('input') && [...t.querySelectorAll('input')].some(i => i.value === n));
      const td = tr && tr.querySelector('td[data-col="Thick(mm)"]'); return td ? { txt: td.textContent.trim(), tip: (td.querySelector('.thick-ref') || {}).title || '', cls: (td.querySelector('.thick-ref') || {}).className || '' } : null; };
    const note = document.getElementById('t_PCB_src');
    return { dp: cell('Driver PA'), si: cell('Si5518'), fp: cell('Final PA'), note: note.textContent, show: getComputedStyle(note).display };
  });
  ok('元件表：RF Thermal Via 的板厚寫「2.4 AI-Thermal」、藍邊、tooltip 指路回 AI-Thermal',
     C.dp && /^2\.4\s*AI-Thermal$/.test(C.dp.txt) && /derived-src/.test(C.dp.cls) && /AI-Thermal RF PCB 板厚/.test(C.dp.tip) && /要改請到 AI-Thermal 改/.test(C.dp.tip), C.dp);
  ok('元件表：Digital 的 Thermal Via 照舊寫參數控制台的值、tooltip 說明 AI-Thermal 設定後會改用那個值',
     C.si && C.si.txt === '2' && !/derived-src/.test(C.si.cls) && /AI-Thermal 的 EE\/RF\/PWR 頁設定這個分類的 PCB 板厚後/.test(C.si.tip), C.si);
  ok('元件表：銅塊元件不提 AI-Thermal 板厚', C.fp && C.fp.txt === '2.5' && !/PCB 板厚/.test(C.fp.tip), C.fp);
  ok('參數控制台 t_PCB 底下：寫出 RF 2.4、PWR 1.6 用 AI-Thermal 的值，Digital 用這一格',
     C.show === 'block' && /RF 2\.4 mm、PWR 1\.6 mm/.test(C.note) && /Digital 沒設定 → 用這一格/.test(C.note), C);

  console.log('\n[D] 專案生命週期');
  await page.evaluate(async () => { await cloudLoadOne('Y'); });
  const D1 = await snap();
  ok('換到沒有 pcb_thickness 的專案 → 板厚回到 t_PCB（不沿用上一個專案的）', row(D1, 'Driver PA').t === gp.t, row(D1, 'Driver PA'));
  await page.evaluate(async () => { await cloudLoadOne('X'); window.__alerts = []; });
  await page.evaluate(() => { window.__db.projects.X.pcb_thickness = { RF: 2.0, Digital: 1.6, PWR: 1.6 }; });
  await page.evaluate(async () => { await checkProjectFreshness(true); });
  const D2 = await page.evaluate(() => ({ dp: components.rf.find(c => c.Component === 'Driver PA')['Thick(mm)'], si: components.digital.find(c => c.Component === 'Si5518')['Thick(mm)'],
    toast: (document.getElementById('cm-toast') || {}).textContent || '', dirty: projectIsDirty() }));
  ok('切回分頁：AI-Thermal 改了板厚（RF 2.0、Digital 1.6）→ 重算、提示、不算未存修改',
     D2.dp === 2.0 && D2.si === 1.6 && /PCB 板厚有更新/.test(D2.toast) && !D2.dirty, D2);
  await page.evaluate(() => { components.rf.find(c => c.Component === 'Driver PA')['Height(mm)'] = 211; recalc(); });
  await page.evaluate(() => { window.__db.projects.X.pcb_thickness = { RF: 2.4 }; });
  await page.evaluate(async () => { await checkProjectFreshness(true); });
  const D3 = await page.evaluate(() => ({ dp: components.rf.find(c => c.Component === 'Driver PA')['Thick(mm)'], si: components.digital.find(c => c.Component === 'Si5518')['Thick(mm)'],
    h: components.rf.find(c => c.Component === 'Driver PA')['Height(mm)'], dirty: projectIsDirty(), G: G.t_PCB }));
  ok('有未存修改時板厚一樣換成最新的（Digital 拿掉 → 回到 t_PCB）、修改保留、仍是未存修改',
     D3.dp === 2.4 && D3.si === D3.G && D3.h === 211 && D3.dirty, D3);
  const pcbBefore = await page.evaluate(() => { window.__db.projects.X.pcb_thickness = { RF: 2.2, PWR: 1.6 }; return JSON.stringify(window.__db.projects.X.pcb_thickness); });
  await page.evaluate(async () => { window.__alerts = []; window.__writes = []; await cloudSaveProject(); });
  const D4 = await page.evaluate(() => ({ pcb: JSON.stringify(window.__db.projects.X.pcb_thickness), w: window.__writes.slice(), vd: !!window.__db.projects.X.validation_data,
    dp: components.rf.find(c => c.Component === 'Driver PA')['Thick(mm)'], dirty: projectIsDirty() }));
  ok('存檔：寫入的欄位不含 pcb_thickness、資料庫的 pcb_thickness 一個字都沒變、其他工具的欄位保留',
     D4.w.length === 1 && !D4.w[0].keys.includes('pcb_thickness') && D4.pcb === pcbBefore && D4.vd, D4.w.map(w => w.keys));
  ok('存檔：元件的 Thick(mm) 寫的是寫入當下資料庫的 AI-Thermal 板厚（2.2）、存完畫面也是', D4.w.length === 1 && D4.w[0].rf.find(x => x[0] === 'Driver PA')[1] === 2.2 && D4.dp === 2.2 && !D4.dirty, D4);
  await page.evaluate(async () => { window.__alerts = []; document.getElementById('copyProjectName').value = '板厚案 複本'; await confirmCopyProject(); });
  const D5 = await page.evaluate(() => ({ dp: components.rf.find(c => c.Component === 'Driver PA')['Thick(mm)'], G: G.t_PCB, alerts: window.__alerts.slice(), id: currentProjectId,
    copyPcb: (window.__db.projects[currentProjectId] || {}).pcb_thickness, dirty: projectIsDirty() }));
  ok('複製專案：複本沒有 pcb_thickness → 改用 t_PCB、提示 AI-Thermal 的分類 PCB 板厚不會跟著複製、不算未存修改',
     D5.id !== 'X' && D5.copyPcb === undefined && D5.dp === D5.G && /分類 PCB 板厚）不會跟著複製/.test(D5.alerts[0] || '') && !D5.dirty, D5);

  console.log('\n[E] 本機檔匯入');
  const E = await page.evaluate(async () => {
    const d = JSON.parse(JSON.stringify(window.__db.projects.X));
    const f = new File([JSON.stringify(d)], 'x.json', { type: 'application/json' });
    await new Promise(res => { handleFileLoad({ target: { files: [f], value: '' } }); setTimeout(res, 400); });
    return { dp: components.rf.find(c => c.Component === 'Driver PA')['Thick(mm)'] };
  });
  ok('匯入完整的專案 document（含 pcb_thickness）→ 照用 AI-Thermal 的板厚', E.dp === 2.2, E);

  ok('沒有 JS 錯誤', errors.length === 0, errors);
  await browser.close();
  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})();
