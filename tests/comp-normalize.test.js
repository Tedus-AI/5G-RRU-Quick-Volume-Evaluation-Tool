/*
 * 元件必填欄位：不補預設值，缺值告警並擋下計算 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 標準流程：AI-Thermal 先建資料 → 5G-RRU 讀同一個專案算體積。AI-Thermal 刻意不寫本工具
 * 專屬欄位（Height(mm)／R_jc…），專案也可能還沒維護完整。原本載入時會補上分類預設值
 * （Height 250、Rjc 1.5、限溫 200…）讓計算跑得動，但預設值若是錯的，算出來的體積就是錯的，
 * 而且不容易被發現。使用者要求：
 *   「參數控制台可以填預設值，元件設定不要；沒填就是使用者必須注意到，否則不能計算。」
 *
 * 驗證情境：
 *   [A] 數字存成字串也要算對（"7"+"2" 不可相接成 "72"）。
 *   [B] calcThermalResistance 對真的缺值維持 NaN（不偷偷當 0）。
 *   [C] normalizeComps 只轉型、空值刪 key，**不補任何值**；舊版 _filled 標記清掉。
 *   [D] compMissing 的必填規則（數量／瓦數必填；有熱才要其餘 7 欄；0 算有填；排除的不算）。
 *   [E] 走完整載入路徑（cloudLoadOne）：不補預設、擋下計算、各頁都顯示同一份擋下原因。
 *   [F] 元件表：缺值格空白（不顯示 0）＋紅框「必填」；下拉顯示「請選擇」而不是第一個選項。
 *   [G] 點擋下原因裡的欄位名稱 → 跳到那一格並聚焦。
 *   [H] 補齊後才計算、不再有 NaN；清空數字欄 → 刪 key（不是寫 0）→ 再次擋下。
 *   [I] 按 👁 排除缺值的元件 → 不再擋。
 *   [J] 新增元件／從資料庫快選：不帶分類預設值；來源瓦數是 '' → 不帶、不鎖瓦數。
 *   [K] 寫回 DB 的元件是深拷貝，並去掉舊版 _filled。
 *   [L] 重量估算出廠預設值（參數控制台）＝鋁 2.7／Filter 1／Shielding 1.5／PCB 1.2。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/comp-normalize.test.js
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

// AI-Thermal 建的專案：元件缺本工具專屬欄位，瓦數還可能是 ''
const AIT_PROJECT = {
  project_name: 'FDD B8B20B28 4T4R 560W',
  rf_data: [
    { Component:'Circulators-B8', Qty:4, 'Power(W)':3.81, 'Height(mm)':450, Pad_L:7, Pad_W:7,
      'Thick(mm)':2, Board_Type:'Thermal Via', 'Limit(C)':125, R_jc:0, TIM_Type:'None' },   // 完整
    { Component:'Circulators-B20B28', Qty:4, 'Power(W)':4.09, Type:'CR' },                 // 只有數量瓦數
    { Component:'Cavity Filter-B8', Qty:4, 'Power(W)':19.1, 'Height(mm)':300, Pad_L:0, Pad_W:0,
      Board_Type:'None', 'Limit(C)':125, R_jc:0.2, TIM_Type:'None' },                      // Pad 0×0＝有填
  ],
  digital_data: [ { Component:'L1452-TMPA1004S', Qty:1, 'Power(W)':'' } ],                 // 瓦數 ''
  pwr_data: [ { Component:'Spare', Qty:1, 'Power(W)':0 } ],                                // 明確 0 瓦
};

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.route('**', r => r.request().url().startsWith(BASE.replace(/index\.html$/, '')) ? r.continue() : r.abort());
  await page.addInitScript(() => {
    window.__plots = {};
    window.Plotly = { newPlot(id, t){ window.__plots[id] = t; }, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
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
  await page.waitForFunction(() => typeof normalizeComps === 'function' && calcResults && calcResults.rows.length > 0);

  console.log('\n[A] 數字存成字串也要算對（不可字串相接）');
  const a = await page.evaluate(() => {
    const num = { Component:'X', Qty:4, 'Power(W)':3.81, 'Height(mm)':450, Pad_L:7, Pad_W:7, 'Thick(mm)':2,
                  Board_Type:'Thermal Via', 'Limit(C)':125, R_jc:0, TIM_Type:'None' };
    const str = { Component:'X', Qty:'4', 'Power(W)':'3.81', 'Height(mm)':'450', Pad_L:'7', Pad_W:'7', 'Thick(mm)':'2',
                  Board_Type:'Thermal Via', 'Limit(C)':'125', R_jc:'0', TIM_Type:'None' };
    const n = calcThermalResistance(num, G), s = calcThermalResistance(str, G);
    return { sBase:[s.Base_L,s.Base_W], nRint:n.R_int, sRint:s.R_int, nAdt:n.Allowed_dT, sAdt:s.Allowed_dT };
  });
  ok('字串版的擴散面積是 7+2=9（不是 "72"）', a.sBase[0] === 9 && a.sBase[1] === 9, a.sBase);
  ok('字串版與數字版算出完全相同的 R_int／允許溫升', near(a.nRint, a.sRint) && near(a.nAdt, a.sAdt), a);

  console.log('\n[B] calcThermalResistance 對真的缺值維持 NaN');
  const b = await page.evaluate(() => {
    const noRjc = { Component:'Y', Qty:4, 'Power(W)':4.09, 'Height(mm)':450, Pad_L:7, Pad_W:7, 'Thick(mm)':2,
                    Board_Type:'Thermal Via', 'Limit(C)':125, TIM_Type:'None' };
    const r = calcThermalResistance(noRjc, G);
    return { dropNaN: isNaN(r.Drop), adtNaN: isNaN(r.Allowed_dT) };
  });
  ok('缺 R_jc → 內部溫降／允許溫升 NaN（不偷偷當 0）', b.dropNaN && b.adtNaN, b);

  console.log('\n[C] normalizeComps：只轉型、空值刪 key，不補任何值');
  const c = await page.evaluate(() => {
    components.rf = [
      { Component:'完整', Qty:4, 'Power(W)':3.81, 'Height(mm)':450, Pad_L:7, Pad_W:7,
        Board_Type:'Thermal Via', 'Limit(C)':125, R_jc:0, TIM_Type:'None' },
      { Component:'缺欄位', Qty:4, 'Power(W)':4.09 },
      { Component:'字串', Qty:'4', 'Power(W)':'4.09', 'Height(mm)':'450', Pad_L:'7', Pad_W:'7',
        Board_Type:'Thermal Via', 'Limit(C)':'125', R_jc:'0.5', TIM_Type:'None' },
      { Component:'空值', Qty:'', 'Power(W)':null, 'Height(mm)':'abc', Board_Type:'', TIM_Type:'  ',
        _filled:{ R_jc:true } },
    ];
    components.digital = []; components.pwr = [];
    normalizeComps();
    const [full, miss, str, empty] = components.rf;
    return {
      fullSame: full.R_jc === 0 && full['Height(mm)'] === 450 && Object.keys(full).length === 10,
      missKeys: Object.keys(miss).sort().join(','),
      strTypes: [str.Qty, str['Power(W)'], str.Pad_L, str['Limit(C)'], str.R_jc].map(v => typeof v).join(','),
      strVals: [str.Qty, str['Power(W)'], str.Pad_L, str['Limit(C)'], str.R_jc].join(','),
      emptyKeys: Object.keys(empty).sort().join(','),
    };
  });
  ok('缺的欄位維持沒有 key（不補分類預設值）', c.missKeys === 'Component,Power(W),Qty', c.missKeys);
  ok('已經有值的元件一個欄位都不動', c.fullSame, c);
  ok('字串數字轉成 number', c.strTypes === 'number,number,number,number,number' && c.strVals === '4,4.09,7,125,0.5', c);
  ok("空字串／null／非數字／空白字串一律刪 key；舊版 _filled 清掉", c.emptyKeys === 'Component', c.emptyKeys);

  console.log('\n[D] 必填規則（compMissing）');
  const d = await page.evaluate(() => ({
    onlyName: compMissing({ Component:'A' }),
    powered: compMissing({ Component:'B', Qty:2, 'Power(W)':5 }),
    zeroPower: compMissing({ Component:'C', Qty:2, 'Power(W)':0 }),
    zeroQty: compMissing({ Component:'C2', Qty:0, 'Power(W)':7 }),
    zeroPad: compMissing({ Component:'D', Qty:1, 'Power(W)':10, 'Height(mm)':0, Pad_L:0, Pad_W:0,
                           Board_Type:'None', 'Limit(C)':125, R_jc:0, TIM_Type:'None' }),
    excluded: compMissing({ Component:'E', _excluded:true }),
    nanPower: compMissing({ Component:'F', Qty:1, 'Power(W)':NaN }),
  }));
  ok('只有名稱 → 9 個欄位全列', d.onlyName.length === 9 && d.onlyName[0] === 'Qty' && d.onlyName[1] === 'Power(W)', d.onlyName);
  ok('有數量有瓦數 → 列出其餘 7 欄（高度、限溫、Rjc、導熱方式、介面材料、E-Pad 長寬）',
     JSON.stringify(d.powered) === JSON.stringify(['Height(mm)','Limit(C)','R_jc','Board_Type','TIM_Type','Pad_L','Pad_W']), d.powered);
  ok('明確填 0 瓦或 0 顆 → 不產生熱，其餘免填', d.zeroPower.length === 0 && d.zeroQty.length === 0, d);
  ok('0 是「有填」（Cavity Filter 的 E-Pad 0×0、Rjc 0 都算有填）', d.zeroPad.length === 0, d.zeroPad);
  ok('按 👁 排除的元件不列', d.excluded.length === 0, d.excluded);
  ok('NaN 瓦數算沒填', d.nanPower.includes('Power(W)'), d.nanPower);

  console.log('\n[E] 走完整載入路徑：不補預設、擋下計算');
  await page.evaluate(async (proj) => {
    window.__alerts = [];
    dbAdapter.isReady = () => true; fbOk = true;
    dbAdapter.getDoc = async () => JSON.parse(JSON.stringify(proj));
    dbAdapter.getCollection = async () => ({});
    await cloudLoadOne('RRU_5G');
  }, AIT_PROJECT);
  const e = await page.evaluate(() => {
    const cir = components.rf.find(x => x.Component === 'Circulators-B20B28');
    const L = calcResults.missing || [];
    const txt = id => (document.getElementById(id) || {}).textContent || '';
    return {
      noDefaults: !('Height(mm)' in cir) && !('R_jc' in cir) && !('Limit(C)' in cir) && !('Board_Type' in cir),
      digPowerKey: 'Power(W)' in components.digital[0],
      blocked: !!calcResults.blocked, rows: calcResults.rows.length, vol: calcResults.Volume_L,
      missing: L.map(m => m.cat + ':' + m.name + ':' + m.fields.length),
      alert: window.__alerts.join('\n'),
      banner: txt('comp-missing-banner'),
      t1: txt('tab1-alerts'), t1table: document.getElementById('tab1-table').innerHTML,
      t2: txt('tab2-result'), t2rest: txt('tab2-charts') + txt('tab2-comp'), t3: txt('tab3-3d'),
    };
  });
  ok('缺的欄位沒有被補上分類預設值', e.noDefaults, e);
  ok("瓦數 '' 在載入時刪 key（空值不寫 key）", e.digPowerKey === false, e);
  ok('計算被擋下（不產生任何計算列、體積為 0）', e.blocked && e.rows === 0 && e.vol === 0, e);
  ok('缺值清單正確：Circulators-B20B28 缺 7 欄、L1452 缺瓦數＋7 欄；完整的／0 瓦的不列',
     JSON.stringify(e.missing) === JSON.stringify(['rf:Circulators-B20B28:7', 'digital:L1452-TMPA1004S:8']), e.missing);
  ok('載入時的提示就告知有幾顆缺值、無法計算', /2 顆元件的必填欄位還沒填/.test(e.alert) && /無法計算體積/.test(e.alert), e.alert);
  ok('元件設定的紅色橫幅列出元件與欄位', /無法計算體積/.test(e.banner) && /Circulators-B20B28/.test(e.banner) && /L1452-TMPA1004S/.test(e.banner), e.banner.slice(0, 120));
  ok('詳細分析頁：顯示擋下原因、不顯示計算表', /無法計算體積/.test(e.t1) && e.t1table === '', e.t1.slice(0, 60));
  ok('視覺化報告頁：顯示擋下原因、不畫任何圖表與整機組成', /無法計算體積/.test(e.t2) && e.t2rest === '', [e.t2.slice(0, 40), e.t2rest.slice(0, 40)]);
  ok('3D 頁顯示擋下原因', /無法計算體積/.test(e.t3), e.t3.slice(0, 40));

  const e2 = await page.evaluate(async () => {
    runSweep(); runTornado();
    window.__alerts = [];
    await generatePDFReport();
    return { sweep: document.getElementById('sa-sweep-results').textContent,
             tornado: document.getElementById('sa-tornado-results').textContent,
             pdf: window.__alerts.join('\n') };
  });
  ok('敏感度分析（掃描／Tornado）都顯示擋下原因', /無法計算體積/.test(e2.sweep) && /無法計算體積/.test(e2.tornado), e2);
  ok('PDF 報告拒絕產生並列出缺什麼', /無法產生報告/.test(e2.pdf) && /Circulators-B20B28/.test(e2.pdf), e2.pdf.slice(0, 80));

  console.log('\n[F] 元件表：缺值格不顯示 0、紅框「必填」、下拉顯示「請選擇」');
  const f = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#subtab0 table.comp-table tbody tr')];
    const row = rows.find(r => (r.querySelector('td[data-col="Component"] input') || {}).value === 'Circulators-B20B28');
    const full = rows.find(r => (r.querySelector('td[data-col="Component"] input') || {}).value === 'Circulators-B8');
    const h = row.querySelector('td[data-col="Height(mm)"] input');
    const bt = row.querySelector('td[data-col="Board_Type"] select');
    const tim = row.querySelector('td[data-col="TIM_Type"] select');
    const rj = row.querySelector('td[data-col="R_jc"] input');
    const cs = getComputedStyle(h);
    return {
      hVal: h.value, hMissing: h.classList.contains('cell-missing'), hPh: h.placeholder, border: cs.borderTopColor,
      btText: bt.options[bt.selectedIndex].textContent, btVal: bt.value, btMissing: bt.classList.contains('cell-missing'),
      timText: tim.options[tim.selectedIndex].textContent, timMissing: tim.classList.contains('cell-missing'),
      rjVal: rj.value, rjMissing: rj.classList.contains('cell-missing'),
      fullMarked: !!full.querySelector('.cell-missing'),
    };
  });
  ok('缺值的數字格是空白（不是 0）、紅框、placeholder「必填」',
     f.hVal === '' && f.hMissing && f.hPh === '必填' && f.border === 'rgb(220, 38, 38)', f);
  ok('導熱方式下拉顯示「— 請選擇 —」而不是清單第一項', /請選擇/.test(f.btText) && f.btVal === '' && f.btMissing, f);
  ok('介面材料下拉同樣顯示「— 請選擇 —」並標紅', /請選擇/.test(f.timText) && f.timMissing, f);
  ok('Rjc 缺值 → 可輸入的空白欄位並標紅', f.rjVal === '' && f.rjMissing, f);
  ok('完整的元件沒有任何紅框', !f.fullMarked, f);

  console.log('\n[G] 點欄位名稱 → 跳到那一格');
  // 使用者多半是在「視覺化報告」頁看到擋下原因 → 從那裡點欄位名稱
  await page.evaluate(() => { switchTab(2); });
  await page.click('#tab2-result a:has-text("限溫")');
  await page.waitForTimeout(250);
  const g = await page.evaluate(() => {
    const a = document.activeElement;
    const td = a && a.closest('td');
    const tr = a && a.closest('tr');
    return { tab0: document.querySelectorAll('.tab-content')[0].classList.contains('active'),
             col: td && td.dataset.col,
             comp: tr && (tr.querySelector('td[data-col="Component"] input') || {}).value,
             flashed: !!(td && td.classList.contains('cell-flash')) };
  });
  ok('切回元件設定、聚焦在 Circulators-B20B28 的「限溫」並閃一下',
     g.tab0 && g.col === 'Limit(C)' && g.comp === 'Circulators-B20B28' && g.flashed, g);

  console.log('\n[H] 補齊後才計算；清空欄位 → 刪 key 再次擋下');
  const h = await page.evaluate(() => {
    const i = components.rf.findIndex(x => x.Component === 'Circulators-B20B28');
    [['Height(mm)','450'],['Limit(C)','125'],['R_jc','0.3'],['Pad_L','7'],['Pad_W','7']].forEach(([k,v]) => updateCompNum('rf', i, k, v));
    updateComp('rf', i, 'Board_Type', 'Thermal Via'); updateComp('rf', i, 'TIM_Type', 'None');
    const afterRf = (calcResults.missing || []).map(m => m.name);
    updateCompNum('digital', 0, 'Power(W)', '0');            // 這顆確定是 0 瓦 → 其餘免填
    const r = calcResults;
    // 有熱的元件不可有 NaN；0 瓦元件其餘欄位免填，算不出的值在畫面上要顯示「—」而不是 NaN
    const nan = r.rows.filter(x => x.Total_W > 0 && ['Allowed_dT','Tj','Tj_Margin','Loc_Amb','Drop'].some(k => typeof x[k] === 'number' && isNaN(x[k])));
    const res = { afterRf, blocked: !!r.blocked, vol: r.Volume_L, nan: nan.map(x => x.Component),
                  tab1NaN: /NaN/.test(document.getElementById('tab1-table').textContent),
                  tab1Rows: document.querySelectorAll('#tab1-table tbody tr').length,
                  banner: document.getElementById('comp-missing-banner').innerHTML };
    updateCompNum('rf', i, 'Height(mm)', '');                // 清空 → 刪 key（不是 0）
    res.cleared = !('Height(mm)' in components.rf[i]);
    res.reblocked = !!calcResults.blocked && calcResults.missing.map(m => m.name + ':' + m.fields.join('+')).join('|');
    updateCompNum('rf', i, 'Height(mm)', '450');
    return res;
  });
  ok('只剩 L1452 沒補時仍然擋著', JSON.stringify(h.afterRf) === JSON.stringify(['L1452-TMPA1004S']), h.afterRf);
  ok('全部補齊 → 開始計算、體積 > 0、有熱的元件沒有 NaN、紅色橫幅消失',
     h.blocked === false && h.vol > 0 && h.nan.length === 0 && h.banner === '', h);
  ok('詳細分析表列出全部元件、0 瓦元件算不出的值顯示「—」而不是 NaN', h.tab1Rows === 5 && h.tab1NaN === false, h);
  ok('清空數字欄 → 刪 key（不是寫 0）並再次擋下', h.cleared && h.reblocked === 'Circulators-B20B28:Height(mm)', h);

  console.log('\n[I] 👁 排除缺值的元件 → 不再擋');
  const i2 = await page.evaluate(() => {
    components.rf.push({ Component:'待確認', Qty:1, 'Power(W)':5 }); recalc();
    const before = !!calcResults.blocked;
    toggleComp('rf', components.rf.length - 1);
    const after = !!calcResults.blocked, vol = calcResults.Volume_L;
    components.rf.pop(); recalc();
    return { before, after, vol };
  });
  ok('排除前擋下、排除後正常計算', i2.before === true && i2.after === false && i2.vol > 0, i2);

  console.log('\n[J] 新增元件／從資料庫快選不帶分類預設值');
  const j = await page.evaluate(() => {
    const n0 = components.digital.length;
    addComp('digital');
    const added = components.digital[n0];
    const addedMiss = compMissing(added);
    components.digital.pop();
    variantsCache = { rf: [], pwr: [], digital: [
      { name:'快選元件', power:'', originProjectName:'StarKcore-12L', originProjectId:'StarKcore-12L',
        src: { Qty:1, 'Power(W)':'', 'Limit(C)':105, Type:'DC-DC' } } ] };
    renderTab0();
    const sel = document.getElementById('lib_sel_digital'); sel.value = '0';
    addFromVariant('digital');
    const q = components.digital[components.digital.length - 1];
    // Thick(mm) 每次 recalc 都由參數控制台依導熱方式帶入（推導值，不是元件預設值）→ 不列入比對
    const own = o => Object.keys(o).filter(k => !k.startsWith('_') && k !== 'Thick(mm)');
    const res = { addedKeys: own(added).join(','), addedMiss: addedMiss.length,
                  qKeys: own(q).sort().join(','),
                  qLocked: q._ref_locked, qMiss: compMissing(q) };
    components.digital.pop(); recalc();
    return res;
  });
  ok('直接新增 → 只有名稱，9 個必填全部標出', j.addedKeys === 'Component' && j.addedMiss === 9, j);
  ok("快選：來源瓦數 '' 不帶過來、其他欄位不補預設（只有來源真的有的）",
     j.qKeys === 'Component,Limit(C),Qty,Type', j);
  ok('快選：來源沒有瓦數 → 不鎖瓦數（要讓使用者能填），並列為缺值',
     j.qLocked === false && j.qMiss.includes('Power(W)'), j);

  console.log('\n[K] 寫回 DB 的元件是深拷貝、去掉舊版 _filled');
  const k = await page.evaluate(() => {
    components.rf[0]._filled = { R_jc: true };
    components.rf[0].Rth = [{ type:'JC_bot', value:0.4 }];
    const fields = _buildProjectFields('T', {});
    components.rf[0].Rth[0].value = 9.9; components.rf[0]['Height(mm)'] = 111;
    const w = fields.rf_data[0];
    const res = { noFilled: w._filled === undefined, rthIsolated: w.Rth[0].value === 0.4, hIsolated: w['Height(mm)'] !== 111 };
    delete components.rf[0]._filled; delete components.rf[0].Rth; components.rf[0]['Height(mm)'] = 450;
    return res;
  });
  ok('寫回 DB 的資料不含 _filled', k.noFilled, k);
  ok('寫出去之後再改畫面上的元件，不會改到要寫進 DB 的那份（深拷貝）', k.rthIsolated && k.hIsolated, k);

  console.log('\n[L] 重量估算出廠預設值（參數控制台）');
  const l = await page.evaluate(() => {
    const gp = DEFAULT_CONFIG.global_params;
    return { al: gp.al_density, filter: gp.filter_density, shield: gp.shielding_density, pcb: gp.pcb_surface_density };
  });
  ok('出廠預設＝鋁 2.7／Filter 1／Shielding 1.5／PCB 1.2',
     l.al === 2.7 && l.filter === 1 && l.shield === 1.5 && l.pcb === 1.2, l);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
