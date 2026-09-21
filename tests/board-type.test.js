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
  ok('BOARD_TYPES 含 IC top 且與 AI-Thermal 主散熱路徑同詞彙',
     a.types.join(',') === 'Thermal Via,Copper Coin,IC top,None', a.types);

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
    const marks = rows[0].querySelectorAll('.derived-src');
    const rjcCell = rows[0].querySelector('td[data-col="R_jc"]');
    const rjcRef = rjcCell.querySelector('.rjc-ref');
    const titles = Array.from(marks).map(m => m.getAttribute('title'));
    // Rjc 已改成鎖定的純參照值（不是 .derived-src input）→ 它的 tooltip 另外取
    const rjcTitle = rjcRef ? (rjcRef.getAttribute('title') || '') : '';
    const cells = Array.from(rows[0].querySelectorAll('td'))
      .map(td => (td.querySelector('.derived-src') || td.querySelector('.rjc-ref')) ? 1 : 0);
    // 標記不可讓該列變高（窄欄換行過）：與沒有標記的列比較列高
    const h1 = rows[0].getBoundingClientRect().height, h2 = heightBefore;
    return {
      markCount: marks.length,
      row2MarkCount: rows[1].querySelectorAll('.derived-src').length,
      cells,                                   // COLS 順序：0 Component…4 Pad_L,5 Pad_W,7 Board_Type,9 R_jc
      hasPath: titles.some(t => /主散熱路徑/.test(t)),
      hasEpad: titles.some(t => /E-PAD 大小/.test(t)),
      hasRjc:  /θJC,bottom/.test(rjcTitle),
      overwriteWarned: titles.every(t => /會被覆寫/.test(t)),
      // Rjc = 規格書值 → 鎖成純文字（白底黑字，不用反灰 disabled input）
      rjcLocked: !!rjcRef && !rjcCell.querySelector('input'),
      rjcTitle,
      rjcBg: rjcRef ? getComputedStyle(rjcRef).backgroundColor : '',
      rjcColor: rjcRef ? getComputedStyle(rjcRef).color : '',
      rjcRow2Input: !!rows[1].querySelector('td[data-col="R_jc"] input'),
      legend: !!document.querySelector('#subtab0 .derived-legend'),
      sameRowHeight: Math.abs(h1 - h2) < 1.5, h1: Math.round(h1), h2: Math.round(h2),
    };
  });
  // Rjc 現在是「鎖定的純參照值」而不是可編輯欄位 → 藍邊 input 只剩 3 欄（Pad_L/Pad_W/導熱方式）
  ok('可編輯的推導欄位標 3 次（Pad_L / Pad_W / 導熱方式）', d.markCount === 3, d);
  ok('標記落在 Pad_L / Pad_W / 導熱方式 / Rjc 這四欄',
     d.cells[4] && d.cells[5] && d.cells[7] && d.cells[9], d.cells);
  ok('tooltip 說得出來源（主散熱路徑 / E-PAD 大小 / θJC,bottom）', d.hasPath && d.hasEpad && d.hasRjc, d);
  ok('tooltip 提醒「會被覆寫」', d.overwriteWarned, d);
  ok('Rjc 鎖定：沒有輸入框，是白底黑字的純參照值（不反灰）',
     d.rjcLocked && /rgb\(255, 255, 255\)/.test(d.rjcBg) && /rgb\(17, 24, 39\)/.test(d.rjcColor), d);
  ok('Rjc 的 tooltip 指路到 AI-Thermal 的熱阻表', /AI-Thermal/.test(d.rjcTitle) && /θJC/.test(d.rjcTitle), d.rjcTitle);
  ok('沒有推導標記的元件 Rjc 仍可自行輸入', d.rjcRow2Input === true, d);
  ok('沒有標記的列不標', d.row2MarkCount === 0, d.row2MarkCount);
  ok('標記不佔額外寬度、不把列撐高（同一列加標記前後等高）', d.sameRowHeight, { 加標記後: d.h1, 加標記前: d.h2 });
  ok('表格上方顯示圖例', d.legend === true);

  console.log('\n[E] 未知值不被靜默改掉');
  const e = await page.evaluate(() => {
    components.rf[1].Board_Type = 'Something-Else';
    recalc();
    const sel = document.querySelectorAll('#subtab0 table.comp-table tbody tr')[1].querySelector('select');
    return { value: sel.value, opts: Array.from(sel.options).map(o => o.text) };
  });
  ok('未知的導熱方式仍被選中並標「未知值」',
     e.value === 'Something-Else' && e.opts.some(t => /Something-Else（未知值）/.test(t)), e);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });
