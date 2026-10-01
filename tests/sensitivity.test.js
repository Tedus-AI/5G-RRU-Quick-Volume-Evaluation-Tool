/*
 * 敏感度分析頁（renderTab4）改版 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 使用者回報：air gap 有意義、環溫用處不大、熱耗（原本的「功耗縮放」）很難看懂、要有讀圖說明；Tornado 拿掉。
 * 驗算時發現原本「固定散熱器」的裕度算錯：computeAll(…, 固定面積) 會照新工況重算鰭片高、拿新的 h／η 配舊面積
 * （評估一顆不存在的散熱器），損失被放大約一倍；做不出來（DRC）的點照樣畫成體積；環溫用 ±% 掃。
 *
 * 驗證情境：
 *   [A] 版面：摘要 → ① air gap → ② 熱耗 → ③ 環溫；舊的掃描／Tornado 都不在；這頁不在畫面上時不畫、切過來才畫
 *   [B] 固定這顆散熱器：基準＝computeAll 的裕度；環溫 +d → 每顆裕度剛好 −d；熱耗倍數 s → 一次式；
 *       餘裕（環溫上限、熱耗上限）代回去，最先超溫那顆的裕度＝0；跟舊算法（重算鰭片高）的差別
 *   [C] ① air gap：4～20 mm 絕對範圍＋目前的值、每一點＝computeAll 重新設計；做不出來的點不畫在曲線上（× ＋原因、灰底）；
 *       流阻比建議帶 AR_GOOD；建議範圍內體積最小；目前的值不在 0.5 mm 格點上也會列入
 *   [D] ② 熱耗：畫「最先碰到 0」的三顆（裕度大、但自己 P×R 也大的元件掉得快）；+10% 拆成散熱器升溫＋自己的 P×R；
 *       重新設計做不出來的點標 ×
 *   [E] ③ 環溫：+0／+5／+10 的裕度 1:1、重新設計體積＝computeAll；最高做得到幾度與原因
 *   [F] 摘要文案：安全係數 1.0（沒有餘裕）、1.1（說明來源與 +10% 的拆解）、0.9（目前就超溫）
 *   [G] 狀態：擋下計算、沒有發熱元件、無法設計、DRC 不通過（只列 ①）
 *   [H] 版面寬度：1366／1600 不會水平溢出；寬的時候 ② 兩張圖並排、窄的時候上下
 *   [I] PDF：敏感度分析一節＝摘要＋(1)(2)(3)，圖由 Plotly.toImage 吃同一組圖（不截畫面）；這頁沒開過也有；結論節號接在後面
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/sensitivity.test.js        # 可用 TEST_URL 指定網址
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
    // Plotly 換成記錄器：畫面上的圖（newPlot）與 PDF 的圖（toImage）都記下來比對
    window.__plots = {}; window.__imgs = [];
    window.Plotly = { newPlot(el, data, layout){ window.__plots[typeof el === 'string' ? el : el.id] = {data, layout}; return Promise.resolve(); },
      Plots:{resize(){}}, relayout(){}, purge(){},
      toImage: async (fig, o) => { window.__imgs.push({fig, o}); return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; } };
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
  // 每個情境前：還原內建範例（元件與參數控制台）
  await page.evaluate(() => {
    window.__orig = { comps: JSON.parse(JSON.stringify(components)), Margin: document.getElementById('Margin').value, Gap: document.getElementById('Gap').value, T_amb: document.getElementById('T_amb').value };
    window.__reset = () => { components.rf = JSON.parse(JSON.stringify(__orig.comps.rf)); components.digital = JSON.parse(JSON.stringify(__orig.comps.digital)); components.pwr = JSON.parse(JSON.stringify(__orig.comps.pwr));
      ['Margin', 'Gap', 'T_amb'].forEach(k => { document.getElementById(k).value = __orig[k]; }); recalc(); renderTab4(true); };
  });

  console.log('\n[A] 版面與「切過來才畫」');
  const a0 = await page.evaluate(() => ({ body: document.getElementById('sa-body').innerHTML.length, stale: tab4Stale, plots: Object.keys(window.__plots) }));
  ok('這頁還沒打開：不畫（只標記要重畫）', a0.body === 0 && a0.stale === true && !a0.plots.some(k => /^sa-/.test(k)), a0);
  await page.evaluate(() => { document.getElementById('T_amb').value = 46; recalc(); });
  const a1 = await page.evaluate(() => ({ body: document.getElementById('sa-body').innerHTML.length, stale: tab4Stale }));
  ok('改參數（這頁不在畫面上）：還是不畫', a1.body === 0 && a1.stale === true, a1);
  await page.evaluate(() => { document.getElementById('T_amb').value = __orig.T_amb; recalc(); switchTab(4); });
  const a = await page.evaluate(() => {
    const tab = document.getElementById('tab4');
    return {
      secs: [...document.querySelectorAll('#sa-body > section')].map(s => s.id),
      heads: [...document.querySelectorAll('#sa-body .vr-head .vr-title')].map(x => x.textContent),
      stale: tab4Stale,
      old: ['sa_var', 'sa_base', 'sa_minus', 'sa_plus', 'sa_steps', 'sa-sweep-panel', 'sa-sweep-results', 'sa-tornado-panel', 'sa-tornado-results', 'tornado_pct', 'tornado_metric', 'sa-cl', 'sa-cr', 'tv', 'tt'].filter(id => document.getElementById(id)),
      oldFns: ['runSweep', 'runTornado', 'saCalc', 'updateSABase', 'toggleSAMode', 'fullscreenBtn'].filter(f => typeof window[f] !== 'undefined'),
      tornado: /tornado/i.test(tab.textContent), radios: tab.querySelectorAll('input[name="sa_mode"]').length,
      plots: Object.keys(window.__plots).filter(k => /^sa-/.test(k)).sort(),
      text: tab.textContent, computeAllArgs: computeAll.length,
    };
  });
  ok('區塊順序：摘要 → ① air gap → ② 熱耗 → ③ 環溫', JSON.stringify(a.secs) === JSON.stringify(['sa-sum', 'sa-gap-sec', 'sa-pw-sec', 'sa-amb-sec']), a.secs);
  ok('標題回答問題', /還有多少餘裕/.test(a.heads[0]) && /air gap/.test(a.heads[1]) && /熱耗/.test(a.heads[2]) && /環溫/.test(a.heads[3]), a.heads);
  ok('切過來就畫，畫完不再標記', a.stale === false && JSON.stringify(a.plots) === JSON.stringify(['sa-gap', 'sa-pw-fix', 'sa-pw-new']), [a.stale, a.plots]);
  ok('舊的掃描／Tornado 控制項與函式都不在了', a.old.length === 0 && a.oldFns.length === 0 && !a.tornado && a.radios === 0, [a.old, a.oldFns]);
  ok('沒有 NaN／undefined／Infinity', !/NaN|undefined|Infinity/.test(a.text), (a.text.match(/.{20}(NaN|undefined|Infinity).{20}/) || [])[0]);
  ok('computeAll 不再收「固定面積」（只剩 params, comps）', a.computeAllArgs === 2, a.computeAllArgs);

  console.log('\n[B] 固定這顆散熱器的模型');
  const b = await page.evaluate(() => {
    const R = calcResults, fx = {A:R.Area_req, h:R.h_value, eff:R.eff};
    const e0 = saFixedEval(G, components, fx), hot = R.rows.filter(r => r.Total_W > 0);
    const base = e0.list.map(q => { const r = hot.find(x => x.Component === q.name); return [q.margin, r.Tj_Margin]; });
    const e5 = saFixedEval({...G, T_amb:G.T_amb + 5}, components, fx);
    const f = s => saFixedEval(G, saScale(components, s), fx).list.map(q => q.margin);
    const m1 = f(1), m11 = f(1.1), m12 = f(1.2), m09 = f(0.9);
    const hr = saHeadroom(G, components, fx), atCap = saFixedEval(G, saScale(components, hr.sMax), fx), atAmb = saFixedEval({...G, T_amb:G.T_amb + hr.dT}, components, fx);
    // 舊算法：環溫 +5 時照新工況重算鰭片高、新的 h／η 配目前的面積
    const g5 = {...G, T_amb:G.T_amb + 5}, r5 = computeAll(g5, components), old5 = Math.min(...r5.rows.filter(r => r.Total_W > 0).map(r => {
      const THB = g5.T_amb + r5.rows.filter(x => x.Total_W > 0).reduce((s, x) => s + x.Total_W, 0) / (r5.h_value * R.Area_req * r5.eff);
      const tc = THB + r['Height(mm)'] * G.Slope + r['Power(W)'] * (r.R_int + r.R_TIM), tj = tc + r['Power(W)'] * r.R_jc; return r['Limit(C)'] - (r.Temp_Label === 'Tc' ? tc : tj); }));
    return { base, minBase:e0.min.margin, BTM:R.Bottleneck_Tj_Margin, d5:e5.list.map((q, i) => q.margin - e0.list[i].margin),
      lin:m1.map((v, i) => (m12[i] - v) - 2 * (m11[i] - v)), sym:m1.map((v, i) => (m11[i] - v) + (m09[i] - v)),
      capMin:atCap.min.margin, capWho:atCap.min.name, lim:hr.lim.name, ambMin:atAmb.min.margin, dT:hr.dT, old5, new5:e5.min.margin,
      sumAmb:document.querySelector('#sa-sum .vr-cell.main .vr-num').textContent, expAmb:(G.T_amb + hr.dT).toFixed(1),
      sumCap:document.querySelectorAll('#sa-sum .vr-cell')[1].querySelector('.vr-num').textContent, expCap:String(Math.round(hr.Pmax)) };
  });
  ok('基準點的裕度＝computeAll（每一顆）', b.base.every(([x, y]) => near(x, y, 1e-6)) && near(b.minBase, b.BTM, 0.051), b.base.slice(0, 3));
  ok('環溫 +5 °C → 每一顆的裕度剛好 −5 °C（h 跟溫差無關）', b.d5.every(v => near(v, -5, 1e-9)), b.d5);
  ok('熱耗倍數 s → 裕度是一次式（×1.2 的變化＝×1.1 的兩倍、×0.9 與 ×1.1 對稱）', b.lin.every(v => near(v, 0, 1e-9)) && b.sym.every(v => near(v, 0, 1e-9)), [b.lin, b.sym]);
  ok('熱耗上限代回去：最先超溫那顆的裕度＝0', near(b.capMin, 0, 1e-6) && b.capWho === b.lim, [b.capMin, b.capWho, b.lim]);
  ok('環溫上限代回去：瓶頸的裕度＝0', near(b.ambMin, 0, 1e-9), b.ambMin);
  ok('摘要的環溫上限／熱耗上限＝上面算的', b.sumAmb.startsWith(b.expAmb) && b.sumCap.startsWith(b.expCap), [b.sumAmb, b.expAmb, b.sumCap, b.expCap]);
  ok('舊算法（重算鰭片高配舊面積）環溫 +5 °C 會多扣（悲觀）：' + b.old5.toFixed(1) + ' vs 正確 ' + b.new5.toFixed(1), b.old5 < b.new5 - 1, [b.old5, b.new5]);

  console.log('\n[C] ① air gap：每一點重新設計、做不出來的不畫在曲線上、流阻比建議帶');
  const c = await page.evaluate(() => {
    const near = (a, b, t) => Math.abs(a - b) <= t;
    const d = saData(calcResults, G, components), P = d.gap.pts, fig = window.__plots['sa-gap'];
    const line = fig.data[0], xTrace = fig.data.find(t => t.name === '做不出來');
    const band = fig.layout.shapes.find(s => s.yref === 'y2');
    const goods = P.filter(p => p.ok && arGood(p.AR)), best = goods.reduce((m, p) => (!m || p.V < m.V ? p : m), null);
    return {
      xs:P.map(p => p.x), gap:G.Gap,
      match:P.every(p => { const r = computeAll({...G, Gap:p.x}, components); return near(p.V, r.Volume_L, 1e-9) && near(p.AR, r.aspect_ratio, 1e-9) && p.ok === (!r.drc_failed && r.Fin_Height > 0); }),
      badOnLine:P.some((p, i) => !p.ok && line.y[i] != null), okOnLine:P.every((p, i) => !p.ok || line.y[i] === p.V),
      badX:xTrace ? xTrace.x : [], badWhy:xTrace ? xTrace.text : [], expBad:P.filter(p => !p.ok).map(p => p.x),
      grey:fig.layout.shapes.filter(s => s.yref === 'paper' && s.fillcolor === '#e2e8f0').map(s => [s.x0, s.x1]), runs:saRuns(P, p => p.ok ? null : 1).length,
      covered:P.filter(p => !p.ok).every(p => fig.layout.shapes.some(s => s.yref === 'paper' && s.fillcolor === '#e2e8f0' && s.x0 < p.x && p.x < s.x1)),
      okFree:P.filter(p => p.ok).every(p => !fig.layout.shapes.some(s => s.yref === 'paper' && s.fillcolor === '#e2e8f0' && s.x0 < p.x && p.x < s.x1)),
      band:band && [band.y0, band.y1], AR_GOOD,
      best:d.gap.best && d.gap.best.x, expBest:best && best.x, bestTrace:(fig.data.find(t => t.name === '建議範圍內體積最小') || {}).x,
      cur:(fig.data.find(t => t.name === '目前') || {}).x,
      ans:[...document.querySelectorAll('#sa-gap-sec .sa-ans > span')].map(s => s.textContent),
      leg:document.querySelector('#sa-gap-sec .sa-leg').textContent, read:document.querySelectorAll('#sa-gap-sec .sa-read li').length,
      tall:document.getElementById('sa-gap').classList.contains('tall'),
    };
  });
  ok('掃描 4～20 mm（每 0.5 mm）＋目前的值', c.xs[0] === 4 && c.xs[c.xs.length - 1] === 20 && c.xs.includes(c.gap) && c.xs.length >= 33, c.xs);
  ok('每一點＝computeAll 重新設計（體積、流阻比、做不做得出來）', c.match);
  ok('做不出來的點不畫在曲線上，改畫 ×（附原因）', !c.badOnLine && c.okOnLine && JSON.stringify(c.badX) === JSON.stringify(c.expBad) && c.badWhy.every(w => w.length > 3), [c.badX, c.expBad]);
  ok('做不出來的範圍畫灰底（連續的一段一塊、蓋住每個做不出來的點、不蓋到做得出來的點）', c.grey.length === c.runs && c.runs >= 1 && c.covered && c.okFree, [c.grey, c.runs]);
  ok('流阻比圖有建議帶（AR_GOOD）', JSON.stringify(c.band) === JSON.stringify(c.AR_GOOD), c.band);
  ok('建議範圍內體積最小＝流阻比在建議範圍的點裡體積最小的', c.best === c.expBest && (c.best === c.cur[0] || (c.bestTrace || [])[0] === c.best), [c.best, c.expBest, c.bestTrace]);
  ok('答案：目前、建議範圍、做不出來', /^目前 11\.6 mm/.test(c.ans[0]) && /流阻比在建議範圍/.test(c.ans[1]) && /做不出來/.test(c.ans[2]), c.ans);
  ok('圖例＋怎麼看（3 點）', /流阻比建議/.test(c.leg) && /做不出來/.test(c.leg) && c.read === 3 && c.tall, [c.leg, c.read]);
  const c2 = await page.evaluate(() => { document.getElementById('Gap').value = 10.3; recalc(); renderTab4(true);
    const d = saData(calcResults, G, components), fig = window.__plots['sa-gap'];
    return { has:d.gap.pts.some(p => p.x === 10.3 && p.cur), cur:(fig.data.find(t => t.name === '目前') || {}).x, ans:document.querySelector('#sa-gap-sec .sa-ans > span').textContent }; });
  ok('目前的 air gap 不在 0.5 mm 格點上（10.3）也列入、標成目前', c2.has && c2.cur[0] === 10.3 && /^目前 10\.3 mm/.test(c2.ans), c2);
  await page.evaluate(() => __reset());

  console.log('\n[D] ② 熱耗：畫最先碰到 0 的三顆');
  const d = await page.evaluate(() => {
    const sel0 = saData(calcResults, G, components).pw.sel.map(q => q.name);
    // Final PA：裕度改成 5 °C（比 Power Mod 的 2.3 大），但自己的 P×R 很大 → 熱耗一增加就掉得比 Power Mod 快
    const R = calcResults, pa = R.rows.find(r => r.Component === 'Final PA'), comp = components.rf.find(x => x.Component === 'Final PA');
    comp['Limit(C)'] = +comp['Limit(C)'] - (pa.Tj_Margin - 5); recalc(); renderTab4(true);
    const dd = saData(calcResults, G, components), list = dd.hr.base.list;
    const bySmallestMargin = list.slice().sort((p, q) => p.margin - q.margin).slice(0, 3).map(q => q.name);
    const fig = window.__plots['sa-pw-fix'], legend = [...document.querySelectorAll('#sa-pw-sec .sa-chart:first-child .sa-leg > span')].map(s => s.textContent);
    const paQ = list.find(q => q.name === 'Final PA');
    return { sel0, sel:dd.pw.sel.map(q => q.name), s0:dd.pw.sel.map(q => q.s0), bySmallestMargin, paMargin:paQ.margin, paS0:paQ.s0,
      lines:fig.data.filter(t => t.mode === 'lines').map(t => t.name.split(' · ')[0]), dash:fig.data.filter(t => t.mode === 'lines').map(t => t.line.dash),
      legend, zero:fig.layout.shapes.some(s => s.y0 === 0 && s.y1 === 0), d10:dd.hr.d10,
      d10chk:(() => { const fx = dd.fx, e1 = saFixedEval(G, components, fx), e2 = saFixedEval(G, saScale(components, 1.1), fx); const q = e1.min; return { hsk:e2.THB - e1.THB, tot:q.margin - e2.list[q.i].margin }; })(),
      ans:[...document.querySelectorAll('#sa-pw-sec .sa-ans > span')].map(s => s.textContent), read:document.querySelectorAll('#sa-pw-sec .sa-read li').length };
  });
  ok('內建範例：畫的三顆＝最先碰到 0 的三顆', JSON.stringify(d.sel0) === JSON.stringify(['CPU (FPGA)', '16G DDR', 'Power Mod']), d.sel0);
  ok('Final PA 裕度 5 °C（比 Power Mod 大）但掉得快 → 改畫 PA、不畫 Power Mod', d.sel.includes('Final PA') && !d.sel.includes('Power Mod') && d.bySmallestMargin.includes('Power Mod') && near(d.paMargin, 5, 1e-6), [d.sel, d.bySmallestMargin]);
  ok('依歸零順序排、線型粗實線 → 虛線 → 點線', d.s0.every((v, i) => !i || v >= d.s0[i - 1]) && JSON.stringify(d.lines) === JSON.stringify(d.sel) && JSON.stringify(d.dash) === JSON.stringify(['solid', 'dash', 'dot']), [d.s0, d.dash]);
  ok('圖例寫每顆「歸零在 X W」、有 0 線', d.legend.length === 3 && d.legend.every(t => /歸零在 \d+ W/.test(t)) && d.zero, d.legend);
  ok('熱耗 +10%：散熱器升溫＋自己的 P×R＝裕度掉多少', near(d.d10.hsk + d.d10.self, d.d10.total, 1e-9) && near(d.d10.hsk, d.d10chk.hsk, 1e-9) && near(d.d10.total, d.d10chk.tot, 1e-9), [d.d10, d.d10chk]);
  ok('答案：熱耗上限＋誰先碰到 0；+10% 的拆解', /熱耗上限 \d+ W/.test(d.ans[0]) && /先碰到 0/.test(d.ans[0]) && /散熱器升溫 \+[\d.]+ °C.*自己的 P×R \+[\d.]+ °C → 裕度 −[\d.]+ °C/.test(d.ans[1]) && d.read === 3, d.ans);
  await page.evaluate(() => __reset());
  const d2 = await page.evaluate(() => {
    // 把功耗放大到「目前做得出來、×1.3 做不出來」（Embedded 鰭片高 > 100 mm）
    const orig = JSON.parse(JSON.stringify(components)); let k = 1;
    for (; k < 2.5; k += 0.05) { const cc = saScale(orig, k), r0 = computeAll(G, cc), r1 = computeAll(G, saScale(cc, 1.3));
      if (!r0.drc_failed && r0.Fin_Height > 0 && (r1.drc_failed || !(r1.Fin_Height > 0))) break; }
    const cc = saScale(orig, k); components.rf = cc.rf; components.digital = cc.digital; components.pwr = cc.pwr; recalc(); renderTab4(true);
    const dd = saData(calcResults, G, components), fig = window.__plots['sa-pw-new'], x = fig.data.find(t => /^做不出來/.test(t.name)), line = fig.data[0];
    return { k, bad:dd.pw.pts.filter(p => !p.ok).map(p => +p.TW.toFixed(1)), xs:x.x.map(v => +v.toFixed(1)), why:x.text, onLine:dd.pw.pts.some((p, i) => !p.ok && line.y[i] != null),
      leg:document.querySelectorAll('#sa-pw-sec .sa-chart')[1].querySelector('.sa-leg').textContent, name:x.name };
  });
  ok('重新設計做不出來的熱耗：不畫在曲線上、標 ×（附原因）', d2.bad.length > 0 && JSON.stringify(d2.bad) === JSON.stringify(d2.xs) && !d2.onLine && d2.why.every(w => /Embedded|流阻比|h_conv/.test(w)), d2);
  ok('右圖圖例寫出做不出來的原因（畫面的 HTML 圖例、PDF 的圖內圖例）', /做不出來（/.test(d2.leg) && /^做不出來（/.test(d2.name), [d2.leg, d2.name]);
  await page.evaluate(() => __reset());

  console.log('\n[E] ③ 環溫');
  const e = await page.evaluate(() => {
    const dd = saData(calcResults, G, components), rows = [...document.querySelectorAll('#sa-amb-tbl tbody tr')].map(tr => [...tr.cells].map(td => td.textContent));
    const m0 = dd.hr.dT, a = dd.amb;
    const lastOk = computeAll({...G, T_amb:a.lastOk.t}, components), next = a.fail && computeAll({...G, T_amb:a.fail.t}, components);
    return { rows, m:a.rows.map(r => r.m), exp:[0, 5, 10].map(dd2 => m0 - dd2),
      V:a.rows.map(r => r.V), expV:[0, 5, 10].map(x => computeAll({...G, T_amb:G.T_amb + x}, components).Volume_L),
      lastOk:!lastOk.drc_failed && lastOk.Fin_Height > 0, failOk:!a.fail || next.drc_failed || !(next.Fin_Height > 0), fail:a.fail,
      ans:[...document.querySelectorAll('#sa-amb-sec .sa-ans > span')].map(s => s.textContent), neg:document.querySelectorAll('#sa-amb-tbl .sa-neg').length };
  });
  ok('裕度：+0／+5／+10 °C → 剛好差 0／5／10 °C', e.m.every((v, i) => near(v, e.exp[i], 1e-9)), [e.m, e.exp]);
  ok('重新設計的體積＝computeAll（環溫 +d）', e.V.every((v, i) => near(v, e.expV[i], 1e-9)), [e.V, e.expV]);
  ok('表格 3 列、目前那列標「（目前）」、負的裕度標超溫（紅字）', e.rows.length === 3 && /（目前）/.test(e.rows[0][0]) && e.neg >= 1 && /超溫/.test(e.rows[1][1]), e.rows);
  ok('最高做得到幾度：那一度做得出來、下一度做不出來（寫出原因）', e.lastOk && e.failOk && /最高做得到 \d+ °C/.test(e.ans[1]) && /起做不出來/.test(e.ans[1]), [e.ans, e.fail]);

  console.log('\n[F] 摘要文案（安全係數）');
  const f = await page.evaluate(() => {
    const at = M => { document.getElementById('Margin').value = M; recalc(); renderTab4(true); const al = document.querySelector('#sa-sum .vr-alert'); return { cls:al.className, t:al.textContent, amb:document.querySelector('#sa-sum .vr-cell.main .vr-note').textContent }; };
    return { m10:at(1.0), m11:at(1.1), m09:at(0.9) };
  });
  ok('×1.0：琥珀色提醒「剛好夠、沒有任何餘裕」', /warn/.test(f.m10.cls) && /剛好夠/.test(f.m10.t) && /還能再高 0\.0 °C/.test(f.m10.amb), f.m10);
  ok('×1.1：說明餘裕來自安全係數、+10% 熱耗的拆解', /info/.test(f.m11.cls) && /安全係數 ×1\.1/.test(f.m11.t) && /熱耗每 \+10%/.test(f.m11.t) && /散熱器升溫/.test(f.m11.t), f.m11.t);
  ok('×0.9：紅色「目前就超溫」', /fail/.test(f.m09.cls) && /目前就超溫/.test(f.m09.t) && /已超出/.test(f.m09.amb), f.m09);
  await page.evaluate(() => __reset());

  console.log('\n[G] 狀態');
  const g = await page.evaluate(() => {
    const txt = () => document.getElementById('sa-body').textContent, secs = () => [...document.querySelectorAll('#sa-body > section')].map(s => s.id);
    const out = {};
    delete components.rf[0]['Height(mm)']; recalc(); renderTab4(true); out.blocked = { t:txt(), secs:secs() }; __reset();
    ['rf', 'digital', 'pwr'].forEach(k => components[k].forEach(c => { c['Power(W)'] = 0; })); recalc(); renderTab4(true); out.nohot = { t:txt(), secs:secs() }; __reset();
    components.digital.find(c => c.Component === 'CPU (FPGA)')['Limit(C)'] = 40; recalc(); renderTab4(true); out.nosol = { t:txt(), secs:secs() }; __reset();
    document.getElementById('Gap').value = 3; recalc(); renderTab4(true); out.drc = { t:txt(), secs:secs(), plots:Object.keys(window.__plots).filter(k => /^sa-/.test(k)), drc:calcResults.drc_failed,
      cur:document.querySelector('#sa-gap-sec .sa-ans > span').textContent,
      firstShade:(window.__plots['sa-gap'].layout.shapes.filter(s => s.yref === 'paper' && s.fillcolor === '#e2e8f0')[0] || {}) }; __reset();
    return out;
  });
  ok('擋下計算：只顯示缺什麼', /無法計算體積/.test(g.blocked.t) && g.blocked.secs.length === 0, g.blocked.t.slice(0, 80));
  ok('沒有發熱元件：一行說明、不分析', /沒有發熱元件/.test(g.nohot.t) && g.nohot.secs.every(s => !s), g.nohot.secs);
  ok('無法設計（允許溫升 ≤ 0）：說明瓶頸、不分析', /無法設計/.test(g.nosol.t) && /先處理瓶頸元件/.test(g.nosol.t), g.nosol.t.slice(0, 80));
  ok('DRC 不通過：只列 ①（找一個做得出來的 air gap），② ③ 略過', g.drc.drc && /DRC 不通過/.test(g.drc.t) && JSON.stringify(g.drc.secs.filter(Boolean)) === JSON.stringify(['sa-gap-sec']) && /^目前 3 mm 做不出來/.test(g.drc.cur), g.drc);
  ok('目前 3 mm（不在格點上）與 4 mm 都做不出來：灰底接成一塊、不留白縫', g.drc.firstShade.x0 < 3 && g.drc.firstShade.x1 > 4, g.drc.firstShade);

  console.log('\n[H] 版面寬度');
  const widthAt = async (w) => { await page.setViewportSize({ width: w, height: 900 }); await page.evaluate(() => renderTab4(true)); await page.waitForTimeout(150);
    return page.evaluate(() => { const t = document.getElementById('tab4'), two = document.querySelector('#sa-pw-sec .sa-two');
      return { over:t.scrollWidth - t.clientWidth, cols:getComputedStyle(two).gridTemplateColumns.split(' ').length, w:t.clientWidth,
        sumCols:getComputedStyle(document.querySelector('#sa-sum .vr-res')).gridTemplateColumns.split(' ').length }; }); };
  const h1600 = await widthAt(1600), h1366 = await widthAt(1366), h900 = await widthAt(900);
  ok('1600／1366：不水平溢出、② 兩張圖並排、摘要三欄', h1600.over <= 0 && h1366.over <= 0 && h1600.cols === 2 && h1366.cols === 2 && h1366.sumCols === 3, [h1600, h1366]);
  ok('窄（頁寬 < 900 px）：② 上下排、摘要單欄、不溢出', h900.cols === 1 && h900.sumCols === 1 && h900.over <= 0, h900);
  await page.setViewportSize({ width: 1600, height: 1000 });

  console.log('\n[I] PDF');
  const pdf = await page.evaluate(async () => {
    __reset(); switchTab(0); window.__imgs = [];
    document.getElementById('sa-body').innerHTML = ''; tab4Stale = true;   // 這頁沒開過（畫面上沒有任何敏感度分析的圖）
    window.__dd = null;
    ensurePdfmake = async () => {};
    loadCJKFont = async () => true;
    window.pdfMake = { createPdf: dd => ({ download() { window.__dd = dd; } }) };
    await generatePDFReport();
    const dd = window.__dd; if (!dd) return { none:true, alerts:window.__alerts.slice(-2) };
    const flat = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : (n && typeof n === 'object') ? (flat(n.text || '') + flat(n.stack || '') + flat(n.columns || '') + flat(n.ul || '') + (n.table ? flat(n.table.body) : '')) : '';
    const content = dd.content, all = flat(content);
    const at = re => content.findIndex(n => n && n.text && re.test(flat(n.text)));
    const iSA = at(/^\d+\. Sensitivity Analysis/), iCon = at(/^\d+\. Conclusion/), sec = flat(content.slice(iSA, iCon));
    const d = saData(calcResults, G, components);
    return { iSA, iCon, head:flat(content[iSA].text), con:flat(content[iCon].text), has3d:/3D Simulation/.test(all),
      sum:/目前這顆散熱器還有多少餘裕/.test(sec) && sec.includes(saF1(G.T_amb + d.hr.dT)) && sec.includes(String(Math.round(d.hr.Pmax))),
      parts:['(1) 鰭片 air gap', '(2) 熱耗比預估高的時候', '(3) 環溫規格'].map(t => sec.includes(t)),
      ans:[saGapAns(d), saPwAns(d), saAmbAns(d, G)].every(list => list.every(x => sec.includes(pdfSafeText(saRunsTxt(x.runs))))),
      table:/固定這顆散熱器: 瓶頸裕度|固定這顆散熱器：瓶頸裕度/.test(sec), read:(sec.match(/怎麼看/g) || []).length,
      images:JSON.stringify(content.slice(iSA, iCon)).match(/"image"/g) || [],
      toImage:window.__imgs.map(x => ({ names:x.fig.data.map(t => t.name).filter(Boolean), legend:x.fig.layout.showlegend, w:x.o.width, h:x.o.height })),
      old:/Tornado|龍捲風|Sweep Analysis|單變數掃描/.test(all), circled:/[①②③]/.test(JSON.stringify(dd.content)),
      hover:/滑到|滑過去/.test(sec), where:/原因見上面|原因寫在圖例/.test(sec) };
  });
  if (pdf.none) ok('PDF 產生（攔截 createPdf）', false, pdf);
  else {
    ok('有敏感度分析一節（這頁沒開過也有）、節號接在 3D 後面', pdf.iSA > 0 && /^(6|7)\. Sensitivity Analysis/.test(pdf.head) && (pdf.has3d ? /^7\./.test(pdf.head) : /^6\./.test(pdf.head)), [pdf.head, pdf.has3d]);
    ok('結論節號接在敏感度分析後面', +pdf.con[0] === +pdf.head[0] + 1, [pdf.head, pdf.con]);
    ok('摘要（環溫上限、熱耗上限）與畫面同一組數字', pdf.sum);
    ok('三段都在（PDF 的 ①②③ 寫成 (1)(2)(3)，字型沒有圈數字）', pdf.parts.every(Boolean) && !pdf.circled, pdf.parts);
    ok('答案文字與畫面同一份（saGapAns／saPwAns／saAmbAns，PDF 只換掉字型沒有的符號）', pdf.ans);
    ok('環溫表格＋三段都有「怎麼看」', pdf.table && pdf.read >= 3, [pdf.table, pdf.read]);
  ok('PDF 的讀圖說明不叫人「滑過去看」（改寫原因在哪）', !pdf.hover && pdf.where, [pdf.hover, pdf.where]);
    ok('3 張圖：Plotly.toImage 吃同一組圖（圖例畫進圖裡），不截畫面', pdf.images.length === 3 && pdf.toImage.length === 3 && pdf.toImage.every(x => x.legend === true && x.w === 1000)
       && pdf.toImage[0].names.includes('做不出來') && pdf.toImage[1].names.some(n => /歸零在/.test(n)) && pdf.toImage[2].names.includes('需要的體積'), pdf.toImage);
    ok('PDF 沒有舊的 Tornado／單變數掃描', !pdf.old);
  }

  ok('沒有 JS 錯誤', errors.length === 0, errors);
  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
