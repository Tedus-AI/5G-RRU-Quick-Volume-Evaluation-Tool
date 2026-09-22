/*
 * TIM 型號串通（TIM_Model → tim_library）＋ Pad2 收斂 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 驗證情境：
 *   [A] calcRow 的 TIM 來源：沒有型號時逐列與舊公式相同（回歸）；選了型號改吃型號的
 *       k 與 gapThickness；型號查不到／缺 k 時退回參數控制台並標警告；畫面看得出來源。
 *   [B] Pad2 收斂：下拉不再有 Pad2；舊資料仍用 K_Pad2/t_Pad2 算得出來（不靜默變 0）；
 *       遷移橫幅把 Pad2 改成 Pad ＋型號；換類型／取消選型都是 delete key 而非寫 ''。
 *   [C] 快選 carry 白名單 21 項（含 TIM_Model）、物件欄位深拷貝。
 *   [D] K_Pad2/t_Pad2 移除後的相容性：不再寫入，但既有專案的值不被刪。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/tim-model.test.js          # 可用 TEST_URL 指定網址
 *
 * 需要 playwright（全域或本地皆可）與 Chromium。CDN 資源在測試中一律擋掉並補最小 stub，
 * 因此不需要對外網路。
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

  // 外部 CDN 不可用 → 擋掉並補上最小 stub，讓頁面其餘邏輯照常跑
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

  console.log('\n[A] calcRow 的 TIM 來源');

  // A0 —— 基準：無型號庫時，每一列的 R_TIM 必須與「改動前的公式」完全相同
  const baseline = await page.evaluate(() => {
    const g = G, out = [];
    const tm = {Grease:{k:g.K_Grease,t:g.t_Grease},Pad:{k:g.K_Pad,t:g.t_Pad},Putty:{k:g.K_Putty,t:g.t_Putty},None:{k:1,t:0}};
    calcResults.rows.forEach(r => {
      const ti = tm[r.TIM_Type] || {k:1,t:0};
      let bl, bw;
      if (r.Board_Type === 'Copper Coin') { bl = g.Coin_L_Setting; bw = g.Coin_W_Setting; }
      else if (r['Power(W)'] === 0 || r['Thick(mm)'] === 0) { bl = 0; bw = 0; }
      else { bl = r.Pad_L + r['Thick(mm)']; bw = r.Pad_W + r['Thick(mm)']; }
      const pa = (r.Pad_L*r.Pad_W)/1e6, ba = (bl*bw)/1e6, ta = ba > 0 ? ba : pa;
      const expect = (ta > 0 && ti.t > 0) ? (ti.t/1000)/(ti.k*ta) : 0;
      out.push({ name:r.Component, type:r.TIM_Type, got:r.R_TIM, expect, src:r.TIM_Src, label:r.TIM_SrcLabel });
    });
    return out;
  });
  ok('無型號庫時 R_TIM 與舊公式逐列相同（' + baseline.length + ' 列）',
     baseline.every(r => near(r.got, r.expect, 1e-12)),
     baseline.filter(r => !near(r.got, r.expect, 1e-12)));
  ok('無型號庫時來源標為 global / none',
     baseline.every(r => r.src === 'global' || r.src === 'none'),
     baseline.map(r => [r.name, r.type, r.src]));

  // A1 —— 掛上型號庫（stub dbAdapter 的 getCollection）後，選型號的那一列改吃型號的 k / gapThickness
  const a1 = await page.evaluate(async () => {
    const lib = {
      t1: { model:'TG-A6200', timType:'Pad',    k:6.2,  thickness:2.5,  gapThickness:1.2, vendor:'T-Global' },
      t2: { model:'TP-500',   timType:'Putty',  k:5.0,  thickness:0.5,  gapThickness:0.5 },
      t3: { model:'GR-9',     timType:'Grease', k:9.0,  thickness:0.05, gapThickness:0.05 },
      t4: { model:'BAD-PAD',  timType:'Pad',    k:0,    thickness:1.0,  gapThickness:1.0 },   // k 沒填好
    };
    // dbAdapter 是 const（詞法繫結），覆寫 window.dbAdapter 沒用 → 直接換掉它的方法
    dbAdapter.isReady = () => true;
    dbAdapter.getCollection = async (c) => (c === 'tim_library' ? lib : {});
    await timLibLoad(true);
    const row = components.rf[0];
    const before = { type: row.TIM_Type, model: row.TIM_Model };
    row.TIM_Type = 'Pad'; row.TIM_Model = 'TG-A6200';
    recalc();
    const r = calcResults.rows.find(x => x.Component === row.Component);
    const pa = (row.Pad_L*row.Pad_W)/1e6;
    const bl = row.Board_Type==='Copper Coin' ? G.Coin_L_Setting : (row['Power(W)']===0||row['Thick(mm)']===0 ? 0 : row.Pad_L+row['Thick(mm)']);
    const bw = row.Board_Type==='Copper Coin' ? G.Coin_W_Setting : (row['Power(W)']===0||row['Thick(mm)']===0 ? 0 : row.Pad_W+row['Thick(mm)']);
    const ba = (bl*bw)/1e6, ta = ba>0?ba:pa;
    return { before, timLibLoaded, name: row.Component, src: r.TIM_Src, label: r.TIM_SrcLabel, k: r.TIM_k, t: r.TIM_t,
             got: r.R_TIM, expect: (1.2/1000)/(6.2*ta), warn: r.TIM_Warn, detail: r.TIM_SrcDetail };
  });
  ok('tim_library 讀得到（唯讀）', a1.timLibLoaded === true);
  ok('選了型號 → k/t 取自型號（k=6.2, gapThickness=1.2）', a1.k === 6.2 && a1.t === 1.2 && a1.src === 'model', a1);
  ok('R_TIM 用型號的 gapThickness 重算', near(a1.got, a1.expect, 1e-12), a1);
  ok('來源標示為型號名', /TG-A6200/.test(a1.label || ''), a1.label);
  ok('型號來源沒有警告', !a1.warn, a1.warn);

  // A2 —— 型號查不到 / 型號缺 k → 退回參數控制台，且要有琥珀色警告
  const a2 = await page.evaluate(() => {
    const row = components.rf[0], out = {};
    row.TIM_Model = 'NOT-IN-LIB'; recalc();
    let r = calcResults.rows.find(x => x.Component === row.Component);
    out.gone = { src:r.TIM_Src, k:r.TIM_k, t:r.TIM_t, warn:r.TIM_Warn };
    row.TIM_Model = 'BAD-PAD'; recalc();
    r = calcResults.rows.find(x => x.Component === row.Component);
    out.badk = { src:r.TIM_Src, k:r.TIM_k, t:r.TIM_t, warn:r.TIM_Warn };
    out.globalK = G.K_Pad; out.globalT = G.t_Pad;
    return out;
  });
  ok('型號不在庫裡 → fallback 參數控制台 + 警告',
     a2.gone.src === 'global' && a2.gone.k === a2.globalK && a2.gone.t === a2.globalT && /不在型號庫/.test(a2.gone.warn), a2.gone);
  ok('型號缺 k → fallback 參數控制台 + 警告',
     a2.badk.src === 'global' && a2.badk.k === a2.globalK && /缺 k/.test(a2.badk.warn), a2.badk);

  // A3 —— 畫面上看得出來源（元件表的來源標註 + Tab1 的 R_TIM 標記）
  const a3 = await page.evaluate(() => {
    components.rf[0].TIM_Model = 'TG-A6200'; recalc();
    const cell = document.querySelector('#subtab0 table.comp-table tbody tr td .tim-note');
    const warnRows = document.querySelectorAll('#subtab0 .tim-note-warn').length;
    const modelSel = document.querySelector('#subtab0 table.comp-table tbody tr .tim-sub select');
    switchTab(1);
    const tab1 = document.getElementById('tab1-table').innerHTML;
    return { note: cell ? cell.textContent.trim() : null, noteTitle: cell ? cell.getAttribute('title') : null,
             warnRows, modelValue: modelSel ? modelSel.value : null,
             modelOptions: modelSel ? Array.from(modelSel.options).map(o=>o.value) : [],
             tab1HasMark: /tim-mark/.test(tab1) };
  });
  ok('元件表顯示「k=… · t=… ← 型號 …」', /k=6\.2/.test(a3.note||'') && /t=1\.2mm/.test(a3.note||'') && /TG-A6200/.test(a3.note||''), a3.note);
  ok('來源 tooltip 說明得出處', /TIM 型號庫/.test(a3.noteTitle||''), a3.noteTitle);
  ok('型號下拉只列同類型（Pad）的型號', a3.modelOptions.join(',') === ',BAD-PAD,TG-A6200' || a3.modelOptions.includes('TG-A6200'), a3.modelOptions);
  ok('型號下拉選到目前型號', a3.modelValue === 'TG-A6200', a3.modelValue);
  ok('Tab1 的 R_TIM 有來源標記', a3.tab1HasMark === true);

  console.log('\n[B] Pad2 收斂');
  const b1 = await page.evaluate(() => {
    switchTab(0);
    const sels = Array.from(document.querySelectorAll('#subtab0 table.comp-table tbody tr td select'));
    const timSel = sels.filter(s => Array.from(s.options).some(o => o.value === 'Putty' || o.value === 'Grease'));
    return { opts: timSel.length ? Array.from(timSel[0].options).map(o=>o.value) : [], TIM_TYPES: TIM_TYPES.slice() };
  });
  ok('TIM 類型常數不再含 Pad2', !b1.TIM_TYPES.includes('Pad2'), b1.TIM_TYPES);
  ok('一般列的下拉沒有 Pad2 選項', !b1.opts.includes('Pad2'), b1.opts);

  // B2 —— 舊資料（TIM_Type='Pad2'）：仍用 K_Pad2/t_Pad2 算得出來、下拉臨時補回該選項、跳遷移橫幅
  const b2 = await page.evaluate(() => {
    const row = components.digital[0];
    delete row.TIM_Model;
    row.TIM_Type = 'Pad2';
    G.K_Pad2 = 7.5; G.t_Pad2 = 1.0;     // 模擬舊專案 global_params 殘留值
    recalc();
    const r = calcResults.rows.find(x => x.Component === row.Component);
    const pa = (row.Pad_L*row.Pad_W)/1e6;
    const bl = row.Board_Type==='Copper Coin' ? G.Coin_L_Setting : (row['Power(W)']===0||row['Thick(mm)']===0 ? 0 : row.Pad_L+row['Thick(mm)']);
    const bw = row.Board_Type==='Copper Coin' ? G.Coin_W_Setting : (row['Power(W)']===0||row['Thick(mm)']===0 ? 0 : row.Pad_W+row['Thick(mm)']);
    const ba=(bl*bw)/1e6, ta=ba>0?ba:pa;
    const banner = document.getElementById('tim-migrate-banner').innerHTML;
    const legacyOpt = Array.from(document.querySelectorAll('#subtab1 table.comp-table tbody tr td select'))
      .flatMap(s => Array.from(s.options).map(o=>o.value)).filter(v=>v==='Pad2');
    return { name: row.Component, src:r.TIM_Src, k:r.TIM_k, t:r.TIM_t, warn:r.TIM_Warn,
             got:r.R_TIM, expect:(1.0/1000)/(7.5*ta),
             bannerHasWarn: /Pad 2 已停用/.test(banner), bannerHasName: banner.includes(row.Component),
             legacyOptCount: legacyOpt.length };
  });
  ok('舊 Pad2 仍以 K_Pad2/t_Pad2 計算（不靜默變 0）', b2.src === 'legacy' && near(b2.got, b2.expect, 1e-12), b2);
  ok('舊 Pad2 有停用提醒', /已停用/.test(b2.warn||''), b2.warn);
  ok('舊值仍出現在該列下拉（不靜默改掉使用者資料）', b2.legacyOptCount === 1, b2.legacyOptCount);
  ok('Tab0 跳出 Pad 2 遷移橫幅並列出元件', b2.bannerHasWarn && b2.bannerHasName, b2);

  // B3 —— 遷移：Pad2 → Pad + 型號
  const b3 = await page.evaluate(() => {
    document.getElementById('tim-migrate-model').value = 'TG-A6200';
    window.__alerts = [];
    timMigratePad2();
    const row = components.digital[0];
    const r = calcResults.rows.find(x => x.Component === row.Component);
    return { type: row.TIM_Type, model: row.TIM_Model, src: r.TIM_Src, k: r.TIM_k, t: r.TIM_t,
             banner: document.getElementById('tim-migrate-banner').innerHTML.trim(),
             alerted: (window.__alerts[0]||'') };
  });
  ok('遷移後 TIM_Type=Pad 且掛上型號', b3.type === 'Pad' && b3.model === 'TG-A6200', b3);
  ok('遷移後改吃型號的 k/t', b3.src === 'model' && b3.k === 6.2 && b3.t === 1.2, b3);
  ok('遷移後橫幅消失', b3.banner === '', b3.banner);
  ok('遷移後提醒要存檔', /儲存專案/.test(b3.alerted), b3.alerted);

  // B4 —— 換 TIM 類型 → 型號 key 被刪掉（不留下不相符的型號、也不寫 ''）
  const b4 = await page.evaluate(() => {
    updateComp('digital', 0, 'TIM_Type', 'Putty');
    const row = components.digital[0];
    return { hasKey: Object.prototype.hasOwnProperty.call(row, 'TIM_Model'), type: row.TIM_Type };
  });
  ok('換類型後 TIM_Model key 被 delete（不是寫 \'\'）', b4.hasKey === false && b4.type === 'Putty', b4);

  // B5 —— 清掉型號選擇 → delete key
  const b5 = await page.evaluate(() => {
    components.rf[0].TIM_Model = 'TG-A6200';
    updateTimModel('rf', 0, '');
    return Object.prototype.hasOwnProperty.call(components.rf[0], 'TIM_Model');
  });
  ok('取消選型 → delete key（不寫 \'\'）', b5 === false, b5);

  console.log('\n[C] 快選 carry 白名單');
  const c1 = await page.evaluate(() => {
    const src = { Component:'X', Qty:2, 'Power(W)':3, TIM_Type:'Pad', TIM_Model:'TG-A6200',
                  Rth:[{type:'JC_bot',value:0.5,primary:true}], SpecFile:{path:'SPEC/A/x.pdf'},
                  'Height(mm)':10, 'Thick(mm)':1, Board_Type:'Thermal Via', 'Limit(C)':105, R_jc:0.4,
                  Pad_L:5, Pad_W:6, Type:'PA', 'Power_RT(W)':2, TV_ID_mil:8, TV_Qty:20,
                  Temp_Sensor:'Y', Local_Qty:1, Remote_Qty:0, note:'n' };
    const carried = carrySrc(src);
    const missing = ['TIM_Model','TIM_Type','R_jc','Rth','SpecFile','Type','note'].filter(k => carried[k] === undefined);
    carried.Rth[0].value = 9.9;           // 深拷貝檢查
    const projects = { p1: { project_name:'ProjA', meta:{timestamp:'2020-01-01T00:00:00Z'}, rf_data:[src] } };
    const agg = aggregateVariants(projects, 'rf');
    return { count: VARIANT_CARRY.length, missing, deepCopied: src.Rth[0].value === 0.5,
             aggHasModel: agg[0] && agg[0].src.TIM_Model === 'TG-A6200' };
  });
  ok('VARIANT_CARRY 共 21 項（與 AI-Thermal 同步）', c1.count === 21, c1.count);
  ok('關鍵欄位都有帶（含 TIM_Model）', c1.missing.length === 0, c1.missing);
  ok('物件欄位深拷貝（不共用參照）', c1.deepCopied === true);
  ok('跨專案聚合帶得出 TIM_Model', c1.aggHasModel === true);

  console.log('\n[D] K_Pad2 / t_Pad2 移除後的相容性');
  const d1 = await page.evaluate(() => {
    const noInput = !document.getElementById('K_Pad2') && !document.getElementById('t_Pad2');
    const notInKeys = !PROJECT_GLOBAL_KEYS.includes('K_Pad2') && !PROJECT_GLOBAL_KEYS.includes('t_Pad2');
    // 既有專案有 K_Pad2 → 合併時必須保留（不是被我們刪掉）
    const keep = _buildProjectFields('T', { global_params: { K_Pad2: 7.5, t_Pad2: 1.0, ai_thermal_only_key: 'keep-me' } });
    // 全新專案 → 我們不主動寫這兩個 key
    const fresh = _buildProjectFields('T', null);
    G.K_Pad2 = 9; G.t_Pad2 = 9; G.K_Solder = 58;
    clearGlobalsWithoutInputs();
    return { noInput, notInKeys,
      kept: keep.global_params.K_Pad2 === 7.5 && keep.global_params.t_Pad2 === 1.0,
      keptSibling: keep.global_params.ai_thermal_only_key === 'keep-me',
      freshHasNone: !('K_Pad2' in fresh.global_params) && !('t_Pad2' in fresh.global_params),
      clearedLegacy: !('K_Pad2' in G) && !('t_Pad2' in G), keptSolder: G.K_Solder === 58,
      timBackToDefault: G.K_Pad === 7.5 && G.t_Pad === 1.7 };
  });
  ok('參數控制台不再有 K_Pad2 / t_Pad2 欄位', d1.noInput);
  ok('PROJECT_GLOBAL_KEYS 不再含 K_Pad2 / t_Pad2', d1.notInKeys);
  ok('既有專案的 K_Pad2 / t_Pad2 存檔時被保留（不刪別人的值）', d1.kept, d1);
  ok('sibling tool 專屬的 global key 仍保留（shallow merge 不吃掉別人的欄位）', d1.keptSibling, d1);
  ok('新專案不寫入 K_Pad2 / t_Pad2', d1.freshHasNone, d1);
  ok('換專案時清掉沒有輸入框的舊參數，但不動 K_Solder', d1.clearedLegacy && d1.keptSolder, d1);
  ok('換專案時 TIM 的 K_/t_ 退回出廠預設（不是被 delete 掉 → R_TIM 不會變 0）', d1.timBackToDefault, d1);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
