/*
 * 存檔三方合併＋切回分頁自動重載 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 標準流程：AI-Thermal 先建資料 → 5G-RRU 讀同一個專案算體積；使用者會在兩個工具之間來回補欄位。
 * 兩個工具存檔時都把整份元件清單寫回共用 DB，原本後存的一方會把對方剛存的修改整批蓋掉。
 *
 * 驗證情境（模擬 DB 的行為與真的後端一致：updateDoc 的 fields 可以是函式、會在最新內容上重算）：
 *   [A] 標準流程：載入 → AI-Thermal 補了 Rjc／導熱方式並存檔 → 5G-RRU 補高度存檔 → 兩邊的修改都在。
 *   [B] 兩邊改到同一格 → 存檔前跳衝突視窗（列出元件、欄位、兩邊的值與載入時的值），全部選完才能存；
 *       選「用資料庫的」／「用我的」都照選擇寫入；按「取消」→ 不寫入、畫面不動。
 *   [C] AI-Thermal 改了專案名稱、5G-RRU 沒改 → 存檔保留新名稱（不被舊名稱蓋回去）。
 *   [D] 對方新增的元件保留、對方刪除且我沒動的元件刪除。
 *   [E] 寫入途中資料庫又被改（樂觀並發重算）→ 重算後出現衝突一樣會問。
 *   [F] 切回分頁：畫面沒有未存修改 → 自動重新載入並提示；有未存修改 → 不動畫面、跳琥珀色提示，
 *       按「放棄我的修改，重新載入」才重載。
 *   [G] 元件 id：載入補發、存檔寫出、📋 複製給新 id、新增元件有 id。
 *   [H] 真的後端（graphDb／fileDb）：getDoc 回複本、updateDoc 接受函式且先算完才動快取、
 *       讀取禁用快取＋5xx 重試、第一次讀到空內容但檔案不是 0 bytes → 唯讀保護。
 *   [I] 元件改名 → 標 `_renamed_from`（AI-Thermal 以名稱當 key 的資料還掛在哪個名稱底下）：
 *       改名存檔標舊名稱；再改一次仍指向最早的名稱；改回原名不標；AI-Thermal 已經搬過（清掉標記）後
 *       再改名，標的是搬過去的那個名稱（不是載入時的舊標記）；資料庫舊資料沒有元件 id 時用載入時的名稱對；
 *       新專案／複製專案／📋 複製元件不帶標記；沒改名的元件不標。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/merge-save.test.js
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

const FULL = (name, extra) => Object.assign({ Component: name, Qty: 1, 'Power(W)': 10, 'Height(mm)': 300, Pad_L: 8, Pad_W: 8,
  Board_Type: 'Thermal Via', 'Limit(C)': 125, R_jc: 0.5, TIM_Type: 'None' }, extra || {});
const PROJ = {
  project_name: 'X 案', global_params: { T_amb: 50 }, thermal_specs: { PA: { heatDirection: 'IC top' } },
  rf_data: [FULL('PA', { 'Power(W)': 30, R_jc: 0.4 }), FULL('Driver', { 'Power(W)': 5 })],
  digital_data: [FULL('FPGA', { 'Power(W)': 20 })],
  pwr_data: [FULL('PSU', { Board_Type: 'None', Pad_L: 0, Pad_W: 0 })],
};

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1500, height: 950 });
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
  await page.waitForFunction(() => typeof cloudLoadOne === 'function' && calcResults && calcResults.rows.length > 0);

  // 模擬共用 DB（行為比照 graphDb）：getDoc 回複本；updateDoc 的 fields 可以是函式，在最新內容上計算；
  // window.__interfere 可在「第一次計算之後、寫入之前」插入別人的寫入（模擬 412 → 重讀重算）。
  const seed = (proj) => page.evaluate((proj) => {
    window.__db = { projects: { X: JSON.parse(JSON.stringify(proj)), OTHER: { project_name: '別的專案', rf_data: [] } } };
    window.__writes = []; window.__interfere = null;
    fbOk = true;
    dbAdapter.isReady = () => true;
    dbAdapter.refresh = async () => { window.__refreshes = (window.__refreshes || 0) + 1; };
    dbAdapter.getDoc = async (c, id) => { const d = (window.__db[c] || {})[id]; return d ? JSON.parse(JSON.stringify(d)) : null; };
    dbAdapter.getCollection = async (c) => JSON.parse(JSON.stringify(window.__db[c] || {}));
    dbAdapter.getProjectsSorted = async () => Object.entries(window.__db.projects).map(([id, d]) => Object.assign({ id }, d));
    dbAdapter.updateDoc = async (c, id, f) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const cur = window.__db[c][id];
        const ff = typeof f === 'function' ? f(cur ? JSON.parse(JSON.stringify(cur)) : null) : f;
        if (window.__interfere) { const fn = window.__interfere; window.__interfere = null; fn(window.__db); continue; }
        window.__writes.push({ id, f: JSON.parse(JSON.stringify(ff)) });
        window.__db[c][id] = Object.assign({}, cur || {}, JSON.parse(JSON.stringify(ff)));
        return;
      }
      throw new Error('too many retries');
    };
    _ensureLockBeforeWrite = async () => true;
    window.__alerts = [];
  }, proj);
  const load = () => page.evaluate(async () => { await cloudLoadOne('X'); window.__alerts = []; });
  const other = (fn) => page.evaluate(fn);           // 模擬 AI-Thermal 在我們載入之後存檔（直接改 DB）
  const db = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__db.projects.X)));
  const by = (list, n) => (list || []).find(c => c.Component === n);

  console.log('\n[A] 標準流程：AI-Thermal 補 Rjc／導熱方式、5G-RRU 補高度 → 兩邊都在');
  await seed(PROJ); await load();
  await other(() => { const d = window.__db.projects.X.rf_data.find(c => c.Component === 'Driver');
                      Object.assign(d, { R_jc: 0.8, _rjc_from: 'JC_bot', Board_Type: 'Copper Coin', _bt_from: 'heatDirection' }); });
  const a = await page.evaluate(async () => {
    components.rf.find(c => c.Component === 'Driver')['Height(mm)'] = 222;
    await cloudSaveProject();
    return { alerts: window.__alerts.slice(), mask: !!document.querySelector('.cm-mask'),
             screen: JSON.parse(JSON.stringify(components.rf.find(c => c.Component === 'Driver'))) };
  });
  const adb = await db();
  const drv = by(adb.rf_data, 'Driver');
  ok('AI-Thermal 存的 Rjc／導熱方式沒有被 5G-RRU 的舊副本蓋掉', drv.R_jc === 0.8 && drv._rjc_from === 'JC_bot' && drv.Board_Type === 'Copper Coin', drv);
  ok('5G-RRU 補的高度也寫進去', drv['Height(mm)'] === 222, drv);
  ok('沒有衝突 → 不跳視窗', !a.mask);
  ok('存檔提示寫出合併了幾項', a.alerts.length === 1 && /已儲存/.test(a.alerts[0]) && /已合併：併入資料庫最新的 2 項修改/.test(a.alerts[0]), a.alerts);
  ok('畫面換成合併後的內容（看得到 AI-Thermal 的 Rjc，板厚依新導熱方式重新帶入）',
     a.screen.R_jc === 0.8 && a.screen.Board_Type === 'Copper Coin' && a.screen['Thick(mm)'] === drv['Thick(mm)'], { screen: a.screen, db: drv });
  ok('其他工具的欄位（thermal_specs）保留', !!adb.thermal_specs && adb.thermal_specs.PA.heatDirection === 'IC top');
  ok('寫出去的每顆元件都有 _cid', ['rf_data', 'digital_data', 'pwr_data'].every(f => adb[f].every(c => typeof c._cid === 'string' && c._cid)));

  console.log('\n[B] 兩邊改到同一格 → 存檔前讓使用者選');
  await seed(PROJ); await load();
  await other(() => { window.__db.projects.X.rf_data.find(c => c.Component === 'PA')['Power(W)'] = 35; });
  await page.evaluate(() => { components.rf.find(c => c.Component === 'PA')['Power(W)'] = 28;
                              window.__saveP = cloudSaveProject(); });
  await page.waitForSelector('.cm-mask', { timeout: 5000 });
  const b1 = await page.evaluate(() => {
    const m = document.querySelector('.cm-mask');
    const row = m.querySelector('tbody tr');
    return { rows: m.querySelectorAll('tbody tr').length, text: row.textContent.replace(/\s+/g, ' '),
             okDisabled: m.querySelector('[data-act="ok"]').disabled, writes: window.__writes.length,
             title: m.querySelector('.cm-title').textContent };
  });
  ok('衝突視窗列出 1 列：元件 PA、瓦數、我的 28、資料庫的 35、載入時 30',
     b1.rows === 1 && /PA/.test(b1.text) && /瓦數/.test(b1.text) && /28/.test(b1.text) && /35/.test(b1.text) && /載入時：30/.test(b1.text), b1);
  ok('還沒選之前不能按「確定儲存」、也還沒寫入', b1.okDisabled && b1.writes === 0, b1);
  ok('標題說明是被別人更新了（可能是 AI-Thermal）', /AI-Thermal/.test(b1.title), b1.title);
  await page.click('.cm-opt[data-side="theirs"]');
  await page.click('[data-act="ok"]');
  await page.evaluate(() => window.__saveP);
  const b2 = await page.evaluate(() => ({ db: window.__db.projects.X.rf_data.find(c => c.Component === 'PA')['Power(W)'],
    screen: components.rf.find(c => c.Component === 'PA')['Power(W)'], mask: !!document.querySelector('.cm-mask'),
    alert: window.__alerts.slice(-1)[0] }));
  ok('選「用資料庫的」→ 寫入 35，畫面也變 35', b2.db === 35 && b2.screen === 35 && !b2.mask, b2);
  ok('存檔提示提到你選擇的衝突', /你選擇的 1 項衝突/.test(b2.alert || ''), b2.alert);

  await seed(PROJ); await load();
  await other(() => { window.__db.projects.X.rf_data.find(c => c.Component === 'PA')['Power(W)'] = 35; });
  await page.evaluate(() => { components.rf.find(c => c.Component === 'PA')['Power(W)'] = 28; window.__saveP = cloudSaveProject(); });
  await page.waitForSelector('.cm-mask');
  await page.click('[data-bulk="mine"]');
  await page.click('[data-act="ok"]');
  await page.evaluate(() => window.__saveP);
  ok('「全部用我的」→ 寫入 28', (await db()).rf_data.find(c => c.Component === 'PA')['Power(W)'] === 28);

  await seed(PROJ); await load();
  await other(() => { window.__db.projects.X.rf_data.find(c => c.Component === 'PA')['Power(W)'] = 35; });
  await page.evaluate(() => { components.rf.find(c => c.Component === 'PA')['Power(W)'] = 28; window.__saveP = cloudSaveProject(); });
  await page.waitForSelector('.cm-mask');
  await page.click('[data-act="cancel"]');
  await page.evaluate(() => window.__saveP);
  const b3 = await page.evaluate(() => ({ writes: window.__writes.length, db: window.__db.projects.X.rf_data.find(c => c.Component === 'PA')['Power(W)'],
    screen: components.rf.find(c => c.Component === 'PA')['Power(W)'], mask: !!document.querySelector('.cm-mask'), alerts: window.__alerts.length }));
  ok('按「取消」→ 不寫入、資料庫維持 35、畫面維持我的 28、不跳成功提示', b3.writes === 0 && b3.db === 35 && b3.screen === 28 && !b3.mask && b3.alerts === 0, b3);

  console.log('\n[C] AI-Thermal 改了專案名稱 → 5G-RRU 存檔不會蓋回舊名稱');
  await seed(PROJ); await load();
  await other(() => { window.__db.projects.X.project_name = 'X 案（AI-Thermal 改名）'; });
  await page.evaluate(async () => { components.rf[0]['Height(mm)'] = 111; await cloudSaveProject(); });
  const c = await page.evaluate(() => ({ db: window.__db.projects.X.project_name, head: document.getElementById('projNameText').textContent, id: currentProjectId }));
  ok('資料庫保留新名稱、頂排也換成新名稱、id 不變', c.db === 'X 案（AI-Thermal 改名）' && c.head.includes('AI-Thermal 改名') && c.id === 'X', c);

  console.log('\n[D] 對方新增／刪除的元件');
  await seed(PROJ); await load();
  await other(() => { const X = window.__db.projects.X;
    X.rf_data.push({ Component: 'LNA', Qty: 1, 'Power(W)': 0.5, _cid: 'fromAT' });
    X.pwr_data = []; });                                  // AI-Thermal 刪掉 PSU（5G-RRU 沒動它）
  await page.evaluate(async () => { components.digital[0]['Height(mm)'] = 77; await cloudSaveProject(); });
  const dd = await db();
  ok('對方新增的 LNA 保留（接在後面）', dd.rf_data.map(x => x.Component).join() === 'PA,Driver,LNA' && by(dd.rf_data, 'LNA')._cid === 'fromAT', dd.rf_data.map(x => x.Component));
  ok('對方刪除、我沒動的 PSU → 刪除', dd.pwr_data.length === 0, dd.pwr_data);
  ok('我改的 FPGA 高度照樣寫入', dd.digital_data[0]['Height(mm)'] === 77);

  console.log('\n[E] 寫入途中資料庫又被改 → 重算後有衝突一樣會問');
  await seed(PROJ); await load();
  await page.evaluate(() => {
    components.rf.find(c => c.Component === 'PA')['Power(W)'] = 28;
    window.__interfere = (db) => { db.projects.X.rf_data.find(c => c.Component === 'PA')['Power(W)'] = 40; };
    window.__saveP = cloudSaveProject();
  });
  await page.waitForSelector('.cm-mask', { timeout: 5000 });
  const e1 = await page.evaluate(() => document.querySelector('.cm-mask tbody tr').textContent.replace(/\s+/g, ' '));
  ok('第一次計算時沒衝突，別人搶先寫入後重算 → 跳出衝突（資料庫的 40）', /40/.test(e1) && /28/.test(e1), e1);
  await page.click('.cm-opt[data-side="mine"]');
  await page.click('[data-act="ok"]');
  await page.evaluate(() => window.__saveP);
  ok('選「用我的」→ 28', (await db()).rf_data.find(x => x.Component === 'PA')['Power(W)'] === 28);

  console.log('\n[F] 切回分頁：自動重載／有未存修改時提示');
  await seed(PROJ); await load();
  await other(() => { window.__db.projects.X.rf_data.find(c => c.Component === 'Driver').R_jc = 0.66; });
  const f1 = await page.evaluate(async () => {
    window.__alerts = [];
    await checkProjectFreshness(true);
    const t = document.getElementById('cm-toast');
    return { rjc: components.rf.find(c => c.Component === 'Driver').R_jc, alerts: window.__alerts.length,
             toast: t ? t.textContent : '', banner: document.getElementById('stale-banner').textContent };
  });
  ok('沒有未存修改 → 自動載入最新資料（Rjc 0.66）、不跳 alert、給一行提示', f1.rjc === 0.66 && f1.alerts === 0 && /已載入最新資料/.test(f1.toast) && !f1.banner, f1);
  await other(() => { window.__db.projects.X.rf_data.find(c => c.Component === 'Driver').R_jc = 0.77; });
  const f2 = await page.evaluate(async () => {
    components.rf.find(c => c.Component === 'PA')['Height(mm)'] = 123;      // 未存修改
    await checkProjectFreshness(true);
    return { rjc: components.rf.find(c => c.Component === 'Driver').R_jc, h: components.rf.find(c => c.Component === 'PA')['Height(mm)'],
             banner: document.getElementById('stale-banner').textContent };
  });
  ok('有未存修改 → 不動畫面（我的 123 還在），跳琥珀色提示說明存檔會合併', f2.rjc === 0.66 && f2.h === 123 && /已在資料庫被更新/.test(f2.banner) && /自動合併/.test(f2.banner), f2);
  const f3 = await page.evaluate(async () => {
    await cloudSaveProject();
    const d = window.__db.projects.X.rf_data;
    return { rjc: d.find(c => c.Component === 'Driver').R_jc, h: d.find(c => c.Component === 'PA')['Height(mm)'],
             banner: document.getElementById('stale-banner').textContent };
  });
  ok('接著存檔 → 我的 123 與對方的 0.77 都寫入，提示消失', f3.rjc === 0.77 && f3.h === 123 && !f3.banner, f3);
  await other(() => { window.__db.projects.X.rf_data.find(c => c.Component === 'Driver').R_jc = 0.88; });
  const f4 = await page.evaluate(async () => {
    components.rf.find(c => c.Component === 'PA')['Height(mm)'] = 124;
    await checkProjectFreshness(true);
    const btn = [...document.querySelectorAll('#stale-banner button')].find(b => /重新載入/.test(b.textContent));
    btn.click();
    await new Promise(r => setTimeout(r, 200));
    return { rjc: components.rf.find(c => c.Component === 'Driver').R_jc, h: components.rf.find(c => c.Component === 'PA')['Height(mm)'] };
  });
  ok('按「放棄我的修改，重新載入」→ 載入資料庫最新內容', f4.rjc === 0.88 && f4.h === 123, f4);
  const f5 = await page.evaluate(async () => {
    window.__refreshes = 0;
    await checkProjectFreshness();            // 剛檢查過 → 節流，不重讀
    const n1 = window.__refreshes;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 50));
    return { n1, n2: window.__refreshes };
  });
  ok('15 秒內重複切換分頁不會一直重讀檔（節流）', f5.n1 === 0 && f5.n2 === 0, f5);

  console.log('\n[G] 元件 id');
  await seed(PROJ); await load();
  const g = await page.evaluate(() => {
    const ids = ['rf', 'digital', 'pwr'].flatMap(cat => components[cat].map(c => c._cid));
    copyComp('rf', 0); addComp('rf');
    const n = components.rf.length;
    return { allHave: ids.every(x => typeof x === 'string' && x), unique: new Set(ids).size === ids.length,
             copyNew: components.rf[n - 2]._cid && components.rf[n - 2]._cid !== components.rf[0]._cid, addHas: !!components.rf[n - 1]._cid };
  });
  ok('載入時補發 id，每顆都有且不重複', g.allHave && g.unique, g);
  ok('📋 複製出來的元件給新 id、新增的元件也有 id', g.copyNew && g.addHas, g);

  console.log('\n[I] 元件改名 → 標 _renamed_from 給 AI-Thermal 搬資料');
  const rename = (from, to) => page.evaluate(([from, to]) => {
    const i = components.rf.findIndex(c => c.Component === from); updateComp('rf', i, 'Component', to); }, [from, to]);
  const save = () => page.evaluate(async () => { await cloudSaveProject(); });
  await seed(PROJ); await load();
  await rename('Driver', 'Driver_v2'); await save();
  let idb = await db();
  ok('改名存檔 → 標上資料庫裡原本的名稱', by(idb.rf_data, 'Driver_v2') && by(idb.rf_data, 'Driver_v2')._renamed_from === 'Driver', idb.rf_data.map(c => [c.Component, c._renamed_from]));
  ok('沒改名的元件不標', !('_renamed_from' in by(idb.rf_data, 'PA')) && idb.digital_data.every(c => !('_renamed_from' in c)));
  await rename('Driver_v2', 'Driver_v3'); await save();
  idb = await db();
  ok('AI-Thermal 還沒搬之前再改一次 → 仍指向最早的名稱（資料還掛在那裡）', by(idb.rf_data, 'Driver_v3')._renamed_from === 'Driver', by(idb.rf_data, 'Driver_v3'));
  await rename('Driver_v3', 'Driver'); await save();
  idb = await db();
  ok('改回原名 → 不標（不用搬）', by(idb.rf_data, 'Driver') && !('_renamed_from' in by(idb.rf_data, 'Driver')), by(idb.rf_data, 'Driver'));

  // AI-Thermal 在我們載入之後已經搬過一次、清掉了標記 → 我們手上還是舊標記，再改名時要以資料庫為準
  await seed(PROJ); await load();
  await rename('Driver', 'Driver_v2'); await save();
  await other(() => { const d = window.__db.projects.X.rf_data.find(c => c.Component === 'Driver_v2'); delete d._renamed_from; });
  ok('（前提）畫面上還留著舊標記', await page.evaluate(() => components.rf.find(c => c.Component === 'Driver_v2')._renamed_from === 'Driver'));
  await rename('Driver_v2', 'Driver_v3'); await save();
  idb = await db();
  ok('AI-Thermal 搬過之後再改名 → 標的是搬過去的名稱 Driver_v2，不是載入時的舊標記', by(idb.rf_data, 'Driver_v3')._renamed_from === 'Driver_v2', by(idb.rf_data, 'Driver_v3'));

  // 資料庫的舊資料還沒有元件 id（兩個工具都還沒存過）→ 用載入時的名稱對到資料庫那一顆
  await seed(PROJ); await load();
  await rename('Driver', 'Driver_new'); await save();
  idb = await db();
  ok('舊資料沒有元件 id：一樣標得出原本的名稱', by(idb.rf_data, 'Driver_new') && by(idb.rf_data, 'Driver_new')._renamed_from === 'Driver', idb.rf_data.map(c => [c.Component, c._renamed_from, !!c._cid]));

  const i2 = await page.evaluate(async () => {
    const i = components.rf.findIndex(c => c.Component === 'Driver_new');
    copyComp('rf', i);
    const cp = components.rf[components.rf.length - 1];
    return { copyMark: '_renamed_from' in cp, srcMark: components.rf[i]._renamed_from };
  });
  ok('📋 複製元件：複本是新的一顆，不帶改名標記（原本那顆保留）', !i2.copyMark && i2.srcMark === 'Driver', i2);
  await page.evaluate(async () => { document.getElementById('copyProjectName').value = 'X 案 複本'; await confirmCopyProject(); });
  const cpy = await page.evaluate(() => { const id = Object.keys(window.__db.projects).find(k => window.__db.projects[k].project_name === 'X 案 複本');
    return id ? JSON.parse(JSON.stringify(window.__db.projects[id])) : null; });
  ok('複製專案：新專案沒有 AI-Thermal 的資料 → 不帶改名標記（畫面上也清掉）',
     !!cpy && cpy.rf_data.every(c => !('_renamed_from' in c)) && await page.evaluate(() => components.rf.every(c => !('_renamed_from' in c))),
     cpy && cpy.rf_data.map(c => [c.Component, c._renamed_from]));

  // 新專案（匯入本機檔後存成新的）→ 沒有可以對照的資料庫內容，不標
  await seed(PROJ); await load();
  await page.evaluate(async () => {
    components.rf.find(c => c.Component === 'Driver')._renamed_from = 'Something';   // 例：匯入的檔案帶著舊標記
    projectIdentitySet(null, 'Y 案'); await cloudSaveProject(); });
  const ydb = await page.evaluate(() => { const id = Object.keys(window.__db.projects).find(k => window.__db.projects[k].project_name === 'Y 案');
    return id ? JSON.parse(JSON.stringify(window.__db.projects[id])) : null; });
  ok('新專案：不帶改名標記', !!ydb && ydb.rf_data.every(c => !('_renamed_from' in c)), ydb && ydb.rf_data.map(c => [c.Component, c._renamed_from]));

  console.log('\n[H] 真的後端：graphDb／fileDb');
  const h = await page.evaluate(async () => {
    const out = {};
    // 先測讀檔（這個頁面還沒持有過任何 SharePoint 資料 ＝ 本 session 第一次讀檔）：
    // 內容空白但檔案不是 0 bytes → 唯讀保護（不 bootstrap 空骨架）；真的是 0 bytes → 照常建立
    {
      const realFetch = window.fetch, realTok = graphDb._getAccessToken, realResolve = graphDb._resolveDriveItemId;
      graphDb._getAccessToken = async () => 'tok'; graphDb._resolveDriveItemId = async () => 'item';
      let size = 0;
      window.fetch = async (url) => /content$/.test(url) ? new Response('', { status: 200 })
                                    : new Response(JSON.stringify({ id: 'item', eTag: 'e1', size }), { status: 200 });
      size = 12345;
      await graphDb._readFile();
      out.emptyButSized = graphDb.isCorrupted() === true;
      size = 0;
      await graphDb._readFile();
      out.trulyEmpty = graphDb.isCorrupted() === false;
      window.fetch = realFetch; graphDb._getAccessToken = realTok; graphDb._resolveDriveItemId = realResolve;
    }
    // graphDb：寫檔改成本機假動作，驗讀寫複本與「函式欄位」
    const realWrite = graphDb._writeFile;
    graphDb._writeFile = async () => {};
    await graphDb.setDoc('projects', 'T', { project_name: 'T', rf_data: [{ Component: 'A', 'Power(W)': 1 }] });
    const d1 = await graphDb.getDoc('projects', 'T');
    d1.rf_data[0]['Power(W)'] = 999;                                  // 改複本不應影響快取
    out.copy = (await graphDb.getDoc('projects', 'T')).rf_data[0]['Power(W)'] === 1;
    let seen = null;
    await graphDb.updateDoc('projects', 'T', (cur) => { seen = cur; cur.project_name = '亂改'; return { note: 'x' }; });
    const d2 = await graphDb.getDoc('projects', 'T');
    out.fnFields = d2.note === 'x' && d2.project_name === 'T' && seen && seen.project_name === '亂改';
    let threw = false;
    try { await graphDb.updateDoc('projects', 'T', () => { throw CompMerge.MergePending([{ key: 'k' }]); }); }
    catch (e) { threw = e.name === 'MergePending'; }
    out.throwKeeps = threw && (await graphDb.getDoc('projects', 'T')).note === 'x';
    graphDb._writeFile = realWrite;
    // _graphGet：禁用快取＋5xx 重試
    const realFetch = window.fetch, realTok = graphDb._getAccessToken, realSleep = graphDb._sleep;
    graphDb._getAccessToken = async () => 'tok'; graphDb._sleep = async () => {};
    const calls = [];
    window.fetch = async (url, init) => { calls.push(init); return calls.length < 3 ? new Response('busy', { status: 503 }) : new Response('{"ok":1}', { status: 200 }); };
    const r = await graphDb._graphGet('https://graph.microsoft.com/x');
    out.retry = r.status === 200 && calls.length === 3;
    out.noStore = calls.every(i => i.cache === 'no-store' && i.headers['Cache-Control'] === 'no-cache' && !!i.signal);
    calls.length = 0;
    window.fetch = async () => new Response('nope', { status: 403 });
    let e403 = null; try { await graphDb._graphGet('https://graph.microsoft.com/y'); } catch (e) { e403 = e; }
    out.noRetry4xx = !!(e403 && e403.status === 403);
    window.fetch = realFetch; graphDb._getAccessToken = realTok; graphDb._sleep = realSleep;
    // fileDb：讀寫複本、函式欄位、refresh 存在
    out.fileRefresh = typeof fileDb.refresh === 'function';
    return out;
  });
  ok('graphDb.getDoc 回複本（改複本不影響快取）', h.copy, h);
  ok('graphDb.updateDoc 接受函式：在最新內容的複本上計算，只寫回傳的欄位', h.fnFields, h);
  ok('函式丟例外（例如有未決定的衝突）→ 不寫入、快取不變', h.throwKeeps, h);
  ok('讀取禁用快取（cache:no-store＋no-cache）並帶逾時訊號', h.noStore, h);
  ok('讀取遇到 5xx 自動重試（第 3 次成功）', h.retry, h);
  ok('403 之類的 4xx 不重試、直接丟出', h.noRetry4xx, h);
  ok('第一次讀檔讀到空內容但檔案有 12345 bytes → 進唯讀保護，不建立空骨架', h.emptyButSized, h);
  ok('真的是 0 bytes 的新檔 → 照常建立空骨架', h.trulyEmpty, h);
  ok('fileDb 有 refresh（本機檔模式存檔前重讀）', h.fileRefresh, h);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
