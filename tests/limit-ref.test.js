/*
 * 限溫對象（Limit_Ref：Tj／Tc）、允許溫升基準、限溫疑似範例值、分析表展開式溫升組成 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 原本「以 Tc 判定」是寫死的名稱規則（PWR 類或名稱含 ddr），而且允許溫升不管 Tj 或 Tc 一律扣 P×Rjc：
 * Tc 類元件 Rjc > 0 時允許溫升被低估，可能錯當成瓶頸。現在：
 *   - 每顆元件可指定 Limit_Ref（'Tj'／'Tc'）；沒指定由 CompMerge.limitRef 自動判定（兩個工具同一套規則）
 *   - 內部溫降＝從判定溫度的位置到散熱器：Tc 不含 Rjc → 允許溫升、裕度、溫升組成全部一致
 *   - 限溫明顯不像實際規格（SFP 200 °C 之類）→ 琥珀色提醒，不擋計算；確認後記下確認的值（_limit_ok）
 *   - 分析表每一列可展開溫升組成（不加欄位）
 *
 * 驗證情境：
 *   [A] 元件表限溫欄：限溫對象小下拉（自動·Tj／Tc、Tj、Tc）；選自動＝刪 key；未知值不被靜默改掉
 *   [B] 計算：Tc 類內部溫降不含 Rjc；允許溫升、Tc、裕度一致；改指定 Tj 就加回 Rjc；Type 優先於名稱規則
 *   [C] 所有元件：裕度 ＝ 允許溫升 − 散熱器溫升（原本 Tc 類 Rjc > 0 時兩者對不上）
 *   [D] 限溫疑似範例值：橫幅＋虛線框＋確認；確認後消失、改值再出現；不擋計算；排除的不列
 *   [E] 快選白名單 22 項（含 Limit_Ref，不含 _limit_ok）
 *   [F] 詳細分析：裕度格的判定說明、限溫格的 ⚠、說明列文案
 *   [G] 展開式溫升組成：預設收合、點開／收合、全部展開、recalc 與排序後保留、Tc 列算式不含 Rjc
 *   [H] PDF：元件清單限溫標 Tj／Tc（自動標 *）與 (?)、溫升組成一覽、分析表限溫 (?)
 *   [I] Excel 匯出多一欄「限溫對象」
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/limit-ref.test.js          # 可用 TEST_URL 指定網址
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
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route('**', r => {
    const u = r.request().url();
    if (u.startsWith(BASE.replace(/index\.html$/, ''))) return r.continue();
    return r.abort();
  });
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.__xlsx = [];
    window.XLSX = { utils:{ book_new:()=>({}), aoa_to_sheet:(d)=>{ window.__xlsx.push(d); return {}; }, book_append_sheet(){} }, writeFile(){} };
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
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0);

  console.log('\n[A] 元件表的限溫欄：限溫對象小下拉');
  const a = await page.evaluate(() => {
    switchTab(0); switchSubTab(1);
    const idx = components.digital.findIndex(c => c.Component === '16G DDR');
    const td = () => document.querySelectorAll('#subtab1 table.comp-table tbody tr')[idx].querySelector('td[data-col="Limit(C)"]');
    const sel = () => td().querySelector('.lim-ref select');
    const r = { opts: Array.from(sel().options).map(o => o.textContent), val: sel().value, hasInput: !!td().querySelector('input[type="number"]') };
    updateLimitRef('digital', idx, 'Tj');
    r.afterTj = components.digital[idx].Limit_Ref; r.selTj = sel().value;
    updateLimitRef('digital', idx, '');
    r.afterAuto = ('Limit_Ref' in components.digital[idx]);
    components.digital[idx].Limit_Ref = 'Tcase'; recalc();
    r.unknown = { val: sel().value, opts: Array.from(sel().options).map(o => o.textContent), kept: components.digital[idx].Limit_Ref, label: calcResults.rows.find(x => x.Component === '16G DDR').Temp_Label };
    delete components.digital[idx].Limit_Ref; recalc();
    return r;
  });
  ok('限溫數字底下多一個小下拉：自動（寫出判定結果）／Tj 接面／Tc 外殼', a.hasInput && JSON.stringify(a.opts) === JSON.stringify(['自動·Tc', 'Tj 接面', 'Tc 外殼']) && a.val === '', a);
  ok('選 Tj → 寫 Limit_Ref；選自動 → 刪 key（空值不寫 \'\'）', a.afterTj === 'Tj' && a.selTj === 'Tj' && a.afterAuto === false, a);
  ok('不認得的值不被靜默改掉：補一個「（未知值）」選項，計算照自動判定', a.unknown.val === 'Tcase' && a.unknown.opts.includes('Tcase（未知值）') && a.unknown.kept === 'Tcase' && a.unknown.label === 'Tc', a.unknown);

  console.log('\n[B] 計算：限溫對象決定內部溫降與允許溫升');
  const b = await page.evaluate(() => {
    const pm = components.pwr.find(c => c.Component === 'Power Mod'); pm.R_jc = 0.4; recalc();
    const row = () => calcResults.rows.find(x => x.Component === 'Power Mod');
    let r0 = row(); const P = r0['Power(W)'];
    const tc = { label: r0.Temp_Label, drop: r0.Drop, dropNoRjc: P * (r0.R_int + r0.R_TIM), adt: r0.Allowed_dT, expAdt: r0['Limit(C)'] - r0.Loc_Amb - P * (r0.R_int + r0.R_TIM),
                 tref: r0.T_ref, Tc: r0.Tc, margin: r0.Tj_Margin, expMargin: r0['Limit(C)'] - r0.Tc };
    pm.Limit_Ref = 'Tj'; recalc(); r0 = row();
    const tj = { label: r0.Temp_Label, drop: r0.Drop, dropAll: P * (r0.R_jc + r0.R_int + r0.R_TIM), tref: r0.T_ref, Tj: r0.Tj, auto: r0.Limit_Ref_Auto };
    delete pm.Limit_Ref; pm.R_jc = 0; recalc();
    // AI-Thermal 的元件類型優先：SFP 類型 → Tc；DC-DC 類型即使在 PWR 也是 Tj
    const cpu = components.digital.find(c => c.Component === 'CPU (FPGA)'); cpu.Type = 'SFP'; recalc();
    const byType = calcResults.rows.find(x => x.Component === 'CPU (FPGA)');
    const t1 = { label: byType.Temp_Label, why: byType.Limit_Ref_Why };
    delete cpu.Type; pm.Type = 'DC-DC'; recalc();
    const t2 = calcResults.rows.find(x => x.Component === 'Power Mod');
    const t2r = { label: t2.Temp_Label, why: t2.Limit_Ref_Why };
    delete pm.Type; recalc();
    return { tc, tj, t1, t2: t2r };
  });
  ok('以 Tc 判定：內部溫降不含 Rjc（原本一律扣 P×Rjc）', b.tc.label === 'Tc' && near(b.tc.drop, b.tc.dropNoRjc), b.tc);
  ok('允許溫升 ＝ 限溫 − 局部環溫 − 內部溫降（不含 Rjc）；判定溫度＝Tc；裕度 ＝ 限溫 − Tc',
     near(b.tc.adt, b.tc.expAdt) && near(b.tc.tref, b.tc.Tc) && near(b.tc.margin, b.tc.expMargin), b.tc);
  ok('同一顆改指定 Tj → 內部溫降加回 Rjc、判定溫度＝Tj、標記為「已指定」', b.tj.label === 'Tj' && near(b.tj.drop, b.tj.dropAll) && near(b.tj.tref, b.tj.Tj) && b.tj.auto === false, b.tj);
  ok('自動判定：AI-Thermal 的元件類型優先（SFP → Tc；DC-DC 即使在 PWR 也是 Tj）',
     b.t1.label === 'Tc' && b.t1.why === '類型 SFP' && b.t2.label === 'Tj' && b.t2.why === '類型 DC-DC', [b.t1, b.t2]);

  console.log('\n[C] 所有元件：裕度 ＝ 允許溫升 − 散熱器溫升');
  const c = await page.evaluate(() => {
    const ddr = components.digital.find(x => x.Component === '16G DDR'); ddr.R_jc = 0.5;   // Tc 類、Rjc > 0：原本兩者對不上
    recalc();
    const R = calcResults, hsk = R.T_hsk_base - G.T_amb;
    const bad = R.rows.filter(r => r.Total_W > 0 && Math.abs(r.Tj_Margin - (r.Allowed_dT - hsk)) > 1e-9).map(r => r.Component + ':' + r.Temp_Label);
    const sums = R.rows.filter(r => r.Total_W > 0).map(r => { const bd = tempBudget(r, R, G); return Math.abs(bd.segs.reduce((s, x) => s + x.v, 0) - (r.T_ref - G.T_amb)); });
    ddr.R_jc = 0; recalc();
    return { bad, maxSum: Math.max(...sums) };
  });
  ok('每一顆發熱元件（含 Tc 類 Rjc > 0）：裕度 ＝ 允許溫升 − 散熱器溫升', c.bad.length === 0, c.bad);
  ok('溫升組成各段加總仍 ＝ 判定溫度 − 環溫', c.maxSum < 1e-9, c.maxSum);

  console.log('\n[D] 限溫疑似範例值（只提醒、不擋計算）');
  const d = await page.evaluate(() => {
    switchTab(0); switchSubTab(1);
    const banner = () => (document.getElementById('limit-suspect-banner') || {}).textContent || '';
    const si = components.digital.findIndex(x => x.Component === 'SFP');
    const td = () => document.querySelectorAll('#subtab1 table.comp-table tbody tr')[si].querySelector('td[data-col="Limit(C)"]');
    const r = { banner: banner(), cls: td().querySelector('input').className, note: (td().querySelector('.lim-sus') || {}).textContent || '',
                blocked: !!calcResults.blocked, vol: calcResults.Volume_L };
    confirmLimitOk('digital', si);
    r.ok = components.digital[si]._limit_ok; r.confirmMsg = window.__confirms.slice(-1)[0] || '';
    r.after = banner(); r.afterCls = td().querySelector('input').className; r.afterNote = !!td().querySelector('.lim-sus');
    updateCompNum('digital', si, 'Limit(C)', '150');
    r.again = banner();
    updateCompNum('digital', si, 'Limit(C)', '200');
    r.back = banner();                                         // 改回確認過的值 → 不再提醒
    const ci = components.rf.findIndex(x => x.Component === 'Cavity Filter');
    toggleComp('rf', ci); r.excluded = banner(); toggleComp('rf', ci);
    delete components.digital[si]._limit_ok; recalc();
    r.volAfter = calcResults.Volume_L;
    return r;
  });
  ok('橫幅列出範例的 SFP（光模組上限 70／85 °C）與 Cavity Filter（功放以外很少到 200 °C）',
     /限溫疑似範例值（2 顆）/.test(d.banner) && /SFP/.test(d.banner) && /70 或 85/.test(d.banner) && /Cavity Filter/.test(d.banner) && /很少到 200/.test(d.banner), d.banner.slice(0, 200));
  ok('限溫格：琥珀色虛線框＋「疑似範例值」與確認鈕（不是紅色：不擋計算）', /cell-suspect/.test(d.cls) && /疑似範例值/.test(d.note), d);
  ok('不擋計算', d.blocked === false && d.vol > 0, d);
  ok('按確認：先問一次，記下確認的值（_limit_ok ＝ 200），提醒消失',
     d.ok === 200 && /200 °C 是實際規格/.test(d.confirmMsg) && !/SFP/.test(d.after) && !/cell-suspect/.test(d.afterCls) && !d.afterNote, d);
  ok('限溫改成別的值 → 再提醒；改回確認過的值 → 不提醒', /SFP/.test(d.again) && !/SFP/.test(d.back), [d.again.slice(0, 80), d.back.slice(0, 80)]);
  ok('按 👁 排除的元件不列', !/Cavity Filter/.test(d.excluded), d.excluded.slice(0, 120));
  ok('確認／提醒都不影響體積', near(d.vol, d.volAfter), [d.vol, d.volAfter]);

  console.log('\n[E] 快選白名單');
  const e = await page.evaluate(() => {
    const src = { Component: 'X', 'Limit(C)': 85, Limit_Ref: 'Tc', _limit_ok: 85, 'Power(W)': 1 };
    const cs = carrySrc(src);
    return { n: VARIANT_CARRY.length, has: VARIANT_CARRY.includes('Limit_Ref'), ref: cs.Limit_Ref, ok: ('_limit_ok' in cs) };
  });
  ok('VARIANT_CARRY 22 項、含 Limit_Ref（與 AI-Thermal 同步）', e.n === 22 && e.has, e);
  ok('快選帶限溫對象、不帶確認標記（快選出來的新元件要重新確認）', e.ref === 'Tc' && e.ok === false, e);

  console.log('\n[F] 詳細分析頁');
  const f = await page.evaluate(() => {
    switchTab(1);
    const tr = Array.from(document.querySelectorAll('#tab1-table tbody tr:not(.an-detail)'));
    const cell = (n, col) => tr.find(t => t.querySelector('td[data-col="Component"]').textContent.includes(n)).querySelector('td[data-col="' + col + '"]');
    return { ddrTip: cell('16G DDR', 'Tj_Margin').title, cpuTip: cell('CPU (FPGA)', 'Tj_Margin').title,
             sfpLim: cell('SFP', 'Limit(C)').innerHTML, sfpLimTip: cell('SFP', 'Limit(C)').title, cpuLim: cell('CPU (FPGA)', 'Limit(C)').innerHTML,
             cap: document.querySelector('#tab1-table .an-cap').textContent };
  });
  ok('裕度格的滑鼠提示寫出限溫對象怎麼來的', /限溫對象 Tc：自動判定（名稱含 DDR）/.test(f.ddrTip) && /限溫對象 Tj：自動判定（預設）/.test(f.cpuTip), [f.ddrTip, f.cpuTip]);
  ok('限溫格：疑似範例值標 ⚠ 並說明；其餘不標', /an-sus/.test(f.sfpLim) && /限溫疑似範例值/.test(f.sfpLimTip) && !/an-sus/.test(f.cpuLim), f);
  ok('說明列：裕度 ＝ 限溫 − Tj 或 Tc（依元件的限溫對象）', /限溫 − Tj 或 Tc（依元件的限溫對象）/.test(f.cap), f.cap);

  console.log('\n[G] 分析表每列展開溫升組成');
  const g = await page.evaluate(() => {
    switchTab(1);
    const btn = n => Array.from(document.querySelectorAll('#tab1-table .an-exp')).find(b => b.closest('td').textContent.includes(n));
    const details = () => Array.from(document.querySelectorAll('#tab1-table tr.an-detail'));
    const r = { cols: document.querySelectorAll('#tab1-table thead th').length, n0: details().length, btns: document.querySelectorAll('#tab1-table .an-exp').length, rows: calcResults.rows.length };
    btn('16G DDR').click();
    const dd = details();
    r.n1 = dd.length; r.aria = btn('16G DDR').getAttribute('aria-expanded');
    r.follows = !!(dd[0] && dd[0].previousElementSibling && dd[0].previousElementSibling.textContent.includes('16G DDR'));
    r.colspan = dd[0] ? +dd[0].querySelector('td').getAttribute('colspan') : 0;
    r.hasBar = !!(dd[0] && dd[0].querySelector('.rc-bar')); r.text = dd[0] ? dd[0].textContent : '';
    r.ctrl = btn('16G DDR').getAttribute('aria-controls') === (dd[0] && dd[0].id);
    recalc(); r.keep = details().length;
    tab1SortBy('Tj'); r.keepSort = details().length && details()[0].previousElementSibling.textContent.includes('16G DDR');
    tab1Sort = { col: 'Allowed_dT', dir: 1 };
    btn('16G DDR').click(); r.closed = details().length;
    document.querySelector('#tab1-table .an-all').click(); r.all = details().length; r.allLabel = document.querySelector('#tab1-table .an-all').textContent;
    btn('CPU (FPGA)').click(); r.one = details().length;   // 全部展開後收合一列
    const cpuAfter = btn('CPU (FPGA)').getAttribute('aria-expanded');
    document.querySelector('#tab1-table .an-all').click(); r.allAgain = details().length;
    document.querySelector('#tab1-table .an-all').click(); r.none = details().length; r.noneLabel = document.querySelector('#tab1-table .an-all').textContent;
    r.cpuAfter = cpuAfter;
    r.zebra = Array.from(document.querySelectorAll('#tab1-table tbody tr')).map(t => t.classList.contains('an-alt') ? 1 : 0).join('');
    // 算式：Tj 列含 Rjc
    btn('CPU (FPGA)').click(); r.cpuText = details()[0].textContent; btn('CPU (FPGA)').click();
    return r;
  });
  ok('預設收合、原本欄位不變（每列只多一顆展開鈕）', g.n0 === 0 && g.cols === 12 && g.btns === g.rows, g);
  ok('點開 → 該列正下方多一列、跨全部欄位、aria-expanded／aria-controls 對得上', g.n1 === 1 && g.aria === 'true' && g.follows && g.colspan === 12 && g.ctrl, g);
  ok('展開列：溫升組成條＋判定溫度／限溫／裕度＋算式（Tc 列不含 Rjc）',
     g.hasBar && /Tc 93\.5 °C/.test(g.text) && /限溫 95 °C/.test(g.text) && /裕度 1\.5 °C（偏緊）/.test(g.text) &&
     /單顆 0\.55 W × \(基板 0\.000 \+ 介面 0\.637\)/.test(g.text) && !/Rjc 0/.test(g.text.split('單顆')[1] || '') && /不含 Rjc/.test(g.text), g.text);
  ok('Tj 列的算式含 Rjc', /單顆 35 W × \(Rjc 0\.160 \+ 基板 0\.000 \+ 介面 0\.045\)/.test(g.cpuText), g.cpuText);
  ok('recalc、改排序後展開狀態保留（跟著元件走）', g.keep === 1 && g.keepSort === true, g);
  ok('再點一次收合', g.closed === 0, g);
  ok('全部展開／全部收合（按鈕文字跟著變）', g.all === g.rows && /全部收合/.test(g.allLabel) && g.one === g.rows - 1 && g.cpuAfter === 'false' &&
     g.allAgain === g.rows && g.none === 0 && /全部展開/.test(g.noneLabel), g);
  ok('斑馬紋不因展開列錯位（用 class，不用 nth-child）', /^(01)+0?$/.test(g.zebra), g.zebra);

  console.log('\n[H] PDF');
  const h = await page.evaluate(async () => {
    window.__dd = null;
    ensurePdfmake = async () => {};
    loadCJKFont = async () => true;
    window.pdfMake = { createPdf: dd => ({ download() { window.__dd = dd; } }) };
    await generatePDFReport();
    const dd = window.__dd; if (!dd) return { none: true };
    const flat = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : (n && typeof n === 'object') ? flat(n.text || '') : '';
    const tables = [];
    (function walk(n) { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (n.table) tables.push(n); Object.keys(n).forEach(k => { if (k !== 'image') walk(n[k]); }); })(dd.content);
    const compDig = tables.find(t => t.table.body.length > 1 && flat(t.table.body[0][0].text).startsWith('Component') && t.table.body.some(r => flat(r[0].text) === 'SFP') && t.table.body[0].length === 11);
    const limCol = 8;
    const sfpRow = compDig.table.body.find(r => flat(r[0].text) === 'SFP'), ddrRow = compDig.table.body.find(r => flat(r[0].text) === '16G DDR');
    const idx = dd.content.findIndex(n => n && n.text === 'Temperature Budget / 溫升組成');
    const list = dd.content.slice(idx).find(n => n && n.table && n.table.widths && n.table.widths.length === 3);
    const all = JSON.stringify(dd.content, (k, v) => k === 'image' ? undefined : v);
    return {
      sfpLim: flat(sfpRow[limCol].text), sfpFill: sfpRow[limCol].fillColor, ddrLim: flat(ddrRow[limCol].text),
      note: /限溫疑似範例值/.test(all) && /SFP 200 °C/.test(all), refNote: /限溫對象/.test(all),
      listRows: list ? list.table.body.map(r => flat(r[0].text)) : [], hasCanvas: list ? !!list.table.body[0][1].canvas : false,
      expect: tab1SortRows(calcResults.rows, { col: 'Allowed_dT', dir: 1 }).filter(r => r.Total_W > 0).map(r => r.Component),
      detailSus: /\(\?\) /.test(all),
    };
  });
  if (h.none) ok('PDF 產生（攔截 createPdf）', false, h);
  else {
    ok('元件清單限溫：標限溫對象（自動判定標 *）、疑似範例值標 (?) 並上琥珀色底', h.sfpLim === '200 Tc* (?)' && h.sfpFill === '#fffbeb' && h.ddrLim === '95 Tc*', h);
    ok('元件清單下方註明 Tj／Tc 的意思，並列出疑似範例值', h.note && h.refNote, h);
    ok('新增「溫升組成」一覽：發熱元件依風險排序，每列一條溫升條', JSON.stringify(h.listRows) === JSON.stringify(h.expect) && h.hasCanvas, h.listRows);
    ok('分析表限溫也標 (?)', h.detailSus, h);
  }

  console.log('\n[I] Excel 匯出');
  const x = await page.evaluate(() => {
    window.__xlsx = []; exportCompExcel('digital');
    const d = window.__xlsx[0] || [];
    const hi = (d[0] || []).indexOf('限溫對象');
    return { header: d[0], ddr: (d.find(r => r[0] === '16G DDR') || [])[hi], limIdx: (d[0] || []).indexOf(COL_LABELS['Limit(C)']), hi };
  });
  ok('限溫後面多一欄「限溫對象」，沒指定的寫自動判定結果與依據', x.hi === x.limIdx + 1 && x.ddr === '自動 Tc（名稱含 DDR）', x);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
