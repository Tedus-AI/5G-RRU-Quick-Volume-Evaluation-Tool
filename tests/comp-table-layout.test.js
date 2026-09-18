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

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
