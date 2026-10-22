/*
 * Thermal Via 逐顆 K_eff（AI-Thermal「Thermal Via 計算」）—— headless 驗證
 * ---------------------------------------------------------------------------
 * 規則：導熱方式＝Thermal Via 的元件，AI-Thermal 有完整的 via 設計（ViaCalc.keffForComp ok）
 *       → R_int ＝ 板厚 ÷ (K_eff × 焊盤面積)（＝AI-Thermal 頁面的 R_th：不加擴散面積、不除 Via_Eff）；
 *       抓不到（沒有設計、缺輸入、暫不納入、via 面積超過焊盤）→ 通用值 K_Via（原本的算法）。
 *
 * 驗證情境：
 *   [A] 回歸：沒有 thermal_specs → 每一列的 R_int 與改動前的公式逐列相同；Thermal Via 標通用值＋原因
 *   [B] 完整 via 設計 → 那一顆改用 K_eff（數字與獨立算的公式相同）；其他元件的 R_int／允許溫升完全不變
 *   [C] 退回通用值：缺塞孔材料／暫不納入／via 面積 > 焊盤；不是 Thermal Via 的元件有 via 設計也不用；
 *       _renamed_from 查得到；試算值照用；配置有問題照用＋⚠
 *   [D] 畫面：元件表導熱方式底下標 K 來源（K_eff 藍邊／通用值＋原因）、圖例；分析表 R_int ◆／⚠、展開列算式；
 *       參數控制台 K_Via 標「通用值」
 *   [E] 專案生命週期：載入帶入、換專案不沿用；切回分頁 thermal_specs 有變 → 重算（有未存修改也照樣換、修改保留）；
 *       存檔不寫 thermal_specs、存完換成資料庫最新的；複製專案 → AI-Thermal 的資料不跟著 → 改用通用值並提示
 *   [F] PDF：元件清單導熱方式底下附 K、說明；分析表 R_int 標 (K_eff)
 *   [G] Excel：元件匯出多一欄「Via K（Thermal Via）」
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/via-k.test.js
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
    window.XLSX = { utils: { book_new: () => ({ sheets: [] }), aoa_to_sheet: (a) => ({ aoa: a }),
      book_append_sheet: (wb, ws, n) => wb.sheets.push({ n, aoa: ws.aoa }) }, writeFile: (wb, fn) => { window.__xlsx = { wb, fn }; } };
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

  // 獨立算的 K_eff（不呼叫 viaCalc.js）：N·A_cu·385 + N·A_fill·K_fill + A_FR4·0.3，全部 ÷ A_pad
  const KEFF = (L, W, n, mil, platMm, kFill) => {
    const ri = mil * 0.0254 / 2, ro = ri + platMm, aFill = Math.PI * ri * ri, aFoot = Math.PI * ro * ro, aCu = aFoot - aFill, A = L * W;
    return (n * aCu * 385 + n * aFill * kFill + (A - n * aFoot) * 0.3) / A;
  };
  const snap = () => page.evaluate(() => calcResults.rows.map(r => ({ n: r.Component, bt: r.Board_Type, ri: r.R_int, rt: r.R_TIM, adt: r.Allowed_dT,
    src: r.Via_Src, k: r.Via_K, why: r.Via_Why, warn: r.Via_Warn, thick: r['Thick(mm)'] })));
  const row = (S, n) => S.find(r => r.n === n);

  console.log('\n[A] 回歸：沒有 thermal_specs → 與改動前的公式逐列相同');
  const A = await page.evaluate(() => {
    const g = G, out = [];
    calcResults.rows.forEach(r => {
      // 改動前的 calcThermalResistance（原封不動）
      let kCoin = parseFloat(g.K_Coin); if (!(kCoin > 0)) kCoin = 380;
      let kb = 0; if (r.Board_Type === 'Copper Coin') kb = kCoin; else if (r.Board_Type === 'Thermal Via') kb = g.K_Via;
      const pa = (r.Pad_L * r.Pad_W) / 1e6, ba = (r.Base_L * r.Base_W) / 1e6;
      let ri = 0;
      if (kb > 0 && pa > 0) { const ea = ba > 0 ? Math.sqrt(pa * ba) : pa; const rv = (r['Thick(mm)'] / 1000) / (kb * ea);
        if (r.Board_Type === 'Copper Coin') ri = rv + ((g.t_Solder / 1000) / (g.K_Solder * pa * g.Voiding));
        else if (r.Board_Type === 'Thermal Via') ri = rv / g.Via_Eff; else ri = rv; }
      out.push({ n: r.Component, bt: r.Board_Type, got: r.R_int, exp: ri, src: r.Via_Src, why: r.Via_Why });
    });
    return out;
  });
  ok('每一列的 R_int 與改動前的公式完全相同（' + A.length + ' 列）', A.every(r => r.got === r.exp), A.filter(r => r.got !== r.exp));
  const tvA = A.filter(r => r.bt === 'Thermal Via');
  ok('Thermal Via 元件（' + tvA.length + ' 顆）都標通用值、原因「還沒有這顆的 via 設計」', tvA.length >= 2 && tvA.every(r => r.src === 'generic' && /還沒有這顆的 via 設計/.test(r.why)), tvA);
  ok('不是 Thermal Via 的元件沒有 Via_Src', A.filter(r => r.bt !== 'Thermal Via').every(r => !r.src));

  console.log('\n[B] 完整 via 設計 → 改用逐顆 K_eff');
  const S0 = await snap();
  await page.evaluate(() => {
    const d = components.rf.find(c => c.Component === 'Driver PA');
    d.TV_Qty = 25; d.TV_ID_mil = 8;                         // EE 清單（AI-Thermal 寫的欄位）
    setProjThermalSpecs({ Driver_PA: { epadSize: '5×5', via: { fill: 'copper', pitchMil: 30 } } });
    recalc();
  });
  const S1 = await snap();
  const kExp = KEFF(5, 5, 25, 8, 0.0254, 385);
  const d1 = row(S1, 'Driver PA');
  ok('Driver PA：Via_Src = keff、K_eff 與獨立算的公式相同（' + kExp.toFixed(3) + '）', d1.src === 'keff' && Math.abs(d1.k - kExp) < 1e-9, { d1, kExp });
  ok('R_int ＝ 板厚 ÷ (K_eff × 焊盤面積)（不加擴散面積、不除 Via_Eff）', Math.abs(d1.ri - d1.thick / (kExp * 25) * 1000) < 1e-12, { got: d1.ri, exp: d1.thick / (kExp * 25) * 1000 });
  ok('（對照：通用值的 R_int 不一樣 → 真的換了算法）', Math.abs(row(S0, 'Driver PA').ri - d1.ri) > 1e-6, [row(S0, 'Driver PA').ri, d1.ri]);
  const others = S1.filter(r => r.n !== 'Driver PA');
  ok('其他元件的 R_int、R_TIM、允許溫升完全不變', others.every(r => { const o = row(S0, r.n); return o.ri === r.ri && o.rt === r.rt && o.adt === r.adt; }),
     others.filter(r => { const o = row(S0, r.n); return !(o.ri === r.ri && o.rt === r.rt && o.adt === r.adt); }));
  ok('Pre Driver（沒有 via 設計）仍是通用值', row(S1, 'Pre Driver').src === 'generic');
  const viaVol = await page.evaluate(() => ({ v: calcResults.Volume_L, bn: calcResults.Bottleneck_Name }));
  console.log('     （參考：內建範例 Driver PA 改用 K_eff 後，體積 ' + viaVol.v.toFixed(2) + ' L、瓶頸 ' + viaVol.bn + '）');

  console.log('\n[C] 退回通用值／照用');
  const caseOf = (mut) => page.evaluate((mut) => {
    const base = { Driver_PA: { epadSize: '5×5', via: { fill: 'copper', pitchMil: 30 } } };
    new Function('s', 'c', mut)(base, components.rf.find(c => c.Component === 'Driver PA'));
    setProjThermalSpecs(base); recalc();
    const r = calcResults.rows.find(x => x.Component === 'Driver PA' || x._renamed_from === 'Driver PA');
    return { src: r.Via_Src, why: r.Via_Why, warn: r.Via_Warn, ri: r.R_int, k: r.Via_K, detail: r.Via_Detail };
  }, mut);
  let c = await caseOf("delete s.Driver_PA.via.fill;");
  ok('缺塞孔材料 → 通用值、原因「via 設計還缺：塞孔材料」、R_int 回到原本', c.src === 'generic' && c.why === 'via 設計還缺：塞孔材料' && c.ri === row(S0, 'Driver PA').ri, c);
  c = await caseOf("s.Driver_PA.via.skip = true;");
  ok('暫不納入熱流評估 → 通用值', c.src === 'generic' && /暫不納入熱流評估/.test(c.why), c);
  c = await caseOf("s.Driver_PA.epadSize = '1×1'; s.Driver_PA.via.qty = 40;");
  ok('via 面積 > 焊盤 → 通用值、原因寫「超過焊盤」', c.src === 'generic' && /超過焊盤/.test(c.why), c);
  c = await caseOf("s.Driver_PA.via.qty = 16; s.Driver_PA.via.diaMil = 10;");
  ok('試算值（16 顆 10 mil）照用、tooltip 寫出 EE 清單的值', c.src === 'keff' && Math.abs(c.k - KEFF(5, 5, 16, 10, 0.0254, 385)) < 1e-9 && /試算值 16（EE 清單是 25）/.test(c.detail), c);
  c = await caseOf("s.Driver_PA.via.pitchMil = 80;");
  ok('孔壁超出焊盤 → K_eff 照用、標警告', c.src === 'keff' && /孔壁超出焊盤/.test(c.warn), c);
  c = await caseOf("delete s.Driver_PA.via.pitchMil;");
  ok('沒填中心間距 → K_eff 照用、警告「沒填中心間距」', c.src === 'keff' && /沒填中心間距/.test(c.warn), c);
  c = await caseOf("c.Component = 'Driver PA v2'; c._renamed_from = 'Driver PA';");
  ok('改了名（_renamed_from）→ 用舊名稱的 via 設計、tooltip 說明', c.src === 'keff' && /舊名稱「Driver PA」/.test(c.detail), c);
  await page.evaluate(() => { const d = components.rf.find(c => c.Component === 'Driver PA v2'); d.Component = 'Driver PA'; delete d._renamed_from; });
  const cc = await page.evaluate(() => {
    setProjThermalSpecs({ Driver_PA: { epadSize: '5×5', via: { fill: 'copper', pitchMil: 30 } }, Final_PA: { epadSize: '20×10', via: { fill: 'copper' } } });
    const fp = components.rf.find(c => c.Board_Type === 'Copper Coin'); fp.TV_Qty = 50; fp.TV_ID_mil = 8;
    recalc();
    const r = calcResults.rows.find(x => x.Component === fp.Component);
    return { name: fp.Component, src: r.Via_Src, ri: r.R_int };
  });
  ok('不是 Thermal Via 的元件（' + cc.name + '，Copper Coin）有 via 設計也不用、R_int 不變', !cc.src && cc.ri === row(S0, cc.name).ri, cc);

  console.log('\n[D] 畫面');
  await page.evaluate(() => { switchTab(0); });
  const D = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#subtab0 tbody tr')];
    const cell = (name) => { const t = tr.find(x => (x.querySelector('td[data-col="Component"] input') || {}).value === name); return t && t.querySelector('td[data-col="Board_Type"]'); };
    const dp = cell('Driver PA').querySelector('.via-k-note'), pd = cell('Pre Driver').querySelector('.via-k-note');
    const fp = tr.map(x => x.querySelector('td[data-col="Board_Type"]')).find(td => td.querySelector('select').value === 'Copper Coin');
    return { dp: dp && { cls: dp.className, text: dp.textContent, tip: dp.title }, pd: pd && { cls: pd.className, text: pd.textContent, tip: pd.title },
      fpNote: !!fp.querySelector('.via-k-note'),
      legend: (document.querySelector('#subtab0 .derived-legend') || {}).textContent || '',
      lbl: document.getElementById('K_Via').previousElementSibling.textContent, effTip: document.getElementById('Via_Eff').previousElementSibling.title,
      hint: (document.querySelector('.via-k-hint') || {}).textContent || '' };
  });
  ok('Driver PA：導熱方式底下「K_eff … W/m·K ← AI-Thermal via 計算」、藍邊樣式', D.dp && /via-k-eff/.test(D.dp.cls) && /^K_eff \d+(\.\d)? W\/m·K← AI-Thermal via 計算$/.test(D.dp.text), D.dp);
  ok('tooltip 寫出算式、via 設計、焊盤來源、去哪裡改', D.dp && /R_int ＝ 板厚 ÷ \(K_eff × 焊盤面積 25 mm²\)/.test(D.dp.tip) && /25 顆 × 內徑 8 mil/.test(D.dp.tip)
    && /塞孔 電鍍填銅/.test(D.dp.tip) && /AI-Thermal TH\/ME 頁的 E-PAD/.test(D.dp.tip) && /到 AI-Thermal 的「Thermal Via 計算」/.test(D.dp.tip), D.dp && D.dp.tip);
  ok('Pre Driver：「通用值 K_Via 30 W/m·K」＋原因、不是藍邊', D.pd && !/via-k-eff/.test(D.pd.cls) && /^通用值 K_Via 30 W\/m·K/.test(D.pd.text) && /還沒有這顆的 via 設計/.test(D.pd.text), D.pd);
  ok('Copper Coin 元件沒有 K 標示', !D.fpNote);
  ok('圖例說明藍邊的 K_eff 來自 AI-Thermal、只能在 AI-Thermal 改', /K\s*eff 是 AI-Thermal「Thermal Via 計算」的逐顆等效 K（只能在 AI-Thermal 改）/.test(D.legend), D.legend);
  ok('參數控制台：K_Via 標「通用值」、製程係數 tooltip 寫「只套用在通用值」＋說明', /Via 等效 K 值（通用值）/.test(D.lbl) && /只套用在通用值/.test(D.effTip) && /抓不到逐顆 K\s*eff 時才用這兩個值/.test(D.hint), D);
  await page.evaluate(() => { switchTab(1); tab1Expanded.clear(); const r = calcResults.rows.find(x => x.Component === 'Driver PA'); tab1Expanded.add(tab1RowKey(r)); renderTab1(); });
  const T = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#tab1-table tbody tr')].find(x => /Driver PA/.test((x.querySelector('td.an-name') || {}).textContent || '') && !/Pre/.test(x.querySelector('td.an-name').textContent));
    const ri = tr.querySelector('td[data-col="R_int"]');
    const pd = [...document.querySelectorAll('#tab1-table tbody tr')].find(x => /Pre Driver/.test((x.querySelector('td.an-name') || {}).textContent || ''));
    const det = document.querySelector('#tab1-table tr.an-detail');
    return { mark: (ri.querySelector('.tim-mark') || {}).textContent || '', tip: ri.title, pdMark: !!pd.querySelector('td[data-col="R_int"] .tim-mark'),
             pdTip: pd.querySelector('td[data-col="R_int"]').title, det: det ? det.textContent : '' };
  });
  ok('分析表 R_int：Driver PA 標 ◆、tooltip 是 K_eff 說明', T.mark === '◆' && /逐顆 K_eff/.test(T.tip), T);
  ok('分析表 R_int：Pre Driver 沒有記號、tooltip 寫通用值與原因', !T.pdMark && /通用值 K_Via = 30/.test(T.pdTip) && /沒有用逐顆 K_eff/.test(T.pdTip), T.pdTip);
  ok('展開列：基板 R_int ＝ 板厚 ÷ (逐顆 K_eff × 焊盤 25 mm²)', /基板 R_int [\d.]+ ＝ 板厚 2 mm ÷ \(逐顆 K_eff [\d.]+ W\/m·K × 焊盤 25 mm²\)/.test(T.det), T.det);
  await page.evaluate(() => { setProjThermalSpecs({ Driver_PA: { epadSize: '5×5', via: { fill: 'copper', pitchMil: 80 } } }); recalc(); });
  const W = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#tab1-table tbody tr')].find(x => /^.*Driver PA$/.test((x.querySelector('td.an-name') || {}).textContent || '') && !/Pre/.test(x.querySelector('td.an-name').textContent));
    switchTab(0);
    const t0 = [...document.querySelectorAll('#subtab0 tbody tr')].find(x => (x.querySelector('td[data-col="Component"] input') || {}).value === 'Driver PA');
    switchTab(1);
    return { mark: (tr.querySelector('td[data-col="R_int"] .tim-mark') || {}).textContent || '', note: t0.querySelector('.via-k-note').className, noteText: t0.querySelector('.via-k-note').textContent };
  });
  ok('配置有問題：分析表標 ⚠、元件表的 K 標示轉琥珀色 ⚠', W.mark === '⚠' && /via-k-warn/.test(W.note) && /^⚠ K_eff/.test(W.noteText), W);

  console.log('\n[E] 專案生命週期');
  await page.evaluate(() => {
    const comps = JSON.parse(JSON.stringify({ rf: components.rf, digital: components.digital, pwr: components.pwr }));
    window.__db = { projects: {
      X: { project_name: 'VIA 案', global_params: Object.assign({}, G),
           thermal_specs: { Driver_PA: { epadSize: '5×5', heatSourceSize: '6×6', via: { fill: 'copper', pitchMil: 30 } } },
           rf_data: comps.rf, digital_data: comps.digital, pwr_data: comps.pwr, validation_data: { rf: [] } },
      Y: { project_name: '沒有 via 的案子', global_params: Object.assign({}, G), rf_data: comps.rf, digital_data: comps.digital, pwr_data: comps.pwr },
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
      window.__writes.push({ id, keys: Object.keys(ff) });
      window.__db[c][id] = Object.assign({}, cur || {}, JSON.parse(JSON.stringify(ff)));
    };
    _ensureLockBeforeWrite = async () => true;
  });
  const dpSrc = () => page.evaluate(() => { const r = calcResults.rows.find(x => x.Component === 'Driver PA'); return { src: r.Via_Src, why: r.Via_Why, k: r.Via_K }; });
  await page.evaluate(async () => { await cloudLoadOne('X'); });
  ok('載入有 via 設計的專案 → Driver PA 用 K_eff', (await dpSrc()).src === 'keff');
  await page.evaluate(async () => { await cloudLoadOne('Y'); });
  ok('換到沒有 thermal_specs 的專案 → 通用值（不沿用上一個專案的 via 設計）', (await dpSrc()).src === 'generic');
  await page.evaluate(async () => { await cloudLoadOne('X'); window.__alerts = []; });
  // AI-Thermal 只改了 via 設計（元件清單沒變）→ 切回分頁要看得到
  await page.evaluate(() => { window.__db.projects.X.thermal_specs.Driver_PA.via.fill = 'epoxy'; });
  await page.evaluate(async () => { await checkProjectFreshness(true); });
  const e1 = await page.evaluate(() => ({ r: calcResults.rows.find(x => x.Component === 'Driver PA').Via_K, toast: (document.getElementById('cm-toast') || {}).textContent || '', dirty: projectIsDirty() }));
  ok('切回分頁：只改了 via 設計（塞孔改導熱膠）→ 重算、K_eff 換成新值、提示', Math.abs(e1.r - KEFF(5, 5, 25, 8, 0.0254, 2)) < 1e-9 && /Thermal Via 設計有更新/.test(e1.toast) && !e1.dirty, e1);
  await page.evaluate(() => { components.rf.find(c => c.Component === 'Driver PA')['Height(mm)'] = 211; recalc(); });
  await page.evaluate(() => { delete window.__db.projects.X.thermal_specs.Driver_PA.via.fill; });
  await page.evaluate(async () => { await checkProjectFreshness(true); });
  const e2 = await page.evaluate(() => ({ src: calcResults.rows.find(x => x.Component === 'Driver PA').Via_Src, h: components.rf.find(c => c.Component === 'Driver PA')['Height(mm)'], dirty: projectIsDirty() }));
  ok('有未存修改時 thermal_specs 一樣換成最新的（不會跟修改衝突）、修改保留', e2.src === 'generic' && e2.h === 211 && e2.dirty, e2);
  // 存檔：本工具不寫 thermal_specs；存完換成資料庫裡（別人剛改過的）那一份
  const specsBefore = await page.evaluate(() => { window.__db.projects.X.thermal_specs.Driver_PA.via.fill = 'solder'; return JSON.stringify(window.__db.projects.X.thermal_specs); });
  await page.evaluate(async () => { window.__alerts = []; window.__writes = []; await cloudSaveProject(); });
  const e3 = await page.evaluate(() => ({ specs: JSON.stringify(window.__db.projects.X.thermal_specs), keys: window.__writes.map(w => w.keys), vd: !!window.__db.projects.X.validation_data,
    src: calcResults.rows.find(x => x.Component === 'Driver PA').Via_Src, k: calcResults.rows.find(x => x.Component === 'Driver PA').Via_K, alerts: window.__alerts.slice() }));
  ok('存檔：寫入的欄位不含 thermal_specs、資料庫的 thermal_specs（含 via）一個字都沒變、其他工具的欄位保留',
     e3.keys.length === 1 && !e3.keys[0].includes('thermal_specs') && e3.specs === specsBefore && e3.vd, e3.keys);
  ok('存完畫面換成資料庫最新的 via 設計（錫膏）、存檔提示寫出 Thermal Via 用哪個 K', e3.src === 'keff' && Math.abs(e3.k - KEFF(5, 5, 25, 8, 0.0254, 50)) < 1e-9
     && /Thermal Via 元件 4 顆：1 顆用 AI-Thermal 的逐顆 K_eff、3 顆用通用值 K_Via/.test(e3.alerts[0] || ''), e3);
  // 複製專案：新文件沒有 AI-Thermal 的資料 → 改用通用值，提示
  await page.evaluate(async () => { window.__alerts = []; document.getElementById('copyProjectName').value = 'VIA 案 複本'; await confirmCopyProject(); });
  const e4 = await page.evaluate(() => ({ src: calcResults.rows.find(x => x.Component === 'Driver PA').Via_Src, alerts: window.__alerts.slice(), id: currentProjectId,
    copySpecs: (window.__db.projects[currentProjectId] || {}).thermal_specs, dirty: projectIsDirty() }));
  ok('複製專案：複本沒有 thermal_specs → 畫面改用通用值、提示「不會跟著複製」、不算未存修改', e4.src === 'generic' && !e4.copySpecs
     && /AI-Thermal 的資料（含 Thermal Via 設計與分類 PCB 板厚）不會跟著複製/.test(e4.alerts[0] || '') && !e4.dirty, e4);

  console.log('\n[F] PDF');
  await page.evaluate(async () => { await cloudLoadOne('X'); });
  await page.evaluate(() => { window.__db.projects.X.thermal_specs.Driver_PA.via.fill = 'copper'; });
  await page.evaluate(async () => { await checkProjectFreshness(true); });
  const P = await page.evaluate(async () => {
    window.__dd = null;
    ensurePdfmake = async () => {};
    loadCJKFont = async () => true;
    window.pdfMake = { createPdf: dd => ({ download() { window.__dd = dd; } }) };
    await generatePDFReport();
    const dd = window.__dd; if (!dd) return { none: true, alerts: window.__alerts.slice(-2) };
    const json = JSON.stringify(dd.content, (k, v) => k === 'image' ? undefined : v);
    return { hasKeff: /"text":"K_eff \d/.test(json), hasGeneric: /K_Via 30 通用/.test(json), note: /Thermal Via 底下的 K/.test(json), rint: /"\(K_eff\) "/.test(json) };
  });
  ok('PDF 元件清單：Thermal Via 底下附 K（K_eff／K_Via 通用）＋說明', !P.none && P.hasKeff && P.hasGeneric && P.note, P);
  ok('PDF 分析表：R_int 標 (K_eff)', P.rint, P);

  console.log('\n[G] Excel');
  const X = await page.evaluate(() => { exportCompExcel('rf'); const s = window.__xlsx.wb.sheets[0].aoa; const i = s[0].indexOf('Via K（Thermal Via）');
    return { i, bt: s[0].indexOf('導熱方式'), dp: s.find(r => r[0] === 'Driver PA')[i], pd: s.find(r => r[0] === 'Pre Driver')[i], fp: s.find(r => r[s[0].indexOf('導熱方式')] === 'Copper Coin')[i] }; });
  ok('元件匯出：導熱方式後面一欄「Via K（Thermal Via）」：逐顆 K_eff／通用值＋原因／其他空白', X.i === X.bt + 1 && /^逐顆 K_eff [\d.]+ W\/m·K（AI-Thermal）/.test(X.dp) && /^通用值 K_Via 30：/.test(X.pd) && X.fp === '', X);

  ok('沒有 JS 錯誤', errors.length === 0, errors);
  await browser.close();
  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})();
