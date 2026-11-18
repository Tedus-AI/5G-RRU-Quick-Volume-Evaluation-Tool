/*
 * 導熱方式（Board_Type）：新增 IC top ＋ AI-Thermal 推導欄位的來源標記 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 驗證情境：
 *   [A] 下拉多了 IC top，且與 AI-Thermal Tab2「主散熱路徑」同一組詞彙。
 *   [B] IC top 不做基板擴散：R_int = 0、R_TIM 的接觸面積取 Pad_L×Pad_W，
 *       不是 (Pad_L+Thick)×(Pad_W+Thick)（那會高估面積＝低估熱阻）。
 *   [C] Copper Coin / Thermal Via / None 的計算完全不變（回歸）。
 *   [D] 來源標記：Board_Type / Pad_L / Pad_W / R_jc 有 AI-Thermal 的標記時顯示 ↩ 與說明，
 *       沒有標記的列不顯示；表格上方出現圖例。
 *   [E] 未知的 Board_Type 值不會被靜默改成清單第一項。
 *   [F] Metal Face（金屬散熱面，AI-Thermal 2026-10 新增）：不穿板，算法同 IC top；板厚、R_int 顯示「—」。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/board-type.test.js         # 可用 TEST_URL 指定網址
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
  await page.route('**', r => r.request().url().startsWith(BASE.replace(/index\.html$/, '')) ? r.continue() : r.abort());
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return []} } };
    window.alert = () => {}; window.confirm = () => true;
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0);

  console.log('\n[A] 下拉選項');
  const a = await page.evaluate(() => ({ types: BOARD_TYPES.slice() }));
  ok('BOARD_TYPES 含 IC top、Metal Face 且與 AI-Thermal 主散熱路徑同詞彙',
     a.types.join(',') === 'Thermal Via,Copper Coin,IC top,Metal Face,None', a.types);

  console.log('\n[B] IC top 的熱阻計算');
  const b = await page.evaluate(() => {
    const g = G;
    const row = {Component:'X', Qty:1, 'Power(W)':5, 'Height(mm)':100, Pad_L:10, Pad_W:10,
                 'Thick(mm)':2, 'Limit(C)':100, R_jc:1, TIM_Type:'Putty', Board_Type:'IC top'};
    const icTop = calcThermalResistance(row, g);
    const asNone = calcThermalResistance(Object.assign({}, row, {Board_Type:'None'}), g);
    const pa = (10*10)/1e6, baNone = (12*12)/1e6;
    return { icTop, asNone, K:g.K_Putty, t:g.t_Putty,
             expectIcTop: (g.t_Putty/1000)/(g.K_Putty*pa),
             expectNone:  (g.t_Putty/1000)/(g.K_Putty*baNone) };
  });
  ok('IC top 的 R_TIM 以 Pad_L×Pad_W 計算', near(b.icTop.R_TIM, b.expectIcTop, 1e-12), b);
  ok('IC top 的 R_int = 0（不穿板）', b.icTop.R_int === 0, b.icTop.R_int);
  ok('IC top 的 Base_L/Base_W = 0（無基板擴散）', b.icTop.Base_L === 0 && b.icTop.Base_W === 0, b.icTop);
  // 「板厚連動」那次改動之後 None 也不吃板厚了（該欄在畫面上反灰＝不適用），
  // 所以 None 與 IC top 一致：R_int=0、接觸面積 = Pad_L×Pad_W，
  // 不再是舊的 (Pad+Thick)² 擴散面積（那會高估面積＝低估 R_TIM）。
  ok('None 與 IC top 一致（都不吃板厚）', near(b.asNone.R_TIM, b.expectIcTop, 1e-12), b);
  ok('None 比舊公式保守（不再用 (Pad+Thick)² 面積）', b.asNone.R_TIM > b.expectNone, [b.asNone.R_TIM, b.expectNone]);

  console.log('\n[C] 其他導熱方式無回歸');
  const c = await page.evaluate(() => {
    const g = G, out = [];
    calcResults.rows.forEach(r => {
      let bl, bw;
      if (r.Board_Type === 'Copper Coin') { bl = g.Coin_L_Setting; bw = g.Coin_W_Setting; }
      else if (r['Power(W)'] === 0 || r['Thick(mm)'] === 0) { bl = 0; bw = 0; }
      else { bl = r.Pad_L + r['Thick(mm)']; bw = r.Pad_W + r['Thick(mm)']; }
      const pa = (r.Pad_L*r.Pad_W)/1e6, ba = (bl*bw)/1e6;
      let kb = 0; if (r.Board_Type === 'Copper Coin') kb = 380; else if (r.Board_Type === 'Thermal Via') kb = g.K_Via;
      let ri = 0;
      if (kb > 0 && pa > 0) { const ea = ba > 0 ? Math.sqrt(pa*ba) : pa; const rv = (r['Thick(mm)']/1000)/(kb*ea);
        if (r.Board_Type === 'Copper Coin') ri = rv + ((g.t_Solder/1000)/(g.K_Solder*pa*g.Voiding));
        else if (r.Board_Type === 'Thermal Via') ri = rv/g.Via_Eff; else ri = rv; }
      const ta = ba > 0 ? ba : pa;
      const rt = (ta > 0 && r.TIM_t > 0) ? (r.TIM_t/1000)/(r.TIM_k*ta) : 0;
      out.push({ name:r.Component, bt:r.Board_Type, riGot:r.R_int, riExp:ri, rtGot:r.R_TIM, rtExp:rt });
    });
    return out;
  });
  ok('預設專案 ' + c.length + ' 列的 R_int / R_TIM 與改動前逐列相同',
     c.every(r => near(r.riGot, r.riExp, 1e-12) && near(r.rtGot, r.rtExp, 1e-12)),
     c.filter(r => !near(r.riGot, r.riExp, 1e-12) || !near(r.rtGot, r.rtExp, 1e-12)));

  console.log('\n[D] AI-Thermal 推導欄位的來源標記');
  const d = await page.evaluate(() => {
    // 同一列「加標記前 vs 加標記後」的高度才是對的比較（不同列的 TIM 欄內容本來就不一樣高）
    const heightBefore = document.querySelectorAll('#subtab0 table.comp-table tbody tr')[0].getBoundingClientRect().height;
    // 模擬 AI-Thermal 寫進來的元件：帶推導標記
    components.rf[0]._bt_from = 'heatDirection';
    components.rf[0]._pad_from = 'epadSize';
    components.rf[0]._rjc_from = 'JC_bot';
    delete components.rf[1]._bt_from; delete components.rf[1]._pad_from; delete components.rf[1]._rjc_from;
    recalc();
    const rows = document.querySelectorAll('#subtab0 table.comp-table tbody tr');
    const tip = c => ((rows[0].querySelector('td[data-col="' + c + '"] .ro-val') || {}).title || '');
    const h1 = rows[0].getBoundingClientRect().height, h2 = heightBefore;
    return {
      marks: document.querySelectorAll('#subtab0 .comp-table .derived-src, #subtab0 .comp-table .rjc-lock').length,
      pathTip: tip('Board_Type'), padTip: tip('Pad_L'), rjcTip: tip('R_jc'),
      legend: (document.querySelector('#subtab0 .ro-legend') || {}).textContent || '',
      sameRowHeight: Math.abs(h1 - h2) < 1.5, h1: Math.round(h1), h2: Math.round(h2),
    };
  });
  // 使用者要求（2026-11）：元件表全部唯讀 → 儲存格不再加藍邊／🔒，表格上方一句話說明；來源細節留在 tooltip
  ok('儲存格不再加藍邊／🔒 標記', d.marks === 0, d.marks);
  ok('tooltip 照樣說得出來源（主散熱路徑 / E-PAD 大小 / θJC,bottom）、5G-RRU 唯讀',
     /主散熱路徑/.test(d.pathTip) && /E-PAD 大小/.test(d.padTip) && /θJC,bottom/.test(d.rjcTip) && /唯讀/.test(d.pathTip), d);
  ok('表格上方一句話：數值取自 AI-Thermal', /表中數值皆取自 AI-Thermal/.test(d.legend), d.legend);
  ok('推導標記不影響列高', d.sameRowHeight, { 加標記後: d.h1, 加標記前: d.h2 });

  console.log('\n[E] 未知值不被靜默改掉');
  const e = await page.evaluate(() => {
    components.rf[1].Board_Type = 'Something-Else';
    recalc();
    const txt = document.querySelectorAll('#subtab0 table.comp-table tbody tr')[1].querySelector('td[data-col="Board_Type"] .ro-val').textContent;
    return { txt, kept: components.rf[1].Board_Type };
  });
  ok('未知的導熱方式照原字顯示並標「未知值」（不靜默改掉）',
     e.txt === 'Something-Else（未知值）' && e.kept === 'Something-Else', e);

  console.log('\n[F] Metal Face（金屬散熱面）');
  const f = await page.evaluate(() => {
    const g = G;
    const row = {Component:'Cavity Filter', Qty:1, 'Power(W)':25, 'Height(mm)':200, Pad_L:120, Pad_W:80,
                 'Thick(mm)':2, 'Limit(C)':125, R_jc:0, TIM_Type:'Putty', Board_Type:'Metal Face'};
    const metal = calcThermalResistance(row, g);
    const icTop = calcThermalResistance(Object.assign({}, row, {Board_Type:'IC top'}), g);
    components.rf[1].Board_Type = 'Metal Face';
    recalc();
    const tr = document.querySelectorAll('#subtab0 table.comp-table tbody tr')[1];
    const sel = tr.querySelector('td[data-col="Board_Type"] .ro-val');
    const thick = tr.querySelector('td[data-col="Thick(mm)"]').textContent.trim();
    const r = calcResults.rows.find(x => x.Component === components.rf[1].Component);
    return { metal, icTop, value: sel.textContent, unknown: /未知值/.test(sel.textContent),
             thick, thickKey: components.rf[1]['Thick(mm)'], rint: r ? tab2Cell(r, 'R_int').text : null };
  });
  ok('Metal Face 不穿板：R_int = 0、沒有基板擴散', f.metal.R_int === 0 && f.metal.Base_L === 0 && f.metal.Base_W === 0, f.metal);
  ok('Metal Face 的 R_TIM 與 IC top 相同（Pad_L×Pad_W）', near(f.metal.R_TIM, f.icTop.R_TIM, 1e-12), [f.metal.R_TIM, f.icTop.R_TIM]);
  ok('顯示 Metal Face，不標「未知值」', f.value === 'Metal Face' && !f.unknown, f);
  ok('板厚不適用：顯示「—」、值歸 0', f.thick === '—' && f.thickKey === 0, f);
  ok('詳細分析的 R_int 顯示「—」', f.rint === '—', f.rint);

  console.log('\n[TIM] 介面材料由 AI-Thermal 帶入（_tim_from）→ 純文字、tooltip 寫來源；表格上方的說明每個分類都有');
  const t = await page.evaluate(() => {
    switchTab(0); switchSubTab(0);
    const rows = components.rf; rows.forEach(r => { delete r._tim_from; delete r._bt_from; delete r._pad_from; delete r._rjc_from; });
    recalc();
    const legend0 = !!document.querySelector('#subtab0 .ro-legend');
    rows[0]._tim_from = 'timType'; recalc();
    const sel = document.querySelectorAll('#subtab0 .comp-table tbody tr')[0].querySelector('td[data-col="TIM_Type"] > .ro-val');
    const r = { legend0, cls: sel.className, tip: sel.title };
    delete rows[0]._tim_from; recalc(); return r;
  });
  ok('沒有任何推導值也顯示表格上方的說明（數值本來就都取自 AI-Thermal）', t.legend0, t);
  ok('_tim_from → 介面材料是純文字（不加藍邊）、tooltip 寫來源（AI-Thermal TH/ME 頁的「TIM Type」）', !/derived-src/.test(t.cls) && /AI-Thermal TH\/ME 頁的「TIM Type」/.test(t.tip), t);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });
