/*
 * 快選參照（「↩ 參照自／曾參照自」）：來源改名跟著變、來源不存在就清掉 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 問題 1：快選時元件上抄的是來源專案「當時的名稱」（_ref_origin_project），來源專案之後改名
 *   （兩個工具都只改 project_name、id 不變）→ 還是顯示舊名稱。
 * 問題 2：來源專案被刪、或來源裡已經沒有同名元件（多半是這顆改了名、已經是另一顆料）→ 參照已失效，畫面還寫著。
 * 修正：判斷在兩個工具共用的 CompMerge.refOrigin／refTidy（compMerge.js，與 AI-Thermal 逐字相同）。
 *
 * 驗證情境：
 *   [A] 顯示：參照中／已解除的元件顯示來源目前的名稱，tooltip 寫出快選當時的名稱；
 *       參照失效（同名元件不見、來源專案已刪除）→ 不顯示、瓦數不鎖；沒有參照的元件不受影響
 *   [B] 存檔：換成目前名稱（_ref_origin_project、規格書 _from、_pd_meas_from）；失效的拿掉三個參照標記、瓦數照留；
 *       存檔提示說一聲清掉幾顆；與 AI-Thermal 的修改照常合併、不跳衝突
 *   [C] 專案名單讀不到 → 不判斷失效（照存著的名稱顯示、瓦數照鎖）；存檔時讀不到名單也不清
 *   [D] 存檔前別的工具才改名 → 寫入最新的名稱
 *
 * 執行：
 *   python3 -m http.server 8126 --bind 127.0.0.1 &   # 於 repo 根目錄（或 npx http-server . -p 8126 -c-1）
 *   node tests/ref-origin.test.js                    # 可用 TEST_URL 指定網址、CHROMIUM_PATH 指定瀏覽器
 */
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const BASE = process.env.TEST_URL || 'http://127.0.0.1:8126/index.html';
const EXEC = process.env.CHROMIUM_PATH || '';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const OLD = 'FDD 4T4R 60W';
const FULL = (name, extra) => Object.assign({ Component: name, Qty: 1, 'Power(W)': 10, 'Height(mm)': 300, Pad_L: 8, Pad_W: 8,
  Board_Type: 'Thermal Via', 'Limit(C)': 125, R_jc: 0.5, TIM_Type: 'None' }, extra || {});
const REF = (extra) => Object.assign({ _ref_origin_project: OLD, _ref_origin_id: 'A', _ref_locked: true }, extra || {});
const PROJECTS = () => ({
  // 來源專案：id 不變，名稱已經改過
  A: { project_name: 'FDD B1B3 4T4R 480W', rf_data: [FULL('BTS6201U-PreDriver'), FULL('Circulators'), FULL('WGC18630-Final-B3')],
       digital_data: [], pwr_data: [] },
  X: { project_name: 'FDD B8B20B28 4T4R 480W', global_params: { T_amb: 50 },
       rf_data: [
         FULL('BTS6201U-PreDriver', REF({ 'Power(W)': 1.2, _pd_meas_from: OLD,
           SpecFile: { path: '/SPEC/' + OLD + '/RF/BTS__ds.pdf', name: 'BTS__ds.pdf', _from: OLD } })),
         FULL('Circulators', REF({ 'Power(W)': 2, _ref_locked: false })),                   // 曾參照（已解除）
         FULL('GTRB097152NCV1-Final', REF({ 'Power(W)': 40,                                  // 快選後改名成另一顆料
           SpecFile: { path: '/SPEC/' + OLD + '/RF/WGC__ds.pdf', name: 'WGC__ds.pdf', _from: OLD } })),
         FULL('Old-Driver', REF({ 'Power(W)': 3, _ref_origin_id: 'Z', _ref_origin_project: '已刪除的專案' })),   // 來源專案已刪除
         FULL('Local-LNA', { 'Power(W)': 0.5 }),                                              // 沒有參照
       ],
       digital_data: [], pwr_data: [] },
});

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
  await page.waitForFunction(() => typeof cloudLoadOne === 'function' && typeof refInfoOf === 'function' && calcResults && calcResults.rows.length > 0);

  // 模擬共用 DB（比照 graphDb：getDoc／getCollection 回複本；updateDoc 的 fields 可以是函式，在最新內容上計算）
  const seed = (projects) => page.evaluate((projects) => {
    window.__db = { projects: JSON.parse(JSON.stringify(projects)) };
    window.__collectionFails = false;
    fbOk = true;
    dbAdapter.isReady = () => true;
    dbAdapter.refresh = async () => {};
    dbAdapter.getDoc = async (c, id) => { const d = (window.__db[c] || {})[id]; return d ? JSON.parse(JSON.stringify(d)) : null; };
    dbAdapter.getCollection = async (c) => { if (window.__collectionFails) throw new Error('讀不到'); return JSON.parse(JSON.stringify(window.__db[c] || {})); };
    dbAdapter.getProjectsSorted = async () => Object.entries(window.__db.projects).map(([id, d]) => Object.assign({ id }, d));
    dbAdapter.updateDoc = async (c, id, f) => {
      const cur = window.__db[c][id];
      const ff = typeof f === 'function' ? f(cur ? JSON.parse(JSON.stringify(cur)) : null) : f;
      window.__db[c][id] = Object.assign({}, cur || {}, JSON.parse(JSON.stringify(ff)));
    };
    _ensureLockBeforeWrite = async () => true;
    refProjects = null; variantsCache = null;
    window.__alerts = [];
  }, projects);
  const load = (waitRefs = true) => page.evaluate(async (waitRefs) => {
    await cloudLoadOne('X'); window.__alerts = [];
    if (waitRefs) { renderTab0(); for (let i = 0; i < 60 && !refProjects; i++) await new Promise(r => setTimeout(r, 25)); }
    await new Promise(r => setTimeout(r, 30));
  }, waitRefs);
  const rows = () => page.evaluate(() => [...document.querySelectorAll('#subtab0 .comp-table tbody tr')].map(tr => {
    const name = tr.querySelector('td[data-col="Component"] input');
    const o = tr.querySelector('.ref-origin');
    const pw = tr.querySelector('td[data-col="Power(W)"]');
    return { name: name ? name.value : '', origin: o ? o.textContent.trim() : '', tip: o ? o.getAttribute('title') : '',
             text: tr.querySelector('td[data-col="Component"]').textContent,
             locked: !!(pw && pw.querySelector('span')), input: !!(pw && pw.querySelector('input')) };
  }));
  const row = (list, n) => list.find(r => r.name === n) || {};

  console.log('\n[A] 顯示');
  await seed(PROJECTS()); await load();
  const a = await rows();
  ok('參照中的元件顯示來源目前的名稱、瓦數鎖定', row(a, 'BTS6201U-PreDriver').origin === '↩ 參照自 FDD B1B3 4T4R 480W' && row(a, 'BTS6201U-PreDriver').locked, row(a, 'BTS6201U-PreDriver'));
  ok('tooltip 寫出快選當時的名稱', /快選當時名稱：FDD 4T4R 60W/.test(row(a, 'BTS6201U-PreDriver').tip), row(a, 'BTS6201U-PreDriver').tip);
  ok('已解除參照的也顯示目前名稱', row(a, 'Circulators').origin === '曾參照自 FDD B1B3 4T4R 480W', row(a, 'Circulators'));
  ok('來源裡沒有同名元件 → 不顯示參照、瓦數不鎖（可輸入）',
     row(a, 'GTRB097152NCV1-Final').origin === '' && !/參照自/.test(row(a, 'GTRB097152NCV1-Final').text) &&
     !row(a, 'GTRB097152NCV1-Final').locked && row(a, 'GTRB097152NCV1-Final').input, row(a, 'GTRB097152NCV1-Final'));
  ok('來源專案已刪除 → 一樣不顯示、瓦數不鎖', row(a, 'Old-Driver').origin === '' && !row(a, 'Old-Driver').locked, row(a, 'Old-Driver'));
  ok('沒有參照的元件不受影響', row(a, 'Local-LNA').origin === '' && row(a, 'Local-LNA').input, row(a, 'Local-LNA'));
  const a2 = await page.evaluate(() => ({ kept: components.rf.find(c => c.Component === 'Old-Driver')._ref_origin_id, dirty: projectIsDirty() }));
  ok('只是顯示：資料不動、不算未存修改', a2.kept === 'Z' && a2.dirty === false, a2);

  console.log('\n[B] 存檔');
  await page.evaluate(() => {
    window.__db.projects.X.rf_data.find(c => c.Component === 'Circulators').R_jc = 0.9;   // AI-Thermal 剛存了 Rjc
    components.rf.find(c => c.Component === 'Local-LNA')['Height(mm)'] = 222;            // 我們補了高度
  });
  await page.evaluate(() => cloudSaveProject());
  const b = await page.evaluate(() => ({ db: JSON.parse(JSON.stringify(window.__db.projects.X.rf_data)), alerts: window.__alerts.slice(),
                                          mask: !!document.querySelector('.cm-mask'), dirty: projectIsDirty() }));
  const by = n => b.db.find(c => c.Component === n) || {};
  const noRef = x => !('_ref_origin_project' in x) && !('_ref_origin_id' in x) && !('_ref_locked' in x);
  ok('換成目前名稱（_ref_origin_project、規格書 _from、_pd_meas_from），id／鎖定不動',
     by('BTS6201U-PreDriver')._ref_origin_project === 'FDD B1B3 4T4R 480W' && by('BTS6201U-PreDriver').SpecFile._from === 'FDD B1B3 4T4R 480W' &&
     by('BTS6201U-PreDriver')._pd_meas_from === 'FDD B1B3 4T4R 480W' && by('BTS6201U-PreDriver')._ref_origin_id === 'A' &&
     by('BTS6201U-PreDriver')._ref_locked === true && by('Circulators')._ref_origin_project === 'FDD B1B3 4T4R 480W', by('BTS6201U-PreDriver'));
  ok('規格書路徑不動（實體檔沒有搬）', by('BTS6201U-PreDriver').SpecFile.path === '/SPEC/FDD 4T4R 60W/RF/BTS__ds.pdf');
  ok('來源裡沒有同名元件 → 拿掉三個參照標記、瓦數照留、規格書 _from 照留（刪除保護）',
     noRef(by('GTRB097152NCV1-Final')) && by('GTRB097152NCV1-Final')['Power(W)'] === 40 && by('GTRB097152NCV1-Final').SpecFile._from === 'FDD B1B3 4T4R 480W', by('GTRB097152NCV1-Final'));
  ok('來源專案已刪除 → 拿掉三個參照標記、瓦數照留', noRef(by('Old-Driver')) && by('Old-Driver')['Power(W)'] === 3, by('Old-Driver'));
  ok('沒有參照的元件不動', noRef(by('Local-LNA')) && by('Local-LNA')['Height(mm)'] === 222, by('Local-LNA'));
  ok('與 AI-Thermal 的修改照常合併（Rjc 保留）、不跳衝突', by('Circulators').R_jc === 0.9 && !b.mask, by('Circulators'));
  ok('存檔提示說一聲清掉幾顆失效參照', b.alerts.length === 1 && /已儲存/.test(b.alerts[0]) && /清掉 2 顆元件的失效參照/.test(b.alerts[0]), b.alerts);
  ok('存完畫面換成寫入的內容、沒有未存修改', b.dirty === false);

  console.log('\n[C] 專案名單讀不到 → 不判斷失效');
  await seed(PROJECTS());
  await page.evaluate(() => { window.__collectionFails = true; });   // 快選快取讀專案名單失敗
  await load(false);
  const c = await rows();
  ok('照存著的名稱顯示、瓦數照鎖（不在不確定時拿掉參照）',
     row(c, 'Old-Driver').origin === '↩ 參照自 已刪除的專案' && row(c, 'Old-Driver').locked &&
     row(c, 'BTS6201U-PreDriver').origin === '↩ 參照自 FDD 4T4R 60W', [row(c, 'Old-Driver'), row(c, 'BTS6201U-PreDriver')]);
  await page.evaluate(async () => { await cloudSaveProject(); });
  const c2 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__db.projects.X.rf_data.find(x => x.Component === 'Old-Driver'))));
  ok('存檔時也讀不到名單 → 參照標記不動', c2._ref_origin_id === 'Z' && c2._ref_origin_project === '已刪除的專案' && c2._ref_locked === true, c2);

  console.log('\n[D] 存檔前別的工具才改名 → 寫入最新名稱');
  await seed(PROJECTS()); await load();
  await page.evaluate(async () => { window.__db.projects.A.project_name = 'AI-Thermal 剛改的名字'; await cloudSaveProject(); });
  const d = await page.evaluate(() => ({ db: window.__db.projects.X.rf_data.find(x => x.Component === 'BTS6201U-PreDriver')._ref_origin_project,
    shown: [...document.querySelectorAll('#subtab0 .ref-origin')].map(x => x.textContent.trim()) }));
  ok('寫入最新的名稱，畫面也換掉', d.db === 'AI-Thermal 剛改的名字' && d.shown.includes('↩ 參照自 AI-Thermal 剛改的名字'), d);

  ok('沒有 JS 錯誤', errors.length === 0, errors);
  await browser.close();
  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
