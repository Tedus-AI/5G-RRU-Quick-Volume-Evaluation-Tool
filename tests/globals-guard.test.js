/**
 * 參數控制台的值不合理 → 擋下計算 —— headless 驗證
 *
 * Code review（2026-11）發現：readGlobals 把清空的欄位當成 0，而且照算 ——
 *   環境溫度清空 → 以 0 °C 計算；Via K 清空 → R_int 直接變 0；安全係數 0 → 鰭片高 0 卻照樣列出體積。
 *   都是偏樂觀、畫面上又看不出來的結果（與「元件欄位沒填就擋下計算」的原則不一致）。
 * 現在 listBadGlobals 檢查，不合理就跟缺必填一樣擋下計算（同一個 calcGateHtml），側欄那一格紅框。
 *
 *   [A] 出廠預設／內建範例不受影響
 *   [B] 環境溫度：清空 → 擋；填 0 → 可以算
 *   [C] 一律要 > 0 的參數（安全係數、PCB 長寬、基板厚、air gap、鰭片厚）
 *   [D] 只在有對應元件時才檢查（Thermal Via → 板厚／Via K／製程係數；Copper Coin → 銅塊尺寸／錫片 K／有效面積率）
 *   [E] 畫面：各頁同一份提示、側欄紅框、點名稱跳到那一格（側欄收合也會打開）
 *   [F] 存檔不會把內部記號寫進 global_params；PDF 拒絕產生並寫出原因
 *
 * 執行：CHROMIUM_PATH=... TEST_URL=http://127.0.0.1:8123/index.html node tests/globals-guard.test.js
 */
const { chromium } = require('playwright');
const BASE = process.env.TEST_URL || 'http://127.0.0.1:8123/index.html';
const EXEC = process.env.CHROMIUM_PATH || '';
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail).slice(0, 700) : '')); } };

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.route('**', r => r.request().url().startsWith(BASE.replace(/index\.html$/, '')) ? r.continue() : r.abort());
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.msal = { PublicClientApplication: class { async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return []} } };
    window.__alerts = []; window.alert = m => window.__alerts.push(String(m)); window.confirm = () => true;
  });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus'); await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0);
  await page.waitForTimeout(300);
  const setVal = (id, v) => page.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); if (typeof recalc === 'function') recalc(); }, [id, v]);
  const state = () => page.evaluate(() => ({ blocked: !!calcResults.blocked, bad: (calcResults.badGlobals || []).map(b => b.key), miss: (calcResults.missing || []).length, V: calcResults.Volume_L, FH: calcResults.Fin_Height,
    banner: document.getElementById('comp-missing-banner').textContent, red: [...document.querySelectorAll('#sidebar input.sb-bad')].map(e => e.id) }));
  const orig = await page.evaluate(() => { const o = {}; document.querySelectorAll('#sidebar input[type=number]').forEach(e => { if (e.id) o[e.id] = e.value; }); return o; });
  const restore = async () => { for (const id of Object.keys(orig)) await page.evaluate(([id, v]) => { document.getElementById(id).value = v; }, [id, orig[id]]); await page.evaluate(() => recalc()); };

  console.log('\n[A] 出廠預設／內建範例');
  const a = await state();
  ok('沒有被擋、有體積、側欄沒有紅框', !a.blocked && a.V > 0 && a.red.length === 0 && a.banner === '', a);

  console.log('\n[B] 環境溫度');
  await setVal('T_amb', '');
  const b1 = await state();
  ok('清空 → 擋下計算（不再當成 0 °C 照算）', b1.blocked && b1.bad.join() === 'T_amb' && !(b1.V > 0), b1);
  ok('元件設定橫幅寫出「參數控制台有 1 個參數」與「環境溫度…未填」', /參數控制台有 1 個參數沒填或不合理/.test(b1.banner) && /環境溫度[^：]*：未填/.test(b1.banner), b1.banner);
  ok('側欄那一格紅框（aria-invalid）', b1.red.join() === 'T_amb' && await page.evaluate(() => document.getElementById('T_amb').getAttribute('aria-invalid') === 'true'), b1.red);
  await setVal('T_amb', '0');
  const b2 = await state();
  ok('填 0 → 可以算（0 °C 是合理的值）、紅框消失', !b2.blocked && b2.V > 0 && b2.red.length === 0, b2);
  await setVal('T_amb', '-10');
  ok('負的環境溫度也可以算', !(await state()).blocked);
  await restore();

  console.log('\n[C] 一律要 > 0');
  for (const id of ['Margin', 'L_pcb', 'W_pcb', 't_base', 'Gap', 'Fin_t']) {
    await setVal(id, '0'); const z = await state();
    await setVal(id, ''); const e = await state();
    ok(`${id}：填 0 與清空都擋下`, z.blocked && z.bad.includes(id) && e.blocked && e.bad.includes(id) && e.red.includes(id), [z.bad, e.bad]);
    await restore();
  }
  ok('還原後恢復計算', !(await state()).blocked);

  console.log('\n[D] 只在有對應元件時才檢查');
  const kinds = await page.evaluate(() => { const all = [].concat(components.rf, components.digital, components.pwr).filter(c => !c._excluded && c.Qty * c['Power(W)'] > 0); return { via: all.filter(c => c.Board_Type === 'Thermal Via').length, coin: all.filter(c => c.Board_Type === 'Copper Coin').length }; });
  ok('範例資料同時有發熱的 Thermal Via 與 Copper Coin 元件', kinds.via > 0 && kinds.coin > 0, kinds);
  for (const id of ['t_PCB', 'K_Via', 'Via_Eff']) { await setVal(id, ''); const s = await state(); ok(`有 Thermal Via 元件：${id} 清空 → 擋下（原本 R_int 會靜默變 0 或無限大）`, s.blocked && s.bad.includes(id), s.bad); await restore(); }
  for (const id of ['Coin_L_Setting', 'Coin_W_Setting', 'Coin_T_Setting', 'K_Solder', 'Voiding']) { await setVal(id, '0'); const s = await state(); ok(`有 Copper Coin 元件：${id} 填 0 → 擋下`, s.blocked && s.bad.includes(id), s.bad); await restore(); }
  await setVal('Voiding', '1.2');
  ok('有效面積率 > 1 → 擋下', (await state()).bad.includes('Voiding'));
  await restore();
  // 把 Thermal Via 元件全部排除 → Via 的參數就不檢查
  await page.evaluate(() => { ['rf', 'digital', 'pwr'].forEach(c => components[c].forEach(x => { if (x.Board_Type === 'Thermal Via') x._excluded = true; })); });
  await setVal('K_Via', '');
  const d1 = await state();
  ok('Thermal Via 元件都排除之後，Via K 清空不擋（用不到）', !d1.blocked && d1.red.length === 0, d1);
  await page.evaluate(() => { ['rf', 'digital', 'pwr'].forEach(c => components[c].forEach(x => { if (x.Board_Type === 'Thermal Via') delete x._excluded; if (x.Board_Type === 'Copper Coin') x._excluded = true; })); });
  await restore(); await setVal('K_Solder', '');
  ok('Copper Coin 元件都排除之後，錫片 K 清空不擋', !(await state()).blocked);
  await page.evaluate(() => { ['rf', 'digital', 'pwr'].forEach(c => components[c].forEach(x => { delete x._excluded; })); });
  await restore();

  console.log('\n[E] 畫面');
  await setVal('Margin', '');
  const e = await page.evaluate(() => { const out = {}; [1, 2, 4].forEach(t => { switchTab(t); if (t === 4 && typeof renderTab4 === 'function') renderTab4(true); const el = document.getElementById('tab' + t); out[t] = /無法計算體積：參數控制台有 1 個參數沒填或不合理/.test(el.textContent) && /設計安全係數/.test(el.textContent); });
    switchTab(0); const kpi = document.body.textContent; return { out, link: !!document.querySelector('#comp-missing-banner a[onclick*="jumpToGlobal"]') }; });
  ok('詳細分析／視覺化報告／敏感度分析都顯示同一份提示', e.out[1] && e.out[2] && e.out[4], e.out);
  await page.evaluate(() => setSidebarCollapsed(true, false));
  await page.evaluate(() => { const t = document.getElementById('Margin').closest('.section-body').previousElementSibling; if (!t.classList.contains('collapsed')) toggleSection(t); });
  await page.click('#comp-missing-banner a[onclick*="jumpToGlobal"]');
  await page.waitForTimeout(150);
  const j = await page.evaluate(() => ({ focus: document.activeElement && document.activeElement.id, collapsed: document.body.classList.contains('sidebar-collapsed'), sec: document.getElementById('Margin').closest('.section-body').classList.contains('collapsed'), vis: document.getElementById('Margin').getClientRects().length > 0 }));
  ok('點參數名稱 → 打開收合的側欄與區段、聚焦那一格', e.link && j.focus === 'Margin' && !j.collapsed && !j.sec && j.vis, j);
  const col = await page.evaluate(() => { document.getElementById('Margin').blur(); const cs = getComputedStyle(document.getElementById('Margin')); return { bg: cs.backgroundColor, bd: cs.borderColor }; });
  ok('紅框：淡紅底＋紅色框線', col.bg === 'rgb(255, 227, 227)' && col.bd === 'rgb(255, 107, 107)', col);

  console.log('\n[F] 存檔與 PDF');
  const f = await page.evaluate(async () => { window.__alerts.length = 0; await generatePDFReport(); const fields = _buildProjectFields('X', null); return { alert: window.__alerts.join('|'), keys: Object.keys(fields.global_params || {}) }; });
  ok('PDF 拒絕產生，寫出是參數控制台的哪個參數', /無法產生報告：參數控制台有 1 個參數/.test(f.alert) && /設計安全係數：須大於 0/.test(f.alert), f.alert);
  ok('存檔的 global_params 沒有內部記號（_emptyIds）', f.keys.length > 20 && !f.keys.some(k => k.startsWith('_')), f.keys.filter(k => k.startsWith('_')));
  await restore();
  ok('還原後恢復計算、提示與紅框都消失', await page.evaluate(() => !calcResults.blocked && document.getElementById('comp-missing-banner').textContent === '' && !document.querySelector('#sidebar input.sb-bad')));

  ok('沒有 JS 錯誤', errors.length === 0, errors);
  await browser.close();
  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('UNEXPECTED:', e); process.exit(1); });
