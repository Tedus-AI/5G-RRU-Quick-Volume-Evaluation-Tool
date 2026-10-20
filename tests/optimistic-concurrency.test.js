/*
 * SharePoint 後端（graphDb.js）的防覆寫機制 —— 與 AI-Thermal 同一套（移植自它的 tests/optimistic-concurrency.test.js）。
 *
 * 以 mock Graph API 驅動「實際的 graphDb.js」：單一檔案＋遞增 etag，PUT 強制檢查 If-Match 不符回 412。
 *   [T1]–[T16]  與 AI-Thermal 相同的契約（412 重讀重試、取鎖原子化、壞檔／截斷唯讀、getDoc 回複本、
 *               忽略較舊內容時不換 eTag…；AI-Thermal 的 writeBatch 項目本工具沒有，改用 updateDoc 驗）
 *   [T17] 每次寫入都遞增 version（AI-Thermal 的防回退與本機檔偵測都靠它）
 *   [T18] 防版本回退：剛寫完就重讀、SharePoint 回了寫入前的舊內容 → 不採用，下一次寫入不會把剛存的蓋掉
 *   [T19] 取鎖寫入失敗（412 用盡）→ 不殘留「以為自己持鎖」的假狀態
 *   [T20] 系統管理員請離 requestEvict：旗標寫在持鎖者的鎖上、不搶鎖；沒有鎖 → 不寫檔
 *   [T21] 續約自己的鎖時請離旗標原樣保留；重新解鎖（不是續約）不沿用上次留下的旗標
 *   [T22] forceReleaseLock：清掉任何人的鎖、回傳原本的鎖
 *
 * 執行：node tests/optimistic-concurrency.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ── 瀏覽器環境 stub ── */
global.window = {};
global.SHAREPOINT_CONFIG = {
  clientId: 'test-client', authority: 'https://login.test', redirectUri: 'http://localhost',
  scopes: ['Files.ReadWrite.All'],
  siteHostname: 'contoso.sharepoint.com', sitePath: '/sites/thermal',
  filePath: '/Shared/thermal_db.json', lockTimeoutMinutes: 10,
};
const ACCOUNT = { name: 'Me', username: 'me@test.com' };
global.msal = {
  PublicClientApplication: class {
    async initialize() {}
    async handleRedirectPromise() { return null; }
    getAllAccounts() { return [ACCOUNT]; }
    async acquireTokenSilent() { return { accessToken: 'tok' }; }
    async loginPopup() { return { account: ACCOUNT }; }
    async logoutPopup() {}
  }
};

/* ── mock SharePoint：單一檔案＋遞增 etag ── */
const server = {
  etag: 1,
  content: JSON.stringify({ version: 1, rf_library: {}, digital_library: {}, pwr_library: {}, projects: { p1: { a: 1 } } }, null, 2),
  puts: 0,          // 成功寫入次數
  putAttempts: 0,   // PUT 嘗試次數（含 412）
  beforePut: null,  // 一次性 hook：模擬「他人在我們讀後、寫前」搶先寫入的競態
  alwaysBump: false,// 每次 PUT 前 etag 都先被別人改掉（持續衝突）
  staleOnce: null,  // 一次性：下一次 content GET 回這份舊內容（模擬 read-after-write 延遲）
  eTagStr() { return 'W/"' + this.etag + '"'; },
  db() { return this.content.trim() === '' ? {} : JSON.parse(this.content); },
  external(mut) {   // 模擬另一個工具/使用者的成功寫入（etag 遞增）
    const db = this.db();
    mut(db);
    this.content = JSON.stringify(db, null, 2);
    this.etag++;
  },
};

global.fetch = async (url, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase();
  const ok = (json, text) => ({
    ok: true, status: 200, statusText: 'OK',
    json: async () => json,
    text: async () => (text !== undefined ? text : JSON.stringify(json)),
  });
  if (method === 'GET') {
    if (url.includes('/sites/contoso.sharepoint.com:')) return ok({ id: 'site1' });
    if (url.includes('/drive/root:'))                   return ok({ id: 'item1' });
    if (url.includes('?$select=id,eTag,cTag'))          return ok({ id: 'item1', eTag: server.eTagStr(),
                                                                   size: server.fakeSize != null ? server.fakeSize : Buffer.byteLength(server.content) });
    if (url.endsWith('/content')) {
      if (server.staleOnce != null) { const s = server.staleOnce; server.staleOnce = null; return ok(null, s); }
      return ok(null, server.content);
    }
    throw new Error('unexpected GET ' + url);
  }
  if (method === 'PUT' && url.endsWith('/content')) {
    server.putAttempts++;
    if (server.alwaysBump) server.etag++;
    if (server.beforePut) { const h = server.beforePut; server.beforePut = null; h(); }
    const ifMatch = opts.headers && (opts.headers['If-Match'] || opts.headers['if-match']);
    if (ifMatch && ifMatch !== server.eTagStr()) {
      return { ok: false, status: 412, statusText: 'Precondition Failed',
               json: async () => ({}), text: async () => 'precondition failed' };
    }
    server.content = opts.body;
    server.etag++;
    server.puts++;
    return ok({ id: 'item1', eTag: server.eTagStr() });
  }
  throw new Error('unexpected ' + method + ' ' + url);
};

/* ── 載入實際的 graphDb.js ── */
eval(fs.readFileSync(path.join(__dirname, '..', 'graphDb.js'), 'utf8'));
const graphDb = window.graphDb;
graphDb._sleep = async () => {};   // 退避不真等，加速測試

/* ── 斷言工具 ── */
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', name); }
  else { fail++; console.log('  FAIL:', name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
async function expectThrow(name, fn, predicate) {
  try { await fn(); check(name + '（應丟錯卻成功）', false); return null; }
  catch (e) { check(name, predicate(e), e && e.message); return e; }
}
const otherLock = (extra) => Object.assign({ lockedBy: 'Other', lockedByEmail: 'other@test.com',
  lockedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60000).toISOString() }, extra || {});

(async () => {
  await graphDb.initMsal();

  console.log('[T1] 基本讀寫：PUT 帶 If-Match、成功後 etag 前進');
  await graphDb.refresh();
  await graphDb.setDoc('projects', 'p2', { b: 2 });
  check('寫入成功（1 次 PUT、無 412）', server.puts === 1 && server.putAttempts === 1);
  check('內容含 p1+p2', !!server.db().projects.p1 && server.db().projects.p2.b === 2);

  console.log('[T2] 他人改其他 doc → 我方 412 → 重讀重試 → 雙方寫入都保留');
  let base = server.putAttempts;
  server.beforePut = () => server.external(db => { db.rf_library.amp1 = { pwr: 9 }; });
  await graphDb.setDoc('projects', 'p3', { c: 3 });
  check('經 1 次 412 後重試成功（共 2 次 PUT 嘗試）', server.putAttempts === base + 2);
  check('對方的 rf_library.amp1 保留（未被回滾）', server.db().rf_library.amp1?.pwr === 9);
  check('我方的 p3 寫入成功', server.db().projects.p3?.c === 3);
  check('既有 p1/p2 完整', !!server.db().projects.p1 && !!server.db().projects.p2);

  console.log('[T3] updateDoc 412 重試：在最新 doc 上重做 shallow merge');
  server.beforePut = () => server.external(db => { db.projects.p1.sibling_field = 'theirs'; });
  await graphDb.updateDoc('projects', 'p1', { mine: 'ours' });
  const p1 = server.db().projects.p1;
  check('對方同 doc 的新欄位保留', p1.sibling_field === 'theirs');
  check('我方欄位合併成功', p1.mine === 'ours' && p1.a === 1);

  console.log('[T4] 取鎖競態：他人在我方讀後寫前搶鎖 → LockError、不雙鎖');
  server.beforePut = () => server.external(db => { db.lock = otherLock(); });
  await expectThrow('後到者得 LockError', () => graphDb.acquireLock(),
    e => e.name === 'LockError' && e.lockedBy === 'Other');
  check('鎖仍屬對方（沒被覆寫，不雙鎖）', server.db().lock.lockedByEmail === 'other@test.com');
  check('本端不誤認持鎖', graphDb.hasLock() === false);

  console.log('[T5] 過期鎖可正常接手');
  server.external(db => { db.lock = { ...otherLock(), expiresAt: new Date(Date.now() - 60000).toISOString() }; });
  const got = await graphDb.acquireLock();
  check('接手成功且鎖屬於我', got.lockedByEmail === 'me@test.com' && server.db().lock.lockedByEmail === 'me@test.com');
  check('hasLock() = true', graphDb.hasLock() === true);

  console.log('[T6] releaseLock 時鎖已被他人接手 → 完全不寫檔');
  server.external(db => { db.lock = otherLock(); });   // 模擬我方鎖過期後被接手
  base = server.putAttempts;
  const basePuts = server.puts;
  await graphDb.releaseLock();
  check('skipWrite：嘗試 1 次 PUT 即 412 收手、無成功寫入', server.putAttempts === base + 1 && server.puts === basePuts);
  check('對方的鎖原封不動', server.db().lock.lockedByEmail === 'other@test.com');
  check('本端持鎖狀態已清', graphDb.hasLock() === false);
  server.external(db => { delete db.lock; });   // 清場

  console.log('[T7] 持續 412 → 重試上限後丟出，不無限迴圈');
  await graphDb.refresh();
  server.alwaysBump = true;
  base = server.putAttempts;
  await expectThrow('上限後丟出 412', () => graphDb.setDoc('projects', 'pX', { x: 1 }), e => e && e.status === 412);
  server.alwaysBump = false;
  check('共 5 次 PUT 嘗試（首次＋4 次重試）', server.putAttempts === base + 5);
  check('檔案未被我方寫入', server.db().projects.pX === undefined);

  console.log('[T8] 歸零保險絲精修：別人清空專案後，本端取鎖不被誤擋');
  const snapshot = server.content;
  server.external(db => { db.projects = {}; });   // 另一邊刻意刪光所有專案
  await graphDb.refresh();                        // lastReadProjects → 0（磁碟現況）
  const lk = await graphDb.acquireLock();
  check('projects 為空時取鎖成功（無偽陽性）', lk.lockedByEmail === 'me@test.com');
  await graphDb.releaseLock();
  check('釋放成功', server.db().lock === undefined);

  console.log('[T9] 截斷偵測：先前已有資料卻讀到 0-byte → 唯讀；修復後解除');
  server.external(db => { db.projects = JSON.parse(snapshot).projects; });   // 還原資料（sawRealData 已為 true）
  await graphDb.refresh();
  const beforeTrunc = server.content;
  server.content = ''; server.etag++;             // 外部把檔案截斷成空
  await graphDb.refresh();
  check('進入唯讀保護', graphDb.isCorrupted() === true);
  base = server.putAttempts;
  await expectThrow('唯讀中寫入被擋（不發 PUT）', () => graphDb.setDoc('projects', 'pY', {}), e => /唯讀保護/.test(e.message));
  check('完全沒有 PUT 嘗試', server.putAttempts === base);
  server.content = beforeTrunc; server.etag++;    // 修復（還原成截斷前內容）
  await graphDb.refresh();
  check('修復後自動解除唯讀', graphDb.isCorrupted() === false);

  console.log('[T10] deleteDoc：doc 已被他人先刪 → 重讀後 skipWrite');
  await graphDb.refresh();
  server.beforePut = () => server.external(db => { delete db.projects.p3; });
  base = server.putAttempts;
  const puts0 = server.puts;
  await graphDb.deleteDoc('projects', 'p3');
  check('412 後發現已不存在 → 不再寫（無成功 PUT）', server.puts === puts0 && server.putAttempts === base + 1);
  check('p3 確實不存在、其餘資料完整', server.db().projects.p3 === undefined && !!server.db().projects.p1);

  console.log('[T12] updateDoc 的 fields 是函式：412 重讀後在最新 doc 上重算（三方合併用）');
  await graphDb.refresh();
  let calls = 0;
  server.beforePut = () => server.external(db => { db.projects.p1.a = 5; });
  await graphDb.updateDoc('projects', 'p1', (cur) => { calls++; return { derived: cur.a + 1 }; });
  check('函式跑了兩次（第一次的結果被 412 擋下）', calls === 2);
  check('寫入的是在最新內容上重算的結果（5+1=6）', server.db().projects.p1.derived === 6);

  console.log('[T13] 函式丟例外（例如合併有未決定的衝突）→ 不寫入、快取不變');
  await graphDb.refresh();
  base = server.putAttempts;
  const before = JSON.stringify(await graphDb.getDoc('projects', 'p1'));
  await expectThrow('例外原樣丟出', () => graphDb.updateDoc('projects', 'p1',
    () => { const e = new Error('pending'); e.name = 'MergePending'; throw e; }), e => e.name === 'MergePending');
  check('完全沒有 PUT', server.putAttempts === base);
  check('快取沒被動到', JSON.stringify(await graphDb.getDoc('projects', 'p1')) === before);

  console.log('[T14] getDoc 回複本：改回傳值不會改到快取');
  const d1 = await graphDb.getDoc('projects', 'p1');
  d1.a = 'mutated';
  check('快取不受影響', (await graphDb.getDoc('projects', 'p1')).a !== 'mutated');

  console.log('[T15] 忽略較舊的讀取結果時不可換 eTag（否則下一次寫入會蓋掉磁碟上的內容）');
  await graphDb.refresh();
  server.external(db => { db.version = 1; db.projects.pExt = { e: 1 }; });   // 例：SharePoint 版本還原、或不遞增 version 的寫入
  await graphDb.refresh();                                                   // 非 force 讀取 → 內容版本較舊被忽略
  base = server.putAttempts;
  await graphDb.setDoc('projects', 'pMine', { m: 1 });
  check('寫入先得到 412（eTag 沒被換成新的）→ 以磁碟為準重讀後才寫', server.putAttempts === base + 2);
  check('磁碟上的新內容（pExt）沒有被舊快取蓋掉', server.db().projects.pExt?.e === 1);
  check('我方的寫入也成功', server.db().projects.pMine?.m === 1);

  console.log('[T16] 本 session 第一次讀檔就讀到空內容：檔案大小不是 0 → 唯讀保護；真的是 0 → 建立空骨架');
  {
    const saved = window.graphDb;
    delete window.graphDb;
    eval(fs.readFileSync(path.join(__dirname, '..', 'graphDb.js'), 'utf8'));   // 全新的一份（沒有讀過任何資料）
    const fresh = window.graphDb;
    window.graphDb = saved;
    fresh._sleep = async () => {};
    await fresh.initMsal();
    const keep = server.content;
    server.content = ''; server.fakeSize = 4321;
    await fresh.refresh();
    check('讀到空內容但檔案有 4321 bytes → 唯讀保護', fresh.isCorrupted() === true);
    base = server.putAttempts;
    await expectThrow('唯讀中寫入被擋', () => fresh.setDoc('projects', 'x', {}), e => /唯讀保護/.test(e.message));
    check('沒有發出 PUT（不會用空骨架蓋掉共用 DB）', server.putAttempts === base);
    server.fakeSize = null;   // 大小照實回報 0
    await fresh.refresh();
    check('真的是 0 bytes 的新檔 → 建立空骨架、可寫入', fresh.isCorrupted() === false);
    server.content = keep;
  }

  console.log('[T17] 每次寫入都遞增 version');
  await graphDb.refresh();
  const v0 = server.db().version;
  await graphDb.setDoc('projects', 'pV1', { v: 1 });
  const v1 = server.db().version;
  await graphDb.setDoc('projects', 'pV2', { v: 2 });
  const v2 = server.db().version;
  check('version 嚴格遞增（同一毫秒內連寫也不撞號）', v1 > v0 && v2 > v1, { v0, v1, v2 });

  console.log('[T18] 防版本回退：剛寫完就重讀、SharePoint 回了寫入前的舊內容 → 不採用');
  await graphDb.refresh();
  const preWrite = server.content;                         // 寫入前的內容
  await graphDb.setDoc('projects', 'pFresh', { saved: true });
  server.staleOnce = preWrite;                             // 下一次 content GET 回舊內容（metadata 已是新 eTag）
  await graphDb.refresh();
  check('快取仍有剛存的 pFresh（舊內容被忽略）', (await graphDb.getDoc('projects', 'pFresh'))?.saved === true);
  await graphDb.setDoc('projects', 'pNext', { n: 1 });
  check('下一次寫入沒有把剛存的 pFresh 蓋掉', server.db().projects.pFresh?.saved === true && server.db().projects.pNext?.n === 1);

  console.log('[T19] 取鎖寫入失敗（412 用盡）→ 不殘留假鎖狀態');
  await graphDb.refresh();
  server.alwaysBump = true;
  await expectThrow('取鎖丟出 412', () => graphDb.acquireLock(), e => e && e.status === 412);
  server.alwaysBump = false;
  check('hasLock() = false（不會以為自己持鎖而去寫）', graphDb.hasLock() === false);
  check('伺服器上也沒有我的鎖', !server.db().lock);

  console.log('[T20] 系統管理員請離 requestEvict：旗標寫在持鎖者的鎖上、不搶鎖');
  server.external(db => { db.lock = otherLock(); });
  await graphDb.refresh();
  const ev = await graphDb.requestEvict('管理員A');
  const l20 = server.db().lock;
  check('鎖仍屬於原持鎖者（不搶鎖）', l20.lockedByEmail === 'other@test.com');
  check('evictRequested／evictBy／evictAt 寫上', l20.evictRequested === true && l20.evictBy === '管理員A' && !!l20.evictAt, l20);
  check('回傳被請離的鎖資訊', ev && ev.lockedByEmail === 'other@test.com' && ev.evictRequested === true);
  server.external(db => { delete db.lock; });
  await graphDb.refresh();
  base = server.putAttempts;
  check('沒有人持鎖 → 回傳 null', (await graphDb.requestEvict('管理員A')) === null);
  check('沒有人持鎖 → 不寫檔', server.putAttempts === base);

  console.log('[T21] 續約自己的鎖時請離旗標原樣保留；重新解鎖不沿用上次的旗標');
  await graphDb.acquireLock();
  const firstExp = server.db().lock.expiresAt;
  server.external(db => { Object.assign(db.lock, { evictRequested: true, evictBy: '管理員B', evictAt: '2026-10-20T01:00:00.000Z' }); });
  await new Promise(r => setTimeout(r, 5));
  await graphDb.acquireLock();                              // 續約（本 session 已持鎖）
  const l21 = server.db().lock;
  check('續約成功（expiresAt 延長、仍是我的鎖）', l21.lockedByEmail === 'me@test.com' && l21.expiresAt > firstExp, l21);
  check('請離旗標沒被續約洗掉', l21.evictRequested === true && l21.evictBy === '管理員B' && l21.evictAt === '2026-10-20T01:00:00.000Z', l21);
  // 續約時旗標才出現（輪詢讀過之後、續約寫入之前）→ 412 重讀後仍保留
  server.external(db => { delete db.lock.evictRequested; delete db.lock.evictBy; delete db.lock.evictAt; });
  await graphDb.refresh();
  server.beforePut = () => server.external(db => { Object.assign(db.lock, { evictRequested: true, evictBy: '管理員C' }); });
  await graphDb.acquireLock();
  check('續約途中才下的請離（412 重讀後）也保留', server.db().lock.evictRequested === true && server.db().lock.evictBy === '管理員C', server.db().lock);
  // 本 session 沒有持鎖（例：上次關分頁時鎖沒放掉）→ 重新解鎖是新的編輯期間
  server.external(db => { Object.assign(db.lock, { evictRequested: true, evictBy: '管理員D' }); });
  await graphDb.releaseLock();                             // 清掉本地狀態（伺服器的鎖也會刪）
  server.external(db => { db.lock = { lockedBy: 'Me', lockedByEmail: 'me@test.com', lockedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(), evictRequested: true, evictBy: '管理員D' }; });
  await graphDb.acquireLock();
  check('重新解鎖 → 不帶上次留下的請離旗標', server.db().lock.lockedByEmail === 'me@test.com' && !server.db().lock.evictRequested, server.db().lock);
  await graphDb.releaseLock();

  console.log('[T22] forceReleaseLock：清掉任何人的鎖、回傳原本的鎖');
  server.external(db => { db.lock = otherLock({ evictRequested: true }); });
  await graphDb.refresh();
  const prev = await graphDb.forceReleaseLock();
  check('回傳原本的鎖', prev && prev.lockedByEmail === 'other@test.com');
  check('伺服器上沒有鎖了', server.db().lock === undefined);
  check('其他資料完整', !!server.db().projects.p1 && !!server.db().projects.pFresh);
  base = server.putAttempts;
  check('沒有鎖時 → 回傳 null、不寫檔', (await graphDb.forceReleaseLock()) === null && server.putAttempts === base);

  console.log(`\n結果：${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('UNEXPECTED:', e); process.exit(1); });
