/*
 * 參數控制台的 TIM 區塊 → 唯讀「TIM 型號庫」按鈕 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 驗證情境：
 *   [A] 參數控制台不再有 6 個 TIM 的 K/t 輸入欄，改成一顆顯眼的「🧪 TIM 型號庫」按鈕；
 *       欄位拿掉之後，沒選型號的元件仍以專案預設值算得出 R_TIM（fallback 不可斷）。
 *   [B] 按鈕開出來的視窗是「唯讀檢視」：列出型號庫內容、沒有任何可編輯欄位或新增/刪除/
 *       儲存鍵、有前往 AI-Thermal 的連結；空庫與資料庫未連線都要有指路文案。
 *   [C] 開視窗會重讀型號庫（AI-Thermal 剛改過的值要吃得到）並重算。
 *   [D] 換專案時 TIM 的 K_/t_ 不會沿用上一個專案的殘留值，但也不會被清成 undefined
 *       （退回出廠預設，否則 R_TIM 會靜默變 0 ＝ 低估熱阻）。
 *   [E] cloudLoadOne 的順序：板厚遷移必須在「元件已換成這個專案的」之後才跑。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/tim-lib-viewer.test.js     # 可用 TEST_URL 指定網址
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
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-9);

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.route('**', r => {
    const u = r.request().url();
    if (u.startsWith(BASE.replace(/index\.html$/, ''))) return r.continue();
    return r.abort();
  });
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null}
      getAllAccounts(){return []} } };
    window.__alerts = []; window.alert = m => window.__alerts.push(String(m));
    window.confirm = () => true;
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows && calcResults.rows.length > 0)
    .catch(async e => { console.error('page errors:', errors.slice(0,5)); throw e; });

  console.log('\n[A] 參數控制台：6 個 K/t 欄位 → 一顆按鈕');

  const a0 = await page.evaluate(() => {
    const ids = ['K_Putty','t_Putty','K_Pad','t_Pad','K_Grease','t_Grease'];
    const btn = document.querySelector('.tim-lib-btn');
    const cs = btn ? getComputedStyle(btn) : null;
    const r = btn ? btn.getBoundingClientRect() : null;
    const sidebar = document.getElementById('sidebar');
    return {
      leftoverInputs: ids.filter(id => document.getElementById(id)),
      stillInKeys: ids.every(id => PROJECT_GLOBAL_KEYS.includes(id)),
      stillInG: ids.every(id => typeof G[id] === 'number' && isFinite(G[id])),
      notRead: (function(){ const before = G.K_Pad; readGlobals(); return G.K_Pad === before; })(),
      btnText: btn ? btn.textContent.trim() : null,
      btnInSidebar: !!(btn && sidebar && sidebar.contains(btn)),
      btnH: r ? Math.round(r.height) : 0,
      btnW: r ? Math.round(r.width) : 0,
      bg: cs ? (cs.backgroundImage || '') + '|' + cs.backgroundColor : '',
      bold: cs ? cs.fontWeight : '',
      hint: (document.querySelector('.tim-lib-hint') || {}).textContent || '',
    };
  });
  ok('K_Putty/t_Putty/K_Pad/t_Pad/K_Grease/t_Grease 六個輸入欄都不在畫面上了', a0.leftoverInputs.length === 0, a0.leftoverInputs);
  ok('這六個 key 仍在 PROJECT_GLOBAL_KEYS（存檔時仍寫回，fallback 不斷）', a0.stillInKeys);
  ok('G 裡仍有這六個值（沒有欄位 ≠ 沒有值）', a0.stillInG);
  ok('readGlobals 不再從畫面讀這六個值（沒有欄位就不刷新）', a0.notRead);
  ok('按鈕文字是「TIM 型號庫」', /TIM\s*型號庫/.test(a0.btnText || ''), a0.btnText);
  ok('按鈕在參數控制台裡', a0.btnInSidebar);
  ok('按鈕夠顯眼：滿版寬 + 高度 ≥ 36px + 粗體 + 有底色', a0.btnW > 180 && a0.btnH >= 36 && parseInt(a0.bold,10) >= 700 && /gradient|rgb/.test(a0.bg), a0);
  ok('旁邊有一行說明：型號在 AI-Thermal 選、本工具只能檢視', /AI-Thermal/.test(a0.hint) && /檢視/.test(a0.hint), a0.hint);

  // 欄位拿掉之後，沒選型號的元件仍要算得出 R_TIM（fallback 斷掉 → R_TIM=0 ＝ 低估熱阻）
  const a1 = await page.evaluate(() => {
    const rows = calcResults.rows.filter(r => r.TIM_Type && r.TIM_Type !== 'None');
    return { n: rows.length,
             allPositive: rows.every(r => r.R_TIM > 0),
             allGlobal: rows.every(r => r.TIM_Src === 'global'),
             sample: rows.slice(0,3).map(r => [r.Component, r.TIM_Type, r.TIM_k, r.TIM_t, r.R_TIM]) };
  });
  ok('沒選型號的元件仍以專案預設值算出 R_TIM > 0（' + a1.n + ' 列）', a1.n > 0 && a1.allPositive, a1.sample);
  ok('來源標為 global（專案預設值）', a1.allGlobal, a1.sample);

  console.log('\n[B] 唯讀檢視視窗');

  // 先掛上型號庫再開視窗
  await page.evaluate(() => {
    window.__libCalls = 0;
    window.__lib = {
      t1: { model:'TG-A6200', timType:'Pad',    k:6.2, thickness:2.5,  gapThickness:1.2, vendor:'T-Global', note:'PA 用' },
      t2: { model:'TP-500',   timType:'Putty',  k:5.0, thickness:0.5,  gapThickness:0.5, vendor:'Fuji' },
      t3: { model:'GR-9',     timType:'Grease', k:9.0, thickness:0.05, gapThickness:0.05 },
    };
    dbAdapter.isReady = () => true;
    dbAdapter.getCollection = async (c) => { if (c === 'tim_library') { window.__libCalls++; return window.__lib; } return {}; };
  });
  await page.click('.tim-lib-btn');
  await page.waitForFunction(() => {
    const b = document.getElementById('timLibViewBody');
    return b && b.querySelectorAll('tbody tr').length > 0;
  }, { timeout: 5000 });

  const b1 = await page.evaluate(() => {
    const modal = document.getElementById('timLibModal');
    const body = document.getElementById('timLibViewBody');
    const rows = [...body.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
    const heads = [...body.querySelectorAll('thead th')].map(th => th.textContent.trim());
    const box = modal.querySelector('.cloud-modal');
    const link = [...box.querySelectorAll('a')].map(a => ({ href: a.getAttribute('href'), t: a.textContent.trim(), tgt: a.getAttribute('target') }));
    const btns = [...box.querySelectorAll('button')].map(b => b.textContent.trim());
    return {
      open: modal.classList.contains('active'),
      heads, rows,
      editable: box.querySelectorAll('input,textarea,select,[contenteditable="true"]').length,
      btns, link,
      onclicks: [...box.querySelectorAll('[onclick]')].map(e => e.getAttribute('onclick')),
      libCalls: window.__libCalls,
    };
  });
  ok('視窗打開了', b1.open);
  ok('表頭含型號／TIM 類型／k／填縫厚度／預設厚度', ['型號','TIM 類型','k (W/m·K)','填縫厚度 (mm)','預設厚度 (mm)'].every(h => b1.heads.includes(h)), b1.heads);
  ok('三筆型號都列出來了', b1.rows.length === 3, b1.rows);
  ok('k 與填縫厚度顯示正確（TG-A6200：6.2 / 1.2 / 2.5）',
     b1.rows.some(r => r[0]==='TG-A6200' && r[2]==='6.2' && r[3]==='1.2' && r[4]==='2.5'), b1.rows);
  ok('唯讀：視窗裡沒有任何可編輯欄位', b1.editable === 0, b1.editable);
  ok('唯讀：沒有新增／儲存／刪除鍵', !b1.btns.some(t => /新增|儲存|刪除|修改/.test(t)) &&
     !b1.onclicks.some(s => /timLibSave|timLibAdd|timLibDel|deleteDoc|writeBatch/.test(s)), { btns: b1.btns, onclicks: b1.onclicks });
  ok('有前往 AI-Thermal 維護型號庫的連結（另開分頁）',
     b1.link.some(l => /AI-Thermal-pad-and-stud-size-Evaluation-Tool/.test(l.href || '') && l.tgt === '_blank'), b1.link);
  ok('開視窗時重讀了一次型號庫', b1.libCalls >= 1, b1.libCalls);

  // 關閉
  await page.click('#timLibModal .cloud-close:not(.tim-lib-go)');
  ok('關閉鍵關得掉', await page.evaluate(() => !document.getElementById('timLibModal').classList.contains('active')));

  // 空庫的指路文案
  const b2 = await page.evaluate(async () => {
    window.__lib = {};
    await timLibViewOpen();
    const t = document.getElementById('timLibViewBody').textContent;
    timLibViewClose();
    return t;
  });
  ok('型號庫是空的時候指路到 AI-Thermal 新增', /空的/.test(b2) && /AI-Thermal/.test(b2), b2.slice(0,80));

  // 資料庫未連線
  const b3 = await page.evaluate(async () => {
    const keep = dbAdapter.isReady;
    dbAdapter.isReady = () => false;
    await timLibViewOpen();
    const t = document.getElementById('timLibViewBody').textContent;
    timLibViewClose();
    dbAdapter.isReady = keep;
    return t;
  });
  ok('資料庫未連線時給明確訊息，不是空白表格', /未連線|讀不到/.test(b3), b3.slice(0,80));

  console.log('\n[C] 開視窗會重讀型號庫並重算');
  const c1 = await page.evaluate(async () => {
    window.__lib = {
      t1: { model:'TG-A6200', timType:'Pad', k:6.2, thickness:2.5, gapThickness:1.2, vendor:'T-Global' },
    };
    await timLibLoad(true);
    const row = components.rf[0];
    row.TIM_Type = 'Pad'; row.TIM_Model = 'TG-A6200';
    recalc();
    const before = calcResults.rows.find(x => x.Component === row.Component).R_TIM;
    // AI-Thermal 端把 k 改掉了 → 重開視窗就要吃到新值
    window.__lib.t1.k = 12.4;
    await timLibViewOpen();
    timLibViewClose();
    const after = calcResults.rows.find(x => x.Component === row.Component);
    return { before, after: after.R_TIM, k: after.TIM_k, src: after.TIM_Src };
  });
  ok('型號庫在 AI-Thermal 被改過 → 重開視窗後 k 跟著更新', c1.k === 12.4 && c1.src === 'model', c1);
  ok('R_TIM 跟著重算（k 加倍 → R_TIM 減半）', near(c1.after, c1.before / 2, 1e-9), c1);

  console.log('\n[D] 換專案時 TIM 預設值的處理');
  const d1 = await page.evaluate(() => {
    G.K_Pad = 99; G.t_Pad = 99; G.K_Putty = 99; G.K_Pad2 = 88;   // 上一個專案的殘留值
    clearGlobalsWithoutInputs();
    const afterClear = { K_Pad: G.K_Pad, t_Pad: G.t_Pad, K_Putty: G.K_Putty, hasPad2: 'K_Pad2' in G };
    // 專案有自己的值 → 蓋上去
    const gp = { K_Pad: 3.3, t_Pad: 2.0 };
    for (const k in gp) G[k] = gp[k];
    return { afterClear, applied: { K_Pad: G.K_Pad, t_Pad: G.t_Pad },
             def: { K_Pad: DEFAULT_CONFIG.global_params.K_Pad, t_Pad: DEFAULT_CONFIG.global_params.t_Pad } };
  });
  ok('換專案先把 TIM 的 K_/t_ 退回出廠預設（不沿用上一個專案的 99）',
     d1.afterClear.K_Pad === d1.def.K_Pad && d1.afterClear.t_Pad === d1.def.t_Pad && d1.afterClear.K_Putty !== 99, d1);
  ok('沒有出廠預設的舊參數（K_Pad2）才是整個 delete 掉', d1.afterClear.hasPad2 === false, d1);
  ok('專案自己的 global_params 蓋得上去', d1.applied.K_Pad === 3.3 && d1.applied.t_Pad === 2.0, d1);

  const d2 = await page.evaluate(() => {
    document.getElementById('cloudProjectName').value = 'T';
    G.K_Pad = 3.3; G.t_Pad = 2.0;
    const f = _buildProjectFields('T', { global_params: { ai_only: 'keep', K_Pad: 1.1 } });
    return { k: f.global_params.K_Pad, t: f.global_params.t_Pad, sib: f.global_params.ai_only,
             noUndef: Object.keys(f.global_params).filter(k => f.global_params[k] === undefined) };
  });
  ok('存檔仍把 TIM 的 K_/t_ 寫進 global_params（下次載入才有 fallback）', d2.k === 3.3 && d2.t === 2.0, d2);
  ok('sibling tool 的 key 不受影響', d2.sib === 'keep', d2);
  ok('沒有任何 global key 被寫成 undefined', d2.noUndef.length === 0, d2.noUndef);

  console.log('\n[E] cloudLoadOne：板厚遷移在元件換好之後才跑');
  const e1 = await page.evaluate(async () => {
    // A 案：Thermal Via 板厚 2.0；B 案：Thermal Via 板厚 1.6，兩案都沒存過 t_PCB
    const mk = (thick) => ([{ Component:'U1', Qty:1, 'Power(W)':5, 'Limit(C)':100, Board_Type:'Thermal Via',
      Pad_L:10, Pad_W:10, 'Thick(mm)':thick, 'Height(mm)':3, TIM_Type:'Pad', R_jc:0.5 }]);
    const projects = {
      A: { project_name:'A', global_params:{ T_amb:45 }, rf_data: mk(2.0), digital_data:[], pwr_data:[] },
      B: { project_name:'B', global_params:{ T_amb:45 }, rf_data: mk(1.6), digital_data:[], pwr_data:[] },
    };
    dbAdapter.getDoc = async (c, id) => (c === 'projects' ? JSON.parse(JSON.stringify(projects[id])) : null);
    await cloudLoadOne('A');
    const a = { t_PCB: G.t_PCB, thick: components.rf[0]['Thick(mm)'] };
    await cloudLoadOne('B');
    const b = { t_PCB: G.t_PCB, thick: components.rf[0]['Thick(mm)'], field: document.getElementById('t_PCB').value };
    return { a, b };
  });
  ok('載入 A 案回推出 t_PCB = 2.0', e1.a.t_PCB === 2 && e1.a.thick === 2, e1.a);
  ok('接著載入 B 案回推的是 B 案自己的 1.6（不是 A 案的 2.0）', e1.b.t_PCB === 1.6 && e1.b.thick === 1.6, e1.b);
  ok('PCB 板厚度欄位也同步成 1.6', String(e1.b.field) === '1.6', e1.b);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
