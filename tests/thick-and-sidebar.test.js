/*
 * 板厚連動（PCB 板厚度／銅塊厚度）＋ K(銅塊) 參數 ＋ 參數控制台調寬/收合 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 驗證情境：
 *   [A] 板厚由參數控制台統一：Thermal Via 吃 t_PCB、Copper Coin 吃 Coin_T_Setting、
 *       IC top/None 不適用（歸 0、顯示「—」、不參與計算）；欄位不再逐顆編輯。
 *   [B] K (銅塊)：預設 380 時與舊的寫死值逐列相同（回歸）；改值 R_int 跟著變；
 *       空值時 fallback 380（不可變成 0）。
 *   [C] 舊專案遷移：專案沒存過全域厚度 → 由元件回推「最常見非零值」並統一，
 *       橫幅逐顆列出被改的元件；專案已有全域值 → 照用不回推。
 *   [D] 參數控制台：拖曳調寬（含上下限）、點一下收合／展開、標題列按鈕、
 *       localStorage 記憶、寬度變動後 Plotly 重算、登入前分隔線不顯示。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/thick-and-sidebar.test.js  # 可用 TEST_URL 指定網址
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**', r => r.request().url().startsWith(BASE.replace(/index\.html$/, '')) ? r.continue() : r.abort());
  await page.addInitScript(() => {
    window.__plotlyResizes = 0;
    window.Plotly = { newPlot(){}, Plots:{ resize(){ window.__plotlyResizes++; } }, relayout(){}, purge(){}, toImage: async()=>'' };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return []} } };
    window.alert = () => {}; window.confirm = () => true;
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  console.log('\n[D0] 登入前');
  const d0 = await page.evaluate(() => ({
    resizer: !!document.getElementById('sidebar-resizer'),
    hidden: getComputedStyle(document.getElementById('sidebar-resizer')).display === 'none',
  }));
  ok('分隔線存在但登入前不顯示', d0.resizer && d0.hidden, d0);

  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0);

  console.log('\n[A] 板厚由參數控制台統一');
  const a = await page.evaluate(() => {
    const byName = n => calcResults.rows.find(r => r.Component === n);
    const rows = ['rf','digital','pwr'].flatMap(c => components[c].map(x => ({bt:x.Board_Type, t:x['Thick(mm)'], n:x.Component})));
    return { tPCB: G.t_PCB, coinT: G.Coin_T_Setting, kCoin: G.K_Coin, rows,
             via: rows.filter(r => r.bt === 'Thermal Via').map(r => r.t),
             coin: rows.filter(r => r.bt === 'Copper Coin').map(r => r.t),
             none: rows.filter(r => r.bt === 'None').map(r => r.t) };
  });
  ok('新全域欄位有預設值（t_PCB=2、銅塊厚=2.5、K(銅塊)=380）',
     a.tPCB === 2 && a.coinT === 2.5 && a.kCoin === 380, a);
  ok('Thermal Via 元件的板厚都等於 t_PCB', a.via.every(t => t === a.tPCB), a.via);
  ok('Copper Coin 元件的板厚都等於銅塊厚度', a.coin.every(t => t === a.coinT), a.coin);
  ok('IC top / None 元件的板厚為 0（不適用）', a.none.every(t => t === 0), a.none);

  const a2 = await page.evaluate(() => {
    const before = calcResults.rows.find(r => r.Component === 'Driver PA').R_int;
    document.getElementById('t_PCB').value = '1.6'; recalc();
    const via = components.rf.filter(c => c.Board_Type === 'Thermal Via').map(c => c['Thick(mm)']);
    const after = calcResults.rows.find(r => r.Component === 'Driver PA').R_int;
    // 板厚欄不可逐顆編輯：該格是純文字，不是 input
    const cell = document.querySelectorAll('#subtab0 table.comp-table tbody tr')[1].querySelectorAll('td')[6];
    return { via, before, after, isText: !cell.querySelector('input'), cls: cell.firstElementChild.className,
             title: cell.firstElementChild.getAttribute('title') };
  });
  ok('改 t_PCB → 所有 Thermal Via 元件板厚跟著變', a2.via.every(t => t === 1.6), a2.via);
  ok('板厚變了 R_int 跟著變', a2.after < a2.before && a2.after > 0, a2);
  ok('板厚欄是純參照文字、不是可編輯輸入框', a2.isText && /thick-ref/.test(a2.cls), a2);
  ok('板厚欄 tooltip 指出來源是參數控制台', /PCB 板厚度/.test(a2.title || ''), a2.title);

  const a3 = await page.evaluate(() => {
    document.getElementById('t_PCB').value = '2'; recalc();
    updateComp('rf', 1, 'Board_Type', 'None');
    const naCell = document.querySelectorAll('#subtab0 table.comp-table tbody tr')[1].querySelectorAll('td')[6];
    const r = calcResults.rows.find(x => x.Component === components.rf[1].Component);
    const out = { thick: components.rf[1]['Thick(mm)'], text: naCell.textContent.trim(),
                  cls: naCell.firstElementChild.className, baseL: r.Base_L, rInt: r.R_int };
    updateComp('rf', 1, 'Board_Type', 'Thermal Via');   // 切回去要拿得回 t_PCB
    out.back = components.rf[1]['Thick(mm)'];
    return out;
  });
  ok('切成 None → 板厚歸 0 且顯示「—」', a3.thick === 0 && a3.text === '—' && /thick-na/.test(a3.cls), a3);
  ok('None 不參與計算（Base_L=0、R_int=0）', a3.baseL === 0 && a3.rInt === 0, a3);
  ok('切回 Thermal Via → 板厚回到 t_PCB', a3.back === 2, a3.back);

  console.log('\n[B] K (銅塊) 參數');
  const b = await page.evaluate(() => {
    const g = G, row = components.rf.find(c => c.Board_Type === 'Copper Coin');
    const r = calcResults.rows.find(x => x.Component === row.Component);
    // 舊公式：kb 寫死 380
    const pa = (row.Pad_L*row.Pad_W)/1e6, ba = (g.Coin_L_Setting*g.Coin_W_Setting)/1e6;
    const ea = Math.sqrt(pa*ba);
    const expect380 = (row['Thick(mm)']/1000)/(380*ea) + ((g.t_Solder/1000)/(g.K_Solder*pa*g.Voiding));
    document.getElementById('K_Coin').value = '200'; recalc();
    const r200 = calcResults.rows.find(x => x.Component === row.Component).R_int;
    const expect200 = (row['Thick(mm)']/1000)/(200*ea) + ((g.t_Solder/1000)/(g.K_Solder*pa*g.Voiding));
    document.getElementById('K_Coin').value = ''; recalc();
    const rEmpty = calcResults.rows.find(x => x.Component === row.Component).R_int;
    document.getElementById('K_Coin').value = '380'; recalc();
    return { got380: r.R_int, expect380, got200: r200, expect200, rEmpty };
  });
  ok('K(銅塊)=380 時 R_int 與舊的寫死值相同（回歸）', near(b.got380, b.expect380, 1e-12), b);
  ok('改成 200 → R_int 依公式變大', near(b.got200, b.expect200, 1e-12) && b.got200 > b.got380, b);
  ok('K(銅塊) 留空 → fallback 380，不會變成 0/NaN', near(b.rEmpty, b.expect380, 1e-12), b);

  console.log('\n[C] 舊專案遷移');
  const c = await page.evaluate(() => {
    // 模擬舊專案：Thermal Via 有 2 也有 0，Copper Coin 2.5，global_params 沒存過厚度
    components.rf = [
      {Component:'PA', Qty:1,'Power(W)':50,'Height(mm)':250,Pad_L:20,Pad_W:10,'Thick(mm)':2.5,Board_Type:'Copper Coin','Limit(C)':200,R_jc:1,TIM_Type:'Grease'},
      {Component:'V1', Qty:1,'Power(W)':10,'Height(mm)':200,Pad_L:5,Pad_W:5,'Thick(mm)':2,Board_Type:'Thermal Via','Limit(C)':200,R_jc:1,TIM_Type:'Putty'},
      {Component:'V2', Qty:1,'Power(W)':10,'Height(mm)':200,Pad_L:5,Pad_W:5,'Thick(mm)':2,Board_Type:'Thermal Via','Limit(C)':200,R_jc:1,TIM_Type:'Putty'},
      {Component:'V3', Qty:1,'Power(W)':10,'Height(mm)':200,Pad_L:5,Pad_W:5,'Thick(mm)':0,Board_Type:'Thermal Via','Limit(C)':200,R_jc:1,TIM_Type:'Putty'},
      {Component:'V4', Qty:1,'Power(W)':10,'Height(mm)':200,Pad_L:5,Pad_W:5,'Thick(mm)':0,Board_Type:'Thermal Via','Limit(C)':200,R_jc:1,TIM_Type:'Putty'},
    ];
    components.digital = []; components.pwr = [];
    migrateThickGlobals({ T_amb: 45 });            // 舊專案的 global_params：沒有厚度
    recalc();
    const banner = document.getElementById('thick-migrate-banner').textContent;
    return { tPCB: G.t_PCB, coinT: G.Coin_T_Setting,
             thicks: components.rf.map(c => c['Thick(mm)']),
             bannerHasInfer: /PCB 板厚度 = 2 mm/.test(banner),
             bannerListsV3: /V3/.test(banner) && /V4/.test(banner),
             bannerSaveHint: /儲存專案/.test(banner),
             inputSynced: document.getElementById('t_PCB').value };
  });
  ok('回推出 t_PCB=2（最常見非零值）、銅塊厚=2.5', c.tPCB === 2 && c.coinT === 2.5, c);
  ok('原本填 0 的 Thermal Via 元件被統一為 2', c.thicks.join(',') === '2.5,2,2,2,2', c.thicks);
  ok('參數控制台欄位同步顯示回推值', c.inputSynced === '2', c.inputSynced);
  ok('橫幅寫出回推來源並逐顆列出被改的元件', c.bannerHasInfer && c.bannerListsV3, c);
  ok('橫幅提醒要按「儲存專案」才寫回', c.bannerSaveHint);

  const c2 = await page.evaluate(() => {
    components.rf.forEach(x => { if (x.Board_Type === 'Thermal Via') x['Thick(mm)'] = 3; });
    migrateThickGlobals({ t_PCB: 1.2, Coin_T_Setting: 4 });   // 專案已有全域值 → 照用
    return { tPCB: G.t_PCB, coinT: G.Coin_T_Setting, thicks: components.rf.map(c => c['Thick(mm)']) };
  });
  ok('專案已有全域厚度 → 直接照用，不回推', c2.tPCB === 1.2 && c2.coinT === 4, c2);
  ok('照用後元件板厚被統一到專案值', c2.thicks.join(',') === '4,1.2,1.2,1.2,1.2', c2.thicks);

  console.log('\n[D] 參數控制台調寬 / 收合');
  const w0 = await page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().width);
  ok('預設寬度 340', Math.round(w0) === 340, w0);

  // 拖曳：往右 +80
  const box = await page.locator('#sidebar-resizer').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 300, { steps: 8 });
  await page.mouse.up();
  const d1 = await page.evaluate(() => ({
    w: document.getElementById('sidebar').getBoundingClientRect().width,
    saved: localStorage.getItem('rru.sidebarWidth'),
    collapsed: document.body.classList.contains('sidebar-collapsed'),
    resizes: window.__plotlyResizes,
  }));
  ok('拖曳可調整寬度（340 → 約 420）', Math.abs(d1.w - 420) <= 2, d1);
  ok('拖曳不會誤觸收合', d1.collapsed === false);
  ok('寬度記進 localStorage', String(Math.round(d1.w)) === d1.saved, d1);

  // 超過上限：再往右拖 300
  const box2 = await page.locator('#sidebar-resizer').boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + 300);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2 + 300, box2.y + 300, { steps: 8 });
  await page.mouse.up();
  const d2 = await page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().width);
  ok('寬度被夾在上限 560', Math.round(d2) === 560, d2);

  // 點一下（不拖）→ 收合
  await page.evaluate(() => { window.__plotlyResizes = 0;
    const d = document.createElement('div'); d.className = 'js-plotly-plot'; document.body.appendChild(d); });
  await page.locator('#sidebar-resizer').click();
  await page.waitForTimeout(150);
  const d3 = await page.evaluate(() => ({
    collapsed: document.body.classList.contains('sidebar-collapsed'),
    sbHidden: getComputedStyle(document.getElementById('sidebar')).display === 'none',
    saved: localStorage.getItem('rru.sidebarCollapsed'),
    peek: getComputedStyle(document.querySelector('#sidebar-resizer .peek')).display !== 'none',
    resizes: window.__plotlyResizes,
  }));
  ok('點一下分隔線 → 收合', d3.collapsed && d3.sbHidden, d3);
  ok('收合後分隔線顯示 ▶ 展開口', d3.peek, d3);
  ok('收合狀態記進 localStorage', d3.saved === '1', d3.saved);
  ok('寬度變動後有重算 Plotly 圖', d3.resizes > 0, d3.resizes);

  // 再點一下 → 展開
  await page.locator('#sidebar-resizer').click();
  await page.waitForTimeout(100);
  const d4 = await page.evaluate(() => ({
    collapsed: document.body.classList.contains('sidebar-collapsed'),
    w: document.getElementById('sidebar').getBoundingClientRect().width,
  }));
  ok('再點一下 → 展開並保留原寬度', !d4.collapsed && Math.round(d4.w) === 560, d4);

  // 標題列按鈕
  await page.locator('.sidebar-toggle').click();
  await page.waitForTimeout(100);
  const d5 = await page.evaluate(() => document.body.classList.contains('sidebar-collapsed'));
  ok('標題列按鈕也能收合', d5 === true);
  await page.evaluate(() => setSidebarCollapsed(false));

  // 重新載入 → 記憶還在
  await page.evaluate(() => { try { localStorage.setItem('rru.sidebarWidth','300'); localStorage.setItem('rru.sidebarCollapsed','0'); } catch(e){} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults);
  const d6 = await page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().width);
  ok('重新載入後還原上次寬度（300）', Math.round(d6) === 300, d6);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
