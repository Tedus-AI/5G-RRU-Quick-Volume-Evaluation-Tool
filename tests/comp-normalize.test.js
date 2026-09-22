/*
 * 元件缺欄位 → 整列 NaN 的修正 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 使用者回報：Circulators-B20B28 / Cavity Filter-B20B28 與對應的 -B8 版本「建法一樣、
 * 只有瓦數不同」，但詳細分析的 Tj／Tj 裕度／允許溫升／局部環溫全是 NaN。
 *
 * 根因（兩個，第二個更危險）：
 *  (1) 缺 key：AI-Thermal 建立的元件刻意不寫本工具專屬欄位（Height(mm)／R_jc…），
 *      而元件表是 `value="'+(row[col]||0)+'"` → 畫面顯示 0，看起來跟正常元件一模一樣；
 *      calcThermalResistance 卻直接拿 undefined 做算術 → 整列 NaN。
 *      （-B8 那幾顆是「從資料庫快選」進來的，快選走 Object.assign({},DEFAULT,src) 會補齊，
 *        所以同樣的建法只有沒走快選的那幾顆爆 NaN。）
 *  (2) 數字存成字串：`Pad_L + Thick(mm)` 是加法 → "7"+"2"="72"，擴散面積變成 72×72mm，
 *      熱阻被低估近 8 倍且**不會噴 NaN**（靜默樂觀，比 NaN 更危險）。
 *
 * 驗證情境：
 *   [A] 計算端：字串欄位不再相接成 "72"，算出與數字版完全相同的結果。
 *   [B] 計算端：真的缺值時仍回 NaN（不偷偷當 0 —— R_jc=0／Height=0 都是低估溫度的方向）。
 *   [C] normalizeComps：缺 key → 補分類預設值並標記；字串數字 → 轉成 number 但不標記；
 *       已有的值一律不動。
 *   [D] 走完整載入路徑（cloudLoadOne）後，使用者那個情境不再出現 NaN。
 *   [E] 元件表把補過的那一格標成琥珀色並給說明；使用者改過就不再標。
 *   [F] Tab0 橫幅逐顆列出補了哪些欄位，可關閉。
 *   [G] `_filled` 是 UI 提醒不是資料 → 不寫回共用 DB。
 *   [H] 重量估算預設值＝鋁 2.7／Filter 1／Shielding 1.5／PCB 1.2。
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

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 950 });
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
  await page.waitForFunction(() => typeof normalizeComps === 'function' && calcResults && calcResults.rows.length > 0);

  console.log('\n[A] 數字存成字串也要算對（不可字串相接）');
  const a = await page.evaluate(() => {
    const num = { Component:'X', Qty:4, 'Power(W)':3.81, 'Height(mm)':450, Pad_L:7, Pad_W:7, 'Thick(mm)':2,
                  Board_Type:'Thermal Via', 'Limit(C)':125, R_jc:0, TIM_Type:'None' };
    const str = { Component:'X', Qty:'4', 'Power(W)':'3.81', 'Height(mm)':'450', Pad_L:'7', Pad_W:'7', 'Thick(mm)':'2',
                  Board_Type:'Thermal Via', 'Limit(C)':'125', R_jc:'0', TIM_Type:'None' };
    const n = calcThermalResistance(num, G), s = calcThermalResistance(str, G);
    return { nBase:[n.Base_L,n.Base_W], sBase:[s.Base_L,s.Base_W],
             nRint:n.R_int, sRint:s.R_int, nAdt:n.Allowed_dT, sAdt:s.Allowed_dT, nLoc:n.Loc_Amb, sLoc:s.Loc_Amb };
  });
  ok('字串版的擴散面積是 7+2=9（不是 "72"）', a.sBase[0] === 9 && a.sBase[1] === 9, a.sBase);
  ok('字串版與數字版的 R_int 完全相同', near(a.nRint, a.sRint), [a.nRint, a.sRint]);
  ok('字串版與數字版的局部環溫／允許溫升完全相同',
     near(a.nLoc, a.sLoc) && near(a.nAdt, a.sAdt), a);

  console.log('\n[B] 真的缺值 → 維持 NaN（不可偷偷當 0）');
  const b = await page.evaluate(() => {
    const noRjc = { Component:'Y', Qty:4, 'Power(W)':4.09, 'Height(mm)':450, Pad_L:7, Pad_W:7, 'Thick(mm)':2,
                    Board_Type:'Thermal Via', 'Limit(C)':125, TIM_Type:'None' };              // 缺 R_jc
    const noH = Object.assign({}, noRjc, { R_jc:0 }); delete noH['Height(mm)'];               // 缺 Height
    const r1 = calcThermalResistance(noRjc, G), r2 = calcThermalResistance(noH, G);
    return { dropNaN: isNaN(r1.Drop), adtNaN: isNaN(r1.Allowed_dT), locOK: r1.Loc_Amb === 58.5,
             locNaN: isNaN(r2.Loc_Amb), rintOK: Math.abs(r1.R_int - 1.1758) < 1e-3 };
  });
  ok('缺 R_jc → 內部溫降／允許溫升 NaN、局部環溫仍正常（與使用者畫面一致）',
     b.dropNaN && b.adtNaN && b.locOK && b.rintOK, b);
  ok('缺 Height(mm) → 局部環溫 NaN（Cavity Filter 那一列的症狀）', b.locNaN, b);

  console.log('\n[C] normalizeComps：補值／轉型／不亂動');
  const c = await page.evaluate(() => {
    components.rf = [
      { Component:'Circulators-B8', Qty:4, 'Power(W)':3.81, 'Height(mm)':450, Pad_L:7, Pad_W:7,
        'Thick(mm)':2, Board_Type:'Thermal Via', 'Limit(C)':125, R_jc:0, TIM_Type:'None' },
      { Component:'Circulators-B20B28', Qty:4, 'Power(W)':4.09, 'Height(mm)':450, Pad_L:7, Pad_W:7,
        Board_Type:'Thermal Via', 'Limit(C)':125, TIM_Type:'None' },                       // 缺 R_jc
      { Component:'字串', Qty:'4', 'Power(W)':'4.09', 'Height(mm)':'450', Pad_L:'7', Pad_W:'7',
        Board_Type:'Thermal Via', 'Limit(C)':'125', R_jc:'0.5', TIM_Type:'None' },          // 全是字串
    ];
    components.digital = []; components.pwr = [];
    const notes = normalizeComps();
    const [b8, b20, st] = components.rf;
    return {
      notes: notes.map(n => n.name + '/' + n.col + '=' + n.value),
      b8Untouched: b8.R_jc === 0 && b8['Height(mm)'] === 450 && !b8._filled,
      b20Rjc: b20.R_jc, b20Filled: b20._filled && Object.keys(b20._filled),
      strTypes: [typeof st.Qty, typeof st['Power(W)'], typeof st.Pad_L, typeof st['Limit(C)'], typeof st.R_jc],
      strValues: [st.Qty, st['Power(W)'], st.Pad_L, st['Limit(C)'], st.R_jc],
      strNotFilled: !st._filled,
      rfDefaultRjc: RF_DEFAULT.R_jc,
    };
  });
  ok('缺 R_jc → 補成 RF 分類預設值並標記', c.b20Rjc === c.rfDefaultRjc
     && String(c.b20Filled) === 'R_jc', c);
  ok('已經有值的元件一個欄位都不動、也不標記', c.b8Untouched, c);
  ok('字串數字一律轉成 number（擋掉字串相加）',
     c.strTypes.every(t => t === 'number') && c.strValues.join(',') === '4,4.09,7,125,0.5', c);
  ok('轉型不算「補值」，不標記琥珀色', c.strNotFilled, c);
  ok('補值清單逐顆逐欄位列出', c.notes.join('|') === 'Circulators-B20B28/R_jc=' + c.rfDefaultRjc, c.notes);

  console.log('\n[D] 走完整載入路徑後，使用者的情境不再 NaN');
  const d = await page.evaluate(async () => {
    dbAdapter.getDoc = async () => ({
      project_name: '使用者情境', global_params: {},
      rf_data: [
        { Component:'Circulators-B8', Qty:4, 'Power(W)':3.81, 'Height(mm)':450, Pad_L:7, Pad_W:7,
          'Thick(mm)':2, Board_Type:'Thermal Via', 'Limit(C)':125, R_jc:0, TIM_Type:'None' },
        { Component:'Circulators-B20B28', Qty:4, 'Power(W)':4.09, 'Height(mm)':450, Pad_L:7, Pad_W:7,
          Board_Type:'Thermal Via', 'Limit(C)':125, TIM_Type:'None' },                       // AI-Thermal 建的
        { Component:'Cavity Filter-B20B28', Qty:4, 'Power(W)':25.5, Pad_L:0, Pad_W:0,
          Board_Type:'None', 'Limit(C)':125, TIM_Type:'None' },                              // 連 Height 都沒有
      ],
      digital_data: [], pwr_data: [],
    });
    await cloudLoadOne('X');
    const pick = n => calcResults.rows.find(r => r.Component === n);
    const bad = calcResults.rows.filter(r => ['Allowed_dT','Tj','Tj_Margin','Loc_Amb','Drop']
      .some(k => typeof r[k] === 'number' && isNaN(r[k])));
    const b20 = pick('Circulators-B20B28'), cav = pick('Cavity Filter-B20B28');
    return { nanRows: bad.map(r => r.Component),
             b20: { adt: +b20.Allowed_dT.toFixed(1), loc: b20.Loc_Amb, tj: +b20.Tj.toFixed(1), rjc: b20.R_jc },
             cav: { loc: cav.Loc_Amb, adt: +cav.Allowed_dT.toFixed(1) },
             filled: calcResults.rows.filter(r => r._filled).map(r => r.Component + ':' + Object.keys(r._filled).join('+')) };
  });
  ok('詳細分析不再有任何 NaN', d.nanRows.length === 0, d.nanRows);
  ok('Circulators-B20B28 算得出 Tj／允許溫升', isFinite(d.b20.adt) && isFinite(d.b20.tj), d.b20);
  ok('Cavity Filter-B20B28 的局部環溫也算得出來', isFinite(d.cav.loc) && isFinite(d.cav.adt), d.cav);
  ok('被補值的元件有記錄下來（供畫面提醒）',
     d.filled.some(x => /Circulators-B20B28/.test(x)) && d.filled.some(x => /Cavity Filter-B20B28/.test(x)), d.filled);

  console.log('\n[E] 元件表把補過的那一格標出來');
  const e = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#subtab0 table.comp-table tbody tr')];
    const row = rows.find(r => (r.querySelector('input[type="text"]') || {}).value === 'Circulators-B20B28');
    const cell = row.querySelector('td[data-col="R_jc"] input');
    const okRow = rows.find(r => (r.querySelector('input[type="text"]') || {}).value === 'Circulators-B8');
    const okCell = okRow.querySelector('td[data-col="R_jc"] input');
    const cs = getComputedStyle(cell);
    return { marked: cell.classList.contains('cell-filled'), tip: cell.title,
             border: cs.borderLeftColor, bg: cs.backgroundColor,
             normalNotMarked: !okCell.classList.contains('cell-filled') };
  });
  ok('補值的格子有 cell-filled、琥珀色左邊框與說明',
     e.marked && /預設值/.test(e.tip) && /rgb\(217, 119, 6\)/.test(e.border), e);
  ok('本來就有值的格子不標記', e.normalNotMarked, e);
  const e2 = await page.evaluate(() => {
    updateComp('rf', 1, 'R_jc', 0.8);
    const rows = [...document.querySelectorAll('#subtab0 table.comp-table tbody tr')];
    const row = rows.find(r => (r.querySelector('input[type="text"]') || {}).value === 'Circulators-B20B28');
    return { marked: row.querySelector('td[data-col="R_jc"] input').classList.contains('cell-filled'),
             val: components.rf[1].R_jc, still: !!components.rf[1]._filled };
  });
  ok('使用者改過之後就不再標記', e2.marked === false && e2.val === 0.8 && e2.still === false, e2);

  console.log('\n[F] Tab0 橫幅');
  const f = await page.evaluate(() => {
    const el = document.getElementById('comp-fill-banner');
    const txt = el.textContent || '';
    return { has: /自動套用/.test(txt), listsComp: /Cavity Filter-B20B28/.test(txt),
             listsField: /熱阻 Rjc|元件相對高度/.test(txt), warnsNaN: /NaN/.test(txt) };
  });
  ok('橫幅說明原因、列出元件與欄位、點出 NaN 的後果',
     f.has && f.listsComp && f.listsField && f.warnsNaN, f);
  const f2 = await page.evaluate(() => { dismissFillNotes(); return document.getElementById('comp-fill-banner').innerHTML; });
  ok('「知道了」可以關掉橫幅', f2 === '', f2);

  console.log('\n[G] `_filled` 不可寫回共用 DB');
  const g = await page.evaluate(() => {
    components.rf[0]._filled = { R_jc: true };
    const fields = _buildProjectFields('T', {});
    return { hasFilled: fields.rf_data.some(c => c._filled !== undefined),
             keeps: fields.rf_data[0].Component === 'Circulators-B8' && fields.rf_data[0].R_jc === 0,
             memoryStillMarked: !!components.rf[0]._filled };
  });
  ok('寫回 DB 的資料不含 _filled，其餘欄位照舊', g.hasFilled === false && g.keeps, g);
  ok('記憶體裡的標記保留（畫面還要提醒）', g.memoryStillMarked, g);

  console.log('\n[H] 重量估算預設值');
  const h = await page.evaluate(() => {
    const gp = DEFAULT_CONFIG.global_params;
    return { al: gp.al_density, filter: gp.filter_density, shield: gp.shielding_density, pcb: gp.pcb_surface_density,
             uiAl: document.getElementById('al_density').value, uiFilter: document.getElementById('filter_density').value,
             uiShield: document.getElementById('shielding_density').value, uiPcb: document.getElementById('pcb_surface_density').value };
  });
  ok('出廠預設＝鋁 2.7／Filter 1／Shielding 1.5／PCB 1.2',
     h.al === 2.7 && h.filter === 1 && h.shield === 1.5 && h.pcb === 1.2, h);
  ok('參數控制台欄位顯示同一組值',
     h.uiAl === '2.7' && h.uiFilter === '1' && h.uiShield === '1.5' && h.uiPcb === '1.2', h);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
