/*
 * 元件清單版面：欄位名稱、置中、欄寬、新增元件列 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 驗證情境：
 *   [A] 欄位名稱：元件相對高度 / E-Pad 長 / E-Pad 寬 / 板厚 (mm) 或銅厚。
 *   [B] 表頭與儲存格都置中，格內文字（含輸入框）也置中。
 *   [C] 數量／單顆功耗的欄寬收到內容寬度（明顯窄於其他數值欄）。
 *   [D] 「從資料庫快選」搬到表格下方，與「直接新增」同一列；三個分類都有。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &
 *   node tests/comp-table-layout.test.js
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**', r => r.request().url().startsWith(BASE.replace(/index\.html$/, '')) ? r.continue() : r.abort());
  await page.addInitScript(() => {
    window.Plotly={newPlot(){},Plots:{resize(){}},relayout(){},purge(){},toImage:async()=>''};
    window.XLSX={utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}},writeFile(){}};
    window.msal={PublicClientApplication:class{async initialize(){}async handleRedirectPromise(){return null}getAllAccounts(){return[]}}};
    window.alert=()=>{};window.confirm=()=>true; try{localStorage.clear();}catch(e){}
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0);

  console.log('\n[A] 欄位名稱');
  const a = await page.evaluate(() => {
    const th = {};
    document.querySelectorAll('#subtab0 table.comp-table thead th').forEach(t => { th[t.dataset.col || '操作'] = t.textContent.trim(); });
    return th;
  });
  ok('高度 → 元件相對高度', /元件相對高度/.test(a['Height(mm)'] || ''), a['Height(mm)']);
  ok('Pad 長/寬 → E-Pad 長/寬', a['Pad_L'] === 'E-Pad 長 (mm)' && a['Pad_W'] === 'E-Pad 寬 (mm)', [a['Pad_L'], a['Pad_W']]);
  ok('板厚 → 板厚 (mm) 或銅厚', a['Thick(mm)'] === '板厚 (mm) 或銅厚', a['Thick(mm)']);
  ok('其他欄位名稱沒被動到', a['Component'] === '元件名稱' && a['Qty'] === '數量' && a['Board_Type'] === '導熱方式', a);

  console.log('\n[B] 置中');
  const b = await page.evaluate(() => {
    const th = document.querySelector('#subtab0 table.comp-table thead th');
    const tds = Array.from(document.querySelectorAll('#subtab0 table.comp-table tbody tr')[0].querySelectorAll('td'));
    const inp = tds[1].querySelector('input');
    const sel = document.querySelector('#subtab0 table.comp-table tbody tr td[data-col="Board_Type"] select');
    return { th: getComputedStyle(th).textAlign,
             td: tds.map(t => getComputedStyle(t).textAlign),
             input: getComputedStyle(inp).textAlign,
             select: sel ? getComputedStyle(sel).textAlign : null };
  });
  ok('表頭置中', b.th === 'center', b.th);
  ok('每個儲存格都置中', b.td.every(t => t === 'center'), b.td);
  ok('輸入框內的文字置中', b.input === 'center', b.input);
  ok('下拉選單內的文字置中', b.select === 'center', b.select);

  console.log('\n[C] 數量／單顆功耗欄寬');
  const c = await page.evaluate(() => {
    const w = sel => document.querySelector('#subtab0 table.comp-table thead th[data-col="'+sel+'"]').getBoundingClientRect().width;
    const iw = sel => document.querySelector('#subtab0 table.comp-table tbody td[data-col="'+sel+'"] input').getBoundingClientRect().width;
    return { qty: w('Qty'), power: w('Power(W)'), height: w('Height(mm)'), padL: w('Pad_L'),
             qtyInput: iw('Qty'), powerInput: iw('Power(W)'), heightInput: iw('Height(mm)') };
  });
  ok('數量欄明顯窄於其他數值欄', c.qty < c.height && c.qty < c.padL, c);
  ok('單顆功耗欄不再佔多餘寬度', c.power <= c.height + 8, c);
  ok('數量／功耗的輸入框收窄到內容寬度', c.qtyInput <= 56 && c.powerInput <= 80 && c.heightInput > c.qtyInput, c);

  console.log('\n[D] 新增元件列');
  const d = await page.evaluate(() => {
    const out = {};
    ['subtab0','subtab1','subtab2'].forEach((id, k) => {
      const wrap = document.getElementById(id);
      const table = wrap.querySelector('table.comp-table');
      const row = wrap.querySelector('.add-row');
      const btn = row && row.querySelector('.btn-add-direct');
      const sel = row && row.querySelector('select');
      const add = row && row.querySelector('button.btn-primary');
      out[id] = {
        hasRow: !!row,
        belowTable: !!(row && table) && (row.getBoundingClientRect().top >= table.getBoundingClientRect().bottom - 1),
        sameLine: !!(btn && sel) && Math.abs((btn.getBoundingClientRect().top + btn.getBoundingClientRect().bottom)/2
                                           - (sel.getBoundingClientRect().top + sel.getBoundingClientRect().bottom)/2) < 6,
        btnText: btn ? btn.textContent.trim() : null,
        selId: sel ? sel.id : null,
        hasAddBtn: !!add,
        libSectionAbove: !!wrap.querySelector('.lib-section'),
      };
    });
    return out;
  });
  ['subtab0','subtab1','subtab2'].forEach((id, k) => {
    const cat = ['RF','Digital','PWR'][k];
    ok(cat + '：新增元件列在表格下方', d[id].hasRow && d[id].belowTable, d[id]);
    ok(cat + '：直接新增與快選同一行', d[id].sameLine, d[id]);
    ok(cat + '：按鈕寫明分類（' + d[id].btnText + '）', /直接新增/.test(d[id].btnText || '') && d[id].btnText.includes(cat), d[id].btnText);
    ok(cat + '：表格上方不再有快選區塊', d[id].libSectionAbove === false, d[id]);
  });

  const d2 = await page.evaluate(() => {
    const before = components.rf.length;
    document.querySelector('#subtab0 .add-row .btn-add-direct').click();
    return { before, after: components.rf.length };
  });
  ok('「直接新增」按鈕真的會新增一顆元件', d2.after === d2.before + 1, d2);

  // 有快選資料時，select 的 id 仍是 lib_sel_<cat>（addFromVariant 靠它）
  const d3 = await page.evaluate(() => {
    variantsCache = { rf:[{name:'X',power:5,originProjectName:'P1',originProjectId:'p1',src:{'Power(W)':5}}], digital:[], pwr:[] };
    renderTab0();
    const sel = document.getElementById('lib_sel_rf');
    const before = components.rf.length;
    sel.value = '0'; addFromVariant('rf');
    return { hasSel: !!sel, inAddRow: !!(sel && sel.closest('.add-row')), added: components.rf.length === before + 1 };
  });
  ok('快選下拉仍是 lib_sel_<分類> 且位在新增元件列裡', d3.hasSel && d3.inAddRow, d3);
  ok('快選「加入」仍可用', d3.added, d3);

  // [E] 使用者回報（24 吋螢幕）：元件名稱「GTRB097152NCV1-…」、E-Pad「20.57」「9.78」、導熱方式底下「AI-Thermal「Thermal Via …」被儲存格吃掉。
  //     原因：數字欄的表頭一行寫完（「元件相對高度 (mm)」）把欄撐到 130～150px，輸入框卻只有 50%（~55px，扣掉上下箭頭只剩 20px）；
  //     說明文字固定 150px＋省略號；元件名稱只有 140px。
  console.log('\n[E] 欄寬：每個欄位的內容都完整顯示');
  // 仿使用者的 FDD 專案（長元件名稱、E-Pad 兩位小數、Thermal Via 通用值、TIM 型號）
  const FDD = [
    { Component:'GTRB097152NCV1-Final-B8', Type:'Final PA', Qty:4, 'Power(W)':75.61, 'Height(mm)':400, Board_Type:'Copper Coin', Pad_L:20.57, Pad_W:9.78,
      R_jc:1.24, _rjc_from:'JC_bot', _bt_from:'heatDirection', _pad_from:'heatSourceSize', TIM_Type:'Grease', TIM_Model:'Tgrease 2500', 'Limit(C)':225, _ref_origin_project:'FDD B8B20B28 4T4R 480W' },
    { Component:'GTRB097152NCV1-Final-B20B28', Type:'Final PA', Qty:4, 'Power(W)':72.688, 'Height(mm)':330, Board_Type:'Copper Coin', Pad_L:20.57, Pad_W:9.78,
      R_jc:1.24, _rjc_from:'JC_bot', _bt_from:'heatDirection', _pad_from:'heatSourceSize', TIM_Type:'Grease', TIM_Model:'Tgrease 2500', 'Limit(C)':225 },
    { Component:'B10H0710N40D-Driver-B20B28', Type:'Driver', Qty:8, 'Power(W)':7.886, 'Height(mm)':350, Board_Type:'Thermal Via', Pad_L:9.4, Pad_W:5.5,
      R_jc:4.1, _rjc_from:'JC_bot', _bt_from:'heatDirection', _pad_from:'epadSize', TIM_Type:'None', 'Limit(C)':225 },
    { Component:'BTS6201U-PreDriver-B1', Type:'Pre-driver', Qty:8, 'Power(W)':0.75, 'Height(mm)':310, Board_Type:'Thermal Via', Pad_L:1.5, Pad_W:1.5,
      R_jc:50, _rjc_from:'JC_bot', TIM_Type:'None', 'Limit(C)':175, _ref_origin_project:'FDD 4T4R 60W', _ref_locked:true },
    { Component:'Circulators', Type:'CR', Qty:8, 'Power(W)':3.81, 'Height(mm)':450, Board_Type:'Thermal Via', Pad_L:7, Pad_W:7, R_jc:0, TIM_Type:'None', 'Limit(C)':125 },
    { Component:'Cavity Filter', Type:'filter', Qty:8, 'Power(W)':19.1, 'Height(mm)':0, Board_Type:'None', Pad_L:0, Pad_W:0, R_jc:0, TIM_Type:'None', 'Limit(C)':125 },
    // 沒選型號 → 「← 專案預設值 K_Pad／t_Pad」（最長的 TIM 來源說明）
    { Component:'LNA', Type:'LNA', Qty:4, 'Power(W)':0.5, 'Height(mm)':200, Board_Type:'IC top', Pad_L:3, Pad_W:3, R_jc:10, TIM_Type:'Pad', 'Limit(C)':150 },
  ];
  const LIB = { g1:{ model:'Tgrease 2500', timType:'Grease', k:3.8, gapThickness:0.05, thickness:0.05, vendor:'Laird', src:'tim-manager', srcId:'x1' } };
  const measure = () => page.evaluate(() => {
    const cv = document.createElement('canvas').getContext('2d');
    const tw = (el, t) => { const cs = getComputedStyle(el); cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; return cv.measureText(t).width; };
    const tbl = document.querySelector('#subtab0 table.comp-table'), wrap = tbl.parentElement;
    const clip = [];
    tbl.querySelectorAll('tbody tr').forEach((tr, ri) => {
      tr.querySelectorAll('input').forEach(inp => {
        const cs = getComputedStyle(inp), col = inp.closest('td').dataset.col;
        // 數字欄扣掉上下箭頭（Chrome 約 15px）
        const room = inp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (inp.type === 'number' ? 15 : 0);
        if (tw(inp, inp.value) > room + 0.5) clip.push([ri, col, inp.value, Math.round(tw(inp, inp.value)), Math.round(room)]);
      });
      tr.querySelectorAll('.via-k-note,.via-k-src,.tim-note,.tim-note-src,.thick-ref,.rjc-ref').forEach(el => {
        if (el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === 'ellipsis') clip.push([ri, el.className, el.textContent]);
      });
    });
    const segs = [...tbl.querySelectorAll('.via-k-seg,.tim-note-seg')].map(s => s.getClientRects().length);
    const th = c => tbl.querySelector('thead th[data-col="' + c + '"]');
    const w = c => Math.round(th(c).getBoundingClientRect().width);
    const sel = tbl.querySelector('tbody td[data-col="Board_Type"] select');
    return { clip, hScroll: wrap.scrollWidth > wrap.clientWidth + 1, tableW: Math.round(tbl.getBoundingClientRect().width),
      segBroken: segs.filter(n => n > 1).length, segN: segs.length,
      heights: { comp: w('Component'), height: w('Height(mm)'), padL: w('Pad_L'), thick: w('Thick(mm)'), bt: w('Board_Type'), tim: w('TIM_Type') },
      btSelW: Math.round(sel.getBoundingClientRect().width),
      heads: [...tbl.querySelectorAll('thead th')].map(t => [t.dataset.col || '操作', t.textContent.trim(), t.querySelectorAll('.th-l').length]),
      labels: COL_LABELS,
      nameTitle: tbl.querySelector('tbody td[data-col="Component"] input').title };
  });
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.evaluate(({ FDD, LIB }) => { timLibrary = LIB; timLibLoaded = true; switchTab(0);
    components.rf = JSON.parse(JSON.stringify(FDD)); normalizeComps(); recalc(); }, { FDD, LIB });
  const e1 = await measure();
  ok('24 吋：數值、元件名稱、說明文字沒有任何一格被截斷', e1.clip.length === 0, e1.clip);
  ok('24 吋：表格放得下，不需要橫向捲動', !e1.hScroll, e1);
  ok('24 吋：Thermal Via 原因、TIM 來源（型號）每一段都沒有從中間斷開', e1.segN > 0 && e1.segBroken === 0, e1);
  ok('表頭分兩行（名稱／單位），文字與 COL_LABELS 相同', ['Power(W)','Height(mm)','Pad_L','Pad_W','Thick(mm)','Limit(C)'].every(c => {
       const h = e1.heads.find(x => x[0] === c); return h && h[2] === 2 && h[1] === e1.labels[c]; }), e1.heads);
  ok('Rjc 表頭標出單位 °C/W', (e1.heads.find(x => x[0] === 'R_jc') || [])[1] === '熱阻 Rjc (°C/W)', e1.heads);
  ok('數字欄收窄（元件相對高度 < 110px、E-Pad < 100px）', e1.heights.height < 110 && e1.heights.padL < 100, e1.heights);
  ok('導熱方式的下拉不跟著欄寬拉長（≤ 170px）', e1.btSelW <= 170, e1.btSelW);
  ok('元件名稱輸入框有 title（超過上限時滑鼠停著看全名）', e1.nameTitle === FDD[0].Component, e1.nameTitle);

  await page.setViewportSize({ width: 1536, height: 730 });   // 17 吋筆電、125% 縮放、參數控制台展開
  await page.evaluate(() => recalc());
  const e2 = await measure();
  ok('17 吋筆電：一樣沒有被截斷的內容（放不下時表格自己橫向捲動）', e2.clip.length === 0, e2.clip);
  ok('17 吋筆電：說明換成兩行時不從「計算」或型號中間斷開', e2.segBroken === 0, e2);
  ok('17 吋筆電：表格比原本窄（原本 1385px）', e2.tableW < 1385, e2.tableW);
  await page.setViewportSize({ width: 1440, height: 900 });

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
