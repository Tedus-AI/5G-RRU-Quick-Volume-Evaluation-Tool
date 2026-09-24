/*
 * 離線資料庫（header「💻 離線資料庫」／沒登入時按「♻️ 還原資料庫」）—— headless 驗證
 * ---------------------------------------------------------------------------
 * 不在公司、連不到 SharePoint 時，改讀寫一份本機的資料庫 JSON（例如備份檔）。
 * 用真的 fileDb，把 showOpenFilePicker 換成記憶體裡的假檔案。
 *   [A] SharePoint 模式下「💻 離線資料庫」按鈕仍顯示。
 *   [B] 沒登入 SharePoint 時按「♻️ 還原資料庫」→ 不再要求登入，直接挑檔開成離線資料庫；
 *       之後所有判斷都視為非 SharePoint（沒有編輯鎖），也不會去打 Graph API。
 *   [C] 離線時載入／儲存專案都讀寫那個本機檔案。
 *   [D] 挑檔取消、瀏覽器不支援、檔案不是 JSON → 什麼都不變。
 *   [E] 從 SharePoint（持有編輯鎖）切到離線 → 先還鎖；寫入保護重新啟用。
 *   [F] 畫面上開著的專案在離線檔裡沒有 → 變成未存的新專案（不誤判成「原專案被刪除」）。
 *   [G] 離線時「♻️ 還原資料庫」照常可用（還原進本機檔）。
 *   [H] 登入 SharePoint 成功 → 切回 SharePoint。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/offline-db.test.js
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
const OFFLINE_DB = {
  rf_library: {}, digital_library: {}, pwr_library: {}, tim_library: {},
  projects: {
    P1: { meta: { timestamp: '2026-09-20T01:00:00Z' }, project_name: '離線案', global_params: { T_amb: 50 },
          rf_data: [FULL('PA', { 'Power(W)': 30 })], digital_data: [], pwr_data: [], thermal_specs: { PA: { x: 1 } } },
  },
};

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**', r => r.request().url().startsWith(BASE.replace(/index\.html$/, '')) ? r.continue() : r.abort());
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return []} } };
    window.__alerts = []; window.alert = m => window.__alerts.push(String(m));
    window.confirm = () => true;
    // 假的本機檔案：window.__file = { name, text }；__pick = 'ok' | 'cancel'
    window.__pick = 'ok'; window.__picks = 0; window.__perm = [];
    window.showOpenFilePicker = async () => {
      window.__picks++;
      if (window.__pick === 'cancel') { const e = new Error('cancel'); e.name = 'AbortError'; throw e; }
      const f = window.__file;
      return [{
        name: f.name, kind: 'file',
        async requestPermission(o) { window.__perm.push(o && o.mode); return 'granted'; },
        async getFile() { return { text: async () => f.text }; },
        async createWritable() { let buf = ''; return { write: async t => { buf += t; }, close: async () => { f.text = buf; f.writes = (f.writes || 0) + 1; } }; },
      }];
    };
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof cloudLoadOne === 'function' && calcResults && calcResults.rows.length > 0);
  await page.evaluate(() => {
    window.__graphCalls = 0;
    const realFetch = window.fetch;
    window.fetch = async (u, o) => { if (/graph\.microsoft\.com/.test(String(u))) window.__graphCalls++; return realFetch(u, o); };
    window.__releases = 0;
    graphDb.releaseLock = async () => { window.__releases++; };
  });
  const setFile = (obj, name) => page.evaluate(([t, n]) => { window.__file = { name: n, text: t }; }, [typeof obj === 'string' ? obj : JSON.stringify(obj), name || 'thermal_db_backup_2026-09-21.json']);
  const fileJson = () => page.evaluate(() => JSON.parse(window.__file.text));
  const lastAlert = () => page.evaluate(() => window.__alerts[window.__alerts.length - 1] || '');

  console.log('\n[A] 按鈕');
  ok('SharePoint 模式下「💻 離線資料庫」仍顯示', await page.evaluate(() => {
    const b = document.getElementById('btn-pick-db'); return !!b && /離線資料庫/.test(b.textContent) && getComputedStyle(b).display !== 'none';
  }));
  ok('一開始不是離線模式、也沒連資料庫', await page.evaluate(() => !dbAdapter.isOffline() && dbAdapter.isSharePointMode() && !fbOk));

  console.log('\n[D] 取消／不支援／壞檔 → 不切換');
  await setFile(OFFLINE_DB);
  await page.evaluate(() => { window.__pick = 'cancel'; });
  await page.evaluate(() => handlePickDb());
  ok('取消挑檔 → 仍是 SharePoint 模式', await page.evaluate(() => !dbAdapter.isOffline() && !fbOk));
  await page.evaluate(() => { window.__pick = 'ok'; });
  const realPicker = await page.evaluateHandle(() => window.showOpenFilePicker);
  await page.evaluate(() => { window.__savedPicker = window.showOpenFilePicker; delete window.showOpenFilePicker; window.showOpenFilePicker = undefined; });
  await page.evaluate(() => handlePickDb());
  ok('瀏覽器不支援 → 提示用 Chrome／Edge、不切換', /Chrome 或 Edge/.test(await lastAlert()) && await page.evaluate(() => !dbAdapter.isOffline()));
  await page.evaluate(() => { window.showOpenFilePicker = window.__savedPicker; });
  await setFile('{ not json', 'broken.json');
  await page.evaluate(() => handlePickDb());
  ok('不是 JSON → 提示、不切換', /讀不懂/.test(await lastAlert()) && await page.evaluate(() => !dbAdapter.isOffline() && !fbOk));
  await realPicker.dispose();

  console.log('\n[B] 沒登入時按「還原資料庫」→ 直接開成離線資料庫');
  await setFile(OFFLINE_DB);
  const picksBefore = await page.evaluate(() => window.__picks);
  await page.click('#btn-db-restore');
  await page.waitForFunction(() => dbAdapter.isOffline());
  const b = await page.evaluate(() => ({
    picks: window.__picks, off: dbAdapter.isOffline(), sp: dbAdapter.isSharePointMode(), ready: dbAdapter.isReady(), fb: fbOk,
    lock: dbAdapter.hasLock(), banner: document.getElementById('db-banner-text').textContent,
    login: getComputedStyle(document.getElementById('btn-sp-login')).display, perm: window.__perm.slice(),
  }));
  ok('直接叫出挑檔視窗（不再跳「請先登入 SharePoint」）', b.picks === picksBefore + 1 && !(await page.evaluate(() => window.__alerts.some(a => /請先登入 SharePoint/.test(a)))));
  ok('切成離線模式、資料庫可用', b.off && !b.sp && b.ready && b.fb, b);
  ok('header 寫出離線資料庫檔名', /離線資料庫：thermal_db_backup_2026-09-21\.json/.test(b.banner), b.banner);
  ok('「登入 SharePoint」鈕仍在（回公司可切回）', b.login !== 'none');
  ok('挑檔當下就要寫入權限', b.perm.includes('readwrite'), b.perm);
  ok('完成訊息說明存檔寫回本機檔＋回公司怎麼同步', /本機檔案/.test(await lastAlert()) && /還原資料庫/.test(await lastAlert()));

  console.log('\n[C] 離線載入／儲存');
  const proj = await page.evaluate(async () => (await dbAdapter.getProjectsSorted()).map(p => p.project_name));
  ok('專案清單來自離線檔', proj.join() === '離線案', proj);
  await page.evaluate(() => cloudLoadOne('P1', { silent: true }));
  ok('載入離線檔的專案', await page.evaluate(() => currentProjectId === 'P1' && components.rf[0]['Power(W)'] === 30));
  await page.evaluate(() => { cloudLocked = true; });
  const blocked = await page.evaluate(() => _ensureLockBeforeWrite('儲存專案'));
  ok('寫入保護沒解除 → 一樣擋下', blocked === false);
  await page.evaluate(() => { cloudLocked = false; _applyCloudLockUI(); components.rf[0]['Power(W)'] = 35; recalc(); });
  await page.evaluate(() => cloudSaveProject());
  await page.waitForTimeout(300);
  let f = await fileJson();
  ok('存檔寫回本機檔（35 W）', f.projects.P1.rf_data[0]['Power(W)'] === 35, f.projects.P1.rf_data[0]);
  ok('AI-Thermal 的欄位保留（thermal_specs）', !!(f.projects.P1.thermal_specs && f.projects.P1.thermal_specs.PA));
  ok('過程中完全沒有打 Graph API', (await page.evaluate(() => window.__graphCalls)) === 0);

  console.log('\n[G] 離線時照常可以還原（還原進本機檔）');
  const clicked = await page.evaluate(async () => {
    let n = 0; const inp = document.getElementById('dbRestoreInput'); const real = inp.click; inp.click = () => { n++; };
    await dbRestoreStart(); inp.click = real; return n;
  });
  ok('開出還原用的檔案選擇', clicked === 1);
  const bk = JSON.parse(JSON.stringify(OFFLINE_DB)); bk.projects.P2 = { project_name: '補回來的', rf_data: [], digital_data: [], pwr_data: [] };
  await page.evaluate(() => { dbAdapter.exportBackup = () => {}; });
  await page.setInputFiles('#dbRestoreInput', { name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bk)) });
  await page.waitForFunction(() => document.getElementById('dbRestoreModal').classList.contains('active'));
  await page.click('#dbRestoreGo');
  await page.waitForFunction(() => !document.getElementById('dbRestoreModal').classList.contains('active'));
  f = await fileJson();
  ok('P2 還原進本機檔、P1 維持 35 W', !!f.projects.P2 && f.projects.P1.rf_data[0]['Power(W)'] === 35);

  await setFile('{ broken', 'broken2.json');
  await page.evaluate(() => handlePickDb());
  const keep = await page.evaluate(async () => ({ corrupt: fileDb.isCorrupted(), n: (await dbAdapter.getProjectsSorted()).length,
    banner: document.getElementById('db-banner-text').textContent }));
  ok('離線中挑到壞檔 → 仍留在原本那份（可寫、不唯讀）', !keep.corrupt && keep.n === 2 && /thermal_db_backup/.test(keep.banner), keep);

  console.log('\n[F] 換一份離線檔：開著的專案不在裡面 → 變成未存的新專案');
  await setFile({ projects: { Q: { project_name: '別的檔', rf_data: [] } } }, 'other.json');
  await page.evaluate(() => handlePickDb());
  const fsw = await page.evaluate(() => ({ id: currentProjectId, name: projectNameGet(), locked: cloudLocked }));
  ok('身分清空、名稱保留', fsw.id === null && fsw.name === '離線案', fsw);
  ok('換資料庫 → 寫入保護重新啟用', fsw.locked === true);

  console.log('\n[E] 從 SharePoint（持有編輯鎖）切到離線 → 先還鎖');
  await page.evaluate(() => {
    dbAdapter.setOffline(false); cloudLocked = false;
    graphDb.hasLock = () => true; graphDb.isSignedIn = () => true;
  });
  await setFile(OFFLINE_DB);
  await page.evaluate(() => handlePickDb());
  const e = await page.evaluate(() => ({ rel: window.__releases, off: dbAdapter.isOffline(), locked: cloudLocked, hasLock: dbAdapter.hasLock() }));
  ok('還了 SharePoint 的編輯鎖', e.rel === 1, e);
  ok('切到離線、寫入保護重新啟用', e.off && e.locked, e);

  console.log('\n[H] 登入 SharePoint → 切回');
  await page.evaluate(() => {
    graphDb.signIn = async () => ({ success: true });
    graphDb._readFile = async () => {};
    graphDb.getAccountInfo = () => ({ name: 'T', email: 't@x.com' });
    graphDb.isReady = () => true;
  });
  await page.evaluate(() => handleSpLogin());
  ok('回到 SharePoint 模式', await page.evaluate(() => !dbAdapter.isOffline() && dbAdapter.isSharePointMode()));
  ok('header 顯示 SharePoint 帳號', /SharePoint/.test(await page.textContent('#db-banner-text')));

  ok('沒有頁面錯誤', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
