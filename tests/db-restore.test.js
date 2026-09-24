/*
 * 還原資料庫（header「♻️ 還原資料庫」）—— headless 驗證
 * ---------------------------------------------------------------------------
 * 用真的 graphDb（SharePoint 後端），把 Graph API 換成記憶體裡的假檔案（含 eTag／If-Match／412）。
 *   [A] 檔案檢查：不是物件、單一專案檔、沒有 projects、0 個專案 → 拒絕並說明原因。
 *   [B] 比對：每個專案標「新增／會覆蓋／相同」，只在資料庫裡的專案另外列出；集合同樣比對。
 *   [C] 選擇性還原（預設）：只勾「新增」；還原後新增的專案回來、沒勾的「會覆蓋」不動、
 *       只在資料庫裡的專案保留；編輯鎖與 version 不被備份蓋掉；還原前先下載一份目前的資料庫。
 *   [D] 勾選「會覆蓋」的專案＋TIM 型號庫 → 被蓋回備份的內容；別人在同時寫入另一個專案（412）→ 保留。
 *   [E] 整份取代：沒輸入「還原」不能按；輸入後只在資料庫裡的專案被刪、編輯鎖保留。
 *   [F] 資料庫保護沒解除／唯讀保護／沒連線 → 不開檔案選擇。
 *   [G] 目前開著的專案被還原覆蓋（畫面沒有未存修改）→ 自動重新載入成還原後的內容。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/db-restore.test.js
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
const proj = (name, w, ts) => ({ meta: { timestamp: ts }, project_name: name, global_params: { T_amb: 50 },
  rf_data: [FULL('PA', { 'Power(W)': w })], digital_data: [], pwr_data: [] });

const BACKUP = {
  rf_library: {}, digital_library: {}, pwr_library: {},
  tim_library: { t1: { model: 'OLD-PAD', timType: 'Pad', k: 3, gapThickness: 1.7 } },
  projects: {
    A: proj('A 案', 30, '2026-09-20T01:00:00Z'),          // 目前資料庫已被刪掉 → 新增
    B: proj('B 案', 30, '2026-09-20T02:00:00Z'),          // 目前資料庫的 B 改過 → 會覆蓋
    C: proj('C 案', 12, '2026-09-20T03:00:00Z'),          // 一樣 → 相同
  },
  lock: { lockedByEmail: 'old@x.com', expiresAt: '2026-09-20T00:00:00Z' },
  version: 111,
};
const CURRENT = {
  rf_library: {}, digital_library: {}, pwr_library: {},
  tim_library: { t1: { model: 'NEW-PAD', timType: 'Pad', k: 5, gapThickness: 1.5 } },
  projects: {
    B: proj('B 案', 99, '2026-09-23T02:00:00Z'),
    C: proj('C 案', 12, '2026-09-20T03:00:00Z'),
    D: proj('D 案（備份之後才建）', 7, '2026-09-23T05:00:00Z'),
  },
  lock: { lockedByEmail: 'me@x.com', expiresAt: '2099-01-01T00:00:00Z' },
  version: 222,
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
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof cloudLoadOne === 'function' && calcResults && calcResults.rows.length > 0);

  // 假 SharePoint：一個檔案＋eTag；PUT 帶 If-Match 不符 → 412。window.__interferePut：第一次 PUT 前插入別人的寫入。
  const seed = (cur) => page.evaluate((cur) => {
    window.__disk = JSON.stringify(cur); window.__etag = 'e1'; window.__puts = 0; window.__exports = [];
    window.__interferePut = null; window.__alerts = [];
    graphDb._getAccessToken = async () => 'tok';
    graphDb._resolveDriveItemId = async () => 'item';
    graphDb.isSignedIn = () => true;
    graphDb.isReady = () => true;
    window.fetch = async (url, opt) => {
      if (opt && opt.method === 'PUT') {
        if (window.__interferePut) { const fn = window.__interferePut; window.__interferePut = null;
          const d = JSON.parse(window.__disk); fn(d); window.__disk = JSON.stringify(d); window.__etag += 'x'; }
        if (opt.headers['If-Match'] && opt.headers['If-Match'] !== window.__etag) return new Response('conflict', { status: 412 });
        window.__puts++; window.__disk = opt.body; window.__etag = 'e' + (window.__puts + 1);
        return new Response(JSON.stringify({ eTag: window.__etag }), { status: 200 });
      }
      if (/content$/.test(url)) return new Response(window.__disk, { status: 200 });
      return new Response(JSON.stringify({ id: 'item', eTag: window.__etag, size: window.__disk.length }), { status: 200 });
    };
    dbAdapter.exportBackup = (tag) => window.__exports.push({ tag, puts: window.__puts });
    fbOk = true; cloudLocked = false;
    window._ensureLockBeforeWrite = async () => true;
    _ensureLockBeforeWrite = window._ensureLockBeforeWrite;
    return graphDb._readFile();
  }, cur);
  const disk = () => page.evaluate(() => JSON.parse(window.__disk));
  const pick = async (obj, name) => {
    await page.evaluate(() => dbRestoreStart());
    await page.setInputFiles('#dbRestoreInput', { name: name || 'thermal_db_backup_2026-09-21.json',
      mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) });
    await page.waitForTimeout(150);
  };
  const modalOpen = () => page.evaluate(() => document.getElementById('dbRestoreModal').classList.contains('active'));

  console.log('\n[A] 檔案檢查');
  ok('header 有「還原資料庫」按鈕，緊接在「備份資料庫」後面', await page.evaluate(() => {
    const b = document.getElementById('btn-db-restore'); const prev = b && b.previousElementSibling;
    return !!b && /還原資料庫/.test(b.textContent) && !!prev && /備份資料庫/.test(prev.textContent);
  }));
  const v = await page.evaluate(() => ({
    arr: dbRestoreValidate([]), one: dbRestoreValidate({ project_name: 'x', rf_data: [] }),
    nop: dbRestoreValidate({ rf_library: {} }), empty: dbRestoreValidate({ projects: {} }),
    bad: dbRestoreValidate({ projects: { a: 3 } }), good: dbRestoreValidate({ projects: { a: {} } }),
  }));
  ok('陣列 → 拒絕', !!v.arr);
  ok('單一專案檔 → 指路「匯入專案」', /匯入專案/.test(v.one || ''), v.one);
  ok('沒有 projects → 拒絕', !!v.nop);
  ok('0 個專案 → 拒絕（不把資料庫清空）', /沒有任何專案/.test(v.empty || ''), v.empty);
  ok('專案內容格式錯 → 拒絕', !!v.bad);
  ok('正常備份 → 通過', v.good === null, v.good);
  await seed(CURRENT);
  await pick('{not json');
  ok('非 JSON 檔 → alert、不開視窗', !(await modalOpen()) && (await page.evaluate(() => window.__alerts.join('|'))).includes('不是有效的 JSON'));
  await pick({ project_name: 'x', rf_data: [] }, 'RRU_x.json');
  ok('單一專案檔 → alert、不開視窗', !(await modalOpen()) && (await page.evaluate(() => window.__alerts.join('|'))).includes('匯入專案'));

  console.log('\n[B] 比對');
  const an = await page.evaluate(([b, c]) => dbRestoreAnalyze(b, c), [BACKUP, CURRENT]);
  const st = Object.fromEntries(an.projects.map(p => [p.id, p.status]));
  ok('A 新增／B 會覆蓋／C 相同', st.A === 'new' && st.B === 'diff' && st.C === 'same', st);
  ok('只在資料庫的 D 另外列出', an.onlyCur.map(p => p.id).join() === 'D', an.onlyCur);
  const tim = an.collections.find(c => c.key === 'tim_library');
  ok('TIM 型號庫：會覆蓋、標中文名稱', tim && tim.status === 'diff' && tim.label === 'TIM 型號庫', tim);
  ok('lock／version 不列入比對', !an.collections.some(c => c.key === 'lock' || c.key === 'version'));

  console.log('\n[C] 選擇性還原（預設只勾新增）');
  await pick(BACKUP);
  ok('視窗打開', await modalOpen());
  const ui = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#dbRestoreBody .dbr-wrap')[0].querySelectorAll('tbody tr')];
    const ck = n => { const r = rows.find(r => r.textContent.includes(n)); const i = r && r.querySelector('input'); return i ? { on: i.checked, dis: i.disabled } : null; };
    return { A: ck('A 案'), B: ck('B 案'), C: ck('C 案'), go: document.getElementById('dbRestoreGo').disabled,
             goText: document.getElementById('dbRestoreGo').textContent,
             note: document.getElementById('dbRestoreBody').textContent };
  });
  ok('A 預設勾選、B 預設不勾、C 相同不能勾', ui.A && ui.A.on && ui.B && !ui.B.on && ui.C && ui.C.dis, ui);
  ok('說明只在資料庫裡的專案不會被動', /另有 1 個專案只在目前資料庫裡/.test(ui.note));
  ok('寫明會先下載一份目前的資料庫', /自動下載一份目前的資料庫/.test(ui.note));
  ok('還原鈕可按', !ui.go && /還原勾選/.test(ui.goText), ui.goText);
  await page.click('#dbRestoreGo');
  await page.waitForFunction(() => !document.getElementById('dbRestoreModal').classList.contains('active'));
  let d = await disk();
  ok('A 回來了', d.projects.A && d.projects.A.project_name === 'A 案');
  ok('B 沒勾 → 維持資料庫的版本（99 W）', d.projects.B.rf_data[0]['Power(W)'] === 99);
  ok('D 保留', !!d.projects.D);
  ok('TIM 型號庫沒勾 → 不動', d.tim_library.t1.model === 'NEW-PAD');
  ok('編輯鎖是目前的、不是備份裡的', d.lock && d.lock.lockedByEmail === 'me@x.com');
  ok('version 不被備份蓋掉', d.version === 222, d.version);
  const ex = await page.evaluate(() => window.__exports);
  ok('寫入前先下載 _before_restore 備份', ex.length === 1 && ex[0].tag === 'before_restore' && ex[0].puts === 0, ex);
  ok('完成訊息寫出結果', (await page.evaluate(() => window.__alerts.pop() || '')).includes('新增 1 個專案'));

  console.log('\n[D] 勾選會覆蓋＋共用資料；同時有人寫別的專案（412）');
  await seed(CURRENT);
  await pick(BACKUP);
  await page.evaluate(() => {
    // 每勾一格會重畫 → 每次重新找
    const byLabel = s => [...document.querySelectorAll('#dbRestoreBody input[type=checkbox]')]
      .find(b => (b.getAttribute('aria-label') || '').includes(s));
    byLabel('B 案').click(); byLabel('TIM 型號庫').click();
  });
  ok('摘要：新增 1、覆蓋 1、共用資料 1', /新增 1 個專案、覆蓋 1 個專案、還原 1 份共用資料/.test(await page.textContent('.dbr-summary')));
  await page.evaluate(() => { window.__interferePut = (db) => { db.projects.D.rf_data[0]['Power(W)'] = 8; }; });
  await page.click('#dbRestoreGo');
  await page.waitForFunction(() => !document.getElementById('dbRestoreModal').classList.contains('active'));
  d = await disk();
  ok('B 被蓋回備份（30 W）', d.projects.B.rf_data[0]['Power(W)'] === 30);
  ok('TIM 型號庫被蓋回備份', d.tim_library.t1.model === 'OLD-PAD');
  ok('別人同時寫的 D（412 後重算）保留', d.projects.D.rf_data[0]['Power(W)'] === 8, d.projects.D.rf_data[0]);

  console.log('\n[E] 整份取代');
  await seed(CURRENT);
  await pick(BACKUP);
  await page.check('input[name=dbr-mode][value=full]');
  ok('切到整份取代：列出會刪除的 D', /會刪除/.test(await page.textContent('#dbRestoreBody')));
  ok('沒輸入確認字 → 不能按', await page.evaluate(() => document.getElementById('dbRestoreGo').disabled));
  await page.fill('#dbr-confirm', '還');
  ok('輸入不完整 → 還是不能按', await page.evaluate(() => document.getElementById('dbRestoreGo').disabled));
  await page.fill('#dbr-confirm', '還原');
  ok('輸入「還原」→ 可以按、紅色', await page.evaluate(() => { const b = document.getElementById('dbRestoreGo');
    return !b.disabled && b.classList.contains('dbr-go-danger'); }));
  await page.click('#dbRestoreGo');
  await page.waitForFunction(() => !document.getElementById('dbRestoreModal').classList.contains('active'));
  d = await disk();
  ok('專案 = 備份的 A／B／C（D 被刪）', Object.keys(d.projects).sort().join() === 'A,B,C', Object.keys(d.projects));
  ok('B 是備份的內容', d.projects.B.rf_data[0]['Power(W)'] === 30);
  ok('編輯鎖保留目前的', d.lock.lockedByEmail === 'me@x.com');
  ok('version 保留目前的', d.version === 222);

  console.log('\n[F] 不能還原的狀態');
  await seed(CURRENT);
  const clicks = () => page.evaluate(async () => {
    let n = 0; const inp = document.getElementById('dbRestoreInput'); const real = inp.click; inp.click = () => { n++; };
    await dbRestoreStart(); inp.click = real; return n;
  });
  await page.evaluate(() => { _ensureLockBeforeWrite = async () => false; });
  ok('資料庫保護沒解除 → 不開檔案選擇', (await clicks()) === 0);
  await page.evaluate(() => { _ensureLockBeforeWrite = async () => true; fbOk = false;
    window.__offlinePick = 0; window.__realPickDb = handlePickDb; handlePickDb = async () => { window.__offlinePick++; }; });
  ok('沒連線資料庫 → 不強制登入 SharePoint，改開「離線資料庫」挑檔（見 offline-db.test.js）',
    (await clicks()) === 0 && (await page.evaluate(() => window.__offlinePick)) === 1
    && !(await page.evaluate(() => window.__alerts.some(a => /請先登入 SharePoint/.test(a)))));
  await page.evaluate(() => { fbOk = true; handlePickDb = window.__realPickDb; });
  ok('一切正常 → 開檔案選擇', (await clicks()) === 1);

  console.log('\n[G] 目前開著的專案被覆蓋 → 自動重新載入');
  await seed(CURRENT);
  await page.evaluate(() => cloudLoadOne('B', { silent: true }));
  const before = await page.evaluate(() => components.rf[0]['Power(W)']);
  await pick(BACKUP);
  await page.evaluate(() => { [...document.querySelectorAll('#dbRestoreBody input[type=checkbox]')]
    .find(b => (b.getAttribute('aria-label') || '').includes('B 案')).click(); });
  await page.click('#dbRestoreGo');
  await page.waitForFunction(() => !document.getElementById('dbRestoreModal').classList.contains('active'));
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ w: components.rf[0]['Power(W)'], id: currentProjectId }));
  ok('畫面上的 B 由 99 W 換成還原後的 30 W', before === 99 && after.w === 30 && after.id === 'B', { before, after });

  ok('沒有頁面錯誤', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
