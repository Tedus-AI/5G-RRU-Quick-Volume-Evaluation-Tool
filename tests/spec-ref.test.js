/*
 * 規格書參照（SpecFile）：AI-Thermal 改成「一顆元件可以有多份」之後的相容性 —— headless 驗證
 * ---------------------------------------------------------------------------
 * AI-Thermal 的 comp.SpecFile 形狀：1 份＝單一物件（舊格式）、≥2 份＝陣列。
 * 本工具不顯示規格書、只原樣保留，但「從資料庫快選」複製元件時一定要把**每一份**
 * 標上 _from（來源專案）—— 漏標的那幾份，AI-Thermal 會以為是本專案自己的檔案，
 * 刪除時就把來源專案的原始檔一起刪掉了。
 *
 * 驗證情境：
 *   [A] specMarkFrom：單一物件與陣列都逐份標；沒有 path 的不動；沒給專案名不動。
 *   [B] 快選一顆有三份規格書的元件 → 三份都帶 _from，且與快選快取不共用參照。
 *   [C] 舊格式（單一物件）行為不變。
 *   [D] carry 白名單仍含 SpecFile（21 項，與 AI-Thermal 的 SG_VARIANT_CARRY 對齊）。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/spec-ref.test.js           # 可用 TEST_URL 指定網址
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
  await page.waitForFunction(() => typeof specMarkFrom === 'function' && typeof addFromVariant === 'function');

  console.log('\n[A] specMarkFrom');
  const a = await page.evaluate(() => {
    const one = { SpecFile: { path: '/a/1', name: '1.pdf' } };
    const many = { SpecFile: [{ path: '/a/1', name: '1.pdf' }, { path: '/a/2', name: '2.pdf' }, { name: '壞資料沒有 path' }] };
    const none = { SpecFile: { path: '/a/9' } };
    specMarkFrom(one, '來源案');
    specMarkFrom(many, '來源案');
    specMarkFrom(none, '');                    // 沒給專案名 → 不動
    specMarkFrom(null, '來源案');              // 不可噴錯
    specMarkFrom({}, '來源案');
    return { one: one.SpecFile._from, many: many.SpecFile.map(s => s._from || null), none: none.SpecFile._from };
  });
  ok('單一物件（舊格式）標得到 _from', a.one === '來源案', a);
  ok('陣列逐份標 _from', a.many[0] === '來源案' && a.many[1] === '來源案', a.many);
  ok('沒有 path 的壞資料不亂標', a.many[2] === null, a.many);
  ok('沒給專案名不動；null／空物件不噴錯', a.none === undefined, a);

  console.log('\n[B] 快選複製：三份規格書都要帶 _from');
  const b = await page.evaluate(() => {
    const projects = { p1: {
      project_name: '來源案', meta: { timestamp: '2026-01-01T00:00:00Z' },
      rf_data: [{ Component: 'Final PA', 'Power(W)': 50, 'Limit(C)': 110, SpecFile: [
        { path: '/SPEC/來源案/RF/PA__d1.pdf', name: 'd1.pdf' },
        { path: '/SPEC/來源案/RF/PA__d2.pdf', name: 'd2.pdf' },
        { path: '/SPEC/來源案/RF/PA__d3.pdf', name: 'd3.pdf' },
      ] }],
    } };
    variantsCache = { rf: aggregateVariants(projects, 'rf'), digital: [], pwr: [] };
    components.rf = [];
    recalc();                                   // 重畫元件表 → 快選下拉才會長出來
    const sel = document.getElementById('lib_sel_rf');
    sel.value = ([...sel.options].find(o => /Final PA/.test(o.textContent)) || {}).value;
    addFromVariant('rf');
    const added = components.rf[0];
    // 動新元件的規格書，不可以動到快選快取（深拷貝）
    added.SpecFile[0].name = '改過了.pdf';
    return {
      isArray: Array.isArray(added.SpecFile),
      n: added.SpecFile.length,
      froms: added.SpecFile.map(s => s._from),
      names: added.SpecFile.map(s => s.name),
      cacheName: variantsCache.rf[0].src.SpecFile[0].name,
      cacheFrom: variantsCache.rf[0].src.SpecFile[0]._from,
      locked: added._ref_locked === true, origin: added._ref_origin_project,
    };
  });
  ok('三份規格書全部帶進來且都標了 _from',
     b.isArray && b.n === 3 && b.froms.join(',') === '來源案,來源案,來源案', b);
  ok('與快選快取不共用參照（深拷貝）', b.cacheName === 'd1.pdf' && b.names[0] === '改過了.pdf', b);
  ok('快取本身不會被標記污染', b.cacheFrom === undefined, b);
  ok('其餘參照欄位照舊（鎖定＋記來源）', b.locked && b.origin === '來源案', b);

  console.log('\n[C] 舊格式（單一份）行為不變');
  const c = await page.evaluate(() => {
    const projects = { p2: {
      project_name: '舊案', meta: { timestamp: '2026-01-01T00:00:00Z' },
      rf_data: [{ Component: 'LNA', 'Power(W)': 3, SpecFile: { path: '/SPEC/舊案/RF/LNA__x.pdf', name: 'x.pdf' } }],
    } };
    variantsCache = { rf: aggregateVariants(projects, 'rf'), digital: [], pwr: [] };
    components.rf = [];
    recalc();
    const sel = document.getElementById('lib_sel_rf');
    sel.value = ([...sel.options].find(o => /LNA/.test(o.textContent)) || {}).value;
    addFromVariant('rf');
    const s = components.rf[0].SpecFile;
    return { isArray: Array.isArray(s), from: s._from, name: s.name };
  });
  ok('單一份仍是單一物件、標得到 _from', c.isArray === false && c.from === '舊案' && c.name === 'x.pdf', c);

  console.log('\n[D] carry 白名單');
  const d = await page.evaluate(() => ({ n: VARIANT_CARRY.length, hasSpec: VARIANT_CARRY.includes('SpecFile') }));
  ok('VARIANT_CARRY 仍含 SpecFile 且為 21 項', d.n === 21 && d.hasSpec, d);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
