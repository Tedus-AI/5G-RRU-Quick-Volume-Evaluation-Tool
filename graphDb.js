(function () {
/* ---- LockError ---- */
class LockError extends Error {
  constructor(lockInfo) {
    super(`資料庫已被 ${lockInfo.lockedBy} 鎖定`);
    this.name = 'LockError';
    this.lockedBy = lockInfo.lockedBy;
    this.lockedByEmail = lockInfo.lockedByEmail;
    this.lockedAt = lockInfo.lockedAt;
    this.expiresAt = lockInfo.expiresAt;
  }
}
window.LockError = LockError;

/* ---- Module state (scoped to this IIFE) ---- */
let msalInstance = null;
let msalAccount = null;
let dbCache = {};
let driveItemId = null;
let _siteId = null;
let currentLock = null;
let dbCorrupted = false;     // 壞檔唯讀保護：JSON 解析失敗時禁止一切寫入
let lastReadProjects = 0;    // 上次成功讀檔時的 projects 筆數（歸零保險絲基準）
let sawRealData = false;     // 本 session 是否曾持有實際資料（區分「全新空庫」vs「截斷成空檔」）
let currentEtag = null;      // 最近一次讀檔的 DriveItem eTag（樂觀並發 If-Match 基準）

/* 讀寫一律用複本：getDoc 若回傳快取的活參照，呼叫端在畫面上的試改會直接改到快取，之後任何一次
   整檔寫入（例如釋放編輯鎖）就會把沒按儲存的內容寫進共用 DB；寫入時把呼叫端的物件放進快取也同理。 */
function _clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
/* updateDoc 的 fields 可以是函式：在「寫入當下的最新內容」上計算要寫的欄位（412 重讀後會重算一次），
   給需要三方合併的呼叫端用（compMerge.js）。函式拿到的是複本；丟例外 → 不寫入、原樣往外丟。 */
function _resolveFields(fields, existing) {
  return typeof fields === 'function' ? fields(existing ? _clone(existing) : null) : fields;
}

/* 外部請求一律有逾時（網路卡住時不讓畫面一直轉圈）；讀取另外自動重試（UX 慣例 11） */
const GET_TIMEOUT_MS = 30000;
const PUT_TIMEOUT_MS = 90000;
async function _fetchT(url, init, ms) {
  const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try {
    return await fetch(url, ctl ? Object.assign({}, init, { signal: ctl.signal }) : init);
  } catch (e) {
    const err = new Error((e && e.name === 'AbortError')
      ? ('連線逾時：SharePoint ' + Math.round(ms / 1000) + ' 秒沒有回應')
      : ('網路連線失敗：' + ((e && e.message) || e)));
    err.network = true;                 // 供重試判斷（逾時／斷線）
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const graphDb = {
  /* ─── MSAL Initialization ─────────────────────────────── */
  async initMsal() {
    if (msalInstance) return;

    const msalConfig = {
      auth: {
        clientId: SHAREPOINT_CONFIG.clientId,
        authority: SHAREPOINT_CONFIG.authority,
        redirectUri: SHAREPOINT_CONFIG.redirectUri
      },
      cache: {
        cacheLocation: 'localStorage',
        storeAuthStateInCookie: false
      }
    };

    msalInstance = new msal.PublicClientApplication(msalConfig);
    await msalInstance.initialize();

    try {
      const response = await msalInstance.handleRedirectPromise();
      if (response) {
        msalAccount = response.account;
      }
    } catch (e) {
      console.warn('[graphDb] handleRedirectPromise failed:', e);
    }

    if (!msalAccount) {
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length > 0) msalAccount = accounts[0];
    }
  },

  /* ─── Authentication ──────────────────────────────────── */
  async signIn() {
    if (!msalInstance) await this.initMsal();
    try {
      const response = await msalInstance.loginPopup({
        scopes: SHAREPOINT_CONFIG.scopes,
        prompt: 'select_account'
      });
      msalAccount = response.account;
      return { success: true, account: msalAccount };
    } catch (e) {
      if (e.errorCode === 'user_cancelled' || e.errorCode === 'popup_window_error') {
        return { success: false, reason: 'cancelled' };
      }
      throw e;
    }
  },

  async signOut() {
    if (!msalInstance) return;
    try {
      await msalInstance.logoutPopup({ account: msalAccount });
    } catch (e) {
      console.warn('[graphDb] logout failed:', e);
    }
    msalAccount = null;
    dbCache = {};
    driveItemId = null;
    _siteId = null;
    currentLock = null;
    dbCorrupted = false;
    currentEtag = null;
    lastReadProjects = 0;
    sawRealData = false;
  },

  isSignedIn() {
    return msalAccount !== null;
  },

  getAccountInfo() {
    if (!msalAccount) return null;
    return { name: msalAccount.name, email: msalAccount.username };
  },

  async _getAccessToken(allowInteractive = true) {
    if (!msalAccount) throw new Error('尚未登入 SharePoint');
    try {
      const response = await msalInstance.acquireTokenSilent({
        scopes: SHAREPOINT_CONFIG.scopes,
        account: msalAccount
      });
      return response.accessToken;
    } catch (e) {
      if (!allowInteractive) throw e;
      const response = await msalInstance.acquireTokenPopup({
        scopes: SHAREPOINT_CONFIG.scopes
      });
      msalAccount = response.account;
      return response.accessToken;
    }
  },

  /* ─── Graph API Helpers ───────────────────────────────── */
  async _graphGet(url, allowInteractive = true) {
    const token = await this._getAccessToken(allowInteractive);
    // cache:'no-store' ＋ no-cache：不可讓瀏覽器／代理回快取的舊檔（會把別人剛存的內容當成沒改過）。
    // 逾時、斷線、429／5xx 自動重試 2 次；其他 4xx（權限、找不到檔）直接丟出。
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await this._sleep(600 * attempt);
      let resp;
      try {
        resp = await _fetchT(url, {
          cache: 'no-store',
          headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        }, GET_TIMEOUT_MS);
      } catch (e) { lastErr = e; continue; }
      if (resp.ok) return resp;
      const errText = await resp.text().catch(() => '');
      lastErr = new Error(`Graph API GET failed: ${resp.status} ${resp.statusText} — ${errText}`);
      lastErr.status = resp.status;
      if (!(resp.status === 429 || resp.status >= 500)) break;
    }
    throw lastErr;
  },

  async _graphPut(url, body, contentType = 'application/json', extraHeaders = {}) {
    const token = await this._getAccessToken(true);
    const resp = await _fetchT(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': contentType,
        ...extraHeaders
      },
      body: body
    }, PUT_TIMEOUT_MS);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const err = new Error(`Graph API PUT failed: ${resp.status} ${resp.statusText} — ${errText}`);
      err.status = resp.status;   // 供 _withOptimisticWrite 偵測 412 Precondition Failed
      throw err;
    }
    return resp;
  },

  /* ─── Site/Drive Resolution & File I/O ────────────────── */
  async _resolveDriveItemId() {
    if (driveItemId && _siteId) return driveItemId;

    const siteResp = await this._graphGet(
      `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_CONFIG.siteHostname}:${SHAREPOINT_CONFIG.sitePath}`
    );
    const site = await siteResp.json();
    _siteId = site.id;

    const itemResp = await this._graphGet(
      `https://graph.microsoft.com/v1.0/sites/${_siteId}/drive/root:${SHAREPOINT_CONFIG.filePath}`
    );
    const item = await itemResp.json();
    driveItemId = item.id;

    return driveItemId;
  },

  async _readFile() {
    await this._resolveDriveItemId();
    // 先取 metadata 拿 eTag 作為樂觀並發基準。content GET 會被 302 導到下載主機，
    // 其 ETag 是儲存層的、不可用於 Graph 的 If-Match，所以要單獨取 DriveItem 的 eTag。
    let metaSize = null;   // 檔案實際大小（bytes）：判斷「讀到空內容」是全新空檔還是讀取異常
    try {
      const metaResp = await this._graphGet(
        `https://graph.microsoft.com/v1.0/sites/${_siteId}/drive/items/${driveItemId}?$select=id,eTag,cTag,size`
      );
      const meta = await metaResp.json();
      currentEtag = meta.eTag || meta.cTag || null;
      if (typeof meta.size === 'number') metaSize = meta.size;
    } catch (e) {
      currentEtag = null;   // 拿不到 etag → 退化為無 If-Match（不比現況差）
    }
    const resp = await this._graphGet(
      `https://graph.microsoft.com/v1.0/sites/${_siteId}/drive/items/${driveItemId}/content`
    );
    const text = await resp.text();
    if (text.trim() === '') {
      if (sawRealData) {
        // 先前已持有實際資料、現在卻讀到空檔 → 視為截斷異常，保留舊快取進唯讀，
        // 絕不可 bootstrap 空骨架後寫回（否則把整份共用 DB 抹掉）。
        dbCorrupted = true;
        console.error('[graphDb] 讀到空檔但先前已有資料 → 截斷疑慮，進入唯讀保護');
      } else if (metaSize !== 0) {
        // 本 session 第一次讀檔就讀到空內容，但檔案大小不是 0（或拿不到大小）→ 是讀取異常，不是全新空檔。
        // 若照舊 bootstrap 空骨架，下一次寫入就會把整份共用 DB 抹掉 → 進唯讀，請使用者重新整理。
        dbCorrupted = true;
        console.error('[graphDb] 讀到空內容但檔案大小為 ' + metaSize + ' bytes → 讀取異常，進入唯讀保護');
      } else {
        // 真正的全新空檔（首次建庫）→ bootstrap 空骨架
        dbCache = { rf_library: {}, digital_library: {}, pwr_library: {}, projects: {} };
        dbCorrupted = false;
      }
    } else {
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        dbCache = parsed;
        dbCorrupted = false;
      } else {
        // 壞檔（非法 JSON / 非物件）→ 保留舊快取、進入唯讀保護。
        // 絕不可 fallback 成空骨架，否則下一次寫入會把整份共用 DB 抹掉。
        dbCorrupted = true;
        console.error('[graphDb] thermal_db.json 解析失敗 → 唯讀保護模式（保留先前快取，禁止寫入）');
      }
    }
    // 記錄這次讀到的 projects 筆數，作為「歸零保險絲」的比較基準（反映磁碟現況，
    // 而非 session 高水位）：唯有「讀檔時有資料、寫檔時卻歸零」才視為記憶體異常丟失。
    lastReadProjects = Object.keys((dbCache && dbCache.projects) || {}).length;
    if (lastReadProjects > 0) sawRealData = true;
  },

  /* 寫入前安全檢查：壞檔唯讀 + projects 突然歸零保險絲 */
  _assertWritable(allowEmptyProjects) {
    if (dbCorrupted) {
      throw new Error('資料庫檔案損毀（JSON 解析失敗），已進入唯讀保護模式，本次寫入已擋下以免覆蓋共用資料庫。請至 SharePoint 檢查 thermal_db.json（文件庫「版本歷史」可還原），修復後重新整理頁面。');
    }
    if (!allowEmptyProjects) {
      const n = Object.keys((dbCache && dbCache.projects) || {}).length;
      // 上次讀檔有 projects、現在卻要寫入 0 筆 → 記憶體裡的 projects 異常丟失，擋下。
      // （磁碟本來就是空的情況 lastReadProjects===0 → 不誤擋取鎖等正常寫入。）
      if (n === 0 && lastReadProjects > 0) {
        throw new Error('安全保護：projects 集合由 ' + lastReadProjects + ' 筆突然變成 0 筆，寫入已擋下以免抹除共用資料庫。請先至 SharePoint 檢查 thermal_db.json（可用版本歷史還原）；若確認為正常狀態，重新整理頁面即可解除。');
      }
    }
  },

  async _writeFile(opts) {
    this._assertWritable(!!(opts && opts.allowEmptyProjects));
    await this._resolveDriveItemId();
    const body = JSON.stringify(dbCache, null, 2);
    const headers = {};
    if (currentEtag) headers['If-Match'] = currentEtag;   // 自我們上次讀檔後若有人改過 → 412
    const resp = await this._graphPut(
      `https://graph.microsoft.com/v1.0/sites/${_siteId}/drive/items/${driveItemId}/content`,
      body,
      'application/json',
      headers
    );
    // 寫入成功 → 從 PUT 回應更新 etag 供下一次 If-Match；解析失敗就保留舊 etag
    // （下一次寫入會 412 → 自動重讀修正，安全但多一趟）。
    try {
      const item = await resp.json();
      if (item && (item.eTag || item.cTag)) currentEtag = item.eTag || item.cTag;
    } catch (e) { /* 回應無 JSON body：靠下一次 412 自癒 */ }
    // 已成功持久化含 projects 的資料 → 標記本 session 曾有實際資料（截斷偵測用）
    if (Object.keys((dbCache && dbCache.projects) || {}).length > 0) sawRealData = true;
  },

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

  // 樂觀並發寫入：在「目前快取」上套用 mutateFn 後寫檔；若期間他人改過檔案（If-Match 412），
  // 重讀最新內容＋新 etag，再於最新狀態上重跑 mutateFn 後重試。最多 4 次。
  // mutateFn(cache) 可：(a) 直接改 cache 後 return（預設要寫）；(b) return {skipWrite:true} 不寫；
  // (c) return {value:x} 帶回傳值；(d) throw（如 LockError）→ 立即往外丟、不重試。
  async _withOptimisticWrite(mutateFn, opts) {
    const MAX = 4;
    for (let attempt = 0; ; attempt++) {
      const decision = mutateFn(dbCache) || {};
      if (decision.skipWrite) return decision.value;
      try {
        await this._writeFile(opts);
        return decision.value;
      } catch (e) {
        // 412：別人改過 → 重讀後在最新狀態上重算；逾時／斷線／429／5xx：不確定有沒有寫成功 →
        // 一樣重讀再試（帶 If-Match：若其實已寫成功會得到 412 再重讀，不會蓋掉任何人的寫入）
        const retryable = e && (e.status === 412 || e.network || e.status === 429 || e.status >= 500);
        if (retryable && attempt < MAX) {
          await this._sleep(120 * (attempt + 1));
          await this._readFile();   // 取得最新內容 + 新 etag，下一圈在最新狀態上重跑 mutateFn
          continue;
        }
        throw e;
      }
    }
  },

  /* ─── Pessimistic Locking ─────────────────────────────── */
  async acquireLock() {
    if (!msalAccount) throw new Error('尚未登入 SharePoint');

    await this._readFile();   // 取最新狀態＋etag：明顯已被鎖時可即時丟 LockError

    // 取鎖檢查與寫入透過 If-Match 構成原子 check-and-set：
    // 若他人在我們讀檔後、寫入前搶先取鎖，PUT 會 412 → 重讀後重跑此函式，
    // 看到對方的有效鎖即丟 LockError，不會兩人同時取得鎖（H-2）。
    return await this._withOptimisticWrite((cache) => {
      const now = new Date();
      const existingLock = cache.lock;
      if (existingLock && existingLock.lockedByEmail && existingLock.lockedByEmail !== msalAccount.username) {
        const expiresAt = new Date(existingLock.expiresAt);
        if (expiresAt > now) throw new LockError(existingLock);
      }
      const expiresAt = new Date(now.getTime() + SHAREPOINT_CONFIG.lockTimeoutMinutes * 60 * 1000);
      cache.lock = {
        lockedBy: msalAccount.name,
        lockedByEmail: msalAccount.username,
        lockedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString()
      };
      currentLock = cache.lock;
      return { value: currentLock };
    });
  },

  async releaseLock() {
    if (!currentLock || !msalAccount) {
      currentLock = null;
      return;
    }
    try {
      // 釋放前在最新狀態上判斷鎖是否仍屬於自己：若鎖已過期被他人接手，
      // skipWrite 不動別人的鎖與資料（修 M-1：避免用過期快取整檔回寫蓋掉對方）。
      await this._withOptimisticWrite((cache) => {
        if (cache.lock && cache.lock.lockedByEmail === msalAccount.username) {
          delete cache.lock;
          return {};
        }
        return { skipWrite: true };
      });
    } catch (e) {
      console.warn('[graphDb] releaseLock failed:', e);
    }
    currentLock = null;
  },

  hasLock() {
    return currentLock !== null;
  },

  /* 目前 dbCache 內的鎖資訊（不重新讀檔，純記憶體） */
  getLockInfo() {
    return dbCache.lock || null;
  },

  /* 重新讀檔以取得最新鎖狀態（供置頂佔用橫幅輪詢用） */
  async peekLock() {
    await this._readFile();
    return dbCache.lock || null;
  },

  /* ─── Collection/Document API (mirrors fileDb) ────────── */
  async openFile() {
    if (!msalInstance) await this.initMsal();
    if (!msalAccount) {
      const result = await this.signIn();
      if (!result.success) return result;
    }
    await this._readFile();
    return { success: true, filename: 'thermal_db.json (SharePoint)' };
  },

  async refresh() {
    await this._readFile();
  },

  isReady() {
    return msalAccount !== null && Object.keys(dbCache).length > 0;
  },

  /* 壞檔唯讀保護模式中？（UI 健康橫幅用） */
  isCorrupted() {
    return dbCorrupted;
  },

  getFilename() {
    return 'thermal_db.json (SharePoint)';
  },

  async getCollection(colName) {
    return dbCache[colName] ?? {};
  },

  async getDoc(colName, docId) {
    return _clone(dbCache[colName]?.[docId] ?? null);
  },

  async setDoc(colName, docId, data) {
    const copy = _clone(data);
    await this._withOptimisticWrite((cache) => {
      if (!cache[colName]) cache[colName] = {};
      cache[colName][docId] = copy;
    });
  },

  async updateDoc(colName, docId, fields) {
    // 衝突時於最新 doc 上重做 shallow merge：他人對其他 doc／collection 的寫入不會被
    // 我們的整檔 PUT 回滾（H-3）。fields 是函式時，每次都在最新 doc 上重算（三方合併）。
    await this._withOptimisticWrite((cache) => {
      const existing = (cache[colName] || {})[docId];
      const f = _clone(_resolveFields(fields, existing));   // 先算完再動快取：算的途中丟例外 → 快取不變
      if (!cache[colName]) cache[colName] = {};
      cache[colName][docId] = { ...(existing ?? {}), ...f };
    });
  },

  async deleteDoc(colName, docId) {
    // 使用者刻意刪除專案（含最後一筆）是合法操作 → 放行並同步保險絲基準
    await this._withOptimisticWrite((cache) => {
      if (cache[colName] && cache[colName][docId] !== undefined) {
        delete cache[colName][docId];
        return {};
      }
      return { skipWrite: true };   // 已不存在（可能他人先刪了）→ 不需寫
    }, { allowEmptyProjects: colName === 'projects' });
    if (colName === 'projects') {
      lastReadProjects = Object.keys(dbCache.projects || {}).length;   // 刪除後磁碟即此筆數
    }
  },

  async getProjectsSorted() {
    const projects = dbCache['projects'] ?? {};
    return Object.entries(projects)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => {
        const ta = a.meta?.timestamp ?? '';
        const tb = b.meta?.timestamp ?? '';
        return tb.localeCompare(ta);
      });
  },

  // 整份快取（唯讀！還原資料庫的比對畫面用，呼叫端不可修改）
  peekCache() { return dbCache; },

  // 還原資料庫（dbAdapter.restoreBackup）：走 _withOptimisticWrite → 412 時在最新內容上重算，
  // 期間別人對其他專案的寫入不會被整檔 PUT 回滾；壞檔唯讀、projects 歸零保險絲照樣生效。
  async mutateWholeDb(mutateFn) {
    if (!this.isSignedIn()) throw new Error('尚未登入 SharePoint');
    await this._readFile();
    await this._withOptimisticWrite((cache) => {
      const next = _clone(cache);
      mutateFn(next);                                // 先算完再動快取：算的途中丟例外 → 快取不變
      Object.keys(cache).forEach(k => { delete cache[k]; });
      Object.assign(cache, next);
    });
    lastReadProjects = Object.keys(dbCache.projects || {}).length;
  },

  exportBackup(tag) {
    const blob = new Blob([JSON.stringify(dbCache, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `thermal_db_backup_${new Date().toISOString().slice(0, 10)}${tag ? '_' + tag : ''}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
};

window.graphDb = graphDb;
})();
