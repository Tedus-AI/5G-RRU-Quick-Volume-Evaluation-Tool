/*
 * 視覺化報告頁（renderTab2）改版 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 使用者回報「溫度裕度的圖有點重複」：原本「溫度裕度總覽」與「各元件溫度裕度」兩張圖畫的是同一組裕度
 * （後者還用紅→綠漸層，0–10 °C 就畫紅色），詳細分析頁也已經有卡片、分析表與溫升組成。
 * 改版後：設計結果（答案在最上面）→ 體積怎麼決定的（5 步推導）→ 一張「溫度 vs 限溫」＋「熱源分佈」→ 整機組成。
 *
 * 驗證情境：
 *   [A] 版面：答案在最上面（體積／尺寸／重量）；只剩一張溫度圖；不再有 chart-margin／chart-tjm／KPI 卡
 *   [B] 5 步推導與 computeAll 同一組公式：熱負載 → 允許溫升（瓶頸）→ 散熱面積 → 鰭片高 → 整機高 → 體積
 *   [C] 安全係數 ≠ 1：熱負載顯示實際值（原本 KPI 與功耗圖寫的是「× 安全係數」後的值），設計值另寫
 *   [D] 溫度 vs 限溫：依風險排序、MARGIN_LEVELS 配色、共用溫度軸、限溫線、超溫斜線、疑似範例值 ⚠
 *   [E] 熱源分佈：依功耗排序、分類上色＋分類文字（不只靠顏色）、分類合計＝100%
 *   [F] 整機組成：高度各項加總＝整機高、重量各項加總＝整機重量；隨散熱設計變動的是鰭片／散熱器
 *   [G] 狀態：DRC 不通過、允許溫升 ≤ 0（無法設計）、沒有發熱元件
 *   [H] 版面寬度：17 吋筆電（1366／1600）不會水平溢出；寬的時候兩張圖並排、窄的時候上下
 *   [I] PDF：第 1 節＝設計結果＋推導、第 4 節＝溫度 vs 限溫＋熱源分佈（直接畫，不截圖）、第 5 節＝整機組成
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/visual-report.test.js      # 可用 TEST_URL 指定網址
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
const near = (a, b, tol) => Math.abs(a - b) <= tol;

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
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0);
  await page.evaluate(() => switchTab(2));
  await page.waitForTimeout(150);

  console.log('\n[A] 版面：答案在最上面、只剩一張溫度圖');
  const a = await page.evaluate(() => {
    const tab = document.getElementById('tab2');
    const blocks = [...tab.children].filter(el => el.tagName !== 'H3').map(el => el.id);
    const res = document.querySelector('#tab2-result .vr-result');
    return {
      blocks, first: blocks[0],
      labels: [...res.querySelectorAll('.vr-res .vr-lbl')].map(x => x.textContent),
      vol: res.querySelector('.vr-cell.main .vr-num').textContent,
      tempCharts: document.querySelectorAll('#tab2 .vr-temp').length,
      old: ['chart-margin', 'chart-tjm', 'chart-power', 'tab2-kpi', 'tab2-volume', 'tab2-weight', 'tab2-dims', 'tab2-drc'].filter(id => document.getElementById(id)),
      kpiCards: document.querySelectorAll('.kpi-card, .volume-box, .weight-box').length,
      volExpect: calcResults.Volume_L.toFixed(2) + 'L',
    };
  });
  ok('區塊順序：設計結果 → 圖表 → 整機組成', JSON.stringify(a.blocks) === JSON.stringify(['tab2-result', 'tab2-charts', 'tab2-comp']), a.blocks);
  ok('設計結果列出體積、外觀尺寸、整機重量；體積＝computeAll 的 Volume_L',
     JSON.stringify(a.labels) === JSON.stringify(['整機體積', '外觀尺寸 L × W × H', '整機重量']) && a.vol === a.volExpect, [a.labels, a.vol, a.volExpect]);
  ok('溫度圖只剩一張（原本兩張畫同一組裕度）', a.tempCharts === 1, a.tempCharts);
  ok('舊的圖表／KPI 卡／大方塊都已移除', a.old.length === 0 && a.kpiCards === 0, a);

  console.log('\n[B] 體積怎麼決定的：5 步推導與 computeAll 同一組公式');
  const b = await page.evaluate(() => {
    const R = calcResults, g = G;
    const steps = [...document.querySelectorAll('#tab2-result .vr-step')].map(el => ({
      label: el.querySelector('.sl').textContent, v: el.querySelector('.sv').firstChild.textContent,
      note: el.querySelector('.sn').textContent, f: (el.querySelector('.sf') || {}).textContent || '' }));
    const hot = R.rows.filter(r => r.Total_W > 0);
    const Q = hot.reduce((s, r) => s + r.Total_W, 0);
    const bn = hot.reduce((m, r) => (!m || r.Allowed_dT < m.Allowed_dT) ? r : m, null);
    const areaCalc = Q * g.Margin / (R.h_value * R.eff * R.Min_dT_Allowed);
    const fhCalc = (R.Area_req - R.L_hsk * R.W_hsk / 1e6) * 1e6 / (2 * R.Fin_Count * R.L_hsk);
    const hCalc = g.H_shield + g.H_filter + g.t_base + R.Fin_Height;
    const hSide = calcHValue(g.Gap, R.Fin_Height).h_value;
    return { steps, Q, bnName: bn.Component, bnAllowed: bn.Allowed_dT, mda: R.Min_dT_Allowed, bottleneck: R.Bottleneck_Name,
             bnLimit: +bn['Limit(C)'], bnLa: bn.Loc_Amb, bnDrop: bn.Drop,
             area: R.Area_req, areaCalc, fh: R.Fin_Height, fhCalc, n: R.Fin_Count, H: R.RRU_Height, hCalc,
             V: R.Volume_L, vCalc: R.L_hsk * R.W_hsk * R.RRU_Height / 1e6, hSide, sidebar: document.getElementById('h-val').textContent };
  });
  ok('5 步依序：熱負載 → 散熱器允許溫升 → 所需散熱面積 → 鰭片高度 → 整機高度',
     JSON.stringify(b.steps.map(s => s.label)) === JSON.stringify(['熱負載', '散熱器允許溫升', '所需散熱面積', '鰭片高度', '整機高度']), b.steps.map(s => s.label));
  ok('① 熱負載＝發熱元件「數量 × 單顆」加總（不含安全係數）', b.steps[0].v === b.Q.toFixed(1), [b.steps[0].v, b.Q]);
  ok('② 允許溫升＝最小的那顆、就是 computeAll 的瓶頸；算式 限溫 − 局部環溫 − 內部溫降',
     b.steps[1].v === b.mda.toFixed(1) && b.bnName === b.bottleneck && b.steps[1].note.includes(b.bottleneck)
     && near(b.bnLimit - b.bnLa - b.bnDrop, b.bnAllowed, 1e-9) && /限溫 .* − 局部環溫 .* − 內部溫降/.test(b.steps[1].f), b.steps[1]);
  ok('③ 散熱面積＝熱負載 × 安全係數 ÷ (h × η × 允許溫升)', b.steps[2].v === b.area.toFixed(3) && near(b.areaCalc, b.area, 1e-9), [b.steps[2].v, b.areaCalc, b.area]);
  ok('③ 顯示的 h 與參數控制台是同一個值', b.steps[2].note.includes('h ' + b.hSide.toFixed(2)) && b.sidebar.includes(b.hSide.toFixed(2)), [b.steps[2].note, b.sidebar]);
  ok('④ 鰭片高＝(面積 − 底面 L×W) ÷ (2 × 片數 × L)', b.steps[3].v === b.fh.toFixed(1) && near(b.fhCalc, b.fh, 0.1) && b.steps[3].note.startsWith(b.n + ' 片'), [b.steps[3], b.fhCalc, b.fh]);
  ok('⑤ 整機高＝屏蔽罩＋濾波器＋基板＋鰭片；體積＝L × W × H', b.steps[4].v === b.H.toFixed(1) && near(b.hCalc, b.H, 1e-9) && near(b.vCalc, b.V, 1e-9), [b.H, b.hCalc, b.V, b.vCalc]);

  console.log('\n[C] 安全係數 ≠ 1：熱負載顯示實際值，設計值另寫');
  const c = await page.evaluate(() => {
    document.getElementById('Margin').value = 1.1; recalc();
    const R = calcResults, Q = R.rows.filter(r => r.Total_W > 0).reduce((s, r) => s + r.Total_W, 0);
    const s1 = document.querySelector('#tab2-result .vr-step');
    const out = { Q, TP: R.Total_Power, v: s1.querySelector('.sv').firstChild.textContent, f: s1.querySelector('.sf').textContent,
                  powerHead: document.querySelector('#tab2 .vr-power .vr-hsub').textContent, tip3: document.querySelectorAll('#tab2-result .vr-step')[2].querySelector('.sf').textContent };
    document.getElementById('Margin').value = 1; recalc();
    return out;
  });
  ok('熱負載＝實際值（計算用的 Total_Power 是 × 1.1 後的值，不可再當成「整機總熱耗」）', c.v === c.Q.toFixed(1) && near(c.TP, c.Q * 1.1, 1e-6), c);
  ok('設計值另寫「散熱器依 ×1.1 ＝ … W 設計」；熱源分佈的合計也是實際值',
     c.f.includes('×1.1 ＝ ' + (c.Q * 1.1).toFixed(1) + ' W') && c.powerHead.startsWith('合計 ' + c.Q.toFixed(1) + ' W') && c.powerHead.includes('×1.1'), c);
  ok('散熱面積的算式寫出 × 安全係數', /熱負載 × 1\.1 ÷/.test(c.tip3), c.tip3);

  console.log('\n[D] 溫度 vs 限溫');
  const d = await page.evaluate(() => {
    const R = calcResults;
    const rows = [...document.querySelectorAll('#tab2 .vr-temp .vr-list .vr-row:not(.vr-axis-row)')];
    const expect = tab1SortRows(R.rows, { col: 'Allowed_dT', dir: 1 }).filter(r => r.Total_W > 0);
    const rgb = hex => 'rgb(' + [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';
    const barW = rows.map(r => Math.round(r.querySelector('.vr-bar').getBoundingClientRect().width));
    const axisW = Math.round(document.querySelector('#tab2 .vr-temp .vr-axis').getBoundingClientRect().width);
    const cpu = rows[expect.findIndex(r => r.Component === 'CPU (FPGA)')];
    const cpuR = expect.find(r => r.Component === 'CPU (FPGA)');
    const ax = vrTempAxis(vrTempItems(R), G.T_amb);
    const limLeft = parseFloat(cpu.querySelector('.vr-lim').style.left);
    return {
      names: rows.map(r => r.querySelector('.vr-name').textContent), expect: expect.map(r => r.Component),
      colors: rows.map(r => getComputedStyle(r.querySelector('.vr-used')).backgroundColor),
      expectColors: expect.map(r => rgb(marginLevel(r.Tj_Margin).mk)),
      pills: rows.map(r => r.querySelector('.an-mg').textContent), expectPills: expect.map(r => marginLevel(r.Tj_Margin).icon + r.Tj_Margin.toFixed(1)),
      labels: rows.map(r => r.querySelector('.vr-lbl2').textContent), expectLabels: expect.map(r => r.Temp_Label),
      barW, axisW, limLeft, limExpect: (cpuR['Limit(C)'] - G.T_amb) / (ax.max - G.T_amb) * 100,
      overNow: document.querySelectorAll('#tab2 .vr-temp .vr-over').length,
      legend: [...document.querySelectorAll('#tab2 .vr-temp .vr-legend .an-mg')].map(x => x.textContent),
      sus: rows.filter(r => r.querySelector('.vr-sus')).map(r => r.querySelector('.vr-name').textContent),
      susExpect: expect.filter(r => CompMerge.limitSuspect(r)).map(r => r.Component),
    };
  });
  ok('列＝發熱元件、依風險排序（與詳細分析同一個順序）', JSON.stringify(d.names) === JSON.stringify(d.expect), d.names);
  ok('條的顏色＝MARGIN_LEVELS（與詳細分析同一組；0–10 °C 不再畫紅色）', JSON.stringify(d.colors) === JSON.stringify(d.expectColors), [d.colors, d.expectColors]);
  ok('右欄裕度＝分級圖示＋數字；Tj／Tc 標出判定溫度', JSON.stringify(d.pills) === JSON.stringify(d.expectPills) && JSON.stringify(d.labels) === JSON.stringify(d.expectLabels), [d.pills, d.labels]);
  ok('所有列共用同一條溫度軸（條寬相同、軸也同寬）', d.barW.every(w => w === d.barW[0]) && d.axisW === d.barW[0], [d.barW, d.axisW]);
  ok('限溫線位置＝(限溫 − 環溫) ÷ (軸上限 − 環溫)', near(d.limLeft, d.limExpect, 0.01), [d.limLeft, d.limExpect]);
  ok('圖例＝四級（超溫／偏緊／留意／充裕）', d.legend.length === 4 && /超溫/.test(d.legend[0]) && /充裕/.test(d.legend[3]), d.legend);
  ok('沒有超溫時不畫斜線段', d.overNow === 0, d.overNow);
  ok('限溫疑似範例值標 ⚠（與元件設定、詳細分析同一條規則）', d.sus.length > 0 && JSON.stringify(d.sus) === JSON.stringify(d.susExpect), [d.sus, d.susExpect]);
  const d2 = await page.evaluate(() => {
    const cpu = components.digital.find(c => c.Component === 'CPU (FPGA)'), old = cpu['Limit(C)'];
    // 散熱器依瓶頸設計 → 正常情況下瓶頸的裕度 ≥ 0；只有「允許溫升 < 0」（散熱器壓到環溫也不夠）才會超溫
    cpu['Limit(C)'] = 50; recalc();
    const row = [...document.querySelectorAll('#tab2 .vr-temp .vr-row')].find(r => (r.querySelector('.vr-name') || {}).textContent === 'CPU (FPGA)');
    const out = { over: !!row.querySelector('.vr-over'), pill: row.querySelector('.an-mg').textContent, m: calcResults.rows.find(r => r.Component === 'CPU (FPGA)').Tj_Margin };
    cpu['Limit(C)'] = old; recalc();
    return out;
  });
  ok('超溫的元件：超出限溫的那段畫紅色斜線、裕度標 ✖', d2.m < 0 && d2.over && /^✖/.test(d2.pill), d2);

  console.log('\n[E] 熱源分佈');
  const e = await page.evaluate(() => {
    const R = calcResults, rows = [...document.querySelectorAll('#tab2 .vr-power .vr-list .vr-row')];
    const hot = R.rows.filter(r => r.Total_W > 0).sort((x, y) => y.Total_W - x.Total_W);
    const total = hot.reduce((s, r) => s + r.Total_W, 0);
    const rgb = hex => 'rgb(' + [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';
    const d = vrPowerData(R);
    return {
      names: rows.map(r => r.querySelector('.vr-nm').textContent), expect: hot.map(r => r.Component),
      tags: rows.map(r => r.querySelector('.vr-src').textContent), expectTags: hot.map(r => VR_CATS.find(c => c.key === r._src).label),
      colors: rows.map(r => getComputedStyle(r.querySelector('.vr-fill')).backgroundColor), expectColors: hot.map(r => rgb(VR_CATS.find(c => c.key === r._src).color)),
      pctSum: d.cats.reduce((s, c) => s + c.pct, 0), catSum: d.cats.reduce((s, c) => s + c.w, 0), total,
      legend: [...document.querySelectorAll('#tab2 .vr-power .vr-legend > span')].map(x => x.textContent),
      split: document.querySelectorAll('#tab2 .vr-power .vr-split span').length, ncat: d.cats.length,
    };
  });
  ok('依總功耗由大到小排序', JSON.stringify(e.names) === JSON.stringify(e.expect), e.names);
  ok('每列依分類上色，名稱旁也寫出分類（不只靠顏色）', JSON.stringify(e.colors) === JSON.stringify(e.expectColors) && JSON.stringify(e.tags) === JSON.stringify(e.expectTags), [e.tags, e.colors]);
  ok('分類合計＝總熱負載、佔比加總 100%；分類條與圖例各一段', near(e.catSum, e.total, 1e-9) && near(e.pctSum, 100, 1e-9) && e.split === e.ncat && e.legend.length === e.ncat, e);

  console.log('\n[F] 整機組成');
  const f = await page.evaluate(() => {
    const R = calcResults, d = vrCompData(R, G);
    const lists = [...document.querySelectorAll('#tab2 .vr-comp-panel .vr-list')];
    const thermal = l => [...l.querySelectorAll('.vr-row:not(.total)')].filter(r => getComputedStyle(r.querySelector('.vr-fill')).backgroundColor === 'rgb(30, 58, 95)').map(r => r.querySelector('.vr-nm').textContent);
    return {
      hSum: d.height.reduce((s, x) => s + x.v, 0), H: R.RRU_Height, wSum: d.weight.reduce((s, x) => s + x.v, 0), W: R.total_weight_kg,
      hTotal: lists[0].querySelector('.total .vr-val').textContent, wTotal: lists[1].querySelector('.total .vr-val').textContent,
      thermalH: thermal(lists[0]), thermalW: thermal(lists[1]),
    };
  });
  ok('高度各項加總＝整機高度；重量各項加總＝整機重量', near(f.hSum, f.H, 1e-9) && near(f.wSum, f.W, 1e-9)
     && f.hTotal === f.H.toFixed(1) + ' mm' && f.wTotal === f.W.toFixed(2) + ' kg', f);
  ok('深色＝隨散熱設計變動：高度是鰭片、重量是散熱器', JSON.stringify(f.thermalH) === '["鰭片"]' && JSON.stringify(f.thermalW) === '["散熱器（基板＋鰭片）"]', [f.thermalH, f.thermalW]);

  console.log('\n[G] 狀態：DRC 不通過／無法設計／沒有發熱元件');
  const g = await page.evaluate(() => {
    const txt = id => (document.getElementById(id) || {}).textContent || '';
    const snap = () => ({ state: vrState(calcResults), res: txt('tab2-result'), steps: document.querySelectorAll('#tab2-result .vr-step').length,
      charts: document.querySelectorAll('#tab2 .vr-temp, #tab2 .vr-power').length, comp: txt('tab2-comp'),
      vol: (document.querySelector('#tab2-result .vr-cell.main .vr-num') || {}).textContent });
    const gap = document.getElementById('Gap'), gap0 = gap.value;
    gap.value = 3; recalc(); const drc = snap(); gap.value = gap0; recalc();
    const cpu = components.digital.find(c => c.Component === 'CPU (FPGA)'), lim0 = cpu['Limit(C)'];
    cpu['Limit(C)'] = 50; recalc(); const nosol = snap(); cpu['Limit(C)'] = lim0; recalc();
    const saved = ['rf', 'digital', 'pwr'].map(k => components[k].map(c => c['Power(W)']));
    ['rf', 'digital', 'pwr'].forEach(k => components[k].forEach(c => { c['Power(W)'] = 0; })); recalc(); const nohot = snap();
    ['rf', 'digital', 'pwr'].forEach((k, i) => components[k].forEach((c, j) => { c['Power(W)'] = saved[i][j]; })); recalc();
    return { drc, nosol, nohot, back: vrState(calcResults) };
  });
  ok('DRC 不通過：體積／尺寸／重量顯示「—」、紅色說明、推導照常列出（看得出是哪一步出問題）、不列整機組成',
     g.drc.state === 'drc' && g.drc.vol === '—' && /DRC 不通過：/.test(g.drc.res) && g.drc.steps === 5 && g.drc.charts === 2 && g.drc.comp === '', g.drc);
  ok('允許溫升 ≤ 0：寫出「無法設計」與瓶頸的允許溫升算式、不列推導與整機組成（不再顯示一個沒有鰭片的體積）',
     g.nosol.state === 'nosol' && g.nosol.vol === '—' && /無法設計：瓶頸 CPU \(FPGA\) 的允許溫升只有 -3\.7 °C/.test(g.nosol.res) && g.nosol.steps === 0 && g.nosol.comp === '', g.nosol);
  ok('沒有發熱元件：說明不列體積、沒有圖表', g.nohot.state === 'nohot' && /沒有發熱元件/.test(g.nohot.res) && g.nohot.charts === 0 && g.nohot.steps === 0, g.nohot);
  ok('改回來之後恢復正常', g.back === 'ok', g.back);

  console.log('\n[H] 版面寬度（17 吋筆電）');
  const lay = {};
  for (const w of [1366, 1600, 1920]) {
    await page.setViewportSize({ width: w, height: 1000 });
    await page.waitForTimeout(120);
    lay[w] = await page.evaluate(() => {
      const tab = document.getElementById('tab2'), t = document.querySelector('#tab2 .vr-temp').getBoundingClientRect(), p = document.querySelector('#tab2 .vr-power').getBoundingClientRect();
      return { over: tab.scrollWidth - tab.clientWidth, doc: document.documentElement.scrollWidth - innerWidth, side: Math.abs(t.top - p.top) < 1 && p.left > t.right - 1, tabW: tab.clientWidth,
               steps: getComputedStyle(document.querySelector('#tab2-result .vr-steps')).gridTemplateColumns.split(' ').length };
    });
  }
  ok('1366／1600／1920 都沒有水平溢出', [1366, 1600, 1920].every(w => lay[w].over <= 0 && lay[w].doc <= 0), lay);
  ok('窄（1366）時兩張圖上下排；寬（1920）時並排', !lay[1366].side && lay[1920].side, lay);
  ok('推導 5 步在 1366 仍排成一列（箭頭接得起來）', lay[1366].steps === 5 && lay[1600].steps === 5, lay);
  await page.setViewportSize({ width: 1600, height: 1000 });

  console.log('\n[I] PDF 同步');
  const pdf = await page.evaluate(async () => {
    window.__dd = null;
    ensurePdfmake = async () => {};
    loadCJKFont = async () => true;
    window.pdfMake = { createPdf: dd => ({ download() { window.__dd = dd; } }) };
    await generatePDFReport();
    const dd = window.__dd; if (!dd) return { none: true, alerts: window.__alerts.slice(-2) };
    const flat = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : (n && typeof n === 'object') ? (flat(n.text || '') + flat(n.stack || '') + flat(n.columns || '') + (n.table ? flat(n.table.body) : '')) : '';
    const content = dd.content, all = flat(content);
    const at = t => content.findIndex(n => n && n.text && flat(n.text).startsWith(t));
    const s1 = at('1. Executive Summary'), s2 = at('2. Component List');
    const s4 = at('4. Visual Report'), s5 = content.findIndex(n => n && n.stack && flat(n.stack[0].text).startsWith('5. Composition'));
    const sec = (i, j) => flat(content.slice(i, j));
    const R = calcResults, Q = R.rows.filter(r => r.Total_W > 0).reduce((s, r) => s + r.Total_W, 0);
    const images = JSON.stringify(content).match(/"image"/g) || [];
    const tempTbl = content.slice(s4, s5).find(n => n && n.table && n.table.widths && n.table.widths[1] === 240 && /Tj|Tc/.test(flat(n.table.body[0][2])));
    return {
      s1: sec(s1, s2), s4: sec(s4, s5), s5: flat(content[s5]), images: images.length,
      vol: R.Volume_L.toFixed(2), Q: Q.toFixed(1), area: R.Area_req.toFixed(3),
      tempRows: tempTbl ? tempTbl.table.body.map(r => flat(r[0].text)) : null,
      tempExpect: tab1SortRows(R.rows, { col: 'Allowed_dT', dir: 1 }).filter(r => r.Total_W > 0).map(r => r.Component),
      tempCanvas: tempTbl ? tempTbl.table.body.every(r => r[1].canvas) : false,
      oldKpi: /Total Power \/ 整機總熱耗|Required Area \/ 所需散熱面積|Temperature Margin Overview/.test(all),
      bad: (JSON.stringify(content, (k, v) => k === 'image' ? undefined : v).match(/[！-～←-⇿≤≥■-➿Ͱ-Ͽ]/g) || []).slice(0, 10),
    };
  });
  if (pdf.none) ok('PDF 產生（攔截 createPdf）', false, pdf);
  else {
    ok('第 1 節＝設計結果（體積）＋ 5 步推導（熱負載是實際值）', pdf.s1.includes('設計結果') && pdf.s1.includes(pdf.vol) && pdf.s1.includes('體積怎麼決定的')
       && pdf.s1.includes('1. 熱負載') && pdf.s1.includes(pdf.Q) && pdf.s1.includes(pdf.area), pdf.s1.slice(0, 200));
    ok('不再有舊的 KPI（整機總熱耗含係數）與「溫度裕度總覽」圖', !pdf.oldKpi, pdf.oldKpi);
    ok('第 4 節＝溫度 vs 限溫＋熱源分佈，直接畫（canvas），不截圖表', /Temperature vs Limit/.test(pdf.s4) && /Heat Sources/.test(pdf.s4) && pdf.tempCanvas && pdf.images === 0, [pdf.images, pdf.s4.slice(0, 120)]);
    ok('第 4 節溫度圖與畫面同一個順序（依風險）', JSON.stringify(pdf.tempRows) === JSON.stringify(pdf.tempExpect), pdf.tempRows);
    ok('第 5 節＝整機組成（高度、重量）', /5\. Composition/.test(pdf.s5) && /高度 \(mm\)/.test(pdf.s5) && /重量 \(kg\)/.test(pdf.s5), pdf.s5.slice(0, 120));
    ok('PDF 沒有字型缺字（全形標點、符號都轉成字型有的字）', pdf.bad.length === 0, pdf.bad);
  }

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
