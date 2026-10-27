/*
 * 鰭片係數「目前採用」＋ Die-casting K_FIN 150 ＋ 存檔寫設計結果（rru_result）—— headless 驗證
 * ---------------------------------------------------------------------------
 * 使用者要求（2026-10）：
 *   - 參數控制台要看得到鰭片的預設係數（原本只在「自訂」打開後的 placeholder 裡）；
 *   - Die-casting 的 K_FIN 預設由 160 改為 150；
 *   - 熱網路工具 06 的鰭片陣列要連動 5G-RRU（鰭片高、片數、air gap、厚度、拔模角、K_FIN）
 *     → 存檔時把設計結果寫進 projects[id].rru_result。
 *
 *   [A] FIN_PROCESS_DEFAULTS：Embedded 1.06／200、Die-casting 0.99／150；computeAll 用的就是它。
 *   [B] 參數控制台「目前採用」：預設值與來源（預設／自訂），自訂但留白的那一項照樣是預設。
 *   [C] 製程下拉：顯示文字不再帶 (0.95)／(0.90)（不是實際係數），value 不變（資料庫與別的工具讀它）。
 *   [D] rruDesignResult：可設計 → ok＋鰭片幾何（與 computeAll 同一組）；Die-casting 另有拔模角／T_root；
 *       擋下計算 → ok:false＋原因、沒有鰭片欄位（對方工具不會拿到舊結果）。
 *   [E] 存檔欄位（_buildProjectFields）帶 rru_result；PDF 參數表的鰭片製程寫名稱＋係數。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/fin-coef.test.js           # 可用 TEST_URL 指定網址
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
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.route('**', r => {
    const u = r.request().url();
    if (u.startsWith(BASE.replace(/index\.html$/, ''))) return r.continue();
    return r.abort();
  });
  await page.addInitScript(() => {
    window.Plotly = { newPlot() {}, react() {}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null}
      getAllAccounts(){return []} } };
    window.alert = () => {}; window.confirm = () => true;
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0)
    .catch(async e => { console.error('page errors:', errors.slice(0, 5)); throw e; });

  const setTech = (v) => page.evaluate(v => {
    const s = document.getElementById('fin_tech_selector_v2'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);
  const effText = (k) => page.evaluate(k => document.getElementById('fin-eff-' + k).textContent.replace(/\s+/g, ' ').trim(), k);
  const visible = (id) => page.evaluate(id => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0; }, id);

  console.log('\n[A] 出廠預設');
  const a = await page.evaluate(() => {
    const dc = finEffective({ fin_tech_selector_v2: 'Die-casting Fin (0.90)' });
    const emb = finEffective({ fin_tech_selector_v2: 'Embedded Fin (0.95)' });
    return { def: FIN_PROCESS_DEFAULTS, dc, emb };
  });
  ok('Embedded：η_process 1.06、K_FIN 200', a.emb.eta_process === 1.06 && a.emb.k_fin === 200, a.emb);
  ok('Die-casting：η_process 0.99、K_FIN 150（原本 160）', a.dc.eta_process === 0.99 && a.dc.k_fin === 150, a.dc);

  console.log('\n[B] 參數控制台「目前採用」');
  await setTech('Embedded Fin (0.95)');
  const b1 = await effText('emb');
  ok('Embedded 顯示「目前採用 η_process 1.06 預設 · K_FIN 200 W/m·K 預設」',
     /目前採用 η_process 1\.06 ?預設 · K_FIN 200 W\/m·K ?預設/.test(b1), b1);
  ok('自訂框沒打開也看得到（不只在 placeholder 裡）', await visible('fin-eff-emb') && !(await visible('fin-custom-emb-fields')));
  await setTech('Die-casting Fin (0.90)');
  const b2 = await effText('dc');
  ok('Die-casting 顯示 0.99／150', /η_process 0\.99 ?預設 · K_FIN 150 W\/m·K ?預設/.test(b2), b2);
  ok('Die-casting 自訂的 placeholder 也是 150', await page.evaluate(() => document.getElementById('fin_kfin_dc').placeholder) === '預設 150');
  await page.click('#fin_custom_dc');
  await page.fill('#fin_kfin_dc', '120');
  await page.dispatchEvent('#fin_kfin_dc', 'change');
  const b3 = await effText('dc');
  ok('自訂 K_FIN 120、η 留白 → K_FIN 寫「自訂」、η 照樣「預設」', /η_process 0\.99 ?預設 · K_FIN 120 W\/m·K ?自訂/.test(b3), b3);
  const b3k = await page.evaluate(() => calcResults && finEffective(G).k_fin);
  ok('計算用的就是自訂的 120', b3k === 120, b3k);
  await page.click('#fin_custom_dc');
  const b4 = await effText('dc');
  ok('取消自訂 → 回到預設 150', /K_FIN 150 W\/m·K ?預設/.test(b4), b4);

  console.log('\n[C] 製程下拉');
  const c = await page.evaluate(() => [...document.getElementById('fin_tech_selector_v2').options].map(o => [o.value, o.textContent]));
  ok('value 不變（資料庫與別的工具讀它）', c[0][0] === 'Embedded Fin (0.95)' && c[1][0] === 'Die-casting Fin (0.90)', c);
  ok('顯示文字不再帶 (0.95)／(0.90)', c[0][1] === 'Embedded Fin' && c[1][1] === 'Die-casting Fin', c);

  console.log('\n[D] 設計結果 rru_result');
  await setTech('Embedded Fin (0.95)');
  const d1 = await page.evaluate(() => ({ r: rruDesignResult(G, components), R: calcResults, g: { Gap: G.Gap, Fin_t: G.Fin_t, t_base: G.t_base } }));
  ok('可設計 → ok:true、沒有 why', d1.r.ok === true && !('why' in d1.r), d1.r);
  ok('鰭片高、片數、長寬高與 computeAll 同一組',
     Math.abs(d1.r.fin_height - d1.R.Fin_Height) < 1e-3 && d1.r.fin_count === d1.R.Fin_Count &&
     Math.abs(d1.r.L_hsk - d1.R.L_hsk) < 1e-3 && Math.abs(d1.r.W_hsk - d1.R.W_hsk) < 1e-3 && Math.abs(d1.r.H_rru - d1.R.RRU_Height) < 1e-3,
     [d1.r, { FH: d1.R.Fin_Height, n: d1.R.Fin_Count }]);
  ok('air gap、厚度、基板厚與參數控制台相同', d1.r.gap === d1.g.Gap && d1.r.fin_t === d1.g.Fin_t && d1.r.t_base === d1.g.t_base, [d1.r, d1.g]);
  ok('Embedded：K_FIN 200、η_process 1.06、沒有拔模角', d1.r.fin_tech === 'Embedded' && d1.r.k_fin === 200 && d1.r.eta_process === 1.06 && !('draft_deg' in d1.r), d1.r);
  ok('h 與 h_conv＋h_rad 一致、帶 η_fin 與實際熱負載', Math.abs(d1.r.h - (d1.r.h_conv + d1.r.h_rad)) < 2e-3 && d1.r.eta_fin > 0 && d1.r.heat_W > 0, d1.r);
  ok('有時間戳記', typeof d1.r.at === 'string' && !Number.isNaN(Date.parse(d1.r.at)), d1.r.at);
  await setTech('Die-casting Fin (0.90)');
  const d2 = await page.evaluate(() => ({ r: rruDesignResult(G, components), R: calcResults, a: G.Draft_Angle }));
  ok('Die-casting：K_FIN 150、拔模角、T_root／G_root 與 computeAll 相同',
     d2.r.fin_tech === 'Die-casting' && d2.r.k_fin === 150 && d2.r.draft_deg === d2.a &&
     (d2.r.ok ? Math.abs(d2.r.T_root - d2.R.T_root) < 1e-3 && Math.abs(d2.r.G_root - d2.R.G_root) < 1e-3 : true), d2.r);
  await setTech('Embedded Fin (0.95)');
  const d3 = await page.evaluate(() => {
    const comps = JSON.parse(JSON.stringify(components));
    delete comps.rf[0]['Height(mm)'];
    return rruDesignResult(G, comps);
  });
  ok('擋下計算 → ok:false＋原因、沒有鰭片欄位', d3.ok === false && /必填/.test(d3.why || '') && !('fin_height' in d3), d3);

  console.log('\n[E] 存檔欄位與 PDF');
  const e = await page.evaluate(() => ({ f: _buildProjectFields('X', null), txt: finCoefTxt(G), name: finTechName(G) }));
  ok('_buildProjectFields 帶 rru_result', e.f.rru_result && e.f.rru_result.ok === true && e.f.rru_result.fin_count > 0, e.f.rru_result);
  ok('fin_tech_selector_v2 照舊寫 value', e.f.global_params.fin_tech_selector_v2 === 'Embedded Fin (0.95)', e.f.global_params.fin_tech_selector_v2);
  ok('PDF 參數表的係數文字＝名稱＋目前採用', e.name === 'Embedded Fin' && /η_process 1\.06（預設）、K_FIN 200 W\/m·K（預設）/.test(e.txt), e);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
