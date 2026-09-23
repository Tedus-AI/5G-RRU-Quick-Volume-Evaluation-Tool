/*
 * 熱阻 Rjc 鎖定（AI-Thermal 推導值不開放在此修改）—— headless 驗證
 * ---------------------------------------------------------------------------
 * 熱阻是規格書給的值，單一事實來源在 AI-Thermal 的熱阻表（θJC）。在 5G-RRU 改它
 * 只會被下次存檔覆寫，還讓兩邊數字對不起來 → 有來源標記（_rjc_from）就鎖成純參照值。
 *
 * 驗證情境：
 *   [A] 有 _rjc_from → 沒有輸入框，顯示為白底黑字純文字（不用反灰 disabled input），
 *       數值與 R_jc 一致，tooltip 寫出來源 θ 型別、量測條件與「要改請到 AI-Thermal」。
 *   [B] 沒有 _rjc_from（本工具自己新增／AI-Thermal 沒推導過）→ 維持可輸入。
 *   [C] 鎖定不影響計算：Tj = Tc + P×R_jc 仍吃得到值；重繪／recalc 後仍是鎖的。
 *   [D] 排除計算（隱藏）的列、複製出來的列都維持鎖定；「從資料庫快選」帶不走內部標記
 *       → 快選出來的新元件可自行輸入（標記不在 carry 白名單，屬預期行為）。
 *   [E] 圖例文案與實際行為一致（Rjc 寫「鎖定」，可編輯的推導欄位才寫「會被覆寫」）。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/rjc-lock.test.js           # 可用 TEST_URL 指定網址
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
  await page.setViewportSize({ width: 1500, height: 950 });
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

  // rf[0] = AI-Thermal 推導（含量測條件）、rf[1] = 沒有來源標記
  const h0 = await page.evaluate(() =>
    Math.round(document.querySelector('#subtab0 table.comp-table tbody tr').getBoundingClientRect().height));
  await page.evaluate(() => {
    const a = components.rf[0], b = components.rf[1];
    a.R_jc = 0.35; a._rjc_from = 'JC_bot';
    a.Rth = [{ type: 'JC_bot', value: 0.35, cond: '@85°C 冷板', primary: true },
             { type: 'JA', value: 12.5, cond: '' }];
    delete b._rjc_from; delete b.Rth; b.R_jc = 1.7;
    recalc();
  });

  console.log('\n[A] AI-Thermal 推導的 Rjc → 鎖定的純參照值');
  const a = await page.evaluate(() => {
    const td = document.querySelector('#subtab0 table.comp-table tbody tr td[data-col="R_jc"]');
    const ref = td.querySelector('.rjc-ref');
    const cs = ref ? getComputedStyle(ref) : null;
    return {
      hasInput: !!td.querySelector('input'),
      hasSelect: !!td.querySelector('select'),
      editable: !!td.querySelector('[contenteditable="true"]'),
      text: ref ? ref.textContent.replace(/\s/g, '') : '',
      title: ref ? ref.getAttribute('title') : '',
      bg: cs ? cs.backgroundColor : '', color: cs ? cs.color : '',
      opacity: cs ? cs.opacity : '', cursor: cs ? cs.cursor : '',
      borderLeft: cs ? cs.borderLeftWidth + ' ' + cs.borderLeftColor : '',
    };
  });
  ok('沒有輸入框／下拉／可編輯區塊（改不動）', !a.hasInput && !a.hasSelect && !a.editable, a);
  ok('顯示的數值就是 R_jc（0.35）', /^0\.35/.test(a.text), a.text);
  ok('白底黑字純文字，不是反灰 disabled input',
     a.bg === 'rgb(255, 255, 255)' && a.color === 'rgb(17, 24, 39)' && a.opacity === '1', a);
  ok('保留 AI-Thermal 推導的藍邊識別（3px #0550ae）',
     parseFloat(a.borderLeft) >= 3 && /rgb\(5, 80, 174\)/.test(a.borderLeft), a.borderLeft);
  ok('滑鼠指標是 help（看得出可看說明）', a.cursor === 'help', a.cursor);
  ok('tooltip 寫出來源 θ 型別', /θJC,bottom/.test(a.title), a.title);
  ok('tooltip 帶出量測條件（讀 AI-Thermal 寫的 Rth）', /@85°C 冷板/.test(a.title), a.title);
  ok('tooltip 指路到 AI-Thermal 的熱阻表，並寫明依主散熱路徑取用哪一筆', /AI-Thermal/.test(a.title) && /依主散熱路徑取用/.test(a.title), a.title);

  // 窄欄換行會把整列撐高（行內圖示踩過這個坑）→ 同一列鎖定前後必須等高
  const aH = await page.evaluate(() => {
    const tr = document.querySelector('#subtab0 table.comp-table tbody tr');
    const ref = tr.querySelector('td[data-col="R_jc"] .rjc-ref');
    return { h: Math.round(tr.getBoundingClientRect().height),
             lines: ref ? Math.round(ref.getBoundingClientRect().height) : 0,
             nowrap: ref ? getComputedStyle(ref).whiteSpace : '' };
  });
  ok('鎖定沒有把列撐高（' + h0 + ' → ' + aH.h + 'px）', Math.abs(aH.h - h0) < 1.5, { h0, aH });
  ok('數值與 🔒 同一行（nowrap，高度 < 30px）', aH.nowrap === 'nowrap' && aH.lines < 30, aH);

  console.log('\n[B] 沒有推導標記 → 仍可自行輸入');
  const b = await page.evaluate(async () => {
    const td = document.querySelectorAll('#subtab0 table.comp-table tbody tr')[1].querySelector('td[data-col="R_jc"]');
    const inp = td.querySelector('input');
    if (!inp) return { hasInput: false };
    inp.value = '2.4';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return { hasInput: true, locked: !!td.querySelector('.rjc-ref'), stored: components.rf[1].R_jc };
  });
  ok('可輸入且改得動（2.4 寫進元件）', b.hasInput && b.stored === 2.4 && !b.locked, b);

  // 標記還在、值卻不見了（例：被清掉）→ 不可把一個空值鎖起來讓人改不了（Rjc 是必填）
  const b2 = await page.evaluate(() => {
    const c = components.rf[1];
    c._rjc_from = 'JC_bot'; delete c.R_jc; recalc();
    const td = document.querySelectorAll('#subtab0 table.comp-table tbody tr')[1].querySelector('td[data-col="R_jc"]');
    const inp = td.querySelector('input');
    const r = { locked: !!td.querySelector('.rjc-ref'), hasInput: !!inp,
                missing: !!(inp && inp.classList.contains('cell-missing')), blocked: !!calcResults.blocked };
    delete c._rjc_from; c.R_jc = 2.4; recalc();     // 還原給後面的情境用
    return r;
  });
  ok('有標記但值是空的 → 可輸入＋紅框必填、計算被擋（不鎖成空值）',
     !b2.locked && b2.hasInput && b2.missing && b2.blocked, b2);

  console.log('\n[C] 鎖定不影響計算');
  const c = await page.evaluate(() => {
    const row = calcResults.rows.find(r => r.Component === components.rf[0].Component);
    return { rjc: row.R_jc, tj: row.Tj, tc: row.Tc, p: row['Power(W)'],
             expect: row.Tc + row['Power(W)'] * 0.35 };
  });
  ok('Rjc 仍進 Tj = Tc + P×R_jc', c.rjc === 0.35 && near(c.tj, c.expect, 1e-9), c);

  const c2 = await page.evaluate(() => {
    recalc(); recalc();
    const td = document.querySelector('#subtab0 table.comp-table tbody tr td[data-col="R_jc"]');
    return { stillLocked: !!td.querySelector('.rjc-ref') && !td.querySelector('input') };
  });
  ok('重繪／recalc 後仍是鎖的', c2.stillLocked, c2);

  console.log('\n[D] 隱藏列／複製／快選');
  const d1 = await page.evaluate(() => {
    toggleComp('rf', 0);            // 排除計算
    const td = document.querySelector('#subtab0 table.comp-table tbody tr td[data-col="R_jc"]');
    const r = { locked: !!td.querySelector('.rjc-ref'), input: !!td.querySelector('input') };
    toggleComp('rf', 0);            // 還原
    return r;
  });
  ok('排除計算的列也維持鎖定（不會冒出輸入框）', d1.locked && !d1.input, d1);

  const d2 = await page.evaluate(() => {
    const before = components.rf.length;
    copyComp('rf', 0);
    const copy = components.rf[components.rf.length - 1];
    const tds = document.querySelectorAll('#subtab0 table.comp-table tbody tr');
    const lastTd = tds[tds.length - 1].querySelector('td[data-col="R_jc"]');
    const r = { added: components.rf.length === before + 1, carried: copy._rjc_from,
                locked: !!lastTd.querySelector('.rjc-ref') };
    removeComp('rf', components.rf.length - 1);
    return r;
  });
  ok('📋 複製同一顆元件 → 沿用規格書值，維持鎖定', d2.added && d2.carried === 'JC_bot' && d2.locked, d2);

  const d3 = await page.evaluate(() => {
    const src = { Component: 'FromLib', 'Power(W)': 10, R_jc: 0.9, _rjc_from: 'JC_bot' };
    const carried = carrySrc(src);
    return { hasMark: Object.prototype.hasOwnProperty.call(carried, '_rjc_from'), rjc: carried.R_jc };
  });
  ok('「從資料庫快選」不帶內部來源標記（快選出來的可自行輸入）', d3.hasMark === false && d3.rjc === 0.9, d3);

  console.log('\n[E] 圖例文案與行為一致');
  const e = await page.evaluate(() => {
    const el = document.querySelector('#subtab0 .derived-legend');
    return el ? el.textContent : '';
  });
  ok('圖例寫明 Rjc 鎖定、其餘推導欄位會被覆寫',
     /Rjc/.test(e) && /鎖定/.test(e) && /會被覆寫/.test(e) && /熱阻/.test(e), e.slice(0, 120));

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
